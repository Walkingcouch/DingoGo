/** Round 17: loyalty rules (settings bounds, tiers, Darwin weeks and streaks, birthdays, expiry dates, promo rules). No database. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  GIFT_CARD_MIN_DAYS, LOYALTY_DEFAULTS, darwin, expiryFrom, inHours, isBirthday, ledgerLabel, mergeLoyalty, promoDiscountOf, promoRuleError,
  streakLength, tierFor, tierPoints, weekOf,
} from '../src/lib/loyalty.js';
import { giftCardExpiry } from '../src/services/loyalty.js';

test('loyalty settings: defaults, every number bounded, tiers sorted with the first at 0 trips', () => {
  assert.deepEqual(mergeLoyalty(null), LOYALTY_DEFAULTS);
  const s = mergeLoyalty({ expiry_months: 999, warn_days: 1, streak_weeks: 1, referral_monthly_cap: -4, birthday_points: 'x',
    tiers: [{ key: 'Gold!', name: 'Gold', min_trips: 30, multiplier: 9 }, { key: 'base', name: 'Base', min_trips: 3, multiplier: 0.2 }] });
  assert.equal(s.expiry_months, 60);
  assert.equal(s.warn_days, 7);
  assert.equal(s.streak_weeks, 2);
  assert.equal(s.referral_monthly_cap, 0);
  assert.equal(s.birthday_points, LOYALTY_DEFAULTS.birthday_points);
  assert.deepEqual(s.tiers.map((t) => [t.key, t.min_trips, t.multiplier]), [['base', 0, 1], ['gold', 30, 3]]);
});

test('tiers: by trips in the last year, progress to the next, points at the tier multiplier', () => {
  const tiers = LOYALTY_DEFAULTS.tiers;
  assert.equal(tierFor(0, tiers).tier.key, 'member');
  assert.deepEqual([tierFor(9, tiers).tier.key, tierFor(9, tiers).trips_to_next], ['member', 1]);
  assert.equal(tierFor(10, tiers).tier.key, 'silver');
  assert.deepEqual([tierFor(45, tiers).tier.key, tierFor(45, tiers).next], ['gold', null]);
  assert.equal(tierPoints(2350, 10, 1), 235);
  assert.equal(tierPoints(2350, 10, 1.5), 352);
  assert.equal(tierPoints(0, 10, 1.5), 0);
});

test('Darwin time: hour, weekday, Monday of the week across UTC midnight; streaks of weeks in a row', () => {
  // 2026-11-15 20:00 UTC = Monday 16 Nov 05:30 in Darwin.
  const d = darwin(new Date('2026-11-15T20:00:00Z'));
  assert.deepEqual([d.date, d.hour, d.dow, d.md, d.month], ['2026-11-16', 5, 1, '11-16', '2026-11']);
  assert.equal(weekOf(new Date('2026-11-15T20:00:00Z')), '2026-11-16');
  assert.equal(weekOf(new Date('2026-11-15T13:00:00Z')), '2026-11-09', 'Sunday night in Darwin is still last week');
  assert.equal(streakLength(['2026-11-16', '2026-11-09', '2026-11-02', '2026-10-19'], '2026-11-16'), 3);
  assert.equal(streakLength(['2026-11-09'], '2026-11-16'), 0);
});

test('birthdays on the Darwin date, 29 February on the 28th in other years; expiry months after the last activity', () => {
  assert.equal(isBirthday('11-19', '2026-11-19'), true);
  assert.equal(isBirthday('11-19', '2026-11-20'), false);
  assert.equal(isBirthday('02-29', '2027-02-28'), true);
  assert.equal(isBirthday('02-29', '2028-02-28'), false);
  assert.equal(isBirthday('02-29', '2028-02-29'), true);
  assert.equal(isBirthday(null, '2026-11-19'), false);
  assert.equal(expiryFrom('2025-11-19T00:00:00Z', 12)!.toISOString().slice(0, 10), '2026-11-19');
  assert.equal(expiryFrom(null, 12), null);
  assert.equal(expiryFrom('2025-11-19T00:00:00Z', 0), null);
});

test('promo rules: services, Darwin days and hours (over midnight), event area on pickup or drop-off; promo spend from the fare lines', () => {
  const todd = { lat: -23.6984, lng: 133.8822 }, airport = { lat: -23.8067, lng: 133.9022 };
  // Tuesday 17 Nov 2026, 2:30 pm Darwin.
  const ctx = { service: 'ride', at: new Date('2026-11-17T05:00:00Z'), pickup: todd, dropoff: airport };
  assert.equal(promoRuleError({}, ctx), null);
  assert.equal(promoRuleError({ services: ['courier_s'] }, ctx)?.code, 'promo_service');
  assert.equal(promoRuleError({ days: [2] }, ctx), null);
  assert.match(promoRuleError({ days: [0, 6] }, ctx)!.message, /Sunday, Saturday/);
  assert.equal(promoRuleError({ hour_from: 10, hour_to: 15 }, ctx), null);
  assert.match(promoRuleError({ hour_from: 15, hour_to: 24 }, ctx)!.message, /3 pm to midnight/);
  assert.equal(inHours(23, 22, 6), true);
  assert.equal(inHours(3, 22, 6), true);
  assert.equal(inHours(12, 22, 6), false);
  assert.equal(promoRuleError({ geo_lat: airport.lat, geo_lng: airport.lng, geo_radius_m: 500 }, ctx), null, 'drop-off at the event');
  assert.equal(promoRuleError({ geo_lat: -23.70, geo_lng: 133.80, geo_radius_m: 500 }, ctx)?.code, 'promo_area');
  assert.equal(promoDiscountOf({ lines: [{ label: 'Trip', cents: 2000 }, { label: 'Promo FIVE', cents: -500 }] }, 'FIVE'), 500);
  assert.equal(promoDiscountOf({ lines: [] }, 'FIVE'), 0);
  assert.equal(promoDiscountOf(null, 'FIVE'), 0);
});

test('ledger labels and gift-card expiry (3 years when sold)', () => {
  assert.equal(ledgerLabel('reward:Free flat white'), 'Swapped for Free flat white');
  assert.equal(ledgerLabel('expired'), 'Expired (no activity)');
  assert.equal(ledgerLabel('something_new'), 'something new');
  assert.equal(giftCardExpiry(365, true), GIFT_CARD_MIN_DAYS);
  assert.equal(giftCardExpiry(2000, true), 2000);
  assert.equal(giftCardExpiry(90, false), 90);
  assert.ok(GIFT_CARD_MIN_DAYS >= 3 * 365);
});
