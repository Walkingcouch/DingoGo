import type pg from 'pg';
import { config } from '../config.js';
import { one, pool, q, tx, type Q } from '../db.js';
import { ApiError, bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { quoteFare, type FareQuote, type FareRule } from '../lib/fares.js';
import { driverPay, loadDriverPay, longPickupCents, pickupPayCents, serviceFeeFor, type DriverPay, type DriverPaySettings } from '../lib/driverPay.js';
import { haversine, route, withinZone, type LatLng } from '../lib/geo.js';
import { pin4, shareToken, tripRef } from '../lib/ids.js';
import { isEv, isGreen } from '../lib/vehicles.js';
import { toOps, toTrip, toUser } from '../realtime.js';
import { send, sendSmsT } from './notify.js';
import { sendDocExpiryReminders } from './docExpiry.js';
import * as pay from './payments.js';
import { autoEarningsFloor } from './earningsFloor.js';

export const ACTIVE = ['requested', 'accepted', 'arrived', 'in_progress'] as const;

export interface QuoteInput {
  service: string;
  pickup: LatLng & { address?: string };
  dropoff: LatLng & { address?: string };
  scheduled_for?: string | null;
  promo_code?: string | null;
  redeem_points?: number;
  corporate_account_id?: string | null;
  tour_package_id?: string | null;
}

export async function loadRule(service: string, c: Q = pool): Promise<FareRule> {
  const r = await one<FareRule & { active: boolean }>('SELECT * FROM fare_rules WHERE service = $1', [service], c);
  if (!r || !r.active) throw bad('invalid_service', `Service "${service}" is not available`);
  return r;
}

/** Active zone containing the point, in a state DingoGo operates in (an active zone in a hidden state stays unavailable).
 *  Includes the zone's state levy (jurisdiction). */
export async function zoneFor(p: LatLng, c: Q = pool) {
  const zones = await q(
    `SELECT z.*, j.levy_cents AS state_levy_cents, j.levy_label AS state_levy_label, j.active AS state_active
     FROM zones z LEFT JOIN jurisdictions j ON j.code = z.state WHERE z.active AND coalesce(j.active, true) ORDER BY z.radius_km`, [], c);
  return zones.find((z) => withinZone(p, z)) ?? null;
}

async function activePlan(userId: string | null, c: Q = pool) {
  if (!userId) return null;
  return one(
    `SELECT p.*, s.deliveries_used FROM subscriptions s JOIN plans p ON p.code = s.plan_code
     WHERE s.user_id = $1 AND s.status = 'active' AND s.period_end > now()`, [userId], c);
}

export async function validatePromo(code: string, userId: string | null, c: Q = pool) {
  const p = await one('SELECT * FROM promo_codes WHERE upper(code) = upper($1)', [code], c);
  const now = new Date();
  if (!p || !p.active) throw bad('promo_invalid', 'That promo code is not valid');
  if (p.valid_from && new Date(p.valid_from) > now) throw bad('promo_invalid', 'That promo code is not active yet');
  if (p.valid_to && new Date(p.valid_to) < now) throw bad('promo_expired', 'That promo code has expired');
  if (p.max_uses != null && p.uses >= p.max_uses) throw bad('promo_exhausted', 'That promo code has been fully used');
  if (userId) {
    const used = await one<{ n: number }>(
      `SELECT count(*)::int n FROM trips WHERE rider_id = $1 AND promo_code = $2 AND status NOT IN ('cancelled_rider','cancelled_driver','cancelled_admin','no_drivers')`,
      [userId, p.code], c);
    if (used!.n >= p.per_user_limit) throw bad('promo_used', 'You have already used this promo code');
    if (p.first_trip_only) {
      const prior = await one<{ n: number }>(`SELECT count(*)::int n FROM trips WHERE rider_id = $1 AND status = 'completed'`, [userId], c);
      if (prior!.n > 0) throw bad('promo_first_trip', 'This code is for your first trip only');
    }
  }
  return p;
}

export async function buildQuote(userId: string | null, input: QuoteInput, c: Q = pool, opts: { opsBooking?: boolean } = {}) {
  const rule = await loadRule(input.service, c);
  const zone = await zoneFor(input.pickup, c);
  if (!zone) throw bad('outside_service_area', 'Pickup is outside our current service area (Alice Springs / Mparntwe)');

  let fixedPriceCents: number | undefined;
  let r = await route(input.pickup, input.dropoff);
  if (input.service === 'tour') {
    if (!input.tour_package_id) throw bad('tour_required', 'Choose a tour package');
    const t = await one('SELECT * FROM tour_packages WHERE id = $1 AND active', [input.tour_package_id], c);
    if (!t) throw notFound('Tour');
    fixedPriceCents = t.price_cents;
    r = { ...r, duration_s: t.duration_min * 60 };
  }

  const at = input.scheduled_for ? new Date(input.scheduled_for) : new Date();
  const holiday = await one('SELECT 1 FROM public_holidays WHERE day = ($1::timestamptz AT TIME ZONE $2)::date', [at, config.timezone], c);
  const plan = await activePlan(userId, c);
  const promo = input.promo_code ? await validatePromo(input.promo_code, userId, c) : null;
  let corporateDiscountPct = 0;
  if (input.corporate_account_id && userId) {
    // Dispatchers may bill any active account (e.g. an NDIS plan manager booking for a participant by phone).
    const acct = opts.opsBooking
      ? await one(`SELECT * FROM corporate_accounts WHERE id = $1 AND active`, [input.corporate_account_id], c)
      : await one(
      `SELECT a.* FROM corporate_accounts a JOIN corporate_members m ON m.account_id = a.id
       WHERE a.id = $1 AND m.user_id = $2 AND a.active`, [input.corporate_account_id, userId], c);
    if (!acct) throw forbidden('You are not a member of that business account');
    corporateDiscountPct = acct.discount_pct;
  }
  const user = userId ? await one('SELECT loyalty_points FROM users WHERE id = $1', [userId], c) : null;

  // Driver pay rules: long-pickup charge (nearest free car far away; on-demand only) and fuel surcharge (not tours).
  const pay = await loadDriverPay(c);
  let longPickup: { km: number; cents: number } | null = null;
  if (pay.pickup.enabled && !input.scheduled_for && input.service !== 'tour') {
    const m = await nearestFreeCarM(input.pickup, zone.state ?? 'NT', c);
    const cents = longPickupCents(m, pay);
    if (m != null && cents > 0) longPickup = { km: m / 1000, cents };
  }
  const fuelSurchargeCents = pay.fuel_surcharge.enabled && input.service !== 'tour' ? pay.fuel_surcharge.cents : 0;

  const quote: FareQuote = quoteFare(rule, {
    distance_m: r.distance_m,
    duration_s: r.duration_s,
    at,
    isHoliday: !!holiday,
    zoneMultiplier: Number(zone.demand_multiplier),
    plan: plan ? {
      ride_discount_pct: plan.ride_discount_pct,
      waive_booking_fee: plan.waive_booking_fee,
      free_delivery: plan.deliveries_used < plan.free_deliveries,
    } : null,
    promo: promo ? { code: promo.code, kind: promo.kind, value: promo.value, max_discount_cents: promo.max_discount_cents } : null,
    corporateDiscountPct,
    pointsToRedeem: input.redeem_points,
    availablePoints: user?.loyalty_points ?? 0,
    fixedPriceCents,
    levy: zone.state_levy_cents != null ? { cents: Number(zone.state_levy_cents), label: zone.state_levy_label } : null,
    longPickup,
    fuelSurchargeCents,
  });
  return { quote, route: r, zone, rule, promo };
}

/** Road-distance estimate (straight line × 1.3, as dispatch ranks drivers) from the pickup to the nearest free, approved,
 *  online car in that state. Null when no car is free (no long-pickup charge then: we can't know who will come). */
export async function nearestFreeCarM(p: LatLng, state: string, c: Q = pool): Promise<number | null> {
  const cars = await q(
    `SELECT d.lat, d.lng FROM drivers d JOIN vehicles v ON v.id = d.vehicle_id AND v.active AND v.status = 'approved'
     JOIN users du ON du.id = d.user_id AND NOT du.blocked AND du.deleted_at IS NULL
     WHERE d.status = 'approved' AND d.online AND d.lat IS NOT NULL AND d.last_seen_at > now() - interval '3 minutes' AND d.state = $1
       AND NOT EXISTS (SELECT 1 FROM trips x WHERE x.driver_id = d.user_id AND x.status IN ('accepted','arrived','in_progress'))`, [state], c);
  let best: number | null = null;
  for (const d of cars) {
    const m = haversine({ lat: d.lat, lng: d.lng }, p) * 1.3;
    if (m <= config.dispatch.searchRadiusKm * 1000 && (best == null || m < best)) best = m;
  }
  return best;
}

/** What a driver would be paid for this trip in their current car, picked up from `pickupM` metres away.
 *  Fare = the trip fare (excludes booking fee, levy and the rider's discounts, which DingoGo funds). */
export async function offerPay(c: Q, t: any, driverId: string, pickupM: number | null, s?: DriverPaySettings): Promise<DriverPay> {
  const rules = s ?? await loadDriverPay(c);
  const d = await one(
    `SELECT d.commission_pct, v.fuel_type, v.ownership FROM drivers d LEFT JOIN vehicles v ON v.id = d.vehicle_id WHERE d.user_id = $1`, [driverId], c);
  const fee = serviceFeeFor(Number(d?.commission_pct ?? 25), d?.fuel_type ? d : null, rules);
  const fb = t.fare_breakdown ?? {};
  return driverPay({
    fareCents: Number(fb.trip_cents ?? t.quote_cents), feePct: fee.pct, feeBasis: fee.basis, pickupM,
    pickupPayCents: pickupPayCents(pickupM, rules), fuelSurchargeCents: Number(fb.fuel_surcharge_cents ?? 0),
  }, rules);
}

export interface CreateTripInput extends QuoteInput {
  kind: 'ride' | 'courier';
  passengers?: number;
  has_pet?: boolean;
  pet_details?: string;
  needs_wheelchair?: boolean;
  assistance_animal?: boolean;
  notes?: string;
  payment_method: 'card' | 'cash' | 'corporate' | 'wallet';
  women_driver_pref?: boolean;
  ndis_number?: string;
  channel?: 'app' | 'phone' | 'web' | 'sms';
  booked_by?: string;
  parcel?: {
    size: 'S' | 'M' | 'L'; weight_kg?: number; description: string; declared_value_cents?: number;
    sender_name: string; sender_phone: string; recipient_name: string; recipient_phone: string;
    instructions?: string; leave_unattended?: boolean; requires_signature?: boolean; prohibited_ack: boolean;
  };
}

export async function createTrip(userId: string, input: CreateTripInput) {
  // One live trip at a time per rider (courier jobs are exempt so a business can send several parcels).
  if (input.kind === 'ride') {
    const live = await one(`SELECT id FROM trips WHERE rider_id = $1 AND kind = 'ride' AND status = ANY($2)`, [userId, ACTIVE]);
    if (live) throw conflict('trip_in_progress', 'You already have a ride in progress');
  }
  if (input.kind === 'courier') {
    if (!input.parcel) throw bad('parcel_required', 'Parcel details are required');
    if (!input.parcel.prohibited_ack) {
      throw bad('prohibited_ack_required', 'Please confirm the parcel contains no alcohol, weapons, drugs or dangerous goods');
    }
    if (!input.service.startsWith('courier')) throw bad('invalid_service', 'Courier jobs must use a courier service');
  }
  if (input.has_pet && input.service !== 'pet') throw bad('pet_service_required', 'Choose "Pet-friendly" to bring a pet (assistance animals are always welcome on any service)');
  if (input.payment_method === 'corporate' && !input.corporate_account_id) throw bad('corporate_required');
  if (input.payment_method === 'cash') {
    const cash = (await one(`SELECT value FROM settings WHERE key = 'cash_payments'`))?.value ?? { ride: false, courier: true };
    if (!cash[input.kind]) throw bad('cash_not_accepted', input.kind === 'ride'
      ? 'Rides are paid in the app. Use a card, DingoGo credit (prepaid vouchers work too) or a business account.'
      : 'Cash is not accepted for this service.');
  }

  const scheduled = input.scheduled_for ? new Date(input.scheduled_for) : null;
  if (scheduled) {
    const mins = (scheduled.getTime() - Date.now()) / 60000;
    if (mins < 20) throw bad('schedule_too_soon', 'Scheduled trips must be at least 20 minutes ahead');
    if (mins > 60 * 24 * 60) throw bad('schedule_too_far', 'You can book up to 60 days ahead');
  }
  // Card: available for this account (mock mode: test accounts only in production) and, with Stripe, a saved card to hold.
  if (input.payment_method === 'card') await pay.requireCardOnFile(userId);

  let heldRef: string | null = null;
  return tx(async (c) => {
    const { quote, route: r, zone, promo } = await buildQuote(userId, input, c, { opsBooking: !!input.booked_by });
    const user = await one('SELECT * FROM users WHERE id = $1 FOR UPDATE', [userId], c);

    if (input.payment_method === 'wallet' && user.wallet_cents < quote.total_cents) {
      throw bad('wallet_insufficient', 'Not enough DingoGo credit for this trip');
    }

    const trip = await one(
      `INSERT INTO trips (ref, kind, service, status, zone_id, rider_id, corporate_account_id, tour_package_id,
         pickup_lat, pickup_lng, pickup_address, dropoff_lat, dropoff_lng, dropoff_address,
         passengers, has_pet, pet_details, needs_wheelchair, assistance_animal, notes, scheduled_for,
         est_distance_m, est_duration_s, quote_cents, fare_breakdown, discount_cents, points_redeemed, promo_code,
         payment_method, verify_pin, share_token, women_driver_pref, ndis_number, channel, booked_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35)
       RETURNING *`,
      [tripRef(), input.kind, input.service, scheduled ? 'scheduled' : 'requested', zone.id, userId,
        input.corporate_account_id ?? null, input.tour_package_id ?? null,
        input.pickup.lat, input.pickup.lng, input.pickup.address ?? 'Pinned location',
        input.dropoff.lat, input.dropoff.lng, input.dropoff.address ?? 'Pinned location',
        input.passengers ?? 1, !!input.has_pet, input.pet_details ?? null, !!input.needs_wheelchair,
        !!input.assistance_animal, input.notes ?? null, scheduled,
        r.distance_m, r.duration_s, quote.total_cents, JSON.stringify(quote), quote.discount_cents,
        quote.points_redeemed, promo?.code ?? null, input.payment_method, pin4(), shareToken(),
        !!input.women_driver_pref, input.ndis_number ?? null, input.channel ?? 'app', input.booked_by ?? null], c);

    if (quote.points_redeemed) {
      await c.query('UPDATE users SET loyalty_points = loyalty_points - $2 WHERE id = $1', [userId, quote.points_redeemed]);
      await c.query(`INSERT INTO loyalty_ledger (user_id, points, reason, trip_id) VALUES ($1, $2, 'redeemed_on_trip', $3)`,
        [userId, -quote.points_redeemed, trip.id]);
    }
    if (promo) await c.query('UPDATE promo_codes SET uses = uses + 1 WHERE code = $1', [promo.code]);

    if (input.kind === 'courier' && input.parcel) {
      const p = input.parcel;
      await c.query(
        `INSERT INTO parcels (trip_id, size, weight_kg, description, declared_value_cents, sender_name, sender_phone,
           recipient_name, recipient_phone, instructions, leave_unattended, requires_signature, delivery_pin, prohibited_ack)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [trip.id, p.size, p.weight_kg ?? null, p.description, p.declared_value_cents ?? null, p.sender_name, p.sender_phone,
          p.recipient_name, p.recipient_phone, p.instructions ?? null, !!p.leave_unattended, !!p.requires_signature, pin4(), true]);
    }

    // Payment hold. Booked trips get theirs when they are released to drivers (card holds lapse after about 7 days).
    if (input.payment_method === 'card' && quote.total_cents > 0 && !scheduled) {
      const auth = await placeHold(c, trip);
      if (!auth.ok) throw payError(auth);
      heldRef = auth.ref;
      trip.payment_status = 'authorised';
      trip.payment_ref = auth.ref;
    }
    if (input.payment_method === 'wallet') {
      await c.query('UPDATE users SET wallet_cents = wallet_cents - $2 WHERE id = $1', [userId, quote.total_cents]);
      await c.query(`UPDATE trips SET payment_status = 'authorised', payment_ref = 'wallet' WHERE id = $1`, [trip.id]);
    }

    await event(c, trip.id, scheduled ? 'scheduled' : 'requested', userId, { quote: quote.total_cents });
    return trip;
  }).catch(async (e) => {
    if (heldRef) await pay.cancelHold(heldRef);   // the booking didn't go through: don't leave money held on the card
    throw e;
  }).then(async (trip) => {
    toOps('trip.created', { id: trip.id, ref: trip.ref, status: trip.status });
    if (trip.status === 'requested') await dispatchTrip(trip.id).catch((e) => console.error('dispatch', e));
    if (input.kind === 'courier') {
      const p = await one('SELECT * FROM parcels WHERE trip_id = $1', [trip.id]);
      void sendSmsT(p.recipient_phone, 'parcel_recipient',
        { sender: p.sender_name, ref: trip.ref, url: `${config.publicWebUrl}/track/${trip.share_token}`, pin: p.delivery_pin }, { tripId: trip.id });
    }
    return getTrip(trip.id);
  });
}

export async function event(c: Q, tripId: string, type: string, actorId: string | null, data?: unknown) {
  await c.query('INSERT INTO trip_events (trip_id, type, actor_id, data) VALUES ($1,$2,$3,$4)', [tripId, type, actorId, data ?? null]);
}

// ───────────────────────── Card money on trips ─────────────────────────

export const payError = (r: pay.PayResult) =>
  new ApiError(402, r.code === 'card_required' || r.code === 'cards_not_available' ? r.code : 'payment_failed', r.error ?? 'Your card could not be charged', { reason: r.code });

/** Hold the fare on the rider's card. Each attempt (booking, release, search again) has its own idempotency key. */
async function placeHold(c: Q, t: any): Promise<pay.PayResult> {
  const n = await one<{ n: number }>(`SELECT count(*)::int n FROM payments WHERE trip_id = $1 AND kind = 'authorise'`, [t.id], c);
  const auth = await pay.holdForTrip({ userId: t.rider_id, tripId: t.id, attempt: n!.n + 1, amountCents: t.quote_cents, description: `DingoGo ${t.ref}` });
  if (auth.ok) await c.query(`UPDATE trips SET payment_status = 'authorised', payment_ref = $2 WHERE id = $1`, [t.id, auth.ref]);
  await c.query(`INSERT INTO payments (trip_id, user_id, provider, provider_ref, kind, amount_cents, status) VALUES ($1,$2,$3,$4,'authorise',$5,$6)`,
    [t.id, t.rider_id, auth.provider, auth.ref || null, auth.amount_cents ?? Math.round(t.quote_cents * 1.2), auth.ok ? 'succeeded' : 'failed']);
  return auth;
}

/** Take `amount` for a card trip: capture the hold, or (no hold / it lapsed) charge the saved card. Records the result. */
async function collectCard(c: Q, t: any, amount: number, purpose: 'fare' | 'fee' | 'retry', description: string) {
  const held = t.payment_status === 'authorised' && t.payment_ref && t.payment_ref !== 'wallet' ? t.payment_ref : null;
  let r: pay.PayResult;
  if (purpose === 'retry') {
    const n = await one<{ n: number }>(`SELECT count(*)::int n FROM payments WHERE trip_id = $1 AND kind = 'capture' AND status = 'failed'`, [t.id], c);
    r = await pay.charge({ userId: t.rider_id, amountCents: amount, description, key: `retry-${t.id}-${n!.n}-${amount}`, metadata: { trip_id: t.id, kind: 'retry' } });
  } else {
    r = await pay.collect({ userId: t.rider_id, tripId: t.id, ref: held, amountCents: amount, description, purpose });
  }
  await c.query(`UPDATE trips SET payment_status = $2, payment_ref = coalesce($3, payment_ref) WHERE id = $1`, [t.id, r.ok ? 'captured' : 'failed', r.ok && r.ref ? r.ref : null]);
  await c.query(`INSERT INTO payments (trip_id, user_id, provider, provider_ref, kind, amount_cents, gst_cents, status) VALUES ($1,$2,$3,$4,'capture',$5,$6,$7)`,
    [t.id, t.rider_id, r.provider, r.ref || held, amount, Math.round(amount / 11), r.ok ? 'succeeded' : 'failed']);
  if (!r.ok) {
    await event(c, t.id, 'payment_failed', null, { stage: purpose, cents: amount, reason: r.code ?? null });
    setImmediate(() => {
      toOps('payment.failed', { trip_id: t.id, ref: t.ref, cents: amount, reason: r.code ?? null });
      void send(t.rider_id, 'payment_failed', { ref: t.ref, cents: amount, reason: r.error }, { data: { trip_id: t.id } });
    });
  }
  return r;
}

/** Pay a card trip whose payment failed (rider "Pay now" or staff "Retry charge"), with the rider's current default card. */
export async function retryTripPayment(tripId: string, actor: { id: string; role: string }) {
  return tx(async (c) => {
    const t = await one('SELECT * FROM trips WHERE id = $1 FOR UPDATE', [tripId], c);
    const staff = actor.role === 'admin' || actor.role === 'dispatcher';
    if (!t || (!staff && t.rider_id !== actor.id)) throw notFound('Trip');
    if (t.payment_status !== 'failed' || t.payment_method !== 'card') throw conflict('nothing_to_pay', 'There is nothing to pay on this trip');
    const amount = t.status === 'completed' ? t.final_cents : t.cancel_fee_cents;
    if (!(amount > 0)) throw conflict('nothing_to_pay', 'There is nothing to pay on this trip');
    if (!staff) await pay.requireCardOnFile(t.rider_id);
    const r = await collectCard(c, t, amount, 'retry', `DingoGo ${t.ref}`);
    await event(c, t.id, r.ok ? 'payment_retried' : 'payment_retry_failed', actor.id, { cents: amount, reason: r.code ?? null });
    if (!r.ok) return { ok: false as const, error: r.error, code: r.code };
    return { ok: true as const, payment_status: 'captured' };
  });
}

/** Full trip view including driver/vehicle/parcel. */
export async function getTrip(id: string, c: Q = pool) {
  const t = await one(
    `SELECT t.*,
       CASE WHEN du.id IS NOT NULL THEN json_build_object('id', du.id, 'name', du.name, 'phone', du.phone, 'rating', du.rating_avg,
         'lat', d.lat, 'lng', d.lng, 'heading', d.heading, 'languages', d.languages) END AS driver,
       CASE WHEN v.id IS NOT NULL THEN json_build_object('rego', v.rego, 'make', v.make, 'model', v.model, 'colour', v.colour, 'battery_pct', v.battery_pct,
         'fuel_type', v.fuel_type, 'green', v.fuel_type IN ('electric','plug_in_hybrid','hybrid'), 'is_ev', v.fuel_type = 'electric') END AS vehicle,
       json_build_object('id', ru.id, 'name', ru.name, 'phone', ru.phone, 'rating', ru.rating_avg, 'accessibility', ru.accessibility) AS rider,
       (SELECT count(*)::int FROM trip_offers o WHERE o.trip_id = t.id AND o.status IN ('cancelled','released')) AS driver_releases
     FROM trips t
     JOIN users ru ON ru.id = t.rider_id
     LEFT JOIN users du ON du.id = t.driver_id
     LEFT JOIN drivers d ON d.user_id = t.driver_id
     LEFT JOIN vehicles v ON v.id = t.vehicle_id
     WHERE t.id = $1`, [id], c);
  if (!t) throw notFound('Trip');
  if (t.rider) { t.rider.needs = riderNeeds(t.rider.accessibility, t.kind); delete t.rider.accessibility; }
  if (t.kind === 'courier') t.parcel = await one('SELECT * FROM parcels WHERE trip_id = $1', [id], c);
  return t;
}

/** What the driver needs to know from the rider's accessibility profile (Account → Profile): Deaf or hard of hearing (message,
 *  don't call), blind or low vision (come to the door, say who you are), mobility aid, and a free-text note. Only sent to the driver
 *  offered or on the trip, and to ops. Parcels: the sender isn't travelling, so nothing is sent. Null when nothing is set. */
export function riderNeeds(a: any, kind?: string): { hearing: boolean; vision: boolean; mobility: boolean; notes: string | null } | null {
  if (!a || typeof a !== 'object' || kind === 'courier') return null;
  const notes = typeof a.notes === 'string' && a.notes.trim() ? a.notes.trim().slice(0, 300) : null;
  const n = { hearing: a.hearing === true, vision: a.vision === true, mobility: a.wheelchair === true, notes };
  return n.hearing || n.vision || n.mobility || n.notes ? n : null;
}

/** Strip secrets a viewer shouldn't see. */
export function viewFor(t: any, viewer: { id: string; role: string }) {
  const out = { ...t };
  const isRider = viewer.id === t.rider_id;
  const isDriver = viewer.id === t.driver_id;
  const isOps = viewer.role === 'admin' || viewer.role === 'dispatcher';
  if (!isRider && !isOps) delete out.verify_pin;               // the driver must ASK for the PIN
  if (out.parcel && !isOps) {
    out.parcel = { ...out.parcel };
    delete out.parcel.delivery_pin;                             // only the recipient (via SMS) knows it
  }
  if (!isDriver && !isOps && out.rider) out.rider = { name: out.rider.name };
  // Mask phone numbers between rider and driver — they call through support / in-app relay.
  if (out.driver && !isOps) out.driver = { ...out.driver, phone: undefined };
  if (out.rider && !isOps) out.rider = { ...out.rider, phone: undefined };
  return out;
}

/** Share-trip links stop working SHARE_LINK_HOURS (default 24) after the trip ends: the link holds pickup/drop-off addresses. */
export function shareLinkExpired(t: { status: string; completed_at?: Date | string | null; cancelled_at?: Date | string | null }, now = Date.now()) {
  const ended = t.completed_at ?? (t.status.startsWith('cancelled') || t.status === 'no_drivers' ? t.cancelled_at : null);
  return !!ended && now - new Date(ended).getTime() > config.shareLinkHours * 3600_000;
}

export function canView(t: any, u: { id: string; role: string }) {
  return u.id === t.rider_id || u.id === t.driver_id || u.role === 'admin' || u.role === 'dispatcher';
}

// ───────────────────────── Dispatch ─────────────────────────

/** Find the best eligible driver and send them an offer. Nearest-first with a head start for green (EV/hybrid) cars; range checks for EVs. */
export async function dispatchTrip(tripId: string): Promise<'offered' | 'waiting' | 'no_drivers' | 'skip'> {
  return tx(async (c) => {
    const t = await one('SELECT * FROM trips WHERE id = $1 FOR UPDATE SKIP LOCKED', [tripId], c);
    if (!t || t.status !== 'requested') return 'skip';
    // An offer stays "live" through the accept grace period, so nobody else is offered the trip while a late tap is in flight.
    const pending = await one(`SELECT 1 FROM trip_offers WHERE trip_id = $1 AND status = 'offered' AND expires_at > now() - make_interval(secs => $2)`,
      [tripId, config.dispatch.offerGraceS], c);
    if (pending) return 'waiting';

    // Give up only after maxAttempts real offers, or after the search window (small fleet: cars free up within minutes).
    if (searchOver(t)) {
      await failNoDrivers(c, t);
      return 'no_drivers';
    }

    const candidates = await q(
      `SELECT d.user_id, d.lat, d.lng, v.id AS vehicle_id, v.battery_pct, v.range_km, v.pet_friendly, v.wheelchair_accessible, v.seats, v.fuel_type
       FROM drivers d JOIN vehicles v ON v.id = d.vehicle_id AND v.active AND v.status = 'approved'
       JOIN users du ON du.id = d.user_id AND NOT du.blocked AND du.deleted_at IS NULL   -- blocked/deleted accounts get no offers
       WHERE d.status = 'approved' AND d.online AND d.lat IS NOT NULL
         AND d.last_seen_at > now() - interval '3 minutes'
         AND ($2::boolean = false OR d.accepts_courier)
         AND ($3::boolean = false OR (d.accepts_pets AND v.pet_friendly))
         AND ($4::boolean = false OR v.wheelchair_accessible)
         AND v.seats >= $5
         AND ($6::boolean = false OR d.female_driver)
         AND NOT EXISTS (SELECT 1 FROM trips x WHERE x.driver_id = d.user_id AND x.status IN ('accepted','arrived','in_progress'))
         AND NOT EXISTS (SELECT 1 FROM trip_offers o WHERE o.driver_id = d.user_id AND o.status = 'offered' AND o.expires_at > now() - make_interval(secs => $8))
         -- Never the same driver twice for a trip (includes a driver who cancelled it or had it taken off them).
         AND NOT EXISTS (SELECT 1 FROM trip_offers o WHERE o.driver_id = d.user_id AND o.trip_id = $1)
         -- Drivers only get trips in their own state (accreditation is per state).
         AND d.state = coalesce((SELECT z.state FROM zones z WHERE z.id = $7), 'NT')`,
      [tripId, t.kind === 'courier', t.has_pet, t.needs_wheelchair, t.passengers, t.women_driver_pref, t.zone_id, config.dispatch.offerGraceS], c);

    const pickup = { lat: t.pickup_lat, lng: t.pickup_lng };
    const ranked = candidates
      .map((d) => {
        const toPickup = haversine({ lat: d.lat, lng: d.lng }, pickup) * 1.3;
        // EVs only: remaining range = rated range × battery % × heat derate. Need pickup + trip + return-to-base reserve.
        // Hybrids / plug-in hybrids / petrol / diesel can refuel anywhere, so no range check.
        let rangeOk = true;
        if (isEv(d.fuel_type) && d.range_km != null) {
          const rangeM = (d.range_km * 1000 * (d.battery_pct ?? 100) / 100) * config.dispatch.rangeDerate;
          const needM = toPickup + t.est_distance_m + config.dispatch.reserveKm * 1000;
          rangeOk = rangeM >= needM;
        }
        // Green cars (electric & hybrids) are offered first: their distance counts as greenBonusM shorter.
        const score = toPickup - (isGreen(d.fuel_type) ? config.dispatch.greenBonusM : 0);
        return { ...d, toPickup, rangeOk, score };
      })
      .filter((d) => d.toPickup <= config.dispatch.searchRadiusKm * 1000 && d.rangeOk)
      .sort((a, b) => a.score - b.score);

    const pick = ranked[0];
    if (!pick) return 'waiting'; // nobody free right now — keep searching until the window closes
    await c.query('UPDATE trips SET dispatch_attempts = dispatch_attempts + 1 WHERE id = $1', [tripId]);
    const etaS = Math.round(pick.toPickup / 1000 / 38 * 3600) + 60;
    await c.query(
      `INSERT INTO trip_offers (trip_id, driver_id, expires_at, pickup_eta_s) VALUES ($1, $2, now() + ($3 || ' seconds')::interval, $4)`,
      [tripId, pick.user_id, String(config.dispatch.offerTimeoutS), etaS]);
    const pickupM = Math.round(pick.toPickup);
    await event(c, tripId, 'offered', null, { driver_id: pick.user_id, eta_s: etaS, pickup_m: pickupM });
    const dp = await offerPay(c, t, pick.user_id, pickupM);
    const ru = await one('SELECT accessibility FROM users WHERE id = $1', [t.rider_id], c);
    const offer = {
      trip_id: t.id, ref: t.ref, kind: t.kind, service: t.service,
      pickup: { lat: t.pickup_lat, lng: t.pickup_lng, address: t.pickup_address },
      dropoff: { lat: t.dropoff_lat, lng: t.dropoff_lng, address: t.dropoff_address },
      est_distance_m: t.est_distance_m, est_duration_s: t.est_duration_s, quote_cents: t.quote_cents,
      trip_cents: t.fare_breakdown?.trip_cents ?? null,
      pickup_eta_s: etaS, expires_in_s: config.dispatch.offerTimeoutS, has_pet: t.has_pet,
      pickup_m: pickupM, total_m: pickupM + t.est_distance_m, driver_pay: dp,
      assistance_animal: t.assistance_animal, needs_wheelchair: t.needs_wheelchair, passengers: t.passengers,
      payment_method: t.payment_method, notes: t.notes, rider_needs: riderNeeds(ru?.accessibility, t.kind),
    };
    setImmediate(() => toUser(pick.user_id, 'offer.new', offer));
    return 'offered';
  });
}

/** Has the search for a driver run its course? Booked (scheduled) trips keep looking until the booked time plus the
 *  search window (they are released early, so a plain window would give up before the pickup time) with twice the offers. */
export function searchOver(t: { requested_at: Date | string; scheduled_for?: Date | string | null; dispatch_attempts: number }, now = Date.now()) {
  const windowMs = config.dispatch.searchWindowMin * 60000;
  const booked = t.scheduled_for ? new Date(t.scheduled_for).getTime() : null;
  const until = Math.max(new Date(t.requested_at).getTime() + windowMs, booked != null ? booked + windowMs : 0);
  const maxAttempts = config.dispatch.maxAttempts * (booked != null ? 2 : 1);
  return t.dispatch_attempts >= maxAttempts || now > until;
}

async function failNoDrivers(c: pg.PoolClient, t: any, why: 'search' | 'missed' = 'search') {
  await c.query(`UPDATE trips SET status = 'no_drivers', cancelled_at = now() WHERE id = $1`, [t.id]);
  await c.query(`UPDATE trip_offers SET status = 'expired' WHERE trip_id = $1 AND status = 'offered'`, [t.id]);
  if (t.promo_code) await c.query('UPDATE promo_codes SET uses = greatest(uses - 1, 0) WHERE code = $1', [t.promo_code]);
  await releaseHoldsAndPoints(c, t);
  await event(c, t.id, 'no_drivers', null, why === 'missed' ? { reason: 'Booking was not sent to drivers in time' } : undefined);
  setImmediate(() => {
    toTrip(t.id, 'trip.updated', { id: t.id, status: 'no_drivers' });
    toUser(t.rider_id, 'trip.updated', { id: t.id, ref: t.ref, status: 'no_drivers' });
    toOps('trip.updated', { id: t.id, ref: t.ref, status: 'no_drivers' });
    void send(t.rider_id, 'no_drivers', { ref: t.ref, missed: why === 'missed' }, { trip: t });
  });
}

async function releaseHoldsAndPoints(c: Q, t: any, feeCents = 0) {
  if (t.payment_method === 'card') {
    if (feeCents > 0) {
      // Capture the fee from the hold; a booking cancelled before its hold was placed (tours, hire) is charged on the saved card.
      const r = await collectCard(c, t, feeCents, 'fee', `DingoGo cancellation fee ${t.ref}`);
      // Charged afresh instead of from the hold (it had lapsed or wouldn't capture): let the old hold go.
      if (t.payment_status === 'authorised' && t.payment_ref && r.ref !== t.payment_ref) await pay.cancelHold(t.payment_ref);
    } else if (t.payment_ref && t.payment_status === 'authorised') {
      await pay.cancelHold(t.payment_ref);
      await c.query(`UPDATE trips SET payment_status = 'none' WHERE id = $1`, [t.id]);
    }
  }
  if (t.payment_method === 'wallet' && t.payment_status === 'authorised') {
    await c.query('UPDATE users SET wallet_cents = wallet_cents + $2 WHERE id = $1', [t.rider_id, t.quote_cents - feeCents]);
    await c.query(`UPDATE trips SET payment_status = $2 WHERE id = $1`, [t.id, feeCents ? 'captured' : 'none']);
    if (feeCents > 0) {
      await c.query(`INSERT INTO payments (trip_id, user_id, provider, provider_ref, kind, amount_cents, gst_cents, status)
                     VALUES ($1,$2,'wallet','wallet','capture',$3,$4,'succeeded')`, [t.id, t.rider_id, feeCents, Math.round(feeCents / 11)]);
    }
  }
  if (t.payment_method === 'corporate' && feeCents > 0) {
    // Business / NDIS accounts: the late-cancellation fee goes on the monthly statement.
    await c.query(`UPDATE trips SET payment_status = 'invoiced' WHERE id = $1`, [t.id]);
    await c.query(`INSERT INTO payments (trip_id, user_id, provider, kind, amount_cents, gst_cents, status)
                   VALUES ($1,$2,'corporate','invoice',$3,$4,'pending')`, [t.id, t.rider_id, feeCents, Math.round(feeCents / 11)]);
  }
  if (t.points_redeemed > 0) {
    await c.query('UPDATE users SET loyalty_points = loyalty_points + $2 WHERE id = $1', [t.rider_id, t.points_redeemed]);
    await c.query(`INSERT INTO loyalty_ledger (user_id, points, reason, trip_id) VALUES ($1,$2,'refund_cancelled_trip',$3)`,
      [t.rider_id, t.points_redeemed, t.id]);
  }
}

let ticking = false;
/** Background loop: expire offers, release scheduled trips, watch silent drivers, re-dispatch.
 *  Runs on a timer on a server, and on incoming requests on serverless (several instances may tick at once:
 *  every step is a conditional update or takes its trip with SKIP LOCKED, so running twice is harmless). */
export async function dispatchTick() {
  if (ticking) return;
  ticking = true;
  try {
    const expired = await q(
      `UPDATE trip_offers SET status = 'expired' WHERE status = 'offered' AND expires_at <= now() - make_interval(secs => $1) RETURNING trip_id, driver_id`,
      [config.dispatch.offerGraceS]);
    for (const e of expired) toUser(e.driver_id, 'offer.expired', { trip_id: e.trip_id });

    // Bookings released very late (nobody used the apps to run the dispatcher): don't send a driver to a pickup long gone.
    const missed = await q(`SELECT id FROM trips WHERE status = 'scheduled' AND scheduled_for < now() - make_interval(mins => $1)`,
      [config.dispatch.scheduledMissedMin]);
    for (const m of missed) {
      await tx(async (c) => {
        const t = await one(`SELECT * FROM trips WHERE id = $1 FOR UPDATE SKIP LOCKED`, [m.id], c);
        if (t?.status === 'scheduled') await failNoDrivers(c, t, 'missed');
      }).catch((e) => console.error('missed booking', e));
    }

    const due = await q(
      `SELECT id FROM trips WHERE status = 'scheduled' AND scheduled_for <= now() + make_interval(mins => $1)
         AND scheduled_for >= now() - make_interval(mins => $2) ORDER BY scheduled_for LIMIT 50`,
      [config.dispatch.scheduledLeadMin, config.dispatch.scheduledMissedMin]);
    for (const d of due) await releaseBooking(d.id).catch((e) => console.error('release booking', e));

    await watchDrivers().catch((e) => console.error('watch drivers', e));
    await autoEarningsFloor().catch((e) => console.error('earnings floor', e));
    await sendDocExpiryReminders().catch((e) => console.error('document reminders', e));

    const open = await q(`SELECT id FROM trips WHERE status = 'requested' ORDER BY requested_at LIMIT 50`);
    for (const t of open) await dispatchTrip(t.id).catch((e) => console.error('dispatch', e));
  } finally {
    ticking = false;
  }
}

/** A booked trip is due: hold the fare on the card now (not at booking: holds lapse after about 7 days), then search.
 *  If the card is declined the booking is cancelled (no charge, points and promo back) and the rider and ops are told. */
async function releaseBooking(tripId: string) {
  const out = await tx(async (c) => {
    const t = await one(`SELECT * FROM trips WHERE id = $1 FOR UPDATE SKIP LOCKED`, [tripId], c);
    if (!t || t.status !== 'scheduled') return null;
    if (t.payment_method === 'card' && t.quote_cents > 0 && t.payment_status !== 'authorised') {
      const auth = await placeHold(c, t);
      if (!auth.ok) {
        await c.query(`UPDATE trips SET status = 'cancelled_admin', cancelled_at = now(), cancel_reason = $2 WHERE id = $1`,
          [t.id, 'Card declined when the booking was due']);
        if (t.promo_code) await c.query('UPDATE promo_codes SET uses = greatest(uses - 1, 0) WHERE code = $1', [t.promo_code]);
        await releaseHoldsAndPoints(c, { ...t, payment_status: 'none' });
        await event(c, t.id, 'payment_failed', null, { stage: 'release', reason: auth.code ?? null });
        return { t, failed: auth };
      }
    }
    await c.query(`UPDATE trips SET status = 'requested', requested_at = now() WHERE id = $1`, [t.id]);
    return { t, failed: null };
  });
  if (!out) return;
  const { t, failed } = out;
  if (failed) {
    toTrip(t.id, 'trip.updated', { id: t.id, status: 'cancelled_admin' });
    toUser(t.rider_id, 'trip.updated', { id: t.id, ref: t.ref, status: 'cancelled_admin' });
    toOps('payment.failed', { trip_id: t.id, ref: t.ref, stage: 'release', reason: failed.code ?? null });
    void send(t.rider_id, 'booking_card_declined', { ref: t.ref, reason: failed.error }, { trip: t });
    return;
  }
  toOps('trip.updated', { id: t.id, ref: t.ref, status: 'requested' });
  void send(t.rider_id, 'booking_released', { ref: t.ref }, { trip: t });
}

/** Drivers who have gone quiet. A live trip whose driver has sent nothing for a while is flagged to ops once per silence
 *  (and, if switched on, an accepted trip is given to another driver). Online drivers with no signal for a long time and
 *  no trip are set offline so the live map and driver counts stay true. */
async function watchDrivers() {
  const alertMin = config.dispatch.driverSilentAlertMin;
  if (alertMin > 0) {
    const silent = await q(
      `INSERT INTO trip_events (trip_id, type, actor_id, data)
       SELECT t.id, 'driver_silent', NULL, json_build_object('driver_id', t.driver_id, 'last_seen_at', d.last_seen_at)
       FROM trips t JOIN drivers d ON d.user_id = t.driver_id
       WHERE t.status IN ('accepted','arrived','in_progress')
         AND greatest(d.last_seen_at, t.accepted_at) < now() - make_interval(mins => $1)
         AND NOT EXISTS (SELECT 1 FROM trip_events e WHERE e.trip_id = t.id AND e.type = 'driver_silent'
                           AND e.at > greatest(d.last_seen_at, t.accepted_at))
       RETURNING trip_id, data`, [alertMin]);
    for (const e of silent) {
      const t = await one('SELECT ref, status FROM trips WHERE id = $1', [e.trip_id]);
      toOps('dispatch.driver_silent', { trip_id: e.trip_id, ref: t?.ref, status: t?.status, driver_id: e.data.driver_id, last_seen_at: e.data.last_seen_at });
    }
  }

  const reassignMin = config.dispatch.driverSilentReassignMin;
  if (reassignMin > 0) {
    const gone = await q(
      `SELECT t.id FROM trips t JOIN drivers d ON d.user_id = t.driver_id
       WHERE t.status = 'accepted' AND greatest(d.last_seen_at, t.accepted_at) < now() - make_interval(mins => $1)`, [reassignMin]);
    for (const g of gone) {
      await reassignTrip(g.id, { by: 'auto', actorId: null, reason: 'lost_contact', note: 'No signal from the driver' })
        .catch((e) => { if (!(e instanceof ApiError)) console.error('auto reassign', e); });
    }
  }

  const staleMin = config.dispatch.driverStaleOfflineMin;
  if (staleMin > 0) {
    const stale = await q(
      `UPDATE drivers d SET online = false
       WHERE d.online AND d.last_seen_at < now() - make_interval(mins => $1)
         AND NOT EXISTS (SELECT 1 FROM trips x WHERE x.driver_id = d.user_id AND x.status IN ('accepted','arrived','in_progress'))
       RETURNING user_id`, [staleMin]);
    for (const d of stale) {
      await withdrawOffers(d.user_id);
      toOps('driver.status', { driver_id: d.user_id, online: false, reason: 'no_signal' });
      void send(d.user_id, 'set_offline', { minutes: staleMin }, { data: {} });
    }
  }
}

/** A driver who can no longer take offers (went offline, blocked, suspended): withdraw their open offer and
 *  offer the trip to the next driver straight away instead of waiting for it to time out. */
export async function withdrawOffers(driverId: string) {
  const r = await q(`UPDATE trip_offers SET status = 'expired' WHERE driver_id = $1 AND status = 'offered' RETURNING trip_id`, [driverId]);
  for (const o of r) {
    await event(pool, o.trip_id, 'offer_withdrawn', driverId, { driver_id: driverId });
    toUser(driverId, 'offer.expired', { trip_id: o.trip_id });
    await dispatchTrip(o.trip_id).catch((e) => console.error('dispatch', e));
  }
  return r.length;
}

/** Ops "search again": restart the search for a trip still looking, or bring back one that found no driver.
 *  A "no drivers" trip had its card hold, wallet credit, points and promo released, so they are taken again first
 *  (otherwise the trip would be free). The search window restarts from now. */
export async function redispatchTrip(tripId: string, actorId: string) {
  await tx(async (c) => {
    const t = await one('SELECT * FROM trips WHERE id = $1 FOR UPDATE', [tripId], c);
    if (!t) throw notFound('Trip');
    if (t.status === 'requested') {
      await c.query(`UPDATE trips SET dispatch_attempts = 0, requested_at = now() WHERE id = $1`, [tripId]);
      await event(c, tripId, 'redispatched', actorId);
      return;
    }
    if (t.status !== 'no_drivers') throw conflict('bad_state', `Can't search again for a trip that is ${t.status}`);
    if (t.points_redeemed > 0) {
      const u = await one('UPDATE users SET loyalty_points = loyalty_points - $2 WHERE id = $1 AND loyalty_points >= $2 RETURNING id', [t.rider_id, t.points_redeemed], c);
      if (!u) throw conflict('points_spent', 'The rider has since used the Dingo Points on this trip. Book it again instead.');
      await c.query(`INSERT INTO loyalty_ledger (user_id, points, reason, trip_id) VALUES ($1, $2, 'redeemed_on_trip', $3)`, [t.rider_id, -t.points_redeemed, t.id]);
    }
    if (t.payment_method === 'wallet') {
      const u = await one('UPDATE users SET wallet_cents = wallet_cents - $2 WHERE id = $1 AND wallet_cents >= $2 RETURNING id', [t.rider_id, t.quote_cents], c);
      if (!u) throw conflict('wallet_insufficient', 'The rider no longer has enough DingoGo credit for this trip');
      await c.query(`UPDATE trips SET payment_status = 'authorised', payment_ref = 'wallet' WHERE id = $1`, [t.id]);
    }
    if (t.payment_method === 'card' && t.quote_cents > 0) {
      const auth = await placeHold(c, t);
      if (!auth.ok) throw payError(auth);
    }
    if (t.promo_code) await c.query('UPDATE promo_codes SET uses = uses + 1 WHERE code = $1', [t.promo_code]);
    await c.query(`UPDATE trips SET status = 'requested', dispatch_attempts = 0, requested_at = now(), cancelled_at = NULL WHERE id = $1`, [tripId]);
    await event(c, tripId, 'redispatched', actorId);
  });
  toOps('trip.updated', { id: tripId, status: 'requested' });
  return dispatchTrip(tripId);
}

// ───────────────────────── Driver actions ─────────────────────────

export async function acceptOffer(driverId: string, tripId: string) {
  const out = await tx(async (c) => {
    // Lock the trip first, then the offer: the same order as dispatch and cancel, so they can't deadlock each other.
    const t = await one('SELECT * FROM trips WHERE id = $1 FOR UPDATE', [tripId], c);
    // Expiry on the database clock (the API and DB clocks can differ), with a short grace for a tap at the last second.
    const offer = await one(
      `SELECT *, expires_at > now() - make_interval(secs => $3) AS live FROM trip_offers WHERE trip_id = $1 AND driver_id = $2 FOR UPDATE`,
      [tripId, driverId, config.dispatch.offerGraceS], c);
    if (!t || !offer || offer.status !== 'offered' || !offer.live) {
      throw conflict('offer_expired', 'This request is no longer available');
    }
    if (t.status !== 'requested') throw conflict('trip_unavailable', 'Trip is no longer available');
    const d = await one('SELECT vehicle_id, online FROM drivers WHERE user_id = $1', [driverId], c);
    if (!d?.online) throw conflict('driver_offline', 'Go online to accept trips');
    const busy = await one(`SELECT 1 FROM trips WHERE driver_id = $1 AND status IN ('accepted','arrived','in_progress')`, [driverId], c);
    if (busy) throw conflict('on_trip', 'Finish your current trip first');
    await c.query(`UPDATE trip_offers SET status = 'accepted' WHERE trip_id = $1 AND driver_id = $2`, [tripId, driverId]);
    await c.query(`UPDATE trips SET status = 'accepted', driver_id = $2, vehicle_id = $3, accepted_at = now() WHERE id = $1`,
      [tripId, driverId, d.vehicle_id]);
    // Pay is fixed now, as shown on the offer: service fee rate for this car and pickup pay for the distance offered.
    const pickupM = await offeredPickupM(c, tripId, driverId);
    const dp = await offerPay(c, t, driverId, pickupM);
    await event(c, tripId, 'accepted', driverId, { eta_s: offer.pickup_eta_s, pickup_m: pickupM, pay: dp });
    return { t, eta: offer.pickup_eta_s };
  });
  const trip = await getTrip(tripId);
  broadcast(trip);
  void send(trip.rider_id, 'driver_on_way', { again: trip.driver_releases > 0, driver: trip.driver.name, colour: trip.vehicle.colour, make: trip.vehicle.make,
    model: trip.vehicle.model, rego: trip.vehicle.rego, eta_min: Math.ceil(out.eta / 60) }, { trip });
  return trip;
}

/** Distance to the pickup when the trip was offered to this driver (recorded on the offer event). */
async function offeredPickupM(c: Q, tripId: string, driverId: string): Promise<number | null> {
  const e = await one(
    `SELECT (data->>'pickup_m')::int AS m FROM trip_events WHERE trip_id = $1 AND type = 'offered' AND data->>'driver_id' = $2 ORDER BY at DESC, id DESC LIMIT 1`,
    [tripId, driverId], c);
  return e?.m ?? null;
}

/** Pay fixed at accept for the trip's current driver (null for trips accepted before Round 4). */
async function acceptedPay(c: Q, tripId: string, driverId: string): Promise<DriverPay | null> {
  const e = await one(
    `SELECT data->'pay' AS pay FROM trip_events WHERE trip_id = $1 AND type = 'accepted' AND actor_id = $2 ORDER BY at DESC, id DESC LIMIT 1`,
    [tripId, driverId], c);
  return e?.pay ?? null;
}

/** Driver cancel reasons that are about the rider or the load: the trip ends. Any other reason (car trouble, something
 *  else) is the driver's side, so the rider keeps their booking and the trip goes to the next driver. */
export const RIDER_SIDE_CANCEL_REASONS = ['rider_no_show', 'rider_requested', 'unsafe', 'parcel_prohibited'] as const;

type ReleaseBy = { by: 'driver' | 'ops' | 'auto'; actorId: string | null; reason: string; note?: string };

/** Take an accepted (not yet started) trip off its driver and put it back into the search. Caller holds the trip lock.
 *  Returns false when the trip has already been re-offered the maximum number of times (driver or automatic releases). */
async function releaseTrip(c: pg.PoolClient, t: any, r: ReleaseBy) {
  const driverId = t.driver_id;
  const prior = (await one<{ n: number }>(
    `SELECT count(*)::int n FROM trip_offers WHERE trip_id = $1 AND status IN ('cancelled','released')`, [t.id], c))!.n;
  if (r.by !== 'ops' && prior >= config.dispatch.maxReoffers) return false;
  // The driver's own cancellation counts against them; ops taking a trip off a driver (e.g. lost signal) does not.
  const fault = r.by === 'driver';
  await c.query(`UPDATE trip_offers SET status = $3 WHERE trip_id = $1 AND driver_id = $2`, [t.id, driverId, fault ? 'cancelled' : 'released']);
  await c.query(
    `UPDATE trips SET status = 'requested', driver_id = NULL, vehicle_id = NULL, accepted_at = NULL, arrived_at = NULL,
       requested_at = now(), dispatch_attempts = 0 WHERE id = $1`, [t.id]);
  await event(c, t.id, 'driver_released', r.actorId, { driver_id: driverId, by: r.by, reason: r.note ? `${r.reason}: ${r.note}` : r.reason });
  if (fault) {
    await recordDriverCancel(c, t, driverId, r.reason);
    if (t.assistance_animal) {
      await c.query(`INSERT INTO compliance_flags (kind, driver_id, trip_id, detail) VALUES ('assistance_animal_refusal', $1, $2, $3)`,
        [driverId, t.id, `Driver cancelled a trip with an assistance animal. Reason: ${r.reason}`]);
    }
  }
  return true;
}

/** A driver cancelled an accepted trip for their own reasons: marked on their offer (acceptance record) and,
 *  at DRIVER_CANCEL_FLAG_COUNT in 7 days, a compliance flag for ops to review (one open flag at a time). */
async function recordDriverCancel(c: pg.PoolClient, t: any, driverId: string, reason: string) {
  await c.query(`UPDATE trip_offers SET status = 'cancelled' WHERE trip_id = $1 AND driver_id = $2`, [t.id, driverId]);
  const n = (await one<{ n: number }>(
    `SELECT count(*)::int n FROM trip_offers WHERE driver_id = $1 AND status = 'cancelled' AND offered_at > now() - interval '7 days'`, [driverId], c))!.n;
  if (n < config.dispatch.driverCancelFlagCount) return;
  const flagged = await one(
    `INSERT INTO compliance_flags (kind, driver_id, trip_id, detail)
     SELECT 'repeat_cancellation', $1::uuid, $2::uuid, $3
     WHERE NOT EXISTS (SELECT 1 FROM compliance_flags WHERE driver_id = $1 AND kind = 'repeat_cancellation' AND status = 'open')
     RETURNING id`,
    [driverId, t.id, `${n} trips cancelled after accepting in the last 7 days (latest ${t.ref}: ${reason})`], c);
  if (flagged) setImmediate(() => toOps('compliance.flag', { kind: 'repeat_cancellation', trip_id: t.id, driver_id: driverId }));
}

/** After a release has committed: tell everyone and find the next driver. */
async function afterRelease(t: any, driverId: string, r: ReleaseBy) {
  const slim = { id: t.id, ref: t.ref, status: 'requested' };
  toTrip(t.id, 'trip.updated', slim);
  toUser(t.rider_id, 'trip.updated', slim);
  toUser(driverId, 'trip.updated', { ...slim, released: true });
  toOps('trip.updated', slim);
  void send(t.rider_id, 'finding_another_driver', { ref: t.ref }, { trip: t });
  if (r.by !== 'driver') void send(driverId, 'trip_given_away', { ref: t.ref }, { data: { trip_id: t.id } });
  await dispatchTrip(t.id).catch((e) => console.error('dispatch', e));
}

/** Ops "give to another driver" (or the automatic lost-signal check): the trip goes back to the search. */
export async function reassignTrip(tripId: string, r: ReleaseBy) {
  const out = await tx(async (c) => {
    const t = await one('SELECT * FROM trips WHERE id = $1 FOR UPDATE', [tripId], c);
    if (!t) throw notFound('Trip');
    if (!['accepted', 'arrived'].includes(t.status) || !t.driver_id) {
      throw conflict('bad_state', t.status === 'in_progress' ? 'The trip has started — it can only be finished or handled by support' : `Trip is ${t.status}`);
    }
    if (!(await releaseTrip(c, t, r))) throw conflict('reoffer_limit', 'This trip has already been re-offered the maximum number of times');
    return t;
  });
  await afterRelease(out, out.driver_id, r);
  return getTrip(tripId);
}

export async function declineOffer(driverId: string, tripId: string) {
  const r = await q(`UPDATE trip_offers SET status = 'declined' WHERE trip_id = $1 AND driver_id = $2 AND status = 'offered' RETURNING 1`, [tripId, driverId]);
  // Only an offer actually made to this driver: otherwise no event, flag or re-dispatch on someone else's trip.
  if (!r.length) return { ok: true };
  await flagAssistanceAnimal(tripId, driverId, 'declined offer');
  await event(pool, tripId, 'declined', driverId);
  await dispatchTrip(tripId).catch((e) => console.error('dispatch', e));
  return { ok: true };
}

function broadcast(trip: any) {
  const slim = { id: trip.id, ref: trip.ref, status: trip.status };
  toTrip(trip.id, 'trip.updated', slim);
  toUser(trip.rider_id, 'trip.updated', slim);
  if (trip.driver_id) toUser(trip.driver_id, 'trip.updated', slim);
  toOps('trip.updated', slim);
}

async function driverTrip(c: Q, driverId: string, tripId: string) {
  const t = await one('SELECT * FROM trips WHERE id = $1 FOR UPDATE', [tripId], c);
  if (!t) throw notFound('Trip');
  if (t.driver_id !== driverId) throw forbidden('Not your trip');
  return t;
}

/** A trip action sent again by the driver app (queued while there was no signal, or the reply was lost). `key` is the app's
 *  Idempotency-Key for the tap; `clientAt` is when the driver tapped. */
export interface Replay { key?: string | null; clientAt?: string | null }
const LATER: Record<string, string[]> = {
  arrived: ['arrived', 'in_progress', 'completed'],
  started: ['in_progress', 'completed'],
  completed: ['completed'],
};
/** True when this tap has already been applied: same key recorded on the event, or (with a key) the trip is already at or past
 *  the step, e.g. the first send got through but the reply was lost. Without a key the old strict behaviour stays. */
async function alreadyDone(c: Q, t: any, type: 'arrived' | 'started' | 'completed', r: Replay) {
  if (!r.key) return false;
  const seen = await one(`SELECT 1 FROM trip_events WHERE trip_id = $1 AND type = $2 AND data->>'idem' = $3 LIMIT 1`, [t.id, type, r.key], c);
  return !!seen || LATER[type].includes(t.status);
}
/** Late replays keep the time the driver actually tapped: never before the previous step, never in the future, at most
 *  REPLAY_MAX_MIN old (so a stuck phone can't rewrite history). Live taps use the server clock. */
const REPLAY_MAX_MIN = 15;
const tapTime = (prevCol: string, r: Replay) => r.key && r.clientAt
  ? `least(now(), greatest(${prevCol}, now() - interval '${REPLAY_MAX_MIN} minutes', $2::timestamptz))` : 'now()';
const tapArg = (r: Replay) => (r.key && r.clientAt ? [r.clientAt] : []);
const idemData = (r: Replay, data?: Record<string, unknown>) => (r.key ? { ...(data ?? {}), idem: r.key, ...(r.clientAt ? { client_at: r.clientAt } : {}) } : data);

export async function markArrived(driverId: string, tripId: string, r: Replay = {}) {
  const changed = await tx(async (c) => {
    const t = await driverTrip(c, driverId, tripId);
    if (await alreadyDone(c, t, 'arrived', r)) return false;
    if (t.status !== 'accepted') throw conflict('bad_state', `Cannot arrive from ${t.status}`);
    await c.query(`UPDATE trips SET status = 'arrived', arrived_at = ${tapTime('accepted_at', r)} WHERE id = $1`, [tripId, ...tapArg(r)]);
    await event(c, tripId, 'arrived', driverId, idemData(r));
    return true;
  });
  const trip = await getTrip(tripId);
  if (!changed) return trip;
  broadcast(trip);
  void send(trip.rider_id, 'driver_here', { ride: trip.kind === 'ride', rego: trip.vehicle.rego, pin: trip.verify_pin, ref: trip.ref }, { trip });
  return trip;
}

export async function startTrip(driverId: string, tripId: string, pin?: string, r: Replay = {}) {
  const changed = await tx(async (c) => {
    const t = await driverTrip(c, driverId, tripId);
    if (await alreadyDone(c, t, 'started', r)) return false;
    if (t.status !== 'arrived') throw conflict('bad_state', `Cannot start from ${t.status}`);
    // Ride: rider shows the 4-digit PIN so they know it's the right car. Courier: pickup is confirmed by scanning/handover.
    if (t.kind === 'ride' && pin !== t.verify_pin) throw bad('pin_mismatch', 'PIN does not match — check you have the right passenger');
    await c.query(`UPDATE trips SET status = 'in_progress', started_at = ${tapTime('arrived_at', r)} WHERE id = $1`, [tripId, ...tapArg(r)]);
    if (t.kind === 'courier') await c.query('UPDATE parcels SET picked_up_at = now() WHERE trip_id = $1', [tripId]);
    await event(c, tripId, 'started', driverId, idemData(r));
    return true;
  });
  const trip = await getTrip(tripId);
  if (changed) broadcast(trip);
  return trip;
}

export interface CompleteInput {
  actual_distance_m?: number;
  delivery_pin?: string;
  pod_photo_url?: string;
  pod_signature?: string;
  pod_received_by?: string;
  lat?: number; lng?: number;
}

/** Wrong delivery PINs allowed per parcel before the PIN stops working (stops a driver guessing 0000–9999). */
export const DELIVERY_PIN_MAX_TRIES = 5;

export async function completeTrip(driverId: string, tripId: string, input: CompleteInput, r: Replay = {}) {
  const fails = input.delivery_pin
    ? (await one<{ n: number }>(`SELECT count(*)::int n FROM trip_events WHERE trip_id = $1 AND type = 'pod_pin_failed'`, [tripId]))!.n : 0;
  const pinLocked = fails >= DELIVERY_PIN_MAX_TRIES;
  const result = await tx(async (c) => {
    const t = await driverTrip(c, driverId, tripId);
    if (await alreadyDone(c, t, 'completed', r)) return null;
    if (t.status !== 'in_progress') throw conflict('bad_state', `Cannot complete from ${t.status}`);

    if (t.kind === 'courier') {
      const p = await one('SELECT * FROM parcels WHERE trip_id = $1', [tripId], c);
      const pinOk = !pinLocked && !!input.delivery_pin && input.delivery_pin === p.delivery_pin;
      const unattendedOk = p.leave_unattended && input.pod_photo_url;
      const signatureOk = input.pod_signature && input.pod_received_by;
      if (p.requires_signature && !signatureOk) throw bad('signature_required', 'This parcel needs a signature and the receiver’s name');
      if (!pinOk && !unattendedOk && !signatureOk) {
        if (input.delivery_pin && pinLocked) throw new ApiError(429, 'pin_locked', 'Too many wrong PINs. Get a signature and the receiver’s name, or call DingoGo.');
        if (input.delivery_pin) throw bad('pin_mismatch', 'That delivery PIN is wrong. Check it with the receiver.');
        throw bad('pod_required', 'Enter the recipient’s delivery PIN, capture a signature, or (if allowed) a photo');
      }
      await c.query(
        `UPDATE parcels SET delivered_at = now(), pod_photo_url = $2, pod_signature = $3, pod_received_by = $4, pod_lat = $5, pod_lng = $6 WHERE trip_id = $1`,
        [tripId, input.pod_photo_url ?? null, input.pod_signature ?? null, input.pod_received_by ?? null, input.lat ?? null, input.lng ?? null]);
    }

    // Upfront pricing: rider pays the quote unless the route grew > 25%, then re-meter (capped at +20%).
    let final = t.quote_cents;
    const actualM = input.actual_distance_m ?? null;
    if (actualM && actualM > t.est_distance_m * 1.25 && t.service !== 'tour') {
      const rule = await loadRule(t.service, c);
      const breakdown = t.fare_breakdown;
      const perM = rule.per_km_cents / 1000;
      const extra = Math.round((actualM - t.est_distance_m) * perM);
      final = Math.min(t.quote_cents + extra, Math.round(t.quote_cents * 1.2));
      breakdown.lines.push({ label: 'Route change adjustment', cents: final - t.quote_cents });
      await c.query('UPDATE trips SET fare_breakdown = $2 WHERE id = $1', [tripId, JSON.stringify(breakdown)]);
    }

    const doneAt = r.key && r.clientAt ? `least(now(), greatest(started_at, now() - interval '${REPLAY_MAX_MIN} minutes', $4::timestamptz))` : 'now()';
    await c.query(
      `UPDATE trips SET status = 'completed', completed_at = ${doneAt}, final_cents = $2, actual_distance_m = $3 WHERE id = $1`,
      [tripId, final, actualM, ...tapArg(r)]);
    await event(c, tripId, 'completed', driverId, idemData(r, { final_cents: final }));
    await settle(c, { ...t, final_cents: final });
    return t;
  }).catch(async (e) => {
    // Recorded outside the (rolled-back) transaction so the try limit holds.
    if (e instanceof ApiError && e.code === 'pin_mismatch') await event(pool, tripId, 'pod_pin_failed', driverId);
    throw e;
  });
  const trip = await getTrip(tripId);
  if (!result) return trip; // a replay of a completion already recorded: nothing more to send
  broadcast(trip);
  void send(trip.rider_id, 'trip_done', { ref: trip.ref, courier: trip.kind === 'courier', cents: trip.final_cents }, { trip });
  if (trip.kind === 'courier' && trip.parcel) {
    void sendSmsT(trip.parcel.sender_phone, 'parcel_delivered_sender', { ref: trip.ref, to: trip.parcel.pod_received_by || trip.parcel.recipient_name }, { tripId: trip.id });
  }
  void result;
  return trip;
}

const FEE_NOTE: Record<string, string> = { green: ' (electric/hybrid rate)', own_car: ' (own-car rate)' };

/** Money movement on completion: capture payment, driver ledger, loyalty, referral. */
async function settle(c: pg.PoolClient, t: any) {
  const amount = t.final_cents;
  const gst = Math.round(amount / 11);

  if (t.payment_method === 'card') {
    // Capture the hold (or charge the saved card if it lapsed or was never placed). A failure leaves the trip "failed" to pay
    // (rider "Pay now", ops "Retry charge"); the driver is paid either way.
    if (amount > 0) await collectCard(c, t, amount, 'fare', `DingoGo ${t.ref}`);
  } else if (t.payment_method === 'cash') {
    await c.query(`UPDATE trips SET payment_status = 'cash_collected' WHERE id = $1`, [t.id]);
    await c.query(`INSERT INTO payments (trip_id, user_id, provider, kind, amount_cents, gst_cents, status)
                   VALUES ($1,$2,'cash','cash',$3,$4,'succeeded')`, [t.id, t.rider_id, amount, gst]);
    // Driver holds the cash, so it is netted against what DingoGo owes them.
    await c.query(`INSERT INTO driver_ledger (driver_id, trip_id, kind, amount_cents, note) VALUES ($1,$2,'cash_collected',$3,'Cash fare held by driver')`,
      [t.driver_id, t.id, -amount]);
  } else if (t.payment_method === 'corporate') {
    await c.query(`UPDATE trips SET payment_status = 'invoiced' WHERE id = $1`, [t.id]);
    await c.query(`INSERT INTO payments (trip_id, user_id, provider, kind, amount_cents, gst_cents, status)
                   VALUES ($1,$2,'corporate','invoice',$3,$4,'pending')`, [t.id, t.rider_id, amount, gst]);
  } else if (t.payment_method === 'wallet') {
    const refundDiff = t.quote_cents - amount;
    if (refundDiff !== 0) await c.query('UPDATE users SET wallet_cents = wallet_cents + $2 WHERE id = $1', [t.rider_id, refundDiff]);
    await c.query(`UPDATE trips SET payment_status = 'captured' WHERE id = $1`, [t.id]);
    await c.query(`INSERT INTO payments (trip_id, user_id, provider, kind, amount_cents, gst_cents, status)
                   VALUES ($1,$2,'wallet','capture',$3,$4,'succeeded')`, [t.id, t.rider_id, amount, gst]);
  }

  // Driver earnings: trip fare (before rider discounts — DingoGo funds promos/points; excludes booking fee & levy) minus the
  // service fee, plus pickup pay and fuel surcharge (no fee on either). Rate and pickup pay as fixed when the driver accepted.
  const adj = (t.fare_breakdown.lines ?? []).find((l: any) => l.label === 'Route change adjustment')?.cents ?? 0;
  const gross = (t.fare_breakdown.trip_cents ?? amount) + adj;
  const fixed = await acceptedPay(c, t.id, t.driver_id);
  const dp = fixed ?? await offerPay(c, t, t.driver_id, null);
  const pct = Number(dp.fee_pct);
  const commission = Math.round((gross * pct) / 100);
  await c.query(`INSERT INTO driver_ledger (driver_id, trip_id, kind, amount_cents, note) VALUES ($1,$2,'fare',$3,$4), ($1,$2,'commission',$5,$6)`,
    [t.driver_id, t.id, gross, `Fare ${t.ref}`, -commission, `DingoGo service fee ${pct}%${FEE_NOTE[dp.fee_basis] ?? ''}`]);
  if (Number(dp.pickup_pay_cents) > 0) {
    await c.query(`INSERT INTO driver_ledger (driver_id, trip_id, kind, amount_cents, note) VALUES ($1,$2,'pickup_pay',$3,$4)`,
      [t.driver_id, t.id, Number(dp.pickup_pay_cents), `Pickup ${dp.pickup_km} km, ${dp.pickup_paid_km} km paid (${t.ref})`]);
  }
  const fuel = Number(t.fare_breakdown.fuel_surcharge_cents ?? 0);
  if (fuel > 0) {
    await c.query(`INSERT INTO driver_ledger (driver_id, trip_id, kind, amount_cents, note) VALUES ($1,$2,'fuel_surcharge',$3,$4)`,
      [t.driver_id, t.id, fuel, `Fuel surcharge ${t.ref}, 100% to you`]);
  }

  // Loyalty points on what the rider actually paid
  const pts = Math.floor((amount / 100) * config.loyalty.pointsPerDollar);
  if (pts > 0) {
    await c.query('UPDATE users SET loyalty_points = loyalty_points + $2 WHERE id = $1', [t.rider_id, pts]);
    await c.query(`INSERT INTO loyalty_ledger (user_id, points, reason, trip_id) VALUES ($1,$2,'trip_earned',$3)`, [t.rider_id, pts, t.id]);
  }

  // Subscription: count free deliveries
  if (t.kind === 'courier' && (t.fare_breakdown.lines ?? []).some((l: any) => l.label.startsWith('Free delivery'))) {
    await c.query('UPDATE subscriptions SET deliveries_used = deliveries_used + 1 WHERE user_id = $1', [t.rider_id]);
  }

  // Referral: both get bonus after referee's first completed trip
  const ref = await one(`SELECT * FROM referrals WHERE referee_id = $1 AND status = 'pending'`, [t.rider_id], c);
  if (ref) {
    const bonus = config.loyalty.referralBonusPoints;
    await c.query(`UPDATE referrals SET status = 'rewarded', rewarded_at = now() WHERE referee_id = $1`, [t.rider_id]);
    await c.query('UPDATE users SET loyalty_points = loyalty_points + $2 WHERE id = ANY($1)', [[ref.referrer_id, ref.referee_id], bonus]);
    await c.query(`INSERT INTO loyalty_ledger (user_id, points, reason) VALUES ($1,$3,'referral_bonus'), ($2,$3,'referral_bonus')`,
      [ref.referrer_id, ref.referee_id, bonus]);
    setImmediate(() => void send(ref.referrer_id, 'referral_bonus', { points: bonus }, { data: {} }));
  }
}

export async function addTip(riderId: string, tripId: string, cents: number) {
  if (cents <= 0 || cents > 10000) throw bad('invalid_tip');
  return tx(async (c) => {
    const t = await one('SELECT * FROM trips WHERE id = $1 FOR UPDATE', [tripId], c);
    if (!t || t.rider_id !== riderId) throw notFound('Trip');
    if (t.status !== 'completed') throw conflict('bad_state', 'You can tip after the trip');
    if (t.tip_cents > 0) throw conflict('already_tipped');
    if (!t.driver_id) throw conflict('bad_state', 'No driver to tip');
    let provider: string, ref: string;
    if (t.payment_method === 'wallet') {
      // Paid with DingoGo credit (e.g. prepaid vouchers, no bank card): the tip comes from credit too.
      const u = await one('UPDATE users SET wallet_cents = wallet_cents - $2 WHERE id = $1 AND wallet_cents >= $2 RETURNING wallet_cents', [riderId, cents], c);
      if (!u) throw new ApiError(402, 'wallet_insufficient', 'Not enough DingoGo credit for this tip');
      provider = 'wallet'; ref = 'wallet';
    } else {
      // Its own PaymentIntent, captured at once (refunds of the tip go back to it). One tip per trip: the key makes a retry a no-op.
      await pay.requireCardOnFile(riderId);
      const r = await pay.charge({ userId: riderId, amountCents: cents, description: `DingoGo tip ${t.ref}`, key: `tip-${tripId}-${cents}`, metadata: { trip_id: tripId, kind: 'tip' } });
      if (!r.ok) throw payError(r);
      provider = r.provider; ref = r.ref;
    }
    await c.query('UPDATE trips SET tip_cents = $2 WHERE id = $1', [tripId, cents]);
    await c.query(`INSERT INTO payments (trip_id, user_id, provider, provider_ref, kind, amount_cents, status) VALUES ($1,$2,$3,$4,'tip',$5,'succeeded')`, [tripId, riderId, provider, ref, cents]);
    // 100% of tips go to the driver.
    await c.query(`INSERT INTO driver_ledger (driver_id, trip_id, kind, amount_cents, note) VALUES ($1,$2,'tip',$3,'Tip — 100% to driver')`, [t.driver_id, tripId, cents]);
    setImmediate(() => void send(t.driver_id, 'tip_received', { ref: t.ref, cents }, { data: { trip_id: tripId } }));
    return { ok: true };
  });
}

/** Cancellation. Riders get a free window (2 min after acceptance); after that, or once the driver has arrived, a fee applies. */
export async function cancelTrip(actor: { id: string; role: string }, tripId: string, reason?: string, opts: { reasonCode?: string; note?: string } = {}) {
  const out = await tx(async (c) => {
    const t = await one('SELECT * FROM trips WHERE id = $1 FOR UPDATE', [tripId], c);
    if (!t) throw notFound('Trip');
    const isRider = actor.id === t.rider_id;
    const isDriver = actor.id === t.driver_id;
    const isOps = actor.role === 'admin' || actor.role === 'dispatcher';
    if (!isRider && !isDriver && !isOps) throw forbidden();
    if (!['scheduled', 'requested', 'accepted', 'arrived'].includes(t.status)) {
      throw conflict('bad_state', t.status === 'in_progress' ? 'Trip already started — use SOS or contact support' : `Trip is ${t.status}`);
    }
    // Driver pulls out before pickup for their own reasons: the rider keeps the booking and the next driver is offered it.
    if (isDriver && !isRider && opts.reasonCode && !(RIDER_SIDE_CANCEL_REASONS as readonly string[]).includes(opts.reasonCode)
        && await releaseTrip(c, t, { by: 'driver', actorId: actor.id, reason: opts.reasonCode, note: opts.note })) {
      return { t, status: 'released', fee: 0, isDriver: true, released: true };
    }
    let fee = 0;
    const policy = (await one(`SELECT value FROM settings WHERE key = 'cancellation_policy'`, [], c))?.value
      ?? { free_window_s: 120, scheduled_free_hours: { tour: 48, hourly: 24 }, scheduled_late_pct: 50 };
    const freeHours = policy.scheduled_free_hours?.[t.service];
    if (isRider && freeHours && t.scheduled_for) {
      // Tours & hire: free until N hours before start, then a percentage of the booking
      const hoursAhead = (new Date(t.scheduled_for).getTime() - Date.now()) / 3600e3;
      if (hoursAhead < freeHours) fee = Math.round((t.quote_cents * (policy.scheduled_late_pct ?? 50)) / 100);
    } else if (isRider && t.driver_id) {
      const rule = await loadRule(t.service, c);
      const sinceAccept = (Date.now() - new Date(t.accepted_at).getTime()) / 1000;
      const waited = t.arrived_at ? (Date.now() - new Date(t.arrived_at).getTime()) / 60000 : 0;
      if (t.status === 'arrived' && waited >= (rule.free_wait_min ?? 3)) fee = rule.cancel_fee_cents ?? 0;
      else if (sinceAccept > (policy.free_window_s ?? 120)) fee = rule.cancel_fee_cents ?? 0;
    }
    // Cash trips: DingoGo can't collect a fee after the fact, so none is charged (and none is credited to the driver).
    let feeWaived: string | undefined;
    if (fee > 0 && t.payment_method === 'cash') { fee = 0; feeWaived = 'cash'; }
    const status = isOps ? 'cancelled_admin' : isRider ? 'cancelled_rider' : 'cancelled_driver';
    await c.query(`UPDATE trips SET status = $2, cancelled_at = now(), cancel_reason = $3, cancel_fee_cents = $4 WHERE id = $1`,
      [tripId, status, reason ?? null, fee]);
    await c.query(`UPDATE trip_offers SET status = 'expired' WHERE trip_id = $1 AND status = 'offered'`, [tripId]);
    if (t.promo_code) await c.query('UPDATE promo_codes SET uses = greatest(uses - 1, 0) WHERE code = $1', [t.promo_code]);
    await releaseHoldsAndPoints(c, t, fee);
    if (fee && t.driver_id) {
      // Driver keeps the same share as on fares (100% − the service fee fixed when they accepted, 25% by default).
      const pct = Number((await acceptedPay(c, tripId, t.driver_id) ?? await offerPay(c, t, t.driver_id, null)).fee_pct);
      await c.query(`INSERT INTO driver_ledger (driver_id, trip_id, kind, amount_cents, note) VALUES ($1,$2,'cancel_fee',$3,$4)`,
        [t.driver_id, tripId, Math.round((fee * (100 - pct)) / 100), `Rider late cancellation (after ${pct}% service fee)`]);
    }
    await event(c, tripId, status, actor.id, { reason, fee, ...(feeWaived ? { fee_waived: feeWaived } : {}) });
    // Re-offer limit reached: the trip ends, but it still counts as the driver's cancellation.
    if (isDriver && !isRider && opts.reasonCode && !(RIDER_SIDE_CANCEL_REASONS as readonly string[]).includes(opts.reasonCode)) {
      await recordDriverCancel(c, t, actor.id, opts.reasonCode);
    }
    if (isDriver && t.assistance_animal) {
      await c.query(`INSERT INTO compliance_flags (kind, driver_id, trip_id, detail) VALUES ('assistance_animal_refusal', $1, $2, $3)`,
        [actor.id, tripId, `Driver cancelled a trip with an assistance animal. Reason: ${reason ?? 'none given'}`]);
    }
    return { t, status, fee, isDriver, released: false };
  });
  if (out.released) {
    await afterRelease(out.t, actor.id, { by: 'driver', actorId: actor.id, reason: opts.reasonCode! });
    // The driver no longer sees the trip's details: just enough for the "passed to another driver" screen.
    const t = out.t;
    return { id: t.id, ref: t.ref, kind: t.kind, service: t.service, status: 'requested', released: true, released_by: 'driver', cancel_fee_cents: 0 };
  }
  const trip = await getTrip(tripId);
  broadcast(trip);
  if (out.isDriver) {
    void send(trip.rider_id, 'driver_cancelled', { ref: trip.ref }, { trip });
  } else if (trip.driver_id) {
    void send(trip.driver_id, 'trip_cancelled', { ref: trip.ref }, { data: { trip_id: tripId } });
  }
  return { ...trip, cancel_fee_cents: out.fee };
}

export async function rateTrip(actor: { id: string }, tripId: string, rating: number, feedback?: string) {
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw bad('invalid_rating');
  const t = await one('SELECT * FROM trips WHERE id = $1', [tripId]);
  if (!t) throw notFound('Trip');
  if (t.status !== 'completed') throw conflict('bad_state', 'Rate after the trip is completed');
  let subject: string;
  if (actor.id === t.rider_id) {
    // Conditional update: two requests at once can't both count.
    const r = await one('UPDATE trips SET rider_rating = $2, rider_feedback = $3 WHERE id = $1 AND rider_rating IS NULL RETURNING id', [tripId, rating, feedback ?? null]);
    if (!r) throw conflict('already_rated');
    subject = t.driver_id;
  } else if (actor.id === t.driver_id) {
    const r = await one('UPDATE trips SET driver_rating = $2 WHERE id = $1 AND driver_rating IS NULL RETURNING id', [tripId, rating]);
    if (!r) throw conflict('already_rated');
    subject = t.rider_id;
  } else throw forbidden();
  await q(`UPDATE users SET rating_avg = ((coalesce(rating_avg,0) * rating_count) + $2) / (rating_count + 1), rating_count = rating_count + 1 WHERE id = $1`,
    [subject, rating]);
  return { ok: true };
}

/** Refusing an assistance animal is unlawful (DDA 1992). Declines are logged for ops review — repeated ones lead to suspension. */
async function flagAssistanceAnimal(tripId: string, driverId: string, what: string) {
  const t = await one('SELECT assistance_animal FROM trips WHERE id = $1', [tripId]);
  if (t?.assistance_animal) {
    await q(`INSERT INTO compliance_flags (kind, driver_id, trip_id, detail) VALUES ('assistance_animal_refusal', $1, $2, $3)`,
      [driverId, tripId, `Driver ${what} on a trip with an assistance animal`]);
    toOps('compliance.flag', { kind: 'assistance_animal_refusal', trip_id: tripId, driver_id: driverId });
  }
}

/** Rider reports an assistance-animal refusal on one of their trips: flag the driver on the trip, or the last driver who was
 *  offered it and declined, cancelled or let it lapse. One open flag per trip and driver (a driver-side cancel may have flagged it
 *  already). Returns false when no driver can be identified (the support ticket still goes to the team). */
export async function flagRiderReportedRefusal(t: { id: string; driver_id: string | null }, message: string) {
  const driverId = t.driver_id ?? (await one(
    `SELECT driver_id FROM trip_offers WHERE trip_id = $1 AND status IN ('declined','cancelled','released','expired','accepted')
     ORDER BY offered_at DESC LIMIT 1`, [t.id]))?.driver_id;
  if (!driverId) return false;
  const open = await one(`SELECT 1 FROM compliance_flags WHERE kind = 'assistance_animal_refusal' AND trip_id = $1 AND driver_id = $2 AND status = 'open'`,
    [t.id, driverId]);
  if (!open) {
    await q(`INSERT INTO compliance_flags (kind, driver_id, trip_id, detail) VALUES ('assistance_animal_refusal', $1, $2, $3)`,
      [driverId, t.id, `Rider reported the driver refused their assistance animal: ${message.slice(0, 300)}`]);
  }
  toOps('compliance.flag', { kind: 'assistance_animal_refusal', trip_id: t.id, driver_id: driverId, reported_by: 'rider' });
  return true;
}

/** Distance (m) from point P to segment AB, using a local equirectangular projection — fine at town scale. */
export function distToSegment(p: LatLng, a: LatLng, b: LatLng) {
  const k = 111320, kx = k * Math.cos((a.lat * Math.PI) / 180);
  const ax = a.lng * kx, ay = a.lat * k, bx = b.lng * kx, by = b.lat * k, px = p.lng * kx, py = p.lat * k;
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Late GPS points (sent after a signal drop) go on the driver's live trip track at the time they were taken. Points from
 *  before the driver accepted the trip are not part of it. Returns how many were stored. */
export async function storeTrack(driverId: string, pts: { lat: number; lng: number; at: string }[]) {
  const t = await one(`SELECT id, accepted_at FROM trips WHERE driver_id = $1 AND status IN ('accepted','arrived','in_progress')`, [driverId]);
  if (!t || !pts.length) return 0;
  const r = await q(
    `INSERT INTO trip_track (trip_id, lat, lng, at)
     SELECT $1, p.lat, p.lng, p.at FROM unnest($2::float8[], $3::float8[], $4::timestamptz[]) AS p(lat, lng, at)
     WHERE p.at >= $5 RETURNING 1`,
    [t.id, pts.map((p) => p.lat), pts.map((p) => p.lng), pts.map((p) => p.at), t.accepted_at]);
  return r.length;
}

/** Called on every driver location ping: stores breadcrumb, pushes live position, checks for route deviation. */
export async function onDriverLocation(driverId: string, p: LatLng & { heading?: number }, opts: { track?: boolean } = {}) {
  const t = await one(`SELECT * FROM trips WHERE driver_id = $1 AND status IN ('accepted','arrived','in_progress')`, [driverId]);
  if (!t) return null;
  if (opts.track !== false) await q('INSERT INTO trip_track (trip_id, lat, lng) VALUES ($1,$2,$3)', [t.id, p.lat, p.lng]);
  const payload = { trip_id: t.id, lat: p.lat, lng: p.lng, heading: p.heading ?? null };
  toTrip(t.id, 'driver.location', payload);
  toUser(t.rider_id, 'driver.location', payload);
  if (t.status === 'in_progress' && !t.deviation_alerted && t.service !== 'tour') {
    const a = { lat: t.pickup_lat, lng: t.pickup_lng }, b = { lat: t.dropoff_lat, lng: t.dropoff_lng };
    const off = distToSegment(p, a, b);
    const allowed = Math.max(2500, haversine(a, b) * 0.5);
    if (off > allowed) {
      await q('UPDATE trips SET deviation_alerted = true WHERE id = $1', [t.id]);
      await q(`INSERT INTO compliance_flags (kind, driver_id, trip_id, detail) VALUES ('route_deviation', $1, $2, $3)`,
        [driverId, t.id, `Vehicle ${Math.round(off)} m off the expected route`]);
      toOps('safety.deviation', { trip_id: t.id, ref: t.ref, off_m: Math.round(off) });
      void send(t.rider_id, 'route_check', { ref: t.ref }, { data: { trip_id: t.id, action: 'safety_check' } });
    }
  }
  return t;
}
