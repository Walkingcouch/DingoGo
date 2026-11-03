import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { one, q, tx } from '../db.js';
import { requireUser } from '../auth.js';
import { bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { voucherCode } from '../lib/ids.js';
import { searchPlaces } from '../lib/places.js';
import { latLng, parse, z } from '../lib/validate.js';
import { toOps } from '../realtime.js';
import { notify } from '../services/notify.js';
import * as pay from '../services/payments.js';
import * as trips from '../services/trips.js';

const quoteSchema = z.object({
  service: z.string(),
  pickup: latLng,
  dropoff: latLng,
  scheduled_for: z.string().datetime().nullable().optional(),
  promo_code: z.string().max(30).nullable().optional(),
  redeem_points: z.number().int().min(0).optional(),
  corporate_account_id: z.string().uuid().nullable().optional(),
  tour_package_id: z.string().uuid().nullable().optional(),
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
  parcel: z.object({
    size: z.enum(['S', 'M', 'L']),
    weight_kg: z.number().max(25).optional(),
    description: z.string().min(2).max(200),
    declared_value_cents: z.number().int().max(100000).optional(),
    sender_name: z.string().min(1).max(80),
    sender_phone: z.string().min(8).max(20),
    recipient_name: z.string().min(1).max(80),
    recipient_phone: z.string().min(8).max(20),
    instructions: z.string().max(300).optional(),
    leave_unattended: z.boolean().optional(),
    requires_signature: z.boolean().optional(),
    prohibited_ack: z.boolean(),
  }).optional(),
});

export default async function riderRoutes(app: FastifyInstance) {
  app.get('/places/search', async (req) => {
    const { q: s = '' } = req.query as { q?: string };
    return { places: searchPlaces(String(s)) };
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

  /** Tax invoice — rideshare is a taxable supply so every receipt shows ABN + GST. */
  app.get('/trips/:id/receipt', async (req) => {
    const me = await requireUser(req);
    const t = await trips.getTrip((req.params as any).id);
    if (!trips.canView(t, me)) throw notFound('Trip');
    if (t.status !== 'completed' && !t.cancel_fee_cents) throw conflict('no_receipt', 'Receipt available once the trip is complete');
    const total = (t.final_cents ?? t.cancel_fee_cents) + t.tip_cents;
    const biz = await one(`SELECT value FROM settings WHERE key = 'business'`);
    return {
      receipt: {
        title: 'Tax Invoice', supplier: biz?.value ?? {}, trip_ref: t.ref, date: t.completed_at ?? t.cancelled_at,
        service: t.service, from: t.pickup_address, to: t.dropoff_address,
        driver: t.driver?.name, vehicle: t.vehicle?.rego,
        lines: t.fare_breakdown.lines, fare_cents: t.final_cents ?? t.cancel_fee_cents, tip_cents: t.tip_cents,
        total_cents: total, gst_cents: Math.round((total - t.tip_cents) / 11), payment_method: t.payment_method,
        distance_km: Math.round((t.actual_distance_m ?? t.est_distance_m) / 100) / 10,
        co2_saved_kg: Math.round(((t.actual_distance_m ?? t.est_distance_m) / 1000) * 0.18 * 10) / 10, // vs avg petrol car ~180 g/km
      },
    };
  });

  /** Emergency: notifies DingoGo ops + emergency contact. The app also offers a one-tap 000 call. */
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
    const u = await one('SELECT emergency_contact FROM users WHERE id = $1', [me.id]);
    if (u?.emergency_contact?.phone) {
      const { sendSms } = await import('../services/notify.js');
      void sendSms(u.emergency_contact.phone,
        `DingoGo SAFETY ALERT: ${me.name} triggered an emergency alert on trip ${t.ref}. Live location: ${config.publicWebUrl}/track/${t.share_token}`);
    }
    return { alert, share_url: `${config.publicWebUrl}/track/${t.share_token}`, emergency_number: '000' };
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
    const ledger = await q('SELECT points, reason, created_at FROM loyalty_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 30', [me.id]);
    const refs = await one(`SELECT count(*)::int total, count(*) FILTER (WHERE status = 'rewarded')::int rewarded FROM referrals WHERE referrer_id = $1`, [me.id]);
    return {
      points: u.loyalty_points, referral_code: u.referral_code, referral_bonus: config.loyalty.referralBonusPoints,
      referrals: refs, rewards, redemptions: mine, ledger,
      earn_rate: `${config.loyalty.pointsPerDollar} points per $1`, burn_rate: '100 points = $1 off a trip',
    };
  });

  app.post('/loyalty/rewards/:id/redeem', async (req) => {
    const me = await requireUser(req);
    const id = (req.params as any).id;
    return tx(async (c) => {
      const r = await one('SELECT * FROM rewards WHERE id = $1 AND active', [id], c);
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
    const b = parse(z.object({ plan_code: z.string() }), req.body);
    const plan = await one('SELECT * FROM plans WHERE code = $1 AND active', [b.plan_code]);
    if (!plan) throw notFound('Plan');
    const auth = await pay.authorise(plan.price_cents, { description: `DingoGo Pass ${plan.name}` });
    if (!auth.ok) throw bad('payment_failed', auth.error);
    await pay.capture(auth.ref, plan.price_cents);
    await q(`INSERT INTO payments (user_id, provider, provider_ref, kind, amount_cents, gst_cents, status) VALUES ($1,$2,$3,'subscription',$4,$5,'succeeded')`,
      [me.id, auth.provider, auth.ref, plan.price_cents, Math.round(plan.price_cents / 11)]);
    const sub = await one(
      `INSERT INTO subscriptions (user_id, plan_code, status, period_start, period_end, deliveries_used, provider_ref)
       VALUES ($1,$2,'active', now(), now() + interval '1 month', 0, $3)
       ON CONFLICT (user_id) DO UPDATE SET plan_code = $2, status = 'active', period_start = now(), period_end = now() + interval '1 month', deliveries_used = 0, provider_ref = $3
       RETURNING *`, [me.id, plan.code, auth.ref]);
    return { subscription: sub };
  });

  app.delete('/subscriptions', async (req) => {
    const me = await requireUser(req);
    await q(`UPDATE subscriptions SET status = 'cancelled' WHERE user_id = $1`, [me.id]);
    return { ok: true, note: 'Your Pass stays active until the end of the current period.' };
  });

  // ───────────── Payment methods & wallet ─────────────
  app.get('/payment-methods', async (req) => {
    const me = await requireUser(req);
    const u = await one('SELECT wallet_cents FROM users WHERE id = $1', [me.id]);
    return { methods: await q('SELECT id, provider, brand, last4, is_default FROM payment_methods WHERE user_id = $1 ORDER BY created_at', [me.id]), wallet_cents: u.wallet_cents };
  });
  app.post('/payment-methods/setup', async (req) => {
    await requireUser(req);
    return pay.setupIntent();
  });
  /** Called after Stripe confirms the SetupIntent on-device (or in mock mode with a test card). */
  app.post('/payment-methods', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({ provider_ref: z.string(), brand: z.string().max(20), last4: z.string().regex(/^\d{4}$/) }), req.body);
    const n = await one<{ n: number }>('SELECT count(*)::int n FROM payment_methods WHERE user_id = $1', [me.id]);
    const pm = await one(`INSERT INTO payment_methods (user_id, provider, provider_ref, brand, last4, is_default) VALUES ($1,'stripe',$2,$3,$4,$5) RETURNING id, brand, last4, is_default`,
      [me.id, b.provider_ref, b.brand, b.last4, n!.n === 0]);
    return { method: pm };
  });
  app.delete('/payment-methods/:id', async (req) => {
    const me = await requireUser(req);
    await q('DELETE FROM payment_methods WHERE id = $1 AND user_id = $2', [(req.params as any).id, me.id]);
    return { ok: true };
  });
  app.post('/wallet/topup', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({ cents: z.number().int().min(1000).max(50000) }), req.body);
    const auth = await pay.authorise(b.cents, { description: 'DingoGo credit top-up' });
    if (!auth.ok) throw bad('payment_failed', auth.error);
    await pay.capture(auth.ref, b.cents);
    await q(`INSERT INTO payments (user_id, provider, provider_ref, kind, amount_cents, status) VALUES ($1,$2,$3,'topup',$4,'succeeded')`, [me.id, auth.provider, auth.ref, b.cents]);
    const u = await one('UPDATE users SET wallet_cents = wallet_cents + $2 WHERE id = $1 RETURNING wallet_cents', [me.id, b.cents]);
    return { wallet_cents: u.wallet_cents };
  });

  /** Prepaid voucher cards (sold at partner shops / community orgs) for customers without bank cards. */
  app.post('/wallet/voucher', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({ code: z.string().min(6).max(30) }), req.body);
    return tx(async (c) => {
      const v = await one('SELECT * FROM gift_vouchers WHERE upper(code) = upper($1) FOR UPDATE', [b.code.trim()], c);
      if (!v) throw bad('voucher_invalid', 'Voucher code not found');
      if (v.redeemed_at) throw bad('voucher_used', 'This voucher has already been used');
      if (v.expires_at && new Date(v.expires_at) < new Date()) throw bad('voucher_expired', 'This voucher has expired');
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
      trip_id: z.string().uuid().optional(), category: z.enum(['lost_item', 'fare', 'safety', 'driver', 'parcel', 'accessibility', 'app', 'other']),
      subject: z.string().min(3).max(120), message: z.string().min(5).max(2000),
    }), req.body);
    if (b.trip_id) {
      const t = await trips.getTrip(b.trip_id);
      if (!trips.canView(t, me)) throw forbidden();
    }
    const t = await one(`INSERT INTO support_tickets (user_id, trip_id, category, subject, message) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [me.id, b.trip_id ?? null, b.category, b.subject, b.message]);
    toOps('support.new', t);
    void notify(me.id, 'We got your message', `Ticket #${t.id.slice(0, 8)} — our team will reply soon.`, { ticket_id: t.id }, 'account');
    reply.code(201);
    return { ticket: t };
  });
  app.get('/support', async (req) => {
    const me = await requireUser(req);
    return { tickets: await q('SELECT * FROM support_tickets WHERE user_id = $1 ORDER BY created_at DESC', [me.id]) };
  });

  app.get('/tours', async () => ({ tours: await q('SELECT * FROM tour_packages WHERE active ORDER BY price_cents') }));
}
