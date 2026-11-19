/**
 * Round 20: fleet and EV programme rules (pure; no database). Policy defaults and checks, the weekly deduction for car
 * agreements (never below what the driver must keep, arrears caught up within a cap, rent-to-own never past the price),
 * agreement totals (owing, buy-out balance), charging reimbursement rules, maintenance due dates by km and months with the
 * heat rule for batteries, and the share/proration helpers used by the profitability and investor reports.
 */
import { ApiError } from './errors.js';

export const CONTRACT_KINDS = ['weekly_lease', 'rent_to_own'] as const;
export type ContractKind = (typeof CONTRACT_KINDS)[number];
export const MAINT_KINDS = ['service', 'tyres', 'brakes', 'battery_check', 'repair', 'inspection', 'other'] as const;
export const CLAIM_KINDS = ['collision', 'animal', 'windscreen', 'hail', 'theft', 'vandalism', 'other'] as const;
export const CLAIM_STATUSES = ['open', 'lodged', 'approved', 'declined', 'paid', 'closed'] as const;
export const COVERS = ['comprehensive', 'third_party_property', 'ctp', 'public_liability', 'other'] as const;
const FUELS = ['electric', 'plug_in_hybrid', 'hybrid', 'petrol', 'diesel'];

export interface ServicePlan { key: string; kind: (typeof MAINT_KINDS)[number]; label: string; every_km: number | null; every_months: number; fuels: string[] }
export interface ChargingRules {
  home_cents_per_kwh: number; public_max_cents_per_kwh: number; public_needs_receipt: boolean; depot_reimbursed: boolean; monthly_cap_cents: number;
}
export interface FleetPolicy {
  /** Shows the fleet programme in admin (contracts, maintenance, insurance, profitability, investors). Off until the fleet launches. */
  enabled: boolean;
  /** Run the weekly agreement deductions automatically on Monday mornings (Darwin time). */
  auto_weekly: boolean;
  /** Owing this many weeks' payments raises a compliance flag and a note to the driver. */
  arrears_flag_weeks: number;
  /** Hours a day a car is expected to work, for the utilisation figure. */
  target_hours_per_day: number;
  charging: ChargingRules;
  service_plans: ServicePlan[];
  heat: { hot_months: number[]; battery_every_months_hot: number; hot_week_c: number; recheck_days: number };
}

export const DEFAULT_SERVICE_PLANS: ServicePlan[] = [
  { key: 'service_ev', kind: 'service', label: 'Scheduled service', every_km: 20000, every_months: 12, fuels: ['electric'] },
  { key: 'service_fuel', kind: 'service', label: 'Scheduled service', every_km: 10000, every_months: 6, fuels: ['plug_in_hybrid', 'hybrid', 'petrol', 'diesel'] },
  { key: 'tyres', kind: 'tyres', label: 'Tyre rotation and tread check', every_km: 10000, every_months: 6, fuels: FUELS },
  { key: 'brakes', kind: 'brakes', label: 'Brake check', every_km: 20000, every_months: 12, fuels: FUELS },
  { key: 'battery', kind: 'battery_check', label: 'Battery health and cooling check', every_km: null, every_months: 6, fuels: ['electric', 'plug_in_hybrid'] },
];

export const DEFAULT_FLEET_POLICY: FleetPolicy = {
  enabled: false, auto_weekly: false, arrears_flag_weeks: 2, target_hours_per_day: 10,
  charging: { home_cents_per_kwh: 30, public_max_cents_per_kwh: 80, public_needs_receipt: false, depot_reimbursed: false, monthly_cap_cents: 25000 },
  service_plans: DEFAULT_SERVICE_PLANS,
  // Alice Springs summers: batteries are checked every 3 months from October to March, and again after a week averaging 40°C+.
  heat: { hot_months: [10, 11, 12, 1, 2, 3], battery_every_months_hot: 3, hot_week_c: 40, recheck_days: 30 },
};

const bad = (field: string, message: string) => new ApiError(400, 'invalid_fleet_policy', message, { field });
const int = (v: unknown, lo: number, hi: number, field: string) => {
  const n = Number(v);
  if (!Number.isInteger(n) || n < lo || n > hi) throw bad(field, `${field} must be a whole number from ${lo} to ${hi}`);
  return n;
};

/** Stored policy over the defaults (missing keys take the default). */
export function mergeFleetPolicy(v: any): FleetPolicy {
  const d = DEFAULT_FLEET_POLICY;
  if (!v || typeof v !== 'object') return structuredClone(d);
  return {
    ...d, ...v,
    charging: { ...d.charging, ...(v.charging ?? {}) },
    heat: { ...d.heat, ...(v.heat ?? {}) },
    service_plans: Array.isArray(v.service_plans) && v.service_plans.length ? v.service_plans : d.service_plans,
  };
}

/** Checks a policy an admin saves; returns it merged and cleaned. */
export function checkFleetPolicy(v: any): FleetPolicy {
  const p = mergeFleetPolicy(v);
  const out: FleetPolicy = {
    enabled: p.enabled === true, auto_weekly: p.auto_weekly === true,
    arrears_flag_weeks: int(p.arrears_flag_weeks, 1, 12, 'arrears_flag_weeks'),
    target_hours_per_day: int(p.target_hours_per_day, 1, 24, 'target_hours_per_day'),
    charging: {
      home_cents_per_kwh: int(p.charging.home_cents_per_kwh, 0, 200, 'charging.home_cents_per_kwh'),
      public_max_cents_per_kwh: int(p.charging.public_max_cents_per_kwh, 0, 300, 'charging.public_max_cents_per_kwh'),
      public_needs_receipt: p.charging.public_needs_receipt === true, depot_reimbursed: p.charging.depot_reimbursed === true,
      monthly_cap_cents: int(p.charging.monthly_cap_cents, 0, 500000, 'charging.monthly_cap_cents'),
    },
    heat: {
      hot_months: [...new Set((Array.isArray(p.heat.hot_months) ? p.heat.hot_months : []).map((m: unknown) => int(m, 1, 12, 'heat.hot_months')))].sort((a, b) => a - b),
      battery_every_months_hot: int(p.heat.battery_every_months_hot, 1, 12, 'heat.battery_every_months_hot'),
      hot_week_c: int(p.heat.hot_week_c, 25, 55, 'heat.hot_week_c'),
      recheck_days: int(p.heat.recheck_days, 1, 365, 'heat.recheck_days'),
    },
    service_plans: [],
  };
  if (!Array.isArray(p.service_plans) || p.service_plans.length > 20) throw bad('service_plans', 'service_plans must be a list of up to 20 plans');
  const keys = new Set<string>();
  for (const [i, s] of p.service_plans.entries()) {
    const f = `service_plans[${i}]`;
    if (!s || typeof s !== 'object') throw bad(f, `${f} must be a plan`);
    const key = String(s.key ?? '').trim();
    if (!/^[a-z0-9_]{2,30}$/.test(key) || keys.has(key)) throw bad(`${f}.key`, `${f}.key must be a unique short name (a-z, 0-9, _)`);
    keys.add(key);
    if (!(MAINT_KINDS as readonly string[]).includes(s.kind)) throw bad(`${f}.kind`, `${f}.kind must be one of ${MAINT_KINDS.join(', ')}`);
    const label = String(s.label ?? '').trim();
    if (label.length < 2 || label.length > 60) throw bad(`${f}.label`, `${f}.label must be 2 to 60 characters`);
    const fuels = Array.isArray(s.fuels) ? s.fuels.filter((x: string) => FUELS.includes(x)) : [];
    if (!fuels.length) throw bad(`${f}.fuels`, `${f}.fuels must list at least one fuel type`);
    out.service_plans.push({
      key, kind: s.kind, label, fuels,
      every_km: s.every_km == null || (s.every_km as unknown) === '' ? null : int(s.every_km, 500, 200000, `${f}.every_km`),
      every_months: int(s.every_months, 1, 60, `${f}.every_months`),
    });
  }
  return out;
}

// ───────────── Agreements ─────────────

export interface ContractTotals {
  due_cents: number; collected_cents: number; paid_cents: number; waived_cents: number; deposit_cents: number;
  /** Payments due but not yet taken (negative = paid ahead). */
  owing_cents: number;
  /** Rent-to-own: what is left to pay to own the car (null for a lease). */
  buy_out_cents: number | null;
  weeks_behind: number;
}

/** Totals for an agreement from its week rows and payments. Paid ahead counts against later weeks. */
export function contractTotals(c: { kind: string; weekly_cents: number; price_cents?: number | null },
  weeks: { due_cents: number; collected_cents: number }[], payments: { kind: string; cents: number }[]): ContractTotals {
  const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);
  const due = sum(weeks.map((w) => w.due_cents));
  const collected = sum(weeks.map((w) => w.collected_cents));
  const pay = (k: string) => sum(payments.filter((p) => p.kind === k).map((p) => p.cents));
  const paid = pay('payment') + pay('buy_out');
  const waived = pay('waiver');
  const deposit = pay('deposit');
  const owing = due - collected - pay('payment') - waived;
  const buyOut = c.kind === 'rent_to_own' ? Math.max(0, Number(c.price_cents ?? 0) - deposit - collected - paid) : null;
  return {
    due_cents: due, collected_cents: collected, paid_cents: paid, waived_cents: waived, deposit_cents: deposit, owing_cents: owing,
    buy_out_cents: buyOut, weeks_behind: c.weekly_cents > 0 ? Math.max(0, Math.floor((owing / c.weekly_cents) * 10) / 10) : 0,
  };
}

/**
 * One week's deduction. Due is the weekly amount (rent-to-own: never more than is left to own the car once what is owing is
 * counted). The deduction takes this week plus anything owing, but never more than the catch-up cap and never more than the
 * driver's balance above what they must keep — so a driver's balance never goes below zero (or the amount kept).
 */
export function weekDeduction(i: {
  weekly_cents: number; owing_cents: number; balance_cents: number; keep_min_cents: number; catch_up_pct: number; buy_out_cents?: number | null;
}) {
  const owingBefore = i.owing_cents;
  let due = Math.max(0, i.weekly_cents);
  if (i.buy_out_cents != null) due = Math.max(0, Math.min(due, i.buy_out_cents - Math.max(0, owingBefore)));
  const owed = Math.max(0, due + owingBefore);
  const cap = Math.max(due, Math.round((i.weekly_cents * i.catch_up_pct) / 100));
  const available = Math.max(0, i.balance_cents - Math.max(0, i.keep_min_cents));
  const collected = Math.max(0, Math.min(owed, cap, available));
  return { due_cents: due, collected_cents: collected, owing_after_cents: owingBefore + due - collected, short_cents: Math.max(0, owed - collected) };
}

/** Weeks of payments a rent-to-own agreement needs after the deposit (for the form's summary). */
export const payoffWeeks = (price: number, deposit: number, weekly: number) => (weekly > 0 ? Math.ceil(Math.max(0, price - deposit) / weekly) : null);

// ───────────── Charging ─────────────

export type ChargeRule = 'home_tariff' | 'public_at_cost' | 'public_capped' | 'public_no_receipt' | 'depot' | 'depot_at_cost' | 'driver_owned';
/** What DingoGo pays the driver back for a charging session (before the monthly cap). */
export function chargeReimbursement(s: { location: string; kwh: number; cost_cents?: number | null; receipt_ref?: string | null },
  ownership: string | null | undefined, r: ChargingRules): { reimbursable: boolean; cents: number; rule: ChargeRule } {
  const kwh = Math.max(0, Number(s.kwh) || 0);
  const cost = Math.max(0, Math.round(Number(s.cost_cents ?? 0)));
  if (!ownership || ownership === 'driver_owned') return { reimbursable: false, cents: 0, rule: 'driver_owned' };
  if (s.location === 'depot') return r.depot_reimbursed ? { reimbursable: cost > 0, cents: cost, rule: 'depot_at_cost' } : { reimbursable: false, cents: 0, rule: 'depot' };
  if (s.location === 'public') {
    if (r.public_needs_receipt && !s.receipt_ref) return { reimbursable: false, cents: 0, rule: 'public_no_receipt' };
    const cap = Math.round(kwh * r.public_max_cents_per_kwh);
    return cost <= cap ? { reimbursable: cost > 0, cents: cost, rule: 'public_at_cost' } : { reimbursable: cap > 0, cents: cap, rule: 'public_capped' };
  }
  const cents = Math.round(kwh * r.home_cents_per_kwh);
  return { reimbursable: cents > 0, cents, rule: 'home_tariff' };
}

/** Plain words for a reimbursement rule (driver app and admin). */
export const CHARGE_RULE_TEXT: Record<ChargeRule, string> = {
  home_tariff: 'Home charging, paid back at the household tariff per kWh',
  public_at_cost: 'Public charger, paid back at cost',
  public_capped: 'Public charger, paid back up to the per-kWh limit',
  public_no_receipt: 'Public charger: add the receipt to be paid back',
  depot: 'Depot charging is paid by DingoGo directly',
  depot_at_cost: 'Depot charging, paid back at cost',
  driver_owned: 'Your own car: keep the cost for your tax return',
};

// ───────────── Maintenance ─────────────

const dayMs = 864e5;
export const addMonths = (d: string, n: number) => {
  const [y, m, dd] = d.slice(0, 10).split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  const last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(dd, last))).toISOString().slice(0, 10);
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b.slice(0, 10)) - Date.parse(a.slice(0, 10))) / dayMs);

export interface DueItem {
  key: string; kind: string; label: string; due_date: string; due_km: number | null; days_left: number; km_left: number | null;
  status: 'ok' | 'due_soon' | 'overdue'; reason: 'time' | 'km' | 'hot_week' | null; last_done: string | null;
}

/** When a plan is next due for a car: months from the last time it was done (or the car joined), km from the last odometer. */
export function dueFor(plan: ServicePlan, car: { fuel_type?: string | null; odometer_km?: number | null; since: string },
  last: { done_on: string; odometer_km?: number | null } | null, o: { today: string; heat: FleetPolicy['heat']; hot_week?: boolean }): DueItem | null {
  const fuel = car.fuel_type ?? 'electric';
  if (!plan.fuels.includes(fuel)) return null;
  const month = Number(o.today.slice(5, 7));
  const battery = plan.kind === 'battery_check';
  const months = battery && o.heat.hot_months.includes(month) ? Math.min(plan.every_months, o.heat.battery_every_months_hot) : plan.every_months;
  const base = (last?.done_on ?? car.since).slice(0, 10);
  let due = addMonths(base, months);
  let reason: DueItem['reason'] = null;
  if (battery && o.hot_week && daysBetween(base, o.today) >= o.heat.recheck_days && due > o.today) { due = o.today; reason = 'hot_week'; }
  const baseKm = last ? (last.odometer_km ?? null) : 0;
  const dueKm = plan.every_km && baseKm != null ? baseKm + plan.every_km : null;
  const kmLeft = dueKm != null && car.odometer_km != null ? dueKm - car.odometer_km : null;
  const daysLeft = daysBetween(o.today, due);
  const overdue = daysLeft < 0 || (kmLeft != null && kmLeft < 0);
  const soon = daysLeft <= 30 || (kmLeft != null && kmLeft <= 1000) || reason === 'hot_week';
  if (!reason) reason = kmLeft != null && kmLeft <= 1000 ? 'km' : daysLeft <= 30 ? 'time' : null;
  return {
    key: plan.key, kind: plan.kind, label: plan.label, due_date: due, due_km: dueKm, days_left: daysLeft, km_left: kmLeft,
    status: overdue ? 'overdue' : soon ? 'due_soon' : 'ok', reason, last_done: last?.done_on?.slice(0, 10) ?? null,
  };
}

// ───────────── Reports ─────────────

/** Days of [from, to] (inclusive dates) that overlap [a, b] (b null = open). */
export function overlapDays(from: string, to: string, a: string, b: string | null) {
  const s = a > from ? a : from;
  const e = b && b < to ? b : to;
  return Math.max(0, daysBetween(s, e) + 1);
}
export const daysIn = (from: string, to: string) => Math.max(0, daysBetween(from, to) + 1);

/** Part of a cost spread over a period that falls in the report range. */
export const prorate = (cents: number, periodFrom: string, periodTo: string, from: string, to: string) => {
  const total = daysIn(periodFrom, periodTo);
  return total ? Math.round((cents * overlapDays(from, to, periodFrom, periodTo)) / total) : 0;
};

/** An investor's share of a car's profit for a range: profit × share % × the part of the range the share ran. Losses are shared too. */
export function investorShare(profitCents: number, sharePct: number, from: string, to: string, startsOn: string, endsOn: string | null) {
  const days = daysIn(from, to);
  if (!days) return 0;
  return Math.round((profitCents * (sharePct / 100) * overlapDays(from, to, startsOn, endsOn)) / days);
}
