/**
 * Stripe webhook events. Each event id is applied once (payment_events), in the same transaction as its effect, so Stripe's
 * retries and replays are harmless and a failure rolls both back (Stripe then retries).
 *
 * What we act on:
 *  - payment_intent.succeeded            a capture/charge that was still pending is marked paid
 *  - payment_intent.payment_failed       recorded on the trip, ops alerted
 *  - payment_intent.canceled             a hold that lapsed (7-day limit) or was cancelled outside DingoGo: the trip no longer
 *                                        counts it as held, so the fare is charged afresh at the end
 *  - charge.refunded                     refunds made in the Stripe dashboard are recorded (once, by amount refunded so far)
 *  - charge.dispute.*                    dispute (chargeback) kept as a payments row, trip event, ops alert
 */
import type pg from 'pg';
import { one, q, tx } from '../db.js';
import { ApiError } from '../lib/errors.js';
import { toOps } from '../realtime.js';
import { event } from './trips.js';

const LIVE = ['scheduled', 'requested', 'accepted', 'arrived', 'in_progress'];

export async function handleStripeEvent(evt: any): Promise<{ duplicate?: boolean; handled: string }> {
  if (!evt || typeof evt.id !== 'string' || typeof evt.type !== 'string') throw new ApiError(400, 'bad_payload', 'Not a Stripe event');
  const obj = evt.data?.object ?? {};
  const after: (() => void)[] = [];
  try {
    const out = await tx(async (c) => {
      const ins = await one(
        `INSERT INTO payment_events (id, provider, type, object_ref, data) VALUES ($1,'stripe',$2,$3,$4) ON CONFLICT (id) DO NOTHING RETURNING id`,
        [evt.id, evt.type, obj.id ?? null, JSON.stringify({ status: obj.status ?? null, amount: obj.amount ?? null, livemode: !!evt.livemode })], c);
      if (!ins) return { duplicate: true, handled: 'duplicate' };
      return { handled: await apply(c, evt.type, obj, after) };
    });
    for (const f of after) f();
    return out;
  } catch (e: any) {
    if (e?.code === '42P01') throw new ApiError(503, 'migration_pending', 'Payment events table not created yet');
    throw e;
  }
}

/** The payments row a PaymentIntent belongs to (fare capture, tip, top-up, Pass). */
async function paymentFor(c: pg.PoolClient, pi: string) {
  return one(`SELECT trip_id, user_id, kind FROM payments WHERE provider_ref = $1 AND kind IN ('capture','tip','topup','subscription','authorise')
              ORDER BY (kind = 'authorise'), created_at DESC LIMIT 1`, [pi], c);
}

async function apply(c: pg.PoolClient, type: string, obj: any, after: (() => void)[]): Promise<string> {
  switch (type) {
    case 'payment_intent.succeeded': {
      await c.query(`UPDATE payments SET status = 'succeeded' WHERE provider_ref = $1 AND kind IN ('capture','tip','topup','subscription') AND status = 'pending'`, [obj.id]);
      return 'payment_succeeded';
    }
    case 'payment_intent.amount_capturable_updated':
      return 'ignored';
    case 'payment_intent.payment_failed': {
      const t = await one(`SELECT id, ref FROM trips WHERE payment_ref = $1 OR id::text = $2 LIMIT 1`, [obj.id, String(obj.metadata?.trip_id ?? '')], c);
      if (!t) return 'no_trip';
      const reason = obj.last_payment_error?.decline_code ?? obj.last_payment_error?.code ?? null;
      await event(c, t.id, 'payment_failed', null, { stage: 'stripe', payment_intent: obj.id, reason });
      after.push(() => toOps('payment.failed', { trip_id: t.id, ref: t.ref, reason }));
      return 'payment_failed';
    }
    case 'payment_intent.canceled': {
      const r = await q(`UPDATE trips SET payment_status = 'none' WHERE payment_ref = $1 AND payment_status = 'authorised' AND status::text = ANY($2) RETURNING id, ref`,
        [obj.id, LIVE], c);
      for (const t of r) {
        await event(c, t.id, 'hold_lapsed', null, { payment_intent: obj.id, reason: obj.cancellation_reason ?? null });
        after.push(() => toOps('payment.hold_lapsed', { trip_id: t.id, ref: t.ref, reason: obj.cancellation_reason ?? null }));
      }
      return r.length ? 'hold_lapsed' : 'ignored';
    }
    case 'charge.refunded': {
      const pi = typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id;
      if (!pi) return 'ignored';
      const p = await paymentFor(c, pi);
      if (!p) return 'unknown_payment';
      if (p.trip_id) await c.query('SELECT id FROM trips WHERE id = $1 FOR UPDATE', [p.trip_id]);   // same lock as admin refunds
      else await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`refund:${pi}`]);
      const rec = await one<{ cents: number }>(`SELECT coalesce(-sum(amount_cents),0)::int cents FROM payments WHERE provider_ref = $1 AND kind = 'refund' AND status = 'succeeded'`, [pi], c);
      const diff = Number(obj.amount_refunded ?? 0) - rec!.cents;
      if (diff <= 0) return 'already_recorded';
      const gst = p.kind === 'capture' || p.kind === 'subscription' ? Math.round(diff / 11) : 0;
      await c.query(`INSERT INTO payments (trip_id, user_id, provider, provider_ref, kind, amount_cents, gst_cents, status) VALUES ($1,$2,'stripe',$3,'refund',$4,$5,'succeeded')`,
        [p.trip_id, p.user_id, pi, -diff, -gst]);
      if (p.kind === 'topup') await c.query('UPDATE users SET wallet_cents = greatest(wallet_cents - $2, 0) WHERE id = $1', [p.user_id, diff]);
      if (p.trip_id) {
        await event(c, p.trip_id, 'refund', null, { cents: diff, source: 'stripe' });
        const t = await one('SELECT final_cents, cancel_fee_cents, tip_cents FROM trips WHERE id = $1', [p.trip_id], c);
        const all = await one<{ cents: number }>(`SELECT coalesce(-sum(amount_cents),0)::int cents FROM payments WHERE trip_id = $1 AND kind = 'refund' AND status = 'succeeded'`, [p.trip_id], c);
        if (all!.cents >= (t.final_cents ?? t.cancel_fee_cents ?? 0) + (t.tip_cents ?? 0)) await c.query(`UPDATE trips SET payment_status = 'refunded' WHERE id = $1`, [p.trip_id]);
      }
      await c.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES (NULL, 'stripe_refund', $1, $2, $3)`,
        [p.trip_id ? 'trip' : 'payment', p.trip_id ?? pi, { cents: diff, payment_intent: pi }]);
      return 'refund_recorded';
    }
    case 'charge.dispute.created': case 'charge.dispute.updated': case 'charge.dispute.closed': case 'charge.dispute.funds_withdrawn': case 'charge.dispute.funds_reinstated': {
      const pi = typeof obj.payment_intent === 'string' ? obj.payment_intent : obj.payment_intent?.id;
      const p = pi ? await paymentFor(c, pi) : null;
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`dispute:${obj.id}`]);
      const upd = await c.query(`UPDATE payments SET status = $2 WHERE kind = 'dispute' AND provider_ref = $1`, [obj.id, String(obj.status ?? 'open')]);
      if (!upd.rowCount) {
        await c.query(`INSERT INTO payments (trip_id, user_id, provider, provider_ref, kind, amount_cents, status) VALUES ($1,$2,'stripe',$3,'dispute',$4,$5)`,
          [p?.trip_id ?? null, p?.user_id ?? null, obj.id, -Number(obj.amount ?? 0), String(obj.status ?? 'open')]);
      }
      const stage = type === 'charge.dispute.created' ? 'dispute_opened' : type === 'charge.dispute.closed' ? 'dispute_closed' : 'dispute_updated';
      if (p?.trip_id) await event(c, p.trip_id, stage, null, { dispute: obj.id, status: obj.status ?? null, reason: obj.reason ?? null, cents: obj.amount ?? null });
      await c.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES (NULL, $1, $2, $3, $4)`,
        [stage, p?.trip_id ? 'trip' : 'payment', p?.trip_id ?? obj.id, { dispute: obj.id, status: obj.status ?? null, reason: obj.reason ?? null, cents: obj.amount ?? null }]);
      const ref = p?.trip_id ? (await one('SELECT ref FROM trips WHERE id = $1', [p.trip_id], c))?.ref : null;
      after.push(() => toOps('payment.dispute', { trip_id: p?.trip_id ?? null, ref, status: obj.status ?? null, reason: obj.reason ?? null, cents: obj.amount ?? null, stage }));
      return stage;
    }
    default:
      return 'ignored';
  }
}
