/**
 * Round 22: customer support and dispute resolution.
 *   Customers (riders and drivers): POST/GET /support, GET /support/:id, POST /support/:id/messages, POST /support/:id/rating,
 *     GET /trips/:id/help, POST /trips/:id/help/fare-review, POST /trips/:id/help/lost-item, POST /trips/:id/help/found-item,
 *     GET /driver/lost-items, POST /lost-items/:id/respond (driver), POST /lost-items/:id/return (rider).
 *   Desk (admin, dispatcher): GET /admin/support, GET/PATCH /admin/support/:id, POST /admin/support/:id/messages,
 *     GET /admin/support/staff, canned replies, GET /admin/lost-items, PATCH /admin/lost-items/:id.
 *   Admin only: GET/PUT /admin/support/policy, GET /admin/trips/:id/evidence-pack.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireUser } from '../auth.js';
import { audit } from '../lib/audit.js';
import { notFound } from '../lib/errors.js';
import { latLng, parse, z } from '../lib/validate.js';
import { CATEGORIES, DEFAULT_SUPPORT_POLICY, LOST_STATUSES, PRIORITIES } from '../lib/support.js';
import * as support from '../services/support.js';
import { evidencePack, evidencePdf } from '../services/evidence.js';

const ops = (req: FastifyRequest) => requireUser(req, 'admin', 'dispatcher');
const admin = (req: FastifyRequest) => requireUser(req, 'admin');
const id = (req: FastifyRequest) => (req.params as any).id as string;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const tripId = (req: FastifyRequest) => { const v = id(req); if (!UUID.test(v)) throw notFound('Trip'); return v; };
const body = (min: number, max: number) => z.string().trim().min(min).max(max);
const STATUS = z.enum(['open', 'pending', 'resolved']);

export default async function supportRoutes(app: FastifyInstance) {
  // ───────────── Customers ─────────────
  app.post('/support', async (req, reply) => {
    const me = await requireUser(req);
    const b = parse(z.object({
      trip_id: z.string().uuid().optional(), category: z.enum(CATEGORIES),
      subject: z.string().min(3).max(120), message: z.string().min(5).max(2000),
    }), req.body);
    const ticket = await support.openTicket(me, b);
    reply.code(201);
    return { ticket };
  });
  app.get('/support', async (req) => support.myTickets(await requireUser(req)));
  app.get('/support/:id', async (req) => support.myThread(id(req), await requireUser(req)));
  app.post('/support/:id/messages', async (req, reply) => {
    const me = await requireUser(req);
    const b = parse(z.object({ body: body(1, 2000) }), req.body);
    const r = await support.customerReply(id(req), me, b.body);
    reply.code(201);
    return r;
  });
  app.post('/support/:id/rating', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({ score: z.number().int().min(1).max(5), comment: z.string().max(500).optional() }), req.body);
    return support.rateTicket(id(req), me, b.score, b.comment);
  });

  app.get('/trips/:id/help', async (req) => support.tripHelp(tripId(req), await requireUser(req)));
  app.post('/trips/:id/help/fare-review', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({ message: z.string().max(2000).optional() }), req.body ?? {});
    return support.fareReview(tripId(req), me, b.message);
  });
  app.post('/trips/:id/help/lost-item', async (req, reply) => {
    const me = await requireUser(req);
    const b = parse(z.object({ description: body(3, 500) }), req.body);
    const r = await support.reportLost(tripId(req), me, b.description);
    reply.code(201);
    return r;
  });
  app.post('/trips/:id/help/found-item', async (req, reply) => {
    const me = await requireUser(req, 'driver');
    const b = parse(z.object({ description: body(3, 500), note: z.string().max(300).optional(), handover: latLng.optional() }), req.body);
    const r = await support.reportFound(tripId(req), me, b);
    reply.code(201);
    return r;
  });
  app.get('/driver/lost-items', async (req) => support.driverLostItems(await requireUser(req, 'driver')));
  app.post('/lost-items/:id/respond', async (req) => {
    const me = await requireUser(req, 'driver');
    const b = parse(z.object({ found: z.boolean(), note: z.string().max(300).optional(), handover: latLng.optional() }), req.body);
    return support.respondLost(id(req), me, b);
  });
  app.post('/lost-items/:id/return', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({
      method: z.enum(['courier', 'collect']), dropoff: latLng.optional(), payment_method: z.enum(['card', 'wallet']).optional(),
      instructions: z.string().max(300).optional(),
    }), req.body);
    return support.arrangeReturn(id(req), me, b);
  });

  // ───────────── Desk ─────────────
  app.get('/admin/support', async (req) => {
    const me = await ops(req);
    const qs = parse(z.object({ view: z.enum(['open', 'mine', 'unassigned', 'overdue', 'resolved', 'all']).optional(), q: z.string().max(80).optional(),
      category: z.enum(CATEGORIES).optional() }), req.query);
    return support.staffQueue(me, qs);
  });
  app.get('/admin/support/staff', async (req) => { await ops(req); return { items: await support.staffMembers() }; });
  app.get('/admin/support/policy', async (req) => {
    await ops(req);
    return { policy: await support.supportPolicy(), defaults: DEFAULT_SUPPORT_POLICY };
  });
  app.put('/admin/support/policy', async (req) => {
    const me = await admin(req);
    return { policy: await support.saveSupportPolicy(me.id, req.body) };
  });
  app.get('/admin/support/canned', async (req) => { await ops(req); return support.cannedList(); });
  const canned = z.object({ title: body(2, 80).optional(), body: body(5, 2000).optional(), category: z.enum(CATEGORIES).nullable().optional(), active: z.boolean().optional() });
  app.post('/admin/support/canned', async (req, reply) => {
    const me = await admin(req);
    const item = await support.cannedSave(me, null, parse(canned, req.body));
    reply.code(201);
    return { item };
  });
  app.patch('/admin/support/canned/:id', async (req) => {
    const me = await admin(req);
    return { item: await support.cannedSave(me, id(req), parse(canned, req.body)) };
  });
  app.delete('/admin/support/canned/:id', async (req) => support.cannedDelete(await admin(req), id(req)));

  app.get('/admin/support/:id', async (req) => { await ops(req); return support.staffTicket(id(req)); });
  app.patch('/admin/support/:id', async (req) => {
    const me = await ops(req);
    const b = parse(z.object({ status: STATUS.optional(), priority: z.enum(PRIORITIES).optional(), assigned_to: z.string().uuid().nullable().optional(),
      resolution: z.string().max(2000).optional() }), req.body);
    return { item: await support.staffUpdate(id(req), me, b) };
  });
  app.post('/admin/support/:id/messages', async (req, reply) => {
    const me = await ops(req);
    const b = parse(z.object({ body: body(1, 4000), internal: z.boolean().optional(), status: STATUS.optional(), canned_id: z.string().uuid().optional() }), req.body);
    const r = await support.staffReply(id(req), me, b);
    reply.code(201);
    return r;
  });

  app.get('/admin/lost-items', async (req) => {
    await ops(req);
    const qs = parse(z.object({ status: z.enum(['open', 'all']).optional() }), req.query);
    return support.adminLostItems(qs);
  });
  app.patch('/admin/lost-items/:id', async (req) => {
    const me = await ops(req);
    const b = parse(z.object({ status: z.enum(LOST_STATUSES), note: z.string().max(300).optional() }), req.body);
    return support.adminUpdateLost(id(req), me, b);
  });

  /** Chargeback evidence: trip, proof of service, timeline, GPS track, chat, receipt and payments. Audited (personal data). */
  app.get('/admin/trips/:id/evidence-pack', async (req, reply) => {
    const me = await admin(req);
    const qs = parse(z.object({ format: z.enum(['json', 'pdf']).optional() }), req.query);
    const pack = await evidencePack(tripId(req));
    await audit(me.id, 'evidence_pack', 'trip', tripId(req), { format: qs.format ?? 'json' });
    reply.header('cache-control', 'no-store');
    if (qs.format === 'pdf') {
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `attachment; filename="dingogo-evidence-${pack.trip.ref}.pdf"`);
      return reply.send(evidencePdf(pack));
    }
    if (qs.format === 'json') reply.header('content-disposition', `attachment; filename="dingogo-evidence-${pack.trip.ref}.json"`);
    return { pack };
  });
}
