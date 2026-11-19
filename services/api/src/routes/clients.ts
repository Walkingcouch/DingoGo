/**
 * Round 12: community organisations, Aboriginal corporations, health services and NDIS providers booking rides for their clients.
 *
 * Rules:
 * - Only accounts of a community kind (CLIENT_BOOKING_KINDS) can book for clients, and only their members.
 * - A ride can be booked for a client only while that client's consent for this organisation is current (recorded here: how it was
 *   given, by whom, when, optional expiry). The client is texted when consent is recorded and can withdraw it in the app.
 * - The trip belongs to the client (their trip list, texts, PIN, receipts); the organisation pays (account invoice) and sees only the
 *   trips it booked: managers see the account's, members the ones they booked. The client is shown as "First L." with the last 3
 *   digits of their mobile — never their other trips or the full number.
 * Needs migration 017 (503 migration_pending before it).
 */
import type { FastifyInstance } from 'fastify';
import { one, q } from '../db.js';
import { requireUser } from '../auth.js';
import { ApiError, bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { latLng, parse, z } from '../lib/validate.js';
import { referralCode } from '../lib/ids.js';
import { auMobile } from '../lib/courier.js';
import { audit } from '../lib/audit.js';
import { CLIENT_BOOKING_KINDS, CONSENT_METHODS, clientName, communityPending, communityReady } from '../lib/community.js';
import { send, sendSmsT } from '../services/notify.js';
import { pickupWhen } from '../services/trips.js';
import * as trips from '../services/trips.js';

const tail = (p: string | null | undefined) => (p ? `…${String(p).slice(-3)}` : null);

async function ready() {
  if (!(await communityReady())) throw new ApiError(503, 'migration_pending', `Booking for clients: ${communityPending}`);
}

/** The caller's membership of a community account that may book for clients. */
async function membership(userId: string, accountId: string) {
  const m = await one(
    `SELECT m.role, a.id, a.name, a.kind FROM corporate_members m JOIN corporate_accounts a ON a.id = m.account_id
     WHERE m.account_id = $1 AND m.user_id = $2 AND a.active`, [accountId, userId]);
  if (!m) throw forbidden('You are not a member of that account');
  if (!CLIENT_BOOKING_KINDS.includes(m.kind)) throw forbidden('Only community, health and NDIS accounts can book rides for clients');
  return m as { role: string; id: string; name: string; kind: string };
}

const CURRENT = `c.withdrawn_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > now())`;

const consentOut = (r: any) => ({
  id: r.id, client: clientName(r.client_name), client_full_name: r.client_name, phone_tail: tail(r.client_phone), method: r.method, note: r.note,
  given_at: r.given_at, expires_at: r.expires_at, withdrawn_at: r.withdrawn_at, current: !!r.current, recorded_by: r.recorded_by_name ?? null,
});

const rideBody = z.object({
  account_id: z.string().uuid(),
  consent_id: z.string().uuid(),
  pickup: latLng, dropoff: latLng,
  scheduled_for: z.string().datetime().nullable().optional(),
  passengers: z.number().int().min(1).max(4).optional(),
  assistance_animal: z.boolean().optional(),
  needs_wheelchair: z.boolean().optional(),
  women_driver_pref: z.boolean().optional(),
  notes: z.string().max(300).optional(),
  ndis_number: z.string().regex(/^\d{9}$/, 'NDIS number is 9 digits').optional(),
});

export default async function clientRoutes(app: FastifyInstance) {
  /** Clients this account may book for (current consents first), for members of a community account. */
  app.get('/business/clients', async (req) => {
    const me = await requireUser(req);
    await ready();
    const { account_id } = parse(z.object({ account_id: z.string().uuid() }), req.query);
    const m = await membership(me.id, account_id);
    const rows = await q(
      `SELECT c.*, u.name AS client_name, u.phone AS client_phone, r.name AS recorded_by_name, (${CURRENT}) AS current
       FROM client_consents c JOIN users u ON u.id = c.client_id LEFT JOIN users r ON r.id = c.recorded_by
       WHERE c.account_id = $1 ORDER BY (${CURRENT}) DESC, c.given_at DESC LIMIT 500`, [account_id]);
    return { account: { id: m.id, name: m.name, kind: m.kind }, clients: rows.map(consentOut) };
  });

  /** Record a client's consent for this organisation to book rides for them. The client is texted. */
  app.post('/business/clients', async (req, reply) => {
    const me = await requireUser(req);
    await ready();
    const b = parse(z.object({
      account_id: z.string().uuid(),
      name: z.string().trim().min(1).max(80),
      phone: z.string().max(20),
      method: z.enum(CONSENT_METHODS),
      note: z.string().max(200).optional(),
      expires_at: z.string().date().nullable().optional(),
      confirm: z.literal(true, { message: 'Confirm the client agreed' }),
    }), req.body);
    const m = await membership(me.id, b.account_id);
    const mobile = auMobile(b.phone);
    if (!mobile) throw bad('client_phone', 'The client needs an Australian mobile number for trip texts');
    if (b.expires_at && b.expires_at <= new Date().toISOString().slice(0, 10)) throw bad('validation_error', 'Expiry must be in the future');
    let u = await one(`SELECT id, name, phone, role FROM users WHERE phone = $1 AND deleted_at IS NULL`, [mobile]);
    if (u && u.role !== 'rider') throw bad('client_phone', 'That number belongs to a DingoGo staff or driver account. Use the client’s own mobile.');
    // Someone who already has an account keeps their own name; nobody learns whether the number was already a customer.
    if (!u) u = await one(`INSERT INTO users (phone, name, referral_code) VALUES ($1,$2,$3) RETURNING id, name, phone`, [mobile, b.name, referralCode(b.name)]);
    const existing = await one(`SELECT id FROM client_consents c WHERE c.account_id = $1 AND c.client_id = $2 AND ${CURRENT}`, [m.id, u.id]);
    if (existing) throw conflict('consent_exists', 'This client already has current consent with your organisation');
    const row = await one(
      `INSERT INTO client_consents (account_id, client_id, method, note, recorded_by, expires_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *, true AS current`,
      [m.id, u.id, b.method, b.note ?? null, me.id, b.expires_at ?? null]);
    await audit(me.id, 'client_consent_recorded', 'corporate_account', m.id, { consent_id: row.id, method: b.method });
    void send(u.id, 'client_consent_recorded', { org: m.name });
    void sendSmsT(mobile, 'client_consent_recorded', { org: m.name }, { userId: u.id });
    reply.code(201);
    return { client: consentOut({ ...row, client_name: b.name, client_phone: mobile, recorded_by_name: null }) };
  });

  /** Staff withdraw a consent (the client asked, or stopped being a client). */
  app.post('/business/clients/:id/withdraw', async (req) => {
    const me = await requireUser(req);
    await ready();
    const c = await one(`SELECT * FROM client_consents WHERE id = $1`, [(req.params as any).id]);
    if (!c) throw notFound('Consent');
    await membership(me.id, c.account_id);
    if (c.withdrawn_at) return { ok: true };
    await q(`UPDATE client_consents SET withdrawn_at = now(), withdrawn_by = $2 WHERE id = $1`, [c.id, me.id]);
    await audit(me.id, 'client_consent_withdrawn', 'corporate_account', c.account_id, { consent_id: c.id, by: 'staff' });
    return { ok: true };
  });

  /** Price a ride for a client (same body as booking, nothing held). */
  app.post('/business/rides/quote', async (req) => {
    const me = await requireUser(req);
    await ready();
    const b = parse(rideBody, req.body);
    await membership(me.id, b.account_id);
    const c = await currentConsent(b.consent_id, b.account_id);
    const { quote, route } = await trips.buildQuote(c.client_id, { service: 'ride', pickup: b.pickup, dropoff: b.dropoff, scheduled_for: b.scheduled_for ?? null,
      corporate_account_id: b.account_id }, undefined, { opsBooking: true });
    return { quote, route: { distance_m: route.distance_m, duration_s: route.duration_s } };
  });

  /** Book a ride for a client, billed to the organisation. The client gets the trip texts and sees it in their app. */
  app.post('/business/rides', async (req, reply) => {
    const me = await requireUser(req);
    await ready();
    const b = parse(rideBody, req.body);
    const m = await membership(me.id, b.account_id);
    const c = await currentConsent(b.consent_id, b.account_id);
    const t = await trips.createTrip(c.client_id, {
      kind: 'ride', service: 'ride', pickup: b.pickup, dropoff: b.dropoff, scheduled_for: b.scheduled_for ?? null,
      passengers: b.passengers, assistance_animal: b.assistance_animal, needs_wheelchair: b.needs_wheelchair, women_driver_pref: b.women_driver_pref,
      notes: b.notes, ndis_number: b.ndis_number, payment_method: 'corporate', corporate_account_id: m.id, channel: 'org', booked_by: me.id,
    });
    await audit(me.id, 'client_ride_booked', 'trip', t.id, { account_id: m.id, consent_id: c.id });
    void send(c.client_id, 'ride_booked_for_you', { org: m.name, ref: t.ref, when: pickupWhen(t.scheduled_for ?? new Date()), pickup: t.pickup_address }, { trip: { id: t.id, channel: 'org' } });
    reply.code(201);
    return { trip: rideOut(t, m.role === 'manager' || t.booked_by === me.id) };
  });

  /** Rides this organisation booked for clients: managers see the account's, members the ones they booked. */
  app.get('/business/rides', async (req) => {
    const me = await requireUser(req);
    await ready();
    const f = parse(z.object({ account_id: z.string().uuid(), limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    const m = await membership(me.id, f.account_id);
    const rows = await q(
      `SELECT t.id, t.ref, t.status, t.pickup_address, t.dropoff_address, t.scheduled_for, t.requested_at, t.completed_at, t.quote_cents, t.final_cents,
              t.booked_by, b.name AS booked_by_name, u.name AS client_name, u.phone AS client_phone,
              du.name AS driver_name, v.rego, v.make, v.model, v.colour
       FROM trips t JOIN users u ON u.id = t.rider_id LEFT JOIN users b ON b.id = t.booked_by
       LEFT JOIN users du ON du.id = t.driver_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
       WHERE t.corporate_account_id = $1 AND t.channel = 'org' ${m.role === 'manager' ? '' : 'AND t.booked_by = $3'}
       ORDER BY coalesce(t.scheduled_for, t.requested_at) DESC LIMIT $2`,
      m.role === 'manager' ? [m.id, f.limit] : [m.id, f.limit, me.id]);
    return { rides: rows.map((r) => rideOut(r, true)) };
  });

  /** Cancel a ride the organisation booked (appointment moved). Same rules and fees as the client cancelling. */
  app.post('/business/rides/:id/cancel', async (req) => {
    const me = await requireUser(req);
    await ready();
    const t = await one(`SELECT id, rider_id, corporate_account_id, booked_by, channel FROM trips WHERE id = $1`, [(req.params as any).id]);
    if (!t || t.channel !== 'org' || !t.corporate_account_id) throw notFound('Trip');
    const m = await membership(me.id, t.corporate_account_id);
    if (m.role !== 'manager' && t.booked_by !== me.id) throw forbidden('Only the person who booked it or an account manager can cancel');
    const out = await trips.cancelTrip({ id: t.rider_id, role: 'rider' }, t.id, 'Cancelled by the organisation that booked it');
    await audit(me.id, 'client_ride_cancelled', 'trip', t.id, { account_id: m.id });
    return { trip: rideOut(out, true) };
  });
}

async function currentConsent(id: string, accountId: string) {
  const c = await one(`SELECT c.* FROM client_consents c WHERE c.id = $1 AND c.account_id = $2 AND ${CURRENT}`, [id, accountId]);
  if (!c) throw new ApiError(403, 'consent_required', 'This client has not given (or has withdrawn) consent for your organisation to book for them');
  return c;
}

/** What the organisation sees of a ride: no full client phone, no PIN, no share link. */
function rideOut(t: any, full: boolean) {
  const car = t.vehicle ?? (t.rego ? { rego: t.rego, make: t.make, model: t.model, colour: t.colour } : null);
  return {
    id: t.id, ref: t.ref, status: t.status, scheduled_for: t.scheduled_for, requested_at: t.requested_at, completed_at: t.completed_at,
    pickup_address: full ? t.pickup_address : null, dropoff_address: full ? t.dropoff_address : null,
    quote_cents: t.quote_cents, final_cents: t.final_cents ?? null,
    client: clientName(t.client_name ?? t.rider?.name), phone_tail: tail(t.client_phone ?? t.rider?.phone ?? null),
    booked_by: t.booked_by_name ?? null,
    driver: (t.driver_name ?? t.driver?.name) ? { name: String(t.driver_name ?? t.driver?.name).split(' ')[0], car } : null,
  };
}
