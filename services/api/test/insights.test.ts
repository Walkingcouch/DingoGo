/** Round 27: owner insights rules (pure; no database). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  INSIGHTS_DEFAULTS, addMonths, checkPolicy, cohortTable, darwinInstant, discountKind, driversNeeded, factorFor, forecast, mondayOf, policyOf,
  simulate, taxiFare, taxiTariffAt, unitEconomics, weekdayOf, cardFee,
} from '../src/lib/insights.js';
import type { FareRule } from '../src/lib/fares.js';

const P = INSIGHTS_DEFAULTS;
const code = (fn: () => unknown) => { try { fn(); return null; } catch (e: any) { return e.code; } };

test('insights policy: defaults are valid, saves are checked, stored values read leniently', () => {
  assert.deepEqual(checkPolicy({}), P);
  assert.deepEqual(policyOf(null), P);
  assert.deepEqual(policyOf({ card_fee: { pct: 'lots' } }), P, 'a bad stored value falls back to the defaults');
  assert.equal(policyOf({ card_fee: { pct: 2.9 } }).card_fee.fixed_cents, 30, 'partial objects merge over the defaults');
  assert.equal(code(() => checkPolicy({ target_utilisation_pct: 5 })), 'invalid_insights_policy');
  assert.equal(code(() => checkPolicy({ surprise: 1 })), 'invalid_insights_policy', 'unknown keys refused');
  assert.equal(code(() => checkPolicy({ seasonality: { ...P.seasonality, public_holiday_factor: 9 } })), 'invalid_insights_policy');
  const ev = (o: object) => ({ seasonality: { ...P.seasonality, events: [{ name: 'Show', from: '2027-07-02', to: '2027-07-03', factor: 1.3, ...o }] } });
  assert.equal(code(() => checkPolicy(ev({ to: '2027-07-01' }))), 'invalid_insights_policy', 'end before start');
  assert.equal(code(() => checkPolicy(ev({ hours: { from: 20, to: 18 } }))), 'invalid_insights_policy');
  assert.equal(checkPolicy(ev({})).seasonality.events[0].confirmed, false, 'confirmed defaults to false');
  assert.equal(code(() => checkPolicy({ weekly_email: { enabled: true, recipients: [], hour: 7 } })), 'invalid_insights_policy', 'email on needs someone to send to');
  assert.equal(code(() => checkPolicy({ weekly_email: { enabled: false, recipients: ['not an email'], hour: 7 } })), 'invalid_insights_policy');
  const ok = checkPolicy({ weekly_email: { enabled: true, recipients: ['Owner@Example.com', 'owner@example.com'], hour: 7 }, seasonality: { ...P.seasonality, tourist_season: { months: [9, 4, 4], factor: 1.2 } } });
  assert.deepEqual(ok.weekly_email.recipients, ['owner@example.com']);
  assert.deepEqual(ok.seasonality.tourist_season.months, [4, 9]);
});

test('taxi tariff: tariff 1 on weekdays 6am to before 6pm, tariff 2 otherwise and on public holidays; metered to 10c', () => {
  const t = P.taxi_tariff;
  const wed = (h: number, m = 0) => darwinInstant('2026-11-18', h, m);   // a Wednesday
  assert.equal(weekdayOf('2026-11-18'), 2);
  assert.equal(taxiTariffAt(wed(10), false, t), 'day');
  assert.equal(taxiTariffAt(wed(6), false, t), 'day');
  assert.equal(taxiTariffAt(wed(5, 59), false, t), 'night');
  assert.equal(taxiTariffAt(wed(18), false, t), 'night');
  assert.equal(taxiTariffAt(wed(10), true, t), 'night', 'public holiday');
  assert.equal(taxiTariffAt(darwinInstant('2026-11-21', 12), false, t), 'night', 'Saturday');
  assert.deepEqual(taxiFare(5, wed(10), false, t), { tariff: 'day', cents: 1780 });     // $5.50 + 5 × $2.45 = $17.75 → $17.80
  assert.deepEqual(taxiFare(5, wed(20), false, t), { tariff: 'night', cents: 2130 }); // $6.80 + 5 × $2.89 = $21.25 → $21.30
});

test('unit economics: where a completed card trip’s money goes, a cash courier and a cancellation fee', () => {
  // Fare $20.00 trip + $1 booking + $1 levy, 10% promo off ($2.10) → $19.90 paid. Driver: $20.00 fare less 25% fee = $15.00.
  const trip = {
    status: 'completed', payment_method: 'card', final_cents: 1990, tip_cents: 300, cancel_fee_cents: 0,
    fare_breakdown: { levy_cents: 100, booking_fee_cents: 100, lines: [{ label: 'Base fare', cents: 300 }, { label: 'Promo WELCOME', cents: -210 }, { label: 'NT passenger levy', cents: 100 }] },
  };
  const ledger = [{ kind: 'fare', amount_cents: 2000 }, { kind: 'commission', amount_cents: -500 }, { kind: 'tip', amount_cents: 300 }];
  const e = unitEconomics(trip, ledger, { policy: P, pointsIssued: 19, refundsCents: 0 });
  assert.equal(e.driver.pay_cents, 1500);
  assert.equal(e.dingogo.kept_cents, 1990 - 100 - 1500);
  assert.equal(e.dingogo.kept_cents, e.dingogo.service_fee_cents + e.dingogo.booking_fee_cents - e.dingogo.discounts_cents + e.dingogo.other_cents);
  assert.equal(e.dingogo.discounts.promo, 210);
  assert.equal(e.dingogo.other_cents, 0);
  assert.equal(e.dingogo.gst_cents, Math.round(390 / 11));
  assert.equal(e.dingogo.card_fees_cents, cardFee(1990, P.card_fee) + cardFee(300, P.card_fee));
  assert.equal(cardFee(1990, P.card_fee), Math.round(1990 * 0.0175) + 30);
  assert.equal(e.dingogo.net_cents, 390 - e.dingogo.gst_cents - e.dingogo.card_fees_cents);
  assert.equal(e.points_issued_cents, 19);
  assert.equal(e.take_rate_pct, Math.round((390 / 1890) * 1000) / 10);

  const cash = unitEconomics({ ...trip, payment_method: 'cash', tip_cents: 0, fare_breakdown: { levy_cents: 0, booking_fee_cents: 0, lines: [] }, final_cents: 1500 },
    [{ kind: 'fare', amount_cents: 1500 }, { kind: 'commission', amount_cents: -375 }, { kind: 'cash_collected', amount_cents: -1500 }], { policy: P });
  assert.equal(cash.dingogo.card_fees_cents, 0);
  assert.equal(cash.dingogo.kept_cents, 375, 'cash the driver holds is netted in the ledger, not lost');

  const cancel = unitEconomics({ status: 'cancelled_rider', payment_method: 'card', final_cents: null, tip_cents: 0, cancel_fee_cents: 300, fare_breakdown: { lines: [{ label: 'Promo X', cents: -100 }] } },
    [{ kind: 'cancel_fee', amount_cents: 225 }], { policy: P, refundsCents: 0 });
  assert.equal(cancel.driver.pay_cents, 225);
  assert.equal(cancel.dingogo.kept_cents, 75);
  assert.equal(cancel.dingogo.cancel_fee_cents, 75);
  assert.equal(cancel.dingogo.discounts_cents, 0, 'a quote’s discount never applied to a cancelled trip');
  assert.equal(discountKind('Dingo Points (300 pts)'), 'points');
  assert.equal(discountKind('DingoGo Pass (−10%)'), 'pass');
  assert.equal(discountKind('Free delivery (DingoGo Pass)'), 'pass');
  assert.equal(discountKind('Business account (−5%)'), 'business');
  assert.equal(discountKind('Pensioner concession'), 'concession');
});

test('seasonality factors and drivers needed', () => {
  const hol = new Map([['2027-01-26', 'Australia Day']]);
  assert.deepEqual(factorFor('2026-11-18', 10, P, hol), { factor: 1, reasons: [] });
  assert.equal(factorFor('2027-07-15', 10, P, hol).factor, Math.round(1.15 * 1.05 * 1000) / 1000, 'tourist season and school holidays');
  const ad = factorFor('2027-01-26', 10, P, hol);
  assert.equal(ad.factor, Math.round(1.05 * 1.1 * 1000) / 1000);
  assert.deepEqual(ad.reasons, ['Summer school holidays', 'Australia Day']);
  assert.equal(factorFor('2026-12-31', 17, P, hol).factor, 1.05, 'New Year’s Eve counts only from 6pm');
  assert.equal(factorFor('2026-12-31', 21, P, hol).factor, Math.round(1.05 * 1.8 * 1000) / 1000);
  assert.equal(driversNeeded(0, 25, 3, P), 0, 'nothing overnight outside service hours');
  assert.equal(driversNeeded(0, 25, 10, P), 2, 'the minimum in service hours');
  assert.equal(driversNeeded(6, 25, 10, P), 5, '6 trips × 25 min = 2.5 h of work at 60% → 5 drivers');
  assert.equal(driversNeeded(1.2, 25, 10, P), 2);
});

test('forecast: hour-of-week baseline with past seasonality taken out and the future’s put back, gaps against drivers online', () => {
  // Eight weeks of history (Mon 2026-09-21 .. Sun 2026-11-15): 2 requests every Monday 8am, plus one Friday 9pm in September
  // (tourist season ×1.15, so the September Fridays count a little less).
  const history: { day: string; hour: number; n: number }[] = [];
  for (let w = 0; w < 8; w++) {
    const mon = new Date(Date.parse('2026-09-21T00:00:00Z') + w * 7 * 864e5).toISOString().slice(0, 10);
    history.push({ day: mon, hour: 8, n: 2 });
  }
  const usual = Array.from({ length: 7 }, () => new Array(24).fill(1));
  const policy = { ...P, seasonality: { ...P.seasonality, events: [{ name: 'Big day', from: '2026-11-23', to: '2026-11-23', factor: 1.5, hours: null, confirmed: true }] } };
  const f = forecast({ history, historyFrom: '2026-09-21', historyTo: '2026-11-15', start: '2026-11-16', days: 14, policy, holidays: new Set(), minutesPerTrip: 30, usualOnline: usual });
  assert.equal(f.days.length, 14);
  assert.equal(f.weekly_trend, 1, 'too little history for a trend');
  const mon = f.days[0];
  assert.equal(mon.weekday, 'Monday');
  // September Mondays were tourist season: 2 ÷ 1.15 counts for less than the October/November 2s, so the baseline is just under 2.
  assert.ok(mon.hours[8].trips >= 1.9 && mon.hours[8].trips <= 2, String(mon.hours[8].trips));
  assert.equal(mon.hours[9].trips, 0);
  assert.equal(mon.hours[8].drivers_needed, 2);
  assert.equal(mon.hours[3].drivers_needed, 0);
  assert.equal(mon.hours[8].gap, 1, 'need 2, usually 1 online');
  const big = f.days[7];
  assert.equal(big.date, '2026-11-23');
  assert.deepEqual(big.reasons, ['Big day']);
  assert.ok(Math.abs(big.hours[8].trips - mon.hours[8].trips * 1.5) < 0.11);
  assert.equal(big.peak_hour, 8);
  assert.equal(f.days[1].trips, 0, 'nothing on Tuesdays');
  // Growth: 3 a day in the last 4 weeks against 1 before → capped at +5% a week.
  const g = forecast({
    history: Array.from({ length: 56 }, (_, i) => ({ day: new Date(Date.parse('2026-09-21T00:00:00Z') + i * 864e5).toISOString().slice(0, 10), hour: 12, n: i >= 28 ? 3 : 1 })),
    historyFrom: '2026-09-21', historyTo: '2026-11-15', start: '2026-11-16', days: 1, policy: { ...P, seasonality: { ...P.seasonality, tourist_season: { months: [], factor: 1 } } }, holidays: new Set(), minutesPerTrip: 20,
  });
  assert.equal(g.weekly_trend, 1.05);
  assert.equal(g.days[0].hours[0].usual_online, null, 'no online data, no gap');
});

test('pricing simulator: same rates change nothing; a dearer per-km rate raises fares, driver pay and take; elasticity trims trips', () => {
  const rule: FareRule = { service: 'ride', label: 'Ride', base_cents: 300, per_km_cents: 160, per_min_cents: 25, booking_fee_cents: 100, min_fare_cents: 1000, night_pct: 20, holiday_pct: 15, levy_cents: 100 };
  const trips = [3, 5, 8, 15].map((km) => ({ distance_m: km * 1000, duration_s: km * 120, at: darwinInstant('2026-11-18', 12), holiday: false }));
  const same = simulate({ rule, proposed: rule, feePct: 25, proposedFeePct: 25, tariff: P.taxi_tariff, trips, elasticity: -0.5, minutesPerTrip: 20 });
  assert.equal(same.change.avg_fare_pct, 0);
  assert.equal(same.estimate.trips, 4);
  assert.equal(same.now.under_taxi_pct, 100);
  assert.equal(same.now.fare_cents, same.now.driver_pay_cents + same.now.take_cents + 4 * 100, 'fare = driver + DingoGo + levy');
  const up = simulate({ rule, proposed: { ...rule, per_km_cents: 190 }, feePct: 25, proposedFeePct: 25, tariff: P.taxi_tariff, trips, elasticity: -0.5, minutesPerTrip: 20 });
  assert.ok(up.proposed.avg_fare_cents! > up.now.avg_fare_cents!);
  assert.ok(up.change.driver_pay_pct! > 0);
  assert.ok(up.estimate.volume_factor < 1);
  assert.equal(up.proposed.driver_pay_per_engaged_hour_cents, Math.round((up.proposed.driver_pay_cents / 4) * 3));
  const lowerFee = simulate({ rule, proposed: rule, feePct: 25, proposedFeePct: 15, tariff: P.taxi_tariff, trips, elasticity: 0, minutesPerTrip: 20 });
  assert.ok(lowerFee.proposed.driver_pay_cents > lowerFee.now.driver_pay_cents && lowerFee.proposed.take_cents < lowerFee.now.take_cents);
  assert.equal(up.examples.length, 8);
  const airportNight = up.examples.find((e) => e.name.includes('airport') && e.when.includes('Friday'))!;
  assert.equal(airportNight.taxi_tariff, 'night');
  const empty = simulate({ rule, proposed: rule, feePct: 25, proposedFeePct: 25, tariff: P.taxi_tariff, trips: [], elasticity: 0, minutesPerTrip: 20 });
  assert.equal(empty.now.avg_fare_cents, null);
  assert.equal(empty.examples.length, 8, 'examples work without history');
});

test('rider cohorts and week helpers', () => {
  const rows = [
    { cohort: '2026-08', month: '2026-08', riders: 10 }, { cohort: '2026-08', month: '2026-09', riders: 6 }, { cohort: '2026-08', month: '2026-11', riders: 3 },
    { cohort: '2026-10', month: '2026-10', riders: 4 }, { cohort: '2026-10', month: '2026-11', riders: 1 },
  ];
  const t = cohortTable(rows, '2026-11', 3);
  assert.deepEqual(t[0], { cohort: '2026-08', riders: 10, retained: [100, 60, 0, 30] });
  assert.deepEqual(t[1], { cohort: '2026-10', riders: 4, retained: [100, 25, null, null] }, 'months still to come are blank');
  assert.equal(addMonths('2026-11', 3), '2027-02');
  assert.equal(addMonths('2027-01', -1), '2026-12');
  assert.equal(mondayOf('2026-11-22'), '2026-11-16');
  assert.equal(mondayOf('2026-11-16'), '2026-11-16');
});
