/**
 * Round 12 admin: community pricing (concession fares, off by default) and the concession card queue; who is on leave.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { one, q } from '../db.js';
import { requireUser } from '../auth.js';
import { ApiError, bad, notFound } from '../lib/errors.js';
import { parse, z } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { send } from '../services/notify.js';
import {
  COMMUNITY_PRICING_DEFAULTS, CONCESSION_TYPES, LANGUAGE_INFO, LEAVE_KINDS, checkCommunityPricing, communityPending, communityReady, loadCommunityPricing,
} from '../lib/community.js';

const ops = (req: FastifyRequest) => requireUser(req, 'admin', 'dispatcher');
const admin = (req: FastifyRequest) => requireUser(req, 'admin');

export async function saveCommunityPricing(actorId: string, value: unknown) {
  const v = checkCommunityPricing(value);
  await q(`INSERT INTO settings (key, value) VALUES ('community_pricing', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(v)]);
  await audit(actorId, 'setting', 'settings', 'community_pricing', v);
  return v;
}

export default async function communityRoutes(app: FastifyInstance) {
  app.get('/admin/community-pricing', async (req) => {
    await ops(req);
    return { settings: await loadCommunityPricing(), defaults: COMMUNITY_PRICING_DEFAULTS, types: CONCESSION_TYPES, ready: await communityReady() };
  });
  app.put('/admin/community-pricing', async (req) => {
    const me = await admin(req);
    return { settings: await saveCommunityPricing(me.id, req.body) };
  });

  /** Concession cards waiting for a check (or all). Only the last 4 digits are ever stored. */
  app.get('/admin/concessions', async (req) => {
    await ops(req);
    if (!(await communityReady())) return { items: [], ready: false };
    const { status = 'pending' } = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected', 'all']).optional() }), req.query);
    const items = await q(
      `SELECT id, name, phone, concession FROM users WHERE concession IS NOT NULL AND deleted_at IS NULL
         AND ($1 = 'all' OR concession->>'status' = $1) ORDER BY concession->>'applied_at' DESC LIMIT 300`, [status]);
    return { items, ready: true };
  });
  app.post('/admin/concessions/:userId/review', async (req) => {
    const me = await ops(req);
    if (!(await communityReady())) throw new ApiError(503, 'migration_pending', `Concession cards: ${communityPending}`);
    const b = parse(z.object({ status: z.enum(['approved', 'rejected']), note: z.string().max(200).optional() }), req.body);
    if (b.status === 'rejected' && !b.note?.trim()) throw bad('note_required', 'Say why, so the rider knows what to fix');
    const u = await one(`SELECT id, concession FROM users WHERE id = $1`, [(req.params as any).userId]);
    if (!u?.concession) throw notFound('Concession card');
    const card = { ...u.concession, status: b.status, note: b.note ?? null, reviewed_at: new Date().toISOString(), reviewed_by: me.id };
    await q(`UPDATE users SET concession = $2 WHERE id = $1`, [u.id, JSON.stringify(card)]);
    await audit(me.id, 'concession_reviewed', 'user', u.id, { status: b.status, type: card.type });
    void send(u.id, 'concession_reviewed', { approved: b.status === 'approved', note: b.note ?? null });
    return { concession: card };
  });

  /** Drivers on leave now (Sorry Business, cultural business, family). The kind is for ops only. */
  app.get('/admin/drivers/on-leave', async (req) => {
    await ops(req);
    if (!(await communityReady())) return { items: [] };
    const items = await q(`SELECT d.user_id, u.name, d.leave FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.leave IS NOT NULL ORDER BY d.leave->>'from' DESC`);
    return { items: items.map((r) => ({ ...r, label: LEAVE_KINDS[r.leave.kind as keyof typeof LEAVE_KINDS] ?? 'Leave' })) };
  });

  app.get('/admin/languages', async (req) => { await ops(req); return { languages: LANGUAGE_INFO }; });
}
