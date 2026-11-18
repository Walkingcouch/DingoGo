/**
 * End-to-end API test against a real Postgres (seeded). Run: npm run db:reset && npm test
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/index.js';
import { pool, one, q } from '../src/db.js';
import { signToken } from '../src/auth.js';
import { checkSignature, signedUploadPath } from '../src/lib/uploads.js';
import { quoteFare } from '../src/lib/fares.js';
import { dispatchTick, searchOver } from '../src/services/trips.js';
import { bg, flushBackground, pendingBackground } from '../src/lib/background.js';
import { config } from '../src/config.js';

process.env.LOG_SMS = 'false';
let app: Awaited<ReturnType<typeof buildServer>>;
const tokens: Record<string, string> = {};

async function call(method: string, url: string, who?: string, body?: unknown, ip = '127.0.0.1') {
  const res = await app.inject({ method: method as any, url, payload: body as any, remoteAddress: ip, headers: who ? { authorization: `Bearer ${tokens[who]}` } : {} });
  const json = res.body && res.headers['content-type']?.toString().includes('json') ? JSON.parse(res.body) : null;
  return { status: res.statusCode, headers: res.headers, ...json } as any;
}
let loginIp = 0;
async function login(who: string, phone: string, appName = 'rider') {
  const ip = `10.250.${Math.floor(++loginIp / 250)}.${loginIp % 250}`; // each sign-in from its own address: stays clear of the per-IP limits
  const r = await call('POST', '/auth/otp/request', undefined, { phone }, ip);
  assert.equal(r.status, 200);
  const v = await call('POST', '/auth/otp/verify', undefined, { phone, code: r.dev_code, app: appName }, ip);
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
  assert.equal(typeof d.green_km_pct, 'number');
  assert.ok(d.green_km_pct > 0 && d.green_km_pct <= 100);
  assert.ok(d.ev_km > 0 && d.co2_saved_kg > 0);
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
  assert.equal(/100% electric|all-electric/i.test(p.body), false, 'no all-electric claim on the roof');
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

// ───────────── Own-car driver model ─────────────
let ownCarId = '';
// VIN position 10 'J' = 2018 model year
const CAMRY = { rego: 'cd 88 pp', make: 'Toyota', model: 'Camry', year: 2018, colour: 'White', seats: 4, doors: 4, fuel_type: 'petrol', vin: 'JTNBF3EK1J3001234', registered_owner: true };

test('own car: add petrol car → pending blocks online → admin approves → online → offer (no CO₂ claim)', async () => {
  // A ready-to-drive test driver with no car yet
  const u = await call('POST', '/admin/users', 'admin', { phone: '0400 000 777', name: 'Pat Petrol', role: 'driver' });
  assert.equal(u.status, 201, JSON.stringify(u));
  assert.equal((await call('PATCH', `/admin/drivers/${u.user.id}`, 'admin', { vehicle_id: null })).ok, true);
  await login('pd', '+61400000777', 'driver');

  const year = new Date().getFullYear();
  const old = await call('POST', '/driver/vehicles', 'pd', { ...CAMRY, year: year - 13 });
  assert.equal(old.status, 400);
  assert.equal(old.error, 'vehicle_too_old');
  assert.equal((await call('POST', '/driver/vehicles', 'pd', { ...CAMRY, doors: 2 })).error, 'doors');
  assert.equal((await call('POST', '/driver/vehicles', 'pd', { ...CAMRY, seats: 8 })).error, 'seats');
  const dup = await call('POST', '/driver/vehicles', 'pd', { ...CAMRY, rego: 'ca12dg' });
  assert.equal(dup.status, 409);
  assert.equal(dup.error, 'rego_taken');

  const add = await call('POST', '/driver/vehicles', 'pd', { ...CAMRY, range_km: 500 });
  assert.equal(add.status, 201, JSON.stringify(add));
  ownCarId = add.vehicle.id;
  assert.equal(add.vehicle.rego, 'CD88PP');
  assert.equal(add.vehicle.status, 'pending');
  assert.equal(add.vehicle.ownership, 'driver_owned');
  assert.equal(add.vehicle.green, false);
  assert.equal(add.vehicle.is_ev, false);
  assert.equal(add.vehicle.range_km, null, 'range only stored for EVs');

  const list = await call('GET', '/driver/vehicles', 'pd');
  assert.equal(list.current_vehicle_id, ownCarId);
  assert.equal(list.min_year, year - 12);
  assert.equal(list.max_age_years, 13);
  assert.ok(list.vehicles.some((v: any) => v.id === ownCarId));

  const doc = await call('POST', '/driver/documents', 'pd', { type: 'vehicle_rego', vehicle_id: ownCarId, number: 'CD88PP' });
  assert.equal(doc.document.vehicle_id, ownCarId);
  const fleetCar = await one(`SELECT id FROM vehicles WHERE rego = 'CA 12 DG'`);
  assert.equal((await call('POST', '/driver/documents', 'pd', { type: 'insurance', vehicle_id: fleetCar.id })).error, 'invalid_vehicle');
  assert.equal((await call('POST', `/driver/vehicles/${fleetCar.id}/use`, 'pd')).status, 404, "can't use someone else's car");
  assert.equal((await call('POST', `/driver/vehicles/${ownCarId}/use`, 'pd')).error, 'not_approved');

  const off = await call('POST', '/driver/online', 'pd', { online: true, lat: TODD_MALL.lat, lng: TODD_MALL.lng });
  assert.equal(off.error, 'not_compliant');
  assert.ok(off.details.some((m: string) => m.includes('waiting for DingoGo to check it')), JSON.stringify(off.details));
  const me = await call('GET', '/driver/me', 'pd');
  assert.equal(me.driver.vehicle.fuel_type, 'petrol');
  assert.equal(me.driver.vehicle.is_ev, false);
  assert.equal(me.driver.vehicle.display_key, undefined);
  assert.ok(me.documents.some((x: any) => x.vehicle_id === ownCarId));

  // Admin queue
  const pending = await call('GET', '/admin/vehicles?status=pending', 'admin');
  const item = pending.items.find((v: any) => v.id === ownCarId);
  assert.ok(item, 'car is in the admin queue');
  assert.equal(item.owner.name, 'Pat Petrol');
  assert.equal(item.documents.length, 1);
  assert.ok(pending.items.some((v: any) => v.rego === 'CB47JP'), 'seeded applicant car awaiting review');
  assert.ok(pending.items.every((v: any) => v.status === 'pending'));
  assert.equal((await call('GET', '/admin/vehicles', 'admin')).items.find((v: any) => v.rego === 'CA 12 DG').is_ev, true);

  const noDates = await call('POST', `/admin/vehicles/${ownCarId}/review`, 'admin', { decision: 'approve' });
  assert.equal(noDates.error, 'dates_required');
  const exp = new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10);
  const ok = await call('POST', `/admin/vehicles/${ownCarId}/review`, 'admin', {
    decision: 'approve', cvl_number: 'CVL-9001', cvl_expiry: exp, rego_expiry: exp, insurance_expiry: exp, roadworthy_date: new Date().toISOString().slice(0, 10),
    verified_year: 2018, verified_source: 'compliance_plate', rego_checked: true, ppsr_clear: true });
  assert.equal(ok.vehicle.status, 'approved', JSON.stringify(ok));
  const audit = await one(`SELECT * FROM audit_log WHERE entity = 'vehicle' AND entity_id = $1`, [ownCarId]);
  assert.equal(audit.action, 'vehicle_approve');

  // Not an EV: low battery_pct is irrelevant
  const on = await call('POST', '/driver/online', 'pd', { online: true, lat: TODD_MALL.lat, lng: TODD_MALL.lng, battery_pct: 5 });
  assert.equal(on.status, 200, JSON.stringify(on));
  await call('POST', '/driver/online', 'd3', { online: false });

  const t = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card' });
  assert.equal(t.status, 201, JSON.stringify(t));
  const offer = await waitForOffer('pd');
  assert.equal(offer.trip_id, t.trip.id);
  const acc = await call('POST', `/driver/offers/${t.trip.id}/accept`, 'pd');
  assert.equal(acc.trip.vehicle.fuel_type, 'petrol');
  assert.equal(acc.trip.vehicle.green, false);
  assert.equal(acc.trip.vehicle.is_ev, false);
  await call('POST', `/driver/trips/${t.trip.id}/arrive`, 'pd');
  await call('POST', `/driver/trips/${t.trip.id}/start`, 'pd', { pin: t.trip.verify_pin });
  assert.equal((await call('POST', `/driver/trips/${t.trip.id}/complete`, 'pd', {})).trip.status, 'completed');
  const r = await call('GET', `/trips/${t.trip.id}/receipt`, 'rider');
  assert.equal(r.receipt.co2_saved_kg, null, 'no CO₂ saved claim for a petrol car');
  assert.equal(r.receipt.vehicle_is_ev, false);
});

test('dispatch: EV preferred over a petrol car less than 1.5 km nearer', async () => {
  await call('POST', '/driver/location', 'pd', { lat: TODD_MALL.lat, lng: TODD_MALL.lng });
  // d3 (BYD, electric) ~1 km north of the pickup (~1.3 km road estimate) — within the 1.5 km green head start
  assert.equal((await call('POST', '/driver/online', 'd3', { online: true, lat: -23.6894, lng: 133.8822, battery_pct: 90 })).status, 200);
  const t = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card' });
  assert.equal(t.status, 201, JSON.stringify(t));
  const offer = await waitForOffer('d3');
  assert.equal(offer.trip_id, t.trip.id);
  assert.equal((await call('GET', '/driver/offers', 'pd')).offers.length, 0, 'petrol car not offered first');
  await call('POST', `/trips/${t.trip.id}/cancel`, 'rider', {});
});

test('own car: editing sends it back for checking', async () => {
  await call('POST', '/driver/online', 'pd', { online: false });
  const e = await call('PATCH', `/driver/vehicles/${ownCarId}`, 'pd', { colour: 'Red' });
  assert.equal(e.vehicle.status, 'pending');
  assert.equal(e.vehicle.colour, 'Red');
  assert.equal((await call('POST', '/driver/online', 'pd', { online: true, lat: TODD_MALL.lat, lng: TODD_MALL.lng })).error, 'not_compliant');
  const rej = await call('POST', `/admin/vehicles/${ownCarId}/review`, 'admin', { decision: 'reject', note: 'Roadworthy report is unreadable' });
  assert.equal(rej.vehicle.status, 'rejected');
  const me = await call('GET', '/driver/me', 'pd');
  assert.ok(me.compliance_issues.some((m: string) => m.includes('was not approved: Roadworthy report is unreadable')));
  await call('POST', '/driver/online', 'd3', { online: false });
});

// ───────────── States (NT live, SA hidden) + rego/age checks ─────────────
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';
/** A syntactically valid VIN whose position-10 code decodes to `year`. */
const vinFor = (year: number, serial = '301234') => `JTNBF3EK1${YEAR_CODES[(year - 1980) % 30]}${serial.padStart(7, '3')}`;
let saDriverId = '';

test('public config + driver vehicles expose per-state rules; SA hidden with 5 regional zones', async () => {
  const c = await call('GET', '/public/config');
  const nt = c.jurisdictions.find((j: any) => j.code === 'NT');
  const sa = c.jurisdictions.find((j: any) => j.code === 'SA');
  assert.equal(nt.active, true);
  assert.equal(nt.vehicle_max_age_years, 13);
  assert.equal(nt.levy_cents, 100);
  assert.ok(nt.vehicle_docs.includes('compliance_plate'));
  assert.equal(sa.active, false);
  assert.equal(sa.vehicle_max_age_years, 8);
  assert.equal(sa.levy_cents, 0);
  assert.equal(sa.inspection_months, 12);
  assert.equal(sa.min_year, new Date().getFullYear() - 7);
  assert.ok(sa.driver_docs.includes('sa_operator_accreditation'));
  assert.deepEqual(sa.zones.map((z: any) => z.id).sort(), ['coober-pedy', 'mount-gambier', 'port-augusta', 'port-pirie', 'whyalla']);
  assert.ok(sa.zones.every((z: any) => !z.active && z.launch_note.startsWith('Coming soon')));
  assert.equal(c.zones.find((z: any) => z.id === 'whyalla').state, 'SA');
  assert.equal(c.document_types.compliance_plate.label, 'Compliance plate');
  // SA town is not bookable while SA is hidden
  const q = await call('POST', '/quotes', 'rider', { service: 'ride', pickup: { lat: -32.4925, lng: 137.7656 }, dropoff: { lat: -32.50, lng: 137.78 } });
  assert.equal(q.error, 'outside_service_area');
});

test('SA driver cannot go online while SA is inactive', async () => {
  const u = await call('POST', '/admin/users', 'admin', { phone: '0400 000 778', name: 'Sam Southern', role: 'driver', state: 'SA' });
  assert.equal(u.status, 201, JSON.stringify(u));
  saDriverId = u.user.id;
  await login('sa', '+61400000778', 'driver');
  const r = await call('POST', '/driver/online', 'sa', { online: true, lat: TODD_MALL.lat, lng: TODD_MALL.lng });
  assert.equal(r.error, 'not_compliant');
  assert.ok(r.details.some((m: string) => m.includes("isn't operating in SA")), JSON.stringify(r.details));
  const v = await call('GET', '/driver/vehicles', 'sa');
  assert.equal(v.state, 'SA');
  assert.equal(v.rules.code, 'SA');
  assert.equal(v.max_age_years, 8);
  assert.equal(v.jurisdictions.length, 2);
  // Approved drivers can't change their own state
  assert.equal((await call('PATCH', '/driver/me', 'sa', { state: 'NT' })).error, 'state_locked');
  // Applicants can
  assert.equal((await call('PATCH', '/driver/me', 'applicant', { state: 'SA' })).ok, true);
  assert.equal((await call('PATCH', '/driver/me', 'applicant', { state: 'NT' })).ok, true);
});

let ntOldCarId = '';
test('vehicle age by state: SA car 9 years old rejected, NT 9-year-old ok; VIN required and checked', async () => {
  const y9 = new Date().getFullYear() - 9;
  const base = { ...CAMRY, year: y9 };
  const noVin = await call('POST', '/driver/vehicles', 'pd', { ...base, rego: 'SA9OLD', vin: undefined });
  assert.equal(noVin.status, 400, 'VIN required for driver-added cars');
  assert.equal((await call('POST', '/driver/vehicles', 'pd', { ...base, rego: 'SA9OLD', vin: 'JTNBF3EO1J3001234' })).error, 'vin');
  const sa = await call('POST', '/driver/vehicles', 'pd', { ...base, rego: 'SA9OLD', rego_state: 'SA', vin: vinFor(y9) });
  assert.equal(sa.status, 400);
  assert.equal(sa.error, 'vehicle_too_old');
  const nt = await call('POST', '/driver/vehicles', 'pd', { ...base, rego: 'NT9OLD', rego_state: 'NT', vin: vinFor(y9 - 3) });
  assert.equal(nt.status, 201, JSON.stringify(nt));
  ntOldCarId = nt.vehicle.id;
  assert.equal(nt.vehicle.rego_state, 'NT');
  assert.equal(nt.vehicle.vin_year, y9 - 3);
  assert.equal(nt.checks.vin_year_mismatch, true, 'VIN year differs from claimed year by > 1');
  assert.equal(nt.vehicle.checks.vin_year_mismatch, true);
  // Moving the car to SA re-applies the SA age limit
  assert.equal((await call('PATCH', `/driver/vehicles/${ntOldCarId}`, 'pd', { rego_state: 'SA' })).error, 'vehicle_too_old');
});

test('admin review: verified year + rego check required; too-old verified year rejected; lookup off without key', async () => {
  const exp = new Date(Date.now() + 200 * 864e5).toISOString().slice(0, 10);
  const dates = { cvl_expiry: exp, rego_expiry: exp, insurance_expiry: exp };
  const url = `/admin/vehicles/${ntOldCarId}/review`;
  assert.equal((await call('POST', url, 'admin', { decision: 'approve', ...dates, rego_checked: true })).error, 'verified_year_required');
  const y = new Date().getFullYear();
  const old = await call('POST', url, 'admin', { decision: 'approve', ...dates, verified_year: y - 13, verified_source: 'compliance_plate', rego_checked: true });
  assert.equal(old.error, 'vehicle_too_old');
  assert.equal((await call('POST', url, 'admin', { decision: 'approve', ...dates, verified_year: y - 9 })).error, 'rego_check_required');
  assert.equal((await call('POST', url, 'admin', { decision: 'approve', ...dates, verified_year: y - 9, rego_checked: true, ppsr_clear: false })).error, 'ppsr_not_clear');
  const ok = await call('POST', url, 'admin', { decision: 'approve', ...dates, verified_year: y - 9, verified_source: 'compliance_plate', rego_checked: true, ppsr_clear: true });
  assert.equal(ok.vehicle.status, 'approved', JSON.stringify(ok));
  assert.equal(ok.vehicle.verified_year, y - 9);
  assert.equal(ok.vehicle.verified_source, 'compliance_plate');
  assert.ok(ok.vehicle.rego_checked_at && ok.vehicle.ppsr_checked_at);
  assert.equal(ok.vehicle.ppsr_clear, true);
  assert.equal(ok.vehicle.state_rules.min_year, y - 12);
  const list = await call('GET', '/admin/vehicles?status=pending', 'admin');
  const camry = list.items.find((v: any) => v.rego === 'CB47JP');
  assert.equal(camry.vin_year, 2019);
  assert.equal(camry.checks.vin_year_mismatch, false);
  assert.ok(camry.documents.some((d: any) => d.type === 'compliance_plate'));
  assert.match(camry.state_rules.rego_check_url, /nt\.gov\.au/);
  assert.equal(list.ppsr_url, 'https://www.ppsr.gov.au/carcheck');

  const lk = await call('POST', `/admin/vehicles/${ntOldCarId}/lookup`, 'admin');
  assert.equal(lk.status, 501);
  assert.equal(lk.error, 'lookup_not_configured');
  assert.equal((await call('GET', '/admin/integrations', 'admin')).plate_lookup, 'not_configured');
});

test('levy by pickup state: $0 in an SA town (SA active), $1 NT', async () => {
  assert.equal((await call('PATCH', '/admin/jurisdictions/SA', 'admin', { active: true })).item.active, true);
  // Active state but zone still "coming soon" → not bookable
  const pa = { lat: -32.4925, lng: 137.7656 }; const pa2 = { lat: -32.5050, lng: 137.7800 };
  assert.equal((await call('POST', '/quotes', 'rider', { service: 'ride', pickup: pa, dropoff: pa2 })).error, 'outside_service_area');
  assert.equal((await call('PATCH', '/admin/zones/port-augusta', 'admin', { active: true })).item.active, true);
  try {
    const sa = await call('POST', '/quotes', 'rider', { service: 'ride', pickup: pa, dropoff: pa2 });
    assert.equal(sa.status, 200, JSON.stringify(sa));
    assert.equal(sa.zone.id, 'port-augusta');
    assert.equal(sa.quote.levy_cents, 0);
    assert.equal(sa.quote.lines.some((l: any) => /levy/i.test(l.label)), false);
    const nt = await call('POST', '/quotes', 'rider', { service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL });
    assert.equal(nt.quote.levy_cents, 100);
    assert.ok(nt.quote.lines.some((l: any) => l.label === 'NT passenger levy' && l.cents === 100));
    // SA levy is configurable (e.g. if a metro zone is ever added)
    await call('PATCH', '/admin/jurisdictions/SA', 'admin', { levy_cents: 200 });
    const sa2 = await call('POST', '/quotes', 'rider', { service: 'ride', pickup: pa, dropoff: pa2 });
    assert.ok(sa2.quote.lines.some((l: any) => l.label === 'SA passenger levy' && l.cents === 200));
    const est = await call('POST', '/public/estimate', undefined, { service: 'ride', pickup: pa, dropoff: pa2 });
    assert.equal(est.quote.levy_cents, 200);
  } finally {
    await call('PATCH', '/admin/jurisdictions/SA', 'admin', { levy_cents: 0, active: false });
    await call('PATCH', '/admin/zones/port-augusta', 'admin', { active: false });
  }
});

test('dispatch: an NT trip is not offered to an SA driver', async () => {
  await call('PATCH', '/admin/jurisdictions/SA', 'admin', { active: true });
  try {
    for (const w of ['d1', 'd2', 'd3', 'pd']) await call('POST', '/driver/online', w, { online: false });
    // SA driver parked right at the NT pickup (forced online: their car isn't SA-registered)
    await pool.query(`UPDATE drivers SET online = true, lat = $2, lng = $3, last_seen_at = now() WHERE user_id = $1`, [saDriverId, TODD_MALL.lat, TODD_MALL.lng]);
    const t = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card' });
    assert.equal(t.status, 201, JSON.stringify(t));
    await wait(500);
    assert.equal((await call('GET', '/driver/offers', 'sa')).offers.length, 0, 'SA driver not offered an NT trip');
    // Control: the same driver in NT does get it
    await pool.query(`UPDATE drivers SET state = 'NT' WHERE user_id = $1`, [saDriverId]);
    await call('POST', `/admin/trips/${t.trip.id}/redispatch`, 'admin');
    const offer = await waitForOffer('sa');
    assert.equal(offer.trip_id, t.trip.id);
    await call('POST', `/trips/${t.trip.id}/cancel`, 'rider', {});
  } finally {
    await pool.query(`UPDATE drivers SET state = 'SA', online = false WHERE user_id = $1`, [saDriverId]);
    await call('PATCH', '/admin/jurisdictions/SA', 'admin', { active: false });
  }
});

// ───────────── Round 1: money flows, idempotency, safety ─────────────
async function onlyD1Online() {
  for (const w of ['d2', 'd3', 'pd', 'sa']) if (tokens[w]) await call('POST', '/driver/online', w, { online: false });
  const r = await call('POST', '/driver/online', 'd1', { online: true, lat: TODD_MALL.lat, lng: TODD_MALL.lng, battery_pct: 90 });
  assert.equal(r.status, 200, JSON.stringify(r));
}
async function driveToArrived(tripId: string) {
  const offer = await waitForOffer('d1');
  assert.equal(offer.trip_id, tripId);
  assert.equal((await call('POST', `/driver/offers/${tripId}/accept`, 'd1')).trip.status, 'accepted');
  assert.equal((await call('POST', `/driver/trips/${tripId}/arrive`, 'd1')).trip.status, 'arrived');
}
const wallet = async () => (await one('SELECT wallet_cents FROM users WHERE phone = $1', ['+61400000100'])).wallet_cents as number;

test('voucher: wrong codes are counted, 6th try in an hour is blocked', async () => {
  await login('vtry', '0400 000 881');
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', '/wallet/voucher', 'vtry', { code: `NOPE${i}XYZ` })).error, 'voucher_invalid');
  const r = await call('POST', '/wallet/voucher', 'vtry', { code: 'DGDEMO5000' });
  assert.equal(r.status, 429, 'blocked even for a real code once the limit is hit');
});

test('refunds: running total capped at what was paid; fully refunded trip is marked refunded', async () => {
  const t = await one('SELECT final_cents, tip_cents FROM trips WHERE id = $1', [rideId]);
  const paid = t.final_cents + t.tip_cents;
  const r1 = await call('POST', `/admin/trips/${rideId}/refund`, 'admin', { cents: paid - 100, reason: 'Long wait' });
  assert.equal(r1.status, 200, JSON.stringify(r1));
  assert.equal(r1.refundable_cents, 100);
  const tooMuch = await call('POST', `/admin/trips/${rideId}/refund`, 'admin', { cents: 200, reason: 'Again' });
  assert.equal(tooMuch.error, 'refund_too_large');
  // Two clicks at once: only one can take the last $1.
  const both = await Promise.all([1, 2].map(() => call('POST', `/admin/trips/${rideId}/refund`, 'admin', { cents: 100, reason: 'Rest' })));
  assert.deepEqual(both.map((b) => b.status).sort(), [200, 400]);
  const sum = await one(`SELECT -sum(amount_cents)::int s FROM payments WHERE trip_id = $1 AND kind = 'refund'`, [rideId]);
  assert.equal(sum.s, paid);
  assert.equal((await one('SELECT payment_status FROM trips WHERE id = $1', [rideId])).payment_status, 'refunded');
  assert.equal((await call('POST', `/trips/${rideId}/refund`, 'rider', { cents: 1, reason: 'x' })).status, 404, 'riders cannot refund');
});

test('ratings: two at once count once', async () => {
  const before = await one('SELECT rating_count FROM users WHERE phone = $1', ['+61400000100']);
  const both = await Promise.all([5, 4].map((rating) => call('POST', `/trips/${rideId}/rate`, 'd1', { rating })));
  assert.deepEqual(both.map((b) => b.status).sort(), [200, 409]);
  const after = await one('SELECT rating_count FROM users WHERE phone = $1', ['+61400000100']);
  assert.equal(after.rating_count, before.rating_count + 1);
});

test('no drivers → admin searches again: payment, points and promo are taken again; wallet tip comes from credit', async () => {
  for (const w of ['d1', 'd2', 'd3', 'pd', 'sa']) if (tokens[w]) await call('POST', '/driver/online', w, { online: false });
  assert.equal((await call('POST', '/admin/promos', 'admin', { code: 'ROUND1', kind: 'fixed', value: 200, per_user_limit: 5, active: true })).status, 201);
  const uses = async () => (await one(`SELECT uses FROM promo_codes WHERE code = 'ROUND1'`)).uses;
  const w0 = await wallet();
  const t = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'wallet', promo_code: 'ROUND1' });
  assert.equal(t.status, 201, JSON.stringify(t));
  const id = t.trip.id; const fare = t.trip.quote_cents;
  assert.equal(await wallet(), w0 - fare);
  assert.equal(await uses(), 1);

  // Nobody free for the whole search window → no_drivers releases credit and the promo use.
  await pool.query(`UPDATE trips SET requested_at = now() - interval '10 minutes' WHERE id = $1`, [id]);
  const { dispatchTrip } = await import('../src/services/trips.js');
  assert.equal(await dispatchTrip(id), 'no_drivers');
  assert.equal(await wallet(), w0);
  assert.equal(await uses(), 0);

  // Search again: credit and promo taken again, search window restarts (it used to fail again straight away).
  await onlyD1Online();
  const again = await call('POST', `/admin/trips/${id}/redispatch`, 'admin');
  assert.equal(again.result, 'offered', JSON.stringify(again));
  assert.equal(await wallet(), w0 - fare);
  assert.equal(await uses(), 1);
  assert.equal((await call('POST', `/admin/trips/${rideId}/redispatch`, 'admin')).error, 'bad_state', 'completed trips cannot be re-dispatched');

  await driveToArrived(id);
  const pin = (await one('SELECT verify_pin FROM trips WHERE id = $1', [id])).verify_pin;
  await call('POST', `/driver/trips/${id}/start`, 'd1', { pin });
  const done = await call('POST', `/driver/trips/${id}/complete`, 'd1', {});
  assert.equal(done.trip.status, 'completed');
  assert.equal(await wallet(), w0 - fare, 'charged once');

  const tip = await call('POST', `/trips/${id}/tip`, 'rider', { cents: 300 });
  assert.equal(tip.ok, true, JSON.stringify(tip));
  assert.equal(await wallet(), w0 - fare - 300, 'tip on a credit-paid trip comes from credit');
  const p = await one(`SELECT provider FROM payments WHERE trip_id = $1 AND kind = 'tip'`, [id]);
  assert.equal(p.provider, 'wallet');
});

test('cancellation fees: driver gets 75%; cash courier no-show charges nothing; business account fee is invoiced', async () => {
  await onlyD1Online();
  // Card ride, late cancel after waiting → $3, driver credited 75%.
  const t1 = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card' });
  await driveToArrived(t1.trip.id);
  await pool.query(`UPDATE trips SET arrived_at = now() - interval '6 minutes' WHERE id = $1`, [t1.trip.id]);
  const c1 = await call('POST', `/trips/${t1.trip.id}/cancel`, 'rider', {});
  assert.equal(c1.trip.cancel_fee_cents, 300);
  const share = await one(`SELECT amount_cents FROM driver_ledger WHERE trip_id = $1 AND kind = 'cancel_fee'`, [t1.trip.id]);
  assert.equal(share.amount_cents, 225);

  // Cash courier: a fee DingoGo can't collect is not charged or credited.
  const parcel = { size: 'S', description: 'Keys', sender_name: 'Demo', sender_phone: '0400000100', recipient_name: 'Nan', recipient_phone: '0400000555', prohibited_ack: true };
  const t2 = await call('POST', '/trips', 'rider', { kind: 'courier', service: 'courier_s', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'cash', parcel });
  assert.equal(t2.status, 201, JSON.stringify(t2));
  await driveToArrived(t2.trip.id);
  await pool.query(`UPDATE trips SET arrived_at = now() - interval '6 minutes' WHERE id = $1`, [t2.trip.id]);
  const c2 = await call('POST', `/trips/${t2.trip.id}/cancel`, 'rider', {});
  assert.equal(c2.trip.cancel_fee_cents, 0);
  assert.equal(await one(`SELECT 1 FROM driver_ledger WHERE trip_id = $1`, [t2.trip.id]), null);

  // Business account: the fee goes on the monthly statement.
  const me = await call('GET', '/me', 'rider');
  const acct = me.corporate_accounts[0];
  assert.ok(acct, 'demo rider has a business account');
  const t3 = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'corporate', corporate_account_id: acct.id });
  assert.equal(t3.status, 201, JSON.stringify(t3));
  await driveToArrived(t3.trip.id);
  await pool.query(`UPDATE trips SET arrived_at = now() - interval '6 minutes' WHERE id = $1`, [t3.trip.id]);
  assert.equal((await call('POST', `/trips/${t3.trip.id}/cancel`, 'rider', {})).trip.cancel_fee_cents, 300);
  const inv = await one(`SELECT amount_cents, status FROM payments WHERE trip_id = $1 AND kind = 'invoice'`, [t3.trip.id]);
  assert.deepEqual(inv, { amount_cents: 300, status: 'pending' });
  const st = await call('GET', `/admin/corporate/${acct.id}/statement`, 'admin');
  assert.ok(st.lines.some((l: any) => l.ref === t3.trip.ref && l.cancellation_fee && l.final_cents === 300));
});

test('courier: delivery PIN locks after 5 wrong tries; signature still works', async () => {
  await onlyD1Online();
  const parcel = { size: 'S', description: 'Medicine', sender_name: 'Demo', sender_phone: '0400000100', recipient_name: 'Nan', recipient_phone: '0400000555', prohibited_ack: true };
  const t = await call('POST', '/trips', 'rider', { kind: 'courier', service: 'courier_s', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card', parcel });
  await driveToArrived(t.trip.id);
  await call('POST', `/driver/trips/${t.trip.id}/start`, 'd1');
  const pin = (await one('SELECT delivery_pin FROM parcels WHERE trip_id = $1', [t.trip.id])).delivery_pin;
  const wrong = pin === '0000' ? '1111' : '0000';
  for (let i = 0; i < 5; i++) assert.equal((await call('POST', `/driver/trips/${t.trip.id}/complete`, 'd1', { delivery_pin: wrong })).error, 'pin_mismatch');
  const locked = await call('POST', `/driver/trips/${t.trip.id}/complete`, 'd1', { delivery_pin: pin });
  assert.equal(locked.status, 429);
  assert.equal(locked.error, 'pin_locked');
  const ok = await call('POST', `/driver/trips/${t.trip.id}/complete`, 'd1', { pod_signature: 'data:image/png;base64,AAAA', pod_received_by: 'Nan' });
  assert.equal(ok.trip.status, 'completed');
});

test('payouts: two clicks pay once', async () => {
  const d1 = (await one('SELECT id FROM users WHERE phone = $1', ['+61400000011'])).id;
  const both = await Promise.all([1, 2].map(() => call('POST', `/admin/payouts/${d1}`, 'admin')));
  assert.deepEqual(both.map((b) => b.status).sort(), [200, 400]);
  const bal = await one(`SELECT sum(amount_cents)::int s FROM driver_ledger l JOIN users u ON u.id = l.driver_id WHERE u.phone = '+61400000011'`);
  assert.equal(bal.s, 0);
});

test('safety: drivers cannot switch on women-driver matching themselves', async () => {
  const r = await call('PATCH', '/driver/me', 'd1', { female_driver: true });
  assert.equal(r.status, 403);
  assert.equal((await call('PATCH', '/driver/me', 'd1', { female_driver: false, accepts_courier: true })).status, 200, 'sending the current value is fine');
  await call('POST', '/driver/online', 'd1', { online: false });
});

// ───────────── Round 2: privacy & security ─────────────
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const raw = (url: string, who?: string) => app.inject({ method: 'GET', url, headers: who ? { authorization: `Bearer ${tokens[who]}` } : {} });

test('uploads: driver documents are private — signed links only, owner/staff with a token, kinds by role, real file types', async () => {
  // Who may upload what
  assert.equal((await call('POST', '/uploads', 'rider', { data_url: PNG, purpose: 'document' })).status, 403);
  assert.equal((await call('POST', '/uploads', 'rider', { data_url: PNG, purpose: 'ad' })).status, 403);
  const fake = 'data:image/png;base64,' + Buffer.from('<html><script>alert(1)</script></html>').toString('base64');
  assert.equal((await call('POST', '/uploads', 'd2', { data_url: fake, purpose: 'document' })).error, 'bad_file');

  const up = await call('POST', '/uploads', 'd2', { data_url: PNG, purpose: 'document' });
  assert.equal(up.status, 200, JSON.stringify(up));
  assert.match(up.url, /^\/uploads\/document-[^?]+$/);
  assert.match(up.view_url, /\?exp=\d+&sig=/);
  const name = up.url.slice('/uploads/'.length);

  // Plain link: no token → 401; another driver → 404; owner and admin → 200
  assert.equal((await raw(up.url)).statusCode, 401);
  assert.equal((await raw(up.url, 'd3')).statusCode, 404);
  assert.equal((await raw(up.url, 'd2')).statusCode, 200);
  assert.equal((await raw(up.url, 'admin')).statusCode, 200);
  // Signed link works without a token; tampered or expired ones don't
  const ok = await raw(up.view_url);
  assert.equal(ok.statusCode, 200);
  assert.equal(ok.headers['content-type'], 'image/png');
  assert.equal(ok.headers['x-content-type-options'], 'nosniff');
  assert.match(String(ok.headers['content-security-policy']), /sandbox/);
  assert.equal((await raw(up.view_url.replace(/sig=./, 'sig=x'))).statusCode, 403);
  const old = signedUploadPath(name, Date.now() - 3 * 3600_000);
  const expired = await raw(old);
  assert.equal(expired.statusCode, 403);
  assert.equal(JSON.parse(expired.body).error, 'link_expired');
  assert.equal(checkSignature(name, '123', 'short'), 'bad');

  // Fresh link: owner yes, other driver no
  assert.match((await call('GET', `/uploads/${name}/link`, 'd2')).url, /sig=/);
  assert.equal((await call('GET', `/uploads/${name}/link`, 'd3')).status, 404);

  // Document file must be your own upload; stored plain, returned signed
  assert.equal((await call('POST', '/driver/documents', 'd2', { type: 'medical', file_url: 'https://evil.example/x.png' })).error, 'invalid_file');
  assert.equal((await call('POST', '/driver/documents', 'd3', { type: 'medical', file_url: up.url })).error, 'invalid_file');
  const doc = await call('POST', '/driver/documents', 'd2', { type: 'medical', file_url: up.view_url });
  assert.equal(doc.status, 200, JSON.stringify(doc));
  assert.match(doc.document.file_url, /^\/uploads\/document-.+\?exp=\d+&sig=/);
  assert.equal((await one('SELECT file_url FROM driver_documents WHERE id = $1', [doc.document.id])).file_url, up.url, 'database keeps the plain reference');
  const d2 = (await one('SELECT id FROM users WHERE phone = $1', ['+61400000012'])).id;
  const adminView = await call('GET', `/admin/drivers/${d2}`, 'admin');
  const listed = adminView.documents.find((x: any) => x.id === doc.document.id);
  assert.equal((await raw(listed.file_url)).statusCode, 200, 'admin "View file" link opens');
  // Ad images stay public
  const ad = await call('POST', '/uploads', 'admin', { data_url: PNG, purpose: 'ad' });
  assert.equal(ad.view_url, ad.url);
  assert.equal((await raw(ad.url)).statusCode, 200);
});

test('uploads: limit per account per hour', async () => {
  await login('uploader', '0400 000 882', 'driver');
  const uid = (await one('SELECT id FROM users WHERE phone = $1', ['+61400000882'])).id;
  await q(`INSERT INTO rate_events (bucket, key) SELECT 'upload_user', $1 FROM generate_series(1, 30)`, [uid]);
  const r = await call('POST', '/uploads', 'uploader', { data_url: PNG, purpose: 'pod' });
  assert.equal(r.status, 429);
  assert.equal(r.error, 'rate_limited');
});

test('courier POD photo: must be the driver’s own photo; rider sees it through a signed link', async () => {
  await onlyD1Online();
  const parcel = { size: 'S', description: 'Books', sender_name: 'Demo', sender_phone: '0400000100', recipient_name: 'Nan', recipient_phone: '0400000555', leave_unattended: true, prohibited_ack: true };
  const t = await call('POST', '/trips', 'rider', { kind: 'courier', service: 'courier_s', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card', parcel });
  await driveToArrived(t.trip.id);
  await call('POST', `/driver/trips/${t.trip.id}/start`, 'd1');
  const someoneElses = await call('POST', '/uploads', 'd2', { data_url: PNG, purpose: 'pod' });
  assert.equal((await call('POST', `/driver/trips/${t.trip.id}/complete`, 'd1', { pod_photo_url: someoneElses.url })).error, 'invalid_file');
  assert.equal((await call('POST', `/driver/trips/${t.trip.id}/complete`, 'd1', { pod_photo_url: 'https://evil.example/p.jpg' })).error, 'invalid_file');
  const mine = await call('POST', '/uploads', 'd1', { data_url: PNG, purpose: 'pod' });
  const done = await call('POST', `/driver/trips/${t.trip.id}/complete`, 'd1', { pod_photo_url: mine.url });
  assert.equal(done.trip.status, 'completed', JSON.stringify(done));
  const seen = await call('GET', `/trips/${t.trip.id}`, 'rider');
  assert.match(seen.trip.parcel.pod_photo_url, /sig=/);
  assert.equal((await raw(seen.trip.parcel.pod_photo_url)).statusCode, 200);
  const name = mine.url.slice('/uploads/'.length);
  assert.match((await call('GET', `/uploads/${name}/link`, 'rider')).url, /sig=/, 'sender can get a fresh link');
  assert.equal((await call('GET', `/uploads/${name}/link`, 'd3')).status, 404);
  await call('POST', '/driver/online', 'd1', { online: false });
});

test('OTP: per-IP request limit; parallel wrong guesses stop at 5; a code works once; per-IP wrong-code limit', async () => {
  const ip = '10.77.0.1';
  for (let i = 0; i < 30; i++) assert.equal((await call('POST', '/auth/otp/request', undefined, { phone: `+614009${String(i).padStart(5, '0')}` }, ip)).status, 200);
  const over = await call('POST', '/auth/otp/request', undefined, { phone: '+61400999999' }, ip);
  assert.equal(over.status, 429);
  assert.equal(over.error, 'rate_limited');

  const ip2 = '10.77.0.2';
  const phone = '+61400777001';
  const code = (await call('POST', '/auth/otp/request', undefined, { phone }, ip2)).dev_code as string;
  const wrong = (n: number) => { let c = String((Number(code) + n) % 1_000_000).padStart(6, '0'); if (c === '000000') c = '999999'; return c; };
  const guesses = await Promise.all([1, 2, 3, 4, 5, 6, 7, 8].map((n) => call('POST', '/auth/otp/verify', undefined, { phone, code: wrong(n) }, ip2)));
  assert.equal(guesses.filter((g) => g.error === 'otp_invalid').length, 5, JSON.stringify(guesses.map((g) => g.error)));
  assert.equal(guesses.filter((g) => g.error === 'otp_locked').length, 3);
  assert.equal((await call('POST', '/auth/otp/verify', undefined, { phone, code }, ip2)).error, 'otp_locked', 'even the right code is locked out');

  // Single use under concurrency
  const ip3 = '10.77.0.3';
  const phone2 = '+61400777002';
  const code2 = (await call('POST', '/auth/otp/request', undefined, { phone: phone2 }, ip3)).dev_code;
  const both = await Promise.all([1, 2].map(() => call('POST', '/auth/otp/verify', undefined, { phone: phone2, code: code2 }, ip3)));
  assert.deepEqual(both.map((b) => b.status).sort(), [200, 400]);

  // 30 wrong codes from one connection (any numbers) → blocked for an hour
  const ip4 = '10.77.0.4';
  await q(`INSERT INTO rate_events (bucket, key) SELECT 'otp_verify_fail_ip', $1 FROM generate_series(1, 30)`, [ip4]);
  const phone3 = '+61400777003';
  const code3 = (await call('POST', '/auth/otp/request', undefined, { phone: phone3 }, ip4)).dev_code;
  const blocked = await call('POST', '/auth/otp/verify', undefined, { phone: phone3, code: code3 }, ip4);
  assert.equal(blocked.status, 429);
  assert.equal(blocked.error, 'too_many_attempts');
  assert.equal((await call('POST', '/auth/otp/verify', undefined, { phone: phone3, code: code3 }, '10.77.0.5')).status, 200, 'other connections unaffected');
});

test('public forms: 10 per hour per connection', async () => {
  const ip = '10.78.0.1';
  const body = { kind: 'general', name: 'Test Person', email: 'test@example.com', message: 'Hello from a test' };
  for (let i = 0; i < 10; i++) assert.equal((await call('POST', '/public/enquiries', undefined, body, ip)).status, 201);
  const r = await call('POST', '/public/hire-requests', undefined, { kind: 'event', contact_name: 'Test Person', contact_email: 'test@example.com' }, ip);
  assert.equal(r.status, 429);
  assert.equal((await call('POST', '/public/enquiries', undefined, body, '10.78.0.2')).status, 201);
});

test('share links stop working a day after the trip ends', async () => {
  const t = await one('SELECT share_token, completed_at FROM trips WHERE id = $1', [rideId]);
  assert.equal((await call('GET', `/public/track/${t.share_token}`)).status, 200);
  await q(`UPDATE trips SET completed_at = now() - interval '25 hours' WHERE id = $1`, [rideId]);
  try {
    const r = await call('GET', `/public/track/${t.share_token}`);
    assert.equal(r.status, 410);
    assert.equal(r.error, 'link_expired');
    const ws = await app.injectWS(`/ws?share=${t.share_token}`);
    const code = await new Promise<number>((res) => ws.on('close', (c: number) => res(c)));
    assert.equal(code, 4010);
  } finally {
    await q('UPDATE trips SET completed_at = $2 WHERE id = $1', [rideId, t.completed_at]);
  }
});

test('realtime: role comes from the database; blocking a user drops their socket and stops reconnects', async () => {
  await app.ready();
  const created = await call('POST', '/admin/users', 'admin', { phone: '0400 000 883', name: 'Socket Test', role: 'rider' });
  assert.equal(created.status, 201, JSON.stringify(created));
  await login('sock', '0400 000 883');
  const hello = (ws: any) => new Promise<any>((res) => ws.once('message', (m: Buffer) => res(JSON.parse(String(m)))));

  // A token claiming "admin" for a rider account doesn't get the ops channel
  const forged = signToken({ id: created.user.id, role: 'admin' });
  const ws1 = await app.injectWS(`/ws?token=${forged}`);
  assert.deepEqual((await hello(ws1)).data.channels, [`user:${created.user.id}`]);
  ws1.terminate();

  const ws = await app.injectWS(`/ws?token=${tokens.sock}`);
  await hello(ws);
  const closed = new Promise<number>((res) => ws.on('close', (c: number) => res(c)));
  assert.equal((await call('PATCH', `/admin/users/${created.user.id}`, 'admin', { blocked: true })).status, 200);
  assert.equal(await closed, 4003);
  const again = await app.injectWS(`/ws?token=${tokens.sock}`);
  assert.equal(await new Promise<number>((res) => again.on('close', (c: number) => res(c))), 4001);
  assert.equal((await call('GET', '/me', 'sock')).status, 401);
  await call('PATCH', `/admin/users/${created.user.id}`, 'admin', { blocked: false });
});

test('partner: two redeems at once settle once; wrong codes are limited', async () => {
  const l = await call('GET', '/loyalty', 'rider');
  const coffee = l.rewards.find((r: any) => r.partner_name?.startsWith('Spinifex') && r.title.includes('coffee'));
  await q('UPDATE users SET loyalty_points = loyalty_points + $2 WHERE phone = $1', ['+61400000100', coffee.points_cost]);
  const red = await call('POST', `/loyalty/rewards/${coffee.id}/redeem`, 'rider');
  const both = await Promise.all([1, 2].map(() => call('POST', '/partner/redeem', 'cafe', { code: red.redemption.code })));
  assert.deepEqual(both.map((b) => b.status).sort(), [200, 400]);

  const cafe = (await one('SELECT id FROM users WHERE phone = $1', ['+61400000300'])).id;
  await q(`INSERT INTO rate_events (bucket, key) SELECT 'partner_code_fail', $1 FROM generate_series(1, 19)`, [cafe]);
  assert.equal((await call('POST', '/partner/check', 'cafe', { code: 'DGNOTREAL1' })).status, 404);
  const r = await call('POST', '/partner/vouchers/sell', 'cafe', { code: 'DGNOTREAL2' });
  assert.equal(r.status, 429);
  assert.equal(r.error, 'too_many_attempts');
  await q(`DELETE FROM rate_events WHERE bucket = 'partner_code_fail' AND key = $1`, [cafe]);
});

test('authorisation: declining a trip you were never offered does nothing; blocked drivers get no offers', async () => {
  const before = await one(`SELECT count(*)::int n FROM trip_events WHERE trip_id = $1`, [rideId]);
  assert.equal((await call('POST', `/driver/offers/${rideId}/decline`, 'd2')).status, 200);
  assert.equal((await one(`SELECT count(*)::int n FROM trip_events WHERE trip_id = $1`, [rideId])).n, before.n);

  await onlyD1Online();
  const d1 = (await one('SELECT id FROM users WHERE phone = $1', ['+61400000011'])).id;
  await call('PATCH', `/admin/users/${d1}`, 'admin', { blocked: true });
  assert.equal((await one('SELECT online FROM drivers WHERE user_id = $1', [d1])).online, false, 'blocking takes the driver offline');
  await q('UPDATE users SET blocked = false WHERE id = $1', [d1]);
  await call('POST', '/driver/online', 'd1', { online: true, lat: TODD_MALL.lat, lng: TODD_MALL.lng, battery_pct: 90 });
  await q('UPDATE users SET blocked = true WHERE id = $1', [d1]);            // blocked while still marked online
  const t = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card' });
  assert.equal(t.status, 201, JSON.stringify(t));
  await wait(300);
  assert.equal((await one(`SELECT count(*)::int n FROM trip_offers WHERE trip_id = $1`, [t.trip.id])).n, 0);
  await q('UPDATE users SET blocked = false WHERE id = $1', [d1]);
  await call('POST', `/trips/${t.trip.id}/cancel`, 'rider', {});
  await call('POST', '/driver/online', 'd1', { online: false });
});

test('security headers and input limits', async () => {
  const h = await call('GET', '/health');
  assert.equal(h.headers['x-content-type-options'], 'nosniff');
  assert.equal(h.headers['x-frame-options'], 'DENY');
  assert.equal(h.headers['referrer-policy'], 'no-referrer');
  assert.match(String(h.headers['content-security-policy']), /default-src 'none'/);
  assert.equal((await call('GET', '/me', 'rider')).headers['cache-control'], 'no-store');
  assert.equal((await call('POST', '/me/push-token', 'rider', { token: 'x'.repeat(5000), platform: 'web' })).error, 'validation_error');
  assert.equal((await call('PATCH', '/me', 'rider', { accessibility: { note: 'x'.repeat(3000) } })).error, 'validation_error');
});

// ───────────── Round 3: trip lifecycle & dispatch reliability ─────────────
const NEAR = { d1: TODD_MALL, d3: { lat: -23.7000, lng: 133.8840 }, d2: { lat: -23.7040, lng: 133.8790 } } as Record<string, { lat: number; lng: number }>;
/** Close out trips other tests left open, so the dispatcher only sees ours. */
async function clearOpenTrips() {
  await q(`UPDATE trips SET status = 'cancelled_admin', cancelled_at = now() WHERE status IN ('scheduled','requested','accepted','arrived','in_progress')`);
  await q(`UPDATE trip_offers SET status = 'expired' WHERE status = 'offered'`);
}
async function onlyOnline(who: string[]) {
  for (const w of ['d1', 'd2', 'd3', 'pd', 'sa']) if (tokens[w] && !who.includes(w)) await call('POST', '/driver/online', w, { online: false });
  for (const w of who) {
    const r = await call('POST', '/driver/online', w, { online: true, ...NEAR[w], battery_pct: 90 });
    assert.equal(r.status, 200, `${w} online: ${JSON.stringify(r)}`);
  }
}
async function offeredTo(tripId: string, who: string[]) {
  for (let i = 0; i < 30; i++) {
    for (const w of who) if ((await call('GET', '/driver/offers', w)).offers?.some((o: any) => o.trip_id === tripId)) return w;
    await wait(100);
  }
  throw new Error('no offer for ' + tripId);
}
const driverId = async (phone: string) => (await one('SELECT id FROM users WHERE phone = $1', [phone])).id as string;
const book = async () => {
  const t = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card' });
  assert.equal(t.status, 201, JSON.stringify(t));
  return t.trip;
};

test('driver cancels after accepting: next driver is offered the trip, rider keeps the booking; rider-side reasons end it; re-offer limit', async () => {
  await clearOpenTrips();
  await onlyOnline(['d1', 'd2', 'd3']);
  const trip = await book();
  const first = await offeredTo(trip.id, ['d1', 'd2', 'd3']);
  assert.equal((await call('POST', `/driver/offers/${trip.id}/accept`, first)).trip.status, 'accepted');

  const c1 = await call('POST', `/driver/trips/${trip.id}/cancel`, first, { reason: 'vehicle_issue', note: 'flat tyre' });
  assert.equal(c1.status, 200, JSON.stringify(c1));
  assert.equal(c1.trip.released, true);
  assert.equal(c1.trip.status, 'requested');
  assert.equal(c1.trip.pickup_address, undefined, 'released driver no longer gets the trip details');
  const row = await one('SELECT status, driver_id, payment_status FROM trips WHERE id = $1', [trip.id]);
  assert.deepEqual([row.status, row.driver_id, row.payment_status], ['requested', null, 'authorised'], 'card hold kept');
  assert.equal((await call('GET', `/trips/${trip.id}`, first)).status, 404, 'released driver cannot view the trip');
  const rv = await call('GET', `/trips/${trip.id}`, 'rider');
  assert.equal(rv.trip.driver_releases, 1);
  assert.ok((await one(`SELECT 1 FROM notifications n JOIN users u ON u.id = n.user_id WHERE u.phone = '+61400000100' AND n.title = 'Finding you another driver' AND n.data->>'trip_id' = $1`, [trip.id])));

  // Second driver (never the one who cancelled) accepts, then pulls out too.
  const second = await offeredTo(trip.id, ['d1', 'd2', 'd3'].filter((w) => w !== first));
  assert.equal((await call('POST', `/driver/offers/${trip.id}/accept`, second)).trip.status, 'accepted');
  assert.equal((await call('POST', `/driver/trips/${trip.id}/cancel`, second, { reason: 'other' })).trip.released, true);
  const third = await offeredTo(trip.id, ['d1', 'd2', 'd3'].filter((w) => w !== first && w !== second));
  assert.equal((await call('POST', `/driver/offers/${trip.id}/accept`, third)).trip.status, 'accepted');
  // Re-offer limit (2) reached: this time the trip ends, rider not charged.
  const c3 = await call('POST', `/driver/trips/${trip.id}/cancel`, third, { reason: 'vehicle_issue' });
  assert.equal(c3.trip.status, 'cancelled_driver');
  const end = await one('SELECT status, payment_status, cancel_fee_cents FROM trips WHERE id = $1', [trip.id]);
  assert.deepEqual([end.status, end.payment_status, end.cancel_fee_cents], ['cancelled_driver', 'none', 0]);
  assert.equal((await one(`SELECT count(*)::int n FROM trip_offers WHERE trip_id = $1 AND status = 'cancelled'`, [trip.id])).n, 3);

  // Rider-side reason: the trip ends straight away (no re-offer).
  const t2 = await book();
  const w = await offeredTo(t2.id, ['d1', 'd2', 'd3']);
  await call('POST', `/driver/offers/${t2.id}/accept`, w);
  await call('POST', `/driver/trips/${t2.id}/arrive`, w);
  const nb = await call('POST', `/driver/trips/${t2.id}/cancel`, w, { reason: 'rider_no_show' });
  assert.equal(nb.trip.status, 'cancelled_driver');
  assert.equal(nb.trip.released, undefined);
  assert.equal((await one(`SELECT status FROM trip_offers WHERE trip_id = $1 AND status <> 'expired' AND status <> 'declined'`, [t2.id])).status, 'accepted', 'no-show is not counted against the driver');
});

test('repeat cancellers: 3 driver cancellations in 7 days raise one compliance flag; driver sees the count', async () => {
  await clearOpenTrips();
  await onlyOnline(['d1']);
  const d1 = await driverId('+61400000011');
  await q(`DELETE FROM compliance_flags WHERE driver_id = $1 AND kind = 'repeat_cancellation'`, [d1]);
  await q(`UPDATE trip_offers SET status = 'accepted' WHERE driver_id = $1 AND status = 'cancelled'`, [d1]);
  // Two earlier cancellations this week.
  await q(`UPDATE trip_offers SET status = 'cancelled', offered_at = now() - interval '1 day'
           WHERE (trip_id, driver_id) IN (SELECT trip_id, driver_id FROM trip_offers WHERE driver_id = $1 AND status = 'accepted' LIMIT 2)`, [d1]);
  for (let i = 0; i < 2; i++) {
    const t = await book();
    await offeredTo(t.id, ['d1']);
    await call('POST', `/driver/offers/${t.id}/accept`, 'd1');
    assert.equal((await call('POST', `/driver/trips/${t.id}/cancel`, 'd1', { reason: 'vehicle_issue' })).trip.released, true);
    await call('POST', `/trips/${t.id}/cancel`, 'rider', {});
  }
  const flags = await q(`SELECT * FROM compliance_flags WHERE driver_id = $1 AND kind = 'repeat_cancellation'`, [d1]);
  assert.equal(flags.length, 1, 'one open flag at a time');
  assert.match(flags[0].detail, /cancelled after accepting/);
  const me = await call('GET', '/driver/me', 'd1');
  assert.equal(me.acceptance.cancelled_7d, 4);
  assert.equal(me.acceptance.cancel_review_at, config.dispatch.driverCancelFlagCount);
});

test('offer races: last-second accept within the grace counts; late, offline or busy accepts are refused; accept vs cancel never errors', async () => {
  await clearOpenTrips();
  await onlyOnline(['d1']);
  const t1 = await book();
  await offeredTo(t1.id, ['d1']);
  await q(`UPDATE trip_offers SET expires_at = now() - interval '1 second' WHERE trip_id = $1`, [t1.id]);
  assert.equal((await call('GET', '/driver/offers', 'd1')).offers.length, 0, 'not shown once it has run out');
  assert.equal((await call('POST', `/driver/offers/${t1.id}/accept`, 'd1')).trip?.status, 'accepted', 'tap inside the grace');
  // Busy driver can't take a second trip even if an offer slipped through.
  await login('rider2', '0400 000 891');
  const other = await call('POST', '/trips', 'rider2', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: AIRPORT, payment_method: 'card' });
  const d1 = await driverId('+61400000011');
  await q(`INSERT INTO trip_offers (trip_id, driver_id, expires_at) VALUES ($1, $2, now() + interval '20 seconds') ON CONFLICT DO NOTHING`, [other.trip.id, d1]);
  assert.equal((await call('POST', `/driver/offers/${other.trip.id}/accept`, 'd1')).error, 'on_trip');
  await call('POST', `/trips/${other.trip.id}/cancel`, 'rider2', {});
  await call('POST', `/trips/${t1.id}/cancel`, 'rider', {});

  const t2 = await book();
  await offeredTo(t2.id, ['d1']);
  await q(`UPDATE trip_offers SET expires_at = now() - interval '10 seconds' WHERE trip_id = $1`, [t2.id]);
  assert.equal((await call('POST', `/driver/offers/${t2.id}/accept`, 'd1')).error, 'offer_expired');
  await call('POST', `/trips/${t2.id}/cancel`, 'rider', {});

  // Rider cancels at the same moment the driver accepts: one wins cleanly, no server error.
  for (let i = 0; i < 3; i++) {
    const t = await book();
    await offeredTo(t.id, ['d1']);
    const [a, c] = await Promise.all([call('POST', `/driver/offers/${t.id}/accept`, 'd1'), call('POST', `/trips/${t.id}/cancel`, 'rider', {})]);
    assert.ok([200, 409].includes(a.status), `accept ${a.status} ${a.error}`);
    assert.equal(c.status, 200, JSON.stringify(c));
    assert.equal((await one('SELECT status FROM trips WHERE id = $1', [t.id])).status, 'cancelled_rider');
  }
});

test('driver goes offline with an offer on screen: the next driver is offered straight away', async () => {
  await clearOpenTrips();
  await onlyOnline(['d1', 'd3']);
  const t = await book();
  const first = await offeredTo(t.id, ['d1', 'd3']);
  const next = first === 'd1' ? 'd3' : 'd1';
  await call('POST', '/driver/online', first, { online: false });
  // No timeout wait and no tick: the withdraw re-dispatches at once.
  assert.ok((await call('GET', '/driver/offers', next)).offers.some((o: any) => o.trip_id === t.id));
  assert.equal((await call('POST', `/driver/offers/${t.id}/accept`, first)).error, 'offer_expired');
  assert.ok(await one(`SELECT 1 FROM trip_events WHERE trip_id = $1 AND type = 'offer_withdrawn'`, [t.id]));
  await call('POST', `/trips/${t.id}/cancel`, 'rider', {});
});

test('silent driver: ops alerted once; ops give the trip to another driver (not counted against them); stale online drivers set offline', async () => {
  await clearOpenTrips();
  await onlyOnline(['d1', 'd3']);
  const d1 = await driverId('+61400000011');
  const t = await book();
  const first = await offeredTo(t.id, ['d1', 'd3']);
  const firstId = first === 'd1' ? d1 : await driverId('+61400000013');
  await call('POST', `/driver/offers/${t.id}/accept`, first);
  await q(`UPDATE drivers SET last_seen_at = now() - interval '6 minutes' WHERE user_id = $1`, [firstId]);
  await q(`UPDATE trips SET accepted_at = now() - interval '6 minutes' WHERE id = $1`, [t.id]);
  await dispatchTick();
  await dispatchTick();
  assert.equal((await one(`SELECT count(*)::int n FROM trip_events WHERE trip_id = $1 AND type = 'driver_silent'`, [t.id])).n, 1, 'alerted once per silence');
  const live = await call('GET', '/admin/live', 'admin');
  const lt = live.trips.find((x: any) => x.id === t.id);
  assert.ok(lt.driver_last_seen_at, 'live map shows last signal');

  const before = (await one(`SELECT count(*)::int n FROM trip_offers WHERE driver_id = $1 AND status = 'cancelled'`, [firstId])).n;
  const r = await call('POST', `/admin/trips/${t.id}/reassign`, 'admin', { reason: 'No answer on the phone' });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.trip.driver_id, null);
  assert.equal((await one(`SELECT status FROM trip_offers WHERE trip_id = $1 AND driver_id = $2`, [t.id, firstId])).status, 'released');
  assert.equal((await one(`SELECT count(*)::int n FROM trip_offers WHERE driver_id = $1 AND status = 'cancelled'`, [firstId])).n, before, 'not counted against the driver');
  assert.ok(await one(`SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'Trip given to another driver'`, [firstId]));
  const next = first === 'd1' ? 'd3' : 'd1';
  assert.ok((await call('GET', '/driver/offers', next)).offers.some((o: any) => o.trip_id === t.id), 'offered to the next driver');
  assert.equal((await call('POST', `/admin/trips/${t.id}/reassign`, 'admin', {})).error, 'bad_state', 'only accepted/arrived trips');
  await call('POST', `/trips/${t.id}/cancel`, 'rider', {});

  // Online but no signal for 30+ min and no trip: set offline; the app learns it from its next location ping.
  await q(`UPDATE drivers SET last_seen_at = now() - interval '31 minutes' WHERE user_id = $1`, [d1]);
  await dispatchTick();
  assert.equal((await one('SELECT online FROM drivers WHERE user_id = $1', [d1])).online, false);
  assert.equal((await call('POST', '/driver/location', 'd1', TODD_MALL)).online, false);
  await call('POST', '/driver/online', 'd3', { online: false });
});

test('booked trips: search runs until the booked time; a booking released far too late is not sent to drivers', async () => {
  const now = Date.now();
  const min = 60000;
  assert.equal(searchOver({ requested_at: new Date(now - 6 * min), scheduled_for: null, dispatch_attempts: 0 }, now), true);
  assert.equal(searchOver({ requested_at: new Date(now - 6 * min), scheduled_for: new Date(now + 5 * min), dispatch_attempts: 0 }, now), false, 'keeps looking until pickup time');
  assert.equal(searchOver({ requested_at: new Date(now - 20 * min), scheduled_for: new Date(now - 6 * min), dispatch_attempts: 0 }, now), true);
  assert.equal(searchOver({ requested_at: new Date(now), scheduled_for: new Date(now + 5 * min), dispatch_attempts: config.dispatch.maxAttempts }, now), false, 'more offers for bookings');
  assert.equal(searchOver({ requested_at: new Date(now), scheduled_for: new Date(now + 5 * min), dispatch_attempts: config.dispatch.maxAttempts * 2 }, now), true);

  await clearOpenTrips();
  await onlyOnline([]);
  const at = new Date(Date.now() + 25 * min).toISOString();
  const b = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card', scheduled_for: at });
  assert.equal(b.status, 201, JSON.stringify(b));
  assert.equal(b.trip.status, 'scheduled');
  // Released early, nobody free: still searching 6 minutes in because the pickup time hasn't come.
  await q(`UPDATE trips SET status = 'requested', requested_at = now() - interval '6 minutes', scheduled_for = now() + interval '5 minutes' WHERE id = $1`, [b.trip.id]);
  await dispatchTick();
  assert.equal((await one('SELECT status FROM trips WHERE id = $1', [b.trip.id])).status, 'requested');
  await call('POST', `/trips/${b.trip.id}/cancel`, 'rider', {});

  const m = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card', scheduled_for: at });
  await q(`UPDATE trips SET scheduled_for = now() - interval '40 minutes' WHERE id = $1`, [m.trip.id]);
  await dispatchTick();
  const row = await one('SELECT status, payment_status FROM trips WHERE id = $1', [m.trip.id]);
  assert.deepEqual([row.status, row.payment_status], ['no_drivers', 'none'], 'missed booking ended, hold released');
});

test('background work (notifications, SMS) is tracked and can be awaited before responding', async () => {
  let done = false;
  void bg(new Promise((r) => setTimeout(r, 50)).then(() => { done = true; }));
  setImmediate(() => void bg(Promise.resolve()));   // registered after the commit, on the next turn
  assert.ok(pendingBackground() >= 1);
  await flushBackground(2000);
  assert.equal(done, true);
  assert.equal(pendingBackground(), 0);
  void bg(Promise.reject(new Error('push failed')));  // logged, never thrown
  const t0 = Date.now();
  void bg(new Promise((r) => setTimeout(r, 5000)));
  await flushBackground(100);
  assert.ok(Date.now() - t0 < 1000, 'bounded wait');
});

// ───────────────────────── Round 4: driver pay ─────────────────────────
import { DRIVER_PAY_DEFAULTS, mergeDriverPay, pickupPayCents, longPickupCents, serviceFeeFor, weekStartOf } from '../src/lib/driverPay.js';

test('driver pay rules: fee by car never above the driver’s own rate; pickup pay beyond the free km; week starts Monday (Darwin)', () => {
  const s = mergeDriverPay({ service_fee: { own_car_pct: 20, green_pct: 15 }, pickup: { enabled: true } });
  assert.deepEqual(serviceFeeFor(25, { fuel_type: 'electric', ownership: 'fleet' }, s), { pct: 15, basis: 'green' });
  assert.deepEqual(serviceFeeFor(25, { fuel_type: 'hybrid', ownership: 'driver_owned' }, s), { pct: 15, basis: 'green' });
  assert.deepEqual(serviceFeeFor(25, { fuel_type: 'petrol', ownership: 'driver_owned' }, s), { pct: 20, basis: 'own_car' });
  assert.deepEqual(serviceFeeFor(25, { fuel_type: 'petrol', ownership: 'fleet' }, s), { pct: 25, basis: 'driver' });
  assert.deepEqual(serviceFeeFor(10, { fuel_type: 'electric', ownership: 'fleet' }, s), { pct: 10, basis: 'driver' }, 'a lower personal rate is kept');
  assert.deepEqual(serviceFeeFor(25, { fuel_type: 'electric' }, DRIVER_PAY_DEFAULTS), { pct: 25, basis: 'driver' }, 'defaults change nothing');
  assert.equal(pickupPayCents(1500, s), 0, 'first 2 km unpaid');
  assert.equal(pickupPayCents(4500, s), 150, '2.5 km × 60c');
  assert.equal(pickupPayCents(40000, s), 600, 'capped at 10 km');
  assert.equal(pickupPayCents(9000, DRIVER_PAY_DEFAULTS), 0, 'off by default');
  assert.equal(longPickupCents(4520, s), 150, 'rider charge rounded to 5c');
  assert.equal(weekStartOf(new Date('2026-11-22T14:00:00Z')), '2026-11-16', 'Sunday 11:30pm Darwin is still that week');
  assert.equal(weekStartOf(new Date('2026-11-22T15:00:00Z')), '2026-11-23', 'Monday 12:30am Darwin starts the next week');
});

test('fare engine: long-pickup charge is discountable; fuel surcharge sits outside discounts; neither on tours', () => {
  const rule = { service: 'ride', label: 'Ride', base_cents: 300, per_km_cents: 160, per_min_cents: 25, booking_fee_cents: 100, min_fare_cents: 1000, night_pct: 0, holiday_pct: 0, levy_cents: 100 };
  const ctx = { distance_m: 5000, duration_s: 600, at: new Date('2026-11-02T02:00:00Z') };
  const base = quoteFare(rule, ctx);
  const q2 = quoteFare(rule, { ...ctx, longPickup: { km: 4.5, cents: 150 }, fuelSurchargeCents: 50 });
  assert.equal(q2.total_cents, base.total_cents + 200);
  assert.equal(q2.trip_cents, base.trip_cents, 'no service fee on either');
  assert.equal(q2.long_pickup_cents, 150);
  assert.equal(q2.fuel_surcharge_cents, 50);
  assert.ok(q2.lines.some((l) => l.label.startsWith('Long pickup')));
  const promo = quoteFare(rule, { ...ctx, longPickup: { km: 4.5, cents: 150 }, fuelSurchargeCents: 50, promo: { code: 'ALL', kind: 'percent', value: 100, max_discount_cents: null } });
  assert.equal(promo.total_cents, 50 + 100, '100% promo leaves only the fuel surcharge and levy');
  const tour = quoteFare(rule, { ...ctx, fixedPriceCents: 9900, longPickup: { km: 9, cents: 400 }, fuelSurchargeCents: 50 });
  assert.equal(tour.total_cents, 9900 + 100 + 100);
});

async function rideToEnd(tripId: string, who: string) {
  assert.equal((await call('POST', `/driver/offers/${tripId}/accept`, who)).trip.status, 'accepted');
  await call('POST', `/driver/trips/${tripId}/arrive`, who);
  const pin = (await one('SELECT verify_pin FROM trips WHERE id = $1', [tripId])).verify_pin;
  assert.equal((await call('POST', `/driver/trips/${tripId}/start`, who, { pin })).trip.status, 'in_progress');
  const done = await call('POST', `/driver/trips/${tripId}/complete`, who, {});
  assert.equal(done.trip.status, 'completed', JSON.stringify(done));
  return done.trip;
}
const ledgerFor = async (tripId: string) => Object.fromEntries((await q(`SELECT kind, sum(amount_cents)::int c FROM driver_ledger WHERE trip_id = $1 GROUP BY kind`, [tripId])).map((r) => [r.kind, r.c]));

test('driver pay defaults: offers (pushed and polled) show pay at 25% and the km to the pickup; nothing else changes', async () => {
  await clearOpenTrips();
  await q(`DELETE FROM settings WHERE key = 'driver_pay'`);
  await onlyD1Online();
  const t = await book();
  assert.ok(!t.fare_breakdown.lines.some((l: any) => /Long pickup|Fuel surcharge/.test(l.label)));
  const o = await waitForOffer('d1');
  assert.equal(o.driver_pay.fee_pct, 25);
  assert.equal(o.driver_pay.fare_cents, t.fare_breakdown.trip_cents, 'polled offers carry the trip fare (was dropped)');
  assert.equal(o.driver_pay.total_cents, t.fare_breakdown.trip_cents - Math.round(t.fare_breakdown.trip_cents * 0.25));
  assert.equal(o.driver_pay.pickup_pay_cents, 0);
  assert.equal(typeof o.pickup_m, 'number');
  assert.equal(o.total_m, o.pickup_m + t.est_distance_m);
  const done = await rideToEnd(t.id, 'd1');
  const l = await ledgerFor(done.id);
  assert.deepEqual(Object.keys(l).sort(), ['commission', 'fare']);
  assert.equal(l.commission, -Math.round(l.fare * 0.25));
  const mine = (await call('GET', '/driver/trips', 'd1')).trips.find((x: any) => x.id === done.id);
  assert.equal(mine.driver_pay_cents, l.fare + l.commission);
});

test('driver pay switched on: EV rate, long-pickup charge funds pickup pay, fuel surcharge to the driver; rate fixed at accept', async () => {
  await clearOpenTrips();
  assert.equal((await call('PUT', '/admin/driver-pay', 'admin', { pickup: { enabled: true, max_km: 999 } })).status, 400, 'bounds checked');
  assert.equal((await call('PUT', '/admin/driver-pay', 'admin', { surprise: 1 })).status, 400, 'unknown keys refused');
  await login('dispatcher', '+61400000002', 'admin');
  assert.equal((await call('PUT', '/admin/driver-pay', 'dispatcher', { service_fee: { green_pct: 1 } })).status, 403, 'admins only');
  const put = await call('PUT', '/admin/driver-pay', 'admin', {
    service_fee: { own_car_pct: 20, green_pct: 15 }, pickup: { enabled: true }, fuel_surcharge: { enabled: true, cents: 52 } });
  assert.equal(put.status, 200, JSON.stringify(put));
  assert.equal(put.settings.fuel_surcharge.cents, 50, 'rounded to 5c');
  assert.equal(put.settings.pickup.free_km, 2, 'defaults kept for fields not sent');
  assert.ok(await one(`SELECT 1 FROM audit_log WHERE action = 'driver_pay'`));

  // Only d1 online, about 3.5 km south of the pickup (≈ 4.6 km by road).
  for (const w of ['d2', 'd3', 'pd', 'sa']) if (tokens[w]) await call('POST', '/driver/online', w, { online: false });
  await call('POST', '/driver/online', 'd1', { online: true, lat: TODD_MALL.lat - 0.0316, lng: TODD_MALL.lng, battery_pct: 90 });
  const quote = await call('POST', '/quotes', 'rider', { service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL });
  const lp = quote.quote.lines.find((l: any) => l.label.startsWith('Long pickup'));
  assert.ok(lp && lp.cents > 0, JSON.stringify(quote.quote.lines));
  assert.ok(quote.quote.lines.some((l: any) => l.label.startsWith('Fuel surcharge') && l.cents === 50));
  const sched = await call('POST', '/quotes', 'rider', { service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, scheduled_for: new Date(Date.now() + 3600e3).toISOString() });
  assert.ok(!sched.quote.lines.some((l: any) => l.label.startsWith('Long pickup')), 'no long-pickup charge on bookings');

  const t = await book();
  assert.equal(t.fare_breakdown.fuel_surcharge_cents, 50);
  const o = await waitForOffer('d1');
  assert.equal(o.driver_pay.fee_pct, 15, 'demo cars are electric');
  assert.equal(o.driver_pay.fee_basis, 'green');
  assert.ok(o.pickup_m > 4000 && o.pickup_m < 5500, String(o.pickup_m));
  const expectPickup = Math.round((o.pickup_m / 1000 - 2) * 60);
  assert.equal(o.driver_pay.pickup_pay_cents, expectPickup);
  assert.equal(o.driver_pay.fuel_surcharge_cents, 50);
  assert.equal(o.driver_pay.total_cents, o.driver_pay.fare_cents - Math.round(o.driver_pay.fare_cents * 0.15) + expectPickup + 50);

  assert.equal((await call('POST', `/driver/offers/${t.id}/accept`, 'd1')).trip.status, 'accepted');
  // Owner changes the rate mid-trip: this trip keeps the rate the driver accepted.
  await call('PUT', '/admin/driver-pay', 'admin', { service_fee: { green_pct: 5 } });
  await call('POST', `/driver/trips/${t.id}/arrive`, 'd1');
  const pin = (await one('SELECT verify_pin FROM trips WHERE id = $1', [t.id])).verify_pin;
  await call('POST', `/driver/trips/${t.id}/start`, 'd1', { pin });
  assert.equal((await call('POST', `/driver/trips/${t.id}/complete`, 'd1', {})).trip.status, 'completed');
  const l = await ledgerFor(t.id);
  assert.equal(l.commission, -Math.round(l.fare * 0.15));
  assert.equal(l.pickup_pay, expectPickup);
  assert.equal(l.fuel_surcharge, 50);
  const note = await one(`SELECT note FROM driver_ledger WHERE trip_id = $1 AND kind = 'commission'`, [t.id]);
  assert.match(note.note, /15% \(electric\/hybrid rate\)/);
  const adminTrip = await call('GET', `/admin/trips/${t.id}`, 'admin');
  assert.ok(adminTrip.driver_ledger.some((x: any) => x.kind === 'pickup_pay'));

  // Late cancellation: the driver's share uses the rate fixed at accept (5% now).
  await call('POST', '/driver/online', 'd1', { online: true, lat: TODD_MALL.lat, lng: TODD_MALL.lng, battery_pct: 90 });
  const t2 = await book();
  await driveToArrived(t2.id);
  await pool.query(`UPDATE trips SET arrived_at = now() - interval '6 minutes' WHERE id = $1`, [t2.id]);
  assert.equal((await call('POST', `/trips/${t2.id}/cancel`, 'rider', {})).trip.cancel_fee_cents, 300);
  assert.equal((await ledgerFor(t2.id)).cancel_fee, 285);

  const e = await call('GET', '/driver/earnings?days=7', 'd1');
  assert.equal(e.pay_rules.fee_pct, 5);
  assert.equal(e.pay_rules.fee_basis, 'green');
  assert.equal(e.pay_rules.fuel_surcharge_cents, 50);
  assert.ok(e.summary.pickup_pay_cents >= expectPickup);
  assert.equal(e.summary.trip_pay_cents, e.summary.fares_cents + e.summary.service_fee_cents + e.summary.pickup_pay_cents + e.summary.fuel_surcharge_cents + e.summary.cancel_fees_cents);
  assert.ok(e.activity.pickup_km > 4 && e.activity.total_km > e.activity.trip_km);
  assert.ok(e.activity.engaged_s >= 0);
  await q(`DELETE FROM settings WHERE key = 'driver_pay'`);
});

test('earnings floor: weekly top-up per engaged hour, paid once; off by default; only finished weeks', async () => {
  await clearOpenTrips();
  await q(`DELETE FROM settings WHERE key = 'driver_pay'`);
  const lastWeek = weekStartOf(new Date(Date.now() - 7 * 864e5));
  assert.equal((await call('POST', '/admin/driver-pay/floor/run', 'admin', { week: lastWeek })).error, 'floor_off');

  // A short trip done last Wednesday that kept the driver busy for 40 minutes.
  await onlyD1Online();
  const t = await book();
  await waitForOffer('d1');
  const done = await rideToEnd(t.id, 'd1');
  const at = new Date(new Date(lastWeek + 'T12:00:00+09:30').getTime() + 2 * 864e5);
  await q(`UPDATE trips SET accepted_at = $2, completed_at = $2::timestamptz + interval '40 minutes' WHERE id = $1`, [done.id, at]);
  await q(`UPDATE driver_ledger SET created_at = $2::timestamptz + interval '40 minutes' WHERE trip_id = $1`, [done.id, at]);

  await call('PUT', '/admin/driver-pay', 'admin', { earnings_floor: { enabled: true, cents_per_engaged_hour: 9000 } });
  assert.equal((await call('POST', '/admin/driver-pay/floor/run', 'admin', { week: weekStartOf(new Date()) })).error, 'week_not_over');
  assert.equal((await call('GET', '/admin/driver-pay/floor?week=2026-11-18', 'admin')).error, 'week', 'weeks start on a Monday');

  const rep = await call('GET', `/admin/driver-pay/floor?week=${lastWeek}`, 'admin');
  assert.equal(rep.status, 200, JSON.stringify(rep));
  assert.equal(rep.week_over, true);
  const d1 = await driverId('+61400000011');
  const row = rep.rows.find((r: any) => r.driver_id === d1);
  assert.ok(row && row.engaged_s >= 2400, JSON.stringify(row));
  assert.equal(row.floor_cents, Math.round((row.engaged_s / 3600) * 9000));
  assert.equal(row.topup_cents, Math.max(0, row.floor_cents - row.earnings_cents));
  assert.ok(row.topup_cents > 0, 'a $90/h floor needs a top-up');

  const runs = await Promise.all([1, 2].map(() => call('POST', '/admin/driver-pay/floor/run', 'admin', { week: lastWeek })));
  assert.deepEqual(runs.map((r) => r.status), [200, 200]);
  const paid = await q(`SELECT amount_cents FROM driver_ledger WHERE driver_id = $1 AND kind = 'earnings_floor'`, [d1]);
  assert.deepEqual(paid.map((p) => p.amount_cents), [row.topup_cents], 'paid once even when run twice at once');
  const after = await call('GET', `/admin/driver-pay/floor?week=${lastWeek}`, 'admin');
  assert.equal(after.settled, true);
  assert.equal(after.rows.find((r: any) => r.driver_id === d1).paid_cents, row.topup_cents);
  assert.ok(await one(`SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'Earnings floor top-up'`, [d1]));

  const e = await call('GET', '/driver/earnings?days=30', 'd1');
  assert.equal(e.summary.earnings_floor_cents, row.topup_cents);
  assert.equal(e.floor.enabled, true);
  assert.equal(e.floor.cents_per_engaged_hour, 9000);
  assert.equal(e.floor.week_start, weekStartOf(new Date()));
  await q(`DELETE FROM settings WHERE key = 'driver_pay'`);
});
