/**
 * Round 16: tax, compliance and reporting endpoints.
 * Drivers: tax details (for the ATO's SERR), quarterly GST statement (BAS worksheet) and DingoGo's tax invoice for fees.
 * Riders: monthly NDIS invoice for trips booked with their NDIS number.
 * Admin: DingoGo's BAS worksheet, SERR report and missing details, levy returns and lodgements, NDIS invoices and bulk claim
 * file, record retention, privacy (APP) request register. Every download is audited. JSON by default; `format=csv|pdf`.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { one, q } from '../db.js';
import { requireUser } from '../auth.js';
import { bad, notFound } from '../lib/errors.js';
import { isoDay, parse, z } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { toCsv } from '../lib/csv.js';
import { notify } from '../services/notify.js';
import {
  abnValid, AU_STATES, checkNdis, checkRetention, darwinNow, halfPeriod, missingSellerDetails, monthPeriod, quarterPeriod, SELLER_TYPES, taxReady,
} from '../lib/tax.js';
import {
  basCsv, basPdf, business, dingogoBas, driverStatement, feeInvoice, feeInvoicePdf, levyReturn, levyReturnCsv, levyReturnPdf, levyReturns,
  missingDetails, ndisBulkClaimCsv, ndisInvoiceCsv, ndisInvoicePdf, ndisInvoices, ndisSettings, needTax, PRIVACY_CHANNELS, PRIVACY_KINDS,
  recordLodgement, recordPrivacyRequest, retentionPolicy, runRetention, serrCsv, serrReport, serrView, statementCsv, statementPdf,
} from '../services/tax.js';

const admin = (req: FastifyRequest) => requireUser(req, 'admin');
const fmt = (req: FastifyRequest) => {
  const f = String((req.query as any)?.format ?? 'json');
  if (!['json', 'csv', 'pdf'].includes(f)) throw bad('bad_format', 'format is json, csv or pdf');
  return f as 'json' | 'csv' | 'pdf';
};
function sendFile(reply: FastifyReply, kind: 'csv' | 'pdf', filename: string, body: string | Buffer) {
  reply.header('content-type', kind === 'csv' ? 'text/csv; charset=utf-8' : 'application/pdf');
  reply.header('content-disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  reply.header('cache-control', 'no-store');
  return reply.send(body);
}
const DETAILS = z.object({
  seller_type: z.enum(SELLER_TYPES).optional(),
  given_name: z.string().trim().max(80).nullable().optional(), family_name: z.string().trim().max(80).nullable().optional(),
  date_of_birth: isoDay('Date of birth looks like 1990-05-31').nullable().optional(),
  business_name: z.string().trim().max(120).nullable().optional(),
  address_line: z.string().trim().max(120).nullable().optional(), suburb: z.string().trim().max(60).nullable().optional(),
  postcode: z.string().regex(/^\d{4}$/, 'Postcode is 4 digits').nullable().optional(), address_state: z.enum(AU_STATES).nullable().optional(),
  abn: z.string().transform((s) => s.replace(/\s/g, '')).pipe(z.string().regex(/^\d{11}$/, 'ABN is 11 digits')).optional(),
  gst_registered: z.boolean().optional(), email: z.string().email().max(120).optional(),
});
const DETAIL_COLS = ['seller_type', 'given_name', 'family_name', 'date_of_birth', 'business_name', 'address_line', 'suburb', 'postcode', 'address_state'];

async function myDetails(id: string) {
  const ready = await taxReady();
  const d = await one(`SELECT d.abn, d.gst_registered, d.bank_bsb IS NOT NULL AND d.bank_account IS NOT NULL AS has_bank, d.bank_bsb, d.bank_account, u.email, u.phone
                       ${ready ? `, ${DETAIL_COLS.map((c) => `d.${c}`).join(', ')}, d.tax_details_updated_at` : ''}
                       FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.user_id = $1`, [id]);
  if (!d) throw notFound('Driver');
  if (d.date_of_birth instanceof Date) d.date_of_birth = d.date_of_birth.toISOString().slice(0, 10);
  const missing = ready ? missingSellerDetails(d) : [];
  delete d.bank_bsb; delete d.bank_account;
  return { details: { ...d, abn_ok: abnValid(d.abn) }, missing, ready,
    why: 'The ATO’s Sharing Economy Reporting Regime makes DingoGo report what each driver earned, twice a year, with these details. They are only used for that and for your tax invoices.' };
}

export default async function taxRoutes(app: FastifyInstance) {
  // ───────────── Driver ─────────────
  app.get('/driver/tax-details', async (req) => myDetails((await requireUser(req, 'driver')).id));
  app.put('/driver/tax-details', async (req) => {
    const me = await requireUser(req, 'driver');
    const b = parse(DETAILS, req.body);
    if (b.abn && !abnValid(b.abn)) throw bad('invalid_abn', 'That ABN doesn’t pass the ATO check. Look it up on abr.business.gov.au', { field: 'abn' });
    if (b.date_of_birth) {
      const age = (Date.now() - Date.parse(b.date_of_birth)) / (365.25 * 864e5);
      if (!(age >= 18 && age < 100)) throw bad('invalid_dob', 'Check your date of birth', { field: 'date_of_birth' });
    }
    const tax = DETAIL_COLS.filter((k) => (b as any)[k] !== undefined);
    if (tax.length) await needTax();
    const sets: string[] = []; const vals: unknown[] = [me.id];
    for (const k of [...tax, 'abn', 'gst_registered']) {
      if ((b as any)[k] === undefined) continue;
      vals.push((b as any)[k] === '' ? null : (b as any)[k]); sets.push(`${k} = $${vals.length}`);
    }
    if (tax.length) sets.push('tax_details_updated_at = now()');
    if (sets.length) await q(`UPDATE drivers SET ${sets.join(', ')} WHERE user_id = $1`, vals);
    if (b.email) await q(`UPDATE users SET email = $2 WHERE id = $1`, [me.id, b.email]);
    return myDetails(me.id);
  });

  app.get('/driver/tax/statement', async (req, reply) => {
    const me = await requireUser(req, 'driver');
    const f = fmt(req);
    const s = await driverStatement(me.id, (req.query as any).quarter || undefined);
    if (f === 'csv') return sendFile(reply, 'csv', `dingogo-gst-statement-${s.period.key}.csv`, statementCsv(s));
    if (f === 'pdf') return sendFile(reply, 'pdf', `dingogo-gst-statement-${s.period.key}.pdf`, statementPdf(s));
    return s;
  });
  app.get('/driver/tax/fee-invoice', async (req, reply) => {
    const me = await requireUser(req, 'driver');
    const f = fmt(req);
    const inv = await feeInvoice(me.id, (req.query as any).quarter || undefined);
    if (f === 'pdf') return sendFile(reply, 'pdf', `${inv.number}.pdf`, feeInvoicePdf(inv));
    if (f === 'csv') throw bad('bad_format', 'The invoice is a PDF');
    return { invoice: inv };
  });

  // ───────────── Rider: NDIS invoice ─────────────
  app.get('/me/ndis-invoice', async (req, reply) => {
    const me = await requireUser(req);
    const f = fmt(req);
    const set = await ndisInvoices((req.query as any).month || undefined, { riderId: me.id });
    if (f === 'json') return { period: set.period, provider: set.provider, invoices: set.invoices };
    if (!set.invoices.length) throw notFound('NDIS trips this month');
    if (f === 'csv') return sendFile(reply, 'csv', `dingogo-ndis-${set.period.key}.csv`, ndisInvoiceCsv(set));
    return sendFile(reply, 'pdf', `${set.invoices[0].number}.pdf`, ndisInvoicePdf(set, set.invoices[0]));
  });

  // ───────────── Admin: overview ─────────────
  app.get('/admin/tax/overview', async (req) => {
    await admin(req);
    const ready = await taxReady();
    const biz = await business();
    const missing = await missingDetails();
    const privacy = ready ? await one(`SELECT count(*) FILTER (WHERE status = 'open')::int open, count(*) FILTER (WHERE status = 'open' AND due_at < now())::int overdue FROM privacy_requests`) : null;
    const levy = await levyReturns('NT');
    return {
      ready, business: { name: biz.name, abn: biz.abn, abn_ok: biz.abn_ok },
      next: { bas: quarterPeriod(), serr: halfPeriod(), levy: monthPeriod(undefined, levy.due_day) },
      missing_details: missing.length, levy_overdue: levy.months.filter((m) => m.overdue).length,
      privacy, retention: await retentionPolicy(), ndis: await ndisSettings(),
      last_retention_run: (await one(`SELECT value FROM settings WHERE key = 'record_retention_last_run'`))?.value ?? null,
    };
  });

  // DingoGo BAS worksheet
  app.get('/admin/tax/bas', async (req, reply) => {
    const me = await admin(req);
    const f = fmt(req);
    const b = await dingogoBas((req.query as any).quarter || undefined);
    if (f === 'json') return b;
    await audit(me.id, 'export', 'report', `bas.${f}`, { quarter: b.period.key });
    return f === 'csv' ? sendFile(reply, 'csv', `dingogo-bas-${b.period.key}.csv`, basCsv(b)) : sendFile(reply, 'pdf', `dingogo-bas-${b.period.key}.pdf`, basPdf(b));
  });
  // Any driver's statement or fee invoice (ops answering a driver's or tax agent's question)
  app.get('/admin/tax/driver-statement', async (req, reply) => {
    const me = await admin(req);
    const f = fmt(req);
    const p = parse(z.object({ driver_id: z.string().uuid(), quarter: z.string().max(8).optional(), doc: z.enum(['statement', 'invoice']).default('statement') }), req.query);
    if (p.doc === 'invoice') {
      const inv = await feeInvoice(p.driver_id, p.quarter || undefined);
      if (f === 'json') return { invoice: inv };
      await audit(me.id, 'export', 'driver', p.driver_id, { doc: 'fee_invoice', quarter: inv.period.key });
      return sendFile(reply, 'pdf', `${inv.number}.pdf`, feeInvoicePdf(inv));
    }
    const s = await driverStatement(p.driver_id, p.quarter || undefined);
    if (f === 'json') return s;
    await audit(me.id, 'export', 'driver', p.driver_id, { doc: 'gst_statement', quarter: s.period.key, format: f });
    return f === 'csv' ? sendFile(reply, 'csv', `gst-statement-${s.period.key}.csv`, statementCsv(s)) : sendFile(reply, 'pdf', `gst-statement-${s.period.key}.pdf`, statementPdf(s));
  });

  // SERR
  app.get('/admin/tax/serr', async (req, reply) => {
    const me = await admin(req);
    const f = fmt(req);
    const r = await serrReport((req.query as any).period || undefined);
    if (f === 'json') return serrView(r);
    if (f === 'pdf') throw bad('bad_format', 'The SERR file is a CSV');
    // Full bank details are only in this file (the ATO asks for them); the download is audited.
    await audit(me.id, 'export', 'report', 'serr.csv', { period: r.period.key, sellers: r.totals.sellers, incomplete: r.totals.incomplete });
    return sendFile(reply, 'csv', `dingogo-serr-${r.period.key}.csv`, serrCsv(r));
  });
  app.get('/admin/tax/missing-details', async (req, reply) => {
    const me = await admin(req);
    const items = await missingDetails();
    if (fmt(req) === 'csv') {
      await audit(me.id, 'export', 'report', 'missing-details.csv', { rows: items.length });
      return sendFile(reply, 'csv', `dingogo-tax-details-missing-${darwinNow()}.csv`,
        toCsv<any>([['Driver', (r) => r.name], ['Status', (r) => r.status], ['Missing', (r) => r.missing.join('; ')], ['Account deleted', (r) => (r.deleted ? 'Yes' : '')]], items));
    }
    return { items };
  });
  app.post('/admin/tax/missing-details/remind', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ driver_ids: z.array(z.string().uuid()).max(500).optional() }), req.body ?? {});
    const items = (await missingDetails()).filter((i) => !i.deleted && (!b.driver_ids || b.driver_ids.includes(i.driver_id)));
    for (const i of items) {
      await notify(i.driver_id, 'Tax details needed', `DingoGo must report your earnings to the ATO. Please add: ${i.missing.join(', ')} (Profile → Tax details).`, { screen: 'tax' }, 'account');
    }
    await audit(me.id, 'tax_details_reminder', 'drivers', 'bulk', { count: items.length });
    return { reminded: items.length };
  });

  // Levy returns
  app.get('/admin/tax/levy-return', async (req, reply) => {
    const me = await admin(req);
    const f = fmt(req);
    const p = req.query as any;
    const r = await levyReturn(p.month || undefined, p.state || 'NT');
    if (f === 'json') return r;
    await audit(me.id, 'export', 'report', `levy-return.${f}`, { state: r.state, month: r.period.key });
    return f === 'csv' ? sendFile(reply, 'csv', `dingogo-levy-return-${r.state}-${r.period.key}.csv`, levyReturnCsv(r))
      : sendFile(reply, 'pdf', `dingogo-levy-return-${r.state}-${r.period.key}.pdf`, levyReturnPdf(r));
  });
  app.get('/admin/tax/levy-returns', async (req) => { await admin(req); return levyReturns(String((req.query as any).state || 'NT')); });
  app.post('/admin/tax/levy-returns', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ state: z.string().max(3).default('NT'), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), reference: z.string().trim().max(60).optional() }), req.body);
    const item = await recordLodgement(me.id, b.state, b.month, b.reference);
    await audit(me.id, 'levy_lodged', 'levy_lodgements', `${item.state}-${item.month}`, { trips: item.trips, amount_cents: item.amount_cents, reference: item.reference });
    return { item };
  });

  // NDIS
  app.get('/admin/tax/ndis', async (req, reply) => {
    const me = await admin(req);
    const f = fmt(req);
    const p = req.query as any;
    const set = await ndisInvoices(p.month || undefined, p.ndis ? { ndis: String(p.ndis) } : {});
    if (f === 'json') return set;
    await audit(me.id, 'export', 'report', `ndis.${f}`, { month: set.period.key, ndis: p.ndis ? 'one' : 'all', claim: p.claim === 'bulk' });
    if (f === 'csv') return sendFile(reply, 'csv', `dingogo-ndis-${p.claim === 'bulk' ? 'bulk-claim-' : ''}${set.period.key}.csv`, p.claim === 'bulk' ? ndisBulkClaimCsv(set) : ndisInvoiceCsv(set));
    if (!p.ndis || !set.invoices.length) throw bad('choose_participant', 'Choose one participant for a PDF invoice');
    return sendFile(reply, 'pdf', `${set.invoices[0].number}.pdf`, ndisInvoicePdf(set, set.invoices[0]));
  });
  app.put('/admin/tax/ndis-settings', async (req) => {
    const me = await admin(req);
    const value = checkNdis(req.body);
    await q(`INSERT INTO settings (key, value) VALUES ('ndis', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(value)]);
    await audit(me.id, 'setting', 'settings', 'ndis', value);
    return { settings: value };
  });

  // Record retention
  app.get('/admin/tax/retention', async (req) => { await admin(req); return runRetention({ dryRun: true }); });
  app.put('/admin/tax/retention', async (req) => {
    const me = await admin(req);
    const value = checkRetention(req.body);
    await q(`INSERT INTO settings (key, value) VALUES ('record_retention', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(value)]);
    await audit(me.id, 'setting', 'settings', 'record_retention', value);
    return { policy: value };
  });
  app.post('/admin/tax/retention/run', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ dry_run: z.boolean().default(true) }), req.body ?? {});
    return runRetention({ dryRun: b.dry_run, actor: me.id });
  });

  // Privacy (APP) requests
  app.get('/admin/privacy/requests', async (req, reply) => {
    const me = await admin(req);
    await needTax();
    const status = String((req.query as any).status ?? '');
    const items = await q(
      `SELECT r.*, u.name AS user_name, h.name AS handled_by_name, (r.status = 'open' AND r.due_at < now()) AS overdue
       FROM privacy_requests r LEFT JOIN users u ON u.id = r.user_id LEFT JOIN users h ON h.id = r.handled_by
       ${['open', 'completed', 'refused'].includes(status) ? 'WHERE r.status = $1' : ''} ORDER BY r.received_at DESC LIMIT 500`,
      ['open', 'completed', 'refused'].includes(status) ? [status] : []);
    if (fmt(req) === 'csv') {
      await audit(me.id, 'export', 'report', 'privacy-requests.csv', { rows: items.length });
      return sendFile(reply, 'csv', `dingogo-privacy-requests-${darwinNow()}.csv`, toCsv<any>([
        ['Ref', (r) => r.ref], ['Kind', (r) => r.kind], ['Channel', (r) => r.channel], ['Status', (r) => r.status], ['Person', (r) => r.user_name ?? r.requester],
        ['Received', (r) => r.received_at], ['Due', (r) => r.due_at], ['Completed', (r) => r.completed_at], ['Handled by', (r) => r.handled_by_name], ['Outcome', (r) => r.outcome],
      ], items));
    }
    return { items, kinds: PRIVACY_KINDS, channels: PRIVACY_CHANNELS };
  });
  app.post('/admin/privacy/requests', async (req, reply) => {
    const me = await admin(req);
    await needTax();
    const b = parse(z.object({
      kind: z.enum(PRIVACY_KINDS), channel: z.enum(PRIVACY_CHANNELS).default('email'), user_id: z.string().uuid().optional(),
      requester: z.string().trim().min(2).max(120), details: z.string().max(1000).optional(),
    }), req.body);
    const item = await recordPrivacyRequest({ ...b, status: 'open' });
    await audit(me.id, 'privacy_request', 'privacy_requests', item.id, { kind: b.kind, channel: b.channel });
    reply.code(201);
    return { item };
  });
  app.patch('/admin/privacy/requests/:id', async (req) => {
    const me = await admin(req);
    await needTax();
    const id = parse(z.object({ id: z.string().uuid() }), req.params).id;
    const b = parse(z.object({ status: z.enum(['open', 'completed', 'refused']), outcome: z.string().trim().max(1000).optional() }), req.body);
    if (b.status !== 'open' && !b.outcome) throw bad('outcome_required', 'Say what was done (or why it was refused)');
    const item = await one(`UPDATE privacy_requests SET status = $2, outcome = coalesce($3, outcome), handled_by = $4,
                              completed_at = CASE WHEN $2 = 'open' THEN NULL ELSE now() END WHERE id = $1 RETURNING *`, [id, b.status, b.outcome ?? null, me.id]);
    if (!item) throw notFound('Request');
    await audit(me.id, 'privacy_request_status', 'privacy_requests', id, { status: b.status });
    return { item };
  });
}
