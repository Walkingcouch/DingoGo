/**
 * Round 24: business and government customers — applications, account set-up, approvals, booking for others, usage, invoices,
 * accounting exports, reminders and recurring trips. Business routes accept the account's members (by role) and DingoGo staff.
 * Needs migration 027 (503 migration_pending before it).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { requireUser } from '../auth.js';
import { config } from '../config.js';
import { bad } from '../lib/errors.js';
import { latLng, parse, z } from '../lib/validate.js';
import { limit } from '../lib/rateLimit.js';
import { audit } from '../lib/audit.js';
import { ACCOUNT_KINDS } from '../lib/community.js';
import { abnValid } from '../lib/tax.js';
import { MEMBER_ROLES, checkBilling } from '../lib/business.js';
import { billingSettings, businessReady, needBusiness } from '../services/businessRules.js';
import { one, q } from '../db.js';
import * as biz from '../services/business.js';

const staff = (req: FastifyRequest) => requireUser(req, 'admin', 'dispatcher');
const admin = (req: FastifyRequest) => requireUser(req, 'admin');
const uuid = z.string().uuid();
const month = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Month looks like 2026-11');
const date = z.string().date();
const money = z.number().int().min(0).max(10_000_000);
function sendFile(reply: FastifyReply, kind: 'csv' | 'pdf', filename: string, body: string | Buffer) {
  reply.header('content-type', kind === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf');
  reply.header('content-disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  reply.header('cache-control', 'no-store');
  return reply.send(body);
}

const traveller = z.union([
  z.object({ self: z.literal(true) }),
  z.object({ member_id: uuid }),
  z.object({ consent_id: uuid }),
  z.object({ name: z.string().trim().min(1).max(80), phone: z.string().max(20) }),
]);
const bizFields = {
  cost_centre_id: uuid.nullable().optional(),
  purpose_code: z.string().trim().max(20).nullable().optional(),
  po_number: z.string().trim().max(40).nullable().optional(),
};
const forBody = z.object({
  account_id: uuid, traveller, service: z.literal('ride').optional(), pickup: latLng, dropoff: latLng,
  scheduled_for: z.string().datetime().nullable().optional(), passengers: z.number().int().min(1).max(7).optional(),
  needs_wheelchair: z.boolean().optional(), assistance_animal: z.boolean().optional(), women_driver_pref: z.boolean().optional(),
  notes: z.string().max(300).optional(), ndis_number: z.string().regex(/^\d{9}$/, 'NDIS number is 9 digits').optional(), ...bizFields,
});
const recurringBody = z.object({
  account_id: uuid, traveller, pickup: latLng, dropoff: latLng,
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7), pickup_time: z.string().max(5), return_time: z.string().max(5).nullable().optional(),
  starts_on: date, ends_on: date.nullable().optional(), skip_holidays: z.boolean().default(true), skip_dates: z.array(date).max(60).default([]),
  dry_run: z.boolean().default(false),
  options: z.object({
    ...bizFields, ndis_number: z.string().regex(/^\d{9}$/, 'NDIS number is 9 digits').optional(), notes: z.string().max(300).optional(),
    needs_wheelchair: z.boolean().optional(), assistance_animal: z.boolean().optional(), passengers: z.number().int().min(1).max(7).optional(),
    women_driver_pref: z.boolean().optional(),
  }).default({}),
});

export default async function businessAccountRoutes(app: FastifyInstance) {
  // ───────────── Applications ─────────────
  /** Website sign-up: creates a pending account that DingoGo checks (per-IP limit like the other public forms). */
  app.post('/public/business-applications', async (req, reply) => {
    // Every try counts (Round 26): checking ABNs one by one would otherwise be free.
    await limit('public_form_ip', req.ip, config.rateLimits.publicFormPerIp, 3600, 'Thanks — we’ve had a lot of messages from this connection. Please try again in an hour, or call us.');
    const b = parse(z.object({
      organisation: z.string().trim().min(2).max(120), kind: z.enum(ACCOUNT_KINDS),
      abn: z.string().transform((s) => s.replace(/\s/g, '')).pipe(z.string().regex(/^\d{11}$/, 'ABN is 11 digits')),
      billing_email: z.string().trim().email().max(200), contact_name: z.string().trim().min(2).max(80), contact_phone: z.string().max(20),
      address: z.string().trim().max(200).optional(), expected_monthly_cents: money.optional(),
      needs: z.array(z.enum(['cost_centres', 'approvals', 'po_numbers', 'ndis', 'recurring', 'parcels'])).max(6).optional(),
      notes: z.string().max(1000).optional(), agree: z.literal(true, { message: 'Agree to the account terms' }),
    }), req.body);
    if (!abnValid(b.abn)) throw bad('invalid_abn', 'That ABN fails the ATO check. Look it up on abr.business.gov.au', { field: 'abn' });
    const row = await biz.apply({ ...b, address: b.address ?? null });
    reply.code(201);
    return { ok: true, ref: row.ref, application_status: row.status };
  });
  app.get('/admin/business/applications', async (req) => {
    await staff(req);
    const { status = 'pending' } = req.query as { status?: string };
    if (!['pending', 'approved', 'declined'].includes(status)) throw bad('bad_status');
    if (!(await businessReady())) return { ready: false, applications: [] };
    return { ready: true, applications: await biz.applications(status) };
  });
  app.post('/admin/business/applications/:id/review', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ approve: z.boolean(), note: z.string().trim().max(300).nullable().optional(), monthly_limit_cents: money.nullable().optional(),
      invoice_terms_days: z.number().int().min(0).max(120).optional(), discount_pct: z.number().min(0).max(50).optional() }), req.body);
    if (!b.approve && !b.note) throw bad('note_required', 'Say why, so the applicant knows', { field: 'note' });
    return biz.review(me, (req.params as any).id, b);
  });

  // ───────────── Account set-up (managers; staff too) ─────────────
  app.get('/business/accounts/:id/setup', async (req) => biz.setup(await requireUser(req), (req.params as any).id));
  app.put('/business/accounts/:id/rules', async (req) => biz.saveRules(await requireUser(req), (req.params as any).id, req.body));
  const ccBody = z.object({ code: z.string().trim().max(20), name: z.string().trim().min(1).max(80), approver_id: uuid.nullable().optional(),
    monthly_budget_cents: money.nullable().optional(), active: z.boolean().optional() });
  app.post('/business/accounts/:id/cost-centres', async (req, reply) => {
    const r = await biz.saveCostCentre(await requireUser(req), (req.params as any).id, null, parse(ccBody, req.body));
    reply.code(201); return r;
  });
  app.patch('/business/accounts/:id/cost-centres/:cc', async (req) =>
    biz.saveCostCentre(await requireUser(req), (req.params as any).id, (req.params as any).cc, parse(ccBody.partial(), req.body)));
  const purposeBody = z.object({ code: z.string().trim().max(20), label: z.string().trim().min(1).max(80), active: z.boolean().optional() });
  app.post('/business/accounts/:id/purposes', async (req, reply) => {
    const r = await biz.savePurpose(await requireUser(req), (req.params as any).id, null, parse(purposeBody, req.body));
    reply.code(201); return r;
  });
  app.patch('/business/accounts/:id/purposes/:pid', async (req) =>
    biz.savePurpose(await requireUser(req), (req.params as any).id, (req.params as any).pid, parse(purposeBody.omit({ code: true }).partial(), req.body)));
  app.post('/business/accounts/:id/members', async (req, reply) => {
    const r = await biz.addMember(await requireUser(req), (req.params as any).id,
      parse(z.object({ phone: z.string().max(20), name: z.string().trim().min(1).max(80), role: z.enum(MEMBER_ROLES).default('member') }), req.body));
    reply.code(201); return r;
  });
  app.delete('/business/accounts/:id/members/:userId', async (req) =>
    biz.removeMember(await requireUser(req), (req.params as any).id, parse(uuid, (req.params as any).userId)));

  // ───────────── Approvals ─────────────
  app.get('/business/approvals', async (req) => biz.pendingApprovals(await requireUser(req), parse(z.object({ account_id: uuid }), req.query).account_id));
  app.post('/business/approvals/:tripId', async (req) =>
    biz.decide(await requireUser(req), parse(uuid, (req.params as any).tripId), parse(z.object({ approve: z.boolean(), note: z.string().trim().max(200).nullable().optional() }), req.body)));

  // ───────────── Booking for someone (or yourself) on the account ─────────────
  app.post('/business/trips/quote', async (req) => biz.quoteFor(await requireUser(req), parse(forBody, req.body)));
  app.post('/business/trips', async (req, reply) => {
    const r = await biz.bookFor(await requireUser(req), parse(forBody, req.body));
    reply.code(201); return r;
  });
  app.get('/business/trips', async (req) => {
    const me = await requireUser(req);
    const f = parse(z.object({ account_id: uuid, month: month.optional(), limit: z.coerce.number().int().min(1).max(500).default(100) }), req.query);
    return biz.accountTrips(me, f.account_id, f);
  });

  // ───────────── Usage and invoices (managers and approvers) ─────────────
  app.get('/business/usage', async (req) => {
    const me = await requireUser(req);
    const f = parse(z.object({ account_id: uuid, month: month.optional() }), req.query);
    return biz.usage(me, f.account_id, f.month);
  });
  app.get('/business/invoices', async (req) => biz.myInvoices(await requireUser(req), parse(z.object({ account_id: uuid }), req.query).account_id));
  app.get('/business/invoices/:id', async (req, reply) => {
    const inv = await biz.myInvoice(await requireUser(req), parse(uuid, (req.params as any).id));
    if ((req.query as any).format === 'pdf') return sendFile(reply, 'pdf', `${inv.number}.pdf`, await biz.invoicePdf(inv));
    return { invoice: inv };
  });

  // ───────────── Recurring trips ─────────────
  app.get('/business/recurring', async (req) => biz.listRecurring(await requireUser(req), parse(z.object({ account_id: uuid }), req.query).account_id));
  app.post('/business/recurring', async (req, reply) => {
    const me = await requireUser(req);
    const b = parse(recurringBody, req.body);
    const r = await biz.createRecurring(me, { ...b, return_time: b.return_time ?? null, ends_on: b.ends_on ?? null });
    if (!b.dry_run) reply.code(201);
    return r;
  });
  app.post('/business/recurring/:id/skip', async (req) =>
    biz.skipDate(await requireUser(req), parse(uuid, (req.params as any).id), parse(z.object({ date }), req.body).date));
  app.post('/business/recurring/:id/stop', async (req) =>
    biz.stopRecurring(await requireUser(req), parse(uuid, (req.params as any).id), parse(z.object({ cancel_booked: z.boolean().default(false) }), req.body ?? {}).cancel_booked));

  // ───────────── Admin: invoices, exports, billing settings ─────────────
  app.get('/admin/business/invoices', async (req) => {
    await staff(req);
    const f = parse(z.object({ month: month.optional(), status: z.enum(['all', 'issued', 'paid', 'void', 'overdue']).default('all'), account_id: uuid.optional() }), req.query);
    if (!(await businessReady())) return { ready: false, invoices: [], summary: { open: 0, open_cents: 0, overdue: 0, overdue_cents: 0 } };
    return { ready: true, ...(await biz.listInvoices({ month: f.month, status: f.status, accountId: f.account_id })) };
  });
  app.post('/admin/business/invoices/run', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ month: month.optional(), account_id: uuid.optional() }), req.body ?? {});
    return biz.issueInvoices({ month: b.month, accountId: b.account_id, actorId: me.id });
  });
  app.get('/admin/business/invoices/export', async (req, reply) => {
    const me = await admin(req);
    const f = parse(z.object({ month, format: z.enum(['xero', 'myob']) }), req.query);
    const csv = await biz.exportInvoices(f.month, f.format);
    await audit(me.id, 'business_invoices_exported', 'settings', 'business_billing', f);
    return sendFile(reply, 'csv', `dingogo-invoices-${f.month}-${f.format}.csv`, csv);
  });
  app.get('/admin/business/invoices/:id', async (req, reply) => {
    await staff(req);
    const inv = await biz.getInvoice(parse(uuid, (req.params as any).id));
    if ((req.query as any).format === 'pdf') return sendFile(reply, 'pdf', `${inv.number}.pdf`, await biz.invoicePdf(inv));
    return { invoice: inv };
  });
  app.post('/admin/business/invoices/:id/paid', async (req) =>
    ({ invoice: await biz.markPaid(await admin(req), parse(uuid, (req.params as any).id), parse(z.object({ paid_on: date.optional(), paid_ref: z.string().trim().max(80).nullable().optional() }), req.body ?? {})) }));
  app.post('/admin/business/invoices/:id/void', async (req) =>
    ({ invoice: await biz.voidInvoice(await admin(req), parse(uuid, (req.params as any).id), parse(z.object({ reason: z.string().trim().min(3).max(200) }), req.body).reason) }));
  app.post('/admin/business/reminders/run', async (req) => {
    const me = await admin(req);
    return biz.runReminders({ actorId: me.id });
  });
  app.get('/admin/business/billing', async (req) => {
    await staff(req);
    return { ready: await businessReady(), settings: await billingSettings() };
  });
  app.put('/admin/business/billing', async (req) => {
    const me = await admin(req);
    await needBusiness();
    const s = checkBilling({ ...(await billingSettings()), ...(req.body && typeof req.body === 'object' ? req.body as object : {}) });
    await q(`INSERT INTO settings (key, value) VALUES ('business_billing', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(s)]);
    (await import('../lib/cache.js')).invalidateConfig();
    await audit(me.id, 'update', 'settings', 'business_billing', s);
    return { settings: s };
  });
  /** Admin view of an account's set-up and recent activity (drawer). */
  app.get('/admin/business/accounts/:id', async (req) => {
    const me = await staff(req);
    const id = parse(uuid, (req.params as any).id);
    const setup = await biz.setup(me, id);
    const recurring = await biz.listRecurring(me, id);
    const a = await one(`SELECT application, applied_at, reviewed_at, review_note, contact_name, contact_phone FROM corporate_accounts WHERE id = $1`, [id]);
    return { ...setup, recurring: recurring.series, application: a };
  });
}
