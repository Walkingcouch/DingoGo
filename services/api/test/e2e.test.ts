/**
 * End-to-end API test against a real Postgres (seeded). Run: npm run db:reset && npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/index.js';
import { pool, one } from '../src/db.js';
import { quoteFare } from '../src/lib/fares.js';

process.env.LOG_SMS = 'false';
let app: Awaited<ReturnType<typeof buildServer>>;
const tokens: Record<string, string> = {};

async function call(method: string, url: string, who?: string, body?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: body as any, headers: who ? { authorization: `Bearer ${tokens[who]}` } : {} });
  const json = res.body ? JSON.parse(res.body) : null;
  return { status: res.statusCode, ...json } as any;
}
async function login(who: string, phone: string, appName = 'rider') {
  const r = await call('POST', '/auth/otp/request', undefined, { phone });
  assert.equal(r.status, 200);
  const v = await call('POST', '/auth/otp/verify', undefined, { phone, code: r.dev_code, app: appName });
  assert.equal(v.status, 200, JSON.stringify(v));
  tokens[who] = v.token;
  return v;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitForOffer(who: string) {
  for (let i = 0; i < 30; i++) {
    const o = await call('GET', '/driver/offers', who);
    if (o.offers?.length) return o.offers[0];
    await wait(100);
  }
  throw new Error('no offer for ' + who);
}

const TODD_MALL = { lat: -23.6984, lng: 133.8822, address: 'Todd Mall' };
const AIRPORT = { lat: -23.8067, lng: 133.9022, address: 'Alice Springs Airport' };
const HOSPITAL = { lat: -23.7076, lng: 133.8770, address: 'Alice Springs Hospital' };

before(async () => {
  app = await buildServer();
  await login('rider', '0400 000 100');
  await login('d1', '+61400000011', 'driver');
  await login('d2', '+61400000012', 'driver');
  await login('d3', '+61400000013', 'driver');
  await login('admin', '+61400000001', 'admin');
  await login('cafe', '+61400000300', 'partner');
});
after(async () => { await app.close(); await pool.end(); });

test('fare engine: levy, minimum fare, night surcharge, rounding', () => {
  const rule = { service: 'ride', label: 'Ride', base_cents: 350, per_km_cents: 185, per_min_cents: 30, booking_fee_cents: 100, min_fare_cents: 1000, night_pct: 20, holiday_pct: 15, levy_cents: 100 };
  const day = quoteFare(rule, { distance_m: 1000, duration_s: 120, at: new Date('2026-11-02T02:00:00Z') }); // 11:30am Darwin
  assert.equal(day.trip_cents, 1000, 'minimum fare applies');
  assert.equal(day.total_cents, 1000 + 100 + 100);
  assert.equal(day.gst_cents, Math.round(day.total_cents / 11));
  const night = quoteFare(rule, { distance_m: 5000, duration_s: 600, at: new Date('2026-11-02T14:00:00Z') }); // 11:30pm Darwin
  assert.ok(night.lines.some((l) => l.label.startsWith('Late-night')));
  assert.equal(night.total_cents % 5, 0, 'cash-friendly 5c rounding');
});

test('compliance: unapproved applicant cannot go online', async () => {
  await login('applicant', '+61400000014', 'driver');
  const r = await call('POST', '/driver/online', 'applicant', { online: true, lat: -23.7, lng: 133.88 });
  assert.equal(r.status, 400);
  assert.equal(r.error, 'not_compliant');
});

test('outside service area is rejected', async () => {
  const r = await call('POST', '/quotes', 'rider', { service: 'ride', pickup: { lat: -12.46, lng: 130.84 }, dropoff: TODD_MALL });
  assert.equal(r.error, 'outside_service_area');
});

let rideId = '';
test('ride: quote → request → nearest driver offered → accept → PIN start → complete → settle', async () => {
  // Driver 1 near Todd Mall, driver 3 further away, driver 2 offline
  assert.equal((await call('POST', '/driver/online', 'd1', { online: true, lat: -23.6990, lng: 133.8815, battery_pct: 85 })).status, 200);
  assert.equal((await call('POST', '/driver/online', 'd3', { online: true, lat: -23.6830, lng: 133.8680, battery_pct: 90 })).status, 200);

  const q = await call('POST', '/quotes', 'rider', { service: 'ride', pickup: TODD_MALL, dropoff: AIRPORT });
  assert.equal(q.status, 200);
  assert.ok(q.quote.total_cents > 2500 && q.quote.total_cents < 5000, `airport fare ${q.quote.total_cents}`);
  assert.ok(q.quote.lines.some((l: any) => l.label === 'NT passenger levy'));

  const before = await one('SELECT loyalty_points FROM users WHERE phone = $1', ['+61400000100']);
  const t = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: AIRPORT, payment_method: 'card', redeem_points: 300 });
  assert.equal(t.status, 201, JSON.stringify(t));
  rideId = t.trip.id;
  assert.equal(t.trip.points_redeemed, 300);
  assert.equal(t.trip.payment_status, 'authorised');
  assert.match(t.trip.verify_pin, /^\d{4}$/, 'rider sees PIN');

  const offer = await waitForOffer('d1');
  assert.equal(offer.trip_id, rideId);
  assert.equal((await call('GET', '/driver/offers', 'd3')).offers.length, 0, 'only nearest driver is offered');

  const acc = await call('POST', `/driver/offers/${rideId}/accept`, 'd1');
  assert.equal(acc.trip.status, 'accepted');
  assert.equal(acc.trip.verify_pin, undefined, 'driver must ask for PIN');

  // Rider can't start a second ride
  const dup = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card' });
  assert.equal(dup.status, 409);

  assert.equal((await call('POST', `/driver/trips/${rideId}/arrive`, 'd1')).trip.status, 'arrived');
  const badPin = await call('POST', `/driver/trips/${rideId}/start`, 'd1', { pin: '0000' === t.trip.verify_pin ? '1111' : '0000' });
  assert.equal(badPin.error, 'pin_mismatch');
  assert.equal((await call('POST', `/driver/trips/${rideId}/start`, 'd1', { pin: t.trip.verify_pin })).trip.status, 'in_progress');

  await call('POST', '/driver/location', 'd1', { lat: -23.75, lng: 133.89, heading: 180 });
  const done = await call('POST', `/driver/trips/${rideId}/complete`, 'd1', { actual_distance_m: t.trip.est_distance_m });
  assert.equal(done.trip.status, 'completed');
  assert.equal(done.trip.final_cents, t.trip.quote_cents, 'upfront price honoured');
  assert.equal(done.trip.payment_status, 'captured');

  const after = await one('SELECT loyalty_points FROM users WHERE phone = $1', ['+61400000100']);
  assert.equal(after.loyalty_points, before.loyalty_points - 300 + Math.floor((done.trip.final_cents / 100) * 10));

  const ledger = await one(`SELECT sum(amount_cents)::int net FROM driver_ledger WHERE trip_id = $1`, [rideId]);
  const trip = done.trip;
  assert.equal(ledger.net, trip.fare_breakdown.trip_cents - Math.round(trip.fare_breakdown.trip_cents * 0.25), 'driver earns trip fare minus 25%');
});

test('ride: rating, tip (100% to driver), tax invoice', async () => {
  assert.equal((await call('POST', `/trips/${rideId}/rate`, 'rider', { rating: 5, feedback: 'Great chat' })).ok, true);
  assert.equal((await call('POST', `/trips/${rideId}/tip`, 'rider', { cents: 500 })).ok, true);
  const r = await call('GET', `/trips/${rideId}/receipt`, 'rider');
  assert.equal(r.receipt.title, 'Tax Invoice');
  assert.ok(r.receipt.gst_cents > 0);
  assert.ok(r.receipt.co2_saved_kg > 0);
  const tip = await one(`SELECT amount_cents FROM driver_ledger WHERE trip_id = $1 AND kind = 'tip'`, [rideId]);
  assert.equal(tip.amount_cents, 500);
});

test('public share link shows trip without phone numbers', async () => {
  const t = await one('SELECT share_token FROM trips WHERE id = $1', [rideId]);
  const r = await call('GET', `/public/track/${t.share_token}`);
  assert.equal(r.trip.status, 'completed');
  assert.equal(JSON.stringify(r).includes('+614'), false);
});

test('courier: sender requests, recipient PIN required for proof of delivery', async () => {
  await call('POST', '/driver/location', 'd1', { lat: -23.6986, lng: 133.8820 }); // back in town, nearest again
  const noAck = await call('POST', '/trips', 'rider', {
    kind: 'courier', service: 'courier_s', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card',
    parcel: { size: 'S', description: 'Prescription glasses', sender_name: 'Demo', sender_phone: '0400000100', recipient_name: 'Nan', recipient_phone: '0400000555', prohibited_ack: false },
  });
  assert.equal(noAck.error, 'prohibited_ack_required');

  const t = await call('POST', '/trips', 'rider', {
    kind: 'courier', service: 'courier_s', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card',
    parcel: { size: 'S', description: 'Prescription glasses', sender_name: 'Demo', sender_phone: '0400000100', recipient_name: 'Nan', recipient_phone: '0400000555', prohibited_ack: true },
  });

  assert.equal(t.status, 201, JSON.stringify(t));
  assert.equal(t.trip.parcel.delivery_pin, undefined, 'sender cannot see recipient PIN');
  const offer = await waitForOffer('d1');
  await call('POST', `/driver/offers/${offer.trip_id}/accept`, 'd1');
  await call('POST', `/driver/trips/${t.trip.id}/arrive`, 'd1');
  assert.equal((await call('POST', `/driver/trips/${t.trip.id}/start`, 'd1')).trip.status, 'in_progress');
  const noPod = await call('POST', `/driver/trips/${t.trip.id}/complete`, 'd1', {});
  assert.equal(noPod.error, 'pod_required');
  const pin = (await one('SELECT delivery_pin FROM parcels WHERE trip_id = $1', [t.trip.id])).delivery_pin;
  const ok = await call('POST', `/driver/trips/${t.trip.id}/complete`, 'd1', { delivery_pin: pin, pod_received_by: 'Nan' });
  assert.equal(ok.trip.status, 'completed');
  assert.ok(ok.trip.parcel.delivered_at);
});

test('cancellation: free right after request, fee after driver has waited', async () => {
  const t1 = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card' });
  const c1 = await call('POST', `/trips/${t1.trip.id}/cancel`, 'rider', { reason: 'changed mind' });
  assert.equal(c1.trip.status, 'cancelled_rider');
  assert.equal(c1.trip.cancel_fee_cents, 0);

  const t2 = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card' });
  const offer = await waitForOffer('d1');
  await call('POST', `/driver/offers/${offer.trip_id}/accept`, 'd1');
  await call('POST', `/driver/trips/${t2.trip.id}/arrive`, 'd1');
  await pool.query(`UPDATE trips SET arrived_at = now() - interval '6 minutes' WHERE id = $1`, [t2.trip.id]);
  const c2 = await call('POST', `/trips/${t2.trip.id}/cancel`, 'rider', {});
  assert.equal(c2.trip.cancel_fee_cents, 300);
});

test('assistance animal: driver decline is flagged for review', async () => {
  const t = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card', assistance_animal: true });
  assert.equal(t.status, 201);
  const offer = await waitForOffer('d1');
  await call('POST', `/driver/offers/${offer.trip_id}/decline`, 'd1');
  const f = await one(`SELECT * FROM compliance_flags WHERE trip_id = $1`, [t.trip.id]);
  assert.equal(f.kind, 'assistance_animal_refusal');
  // re-dispatched to the next driver
  const o3 = await waitForOffer('d3');
  assert.equal(o3.trip_id, t.trip.id);
  await call('POST', `/trips/${t.trip.id}/cancel`, 'rider', {});
});

test('EV range check: low-battery car is skipped for long trips', async () => {
  await call('POST', '/driver/online', 'd1', { online: false });
  await call('POST', '/driver/location', 'd3', { lat: -23.6985, lng: 133.8822, battery_pct: 18 });
  // ~45 km trip to the edge of the zone exceeds 18% × 427 km × 0.7 derate − 40 km reserve
  const far = { lat: -23.69, lng: 133.66, address: 'Far west' };
  const t = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: far, payment_method: 'card' });
  assert.equal(t.status, 201, JSON.stringify(t));
  await wait(400);
  assert.equal((await call('GET', '/driver/offers', 'd3')).offers.length, 0, 'low battery car not offered long trip');
  await call('POST', `/trips/${t.trip.id}/cancel`, 'rider', {});
});

test('tour cancellation: free 48 h+ ahead, 50% inside 48 h', async () => {
  const tours = (await call('GET', '/tours', 'rider')).tours;
  const t1 = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'tour', tour_package_id: tours[0].id, pickup: TODD_MALL, dropoff: TODD_MALL, payment_method: 'card',
    scheduled_for: new Date(Date.now() + 72 * 3600e3).toISOString() });
  assert.equal(t1.status, 201, JSON.stringify(t1));
  assert.equal((await call('POST', `/trips/${t1.trip.id}/cancel`, 'rider', {})).trip.cancel_fee_cents, 0);
  const t2 = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'tour', tour_package_id: tours[0].id, pickup: TODD_MALL, dropoff: TODD_MALL, payment_method: 'card',
    scheduled_for: new Date(Date.now() + 24 * 3600e3).toISOString() });
  const c2 = await call('POST', `/trips/${t2.trip.id}/cancel`, 'rider', {});
  assert.equal(c2.trip.cancel_fee_cents, Math.round(t2.trip.quote_cents / 2));
});

test('loyalty: redeem free coffee, café validates once', async () => {
  const l = await call('GET', '/loyalty', 'rider');
  const coffee = l.rewards.find((r: any) => r.partner_name?.startsWith('Spinifex') && r.title.includes('coffee'));
  const red = await call('POST', `/loyalty/rewards/${coffee.id}/redeem`, 'rider');
  assert.match(red.redemption.code, /^DG/);
  const chk = await call('POST', '/partner/check', 'cafe', { code: red.redemption.code });
  assert.equal(chk.valid, true);
  assert.equal((await call('POST', '/partner/redeem', 'cafe', { code: red.redemption.code })).redemption.status, 'redeemed');
  assert.equal((await call('POST', '/partner/redeem', 'cafe', { code: red.redemption.code })).error, 'already_redeemed');
});

test('prepaid voucher tops up wallet once', async () => {
  const r = await call('POST', '/wallet/voucher', 'rider', { code: 'dgdemo2026' });
  assert.equal(r.added_cents, 2000);
  assert.equal((await call('POST', '/wallet/voucher', 'rider', { code: 'DGDEMO2026' })).error, 'voucher_used');
});

test('admin: dashboard, levy report, phone booking, compliance', async () => {
  const d = await call('GET', '/admin/dashboard', 'admin');
  assert.ok(d.today.requested >= 1);
  assert.equal(d.daily.length, 14);
  const levy = await call('GET', '/admin/reports/levy', 'admin');
  assert.ok(levy.passenger_trips >= 1);
  assert.equal(levy.levy_payable_cents, levy.passenger_trips * 100);
  const noCash = await call('POST', '/admin/bookings', 'admin', { phone: '0400 123 999', name: 'Phone Customer', trip: { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL } });
  assert.equal(noCash.error, 'cash_not_accepted', 'cash is off for rides by default');
  const pb = await call('POST', '/admin/bookings', 'admin', { phone: '0400 123 998', name: 'Phone Customer', trip: { kind: 'courier', service: 'courier_s', pickup: TODD_MALL, dropoff: HOSPITAL,
    parcel: { size: 'S', description: 'Keys', sender_name: 'Phone Customer', sender_phone: '0400123998', recipient_name: 'Friend', recipient_phone: '0400123997', prohibited_ack: true } } });
  assert.equal(pb.status, 201, JSON.stringify(pb));
  assert.equal(pb.trip.channel, 'phone');
  assert.equal(pb.trip.payment_method, 'cash');
  await call('POST', `/admin/trips/${pb.trip.id}/cancel`, 'admin', {});
  const comp = await call('GET', '/admin/compliance', 'admin');
  assert.ok(comp.flags.length >= 1);
  assert.equal((await call('GET', '/admin/dashboard', 'rider')).status, 403);
});

test('roof display: playlist + play logging', async () => {
  const p = await app.inject({ method: 'GET', url: '/display/playlist?key=led_demo_vehicle_one_key' });
  const j = JSON.parse(p.body);
  assert.equal(j.mode, 'ads');
  assert.ok(j.items.length >= 1);
  const camp = j.items.find((i: any) => !String(i.id).startsWith('house'));
  if (camp) {
    const r = await app.inject({ method: 'POST', url: '/display/plays', headers: { 'x-display-key': 'led_demo_vehicle_one_key' }, payload: { plays: [{ campaign_id: camp.id, seconds: 10 }] } });
    assert.equal(JSON.parse(r.body).recorded, 1);
  }
  assert.equal((await app.inject({ method: 'GET', url: '/display/playlist?key=wrong' })).statusCode, 403);
});

test('privacy: data export works', async () => {
  const e = await call('GET', '/me/export', 'rider');
  assert.ok(e.trips.length >= 1);
});
