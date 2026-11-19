import { pushProviders } from '../services/push.js';
import type { FastifyInstance } from 'fastify';
import { one, q } from '../db.js';
import { ApiError, notFound } from '../lib/errors.js';
import { config } from '../config.js';
import { limit, record, tooMany } from '../lib/rateLimit.js';
import { applicationRef, shareToken } from '../lib/ids.js';
import { FINAL_STAGES, REFERRAL_CODE, STATUS_TOKEN, applicationsPending, applicationsReady, cleanSource, publicApplication } from '../lib/growth.js';
import { sendSmsT } from '../services/notify.js';
import { quoteFare } from '../lib/fares.js';
import { lastRouteError, route } from '../lib/geo.js';
import { searchPlaces } from '../lib/places.js';
import { CONCESSION_TYPES, LANGUAGE_INFO, communityReady, loadCommunityPricing } from '../lib/community.js';
import { latLng, parse, z } from '../lib/validate.js';
import { toOps } from '../realtime.js';
import { loadRule, shareLinkExpired, zoneFor } from '../services/trips.js';
import { cached, settingValue } from '../lib/cache.js';
import { recipientInstructions } from '../services/courier.js';
import { courierReady } from '../lib/courierSchema.js';
import { FAIL_REASONS, MAX_DECLARED_CENTS, MAX_DROPS, PROHIBITED_KEYS, PROHIBITED_VERSION, SIZE_MAX_KG } from '../lib/courier.js';

/** Website forms are open to anyone: cap them per IP so a bot can't flood the ops inbox. */
const formLimit = (req: { ip: string }) =>
  limit('public_form_ip', req.ip, config.rateLimits.publicFormPerIp, 3600, 'Thanks — we’ve had a lot of messages from this connection. Please try again in an hour, or call us.');
import { FUEL_TYPES, vehicleAgeRule } from '../lib/vehicles.js';
import { DOCUMENT_TYPES, listJurisdictions } from '../lib/jurisdictions.js';

/** What a parcel's tracking link shows: progress, the delivery estimate, where it was left (with the photo), or why it is going
 *  back. No PIN, phone numbers, sender address details beyond the pickup already shown, or other drops on the run. */
async function parcelForTracking(tripId: string) {
  const ready = await courierReady();
  const p = await one(
    `SELECT p.size, p.picked_up_at, p.delivered_at, p.leave_unattended, p.requires_signature, split_part(p.recipient_name, ' ', 1) AS recipient_first_name,
            p.sender_name, p.pod_received_by IS NOT NULL AS signed, p.pod_photo_url, t.scheduled_for
            ${ready ? ', p.outcome, p.eta_at, p.safe_place, p.recipient_notes, p.failed_reason, t.pickup_window_end' : ''}
     FROM parcels p JOIN trips t ON t.id = p.trip_id WHERE p.trip_id = $1`, [tripId]);
  if (!p) return null;
  const photoDrop = !!p.pod_photo_url && !p.signed;
  return {
    size: p.size, sender_name: p.sender_name, recipient_first_name: p.recipient_first_name,
    picked_up_at: p.picked_up_at, delivered_at: p.delivered_at, outcome: p.outcome ?? (p.delivered_at ? 'delivered' : null),
    eta_at: p.eta_at ?? null, pickup_window: p.pickup_window_end ? { from: p.scheduled_for, to: p.pickup_window_end } : null,
    leave_unattended: p.leave_unattended, requires_signature: p.requires_signature, safe_place: p.safe_place ?? null,
    recipient_notes: p.recipient_notes ?? null,
    // Left in a safe place: the photo shows where (signed link, like every private upload).
    left_photo_url: photoDrop ? p.pod_photo_url : null,
    failed_reason: p.failed_reason ? (FAIL_REASONS as Record<string, string>)[p.failed_reason] ?? 'Could not be delivered' : null,
    can_add_instructions: ready && !p.delivered_at && !p.outcome,
  };
}

export default async function publicRoutes(app: FastifyInstance) {
  app.get('/health', async () => {
    await q('SELECT 1');
    return { ok: true, service: 'dingogo-api', time: new Date().toISOString() };
  });

  /** Is road routing working? Telegraph Station → Todd Mall. source 'estimate' means the routing provider isn't answering. */
  app.get('/health/routing', async () => {
    const r = await route({ lat: -23.6665, lng: 133.8865 }, { lat: -23.6988, lng: 133.8823 });
    return { source: r.source, distance_m: r.distance_m, duration_s: r.duration_s, points: r.geometry?.length ?? 0, ...(r.source === 'estimate' ? { last_error: lastRouteError() } : {}) };
  });

  // Round 18: the same for everyone and read by every app at start-up: built from parallel queries, kept in memory for
  // CONFIG_CACHE_TTL_MS and cacheable by the browser for a minute (with an ETag, so a reload is a 304).
  const buildPublicConfig = async () => {
    const [services, zones, plans, business, support, cash, cancel, ntAge, jurisdictions, runs, community, communityOn] = await Promise.all([
      q('SELECT service, label, base_cents, per_km_cents, per_min_cents, booking_fee_cents, min_fare_cents, cancel_fee_cents, free_wait_min, night_pct, levy_cents, description FROM fare_rules WHERE active ORDER BY min_fare_cents'),
      q('SELECT id, name, state, centre_lat, centre_lng, radius_km, active, launch_note FROM zones ORDER BY active DESC, state, name'),
      q('SELECT * FROM plans WHERE active ORDER BY price_cents'),
      settingValue('business'), settingValue('support'), settingValue('cash_payments'), settingValue('cancellation_policy'),
      vehicleAgeRule('NT'), listJurisdictions(), courierReady(), loadCommunityPricing(), communityReady(),
    ]);
    return {
      services, zones, plans,
      business: business ?? {},
      support: support ?? {},
      cash_payments: cash ?? { ride: false, courier: true },
      cancellation_policy: cancel ?? null,
      // NT rules (back-compat); per-state rules are in `jurisdictions`.
      vehicle_rules: { ...ntAge, min_doors: 4, seats: { min: 4, max: 7 }, fuel_types: FUEL_TYPES },
      jurisdictions,
      document_types: DOCUMENT_TYPES,
      // Round 9: which push services the apps can register with, and whether masked calls (relay number) are on.
      push: { web_push_key: config.push.vapidPublicKey || null, fcm: pushProviders().fcm },
      comms: { relay: !!(config.twilio.relayNumber && config.twilio.sid && config.twilio.token), chat: true },
      // Round 11: parcel limits and the prohibited items checklist keys (wording in the apps), and what's switched on.
      courier: {
        size_max_kg: SIZE_MAX_KG, max_declared_cents: MAX_DECLARED_CENTS, max_drops: MAX_DROPS,
        prohibited: { version: PROHIBITED_VERSION, keys: PROHIBITED_KEYS }, fail_reasons: FAIL_REASONS,
        runs, windows: runs,
      },
      // Round 12: app languages (Arrernte and Kriol are community drafts) and concession fares (off unless switched on in admin).
      languages: LANGUAGE_INFO,
      community_pricing: (() => {
        const r = community;
        const on = r.enabled && communityOn;
        return { concession: on, pct: on ? r.concession_pct : 0, max_cents: on ? r.concession_max_cents : 0, services: on ? r.services : [],
          types: on ? Object.fromEntries(r.types.map((t) => [t, CONCESSION_TYPES[t]])) : {} };
      })(),
      client_bookings: communityOn,
    };
  };
  app.get('/public/config', async (_req, reply) => {
    reply.header('Cache-Control', 'public, max-age=60');
    return cached('public_config', buildPublicConfig);
  });

  app.get('/public/places', async (req) => ({ places: searchPlaces(String((req.query as any).q ?? '').slice(0, 100)) }));

  /** Anonymous fare estimate for the website. */
  app.post('/public/estimate', async (req) => {
    const b = parse(z.object({ service: z.string().max(40).default('ride'), pickup: latLng, dropoff: latLng }), req.body);
    // Each estimate can use a call to the routing provider (free daily quota): cap per IP.
    await limit('estimate_ip', req.ip, config.rateLimits.estimatePerIp10Min, 600, 'Too many price checks. Please wait a few minutes.');
    const rule = await loadRule(b.service).catch(() => null);
    if (!rule) throw notFound('Service');
    const zone = await zoneFor(b.pickup);
    const r = await route(b.pickup, b.dropoff);
    const quote = quoteFare(rule, { distance_m: r.distance_m, duration_s: r.duration_s, at: new Date(), zoneMultiplier: Number(zone?.demand_multiplier ?? 1),
      levy: zone?.state_levy_cents != null ? { cents: Number(zone.state_levy_cents), label: zone.state_levy_label } : null });
    return { quote, in_service_area: !!zone, zone: zone?.name ?? null };
  });

  // /public/tours: routes/tours.ts (Round 19).
  app.get('/public/partners', async () => ({
    partners: await q('SELECT id, name, kind, address, lat, lng, logo_url, aboriginal_owned FROM partners WHERE active ORDER BY name'),
  }));

  /** Live share-link tracking (no login). Shows only what a trusted contact needs. */
  app.get('/public/track/:token', async (req) => {
    const t = await one(
      `SELECT t.id, t.ref, t.kind, t.status, t.pickup_address, t.pickup_lat, t.pickup_lng, t.dropoff_address, t.dropoff_lat, t.dropoff_lng,
              t.requested_at, t.accepted_at, t.started_at, t.completed_at, t.est_duration_s,
              split_part(du.name, ' ', 1) AS driver_first_name, v.rego, v.make, v.model, v.colour, v.fuel_type,
              (v.fuel_type IN ('electric','plug_in_hybrid','hybrid')) AS green, (v.fuel_type = 'electric') AS is_ev, d.lat AS driver_lat, d.lng AS driver_lng,
              split_part(ru.name, ' ', 1) AS rider_first_name, t.cancelled_at
       FROM trips t JOIN users ru ON ru.id = t.rider_id LEFT JOIN users du ON du.id = t.driver_id
       LEFT JOIN drivers d ON d.user_id = t.driver_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.share_token = $1`, [String((req.params as any).token).slice(0, 100)]);
    if (!t) throw notFound('Trip');
    if (shareLinkExpired(t)) throw new ApiError(410, 'link_expired', 'This trip has finished. Tracking links stop working a day after the trip ends.');
    const live = ['accepted', 'arrived', 'in_progress'].includes(t.status);
    if (!live) { delete t.driver_lat; delete t.driver_lng; }
    const track = live ? await q('SELECT lat, lng FROM trip_track WHERE trip_id = $1 ORDER BY at DESC LIMIT 200', [t.id]) : [];
    const { id, cancelled_at, ...rest } = t;
    if (t.kind === 'courier') (rest as any).parcel = await parcelForTracking(t.id);
    return { trip: rest, track: track.reverse(), live };
  });

  /** The recipient adds delivery instructions or a safe place from their tracking link. */
  app.post('/public/track/:token/instructions', async (req) => {
    const b = parse(z.object({ notes: z.string().max(300).optional(), safe_place: z.string().max(120).optional() }), req.body);
    return recipientInstructions(String((req.params as any).token), req.ip, b);
  });

  app.post('/public/driver-applications', async (req, reply) => {
    const b = parse(z.object({
      name: z.string().min(2).max(80), phone: z.string().min(8).max(20), email: z.string().email(), suburb: z.string().max(60).optional(),
      has_licence_years: z.number().int().min(0).max(70).optional(), has_cpv_authority: z.boolean().default(false),
      wants_lease: z.boolean().default(false), languages: z.string().max(120).optional(), message: z.string().max(1000).optional(),
      // Round 13: where the applicant first came from (utm tags or referrer host, set by the website) and the state they'll drive in.
      source: z.string().max(80).optional(), drive_state: z.enum(['NT', 'SA']).optional(),
    }), req.body);
    await formLimit(req);
    const base = [b.name, b.phone, b.email, b.suburb ?? null, b.has_licence_years ?? null, b.has_cpv_authority, b.wants_lease, b.languages ?? null, b.message ?? null];
    if (!(await applicationsReady())) {
      // Migration 018 not applied yet: the application is still taken, just without a status link.
      const row = await one(
        `INSERT INTO driver_applications (name, phone, email, suburb, has_licence_years, has_cpv_authority, wants_lease, languages, message)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, created_at`, base);
      toOps('application.new', row);
      reply.code(201);
      return { ok: true, id: row.id };
    }
    const token = shareToken();
    const row = await one(
      `INSERT INTO driver_applications (name, phone, email, suburb, has_licence_years, has_cpv_authority, wants_lease, languages, message,
                                        ref, status_token, source, drive_state, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13, now()) RETURNING id, ref, created_at`,
      [...base, applicationRef(), token, cleanSource(b.source), b.drive_state ?? 'NT']);
    toOps('application.new', { id: row.id, created_at: row.created_at });
    const url = `${config.publicWebUrl}/drive/status/${token}`;
    void sendSmsT(b.phone, 'driver_application_received', { ref: row.ref, url }, {});
    reply.code(201);
    return { ok: true, id: row.id, ref: row.ref, status_token: token, status_url: url };
  });

  /** The applicant's private status link. Wrong tokens are counted per IP so links can't be guessed. */
  const applicationByToken = async (req: { ip: string; params: unknown }) => {
    if (!(await applicationsReady())) throw new ApiError(503, 'migration_pending', applicationsPending());
    const token = String((req.params as any).token ?? '');
    if (await tooMany('application_token_ip', req.ip, config.rateLimits.publicFormPerIp * 6, 3600)) {
      throw new ApiError(429, 'rate_limited', 'Too many tries from this connection. Please wait an hour or call us.');
    }
    const row = STATUS_TOKEN.test(token) ? await one('SELECT * FROM driver_applications WHERE status_token = $1', [token]) : null;
    if (!row) { await record('application_token_ip', req.ip); throw notFound('Application'); }
    return row;
  };
  app.get('/public/driver-applications/status/:token', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    return { application: publicApplication(await applicationByToken(req)) };
  });
  app.post('/public/driver-applications/status/:token/withdraw', async (req, reply) => {
    reply.header('Cache-Control', 'no-store');
    const row = await applicationByToken(req);
    if (FINAL_STAGES.includes(row.status)) throw new ApiError(409, 'application_closed', 'This application is already closed.');
    const upd = await one(`UPDATE driver_applications SET status = 'withdrawn', updated_at = now() WHERE id = $1 AND status = $2 RETURNING *`, [row.id, row.status]);
    if (!upd) throw new ApiError(409, 'application_changed', 'This application just changed. Refresh to see where it is up to.');
    toOps('application.withdrawn', { id: row.id });
    return { application: publicApplication(upd) };
  });

  /** Referral invite links (/invite/CODE on the website): says only whether the code works and what it's worth — nothing about the
   *  person who shared it. Misses are counted per IP so codes can't be listed by guessing. */
  app.get('/public/referrals/:code', async (req) => {
    const code = String((req.params as any).code ?? '');
    if (await tooMany('referral_check_ip', req.ip, config.rateLimits.publicFormPerIp * 6, 3600)) {
      throw new ApiError(429, 'rate_limited', 'Too many tries from this connection. Please wait an hour.');
    }
    const u = REFERRAL_CODE.test(code) ? await one(`SELECT 1 FROM users WHERE upper(referral_code) = upper($1) AND deleted_at IS NULL`, [code]) : null;
    if (!u) await record('referral_check_ip', req.ip);
    return { valid: !!u, code: u ? code.toUpperCase() : null, bonus_points: config.loyalty.referralBonusPoints };
  });

  app.post('/public/hire-requests', async (req, reply) => {
    const b = parse(z.object({
      kind: z.enum(['event', 'corporate', 'wedding', 'conference', 'festival', 'tour', 'ndis', 'other']),
      contact_name: z.string().min(2).max(80), contact_email: z.string().email(), contact_phone: z.string().max(20).optional(),
      organisation: z.string().max(120).optional(), event_date: z.string().date().optional(), passengers: z.number().int().min(1).max(500).optional(),
      vehicles: z.number().int().min(1).max(20).optional(), details: z.string().max(2000).optional(),
    }), req.body);
    await formLimit(req);
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
    await formLimit(req);
    const row = await one(`INSERT INTO enquiries (kind, name, email, phone, organisation, message) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [b.kind, b.name, b.email, b.phone ?? null, b.organisation ?? null, b.message]);
    reply.code(201);
    return { ok: true, id: row.id };
  });
}
