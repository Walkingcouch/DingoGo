import { textContactsOnAlert } from '../services/safety.js';
import { logError } from '../lib/log.js';
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { one, q, tx, type Q } from '../db.js';
import { requireUser } from '../auth.js';
import { ApiError, bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { voucherCode } from '../lib/ids.js';
import { searchPlaces } from '../lib/places.js';
import { latLng, parse, z } from '../lib/validate.js';
import { toOps } from '../realtime.js';
import { send, sendSmsT } from '../services/notify.js';
import * as pay from '../services/payments.js';
import * as trips from '../services/trips.js';
import { reattempt } from '../services/courier.js';
import * as loyalty from '../services/loyalty.js';
import { ledgerLabel } from '../lib/loyalty.js';

/** Client Idempotency-Key header (a double tap or a retry after a lost reply sends the same one). */
const idemKey = (req: FastifyRequest) => {
  const k = req.headers['idempotency-key'];
  return typeof k === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(k) ? k : null;
};

/** Record a one-off card payment (top-up, Pass) once, even when the same Stripe payment comes back for a replayed request. */
async function recordOnce(c: Q, ref: string, kind: string) {
  await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`${kind}:${ref}`]);
  return !!(await one('SELECT 1 FROM payments WHERE provider_ref = $1 AND kind = $2', [ref, kind], c));
}

const quoteSchema = z.object({
  service: z.string().max(40),
  pickup: latLng,
  dropoff: latLng,
  scheduled_for: z.string().datetime().nullable().optional(),
  promo_code: z.string().max(30).nullable().optional(),
  redeem_points: z.number().int().min(0).optional(),
  corporate_account_id: z.string().uuid().nullable().optional(),
  tour_package_id: z.string().uuid().nullable().optional(),
});

/** Parcel details. Sizes, weights, phones and the checklist are checked in lib/courier.ts (`checkParcel`). */
export const parcelSchema = z.object({
  size: z.enum(['S', 'M', 'L']),
  weight_kg: z.number().positive().max(25).optional(),
  description: z.string().min(2).max(200),
  declared_value_cents: z.number().int().min(0).max(100000).optional(),
  sender_name: z.string().min(1).max(80),
  sender_phone: z.string().min(8).max(20),
  recipient_name: z.string().min(1).max(80),
  recipient_phone: z.string().min(8).max(20),
  instructions: z.string().max(300).optional(),
  leave_unattended: z.boolean().optional(),
  requires_signature: z.boolean().optional(),
  safe_place: z.string().max(120).optional(),
  customer_ref: z.string().max(40).optional(),
  // Every line of the prohibited items check (new apps), or the single tick box (older apps).
  prohibited_items: z.array(z.string().max(30)).max(20).optional(),
  prohibited_ack: z.boolean().default(false),
});

const tripSchema = quoteSchema.extend({
  kind: z.enum(['ride', 'courier']),
  passengers: z.number().int().min(1).max(7).optional(),
  has_pet: z.boolean().optional(),
  pet_details: z.string().max(200).optional(),
  needs_wheelchair: z.boolean().optional(),
  assistance_animal: z.boolean().optional(),
  notes: z.string().max(300).optional(),
  payment_method: z.enum(['card', 'cash', 'corporate', 'wallet']),
  women_driver_pref: z.boolean().optional(),
  ndis_number: z.string().regex(/^\d{9}$/, 'NDIS number is 9 digits').optional(),
  parcel: parcelSchema.optional(),
  pickup_window_end: z.string().datetime().nullable().optional(),
});

export default async function riderRoutes(app: FastifyInstance) {
  app.get('/places/search', async (req) => {
    const { q: s = '' } = req.query as { q?: string };
    return { places: searchPlaces(String(s).slice(0, 100)) };
  });

  app.post('/quotes', async (req) => {
    const me = await requireUser(req);
    const body = parse(quoteSchema, req.body);
    const { quote, route, zone } = await trips.buildQuote(me.id, body);
    return { quote, route: { distance_m: route.distance_m, duration_s: route.duration_s, source: route.source, geometry: route.geometry }, zone: { id: zone.id, name: zone.name } };
  });

  app.post('/trips', async (req, reply) => {
    const me = await requireUser(req);
    const body = parse(tripSchema, req.body);
    const t = await trips.createTrip(me.id, body);
    reply.code(201);
    return { trip: trips.viewFor(t, me) };
  });

  app.get('/trips', async (req) => {
    const me = await requireUser(req);
    const { status } = req.query as { status?: string };
    const rows = await q(
      `SELECT id, ref, kind, service, status, pickup_address, dropoff_address, requested_at, scheduled_for, completed_at,
              quote_cents, final_cents, tip_cents, payment_method, rider_rating
       FROM trips WHERE rider_id = $1 ${status === 'active' ? `AND status IN ('scheduled','requested','accepted','arrived','in_progress')` : ''}
       ORDER BY coalesce(scheduled_for, requested_at) DESC LIMIT 100`, [me.id]);
    return { trips: rows };
  });

  app.get('/trips/:id', async (req) => {
    const me = await requireUser(req);
    const t = await trips.getTrip((req.params as any).id);
    if (!trips.canView(t, me)) throw notFound('Trip');
    return { trip: trips.viewFor(t, me) };
  });

  app.get('/trips/:id/track', async (req) => {
    const me = await requireUser(req);
    const t = await trips.getTrip((req.params as any).id);
    if (!trips.canView(t, me)) throw notFound('Trip');
    return { points: await q('SELECT lat, lng, at FROM trip_track WHERE trip_id = $1 ORDER BY at', [t.id]) };
  });

  app.post('/trips/:id/cancel', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({ reason: z.string().max(200).optional() }), req.body);
    return { trip: trips.viewFor(await trips.cancelTrip(me, (req.params as any).id, b.reason), me) };
  });

  /** A parcel that came back to the sender: book another try (same parcel and addresses, new PIN, normal fare). */
  app.post('/trips/:id/reattempt', async (req, reply) => {
    const me = await requireUser(req);
    const b = parse(z.object({
      scheduled_for: z.string().datetime().nullable().optional(), pickup_window_end: z.string().datetime().nullable().optional(),
      payment_method: z.enum(['card', 'cash', 'corporate', 'wallet']).optional(), leave_unattended: z.boolean().optional(),
      safe_place: z.string().max(120).optional(), instructions: z.string().max(300).optional(),
    }), req.body ?? {});
    const t = await reattempt(me.id, (req.params as any).id, b);
    reply.code(201);
    return { trip: trips.viewFor(t, me) };
  });

  app.post('/trips/:id/rate', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({ rating: z.number().int().min(1).max(5), feedback: z.string().max(500).optional() }), req.body);
    return trips.rateTrip(me, (req.params as any).id, b.rating, b.feedback);
  });

  app.post('/trips/:id/tip', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({ cents: z.number().int() }), req.body);
    return trips.addTip(me.id, (req.params as any).id, b.cents);
  });

  /** Tax invoice — rideshare is a taxable supply so every receipt shows ABN + GST. Refunds are listed as adjustments and the
   *  totals are net of them; tips are not part of the supply (no GST), matching the GST report. */
  app.get('/trips/:id/receipt', async (req) => {
    const me = await requireUser(req);
    const t = await trips.getTrip((req.params as any).id);
    if (!trips.canView(t, me)) throw notFound('Trip');
    if (t.status !== 'completed' && !t.cancel_fee_cents) throw conflict('no_receipt', 'Receipt available once the trip is complete');
    const fee = t.status !== 'completed';
    const fare = fee ? t.cancel_fee_cents : t.final_cents;
    const biz = (await one(`SELECT value FROM settings WHERE key = 'business'`))?.value ?? {};
    const refunds = await q(`SELECT created_at AS at, -amount_cents AS cents, -gst_cents AS gst_cents FROM payments
                             WHERE trip_id = $1 AND kind = 'refund' AND status = 'succeeded' ORDER BY created_at`, [t.id]);
    const refunded = refunds.reduce((n: number, r: any) => n + r.cents, 0);
    const refundedGst = refunds.reduce((n: number, r: any) => n + r.gst_cents, 0);
    const gst = Math.round(fare / 11);
    const netGst = gst - refundedGst;
    const total = fare + t.tip_cents;
    const lines = fee ? [{ label: 'Cancellation fee', cents: fare }] : t.fare_breakdown.lines;
    // Fares are the driver's taxable supply (each driver is registered for GST; see the GST report): DingoGo issues the
    // invoice on the driver's behalf, so it carries the driver's ABN as well as DingoGo's.
    const drv = t.driver_id ? await one('SELECT abn, gst_registered FROM drivers WHERE user_id = $1', [t.driver_id]) : null;
    return {
      receipt: {
        title: refunded > 0 ? 'Tax Invoice (adjusted)' : 'Tax Invoice', invoice_number: t.ref,
        supplier: biz, supplier_abn: biz.abn ?? null,
        supplied_by: t.driver ? { name: t.driver.name, abn: drv?.abn ?? null, gst_registered: !!drv?.gst_registered } : null,
        issued_on_behalf: !!t.driver, trip_ref: t.ref, date: t.completed_at ?? t.cancelled_at, issued_at: new Date().toISOString(),
        customer: { name: t.rider?.name ?? null, ndis_number: t.ndis_number ?? null },
        service: t.service, from: t.pickup_address, to: t.dropoff_address, cancellation_fee: fee,
        driver: t.driver?.name, vehicle: t.vehicle?.rego, vehicle_fuel_type: t.vehicle?.fuel_type ?? null, vehicle_is_ev: !!t.vehicle?.is_ev,
        lines, fare_cents: fare, tip_cents: t.tip_cents,
        total_cents: total, gst_cents: gst,
        refunds, refunded_cents: refunded, net_total_cents: total - refunded, net_gst_cents: netGst,
        gst_note: `Total includes GST of $${(netGst / 100).toFixed(2)}`,
        tip_note: t.tip_cents > 0 ? 'Tips go 100% to your driver and are not part of the taxable fare (no GST).' : null,
        payment_method: t.payment_method, payment_status: t.payment_status,
        distance_km: Math.round((t.actual_distance_m ?? t.est_distance_m) / 100) / 10,
        // CO₂ saved only for trips actually done in an electric car (vs avg petrol car ~180 g/km); null otherwise.
        co2_saved_kg: !fee && t.vehicle?.is_ev ? Math.round(((t.actual_distance_m ?? t.est_distance_m) / 1000) * 0.18 * 10) / 10 : null,
      },
    };
  });

  /** Pay a trip whose card payment didn't go through, with the rider's current default card. */
  app.post('/trips/:id/pay', async (req) => {
    const me = await requireUser(req);
    const r = await trips.retryTripPayment((req.params as any).id, me);
    if (!r.ok) throw new ApiError(402, 'payment_failed', r.error ?? 'Your card could not be charged', { reason: r.code });
    return r;
  });

  /** Emergency: notifies DingoGo ops + trusted/emergency contacts. The app also offers a one-tap 000 call. */
  app.post('/trips/:id/sos', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({ lat: z.number().optional(), lng: z.number().optional(), message: z.string().max(300).optional() }), req.body);
    const t = await trips.getTrip((req.params as any).id);
    if (!trips.canView(t, me)) throw notFound('Trip');
    const alert = await one(
      `INSERT INTO sos_alerts (trip_id, user_id, role, lat, lng, message) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [t.id, me.id, me.id === t.driver_id ? 'driver' : 'rider', b.lat ?? null, b.lng ?? null, b.message ?? null]);
    await trips.event(await import('../db.js').then((m) => m.pool), t.id, 'sos', me.id, b);
    toOps('sos.new', { ...alert, trip_ref: t.ref, user_name: me.name });
    // Every trusted contact and the emergency contact get the live trip link (a driver's contacts get the car's position only).
    const texted = await textContactsOnAlert(me.id, 'sos', t, b);
    return { alert, share_url: `${config.publicWebUrl}/track/${t.share_token}`, emergency_number: '000', contacts_texted: texted };
  });

  // ───────────── Loyalty & rewards ─────────────
  app.get('/loyalty', async (req) => {
    const me = await requireUser(req);
    const u = await one('SELECT loyalty_points, referral_code FROM users WHERE id = $1', [me.id]);
    const rewards = await q(
      `SELECT r.*, p.name AS partner_name, p.address AS partner_address, p.aboriginal_owned FROM rewards r LEFT JOIN partners p ON p.id = r.partner_id
       WHERE r.active AND (p.id IS NULL OR p.active) ORDER BY r.points_cost`);
    const mine = await q(
      `SELECT rr.*, r.title, p.name AS partner_name FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id
       LEFT JOIN partners p ON p.id = r.partner_id WHERE rr.user_id = $1 ORDER BY rr.issued_at DESC LIMIT 30`, [me.id]);
    const ledger = (await q('SELECT points, reason, created_at FROM loyalty_ledger WHERE user_id = $1 ORDER BY id DESC LIMIT 30', [me.id]))
      .map((l: any) => ({ ...l, label: ledgerLabel(l.reason) }));
    const refs = await one(`SELECT count(*)::int total, count(*) FILTER (WHERE status = 'rewarded')::int rewarded FROM referrals WHERE referrer_id = $1`, [me.id]);
    const sum = await loyalty.summary(me.id, u.loyalty_points);
    const mult = sum.tier.multiplier;
    return {
      points: u.loyalty_points, referral_code: u.referral_code, referral_bonus: sum.referral.bonus_points,
      referral_min_fare_cents: sum.referral.min_fare_cents,
      referrals: refs, rewards, redemptions: mine, ledger, ...sum,
      earn_rate: `${Math.round(config.loyalty.pointsPerDollar * mult * 100) / 100} points per $1${mult > 1 ? ` (${sum.tier.name})` : ''}`, burn_rate: '100 points = $1 off a trip',
    };
  });

  app.post('/loyalty/rewards/:id/redeem', async (req) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    return tx(async (c) => {
      // A café reward from a partner that has been switched off can't be swapped for (nobody would serve it).
      const r = await one('SELECT r.* FROM rewards r LEFT JOIN partners p ON p.id = r.partner_id WHERE r.id = $1 AND r.active AND (p.id IS NULL OR p.active)', [id], c);
      if (!r) throw notFound('Reward');
      const u = await one('SELECT loyalty_points FROM users WHERE id = $1 FOR UPDATE', [me.id], c);
      if (u.loyalty_points < r.points_cost) throw bad('not_enough_points', `You need ${r.points_cost - u.loyalty_points} more points`);
      await c.query('UPDATE users SET loyalty_points = loyalty_points - $2 WHERE id = $1', [me.id, r.points_cost]);
      await c.query(`INSERT INTO loyalty_ledger (user_id, points, reason) VALUES ($1,$2,$3)`, [me.id, -r.points_cost, `reward:${r.title}`]);
      if (r.kind === 'ride_credit') {
        await c.query('UPDATE users SET wallet_cents = wallet_cents + $2 WHERE id = $1', [me.id, r.credit_cents]);
        return { redemption: { kind: 'ride_credit', credit_cents: r.credit_cents } };
      }
      const red = await one(
        `INSERT INTO reward_redemptions (reward_id, user_id, code, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' days')::interval) RETURNING *`,
        [r.id, me.id, voucherCode(), String(config.loyalty.redemptionValidDays)], c);
      return { redemption: { ...red, title: r.title } };
    });
  });

  // ───────────── Subscriptions (DingoGo Pass) ─────────────
  app.get('/plans', async () => ({ plans: await q('SELECT * FROM plans WHERE active ORDER BY price_cents') }));

  app.post('/subscriptions', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({ plan_code: z.string().max(40) }), req.body);
    const plan = await one('SELECT * FROM plans WHERE code = $1 AND active', [b.plan_code]);
    if (!plan) throw notFound('Plan');
    await pay.requireCardOnFile(me.id);
    const r = await pay.charge({ userId: me.id, amountCents: plan.price_cents, description: `DingoGo Pass ${plan.name}`,
      key: `pass-${me.id}-${plan.code}-${idemKey(req) ?? crypto.randomUUID()}`, metadata: { user_id: me.id, kind: 'subscription' } });
    if (!r.ok) throw trips.payError(r);
    return tx(async (c) => {
      // A replayed request (same Idempotency-Key) gets the same payment back from Stripe: don't start the month again.
      if (await recordOnce(c, r.ref, 'subscription')) return { subscription: await one('SELECT * FROM subscriptions WHERE user_id = $1', [me.id], c), replayed: true };
      await c.query(`INSERT INTO payments (user_id, provider, provider_ref, kind, amount_cents, gst_cents, status) VALUES ($1,$2,$3,'subscription',$4,$5,'succeeded')`,
        [me.id, r.provider, r.ref, plan.price_cents, Math.round(plan.price_cents / 11)]);
      const sub = await one(
        `INSERT INTO subscriptions (user_id, plan_code, status, period_start, period_end, deliveries_used, provider_ref)
         VALUES ($1,$2,'active', now(), now() + interval '1 month', 0, $3)
         ON CONFLICT (user_id) DO UPDATE SET plan_code = $2, status = 'active', period_start = now(), period_end = now() + interval '1 month', deliveries_used = 0, provider_ref = $3
         RETURNING *`, [me.id, plan.code, r.ref], c);
      return { subscription: sub };
    });
  });

  app.delete('/subscriptions', async (req) => {
    const me = await requireUser(req);
    await q(`UPDATE subscriptions SET status = 'cancelled' WHERE user_id = $1`, [me.id]);
    return { ok: true, note: 'Your Pass stays active until the end of the current period.' };
  });

  // ───────────── Payment methods & wallet ─────────────
  /** Saved cards. `cards.mode`: stripe (add with Stripe Elements using `publishable_key`), test (mock test card) or off (coming soon). */
  app.get('/payment-methods', async (req) => {
    const me = await requireUser(req);
    const u = await one('SELECT wallet_cents FROM users WHERE id = $1', [me.id]);
    const mode = await pay.cardModeFor(me.id);
    const base = `FROM payment_methods WHERE user_id = $1 AND ${pay.usableCardsSql()} ORDER BY is_default DESC, created_at`;
    const methods = mode === 'off' ? [] : await q(`SELECT id, provider, brand, last4, is_default, exp_month, exp_year ${base}`, [me.id])
      .catch(() => q(`SELECT id, provider, brand, last4, is_default ${base}`, [me.id]));   // before migration 014
    return { methods, wallet_cents: u.wallet_cents, cards: { mode, publishable_key: mode === 'stripe' ? config.stripe.publishableKey || null : null } };
  });
  app.post('/payment-methods/setup', async (req) => {
    const me = await requireUser(req);
    await pay.requireCards(me.id);
    return pay.setupIntent(me.id);
  });
  /** Called after the app confirms the SetupIntent (Stripe), or with a test card (test mode). With Stripe the card details
   *  come from Stripe, never from the request, and the SetupIntent must belong to this rider. */
  app.post('/payment-methods', async (req) => {
    const me = await requireUser(req);
    const mode = await pay.requireCards(me.id);
    const count = await one<{ n: number }>(`SELECT count(*)::int n FROM payment_methods WHERE user_id = $1 AND ${pay.usableCardsSql()}`, [me.id]);
    if (count!.n >= 10) throw bad('too_many_cards', 'You can save up to 10 cards. Remove one first.');
    if (mode === 'stripe') {
      const b = parse(z.object({ setup_intent_id: z.string().regex(/^seti_[A-Za-z0-9_]{6,200}$/) }), req.body);
      const card = await pay.cardFromSetup(me.id, b.setup_intent_id);
      const out = await tx(async (c) => {
        await c.query('SELECT id FROM users WHERE id = $1 FOR UPDATE', [me.id]);
        const same = await one(`SELECT id, brand, last4, is_default, exp_month, exp_year, provider_ref FROM payment_methods
                                WHERE user_id = $1 AND provider = 'stripe' AND (provider_ref = $2 OR (fingerprint IS NOT NULL AND fingerprint = $3))`,
          [me.id, card.ref, card.fingerprint], c);
        if (same) return { method: same, duplicate: same.provider_ref !== card.ref };
        const n = await one<{ n: number }>(`SELECT count(*)::int n FROM payment_methods WHERE user_id = $1 AND ${pay.usableCardsSql()}`, [me.id], c);
        const pm = await one(`INSERT INTO payment_methods (user_id, provider, provider_ref, brand, last4, is_default, fingerprint, exp_month, exp_year)
                              VALUES ($1,'stripe',$2,$3,$4,$5,$6,$7,$8) RETURNING id, brand, last4, is_default, exp_month, exp_year`,
          [me.id, card.ref, card.brand, card.last4, n!.n === 0, card.fingerprint, card.exp_month, card.exp_year], c);
        return { method: pm, duplicate: false };
      });
      // The same card saved twice: keep the first, let Stripe forget the copy.
      if (out.duplicate) await pay.detachCard(card.ref).catch(() => undefined);
      const { provider_ref: _r, ...method } = out.method as any;
      return { method, already_saved: 'provider_ref' in out.method };
    }
    const b = parse(z.object({ provider_ref: z.string().min(1).max(255), brand: z.string().max(20), last4: z.string().regex(/^\d{4}$/) }), req.body);
    const pm = await one(`INSERT INTO payment_methods (user_id, provider, provider_ref, brand, last4, is_default) VALUES ($1,'mock',$2,$3,$4,$5) RETURNING id, brand, last4, is_default`,
      [me.id, b.provider_ref, b.brand, b.last4, count!.n === 0]);
    return { method: pm };
  });
  app.post('/payment-methods/:id/default', async (req) => {
    const me = await requireUser(req);
    const id = String((req.params as any).id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Card');
    return tx(async (c) => {
      const pm = await one(`SELECT id FROM payment_methods WHERE id = $1 AND user_id = $2 AND ${pay.usableCardsSql()}`, [id, me.id], c);
      if (!pm) throw notFound('Card');
      await c.query('UPDATE payment_methods SET is_default = (id = $2) WHERE user_id = $1', [me.id, id]);
      return { ok: true };
    });
  });
  app.delete('/payment-methods/:id', async (req) => {
    const me = await requireUser(req);
    const id = String((req.params as any).id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) return { ok: true };
    const gone = await tx(async (c) => {
      const d = await one('DELETE FROM payment_methods WHERE id = $1 AND user_id = $2 RETURNING provider, provider_ref, is_default', [id, me.id], c);
      // Removing the default card makes the newest remaining card the default (booking always has a card to hold).
      if (d?.is_default) {
        await c.query(`UPDATE payment_methods SET is_default = true WHERE id = (SELECT id FROM payment_methods WHERE user_id = $1 AND ${pay.usableCardsSql()}
                       ORDER BY created_at DESC LIMIT 1)`, [me.id]);
      }
      return d;
    });
    if (gone?.provider === 'stripe') await pay.detachCard(gone.provider_ref).catch((e) => logError('detach card', e));
    return { ok: true };
  });
  app.post('/wallet/topup', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({ cents: z.number().int().min(1000).max(50000) }), req.body);
    await pay.requireCardOnFile(me.id);
    const r = await pay.charge({ userId: me.id, amountCents: b.cents, description: 'DingoGo credit top-up',
      key: `topup-${me.id}-${b.cents}-${idemKey(req) ?? crypto.randomUUID()}`, metadata: { user_id: me.id, kind: 'topup' } });
    if (!r.ok) throw trips.payError(r);
    return tx(async (c) => {
      const replayed = await recordOnce(c, r.ref, 'topup');
      if (!replayed) {
        await c.query(`INSERT INTO payments (user_id, provider, provider_ref, kind, amount_cents, status) VALUES ($1,$2,$3,'topup',$4,'succeeded')`, [me.id, r.provider, r.ref, b.cents]);
        await c.query('UPDATE users SET wallet_cents = wallet_cents + $2 WHERE id = $1', [me.id, b.cents]);
      }
      const u = await one('SELECT wallet_cents FROM users WHERE id = $1', [me.id], c);
      return { wallet_cents: u.wallet_cents, ...(replayed ? { replayed: true } : {}) };
    });
  });

  /** Prepaid voucher cards (sold at partner shops / community orgs) for customers without bank cards. */
  app.post('/wallet/voucher', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({ code: z.string().min(6).max(30) }), req.body);
    const fails = await one(`SELECT count(*)::int n FROM audit_log WHERE actor_id = $1 AND action = 'voucher_fail' AND at > now() - interval '1 hour'`, [me.id]);
    if (fails!.n >= 5) throw new ApiError(429, 'too_many_attempts', 'Too many wrong codes. Try again in an hour.');
    // Log a wrong code outside the redeem transaction — inside it, the throw would roll the log back and the limit would never trip.
    const exists = await one('SELECT 1 FROM gift_vouchers WHERE upper(code) = upper($1)', [b.code.trim()]);
    if (!exists) {
      await q(`INSERT INTO audit_log (actor_id, action, entity) VALUES ($1, 'voucher_fail', 'gift_vouchers')`, [me.id]);
      throw bad('voucher_invalid', 'Voucher code not found');
    }
    return tx(async (c) => {
      const v = await one('SELECT * FROM gift_vouchers WHERE upper(code) = upper($1) FOR UPDATE', [b.code.trim()], c);
      if (!v) throw bad('voucher_invalid', 'Voucher code not found');
      if (v.redeemed_at) throw bad('voucher_used', 'This voucher has already been used');
      if (v.expires_at && new Date(v.expires_at) < new Date()) throw bad('voucher_expired', 'This voucher has expired');
      // Cards printed for selling at a shop work only once the shop has sold them (a card taken off the counter isn't credit).
      if (v.needs_activation && !v.sold_at) throw bad('voucher_not_sold', "This card hasn't been activated yet. Ask the shop where you bought it, or call DingoGo.");
      await c.query('UPDATE gift_vouchers SET redeemed_by = $2, redeemed_at = now() WHERE code = $1', [v.code, me.id]);
      const u = await one('UPDATE users SET wallet_cents = wallet_cents + $2 WHERE id = $1 RETURNING wallet_cents', [me.id, v.value_cents], c);
      await c.query(`INSERT INTO payments (user_id, provider, provider_ref, kind, amount_cents, status) VALUES ($1,'voucher',$2,'topup',$3,'succeeded')`, [me.id, v.code, v.value_cents]);
      return { wallet_cents: u.wallet_cents, added_cents: v.value_cents };
    });
  });

  // ───────────── Support ─────────────
  app.post('/support', async (req, reply) => {
    const me = await requireUser(req);
    const b = parse(z.object({
      trip_id: z.string().uuid().optional(), category: z.enum(['lost_item', 'fare', 'safety', 'driver', 'parcel', 'accessibility', 'assistance_animal_refused', 'app', 'other']),
      subject: z.string().min(3).max(120), message: z.string().min(5).max(2000),
    }), req.body);
    let trip: any = null;
    if (b.trip_id) {
      trip = await trips.getTrip(b.trip_id);
      if (!trips.canView(trip, me)) throw forbidden();
    }
    const t = await one(`INSERT INTO support_tickets (user_id, trip_id, category, subject, message) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [me.id, b.trip_id ?? null, b.category, b.subject, b.message]);
    toOps('support.new', t);
    // A rider saying a driver refused their assistance animal (unlawful under the DDA) gets the same compliance review as a driver
    // declining or cancelling such a trip, even if the rider didn't tick "assistance animal" when booking (the driver saw the dog and left).
    if (b.category === 'assistance_animal_refused' && trip && trip.rider_id === me.id) {
      const flagged = await trips.flagRiderReportedRefusal(trip, b.message);
      if (flagged) t.flagged = true;
    }
    void send(me.id, 'ticket_received', { id: t.id }, { data: { ticket_id: t.id } });
    reply.code(201);
    return { ticket: t };
  });
  app.get('/support', async (req) => {
    const me = await requireUser(req);
    return { tickets: await q('SELECT * FROM support_tickets WHERE user_id = $1 ORDER BY created_at DESC', [me.id]) };
  });

  app.get('/tours', async () => ({ tours: await q('SELECT * FROM tour_packages WHERE active ORDER BY price_cents') }));
}
