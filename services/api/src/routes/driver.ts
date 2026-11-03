import type { FastifyInstance } from 'fastify';
import { one, q } from '../db.js';
import { requireUser } from '../auth.js';
import { bad, conflict, forbidden } from '../lib/errors.js';
import { latLng, parse, z } from '../lib/validate.js';
import { toOps } from '../realtime.js';
import * as trips from '../services/trips.js';

/** Credentials that must be current before a driver can go online (NT CPV rules + DingoGo policy). */
export async function complianceIssues(driverId: string): Promise<string[]> {
  const d = await one(
    `SELECT d.*, v.rego, v.cvl_expiry, v.rego_expiry, v.insurance_expiry, v.active AS vehicle_active
     FROM drivers d LEFT JOIN vehicles v ON v.id = d.vehicle_id WHERE d.user_id = $1`, [driverId]);
  if (!d) return ['Not registered as a driver'];
  const issues: string[] = [];
  const today = new Date().toISOString().slice(0, 10);
  const expired = (date: string | null) => !date || date < today;
  if (d.status !== 'approved') issues.push(`Account status is "${d.status}" — DingoGo must approve your application`);
  if (expired(d.licence_expiry)) issues.push('Driver licence missing or expired');
  if (expired(d.h_endorsement_expiry)) issues.push('H endorsement (CPV driver authority) missing or expired');
  if (!d.abn) issues.push('ABN required');
  if (!d.gst_registered) issues.push('GST registration required (ATO: rideshare drivers register from the first trip)');
  if (!d.vehicle_id) issues.push('No vehicle assigned');
  else {
    if (!d.vehicle_active) issues.push(`Vehicle ${d.rego} is off the road`);
    if (expired(d.cvl_expiry)) issues.push(`Vehicle ${d.rego}: rideshare Commercial Vehicle Licence missing or expired`);
    if (expired(d.rego_expiry)) issues.push(`Vehicle ${d.rego}: registration expired`);
    if (expired(d.insurance_expiry)) issues.push(`Vehicle ${d.rego}: insurance expired`);
  }
  return issues;
}

export default async function driverRoutes(app: FastifyInstance) {
  app.get('/driver/me', async (req) => {
    const me = await requireUser(req, 'driver');
    const d = await one(
      `SELECT d.*, u.name, u.phone, u.email, u.rating_avg, u.rating_count,
         row_to_json(v.*) AS vehicle
       FROM drivers d JOIN users u ON u.id = d.user_id LEFT JOIN vehicles v ON v.id = d.vehicle_id WHERE d.user_id = $1`, [me.id]);
    const docs = await q('SELECT id, type, number, expires_at, status, note, created_at FROM driver_documents WHERE driver_id = $1 ORDER BY created_at DESC', [me.id]);
    const today = await one(
      `SELECT count(*) FILTER (WHERE status = 'completed')::int trips,
              coalesce(sum(final_cents) FILTER (WHERE status = 'completed'), 0)::int gross_cents
       FROM trips WHERE driver_id = $1 AND completed_at >= date_trunc('day', now() AT TIME ZONE 'Australia/Darwin') AT TIME ZONE 'Australia/Darwin'`, [me.id]);
    const acceptance = await one(
      `SELECT count(*) FILTER (WHERE status = 'accepted')::int accepted, count(*)::int offered
       FROM trip_offers WHERE driver_id = $1 AND offered_at > now() - interval '30 days'`, [me.id]);
    if (d) { delete d.bank_account; }
    return { driver: d, documents: docs, today, acceptance, compliance_issues: await complianceIssues(me.id) };
  });

  app.patch('/driver/me', async (req) => {
    const me = await requireUser(req, 'driver');
    const b = parse(z.object({
      licence_no: z.string().max(20).optional(), licence_expiry: z.string().date().optional(),
      cpv_authority_no: z.string().max(20).optional(), h_endorsement_expiry: z.string().date().optional(),
      abn: z.string().regex(/^\d{11}$/, 'ABN is 11 digits').optional(), gst_registered: z.boolean().optional(),
      bank_bsb: z.string().regex(/^\d{6}$/).optional(), bank_account: z.string().regex(/^\d{5,10}$/).optional(),
      languages: z.array(z.string().max(20)).max(6).optional(), bio: z.string().max(300).optional(),
      accepts_courier: z.boolean().optional(), accepts_pets: z.boolean().optional(), female_driver: z.boolean().optional(),
    }), req.body);
    const sets: string[] = []; const vals: unknown[] = [me.id];
    for (const [k, v] of Object.entries(b)) { vals.push(v); sets.push(`${k} = $${vals.length}`); }
    if (sets.length) await q(`UPDATE drivers SET ${sets.join(', ')} WHERE user_id = $1`, vals);
    const d = await one(`SELECT status FROM drivers WHERE user_id = $1`, [me.id]);
    if (d.status === 'applied' && b.licence_no && b.abn) await q(`UPDATE drivers SET status = 'pending_documents' WHERE user_id = $1`, [me.id]);
    return { ok: true };
  });

  app.post('/driver/documents', async (req) => {
    const me = await requireUser(req, 'driver');
    const b = parse(z.object({
      type: z.enum(['licence', 'h_endorsement', 'cpvid', 'police_check', 'medical', 'abn', 'gst', 'insurance', 'vehicle_cvl', 'roadworthy', 'first_aid', 'disability_awareness', 'wwcc']),
      file_url: z.string().max(500).optional(), number: z.string().max(40).optional(), expires_at: z.string().date().optional(),
    }), req.body);
    const doc = await one(`INSERT INTO driver_documents (driver_id, type, file_url, number, expires_at) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [me.id, b.type, b.file_url ?? null, b.number ?? null, b.expires_at ?? null]);
    toOps('driver.document', { driver_id: me.id, type: b.type });
    return { document: doc };
  });

  app.post('/driver/online', async (req) => {
    const me = await requireUser(req, 'driver');
    const b = parse(z.object({ online: z.boolean(), lat: z.number().optional(), lng: z.number().optional(), battery_pct: z.number().int().min(0).max(100).optional() }), req.body);
    if (b.online) {
      const issues = await complianceIssues(me.id);
      if (issues.length) throw bad('not_compliant', issues[0], issues);
      if (b.battery_pct != null && b.battery_pct < 15) throw bad('battery_low', 'Charge above 15% before going online');
    }
    const d = await one(
      `UPDATE drivers SET online = $2, lat = coalesce($3, lat), lng = coalesce($4, lng), last_seen_at = now() WHERE user_id = $1 RETURNING vehicle_id, online`,
      [me.id, b.online, b.lat ?? null, b.lng ?? null]);
    if (b.battery_pct != null && d.vehicle_id) {
      await q('UPDATE vehicles SET battery_pct = $2 WHERE id = $1', [d.vehicle_id, b.battery_pct]);
      await q('INSERT INTO battery_logs (vehicle_id, driver_id, pct) VALUES ($1,$2,$3)', [d.vehicle_id, me.id, b.battery_pct]);
    }
    toOps('driver.status', { driver_id: me.id, online: b.online, lat: b.lat, lng: b.lng });
    return { online: d.online };
  });

  app.post('/driver/location', async (req) => {
    const me = await requireUser(req, 'driver');
    const b = parse(latLng.extend({ heading: z.number().optional(), battery_pct: z.number().int().min(0).max(100).optional(), speed_kmh: z.number().optional() }), req.body);
    const d = await one(
      `UPDATE drivers SET lat = $2, lng = $3, heading = $4, last_seen_at = now() WHERE user_id = $1 RETURNING vehicle_id, online`,
      [me.id, b.lat, b.lng, b.heading ?? null]);
    if (b.battery_pct != null && d?.vehicle_id) await q('UPDATE vehicles SET battery_pct = $2 WHERE id = $1', [d.vehicle_id, b.battery_pct]);
    await trips.onDriverLocation(me.id, b);
    toOps('driver.location', { driver_id: me.id, lat: b.lat, lng: b.lng, heading: b.heading, battery_pct: b.battery_pct, online: d?.online });
    return { ok: true };
  });

  app.get('/driver/offers', async (req) => {
    const me = await requireUser(req, 'driver');
    const offers = await q(
      `SELECT o.trip_id, o.expires_at, o.pickup_eta_s, t.ref, t.kind, t.service, t.pickup_address, t.pickup_lat, t.pickup_lng,
              t.dropoff_address, t.dropoff_lat, t.dropoff_lng, t.est_distance_m, t.est_duration_s, t.quote_cents, (t.fare_breakdown->>'trip_cents')::int AS trip_cents, t.has_pet,
              t.assistance_animal, t.needs_wheelchair, t.passengers, t.payment_method, t.notes
       FROM trip_offers o JOIN trips t ON t.id = o.trip_id
       WHERE o.driver_id = $1 AND o.status = 'offered' AND o.expires_at > now()`, [me.id]);
    return { offers };
  });

  app.post('/driver/offers/:tripId/accept', async (req) => {
    const me = await requireUser(req, 'driver');
    return { trip: trips.viewFor(await trips.acceptOffer(me.id, (req.params as any).tripId), me) };
  });
  app.post('/driver/offers/:tripId/decline', async (req) => {
    const me = await requireUser(req, 'driver');
    return trips.declineOffer(me.id, (req.params as any).tripId);
  });

  app.get('/driver/trips/active', async (req) => {
    const me = await requireUser(req, 'driver');
    const t = await one(`SELECT id FROM trips WHERE driver_id = $1 AND status IN ('accepted','arrived','in_progress') LIMIT 1`, [me.id]);
    return { trip: t ? trips.viewFor(await trips.getTrip(t.id), me) : null };
  });

  app.get('/driver/trips', async (req) => {
    const me = await requireUser(req, 'driver');
    return { trips: await q(
      `SELECT id, ref, kind, service, status, pickup_address, dropoff_address, requested_at, completed_at, final_cents, tip_cents, payment_method, rider_rating
       FROM trips WHERE driver_id = $1 ORDER BY requested_at DESC LIMIT 100`, [me.id]) };
  });

  app.post('/driver/trips/:id/arrive', async (req) => {
    const me = await requireUser(req, 'driver');
    return { trip: trips.viewFor(await trips.markArrived(me.id, (req.params as any).id), me) };
  });
  app.post('/driver/trips/:id/start', async (req) => {
    const me = await requireUser(req, 'driver');
    const b = parse(z.object({ pin: z.string().optional() }), req.body);
    return { trip: trips.viewFor(await trips.startTrip(me.id, (req.params as any).id, b.pin), me) };
  });
  app.post('/driver/trips/:id/complete', async (req) => {
    const me = await requireUser(req, 'driver');
    const b = parse(z.object({
      actual_distance_m: z.number().int().optional(), delivery_pin: z.string().optional(), pod_photo_url: z.string().optional(),
      pod_signature: z.string().max(200000).optional(), pod_received_by: z.string().max(80).optional(),
      lat: z.number().optional(), lng: z.number().optional(),
    }), req.body);
    return { trip: trips.viewFor(await trips.completeTrip(me.id, (req.params as any).id, b), me) };
  });
  app.post('/driver/trips/:id/cancel', async (req) => {
    const me = await requireUser(req, 'driver');
    const b = parse(z.object({ reason: z.enum(['rider_no_show', 'unsafe', 'rider_requested', 'vehicle_issue', 'parcel_prohibited', 'other']), note: z.string().max(200).optional() }), req.body);
    return { trip: trips.viewFor(await trips.cancelTrip(me, (req.params as any).id, b.reason + (b.note ? `: ${b.note}` : '')), me) };
  });

  /** Earnings: ledger summary for a period, with lease and charging shown so drivers see true take-home. */
  app.get('/driver/earnings', async (req) => {
    const me = await requireUser(req, 'driver');
    const { days = '7' } = req.query as { days?: string };
    const n = Math.min(Math.max(Number(days) || 7, 1), 366);
    const byKind = await q(
      `SELECT kind, sum(amount_cents)::int cents, count(*)::int n FROM driver_ledger
       WHERE driver_id = $1 AND created_at > now() - ($2 || ' days')::interval GROUP BY kind`, [me.id, String(n)]);
    const daily = await q(
      `SELECT to_char(date_trunc('day', created_at AT TIME ZONE 'Australia/Darwin'), 'YYYY-MM-DD') AS day, sum(amount_cents)::int cents
       FROM driver_ledger WHERE driver_id = $1 AND created_at > now() - ($2 || ' days')::interval GROUP BY 1 ORDER BY 1`, [me.id, String(n)]);
    const balance = await one('SELECT coalesce(sum(amount_cents),0)::int cents FROM driver_ledger WHERE driver_id = $1', [me.id]);
    const ledger = await q('SELECT * FROM driver_ledger WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 50', [me.id]);
    const totals = Object.fromEntries(byKind.map((r) => [r.kind, r.cents]));
    const net = byKind.reduce((s, r) => s + r.cents, 0);
    const gross = totals.fare ?? 0;
    return {
      days: n, by_kind: totals, net_cents: net, balance_cents: balance!.cents, daily, ledger,
      // GST: drivers are GST-registered; 1/11 of their fare income is GST payable on their BAS.
      gst_on_fares_cents: Math.round(gross / 11),
    };
  });

  // ───────────── EV: charging & battery ─────────────
  app.post('/driver/charging', async (req) => {
    const me = await requireUser(req, 'driver');
    const b = parse(z.object({
      location: z.enum(['home', 'depot', 'public']), site_name: z.string().max(80).optional(),
      started_at: z.string().datetime(), ended_at: z.string().datetime().optional(),
      kwh: z.number().min(0).max(100), tariff_cents_per_kwh: z.number().int().min(0).max(200).optional(),
      cost_cents: z.number().int().min(0).optional(), start_pct: z.number().int().min(0).max(100).optional(),
      end_pct: z.number().int().min(0).max(100).optional(), meter_ref: z.string().max(60).optional(),
    }), req.body);
    const d = await one('SELECT vehicle_id FROM drivers WHERE user_id = $1', [me.id]);
    if (!d?.vehicle_id) throw conflict('no_vehicle', 'No vehicle assigned');
    const tariff = b.tariff_cents_per_kwh ?? (await one(`SELECT value FROM settings WHERE key = 'home_tariff_cents_per_kwh'`))?.value ?? 30;
    const cost = b.cost_cents ?? Math.round(b.kwh * Number(tariff));
    const s = await one(
      `INSERT INTO charging_sessions (driver_id, vehicle_id, location, site_name, started_at, ended_at, kwh, tariff_cents_per_kwh, cost_cents, start_pct, end_pct, meter_ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [me.id, d.vehicle_id, b.location, b.site_name ?? null, b.started_at, b.ended_at ?? null, b.kwh, tariff, cost, b.start_pct ?? null, b.end_pct ?? null, b.meter_ref ?? null]);
    if (b.end_pct != null) await q('UPDATE vehicles SET battery_pct = $2 WHERE id = $1', [d.vehicle_id, b.end_pct]);
    return { session: s };
  });

  app.get('/driver/charging', async (req) => {
    const me = await requireUser(req, 'driver');
    const sessions = await q('SELECT * FROM charging_sessions WHERE driver_id = $1 ORDER BY started_at DESC LIMIT 50', [me.id]);
    const month = await one(
      `SELECT coalesce(sum(kwh),0) kwh, coalesce(sum(cost_cents),0)::int cost_cents, count(*)::int n FROM charging_sessions
       WHERE driver_id = $1 AND started_at > date_trunc('month', now())`, [me.id]);
    const km = await one(
      `SELECT coalesce(sum(coalesce(actual_distance_m, est_distance_m)),0)::int m FROM trips WHERE driver_id = $1 AND status = 'completed' AND completed_at > date_trunc('month', now())`, [me.id]);
    return { sessions, month: { ...month, trip_km: Math.round(km!.m / 1000) } };
  });

  app.post('/driver/battery', async (req) => {
    const me = await requireUser(req, 'driver');
    const b = parse(z.object({ pct: z.number().int().min(0).max(100), odometer_km: z.number().int().optional(), ambient_c: z.number().optional() }), req.body);
    const d = await one('SELECT vehicle_id FROM drivers WHERE user_id = $1', [me.id]);
    if (!d?.vehicle_id) throw forbidden('No vehicle');
    await q('INSERT INTO battery_logs (vehicle_id, driver_id, pct, odometer_km, ambient_c) VALUES ($1,$2,$3,$4,$5)', [d.vehicle_id, me.id, b.pct, b.odometer_km ?? null, b.ambient_c ?? null]);
    await q('UPDATE vehicles SET battery_pct = $2, odometer_km = coalesce($3, odometer_km) WHERE id = $1', [d.vehicle_id, b.pct, b.odometer_km ?? null]);
    return { ok: true };
  });

  app.post('/driver/sos', async (req) => {
    const me = await requireUser(req, 'driver');
    const b = parse(z.object({ lat: z.number().optional(), lng: z.number().optional(), message: z.string().max(300).optional() }), req.body);
    const t = await one(`SELECT id, ref FROM trips WHERE driver_id = $1 AND status IN ('accepted','arrived','in_progress') LIMIT 1`, [me.id]);
    const alert = await one(`INSERT INTO sos_alerts (trip_id, user_id, role, lat, lng, message) VALUES ($1,$2,'driver',$3,$4,$5) RETURNING *`,
      [t?.id ?? null, me.id, b.lat ?? null, b.lng ?? null, b.message ?? null]);
    toOps('sos.new', { ...alert, trip_ref: t?.ref, user_name: me.name });
    return { alert, emergency_number: '000' };
  });
}
