/**
 * Refunds on a trip (moved out of the admin route in Round 22 so automatic fare-review refunds use exactly the same rules).
 * The fare is refunded first, then the tip, each back to where it was paid (the fare's and the tip's own PaymentIntent; a tour
 * fare paid partly by its deposit against each payment in turn; DingoGo credit for wallet and cash). GST comes off the fare part
 * only. One refund at a time per trip (row lock) and the running total can never exceed what the rider paid.
 */
import type pg from 'pg';
import { one, q, tx } from '../db.js';
import { bad, notFound } from '../lib/errors.js';
import * as pay from './payments.js';
import { event } from './trips.js';
import { send } from './notify.js';

export interface RefundResult { trip: any; refunded_cents: number; fare_cents: number; tip_cents: number; refundable_cents: number }

/** Refund `cents` on a trip. `actorId` null = DingoGo's automatic checks (audited as system). Pass `c` to run inside a
 *  transaction you already hold; the rider's "refund issued" notice is sent by `refundTrip` (not `refundIn`). */
export async function refundIn(c: pg.PoolClient, tripId: string, cents: number, reason: string, actorId: string | null, extra: Record<string, unknown> = {}): Promise<RefundResult> {
  const t = await one('SELECT * FROM trips WHERE id = $1 FOR UPDATE', [tripId], c);
  if (!t) throw notFound('Trip');
  const farePaid = t.payment_status === 'failed' ? 0 : (t.final_cents ?? t.cancel_fee_cents ?? 0);
  const tip = await one(`SELECT provider, provider_ref, amount_cents FROM payments WHERE trip_id = $1 AND kind = 'tip' AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1`, [tripId], c);
  const tipPaid = tip ? t.tip_cents ?? 0 : 0;
  const rows = await q(`SELECT provider_ref, -amount_cents AS cents FROM payments WHERE trip_id = $1 AND kind = 'refund' AND status = 'succeeded'`, [tripId], c);
  const prior = rows.reduce((n: number, r: any) => n + r.cents, 0);
  const left = farePaid + tipPaid - prior;
  if (cents > left) throw bad('refund_too_large', left > 0 ? `Only $${(left / 100).toFixed(2)} is left to refund on this trip` : 'This trip has already been fully refunded', { refundable_cents: Math.max(left, 0) });
  // How much of each part is already refunded: by PaymentIntent when the tip has its own, otherwise fare first.
  const ownTipRef = tip?.provider_ref && tip.provider_ref !== t.payment_ref && !['wallet'].includes(tip.provider_ref);
  const tipRefunded = ownTipRef ? rows.filter((r: any) => r.provider_ref === tip!.provider_ref).reduce((n: number, r: any) => n + r.cents, 0) : Math.max(prior - farePaid, 0);
  const fareRefunded = prior - tipRefunded;
  const farePart = Math.min(cents, Math.max(farePaid - fareRefunded, 0));
  const tipPart = cents - farePart;
  const parts: { cents: number; gst: number; method: string; ref: string | null; which: string }[] = [];
  if (farePart > 0 && t.payment_method === 'card' && t.fare_breakdown?.deposit) {
    // Round 19: a tour fare paid partly by its deposit is refunded against each payment in turn (what's left on each).
    const caps = await q(`SELECT provider_ref, sum(amount_cents)::int cents FROM payments WHERE trip_id = $1 AND kind = 'capture' AND status = 'succeeded' AND provider_ref IS NOT NULL
                          GROUP BY provider_ref ORDER BY min(created_at) DESC`, [tripId], c);
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
  if (cents === left) await c.query(`UPDATE trips SET payment_status = 'refunded' WHERE id = $1`, [t.id]);
  const data = { cents, reason, ...extra, fare_cents: farePart, tip_cents: tipPart, ...(actorId ? {} : { by: 'system' }) };
  await event(c, t.id, 'refund', actorId, data);
  await c.query('INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES ($1,$2,$3,$4,$5)', [actorId, actorId ? 'refund' : 'auto_refund', 'trip', t.id, { cents, reason, ...extra }]);
  return { trip: t, refunded_cents: cents, fare_cents: farePart, tip_cents: tipPart, refundable_cents: left - cents };
}

export function notifyRefund(r: RefundResult, reason: string) {
  void send(r.trip.rider_id, 'refund_issued', { ref: r.trip.ref, cents: r.refunded_cents, reason }, { data: { trip_id: r.trip.id } });
}

export async function refundTrip(tripId: string, cents: number, reason: string, actorId: string | null, extra: Record<string, unknown> = {}) {
  const r = await tx((c) => refundIn(c, tripId, cents, reason, actorId, extra));
  notifyRefund(r, reason);
  return r;
}
