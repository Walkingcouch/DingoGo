/**
 * Round 17 — rider growth and loyalty routes: points history and bonus opt-ins, gift vouchers bought online (Stripe-ready, mock
 * otherwise), and the admin side (programme settings, the scheduled run, win-back, café settlements, targeted promo grants).
 * Café stats and statements live in routes/partner.ts. Without migration 021 the new writes answer 503 `migration_pending`.
 */
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { one, q, tx } from '../db.js';
import { requireUser } from '../auth.js';
import { audit } from '../lib/audit.js';
import { ApiError, bad, notFound } from '../lib/errors.js';
import { voucherCode } from '../lib/ids.js';
import { GIFT_CARD_MIN_DAYS, GIFT_VALUES_CENTS, darwin, loyaltyReady } from '../lib/loyalty.js';
import { record, tooMany } from '../lib/rateLimit.js';
import { longDate } from '../lib/tax.js';
import { parse, z } from '../lib/validate.js';
import { sendSmsT } from '../services/notify.js';
import * as pay from '../services/payments.js';
import { e164 } from '../services/sms.js';
import * as trips from '../services/trips.js';
import * as L from '../services/loyalty.js';

const ops = (req: FastifyRequest) => requireUser(req, 'admin', 'dispatcher');
const admin = (req: FastifyRequest) => requireUser(req, 'admin');
const idemKey = (req: FastifyRequest) => {
  const k = req.headers['idempotency-key'];
  return typeof k === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(k) ? k : null;
};
const MONTH = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month looks like 2026-11');
const MD = z.string().regex(/^(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/, 'Birthday looks like 05-31 (month-day)');
const PHONE = z.string().trim().regex(/^(\+?61|0)4\d{2}\s?\d{3}\s?\d{3}$|^(\+?61|0)4\d{8}$/, 'Enter an Australian mobile number');
/** Gift vouchers bought in the app: 5 a day per rider (a stolen card can't be turned into a pile of codes). */
const GIFT_BUYS_PER_DAY = 5;

export default async function loyaltyRoutes(app: FastifyInstance) {
  // ───────────── Rider ─────────────
  app.get('/loyalty/history', async (req) => {
    const me = await requireUser(req);
    const before = Number((req.query as any)?.before);
    return L.history(me.id, Number.isInteger(before) && before > 0 ? before : null);
  });

  app.put('/loyalty/profile', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({ birthday_md: MD.nullable().optional(), birthday_opt_in: z.boolean().optional(), streak_opt_in: z.boolean().optional() }), req.body);
    return { profile: await L.saveProfile(me.id, b) };
  });

  app.get('/gift-vouchers', async (req) => {
    const me = await requireUser(req);
    return { vouchers: await L.myGifts(me.id), values_cents: GIFT_VALUES_CENTS, ready: await loyaltyReady(), valid_years: 3 };
  });

  /** Buy DingoGo credit as a gift with the saved card. The code can be texted to the person, or printed as a card with a QR code
   *  for someone without a phone. Idempotent with an Idempotency-Key (a retry doesn't buy two). */
  app.post('/gift-vouchers', async (req, reply) => {
    const me = await requireUser(req);
    const b = parse(z.object({
      value_cents: z.number().int().refine((v) => GIFT_VALUES_CENTS.includes(v), `Choose ${GIFT_VALUES_CENTS.map((c) => `$${c / 100}`).join(', ')}`),
      from_name: z.string().trim().max(60).optional(), recipient_name: z.string().trim().max(60).optional(), message: z.string().trim().max(140).optional(),
      send_to: PHONE.optional(),
    }), req.body);
    if (!(await loyaltyReady())) throw L.pending();
    if (await tooMany('gift_buy', me.id, GIFT_BUYS_PER_DAY, 86400)) throw new ApiError(429, 'too_many_attempts', `You can buy up to ${GIFT_BUYS_PER_DAY} gift vouchers a day. Call DingoGo for more.`);
    await pay.requireCardOnFile(me.id);
    const key = `gift-${me.id}-${b.value_cents}-${idemKey(req) ?? crypto.randomUUID()}`;
    const r = await pay.charge({ userId: me.id, amountCents: b.value_cents, description: 'DingoGo gift voucher', key, metadata: { user_id: me.id, kind: 'gift_voucher' } });
    if (!r.ok) throw trips.payError(r);
    const out = await tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`gift_voucher:${r.ref}`]);
      const had = await one('SELECT code, value_cents, from_name, recipient_name, message, created_at, expires_at FROM gift_vouchers WHERE payment_ref = $1', [r.ref], c);
      if (had) return { voucher: had, replayed: true };
      // A gift voucher is a voucher, not a supply: GST is in the fares it's spent on, so none here.
      await c.query(`INSERT INTO payments (user_id, provider, provider_ref, kind, amount_cents, gst_cents, status) VALUES ($1,$2,$3,'gift_voucher',$4,0,'succeeded')`,
        [me.id, r.provider, r.ref, b.value_cents]);
      const v = await one(
        `INSERT INTO gift_vouchers (code, value_cents, batch, sold_at, expires_at, purchased_by, from_name, recipient_name, message, payment_ref, needs_activation)
         VALUES ($1,$2,'online', now(), now() + ($3 || ' days')::interval, $4,$5,$6,$7,$8, false)
         RETURNING code, value_cents, from_name, recipient_name, message, created_at, expires_at`,
        [voucherCode() + voucherCode().slice(2, 6), b.value_cents, String(GIFT_CARD_MIN_DAYS), me.id, b.from_name || null, b.recipient_name || null, b.message || null, r.ref], c);
      return { voucher: v, replayed: false };
    });
    if (!out.replayed) await record('gift_buy', me.id);
    let texted = false;
    if (b.send_to && !out.replayed) {
      const from = b.from_name || me.name?.split(/\s+/)[0] || 'Someone';
      const s = await sendSmsT(e164(b.send_to), 'gift_voucher', { from, cents: out.voucher.value_cents, code: out.voucher.code, expires: longDate(out.voucher.expires_at) }, { userId: null });
      texted = s.sent || s.status === 'dev_log';
    }
    reply.code(out.replayed ? 200 : 201);
    return { ...out, texted };
  });

  // ───────────── Admin ─────────────
  app.get('/admin/loyalty/settings', async (req) => {
    await ops(req);
    return { settings: await L.loadLoyalty(), ready: await loyaltyReady() };
  });
  app.put('/admin/loyalty/settings', async (req) => {
    const me = await admin(req);
    const s = await L.saveLoyalty(req.body ?? {});
    await audit(me.id, 'loyalty_settings', 'settings', 'loyalty', s);
    return { settings: s };
  });
  /** Run expiry warnings, expiry, birthday bonuses and stale café codes now (it also runs from the dispatcher every few hours). */
  app.post('/admin/loyalty/run', async (req) => {
    const me = await admin(req);
    const out = await L.runLoyalty();
    await audit(me.id, 'loyalty_run', 'loyalty_ledger', 'run', out);
    return out;
  });
  app.get('/admin/loyalty/overview', async (req) => {
    await ops(req);
    const s = await L.loadLoyalty();
    const out = await one<any>(
      `SELECT (SELECT coalesce(sum(loyalty_points),0)::int FROM users WHERE deleted_at IS NULL) AS points_outstanding,
              (SELECT coalesce(sum(points),0)::int FROM loyalty_ledger WHERE points > 0 AND created_at > now() - interval '30 days') AS earned_30d,
              (SELECT coalesce(-sum(points),0)::int FROM loyalty_ledger WHERE points < 0 AND reason <> 'expired' AND created_at > now() - interval '30 days') AS used_30d,
              (SELECT coalesce(-sum(points),0)::int FROM loyalty_ledger WHERE reason = 'expired' AND created_at > now() - interval '30 days') AS expired_30d,
              (SELECT count(*)::int FROM referrals WHERE status = 'rewarded' AND rewarded_at > now() - interval '30 days') AS referrals_30d`);
    const tiers = await q<any>(
      `SELECT n, count(*)::int riders FROM (SELECT count(t.id)::int n FROM users u LEFT JOIN trips t ON t.rider_id = u.id AND t.status = 'completed' AND t.completed_at > now() - interval '12 months'
         WHERE u.role = 'rider' AND u.deleted_at IS NULL GROUP BY u.id) x GROUP BY n`);
    const byTier = s.tiers.map((t, i) => ({ ...t, riders: tiers.filter((r) => r.n >= t.min_trips && (i === s.tiers.length - 1 || r.n < s.tiers[i + 1].min_trips)).reduce((a, r) => a + r.riders, 0) }));
    // 100 points = $1: what the outstanding points would cost DingoGo if all were used.
    return { ...out, liability_cents: out.points_outstanding, tiers: byTier, ready: await loyaltyReady() };
  });

  app.get('/admin/loyalty/winback', async (req) => {
    await ops(req);
    const d = Number((req.query as any)?.days);
    return L.winbackPreview(Number.isInteger(d) && d >= 14 && d <= 365 ? d : undefined);
  });
  app.post('/admin/loyalty/winback', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({
      days: z.number().int().min(14).max(365).optional(), title: z.string().trim().min(2).max(60), body: z.string().trim().min(2).max(200),
      promo_code: z.string().trim().max(30).nullable().optional(), channel: z.enum(['app', 'sms']).default('app'),
    }), req.body);
    if (b.channel === 'sms') {
      const { smsConfigured, replyableSender } = await import('../services/sms.js');
      if (!smsConfigured() || !replyableSender()) throw bad('sms_marketing_unavailable', 'Offers by text need Twilio and a sender number that takes STOP replies');
    }
    return L.winbackSend(b, me.id);
  });

  app.get('/admin/partner-settlements', async (req) => {
    await ops(req);
    const m = (req.query as any)?.month;
    const month = m ? parse(MONTH, m) : darwin().month;
    return { month, open: month >= darwin().month, partners: await L.settlementsFor(month), months: L.recentMonths(12) };
  });
  app.post('/admin/partner-settlements', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ partner_id: z.string().uuid(), month: MONTH, paid_ref: z.string().trim().max(60).nullable().optional() }), req.body);
    const row = await L.markPaid(b.partner_id, b.month, b.paid_ref ?? null, me.id);
    await audit(me.id, 'partner_settlement_paid', 'partner_settlements', row.id, { partner_id: b.partner_id, month: b.month, amount_cents: row.amount_cents, paid_ref: b.paid_ref ?? null });
    return { settlement: row };
  });
  app.get('/admin/partner-settlements/:partner/:month', async (req, reply) => {
    await ops(req);
    const { partner, month } = req.params as any;
    if (!/^[0-9a-f-]{36}$/i.test(partner)) throw notFound('Partner');
    const st = await L.partnerStatement(partner, month);
    const f = String((req.query as any)?.format ?? 'json');
    if (f === 'json') return { statement: st };
    if (!['csv', 'pdf'].includes(f)) throw bad('bad_format', 'format is json, csv or pdf');
    reply.header('content-type', f === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf');
    reply.header('content-disposition', `attachment; filename="rewards-statement-${month}.${f}"`);
    return reply.send(f === 'csv' ? L.statementCsv(st) : L.statementPdf(st));
  });

  /** Targeted promo codes: give the code to riders by mobile number (win-back grants them automatically). */
  app.get('/admin/promos/:code/grants', async (req) => {
    await ops(req);
    if (!(await loyaltyReady())) throw L.pending();
    return { grants: await q(`SELECT g.user_id, u.name, g.reason, g.granted_at FROM promo_grants g JOIN users u ON u.id = g.user_id WHERE g.code = $1 ORDER BY g.granted_at DESC LIMIT 500`,
      [String((req.params as any).code)]) };
  });
  app.post('/admin/promos/:code/grants', async (req) => {
    const me = await admin(req);
    if (!(await loyaltyReady())) throw L.pending();
    const b = parse(z.object({ phones: z.array(z.string().max(20)).min(1).max(500) }), req.body);
    const p = await one('SELECT code FROM promo_codes WHERE code = $1', [String((req.params as any).code)]);
    if (!p) throw notFound('Promo code');
    const phones = [...new Set(b.phones.map((x) => e164(x)))];
    const users = await q<{ id: string; phone: string }>('SELECT id, phone FROM users WHERE phone = ANY($1) AND deleted_at IS NULL', [phones]);
    for (const u of users) await q(`INSERT INTO promo_grants (code, user_id, reason) VALUES ($1,$2,'admin') ON CONFLICT DO NOTHING`, [p.code, u.id]);
    await audit(me.id, 'promo_grants', 'promo_grants', p.code, { granted: users.length });
    const found = new Set(users.map((u) => u.phone));
    return { granted: users.length, not_found: phones.filter((x) => !found.has(x)) };
  });
}
