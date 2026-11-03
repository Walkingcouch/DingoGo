/** Partner portal (cafes etc.): validate & redeem customer reward codes at the counter, sell prepaid vouchers. */
import type { FastifyInstance } from 'fastify';
import { one, q } from '../db.js';
import { requireUser } from '../auth.js';
import { bad, forbidden, notFound } from '../lib/errors.js';
import { parse, z } from '../lib/validate.js';

export default async function partnerRoutes(app: FastifyInstance) {
  const partnerOf = async (req: any) => {
    const me = await requireUser(req, 'partner', 'admin');
    const pid = me.role === 'admin' ? (req.query?.partner_id ?? req.body?.partner_id ?? me.partner_id) : me.partner_id;
    if (!pid) throw forbidden('No partner business linked to this account');
    return { me, pid };
  };

  app.get('/partner/me', async (req) => {
    const { pid } = await partnerOf(req);
    const p = await one('SELECT * FROM partners WHERE id = $1', [pid]);
    const stats = await one(
      `SELECT count(*) FILTER (WHERE rr.status = 'redeemed' AND rr.redeemed_at > date_trunc('month', now()))::int this_month,
              count(*) FILTER (WHERE rr.status = 'redeemed')::int all_time
       FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id WHERE r.partner_id = $1`, [pid]);
    const rewards = await q('SELECT * FROM rewards WHERE partner_id = $1 ORDER BY points_cost', [pid]);
    return { partner: p, stats, rewards, owed_this_month_cents: stats!.this_month * (p?.settlement_cents_per_redemption ?? 0) };
  });

  app.post('/partner/check', async (req) => {
    const { pid } = await partnerOf(req);
    const b = parse(z.object({ code: z.string().min(4).max(20) }), req.body);
    const r = await one(
      `SELECT rr.*, r.title, r.partner_id, split_part(u.name,' ',1) AS customer FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id JOIN users u ON u.id = rr.user_id
       WHERE upper(rr.code) = upper($1)`, [b.code.trim()]);
    if (!r || r.partner_id !== pid) throw notFound('Code');
    return { redemption: r, valid: r.status === 'issued' && new Date(r.expires_at) > new Date() };
  });

  app.post('/partner/redeem', async (req) => {
    const { me, pid } = await partnerOf(req);
    const b = parse(z.object({ code: z.string().min(4).max(20) }), req.body);
    const r = await one(
      `SELECT rr.*, r.partner_id, r.title FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id WHERE upper(rr.code) = upper($1)`, [b.code.trim()]);
    if (!r || r.partner_id !== pid) throw notFound('Code');
    if (r.status !== 'issued') throw bad('already_redeemed', `This code was already ${r.status}`);
    if (new Date(r.expires_at) < new Date()) {
      await q(`UPDATE reward_redemptions SET status = 'expired' WHERE id = $1`, [r.id]);
      throw bad('expired', 'This code has expired');
    }
    const out = await one(`UPDATE reward_redemptions SET status = 'redeemed', redeemed_at = now(), redeemed_by = $2 WHERE id = $1 RETURNING *`, [r.id, me.id]);
    return { redemption: { ...out, title: r.title } };
  });

  app.get('/partner/redemptions', async (req) => {
    const { pid } = await partnerOf(req);
    return { items: await q(
      `SELECT rr.code, rr.status, rr.issued_at, rr.redeemed_at, r.title FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id
       WHERE r.partner_id = $1 AND rr.status = 'redeemed' ORDER BY rr.redeemed_at DESC LIMIT 200`, [pid]) };
  });

  /** Record the over-the-counter sale of a prepaid DingoGo voucher card. */
  app.post('/partner/vouchers/sell', async (req) => {
    const { pid } = await partnerOf(req);
    const b = parse(z.object({ code: z.string() }), req.body);
    const v = await one(`UPDATE gift_vouchers SET sold_at = now(), sold_by_partner = $2 WHERE upper(code) = upper($1) AND sold_at IS NULL AND redeemed_at IS NULL RETURNING *`, [b.code.trim(), pid]);
    if (!v) throw bad('voucher_invalid', 'Voucher not found or already sold');
    return { voucher: v };
  });
}
