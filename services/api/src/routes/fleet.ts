/**
 * Round 20: fleet and EV programme (admin side, plus the driver's own agreement). Car agreements (weekly lease, rent-to-own)
 * and the weekly run, maintenance with downtime and spare cars, insurance and claims, per-car profitability and investor
 * shares. Money reports and investor records are admin only; dispatchers can see agreements and run maintenance.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { one, q } from '../db.js';
import { requireUser } from '../auth.js';
import { bad, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { toCsv, dollars } from '../lib/csv.js';
import { parse, z } from '../lib/validate.js';
import { CLAIM_KINDS, CLAIM_STATUSES, CONTRACT_KINDS, COVERS, DEFAULT_FLEET_POLICY, MAINT_KINDS } from '../lib/fleet.js';
import * as fleet from '../services/fleet.js';

const ops = (req: FastifyRequest) => requireUser(req, 'admin', 'dispatcher');
const admin = (req: FastifyRequest) => requireUser(req, 'admin');
const date = z.string().date();
const cents = (max = 10_000_000) => z.number().int().min(0).max(max);
const text = (max: number) => z.string().trim().max(max);

function sendCsv(reply: FastifyReply, filename: string, body: string) {
  reply.header('content-type', 'text/csv; charset=utf-8');
  reply.header('content-disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  reply.header('cache-control', 'no-store');
  return reply.send(body);
}

/** Writes only the given keys; returns the row. */
async function patchRow(table: string, id: string, b: Record<string, unknown>) {
  const keys = Object.keys(b).filter((k) => b[k] !== undefined);
  if (!keys.length) throw bad('empty');
  return one(`UPDATE ${table} SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [id, ...keys.map((k) => b[k])]);
}
async function insertRow(table: string, b: Record<string, unknown>) {
  const keys = Object.keys(b).filter((k) => b[k] !== undefined);
  return one(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, keys.map((k) => b[k]));
}

const contractBody = z.object({
  vehicle_id: z.string().uuid(), driver_id: z.string().uuid(), kind: z.enum(CONTRACT_KINDS), weekly_cents: cents(200000), starts_on: date,
  ends_on: date.nullable().optional(), term_weeks: z.number().int().min(1).max(520).nullable().optional(), price_cents: cents(50_000_000).nullable().optional(),
  deposit_cents: cents(50_000_000).optional(), deposit_ref: text(80).nullable().optional(), catch_up_pct: z.number().int().min(100).max(300).optional(),
  keep_min_cents: cents(100000).optional(), km_per_week: z.number().int().min(1).max(10000).nullable().optional(), notes: text(1000).nullable().optional(),
  assign: z.boolean().optional(),
});
const policyBody = z.object({
  insurer: text(80).min(2), policy_no: text(60).min(1), cover: z.enum(COVERS).optional(), starts_on: date, ends_on: date,
  premium_cents: cents().optional(), excess_cents: cents().optional(), notes: text(1000).nullable().optional(),
});
const claimBody = z.object({
  policy_id: z.string().uuid().nullable().optional(), driver_id: z.string().uuid().nullable().optional(), trip_id: z.string().uuid().nullable().optional(),
  incident_at: z.string().datetime({ offset: true }), kind: z.enum(CLAIM_KINDS), description: text(2000).min(3),
  status: z.enum(CLAIM_STATUSES).optional(), claim_no: text(60).nullable().optional(), at_fault: z.boolean().nullable().optional(),
  excess_cents: cents().optional(), driver_contribution_cents: cents().optional(), repair_cost_cents: cents().optional(), payout_cents: cents().optional(),
  notes: text(2000).nullable().optional(),
});
const investorBody = z.object({
  name: text(120).min(2), email: z.string().trim().email().max(200).nullable().optional(),
  abn: z.preprocess((v) => (typeof v === 'string' ? v.replace(/\s+/g, '') || null : v), z.string().regex(/^\d{11}$/, 'ABN is 11 digits').nullable().optional()),
  payment_ref: text(80).nullable().optional(), notes: text(1000).nullable().optional(), active: z.boolean().optional(),
});
const shareBody = z.object({ investor_id: z.string().uuid(), vehicle_id: z.string().uuid(), share_pct: z.number().gt(0).max(100), starts_on: date, ends_on: date.nullable().optional() });

export default async function fleetRoutes(app: FastifyInstance) {
  // ───────────── Programme and policy ─────────────
  app.get('/admin/fleet', async (req) => {
    await ops(req);
    const ready = await fleet.fleetReady();
    const policy = await fleet.loadFleetPolicy();
    const counts = ready ? await one(
      `SELECT (SELECT count(*) FROM vehicles WHERE ownership <> 'driver_owned')::int cars,
              (SELECT count(*) FROM fleet_contracts WHERE status IN ('active','paused'))::int agreements,
              (SELECT count(*) FROM vehicle_maintenance WHERE status = 'off_road')::int off_road,
              (SELECT count(*) FROM fleet_claims WHERE status IN ('open','lodged','approved'))::int open_claims`) : null;
    return { ready, policy, defaults: DEFAULT_FLEET_POLICY, counts };
  });
  app.put('/admin/fleet/policy', async (req) => {
    const me = await admin(req);
    return { policy: await fleet.saveFleetPolicy(me.id, (req.body as any)?.policy ?? req.body) };
  });

  // ───────────── Agreements ─────────────
  app.get('/admin/fleet/contracts', async (req) => {
    await ops(req);
    const { status } = req.query as { status?: string };
    if (status && !['active', 'paused', 'ended', 'bought_out'].includes(status)) throw bad('status', 'status must be active, paused, ended or bought_out');
    return { items: await fleet.listContracts(status) };
  });
  app.post('/admin/fleet/contracts', async (req, reply) => {
    const me = await admin(req);
    const r = await fleet.createContract(me.id, parse(contractBody, req.body));
    reply.code(201);
    return r;
  });
  app.get('/admin/fleet/contracts/:id', async (req) => { await ops(req); return { contract: await fleet.getContract((req.params as any).id) }; });
  app.patch('/admin/fleet/contracts/:id', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({
      status: z.enum(['active', 'paused']).optional(), paused_reason: text(300).nullable().optional(), weekly_cents: cents(200000).optional(),
      ends_on: date.nullable().optional(), catch_up_pct: z.number().int().min(100).max(300).optional(), keep_min_cents: cents(100000).optional(),
      km_per_week: z.number().int().min(1).max(10000).nullable().optional(), notes: text(1000).nullable().optional(),
    }), req.body);
    return { contract: await fleet.updateContract(me.id, (req.params as any).id, b) };
  });
  app.post('/admin/fleet/contracts/:id/payments', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ kind: z.enum(['payment', 'waiver']), cents: z.number().int().min(1).max(50_000_000), method: z.enum(['bank', 'balance']).optional(),
      reference: text(80).nullable().optional() }), req.body);
    return { contract: await fleet.recordPayment(me.id, (req.params as any).id, b) };
  });
  app.post('/admin/fleet/contracts/:id/buy-out', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ method: z.enum(['bank', 'balance']), reference: text(80).nullable().optional() }), req.body);
    return { contract: await fleet.buyOut(me.id, (req.params as any).id, b) };
  });
  app.post('/admin/fleet/contracts/:id/end', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ reason: text(300).min(2) }), req.body);
    return { contract: await fleet.endContract(me.id, (req.params as any).id, b) };
  });
  app.post('/admin/fleet/run-week', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ week: date.optional() }), req.body ?? {});
    return fleet.runWeek(b.week, me.id);
  });

  // ───────────── Maintenance ─────────────
  app.get('/admin/fleet/maintenance', async (req) => { await ops(req); return fleet.maintenanceBoard(); });
  app.post('/admin/fleet/maintenance', async (req, reply) => {
    const me = await ops(req);
    const b = parse(z.object({
      vehicle_id: z.string().uuid(), kind: z.enum(MAINT_KINDS), booked_for: date.nullable().optional(), provider: text(80).nullable().optional(),
      notes: text(1000).nullable().optional(), cost_cents: cents().optional(), odometer_km: z.number().int().min(0).max(2_000_000).nullable().optional(),
      done_on: date.nullable().optional(), claim_id: z.string().uuid().nullable().optional(),
    }), req.body);
    reply.code(201);
    return { job: await fleet.createJob(me.id, b) };
  });
  app.post('/admin/fleet/maintenance/:id/start', async (req) => {
    const me = await ops(req);
    const b = parse(z.object({ spare_vehicle_id: z.string().uuid().nullable().optional() }), req.body ?? {});
    return fleet.startJob(me.id, (req.params as any).id, b);
  });
  app.post('/admin/fleet/maintenance/:id/finish', async (req) => {
    const me = await ops(req);
    const b = parse(z.object({ odometer_km: z.number().int().min(0).max(2_000_000).nullable().optional(), cost_cents: cents().optional(),
      notes: text(1000).nullable().optional(), provider: text(80).nullable().optional() }), req.body ?? {});
    return fleet.finishJob(me.id, (req.params as any).id, b);
  });
  app.post('/admin/fleet/maintenance/:id/cancel', async (req) => { const me = await ops(req); return { job: await fleet.cancelJob(me.id, (req.params as any).id) }; });

  // ───────────── Insurance and claims ─────────────
  app.get('/admin/fleet/insurance', async (req) => { await ops(req); return fleet.listInsurance(); });
  app.post('/admin/fleet/insurance', async (req, reply) => {
    const me = await admin(req);
    const b = parse(policyBody.extend({ vehicle_id: z.string().uuid() }), req.body);
    if (b.ends_on < b.starts_on) throw bad('dates', 'The policy ends before it starts');
    if (!(await fleet.fleetReady())) throw fleet.migrationPending();
    if (!(await one(`SELECT 1 FROM vehicles WHERE id = $1`, [b.vehicle_id]))) throw notFound('Vehicle');
    const row = await insertRow('fleet_insurance', b);
    await fleet.syncInsuranceExpiry(b.vehicle_id);
    await audit(me.id, 'create', 'fleet_insurance', row.id, b);
    reply.code(201);
    return { item: row };
  });
  app.patch('/admin/fleet/insurance/:id', async (req) => {
    const me = await admin(req);
    const b = parse(policyBody.partial(), req.body);
    if (!(await fleet.fleetReady())) throw fleet.migrationPending();
    const row = await patchRow('fleet_insurance', (req.params as any).id, b).catch((e) => {
      if (e?.code === '23514') throw bad('dates', 'The policy ends before it starts');
      throw e;
    });
    if (!row) throw notFound('Policy');
    await fleet.syncInsuranceExpiry(row.vehicle_id);
    await audit(me.id, 'update', 'fleet_insurance', row.id, b);
    return { item: row };
  });
  app.post('/admin/fleet/claims', async (req, reply) => {
    const me = await ops(req);
    const b = parse(claimBody.extend({ vehicle_id: z.string().uuid() }), req.body);
    if (!(await fleet.fleetReady())) throw fleet.migrationPending();
    if (!(await one(`SELECT 1 FROM vehicles WHERE id = $1`, [b.vehicle_id]))) throw notFound('Vehicle');
    if (b.policy_id && !(await one(`SELECT 1 FROM fleet_insurance WHERE id = $1 AND vehicle_id = $2`, [b.policy_id, b.vehicle_id]))) throw bad('policy', 'That policy is not for this car');
    const row = await insertRow('fleet_claims', { ...b, created_by: me.id });
    await audit(me.id, 'create', 'fleet_claims', row.id, b);
    reply.code(201);
    return { item: row };
  });
  app.patch('/admin/fleet/claims/:id', async (req) => {
    const me = await ops(req);
    const b = parse(claimBody.partial(), req.body);
    if (!(await fleet.fleetReady())) throw fleet.migrationPending();
    // Money on a claim (excess, driver contribution, payout) is admin only.
    if (me.role !== 'admin' && ['excess_cents', 'driver_contribution_cents', 'repair_cost_cents', 'payout_cents'].some((k) => (b as any)[k] !== undefined)) {
      await admin(req);
    }
    const row = await patchRow('fleet_claims', (req.params as any).id, { ...b, updated_at: new Date() });
    if (!row) throw notFound('Claim');
    await audit(me.id, 'update', 'fleet_claims', row.id, b);
    return { item: row };
  });

  // ───────────── Profitability and investors (admin only) ─────────────
  app.get('/admin/fleet/profitability', async (req, reply) => {
    await admin(req);
    const qs = req.query as { from?: string; to?: string; format?: string };
    const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Darwin' }).format(new Date());
    const r = await fleet.profitability(qs.from ?? `${today.slice(0, 8)}01`, qs.to ?? today);
    if (qs.format === 'csv') {
      return sendCsv(reply, `fleet-profit-${r.from}-to-${r.to}.csv`, toCsv([
        ['Car', (c: any) => c.rego], ['Vehicle', (c: any) => `${c.make} ${c.model}`], ['Fuel', (c: any) => c.fuel_type], ['Days', (c: any) => c.days],
        ['Days off road', (c: any) => c.off_road_days], ['Trips', (c: any) => c.trips], ['Km', (c: any) => c.km], ['Engaged hours', (c: any) => c.engaged_hours],
        ['Utilisation %', (c: any) => c.utilisation_pct ?? ''], ['Service fees', (c: any) => dollars(c.income.service_fees_cents)],
        ['Agreement payments', (c: any) => dollars(c.income.agreement_cents)], ['Roof ads', (c: any) => dollars(c.income.ads_cents)],
        ['Insurance payouts', (c: any) => dollars(c.income.insurance_payouts_cents)], ['Income', (c: any) => dollars(c.income.total_cents)],
        ['Charging', (c: any) => dollars(c.costs.charging_cents)], ['Maintenance', (c: any) => dollars(c.costs.maintenance_cents)],
        ['Insurance', (c: any) => dollars(c.costs.insurance_cents)], ['Claims', (c: any) => dollars(c.costs.claims_cents)], ['Finance', (c: any) => dollars(c.costs.finance_cents)],
        ['Costs', (c: any) => dollars(c.costs.total_cents)], ['Profit', (c: any) => dollars(c.profit_cents)], ['Profit per km', (c: any) => dollars(c.profit_per_km_cents)],
      ], r.cars));
    }
    return r;
  });

  app.get('/admin/fleet/investors', async (req) => {
    await admin(req);
    if (!(await fleet.fleetReady())) throw fleet.migrationPending();
    const items = await q(`SELECT i.*, coalesce((SELECT json_agg(json_build_object('id', s.id, 'vehicle_id', s.vehicle_id, 'rego', v.rego, 'share_pct', s.share_pct,
                             'starts_on', s.starts_on, 'ends_on', s.ends_on) ORDER BY s.starts_on DESC) FROM fleet_investor_shares s JOIN vehicles v ON v.id = s.vehicle_id
                             WHERE s.investor_id = i.id), '[]') AS shares FROM fleet_investors i ORDER BY i.active DESC, i.name`);
    return { items };
  });
  app.post('/admin/fleet/investors', async (req, reply) => {
    const me = await admin(req);
    const b = parse(investorBody, req.body);
    if (!(await fleet.fleetReady())) throw fleet.migrationPending();
    const row = await insertRow('fleet_investors', b);
    await audit(me.id, 'create', 'fleet_investors', row.id, { name: b.name });
    reply.code(201);
    return { item: row };
  });
  app.patch('/admin/fleet/investors/:id', async (req) => {
    const me = await admin(req);
    const b = parse(investorBody.partial(), req.body);
    if (!(await fleet.fleetReady())) throw fleet.migrationPending();
    const row = await patchRow('fleet_investors', (req.params as any).id, b);
    if (!row) throw notFound('Investor');
    await audit(me.id, 'update', 'fleet_investors', row.id, b);
    return { item: row };
  });
  app.post('/admin/fleet/investor-shares', async (req, reply) => {
    const me = await admin(req);
    const b = parse(shareBody, req.body);
    if (!(await fleet.fleetReady())) throw fleet.migrationPending();
    if (b.ends_on && b.ends_on < b.starts_on) throw bad('dates', 'The share ends before it starts');
    const v = await one(`SELECT ownership FROM vehicles WHERE id = $1`, [b.vehicle_id]);
    if (!v) throw notFound('Vehicle');
    if (v.ownership === 'driver_owned') throw bad('not_fleet_car', 'Investor shares are for DingoGo cars');
    if (!(await one(`SELECT 1 FROM fleet_investors WHERE id = $1`, [b.investor_id]))) throw notFound('Investor');
    await fleet.checkShareTotal(b.vehicle_id, b.share_pct, b.starts_on, b.ends_on ?? null);
    const row = await insertRow('fleet_investor_shares', b);
    await audit(me.id, 'create', 'fleet_investor_shares', row.id, b);
    reply.code(201);
    return { item: row };
  });
  app.patch('/admin/fleet/investor-shares/:id', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ share_pct: z.number().gt(0).max(100).optional(), starts_on: date.optional(), ends_on: date.nullable().optional() }), req.body);
    if (!(await fleet.fleetReady())) throw fleet.migrationPending();
    const cur = await one(`SELECT *, starts_on::text AS starts_on, ends_on::text AS ends_on FROM fleet_investor_shares WHERE id = $1`, [(req.params as any).id]);
    if (!cur) throw notFound('Share');
    const next = { share_pct: b.share_pct ?? Number(cur.share_pct), starts_on: b.starts_on ?? cur.starts_on, ends_on: b.ends_on !== undefined ? b.ends_on : cur.ends_on };
    if (next.ends_on && next.ends_on < next.starts_on) throw bad('dates', 'The share ends before it starts');
    await fleet.checkShareTotal(cur.vehicle_id, next.share_pct, next.starts_on, next.ends_on, cur.id);
    const row = await patchRow('fleet_investor_shares', cur.id, b);
    await audit(me.id, 'update', 'fleet_investor_shares', cur.id, b);
    return { item: row };
  });
  app.get('/admin/fleet/investor-report', async (req, reply) => {
    await admin(req);
    const qs = req.query as { month?: string; format?: string };
    const month = qs.month ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Darwin' }).format(new Date(Date.now() - 28 * 864e5)).slice(0, 7);
    const r = await fleet.investorReport(month);
    if (qs.format === 'csv') {
      return sendCsv(reply, `investor-shares-${month}.csv`, toCsv([
        ['Month', () => month], ['Investor', (x: any) => x.investor], ['Payment ref', (x: any) => x.payment_ref ?? ''], ['Car', (x: any) => x.rego],
        ['Share %', (x: any) => x.share_pct], ['Days', (x: any) => x.days], ['Car income', (x: any) => dollars(x.car_income_cents)],
        ['Car costs', (x: any) => dollars(x.car_costs_cents)], ['Car profit', (x: any) => dollars(x.car_profit_cents)], ['Share', (x: any) => dollars(x.share_cents)],
      ], r.rows));
    }
    return r;
  });

  // ───────────── Driver ─────────────
  app.get('/driver/fleet', async (req) => {
    const me = await requireUser(req, 'driver');
    return fleet.driverFleet(me.id);
  });
}
