/** Round 19: tour, hire and tourism rules (pure; no database). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BUILT_IN, DEFAULT_TOUR_POLICY, SEED_TRANSLATIONS, VISITOR_LANGS, availability, checkStart, checkTourFields, checkTourPolicy, darwinParts, darwinTime,
  depositCents, hireQuote, localiseTour, normaliseTour, safetyFor, scheduledCancel, tourFields, waterLitres, type Advisory,
} from '../src/lib/tours.js';
import { quoteFare, GUIDE_FEE_LABEL } from '../src/lib/fares.js';

const ROW = { id: 't1', slug: 'west-macs-gaps', name: 'West MacDonnell Gaps', summary: 's', description: 'd', duration_min: 270, price_cents: 42000, max_passengers: 4,
  stops: ['Simpsons Gap (Rungutjirba)', 'Standley Chasm (Angkerle Atwatye)'], cultural_note: null, requires_permit: true, active: true };
const NOW = Date.parse('2026-11-19T00:00:00Z');   // 9:30 am Thursday in Alice Springs
const adv = (a: Partial<Advisory>): Advisory => ({ id: 'a', kind: 'heat', title: 'Extreme heat', message: '44 degrees', starts_on: '2026-11-25', ends_on: '2026-11-25',
  tour_ids: [], latest_start: '07:30', closes: false, active: true, ...a });

test('products: seeded tours get their itinerary, timetable and heat rule before migration 023; own data wins after', () => {
  const p = normaliseTour(ROW);
  assert.deepEqual(p.start_times, BUILT_IN['west-macs-gaps'].start_times);
  assert.equal(p.itinerary.length, 2);
  assert.ok(p.itinerary[0].protocols!.includes('no_swimming'));
  assert.equal(p.heat_sensitive, true);
  assert.equal(p.min_notice_hours, 24);
  assert.deepEqual(p.season_months.length, 12);
  assert.equal(p.guide_fee_cents, 0);
  // After 023 with staff edits: the row's own values.
  const own = normaliseTour({ ...ROW, itinerary: [{ name: 'Rungutjirba', minutes: 60 }], start_times: ['06:30'], heat_sensitive: false, min_notice_hours: 6,
    season_months: [4, 5, 6, 7, 8, 9], guided_by: 'aboriginal_guide', guide_fee_cents: 9000, deposit_pct: 30 });
  assert.deepEqual([own.start_times, own.heat_sensitive, own.min_notice_hours, own.guide_fee_cents, own.deposit_pct], [['06:30'], false, 6, 9000, 30]);
  // An unknown tour without an itinerary splits its time across the stops.
  const plain = normaliseTour({ ...ROW, slug: 'new-one', stops: ['A', 'B', 'C'], duration_min: 180 });
  assert.deepEqual(plain.itinerary.map((s) => s.minutes), [60, 60, 60]);
  // A guide fee without a guide is ignored.
  assert.equal(normaliseTour({ ...ROW, guided_by: 'driver', guide_fee_cents: 5000 }).guide_fee_cents, 0);
});

test('availability and booking checks: notice, guests, season, weekdays, start times, closures and heat (Darwin time)', () => {
  const p = normaliseTour({ ...ROW, itinerary: [{ name: 'Gap', minutes: 60 }], start_times: ['07:00', '15:00'], min_notice_hours: 24, heat_sensitive: true,
    season_months: [11, 12, 1], days: [1, 2, 3, 4, 5, 6] });
  const at = (d: string, t: string) => darwinTime(d, t);
  assert.equal(darwinParts(at('2026-11-25', '07:00')).time, '07:00');
  assert.equal(darwinParts(at('2026-11-25', '07:00')).weekday, 3);
  assert.equal(checkStart(p, at('2026-11-25', '07:00'), { now: NOW }), null);
  assert.equal(checkStart(p, at('2026-11-19', '15:00'), { now: NOW })?.code, 'tour_too_soon');
  assert.equal(checkStart(p, at('2026-11-19', '15:00'), { now: NOW, ignoreNotice: true }), null, 'staff bookings can be later');
  assert.equal(checkStart(p, at('2026-11-25', '07:00'), { now: NOW, guests: 5 })?.code, 'too_many_guests');
  assert.equal(checkStart(p, at('2026-11-25', '08:00'), { now: NOW })?.code, 'tour_start_time');
  assert.equal(checkStart(p, at('2026-11-29', '07:00'), { now: NOW })?.code, 'tour_not_that_day');   // Sunday
  assert.equal(checkStart(p, at('2027-02-02', '07:00'), { now: NOW })?.code, 'tour_out_of_season');
  assert.equal(checkStart({ ...p, active: false }, at('2026-11-25', '07:00'), { now: NOW })?.code, 'tour_unavailable');
  // Heat: heat-sensitive tours must start by the latest start; a closure stops the day; other tours' advisories don't count.
  assert.equal(checkStart(p, at('2026-11-25', '15:00'), { now: NOW, advisories: [adv({})] })?.code, 'heat_advisory');
  assert.equal(checkStart(p, at('2026-11-25', '07:00'), { now: NOW, advisories: [adv({ latest_start: '07:00' })] }), null);
  assert.equal(checkStart({ ...p, heat_sensitive: false }, at('2026-11-25', '15:00'), { now: NOW, advisories: [adv({})] }), null);
  assert.equal(checkStart(p, at('2026-11-25', '07:00'), { now: NOW, advisories: [adv({ kind: 'closure', closes: true, title: 'Park closed', tour_ids: ['t1'] })] })?.code, 'tour_closed');
  assert.equal(checkStart(p, at('2026-11-25', '07:00'), { now: NOW, advisories: [adv({ kind: 'closure', closes: true, tour_ids: ['other'] })] }), null);
  assert.equal(checkStart(p, at('2026-11-25', '07:00'), { now: NOW, advisories: [adv({ kind: 'closure', closes: true, active: false })] }), null);

  const days = availability(p, [adv({})], '2026-11-24', 3, NOW);
  assert.deepEqual(days.map((d) => d.date), ['2026-11-24', '2026-11-25', '2026-11-26']);
  assert.deepEqual(days[1].times, [{ time: '07:00', ok: true }, { time: '15:00', ok: false, reason: 'heat_advisory' }]);
  assert.equal(days[1].advisories[0].title, 'Extreme heat');
  assert.equal(availability(p, [], '2026-11-24', 500, NOW).length, 62, 'at most 62 days');
});

test('deposit and the 48-hour rule: free before, change of mind, advisory days, 50% late', () => {
  assert.equal(depositCents(42100, 20), 8420);
  assert.equal(depositCents(42100, 0), 0);
  assert.equal(depositCents(1000, 100), 1000);
  const start = '2026-11-25T21:30:00Z';
  const base = { quoteCents: 42100, scheduledFor: start, freeHours: 48, latePct: 50, changeOfMindMin: 10 };
  assert.deepEqual(scheduledCancel({ ...base, now: Date.parse('2026-11-23T00:00:00Z') }).reason, 'free_before');
  const late = scheduledCancel({ ...base, now: Date.parse('2026-11-24T22:00:00Z'), bookedAt: '2026-11-20T00:00:00Z' });
  assert.deepEqual([late.reason, late.fee_cents, late.free_until], ['late', 21050, '2026-11-23T21:30:00.000Z']);
  assert.equal(scheduledCancel({ ...base, now: Date.parse('2026-11-24T22:00:00Z'), bookedAt: '2026-11-24T21:55:00Z' }).reason, 'change_of_mind');
  assert.equal(scheduledCancel({ ...base, now: Date.parse('2026-11-24T22:20:00Z'), bookedAt: '2026-11-24T22:00:00Z' }).reason, 'late');
  assert.equal(scheduledCancel({ ...base, now: Date.parse('2026-11-24T22:00:00Z'), advisory: true }).fee_cents, 0);
});

test('hire quotes: hourly rate from the rule, minimum, day-rate cap, multi-day discount, levy per car per day, fatigue limit', () => {
  const rule = { per_min_cents: 125, min_fare_cents: 7500, levy_cents: 100 };
  const h = DEFAULT_TOUR_POLICY.hire;
  const one = hireQuote(rule, { hours_per_day: 3, days: 1, vehicles: 1 }, h);
  assert.deepEqual([one.hourly_cents, one.total_cents, one.levy_cents, one.gst_cents], [7500, 22600, 100, Math.round(22600 / 11)]);
  assert.equal(hireQuote(rule, { hours_per_day: 0.5, days: 1, vehicles: 1 }, h).charged_hours_per_day, 1, 'one-hour minimum');
  const long = hireQuote(rule, { hours_per_day: 10, days: 1, vehicles: 2 }, h);
  assert.equal(long.charged_hours_per_day, 8, 'a long day is charged at the day rate');
  assert.ok(long.lines.some((l) => l.label.startsWith('Day rate')));
  const multi = hireQuote(rule, { hours_per_day: 8, days: 3, vehicles: 2 }, h);
  assert.equal(multi.subtotal_cents, 7500 * 8 * 3 * 2);
  assert.equal(multi.discount_cents, Math.round(multi.subtotal_cents * 0.1));
  assert.equal(multi.total_cents, multi.subtotal_cents - multi.discount_cents + 600);
  assert.throws(() => hireQuote(rule, { hours_per_day: 11, days: 1, vehicles: 1 }, h), /fatigue/);
  assert.throws(() => hireQuote(rule, { hours_per_day: 2, days: 40, vehicles: 1 }, h));
});

test('admin checks: tour fields, translations and the policy', () => {
  const v = tourFields.parse({ itinerary: [{ name: 'Gap', minutes: 60, protocols: ['no_climbing'] }], start_times: ['07:00'], duration_min: 120 });
  assert.deepEqual(checkTourFields(v).stops, ['Gap'], 'stops follow the itinerary');
  assert.throws(() => checkTourFields(tourFields.parse({ itinerary: [{ name: 'Gap', minutes: 200 }] }), { duration_min: 120 }), /duration/);
  assert.throws(() => tourFields.parse({ itinerary: [{ name: 'Gap', minutes: 60, protocols: ['dance'] }] }));
  assert.throws(() => tourFields.parse({ start_times: ['7am'] }));
  assert.throws(() => checkTourFields(tourFields.parse({ guide_fee_cents: 5000 }), { guided_by: 'driver' }), /guide/);
  assert.doesNotThrow(() => checkTourFields(tourFields.parse({ guide_fee_cents: 5000, guided_by: 'aboriginal_guide' })));
  assert.throws(() => checkTourFields(tourFields.parse({ translations: { es: { name: 'x' } } })), /Translations/);
  assert.throws(() => checkTourFields(tourFields.parse({ translations: { de: { name: 'x', status: 'reviewed' } } })), /reviewer/);
  assert.doesNotThrow(() => checkTourFields(tourFields.parse({ translations: { de: { name: 'x', status: 'reviewed', reviewed_by: 'Anna K', reviewed_on: '2026-11-19' } } })));
  assert.equal(checkTourPolicy({ deposit_pct: 30 }).hire.day_cap_hours, 8, 'partial policy merged with defaults');
  assert.throws(() => checkTourPolicy({ deposit_pct: 130 }));
  assert.throws(() => checkTourPolicy({ hire: { min_hours: 4, day_cap_hours: 2 } }));
});

test('visitor languages: machine translations flagged, English falls in, tours localised; never in the community file', () => {
  const p = normaliseTour(ROW);
  const de = localiseTour(p, 'de');
  assert.equal(de.name, SEED_TRANSLATIONS['west-macs-gaps'].de!.name);
  assert.equal(de.description, 'd', 'description falls back to English');
  assert.deepEqual([de.machine_translated, de.translated_fields], [true, ['name', 'summary']]);
  assert.equal(localiseTour(p, 'xx').name, 'West MacDonnell Gaps');
  assert.equal(localiseTour(p, 'en').machine_translated, false);
  for (const tr of Object.values(SEED_TRANSLATIONS)) for (const l of VISITOR_LANGS) assert.equal(tr[l]?.status, 'machine', `${l} seeded text is flagged`);

  const file = JSON.parse(readFileSync(new URL('../../../packages/shared/src/i18n/visitor.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(file.languages), [...VISITOR_LANGS]);
  for (const [key, e] of Object.entries<any>(file.strings)) {
    assert.ok(e.en, `${key}: English is the source`);
    for (const l of VISITOR_LANGS) {
      assert.ok(e[l]?.text, `${key}.${l} has text`);
      if (e[l].status === 'reviewed') assert.ok(e[l].reviewed_by && e[l].reviewed_on, `${key}.${l}: reviewed needs a reviewer`);
      else assert.equal(e[l].status, 'machine', `${key}.${l} is flagged machine`);
      for (const ph of e.en.match(/\{\w+\}/g) ?? []) assert.ok(e[l].text.includes(ph), `${key}.${l} keeps ${ph}`);
    }
  }
  const community = JSON.parse(readFileSync(new URL('../../../packages/shared/src/i18n/strings.json', import.meta.url), 'utf8'));
  for (const l of VISITOR_LANGS) assert.ok(!(l in community.languages), 'visitor languages stay out of the community file');
});

test('safety advice and the guide fee line', () => {
  assert.equal(waterLitres(270, 2), 10);
  assert.equal(waterLitres(20, 1), 1);
  const s = safetyFor({ duration_min: 270, heat_sensitive: true, requires_permit: true }, 12, 2);
  assert.ok(s[0].includes('10 L') && s.some((x) => x.startsWith('Summer')) && s.some((x) => x.includes('permit')));
  assert.ok(!safetyFor({ duration_min: 120, heat_sensitive: false, requires_permit: false }, 7).some((x) => x.startsWith('Summer')));
  // Guide fee: after discounts, outside the driver's fare (trip_cents), in the total.
  const rule = { service: 'tour', label: 'Private Tour', base_cents: 0, per_km_cents: 0, per_min_cents: 0, booking_fee_cents: 0, min_fare_cents: 0, night_pct: 0, holiday_pct: 0, levy_cents: 100 };
  const q = quoteFare(rule, { distance_m: 0, duration_s: 0, at: new Date(NOW), fixedPriceCents: 42000, guideFeeCents: 9000,
    promo: { code: 'TEN', kind: 'percent', value: 10, max_discount_cents: null } });
  assert.deepEqual([q.trip_cents, q.guide_fee_cents, q.discount_cents, q.total_cents], [42000, 9000, 4200, 42000 - 4200 + 9000 + 100]);
  assert.ok(q.lines.some((l) => l.label === GUIDE_FEE_LABEL && l.cents === 9000));
  assert.equal(quoteFare(rule, { distance_m: 0, duration_s: 0, at: new Date(NOW), fixedPriceCents: 42000 }).guide_fee_cents, 0);
});
