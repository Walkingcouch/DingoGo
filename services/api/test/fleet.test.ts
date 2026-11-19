/** Round 20: fleet and EV programme rules (pure; no database). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FLEET_POLICY, addMonths, chargeReimbursement, checkFleetPolicy, contractTotals, daysIn, dueFor, investorShare, mergeFleetPolicy, overlapDays,
  payoffWeeks, prorate, weekDeduction,
} from '../src/lib/fleet.js';
import { ApiError } from '../src/lib/errors.js';

const W = 11333;
const ded = (o: Partial<Parameters<typeof weekDeduction>[0]>) =>
  weekDeduction({ weekly_cents: W, owing_cents: 0, balance_cents: 50000, keep_min_cents: 0, catch_up_pct: 150, buy_out_cents: null, ...o });

test('weekly deduction: full week, short week never below zero, catch-up within the cap, kept minimum, paid ahead', () => {
  assert.deepEqual(ded({}), { due_cents: W, collected_cents: W, owing_after_cents: 0, short_cents: 0 });
  // Only $50 earned: $50 taken, the rest owing; the balance never goes below zero.
  const short = ded({ balance_cents: 5000 });
  assert.deepEqual([short.collected_cents, short.owing_after_cents, short.short_cents], [5000, W - 5000, W - 5000]);
  assert.equal(ded({ balance_cents: -2000 }).collected_cents, 0, 'a negative balance gives nothing');
  // Next week: this week plus what is owing, but no more than 150% of the weekly amount.
  const catchUp = ded({ owing_cents: W - 5000, balance_cents: 100000 });
  assert.equal(catchUp.collected_cents, Math.round(W * 1.5));
  assert.equal(catchUp.owing_after_cents, W - 5000 + W - Math.round(W * 1.5));
  assert.equal(ded({ owing_cents: 1000, balance_cents: 100000 }).collected_cents, W + 1000, 'small arrears cleared in one go');
  // The driver always keeps their minimum.
  assert.equal(ded({ balance_cents: 15000, keep_min_cents: 10000 }).collected_cents, 5000);
  assert.equal(ded({ balance_cents: 8000, keep_min_cents: 10000 }).collected_cents, 0);
  // Paid ahead: a credit reduces this week's deduction.
  assert.equal(ded({ owing_cents: -5000 }).collected_cents, W - 5000);
  assert.equal(ded({ owing_cents: -20000 }).collected_cents, 0);
  // Catch-up cap below 100% isn't possible: at least the week's amount.
  assert.equal(ded({ catch_up_pct: 50, owing_cents: 5000, balance_cents: 100000 }).collected_cents, W);
});

test('rent-to-own: due never more than is left to own the car; agreement totals, waivers, payments and the buy-out balance', () => {
  // $200 left to own, nothing owing: this week is capped at $200.
  assert.deepEqual([ded({ buy_out_cents: 20000, weekly_cents: 30000 }).due_cents, ded({ buy_out_cents: 20000, weekly_cents: 30000 }).collected_cents], [20000, 20000]);
  // $150 owing of the $200 left: only $50 more falls due.
  assert.equal(ded({ buy_out_cents: 20000, weekly_cents: 30000, owing_cents: 15000 }).due_cents, 5000);
  assert.equal(ded({ buy_out_cents: 0, weekly_cents: 30000 }).due_cents, 0, 'paid off: nothing more is due');

  const rto = { kind: 'rent_to_own', weekly_cents: 30000, price_cents: 100000 };
  const t = contractTotals(rto, [{ due_cents: 30000, collected_cents: 30000 }, { due_cents: 30000, collected_cents: 10000 }],
    [{ kind: 'deposit', cents: 20000 }, { kind: 'payment', cents: 5000 }, { kind: 'waiver', cents: 2000 }]);
  assert.equal(t.owing_cents, 60000 - 40000 - 5000 - 2000);
  assert.equal(t.buy_out_cents, 100000 - 20000 - 40000 - 5000, 'waivers do not count towards owning the car');
  assert.equal(t.weeks_behind, 0.4);
  const lease = contractTotals({ kind: 'weekly_lease', weekly_cents: W }, [{ due_cents: W, collected_cents: 0 }, { due_cents: W, collected_cents: 0 }], []);
  assert.deepEqual([lease.owing_cents, lease.buy_out_cents, lease.weeks_behind], [2 * W, null, 2]);
  assert.equal(payoffWeeks(100000, 20000, 30000), 3);
  assert.equal(payoffWeeks(100000, 20000, 0), null);
});

test('charging reimbursement: home at the tariff, public at cost up to the limit, receipts, depot and own cars never', () => {
  const r = DEFAULT_FLEET_POLICY.charging;
  assert.deepEqual(chargeReimbursement({ location: 'home', kwh: 20, cost_cents: 2000 }, 'leased_to_driver', r), { reimbursable: true, cents: 600, rule: 'home_tariff' });
  assert.deepEqual(chargeReimbursement({ location: 'public', kwh: 10, cost_cents: 700 }, 'fleet', r), { reimbursable: true, cents: 700, rule: 'public_at_cost' });
  assert.deepEqual(chargeReimbursement({ location: 'public', kwh: 10, cost_cents: 1200 }, 'fleet', r), { reimbursable: true, cents: 800, rule: 'public_capped' });
  assert.equal(chargeReimbursement({ location: 'public', kwh: 10, cost_cents: 700 }, 'fleet', { ...r, public_needs_receipt: true }).rule, 'public_no_receipt');
  assert.equal(chargeReimbursement({ location: 'public', kwh: 10, cost_cents: 700, receipt_ref: 'R1' }, 'fleet', { ...r, public_needs_receipt: true }).cents, 700);
  assert.deepEqual(chargeReimbursement({ location: 'depot', kwh: 30, cost_cents: 900 }, 'fleet', r), { reimbursable: false, cents: 0, rule: 'depot' });
  assert.equal(chargeReimbursement({ location: 'depot', kwh: 30, cost_cents: 900 }, 'fleet', { ...r, depot_reimbursed: true }).cents, 900);
  assert.deepEqual(chargeReimbursement({ location: 'home', kwh: 20, cost_cents: 600 }, 'driver_owned', r), { reimbursable: false, cents: 0, rule: 'driver_owned' });
  assert.equal(chargeReimbursement({ location: 'home', kwh: 20 }, null, r).reimbursable, false);
});

test('maintenance due: months and km from the last job, fuel types, the summer battery interval and a hot week', () => {
  const heat = DEFAULT_FLEET_POLICY.heat;
  const plan = (k: string) => DEFAULT_FLEET_POLICY.service_plans.find((p) => p.key === k)!;
  const ev = { fuel_type: 'electric', odometer_km: 18500, since: '2026-01-10' };
  // Service every 20,000 km / 12 months: 1,500 km left → due soon by km.
  const s = dueFor(plan('service_ev'), ev, null, { today: '2026-06-01', heat })!;
  assert.deepEqual([s.due_date, s.due_km, s.km_left, s.status, s.reason], ['2027-01-10', 20000, 1500, 'ok', null]);
  assert.deepEqual([dueFor(plan('service_ev'), { ...ev, odometer_km: 19200 }, null, { today: '2026-06-01', heat })!.status], ['due_soon']);
  assert.equal(dueFor(plan('service_ev'), { ...ev, odometer_km: 20100 }, null, { today: '2026-06-01', heat })!.status, 'overdue');
  assert.equal(dueFor(plan('service_ev'), ev, null, { today: '2027-01-11', heat })!.status, 'overdue');
  // From the last job: date and odometer.
  const last = dueFor(plan('tyres'), ev, { done_on: '2026-05-01', odometer_km: 15000 }, { today: '2026-06-01', heat })!;
  assert.deepEqual([last.due_date, last.due_km, last.km_left, last.last_done], ['2026-11-01', 25000, 6500, '2026-05-01']);
  assert.equal(dueFor(plan('tyres'), ev, { done_on: '2026-05-01', odometer_km: null }, { today: '2026-06-01', heat })!.due_km, null, 'no odometer on record: by months only');
  // Fuel types: no petrol service plan for an EV, no battery check for petrol cars.
  assert.equal(dueFor(plan('service_fuel'), ev, null, { today: '2026-06-01', heat }), null);
  assert.equal(dueFor(plan('battery'), { ...ev, fuel_type: 'petrol' }, null, { today: '2026-06-01', heat }), null);
  // Battery: 6 months in winter, 3 months from October to March.
  const b = { done_on: '2026-09-01', odometer_km: 12000 };
  assert.equal(dueFor(plan('battery'), ev, b, { today: '2026-09-15', heat })!.due_date, '2027-03-01');
  assert.equal(dueFor(plan('battery'), ev, b, { today: '2026-10-15', heat })!.due_date, '2026-12-01');
  // A week averaging 40°C+ brings it forward once 30 days have passed since the last check.
  const hot = dueFor(plan('battery'), ev, b, { today: '2026-10-15', heat, hot_week: true })!;
  assert.deepEqual([hot.due_date, hot.status, hot.reason], ['2026-10-15', 'due_soon', 'hot_week']);
  assert.equal(dueFor(plan('battery'), ev, { done_on: '2026-10-01' }, { today: '2026-10-15', heat, hot_week: true })!.reason, null, 'checked recently');
  assert.equal(addMonths('2026-08-31', 6), '2027-02-28');
});

test('fleet policy: defaults merge, admin edits are checked; reports prorate by days and share profit and losses', () => {
  assert.deepEqual(mergeFleetPolicy(null), DEFAULT_FLEET_POLICY);
  assert.equal(mergeFleetPolicy({ enabled: true, charging: { home_cents_per_kwh: 35 } }).charging.public_max_cents_per_kwh, 80);
  const ok = checkFleetPolicy({ enabled: true, charging: { monthly_cap_cents: 1000 }, heat: { hot_months: [1, 12, 12, 2] } });
  assert.deepEqual([ok.enabled, ok.auto_weekly, ok.charging.monthly_cap_cents, ok.heat.hot_months], [true, false, 1000, [1, 2, 12]]);
  const fails = (v: any, field: string) => assert.throws(() => checkFleetPolicy(v), (e: any) => e instanceof ApiError && e.code === 'invalid_fleet_policy' && (e.details as any).field === field);
  fails({ arrears_flag_weeks: 0 }, 'arrears_flag_weeks');
  fails({ charging: { home_cents_per_kwh: -1 } }, 'charging.home_cents_per_kwh');
  fails({ heat: { hot_months: [13] } }, 'heat.hot_months');
  fails({ service_plans: [{ key: 'x y', kind: 'service', label: 'Service', every_months: 6, fuels: ['electric'] }] }, 'service_plans[0].key');
  fails({ service_plans: [{ key: 'svc', kind: 'wash', label: 'Wash', every_months: 6, fuels: ['electric'] }] }, 'service_plans[0].kind');
  fails({ service_plans: [{ key: 'svc', kind: 'service', label: 'Service', every_months: 6, fuels: ['steam'] }] }, 'service_plans[0].fuels');
  fails({ service_plans: [{ key: 'svc', kind: 'service', label: 'Service', every_km: 10, every_months: 6, fuels: ['electric'] }] }, 'service_plans[0].every_km');

  assert.equal(daysIn('2026-11-01', '2026-11-30'), 30);
  assert.equal(overlapDays('2026-11-01', '2026-11-30', '2026-11-21', null), 10);
  assert.equal(overlapDays('2026-11-01', '2026-11-30', '2026-12-01', null), 0);
  assert.equal(prorate(36500, '2026-01-01', '2026-12-31', '2026-11-01', '2026-11-30'), 3000);
  assert.equal(investorShare(100000, 60, '2026-11-01', '2026-11-30', '2026-01-01', null), 60000);
  assert.equal(investorShare(100000, 60, '2026-11-01', '2026-11-30', '2026-11-16', null), 30000, 'half the month');
  assert.equal(investorShare(-10000, 50, '2026-11-01', '2026-11-30', '2026-01-01', null), -5000, 'losses are shared too');
});
