/** Round 22: support rules (pure; no database) and the help centre content and search (packages/shared, loaded by URL). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_SUPPORT_POLICY, autoRefundDecision, checkSupportPolicy, fillPlaceholders, priorityFor, reviewFare, slaDue, slaState, trackDistanceM,
} from '../src/lib/support.js';

const load = (rel: string) => import(new URL(rel, import.meta.url).href) as Promise<any>;
const helpP = load('../../../packages/shared/src/helpArticles.ts');
const FR = DEFAULT_SUPPORT_POLICY.fare_review;

/** Points along a straight north-south line from Todd Mall, `km` long, one every ~250 m, a minute apart. */
function line(km: number, from = { lat: -23.6984, lng: 133.8822 }) {
  const n = Math.max(2, Math.round(km * 4) + 1);
  const dLat = km / 111.2 / (n - 1);
  return Array.from({ length: n }, (_, i) => ({ lat: from.lat - dLat * i, lng: from.lng, at: new Date(Date.UTC(2026, 10, 19, 1, i)) }));
}

test('policy: defaults, partial input, limits and rules (safety always urgent, first reply before resolve)', () => {
  assert.deepEqual(checkSupportPolicy({}), DEFAULT_SUPPORT_POLICY);
  const p = checkSupportPolicy({ sla: { high: { first_response_min: 30 } }, fare_review: { max_cents: 2000 } });
  assert.equal(p.sla.high.first_response_min, 30);
  assert.equal(p.sla.high.resolve_hours, 24);
  assert.equal(p.fare_review.max_cents, 2000);
  assert.equal(p.fare_review.max_per_rider_30d, 2);
  const fail = (v: unknown) => assert.throws(() => checkSupportPolicy(v), (e: any) => e.code === 'invalid_policy');
  fail({ priority_by_category: { safety: 'high' } });
  fail({ priority_by_category: { fare: 'soon' } });
  fail({ sla: { low: { first_response_min: 600, resolve_hours: 5 } } });
  fail({ fare_review: { max_cents: 20000 } });
  fail({ fare_review: { unverified: 'maybe' } });
  fail({ fare_review: { auto_refund: 'yes' } });
  fail({ reopen_days: 0 });
  assert.equal(priorityFor('safety'), 'urgent');
  assert.equal(priorityFor('lost_item'), 'high');
  assert.equal(priorityFor('unknown'), 'normal');
});

test('SLA: due times from arrival; timers due, overdue, met and missed; waiting on the customer stops the resolve clock', () => {
  const at = new Date('2026-11-19T00:00:00Z');
  const d = slaDue(at, 'high');
  assert.equal(d.first_response_due_at.toISOString(), '2026-11-19T01:00:00.000Z');
  assert.equal(d.resolve_due_at.toISOString(), '2026-11-20T00:00:00.000Z');
  const t = { status: 'open', ...d, first_response_at: null, resolved_at: null };
  const s1 = slaState(t, at.getTime() + 30 * 60_000);
  assert.deepEqual([s1.first_response, s1.resolve, s1.minutes_left, s1.overdue], ['due', 'due', 30, false]);
  const s2 = slaState(t, at.getTime() + 90 * 60_000);
  assert.deepEqual([s2.first_response, s2.minutes_left, s2.overdue], ['overdue', -30, true]);
  const replied = { ...t, first_response_at: new Date(at.getTime() + 20 * 60_000) };
  const s3 = slaState(replied, at.getTime() + 2 * 3600_000);
  assert.deepEqual([s3.first_response, s3.resolve, s3.minutes_left], ['met', 'due', 22 * 60]);
  const late = slaState({ ...replied, status: 'pending' }, at.getTime() + 30 * 3600_000);
  assert.deepEqual([late.resolve, late.overdue, late.minutes_left], ['due', false, null], 'pending: not late for the desk');
  assert.equal(slaState({ ...replied, status: 'open' }, at.getTime() + 30 * 3600_000).overdue, true);
  const done = slaState({ ...replied, status: 'resolved', resolved_at: new Date(at.getTime() + 25 * 3600_000) });
  assert.deepEqual([done.first_response, done.resolve, done.overdue], ['met', 'missed', false]);
  assert.equal(slaState({ status: 'open' }).first_response, null, 'tickets from before migration 026 have no timers');
});

test('GPS track length: sums the path, skips jumps that would need more than 200 km/h', () => {
  const pts = line(10);
  const m = trackDistanceM(pts);
  assert.ok(Math.abs(m - 10_000) < 30, `${m}`);
  const jump = [...pts.slice(0, 5), { lat: -23.0, lng: 133.8822, at: new Date(pts[4].at.getTime() + 5000) }, ...pts.slice(5)];
  assert.ok(Math.abs(trackDistanceM(jump) - m) < 30, 'a GPS jump is ignored');
  assert.equal(trackDistanceM([]), 0);
});

test('fare review: as quoted, route change supported or not by the track, no track, already refunded, failed payment', () => {
  const base = { quote_cents: 2000, est_distance_m: 10_000, per_km_cents: 160, service: 'ride', refunded_cents: 0 };
  // Paid the price shown.
  const q = reviewFare({ ...base, final_cents: 2000, actual_distance_m: 14_000, track: line(14) });
  assert.deepEqual([q.verdict, q.overcharge_cents], ['as_quoted', 0]);
  assert.match(q.explanation, /price shown/);
  // Charged for 14 km but the car drove 10 km: the route change isn't earned.
  const o = reviewFare({ ...base, final_cents: 2400, actual_distance_m: 14_000, track: line(10) });
  assert.deepEqual([o.verdict, o.overcharge_cents, o.fair_cents], ['overcharged', 400, 2000]);
  // The track shows 14 km: it stands.
  const s = reviewFare({ ...base, final_cents: 2400, actual_distance_m: 14_000, track: line(14) });
  assert.deepEqual([s.verdict, s.overcharge_cents], ['supported', 0]);
  // Partly supported: $30 quote charged $36 for 15 km; 11.82 km tracked (+10% allowance = 13 km) supports $4.80 of the $6.
  const part = reviewFare({ ...base, quote_cents: 3000, final_cents: 3600, actual_distance_m: 15_000, track: line(11.82) });
  assert.equal(part.verdict, 'overcharged');
  assert.ok(Math.abs(part.overcharge_cents - 120) <= 5, `${part.overcharge_cents}`);
  // No track: can't check.
  const u = reviewFare({ ...base, final_cents: 2400, actual_distance_m: 14_000, track: line(1).slice(0, 2) });
  assert.deepEqual([u.verdict, u.overcharge_cents, u.tracked_distance_m], ['unverified', 400, null]);
  // Already refunded.
  const r = reviewFare({ ...base, final_cents: 2400, actual_distance_m: 14_000, track: line(10), refunded_cents: 400 });
  assert.deepEqual([r.verdict, r.overcharge_cents], ['refunded_already', 0]);
  const half = reviewFare({ ...base, final_cents: 2400, actual_distance_m: 14_000, track: line(10), refunded_cents: 100 });
  assert.deepEqual([half.verdict, half.overcharge_cents], ['overcharged', 300]);
  assert.equal(reviewFare({ ...base, final_cents: 2400, actual_distance_m: 14_000, track: line(10), payment_failed: true }).verdict, 'not_charged');
  // Tours never change price.
  assert.equal(reviewFare({ ...base, service: 'tour', final_cents: 2000, actual_distance_m: 90_000, track: line(10) }).verdict, 'as_quoted');
});

test('automatic refund: within the per-refund limit and the 30-day count; unverified per policy; switched off', () => {
  const o = reviewFare({ quote_cents: 2000, est_distance_m: 10_000, per_km_cents: 160, service: 'ride', refunded_cents: 0, final_cents: 2400, actual_distance_m: 14_000, track: line(10) });
  assert.equal(autoRefundDecision(o, FR, 0).refund_cents, 400);
  assert.deepEqual(autoRefundDecision(o, FR, 2), { refund_cents: 0, held: 'too_many' });
  assert.deepEqual(autoRefundDecision(o, { ...FR, max_cents: 300 }, 0), { refund_cents: 0, held: 'over_limit' });
  assert.deepEqual(autoRefundDecision(o, { ...FR, auto_refund: false }, 0), { refund_cents: 0, held: 'policy_off' });
  const u = { ...o, verdict: 'unverified' as const };
  assert.equal(autoRefundDecision(u, FR, 0).refund_cents, 400);
  assert.deepEqual(autoRefundDecision(u, { ...FR, unverified: 'ticket' }, 0), { refund_cents: 0, held: 'unverified_to_person' });
  assert.deepEqual(autoRefundDecision({ ...o, verdict: 'supported', overcharge_cents: 0 }, FR, 0), { refund_cents: 0, held: 'nothing' });
});

test('canned replies: placeholders filled, unknown ones left, sensible fallbacks', () => {
  assert.equal(fillPlaceholders('Hi {first_name}, about {trip_ref} ({ticket_ref}) {other}', { name: 'Mary Jane Smith', trip_ref: 'DG-ABC123', ticket_ref: 'ST-XYZ789' }),
    'Hi Mary, about DG-ABC123 (ST-XYZ789) {other}');
  assert.equal(fillPlaceholders('Hi {first_name}, {trip_ref}', {}), 'Hi there, your trip');
});

test('help centre: unique ids, topics exist, plain wording with no emoji or "all-electric" claims, every action known', async () => {
  const { HELP_ARTICLES, HELP_TOPICS, articlesFor } = await helpP;
  const ids = HELP_ARTICLES.map((a: any) => a.id);
  assert.equal(new Set(ids).size, ids.length);
  const actions = ['trip_help', 'message', 'safety', 'call', 'payment', 'profile', 'earnings'];
  for (const a of HELP_ARTICLES) {
    for (const who of a.audience) assert.ok(HELP_TOPICS[who].includes(a.topic), `${a.id}: topic ${a.topic} for ${who}`);
    const text = [a.title, ...a.body].join(' ');
    assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, a.id);
    assert.doesNotMatch(text, /100% electric|all-electric/i, a.id);
    for (const p of a.body) assert.ok(p.length <= 420, `${a.id}: keep paragraphs short (${p.length})`);
    if (a.action) assert.ok(actions.includes(a.action), `${a.id}: ${a.action}`);
  }
  for (const who of ['rider', 'driver']) for (const t of HELP_TOPICS[who]) assert.ok(articlesFor(who).some((a: any) => a.topic === t), `${who} topic ${t} has articles`);
});

test('help centre: numbers match the seeded fare rules and the business rules (fee split, tips, levy, cancellation)', async () => {
  const { HELP_ARTICLES } = await helpP;
  const all = HELP_ARTICLES.map((a: any) => a.body.join(' ')).join(' ');
  const seed = readFileSync(new URL('../src/lib/baseSeed.ts', import.meta.url), 'utf8');
  const ride = /\('ride',\s*'[^']+',\s*(\d+),\s*(\d+),\s*(\d+),\s*(\d+),\s*\d+,\s*(\d+),\s*\d+,\s*\d+,\s*\d+,\s*\d+,\s*(\d+)/.exec(seed)!;
  const [base, km, min, booking, cancel, levy] = ride.slice(1).map(Number);
  const $ = (c: number) => (c % 100 ? `$${(c / 100).toFixed(2)}` : `$${c / 100}`);
  assert.ok(all.includes(`${$(base)} to start, ${$(km)} a kilometre and ${min}c a minute, plus a ${$(booking)} booking fee`), 'ride fare wording');
  assert.ok(all.includes(`${$(levy)} government levy`));
  assert.ok(all.includes(`there is a ${$(cancel)} fee`));
  assert.ok(all.includes('You keep 75% of each fare') && all.includes('25%') && all.includes('100% yours'));
  assert.ok(all.includes('more than a quarter longer') && all.includes('never more than 20%'), 'upfront price rule (routeChangeExtra)');
  assert.ok(all.includes('within 30 days'), 'lost property window = policy default');
  assert.equal(DEFAULT_SUPPORT_POLICY.lost_property.report_within_days, 30);
});

test('help search: words, stems and synonyms find the right article; audience respected; empty query finds nothing', async () => {
  const { searchHelp, helpWords } = await helpP;
  const top = (q: string, who = 'rider') => searchHelp(q, who)[0]?.id;
  assert.deepEqual(helpWords("I've cancelled my rides"), ['ive', 'cancel', 'ride']);
  assert.equal(top('I left my phone in the car'), 'lost-item');
  assert.equal(top('forgot wallet'), 'lost-item');
  assert.equal(top('overcharged'), 'upfront-price');
  assert.equal(top('why was I charged more'), 'upfront-price');
  assert.equal(top('cancellation fee'), 'cancellation-fee');
  assert.equal(top('refund to my card'), 'refunds');
  assert.equal(top('rude driver'), 'driver-feedback');
  assert.equal(top('guide dog refused'), 'assistance-animal');
  assert.equal(top('found a phone in my car', 'driver'), 'driver-found-item');
  assert.equal(top('my pay is wrong', 'driver'), 'driver-pay-question');
  assert.ok(!searchHelp('tip', 'driver').some((a: any) => a.id === 'tips'), 'rider-only article not shown to drivers');
  assert.deepEqual(searchHelp('   the a ', 'rider'), []);
  assert.deepEqual(searchHelp('zzzz', 'rider'), []);
});
