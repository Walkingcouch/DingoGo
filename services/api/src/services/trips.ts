import type pg from 'pg';
import { config } from '../config.js';
import { one, pool, q, tx, type Q } from '../db.js';
import { ApiError, bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { quoteFare, type FareQuote, type FareRule } from '../lib/fares.js';
import { haversine, route, withinZone, type LatLng } from '../lib/geo.js';
import { pin4, shareToken, tripRef } from '../lib/ids.js';
import { isEv, isGreen } from '../lib/vehicles.js';
import { toOps, toTrip, toUser } from '../realtime.js';
import { notify, sendSms } from './notify.js';
import * as pay from './payments.js';

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

export async function zoneFor(p: LatLng, c: Q = pool) {
  const zones = await q('SELECT * FROM zones WHERE active ORDER BY radius_km', [], c);
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
  });
  return { quote, route: r, zone, rule, promo };
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

    // Payment hold
    if (input.payment_method === 'card' && quote.total_cents > 0) {
      const auth = await pay.authorise(quote.total_cents, { description: `DingoGo ${trip.ref}` });
      if (!auth.ok) throw new ApiError(402, 'payment_failed', auth.error ?? 'Card could not be authorised');
      await c.query(`UPDATE trips SET payment_status = 'authorised', payment_ref = $2 WHERE id = $1`, [trip.id, auth.ref]);
      await c.query(`INSERT INTO payments (trip_id, user_id, provider, provider_ref, kind, amount_cents, status)
                     VALUES ($1,$2,$3,$4,'authorise',$5,'succeeded')`, [trip.id, userId, auth.provider, auth.ref, Math.round(quote.total_cents * 1.2)]);
      trip.payment_status = 'authorised';
      trip.payment_ref = auth.ref;
    }
    if (input.payment_method === 'wallet') {
      await c.query('UPDATE users SET wallet_cents = wallet_cents - $2 WHERE id = $1', [userId, quote.total_cents]);
      await c.query(`UPDATE trips SET payment_status = 'authorised', payment_ref = 'wallet' WHERE id = $1`, [trip.id]);
    }

    await event(c, trip.id, scheduled ? 'scheduled' : 'requested', userId, { quote: quote.total_cents });
    return trip;
  }).then(async (trip) => {
    toOps('trip.created', { id: trip.id, ref: trip.ref, status: trip.status });
    if (trip.status === 'requested') await dispatchTrip(trip.id).catch((e) => console.error('dispatch', e));
    if (input.kind === 'courier') {
      const p = await one('SELECT * FROM parcels WHERE trip_id = $1', [trip.id]);
      void sendSms(p.recipient_phone,
        `DingoGo: ${p.sender_name} is sending you a parcel (${trip.ref}). Track it: ${config.publicWebUrl}/track/${trip.share_token} — give the driver PIN ${p.delivery_pin} on delivery.`);
    }
    return getTrip(trip.id);
  });
}

export async function event(c: Q, tripId: string, type: string, actorId: string | null, data?: unknown) {
  await c.query('INSERT INTO trip_events (trip_id, type, actor_id, data) VALUES ($1,$2,$3,$4)', [tripId, type, actorId, data ?? null]);
}

/** Full trip view including driver/vehicle/parcel. */
export async function getTrip(id: string, c: Q = pool) {
  const t = await one(
    `SELECT t.*,
       CASE WHEN du.id IS NOT NULL THEN json_build_object('id', du.id, 'name', du.name, 'phone', du.phone, 'rating', du.rating_avg,
         'lat', d.lat, 'lng', d.lng, 'heading', d.heading, 'languages', d.languages) END AS driver,
       CASE WHEN v.id IS NOT NULL THEN json_build_object('rego', v.rego, 'make', v.make, 'model', v.model, 'colour', v.colour, 'battery_pct', v.battery_pct,
         'fuel_type', v.fuel_type, 'green', v.fuel_type IN ('electric','plug_in_hybrid','hybrid'), 'is_ev', v.fuel_type = 'electric') END AS vehicle,
       json_build_object('id', ru.id, 'name', ru.name, 'phone', ru.phone, 'rating', ru.rating_avg) AS rider
     FROM trips t
     JOIN users ru ON ru.id = t.rider_id
     LEFT JOIN users du ON du.id = t.driver_id
     LEFT JOIN drivers d ON d.user_id = t.driver_id
     LEFT JOIN vehicles v ON v.id = t.vehicle_id
     WHERE t.id = $1`, [id], c);
  if (!t) throw notFound('Trip');
  if (t.kind === 'courier') t.parcel = await one('SELECT * FROM parcels WHERE trip_id = $1', [id], c);
  return t;
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

export function canView(t: any, u: { id: string; role: string }) {
  return u.id === t.rider_id || u.id === t.driver_id || u.role === 'admin' || u.role === 'dispatcher';
}

// ───────────────────────── Dispatch ─────────────────────────

/** Find the best eligible driver and send them an offer. Nearest-first with a head start for green (EV/hybrid) cars; range checks for EVs. */
export async function dispatchTrip(tripId: string): Promise<'offered' | 'waiting' | 'no_drivers' | 'skip'> {
  return tx(async (c) => {
    const t = await one('SELECT * FROM trips WHERE id = $1 FOR UPDATE SKIP LOCKED', [tripId], c);
    if (!t || t.status !== 'requested') return 'skip';
    const pending = await one(`SELECT 1 FROM trip_offers WHERE trip_id = $1 AND status = 'offered' AND expires_at > now()`, [tripId], c);
    if (pending) return 'waiting';

    // Give up only after maxAttempts real offers, or after the search window (small fleet: cars free up within minutes).
    const searching = Date.now() - new Date(t.requested_at).getTime();
    if (t.dispatch_attempts >= config.dispatch.maxAttempts || searching > config.dispatch.searchWindowMin * 60000) {
      await failNoDrivers(c, t);
      return 'no_drivers';
    }

    const candidates = await q(
      `SELECT d.user_id, d.lat, d.lng, v.id AS vehicle_id, v.battery_pct, v.range_km, v.pet_friendly, v.wheelchair_accessible, v.seats, v.fuel_type
       FROM drivers d JOIN vehicles v ON v.id = d.vehicle_id AND v.active AND v.status = 'approved'
       WHERE d.status = 'approved' AND d.online AND d.lat IS NOT NULL
         AND d.last_seen_at > now() - interval '3 minutes'
         AND ($2::boolean = false OR d.accepts_courier)
         AND ($3::boolean = false OR (d.accepts_pets AND v.pet_friendly))
         AND ($4::boolean = false OR v.wheelchair_accessible)
         AND v.seats >= $5
         AND ($6::boolean = false OR d.female_driver)
         AND NOT EXISTS (SELECT 1 FROM trips x WHERE x.driver_id = d.user_id AND x.status IN ('accepted','arrived','in_progress'))
         AND NOT EXISTS (SELECT 1 FROM trip_offers o WHERE o.driver_id = d.user_id AND o.status = 'offered' AND o.expires_at > now())
         AND NOT EXISTS (SELECT 1 FROM trip_offers o WHERE o.driver_id = d.user_id AND o.trip_id = $1)`,
      [tripId, t.kind === 'courier', t.has_pet, t.needs_wheelchair, t.passengers, t.women_driver_pref], c);

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
    await event(c, tripId, 'offered', null, { driver_id: pick.user_id, eta_s: etaS });
    const offer = {
      trip_id: t.id, ref: t.ref, kind: t.kind, service: t.service,
      pickup: { lat: t.pickup_lat, lng: t.pickup_lng, address: t.pickup_address },
      dropoff: { lat: t.dropoff_lat, lng: t.dropoff_lng, address: t.dropoff_address },
      est_distance_m: t.est_distance_m, est_duration_s: t.est_duration_s, quote_cents: t.quote_cents,
      trip_cents: t.fare_breakdown?.trip_cents ?? null,
      pickup_eta_s: etaS, expires_in_s: config.dispatch.offerTimeoutS, has_pet: t.has_pet,
      assistance_animal: t.assistance_animal, needs_wheelchair: t.needs_wheelchair, passengers: t.passengers,
      payment_method: t.payment_method, notes: t.notes,
    };
    setImmediate(() => toUser(pick.user_id, 'offer.new', offer));
    return 'offered';
  });
}

async function failNoDrivers(c: pg.PoolClient, t: any) {
  await c.query(`UPDATE trips SET status = 'no_drivers', cancelled_at = now() WHERE id = $1`, [t.id]);
  await releaseHoldsAndPoints(c, t);
  await event(c, t.id, 'no_drivers', null);
  setImmediate(() => {
    toTrip(t.id, 'trip.updated', { id: t.id, status: 'no_drivers' });
    toOps('trip.updated', { id: t.id, status: 'no_drivers' });
    void notify(t.rider_id, 'No drivers available', `Sorry — no DingoGo cars are free right now for ${t.ref}. You have not been charged.`, { trip_id: t.id });
  });
}

async function releaseHoldsAndPoints(c: Q, t: any, feeCents = 0) {
  if (t.payment_method === 'card' && t.payment_ref && t.payment_status === 'authorised') {
    if (feeCents > 0) {
      await pay.capture(t.payment_ref, feeCents);
      await c.query(`UPDATE trips SET payment_status = 'captured' WHERE id = $1`, [t.id]);
      await c.query(`INSERT INTO payments (trip_id, user_id, provider, provider_ref, kind, amount_cents, gst_cents, status)
                     VALUES ($1,$2,'card',$3,'capture',$4,$5,'succeeded')`, [t.id, t.rider_id, t.payment_ref, feeCents, Math.round(feeCents / 11)]);
    } else {
      await pay.cancelHold(t.payment_ref);
      await c.query(`UPDATE trips SET payment_status = 'none' WHERE id = $1`, [t.id]);
    }
  }
  if (t.payment_method === 'wallet' && t.payment_status === 'authorised') {
    await c.query('UPDATE users SET wallet_cents = wallet_cents + $2 WHERE id = $1', [t.rider_id, t.quote_cents - feeCents]);
    await c.query(`UPDATE trips SET payment_status = $2 WHERE id = $1`, [t.id, feeCents ? 'captured' : 'none']);
  }
  if (t.points_redeemed > 0) {
    await c.query('UPDATE users SET loyalty_points = loyalty_points + $2 WHERE id = $1', [t.rider_id, t.points_redeemed]);
    await c.query(`INSERT INTO loyalty_ledger (user_id, points, reason, trip_id) VALUES ($1,$2,'refund_cancelled_trip',$3)`,
      [t.rider_id, t.points_redeemed, t.id]);
  }
}

let ticking = false;
/** Background loop: expire offers, re-dispatch, release scheduled trips. */
export async function dispatchTick() {
  if (ticking) return;
  ticking = true;
  try {
    const expired = await q(
      `UPDATE trip_offers SET status = 'expired' WHERE status = 'offered' AND expires_at <= now() RETURNING trip_id, driver_id`);
    for (const e of expired) toUser(e.driver_id, 'offer.expired', { trip_id: e.trip_id });

    const due = await q(
      `UPDATE trips SET status = 'requested', requested_at = now()
       WHERE status = 'scheduled' AND scheduled_for <= now() + ($1 || ' minutes')::interval RETURNING id, rider_id, ref`,
      [String(config.dispatch.scheduledLeadMin)]);
    for (const t of due) {
      void notify(t.rider_id, 'Finding your driver', `We're now matching a driver for your scheduled trip ${t.ref}.`, { trip_id: t.id });
    }

    const open = await q(`SELECT id FROM trips WHERE status = 'requested' ORDER BY requested_at LIMIT 50`);
    for (const t of open) await dispatchTrip(t.id).catch((e) => console.error('dispatch', e));
  } finally {
    ticking = false;
  }
}

// ───────────────────────── Driver actions ─────────────────────────

export async function acceptOffer(driverId: string, tripId: string) {
  const out = await tx(async (c) => {
    const offer = await one(
      `SELECT * FROM trip_offers WHERE trip_id = $1 AND driver_id = $2 FOR UPDATE`, [tripId, driverId], c);
    if (!offer || offer.status !== 'offered' || new Date(offer.expires_at) < new Date()) {
      throw conflict('offer_expired', 'This request is no longer available');
    }
    const t = await one('SELECT * FROM trips WHERE id = $1 FOR UPDATE', [tripId], c);
    if (t.status !== 'requested') throw conflict('trip_unavailable', 'Trip is no longer available');
    const d = await one('SELECT vehicle_id FROM drivers WHERE user_id = $1', [driverId], c);
    await c.query(`UPDATE trip_offers SET status = 'accepted' WHERE trip_id = $1 AND driver_id = $2`, [tripId, driverId]);
    await c.query(`UPDATE trips SET status = 'accepted', driver_id = $2, vehicle_id = $3, accepted_at = now() WHERE id = $1`,
      [tripId, driverId, d.vehicle_id]);
    await event(c, tripId, 'accepted', driverId, { eta_s: offer.pickup_eta_s });
    return { t, eta: offer.pickup_eta_s };
  });
  const trip = await getTrip(tripId);
  broadcast(trip);
  void notify(trip.rider_id, 'Driver on the way 🐕',
    `${trip.driver.name} is coming in a ${trip.vehicle.colour} ${trip.vehicle.make} ${trip.vehicle.model} (${trip.vehicle.rego}). ETA ${Math.ceil(out.eta / 60)} min.`,
    { trip_id: tripId });
  return trip;
}

export async function declineOffer(driverId: string, tripId: string) {
  await q(`UPDATE trip_offers SET status = 'declined' WHERE trip_id = $1 AND driver_id = $2 AND status = 'offered'`, [tripId, driverId]);
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

export async function markArrived(driverId: string, tripId: string) {
  await tx(async (c) => {
    const t = await driverTrip(c, driverId, tripId);
    if (t.status !== 'accepted') throw conflict('bad_state', `Cannot arrive from ${t.status}`);
    await c.query(`UPDATE trips SET status = 'arrived', arrived_at = now() WHERE id = $1`, [tripId]);
    await event(c, tripId, 'arrived', driverId);
  });
  const trip = await getTrip(tripId);
  broadcast(trip);
  void notify(trip.rider_id, 'Your driver is here',
    trip.kind === 'ride' ? `Look for ${trip.vehicle.rego}. Your trip PIN is ${trip.verify_pin}.` : `Driver has arrived to collect parcel ${trip.ref}.`,
    { trip_id: tripId });
  return trip;
}

export async function startTrip(driverId: string, tripId: string, pin?: string) {
  await tx(async (c) => {
    const t = await driverTrip(c, driverId, tripId);
    if (t.status !== 'arrived') throw conflict('bad_state', `Cannot start from ${t.status}`);
    // Ride: rider shows the 4-digit PIN so they know it's the right car. Courier: pickup is confirmed by scanning/handover.
    if (t.kind === 'ride' && pin !== t.verify_pin) throw bad('pin_mismatch', 'PIN does not match — check you have the right passenger');
    await c.query(`UPDATE trips SET status = 'in_progress', started_at = now() WHERE id = $1`, [tripId]);
    if (t.kind === 'courier') await c.query('UPDATE parcels SET picked_up_at = now() WHERE trip_id = $1', [tripId]);
    await event(c, tripId, 'started', driverId);
  });
  const trip = await getTrip(tripId);
  broadcast(trip);
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

export async function completeTrip(driverId: string, tripId: string, input: CompleteInput) {
  const result = await tx(async (c) => {
    const t = await driverTrip(c, driverId, tripId);
    if (t.status !== 'in_progress') throw conflict('bad_state', `Cannot complete from ${t.status}`);

    if (t.kind === 'courier') {
      const p = await one('SELECT * FROM parcels WHERE trip_id = $1', [tripId], c);
      const pinOk = input.delivery_pin && input.delivery_pin === p.delivery_pin;
      const unattendedOk = p.leave_unattended && input.pod_photo_url;
      const signatureOk = input.pod_signature && input.pod_received_by;
      if (p.requires_signature && !signatureOk) throw bad('signature_required', 'This parcel needs a signature and the receiver’s name');
      if (!pinOk && !unattendedOk && !signatureOk) {
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

    await c.query(
      `UPDATE trips SET status = 'completed', completed_at = now(), final_cents = $2, actual_distance_m = $3 WHERE id = $1`,
      [tripId, final, actualM]);
    await event(c, tripId, 'completed', driverId, { final_cents: final });
    await settle(c, { ...t, final_cents: final });
    return t;
  });
  const trip = await getTrip(tripId);
  broadcast(trip);
  void notify(trip.rider_id, trip.kind === 'courier' ? 'Parcel delivered ✅' : 'Thanks for riding DingoGo',
    `${trip.ref}: $${(trip.final_cents / 100).toFixed(2)} incl. GST. Your tax invoice is in the app.`, { trip_id: tripId });
  if (trip.kind === 'courier' && trip.parcel) {
    void sendSms(trip.parcel.sender_phone, `DingoGo: parcel ${trip.ref} delivered to ${trip.parcel.pod_received_by || trip.parcel.recipient_name}.`);
  }
  void result;
  return trip;
}

/** Money movement on completion: capture payment, driver ledger, loyalty, referral. */
async function settle(c: pg.PoolClient, t: any) {
  const amount = t.final_cents;
  const gst = Math.round(amount / 11);

  if (t.payment_method === 'card' && t.payment_ref) {
    const cap = await pay.capture(t.payment_ref, amount);
    await c.query(`UPDATE trips SET payment_status = $2 WHERE id = $1`, [t.id, cap.ok ? 'captured' : 'failed']);
    await c.query(`INSERT INTO payments (trip_id, user_id, provider, provider_ref, kind, amount_cents, gst_cents, status)
                   VALUES ($1,$2,'card',$3,'capture',$4,$5,$6)`, [t.id, t.rider_id, t.payment_ref, amount, gst, cap.ok ? 'succeeded' : 'failed']);
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

  // Driver earnings: trip fare (before rider discounts — DingoGo funds promos/points; excludes booking fee & levy) minus commission.
  const adj = (t.fare_breakdown.lines ?? []).find((l: any) => l.label === 'Route change adjustment')?.cents ?? 0;
  const gross = (t.fare_breakdown.trip_cents ?? amount) + adj;
  const d = await one('SELECT commission_pct FROM drivers WHERE user_id = $1', [t.driver_id], c);
  const commission = Math.round((gross * Number(d.commission_pct)) / 100);
  await c.query(`INSERT INTO driver_ledger (driver_id, trip_id, kind, amount_cents, note) VALUES ($1,$2,'fare',$3,$4), ($1,$2,'commission',$5,$6)`,
    [t.driver_id, t.id, gross, `Fare ${t.ref}`, -commission, `DingoGo service fee ${d.commission_pct}%`]);

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
    setImmediate(() => void notify(ref.referrer_id, 'Referral bonus! 🎉', `Your friend took their first DingoGo trip — ${bonus} Dingo Points added.`, {}, 'promo'));
  }
}

export async function addTip(riderId: string, tripId: string, cents: number) {
  if (cents <= 0 || cents > 10000) throw bad('invalid_tip');
  return tx(async (c) => {
    const t = await one('SELECT * FROM trips WHERE id = $1 FOR UPDATE', [tripId], c);
    if (!t || t.rider_id !== riderId) throw notFound('Trip');
    if (t.status !== 'completed') throw conflict('bad_state', 'You can tip after the trip');
    if (t.tip_cents > 0) throw conflict('already_tipped');
    const auth = await pay.authorise(cents, { description: `DingoGo tip ${t.ref}` });
    const cap = auth.ok ? await pay.capture(auth.ref, cents) : { ok: false, error: auth.error };
    if (!cap.ok) throw new ApiError(402, 'payment_failed', cap.error ?? 'Your card could not be charged for the tip');
    await c.query('UPDATE trips SET tip_cents = $2 WHERE id = $1', [tripId, cents]);
    await c.query(`INSERT INTO payments (trip_id, user_id, provider, provider_ref, kind, amount_cents, status) VALUES ($1,$2,$3,$4,'tip',$5,'succeeded')`, [tripId, riderId, auth.provider, auth.ref, cents]);
    // 100% of tips go to the driver.
    await c.query(`INSERT INTO driver_ledger (driver_id, trip_id, kind, amount_cents, note) VALUES ($1,$2,'tip',$3,'Tip — 100% to driver')`, [t.driver_id, tripId, cents]);
    setImmediate(() => void notify(t.driver_id, 'You got a tip! 💛', `$${(cents / 100).toFixed(2)} on ${t.ref}`));
    return { ok: true };
  });
}

/** Cancellation. Riders get a free window (2 min after acceptance); after that, or once the driver has arrived, a fee applies. */
export async function cancelTrip(actor: { id: string; role: string }, tripId: string, reason?: string) {
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
    const status = isOps ? 'cancelled_admin' : isRider ? 'cancelled_rider' : 'cancelled_driver';
    await c.query(`UPDATE trips SET status = $2, cancelled_at = now(), cancel_reason = $3, cancel_fee_cents = $4 WHERE id = $1`,
      [tripId, status, reason ?? null, fee]);
    await c.query(`UPDATE trip_offers SET status = 'expired' WHERE trip_id = $1 AND status = 'offered'`, [tripId]);
    if (t.promo_code) await c.query('UPDATE promo_codes SET uses = greatest(uses - 1, 0) WHERE code = $1', [t.promo_code]);
    await releaseHoldsAndPoints(c, t, fee);
    if (fee && t.driver_id) {
      await c.query(`INSERT INTO driver_ledger (driver_id, trip_id, kind, amount_cents, note) VALUES ($1,$2,'cancel_fee',$3,'Rider late cancellation')`,
        [t.driver_id, tripId, Math.round(fee * 0.8)]);
    }
    await event(c, tripId, status, actor.id, { reason, fee });
    if (isDriver && t.assistance_animal) {
      await c.query(`INSERT INTO compliance_flags (kind, driver_id, trip_id, detail) VALUES ('assistance_animal_refusal', $1, $2, $3)`,
        [actor.id, tripId, `Driver cancelled a trip with an assistance animal. Reason: ${reason ?? 'none given'}`]);
    }
    return { t, status, fee, isDriver };
  });
  const trip = await getTrip(tripId);
  broadcast(trip);
  if (out.isDriver) {
    void notify(trip.rider_id, 'Driver cancelled', `Your driver had to cancel ${trip.ref}. You have not been charged.`, { trip_id: tripId });
  } else if (trip.driver_id) {
    void notify(trip.driver_id, 'Trip cancelled', `${trip.ref} was cancelled.`, { trip_id: tripId });
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
    if (t.rider_rating) throw conflict('already_rated');
    await q('UPDATE trips SET rider_rating = $2, rider_feedback = $3 WHERE id = $1', [tripId, rating, feedback ?? null]);
    subject = t.driver_id;
  } else if (actor.id === t.driver_id) {
    if (t.driver_rating) throw conflict('already_rated');
    await q('UPDATE trips SET driver_rating = $2 WHERE id = $1', [tripId, rating]);
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

/** Distance (m) from point P to segment AB, using a local equirectangular projection — fine at town scale. */
export function distToSegment(p: LatLng, a: LatLng, b: LatLng) {
  const k = 111320, kx = k * Math.cos((a.lat * Math.PI) / 180);
  const ax = a.lng * kx, ay = a.lat * k, bx = b.lng * kx, by = b.lat * k, px = p.lng * kx, py = p.lat * k;
  const dx = bx - ax, dy = by - ay;
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** Called on every driver location ping: stores breadcrumb, pushes live position, checks for route deviation. */
export async function onDriverLocation(driverId: string, p: LatLng & { heading?: number }) {
  const t = await one(`SELECT * FROM trips WHERE driver_id = $1 AND status IN ('accepted','arrived','in_progress')`, [driverId]);
  if (!t) return null;
  await q('INSERT INTO trip_track (trip_id, lat, lng) VALUES ($1,$2,$3)', [t.id, p.lat, p.lng]);
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
      void notify(t.rider_id, 'Is everything OK?', `Your trip ${t.ref} has gone off the usual route. Tap to share your trip or get help.`, { trip_id: t.id, action: 'safety_check' }, 'safety');
    }
  }
  return t;
}
