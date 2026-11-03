import type { FastifyInstance } from 'fastify';
import { one, q } from '../db.js';
import { notFound } from '../lib/errors.js';
import { quoteFare } from '../lib/fares.js';
import { route } from '../lib/geo.js';
import { searchPlaces } from '../lib/places.js';
import { latLng, parse, z } from '../lib/validate.js';
import { toOps } from '../realtime.js';
import { zoneFor } from '../services/trips.js';

export default async function publicRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    await q('SELECT 1');
    return { ok: true, service: 'dingogo-api', time: new Date().toISOString() };
  });

  app.get('/public/config', async () => ({
    services: await q('SELECT service, label, base_cents, per_km_cents, per_min_cents, booking_fee_cents, min_fare_cents, cancel_fee_cents, free_wait_min, night_pct, levy_cents, description FROM fare_rules WHERE active ORDER BY min_fare_cents'),
    zones: await q('SELECT id, name, centre_lat, centre_lng, radius_km, active, launch_note FROM zones ORDER BY active DESC, name'),
    plans: await q('SELECT * FROM plans WHERE active ORDER BY price_cents'),
    business: (await one(`SELECT value FROM settings WHERE key = 'business'`))?.value ?? {},
    support: (await one(`SELECT value FROM settings WHERE key = 'support'`))?.value ?? {},
    cash_payments: (await one(`SELECT value FROM settings WHERE key = 'cash_payments'`))?.value ?? { ride: false, courier: true },
    cancellation_policy: (await one(`SELECT value FROM settings WHERE key = 'cancellation_policy'`))?.value ?? null,
  }));

  app.get('/public/places', async (req) => ({ places: searchPlaces(String((req.query as any).q ?? '')) }));

  /** Anonymous fare estimate for the website. */
  app.post('/public/estimate', async (req) => {
    const b = parse(z.object({ service: z.string().default('ride'), pickup: latLng, dropoff: latLng }), req.body);
    const rule = await one('SELECT * FROM fare_rules WHERE service = $1 AND active', [b.service]);
    if (!rule) throw notFound('Service');
    const zone = await zoneFor(b.pickup);
    const r = await route(b.pickup, b.dropoff);
    const quote = quoteFare(rule, { distance_m: r.distance_m, duration_s: r.duration_s, at: new Date(), zoneMultiplier: Number(zone?.demand_multiplier ?? 1) });
    return { quote, in_service_area: !!zone, zone: zone?.name ?? null };
  });

  app.get('/public/tours', async () => ({ tours: await q('SELECT * FROM tour_packages WHERE active ORDER BY price_cents') }));
  app.get('/public/partners', async () => ({
    partners: await q('SELECT id, name, kind, address, lat, lng, logo_url, aboriginal_owned FROM partners WHERE active ORDER BY name'),
  }));

  /** Live share-link tracking (no login). Shows only what a trusted contact needs. */
  app.get('/public/track/:token', async (req) => {
    const t = await one(
      `SELECT t.id, t.ref, t.kind, t.status, t.pickup_address, t.pickup_lat, t.pickup_lng, t.dropoff_address, t.dropoff_lat, t.dropoff_lng,
              t.requested_at, t.accepted_at, t.started_at, t.completed_at, t.est_duration_s,
              split_part(du.name, ' ', 1) AS driver_first_name, v.rego, v.make, v.model, v.colour, d.lat AS driver_lat, d.lng AS driver_lng,
              split_part(ru.name, ' ', 1) AS rider_first_name
       FROM trips t JOIN users ru ON ru.id = t.rider_id LEFT JOIN users du ON du.id = t.driver_id
       LEFT JOIN drivers d ON d.user_id = t.driver_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.share_token = $1`, [(req.params as any).token]);
    if (!t) throw notFound('Trip');
    const live = ['accepted', 'arrived', 'in_progress'].includes(t.status);
    if (!live) { delete t.driver_lat; delete t.driver_lng; }
    const track = live ? await q('SELECT lat, lng FROM trip_track WHERE trip_id = $1 ORDER BY at DESC LIMIT 200', [t.id]) : [];
    const { id, ...rest } = t;
    return { trip: rest, track: track.reverse(), live };
  });

  app.post('/public/driver-applications', async (req, reply) => {
    const b = parse(z.object({
      name: z.string().min(2).max(80), phone: z.string().min(8).max(20), email: z.string().email(), suburb: z.string().max(60).optional(),
      has_licence_years: z.number().int().min(0).max(70).optional(), has_cpv_authority: z.boolean().default(false),
      wants_lease: z.boolean().default(false), languages: z.string().max(120).optional(), message: z.string().max(1000).optional(),
    }), req.body);
    const row = await one(
      `INSERT INTO driver_applications (name, phone, email, suburb, has_licence_years, has_cpv_authority, wants_lease, languages, message)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, created_at`,
      [b.name, b.phone, b.email, b.suburb ?? null, b.has_licence_years ?? null, b.has_cpv_authority, b.wants_lease, b.languages ?? null, b.message ?? null]);
    toOps('application.new', row);
    reply.code(201);
    return { ok: true, id: row.id };
  });

  app.post('/public/hire-requests', async (req, reply) => {
    const b = parse(z.object({
      kind: z.enum(['event', 'corporate', 'wedding', 'conference', 'festival', 'tour', 'ndis', 'other']),
      contact_name: z.string().min(2).max(80), contact_email: z.string().email(), contact_phone: z.string().max(20).optional(),
      organisation: z.string().max(120).optional(), event_date: z.string().date().optional(), passengers: z.number().int().min(1).max(500).optional(),
      vehicles: z.number().int().min(1).max(20).optional(), details: z.string().max(2000).optional(),
    }), req.body);
    const row = await one(
      `INSERT INTO hire_requests (kind, contact_name, contact_email, contact_phone, organisation, event_date, passengers, vehicles, details)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, created_at`,
      [b.kind, b.contact_name, b.contact_email, b.contact_phone ?? null, b.organisation ?? null, b.event_date ?? null, b.passengers ?? null, b.vehicles ?? null, b.details ?? null]);
    toOps('hire.new', row);
    reply.code(201);
    return { ok: true, id: row.id };
  });

  app.post('/public/enquiries', async (req, reply) => {
    const b = parse(z.object({
      kind: z.enum(['advertise', 'partner', 'general', 'media']), name: z.string().min(2).max(80), email: z.string().email(),
      phone: z.string().max(20).optional(), organisation: z.string().max(120).optional(), message: z.string().min(5).max(2000),
    }), req.body);
    const row = await one(`INSERT INTO enquiries (kind, name, email, phone, organisation, message) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [b.kind, b.name, b.email, b.phone ?? null, b.organisation ?? null, b.message]);
    reply.code(201);
    return { ok: true, id: row.id };
  });
}
