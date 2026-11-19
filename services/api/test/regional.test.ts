/** Round 28: community routes, long trips, shuttles, booking by text, store top-ups and the low-data page (pure rules, no database). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_REGIONAL_POLICY, checkRegionalPolicy, checkTopup, checkinPlan, dayFilter, findCorridor, fixedPriceFor, litePage, longestGapMin, matchCorridor,
  parseSms, priceLabel, rangeNeededM, readRegionalPolicy, regionalInfo, runDriverPay, shuttleTimes, tooFarForMeter, whenText,
} from '../src/lib/regional.js';
import { quoteFare } from '../src/lib/fares.js';

const P = DEFAULT_REGIONAL_POLICY;
const ALICE = { centre_lat: -23.6980, centre_lng: 133.8807, radius_km: 25 };
const TODD = { lat: -23.6984, lng: 133.8822 };
const NTARIA = { lat: -23.9440, lng: 132.7760 };
const SANTA = { lat: -24.1300, lng: 134.3740 };
const YULARA = { lat: -25.2406, lng: 130.9889 };
const corridor = (id: string) => P.corridors.find((c) => c.id === id)!;

test('policy: defaults pass their own checks; bad routes are refused; stored policies are read leniently', () => {
  assert.equal(checkRegionalPolicy(P).corridors.length, 3);
  assert.equal(corridor('yulara').active, false, 'Yulara waits for the charging plan');
  for (const c of P.corridors) {
    assert.ok(c.permit_note && /may|usually|check/i.test(c.permit_note), `${c.id}: permit note hedges (no legal certainty)`);
    assert.equal(c.confirmed, false, `${c.id}: distances and gaps marked unconfirmed`);
    assert.ok(c.pickup_points.some((p) => p.side === 'town') && c.pickup_points.some((p) => p.side === 'community'));
  }
  const dup = { ...P, corridors: [P.corridors[0], P.corridors[0]] };
  assert.throws(() => checkRegionalPolicy(dup), /Two routes/);
  const gap = structuredClone(P); gap.corridors[0].coverage_gaps = [{ from_km: 10, to_km: 400, note: 'x' }];
  assert.throws(() => checkRegionalPolicy(gap), /past the end/);
  assert.throws(() => checkRegionalPolicy({ ...P, max_metered_km: 5 }), /max_metered_km/);
  assert.deepEqual(readRegionalPolicy({ nonsense: true }), P);
  assert.deepEqual(readRegionalPolicy(null), P);
});

test('matching: town to a community and back, inactive routes for staff only, metered fares end at the edge', () => {
  assert.deepEqual(matchCorridor(P, TODD, NTARIA, [ALICE])?.direction, 'out');
  assert.equal(matchCorridor(P, NTARIA, TODD, [ALICE])?.corridor.id, 'ntaria');
  assert.equal(matchCorridor(P, NTARIA, TODD, [ALICE])?.direction, 'back');
  assert.equal(matchCorridor(P, TODD, { lat: -23.80, lng: 133.90 }, [ALICE]), null, 'a town trip is not a community trip');
  assert.equal(matchCorridor(P, NTARIA, SANTA, [ALICE]), null, 'community to community is not a route');
  assert.equal(matchCorridor(P, TODD, YULARA, [ALICE]), null);
  assert.equal(matchCorridor(P, TODD, YULARA, [ALICE], { staff: true })?.corridor.id, 'yulara');
  assert.equal(tooFarForMeter(P, ALICE, { lat: -23.80, lng: 133.90 }), 0, 'airport is metered');
  assert.equal(tooFarForMeter(P, ALICE, { lat: -23.715, lng: 133.46 }), 0, 'Standley Chasm (about 43 km) is metered');
  assert.ok(tooFarForMeter(P, ALICE, { lat: -23.6326, lng: 132.7270 }) > 100, 'Ormiston Gorge is not');
});

test('prices, info and the check-in plan: fixed one-way price, return discount, gaps on both directions', () => {
  const n = corridor('ntaria');
  assert.equal(fixedPriceFor(n, false), 26000);
  assert.equal(fixedPriceFor(n, true), 18200);
  assert.equal(priceLabel(n, 'out', false), 'Fixed price: Alice Springs to Ntaria (Hermannsburg)');
  assert.equal(priceLabel(n, 'back', true), 'Fixed price: Ntaria (Hermannsburg) to Alice Springs (return trip, -30%)');
  const info = regionalInfo({ corridor: n, direction: 'out' }, P);
  assert.equal(info.empty_return_km, 128, 'the drive back is empty');
  assert.equal(regionalInfo({ corridor: n, direction: 'out' }, P, true).empty_return_km, 0);
  const out = checkinPlan(n, 'out', 45);
  assert.equal(out[0], 'Leaving Alice Springs');
  assert.equal(out.at(-1), 'Arrived at Ntaria (Hermannsburg)');
  assert.ok(out.some((s) => /before the no-coverage stretch \(70 km\)/.test(s)) && out.some((s) => /back in coverage/.test(s)));
  const back = checkinPlan(n, 'back', 45);
  assert.equal(back[0], 'Leaving Ntaria (Hermannsburg)');
  assert.ok(back.some((s) => s.startsWith('About 11 km: before')), 'gap mirrored for the trip back');
  assert.equal(longestGapMin(n), Math.round(70 / (128 / 95)));
  // EV range: to the pickup + the trip + home (unless it can charge there) + reserve.
  assert.equal(rangeNeededM({ toPickupM: 2000, tripM: 128000, info, reserveKm: 40 }), 2000 + 128000 + 128000 + 40000);
  assert.equal(rangeNeededM({ toPickupM: 2000, tripM: 445000, info: { direction: 'out', road_km: 445, charging_at_destination: true }, reserveKm: 40 }), 487000);
  assert.equal(rangeNeededM({ toPickupM: 160000, tripM: 128000, info: { ...info, direction: 'back' }, reserveKm: 40 }), 328000);
  // The fare engine shows the route's own line (tours keep "package price").
  const rule = { service: 'ride', label: 'DingoGo Ride', base_cents: 300, per_km_cents: 160, per_min_cents: 25, booking_fee_cents: 100, min_fare_cents: 1000, night_pct: 20, holiday_pct: 15, levy_cents: 100 };
  const q = quoteFare({ ...rule, booking_fee_cents: 0, min_fare_cents: 0 }, { distance_m: 128000, duration_s: 95 * 60, at: new Date('2026-11-24T22:00:00Z'), fixedPriceCents: 26000, fixedPriceLabel: priceLabel(n, 'out', false),
    levy: { cents: 100, label: 'NT passenger levy' } });
  assert.equal(q.lines[0].label, 'Fixed price: Alice Springs to Ntaria (Hermannsburg)');
  assert.equal(q.total_cents, 26100, 'fixed price + levy (no night surcharge; buildQuote takes the booking fee off)');
  assert.equal(runDriverPay(n, 4000), 15000, 'run pay is the minimum');
  assert.equal(runDriverPay(n, 40000), 30000, '75% of a full run when that is more');
});

test('shuttle timetable on the route days, Darwin time', () => {
  const t = shuttleTimes(corridor('ltyentye-apurte'), '2026-11-23', 7);   // Mon 23 Nov
  assert.deepEqual(t.map((x) => [x.direction, x.departs_at.toISOString()]), [
    ['out', '2026-11-22T22:30:00.000Z'], ['back', '2026-11-23T04:00:00.000Z'],      // Monday 8:00am / 1:30pm Darwin
    ['out', '2026-11-25T22:30:00.000Z'], ['back', '2026-11-26T04:00:00.000Z'],      // Thursday
  ]);
  assert.equal(whenText('2026-11-22T22:30:00Z'), 'Mon 23 Nov 8:00am');
  assert.equal(whenText('2026-11-26T04:00:00Z'), 'Thu 26 Nov 1:30pm');
});

test('booking by text: keywords, places, days, seats and directions', () => {
  assert.deepEqual(parseSms('BUS NTARIA FRI 2'), { kind: 'book', place: 'ntaria', direction: 'out', day: 5, seats: 2 });
  assert.deepEqual(parseSms('bus to santa teresa thursday'), { kind: 'book', place: 'santa teresa', direction: 'out', day: 4, seats: 1 });
  assert.deepEqual(parseSms('Bus from Hermannsburg tomorrow'), { kind: 'book', place: 'hermannsburg', direction: 'back', day: 'tomorrow', seats: 1 });
  assert.deepEqual(parseSms('shuttle from alice to ntaria 3 seats'), { kind: 'book', place: 'ntaria', direction: 'out', day: null, seats: 3 });
  assert.deepEqual(parseSms('bus alice from ntaria'), { kind: 'book', place: 'ntaria', direction: 'back', day: null, seats: 1 });
  assert.deepEqual(parseSms('BUS'), { kind: 'usage' });
  assert.deepEqual(parseSms('bus alice'), { kind: 'usage' });
  assert.deepEqual(parseSms(' Yes '), { kind: 'yes' });
  assert.deepEqual(parseSms('no'), { kind: 'no' });
  assert.deepEqual(parseSms('MY BUS'), { kind: 'list' });
  assert.deepEqual(parseSms('bal'), { kind: 'balance' });
  assert.deepEqual(parseSms('CANCEL SB-ab2c3d'), { kind: 'cancel', ref: 'SB-AB2C3D' });
  assert.equal(parseSms('cancel'), null, 'a bare CANCEL is an opt-out word (handled as STOP)');
  assert.equal(parseSms("I'm at the front gate"), null, 'chat stays chat');
  assert.equal(parseSms('yes I can see you'), null);
  assert.equal(findCorridor(P, 'santa teresa')?.id, 'ltyentye-apurte');
  assert.equal(findCorridor(P, 'Ltyentye Apurte')?.id, 'ltyentye-apurte');
  assert.equal(findCorridor(P, 'hermannsburg')?.id, 'ntaria');
  assert.equal(findCorridor(P, 'NTARIA')?.id, 'ntaria');
  assert.equal(findCorridor(P, 'yulara'), null, 'inactive route not bookable by text');
  assert.equal(findCorridor(P, 'ab'), null);
  assert.deepEqual(dayFilter(5), { weekday: 5 });
  assert.deepEqual(dayFilter('tomorrow', new Date('2026-11-19T15:00:00Z')), { date: '2026-11-21' });   // 0:30am Fri 20th in Darwin
  assert.deepEqual(dayFilter('today', new Date('2026-11-19T15:00:00Z')), { date: '2026-11-20' });
});

test('store top-ups: amount, whole 5 cents, per person and per store each day', () => {
  const t = P.topups;
  const ok = { riderTodayCents: 0, storeTodayCents: 0 };
  assert.doesNotThrow(() => checkTopup(t, 2000, ok));
  assert.throws(() => checkTopup(t, 300, ok), /between/);
  assert.throws(() => checkTopup(t, 25000, ok), /between/);
  assert.throws(() => checkTopup(t, 2002, ok), /5 cents/);
  assert.throws(() => checkTopup(t, 20000, { riderTodayCents: 15000, storeTodayCents: 0 }), /one person today/);
  assert.throws(() => checkTopup(t, 20000, { riderTodayCents: 0, storeTodayCents: 190000 }), /top-up limit/);
});

test('low-data page: tiny, no scripts or images, timetable with seats, permits and the coverage warning', () => {
  const runs = [{ id: '11111111-1111-4111-8111-111111111111', corridor: 'ntaria', direction: 'out' as const, departs_at: '2026-11-24T22:00:00Z', seats_left: 3 },
    { id: '22222222-2222-4222-8222-222222222222', corridor: 'ntaria', direction: 'back' as const, departs_at: '2026-11-25T04:30:00Z', seats_left: 0 }];
  const html = litePage({ policy: P, runs, phone: '08 8950 0000', message: '<b>hi</b>', formAction: '/lite/book' });
  assert.ok(Buffer.byteLength(html) < 12_000, `${Buffer.byteLength(html)} bytes`);
  assert.doesNotMatch(html, /<script|<img|<link|@import|url\(/i);
  assert.match(html, /Ntaria \(Hermannsburg\)/);
  assert.match(html, /3 seats left/);
  assert.match(html, /full/);
  assert.match(html, /Permits:/);
  assert.match(html, /No mobile coverage on parts of the road/);
  assert.match(html, /tel:0889500000/);
  assert.match(html, /&lt;b&gt;hi&lt;\/b&gt;/, 'messages are escaped');
  assert.equal((html.match(/<option value=/g) ?? []).length, 1, 'only shuttles with seats can be chosen');
  assert.doesNotMatch(html, /Yulara/, 'inactive routes are left out');
});
