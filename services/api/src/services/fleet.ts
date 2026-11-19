/**
 * Round 20: fleet and EV programme (database side). Car agreements and the weekly deduction run, maintenance jobs with
 * downtime and spare cars, charging reimbursement with a monthly cap, insurance and claims, per-car profitability and the
 * investor revenue-share report. Everything new needs migration 024 (`fleetReady()`); before it the old weekly lease run keeps
 * working (now capped at the driver's balance) and the rest answers 503 `migration_pending`.
 */
import { isIsoDay } from '../lib/validate.js';
import { one, pool, q, tx, type Q } from '../db.js';
import { ApiError, bad, conflict, notFound } from '../lib/errors.js';
import { settingValue, invalidateConfig } from '../lib/cache.js';
import { config } from '../config.js';
import { audit } from '../lib/audit.js';
import { logError } from '../lib/log.js';
import { weekStartOf } from '../lib/driverPay.js';
import { toOps } from '../realtime.js';
import { send } from './notify.js';
import { engagedFromSql } from './courier.js';
import {
  CHARGE_RULE_TEXT, DEFAULT_FLEET_POLICY, chargeReimbursement, checkFleetPolicy, contractTotals, daysIn, dueFor, investorShare, mergeFleetPolicy,
  overlapDays, payoffWeeks, prorate, weekDeduction, type FleetPolicy,
} from '../lib/fleet.js';

const TZ = config.timezone;
let ready = false;
let checkedAt = 0;
/** True once migration 024's tables and columns exist (re-checked once a minute until then). */
export async function fleetReady(): Promise<boolean> {
  if (ready) return true;
  if (checkedAt && Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const r = await one<{ n: number }>(
      `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name IN
                 ('fleet_contracts','fleet_contract_weeks','fleet_contract_payments','vehicle_maintenance','fleet_insurance','fleet_claims',
                  'fleet_investors','fleet_investor_shares'))
            + (SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema()
                 AND ((table_name = 'vehicles' AND column_name IN ('purchase_price_cents','purchase_date','finance_weekly_cents','spare'))
                   OR (table_name = 'charging_sessions' AND column_name IN ('reimburse_cents','rule','receipt_ref')))) AS n`);
    ready = Number(r!.n) === 15;
  } catch { ready = false; }
  return ready;
}
export function resetFleetReady() { ready = false; checkedAt = 0; }
export const migrationPending = () => new ApiError(503, 'migration_pending', 'This needs database migration 024 (fleet programme)');
async function needReady() { if (!(await fleetReady())) throw migrationPending(); }

export async function loadFleetPolicy(): Promise<FleetPolicy> { return mergeFleetPolicy(await settingValue('fleet_policy')); }
export async function saveFleetPolicy(actorId: string, v: unknown) {
  const value = checkFleetPolicy(v);
  await q(`INSERT INTO settings (key, value) VALUES ('fleet_policy', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(value)]);
  invalidateConfig('setting:fleet_policy');
  await audit(actorId, 'update', 'settings', 'fleet_policy', value);
  return value;
}

const darwinToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const LIVE = `('accepted','arrived','in_progress')`;
const onLiveTrip = async (driverId: string, c: Q = pool) => !!(await one(`SELECT 1 FROM trips WHERE driver_id = $1 AND status IN ${LIVE} LIMIT 1`, [driverId], c));
const balanceOf = async (driverId: string, c: Q) => (await one<{ cents: number }>(`SELECT coalesce(sum(amount_cents),0)::int cents FROM driver_ledger WHERE driver_id = $1`, [driverId], c))!.cents;
/** Same lock as payouts: a deduction and a payout for one driver never interleave. */
const lockDriver = (driverId: string, c: Q) => one(`SELECT user_id FROM drivers WHERE user_id = $1 FOR UPDATE`, [driverId], c);

// ───────────── Agreements ─────────────

async function totalsFor(c: any, client: Q = pool) {
  const weeks = await q(`SELECT due_cents, collected_cents FROM fleet_contract_weeks WHERE contract_id = $1`, [c.id], client);
  const payments = await q(`SELECT kind, cents FROM fleet_contract_payments WHERE contract_id = $1`, [c.id], client);
  return contractTotals(c, weeks, payments);
}

const CONTRACT_SELECT = `SELECT c.*, c.starts_on::text AS starts_on, c.ends_on::text AS ends_on, v.rego, v.make, v.model, v.fuel_type, u.name AS driver_name
  FROM fleet_contracts c JOIN vehicles v ON v.id = c.vehicle_id JOIN users u ON u.id = c.driver_id`;

export async function listContracts(status?: string) {
  await needReady();
  const rows = await q(`${CONTRACT_SELECT} WHERE ($1::text IS NULL OR c.status = $1) ORDER BY (c.status IN ('active','paused')) DESC, c.created_at DESC LIMIT 500`, [status ?? null]);
  return Promise.all(rows.map(async (c) => ({ ...c, totals: await totalsFor(c) })));
}

export async function getContract(id: string) {
  await needReady();
  const c = await one(`${CONTRACT_SELECT} WHERE c.id = $1`, [id]);
  if (!c) throw notFound('Agreement');
  const weeks = await q(`SELECT week_start::text AS week_start, due_cents, collected_cents, balance_before_cents, created_at FROM fleet_contract_weeks WHERE contract_id = $1 ORDER BY week_start DESC`, [id]);
  const payments = await q(`SELECT * FROM fleet_contract_payments WHERE contract_id = $1 ORDER BY created_at DESC`, [id]);
  return { ...c, totals: contractTotals(c, weeks, payments), weeks, payments, payoff_weeks: c.kind === 'rent_to_own' ? payoffWeeks(c.price_cents ?? 0, c.deposit_cents, c.weekly_cents) : null };
}

export interface ContractInput {
  vehicle_id: string; driver_id: string; kind: 'weekly_lease' | 'rent_to_own'; weekly_cents: number; starts_on: string; ends_on?: string | null;
  term_weeks?: number | null; price_cents?: number | null; deposit_cents?: number; deposit_ref?: string | null; catch_up_pct?: number; keep_min_cents?: number;
  km_per_week?: number | null; notes?: string | null; assign?: boolean;
}

/** New agreement: a DingoGo car (not one a driver owns) and a driver, neither already on a live agreement. The car becomes
 *  "leased to driver" at this weekly amount and (unless `assign: false`) the driver's car, if they are not on a trip. */
export async function createContract(actorId: string, b: ContractInput) {
  await needReady();
  if (b.kind === 'rent_to_own') {
    if (!b.price_cents || b.price_cents <= 0) throw bad('price_required', 'Rent-to-own needs the total price to own the car');
    if ((b.deposit_cents ?? 0) >= b.price_cents) throw bad('deposit_too_high', 'The deposit must be less than the price');
    if (b.weekly_cents <= 0) throw bad('weekly_required', 'Rent-to-own needs a weekly payment');
  }
  if (b.ends_on && b.ends_on < b.starts_on) throw bad('dates', 'The end date is before the start date');
  const out = await tx(async (c) => {
    const v = await one(`SELECT * FROM vehicles WHERE id = $1 FOR UPDATE`, [b.vehicle_id], c);
    if (!v) throw notFound('Vehicle');
    if (v.ownership === 'driver_owned') throw bad('not_fleet_car', `${v.rego} belongs to a driver. Agreements are for DingoGo cars.`);
    if (v.status !== 'approved') throw bad('car_not_approved', `${v.rego} must be approved before it is leased`);
    const d = await one(`SELECT d.user_id, d.vehicle_id, u.name FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.user_id = $1 AND u.deleted_at IS NULL FOR UPDATE OF d`, [b.driver_id], c);
    if (!d) throw notFound('Driver');
    if (await one(`SELECT 1 FROM fleet_contracts WHERE vehicle_id = $1 AND status IN ('active','paused')`, [v.id], c)) throw conflict('car_has_agreement', `${v.rego} already has an agreement`);
    if (await one(`SELECT 1 FROM fleet_contracts WHERE driver_id = $1 AND status IN ('active','paused')`, [d.user_id], c)) throw conflict('driver_has_agreement', `${d.name ?? 'This driver'} already has an agreement`);
    const other = await one(`SELECT u.name FROM drivers x JOIN users u ON u.id = x.user_id WHERE x.vehicle_id = $1 AND x.user_id <> $2 LIMIT 1`, [v.id, d.user_id], c);
    if (other && b.assign !== false) throw conflict('car_in_use', `${v.rego} is the car of ${other.name ?? 'another driver'}. Move them to another car first.`);
    const row = await one(
      `INSERT INTO fleet_contracts (vehicle_id, driver_id, kind, weekly_cents, starts_on, ends_on, term_weeks, price_cents, deposit_cents, catch_up_pct,
         keep_min_cents, km_per_week, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [v.id, d.user_id, b.kind, b.weekly_cents, b.starts_on, b.ends_on ?? null, b.term_weeks ?? null, b.kind === 'rent_to_own' ? b.price_cents : null,
        b.deposit_cents ?? 0, b.catch_up_pct ?? 150, b.keep_min_cents ?? 0, b.km_per_week ?? null, b.notes ?? null, actorId], c);
    if (b.deposit_cents) {
      await c.query(`INSERT INTO fleet_contract_payments (contract_id, kind, cents, method, reference, created_by) VALUES ($1,'deposit',$2,'bank',$3,$4)`,
        [row!.id, b.deposit_cents, b.deposit_ref ?? null, actorId]);
    }
    await c.query(`UPDATE vehicles SET ownership = 'leased_to_driver', lease_weekly_cents = $2 WHERE id = $1`, [v.id, b.weekly_cents]);
    let assigned = false;
    if (b.assign !== false && d.vehicle_id !== v.id && !(await onLiveTrip(d.user_id, c))) {
      await c.query(`UPDATE drivers SET vehicle_id = $2 WHERE user_id = $1`, [d.user_id, v.id]);
      assigned = true;
    }
    await audit(actorId, 'fleet_contract_created', 'fleet_contract', row!.id, { ...b, assigned }, c);
    return { id: row!.id as string, assigned: assigned || d.vehicle_id === v.id };
  });
  return { contract: await getContract(out.id), assigned: out.assigned };
}

export async function updateContract(actorId: string, id: string, b: { status?: 'active' | 'paused'; paused_reason?: string | null; weekly_cents?: number;
  ends_on?: string | null; catch_up_pct?: number; keep_min_cents?: number; km_per_week?: number | null; notes?: string | null }) {
  await needReady();
  const cur = await one(`SELECT * FROM fleet_contracts WHERE id = $1`, [id]);
  if (!cur) throw notFound('Agreement');
  if (!['active', 'paused'].includes(cur.status)) throw conflict('agreement_closed', 'This agreement has ended');
  if (b.status === 'paused' && !b.paused_reason?.trim() && !cur.paused_reason) throw bad('reason_required', 'Say why the payments are paused (for example hardship or the car is off the road)');
  const keys = Object.keys(b).filter((k) => (b as any)[k] !== undefined);
  if (!keys.length) throw bad('empty');
  const vals = keys.map((k) => (b as any)[k]);
  const extra = b.status === 'active' ? ', paused_reason = NULL' : '';
  const row = await one(`UPDATE fleet_contracts SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')}${extra} WHERE id = $1 RETURNING *`, [id, ...vals]);
  if (b.weekly_cents != null) await q(`UPDATE vehicles SET lease_weekly_cents = $2 WHERE id = $1`, [row.vehicle_id, b.weekly_cents]);
  await audit(actorId, b.status === 'paused' ? 'fleet_contract_paused' : b.status === 'active' ? 'fleet_contract_resumed' : 'fleet_contract_updated', 'fleet_contract', id, b);
  return getContract(id);
}

/** A payment outside the weekly run (by bank, or from the driver's balance) or arrears written off (waiver). */
export async function recordPayment(actorId: string, id: string, b: { kind: 'payment' | 'waiver'; cents: number; method?: 'bank' | 'balance'; reference?: string | null }) {
  await needReady();
  await tx(async (c) => {
    const k = await one(`SELECT * FROM fleet_contracts WHERE id = $1 FOR UPDATE`, [id], c);
    if (!k) throw notFound('Agreement');
    const t = await totalsFor(k, c);
    if (b.kind === 'waiver' && b.cents > Math.max(0, t.owing_cents)) throw bad('waiver_too_big', 'You can only waive what is owing');
    if (b.kind === 'payment' && t.buy_out_cents != null && b.cents > t.buy_out_cents) throw bad('payment_too_big', 'That is more than is left to pay for the car. Use buy-out.');
    if (b.kind === 'payment' && b.method === 'balance') {
      await lockDriver(k.driver_id, c);
      if ((await balanceOf(k.driver_id, c)) < b.cents) throw bad('balance_too_low', 'The driver’s balance is less than that');
      await c.query(`INSERT INTO driver_ledger (driver_id, kind, amount_cents, note) VALUES ($1,'lease',$2,$3)`, [k.driver_id, -b.cents, `Car agreement payment from balance`]);
    }
    await c.query(`INSERT INTO fleet_contract_payments (contract_id, kind, cents, method, reference, created_by) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, b.kind, b.cents, b.kind === 'payment' ? b.method ?? 'bank' : null, b.reference ?? null, actorId]);
    await audit(actorId, `fleet_${b.kind}`, 'fleet_contract', id, b, c);
  });
  return getContract(id);
}

/** Rent-to-own buy-out: the rest is paid (by bank or from the balance), the agreement closes and the car becomes the driver's. */
export async function buyOut(actorId: string, id: string, b: { method: 'bank' | 'balance'; reference?: string | null }) {
  await needReady();
  const paid = await tx(async (c) => {
    const k = await one(`SELECT * FROM fleet_contracts WHERE id = $1 FOR UPDATE`, [id], c);
    if (!k) throw notFound('Agreement');
    if (k.kind !== 'rent_to_own') throw bad('not_rent_to_own', 'Only rent-to-own agreements have a buy-out');
    if (!['active', 'paused'].includes(k.status)) throw conflict('agreement_closed', 'This agreement has ended');
    const t = await totalsFor(k, c);
    const cents = t.buy_out_cents ?? 0;
    if (b.method === 'balance' && cents > 0) {
      await lockDriver(k.driver_id, c);
      if ((await balanceOf(k.driver_id, c)) < cents) throw bad('balance_too_low', 'The driver’s balance doesn’t cover the buy-out');
      await c.query(`INSERT INTO driver_ledger (driver_id, kind, amount_cents, note) VALUES ($1,'lease',$2,'Car buy-out')`, [k.driver_id, -cents]);
    }
    await c.query(`INSERT INTO fleet_contract_payments (contract_id, kind, cents, method, reference, created_by) VALUES ($1,'buy_out',$2,$3,$4,$5)`,
      [id, cents, b.method, b.reference ?? null, actorId]);
    await c.query(`UPDATE fleet_contracts SET status = 'bought_out', ended_at = now(), end_reason = 'Bought out' WHERE id = $1`, [id]);
    // The car is the driver's now: it leaves the fleet (their own-car fee rate applies) and stays their car.
    await c.query(`UPDATE vehicles SET ownership = 'driver_owned', owner_driver_id = $2, lease_weekly_cents = 0 WHERE id = $1`, [k.vehicle_id, k.driver_id]);
    await c.query(`UPDATE fleet_investor_shares SET ends_on = (now() AT TIME ZONE $2)::date WHERE vehicle_id = $1 AND (ends_on IS NULL OR ends_on > (now() AT TIME ZONE $2)::date)`, [k.vehicle_id, TZ]);
    await audit(actorId, 'fleet_buy_out', 'fleet_contract', id, { cents, ...b }, c);
    return { cents, driver: k.driver_id };
  });
  void send(paid.driver, 'fleet_bought_out', {}, { data: { contract_id: id } });
  return { ...(await getContract(id)), buy_out_paid_cents: paid.cents };
}

/** End an agreement: the car goes back to the fleet; the driver stops using it (unless they are on a trip right now). What is
 *  still owing stays on the agreement's record. */
export async function endContract(actorId: string, id: string, b: { reason: string }) {
  await needReady();
  const out = await tx(async (c) => {
    const k = await one(`SELECT * FROM fleet_contracts WHERE id = $1 FOR UPDATE`, [id], c);
    if (!k) throw notFound('Agreement');
    if (!['active', 'paused'].includes(k.status)) throw conflict('agreement_closed', 'This agreement has already ended');
    await c.query(`UPDATE fleet_contracts SET status = 'ended', ended_at = now(), end_reason = $2 WHERE id = $1`, [id, b.reason]);
    await c.query(`UPDATE vehicles SET ownership = 'fleet', lease_weekly_cents = 0 WHERE id = $1`, [k.vehicle_id]);
    const busy = await onLiveTrip(k.driver_id, c);
    const moved = busy ? null : await one(`UPDATE drivers SET vehicle_id = NULL, online = false WHERE user_id = $1 AND vehicle_id = $2 RETURNING user_id`, [k.driver_id, k.vehicle_id], c);
    await audit(actorId, 'fleet_contract_ended', 'fleet_contract', id, { ...b, car_returned: !!moved }, c);
    return { driver: k.driver_id as string, returned: !!moved, busy };
  });
  if (out.returned) await (await import('./trips.js')).withdrawOffers(out.driver);
  return { ...(await getContract(id)), car_returned: out.returned, driver_on_trip: out.busy };
}

/**
 * The weekly deduction for every live agreement for the week starting `week` (a Monday, Darwin time; default this week).
 * Once per agreement per week (the week row is the key), under the same per-driver lock as payouts. Paused agreements and
 * agreements not running that week are skipped. Never takes the driver's balance below the amount they keep.
 */
export async function runWeek(week?: string | null, actorId: string | null = null) {
  await needReady();
  const w = week || weekStartOf(new Date());
  if (!isIsoDay(w) || new Date(w + 'T00:00:00Z').getUTCDay() !== 1) throw bad('week', 'Week must be a Monday (YYYY-MM-DD)');
  const policy = await loadFleetPolicy();
  const live = await q(`SELECT id FROM fleet_contracts WHERE status = 'active' AND starts_on <= $1::date + 6 AND (ends_on IS NULL OR ends_on >= $1::date) ORDER BY created_at`, [w]);
  const rows: any[] = [];
  for (const { id } of live) {
    const r = await tx(async (c) => {
      const k = await one(`SELECT c.*, v.rego FROM fleet_contracts c JOIN vehicles v ON v.id = c.vehicle_id WHERE c.id = $1 FOR UPDATE OF c`, [id], c);
      if (!k || k.status !== 'active') return null;
      await lockDriver(k.driver_id, c);
      if (await one(`SELECT 1 FROM fleet_contract_weeks WHERE contract_id = $1 AND week_start = $2`, [id, w], c)) return null;
      const t = await totalsFor(k, c);
      const balance = await balanceOf(k.driver_id, c);
      const d = weekDeduction({ weekly_cents: k.weekly_cents, owing_cents: t.owing_cents, balance_cents: balance, keep_min_cents: k.keep_min_cents,
        catch_up_pct: k.catch_up_pct, buy_out_cents: t.buy_out_cents });
      await c.query(`INSERT INTO fleet_contract_weeks (contract_id, week_start, due_cents, collected_cents, balance_before_cents) VALUES ($1,$2,$3,$4,$5)`,
        [id, w, d.due_cents, d.collected_cents, balance]);
      if (d.collected_cents > 0) {
        const label = k.kind === 'rent_to_own' ? 'Rent-to-own payment' : 'Weekly car lease';
        await c.query(`INSERT INTO driver_ledger (driver_id, kind, amount_cents, note) VALUES ($1,'lease',$2,$3)`,
          [k.driver_id, -d.collected_cents, `${label} ${k.rego}, week of ${w}`]);
      }
      return { contract_id: id, driver_id: k.driver_id, rego: k.rego, kind: k.kind, weekly_cents: k.weekly_cents, ...d,
        buy_out_after_cents: t.buy_out_cents != null ? t.buy_out_cents - d.collected_cents : null };
    }).catch((e) => { logError('fleet week', e); return null; });
    if (r) rows.push(r);
  }
  // Behind by N weeks or more: one open compliance flag per driver, and a plain note to the driver.
  for (const r of rows) {
    if (r.weekly_cents <= 0 || r.owing_after_cents < policy.arrears_flag_weeks * r.weekly_cents) continue;
    const flagged = await one(
      `INSERT INTO compliance_flags (kind, driver_id, detail)
       SELECT 'fleet_arrears', $1::uuid, $2 WHERE NOT EXISTS (SELECT 1 FROM compliance_flags WHERE driver_id = $1 AND kind = 'fleet_arrears' AND status = 'open')
       RETURNING id`, [r.driver_id, `Car agreement ${r.rego}: $${(r.owing_after_cents / 100).toFixed(2)} owing after the week of ${w}`]);
    r.flagged = !!flagged;
    if (flagged) {
      toOps('compliance.flag', { kind: 'fleet_arrears', driver_id: r.driver_id });
      void send(r.driver_id, 'fleet_arrears', { cents: r.owing_after_cents, rego: r.rego }, { data: { contract_id: r.contract_id } });
    }
  }
  if (actorId) await audit(actorId, 'fleet_week_run', 'fleet_contract_weeks', w, { contracts: rows.length });
  return { week: w, charged: rows.filter((r) => r.collected_cents > 0).length, rows,
    collected_cents: rows.reduce((s, r) => s + r.collected_cents, 0), short_cents: rows.reduce((s, r) => s + r.short_cents, 0) };
}

let lastAuto = 0;
/** From the dispatcher tick: the weekly run on Monday from 6 am Darwin time, if switched on (at most every 10 minutes). */
export async function autoWeeklyIfDue(now = new Date()) {
  if (Date.now() - lastAuto < 600_000) return;
  lastAuto = Date.now();
  if (!(await fleetReady())) return;
  const p = await loadFleetPolicy();
  if (!p.auto_weekly) return;
  const parts = new Intl.DateTimeFormat('en-AU', { timeZone: TZ, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }).formatToParts(now);
  if (parts.find((x) => x.type === 'weekday')?.value !== 'Mon' || Number(parts.find((x) => x.type === 'hour')?.value) < 6) return;
  await runWeek(weekStartOf(now)).catch((e) => logError('fleet auto week', e));
}

/** `POST /admin/lease/run`. With migration 024: this week's agreement run. Before it: the old run (every approved driver on a
 *  leased car), now once per Darwin week, locked per driver and never more than the driver's balance. */
export async function leaseRun(actorId: string) {
  if (await fleetReady()) {
    const r = await runWeek(null, actorId);
    return { ...r, rows: r.rows.map((x) => ({ driver_id: x.driver_id, amount_cents: -x.collected_cents, due_cents: x.due_cents, short_cents: x.short_cents })) };
  }
  const week = weekStartOf(new Date());
  const ds = await q(`SELECT d.user_id, v.lease_weekly_cents, v.rego FROM drivers d JOIN vehicles v ON v.id = d.vehicle_id
                      WHERE v.ownership = 'leased_to_driver' AND v.lease_weekly_cents > 0 AND d.status = 'approved'`);
  const rows: any[] = [];
  for (const d of ds) {
    const r = await tx(async (c) => {
      await lockDriver(d.user_id, c);
      const note = `Weekly vehicle lease ${d.rego} — week of ${week}`;
      if (await one(`SELECT 1 FROM driver_ledger WHERE driver_id = $1 AND kind = 'lease' AND note = $2`, [d.user_id, note], c)) return null;
      const take = Math.max(0, Math.min(d.lease_weekly_cents, await balanceOf(d.user_id, c)));
      if (take <= 0) return { driver_id: d.user_id, amount_cents: 0, due_cents: d.lease_weekly_cents, short_cents: d.lease_weekly_cents };
      await c.query(`INSERT INTO driver_ledger (driver_id, kind, amount_cents, note) VALUES ($1,'lease',$2,$3)`, [d.user_id, -take, note]);
      return { driver_id: d.user_id, amount_cents: -take, due_cents: d.lease_weekly_cents, short_cents: d.lease_weekly_cents - take };
    });
    if (r) rows.push(r);
  }
  await audit(actorId, 'lease_run', 'driver_ledger', String(rows.length));
  return { week, charged: rows.filter((r) => r.amount_cents < 0).length, rows, legacy: true };
}

/** The driver's own view: agreement, this week, owing, buy-out balance, recent weeks and the car's next service. */
export async function driverFleet(driverId: string) {
  if (!(await fleetReady())) return { ready: false, contract: null };
  const k = await one(`${CONTRACT_SELECT} WHERE c.driver_id = $1 ORDER BY (c.status IN ('active','paused')) DESC, c.created_at DESC LIMIT 1`, [driverId]);
  if (!k) return { ready: true, contract: null };
  const full = await getContract(k.id);
  const week = weekStartOf(new Date());
  const board = await maintenanceBoard({ vehicleId: k.vehicle_id });
  const car = board.cars[0];
  const next = car?.due?.filter((x: any) => x.status !== 'ok').concat(car?.due?.filter((x: any) => x.status === 'ok') ?? []).slice(0, 2) ?? [];
  const { created_by, notes, ...pub } = full as any;
  return {
    ready: true,
    contract: { ...pub, payments: full.payments.map(({ created_by: _c, ...p }: any) => p), weeks: full.weeks.slice(0, 12),
      this_week: full.weeks.find((x: any) => x.week_start === week) ?? null },
    next_service: next, off_road: car?.open_jobs?.find((j: any) => j.status === 'off_road') ?? null,
  };
}

// ───────────── Maintenance ─────────────

const FLEET_CAR = `v.ownership <> 'driver_owned'`;

/** Every DingoGo car with what is due (by plan), open jobs, recent jobs and the spare cars free now. */
export async function maintenanceBoard(o: { vehicleId?: string } = {}) {
  await needReady();
  const policy = await loadFleetPolicy();
  const today = darwinToday();
  const cars = await q(
    `SELECT v.id, v.rego, v.make, v.model, v.fuel_type, v.odometer_km, v.ownership, v.active, v.status, v.spare,
            coalesce(v.purchase_date, v.created_at::date)::text AS since,
            (SELECT json_build_object('id', u.id, 'name', u.name) FROM drivers d JOIN users u ON u.id = d.user_id WHERE d.vehicle_id = v.id LIMIT 1) AS driver,
            (SELECT avg(b.ambient_c) FROM battery_logs b WHERE b.vehicle_id = v.id AND b.at > now() - interval '7 days') AS week_c
     FROM vehicles v WHERE ${FLEET_CAR} AND ($1::uuid IS NULL OR v.id = $1) ORDER BY v.rego`, [o.vehicleId ?? null]);
  const ids = cars.map((c) => c.id);
  const done = await q(
    `SELECT DISTINCT ON (vehicle_id, kind) vehicle_id, kind, finished_at, odometer_km FROM vehicle_maintenance
     WHERE status = 'done' AND vehicle_id = ANY($1) ORDER BY vehicle_id, kind, finished_at DESC`, [ids]);
  const jobs = await q(
    `SELECT m.*, m.booked_for::text AS booked_for, s.rego AS spare_rego, u.name AS driver_name FROM vehicle_maintenance m
     LEFT JOIN vehicles s ON s.id = m.spare_vehicle_id LEFT JOIN users u ON u.id = m.driver_id
     WHERE m.vehicle_id = ANY($1) AND (m.status IN ('booked','off_road') OR m.created_at > now() - interval '120 days') ORDER BY m.created_at DESC`, [ids]);
  const out = cars.map((car) => {
    const hotWeek = car.week_c != null && Number(car.week_c) >= policy.heat.hot_week_c;
    const due = policy.service_plans.map((p) => {
      const last = done.find((d) => d.vehicle_id === car.id && d.kind === p.kind);
      return dueFor(p, { fuel_type: car.fuel_type, odometer_km: car.odometer_km, since: car.since },
        last ? { done_on: new Date(last.finished_at).toISOString().slice(0, 10), odometer_km: last.odometer_km } : null, { today, heat: policy.heat, hot_week: hotWeek });
    }).filter(Boolean).sort((a: any, b: any) => (a.status === b.status ? a.days_left - b.days_left : ['overdue', 'due_soon', 'ok'].indexOf(a.status) - ['overdue', 'due_soon', 'ok'].indexOf(b.status)));
    const mine = jobs.filter((j) => j.vehicle_id === car.id);
    return { ...car, week_c: car.week_c != null ? Math.round(Number(car.week_c) * 10) / 10 : null, hot_week: hotWeek, due,
      open_jobs: mine.filter((j) => ['booked', 'off_road'].includes(j.status)), recent_jobs: mine.filter((j) => !['booked', 'off_road'].includes(j.status)).slice(0, 5) };
  });
  return { today, cars: out, spares: o.vehicleId ? [] : await freeSpares(), summary: {
    overdue: out.filter((c) => c.due.some((d: any) => d.status === 'overdue')).length,
    due_soon: out.filter((c) => c.due.some((d: any) => d.status === 'due_soon')).length,
    off_road: out.filter((c) => c.open_jobs.some((j: any) => j.status === 'off_road')).length,
  } };
}

/** DingoGo cars that are free to lend: approved, on the road, nobody's car, no open job and no agreement. Marked spares first. */
async function freeSpares(c: Q = pool, except?: string) {
  return q(
    `SELECT v.id, v.rego, v.make, v.model, v.fuel_type, v.spare FROM vehicles v
     WHERE ${FLEET_CAR} AND v.status = 'approved' AND v.active AND ($1::uuid IS NULL OR v.id <> $1)
       AND NOT EXISTS (SELECT 1 FROM drivers d WHERE d.vehicle_id = v.id)
       AND NOT EXISTS (SELECT 1 FROM vehicle_maintenance m WHERE m.vehicle_id = v.id AND m.status = 'off_road')
       AND NOT EXISTS (SELECT 1 FROM fleet_contracts k WHERE k.vehicle_id = v.id AND k.status IN ('active','paused'))
     ORDER BY v.spare DESC, v.rego`, [except ?? null], c);
}

export async function createJob(actorId: string, b: { vehicle_id: string; kind: string; booked_for?: string | null; provider?: string | null; notes?: string | null;
  cost_cents?: number; odometer_km?: number | null; done_on?: string | null; claim_id?: string | null }) {
  await needReady();
  const v = await one(`SELECT id, rego, ownership FROM vehicles WHERE id = $1`, [b.vehicle_id]);
  if (!v) throw notFound('Vehicle');
  if (v.ownership === 'driver_owned') throw bad('not_fleet_car', `${v.rego} belongs to a driver. Maintenance is tracked for DingoGo cars.`);
  // A job already done (for the history: the last service, so the schedule starts from it).
  const done = !!b.done_on;
  const row = await one(
    `INSERT INTO vehicle_maintenance (vehicle_id, kind, status, booked_for, provider, notes, cost_cents, odometer_km, finished_at, claim_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
    [v.id, b.kind, done ? 'done' : 'booked', b.booked_for ?? null, b.provider ?? null, b.notes ?? null, b.cost_cents ?? 0, b.odometer_km ?? null,
      done ? `${b.done_on}T12:00:00+09:30` : null, b.claim_id ?? null, actorId]);
  if (done && b.odometer_km != null) await q(`UPDATE vehicles SET odometer_km = greatest(coalesce(odometer_km, 0), $2) WHERE id = $1`, [v.id, b.odometer_km]);
  await audit(actorId, 'maintenance_created', 'vehicle_maintenance', row.id, b);
  return row;
}

/** The car goes off the road: out of dispatch until the job is finished. Its driver gets the spare car if one is given
 *  (otherwise they are taken offline). Refused while the car is on a trip. */
export async function startJob(actorId: string, id: string, b: { spare_vehicle_id?: string | null }) {
  await needReady();
  const out = await tx(async (c) => {
    const j = await one(`SELECT * FROM vehicle_maintenance WHERE id = $1 FOR UPDATE`, [id], c);
    if (!j) throw notFound('Job');
    if (j.status !== 'booked') throw conflict('job_not_booked', 'Only a booked job can start');
    // Everyone who drives this car (shift drivers can share one): none may be on a trip. The spare goes to the driver on the
    // car's agreement, else the one seen last; the others are taken offline.
    const all = await q(`SELECT d.user_id FROM drivers d WHERE d.vehicle_id = $1
                         ORDER BY EXISTS (SELECT 1 FROM fleet_contracts k WHERE k.vehicle_id = $1 AND k.driver_id = d.user_id AND k.status IN ('active','paused')) DESC,
                                  d.last_seen_at DESC NULLS LAST FOR UPDATE OF d`, [j.vehicle_id], c);
    for (const x of all) if (await onLiveTrip(x.user_id, c)) throw conflict('car_on_trip', 'The car is on a trip. Start the job when the trip is finished.');
    const d = all[0] ?? null;
    const others = all.slice(1).map((x) => x.user_id as string);
    if (others.length) await c.query(`UPDATE drivers SET online = false WHERE user_id = ANY($1)`, [others]);
    let spare: any = null;
    if (b.spare_vehicle_id) {
      if (!d) throw bad('no_driver', 'Nobody drives this car, so no spare car is needed');
      spare = (await freeSpares(c, j.vehicle_id)).find((s: any) => s.id === b.spare_vehicle_id);
      if (!spare) throw conflict('spare_not_free', 'That car is not free to lend');
      await c.query(`UPDATE drivers SET vehicle_id = $2 WHERE user_id = $1`, [d.user_id, spare.id]);
    } else if (d) {
      await c.query(`UPDATE drivers SET online = false WHERE user_id = $1`, [d.user_id]);
    }
    await c.query(`UPDATE vehicles SET active = false WHERE id = $1`, [j.vehicle_id]);
    const row = await one(`UPDATE vehicle_maintenance SET status = 'off_road', started_at = now(), driver_id = $2, spare_vehicle_id = $3 WHERE id = $1 RETURNING *`,
      [id, d?.user_id ?? null, spare?.id ?? null], c);
    await audit(actorId, 'maintenance_started', 'vehicle_maintenance', id, { spare: spare?.rego ?? null }, c);
    return { row, driver: d?.user_id ?? null, spare, others };
  });
  for (const o of out.others) await (await import('./trips.js')).withdrawOffers(o);
  if (out.driver) {
    await (await import('./trips.js')).withdrawOffers(out.driver);
    void send(out.driver, 'fleet_car_off_road', { spare: out.spare ? out.spare.rego : null }, { data: { job_id: id } });
  }
  return { job: out.row, spare: out.spare };
}

/** The car is back: on the road again, odometer and cost recorded; its driver moves back from the spare car (unless they are on
 *  a trip in it right now — then they stay in the spare and `driver_in_spare` says so). */
export async function finishJob(actorId: string, id: string, b: { odometer_km?: number | null; cost_cents?: number; notes?: string | null; provider?: string | null }) {
  await needReady();
  const out = await tx(async (c) => {
    const j = await one(`SELECT * FROM vehicle_maintenance WHERE id = $1 FOR UPDATE`, [id], c);
    if (!j) throw notFound('Job');
    if (!['booked', 'off_road'].includes(j.status)) throw conflict('job_closed', 'This job is already finished or cancelled');
    if (j.status === 'off_road') await c.query(`UPDATE vehicles SET active = true WHERE id = $1`, [j.vehicle_id]);
    if (b.odometer_km != null) await c.query(`UPDATE vehicles SET odometer_km = greatest(coalesce(odometer_km, 0), $2) WHERE id = $1`, [j.vehicle_id, b.odometer_km]);
    let inSpare = false;
    if (j.driver_id && j.spare_vehicle_id) {
      if (await onLiveTrip(j.driver_id, c)) inSpare = true;
      else await c.query(`UPDATE drivers SET vehicle_id = $2 WHERE user_id = $1 AND vehicle_id = $3`, [j.driver_id, j.vehicle_id, j.spare_vehicle_id]);
    }
    const row = await one(
      `UPDATE vehicle_maintenance SET status = 'done', finished_at = now(), started_at = coalesce(started_at, now()), odometer_km = coalesce($2, odometer_km),
         cost_cents = coalesce($3, cost_cents), notes = coalesce($4, notes), provider = coalesce($5, provider) WHERE id = $1 RETURNING *`,
      [id, b.odometer_km ?? null, b.cost_cents ?? null, b.notes ?? null, b.provider ?? null], c);
    await audit(actorId, 'maintenance_finished', 'vehicle_maintenance', id, b, c);
    return { row, inSpare, driver: j.driver_id };
  });
  if (out.driver) void send(out.driver, 'fleet_car_back', {}, { data: { job_id: id } });
  return { job: out.row, driver_in_spare: out.inSpare };
}

export async function cancelJob(actorId: string, id: string) {
  await needReady();
  const j = await one(`UPDATE vehicle_maintenance SET status = 'cancelled' WHERE id = $1 AND status = 'booked' RETURNING *`, [id]);
  if (!j) throw conflict('job_not_booked', 'Only a booked job (not yet off the road) can be cancelled. Finish it instead.');
  await audit(actorId, 'maintenance_cancelled', 'vehicle_maintenance', id);
  return j;
}

// ───────────── Charging ─────────────

/** Reimbursement for a session a driver logs: the rule and amount (before the monthly cap). */
export async function chargingRuleFor(s: { location: string; kwh: number; cost_cents?: number | null; receipt_ref?: string | null }, ownership: string | null) {
  const p = await loadFleetPolicy();
  return chargeReimbursement(s, ownership, p.charging);
}
export const chargeRuleText = (rule?: string | null) => (rule ? (CHARGE_RULE_TEXT as Record<string, string>)[rule] ?? null : null);

/** Pay a driver back for their unpaid sessions: each session's rule amount, up to the monthly cap per Darwin month. */
export async function reimburseCharging(actorId: string, driverId: string) {
  const isReady = await fleetReady();
  const cap = (await loadFleetPolicy()).charging.monthly_cap_cents;
  return tx(async (c) => {
    await lockDriver(driverId, c);
    const amount = isReady ? 'coalesce(reimburse_cents, cost_cents, 0)' : 'coalesce(cost_cents, 0)';
    const rows = await q(
      `SELECT id, ${amount}::int AS cents, to_char(started_at AT TIME ZONE $2, 'YYYY-MM') AS month FROM charging_sessions
       WHERE driver_id = $1 AND reimbursable AND reimbursed_at IS NULL ORDER BY started_at FOR UPDATE`, [driverId, TZ], c);
    const paidBefore = new Map<string, number>();
    if (isReady && cap > 0) {
      for (const r of await q(`SELECT to_char(started_at AT TIME ZONE $2, 'YYYY-MM') AS month, sum(reimburse_cents)::int cents FROM charging_sessions
                               WHERE driver_id = $1 AND reimbursed_at IS NOT NULL GROUP BY 1`, [driverId, TZ], c)) paidBefore.set(r.month, r.cents ?? 0);
    }
    let total = 0, capped = 0;
    for (const r of rows) {
      let pay = r.cents;
      if (isReady && cap > 0) {
        const used = paidBefore.get(r.month) ?? 0;
        pay = Math.max(0, Math.min(pay, cap - used));
        paidBefore.set(r.month, used + pay);
        capped += r.cents - pay;
      }
      total += pay;
      if (isReady) await c.query(`UPDATE charging_sessions SET reimbursed_at = now(), reimburse_cents = $2 WHERE id = $1`, [r.id, pay]);
      else await c.query(`UPDATE charging_sessions SET reimbursed_at = now() WHERE id = $1`, [r.id]);
    }
    if (total > 0) await c.query(`INSERT INTO driver_ledger (driver_id, kind, amount_cents, note) VALUES ($1,'charging_credit',$2,$3)`,
      [driverId, total, `Charging reimbursement (${rows.length} session${rows.length === 1 ? '' : 's'})`]);
    await audit(actorId, 'charging_reimburse', 'driver', driverId, { total, capped }, c);
    return { sessions: rows.length, total_cents: total, over_cap_cents: capped };
  });
}

// ───────────── Insurance and claims ─────────────

/** Keeps the car's insurance expiry (used by compliance and reminders) at the latest comprehensive / property policy end. */
export async function syncInsuranceExpiry(vehicleId: string) {
  await q(`UPDATE vehicles SET insurance_expiry = x.ends_on FROM (SELECT max(ends_on) ends_on FROM fleet_insurance WHERE vehicle_id = $1
             AND cover IN ('comprehensive','third_party_property')) x WHERE vehicles.id = $1 AND x.ends_on IS NOT NULL`, [vehicleId]);
}

export async function listInsurance() {
  await needReady();
  const policies = await q(`SELECT i.*, i.starts_on::text AS starts_on, i.ends_on::text AS ends_on, v.rego FROM fleet_insurance i JOIN vehicles v ON v.id = i.vehicle_id
                            ORDER BY i.ends_on DESC LIMIT 500`);
  const claims = await q(`SELECT k.*, v.rego, u.name AS driver_name, t.ref AS trip_ref, i.insurer, i.policy_no FROM fleet_claims k JOIN vehicles v ON v.id = k.vehicle_id
                          LEFT JOIN users u ON u.id = k.driver_id LEFT JOIN trips t ON t.id = k.trip_id LEFT JOIN fleet_insurance i ON i.id = k.policy_id
                          ORDER BY (k.status IN ('open','lodged','approved')) DESC, k.incident_at DESC LIMIT 500`);
  const today = darwinToday();
  return { policies: policies.map((p) => ({ ...p, current: p.starts_on <= today && p.ends_on >= today, days_left: overlapDays(today, p.ends_on, today, null) - 1 })), claims };
}

// ───────────── Profitability and investors ─────────────

export interface CarProfit {
  vehicle_id: string; rego: string; make: string; model: string; fuel_type: string; ownership: string;
  days: number; off_road_days: number; trips: number; km: number; engaged_hours: number; engaged_hours_per_day: number; utilisation_pct: number | null;
  income: { service_fees_cents: number; agreement_cents: number; ads_cents: number; insurance_payouts_cents: number; total_cents: number };
  costs: { charging_cents: number; maintenance_cents: number; insurance_cents: number; claims_cents: number; finance_cents: number; total_cents: number };
  profit_cents: number; profit_per_km_cents: number | null;
}

/** Per DingoGo car for [from, to] (Darwin dates): what it earned DingoGo, what it cost, profit and how busy it was. */
export async function profitability(from: string, to: string): Promise<{ from: string; to: string; cars: CarProfit[]; totals: any }> {
  await needReady();
  if (!isIsoDay(from) || !isIsoDay(to) || to < from) throw bad('range', 'Give from and to as dates (YYYY-MM-DD), from first');
  if (daysIn(from, to) > 400) throw bad('range', 'Choose a range of up to 400 days');
  const policy = await loadFleetPolicy();
  const B = `WITH b AS (SELECT ($1::date)::timestamp AT TIME ZONE '${TZ}' AS f, ($2::date + 1)::timestamp AT TIME ZONE '${TZ}' AS t)`;
  const cars = await q(`SELECT v.id, v.rego, v.make, v.model, v.fuel_type, v.ownership, v.finance_weekly_cents FROM vehicles v
                        WHERE ${FLEET_CAR} OR EXISTS (SELECT 1 FROM fleet_contracts k WHERE k.vehicle_id = v.id AND k.starts_on <= $1::date) ORDER BY v.rego`, [to]);
  const ids = cars.map((c) => c.id);
  const P = [from, to, ids];
  const engaged = await engagedFromSql('t');
  const by = async (sql: string) => new Map((await q(`${B} ${sql}`, P)).map((r: any) => [r.vehicle_id, r]));
  const [tr, fees, agree, pays, ads, charging, maint, claims] = await Promise.all([
    by(`SELECT t.vehicle_id, count(*)::int trips, coalesce(sum(coalesce(t.actual_distance_m, t.est_distance_m)),0)::bigint m,
          coalesce(sum(greatest(0, least(extract(epoch FROM t.completed_at - ${engaged}), t.est_duration_s * 2 + 2700))),0)::bigint s
        FROM trips t, b WHERE t.vehicle_id = ANY($3) AND t.status = 'completed' AND t.completed_at >= b.f AND t.completed_at < b.t GROUP BY 1`),
    by(`SELECT t.vehicle_id, (-sum(l.amount_cents))::int cents FROM driver_ledger l JOIN trips t ON t.id = l.trip_id, b
        WHERE l.kind = 'commission' AND t.vehicle_id = ANY($3) AND l.created_at >= b.f AND l.created_at < b.t GROUP BY 1`),
    by(`SELECT k.vehicle_id, sum(w.collected_cents)::int cents FROM fleet_contract_weeks w JOIN fleet_contracts k ON k.id = w.contract_id
        WHERE k.vehicle_id = ANY($3) AND w.week_start BETWEEN $1::date AND $2::date GROUP BY 1`),
    by(`SELECT k.vehicle_id, sum(p.cents)::int cents FROM fleet_contract_payments p JOIN fleet_contracts k ON k.id = p.contract_id, b
        WHERE k.vehicle_id = ANY($3) AND p.kind IN ('deposit','payment','buy_out') AND p.created_at >= b.f AND p.created_at < b.t GROUP BY 1`),
    by(`SELECT p.vehicle_id, round(sum(c.cpm_cents) / 1000.0)::int cents FROM ad_plays p JOIN ad_campaigns c ON c.id = p.campaign_id, b
        WHERE p.vehicle_id = ANY($3) AND p.at >= b.f AND p.at < b.t GROUP BY 1`),
    // Paid back to drivers (when reimbursed) plus depot charging DingoGo pays for directly.
    by(`SELECT s.vehicle_id, (coalesce(sum(coalesce(s.reimburse_cents, s.cost_cents)) FILTER (WHERE s.reimbursed_at >= b.f AND s.reimbursed_at < b.t), 0)
          + coalesce(sum(s.cost_cents) FILTER (WHERE s.location = 'depot' AND s.reimbursed_at IS NULL AND s.started_at >= b.f AND s.started_at < b.t), 0))::int cents
        FROM charging_sessions s, b WHERE s.vehicle_id = ANY($3) GROUP BY 1`),
    by(`SELECT m.vehicle_id, sum(m.cost_cents)::int cents FROM vehicle_maintenance m, b
        WHERE m.vehicle_id = ANY($3) AND m.status = 'done' AND m.finished_at >= b.f AND m.finished_at < b.t GROUP BY 1`),
    by(`SELECT k.vehicle_id, sum(greatest(0, CASE WHEN k.status = 'declined' THEN k.repair_cost_cents ELSE k.excess_cents END - k.driver_contribution_cents))::int cents,
          sum(k.payout_cents)::int payouts FROM fleet_claims k, b
        WHERE k.vehicle_id = ANY($3) AND k.incident_at >= b.f AND k.incident_at < b.t GROUP BY 1`),
  ]);
  const policies = await q(`SELECT vehicle_id, starts_on::text AS starts_on, ends_on::text AS ends_on, premium_cents FROM fleet_insurance
                            WHERE vehicle_id = ANY($3) AND starts_on <= $2::date AND ends_on >= $1::date`, P);
  const down = await q(`SELECT vehicle_id, (started_at AT TIME ZONE '${TZ}')::date::text AS a, (coalesce(finished_at, now()) AT TIME ZONE '${TZ}')::date::text AS b,
                          extract(epoch FROM coalesce(finished_at, now()) - started_at) AS s
                        FROM vehicle_maintenance WHERE vehicle_id = ANY($3) AND started_at IS NOT NULL AND status IN ('off_road','done')
                          AND (started_at AT TIME ZONE '${TZ}')::date <= $2::date AND (coalesce(finished_at, now()) AT TIME ZONE '${TZ}')::date >= $1::date`, P);
  const days = daysIn(from, to);
  const n = (m: Map<string, any>, id: string, k = 'cents') => Number(m.get(id)?.[k] ?? 0);
  const out: CarProfit[] = cars.map((v) => {
    // Off road: whole days of each job inside the range (a job inside one day counts its hours).
    const offRoad = Math.min(days, down.filter((d) => d.vehicle_id === v.id).reduce((s, d) => {
      const span = daysIn(d.a, d.b);
      const inRange = overlapDays(from, to, d.a, d.b);
      return s + (span <= 1 ? Math.min(1, Number(d.s) / 86400) : inRange);
    }, 0));
    const t = tr.get(v.id);
    const engagedH = Math.round((Number(t?.s ?? 0) / 3600) * 10) / 10;
    const avail = Math.max(0, days - offRoad);
    const income = { service_fees_cents: n(fees, v.id), agreement_cents: n(agree, v.id) + n(pays, v.id), ads_cents: n(ads, v.id), insurance_payouts_cents: n(claims, v.id, 'payouts'), total_cents: 0 };
    income.total_cents = income.service_fees_cents + income.agreement_cents + income.ads_cents + income.insurance_payouts_cents;
    const insurance = policies.filter((p) => p.vehicle_id === v.id).reduce((s, p) => s + prorate(p.premium_cents, p.starts_on, p.ends_on, from, to), 0);
    const costs = { charging_cents: n(charging, v.id), maintenance_cents: n(maint, v.id), insurance_cents: insurance, claims_cents: n(claims, v.id),
      finance_cents: Math.round((Number(v.finance_weekly_cents ?? 0) * days) / 7), total_cents: 0 };
    costs.total_cents = costs.charging_cents + costs.maintenance_cents + costs.insurance_cents + costs.claims_cents + costs.finance_cents;
    const km = Math.round(Number(t?.m ?? 0) / 100) / 10;
    const profit = income.total_cents - costs.total_cents;
    return {
      vehicle_id: v.id, rego: v.rego, make: v.make, model: v.model, fuel_type: v.fuel_type, ownership: v.ownership,
      days, off_road_days: Math.round(offRoad * 10) / 10, trips: Number(t?.trips ?? 0), km, engaged_hours: engagedH,
      engaged_hours_per_day: avail ? Math.round((engagedH / avail) * 10) / 10 : 0,
      utilisation_pct: avail ? Math.round((engagedH / (avail * policy.target_hours_per_day)) * 1000) / 10 : null,
      income, costs, profit_cents: profit, profit_per_km_cents: km > 0 ? Math.round(profit / km) : null,
    };
  });
  const sum = (f: (c: CarProfit) => number) => out.reduce((s, c) => s + f(c), 0);
  return { from, to, cars: out, totals: { cars: out.length, trips: sum((c) => c.trips), km: Math.round(sum((c) => c.km) * 10) / 10,
    income_cents: sum((c) => c.income.total_cents), costs_cents: sum((c) => c.costs.total_cents), profit_cents: sum((c) => c.profit_cents) } };
}

/** Each investor's share of their cars' profit for a month (Darwin). Shares that ran part of the month count for those days. */
export async function investorReport(month: string) {
  await needReady();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad('month', 'Month must be YYYY-MM');
  const from = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  const shares = await q(`SELECT s.*, s.starts_on::text AS starts_on, s.ends_on::text AS ends_on, i.name AS investor, i.payment_ref, v.rego
                          FROM fleet_investor_shares s JOIN fleet_investors i ON i.id = s.investor_id JOIN vehicles v ON v.id = s.vehicle_id
                          WHERE s.starts_on <= $2::date AND (s.ends_on IS NULL OR s.ends_on >= $1::date) ORDER BY i.name, v.rego`, [from, to]);
  const report = shares.length ? await profitability(from, to) : { cars: [] as CarProfit[] };
  const car = new Map(report.cars.map((c) => [c.vehicle_id, c]));
  const rows = shares.map((s) => {
    const c = car.get(s.vehicle_id);
    const profit = c?.profit_cents ?? 0;
    return { investor_id: s.investor_id, investor: s.investor, payment_ref: s.payment_ref, vehicle_id: s.vehicle_id, rego: s.rego, share_pct: Number(s.share_pct),
      days: overlapDays(from, to, s.starts_on, s.ends_on), car_income_cents: c?.income.total_cents ?? 0, car_costs_cents: c?.costs.total_cents ?? 0,
      car_profit_cents: profit, share_cents: investorShare(profit, Number(s.share_pct), from, to, s.starts_on, s.ends_on) };
  });
  const investors = [...new Map(rows.map((r) => [r.investor_id, r.investor])).entries()].map(([id, name]) => ({
    investor_id: id, investor: name, cars: rows.filter((r) => r.investor_id === id).length, share_cents: rows.filter((r) => r.investor_id === id).reduce((s, r) => s + r.share_cents, 0) }));
  return { month, from, to, rows, investors };
}

/** Shares of one car can't add up to more than 100% on any day. */
export async function checkShareTotal(vehicleId: string, pct: number, startsOn: string, endsOn: string | null, exceptId?: string) {
  const r = await one<{ pct: number }>(
    `SELECT coalesce(sum(share_pct), 0)::float AS pct FROM fleet_investor_shares WHERE vehicle_id = $1 AND ($4::uuid IS NULL OR id <> $4)
       AND starts_on <= coalesce($3::date, 'infinity'::date) AND coalesce(ends_on, 'infinity'::date) >= $2::date`, [vehicleId, startsOn, endsOn, exceptId ?? null]);
  if (Number(r!.pct) + pct > 100.001) throw bad('shares_over_100', `Shares in this car would add up to ${Math.round((Number(r!.pct) + pct) * 100) / 100}%. The most is 100%.`);
}

export { DEFAULT_FLEET_POLICY };
