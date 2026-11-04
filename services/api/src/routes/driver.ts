import type { FastifyInstance } from 'fastify';
import { one, q } from '../db.js';
import { requireUser } from '../auth.js';
import { bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { latLng, parse, z } from '../lib/validate.js';
import { FUEL_TYPES, VEHICLE_DOC_TYPES, isEv, normaliseRego, vehicleAgeRule, vehicleOut } from '../lib/vehicles.js';
import { DOC_TYPE_KEYS, STATES, ageRule, docLabel, getJurisdiction, listJurisdictions } from '../lib/jurisdictions.js';
import { decodeVin, normaliseVin, vinYearMismatch } from '../lib/vin.js';
import { toOps } from '../realtime.js';
import * as trips from '../services/trips.js';

/** Credentials that must be current before a driver can go online. Rules come from the driver's state (jurisdictions table):
 *  NT CPV rules / SA point-to-point rules + DingoGo policy. */
export async function complianceIssues(driverId: string): Promise<string[]> {
  const d = await one(
    `SELECT d.*, v.rego, v.cvl_expiry, v.rego_expiry, v.insurance_expiry, v.inspection_expiry, v.active AS vehicle_active,
            v.status AS vehicle_status, v.review_note AS vehicle_review_note, v.year AS vehicle_year, v.verified_year AS vehicle_verified_year,
            v.rego_state AS vehicle_rego_state
     FROM drivers d LEFT JOIN vehicles v ON v.id = d.vehicle_id WHERE d.user_id = $1`, [driverId]);
  if (!d) return ['Not registered as a driver'];
  const j = await getJurisdiction(d.state);
  const issues: string[] = [];
  if (!j) return [`Unknown state "${d.state}"`];
  const today = new Date().toISOString().slice(0, 10);
  const expired = (date: string | null) => !date || date < today;
  if (d.status !== 'approved') issues.push(`Account status is "${d.status}" — DingoGo must approve your application`);
  if (!j.active) issues.push(`DingoGo isn't operating in ${j.code} yet — ${j.name} is coming soon`);
  const fieldFail = new Set<string>();
  if (expired(d.licence_expiry)) { issues.push('Driver licence missing or expired'); fieldFail.add('licence'); }
  if (j.driver_docs.includes('h_endorsement') && expired(d.h_endorsement_expiry)) { issues.push('H endorsement (CPV driver authority) missing or expired'); fieldFail.add('h_endorsement'); }
  if (!d.abn) { issues.push('ABN required'); fieldFail.add('abn'); }
  if (!d.gst_registered) { issues.push('GST registration required (ATO: rideshare drivers register from the first trip)'); fieldFail.add('gst'); }
  // Every document the state requires must be approved and not expired.
  const docs = await q(
    `SELECT DISTINCT type FROM driver_documents WHERE driver_id = $1 AND vehicle_id IS NULL AND status = 'approved'
       AND (expires_at IS NULL OR expires_at >= $2::date)`, [driverId, today]);
  const have = new Set(docs.map((x) => x.type));
  for (const t of j.driver_docs) {
    if (!have.has(t) && !fieldFail.has(t)) issues.push(`${docLabel(t)}: document missing, expired or not yet approved`);
  }
  if (!d.vehicle_id) issues.push('No vehicle assigned');
  else {
    const vj = (d.vehicle_rego_state === j.code ? j : await getJurisdiction(d.vehicle_rego_state)) ?? j;
    const { min_year } = ageRule(vj.vehicle_max_age_years);
    const year = d.vehicle_verified_year ?? d.vehicle_year;
    if (d.vehicle_status === 'pending') issues.push(`Your car ${d.rego} is waiting for DingoGo to check it`);
    else if (d.vehicle_status === 'rejected') issues.push(`Your car ${d.rego} was not approved${d.vehicle_review_note ? `: ${d.vehicle_review_note}` : ''}`);
    if (d.vehicle_rego_state !== d.state) issues.push(`Your car ${d.rego} is registered in ${d.vehicle_rego_state} — you need a car registered in ${d.state} to drive there`);
    if (year < min_year) issues.push(`Your car ${d.rego} is too old (${year}) — ${vj.code} rideshare cars must be ${min_year} or newer`);
    if (!d.vehicle_active) issues.push(`Vehicle ${d.rego} is off the road`);
    if (vj.vehicle_docs.includes('vehicle_cvl') && expired(d.cvl_expiry)) issues.push(`Vehicle ${d.rego}: rideshare Commercial Vehicle Licence missing or expired`);
    if (vj.inspection_months && expired(d.inspection_expiry)) issues.push(`Vehicle ${d.rego}: ${vj.code} vehicle inspection missing or expired`);
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
    if (d) d.vehicle = vehicleOut(d.vehicle);
    const docs = await q('SELECT id, type, vehicle_id, number, expires_at, status, note, created_at FROM driver_documents WHERE driver_id = $1 ORDER BY created_at DESC', [me.id]);
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
      // Expiry dates are set only by DingoGo when a document is reviewed — drivers cannot extend their own credentials.
      licence_no: z.string().max(20).optional(),
      cpv_authority_no: z.string().max(20).optional(),
      abn: z.string().regex(/^\d{11}$/, 'ABN is 11 digits').optional(), gst_registered: z.boolean().optional(),
      bank_bsb: z.string().regex(/^\d{6}$/).optional(), bank_account: z.string().regex(/^\d{5,10}$/).optional(),
      languages: z.array(z.string().max(20)).max(6).optional(), bio: z.string().max(300).optional(),
      accepts_courier: z.boolean().optional(), accepts_pets: z.boolean().optional(), female_driver: z.boolean().optional(),
      state: z.enum(STATES).optional(),
    }), req.body);
    if (b.state) {
      const cur = await one(`SELECT status, state FROM drivers WHERE user_id = $1`, [me.id]);
      if (cur && cur.state !== b.state && !['applied', 'pending_documents'].includes(cur.status)) {
        throw conflict('state_locked', 'Contact DingoGo to change the state you drive in');
      }
    }
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
      type: z.enum(DOC_TYPE_KEYS),
      file_url: z.string().max(500).optional(), number: z.string().max(40).optional(), expires_at: z.string().date().optional(),
      vehicle_id: z.string().uuid().optional(),
    }), req.body);
    let vehicleId: string | null = b.vehicle_id ?? null;
    if (vehicleId) {
      const own = await one('SELECT 1 FROM vehicles WHERE id = $1 AND owner_driver_id = $2', [vehicleId, me.id]);
      if (!own) throw bad('invalid_vehicle', 'You can only add documents for your own car');
    } else if (VEHICLE_DOC_TYPES.includes(b.type)) {
      // Car paperwork with no car given: attach to the driver's current car if it is their own.
      vehicleId = (await one(`SELECT v.id FROM drivers d JOIN vehicles v ON v.id = d.vehicle_id AND v.owner_driver_id = d.user_id WHERE d.user_id = $1`, [me.id]))?.id ?? null;
    }
    const doc = await one(`INSERT INTO driver_documents (driver_id, type, file_url, number, expires_at, vehicle_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [me.id, b.type, b.file_url ?? null, b.number ?? null, b.expires_at ?? null, vehicleId]);
    toOps('driver.document', { driver_id: me.id, type: b.type, vehicle_id: vehicleId });
    return { document: doc };
  });

  // ───────────── Own cars (drivers bring their own vehicle) ─────────────
  const vehicleBody = z.object({
    rego: z.string().min(2).max(15), make: z.string().trim().min(1).max(40), model: z.string().trim().min(1).max(40),
    year: z.number().int().min(1950).max(2100), colour: z.string().trim().min(1).max(30),
    seats: z.number().int().default(4), doors: z.number().int().default(4),
    fuel_type: z.enum(FUEL_TYPES), vin: z.string().trim().min(1, 'Enter the VIN (17 letters and numbers)').max(25),
    rego_state: z.enum(STATES).optional(),
    pet_friendly: z.boolean().optional(), wheelchair_accessible: z.boolean().optional(),
    range_km: z.number().int().min(10).max(2000).nullable().optional(), battery_kwh: z.number().min(1).max(250).nullable().optional(),
    registered_owner: z.boolean().default(true),
  });

  /** Shared checks for add/edit. `state` = the car's rego state (age limit comes from it). Returns the normalised fields to write. */
  async function checkVehicle(b: Partial<z.infer<typeof vehicleBody>>, state: string, selfId?: string) {
    const out: Record<string, unknown> = { ...b };
    if (b.rego != null) {
      const rego = normaliseRego(b.rego);
      if (!/^[A-Z0-9]{2,10}$/.test(rego)) throw bad('rego', 'Enter the number plate using letters and numbers');
      const taken = await one(`SELECT id FROM vehicles WHERE upper(regexp_replace(rego, '\\s', '', 'g')) = $1 AND id IS DISTINCT FROM $2`, [rego, selfId ?? null]);
      if (taken) throw conflict('rego_taken', `A car with plate ${rego} is already registered with DingoGo`);
      out.rego = rego;
    }
    if (b.vin != null) {
      const vin = normaliseVin(b.vin);
      const r = decodeVin(vin);
      if (!r.valid) throw bad('vin', r.note);
      out.vin = vin;
      out.vin_year = r.year;
    }
    if (b.year != null) {
      const { min_year, max_age_years, current_year } = await vehicleAgeRule(state);
      if (b.year < min_year) throw bad('vehicle_too_old', `${state} rideshare cars must be under ${max_age_years} years old (${min_year} or newer)`);
      if (b.year > current_year + 1) throw bad('year', 'Check the year your car was made');
    }
    if (b.doors != null && b.doors < 4) throw bad('doors', 'Rideshare cars need at least 4 doors');
    if (b.seats != null && (b.seats < 4 || b.seats > 7)) throw bad('seats', 'Cars need 4 to 7 passenger seats');
    if (b.fuel_type && !isEv(b.fuel_type)) { out.range_km = null; out.battery_kwh = null; }
    return out;
  }
  const checksFor = (v: any) => {
    const r = v.vin ? decodeVin(v.vin) : null;
    return { vin_valid: r?.valid ?? null, vin_year: v.vin_year ?? null, vin_note: r?.note ?? null, vin_year_mismatch: vinYearMismatch(v.vin_year, v.year) };
  };

  app.get('/driver/vehicles', async (req) => {
    const me = await requireUser(req, 'driver');
    const d = await one('SELECT vehicle_id, state FROM drivers WHERE user_id = $1', [me.id]);
    const vehicles = await q(
      `SELECT v.*, coalesce((SELECT json_agg(json_build_object('id', x.id, 'type', x.type, 'number', x.number, 'expires_at', x.expires_at,
                'status', x.status, 'note', x.note, 'file_url', x.file_url, 'created_at', x.created_at) ORDER BY x.created_at DESC)
              FROM driver_documents x WHERE x.vehicle_id = v.id AND x.driver_id = $1), '[]') AS documents
       FROM vehicles v WHERE v.owner_driver_id = $1 OR v.id = $2 ORDER BY v.created_at`, [me.id, d?.vehicle_id ?? null]);
    const state = d?.state ?? 'NT';
    const jurisdictions = await listJurisdictions();
    const rules = jurisdictions.find((j) => j.code === state) ?? null;
    return {
      vehicles: vehicles.map((v) => vehicleOut(v)), current_vehicle_id: d?.vehicle_id ?? null,
      state, max_age_years: rules?.max_age_years ?? 13, min_year: rules?.min_year ?? ageRule(13).min_year,
      rules, jurisdictions,
    };
  });

  app.post('/driver/vehicles', async (req, reply) => {
    const me = await requireUser(req, 'driver');
    const b = parse(vehicleBody, req.body);
    const drv = await one('SELECT state FROM drivers WHERE user_id = $1', [me.id]);
    const regoState = b.rego_state ?? drv?.state ?? 'NT';
    const v = await checkVehicle(b, regoState);
    const row = await one(
      `INSERT INTO vehicles (rego, make, model, year, colour, seats, doors, fuel_type, vin, vin_year, rego_state, pet_friendly, wheelchair_accessible, range_km, battery_kwh,
         registered_owner, ownership, owner_driver_id, status)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,'driver_owned',$17,'pending') RETURNING *`,
      [v.rego, b.make, b.model, b.year, b.colour, b.seats, b.doors, b.fuel_type, v.vin, v.vin_year ?? null, regoState, b.pet_friendly ?? false, b.wheelchair_accessible ?? false,
        v.range_km ?? null, v.battery_kwh ?? null, b.registered_owner, me.id]);
    // First car: make it the driver's current car straight away (they stay offline until DingoGo approves it).
    await q('UPDATE drivers SET vehicle_id = $2 WHERE user_id = $1 AND vehicle_id IS NULL', [me.id, row.id]);
    toOps('vehicle.new', { id: row.id, rego: row.rego, driver_id: me.id });
    reply.code(201);
    return { vehicle: vehicleOut(row), checks: checksFor(row) };
  });

  app.patch('/driver/vehicles/:id', async (req) => {
    const me = await requireUser(req, 'driver');
    const id = (req.params as any).id;
    const cur = await one('SELECT * FROM vehicles WHERE id = $1 AND owner_driver_id = $2', [id, me.id]);
    if (!cur) throw notFound('Car');
    const b = parse(vehicleBody.partial().extend({ seats: z.number().int().optional(), doors: z.number().int().optional(), registered_owner: z.boolean().optional() }), req.body);
    const regoState = b.rego_state ?? cur.rego_state;
    // A new state means a new age limit: re-check the year even if it wasn't sent.
    if (b.rego_state && b.rego_state !== cur.rego_state && b.year == null) b.year = cur.year;
    const d = await one('SELECT vehicle_id FROM drivers WHERE user_id = $1', [me.id]);
    const isCurrent = d?.vehicle_id === id;
    if (isCurrent) {
      const live = await one(`SELECT 1 FROM trips WHERE driver_id = $1 AND status IN ('accepted','arrived','in_progress')`, [me.id]);
      if (live) throw conflict('on_trip', 'Finish your trip before changing your car details');
    }
    const fields = await checkVehicle({ ...b, fuel_type: b.fuel_type ?? cur.fuel_type }, regoState, id);
    if (!b.fuel_type) delete fields.fuel_type;
    // Changed identity → DingoGo has to verify it again.
    if ((fields.year != null && fields.year !== cur.year) || (fields.vin != null && fields.vin !== cur.vin)) { fields.verified_year = null; fields.verified_source = null; }
    if ((fields.rego != null && fields.rego !== cur.rego) || (fields.rego_state != null && fields.rego_state !== cur.rego_state)) fields.rego_checked_at = null;
    if (fields.vin != null && fields.vin !== cur.vin) { fields.ppsr_checked_at = null; fields.ppsr_clear = null; }
    const keys = Object.keys(fields).filter((k) => fields[k] !== undefined);
    if (!keys.length) throw bad('empty');
    // Any change means DingoGo has to check the car again.
    const row = await one(
      `UPDATE vehicles SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}, status = 'pending', review_note = NULL, reviewed_at = NULL
       WHERE id = $1 RETURNING *`, [id, ...keys.map((k) => fields[k])]);
    if (isCurrent) await q('UPDATE drivers SET online = false WHERE user_id = $1', [me.id]);
    toOps('vehicle.updated', { id, rego: row.rego, driver_id: me.id, status: 'pending' });
    return { vehicle: vehicleOut(row), checks: checksFor(row) };
  });

  app.post('/driver/vehicles/:id/use', async (req) => {
    const me = await requireUser(req, 'driver');
    const id = (req.params as any).id;
    const v = await one('SELECT * FROM vehicles WHERE id = $1 AND owner_driver_id = $2', [id, me.id]);
    if (!v) throw notFound('Car');
    if (v.status !== 'approved' || !v.active) throw bad('not_approved', `${v.rego} has not been approved by DingoGo yet`);
    const d = await one('SELECT online FROM drivers WHERE user_id = $1', [me.id]);
    if (d?.online) throw conflict('driver_online', 'Go offline before changing cars');
    const live = await one(`SELECT 1 FROM trips WHERE driver_id = $1 AND status IN ('accepted','arrived','in_progress')`, [me.id]);
    if (live) throw conflict('on_trip', 'Finish your trip before changing cars');
    await q('UPDATE drivers SET vehicle_id = $2 WHERE user_id = $1', [me.id, id]);
    return { ok: true, current_vehicle_id: id, vehicle: vehicleOut(v) };
  });

  app.post('/driver/online', async (req) => {
    const me = await requireUser(req, 'driver');
    const b = parse(z.object({ online: z.boolean(), lat: z.number().optional(), lng: z.number().optional(), battery_pct: z.number().int().min(0).max(100).optional() }), req.body);
    if (b.online) {
      const issues = await complianceIssues(me.id);
      if (issues.length) throw bad('not_compliant', issues[0], issues);
    }
    const veh = await one('SELECT v.fuel_type FROM drivers d JOIN vehicles v ON v.id = d.vehicle_id WHERE d.user_id = $1', [me.id]);
    const ev = isEv(veh?.fuel_type);
    // Battery check only makes sense for fully electric cars.
    if (b.online && ev && b.battery_pct != null && b.battery_pct < 15) throw bad('battery_low', 'Charge above 15% before going online');
    const d = await one(
      `UPDATE drivers SET online = $2, lat = coalesce($3, lat), lng = coalesce($4, lng), last_seen_at = now() WHERE user_id = $1 RETURNING vehicle_id, online`,
      [me.id, b.online, b.lat ?? null, b.lng ?? null]);
    if (b.battery_pct != null && d.vehicle_id && ev) {
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
    if (b.battery_pct != null && d?.vehicle_id) await q(`UPDATE vehicles SET battery_pct = $2 WHERE id = $1 AND fuel_type IN ('electric','plug_in_hybrid')`, [d.vehicle_id, b.battery_pct]);
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
    const d = await one('SELECT d.vehicle_id, v.fuel_type FROM drivers d LEFT JOIN vehicles v ON v.id = d.vehicle_id WHERE d.user_id = $1', [me.id]);
    if (!d?.vehicle_id) throw conflict('no_vehicle', 'No vehicle assigned');
    if (!['electric', 'plug_in_hybrid'].includes(d.fuel_type)) throw bad('not_plug_in', 'Charging logs are for electric and plug-in hybrid cars');
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
