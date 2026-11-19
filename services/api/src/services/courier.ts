/**
 * Courier and delivery business (Round 11): the courier policy (return fee, extra-stop minimum), delivery estimates texted at
 * pickup, failed deliveries returned to the sender, booking another try, recipient instructions from the tracking link and
 * the engaged-time rule for multi-drop runs. Multi-drop booking itself lives with the trip code (services/trips.ts).
 */
import type pg from 'pg';
import { config } from '../config.js';
import { one, pool, q, tx, type Q } from '../db.js';
import { ApiError, bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { FAIL_REASONS, type FailReason } from '../lib/courier.js';
import { courierPending, courierReady } from '../lib/courierSchema.js';
import { RETURN_FEE_LABEL, returnFeeCents, type FareBreakdown } from '../lib/fares.js';
import type { TripMoney } from '../lib/tripTypes.js';
import { limit } from '../lib/rateLimit.js';
import { toOps, toTrip, toUser } from '../realtime.js';
import { send, sendSmsT } from './notify.js';
import * as trips from './trips.js';

export interface CourierPolicy {
  /** Fee for bringing an undeliverable parcel back, as a % of the trip fare (0 turns it off), with a minimum. */
  return_fee_pct: number;
  return_fee_min_cents: number;
  /** Minimum price of a later drop on a multi-drop run (it has no base fare or booking fee). */
  extra_stop_min_cents: number;
  /** Time allowed at each drop when working out the next recipients' delivery estimates. */
  handover_s: number;
}
export const COURIER_POLICY_DEFAULTS: CourierPolicy = { return_fee_pct: 50, return_fee_min_cents: 500, extra_stop_min_cents: 600, handover_s: 180 };

const clamp = (v: unknown, lo: number, hi: number, d: number) => (Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Math.round(Number(v)))) : d);

/** Admin → Settings key `courier_policy`; anything missing or out of range falls back to the defaults. */
export async function loadCourierPolicy(c: Q = pool): Promise<CourierPolicy> {
  const v = (await one(`SELECT value FROM settings WHERE key = 'courier_policy'`, [], c))?.value ?? {};
  const d = COURIER_POLICY_DEFAULTS;
  return {
    return_fee_pct: clamp(v.return_fee_pct, 0, 100, d.return_fee_pct),
    return_fee_min_cents: clamp(v.return_fee_min_cents, 0, 5000, d.return_fee_min_cents),
    extra_stop_min_cents: clamp(v.extra_stop_min_cents, 0, 5000, d.extra_stop_min_cents),
    handover_s: clamp(v.handover_s, 0, 1800, d.handover_s),
  };
}

const darwinTime = (d: Date) => new Intl.DateTimeFormat('en-AU', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit', hour12: true })
  .format(d).replace(/\s+/g, ' ').toLowerCase();

/** The return fee on a trip (set when the delivery failed). Credit-paid trips take only what credit is left: the rest is
 *  waived rather than taking the rider's balance below zero. Caller holds the trip lock and is completing the trip. */
export async function returnFeeFor(c: pg.PoolClient, t: TripMoney): Promise<number> {
  const fb: FareBreakdown = t.fare_breakdown ?? { lines: [] };
  const line = (fb.lines ?? []).find((l) => String(l.label).startsWith(RETURN_FEE_LABEL));
  let fee = Number(line?.cents ?? 0);
  if (line && fee > 0 && t.payment_method === 'wallet') {
    const u = await one('SELECT wallet_cents FROM users WHERE id = $1 FOR UPDATE', [t.rider_id], c);
    const left = Math.max(0, Number(u?.wallet_cents ?? 0));
    if (left < fee) {
      fee = Math.floor(left / 5) * 5;
      line.cents = fee;
      line.label = `${RETURN_FEE_LABEL} (part waived: not enough DingoGo credit)`;
      fb.return_fee_cents = fee;
      await c.query('UPDATE trips SET fare_breakdown = $2 WHERE id = $1', [t.id, JSON.stringify(fb)]);
    }
  }
  return fee;
}

/** Parcels have just been collected: work out each one's delivery estimate (in drop order for a run) and text the recipient. */
export async function onParcelsCollected(tripIds: string[]) {
  if (!tripIds.length) return;
  const ready = await courierReady();
  const policy = await loadCourierPolicy();
  const rows = await q(
    `SELECT t.id, t.ref, t.share_token, t.est_duration_s, p.sender_name, p.recipient_phone, p.leave_unattended
            ${ready ? ', p.safe_place' : ''}
     FROM trips t JOIN parcels p ON p.trip_id = t.id WHERE t.id = ANY($1::uuid[]) ${ready ? 'ORDER BY t.batch_seq NULLS FIRST' : ''}`, [tripIds]);
  let at = Date.now();
  for (const [i, r] of rows.entries()) {
    at += Number(r.est_duration_s) * 1000 + (i > 0 ? policy.handover_s * 1000 : 0);
    const eta = new Date(Math.ceil(at / 300_000) * 300_000);   // to the next 5 minutes
    if (ready) await q('UPDATE parcels SET eta_at = $2 WHERE trip_id = $1', [r.id, eta]);
    void sendSmsT(r.recipient_phone, 'parcel_on_way', {
      sender: r.sender_name, ref: r.ref, eta: darwinTime(eta), url: `${config.publicWebUrl}/track/${r.share_token}`,
      safe_place: r.leave_unattended ? (r.safe_place || 'in a safe place') : null,
    }, { tripId: r.id });
  }
}

export interface FailInput { reason: FailReason; note?: string; photo_url?: string; lat?: number; lng?: number }

/** The driver couldn't deliver: the parcel goes back to the sender (the trip stays live and its target becomes the pickup).
 *  A return fee (courier policy) is added to the trip and paid to the driver like the fare. The sender and recipient are told. */
export async function failDelivery(driverId: string, tripId: string, b: FailInput) {
  if (!(await courierReady())) throw new ApiError(503, 'migration_pending', `${courierPending()}. Call DingoGo to arrange the return.`);
  const out = await tx(async (c) => {
    const t = await one('SELECT * FROM trips WHERE id = $1 FOR UPDATE', [tripId], c);
    if (!t) throw notFound('Trip');
    if (t.driver_id !== driverId) throw forbidden('Not your trip');
    if (t.kind !== 'courier' || t.status !== 'in_progress') throw conflict('bad_state', 'Only a parcel you have collected can be marked not delivered');
    const p = await one('SELECT * FROM parcels WHERE trip_id = $1 FOR UPDATE', [tripId], c);
    if (p.outcome === 'returning') return { t, p, fee: Number(t.fare_breakdown?.return_fee_cents ?? 0), replay: true };
    if (b.reason === 'no_one_home' && p.leave_unattended) {
      throw bad('use_safe_place', 'The sender said it can be left. Leave it in a safe place with a photo, or choose "No safe place to leave it".');
    }
    const policy = await loadCourierPolicy(c);
    const fare = Number(t.fare_breakdown?.trip_cents ?? t.quote_cents);
    const fee = returnFeeCents(fare, policy);
    const fb = { ...(t.fare_breakdown ?? {}), lines: [...(t.fare_breakdown?.lines ?? [])], return_fee_cents: fee };
    if (fee > 0) fb.lines.push({ label: RETURN_FEE_LABEL, cents: fee });
    await c.query('UPDATE trips SET fare_breakdown = $2 WHERE id = $1', [tripId, JSON.stringify(fb)]);
    await c.query(
      `UPDATE parcels SET outcome = 'returning', failed_at = now(), failed_reason = $2, failed_note = $3, failed_photo_url = $4 WHERE trip_id = $1`,
      [tripId, b.reason, b.note?.trim() || null, b.photo_url ?? null]);
    await trips.event(c, tripId, 'delivery_failed', driverId, { reason: b.reason, note: b.note ?? null, fee, lat: b.lat ?? null, lng: b.lng ?? null });
    return { t, p, fee, replay: false };
  });
  const trip = await trips.getTrip(tripId);
  if (!out.replay) {
    const reason = FAIL_REASONS[b.reason];
    const slim = { id: trip.id, ref: trip.ref, status: trip.status, parcel_outcome: 'returning' };
    toTrip(trip.id, 'trip.updated', slim); toUser(trip.rider_id, 'trip.updated', slim); toOps('parcel.failed', { ...slim, reason: b.reason });
    void sendSmsT(out.p.recipient_phone, 'parcel_failed_recipient', { sender: out.p.sender_name, ref: trip.ref, reason: reason.toLowerCase() }, { tripId });
    void send(trip.rider_id, 'parcel_failed_sender', { ref: trip.ref, to: out.p.recipient_name, reason: reason.toLowerCase(), fee_cents: out.fee }, { trip });
    if (await trips.senderNotRider(trip)) {
      void sendSmsT(out.p.sender_phone, 'parcel_failed_sender', { ref: trip.ref, to: out.p.recipient_name, reason: reason.toLowerCase(), fee_cents: out.fee }, { tripId });
    }
  }
  return trip;
}

export interface ReattemptInput {
  scheduled_for?: string | null; pickup_window_end?: string | null; payment_method?: 'card' | 'cash' | 'corporate' | 'wallet';
  leave_unattended?: boolean; safe_place?: string; instructions?: string;
}

/** The sender books another try for a parcel that came back: same parcel, addresses and account, a new PIN and a normal fare. */
export async function reattempt(riderId: string, tripId: string, b: ReattemptInput) {
  const t = await trips.getTrip(tripId);
  if (t.rider_id !== riderId) throw notFound('Trip');
  if (t.kind !== 'courier' || t.parcel?.outcome !== 'returned') throw conflict('not_returned', 'Only a parcel that came back to you can be sent again');
  const prior = await one(`SELECT data FROM trip_events WHERE trip_id = $1 AND type = 'reattempt_booked' LIMIT 1`, [tripId]);
  if (prior) throw conflict('already_rebooked', `This parcel has already been booked again (${prior.data?.ref ?? 'see your trips'})`);
  const p = t.parcel;
  const unattended = b.leave_unattended ?? p.leave_unattended;
  const nt = await trips.createTrip(riderId, {
    kind: 'courier', service: t.service, payment_method: b.payment_method ?? t.payment_method,
    corporate_account_id: (b.payment_method ?? t.payment_method) === 'corporate' ? t.corporate_account_id : t.corporate_account_id ?? null,
    pickup: { lat: t.pickup_lat, lng: t.pickup_lng, address: t.pickup_address },
    dropoff: { lat: t.dropoff_lat, lng: t.dropoff_lng, address: t.dropoff_address },
    scheduled_for: b.scheduled_for ?? null, pickup_window_end: b.pickup_window_end ?? null, ndis_number: t.ndis_number ?? undefined,
    parcel: {
      size: p.size, weight_kg: p.weight_kg != null ? Number(p.weight_kg) : undefined, description: p.description,
      declared_value_cents: p.declared_value_cents ?? undefined, sender_name: p.sender_name, sender_phone: p.sender_phone,
      recipient_name: p.recipient_name, recipient_phone: p.recipient_phone, instructions: b.instructions ?? p.instructions ?? undefined,
      leave_unattended: unattended, requires_signature: unattended ? false : p.requires_signature,
      safe_place: b.safe_place ?? p.safe_place ?? undefined, customer_ref: p.customer_ref ?? undefined,
      // The sender ticked the checklist for this same parcel when it was first booked.
      prohibited_ack: true, prohibited_items: p.prohibited_checklist?.items,
    },
  });
  await trips.event(pool, tripId, 'reattempt_booked', riderId, { trip_id: nt.id, ref: nt.ref });
  await trips.event(pool, nt.id, 'reattempt_of', riderId, { trip_id: tripId, ref: t.ref });
  return nt;
}

/** The recipient adds instructions or a safe place from their tracking link (no login). Not once the parcel is delivered or
 *  failed, and no safe place when the sender asked for a signature. */
export async function recipientInstructions(token: string, ip: string, b: { notes?: string; safe_place?: string }) {
  await limit('recipient_notes_ip', ip, config.rateLimits.publicFormPerIp, 3600, 'Too many changes from this connection. Please try again later.');
  if (!(await courierReady())) throw new ApiError(503, 'migration_pending', courierPending());
  const t = await one(`SELECT id, ref, kind, status, rider_id, driver_id, completed_at, cancelled_at FROM trips WHERE share_token = $1`, [token.slice(0, 100)]);
  if (!t || t.kind !== 'courier') throw notFound('Delivery');
  if (trips.shareLinkExpired(t)) throw new ApiError(410, 'link_expired', 'This delivery has finished.');
  if (!['scheduled', 'requested', 'accepted', 'arrived', 'in_progress'].includes(t.status)) throw conflict('too_late', 'This delivery has finished');
  const notes = b.notes?.trim() || null;
  const place = b.safe_place?.trim() || null;
  if (!notes && !place) throw bad('validation_error', 'Add a note or a safe place');
  return tx(async (c) => {
    const p = await one('SELECT * FROM parcels WHERE trip_id = $1 FOR UPDATE', [t.id], c);
    if (p.delivered_at || p.outcome) throw conflict('too_late', 'The driver has already been to your address');
    if (place && p.requires_signature) throw bad('signature_required', 'The sender asked for a signature, so this parcel can’t be left. Someone needs to be there to sign.');
    await c.query(
      `UPDATE parcels SET recipient_notes = coalesce($2, recipient_notes), safe_place = coalesce($3, safe_place),
         leave_unattended = leave_unattended OR $3::text IS NOT NULL WHERE trip_id = $1`, [t.id, notes, place]);
    await trips.event(c, t.id, 'recipient_instructions', null, { notes: !!notes, safe_place: !!place });
    setImmediate(() => {
      const slim = { id: t.id, ref: t.ref, status: t.status, recipient_instructions: true };
      if (t.driver_id) toUser(t.driver_id, 'trip.updated', slim);
      toUser(t.rider_id, 'trip.updated', slim);
    });
    const after = await one('SELECT recipient_notes, safe_place, leave_unattended FROM parcels WHERE trip_id = $1', [t.id], c);
    return { ok: true, parcel: after };
  });
}

/** SQL for when a trip's engaged time starts. A drop on a multi-drop run starts when the drop before it was finished (all
 *  drops are accepted together, so counting each from accept would count the same minutes several times). */
export async function engagedFromSql(alias = 't') {
  if (!(await courierReady())) return `${alias}.accepted_at`;
  return `greatest(${alias}.accepted_at, coalesce((SELECT max(px.completed_at) FROM trips px WHERE ${alias}.batch_id IS NOT NULL AND px.batch_id = ${alias}.batch_id
    AND px.id <> ${alias}.id AND px.driver_id = ${alias}.driver_id AND px.completed_at < coalesce(${alias}.completed_at, ${alias}.cancelled_at)), ${alias}.accepted_at))`;
}
