/** Unit tests for the pure money logic (no database): fares, discounts and their order, levy and fuel surcharge, route changes,
 *  return and cancellation fees, driver pay and service fees, pickup pay, earnings-floor weeks, concessions and local dates. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cancelFeeCharged, gstOf, isNight, pointsEarned, quoteFare, returnFeeCents, routeChangeExtra, type FareRule,
} from '../src/lib/fares.js';
import {
  DRIVER_PAY_DEFAULTS, chargeableKm, driverPay, longPickupCents, mergeDriverPay, pickupPayCents, serviceFeeFor, weekStartOf,
  type DriverPaySettings,
} from '../src/lib/driverPay.js';
import { COMMUNITY_PRICING_DEFAULTS, checkCommunityPricing, concessionFor, localDate } from '../src/lib/community.js';

const RIDE: FareRule = {
  service: 'ride', label: 'Ride', base_cents: 300, per_km_cents: 160, per_min_cents: 25, booking_fee_cents: 100,
  min_fare_cents: 1000, night_pct: 20, holiday_pct: 25, cancel_fee_cents: 300, free_wait_min: 3, levy_cents: 100,
};
const COURIER: FareRule = { ...RIDE, service: 'courier_s', label: 'Courier small', levy_cents: 0, night_pct: 0, holiday_pct: 0 };
const DAY = new Date('2026-11-19T02:00:00Z');        // 11:30 am in Darwin
const trip5k = { distance_m: 5000, duration_s: 600, at: DAY };   // $3 + 5 km × $1.60 + 10 min × $0.25 = $13.50
const line = (q: { lines: { label: string; cents: number }[] }, start: string) => q.lines.find((l) => l.label.startsWith(start));

test('fare: base + distance + time, booking fee, NT levy after discounts, GST 1/11th, 5c rounding', () => {
  const q = quoteFare(RIDE, trip5k);
  assert.equal(q.trip_cents, 1350);
  assert.equal(q.booking_fee_cents, 100);
  assert.equal(q.levy_cents, 100);
  assert.equal(q.total_cents, 1550);
  assert.equal(q.subtotal_cents, 1550);
  assert.equal(q.gst_cents, 141);
  assert.equal(q.discount_cents, 0);
  assert.equal(q.distance_km, 5);
  assert.equal(q.duration_min, 10);
  assert.equal(line(q, 'NT passenger levy')?.cents, 100);
  // Odd cents are rounded to 5c (no 1c/2c coins): 5.03 km → 804.8c distance.
  assert.equal(quoteFare(RIDE, { ...trip5k, distance_m: 5030 }).total_cents % 5, 0);
});

test('fare: minimum fare, late-night loading (Darwin time) and public holiday on top, demand multiplier capped at 1.5', () => {
  const short = quoteFare(RIDE, { distance_m: 1000, duration_s: 120, at: DAY });
  assert.equal(short.trip_cents, 1000);
  assert.equal(line(short, 'Minimum fare')?.cents, 490);
  assert.equal(short.total_cents, 1200);

  assert.equal(isNight(new Date('2026-11-19T12:29:00Z')), false, '9:59 pm Darwin');
  assert.equal(isNight(new Date('2026-11-19T12:30:00Z')), true, '10 pm Darwin');
  assert.equal(isNight(new Date('2026-11-18T19:29:00Z')), true, '4:59 am Darwin');
  assert.equal(isNight(new Date('2026-11-18T19:30:00Z')), false, '5 am Darwin');
  const night = quoteFare(RIDE, { ...trip5k, at: new Date('2026-11-19T13:00:00Z') });
  assert.equal(night.trip_cents, 1620);
  assert.equal(night.total_cents, 1820);
  const both = quoteFare(RIDE, { ...trip5k, at: new Date('2026-11-19T13:00:00Z'), isHoliday: true });
  assert.equal(both.trip_cents, 1620 + 405, 'holiday loading applies to the night-loaded fare');

  assert.equal(quoteFare(RIDE, { ...trip5k, zoneMultiplier: 3 }).trip_cents, 2025, 'capped at ×1.5');
  assert.equal(quoteFare(RIDE, { ...trip5k, zoneMultiplier: 0.5 }).trip_cents, 1350, 'never below ×1');
  assert.equal(line(quoteFare(RIDE, { ...trip5k, zoneMultiplier: 1 }), 'High demand'), undefined);
});

test('fare: discounts in order (Pass, concession with cap, business account, promo, points up to half), never below zero', () => {
  const q = quoteFare(RIDE, {
    ...trip5k,
    plan: { ride_discount_pct: 10, waive_booking_fee: false, free_delivery: false },
    concession: { pct: 50, max_cents: 500, label: 'Concession (−50%)' },
    corporateDiscountPct: 10,
    promo: { code: 'WELCOME', kind: 'fixed', value: 500, max_discount_cents: null },
    pointsToRedeem: 1000, availablePoints: 1000,
  });
  assert.equal(line(q, 'DingoGo Pass')?.cents, -135, 'Pass % is on the trip fare only');
  assert.equal(line(q, 'Concession')?.cents, -500, 'capped per trip');
  assert.equal(line(q, 'Business account')?.cents, -82, '10% of what is left (815c)');
  assert.equal(line(q, 'Promo WELCOME')?.cents, -500);
  assert.equal(q.points_redeemed, 100, 'whole dollars, at most half of what is left');
  assert.equal(q.discount_cents, 1317);
  assert.equal(q.total_cents, 135 + 100, 'levy is never discounted');

  // A big fixed promo can't take the fare below zero; the levy is still paid.
  const free = quoteFare(RIDE, { ...trip5k, promo: { code: 'BIG', kind: 'fixed', value: 99_999, max_discount_cents: null } });
  assert.equal(free.discount_cents, 1450);
  assert.equal(free.total_cents, 100);
  // Percent promo with a cap.
  const pct = quoteFare(RIDE, { ...trip5k, promo: { code: 'HALF', kind: 'percent', value: 50, max_discount_cents: 300 } });
  assert.equal(line(pct, 'Promo HALF')?.cents, -300);
  // Points: only what the rider has, in 100s, and not more than half the fare.
  assert.equal(quoteFare(RIDE, { ...trip5k, pointsToRedeem: 5000, availablePoints: 250 }).points_redeemed, 200);
  assert.equal(quoteFare(RIDE, { ...trip5k, pointsToRedeem: 5000, availablePoints: 5000 }).points_redeemed, 700, 'half of $14.50');
  assert.equal(quoteFare(RIDE, { ...trip5k, pointsToRedeem: 5000, availablePoints: 0 }).points_redeemed, 0);
});

test('fare: Pass waives the booking fee and gives free deliveries; concession not on tours; fixed tour price', () => {
  const pass = quoteFare(RIDE, { ...trip5k, plan: { ride_discount_pct: 0, waive_booking_fee: true, free_delivery: false } });
  assert.equal(pass.booking_fee_cents, 0);
  assert.equal(pass.total_cents, 1450);
  const parcel = quoteFare(COURIER, { ...trip5k, plan: { ride_discount_pct: 0, waive_booking_fee: false, free_delivery: true }, fuelSurchargeCents: 50,
    pointsToRedeem: 500, availablePoints: 500 });
  assert.equal(parcel.total_cents, 50, 'free delivery: only the fuel surcharge (all to the driver) is paid');
  assert.equal(parcel.points_redeemed, 0, 'no points spent on a free delivery');
  const tour = quoteFare({ ...RIDE, service: 'tour', label: 'Tour' }, { ...trip5k, fixedPriceCents: 15000, fuelSurchargeCents: 50,
    longPickup: { km: 5, cents: 300 }, concession: { pct: 50, max_cents: null, label: 'Concession (−50%)' } });
  assert.equal(tour.trip_cents, 15000);
  assert.equal(tour.fuel_surcharge_cents, 0);
  assert.equal(tour.long_pickup_cents, 0);
  assert.equal(line(tour, 'Concession'), undefined);
  assert.equal(tour.total_cents, 15000 + 100 + 100);
});

test('fare: state levy replaces the NT levy only on services that carry one; fuel surcharge and long pickup', () => {
  assert.equal(quoteFare(RIDE, { ...trip5k, levy: { cents: 0, label: 'SA passenger levy' } }).levy_cents, 0);
  assert.equal(line(quoteFare(RIDE, { ...trip5k, levy: { cents: 200, label: 'SA passenger levy' } }), 'SA passenger levy')?.cents, 200);
  assert.equal(quoteFare(COURIER, { ...trip5k, levy: { cents: 100, label: 'NT passenger levy' } }).levy_cents, 0, 'parcels pay no passenger levy');
  const fuel = quoteFare(RIDE, { ...trip5k, fuelSurchargeCents: 52, promo: { code: 'BIG', kind: 'fixed', value: 99_999, max_discount_cents: null } });
  assert.equal(fuel.fuel_surcharge_cents, 50, '5c-rounded');
  assert.equal(fuel.total_cents, 150, 'fuel and levy are added after discounts');
  const far = quoteFare(RIDE, { ...trip5k, longPickup: { km: 6.04, cents: 245 } });
  assert.equal(far.long_pickup_cents, 245);
  assert.equal(far.long_pickup_km, 6);
  assert.equal(far.total_cents, 1550 + 245);
});

test('route change: quote stands up to +25% distance, then extra km at the per-km rate, capped at +20%; tours never change', () => {
  const base = { quoteCents: 2000, estDistanceM: 5000, perKmCents: 160, service: 'ride' };
  assert.equal(routeChangeExtra({ ...base, actualDistanceM: 6250 }), 0);
  assert.equal(routeChangeExtra({ ...base, actualDistanceM: 7000 }), 320);
  assert.equal(routeChangeExtra({ ...base, actualDistanceM: 20_000 }), 400, 'capped at 20% of the quote');
  assert.equal(routeChangeExtra({ ...base, actualDistanceM: 20_000, service: 'tour' }), 0);
  assert.equal(routeChangeExtra({ ...base, actualDistanceM: null }), 0);
  assert.equal(routeChangeExtra({ ...base, estDistanceM: 0, actualDistanceM: 9000 }), 0, 'no estimate, no adjustment');
});

test('return, cancellation and points: return fee % with a minimum, cancel fee never above the price or on cash, points and GST', () => {
  const policy = { return_fee_pct: 50, return_fee_min_cents: 500 };
  assert.equal(returnFeeCents(1000, policy), 500);
  assert.equal(returnFeeCents(1234, policy), 615);
  assert.equal(returnFeeCents(3000, policy), 1500);
  assert.equal(returnFeeCents(3000, { ...policy, return_fee_pct: 0 }), 0, 'switched off');

  assert.deepEqual(cancelFeeCharged(300, { quote_cents: 1550, payment_method: 'card' }), { cents: 300 });
  assert.deepEqual(cancelFeeCharged(300, { quote_cents: 1550, payment_method: 'cash' }), { cents: 0, waived: 'cash' });
  assert.deepEqual(cancelFeeCharged(300, { quote_cents: 200, payment_method: 'wallet' }), { cents: 200, waived: 'capped' });
  assert.deepEqual(cancelFeeCharged(300, { quote_cents: 0, payment_method: 'card' }), { cents: 0, waived: 'capped' }, 'a free Pass delivery costs nothing to cancel');
  assert.deepEqual(cancelFeeCharged(0, { quote_cents: 1550, payment_method: 'card' }), { cents: 0 });

  assert.equal(pointsEarned(1550, 10), 155);
  assert.equal(pointsEarned(1599, 10), 159);
  assert.equal(pointsEarned(0, 10), 0);
  assert.equal(gstOf(1550), 141);
  assert.equal(gstOf(11), 1);
});

test('driver pay: service fee by car (never above the driver’s own rate), pay breakdown, pickup pay and long-pickup charge', () => {
  const s: DriverPaySettings = mergeDriverPay({ service_fee: { own_car_pct: 22, green_pct: 20 } });
  assert.deepEqual(serviceFeeFor(25, { fuel_type: 'electric', ownership: 'driver_owned' }, s), { pct: 20, basis: 'green' });
  assert.deepEqual(serviceFeeFor(25, { fuel_type: 'hybrid', ownership: 'fleet' }, s), { pct: 20, basis: 'green' });
  assert.deepEqual(serviceFeeFor(25, { fuel_type: 'petrol', ownership: 'driver_owned' }, s), { pct: 22, basis: 'own_car' });
  assert.deepEqual(serviceFeeFor(25, { fuel_type: 'petrol', ownership: 'fleet' }, s), { pct: 25, basis: 'driver' });
  assert.deepEqual(serviceFeeFor(15, { fuel_type: 'electric', ownership: 'driver_owned' }, s), { pct: 15, basis: 'driver' }, 'a lower personal rate wins');
  assert.deepEqual(serviceFeeFor(NaN, null, s), { pct: 25, basis: 'driver' });
  assert.deepEqual(serviceFeeFor(25, null, DRIVER_PAY_DEFAULTS), { pct: 25, basis: 'driver' }, 'defaults keep 25% for everyone');

  const p = driverPay({ fareCents: 1350, feePct: 25, pickupM: 5000, pickupPayCents: 180, fuelSurchargeCents: 50 },
    mergeDriverPay({ pickup: { enabled: true } }));
  assert.equal(p.fee_cents, 338);
  assert.equal(p.total_cents, 1350 - 338 + 180 + 50);
  assert.equal(p.pickup_km, 5);
  assert.equal(p.pickup_paid_km, 3);

  const on = mergeDriverPay({ pickup: { enabled: true } });   // first 2 km free, 60c/km to 10 km
  assert.equal(chargeableKm(5000, DRIVER_PAY_DEFAULTS), 0, 'off by default');
  assert.equal(chargeableKm(1500, on), 0);
  assert.equal(chargeableKm(5000, on), 3);
  assert.equal(chargeableKm(20_000, on), 10);
  assert.equal(chargeableKm(null, on), 0);
  assert.equal(pickupPayCents(5000, on), 180);
  assert.equal(longPickupCents(5500, on), 210);
  assert.equal(longPickupCents(5333, on), 200, '5c-rounded');
  assert.deepEqual(mergeDriverPay('junk'), DRIVER_PAY_DEFAULTS);
  assert.equal(mergeDriverPay({ earnings_floor: { enabled: true } }).earnings_floor.cents_per_engaged_hour, 3200, 'missing fields keep defaults');
});

test('earnings-floor weeks run Monday to Sunday in Darwin time', () => {
  assert.equal(weekStartOf(new Date('2026-11-19T02:00:00Z')), '2026-11-16');
  assert.equal(weekStartOf(new Date('2026-11-22T13:30:00Z')), '2026-11-16', 'Sunday 11 pm Darwin');
  assert.equal(weekStartOf(new Date('2026-11-22T15:00:00Z')), '2026-11-23', 'Monday 00:30 Darwin (still Sunday in UTC)');
});

test('concessions: approved card, accepted type and service, valid until local midnight; policy validation', () => {
  const rules = { ...COMMUNITY_PRICING_DEFAULTS, enabled: true, concession_pct: 50, concession_max_cents: 1000 };
  const card = { type: 'pensioner', status: 'approved', expires: '2026-11-19' };
  assert.deepEqual(concessionFor(card, 'ride', rules, DAY), { pct: 50, max_cents: 1000, label: 'Concession (−50%)' });
  assert.equal(concessionFor({ ...card, status: 'pending' }, 'ride', rules, DAY), null);
  assert.equal(concessionFor({ ...card, type: 'student' }, 'ride', rules, DAY), null);
  assert.equal(concessionFor(card, 'courier_s', rules, DAY), null);
  assert.equal(concessionFor(card, 'ride', { ...rules, enabled: false }, DAY), null);
  assert.ok(concessionFor(card, 'ride', rules, new Date('2026-11-19T14:00:00Z')), '11:30 pm Darwin on the expiry day: still valid');
  assert.equal(concessionFor(card, 'ride', rules, new Date('2026-11-19T15:00:00Z')), null, '00:30 the next day in Darwin (still the 19th in UTC)');
  assert.equal(localDate(new Date('2026-11-19T15:00:00Z')), '2026-11-20');
  assert.throws(() => checkCommunityPricing({ concession_pct: 80 }), /0 to 75/);
  assert.throws(() => checkCommunityPricing({ enabled: true, concession_pct: 0 }), /Set a concession percent/);
  assert.throws(() => checkCommunityPricing({ types: ['library_card'] }), /Card types/);
  assert.equal(checkCommunityPricing({ enabled: true, concession_pct: 30, services: ['ride', 'ride'] }).services.length, 1);
});
