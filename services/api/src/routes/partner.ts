/** Partner portal (cafes etc.): validate & redeem customer reward codes at the counter, sell prepaid vouchers. */
import type { FastifyInstance } from 'fastify';
import { one, q } from '../db.js';
import { requireUser } from '../auth.js';
import { config } from '../config.js';
import { ApiError, bad, forbidden, notFound } from '../lib/errors.js';
import { record, tooMany } from '../lib/rateLimit.js';
import { parse, z } from '../lib/validate.js';
import { darwin, loyaltyReady } from '../lib/loyalty.js';
import { partnerStatement, partnerStats, recentMonths, statementCsv, statementPdf } from '../services/loyalty.js';

export default async function partnerRoutes(app: FastifyInstance) {
  const partnerOf = async (req: any) => {
    const me = await requireUser(req, 'partner', 'admin');
    const pid = me.role === 'admin' ? (req.query?.partner_id ?? req.body?.partner_id ?? me.partner_id) : me.partner_id;
    if (!pid) throw forbidden('No partner business linked to this account');
    return { me, pid };
  };

  // Wrong codes are counted per partner login: stops anyone guessing customers' reward codes or unsold voucher codes.
  const guard = async (userId: string) => {
    if (await tooMany('partner_code_fail', userId, config.rateLimits.partnerCodeFailsPerUser, 3600)) {
      throw new ApiError(429, 'too_many_attempts', 'Too many wrong codes. Try again in an hour, or call DingoGo.');
    }
  };
  const wrong = async (userId: string) => { await record('partner_code_fail', userId); };

  app.get('/partner/me', async (req) => {
    const { pid } = await partnerOf(req);
    const p = await one('SELECT * FROM partners WHERE id = $1', [pid]);
    // "This month" is the Darwin month, and each reward is owed at the rate fixed when it was served (Round 17).
    const st = await partnerStatement(pid, darwin().month);
    const all = await one<{ n: number }>(`SELECT count(*)::int n FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id WHERE r.partner_id = $1 AND rr.status = 'redeemed'`, [pid]);
    const rewards = await q('SELECT * FROM rewards WHERE partner_id = $1 ORDER BY points_cost', [pid]);
    return { partner: p, stats: { this_month: st.redeemed, all_time: all!.n }, rewards, owed_this_month_cents: st.total_cents };
  });

  app.post('/partner/check', async (req) => {
    const { me, pid } = await partnerOf(req);
    const b = parse(z.object({ code: z.string().min(4).max(20) }), req.body);
    await guard(me.id);
    const r = await one(
      `SELECT rr.*, r.title, r.partner_id, split_part(u.name,' ',1) AS customer FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id JOIN users u ON u.id = rr.user_id
       WHERE upper(rr.code) = upper($1)`, [b.code.trim()]);
    if (!r || r.partner_id !== pid) { await wrong(me.id); throw notFound('Code'); }
    return { redemption: r, valid: r.status === 'issued' && new Date(r.expires_at) > new Date() };
  });

  app.post('/partner/redeem', async (req) => {
    const { me, pid } = await partnerOf(req);
    const b = parse(z.object({ code: z.string().min(4).max(20) }), req.body);
    await guard(me.id);
    const r = await one(
      `SELECT rr.*, r.partner_id, r.title FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id WHERE upper(rr.code) = upper($1)`, [b.code.trim()]);
    if (!r || r.partner_id !== pid) { await wrong(me.id); throw notFound('Code'); }
    if (r.status !== 'issued') throw bad('already_redeemed', `This code was already ${r.status}`);
    if (new Date(r.expires_at) < new Date()) {
      await q(`UPDATE reward_redemptions SET status = 'expired' WHERE id = $1`, [r.id]);
      throw bad('expired', 'This code has expired');
    }
    // Only an issued code can be redeemed: two taps at the counter (or two tills) redeem it once, so it's settled once.
    // The café's rate is fixed on the code when it's served: a later change to the rate doesn't reprice it.
    const out = await one(`UPDATE reward_redemptions SET status = 'redeemed', redeemed_at = now(), redeemed_by = $2
                             ${(await loyaltyReady()) ? `, settlement_cents = (SELECT settlement_cents_per_redemption FROM partners WHERE id = $3)` : ''}
                           WHERE id = $1 AND status = 'issued' RETURNING *`, (await loyaltyReady()) ? [r.id, me.id, pid] : [r.id, me.id]);
    if (!out) throw bad('already_redeemed', 'This code was already redeemed');
    return { redemption: { ...out, title: r.title } };
  });

  app.get('/partner/redemptions', async (req) => {
    const { pid } = await partnerOf(req);
    return { items: await q(
      `SELECT rr.code, rr.status, rr.issued_at, rr.redeemed_at, r.title FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id
       WHERE r.partner_id = $1 AND rr.status = 'redeemed' ORDER BY rr.redeemed_at DESC LIMIT 200`, [pid]) };
  });

  /** Round 17: redemption stats (last 6 Darwin months, by reward, customers, repeat customers, codes waiting). */
  app.get('/partner/stats', async (req) => {
    const { pid } = await partnerOf(req);
    return partnerStats(pid);
  });
  /** Monthly settlement statements: the last 12 months with what was served, owed and paid. */
  app.get('/partner/statements', async (req) => {
    const { pid } = await partnerOf(req);
    const months = recentMonths(12);
    const rows = await Promise.all(months.map((m) => partnerStatement(pid, m)));
    return { statements: rows.map(({ lines: _l, ...s }) => s) };
  });
  /** One month's statement, as JSON, CSV or PDF (`format`). */
  app.get('/partner/statements/:month', async (req, reply) => {
    const { pid } = await partnerOf(req);
    const month = String((req.params as any).month);
    const f = String((req.query as any)?.format ?? 'json');
    if (!['json', 'csv', 'pdf'].includes(f)) throw bad('bad_format', 'format is json, csv or pdf');
    const st = await partnerStatement(pid, month);
    if (f === 'json') return { statement: st };
    reply.header('content-type', f === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf');
    reply.header('content-disposition', `attachment; filename="dingogo-rewards-statement-${month}.${f}"`);
    reply.header('cache-control', 'no-store');
    return reply.send(f === 'csv' ? statementCsv(st) : statementPdf(st));
  });

  /** Record the over-the-counter sale of a prepaid DingoGo voucher card. */
  app.post('/partner/vouchers/sell', async (req) => {
    const { me, pid } = await partnerOf(req);
    const b = parse(z.object({ code: z.string().min(4).max(30) }), req.body);
    await guard(me.id);
    const v = await one(`UPDATE gift_vouchers SET sold_at = now(), sold_by_partner = $2 WHERE upper(code) = upper($1) AND sold_at IS NULL AND redeemed_at IS NULL RETURNING *`, [b.code.trim(), pid]);
    if (!v) { await wrong(me.id); throw bad('voucher_invalid', 'Voucher not found or already sold'); }
    return { voucher: v };
  });
}
