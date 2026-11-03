import type { FastifyInstance, FastifyRequest } from 'fastify';
import { one, q, tx } from '../db.js';
import { requireUser } from '../auth.js';
import { bad, notFound } from '../lib/errors.js';
import { displayKey, referralCode, voucherCode } from '../lib/ids.js';
import { parse, phone, z } from '../lib/validate.js';
import { stats as wsStats, toOps } from '../realtime.js';
import { notify } from '../services/notify.js';
import * as pay from '../services/payments.js';
import * as trips from '../services/trips.js';
import { complianceIssues } from './driver.js';

const ops = (req: FastifyRequest) => requireUser(req, 'admin', 'dispatcher');
const admin = (req: FastifyRequest) => requireUser(req, 'admin');

async function audit(actorId: string, action: string, entity: string, entityId: string, data?: unknown) {
  await q('INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES ($1,$2,$3,$4,$5)', [actorId, action, entity, entityId, data ?? null]);
}

/** Minimal CRUD for config-style tables. Only whitelisted columns are writable. */
function crud(app: FastifyInstance, path: string, table: string, cols: string[], opts: { pk?: string; order?: string; idType?: 'uuid' | 'text' } = {}) {
  const pk = opts.pk ?? 'id';
  const pick = (body: any) => Object.fromEntries(Object.entries(body ?? {}).filter(([k]) => cols.includes(k)));
  app.get(`/admin/${path}`, async (req) => { await ops(req); return { items: await q(`SELECT * FROM ${table} ORDER BY ${opts.order ?? pk}`) }; });
  app.post(`/admin/${path}`, async (req, reply) => {
    const me = await admin(req);
    const data = pick(req.body);
    if (!Object.keys(data).length) throw bad('empty');
    const keys = Object.keys(data);
    const row = await one(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
      keys.map((k) => (typeof data[k] === 'object' && data[k] !== null && !Array.isArray(data[k]) ? JSON.stringify(data[k]) : data[k])));
    await audit(me.id, 'create', table, String(row[pk]), data);
    reply.code(201);
    return { item: row };
  });
  app.patch(`/admin/${path}/:id`, async (req) => {
    const me = await admin(req);
    const data = pick(req.body);
    const keys = Object.keys(data);
    if (!keys.length) throw bad('empty');
    const row = await one(`UPDATE ${table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE ${pk} = $1 RETURNING *`,
      [(req.params as any).id, ...keys.map((k) => (typeof data[k] === 'object' && data[k] !== null && !Array.isArray(data[k]) ? JSON.stringify(data[k]) : data[k]))]);
    if (!row) throw notFound();
    await audit(me.id, 'update', table, String(row[pk]), data);
    return { item: row };
  });
}

export default async function adminRoutes(app: FastifyInstance) {
  // ───────────── Dashboard & live ops ─────────────
  app.get('/admin/dashboard', async (req) => {
    await ops(req);
    const tz = `'Australia/Darwin'`;
    const todayStart = `(date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz})`;
    const today = await one(
      `SELECT count(*)::int requested,
              count(*) FILTER (WHERE status = 'completed')::int completed,
              count(*) FILTER (WHERE status::text LIKE 'cancelled%')::int cancelled,
              count(*) FILTER (WHERE status = 'no_drivers')::int unfulfilled,
              coalesce(sum(final_cents) FILTER (WHERE status = 'completed'),0)::int revenue_cents,
              count(*) FILTER (WHERE kind = 'courier')::int courier
       FROM trips WHERE requested_at >= ${todayStart}`);
    const live = await one(
      `SELECT (SELECT count(*)::int FROM trips WHERE status IN ('requested','accepted','arrived','in_progress')) active_trips,
              (SELECT count(*)::int FROM trips WHERE status = 'scheduled') scheduled,
              (SELECT count(*)::int FROM drivers WHERE online AND last_seen_at > now() - interval '3 minutes') online_drivers,
              (SELECT count(*)::int FROM sos_alerts WHERE status <> 'resolved') open_sos,
              (SELECT count(*)::int FROM support_tickets WHERE status = 'open') open_tickets,
              (SELECT count(*)::int FROM drivers WHERE status IN ('applied','pending_documents')) pending_drivers,
              (SELECT count(*)::int FROM driver_documents WHERE status = 'pending') pending_docs,
              (SELECT count(*)::int FROM compliance_flags WHERE status = 'open') open_flags,
              (SELECT count(*)::int FROM hire_requests WHERE status = 'new') new_hire_requests,
              (SELECT count(*)::int FROM driver_applications WHERE status = 'new') new_applications`);
    const daily = await q(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day,
              coalesce((SELECT sum(final_cents) FROM trips t WHERE t.status='completed' AND (t.completed_at AT TIME ZONE ${tz})::date = d),0)::int revenue_cents,
              coalesce((SELECT count(*) FROM trips t WHERE t.status='completed' AND (t.completed_at AT TIME ZONE ${tz})::date = d),0)::int trips
       FROM generate_series((now() AT TIME ZONE ${tz})::date - 13, (now() AT TIME ZONE ${tz})::date, interval '1 day') d`);
    const mix = await q(`SELECT service, count(*)::int n FROM trips WHERE status = 'completed' AND completed_at > now() - interval '30 days' GROUP BY service ORDER BY n DESC`);
    const green = await one(`SELECT coalesce(sum(coalesce(actual_distance_m, est_distance_m)),0)::bigint m FROM trips WHERE status = 'completed'`);
    const rating = await one(`SELECT round(avg(rider_rating)::numeric, 2) avg FROM trips WHERE rider_rating IS NOT NULL AND completed_at > now() - interval '30 days'`);
    const plays = await one(`SELECT count(*)::int n FROM ad_plays WHERE at >= ${todayStart}`);
    const zeroKm = Number(green!.m) / 1000;
    return {
      today, live, daily, mix, avg_rating_30d: rating?.avg, ad_plays_today: plays!.n,
      lifetime: { ev_km: Math.round(zeroKm), co2_avoided_kg: Math.round(zeroKm * 0.18) },
      realtime: wsStats(),
    };
  });

  app.get('/admin/live', async (req) => {
    await ops(req);
    const drivers = await q(
      `SELECT d.user_id AS id, u.name, d.online, d.lat, d.lng, d.heading, d.last_seen_at, d.status,
              v.rego, v.battery_pct, v.range_km, v.pet_friendly, v.has_roof_display,
              (SELECT t.status FROM trips t WHERE t.driver_id = d.user_id AND t.status IN ('accepted','arrived','in_progress') LIMIT 1) AS trip_status
       FROM drivers d JOIN users u ON u.id = d.user_id LEFT JOIN vehicles v ON v.id = d.vehicle_id
       WHERE d.status = 'approved'`);
    const active = await q(
      `SELECT t.id, t.ref, t.kind, t.service, t.status, t.pickup_lat, t.pickup_lng, t.pickup_address, t.dropoff_lat, t.dropoff_lng, t.dropoff_address,
              t.requested_at, t.driver_id, ru.name AS rider_name, du.name AS driver_name, t.dispatch_attempts, t.channel
       FROM trips t JOIN users ru ON ru.id = t.rider_id LEFT JOIN users du ON du.id = t.driver_id
       WHERE t.status IN ('requested','accepted','arrived','in_progress') ORDER BY t.requested_at`);
    const sos = await q(`SELECT s.*, u.name AS user_name, t.ref AS trip_ref FROM sos_alerts s JOIN users u ON u.id = s.user_id LEFT JOIN trips t ON t.id = s.trip_id WHERE s.status <> 'resolved' ORDER BY s.created_at DESC`);
    const zones = await q('SELECT * FROM zones ORDER BY active DESC, name');
    return { drivers, trips: active, sos, zones };
  });

  // ───────────── Trips ─────────────
  app.get('/admin/trips', async (req) => {
    await ops(req);
    const { status, q: s, kind, limit = '100' } = req.query as Record<string, string>;
    const where: string[] = []; const vals: unknown[] = [];
    if (status === 'active') where.push(`t.status IN ('requested','accepted','arrived','in_progress')`);
    else if (status) { vals.push(status); where.push(`t.status = $${vals.length}`); }
    if (kind) { vals.push(kind); where.push(`t.kind = $${vals.length}`); }
    if (s) { vals.push(`%${s}%`); where.push(`(t.ref ILIKE $${vals.length} OR ru.name ILIKE $${vals.length} OR ru.phone ILIKE $${vals.length} OR t.pickup_address ILIKE $${vals.length} OR t.dropoff_address ILIKE $${vals.length})`); }
    vals.push(Math.min(Number(limit) || 100, 500));
    return { trips: await q(
      `SELECT t.id, t.ref, t.kind, t.service, t.status, t.channel, t.pickup_address, t.dropoff_address, t.requested_at, t.scheduled_for, t.completed_at,
              t.quote_cents, t.final_cents, t.tip_cents, t.payment_method, t.payment_status, t.rider_rating, ru.name AS rider_name, du.name AS driver_name
       FROM trips t JOIN users ru ON ru.id = t.rider_id LEFT JOIN users du ON du.id = t.driver_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.requested_at DESC LIMIT $${vals.length}`, vals) };
  });

  app.get('/admin/trips/:id', async (req) => {
    const me = await ops(req);
    const t = await trips.getTrip((req.params as any).id);
    const events = await q('SELECT * FROM trip_events WHERE trip_id = $1 ORDER BY at', [t.id]);
    const track = await q('SELECT lat, lng, at FROM trip_track WHERE trip_id = $1 ORDER BY at', [t.id]);
    const offers = await q('SELECT o.*, u.name FROM trip_offers o JOIN users u ON u.id = o.driver_id WHERE trip_id = $1 ORDER BY offered_at', [t.id]);
    const payments = await q('SELECT * FROM payments WHERE trip_id = $1 ORDER BY created_at', [t.id]);
    return { trip: trips.viewFor(t, me), events, track, offers, payments };
  });

  app.post('/admin/trips/:id/cancel', async (req) => {
    const me = await ops(req);
    const b = parse(z.object({ reason: z.string().max(200).optional() }), req.body);
    return { trip: await trips.cancelTrip(me, (req.params as any).id, b.reason ?? 'Cancelled by DingoGo') };
  });

  app.post('/admin/trips/:id/redispatch', async (req) => {
    await ops(req);
    const id = (req.params as any).id;
    await q(`UPDATE trips SET status = 'requested', dispatch_attempts = 0 WHERE id = $1 AND status IN ('no_drivers','requested')`, [id]);
    return { result: await trips.dispatchTrip(id) };
  });

  app.post('/admin/trips/:id/refund', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ cents: z.number().int().min(1), reason: z.string().max(200) }), req.body);
    const t = await trips.getTrip((req.params as any).id);
    const paid = (t.final_cents ?? t.cancel_fee_cents ?? 0) + t.tip_cents;
    if (b.cents > paid) throw bad('refund_too_large', 'Refund exceeds amount paid');
    if (t.payment_method === 'card' && t.payment_ref) {
      const r = await pay.refund(t.payment_ref, b.cents);
      if (!r.ok) throw bad('refund_failed', r.error);
    } else if (t.payment_method === 'wallet' || t.payment_method === 'cash') {
      await q('UPDATE users SET wallet_cents = wallet_cents + $2 WHERE id = $1', [t.rider_id, b.cents]);
    }
    await q(`INSERT INTO payments (trip_id, user_id, provider, provider_ref, kind, amount_cents, gst_cents, status) VALUES ($1,$2,$3,$4,'refund',$5,$6,'succeeded')`,
      [t.id, t.rider_id, t.payment_method, t.payment_ref, -b.cents, -Math.round(b.cents / 11)]);
    await trips.event(await import('../db.js').then((m) => m.pool), t.id, 'refund', me.id, b);
    await audit(me.id, 'refund', 'trip', t.id, b);
    void notify(t.rider_id, 'Refund issued', `We've refunded $${(b.cents / 100).toFixed(2)} on ${t.ref}. ${b.reason}`, { trip_id: t.id }, 'account');
    return { ok: true };
  });

  /** Phone / walk-in booking for customers without a smartphone (critical for community access). */
  app.post('/admin/bookings', async (req, reply) => {
    const me = await ops(req);
    const b = parse(z.object({
      phone, name: z.string().min(1).max(80),
      trip: z.record(z.string(), z.any()),
    }), req.body);
    let u = await one('SELECT * FROM users WHERE phone = $1 AND deleted_at IS NULL', [b.phone]);
    if (!u) u = await one(`INSERT INTO users (phone, name, referral_code) VALUES ($1,$2,$3) RETURNING *`, [b.phone, b.name, referralCode(b.name)]);
    const pm = (b.trip as any).payment_method ?? 'cash';
    if (pm === 'card') throw bad('card_not_supported', 'Phone bookings are cash, voucher credit or account');
    const t = await trips.createTrip(u.id, { ...(b.trip as any), payment_method: pm, channel: 'phone', booked_by: me.id });
    reply.code(201);
    return { trip: t };
  });

  // ───────────── Users & drivers ─────────────
  app.get('/admin/users', async (req) => {
    await ops(req);
    const { q: s = '', role } = req.query as Record<string, string>;
    const vals: unknown[] = [`%${s}%`];
    let where = `deleted_at IS NULL AND (name ILIKE $1 OR phone ILIKE $1 OR coalesce(email,'') ILIKE $1)`;
    if (role) { vals.push(role); where += ` AND role = $2`; }
    return { users: await q(
      `SELECT u.id, u.name, u.phone, u.email, u.role, u.loyalty_points, u.wallet_cents, u.rating_avg, u.blocked, u.created_at, u.partner_id,
              (SELECT count(*)::int FROM trips t WHERE t.rider_id = u.id AND t.status = 'completed') trips
       FROM users u WHERE ${where} ORDER BY u.created_at DESC LIMIT 200`, vals) };
  });

  app.patch('/admin/users/:id', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({
      role: z.enum(['rider', 'driver', 'admin', 'dispatcher', 'partner', 'corporate_admin']).optional(),
      blocked: z.boolean().optional(), partner_id: z.string().uuid().nullable().optional(), name: z.string().max(80).optional(),
      add_points: z.number().int().optional(), add_wallet_cents: z.number().int().optional(),
    }), req.body);
    const id = (req.params as any).id;
    const { add_points, add_wallet_cents, ...rest } = b;
    const keys = Object.keys(rest);
    if (keys.length) await q(`UPDATE users SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...keys.map((k) => (rest as any)[k])]);
    if (add_points) {
      await q('UPDATE users SET loyalty_points = greatest(loyalty_points + $2, 0) WHERE id = $1', [id, add_points]);
      await q(`INSERT INTO loyalty_ledger (user_id, points, reason) VALUES ($1,$2,'admin_adjustment')`, [id, add_points]);
    }
    if (add_wallet_cents) await q('UPDATE users SET wallet_cents = greatest(wallet_cents + $2, 0) WHERE id = $1', [id, add_wallet_cents]);
    if (b.role === 'driver') await q('INSERT INTO drivers (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
    await audit(me.id, 'update', 'user', id, b);
    return { user: await one('SELECT id, name, phone, role, blocked, loyalty_points, wallet_cents, partner_id FROM users WHERE id = $1', [id]) };
  });

  app.get('/admin/drivers', async (req) => {
    await ops(req);
    const rows = await q(
      `SELECT d.*, u.name, u.phone, u.email, u.rating_avg, u.rating_count, v.rego, v.model, v.battery_pct,
              (SELECT count(*)::int FROM driver_documents x WHERE x.driver_id = d.user_id AND x.status = 'pending') pending_docs,
              (SELECT coalesce(sum(amount_cents),0)::int FROM driver_ledger l WHERE l.driver_id = d.user_id) balance_cents,
              (SELECT count(*)::int FROM trips t WHERE t.driver_id = d.user_id AND t.status = 'completed') trips
       FROM drivers d JOIN users u ON u.id = d.user_id LEFT JOIN vehicles v ON v.id = d.vehicle_id ORDER BY d.created_at DESC`);
    for (const r of rows) { delete r.bank_account; r.compliance_issues = await complianceIssues(r.user_id); }
    return { drivers: rows };
  });

  app.get('/admin/drivers/:id', async (req) => {
    await ops(req);
    const id = (req.params as any).id;
    const d = await one(`SELECT d.*, u.name, u.phone, u.email, u.rating_avg, u.rating_count FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.user_id = $1`, [id]);
    if (!d) throw notFound('Driver');
    d.bank_account = d.bank_account ? '••••' + String(d.bank_account).slice(-3) : null;
    return {
      driver: d,
      documents: await q('SELECT * FROM driver_documents WHERE driver_id = $1 ORDER BY created_at DESC', [id]),
      compliance_issues: await complianceIssues(id),
      flags: await q('SELECT * FROM compliance_flags WHERE driver_id = $1 ORDER BY created_at DESC', [id]),
      ledger: await q('SELECT * FROM driver_ledger WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 50', [id]),
      trips: await q(`SELECT id, ref, status, service, completed_at, final_cents, rider_rating FROM trips WHERE driver_id = $1 ORDER BY requested_at DESC LIMIT 30`, [id]),
    };
  });

  app.patch('/admin/drivers/:id', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({
      status: z.enum(['applied', 'pending_documents', 'approved', 'suspended', 'rejected']).optional(),
      vehicle_id: z.string().uuid().nullable().optional(), commission_pct: z.number().min(0).max(50).optional(),
      licence_expiry: z.string().date().optional(), h_endorsement_expiry: z.string().date().optional(),
      police_check_date: z.string().date().optional(), medical_date: z.string().date().optional(),
      da_training_date: z.string().date().optional(), gst_registered: z.boolean().optional(), abn: z.string().optional(),
      accepts_pets: z.boolean().optional(), female_driver: z.boolean().optional(), zone_id: z.string().optional(),
    }), req.body);
    const id = (req.params as any).id;
    const keys = Object.keys(b);
    if (!keys.length) throw bad('empty');
    await q(`UPDATE drivers SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE user_id = $1`, [id, ...keys.map((k) => (b as any)[k])]);
    if (b.status === 'suspended') await q('UPDATE drivers SET online = false WHERE user_id = $1', [id]);
    if (b.status === 'approved') void notify(id, 'You’re approved! 🎉', 'Welcome to DingoGo. You can now go online and accept trips.', {}, 'account');
    await audit(me.id, 'update', 'driver', id, b);
    return { ok: true, compliance_issues: await complianceIssues(id) };
  });

  app.post('/admin/documents/:id/review', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ status: z.enum(['approved', 'rejected']), note: z.string().max(300).optional(), expires_at: z.string().date().optional() }), req.body);
    const doc = await one(
      `UPDATE driver_documents SET status = $2, note = $3, expires_at = coalesce($4, expires_at), reviewer_id = $5, reviewed_at = now() WHERE id = $1 RETURNING *`,
      [(req.params as any).id, b.status, b.note ?? null, b.expires_at ?? null, me.id]);
    if (!doc) throw notFound('Document');
    // Mirror key expiries onto the driver record so the online-check stays fast.
    const map: Record<string, string> = { licence: 'licence_expiry', h_endorsement: 'h_endorsement_expiry', police_check: 'police_check_date', medical: 'medical_date', disability_awareness: 'da_training_date' };
    if (b.status === 'approved' && map[doc.type]) {
      const val = ['police_check', 'medical', 'disability_awareness'].includes(doc.type) ? (doc.created_at as Date).toISOString().slice(0, 10) : doc.expires_at;
      if (val) await q(`UPDATE drivers SET ${map[doc.type]} = $2 WHERE user_id = $1`, [doc.driver_id, val]);
    }
    void notify(doc.driver_id, `Document ${b.status}`, `${doc.type.replace(/_/g, ' ')}: ${b.status}${b.note ? ' — ' + b.note : ''}`, {}, 'account');
    return { document: doc };
  });

  // ───────────── Fleet ─────────────
  crud(app, 'vehicles', 'vehicles',
    ['rego', 'make', 'model', 'year', 'colour', 'seats', 'battery_kwh', 'range_km', 'pet_friendly', 'wheelchair_accessible', 'has_roof_display',
      'ownership', 'lease_weekly_cents', 'rego_expiry', 'inspection_expiry', 'insurance_expiry', 'cvl_number', 'cvl_expiry', 'roadworthy_date', 'active', 'odometer_km'],
    { order: 'rego' });
  app.post('/admin/vehicles/:id/display-key', async (req) => {
    const me = await admin(req);
    const v = await one('UPDATE vehicles SET display_key = $2, has_roof_display = true WHERE id = $1 RETURNING id, rego, display_key', [(req.params as any).id, displayKey()]);
    if (!v) throw notFound('Vehicle');
    await audit(me.id, 'rotate_display_key', 'vehicle', v.id);
    return { vehicle: v };
  });

  /** Weekly lease deductions for drivers on DingoGo-leased cars (e.g. EV Direct Finance ~$113.33/wk). */
  app.post('/admin/lease/run', async (req) => {
    const me = await admin(req);
    const rows = await q(
      `INSERT INTO driver_ledger (driver_id, kind, amount_cents, note)
       SELECT d.user_id, 'lease', -v.lease_weekly_cents, 'Weekly vehicle lease ' || v.rego || ' — week of ' || to_char(now() AT TIME ZONE 'Australia/Darwin', 'DD Mon YYYY')
       FROM drivers d JOIN vehicles v ON v.id = d.vehicle_id
       WHERE v.ownership = 'leased_to_driver' AND v.lease_weekly_cents > 0 AND d.status = 'approved'
         AND NOT EXISTS (SELECT 1 FROM driver_ledger l WHERE l.driver_id = d.user_id AND l.kind = 'lease' AND l.created_at > now() - interval '6 days')
       RETURNING driver_id, amount_cents`);
    await audit(me.id, 'lease_run', 'driver_ledger', String(rows.length));
    return { charged: rows.length, rows };
  });

  // ───────────── Pricing & zones ─────────────
  crud(app, 'fares', 'fare_rules',
    ['service', 'label', 'base_cents', 'per_km_cents', 'per_min_cents', 'booking_fee_cents', 'min_fare_cents', 'cancel_fee_cents', 'free_wait_min',
      'wait_per_min_cents', 'night_pct', 'holiday_pct', 'levy_cents', 'active', 'description'],
    { pk: 'service', order: 'service' });
  crud(app, 'zones', 'zones', ['id', 'name', 'centre_lat', 'centre_lng', 'radius_km', 'active', 'demand_multiplier', 'launch_note'], { order: 'name' });
  crud(app, 'promos', 'promo_codes',
    ['code', 'kind', 'value', 'max_discount_cents', 'max_uses', 'per_user_limit', 'first_trip_only', 'valid_from', 'valid_to', 'active', 'description'],
    { pk: 'code', order: 'code' });
  crud(app, 'holidays', 'public_holidays', ['day', 'name'], { pk: 'day', order: 'day' });
  crud(app, 'plans', 'plans', ['code', 'name', 'price_cents', 'ride_discount_pct', 'free_deliveries', 'waive_booking_fee', 'perks', 'active'], { pk: 'code', order: 'price_cents' });
  crud(app, 'tours', 'tour_packages',
    ['slug', 'name', 'summary', 'description', 'duration_min', 'price_cents', 'max_passengers', 'stops', 'cultural_note', 'requires_permit', 'image_url', 'active'],
    { order: 'name' });

  // ───────────── Loyalty partners ─────────────
  crud(app, 'partners', 'partners', ['name', 'kind', 'address', 'lat', 'lng', 'phone', 'email', 'logo_url', 'aboriginal_owned', 'settlement_cents_per_redemption', 'active'], { order: 'name' });
  crud(app, 'rewards', 'rewards', ['partner_id', 'title', 'description', 'points_cost', 'kind', 'credit_cents', 'active'], { order: 'points_cost' });
  app.get('/admin/redemptions', async (req) => {
    await ops(req);
    return { items: await q(
      `SELECT rr.*, r.title, p.name AS partner_name, p.settlement_cents_per_redemption, u.name AS user_name
       FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id LEFT JOIN partners p ON p.id = r.partner_id JOIN users u ON u.id = rr.user_id
       ORDER BY rr.issued_at DESC LIMIT 300`),
      settlement: await q(
        `SELECT p.id, p.name, count(*)::int redeemed, (count(*) * p.settlement_cents_per_redemption)::int owed_cents
         FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id JOIN partners p ON p.id = r.partner_id
         WHERE rr.status = 'redeemed' AND rr.redeemed_at > date_trunc('month', now()) GROUP BY p.id ORDER BY owed_cents DESC`) };
  });

  // ───────────── Vouchers (cash customers) ─────────────
  app.get('/admin/vouchers', async (req) => {
    await ops(req);
    return { items: await q('SELECT v.*, p.name AS partner_name FROM gift_vouchers v LEFT JOIN partners p ON p.id = v.sold_by_partner ORDER BY created_at DESC LIMIT 500') };
  });
  app.post('/admin/vouchers', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ count: z.number().int().min(1).max(500), value_cents: z.number().int().min(500).max(20000), batch: z.string().max(40), partner_id: z.string().uuid().optional(), valid_days: z.number().int().default(365) }), req.body);
    const codes: string[] = [];
    for (let i = 0; i < b.count; i++) {
      const code = voucherCode() + voucherCode().slice(2, 6);
      codes.push(code);
      await q(`INSERT INTO gift_vouchers (code, value_cents, batch, sold_by_partner, expires_at) VALUES ($1,$2,$3,$4, now() + ($5 || ' days')::interval)`,
        [code, b.value_cents, b.batch, b.partner_id ?? null, String(b.valid_days)]);
    }
    await audit(me.id, 'vouchers_created', 'gift_vouchers', b.batch, { count: b.count, value_cents: b.value_cents });
    return { codes };
  });

  // ───────────── Advertising ─────────────
  crud(app, 'advertisers', 'advertisers', ['name', 'contact_name', 'email', 'phone', 'abn', 'community'], { order: 'name' });
  crud(app, 'campaigns', 'ad_campaigns',
    ['advertiser_id', 'name', 'headline', 'subline', 'bg_colour', 'fg_colour', 'image_url', 'starts_on', 'ends_on', 'hour_from', 'hour_to',
      'geo_lat', 'geo_lng', 'geo_radius_m', 'weight', 'cpm_cents', 'budget_cents', 'status'],
    { order: 'created_at DESC' });
  app.get('/admin/campaigns-report', async (req) => {
    await ops(req);
    return { items: await q(
      `SELECT c.id, c.name, c.status, c.starts_on, c.ends_on, c.cpm_cents, c.budget_cents, a.name AS advertiser,
              count(p.id)::int plays, coalesce(sum(p.seconds),0)::int seconds,
              round(count(p.id) * c.cpm_cents / 1000.0)::int billable_cents,
              count(DISTINCT p.vehicle_id)::int vehicles
       FROM ad_campaigns c JOIN advertisers a ON a.id = c.advertiser_id LEFT JOIN ad_plays p ON p.campaign_id = c.id
       GROUP BY c.id, a.name ORDER BY c.created_at DESC`) };
  });

  // ───────────── EV charging & battery ─────────────
  app.get('/admin/charging', async (req) => {
    await ops(req);
    const { month } = req.query as { month?: string };
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
    const by = await q(
      `SELECT v.rego, u.name AS driver_name, s.driver_id, count(*)::int sessions, sum(s.kwh)::numeric(8,1) kwh, sum(s.cost_cents)::int cost_cents,
              sum(s.cost_cents) FILTER (WHERE s.reimbursable AND s.reimbursed_at IS NULL)::int unreimbursed_cents,
              count(*) FILTER (WHERE s.location = 'home')::int home_sessions
       FROM charging_sessions s JOIN vehicles v ON v.id = s.vehicle_id LEFT JOIN users u ON u.id = s.driver_id
       WHERE to_char(s.started_at AT TIME ZONE 'Australia/Darwin', 'YYYY-MM') = $1
       GROUP BY v.rego, u.name, s.driver_id ORDER BY v.rego`, [m]);
    const efficiency = await q(
      `SELECT v.rego, v.battery_pct, v.range_km, v.odometer_km,
              (SELECT round(avg(b.ambient_c)::numeric,1) FROM battery_logs b WHERE b.vehicle_id = v.id AND b.at > now() - interval '7 days') avg_temp_c,
              (SELECT max(b.at) FROM battery_logs b WHERE b.vehicle_id = v.id) last_log
       FROM vehicles v WHERE v.active ORDER BY v.rego`);
    const sessions = await q(`SELECT s.*, v.rego FROM charging_sessions s JOIN vehicles v ON v.id = s.vehicle_id ORDER BY s.started_at DESC LIMIT 100`);
    return { month: m, by_vehicle: by, fleet: efficiency, sessions };
  });

  /** Reimburse drivers for home-charging electricity (credited to their ledger, paid with next payout). */
  app.post('/admin/charging/reimburse', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ driver_id: z.string().uuid() }), req.body);
    return tx(async (c) => {
      const rows = await q(`UPDATE charging_sessions SET reimbursed_at = now() WHERE driver_id = $1 AND reimbursable AND reimbursed_at IS NULL RETURNING cost_cents`, [b.driver_id], c);
      const total = rows.reduce((s, r) => s + (r.cost_cents ?? 0), 0);
      if (total > 0) await c.query(`INSERT INTO driver_ledger (driver_id, kind, amount_cents, note) VALUES ($1,'charging_credit',$2,$3)`, [b.driver_id, total, `Home charging reimbursement (${rows.length} sessions)`]);
      await audit(me.id, 'charging_reimburse', 'driver', b.driver_id, { total });
      return { sessions: rows.length, total_cents: total };
    });
  });

  // ───────────── Payouts ─────────────
  app.get('/admin/payouts', async (req) => {
    await ops(req);
    return { balances: await q(
      `SELECT d.user_id AS driver_id, u.name, d.bank_bsb IS NOT NULL AND d.bank_account IS NOT NULL AS has_bank,
              coalesce(sum(l.amount_cents),0)::int balance_cents,
              max(l.created_at) FILTER (WHERE l.kind = 'payout') last_payout
       FROM drivers d JOIN users u ON u.id = d.user_id LEFT JOIN driver_ledger l ON l.driver_id = d.user_id
       GROUP BY d.user_id, u.name ORDER BY balance_cents DESC`) };
  });
  app.post('/admin/payouts/:driverId', async (req) => {
    const me = await admin(req);
    const id = (req.params as any).driverId;
    const bal = await one('SELECT coalesce(sum(amount_cents),0)::int cents FROM driver_ledger WHERE driver_id = $1', [id]);
    if (bal!.cents <= 0) throw bad('nothing_to_pay', 'Driver balance is zero or negative');
    await q(`INSERT INTO driver_ledger (driver_id, kind, amount_cents, note) VALUES ($1,'payout',$2,'Bank transfer (ABA batch)')`, [id, -bal!.cents]);
    await audit(me.id, 'payout', 'driver', id, { cents: bal!.cents });
    void notify(id, 'Payout sent 💸', `$${(bal!.cents / 100).toFixed(2)} is on its way to your bank account.`, {}, 'account');
    return { paid_cents: bal!.cents };
  });

  // ───────────── Safety, support, compliance ─────────────
  app.get('/admin/sos', async (req) => {
    await ops(req);
    return { items: await q(`SELECT s.*, u.name AS user_name, u.phone AS user_phone, t.ref AS trip_ref, t.share_token FROM sos_alerts s JOIN users u ON u.id = s.user_id LEFT JOIN trips t ON t.id = s.trip_id ORDER BY s.created_at DESC LIMIT 200`) };
  });
  app.patch('/admin/sos/:id', async (req) => {
    const me = await ops(req);
    const b = parse(z.object({ status: z.enum(['acknowledged', 'resolved']), notes: z.string().max(1000).optional() }), req.body);
    const s = await one(`UPDATE sos_alerts SET status = $2, notes = coalesce($3, notes), handled_by = $4, resolved_at = CASE WHEN $2 = 'resolved' THEN now() END WHERE id = $1 RETURNING *`,
      [(req.params as any).id, b.status, b.notes ?? null, me.id]);
    toOps('sos.updated', s);
    return { item: s };
  });

  app.get('/admin/support', async (req) => {
    await ops(req);
    return { items: await q(`SELECT s.*, u.name AS user_name, u.phone AS user_phone, t.ref AS trip_ref FROM support_tickets s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN trips t ON t.id = s.trip_id ORDER BY (s.status = 'open') DESC, s.created_at DESC LIMIT 300`) };
  });
  app.patch('/admin/support/:id', async (req) => {
    await ops(req);
    const b = parse(z.object({ status: z.enum(['open', 'pending', 'resolved']), resolution: z.string().max(2000).optional() }), req.body);
    const t = await one(`UPDATE support_tickets SET status = $2, resolution = coalesce($3, resolution), updated_at = now() WHERE id = $1 RETURNING *`, [(req.params as any).id, b.status, b.resolution ?? null]);
    if (t?.user_id && b.resolution) void notify(t.user_id, `Re: ${t.subject}`, b.resolution, { ticket_id: t.id }, 'account');
    return { item: t };
  });

  app.get('/admin/compliance', async (req) => {
    await ops(req);
    const soon = `(now() + interval '30 days')::date`;
    return {
      flags: await q(`SELECT f.*, u.name AS driver_name, t.ref AS trip_ref FROM compliance_flags f LEFT JOIN users u ON u.id = f.driver_id LEFT JOIN trips t ON t.id = f.trip_id ORDER BY (f.status='open') DESC, f.created_at DESC LIMIT 200`),
      expiring_drivers: await q(
        `SELECT d.user_id, u.name, d.licence_expiry, d.h_endorsement_expiry FROM drivers d JOIN users u ON u.id = d.user_id
         WHERE d.status = 'approved' AND (d.licence_expiry < ${soon} OR d.h_endorsement_expiry < ${soon} OR d.h_endorsement_expiry IS NULL)`),
      expiring_vehicles: await q(
        `SELECT id, rego, rego_expiry, cvl_expiry, insurance_expiry, inspection_expiry FROM vehicles
         WHERE active AND (rego_expiry < ${soon} OR cvl_expiry < ${soon} OR insurance_expiry < ${soon} OR cvl_expiry IS NULL)`),
      pending_documents: await q(`SELECT x.*, u.name AS driver_name FROM driver_documents x JOIN users u ON u.id = x.driver_id WHERE x.status = 'pending' ORDER BY x.created_at`),
    };
  });
  app.patch('/admin/compliance/:id', async (req) => {
    await ops(req);
    const b = parse(z.object({ status: z.enum(['open', 'reviewed', 'actioned', 'dismissed']) }), req.body);
    return { item: await one('UPDATE compliance_flags SET status = $2 WHERE id = $1 RETURNING *', [(req.params as any).id, b.status]) };
  });

  // ───────────── Reports (levy, GST/BAS, corporate) ─────────────
  /** NT passenger services levy: $1 per completed passenger trip, lodged monthly by the dispatch network. */
  app.get('/admin/reports/levy', async (req) => {
    await ops(req);
    const { month } = req.query as { month?: string };
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
    const r = await one(
      `SELECT count(*)::int trips, coalesce(sum((fare_breakdown->>'levy_cents')::int),0)::int levy_collected_cents
       FROM trips WHERE status = 'completed' AND kind = 'ride'
         AND to_char(completed_at AT TIME ZONE 'Australia/Darwin', 'YYYY-MM') = $1`, [m]);
    const perDriver = await q(
      `SELECT u.name, count(*)::int trips FROM trips t JOIN users u ON u.id = t.driver_id
       WHERE t.status = 'completed' AND t.kind = 'ride' AND to_char(t.completed_at AT TIME ZONE 'Australia/Darwin', 'YYYY-MM') = $1 GROUP BY u.name ORDER BY trips DESC`, [m]);
    const levyRate = await one(`SELECT value FROM settings WHERE key = 'nt_levy_cents'`);
    const rate = Number(levyRate?.value ?? 100);
    return { month: m, passenger_trips: r!.trips, levy_rate_cents: rate, levy_payable_cents: r!.trips * rate, levy_collected_cents: r!.levy_collected_cents, per_driver: perDriver };
  });

  app.get('/admin/reports/gst', async (req) => {
    await ops(req);
    const { from, to } = req.query as { from?: string; to?: string };
    const f = from ?? new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10);
    const t = to ?? new Date().toISOString().slice(0, 10);
    const rows = await q(
      `SELECT kind, provider, count(*)::int n, sum(amount_cents)::int amount_cents, sum(gst_cents)::int gst_cents
       FROM payments WHERE status IN ('succeeded','pending') AND kind IN ('capture','cash','invoice','subscription','refund','tip')
         AND (created_at AT TIME ZONE 'Australia/Darwin')::date BETWEEN $1 AND $2
       GROUP BY kind, provider ORDER BY kind`, [f, t]);
    const fees = await one(
      `SELECT coalesce(-sum(amount_cents),0)::int commission_cents FROM driver_ledger WHERE kind = 'commission' AND (created_at AT TIME ZONE 'Australia/Darwin')::date BETWEEN $1 AND $2`, [f, t]);
    return { from: f, to: t, rows, dingogo_service_fees_cents: fees!.commission_cents, gst_on_service_fees_cents: Math.round(fees!.commission_cents / 11) };
  });

  crud(app, 'corporate', 'corporate_accounts', ['name', 'kind', 'abn', 'billing_email', 'monthly_limit_cents', 'invoice_terms_days', 'discount_pct', 'active'], { order: 'name' });
  app.post('/admin/corporate/:id/members', async (req) => {
    await admin(req);
    const b = parse(z.object({ phone, role: z.enum(['member', 'manager']).default('member') }), req.body);
    const u = await one('SELECT id FROM users WHERE phone = $1', [b.phone]);
    if (!u) throw notFound('User with that phone');
    await q(`INSERT INTO corporate_members (account_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (account_id, user_id) DO UPDATE SET role = $3`, [(req.params as any).id, u.id, b.role]);
    return { ok: true };
  });
  app.get('/admin/corporate/:id/statement', async (req) => {
    await ops(req);
    const { month } = req.query as { month?: string };
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
    const acct = await one('SELECT * FROM corporate_accounts WHERE id = $1', [(req.params as any).id]);
    if (!acct) throw notFound('Account');
    const lines = await q(
      `SELECT t.ref, t.completed_at, u.name AS rider, t.pickup_address, t.dropoff_address, t.final_cents, t.ndis_number
       FROM trips t JOIN users u ON u.id = t.rider_id
       WHERE t.corporate_account_id = $1 AND t.status = 'completed' AND to_char(t.completed_at AT TIME ZONE 'Australia/Darwin', 'YYYY-MM') = $2 ORDER BY t.completed_at`, [acct.id, m]);
    const total = lines.reduce((s, l) => s + l.final_cents, 0);
    return { account: acct, month: m, lines, total_cents: total, gst_cents: Math.round(total / 11),
      members: await q('SELECT u.id, u.name, u.phone, m.role FROM corporate_members m JOIN users u ON u.id = m.user_id WHERE m.account_id = $1', [acct.id]) };
  });

  // ───────────── Inbound: hire requests, driver applications, enquiries ─────────────
  for (const [path, table] of [['hire-requests', 'hire_requests'], ['applications', 'driver_applications'], ['enquiries', 'enquiries']] as const) {
    app.get(`/admin/${path}`, async (req) => { await ops(req); return { items: await q(`SELECT * FROM ${table} ORDER BY created_at DESC LIMIT 300`) }; });
    app.patch(`/admin/${path}/:id`, async (req) => {
      await ops(req);
      const b = parse(z.object({ status: z.string().max(20), quote_cents: z.number().int().optional() }), req.body);
      const extra = table === 'hire_requests' && b.quote_cents != null ? ', quote_cents = $3' : '';
      const vals = [(req.params as any).id, b.status, ...(extra ? [b.quote_cents] : [])];
      return { item: await one(`UPDATE ${table} SET status = $2${extra} WHERE id = $1 RETURNING *`, vals) };
    });
  }

  // ───────────── Settings & broadcast ─────────────
  app.get('/admin/settings', async (req) => { await ops(req); return { items: await q('SELECT * FROM settings ORDER BY key') }; });
  app.put('/admin/settings/:key', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ value: z.any() }), req.body);
    const row = await one(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2 RETURNING *`, [(req.params as any).key, JSON.stringify(b.value)]);
    await audit(me.id, 'setting', 'settings', row.key, b.value);
    return { item: row };
  });

  /** Promotional broadcast — Spam Act: only to riders who opted in; every message identifies DingoGo and how to opt out. */
  app.post('/admin/broadcast', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ audience: z.enum(['riders_opted_in', 'drivers']), title: z.string().min(2).max(60), body: z.string().min(2).max(240) }), req.body);
    const users = b.audience === 'drivers'
      ? await q(`SELECT user_id AS id FROM drivers WHERE status = 'approved'`)
      : await q(`SELECT id FROM users WHERE role = 'rider' AND marketing_opt_in AND deleted_at IS NULL`);
    const body = b.audience === 'riders_opted_in' ? `${b.body}\n— DingoGo. Turn off offers in Account › Notifications.` : b.body;
    for (const u of users) await notify(u.id, b.title, body, {}, b.audience === 'drivers' ? 'account' : 'promo');
    await audit(me.id, 'broadcast', 'notifications', b.audience, { title: b.title, count: users.length });
    return { sent: users.length };
  });

  app.get('/admin/audit', async (req) => {
    await admin(req);
    return { items: await q('SELECT a.*, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY at DESC LIMIT 300') };
  });
}
