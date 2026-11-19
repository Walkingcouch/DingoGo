import type { FastifyInstance, FastifyRequest } from 'fastify';
import { one, pool, q, tx } from '../db.js';
import { requireUser } from '../auth.js';
import { ApiError, bad, conflict, notFound } from '../lib/errors.js';
import { APPLICATION_STAGES, STAGE_KEYS, applicationsPending, applicationsReady } from '../lib/growth.js';
import { displayKey, referralCode, voucherCode } from '../lib/ids.js';
import { GIFT_CARD_MIN_DAYS, darwin, loyaltyReady } from '../lib/loyalty.js';
import { giftCardExpiry, settlementsFor } from '../services/loyalty.js';
import { parse, phone, z } from '../lib/validate.js';
import { VERIFIED_SOURCES, greenSql, normaliseRego, vehicleAgeRule, vehicleOut } from '../lib/vehicles.js';
import { STATES, ageRule, getJurisdiction, listJurisdictions } from '../lib/jurisdictions.js';
import { decodeVin, normaliseVin } from '../lib/vin.js';
import { lookupPlate, plateLookupConfigured } from '../lib/plateLookup.js';
import { config } from '../config.js';
import { disconnectUser, stats as wsStats, toOps } from '../realtime.js';
import { notify, send, sendSmsT } from '../services/notify.js';
import { replyableSender, smsConfigured } from '../services/sms.js';
import { pushProviders } from '../services/push.js';
import { integrationStatus } from './health.js';
import { gsmFriendly, render, smsSegments } from '../lib/messages.js';
import * as pay from '../services/payments.js';
import * as trips from '../services/trips.js';
import { complianceIssues } from './driver.js';
import { DRIVER_PAY_DEFAULTS, loadDriverPay, mergeDriverPay } from '../lib/driverPay.js';
import { invalidateConfig } from '../lib/cache.js';
import { floorReport, runEarningsFloor } from '../services/earningsFloor.js';
import { gstReport, levyReport, tripFilters } from '../services/reports.js';
import { audit as writeAudit } from '../lib/audit.js';
import { saveCommunityPricing } from './community.js';
import { checkSafetyPolicy, safetyReady } from '../lib/safety.js';
import { ACCOUNT_KINDS } from '../lib/community.js';
import { sessionOnline } from '../services/safety.js';

/** Driver pay rules (all optional on update; merged over what is stored). Bounds keep a typo from paying out wildly. */
const driverPayBody = z.object({
  service_fee: z.object({ own_car_pct: z.number().min(0).max(50), green_pct: z.number().min(0).max(50) }).partial().optional(),
  pickup: z.object({
    enabled: z.boolean(), free_km: z.number().min(0).max(20), driver_cents_per_km: z.number().int().min(0).max(300),
    rider_cents_per_km: z.number().int().min(0).max(300), max_km: z.number().min(0).max(50),
  }).partial().optional(),
  fuel_surcharge: z.object({ enabled: z.boolean(), cents: z.number().int().min(0).max(500) }).partial().optional(),
  earnings_floor: z.object({ enabled: z.boolean(), cents_per_engaged_hour: z.number().int().min(0).max(10000), auto_weekly: z.boolean() }).partial().optional(),
}).strict();

async function saveDriverPay(actorId: string, body: unknown) {
  const b = parse(driverPayBody, body);
  invalidateConfig('setting:driver_pay');   // merge onto what is saved now, not this instance's cached copy
  const cur = await loadDriverPay();
  const next = mergeDriverPay({
    service_fee: { ...cur.service_fee, ...b.service_fee }, pickup: { ...cur.pickup, ...b.pickup },
    fuel_surcharge: { ...cur.fuel_surcharge, ...b.fuel_surcharge }, earnings_floor: { ...cur.earnings_floor, ...b.earnings_floor },
  });
  next.fuel_surcharge.cents = Math.round(next.fuel_surcharge.cents / 5) * 5;   // cash-friendly
  await q(`INSERT INTO settings (key, value) VALUES ('driver_pay', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(next)]);
  await q('INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES ($1,$2,$3,$4,$5)',
    [actorId, 'driver_pay', 'settings', 'driver_pay', JSON.stringify({ before: cur, after: next })]);
  return next;
}

import { ROUND19_TOUR_COLUMNS, checkTourFields, checkTourPolicy, tourFields } from '../lib/tours.js';
import { migrationPending as toursPending, toursReady } from '../services/tours.js';
const ops = (req: FastifyRequest) => requireUser(req, 'admin', 'dispatcher');
const admin = (req: FastifyRequest) => requireUser(req, 'admin');

const audit = (actorId: string, action: string, entity: string, entityId: string, data?: unknown) => writeAudit(actorId, action, entity, entityId, data);

/** Minimal CRUD for config-style tables. Only whitelisted columns are writable. */
/** Promo code fields (Round 17). Hours are Darwin time, `hour_to` exclusive (22 to 6 runs over midnight); days 0 = Sunday. */
const promoFields = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9_-]{3,30}$/, 'Code is 3 to 30 letters or numbers').optional(),
  kind: z.enum(['percent', 'fixed']).optional(), value: z.number().int().min(0).max(100000).optional(),
  max_discount_cents: z.number().int().min(0).max(100000).nullable().optional(), max_uses: z.number().int().min(1).nullable().optional(),
  per_user_limit: z.number().int().min(1).max(100).optional(), first_trip_only: z.boolean().optional(),
  valid_from: z.string().datetime({ offset: true }).nullable().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullable().optional()),
  valid_to: z.string().datetime({ offset: true }).nullable().optional().or(z.string().regex(/^\d{4}-\d{2}-\d{2}/).nullable().optional()),
  active: z.boolean().optional(), description: z.string().max(300).nullable().optional(),
  budget_cents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  services: z.array(z.string().max(40)).max(20).nullable().optional().transform((v) => (v && v.length ? v : v === undefined ? undefined : null)),
  hour_from: z.number().int().min(0).max(23).nullable().optional(), hour_to: z.number().int().min(1).max(24).nullable().optional(),
  days: z.array(z.coerce.number().int().min(0).max(6)).max(7).nullable().optional().transform((v) => (v && v.length ? [...new Set(v)].sort() : v === undefined ? undefined : null)),
  geo_lat: z.number().min(-45).max(-9).nullable().optional(), geo_lng: z.number().min(110).max(155).nullable().optional(),
  geo_radius_m: z.number().int().min(50).max(20000).nullable().optional(), targeted: z.boolean().optional(),
});

function crud(app: FastifyInstance, path: string, table: string, cols: string[],
  opts: { pk?: string; order?: string; idType?: 'uuid' | 'text'; list?: boolean; out?: (row: any) => any;
    /** Validate / derive fields before writing. `id` is set on update. */
    prepare?: (data: Record<string, any>, id?: string) => Promise<Record<string, any>> } = {}) {
  const pk = opts.pk ?? 'id';
  const out = opts.out ?? ((r: any) => r);
  const pick = (body: any) => Object.fromEntries(Object.entries(body ?? {}).filter(([k]) => cols.includes(k)));
  if (opts.list !== false) app.get(`/admin/${path}`, async (req) => { await ops(req); return { items: await q(`SELECT * FROM ${table} ORDER BY ${opts.order ?? pk}`) }; });
  app.post(`/admin/${path}`, async (req, reply) => {
    const me = await admin(req);
    let data = pick(req.body);
    if (!Object.keys(data).length) throw bad('empty');
    if (opts.prepare) data = await opts.prepare(data);
    const keys = Object.keys(data);
    const row = await one(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`,
      keys.map((k) => (typeof data[k] === 'object' && data[k] !== null && !Array.isArray(data[k]) ? JSON.stringify(data[k]) : data[k])));
    await audit(me.id, 'create', table, String(row[pk]), data);
    reply.code(201);
    return { item: out(row) };
  });
  app.patch(`/admin/${path}/:id`, async (req) => {
    const me = await admin(req);
    let data = pick(req.body);
    if (!Object.keys(data).length) throw bad('empty');
    if (opts.prepare) data = await opts.prepare(data, (req.params as any).id);
    const keys = Object.keys(data);
    const row = await one(`UPDATE ${table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE ${pk} = $1 RETURNING *`,
      [(req.params as any).id, ...keys.map((k) => (typeof data[k] === 'object' && data[k] !== null && !Array.isArray(data[k]) ? JSON.stringify(data[k]) : data[k]))]);
    if (!row) throw notFound();
    await audit(me.id, 'update', table, String(row[pk]), data);
    return { item: out(row) };
  });
}

/** Business account fields an admin can set. The discount feeds every fare on the account, so it is bounded (the admin form
 *  says 0–50%); an empty limit means no limit. */
const corporateFields = z.object({
  name: z.string().trim().min(1).max(120).nullable().optional(),
  kind: z.enum(ACCOUNT_KINDS).nullable().optional(),
  abn: z.preprocess((v) => (typeof v === 'string' ? v.replace(/\s+/g, '') || null : v), z.string().regex(/^\d{11}$/, 'ABN is 11 digits').nullable().optional()),
  billing_email: z.string().trim().email().max(200).nullable().optional(),
  monthly_limit_cents: z.number().int().min(0).max(10_000_000).nullable().optional(),
  invoice_terms_days: z.number().int().min(0).max(120).nullable().optional(),
  discount_pct: z.number().min(0).max(50).nullable().optional(),
  active: z.boolean().nullable().optional(),
});
/** Validated account fields; a cleared field that can't be empty is left as it was. */
function corporateInput(d: Record<string, any>) {
  const o: Record<string, any> = parse(corporateFields, d);
  for (const k of ['name', 'kind', 'billing_email', 'invoice_terms_days', 'discount_pct', 'active']) if (o[k] === null) delete o[k];
  if (!Object.keys(o).length) throw bad('empty');
  return o;
}

const PPSR_URL = 'https://www.ppsr.gov.au/carcheck';
/** What the admin "Checks" panel needs for a car's state. */
function stateRules(j: any) {
  if (!j) return null;
  const r = ageRule(j.vehicle_max_age_years);
  return { code: j.code, name: j.name, max_age_years: r.max_age_years, min_year: r.min_year, inspection_months: j.inspection_months,
    rego_check_url: j.rego_check_url, ppsr_url: PPSR_URL, vehicle_docs: j.vehicle_docs, active: j.active };
}

/** Admin fleet create/edit: normalise VIN + decode vin_year, normalise rego state, apply the state's age limit when year/state change. */
async function prepareAdminVehicle(data: Record<string, any>, id?: string) {
  const out = { ...data };
  if (out.vin === '' ) out.vin = null;
  if (out.vin != null) {
    const r = decodeVin(String(out.vin));
    if (!r.valid) throw bad('vin', r.note);
    out.vin = normaliseVin(String(out.vin));
    out.vin_year = r.year;
  } else if ('vin' in out) out.vin_year = null;
  if (out.rego_state != null) {
    out.rego_state = String(out.rego_state).toUpperCase();
    if (!(STATES as readonly string[]).includes(out.rego_state)) throw bad('rego_state', 'rego_state must be NT or SA');
  }
  if (out.verified_source != null && !(VERIFIED_SOURCES as readonly string[]).includes(out.verified_source)) throw bad('verified_source', `verified_source must be one of ${VERIFIED_SOURCES.join(', ')}`);
  if (out.year != null || out.rego_state != null || out.verified_year != null) {
    const cur = id ? await one('SELECT year, verified_year, rego_state FROM vehicles WHERE id = $1', [id]) : null;
    const state = out.rego_state ?? cur?.rego_state ?? 'NT';
    const year = out.verified_year ?? cur?.verified_year ?? out.year ?? cur?.year;
    if (year != null) {
      const rule = await vehicleAgeRule(state);
      if (year < rule.min_year) throw bad('vehicle_too_old', `${state} rideshare cars must be ${rule.min_year} or newer (under ${rule.max_age_years} years old)`);
    }
  }
  return out;
}

/** Approve or reject one driver document, mirror key expiries onto the driver record, and audit it. Null if not found (or, with
 *  onlyPending, no longer waiting). The caller notifies the driver. */
async function reviewDocument(actorId: string, id: string, b: { status: 'approved' | 'rejected'; note?: string; expires_at?: string }, opts: { onlyPending?: boolean } = {}) {
  const doc = await one(
    `UPDATE driver_documents SET status = $2, note = $3, expires_at = coalesce($4, expires_at), reviewer_id = $5, reviewed_at = now()
     WHERE id = $1 ${opts.onlyPending ? `AND status = 'pending'` : ''} RETURNING *`,
    [id, b.status, b.note ?? null, b.expires_at ?? null, actorId]);
  if (!doc) return null;
  // Mirror key expiries onto the driver record so the online-check stays fast.
  const map: Record<string, string> = { licence: 'licence_expiry', h_endorsement: 'h_endorsement_expiry', police_check: 'police_check_date', medical: 'medical_date', disability_awareness: 'da_training_date' };
  if (b.status === 'approved' && map[doc.type]) {
    const val = ['police_check', 'medical', 'disability_awareness'].includes(doc.type) ? (doc.created_at as Date).toISOString().slice(0, 10) : doc.expires_at;
    if (val) await q(`UPDATE drivers SET ${map[doc.type]} = $2 WHERE user_id = $1`, [doc.driver_id, val]);
  }
  await writeAudit(actorId, 'document_review', 'driver_document', doc.id, { driver_id: doc.driver_id, type: doc.type, status: b.status, note: b.note ?? null });
  return doc;
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
              (SELECT count(*)::int FROM vehicles WHERE status = 'pending') pending_vehicles,
              (SELECT count(*)::int FROM compliance_flags WHERE status = 'open') open_flags,
              (SELECT count(*)::int FROM hire_requests WHERE status = 'new') new_hire_requests,
              (SELECT count(*)::int FROM driver_applications WHERE status = 'new') new_applications`);
    const daily = await q(
      `SELECT to_char(d, 'YYYY-MM-DD') AS day,
              coalesce((SELECT sum(final_cents) FROM trips t WHERE t.status='completed' AND (t.completed_at AT TIME ZONE ${tz})::date = d),0)::int revenue_cents,
              coalesce((SELECT count(*) FROM trips t WHERE t.status='completed' AND (t.completed_at AT TIME ZONE ${tz})::date = d),0)::int trips
       FROM generate_series((now() AT TIME ZONE ${tz})::date - 13, (now() AT TIME ZONE ${tz})::date, interval '1 day') d`);
    const mix = await q(`SELECT service, count(*)::int n FROM trips WHERE status = 'completed' AND completed_at > now() - interval '30 days' GROUP BY service ORDER BY n DESC`);
    // Going electric: share of completed-trip km done in green cars (EV + hybrids) over 30 days; EV km & CO₂ count electric cars only.
    const green = await one(
      `SELECT coalesce(sum(coalesce(t.actual_distance_m, t.est_distance_m)) FILTER (WHERE t.completed_at > now() - interval '30 days'),0)::bigint m30,
              coalesce(sum(coalesce(t.actual_distance_m, t.est_distance_m)) FILTER (WHERE t.completed_at > now() - interval '30 days' AND ${greenSql('v')}),0)::bigint green_m30,
              coalesce(sum(coalesce(t.actual_distance_m, t.est_distance_m)) FILTER (WHERE t.completed_at > now() - interval '30 days' AND v.fuel_type = 'electric'),0)::bigint ev_m30,
              coalesce(sum(coalesce(t.actual_distance_m, t.est_distance_m)) FILTER (WHERE v.fuel_type = 'electric'),0)::bigint ev_m
       FROM trips t LEFT JOIN vehicles v ON v.id = t.vehicle_id WHERE t.status = 'completed'`);
    const rating = await one(`SELECT round(avg(rider_rating)::numeric, 2) avg FROM trips WHERE rider_rating IS NOT NULL AND completed_at > now() - interval '30 days'`);
    const plays = await one(`SELECT count(*)::int n FROM ad_plays WHERE at >= ${todayStart}`);
    const evKm = Number(green!.ev_m) / 1000;
    const m30 = Number(green!.m30);
    const greenPct = m30 > 0 ? Math.round((Number(green!.green_m30) / m30) * 1000) / 10 : 0;
    return {
      today, live, daily, mix, avg_rating_30d: rating?.avg, ad_plays_today: plays!.n,
      green_km_pct: greenPct,                                  // % of completed-trip km in green cars, last 30 days
      ev_km: Math.round(evKm),                                 // lifetime km in electric cars
      co2_saved_kg: Math.round(evKm * 0.18),                   // lifetime, electric cars only (vs ~180 g/km petrol)
      green_30d: { total_km: Math.round(m30 / 1000), green_km: Math.round(Number(green!.green_m30) / 1000), ev_km: Math.round(Number(green!.ev_m30) / 1000), green_km_pct: greenPct },
      lifetime: { ev_km: Math.round(evKm), co2_avoided_kg: Math.round(evKm * 0.18) },
      realtime: wsStats(),
    };
  });

  app.get('/admin/live', async (req) => {
    await ops(req);
    // Four independent reads at once (Round 18): the live map polls this every few seconds.
    const [drivers, active, sos, zones] = await Promise.all([q(
      `SELECT d.user_id AS id, u.name, d.online, d.lat, d.lng, d.heading, d.last_seen_at, d.status,
              v.rego, v.battery_pct, v.range_km, v.pet_friendly, v.has_roof_display, v.fuel_type,
              (v.fuel_type IN ('electric','plug_in_hybrid','hybrid')) AS green, (v.fuel_type = 'electric') AS is_ev,
              (SELECT t.status FROM trips t WHERE t.driver_id = d.user_id AND t.status IN ('accepted','arrived','in_progress') LIMIT 1) AS trip_status
       FROM drivers d JOIN users u ON u.id = d.user_id LEFT JOIN vehicles v ON v.id = d.vehicle_id
       WHERE d.status = 'approved'`),
    q(
      `SELECT t.id, t.ref, t.kind, t.service, t.status, t.pickup_lat, t.pickup_lng, t.pickup_address, t.dropoff_lat, t.dropoff_lng, t.dropoff_address,
              t.requested_at, t.scheduled_for, t.driver_id, ru.name AS rider_name, du.name AS driver_name, t.dispatch_attempts, t.channel,
              dd.last_seen_at AS driver_last_seen_at,
              (SELECT count(*)::int FROM trip_offers o WHERE o.trip_id = t.id AND o.status IN ('cancelled','released')) AS driver_releases
       FROM trips t JOIN users ru ON ru.id = t.rider_id LEFT JOIN users du ON du.id = t.driver_id LEFT JOIN drivers dd ON dd.user_id = t.driver_id
       WHERE t.status IN ('requested','accepted','arrived','in_progress') ORDER BY t.requested_at`),
    q(`SELECT s.*, u.name AS user_name, t.ref AS trip_ref FROM sos_alerts s JOIN users u ON u.id = s.user_id LEFT JOIN trips t ON t.id = s.trip_id WHERE s.status <> 'resolved' ORDER BY s.created_at DESC`),
    q('SELECT * FROM zones ORDER BY active DESC, name')]);
    return { drivers, trips: active, sos, zones };
  });

  // ───────────── Trips ─────────────
  app.get('/admin/trips', async (req) => {
    await ops(req);
    const { where, vals } = tripFilters(req.query as Record<string, string>);
    vals.push(Math.min(Number((req.query as any).limit) || 100, 500));
    return { trips: await q(
      `SELECT t.id, t.ref, t.kind, t.service, t.status, t.channel, t.pickup_address, t.dropoff_address, t.requested_at, t.scheduled_for, t.completed_at,
              t.quote_cents, t.final_cents, t.tip_cents, t.payment_method, t.payment_status, t.rider_rating, ru.name AS rider_name, du.name AS driver_name, v.rego
       FROM trips t JOIN users ru ON ru.id = t.rider_id LEFT JOIN users du ON du.id = t.driver_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY t.requested_at DESC LIMIT $${vals.length}`, vals) };
  });

  app.get('/admin/trips/:id', async (req) => {
    const me = await ops(req);
    const t = await trips.getTrip((req.params as any).id);
    const events = await q('SELECT * FROM trip_events WHERE trip_id = $1 ORDER BY at', [t.id]);
    const track = await q('SELECT lat, lng, at FROM trip_track WHERE trip_id = $1 ORDER BY at', [t.id]);
    const offers = await q('SELECT o.*, u.name FROM trip_offers o JOIN users u ON u.id = o.driver_id WHERE trip_id = $1 ORDER BY offered_at', [t.id]);
    const payments = await q('SELECT * FROM payments WHERE trip_id = $1 ORDER BY created_at', [t.id]);
    // What the driver was paid for this trip (fare, fee, pickup pay, fuel surcharge, tip, cancellation share).
    const driver_ledger = await q('SELECT id, driver_id, kind, amount_cents, note, created_at FROM driver_ledger WHERE trip_id = $1 ORDER BY id', [t.id]);
    // Round 9: the trip chat (safety record) and texts/calls sent about the trip (template and last digits only). Empty before migration 015.
    const opt = <T>(p: Promise<T>, empty: T) => p.catch((e) => { if (e?.code === '42P01' || e?.code === '42703') return empty; throw e; });
    const messages = await opt(q(`SELECT m.id, m.sender_role, u.name AS sender_name, m.body, m.via, m.read_at, m.created_at FROM trip_messages m
      LEFT JOIN users u ON u.id = m.sender_id WHERE m.trip_id = $1 ORDER BY m.id`, [t.id]), []);
    const comms = await opt(q('SELECT id, at, channel, template, to_tail, status, error FROM comms_log WHERE trip_id = $1 ORDER BY id', [t.id]), []);
    return { trip: trips.viewFor(t, me), events, track, offers, payments, driver_ledger, messages, comms };
  });

  app.post('/admin/trips/:id/cancel', async (req) => {
    const me = await ops(req);
    const b = parse(z.object({ reason: z.string().max(200).optional() }), req.body ?? {});
    const trip = await trips.cancelTrip(me, (req.params as any).id, b.reason ?? 'Cancelled by DingoGo');
    await audit(me.id, 'cancel', 'trip', (req.params as any).id, { reason: b.reason ?? null });
    return { trip };
  });

  app.post('/admin/trips/:id/redispatch', async (req) => {
    const me = await ops(req);
    const id = (req.params as any).id;
    const result = await trips.redispatchTrip(id, me.id);
    await audit(me.id, 'redispatch', 'trip', id);
    return { result };
  });

  /** Take an accepted trip off its driver (e.g. no signal, broken down) and offer it to the next driver. Not counted against the driver. */
  app.post('/admin/trips/:id/reassign', async (req) => {
    const me = await ops(req);
    const id = (req.params as any).id;
    const b = parse(z.object({ reason: z.string().max(200).optional() }), req.body ?? {});
    const trip = await trips.reassignTrip(id, { by: 'ops', actorId: me.id, reason: 'ops_reassigned', note: b.reason });
    await audit(me.id, 'reassign', 'trip', id, b);
    return { trip: trips.viewFor(trip, me) };
  });

  /** Refund part or all of what the rider paid. The fare is refunded first, then the tip, each back to where it was paid
   *  (the fare's and the tip's own PaymentIntent; credit for wallet and cash). GST comes off the fare part only. */
  app.post('/admin/trips/:id/refund', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ cents: z.number().int().min(1), reason: z.string().min(1).max(200) }), req.body);
    const id = (req.params as any).id;
    // One refund at a time per trip (row lock), and the running total can never exceed what the rider paid.
    const out = await tx(async (c) => {
      const t = await one('SELECT * FROM trips WHERE id = $1 FOR UPDATE', [id], c);
      if (!t) throw notFound('Trip');
      const farePaid = t.payment_status === 'failed' ? 0 : (t.final_cents ?? t.cancel_fee_cents ?? 0);
      const tip = await one(`SELECT provider, provider_ref, amount_cents FROM payments WHERE trip_id = $1 AND kind = 'tip' AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1`, [id], c);
      const tipPaid = tip ? t.tip_cents ?? 0 : 0;
      const rows = await q(`SELECT provider_ref, -amount_cents AS cents FROM payments WHERE trip_id = $1 AND kind = 'refund' AND status = 'succeeded'`, [id], c);
      const prior = rows.reduce((n: number, r: any) => n + r.cents, 0);
      const left = farePaid + tipPaid - prior;
      if (b.cents > left) throw bad('refund_too_large', left > 0 ? `Only $${(left / 100).toFixed(2)} is left to refund on this trip` : 'This trip has already been fully refunded', { refundable_cents: Math.max(left, 0) });
      // How much of each part is already refunded: by PaymentIntent when the tip has its own, otherwise fare first.
      const ownTipRef = tip?.provider_ref && tip.provider_ref !== t.payment_ref && !['wallet'].includes(tip.provider_ref);
      const tipRefunded = ownTipRef ? rows.filter((r: any) => r.provider_ref === tip!.provider_ref).reduce((n: number, r: any) => n + r.cents, 0) : Math.max(prior - farePaid, 0);
      const fareRefunded = prior - tipRefunded;
      const farePart = Math.min(b.cents, Math.max(farePaid - fareRefunded, 0));
      const tipPart = b.cents - farePart;
      const parts: { cents: number; gst: number; method: string; ref: string | null; which: string }[] = [];
      if (farePart > 0 && t.payment_method === 'card' && t.fare_breakdown?.deposit) {
        // Round 19: a tour fare paid partly by its deposit is refunded against each payment in turn (what's left on each).
        const caps = await q(`SELECT provider_ref, sum(amount_cents)::int cents FROM payments WHERE trip_id = $1 AND kind = 'capture' AND status = 'succeeded' AND provider_ref IS NOT NULL
                              GROUP BY provider_ref ORDER BY min(created_at) DESC`, [id], c);
        let need = farePart;
        for (const cap of caps) {
          const done = rows.filter((r: any) => r.provider_ref === cap.provider_ref).reduce((n: number, r: any) => n + r.cents, 0);
          const take = Math.min(need, Math.max(0, cap.cents - done));
          if (take > 0) { parts.push({ cents: take, gst: Math.round(take / 11), method: 'card', ref: cap.provider_ref, which: `fare-${parts.length}` }); need -= take; }
        }
        if (need > 0) throw bad('refund_too_large', 'Nothing left to refund on the card payments for this trip');
      } else if (farePart > 0) parts.push({ cents: farePart, gst: Math.round(farePart / 11), method: t.payment_method, ref: t.payment_ref, which: 'fare' });
      if (tipPart > 0) parts.push({ cents: tipPart, gst: 0, method: tip!.provider === 'wallet' ? 'wallet' : 'card', ref: tip!.provider_ref, which: 'tip' });
      for (const p of parts) {
        let provider = p.method;
        if (p.method === 'card' && p.ref) {
          const r = await pay.refund(p.ref, p.cents, `${t.id}-${prior}-${p.which}-${p.cents}`);
          if (!r.ok) throw bad('refund_failed', r.error);
          provider = p.ref.startsWith('mock_') ? 'mock' : 'stripe';
        } else if (p.method === 'wallet' || p.method === 'cash') {
          // Cash fares are refunded as DingoGo credit.
          await c.query('UPDATE users SET wallet_cents = wallet_cents + $2 WHERE id = $1', [t.rider_id, p.cents]);
          provider = 'wallet';
        }
        await c.query(`INSERT INTO payments (trip_id, user_id, provider, provider_ref, kind, amount_cents, gst_cents, status) VALUES ($1,$2,$3,$4,'refund',$5,$6,'succeeded')`,
          [t.id, t.rider_id, provider, p.ref, -p.cents, -p.gst]);
      }
      if (b.cents === left) await c.query(`UPDATE trips SET payment_status = 'refunded' WHERE id = $1`, [t.id]);
      await trips.event(c, t.id, 'refund', me.id, { ...b, fare_cents: farePart, tip_cents: tipPart });
      await c.query('INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES ($1,$2,$3,$4,$5)', [me.id, 'refund', 'trip', t.id, b]);
      return { t, refundable_cents: left - b.cents };
    });
    void send(out.t.rider_id, 'refund_issued', { ref: out.t.ref, cents: b.cents, reason: b.reason }, { data: { trip_id: out.t.id } });
    return { ok: true, refundable_cents: out.refundable_cents };
  });

  /** Card payment that didn't go through: charge the rider's current default card again. */
  app.post('/admin/trips/:id/retry-payment', async (req) => {
    const me = await admin(req);
    const id = (req.params as any).id;
    const r = await trips.retryTripPayment(id, me);
    await audit(me.id, 'retry_payment', 'trip', id, { ok: r.ok, reason: (r as any).code ?? null });
    return r;
  });

  /** Payment problems to follow up: card payments that failed, and disputes (chargebacks) still open. */
  app.get('/admin/payments/issues', async (req) => {
    await admin(req);
    const failed = await q(
      `SELECT t.id, t.ref, t.status, t.payment_method, coalesce(t.final_cents, t.cancel_fee_cents) AS cents, coalesce(t.completed_at, t.cancelled_at) AS at,
              ru.name AS rider_name,
              (SELECT e.data->>'reason' FROM trip_events e WHERE e.trip_id = t.id AND e.type IN ('payment_failed','payment_retry_failed') ORDER BY e.at DESC LIMIT 1) AS reason
       FROM trips t JOIN users ru ON ru.id = t.rider_id
       WHERE t.payment_status = 'failed' ORDER BY coalesce(t.completed_at, t.cancelled_at, t.requested_at) DESC LIMIT 200`);
    const disputes = await q(
      `SELECT p.id, p.provider_ref AS dispute_ref, p.status, -p.amount_cents AS cents, p.created_at, t.id AS trip_id, t.ref, ru.name AS rider_name
       FROM payments p LEFT JOIN trips t ON t.id = p.trip_id LEFT JOIN users ru ON ru.id = p.user_id
       WHERE p.kind = 'dispute' AND p.status NOT IN ('won','lost','warning_closed') ORDER BY p.created_at DESC LIMIT 200`);
    return { failed, disputes };
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
    const vals: unknown[] = [`%${String(s).slice(0, 100)}%`];
    let where = `deleted_at IS NULL AND (name ILIKE $1 OR phone ILIKE $1 OR coalesce(email,'') ILIKE $1)`;
    if (role) { vals.push(role); where += ` AND role = $2`; }
    return { users: await q(
      `SELECT u.id, u.name, u.phone, u.email, u.role, u.loyalty_points, u.wallet_cents, u.rating_avg, u.blocked, u.created_at, u.partner_id, u.test_account,
              (SELECT count(*)::int FROM trips t WHERE t.rider_id = u.id AND t.status = 'completed') trips
       FROM users u WHERE ${where} ORDER BY u.created_at DESC LIMIT 200`, vals) };
  });

  app.patch('/admin/users/:id', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({
      role: z.enum(['rider', 'driver', 'admin', 'dispatcher', 'partner', 'corporate_admin']).optional(),
      blocked: z.boolean().optional(), partner_id: z.string().uuid().nullable().optional(), name: z.string().max(80).optional(),
      add_points: z.number().int().optional(), add_wallet_cents: z.number().int().optional(),
      test_account: z.boolean().optional(),
    }), req.body);
    const id = (req.params as any).id;
    const { add_points, add_wallet_cents, ...rest } = b;
    // The block switch is a ban without a stated reason: record it in the account's standing (so the person can appeal), and
    // record a lift when it's switched off. Admin → Safety → account standing gives reasons and end dates.
    if (b.blocked !== undefined && await safetyReady()) {
      const cur = await one('SELECT blocked FROM users WHERE id = $1', [id]);
      if (cur && cur.blocked !== b.blocked) {
        await q(`INSERT INTO account_actions (user_id, action, reason_code, public_reason, by_id) VALUES ($1, $2, 'other', $3, $4)`,
          [id, b.blocked ? 'ban' : 'lift', b.blocked ? 'A breach of the DingoGo terms.' : 'Your account is active again.', me.id]);
        if (b.blocked) await sessionOnline(id, false, 'blocked');
      }
    }
    const keys = Object.keys(rest);
    if (keys.length) await q(`UPDATE users SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...keys.map((k) => (rest as any)[k])]);
    if (add_points) {
      await q('UPDATE users SET loyalty_points = greatest(loyalty_points + $2, 0) WHERE id = $1', [id, add_points]);
      await q(`INSERT INTO loyalty_ledger (user_id, points, reason) VALUES ($1,$2,'admin_adjustment')`, [id, add_points]);
    }
    if (add_wallet_cents) await q('UPDATE users SET wallet_cents = greatest(wallet_cents + $2, 0) WHERE id = $1', [id, add_wallet_cents]);
    if (b.role === 'driver') await q('INSERT INTO drivers (user_id) VALUES ($1) ON CONFLICT DO NOTHING', [id]);
    // Blocked or role changed: drop their live connections now (they reconnect and are checked again).
    if (b.blocked) { await q('UPDATE drivers SET online = false WHERE user_id = $1', [id]); await trips.withdrawOffers(id); }
    if (b.blocked || b.role) disconnectUser(id, b.blocked ? 'blocked' : 'role changed');
    await audit(me.id, 'update', 'user', id, b);
    return { user: await one('SELECT id, name, phone, role, blocked, loyalty_points, wallet_cents, partner_id FROM users WHERE id = $1', [id]) };
  });

  /** Create an account for testing. Test accounts sign in with code 000000 (while demo mode is on), so no SMS is needed.
   *  A test driver can be made ready to drive immediately: approved, credentials on file, and a car assigned. */
  app.post('/admin/users', async (req, reply) => {
    const me = await admin(req);
    const b = parse(z.object({
      phone, name: z.string().min(1).max(80),
      role: z.enum(['rider', 'driver', 'admin', 'dispatcher', 'partner', 'corporate_admin']).default('rider'),
      test_account: z.boolean().default(true),
      partner_id: z.string().uuid().nullable().optional(),
      vehicle_id: z.string().uuid().nullable().optional(),
      ready_to_drive: z.boolean().default(true),
      state: z.enum(STATES).default('NT'),
      wallet_cents: z.number().int().min(0).max(100000).default(0),
      loyalty_points: z.number().int().min(0).max(100000).default(0),
    }), req.body);
    const exists = await one('SELECT id FROM users WHERE phone = $1 AND deleted_at IS NULL', [b.phone]);
    if (exists) throw bad('phone_taken', 'An account with that phone number already exists — edit it in the list instead');
    const user = await tx(async (c) => {
      const u = await one(
        `INSERT INTO users (phone, name, role, referral_code, test_account, partner_id, wallet_cents, loyalty_points)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, name, phone, role, test_account`,
        [b.phone, b.name, b.role, referralCode(b.name), b.test_account, b.role === 'partner' ? b.partner_id ?? null : null, b.wallet_cents, b.loyalty_points], c);
      if (b.role === 'driver') {
        if (b.ready_to_drive) {
          const far = new Date(Date.now() + 2 * 365 * 864e5).toISOString().slice(0, 10);
          const today = new Date().toISOString().slice(0, 10);
          const vehicle = b.vehicle_id ?? (await one(`SELECT id FROM vehicles WHERE active AND status = 'approved' AND ownership <> 'driver_owned' ORDER BY rego LIMIT 1`, [], c))?.id ?? null;
          await c.query(
            `INSERT INTO drivers (user_id, status, vehicle_id, licence_no, licence_expiry, h_endorsement_expiry, cpv_authority_no, abn, gst_registered,
               police_check_date, medical_date, da_training_date, accepts_pets, bio, state)
             VALUES ($1,'approved',$2,'TEST',$3,$3,'TEST','00000000000',true,$4,$4,$4,true,'Test driver account',$5)`,
            [u.id, vehicle, far, today, b.state]);
          // Test credentials on file: every document the state requires, approved.
          const j = await getJurisdiction(b.state, c);
          for (const type of j?.driver_docs ?? []) {
            await c.query(`INSERT INTO driver_documents (driver_id, type, number, expires_at, status, reviewer_id, reviewed_at) VALUES ($1,$2,'TEST',$3,'approved',$4,now())`,
              [u.id, type, far, me.id]);
          }
        } else {
          await c.query(`INSERT INTO drivers (user_id, state) VALUES ($1,$2)`, [u.id, b.state]);
        }
      }
      return u;
    });
    await audit(me.id, 'create_user', 'user', user.id, { role: b.role, test_account: b.test_account });
    reply.code(201);
    return { user };
  });

  app.get('/admin/drivers', async (req) => {
    await ops(req);
    const rows = await q(
      `SELECT d.*, u.name, u.phone, u.email, u.rating_avg, u.rating_count, v.rego, v.make, v.model, v.battery_pct, v.fuel_type,
              v.status AS vehicle_status, v.ownership AS vehicle_ownership,
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
      da_training_date: z.string().date().optional(), gst_registered: z.boolean().optional(), abn: z.string().regex(/^\d{11}$/, 'ABN is 11 digits').optional(),
      accepts_pets: z.boolean().optional(), female_driver: z.boolean().optional(), zone_id: z.string().max(40).optional(),
      state: z.enum(STATES).optional(),
    }), req.body);
    const id = (req.params as any).id;
    const keys = Object.keys(b);
    if (!keys.length) throw bad('empty');
    await q(`UPDATE drivers SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE user_id = $1`, [id, ...keys.map((k) => (b as any)[k])]);
    if (b.status === 'suspended' || b.state) { await q('UPDATE drivers SET online = false WHERE user_id = $1', [id]); await trips.withdrawOffers(id); }
    if (b.status === 'approved') void send(id, 'driver_approved', {}, { data: {} });
    await audit(me.id, 'update', 'driver', id, b);
    return { ok: true, compliance_issues: await complianceIssues(id) };
  });

  app.post('/admin/documents/:id/review', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ status: z.enum(['approved', 'rejected']), note: z.string().max(300).optional(), expires_at: z.string().date().optional() }), req.body);
    const doc = await reviewDocument(me.id, (req.params as any).id, b);
    if (!doc) throw notFound('Document');
    void send(doc.driver_id, 'documents_reviewed', { types: [doc.type.replace(/_/g, ' ')], status: b.status, note: b.note }, { data: {} });
    return { document: doc };
  });

  /** Review many documents at once (the "Documents to review" queue). Only documents still waiting are changed, so an old screen or a
   *  double click can't overturn someone else's decision. One notification per driver. */
  app.post('/admin/documents/review', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({
      ids: z.array(z.string().uuid()).min(1).max(50), status: z.enum(['approved', 'rejected']), note: z.string().max(300).optional(),
    }), req.body);
    if (b.status === 'rejected' && !b.note?.trim()) throw bad('note_required', 'Give the driver a reason for rejecting');
    const ids = [...new Set(b.ids)];
    const reviewed: any[] = []; const skipped: { id: string; reason: string }[] = [];
    for (const id of ids) {
      const doc = await reviewDocument(me.id, id, { status: b.status, note: b.note }, { onlyPending: true });
      if (doc) reviewed.push(doc);
      else skipped.push({ id, reason: (await one('SELECT 1 FROM driver_documents WHERE id = $1', [id])) ? 'not_pending' : 'not_found' });
    }
    const byDriver = new Map<string, string[]>();
    for (const d of reviewed) byDriver.set(d.driver_id, [...(byDriver.get(d.driver_id) ?? []), d.type.replace(/_/g, ' ')]);
    for (const [driverId, types] of byDriver) {
      void send(driverId, 'documents_reviewed', { types, status: b.status, note: b.note }, { data: {} });
    }
    return { reviewed: reviewed.map((d) => d.id), skipped };
  });

  // ───────────── Fleet ─────────────
  /** Fleet + driver-owned cars. ?status=pending|approved|rejected|all (default all). Each item has owner + that car's documents. */
  app.get('/admin/vehicles', async (req) => {
    await ops(req);
    const { status = 'all' } = req.query as { status?: string };
    if (!['pending', 'approved', 'rejected', 'all'].includes(status)) throw bad('invalid_status', 'status must be pending, approved, rejected or all');
    const rows = await q(
      `SELECT v.*,
              CASE WHEN ou.id IS NOT NULL THEN json_build_object('id', ou.id, 'name', ou.name, 'phone', ou.phone) END AS owner,
              (SELECT json_build_object('id', au.id, 'name', au.name) FROM drivers ad JOIN users au ON au.id = ad.user_id WHERE ad.vehicle_id = v.id LIMIT 1) AS assigned_driver,
              coalesce((SELECT json_agg(json_build_object('id', x.id, 'type', x.type, 'number', x.number, 'expires_at', x.expires_at, 'status', x.status,
                        'note', x.note, 'file_url', x.file_url, 'driver_id', x.driver_id, 'created_at', x.created_at) ORDER BY x.created_at DESC)
                        FROM driver_documents x WHERE x.vehicle_id = v.id), '[]') AS documents
       FROM vehicles v LEFT JOIN users ou ON ou.id = v.owner_driver_id
       WHERE ($1 = 'all' OR v.status = $1)
       ORDER BY (v.status = 'pending') DESC, v.rego`, [status]);
    const states = Object.fromEntries((await listJurisdictions()).map((j) => [j.code, j]));
    return { items: rows.map((r) => ({ ...vehicleOut(r, { keepSecrets: true }), state_rules: stateRules(states[r.rego_state]) })), ppsr_url: PPSR_URL };
  });
  crud(app, 'vehicles', 'vehicles',
    ['rego', 'make', 'model', 'year', 'colour', 'seats', 'doors', 'fuel_type', 'vin', 'status', 'review_note', 'registered_owner', 'owner_driver_id',
      'battery_kwh', 'range_km', 'pet_friendly', 'wheelchair_accessible', 'has_roof_display',
      'ownership', 'lease_weekly_cents', 'rego_expiry', 'inspection_expiry', 'insurance_expiry', 'cvl_number', 'cvl_expiry', 'roadworthy_date', 'active', 'odometer_km',
      'rego_state', 'verified_year', 'verified_source'],
    { order: 'rego', list: false, out: (r) => vehicleOut(r, { keepSecrets: true }), prepare: prepareAdminVehicle });

  /** Check a driver-owned car. Approve needs: the state's expiry dates (CVL for NT, inspection for SA, rego, insurance),
   *  a verified year of manufacture within the state's age limit, and rego_checked=true (checked on the state gov site). */
  app.post('/admin/vehicles/:id/review', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({
      decision: z.enum(['approve', 'reject']), note: z.string().max(300).optional(),
      cvl_number: z.string().max(40).optional(), cvl_expiry: z.string().date().optional(), rego_expiry: z.string().date().optional(),
      insurance_expiry: z.string().date().optional(), roadworthy_date: z.string().date().optional(),
      inspection_expiry: z.string().date().optional(),
      verified_year: z.number().int().min(1950).max(2100).optional(), verified_source: z.enum(VERIFIED_SOURCES).optional(),
      rego_checked: z.boolean().optional(), ppsr_clear: z.boolean().optional(),
    }), req.body);
    const id = (req.params as any).id;
    const cur = await one('SELECT * FROM vehicles WHERE id = $1', [id]);
    if (!cur) throw notFound('Vehicle');
    const j = await getJurisdiction(cur.rego_state);
    if (b.decision === 'approve') {
      const need: string[] = ['rego_expiry', 'insurance_expiry'];
      if (!j || j.vehicle_docs.includes('vehicle_cvl')) need.unshift('cvl_expiry');
      if (j?.inspection_months) need.push('inspection_expiry');
      const names: Record<string, string> = { cvl_expiry: 'CVL', rego_expiry: 'rego', insurance_expiry: 'insurance', inspection_expiry: `${cur.rego_state} inspection` };
      const missing = need.filter((k) => !((b as any)[k] ?? cur[k]));
      if (missing.length) throw bad('dates_required', `Enter the ${missing.map((k) => names[k]).join(', ')} expiry date${missing.length > 1 ? 's' : ''} before approving`, missing);
      const year = b.verified_year ?? cur.verified_year;
      if (year == null) throw bad('verified_year_required', 'Enter the year of manufacture you checked (compliance plate, rego papers or VIN) before approving');
      const rule = ageRule(j?.vehicle_max_age_years ?? 13);
      if (year < rule.min_year) throw bad('vehicle_too_old', `${cur.rego} was made in ${year} — ${cur.rego_state} rideshare cars must be ${rule.min_year} or newer (under ${rule.max_age_years} years old)`);
      if (b.rego_checked !== true) throw bad('rego_check_required', `Check the registration is current on the ${cur.rego_state} government rego check, then tick "Rego is current"`);
      if (b.ppsr_clear === false || (b.ppsr_clear == null && cur.ppsr_clear === false)) throw bad('ppsr_not_clear', 'PPSR shows a problem (stolen, written off or similar) — this car cannot be approved');
    }
    const verifiedSource = b.verified_year != null ? (b.verified_source ?? (cur.vin_year === b.verified_year ? 'vin' : 'other')) : (b.verified_source ?? null);
    const row = await tx(async (c) => {
      const v = await one(
        `UPDATE vehicles SET status = $2, review_note = $3, reviewed_at = now(),
           cvl_number = coalesce($4, cvl_number), cvl_expiry = coalesce($5::date, cvl_expiry), rego_expiry = coalesce($6::date, rego_expiry),
           insurance_expiry = coalesce($7::date, insurance_expiry), roadworthy_date = coalesce($8::date, roadworthy_date),
           inspection_expiry = coalesce($9::date, inspection_expiry),
           verified_year = coalesce($10::int, verified_year), verified_source = coalesce($11, verified_source),
           rego_checked_at = CASE WHEN $12::boolean THEN now() ELSE rego_checked_at END,
           ppsr_clear = coalesce($13::boolean, ppsr_clear), ppsr_checked_at = CASE WHEN $13::boolean IS NOT NULL THEN now() ELSE ppsr_checked_at END
         WHERE id = $1 RETURNING *`,
        [id, b.decision === 'approve' ? 'approved' : 'rejected', b.note ?? null, b.cvl_number ?? null, b.cvl_expiry ?? null,
          b.rego_expiry ?? null, b.insurance_expiry ?? null, b.roadworthy_date ?? null, b.inspection_expiry ?? null,
          b.verified_year ?? null, verifiedSource, b.rego_checked === true, b.ppsr_clear ?? null], c);
      if (b.decision === 'approve' && v.owner_driver_id) {
        await c.query('UPDATE drivers SET vehicle_id = $1 WHERE user_id = $2 AND vehicle_id IS NULL', [id, v.owner_driver_id]);
      }
      // Approving the car approves its waiting papers too (one notification for the car, not one per document).
      if (b.decision === 'approve') {
        await c.query(`UPDATE driver_documents SET status = 'approved', reviewer_id = $2, reviewed_at = now()
                       WHERE vehicle_id = $1 AND status = 'pending'`, [id, me.id]);
      }
      await c.query('INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES ($1,$2,$3,$4,$5)',
        [me.id, `vehicle_${b.decision}`, 'vehicle', id, b]);
      return v;
    });
    if (row.owner_driver_id) {
      void send(row.owner_driver_id, 'car_reviewed', { approved: b.decision === 'approve', rego: row.rego, note: b.note }, { data: { vehicle_id: id } });
    }
    toOps('vehicle.reviewed', { id, status: row.status });
    return { vehicle: { ...vehicleOut(row, { keepSecrets: true }), state_rules: stateRules(j) } };
  });

  /** Paid plate lookup (each call costs a provider credit) — admin-triggered only. 501 until REGCHECK_USERNAME is set. */
  app.post('/admin/vehicles/:id/lookup', async (req, reply) => {
    const me = await admin(req);
    const id = (req.params as any).id;
    const v = await one('SELECT id, rego, rego_state FROM vehicles WHERE id = $1', [id]);
    if (!v) throw notFound('Vehicle');
    // Both `error` (house style) and `code` (contract) carry the code.
    if (!plateLookupConfigured()) return reply.code(501).send({ error: 'lookup_not_configured', code: 'lookup_not_configured', message: 'Paid plate lookup not set up — add a provider key (REGCHECK_USERNAME)' });
    const lookup = await lookupPlate(normaliseRego(v.rego), v.rego_state);
    const row = await one('UPDATE vehicles SET lookup = $2, lookup_at = now() WHERE id = $1 RETURNING lookup_at', [id, JSON.stringify(lookup)]);
    await audit(me.id, 'plate_lookup', 'vehicle', id, { rego: v.rego, state: v.rego_state });
    return { lookup, lookup_at: row!.lookup_at };
  });

  app.get('/admin/integrations', async (req) => {
    await ops(req);
    return integrationStatus();
  });

  // ───────────── States (jurisdictions) ─────────────
  app.get('/admin/jurisdictions', async (req) => { await ops(req); return { items: await listJurisdictions() }; });
  app.get('/admin/jurisdictions/:code', async (req) => {
    await ops(req);
    const item = (await listJurisdictions()).find((j) => j.code === String((req.params as any).code).toUpperCase());
    if (!item) throw notFound('State');
    return { item };
  });
  app.patch('/admin/jurisdictions/:code', async (req) => {
    const me = await admin(req);
    const code = String((req.params as any).code).toUpperCase();
    const b = parse(z.object({
      name: z.string().min(2).max(60).optional(),
      vehicle_max_age_years: z.number().int().min(1).max(50).optional(),
      levy_cents: z.number().int().min(0).max(2000).optional(), levy_label: z.string().min(2).max(60).optional(),
      inspection_months: z.number().int().min(1).max(60).nullable().optional(),
      rego_check_url: z.string().url().max(300).nullable().optional(), regulator: z.string().max(200).nullable().optional(),
      driver_docs: z.array(z.string().max(40)).max(20).optional(), vehicle_docs: z.array(z.string().max(40)).max(20).optional(),
      notes: z.string().max(3000).nullable().optional(), active: z.boolean().optional(),
    }), req.body);
    const keys = Object.keys(b);
    if (!keys.length) throw bad('empty');
    const vals = keys.map((k) => (['driver_docs', 'vehicle_docs'].includes(k) ? JSON.stringify((b as any)[k]) : (b as any)[k]));
    const row = await one(`UPDATE jurisdictions SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, updated_at = now() WHERE code = $1 RETURNING code`, [code, ...vals]);
    if (!row) throw notFound('State');
    // Keep the old global setting in step with NT (older clients read it).
    if (code === 'NT' && b.vehicle_max_age_years != null) {
      await q(`INSERT INTO settings (key, value) VALUES ('vehicle_max_age_years', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(b.vehicle_max_age_years)]);
    }
    if (b.active === false) {
      const off = await q(`UPDATE drivers SET online = false WHERE state = $1 RETURNING user_id`, [code]);
      for (const d of off) await trips.withdrawOffers(d.user_id);
    }
    await audit(me.id, 'update', 'jurisdictions', code, b);
    return { item: (await listJurisdictions()).find((j) => j.code === code) };
  });
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
  crud(app, 'zones', 'zones', ['id', 'name', 'centre_lat', 'centre_lng', 'radius_km', 'active', 'demand_multiplier', 'launch_note', 'state', 'timezone'], { order: 'state, name' });
  // Round 17 (migration 021): budget, Darwin hours/days, services, event area and targeted codes; checked before they're written.
  crud(app, 'promos', 'promo_codes',
    ['code', 'kind', 'value', 'max_discount_cents', 'max_uses', 'per_user_limit', 'first_trip_only', 'valid_from', 'valid_to', 'active', 'description',
      'budget_cents', 'services', 'hour_from', 'hour_to', 'days', 'geo_lat', 'geo_lng', 'geo_radius_m', 'targeted'],
    { pk: 'code', order: 'code', prepare: async (d) => {
      const v = parse(promoFields, d);
      if (v.kind === 'percent' && v.value != null && v.value > 100) throw bad('invalid_value', 'A percentage is 0 to 100');
      const rules = ['budget_cents', 'services', 'hour_from', 'hour_to', 'days', 'geo_lat', 'geo_lng', 'geo_radius_m', 'targeted'];
      if (!(await loyaltyReady()) && rules.some((k) => (v as any)[k] != null && (v as any)[k] !== false)) {
        throw new ApiError(503, 'migration_pending', 'Budgets, times, services, event areas and targeted codes need database migration 021');
      }
      if ((v.hour_from == null) !== (v.hour_to == null) && ('hour_from' in v || 'hour_to' in v)) throw bad('invalid_hours', 'Set both the start and end hour, or neither');
      if (v.geo_radius_m != null && (v.geo_lat == null || v.geo_lng == null)) throw bad('invalid_area', 'An event area needs a centre (latitude and longitude) and a radius');
      // Before 021 the new columns don't exist: leave them out of the write.
      return (await loyaltyReady()) ? v : Object.fromEntries(Object.entries(v).filter(([k]) => !rules.includes(k)));
    } });
  crud(app, 'holidays', 'public_holidays', ['day', 'name'], { pk: 'day', order: 'day' });
  crud(app, 'plans', 'plans', ['code', 'name', 'price_cents', 'ride_discount_pct', 'free_deliveries', 'waive_booking_fee', 'perks', 'active'], { pk: 'code', order: 'price_cents' });
  // Round 19: itinerary, season, start times, notice, heat rule, hotel pickup, Aboriginal guide and fee, deposit, visitor-language
  // text; checked first. JSON lists are written as JSON (a plain array would be sent as a Postgres array and fail on jsonb).
  crud(app, 'tours', 'tour_packages',
    ['slug', 'name', 'summary', 'description', 'duration_min', 'price_cents', 'max_passengers', 'stops', 'cultural_note', 'requires_permit', 'image_url', 'active',
      ...ROUND19_TOUR_COLUMNS],
    { order: 'name', prepare: async (d, id) => {
      // The admin form sends every field: empty lists and blanks mean "leave it" (or every month / day), numbers may come as text.
      for (const k of ['season_months', 'days'] as const) {
        if (Array.isArray(d[k])) d[k] = d[k].length ? d[k].map(Number) : (k === 'days' ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
      }
      for (const k of ['itinerary', 'season_months', 'days', 'start_times', 'min_notice_hours', 'translations', 'guided_by', 'guide_fee_cents', 'heat_sensitive', 'hotel_pickup', 'stops']) {
        if (d[k] === null) delete d[k];
      }
      const v = parse(tourFields, d);
      const before = id ? await one('SELECT * FROM tour_packages WHERE id = $1', [id]) : null;
      const out = checkTourFields(v, before);
      const ready = await toursReady();
      if (!ready) {
        // Before 023: the form's defaults (unticked boxes, "Your driver", blanks) are fine and left out; anything real needs the migration.
        const plain = (k: string, x: unknown) => x === undefined || x === null || x === false || x === 0 || x === 'driver' || (Array.isArray(x) && !x.length)
          || (k === 'hotel_pickup' && x === true) || (typeof x === 'object' && !Array.isArray(x) && !Object.keys(x as object).length)
          || ((k === 'season_months' || k === 'days') && Array.isArray(x) && x.length === (k === 'days' ? 7 : 12));
        if (ROUND19_TOUR_COLUMNS.some((k) => !plain(k, out[k]))) throw toursPending();
        for (const k of ROUND19_TOUR_COLUMNS) delete out[k];
      }
      for (const k of ['stops', 'itinerary'] as const) if (Array.isArray(out[k])) out[k] = JSON.stringify(out[k]);
      return out;
    } });

  // ───────────── Loyalty partners ─────────────
  // Round 19: hotels, visitor centres and tour desks book tours for guests (commission, billed to a linked business account).
  crud(app, 'partners', 'partners', ['name', 'kind', 'address', 'lat', 'lng', 'phone', 'email', 'logo_url', 'aboriginal_owned', 'settlement_cents_per_redemption', 'active',
    'tour_commission_pct', 'corporate_account_id'], { order: 'name', prepare: async (d) => {
      const v = parse(z.object({ kind: z.enum(['cafe', 'shop', 'community', 'hotel', 'visitor_centre', 'tour_desk', 'other']).optional(),
        tour_commission_pct: z.number().min(0).max(50).nullable().optional(), corporate_account_id: z.string().uuid().nullable().optional() }).passthrough(), d);
      if (v.tour_commission_pct === null) delete v.tour_commission_pct;
      if (!(await toursReady())) {
        // Before 023: blanks from the form are left out; a real rate or account needs the migration.
        if (v.tour_commission_pct || v.corporate_account_id) throw toursPending();
        delete v.tour_commission_pct; delete v.corporate_account_id;
      }
      if (v.corporate_account_id && !(await one('SELECT 1 FROM corporate_accounts WHERE id = $1 AND active', [v.corporate_account_id]))) throw bad('invalid_account', 'No active business account with that id');
      return v;
    } });
  crud(app, 'rewards', 'rewards', ['partner_id', 'title', 'description', 'points_cost', 'kind', 'credit_cents', 'active'], { order: 'points_cost' });
  app.get('/admin/redemptions', async (req) => {
    await ops(req);
    return { items: await q(
      `SELECT rr.*, r.title, p.name AS partner_name, p.settlement_cents_per_redemption, u.name AS user_name
       FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id LEFT JOIN partners p ON p.id = r.partner_id JOIN users u ON u.id = rr.user_id
       ORDER BY rr.issued_at DESC LIMIT 300`),
      // This Darwin month, each reward at the rate fixed when it was served (Round 17).
      settlement: await settlementsFor(darwin().month) };
  });

  // ───────────── Vouchers (cash customers) ─────────────
  app.get('/admin/vouchers', async (req) => {
    await ops(req);
    return { items: await q('SELECT v.*, p.name AS partner_name FROM gift_vouchers v LEFT JOIN partners p ON p.id = v.sold_by_partner ORDER BY created_at DESC LIMIT 500') };
  });
  app.post('/admin/vouchers', async (req) => {
    const me = await admin(req);
    // `for_sale`: cards for selling at a shop work only once the shop records the sale, and (Australian Consumer Law) carry at least a
    // 3-year expiry. Cards given away free (community programmes) can be used straight away and may have a shorter expiry.
    const b = parse(z.object({ count: z.number().int().min(1).max(500), value_cents: z.number().int().min(500).max(20000), batch: z.string().max(40),
      partner_id: z.string().uuid().optional(), valid_days: z.number().int().min(30).max(3650).optional(), for_sale: z.boolean().default(true) }), req.body);
    const ready = await loyaltyReady();
    const days = giftCardExpiry(b.valid_days ?? GIFT_CARD_MIN_DAYS, b.for_sale);
    const codes: string[] = [];
    for (let i = 0; i < b.count; i++) {
      const code = voucherCode() + voucherCode().slice(2, 6);
      codes.push(code);
      await q(`INSERT INTO gift_vouchers (code, value_cents, batch, sold_by_partner, expires_at${ready ? ', needs_activation' : ''})
               VALUES ($1,$2,$3,$4, now() + ($5 || ' days')::interval${ready ? ', $6' : ''})`,
        [code, b.value_cents, b.batch, b.partner_id ?? null, String(days), ...(ready ? [b.for_sale] : [])]);
    }
    const expires = (await one('SELECT expires_at FROM gift_vouchers WHERE code = $1', [codes[0]]))?.expires_at;
    await audit(me.id, 'vouchers_created', 'gift_vouchers', b.batch, { count: b.count, value_cents: b.value_cents, for_sale: b.for_sale, days });
    return { codes, expires_at: expires, needs_activation: ready && b.for_sale, valid_days: days };
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
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : trips.localMonth();
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
       FROM vehicles v WHERE v.active AND v.fuel_type IN ('electric','plug_in_hybrid') ORDER BY v.rego`);
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
    // Serialised per driver: two clicks (or two admins) can't both pay the same balance.
    const cents = await tx(async (c) => {
      const d = await one('SELECT user_id FROM drivers WHERE user_id = $1 FOR UPDATE', [id], c);
      if (!d) throw notFound('Driver');
      const bal = await one('SELECT coalesce(sum(amount_cents),0)::int cents FROM driver_ledger WHERE driver_id = $1', [id], c);
      if (bal!.cents <= 0) throw bad('nothing_to_pay', 'Driver balance is zero or negative');
      await c.query(`INSERT INTO driver_ledger (driver_id, kind, amount_cents, note) VALUES ($1,'payout',$2,'Bank transfer (ABA batch)')`, [id, -bal!.cents]);
      await c.query('INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES ($1,$2,$3,$4,$5)', [me.id, 'payout', 'driver', id, { cents: bal!.cents }]);
      return bal!.cents;
    });
    void send(id, 'payout_sent', { cents }, { data: {} });
    return { paid_cents: cents };
  });

  // ───────────── Safety, support, compliance ─────────────
  app.get('/admin/sos', async (req) => {
    await ops(req);
    return { items: await q(`SELECT s.*, u.name AS user_name, u.phone AS user_phone, t.ref AS trip_ref, t.share_token FROM sos_alerts s JOIN users u ON u.id = s.user_id LEFT JOIN trips t ON t.id = s.trip_id ORDER BY s.created_at DESC LIMIT 200`) };
  });
  app.patch('/admin/sos/:id', async (req) => {
    const me = await ops(req);
    const b = parse(z.object({ status: z.enum(['acknowledged', 'resolved']), notes: z.string().trim().max(1000).optional() }), req.body);
    const id = (req.params as any).id;
    const cur = await one('SELECT status FROM sos_alerts WHERE id = $1', [id]);
    if (!cur) throw notFound('Alert');
    if (cur.status === 'resolved') throw conflict('already_resolved', 'This alert is already resolved. Add a note to the incident instead.');
    // Notes are added to what is already recorded (incident history), never written over.
    const s = await one(
      `UPDATE sos_alerts SET status = $2, handled_by = $4, resolved_at = CASE WHEN $2 = 'resolved' THEN now() END,
         notes = CASE WHEN $3::text IS NULL OR $3::text = '' THEN notes WHEN notes IS NULL OR notes = '' THEN $3::text ELSE notes || E'\n' || $3::text END
       WHERE id = $1 RETURNING *`, [id, b.status, b.notes ?? null, me.id]);
    await audit(me.id, b.status === 'resolved' ? 'sos_resolved' : 'sos_acknowledged', 'sos', id, b.notes ? { text: b.notes } : undefined);
    toOps('sos.updated', s);
    return { item: s };
  });

  app.get('/admin/support', async (req) => {
    await ops(req);
    return { items: await q(`SELECT s.*, u.name AS user_name, u.phone AS user_phone, t.ref AS trip_ref FROM support_tickets s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN trips t ON t.id = s.trip_id ORDER BY (s.status = 'open') DESC, s.created_at DESC LIMIT 300`) };
  });
  app.patch('/admin/support/:id', async (req) => {
    const me = await ops(req);
    const b = parse(z.object({ status: z.enum(['open', 'pending', 'resolved']), resolution: z.string().max(2000).optional() }), req.body);
    const t = await one(`UPDATE support_tickets SET status = $2, resolution = coalesce($3, resolution), updated_at = now() WHERE id = $1 RETURNING *`, [(req.params as any).id, b.status, b.resolution ?? null]);
    if (!t) throw notFound('Ticket');
    await audit(me.id, 'ticket_' + b.status, 'support_ticket', t.id, b.resolution ? { resolution: b.resolution } : undefined);
    if (t.user_id && b.resolution) void send(t.user_id, 'ticket_reply', { subject: t.subject, resolution: b.resolution }, { data: { ticket_id: t.id } });
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
        `SELECT id, rego, rego_expiry, cvl_expiry, insurance_expiry, inspection_expiry, ownership, owner_driver_id FROM vehicles
         WHERE active AND status = 'approved' AND (rego_expiry < ${soon} OR cvl_expiry < ${soon} OR insurance_expiry < ${soon} OR cvl_expiry IS NULL)`),
      pending_documents: await q(`SELECT x.*, u.name AS driver_name FROM driver_documents x JOIN users u ON u.id = x.driver_id WHERE x.status = 'pending' ORDER BY x.created_at`),
    };
  });
  app.patch('/admin/compliance/:id', async (req) => {
    const me = await ops(req);
    const b = parse(z.object({ status: z.enum(['open', 'reviewed', 'actioned', 'dismissed']) }), req.body);
    const item = await one('UPDATE compliance_flags SET status = $2 WHERE id = $1 RETURNING *', [(req.params as any).id, b.status]);
    if (!item) throw notFound('Flag');
    await audit(me.id, 'flag_' + b.status, 'compliance_flag', item.id, { kind: item.kind, driver_id: item.driver_id });
    return { item };
  });

  // ───────────── Reports (levy, GST/BAS, corporate) ─────────────
  /** NT passenger services levy: $1 per completed passenger trip, lodged monthly by the dispatch network. */
  app.get('/admin/reports/levy', async (req) => {
    await ops(req);
    const { month, state } = req.query as { month?: string; state?: string };
    return levyReport(month, state ?? 'NT');
  });

  app.get('/admin/reports/gst', async (req) => {
    await ops(req);
    const { from, to } = req.query as { from?: string; to?: string };
    return gstReport(from, to);
  });

  crud(app, 'corporate', 'corporate_accounts', ['name', 'kind', 'abn', 'billing_email', 'monthly_limit_cents', 'invoice_terms_days', 'discount_pct', 'active'], {
    order: 'name', prepare: async (d) => corporateInput(d) });
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
    const m = month && /^\d{4}-\d{2}$/.test(month) ? month : trips.localMonth();
    const acct = await one('SELECT * FROM corporate_accounts WHERE id = $1', [(req.params as any).id]);
    if (!acct) throw notFound('Account');
    const lines = await q(
      `SELECT t.ref, coalesce(t.completed_at, t.cancelled_at) AS completed_at, u.name AS rider, t.pickup_address, t.dropoff_address,
              coalesce(t.final_cents, t.cancel_fee_cents)::int AS final_cents, t.ndis_number, (t.status <> 'completed') AS cancellation_fee,
              coalesce((SELECT -sum(p.amount_cents) FROM payments p WHERE p.trip_id = t.id AND p.kind = 'refund' AND p.status = 'succeeded'), 0)::int AS refunded_cents
       FROM trips t JOIN users u ON u.id = t.rider_id
       WHERE t.corporate_account_id = $1 AND t.payment_method = 'corporate'
         AND (t.status = 'completed' OR (t.status::text LIKE 'cancelled%' AND t.cancel_fee_cents > 0))
         AND to_char(coalesce(t.completed_at, t.cancelled_at) AT TIME ZONE 'Australia/Darwin', 'YYYY-MM') = $2
       ORDER BY coalesce(t.completed_at, t.cancelled_at)`, [acct.id, m]);
    // Refunds are credits on the statement (a refund on a business trip moves no money: it comes off the invoice).
    const charges = lines.reduce((s, l) => s + l.final_cents, 0);
    const refunds = lines.reduce((s, l) => s + l.refunded_cents, 0);
    const total = charges - refunds;
    const limit = Number(acct.monthly_limit_cents ?? 0);
    const used = limit > 0 ? await trips.accountMonthCents(pool, acct.id, m) : 0;
    return { account: acct, month: m, lines, charges_cents: charges, refunds_cents: refunds, total_cents: total, gst_cents: Math.round(total / 11),
      limit: limit > 0 ? { limit_cents: limit, used_cents: used, left_cents: Math.max(0, limit - used) } : null,
      members: await q('SELECT u.id, u.name, u.phone, m.role FROM corporate_members m JOIN users u ON u.id = m.user_id WHERE m.account_id = $1', [acct.id]) };
  });

  // ───────────── Inbound: hire requests, driver applications, enquiries ─────────────
  // Driver applications (Round 13): stages the applicant sees through their status link, a note for them, funnel counts by stage and source.
  app.get('/admin/applications', async (req) => {
    await ops(req);
    const ready = await applicationsReady();
    const items = await q(`SELECT * FROM driver_applications ORDER BY created_at DESC LIMIT 300`);
    for (const it of items) delete (it as any).status_token;   // the applicant's private link isn't shown to staff
    const stages = await q(`SELECT status, count(*)::int n FROM driver_applications WHERE created_at > now() - interval '90 days' GROUP BY 1`);
    const sources = ready
      ? await q(`SELECT coalesce(source, 'direct') source, count(*)::int n, count(*) FILTER (WHERE status = 'approved')::int approved
                 FROM driver_applications WHERE created_at > now() - interval '90 days' GROUP BY 1 ORDER BY 2 DESC LIMIT 10`)
      : [];
    return { items, stages: APPLICATION_STAGES, funnel: { days: 90, stages: Object.fromEntries(stages.map((r: any) => [r.status, r.n])), sources }, status_links: ready };
  });
  app.patch('/admin/applications/:id', async (req) => {
    const me = await ops(req);
    const b = parse(z.object({ status: z.enum(STAGE_KEYS).optional(), public_note: z.string().max(300).nullable().optional(), notify: z.boolean().default(true) }), req.body);
    const ready = await applicationsReady();
    if (b.public_note !== undefined && !ready) throw new ApiError(503, 'migration_pending', applicationsPending());
    const before = await one('SELECT * FROM driver_applications WHERE id = $1', [(req.params as any).id]);
    if (!before) throw notFound();
    const sets: string[] = []; const vals: unknown[] = [before.id];
    if (b.status) { vals.push(b.status); sets.push(`status = $${vals.length}`); }
    if (b.public_note !== undefined) { vals.push(b.public_note?.trim() || null); sets.push(`public_note = $${vals.length}`); }
    if (!sets.length) throw new ApiError(400, 'nothing_to_change', 'Send a status or a note');
    if (ready) sets.push('updated_at = now()');
    const item = await one(`UPDATE driver_applications SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
    const changed = !!b.status && b.status !== before.status;
    let texted = false;
    if (changed && b.notify && ready && item.status_token && item.ref) {
      const r = await sendSmsT(item.phone, 'driver_application_update', { ref: item.ref, stage: APPLICATION_STAGES[b.status!].label,
        url: `${config.publicWebUrl}/drive/status/${item.status_token}` });
      texted = r.sent;
    }
    await audit(me.id, 'status', 'driver_applications', item.id, { status: b.status, note: b.public_note !== undefined ? 'set' : undefined, texted });
    delete item.status_token;
    return { item, texted };
  });

  for (const [path, table] of [['hire-requests', 'hire_requests'], ['enquiries', 'enquiries']] as const) {
    app.get(`/admin/${path}`, async (req) => { await ops(req); return { items: await q(`SELECT * FROM ${table} ORDER BY created_at DESC LIMIT 300`) }; });
    app.patch(`/admin/${path}/:id`, async (req) => {
      const me = await ops(req);
      const b = parse(z.object({ status: z.string().max(20), quote_cents: z.number().int().optional() }), req.body);
      const extra = table === 'hire_requests' && b.quote_cents != null ? ', quote_cents = $3' : '';
      const vals = [(req.params as any).id, b.status, ...(extra ? [b.quote_cents] : [])];
      const item = await one(`UPDATE ${table} SET status = $2${extra} WHERE id = $1 RETURNING *`, vals);
      if (!item) throw notFound();
      await audit(me.id, 'status', table, item.id, b);
      return { item };
    });
  }

  // ───────────── Settings & broadcast ─────────────
  app.get('/admin/settings', async (req) => { await ops(req); return { items: await q(`SELECT * FROM settings WHERE key NOT LIKE '\\_%' ORDER BY key`) }; });
  app.put('/admin/settings/:key', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ value: z.any() }), req.body);
    // Driver pay goes through its own validation.
    if ((req.params as any).key === 'driver_pay') return { item: { key: 'driver_pay', value: await saveDriverPay(me.id, b.value) } };
    if ((req.params as any).key === 'tour_policy') {
      const value = checkTourPolicy(b.value);
      await q(`INSERT INTO settings (key, value) VALUES ('tour_policy', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(value)]);
      await audit(me.id, 'update', 'settings', 'tour_policy', value);
      return { item: { key: 'tour_policy', value } };
    }
    if ((req.params as any).key === 'community_pricing') return { item: { key: 'community_pricing', value: await saveCommunityPricing(me.id, b.value) } };
    if ((req.params as any).key === 'safety_policy') {
      const value = checkSafetyPolicy(b.value);
      await q(`INSERT INTO settings (key, value) VALUES ('safety_policy', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(value)]);
      await audit(me.id, 'safety_policy_updated', 'settings', 'safety_policy', value);
      return { item: { key: 'safety_policy', value } };
    }
    const row = await one(`INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2 RETURNING *`, [(req.params as any).key, JSON.stringify(b.value)]);
    // Legacy setting: the NT max age now lives on the NT jurisdiction — keep them in step.
    if (row.key === 'vehicle_max_age_years' && Number(b.value) >= 1 && Number(b.value) <= 50) {
      await q(`UPDATE jurisdictions SET vehicle_max_age_years = $1, updated_at = now() WHERE code = 'NT'`, [Math.round(Number(b.value))]);
    }
    await audit(me.id, 'setting', 'settings', row.key, b.value);
    return { item: row };
  });

  // ───────────── Driver pay (Round 4) ─────────────
  app.get('/admin/driver-pay', async (req) => {
    await ops(req);
    return { settings: await loadDriverPay(), defaults: DRIVER_PAY_DEFAULTS };
  });
  app.put('/admin/driver-pay', async (req) => {
    const me = await admin(req);
    return { settings: await saveDriverPay(me.id, req.body) };
  });
  /** Weekly earnings floor: per-driver engaged hours, counted earnings and top-ups for a week (default: last full week). */
  app.get('/admin/driver-pay/floor', async (req) => {
    await ops(req);
    return floorReport((req.query as any).week);
  });
  app.post('/admin/driver-pay/floor/run', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ week: z.string().max(10).optional() }), req.body ?? {});
    return runEarningsFloor(b.week, me.id);
  });

  /** Promotional broadcast — Spam Act: only to riders who opted in; every message identifies DingoGo and how to opt out. */
  app.post('/admin/broadcast', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({
      audience: z.enum(['riders_opted_in', 'drivers']), title: z.string().min(2).max(60), body: z.string().min(2).max(240),
      channel: z.enum(['app', 'sms']).default('app'),
    }), req.body);
    if (b.channel === 'sms') {
      // Offers by text: opted-in riders only, never numbers that replied STOP, from a number that takes replies, "Reply STOP" in every text.
      if (b.audience !== 'riders_opted_in') throw bad('sms_riders_only', 'Texts can only go to riders who said yes to offers');
      if (!smsConfigured()) throw conflict('sms_not_configured', 'Texts are not switched on (Twilio)');
      if (!replyableSender()) throw conflict('sms_marketing_unavailable', 'Offers by text need a sender number that takes STOP replies (TWILIO_MARKETING_FROM, a number in TWILIO_FROM or a Messaging Service)');
      const text = render('promo', { title: b.title, body: b.body }).sms!;
      if (smsSegments(gsmFriendly(text)).segments > 2) throw bad('sms_too_long', 'Make the message shorter: it would be sent as more than 2 texts');
    }
    const users = b.audience === 'drivers'
      ? await q<{ id: string; phone: string }>(`SELECT d.user_id AS id, u.phone FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.status = 'approved' AND u.deleted_at IS NULL`)
      : await q<{ id: string; phone: string }>(`SELECT id, phone FROM users WHERE role = 'rider' AND marketing_opt_in AND deleted_at IS NULL`);
    let sent = 0; let skipped = 0;
    // A few at a time: push and SMS are network calls, and one by one could run past the serverless time limit.
    for (let i = 0; i < users.length; i += 10) {
      await Promise.all(users.slice(i, i + 10).map(async (u) => {
        if (b.channel === 'sms') {
          const r = await sendSmsT(u.phone, 'promo', { title: b.title, body: b.body }, { userId: u.id });
          if (r.sent || r.status === 'dev_log') sent++; else skipped++;
        } else if (b.audience === 'drivers') { await notify(u.id, b.title, b.body, {}, 'account'); sent++; }
        else { const m = render('promo', { title: b.title, body: b.body }); await notify(u.id, m.title!, m.body!, {}, 'promo'); sent++; }
      }));
    }
    await audit(me.id, 'broadcast', 'notifications', b.audience, { title: b.title, channel: b.channel, count: sent, skipped });
    return { sent, skipped };
  });

  // GET /admin/audit (with filters) lives in routes/ops.ts.
}
