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
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { encodeForm, signWebhook, verifyWebhook } from '../src/services/payments.js';
import crypto from 'node:crypto';
import { sendSmsNow, twilioSignature } from '../src/services/sms.js';
import { generateVapidKeys } from '../src/services/push.js';
import { notify, send } from '../src/services/notify.js';
import { decryptWebPush } from './helpers/webpush.js';

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

// ───────────── Round 5: accessibility ─────────────
test('rider accessibility profile reaches the offered and assigned driver (not parcels, not other viewers)', async () => {
  await clearOpenTrips();
  await onlyOnline(['d1']);
  const set = await call('PATCH', '/me', 'rider', { accessibility: { hearing: true, vision: false, wheelchair: true, assistance_animal: false, notes: '  Guide dog called Rusty  ' } });
  assert.equal(set.status, 200, JSON.stringify(set));
  const want = { hearing: true, vision: false, mobility: true, notes: 'Guide dog called Rusty' };
  try {
    const trip = await book();
    const offer = await waitForOffer('d1');
    assert.equal(offer.trip_id, trip.id);
    assert.deepEqual(offer.rider_needs, want, 'polled offer carries the needs');
    assert.equal(offer.rider_accessibility, undefined, 'raw profile JSON is not sent');
    const acc = await call('POST', `/driver/offers/${trip.id}/accept`, 'd1');
    assert.deepEqual(acc.trip.rider.needs, want);
    assert.deepEqual((await call('GET', '/driver/trips/active', 'd1')).trip.rider.needs, want);
    assert.deepEqual((await call('GET', `/admin/trips/${trip.id}`, 'admin')).trip.rider.needs, want, 'ops see it');
    const own = await call('GET', `/trips/${trip.id}`, 'rider');
    assert.deepEqual(own.trip.rider, { name: own.trip.rider.name }, 'rider view stays name only');
    assert.equal((await call('GET', `/public/track/${own.trip.share_token}`)).trip.rider_needs, undefined, 'share link shows nothing');
    await call('POST', `/trips/${trip.id}/cancel`, 'rider', { reason: 'test' });

    // Parcels: the sender isn't travelling.
    const p = await call('POST', '/trips', 'rider', {
      kind: 'courier', service: 'courier_s', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card',
      parcel: { size: 'S', description: 'Keys', sender_name: 'Demo', sender_phone: '0400000100', recipient_name: 'Nan', recipient_phone: '0400000555', prohibited_ack: true },
    });
    assert.equal(p.status, 201, JSON.stringify(p));
    assert.equal((await waitForOffer('d1')).rider_needs, null);
    await call('POST', `/trips/${p.trip.id}/cancel`, 'rider', { reason: 'test' });
  } finally {
    await call('PATCH', '/me', 'rider', { accessibility: {} });
  }
  // Nothing set → null.
  const t2 = await book();
  assert.equal((await waitForOffer('d1')).rider_needs, null);
  await call('POST', `/trips/${t2.id}/cancel`, 'rider', { reason: 'test' });
});

test('rider report of an assistance-animal refusal flags the driver once; own trips only', async () => {
  await clearOpenTrips();
  await onlyOnline(['d1']);
  const trip = await book(); // assistance animal not ticked: the driver saw the dog and left
  await waitForOffer('d1');
  assert.equal((await call('POST', `/driver/offers/${trip.id}/decline`, 'd1')).status, 200);
  assert.equal(await one(`SELECT 1 FROM compliance_flags WHERE trip_id = $1`, [trip.id]), null, 'plain decline is not flagged');

  const body = { trip_id: trip.id, category: 'assistance_animal_refused', subject: 'Driver refused my dog', message: 'He saw my guide dog and drove off.' };
  const r = await call('POST', '/support', 'rider', body);
  assert.equal(r.status, 201, JSON.stringify(r));
  assert.equal(r.ticket.flagged, true);
  const again = await call('POST', '/support', 'rider', body);
  assert.equal(again.status, 201);
  const flags = await q(`SELECT driver_id, detail FROM compliance_flags WHERE trip_id = $1 AND kind = 'assistance_animal_refusal'`, [trip.id]);
  assert.equal(flags.length, 1, 'one open flag per trip and driver');
  assert.equal(flags[0].driver_id, await driverId('+61400000011'));
  assert.match(flags[0].detail, /Rider reported/);

  // Someone else's trip: forbidden. No trip: a ticket, no flag.
  await login('rider2', '0400 000 177');
  assert.equal((await call('POST', '/support', 'rider2', body)).status, 403);
  const plain = await call('POST', '/support', 'rider', { category: 'assistance_animal_refused', subject: 'Refused', message: 'Last week a car refused my dog.' });
  assert.equal(plain.status, 201);
  assert.equal(plain.ticket.flagged, undefined);
  // A trip nobody was offered yet: ticket only.
  await q(`UPDATE trips SET status = 'cancelled_admin' WHERE id = $1`, [trip.id]);
  await onlyOnline([]);
  const lonely = await book();
  const r3 = await call('POST', '/support', 'rider', { ...body, trip_id: lonely.id });
  assert.equal(r3.status, 201);
  assert.equal(r3.ticket.flagged, undefined);
  await call('POST', `/trips/${lonely.id}/cancel`, 'rider', { reason: 'test' });
});

async function callH(method: string, url: string, who: string, body: unknown, headers: Record<string, string>) {
  const res = await app.inject({ method: method as any, url, payload: body as any, headers: { authorization: `Bearer ${tokens[who]}`, ...headers } });
  return { status: res.statusCode, ...JSON.parse(res.body) } as any;
}

test('poor signal: queued arrive/start/complete replay once (Idempotency-Key), keep the tap time within limits; late GPS points fill the track', async () => {
  await clearOpenTrips();
  await onlyOnline(['d1']);
  const trip = await book();
  await waitForOffer('d1');
  assert.equal((await call('POST', `/driver/offers/${trip.id}/accept`, 'd1')).trip.status, 'accepted');
  await q(`UPDATE trips SET accepted_at = now() - interval '20 minutes' WHERE id = $1`, [trip.id]);
  const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();

  assert.equal((await callH('POST', `/driver/trips/${trip.id}/arrive`, 'd1', {}, { 'idempotency-key': 'x' })).error, 'bad_idempotency_key');
  const a1 = await callH('POST', `/driver/trips/${trip.id}/arrive`, 'd1', { client_at: ago(18) }, { 'idempotency-key': 'arrive-key-0001' });
  assert.equal(a1.trip.status, 'arrived');
  const at = await one(`SELECT extract(epoch FROM now() - arrived_at)::int AS age FROM trips WHERE id = $1`, [trip.id]);
  assert.ok(at.age >= 14 * 60 && at.age <= 16 * 60, `tap time capped at 15 min old (got ${at.age}s)`);
  const again = await callH('POST', `/driver/trips/${trip.id}/arrive`, 'd1', { client_at: ago(18) }, { 'idempotency-key': 'arrive-key-0001' });
  assert.equal(again.status, 200, 'replay is not a conflict');
  assert.equal(again.trip.status, 'arrived');
  assert.equal((await call('POST', `/driver/trips/${trip.id}/arrive`, 'd1')).error, 'bad_state', 'a plain second tap is still refused');
  assert.equal((await one(`SELECT count(*)::int n FROM trip_events WHERE trip_id = $1 AND type = 'arrived'`, [trip.id])).n, 1);

  // Wrong PIN queued offline: refused on replay, so the app can put the driver back on the PIN screen.
  const wrong = trip.verify_pin === '0000' ? '1111' : '0000';
  assert.equal((await callH('POST', `/driver/trips/${trip.id}/start`, 'd1', { pin: wrong, client_at: ago(1) }, { 'idempotency-key': 'start-key-wrong' })).error, 'pin_mismatch');
  const future = new Date(Date.now() + 10 * 60_000).toISOString();
  const s1 = await callH('POST', `/driver/trips/${trip.id}/start`, 'd1', { pin: trip.verify_pin, client_at: future }, { 'idempotency-key': 'start-key-0001' });
  assert.equal(s1.trip.status, 'in_progress');
  assert.ok((await one(`SELECT started_at <= now() AS ok FROM trips WHERE id = $1`, [trip.id])).ok, 'never in the future');
  assert.equal((await callH('POST', `/driver/trips/${trip.id}/start`, 'd1', { pin: trip.verify_pin }, { 'idempotency-key': 'start-key-0001' })).trip.status, 'in_progress');

  // GPS saved on the phone during the dead zone.
  const pts = [
    { lat: -23.7001, lng: 133.8811, at: ago(2) }, { lat: -23.7030, lng: 133.8790, heading: 200, at: ago(1) },
    { lat: -23.69, lng: 133.88, at: ago(180) }, { lat: -23.69, lng: 133.88, at: new Date(Date.now() + 600_000).toISOString() },
  ];
  const before = (await one(`SELECT count(*)::int n FROM trip_track WHERE trip_id = $1`, [trip.id])).n;
  const lb = await call('POST', '/driver/location/batch', 'd1', { points: pts });
  assert.equal(lb.status, 200, JSON.stringify(lb));
  assert.equal(lb.stored, 2, 'too old and future points are dropped');
  assert.equal((await one(`SELECT count(*)::int n FROM trip_track WHERE trip_id = $1`, [trip.id])).n, before + 2);
  const pos = await one(`SELECT lat, lng, heading FROM drivers WHERE user_id = $1`, [await driverId('+61400000011')]);
  assert.deepEqual([pos.lat, pos.lng, pos.heading], [-23.7030, 133.8790, 200], 'live position is the newest point');
  assert.equal((await call('POST', '/driver/location/batch', 'd1', { points: [] })).status, 400);

  const ledgerBefore = (await one(`SELECT count(*)::int n FROM driver_ledger WHERE trip_id = $1`, [trip.id])).n;
  const c1 = await callH('POST', `/driver/trips/${trip.id}/complete`, 'd1', { client_at: ago(0.5) }, { 'idempotency-key': 'done-key-00001' });
  assert.equal(c1.trip.status, 'completed', JSON.stringify(c1));
  const ledger = (await one(`SELECT count(*)::int n FROM driver_ledger WHERE trip_id = $1`, [trip.id])).n;
  assert.ok(ledger > ledgerBefore);
  const c2 = await callH('POST', `/driver/trips/${trip.id}/complete`, 'd1', { client_at: ago(0.5) }, { 'idempotency-key': 'done-key-00001' });
  assert.equal(c2.status, 200);
  assert.equal(c2.trip.final_cents, c1.trip.final_cents);
  assert.equal((await one(`SELECT count(*)::int n FROM driver_ledger WHERE trip_id = $1`, [trip.id])).n, ledger, 'settled once');
  assert.equal((await one(`SELECT count(*)::int n FROM payments WHERE trip_id = $1 AND kind = 'capture'`, [trip.id])).n, 1, 'captured once');
  assert.equal((await one(`SELECT count(*)::int n FROM trip_events WHERE trip_id = $1 AND type = 'completed'`, [trip.id])).n, 1);
  // Someone else's trip stays forbidden, key or not.
  assert.equal((await callH('POST', `/driver/trips/${trip.id}/complete`, 'd2', {}, { 'idempotency-key': 'done-key-00001' })).status, 403);
});

test('document expiry: driver sees what runs out within 30 days; reminders at 30/14/3 days, once each, not when a new copy is waiting', async () => {
  const { reminderPoint, sendDocExpiryReminders } = await import('../src/services/docExpiry.js');
  assert.deepEqual([45, 30, 20, 14, 10, 3, 1, 0, -1].map(reminderPoint), [null, 30, 30, 14, 14, 3, 3, 3, null]);

  const id = await driverId('+61400000012');
  const orig = await one(`SELECT d.licence_expiry, d.vehicle_id, v.insurance_expiry, v.rego_expiry FROM drivers d JOIN vehicles v ON v.id = d.vehicle_id WHERE d.user_id = $1`, [id]);
  const day = async (n: number) => (await one(`SELECT ((now() AT TIME ZONE 'Australia/Darwin')::date + $1::int)::text AS d`, [n])).d as string;
  let added: string[] = [];
  try {
    await q(`UPDATE drivers SET licence_expiry = $2 WHERE user_id = $1`, [id, await day(10)]);
    await q(`UPDATE vehicles SET insurance_expiry = $2, rego_expiry = $3 WHERE id = $1`, [orig.vehicle_id, await day(3), await day(40)]);
    added = (await q(`INSERT INTO driver_documents (driver_id, type, expires_at, status) VALUES ($1, 'police_check', $2, 'approved'), ($1, 'licence', $3, 'pending') RETURNING id`,
      [id, await day(25), await day(1500)])).map((r: any) => r.id);
    const me = await call('GET', '/driver/me', 'd2');
    const by = Object.fromEntries(me.expiring.map((e: any) => [e.key, e]));
    assert.equal(by.licence.days_left, 10);
    assert.equal(by.licence.level, 'soon');
    assert.equal(by.licence.replacement_pending, true, 'new licence sent, waiting for checking');
    assert.equal(by[`vehicle:${orig.vehicle_id}:insurance`].level, 'urgent');
    assert.match(by[`vehicle:${orig.vehicle_id}:insurance`].label, /insurance/);
    assert.equal(by.police_check.level, 'upcoming');
    assert.equal(by[`vehicle:${orig.vehicle_id}:vehicle_rego`], undefined, '40 days out is not listed');
    assert.equal(me.expiring[0].days_left, 3, 'soonest first');

    const mine = async () => (await q(`SELECT data->>'reminder' AS r, title FROM notifications WHERE user_id = $1 AND category = 'documents' ORDER BY id`, [id]));
    await sendDocExpiryReminders({ force: true });
    let rows = await mine();
    const keys = rows.map((r: any) => r.r);
    const [d3, d25] = [await day(3), await day(25)];
    assert.ok(keys.includes(`vehicle:${orig.vehicle_id}:insurance:${d3}:3`), JSON.stringify(keys));
    assert.ok(keys.includes(`police_check:${d25}:30`));
    assert.ok(!keys.some((k: string) => k.startsWith('licence:')), 'no nag while the new licence waits for checking');
    const n = rows.length;
    await sendDocExpiryReminders({ force: true });
    assert.equal((await mine()).length, n, 'once per reminder point');
    // Outside 8 am–8 pm Darwin: nothing is sent by the tick.
    assert.deepEqual(await sendDocExpiryReminders({ now: new Date('2026-11-19T13:00:00Z') }), { sent: 0 }); // 10:30 pm Darwin
    // Insurance renewed but the new date is again close: a new reminder for the new date.
    await q(`UPDATE vehicles SET insurance_expiry = $2 WHERE id = $1`, [orig.vehicle_id, await day(13)]);
    await sendDocExpiryReminders({ force: true });
    rows = await mine();
    const d13 = await day(13);
    assert.ok(rows.some((r: any) => r.r === `vehicle:${orig.vehicle_id}:insurance:${d13}:14`));
    assert.match(rows[rows.length - 1].title, /expires in 13 days/);
  } finally {
    await q(`UPDATE drivers SET licence_expiry = $2 WHERE user_id = $1`, [id, orig.licence_expiry]);
    await q(`UPDATE vehicles SET insurance_expiry = $2, rego_expiry = $3 WHERE id = $1`, [orig.vehicle_id, orig.insurance_expiry, orig.rego_expiry]);
    await q(`DELETE FROM driver_documents WHERE id = ANY($1::uuid[])`, [added]);
  }
});

// ───────────── Round 7: ops tooling ─────────────
async function rawAs(method: string, url: string, who: string) {
  return app.inject({ method: method as any, url, headers: { authorization: `Bearer ${tokens[who]}` } });
}
const parseCsv = (body: string) => body.replace(/^﻿/, '').trim().split('\r\n');

test('ops search: trips by ref and phone, drivers by rego and phone, people by name; trip list filters', async () => {
  if (!tokens.dispatcher) await login('dispatcher', '+61400000002', 'admin');
  const d1 = await one(`SELECT d.user_id, u.phone, v.rego FROM drivers d JOIN users u ON u.id = d.user_id JOIN vehicles v ON v.id = d.vehicle_id WHERE u.phone = '+61400000011'`);
  const pb = await call('POST', '/admin/bookings', 'admin', { phone: '0400 765 432', name: 'Search Testperson', trip: { kind: 'courier', service: 'courier_s', pickup: TODD_MALL, dropoff: HOSPITAL,
    parcel: { size: 'S', description: 'Papers', sender_name: 'Search Testperson', sender_phone: '0400765432', recipient_name: 'Friend', recipient_phone: '0400765431', prohibited_ack: true } } });
  assert.equal(pb.status, 201, JSON.stringify(pb));
  // Ref, in lower case, finds the trip first.
  const byRef = await call('GET', `/admin/search?q=${encodeURIComponent(pb.trip.ref.toLowerCase())}`, 'dispatcher');
  assert.equal(byRef.trips[0].id, pb.trip.id);
  // Phone in local format with spaces finds the rider's trip and the person (stored as +61…).
  const byPhone = await call('GET', `/admin/search?q=${encodeURIComponent('0400 765 432')}`, 'dispatcher');
  assert.ok(byPhone.trips.some((t: any) => t.id === pb.trip.id));
  assert.ok(byPhone.people.some((p: any) => p.name === 'Search Testperson'));
  // Rego with odd spacing / case finds the driver and the car; driver phone in local format finds the driver.
  const messy = d1!.rego.toLowerCase().replace(/\s+/g, '').split('').join(' ');
  const byRego = await call('GET', `/admin/search?q=${encodeURIComponent(messy)}`, 'dispatcher');
  assert.ok(byRego.drivers.some((d: any) => d.id === d1!.user_id), JSON.stringify(byRego));
  assert.ok(byRego.vehicles.some((v: any) => v.rego === d1!.rego));
  const byDriverPhone = await call('GET', `/admin/search?q=${encodeURIComponent('0400 000 011')}`, 'dispatcher');
  assert.ok(byDriverPhone.drivers.some((d: any) => d.id === d1!.user_id));
  assert.equal(byDriverPhone.people.some((p: any) => p.role === 'driver'), false, 'drivers listed once, under drivers');
  assert.deepEqual((await call('GET', '/admin/search?q=x', 'dispatcher')).trips, [], 'too short');
  assert.equal((await call('GET', '/admin/search?q=test', 'rider')).status, 403);
  // Trip list: phone search, date range, cancelled group, bad status.
  const list = await call('GET', `/admin/trips?q=${encodeURIComponent('+61 400 765 432')}`, 'dispatcher');
  assert.deepEqual(list.trips.map((t: any) => t.id), [pb.trip.id]);
  const today = new Date(Date.now() + 9.5 * 3600e3).toISOString().slice(0, 10);
  assert.ok((await call('GET', `/admin/trips?from=${today}&to=${today}&q=Search%20Testperson`, 'dispatcher')).trips.length === 1);
  assert.equal((await call('GET', `/admin/trips?from=2001-01-01&to=2001-01-02`, 'dispatcher')).trips.length, 0);
  await call('POST', `/admin/trips/${pb.trip.id}/cancel`, 'dispatcher', {});
  assert.ok((await call('GET', `/admin/trips?status=cancelled&q=${pb.trip.ref}`, 'dispatcher')).trips.length === 1);
  assert.equal((await call('GET', '/admin/trips?status=nonsense', 'dispatcher')).error, 'invalid_status');
  // The ops cancel is in the audit log.
  const a = await call('GET', `/admin/audit?entity=trip&entity_id=${pb.trip.id}`, 'admin');
  assert.equal(a.items[0].action, 'cancel');
  assert.equal(a.items[0].actor_name, 'Dispatch Desk');
});

test('SOS incident: timeline, runbook steps once, first action acknowledges, resolve keeps notes, no reopen', async () => {
  if (!tokens.dispatcher) await login('dispatcher', '+61400000002', 'admin');
  const raised = await call('POST', '/driver/sos', 'd3', { lat: -23.7, lng: 133.88, message: 'Passenger aggressive' });
  const id = raised.alert.id;
  let inc = await call('GET', `/admin/sos/${id}`, 'dispatcher');
  assert.equal(inc.alert.status, 'open');
  assert.equal(inc.timeline[0].kind, 'raised');
  assert.match(inc.timeline[0].text, /Passenger aggressive/);
  assert.ok(inc.runbook.length >= 5 && inc.runbook.every((s: any) => s.done_at === null));
  // Ticking a step acknowledges the alert and is recorded once, even if ticked twice.
  inc = await call('POST', `/admin/sos/${id}/notes`, 'dispatcher', { step: 'call_raiser' });
  inc = await call('POST', `/admin/sos/${id}/notes`, 'dispatcher', { step: 'call_raiser' });
  assert.equal(inc.alert.status, 'acknowledged');
  assert.equal(inc.alert.handled_by_name, 'Dispatch Desk');
  assert.ok(inc.runbook.find((s: any) => s.key === 'call_raiser').done_at);
  assert.equal(inc.timeline.filter((e: any) => e.kind === 'step').length, 1);
  assert.equal(inc.timeline.filter((e: any) => e.kind === 'acknowledged').length, 1);
  inc = await call('POST', `/admin/sos/${id}/notes`, 'dispatcher', { text: 'Driver safe, passenger left the car' });
  assert.ok(inc.timeline.some((e: any) => e.kind === 'note' && e.by === 'Dispatch Desk'));
  assert.equal((await call('POST', `/admin/sos/${id}/notes`, 'dispatcher', {})).status, 400);
  assert.equal((await call('POST', `/admin/sos/${id}/notes`, 'dispatcher', { step: 'not_a_step' })).status, 400);
  assert.equal((await call('GET', '/admin/sos/not-a-uuid', 'dispatcher')).status, 404);
  // Resolve: earlier notes kept, outcome added; no going back to acknowledged.
  await call('PATCH', `/admin/sos/${id}`, 'dispatcher', { status: 'acknowledged', notes: 'Called driver' });
  const res = await call('PATCH', `/admin/sos/${id}`, 'dispatcher', { status: 'resolved', notes: 'No injuries. Rider account blocked.' });
  assert.equal(res.item.status, 'resolved');
  assert.equal(res.item.notes, 'Called driver\nNo injuries. Rider account blocked.');
  assert.equal((await call('PATCH', `/admin/sos/${id}`, 'dispatcher', { status: 'acknowledged' })).error, 'already_resolved');
  inc = await call('GET', `/admin/sos/${id}`, 'dispatcher');
  assert.deepEqual(inc.timeline.map((e: any) => e.kind), ['raised', 'step', 'acknowledged', 'note', 'acknowledged', 'resolved']);
  assert.equal((await call('GET', `/admin/sos/${id}`, 'rider')).status, 403);
});

test('bulk document review: only pending docs change, one notification per driver, audited; reject needs a reason', async () => {
  const d2 = (await one(`SELECT user_id FROM drivers d JOIN users u ON u.id = d.user_id WHERE u.phone = '+61400000012'`))!.user_id;
  const docs = (await q(`INSERT INTO driver_documents (driver_id, type, number, expires_at, status) VALUES
      ($1,'first_aid','FA1','2030-01-01','pending'), ($1,'wwcc','W1','2030-01-01','pending'), ($1,'medical','M1',null,'approved') RETURNING id`, [d2])).map((r: any) => r.id);
  try {
    assert.equal((await call('POST', '/admin/documents/review', 'admin', { ids: docs, status: 'rejected' })).error, 'note_required');
    const before = (await one(`SELECT count(*)::int n FROM notifications WHERE user_id = $1`, [d2]))!.n;
    const ghost = '00000000-0000-4000-8000-000000000000';
    const r = await call('POST', '/admin/documents/review', 'admin', { ids: [...docs, docs[0], ghost], status: 'approved' });
    assert.deepEqual(r.reviewed.sort(), docs.slice(0, 2).sort());
    assert.deepEqual(r.skipped.map((s: any) => s.reason).sort(), ['not_found', 'not_pending']);
    await flushBackground(2000);
    const notes = await q(`SELECT title FROM notifications WHERE user_id = $1 ORDER BY id DESC LIMIT 3`, [d2]);
    assert.equal((await one(`SELECT count(*)::int n FROM notifications WHERE user_id = $1`, [d2]))!.n, before + 1, 'one notification for the batch');
    assert.equal(notes[0].title, '2 documents approved');
    const a = await call('GET', `/admin/audit?action=document_review&q=${docs[0]}`, 'admin');
    assert.equal(a.items.length, 1);
    assert.equal((await call('POST', '/admin/documents/review', 'dispatcher', { ids: docs, status: 'approved' })).status, 403);
  } finally { await q(`DELETE FROM driver_documents WHERE id = ANY($1::uuid[])`, [docs]); }
});

test('CSV exports, daily summary and audit log filters', async () => {
  if (!tokens.dispatcher) await login('dispatcher', '+61400000002', 'admin');
  const today = new Date(Date.now() + 9.5 * 3600e3).toISOString().slice(0, 10);
  // Trips CSV: dispatchers may export trips; no phone numbers; formula-looking text is defused.
  const evil = await call('POST', '/admin/bookings', 'admin', { phone: '0400 765 999', name: '=HYPERLINK("x")', trip: { kind: 'courier', service: 'courier_s', pickup: { ...TODD_MALL, address: '+SUM(A1)' }, dropoff: HOSPITAL,
    parcel: { size: 'S', description: 'Box', sender_name: 'Evil', sender_phone: '0400765999', recipient_name: 'Friend', recipient_phone: '0400765998', prohibited_ack: true } } });
  assert.equal(evil.status, 201, JSON.stringify(evil));
  const res = await rawAs('GET', `/admin/export/trips.csv?from=${today}&to=${today}`, 'dispatcher');
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type']), /^text\/csv/);
  assert.match(String(res.headers['content-disposition']), /attachment; filename="dingogo-trips-/);
  assert.equal(res.headers['cache-control'], 'no-store');
  const lines = parseCsv(res.body);
  assert.match(lines[0], /^Ref,Type,Service,Status/);
  const row = lines.find((l) => l.startsWith(evil.trip.ref))!;
  assert.ok(row.includes(`"'=HYPERLINK(""x"")"`), row);
  assert.ok(row.includes(`'+SUM(A1)`), row);
  assert.ok(!/\+61\d{9}|0400765999/.test(res.body), 'no phone numbers in exports');
  assert.equal((await rawAs('GET', '/admin/export/trips.csv?from=2020-01-01&to=2026-01-01', 'dispatcher')).statusCode, 400, 'over a year');
  // Money exports are admin-only.
  assert.equal((await rawAs('GET', '/admin/export/payouts.csv', 'dispatcher')).statusCode, 403);
  assert.equal((await rawAs('GET', '/admin/export/nope.csv', 'admin')).statusCode, 404);
  const levy = await call('GET', '/admin/reports/levy', 'admin');
  const lv = parseCsv((await rawAs('GET', `/admin/export/levy.csv?month=${levy.month}`, 'admin')).body);
  assert.equal(lv[0], 'Month,State,Driver,Passenger trips,Levy per trip ($),Levy payable ($)');
  assert.equal(lv[lv.length - 1], `${levy.month},NT,Total,${levy.passenger_trips},1.00,${(levy.levy_payable_cents / 100).toFixed(2)}`);
  const gst = parseCsv((await rawAs('GET', '/admin/export/gst.csv', 'admin')).body);
  assert.match(gst[gst.length - 1], /DingoGo service fees,driver ledger/);
  const pay = parseCsv((await rawAs('GET', `/admin/export/payouts.csv?from=2020-01-01&to=${today}`, 'admin')).body);
  assert.match(pay[pay.length - 1], /,Total,/);
  // Exports are audited.
  const ex = await call('GET', '/admin/audit?action=export&entity_id=trips.csv', 'admin');
  assert.ok(ex.items.length >= 1 && ex.items[0].actor_name === 'Dispatch Desk');

  // Daily summary (Darwin day).
  const s = await call('GET', `/admin/summary/daily?date=${today}`, 'dispatcher');
  assert.equal(s.date, today);
  assert.ok(s.trips.requested >= 2 && s.trips.courier >= 2 && s.trips.phone_or_staff >= 2);
  assert.ok(s.safety.raised >= 1);
  assert.equal(typeof s.attention.open_sos, 'number');
  assert.ok(s.documents.approved >= 2, 'bulk review counted');
  assert.ok(Array.isArray(s.cancellations));
  const old = await call('GET', '/admin/summary/daily?date=2001-02-03', 'dispatcher');
  assert.equal(old.trips.requested, 0);
  assert.equal((await call('GET', '/admin/summary/daily?date=garbage', 'dispatcher')).date, today);

  // Audit filters + paging.
  const page1 = await call('GET', '/admin/audit?limit=2', 'admin');
  assert.equal(page1.items.length, 2);
  assert.ok(page1.next_before && page1.actions.length && page1.actors.length);
  const page2 = await call('GET', `/admin/audit?limit=2&before=${page1.next_before}`, 'admin');
  assert.ok(Number(page2.items[0].id) < Number(page1.items[1].id));
  assert.equal(page2.actions, undefined, 'menus only on the first page');
  assert.equal((await call('GET', '/admin/audit?before=abc', 'admin')).status, 400);
  assert.equal((await call('GET', `/admin/audit?from=2001-01-01&to=2001-01-02`, 'admin')).items.length, 0);
  assert.equal((await call('GET', '/admin/audit', 'dispatcher')).status, 403);
});

// ───────────── Round 8: payments readiness (Stripe) ─────────────
/** A fake Stripe API on localhost (no network): records every request, honours idempotency keys, and can decline or ask for a bank check. */
const fake = {
  url: '', n: 0, reqs: [] as { method: string; path: string; params: Record<string, string>; headers: http.IncomingHttpHeaders }[],
  pis: new Map<string, any>(), setis: new Map<string, any>(), idem: new Map<string, { status: number; body: any }>(),
  next: { pm: 'pm_card1', fingerprint: 'fp_card1' }, declineNext: false, requireAction: false,
};
const fakeServer = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (d) => { raw += d; });
  req.on('end', () => {
    const u = new URL(req.url ?? '/', 'http://x');
    const params = Object.fromEntries(new URLSearchParams(req.method === 'GET' ? u.search : raw));
    fake.reqs.push({ method: req.method!, path: u.pathname, params, headers: req.headers });
    const send = (status: number, body: any) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (req.headers.authorization !== 'Bearer sk_test_fake') return send(401, { error: { message: 'bad key' } });
    const key = req.headers['idempotency-key'] as string | undefined;
    if (req.method === 'POST' && key && fake.idem.has(key)) { const c = fake.idem.get(key)!; return send(c.status, c.body); }
    const out = (() => {
      const p = u.pathname; const id = () => `${++fake.n}abcdef`;
      if (p === '/v1/customers') return { status: 200, body: { id: `cus_${id()}` } };
      if (p === '/v1/setup_intents' && req.method === 'POST') {
        const si = { id: `seti_${id()}`, customer: params.customer, status: 'succeeded', client_secret: `seti_secret_${fake.n}`,
          payment_method: { id: fake.next.pm, card: { brand: 'visa', last4: '4242', exp_month: 4, exp_year: 2030, fingerprint: fake.next.fingerprint } } };
        fake.setis.set(si.id, si);
        return { status: 200, body: { id: si.id, client_secret: si.client_secret, status: 'requires_payment_method' } };
      }
      const seti = p.match(/^\/v1\/setup_intents\/(.+)$/);
      if (seti) return fake.setis.has(seti[1]) ? { status: 200, body: fake.setis.get(seti[1]) } : { status: 404, body: { error: { code: 'resource_missing', message: 'No such setupintent' } } };
      if (/^\/v1\/payment_methods\/.+\/detach$/.test(p)) return { status: 200, body: { id: p.split('/')[3] } };
      if (p === '/v1/payment_intents') {
        if (fake.declineNext) {
          fake.declineNext = false;
          return { status: 402, body: { error: { type: 'card_error', code: 'card_declined', decline_code: 'insufficient_funds', message: 'Your card has insufficient funds.', payment_intent: { id: `pi_declined_${id()}` } } } };
        }
        const pi = { id: `pi_${id()}`, amount: Number(params.amount), capture_method: params.capture_method, metadata: {} as any,
          status: fake.requireAction ? 'requires_action' : params.capture_method === 'manual' ? 'requires_capture' : 'succeeded' };
        fake.pis.set(pi.id, pi);
        return { status: 200, body: pi };
      }
      const cap = p.match(/^\/v1\/payment_intents\/(.+)\/capture$/);
      if (cap) {
        const pi = fake.pis.get(cap[1]);
        if (!pi || pi.status !== 'requires_capture') return { status: 400, body: { error: { code: 'payment_intent_unexpected_state', message: 'This PaymentIntent could not be captured' } } };
        pi.status = 'succeeded'; pi.amount_received = Number(params.amount_to_capture);
        return { status: 200, body: pi };
      }
      const can = p.match(/^\/v1\/payment_intents\/(.+)\/cancel$/);
      if (can) { const pi = fake.pis.get(can[1]); if (pi) pi.status = 'canceled'; return { status: 200, body: pi ?? { id: can[1], status: 'canceled' } }; }
      if (p === '/v1/refunds') return { status: 200, body: { id: `re_${id()}`, amount: Number(params.amount), payment_intent: params.payment_intent } };
      return { status: 404, body: { error: { message: `fake stripe: no route ${p}` } } };
    })();
    if (req.method === 'POST' && key) fake.idem.set(key, out);
    send(out.status, out.body);
  });
});
async function withStripe<T>(fn: () => Promise<T>): Promise<T> {
  if (!fake.url) { await new Promise<void>((r) => fakeServer.listen(0, '127.0.0.1', r)); fake.url = `http://127.0.0.1:${(fakeServer.address() as AddressInfo).port}`; }
  const prev = { ...config.stripe };
  Object.assign(config.stripe, { secretKey: 'sk_test_fake', publishableKey: 'pk_test_fake', webhookSecret: 'whsec_test', apiBase: fake.url });
  try { return await fn(); } finally { Object.assign(config.stripe, prev); }
}
after(() => { fakeServer.close(); });
async function hook(evt: any, secret = 'whsec_test', t?: number) {
  const payload = JSON.stringify(evt);
  const res = await app.inject({ method: 'POST', url: '/payments/stripe/webhook', payload, headers: { 'content-type': 'application/json', 'stripe-signature': signWebhook(payload, secret, t) } });
  return { status: res.statusCode, ...JSON.parse(res.body) } as any;
}
const reqsTo = (path: string, pred: (r: (typeof fake.reqs)[number]) => boolean = () => true) => fake.reqs.filter((r) => r.path === path && pred(r));
const rideFor = (who: string, extra: Record<string, unknown> = {}) => call('POST', '/trips', who, { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card', ...extra });

test('Stripe client: nested form encoding; webhook signatures (secret, tolerance, several v1, tampering)', () => {
  assert.equal(encodeForm({ a: 1, m: { trip_id: 'x' }, l: ['card'], skip: undefined }).toString(), 'a=1&m%5Btrip_id%5D=x&l%5B0%5D=card');
  const body = JSON.stringify({ id: 'evt_1', type: 'x' });
  const h = signWebhook(body, 'whsec_a');
  assert.equal(verifyWebhook(Buffer.from(body), h, 'whsec_a').id, 'evt_1');
  assert.throws(() => verifyWebhook(Buffer.from(body), h, 'whsec_b'), /does not match/);
  assert.throws(() => verifyWebhook(Buffer.from(body + ' '), h, 'whsec_a'), /does not match/, 'tampered body');
  assert.throws(() => verifyWebhook(Buffer.from(body), signWebhook(body, 'whsec_a', Math.floor(Date.now() / 1000) - 400), 'whsec_a'), /too old/);
  const t = Math.floor(Date.now() / 1000);
  const two = `t=${t},v1=${'0'.repeat(64)},${signWebhook(body, 'whsec_a', t).split(',')[1]}`;   // rolling secrets: any v1 may match
  assert.equal(verifyWebhook(Buffer.from(body), two, 'whsec_a').id, 'evt_1');
  assert.throws(() => verifyWebhook(Buffer.from(body), undefined, 'whsec_a'), /Missing/);
  assert.throws(() => verifyWebhook(Buffer.from(body), 't=abc', 'whsec_a'), /Malformed/);
});

let stripeTrip: any;
test('Stripe mode: card saved only through a checked SetupIntent; fare held on it with idempotency keys and captured at the end; tip on its own PaymentIntent; refunds fare first then tip; dashboard refunds recorded once', async () => {
  await clearOpenTrips();
  await onlyOnline(['d1']);
  await login('sr', '+61400000871');
  await withStripe(async () => {
    const pm0 = await call('GET', '/payment-methods', 'sr');
    assert.deepEqual([pm0.cards.mode, pm0.cards.publishable_key, pm0.methods.length], ['stripe', 'pk_test_fake', 0]);
    const noCard = await rideFor('sr');
    assert.deepEqual([noCard.status, noCard.error], [402, 'card_required']);
    // Card details from the app are not trusted: only a SetupIntent id, checked with Stripe.
    assert.equal((await call('POST', '/payment-methods', 'sr', { provider_ref: 'pm_x', brand: 'Visa', last4: '4242' })).error, 'validation_error');
    const setup = await call('POST', '/payment-methods/setup', 'sr');
    assert.match(setup.client_secret, /^seti_secret_/);
    assert.equal(setup.publishable_key, 'pk_test_fake');
    const siReq = reqsTo('/v1/setup_intents').at(-1)!;
    assert.deepEqual([siReq.params.usage, siReq.params['payment_method_types[0]']], ['off_session', 'card']);
    assert.match(siReq.params.customer, /^cus_/);
    fake.setis.set('seti_foreign1', { id: 'seti_foreign1', customer: 'cus_someone_else', status: 'succeeded', payment_method: { id: 'pm_other', card: {} } });
    assert.equal((await call('POST', '/payment-methods', 'sr', { setup_intent_id: 'seti_foreign1' })).error, 'setup_not_found');
    assert.equal((await call('POST', '/payment-methods', 'sr', { setup_intent_id: 'seti_missing99' })).error, 'setup_not_found');
    const saved = await call('POST', '/payment-methods', 'sr', { setup_intent_id: setup.setup_intent_id });
    assert.deepEqual([saved.method.brand, saved.method.last4, saved.method.is_default, saved.method.exp_year], ['Visa', '4242', true, 2030]);
    // The same card again (same fingerprint): kept once, the copy detached at Stripe.
    fake.next = { pm: 'pm_card1copy', fingerprint: 'fp_card1' };
    const s2 = await call('POST', '/payment-methods/setup', 'sr');
    const dup = await call('POST', '/payment-methods', 'sr', { setup_intent_id: s2.setup_intent_id });
    assert.equal(dup.already_saved, true);
    assert.equal(reqsTo('/v1/payment_methods/pm_card1copy/detach').length, 1);
    fake.next = { pm: 'pm_card1', fingerprint: 'fp_card1' };
    assert.equal((await call('GET', '/payment-methods', 'sr')).methods.length, 1);

    const t = await rideFor('sr');
    assert.equal(t.status, 201, JSON.stringify(t));
    assert.equal(t.trip.payment_status, 'authorised');
    const hold = reqsTo('/v1/payment_intents', (r) => r.params['metadata[trip_id]'] === t.trip.id)[0];
    assert.equal(hold.headers['idempotency-key'], `hold-${t.trip.id}-1`);
    assert.equal(hold.headers['stripe-version'], '2024-06-20');
    assert.deepEqual([hold.params.capture_method, hold.params.off_session, hold.params.confirm, hold.params.payment_method, hold.params.currency],
      ['manual', 'true', 'true', 'pm_card1', 'aud']);
    assert.equal(hold.params.amount, String(Math.round(t.trip.quote_cents * 1.2)), 'quote + 20%');
    await offeredTo(t.trip.id, ['d1']);
    const done = await rideToEnd(t.trip.id, 'd1');
    assert.equal(done.payment_status, 'captured');
    const cap = reqsTo(`/v1/payment_intents/${t.trip.payment_ref}/capture`);
    assert.equal(cap.length, 1);
    assert.equal(cap[0].params.amount_to_capture, String(done.final_cents));
    assert.equal(cap[0].headers['idempotency-key'], `capture-${t.trip.payment_ref}-${done.final_cents}`);
    assert.equal((await one(`SELECT provider FROM payments WHERE trip_id = $1 AND kind = 'capture'`, [t.trip.id])).provider, 'stripe');

    assert.equal((await call('POST', `/trips/${t.trip.id}/tip`, 'sr', { cents: 500 })).ok, true);
    const tipReq = reqsTo('/v1/payment_intents', (r) => r.params['metadata[kind]'] === 'tip' && r.params['metadata[trip_id]'] === t.trip.id);
    assert.equal(tipReq.length, 1);
    assert.deepEqual([tipReq[0].params.capture_method, tipReq[0].headers['idempotency-key']], ['automatic', `tip-${t.trip.id}-500`]);
    const tipRow = await one(`SELECT provider, provider_ref FROM payments WHERE trip_id = $1 AND kind = 'tip'`, [t.trip.id]);
    assert.equal(tipRow.provider, 'stripe');
    assert.notEqual(tipRow.provider_ref, t.trip.payment_ref, 'tip has its own PaymentIntent');

    // Refund the whole fare and $2 of the tip: two refunds, each to its own PaymentIntent; GST only on the fare part.
    const rf = await call('POST', `/admin/trips/${t.trip.id}/refund`, 'admin', { cents: done.final_cents + 200, reason: 'Test refund' });
    assert.equal(rf.refundable_cents, 300);
    const refunds = reqsTo('/v1/refunds', (r) => [t.trip.payment_ref, tipRow.provider_ref].includes(r.params.payment_intent));
    assert.deepEqual(refunds.map((r) => [r.params.payment_intent, r.params.amount]), [[t.trip.payment_ref, String(done.final_cents)], [tipRow.provider_ref, '200']]);
    assert.ok(refunds.every((r) => String(r.headers['idempotency-key']).startsWith(`refund-${t.trip.id}-`)));
    const rows = await q(`SELECT provider_ref, amount_cents, gst_cents FROM payments WHERE trip_id = $1 AND kind = 'refund' ORDER BY amount_cents`, [t.trip.id]);
    assert.deepEqual(rows.map((r) => [r.amount_cents, r.gst_cents]), [[-done.final_cents, -Math.round(done.final_cents / 11)], [-200, 0]]);
    const rc = (await call('GET', `/trips/${t.trip.id}/receipt`, 'sr')).receipt;
    assert.equal(rc.title, 'Tax Invoice (adjusted)');
    assert.deepEqual([rc.refunded_cents, rc.net_total_cents, rc.net_gst_cents, rc.invoice_number], [done.final_cents + 200, 300, 0, t.trip.ref]);
    assert.match(rc.tip_note, /not part of the taxable fare/);

    // Stripe tells us about the refunds we made: nothing new. A dashboard refund of $1 more on the tip is recorded once.
    assert.equal((await hook({ id: 'evt_ref_1', type: 'charge.refunded', data: { object: { id: 'ch_1', payment_intent: t.trip.payment_ref, amount_refunded: done.final_cents } } })).handled, 'already_recorded');
    const dash = { id: 'evt_ref_2', type: 'charge.refunded', data: { object: { id: 'ch_2', payment_intent: tipRow.provider_ref, amount_refunded: 300 } } };
    assert.equal((await hook(dash)).handled, 'refund_recorded');
    assert.equal((await hook(dash)).duplicate, true, 'replayed event applied once');
    assert.equal((await hook({ ...dash, id: 'evt_ref_3' })).handled, 'already_recorded', 'same total in a new event adds nothing');
    const total = await one(`SELECT -sum(amount_cents)::int c, sum(gst_cents)::int g FROM payments WHERE trip_id = $1 AND kind = 'refund'`, [t.trip.id]);
    assert.deepEqual([total.c, total.g], [done.final_cents + 300, -Math.round(done.final_cents / 11)]);
    assert.equal((await call('POST', `/admin/trips/${t.trip.id}/refund`, 'admin', { cents: 300, reason: 'x' })).error, 'refund_too_large');
    stripeTrip = { ...done, payment_ref: t.trip.payment_ref };
  });
});

test('Stripe mode: declines and bank checks refused plainly; booked trips held at release (declined → cancelled); a lapsed hold is charged afresh; a failed payment is paid later', async () => {
  await clearOpenTrips();
  await onlyOnline([]);
  await withStripe(async () => {
    const riderId = (await one(`SELECT id FROM users WHERE phone = '+61400000871'`)).id;
    const count = async () => (await one('SELECT count(*)::int n FROM trips WHERE rider_id = $1', [riderId])).n;
    const n0 = await count();
    fake.declineNext = true;
    const d = await rideFor('sr');
    assert.deepEqual([d.status, d.error, d.details.reason], [402, 'payment_failed', 'insufficient_funds']);
    assert.match(d.message, /not enough money/);
    assert.equal(await count(), n0, 'no trip left behind');
    fake.requireAction = true;
    const a = await rideFor('sr');
    fake.requireAction = false;
    assert.deepEqual([a.status, a.details.reason], [402, 'authentication_required']);
    assert.match(a.message, /bank wants to confirm/);
    const actionPi = [...fake.pis.values()].find((p) => p.status === 'canceled' && p.capture_method === 'manual');
    assert.ok(actionPi, 'the half-done hold is cancelled');

    // Booked ahead: no hold at booking (holds lapse after ~7 days); held when released to drivers.
    const at = new Date(Date.now() + 3 * 24 * 3600e3).toISOString();
    const s = await rideFor('sr', { scheduled_for: at });
    assert.equal(s.status, 201, JSON.stringify(s));
    assert.deepEqual([s.trip.status, s.trip.payment_status], ['scheduled', 'none']);
    assert.equal((await one(`SELECT count(*)::int n FROM payments WHERE trip_id = $1`, [s.trip.id])).n, 0);
    await q(`UPDATE trips SET scheduled_for = now() + interval '10 minutes' WHERE id = $1`, [s.trip.id]);
    await dispatchTick();
    const rel = await one('SELECT status, payment_status, payment_ref FROM trips WHERE id = $1', [s.trip.id]);
    assert.deepEqual([rel.status, rel.payment_status], ['requested', 'authorised']);
    assert.equal(reqsTo('/v1/payment_intents', (r) => r.params['metadata[trip_id]'] === s.trip.id)[0].headers['idempotency-key'], `hold-${s.trip.id}-1`);
    await call('POST', `/trips/${s.trip.id}/cancel`, 'sr', {});
    assert.equal(reqsTo(`/v1/payment_intents/${rel.payment_ref}/cancel`).length, 1, 'free cancel lets the hold go');

    // Declined at release: the booking is cancelled, nothing charged, rider told.
    const s2 = await rideFor('sr', { scheduled_for: at });
    await q(`UPDATE trips SET scheduled_for = now() + interval '10 minutes' WHERE id = $1`, [s2.trip.id]);
    fake.declineNext = true;
    await dispatchTick();
    const r2 = await one('SELECT status, payment_status, cancel_reason FROM trips WHERE id = $1', [s2.trip.id]);
    assert.deepEqual([r2.status, r2.payment_status], ['cancelled_admin', 'none']);
    assert.match(r2.cancel_reason, /Card declined/);
    assert.ok(await one(`SELECT 1 FROM trip_events WHERE trip_id = $1 AND type = 'payment_failed' AND data->>'stage' = 'release'`, [s2.trip.id]));
    await flushBackground(1000);
    assert.ok(await one(`SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'Booking cancelled: card declined'`, [riderId]));

    // The hold lapsed (webhook): the fare is charged on the saved card instead of captured.
    await onlyOnline(['d1']);
    const t = await rideFor('sr');
    fake.pis.get(t.trip.payment_ref).status = 'canceled';
    assert.equal((await hook({ id: 'evt_cancel_1', type: 'payment_intent.canceled', data: { object: { id: t.trip.payment_ref, cancellation_reason: 'automatic' } } })).handled, 'hold_lapsed');
    assert.equal((await one('SELECT payment_status FROM trips WHERE id = $1', [t.trip.id])).payment_status, 'none');
    await offeredTo(t.trip.id, ['d1']);
    const done = await rideToEnd(t.trip.id, 'd1');
    assert.equal(done.payment_status, 'captured');
    assert.notEqual(done.payment_ref, t.trip.payment_ref, 'fresh PaymentIntent');
    const fresh = reqsTo('/v1/payment_intents', (r) => r.headers['idempotency-key'] === `fare-${t.trip.id}-${done.final_cents}`);
    assert.deepEqual([fresh.length, fresh[0]?.params.capture_method], [1, 'automatic']);

    // Capture fails and the fresh charge is declined: trip "failed" to pay, ops see it, the rider pays later.
    const t2 = await rideFor('sr');
    await offeredTo(t2.trip.id, ['d1']);
    fake.pis.get(t2.trip.payment_ref).status = 'canceled';
    fake.declineNext = true;
    const done2 = await rideToEnd(t2.trip.id, 'd1');
    assert.equal(done2.payment_status, 'failed');
    const issues = await call('GET', '/admin/payments/issues', 'admin');
    assert.equal(issues.failed.find((f: any) => f.id === t2.trip.id)?.reason, 'insufficient_funds');
    assert.equal((await call('GET', '/admin/payments/issues', 'dispatcher')).status, 403);
    assert.equal((await call('GET', `/trips/${t2.trip.id}/receipt`, 'sr')).receipt.payment_status, 'failed');
    const paid = await call('POST', `/trips/${t2.trip.id}/pay`, 'sr');
    assert.deepEqual([paid.ok, paid.payment_status], [true, 'captured']);
    assert.equal(reqsTo('/v1/payment_intents', (r) => r.headers['idempotency-key'] === `retry-${t2.trip.id}-1-${done2.final_cents}`).length, 1);
    assert.equal((await call('POST', `/trips/${t2.trip.id}/pay`, 'sr')).error, 'nothing_to_pay');
    assert.equal((await call('POST', `/trips/${t2.trip.id}/pay`, 'rider')).status, 404, 'only the rider (or staff) can pay it');
    assert.ok(!(await call('GET', '/admin/payments/issues', 'admin')).failed.some((f: any) => f.id === t2.trip.id));
  });
});

test('Stripe webhook: secret and valid signature required; disputes tracked for ops; unknown events ignored', async () => {
  const evt = { id: 'evt_nosecret', type: 'payment_intent.succeeded', data: { object: { id: 'pi_x' } } };
  assert.deepEqual([(await hook(evt)).status, (await hook(evt)).error], [503, 'webhook_not_configured']);
  await withStripe(async () => {
    assert.equal((await hook(evt, 'whsec_wrong')).error, 'bad_signature');
    assert.equal((await hook(evt, 'whsec_test', Math.floor(Date.now() / 1000) - 1000)).error, 'signature_expired');
    const unsigned = await app.inject({ method: 'POST', url: '/payments/stripe/webhook', payload: JSON.stringify(evt), headers: { 'content-type': 'application/json' } });
    assert.equal(unsigned.statusCode, 400);
    assert.equal((await hook({ id: 'evt_other', type: 'customer.created', data: { object: { id: 'cus_1' } } })).handled, 'ignored');

    const dispute = (id: string, type: string, status: string) => ({ id, type, data: { object: { id: 'dp_test1', payment_intent: stripeTrip.payment_ref, amount: 1500, status, reason: 'fraudulent' } } });
    assert.equal((await hook(dispute('evt_dp_1', 'charge.dispute.created', 'needs_response'))).handled, 'dispute_opened');
    assert.equal((await hook(dispute('evt_dp_1', 'charge.dispute.created', 'needs_response'))).duplicate, true);
    let issues = await call('GET', '/admin/payments/issues', 'admin');
    const open = issues.disputes.find((d: any) => d.dispute_ref === 'dp_test1');
    assert.deepEqual([open?.trip_id, open?.cents, open?.status], [stripeTrip.id, 1500, 'needs_response']);
    assert.ok(await one(`SELECT 1 FROM trip_events WHERE trip_id = $1 AND type = 'dispute_opened'`, [stripeTrip.id]));
    assert.equal((await hook(dispute('evt_dp_2', 'charge.dispute.closed', 'won'))).handled, 'dispute_closed');
    issues = await call('GET', '/admin/payments/issues', 'admin');
    assert.ok(!issues.disputes.some((d: any) => d.dispute_ref === 'dp_test1'));
    assert.equal((await one(`SELECT count(*)::int n, max(status) s FROM payments WHERE kind = 'dispute' AND provider_ref = 'dp_test1'`)).n, 1);
    // Disputes are not GST events.
    const gst = await call('GET', '/admin/reports/gst', 'admin');
    if (gst.rows) assert.ok(!gst.rows.some((r: any) => r.kind === 'dispute'));
  });
});

test('mock cards: only test accounts in production mode (others: coming soon); top-up and Pass replays charge once; fee invoices show the fee and the NDIS number', async () => {
  const prev = config.mockCards;
  config.mockCards = 'test';
  try {
    await login('plain', '+61400000872');
    const pm = await call('GET', '/payment-methods', 'plain');
    assert.deepEqual([pm.cards.mode, pm.methods.length], ['off', 0]);
    for (const [m, u, b] of [['POST', '/trips', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card' }],
      ['POST', '/wallet/topup', { cents: 2000 }], ['POST', '/payment-methods/setup', {}], ['POST', '/payment-methods', { provider_ref: 'pm_test_1', brand: 'Visa', last4: '4242' }]] as const) {
      const r = await call(m, u, 'plain', b);
      assert.deepEqual([r.status, r.error], [402, 'cards_not_available'], u);
    }
    assert.equal((await call('GET', '/payment-methods', 'rider')).cards.mode, 'test', 'seeded demo number');
    await q(`UPDATE users SET test_account = true WHERE phone = '+61400000872'`);
    assert.equal((await call('GET', '/payment-methods', 'plain')).cards.mode, 'test', 'admin-made test account');
  } finally { config.mockCards = prev; }

  const w0 = await wallet();
  const t1 = await callH('POST', '/wallet/topup', 'rider', { cents: 2000 }, { 'idempotency-key': 'topup-key-0001' });
  const t2 = await callH('POST', '/wallet/topup', 'rider', { cents: 2000 }, { 'idempotency-key': 'topup-key-0001' });
  assert.deepEqual([t1.wallet_cents, t2.wallet_cents, t2.replayed], [w0 + 2000, w0 + 2000, true]);
  assert.equal((await callH('POST', '/wallet/topup', 'rider', { cents: 2000 }, { 'idempotency-key': 'topup-key-0002' })).wallet_cents, w0 + 4000);
  const plan = (await call('GET', '/plans', 'rider')).plans[0];
  if (plan) {
    const p1 = await callH('POST', '/subscriptions', 'rider', { plan_code: plan.code }, { 'idempotency-key': 'pass-key-0001' });
    const p2 = await callH('POST', '/subscriptions', 'rider', { plan_code: plan.code }, { 'idempotency-key': 'pass-key-0001' });
    assert.equal(p2.replayed, true);
    assert.equal(p1.subscription.id ?? p1.subscription.user_id, p2.subscription.id ?? p2.subscription.user_id);
    assert.equal((await one(`SELECT count(*)::int n FROM payments WHERE kind = 'subscription' AND provider_ref = (SELECT provider_ref FROM subscriptions WHERE user_id = (SELECT id FROM users WHERE phone = '+61400000100'))`)).n, 1);
  }

  // Cards: default and remove (the next card becomes the default).
  const a = (await call('POST', '/payment-methods', 'plain', { provider_ref: 'pm_test_a', brand: 'Visa', last4: '1111' })).method;
  const b = (await call('POST', '/payment-methods', 'plain', { provider_ref: 'pm_test_b', brand: 'Mastercard', last4: '2222' })).method;
  assert.deepEqual([a.is_default, b.is_default], [true, false]);
  assert.equal((await call('POST', `/payment-methods/${b.id}/default`, 'plain')).ok, true);
  assert.equal((await call('GET', '/payment-methods', 'plain')).methods[0].id, b.id, 'default listed first');
  assert.equal((await call('POST', `/payment-methods/${b.id}/default`, 'rider')).status, 404, 'not your card');
  await call('DELETE', `/payment-methods/${b.id}`, 'plain');
  const left = (await call('GET', '/payment-methods', 'plain')).methods;
  assert.deepEqual(left.map((m: any) => [m.id, m.is_default]), [[a.id, true]]);

  // A cancellation-fee invoice shows the fee, not the trip's fare lines; NDIS number on the invoice.
  const fee = await one(`SELECT id, cancel_fee_cents FROM trips WHERE cancel_fee_cents > 0 AND status <> 'completed' AND rider_id = (SELECT id FROM users WHERE phone = '+61400000100') LIMIT 1`);
  assert.ok(fee, 'an earlier test left a fee trip');
  await q(`UPDATE trips SET ndis_number = '430000001' WHERE id = $1`, [fee.id]);
  const rc = (await call('GET', `/trips/${fee.id}/receipt`, 'rider')).receipt;
  assert.deepEqual(rc.lines, [{ label: 'Cancellation fee', cents: fee.cancel_fee_cents }]);
  assert.deepEqual([rc.fare_cents, rc.gst_cents, rc.cancellation_fee, rc.customer.ndis_number, rc.co2_saved_kg], [fee.cancel_fee_cents, Math.round(fee.cancel_fee_cents / 11), true, '430000001', null]);
  assert.match(rc.gst_note, /^Total includes GST of \$/);
});

// ───────────── Round 9: notifications and communications (fake Twilio / FCM / Web Push on localhost, no network) ─────────────
const comms = {
  url: '', sms: [] as { params: Record<string, string>; auth: string }[], fcm: [] as any[], fcmAuth: [] as any[], web: [] as { id: string; headers: http.IncomingHttpHeaders; body: Buffer }[],
  twilioError: null as null | { status: number; body: any }, fcmDead: new Set<string>(), webDead: new Set<string>(), n: 0,
};
const fcmKeys = crypto.generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const commsServer = http.createServer((req, res) => {
  const chunks: Buffer[] = [];
  req.on('data', (d) => chunks.push(d));
  req.on('end', () => {
    const raw = Buffer.concat(chunks); const u = new URL(req.url ?? '/', 'http://x');
    const send = (status: number, body: any) => { res.writeHead(status, { 'content-type': 'application/json' }); res.end(JSON.stringify(body)); };
    if (u.pathname === '/2010-04-01/Accounts/AC_test/Messages.json') {
      if (req.headers.authorization !== 'Basic ' + Buffer.from('AC_test:twtok').toString('base64')) return send(401, { code: 20003, message: 'auth' });
      if (comms.twilioError) return send(comms.twilioError.status, comms.twilioError.body);
      comms.sms.push({ params: Object.fromEntries(new URLSearchParams(raw.toString())), auth: req.headers.authorization! });
      return send(201, { sid: `SM${++comms.n}`, status: 'queued' });
    }
    if (u.pathname === '/oauth/token') {
      const p = new URLSearchParams(raw.toString());
      const [h, c, s] = String(p.get('assertion')).split('.');
      const ok = crypto.verify('RSA-SHA256', Buffer.from(`${h}.${c}`), fcmKeys.publicKey, Buffer.from(s, 'base64url'));
      comms.fcmAuth.push({ ok, grant: p.get('grant_type'), claims: JSON.parse(Buffer.from(c, 'base64url').toString()) });
      return ok ? send(200, { access_token: 'ya29.fake', expires_in: 3600 }) : send(400, { error: 'invalid_grant' });
    }
    if (u.pathname === '/v1/projects/dingogo-test/messages:send') {
      if (req.headers.authorization !== 'Bearer ya29.fake') return send(401, { error: { status: 'UNAUTHENTICATED' } });
      const m = JSON.parse(raw.toString()).message;
      if (comms.fcmDead.has(m.token)) return send(404, { error: { status: 'NOT_FOUND', message: 'Requested entity was not found.', details: [{ errorCode: 'UNREGISTERED' }] } });
      comms.fcm.push(m);
      return send(200, { name: 'projects/dingogo-test/messages/1' });
    }
    const push = u.pathname.match(/^\/push\/(.+)$/);
    if (push) {
      if (comms.webDead.has(push[1])) { res.writeHead(410); return res.end(); }
      comms.web.push({ id: push[1], headers: req.headers, body: raw });
      res.writeHead(201); return res.end();
    }
    send(404, { message: 'fake comms: no route ' + u.pathname });
  });
});
after(() => { commsServer.close(); });
const RELAY = '+61480000999';
async function withComms<T>(fn: () => Promise<T>): Promise<T> {
  if (!comms.url) { await new Promise<void>((r) => commsServer.listen(0, '127.0.0.1', r)); comms.url = `http://127.0.0.1:${(commsServer.address() as AddressInfo).port}`; }
  const prevT = { ...config.twilio }; const prevP = { ...config.push };
  Object.assign(config.twilio, { sid: 'AC_test', token: 'twtok', from: 'DingoGo', messagingServiceSid: '', marketingFrom: '', relayNumber: RELAY,
    webhookBaseUrl: 'https://api.test', apiBase: comms.url, timeoutMs: 3000 });
  Object.assign(config.push, { fcmServiceAccount: JSON.stringify({ project_id: 'dingogo-test', client_email: 'push@dingogo-test.iam.gserviceaccount.com',
    private_key: fcmKeys.privateKey, token_uri: `${comms.url}/oauth/token` }), fcmApiBase: comms.url, ...vapid, timeoutMs: 3000 });
  process.env.WEB_PUSH_ALLOW_HTTP = '1';
  try { return await fn(); } finally { Object.assign(config.twilio, prevT); Object.assign(config.push, prevP); delete process.env.WEB_PUSH_ALLOW_HTTP; }
}
const vapid = (() => { const k = generateVapidKeys(); return { vapidPublicKey: k.publicKey, vapidPrivateKey: k.privateKey, vapidSubject: 'mailto:test@dingogo.test' }; })();
async function twilioHook(path: string, params: Record<string, string>, sig?: string) {
  const res = await app.inject({ method: 'POST', url: path, payload: new URLSearchParams(params).toString(),
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-twilio-signature': sig ?? twilioSignature('twtok', 'https://api.test' + path, params) } });
  return { status: res.statusCode, body: res.body, type: String(res.headers['content-type'] ?? '') };
}

test('trip chat: quick replies, replay-safe sends, read receipts, polling cursor, strangers kept out, ops can read and write, closes 30 min after drop-off', async () => {
  await clearOpenTrips();
  await onlyOnline(['d1']);
  const trip = await book();
  await waitForOffer('d1');
  assert.equal((await call('POST', `/driver/offers/${trip.id}/accept`, 'd1')).status, 200);
  const url = `/trips/${trip.id}/messages`;
  const first = await call('GET', url, 'rider');
  assert.deepEqual([first.status, first.messages.length, first.can_send, first.role], [200, 0, true, 'rider']);
  assert.ok(first.quick_replies.some((r: any) => r.key === 'coming_out'));
  const dq = (await call('GET', url, 'd1')).quick_replies.map((r: any) => r.key);
  assert.ok(dq.includes('outside') && !dq.includes('at_door'), 'ride quick replies for the driver');

  const m1 = await call('POST', url, 'rider', { quick: 'coming_out', client_id: 'chat-msg-0001' });
  assert.deepEqual([m1.status, m1.message.body, m1.message.mine, m1.message.from], [201, "I'm coming out now", true, 'rider']);
  const again = await call('POST', url, 'rider', { quick: 'coming_out', client_id: 'chat-msg-0001' });
  assert.deepEqual([again.status, again.replayed, again.message.id], [200, true, m1.message.id], 'a retried send is stored once');
  assert.equal((await call('POST', url, 'rider', { quick: 'no_such' })).error, 'bad_quick_reply');
  assert.equal((await call('POST', url, 'rider', { body: '  \u0007  ' })).error, 'empty_message');
  const long = await call('POST', url, 'rider', { body: 'Gate\u0000 code\n\n\n\nis 1234 ' + 'x'.repeat(600) });
  assert.equal(long.status, 201);
  assert.ok(long.message.body.startsWith('Gate code\n\nis 1234') && long.message.body.length === 500, 'cleaned and capped');
  assert.equal((await call('GET', url, 'd2')).status, 404, 'another driver can\'t read it');
  assert.equal((await call('POST', url, 'd2', { body: 'hi' })).status, 404);

  const peek = await call('GET', `${url}?peek=1`, 'd1');
  assert.equal(peek.unread, 2);
  assert.ok(peek.messages.every((m: any) => !m.read_at), 'peeking leaves them unread');
  await call('GET', url, 'd1');
  assert.ok((await call('GET', url, 'rider')).messages.every((m: any) => m.read_at), 'rider sees "Read"');
  const reply = await call('POST', url, 'd1', { body: 'Be there in 2' });
  const since = await call('GET', `${url}?after=${long.message.id}`, 'rider');
  assert.deepEqual(since.messages.map((m: any) => [m.id, m.from, m.mine]), [[reply.message.id, 'driver', false]], 'only what is new');
  assert.equal((await one(`SELECT count(*)::int n FROM notifications WHERE category = 'chat'`)).n, 0, 'chat stays out of the inbox');

  const ops = await call('POST', url, 'admin', { body: 'DingoGo here. All OK?' });
  assert.deepEqual([ops.status, ops.message.from], [201, 'dingogo']);
  assert.equal((await call('GET', url, 'admin')).role, 'dingogo');
  assert.equal((await call('GET', `${url}?peek=1`, 'rider')).unread, 1, 'the DingoGo message is unread for the rider');
  assert.equal((await one(`SELECT read_at FROM trip_messages WHERE id = $1`, [ops.message.id])).read_at, null, 'staff reading the thread marks nothing read');
  const drawer = await call('GET', `/admin/trips/${trip.id}`, 'admin');
  assert.deepEqual(drawer.messages.map((m: any) => m.sender_role), ['rider', 'rider', 'driver', 'dingogo']);
  const contact = await call('GET', `/trips/${trip.id}/contact`, 'rider');
  assert.deepEqual([contact.chat, contact.call, contact.reason], [true, null, 'relay_off'], 'no relay number: chat only');

  // 20 messages per 5 minutes per person per trip.
  for (let i = 0; i < 18; i++) assert.equal((await call('POST', url, 'rider', { body: `m${i}` })).status, 201);
  assert.equal((await call('POST', url, 'rider', { body: 'one too many' })).status, 429);

  await q(`UPDATE trips SET status = 'completed', completed_at = now() - interval '10 minutes' WHERE id = $1`, [trip.id]);
  const after10 = await call('GET', url, 'd1');
  assert.ok(after10.can_send && after10.closes_at, 'still open just after drop-off (left something in the car)');
  await q(`UPDATE trips SET completed_at = now() - interval '31 minutes' WHERE id = $1`, [trip.id]);
  assert.equal((await call('GET', url, 'd1')).can_send, false);
  assert.equal((await call('POST', url, 'd1', { body: 'late' })).error, 'chat_closed');
  assert.equal((await call('POST', url, 'admin', { body: 'Follow-up from DingoGo' })).status, 201, 'staff can still write');
  const exp = await call('GET', '/me/export', 'rider');
  assert.ok(exp.messages.some((m: any) => m.body === "I'm coming out now"), 'messages are in the data export');
});

test('SMS: Twilio behind config (sender ID, log without the text), unsubscribed numbers remembered, signed webhook with STOP / START / HELP and consent records', async () => {
  await withComms(async () => {
    comms.sms = [];
    const r = await call('POST', '/auth/otp/request', undefined, { phone: '0400 000 861' }, '10.9.9.1');
    assert.equal(r.status, 200, JSON.stringify(r));
    await flushBackground();
    const otp = comms.sms.at(-1)!;
    assert.deepEqual([otp.params.To, otp.params.From], ['+61400000861', 'DingoGo']);
    assert.ok(otp.params.Body.includes(r.dev_code));
    const log = await one(`SELECT * FROM comms_log WHERE template = 'otp' ORDER BY id DESC LIMIT 1`);
    assert.deepEqual([log.to_tail, log.status, log.channel], ['861', 'sent', 'sms']);
    assert.ok(log.provider_ref.startsWith('SM'));
    assert.ok(!Object.values(log).some((v) => String(v).includes(r.dev_code)), 'the code is never stored');

    comms.twilioError = { status: 400, body: { code: 21610, message: 'Attempt to send to unsubscribed recipient' } };
    assert.equal((await sendSmsNow('+61400000870', 'DingoGo: test')).status, 'unsubscribed');
    comms.twilioError = null;
    assert.equal((await one(`SELECT source FROM sms_opt_outs WHERE phone = '+61400000870'`)).source, 'carrier');
    const before = comms.sms.length;
    assert.equal((await sendSmsNow('+61400000870', 'DingoGo: test 2')).status, 'skipped_opt_out');
    assert.equal(comms.sms.length, before, 'nothing sent to an unsubscribed number');
    assert.equal((await sendSmsNow('+61400000870', 'DingoGo code', { kind: 'essential' })).sent, true, 'a sign-in code they asked for still goes');
    comms.twilioError = { status: 500, body: { message: 'oops' } };
    assert.equal((await sendSmsNow('+61400000869', 'DingoGo: x')).status, 'failed');
    comms.twilioError = null;

    // Webhook: signed requests only.
    const stopP = { From: '+61400000100', To: '+61480000111', Body: 'Stop' };
    assert.equal((await twilioHook('/comms/twilio/sms', stopP, 'bad')).status, 403);
    config.twilio.token = '';
    assert.equal((await twilioHook('/comms/twilio/sms', stopP)).status, 503);
    config.twilio.token = 'twtok';

    await call('PUT', '/me/notification-prefs', 'rider', { marketing: false });
    const yes = await call('PUT', '/me/notification-prefs', 'rider', { marketing: true });
    assert.equal(yes.marketing.opted_in, true);
    const stop = await twilioHook('/comms/twilio/sms', stopP);
    assert.equal(stop.status, 200);
    assert.ok(stop.type.startsWith('text/xml') && /<Message>.*START.*<\/Message>/.test(stop.body));
    const after = await call('GET', '/me/notification-prefs', 'rider');
    assert.deepEqual([after.marketing.opted_in, after.sms_opted_out, after.marketing.last_change.source], [false, true, 'sms_stop']);
    const consents = await q(`SELECT granted, source, wording, ip FROM marketing_consents WHERE user_id = (SELECT id FROM users WHERE phone = '+61400000100') ORDER BY id DESC LIMIT 2`);
    assert.deepEqual(consents.map((c) => [c.granted, c.source]), [[false, 'sms_stop'], [true, 'app']]);
    assert.match(consents[1].wording, /offers/);
    assert.ok(consents[1].ip, 'where consent was given from');
    const start = await twilioHook('/comms/twilio/sms', { ...stopP, Body: 'START' });
    assert.match(start.body, /back on/);
    const again = await call('GET', '/me/notification-prefs', 'rider');
    assert.deepEqual([again.sms_opted_out, again.marketing.opted_in], [false, false], 'START turns texts back on but not offers');
    assert.match((await twilioHook('/comms/twilio/sms', { ...stopP, Body: 'help' })).body, /STOP/);
    // Someone without an account (a parcel recipient) can stop texts too.
    await twilioHook('/comms/twilio/sms', { From: '+61400000868', To: '+61480000111', Body: 'UNSUBSCRIBE' });
    assert.ok(await one(`SELECT 1 FROM sms_opt_outs WHERE phone = '+61400000868'`));
    assert.ok(await one(`SELECT 1 FROM marketing_consents WHERE phone = '+61400000868' AND user_id IS NULL AND granted = false`));
    // A text that isn't a keyword to a number that isn't the relay: no reply.
    assert.match((await twilioHook('/comms/twilio/sms', { From: '+61400000867', To: '+61480000111', Body: 'hello?' })).body, /<Response\/>/);
    // PATCH /me (older app) records consent too.
    await call('PATCH', '/me', 'rider', { marketing_opt_in: true });
    await call('PATCH', '/me', 'rider', { marketing_opt_in: false });
    const appRows = await q(`SELECT granted FROM marketing_consents WHERE user_id = (SELECT id FROM users WHERE phone = '+61400000100') AND source = 'app' ORDER BY id DESC LIMIT 2`);
    assert.deepEqual(appRows.map((r) => r.granted), [false, true]);
  });
});

test('relay number: masked calls and texts between rider and driver; phone bookings get trip texts; chat to a phone rider goes by text', async () => {
  await withComms(async () => {
    await clearOpenTrips();
    await onlyOnline(['d1']);
    comms.sms = [];
    const pb = await call('POST', '/admin/bookings', 'admin', { phone: '0400 123 456', name: 'Nan Phone', trip: { kind: 'courier', service: 'courier_s', pickup: TODD_MALL, dropoff: HOSPITAL,
      parcel: { size: 'S', description: 'Medicine', sender_name: 'Nan Phone', sender_phone: '0400123456', recipient_name: 'Aunty', recipient_phone: '0400123455', prohibited_ack: true } } });
    assert.equal(pb.status, 201, JSON.stringify(pb));
    const id = pb.trip.id;
    await waitForOffer('d1');
    assert.equal((await call('POST', `/driver/offers/${id}/accept`, 'd1')).status, 200);
    await flushBackground();
    const pin = (await one('SELECT delivery_pin FROM parcels WHERE trip_id = $1', [id])).delivery_pin;
    assert.ok(comms.sms.some((s) => s.params.To === '+61400123455' && s.params.Body.includes(pin)), 'recipient got the PIN');
    assert.ok(comms.sms.some((s) => s.params.To === '+61400123456' && /on the way/.test(s.params.Body)), 'phone-booked rider got "on the way" by text');
    assert.ok(comms.sms.every((s) => !/[—’]/.test(s.params.Body)), 'texts are plain GSM characters');

    const contact = await call('GET', `/trips/${id}/contact`, 'd1');
    assert.equal(contact.call.number, RELAY);
    const fromDriver = await twilioHook('/comms/twilio/voice', { From: '+61400000011', To: RELAY, CallSid: 'CA100' });
    assert.match(fromDriver.body, new RegExp(`<Dial callerId="\\${RELAY}"[^>]*><Number>\\+61400123456</Number>`));
    assert.match(fromDriver.body, /your DingoGo rider/);
    const fromRider = await twilioHook('/comms/twilio/voice', { From: '+61400123456', To: RELAY, CallSid: 'CA101' });
    assert.match(fromRider.body, /<Number>\+61400000011<\/Number>/);
    const stranger = await twilioHook('/comms/twilio/voice', { From: '+61400999999', To: RELAY });
    assert.ok(!/<Dial/.test(stranger.body) && /couldn't find a live DingoGo trip/.test(stranger.body));
    assert.equal((await q(`SELECT 1 FROM trip_events WHERE trip_id = $1 AND type = 'relay_call'`, [id])).length, 2);

    // The rider texts the relay: it lands in the trip chat for the driver.
    const t = await twilioHook('/comms/twilio/sms', { From: '+61400123456', To: RELAY, Body: "I'm at the front gate" });
    assert.match(t.body, /<Response\/>/);
    const thread = await call('GET', `/trips/${id}/messages`, 'd1');
    assert.deepEqual([thread.messages.at(-1).body, thread.messages.at(-1).via, thread.messages.at(-1).from], ["I'm at the front gate", 'sms', 'rider']);
    // The driver answers in the app: passed on by text from the relay, so Nan can reply.
    comms.sms = [];
    await call('POST', `/trips/${id}/messages`, 'd1', { body: 'Coming to the gate now' });
    await flushBackground();
    const fwd = comms.sms.find((s) => s.params.To === '+61400123456')!;
    assert.equal(fwd.params.From, RELAY);
    assert.match(fwd.params.Body, /^DingoGo driver \w+: Coming to the gate now/);
    // Nobody's trip: polite reply.
    assert.match((await twilioHook('/comms/twilio/sms', { From: '+61400999999', To: RELAY, Body: 'hello' })).body, /couldn't find a live trip/);
    const drawer = await call('GET', `/admin/trips/${id}`, 'admin');
    const kinds = drawer.comms.map((c: any) => c.template);
    assert.ok(kinds.includes('driver_on_way') && kinds.includes('chat_relay_sms') && kinds.includes('relay_call'));
    assert.ok(drawer.comms.every((c: any) => c.body === undefined), 'no text kept in the log');
    await call('POST', `/admin/trips/${id}/cancel`, 'admin', {});
  });
});

test('push: FCM and Web Push behind config; settings respected, safety always, offers need consent; dead tokens removed; broadcast by text follows the Spam Act', async () => {
  await withComms(async () => {
    const rider = (await one(`SELECT id FROM users WHERE phone = '+61400000100'`)).id;
    await q('DELETE FROM push_tokens WHERE user_id = $1', [rider]);
    await call('PUT', '/me/notification-prefs', 'rider', { marketing: false });
    const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = crypto.randomBytes(16);
    const sub = (p: string) => JSON.stringify({ endpoint: `${comms.url}/push/${p}`, keys: { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') } });
    for (const [token, platform] of [['fcm-token-good-123', 'android'], ['fcm-token-dead-456', 'android'], [sub('good'), 'web'], [sub('gone'), 'web']]) {
      assert.equal((await call('POST', '/me/push-token', 'rider', { token, platform })).status, 200);
    }
    comms.fcmDead.add('fcm-token-dead-456'); comms.webDead.add('gone');
    comms.fcm = []; comms.web = [];
    await notify(rider, 'Test title', 'Test body', { trip_id: 'abc', n: 1 }, 'trip');
    await flushBackground();
    assert.equal(comms.fcm.length, 1);
    assert.deepEqual([comms.fcm[0].token, comms.fcm[0].notification.title, comms.fcm[0].data.trip_id, comms.fcm[0].data.n], ['fcm-token-good-123', 'Test title', 'abc', '1']);
    assert.ok(comms.fcmAuth.at(-1).ok && comms.fcmAuth.at(-1).claims.scope.includes('firebase.messaging'), 'service-account JWT signed with the key');
    assert.equal(comms.web.length, 1);
    assert.equal(JSON.parse(decryptWebPush(comms.web[0].body, ua, auth)).title, 'Test title');
    assert.match(String(comms.web[0].headers.authorization), /^vapid t=.+, k=/);
    assert.equal(comms.web[0].headers['content-encoding'], 'aes128gcm');
    const left = (await q('SELECT token FROM push_tokens WHERE user_id = $1', [rider])).map((r) => r.token);
    assert.equal(left.length, 2, 'dead tokens removed');

    const prefs = await call('GET', '/me/notification-prefs', 'rider');
    assert.deepEqual(prefs.prefs, { push: { trip: true, chat: true, account: true, documents: true, promo: true }, sms: { trip: false } });
    assert.ok(!prefs.categories.some((c: any) => c.key === 'documents'), 'riders have no papers');
    assert.ok(prefs.categories.find((c: any) => c.key === 'safety').locked);
    assert.deepEqual(prefs.channels.push, { fcm: true, web: true, expo: false });
    assert.ok((await call('GET', '/me/notification-prefs', 'd1')).categories.some((c: any) => c.key === 'documents'));
    assert.equal((await call('PUT', '/me/notification-prefs', 'rider', { push: { nope: true } })).status, 400);
    assert.equal((await call('PUT', '/me/notification-prefs', 'rider', { push: { trip: false } })).prefs.push.trip, false);
    comms.fcm = []; comms.web = [];
    await notify(rider, 'Quiet trip update', 'x', {}, 'trip');
    await notify(rider, 'Safety check', 'x', {}, 'safety');
    await notify(rider, 'Big sale', 'x', {}, 'promo');
    await flushBackground();
    assert.deepEqual(comms.fcm.map((m) => m.notification.title), ['Safety check'], 'trip push off; safety always; offers need consent');
    assert.ok(await one(`SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'Quiet trip update'`, [rider]), 'inbox still has it');
    assert.equal(await one(`SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'Big sale'`, [rider]), null, 'no offer without consent');

    // Texts for trip updates when the rider asks for them.
    assert.equal((await call('PUT', '/me/notification-prefs', 'rider', { sms: { trip: true }, push: { trip: true } })).prefs.sms.trip, true);
    comms.sms = [];
    await send(rider, 'driver_here', { ride: true, rego: 'CD12AB', pin: '1234', ref: 'DG-TEST' }, { trip: { id: (await one('SELECT id FROM trips LIMIT 1')).id, channel: 'app' } });
    await flushBackground();
    assert.ok(comms.sms.some((s) => s.params.To === '+61400000100' && /your driver is here/.test(s.params.Body)));
    await call('PUT', '/me/notification-prefs', 'rider', { sms: { trip: false } });

    // Offers by text: opted-in riders, a sender that takes STOP replies, never a number that opted out.
    await call('PUT', '/me/notification-prefs', 'rider', { marketing: true });
    const noReply = await call('POST', '/admin/broadcast', 'admin', { audience: 'riders_opted_in', title: 'Deal', body: 'Half price coffee at the Todd Mall.', channel: 'sms' });
    assert.deepEqual([noReply.status, noReply.error], [409, 'sms_marketing_unavailable'], 'an alphanumeric sender ID can\'t take STOP');
    config.twilio.marketingFrom = '+61480000001';
    assert.equal((await call('POST', '/admin/broadcast', 'admin', { audience: 'drivers', title: 'Deal', body: 'x y z', channel: 'sms' })).error, 'sms_riders_only');
    await q(`INSERT INTO users (phone, name, referral_code, marketing_opt_in) VALUES ('+61400000866', 'Opted Out', 'OPTOUT866', true) ON CONFLICT DO NOTHING`);
    await twilioHook('/comms/twilio/sms', { From: '+61400000866', To: '+61480000001', Body: 'STOP' });
    await q(`UPDATE users SET marketing_opt_in = true WHERE phone = '+61400000866'`);   // e.g. said yes in the app again: texts still stay off
    comms.sms = [];
    const b = await call('POST', '/admin/broadcast', 'admin', { audience: 'riders_opted_in', title: 'Deal', body: 'Half price coffee at the Todd Mall.', channel: 'sms' });
    assert.equal(b.status, 200, JSON.stringify(b));
    assert.ok(b.skipped >= 1);
    const txt = comms.sms.find((s) => s.params.To === '+61400000100')!;
    assert.deepEqual([txt.params.From, txt.params.Body], ['+61480000001', 'DingoGo: Half price coffee at the Todd Mall. Reply STOP to opt out.']);
    assert.ok(!comms.sms.some((s) => s.params.To === '+61400000866'));
    const app1 = await call('POST', '/admin/broadcast', 'admin', { audience: 'riders_opted_in', title: 'Deal', body: 'In the app' });
    assert.ok(app1.sent >= 1);
    assert.match((await one(`SELECT body FROM notifications WHERE user_id = $1 AND title = 'Deal' ORDER BY id DESC LIMIT 1`, [rider])).body, /Turn off offers/);
    await call('PUT', '/me/notification-prefs', 'rider', { marketing: false });

    assert.equal((await call('DELETE', '/me/push-token', 'rider', { token: 'fcm-token-good-123' })).removed, 1, 'sign-out stops pushes to this phone');
    const cfg = await call('GET', '/public/config');
    assert.deepEqual([cfg.push.web_push_key, cfg.push.fcm, cfg.comms.relay], [vapid.vapidPublicKey, true, true]);
    const integ = await call('GET', '/admin/integrations', 'admin');
    assert.deepEqual([integ.sms_relay, integ.push_fcm, integ.push_web, integ.sms_replies], ['configured', 'configured', 'configured', 'configured']);
  });
});

test('before migration 015: chat says migration_pending, settings fall back to defaults, texts and notifications still go', async () => {
  const renames = [['trip_messages', 'trip_messages_off'], ['comms_log', 'comms_log_off'], ['sms_opt_outs', 'sms_opt_outs_off'], ['marketing_consents', 'marketing_consents_off']];
  for (const [a, b] of renames) await q(`ALTER TABLE ${a} RENAME TO ${b}`);
  await q('ALTER TABLE users RENAME COLUMN notification_prefs TO notification_prefs_off');
  try {
    const t = await one(`SELECT id FROM trips WHERE rider_id = (SELECT id FROM users WHERE phone = '+61400000100') ORDER BY requested_at DESC LIMIT 1`);
    const m = await call('GET', `/trips/${t.id}/messages`, 'rider');
    assert.deepEqual([m.status, m.error], [503, 'migration_pending']);
    const p = await call('GET', '/me/notification-prefs', 'rider');
    assert.deepEqual([p.status, p.prefs.push.trip, p.marketing.last_change, p.sms_opted_out], [200, true, null, false]);
    assert.equal((await call('PUT', '/me/notification-prefs', 'rider', { push: { trip: false } })).error, 'migration_pending');
    assert.equal((await call('PUT', '/me/notification-prefs', 'rider', { marketing: false })).status, 200, 'the opt-in flag itself still saves');
    assert.equal((await call('POST', '/auth/otp/request', undefined, { phone: '0400 000 862' }, '10.9.9.2')).status, 200);
    const rider = (await one(`SELECT id FROM users WHERE phone = '+61400000100'`)).id;
    const row = await notify(rider, 'Still works', 'x', {}, 'account');
    assert.equal(row?.title, 'Still works');
    assert.equal((await call('GET', `/admin/trips/${t.id}`, 'admin')).messages.length, 0);
    assert.equal((await call('GET', '/me/export', 'rider')).status, 200);
  } finally {
    await q('ALTER TABLE users RENAME COLUMN notification_prefs_off TO notification_prefs');
    for (const [a, b] of renames) await q(`ALTER TABLE ${b} RENAME TO ${a}`);
  }
});

// ───────────────────────── Round 11: courier and delivery business ─────────────────────────
import { auMobile, auPhone, checkParcel, csvToDrops, orderStops, parseCsv as parseCsvText, PROHIBITED_KEYS, SIZE_MAX_KG } from '../src/lib/courier.js';
import { readFileSync } from 'node:fs';
import { resetCourierReady } from '../src/lib/courierSchema.js';
import { engagedFromSql } from '../src/services/courier.js';
import { pickupWhen } from '../src/services/trips.js';

const ALL_ITEMS = [...PROHIBITED_KEYS];
const YEPERENYE = { lat: -23.7008, lng: 133.8818, address: 'Yeperenye Shopping Centre' };
const ARALUEN = { lat: -23.7036, lng: 133.8622, address: 'Araluen Arts Centre' };
const BRAITLING = { lat: -23.6830, lng: 133.8680, address: 'Braitling' };
const drop = (name: string, extra: Record<string, unknown> = {}) => ({ size: 'S', description: 'Prescription', recipient_name: name, recipient_phone: '0400 000 555', ...extra });
const smsCount = async (tripId: string, template: string) => {
  await flushBackground(3000);
  return (await one<{ n: number }>(`SELECT count(*)::int n FROM comms_log WHERE trip_id = $1 AND template = $2`, [tripId, template]))!.n;
};

test('courier: top up the demo rider for the Round 11 deliveries', async () => {
  await q(`UPDATE users SET wallet_cents = wallet_cents + 100000 WHERE phone = '+61400000100'`);
});

test('courier rules: sizes and weights, Australian mobiles, checklist, CSV parsing, drop order, pickup times', () => {
  const p = { size: 'S' as const, description: 'Box', sender_name: 'Shop', sender_phone: '08 8950 1234', recipient_name: 'Jo', recipient_phone: '0412 345 678', prohibited_ack: false };
  assert.equal(auMobile('+61 412 345 678'), '+61412345678');
  assert.equal(auMobile('0889501234'), null, 'a landline cannot get texts');
  assert.equal(auPhone('(08) 8950 1234'), '+61889501234');
  assert.throws(() => checkParcel({ ...p, prohibited_items: ALL_ITEMS, weight_kg: 7 }), /too heavy for size S.*Choose size M/);
  assert.throws(() => checkParcel({ ...p, prohibited_items: ALL_ITEMS, weight_kg: 30 }), /up to 25 kg/);
  assert.throws(() => checkParcel({ ...p, prohibited_items: ALL_ITEMS, recipient_phone: '08 8950 1234' }), /Australian mobile/);
  assert.throws(() => checkParcel({ ...p, prohibited_items: ALL_ITEMS.slice(1) }), /every line/);
  assert.throws(() => checkParcel(p), /no alcohol/);
  const ok = checkParcel({ ...p, prohibited_items: ALL_ITEMS, leave_unattended: true, safe_place: ' side gate ' });
  assert.deepEqual([ok.recipient_phone, ok.sender_phone, ok.safe_place, ok.checklist?.items.length], ['+61412345678', '+61889501234', 'side gate', ALL_ITEMS.length]);
  assert.equal(checkParcel({ ...p, prohibited_ack: true }).checklist, null, 'older apps: single tick still accepted');
  assert.deepEqual(SIZE_MAX_KG, { S: 5, M: 15, L: 25 });
  const shared = readFileSync(new URL('../../../packages/shared/src/courier.ts', import.meta.url), 'utf8');
  assert.deepEqual([...shared.matchAll(/\{ key: '([a-z_]+)', title/g)].map((m) => m[1]), ALL_ITEMS, 'apps and API use the same checklist');

  assert.deepEqual(parseCsvText('a,b\r\n"x, ""y""",2\n\n"multi\nline",3'), [['a', 'b'], ['x, "y"', '2'], ['multi\nline', '3']]);
  const r = csvToDrops('Name,Mobile,Address,Size,Weight,Reference,Safe place\n'
    + 'Jo Bloggs,0412 345 678,Araluen Arts Centre,M,8,ORD-1,\n'
    + 'Nan,0400000555,"Somewhere unknown, Gillen",S,,ORD-2,\n'
    + 'Bob,0889501234,Todd Mall,S,,,\n'
    + 'Al,0400000556,Todd Mall,S,9,,\n'
    + 'Sue,0400000557,Hospital,S,,ORD-5,front porch\n');
  assert.equal(r.drops.length, 2);
  assert.deepEqual(r.drops.map((d) => [d.row, d.parcel.customer_ref ?? null, d.parcel.leave_unattended]), [[2, 'ORD-1', false], [6, 'ORD-5', true]]);
  assert.deepEqual(r.errors.map((e) => e.row), [3, 4, 5]);
  assert.match(r.errors[0].error, /Couldn't find/);
  assert.match(r.errors[1].error, /Australian mobile/);
  assert.match(r.errors[2].error, /doesn't fit size S/);
  assert.match(csvToDrops('recipient_name,address\nJo,Todd Mall').errors[0].error, /Missing column "recipient_phone"/);

  const order = orderStops(TODD_MALL, [{ dropoff: AIRPORT, n: 1 }, { dropoff: YEPERENYE, n: 2 }, { dropoff: HOSPITAL, n: 3 }]);
  assert.deepEqual(order.map((o) => o.n), [2, 3, 1], 'nearest first, then nearest to the last drop');
  assert.equal(pickupWhen('2026-11-19T04:30:00Z', '2026-11-19T06:30:00Z'), 'Thu 2:00-4:00 pm');
  assert.ok(searchOver({ requested_at: new Date(), scheduled_for: new Date(), dispatch_attempts: 0 }, Date.now() + 3 * 3600_000));
  assert.ok(!searchOver({ requested_at: new Date(), scheduled_for: new Date(), pickup_window_end: new Date(Date.now() + 4 * 3600_000), dispatch_attempts: 0 }, Date.now() + 3 * 3600_000),
    'a pickup window keeps the search going to its end');
});

test('parcel booking: weight, recipient mobile and the full checklist checked; checklist, safe place and reference stored; config lists the rules', async () => {
  const base = { kind: 'courier', service: 'courier_s', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'wallet' };
  const parcel = { size: 'S', description: 'Script', sender_name: 'Central Pharmacy', sender_phone: '08 8950 1234', recipient_name: 'Nan', recipient_phone: '0400 000 555' };
  assert.equal((await call('POST', '/trips', 'rider', { ...base, parcel: { ...parcel, weight_kg: 9, prohibited_items: ALL_ITEMS } })).error, 'parcel_too_heavy');
  assert.equal((await call('POST', '/trips', 'rider', { ...base, parcel: { ...parcel, recipient_phone: '08 8950 9999', prohibited_items: ALL_ITEMS } })).error, 'recipient_mobile');
  const missing = await call('POST', '/trips', 'rider', { ...base, parcel: { ...parcel, prohibited_items: ['alcohol'] } });
  assert.equal(missing.error, 'prohibited_ack_required');
  assert.equal((await call('POST', '/trips', 'rider', { ...base, service: 'ride', kind: 'ride', scheduled_for: new Date(Date.now() + 3600_000).toISOString(),
    pickup_window_end: new Date(Date.now() + 7200_000).toISOString() })).error, 'validation_error', 'windows are for parcels');
  const shortWin = await call('POST', '/trips', 'rider', { ...base, parcel: { ...parcel, prohibited_items: ALL_ITEMS },
    scheduled_for: new Date(Date.now() + 3600_000).toISOString(), pickup_window_end: new Date(Date.now() + 3600_000 + 10 * 60000).toISOString() });
  assert.equal(shortWin.error, 'window_invalid');
  const t = await call('POST', '/trips', 'rider', { ...base, parcel: { ...parcel, weight_kg: 2, prohibited_items: ALL_ITEMS, leave_unattended: true, safe_place: 'Behind the side gate', customer_ref: 'RX-1001' },
    scheduled_for: new Date(Date.now() + 3600_000).toISOString(), pickup_window_end: new Date(Date.now() + 3 * 3600_000).toISOString() });
  assert.equal(t.status, 201, JSON.stringify(t));
  const p = await one('SELECT * FROM parcels WHERE trip_id = $1', [t.trip.id]);
  assert.deepEqual([p.recipient_phone, p.sender_phone, p.safe_place, p.customer_ref, p.prohibited_checklist.version], ['+61400000555', '+61889501234', 'Behind the side gate', 'RX-1001', 1]);
  assert.ok(t.trip.pickup_window_end, 'window stored');
  assert.equal(await smsCount(t.trip.id, 'parcel_recipient_booked'), 1, 'recipient told when it will be collected');
  const cfg = await call('GET', '/public/config');
  assert.deepEqual([cfg.courier.size_max_kg.L, cfg.courier.prohibited.keys.length, cfg.courier.runs], [25, ALL_ITEMS.length, true]);
  assert.equal((await call('POST', `/trips/${t.trip.id}/cancel`, 'rider', {})).trip.status, 'cancelled_rider');
});

test('pickup window: released at the start of the window (not 15 min early), searched until it closes', async () => {
  for (const w of ['d1', 'd2', 'd3']) await call('POST', '/driver/online', w, { online: false });
  const parcel = { size: 'S', description: 'Script', sender_name: 'Central Pharmacy', sender_phone: '08 8950 1234', recipient_name: 'Nan', recipient_phone: '0400 000 555', prohibited_items: ALL_ITEMS };
  const mk = (win: boolean) => call('POST', '/trips', 'rider', { kind: 'courier', service: 'courier_s', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'wallet', parcel,
    scheduled_for: new Date(Date.now() + 3600_000).toISOString(), ...(win ? { pickup_window_end: new Date(Date.now() + 3 * 3600_000).toISOString() } : {}) });
  const w = await mk(true); const plain = await mk(false);
  await pool.query(`UPDATE trips SET scheduled_for = now() + interval '10 minutes' WHERE id = ANY($1)`, [[w.trip.id, plain.trip.id]]);
  await dispatchTick();
  assert.equal((await one('SELECT status FROM trips WHERE id = $1', [plain.trip.id])).status, 'requested', 'a plain booking is released 15 min ahead');
  assert.equal((await one('SELECT status FROM trips WHERE id = $1', [w.trip.id])).status, 'scheduled', 'the window has not started');
  await pool.query(`UPDATE trips SET scheduled_for = now() - interval '40 minutes', pickup_window_end = now() + interval '1 hour' WHERE id = $1`, [w.trip.id]);
  await dispatchTick();
  assert.equal((await one('SELECT status FROM trips WHERE id = $1', [w.trip.id])).status, 'requested', 'inside its window: released, not "missed"');
  await pool.query(`UPDATE trips SET requested_at = now() - interval '30 minutes' WHERE id = $1`, [w.trip.id]);
  await dispatchTick();
  assert.equal((await one('SELECT status FROM trips WHERE id = $1', [w.trip.id])).status, 'requested', 'still searching until the window closes');
  for (const id of [w.trip.id, plain.trip.id]) await call('POST', `/trips/${id}/cancel`, 'rider', {});
});

let runTrips: any[] = [];
test('multi-drop run: priced by leg, offered once to one driver with the whole run; every parcel collected together, recipients texted an ETA', async () => {
  await onlyD1Online();
  const drops = [{ dropoff: BRAITLING, size: 'S' }, { dropoff: YEPERENYE, size: 'S' }, { dropoff: ARALUEN, size: 'M' }];
  const qr = await call('POST', '/courier/runs/quote', 'rider', { pickup: TODD_MALL, drops });
  assert.equal(qr.status, 200, JSON.stringify(qr));
  assert.deepEqual(qr.stops.map((s: any) => s.index), [1, 2, 0], 'nearest drop first');
  assert.ok(qr.stops[1].quote.lines.some((l: any) => l.label.startsWith('Extra stop')));
  assert.ok(!qr.stops[1].quote.lines.some((l: any) => l.label === 'Booking fee'), 'booking fee once per run');
  const single = await call('POST', '/quotes', 'rider', { service: 'courier_s', pickup: TODD_MALL, dropoff: BRAITLING });
  assert.ok(qr.stops[2].quote.trip_cents < single.quote.trip_cents, 'a later drop costs less than sending it on its own');

  const body = { pickup: TODD_MALL, sender_name: 'Central Pharmacy', sender_phone: '08 8950 1234', payment_method: 'wallet', prohibited_items: ALL_ITEMS,
    drops: [{ dropoff: BRAITLING, parcel: drop('Far Away') }, { dropoff: YEPERENYE, parcel: drop('Close By', { customer_ref: 'RX-7' }) }, { dropoff: ARALUEN, parcel: drop('Middle', { size: 'M', requires_signature: true }) }] };
  assert.equal((await call('POST', '/courier/runs', 'rider', { ...body, drops: [body.drops[0], { ...body.drops[1], parcel: drop('Bad', { weight_kg: 9 }) }] })).error, 'parcel_too_heavy');
  const before = await wallet();
  const r = await call('POST', '/courier/runs', 'rider', body);
  assert.equal(r.status, 201, JSON.stringify(r));
  runTrips = r.trips;
  assert.deepEqual(r.trips.map((t: any) => [t.batch_seq, t.parcel.recipient_name]), [[1, 'Close By'], [2, 'Middle'], [3, 'Far Away']]);
  assert.equal(await wallet(), before - r.trips.reduce((n: number, t: any) => n + t.quote_cents, 0), 'each drop paid from credit');
  assert.match(r.batch.ref, /^RUN-/);

  const offer = await waitForOffer('d1');
  assert.equal(offer.trip_id, r.trips[0].id, 'only the first drop is offered');
  assert.equal(offer.run.stops, 3);
  assert.ok(offer.run.pay_cents > offer.driver_pay.total_cents, 'offer shows the pay for the whole run');
  await dispatchTick();
  assert.equal((await call('GET', '/driver/offers', 'd1')).offers.length, 1, 'later drops are never offered on their own');
  assert.equal((await call('POST', `/driver/offers/${r.trips[0].id}/accept`, 'd1')).trip.status, 'accepted');
  const st = await q('SELECT status, driver_id FROM trips WHERE batch_id = $1 ORDER BY batch_seq', [r.batch.id]);
  assert.ok(st.every((x: any) => x.status === 'accepted' && x.driver_id === st[0].driver_id), 'the whole run goes to the driver');
  const active = await call('GET', '/driver/trips/active', 'd1');
  assert.equal(active.trip.id, r.trips[0].id);
  assert.equal(active.trip.batch.stops.length, 3);
  await call('POST', `/driver/trips/${r.trips[0].id}/arrive`, 'd1');
  assert.equal((await call('POST', `/driver/trips/${r.trips[0].id}/start`, 'd1')).trip.status, 'in_progress');
  const ps = await q('SELECT p.eta_at, p.picked_up_at FROM parcels p JOIN trips t ON t.id = p.trip_id WHERE t.batch_id = $1 ORDER BY t.batch_seq', [r.batch.id]);
  assert.ok(ps.every((p: any) => p.picked_up_at && p.eta_at), 'every parcel collected, each with an ETA');
  assert.ok(ps[0].eta_at < ps[1].eta_at && ps[1].eta_at < ps[2].eta_at, 'later drops later');
  for (const t of r.trips) assert.equal(await smsCount(t.id, 'parcel_on_way'), 1, 'each recipient texted once');
  const track = await call('GET', `/public/track/${(await one('SELECT share_token FROM trips WHERE id = $1', [r.trips[1].id])).share_token}`);
  assert.ok(track.trip.parcel.eta_at && track.live, 'recipient sees the ETA');
  assert.equal(track.trip.batch, undefined, 'no other drops on a share link');
  assert.equal(JSON.stringify(track).includes('Far Away'), false);
});

test('failed delivery: parcel goes back to the sender with a return fee; run continues; return needs a handover; another try can be booked once', async () => {
  const [first, second, third] = runTrips;
  const pin = async (id: string) => (await one('SELECT delivery_pin FROM parcels WHERE trip_id = $1', [id])).delivery_pin;
  assert.equal((await call('POST', `/driver/trips/${first.id}/complete`, 'd1', { delivery_pin: await pin(first.id), lat: YEPERENYE.lat, lng: YEPERENYE.lng })).trip.status, 'completed');
  assert.equal((await call('GET', '/driver/trips/active', 'd1')).trip.id, second.id, 'next drop');
  assert.equal((await call('POST', `/driver/trips/${second.id}/delivery-failed`, 'd1', { reason: 'other' })).error, 'validation_error', 'say what happened');
  const f = await call('POST', `/driver/trips/${second.id}/delivery-failed`, 'd1', { reason: 'no_one_home', note: 'Knocked twice' });
  assert.equal(f.status, 200, JSON.stringify(f));
  assert.equal(f.trip.parcel.outcome, 'returning');
  const fee = f.trip.fare_breakdown.lines.find((l: any) => l.label === 'Return to sender').cents;
  assert.ok(fee >= 500, `return fee ${fee}`);
  assert.equal((await call('POST', `/driver/trips/${second.id}/delivery-failed`, 'd1', { reason: 'no_one_home' })).status, 200, 'a repeat is harmless');
  assert.equal(await smsCount(second.id, 'parcel_failed_recipient'), 1);
  assert.equal(await smsCount(second.id, 'parcel_failed_sender'), 1, 'sender phone (not the booking login) texted');
  assert.equal((await call('GET', '/driver/trips/active', 'd1')).trip.id, third.id, 'returns go last');
  assert.equal((await call('POST', `/driver/trips/${third.id}/complete`, 'd1', { delivery_pin: await pin(third.id) })).trip.status, 'completed');
  assert.equal((await call('GET', '/driver/trips/active', 'd1')).trip.id, second.id, 'then back to the sender');
  assert.equal((await call('POST', `/driver/trips/${second.id}/complete`, 'd1', { delivery_pin: await pin(second.id) })).error, 'return_pod_required');
  const balance = await wallet();
  const back = await call('POST', `/driver/trips/${second.id}/complete`, 'd1', { pod_signature: 'data:image/png;base64,AAAA', pod_received_by: 'Pharmacist' });
  assert.equal(back.trip.status, 'completed');
  assert.equal(back.trip.parcel.outcome, 'returned');
  assert.equal(back.trip.final_cents, second.quote_cents + fee);
  assert.equal(await wallet(), balance - fee, 'return fee taken from credit');
  const led = await one<{ n: number }>(`SELECT sum(amount_cents)::int n FROM driver_ledger WHERE trip_id = $1 AND kind = 'fare'`, [second.id]);
  assert.equal(led!.n, second.fare_breakdown.trip_cents + fee, 'driver is paid for the return');
  assert.equal(await smsCount(second.id, 'parcel_delivered_sender'), 0, 'no "delivered" text for a return');
  assert.equal(await one(`SELECT 1 FROM trips WHERE driver_id = (SELECT id FROM users WHERE phone = '+61400000011') AND status IN ('accepted','arrived','in_progress')`), null);

  // Engaged time for the run is counted once, not once per drop.
  const from = await engagedFromSql('t');
  const e = await one(`SELECT sum(extract(epoch FROM t.completed_at - ${from}))::int s, extract(epoch FROM max(t.completed_at) - min(t.accepted_at))::int wall
                       FROM trips t WHERE t.batch_id = $1`, [first.batch_id]);
  assert.ok(e.s <= e.wall + 1, `engaged ${e.s}s within ${e.wall}s`);

  assert.equal((await call('POST', `/trips/${first.id}/reattempt`, 'rider', {})).error, 'not_returned');
  const again = await call('POST', `/trips/${second.id}/reattempt`, 'rider', { leave_unattended: true, safe_place: 'Front porch' });
  assert.equal(again.status, 201, JSON.stringify(again));
  assert.deepEqual([again.trip.dropoff_address, again.trip.parcel.recipient_name, again.trip.parcel.safe_place, again.trip.parcel.requires_signature],
    [second.dropoff_address, 'Middle', 'Front porch', false]);
  assert.equal((await call('POST', `/trips/${second.id}/reattempt`, 'rider', {})).error, 'already_rebooked');
  await call('POST', `/trips/${again.trip.id}/cancel`, 'rider', {});
});

test('recipient: adds a safe place from the tracking link (not when a signature is needed, not after delivery); photo drop shows where it was left; far drops flagged', async () => {
  await onlyD1Online();
  const parcel = { size: 'S', description: 'Book', sender_name: 'Library', sender_phone: '08 8950 1234', recipient_name: 'Jo Bloggs', recipient_phone: '0400 000 555', prohibited_items: ALL_ITEMS };
  const sig = await call('POST', '/trips', 'rider', { kind: 'courier', service: 'courier_s', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'wallet', parcel: { ...parcel, requires_signature: true } });
  const sigTok = (await one('SELECT share_token FROM trips WHERE id = $1', [sig.trip.id])).share_token;
  assert.equal((await call('POST', `/public/track/${sigTok}/instructions`, undefined, { safe_place: 'Porch' }, '10.77.0.1')).error, 'signature_required');
  await call('POST', `/trips/${sig.trip.id}/cancel`, 'rider', {});

  const t = await call('POST', '/trips', 'rider', { kind: 'courier', service: 'courier_s', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'wallet', parcel });
  const tok = (await one('SELECT share_token FROM trips WHERE id = $1', [t.trip.id])).share_token;
  assert.equal((await call('GET', `/public/track/${tok}`)).trip.parcel.can_add_instructions, true);
  const ins = await call('POST', `/public/track/${tok}/instructions`, undefined, { notes: 'Blue door', safe_place: 'Under the verandah' }, '10.77.0.1');
  assert.equal(ins.status, 200, JSON.stringify(ins));
  assert.deepEqual([ins.parcel.leave_unattended, ins.parcel.safe_place, ins.parcel.recipient_notes], [true, 'Under the verandah', 'Blue door']);
  await driveToArrived(t.trip.id);
  await call('POST', `/driver/trips/${t.trip.id}/start`, 'd1');
  const up = await call('POST', '/uploads', 'd1', { data_url: PNG, purpose: 'pod' });
  assert.ok(up.url, JSON.stringify(up));
  // 2 km from the address with only a photo: delivered, but checked by ops.
  const done = await call('POST', `/driver/trips/${t.trip.id}/complete`, 'd1', { pod_photo_url: up.url, lat: -23.69, lng: 133.86 });
  assert.equal(done.trip.parcel.outcome, 'delivered');
  assert.ok(done.trip.parcel.pod_distance_m > 1000);
  assert.ok(await one(`SELECT 1 FROM compliance_flags WHERE trip_id = $1 AND kind = 'delivery_far_from_address'`, [t.trip.id]));
  const tr = await call('GET', `/public/track/${tok}`);
  assert.equal(tr.trip.parcel.outcome, 'delivered');
  assert.match(tr.trip.parcel.left_photo_url, /^\/uploads\/pod-.*sig=/, 'recipient sees where it was left (signed link)');
  assert.equal(tr.trip.parcel.can_add_instructions, false);
  assert.equal((await call('POST', `/public/track/${tok}/instructions`, undefined, { notes: 'late' }, '10.77.0.1')).status, 409);
});

test('business deliveries: managers see the account, members their own; CSV export without phones; CSV import checks every row, then books runs', async () => {
  const me = await call('GET', '/me', 'rider');
  const acct = me.corporate_accounts[0];
  // Signed in directly (the OTP per-number limits are covered elsewhere).
  const boss = (await one(`INSERT INTO users (phone, name, role, referral_code) VALUES ('+61400000977', 'Biz Manager', 'rider', 'BIZMGR977') ON CONFLICT (phone) DO UPDATE SET name = 'Biz Manager' RETURNING id`)).id;
  tokens.bizboss = signToken({ id: boss, role: 'rider' });
  assert.equal((await call('GET', `/business/deliveries?account_id=${acct.id}`, 'bizboss')).status, 403, 'not a member yet');
  await q(`INSERT INTO corporate_members (account_id, user_id, role) VALUES ($1, $2, 'manager')`, [acct.id, boss]);

  const parcel = { size: 'S', description: 'Order', sender_name: 'Desert Conference Centre', sender_phone: '08 8950 1234', recipient_name: 'Guest One', recipient_phone: '0400 000 555', prohibited_items: ALL_ITEMS, customer_ref: 'INV-55' };
  const t = await call('POST', '/trips', 'rider', { kind: 'courier', service: 'courier_s', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'corporate', corporate_account_id: acct.id, parcel,
    scheduled_for: new Date(Date.now() + 2 * 3600_000).toISOString() });
  assert.equal(t.status, 201, JSON.stringify(t));
  const mine = await call('GET', `/business/deliveries?account_id=${acct.id}`, 'rider');
  assert.equal(mine.manager, false);
  assert.ok(mine.deliveries.some((d: any) => d.ref === t.trip.ref && d.customer_ref === 'INV-55'));
  const all = await call('GET', `/business/deliveries?account_id=${acct.id}&status=active&q=INV-55`, 'bizboss');
  assert.equal(all.manager, true);
  assert.deepEqual(all.deliveries.map((d: any) => d.ref), [t.trip.ref], 'manager sees deliveries booked by others on the account');
  assert.equal((await call('GET', `/business/deliveries?account_id=${acct.id}`, 'bizboss')).deliveries.some((d: any) => d.rider_id === boss), false);
  const res = await app.inject({ method: 'GET', url: `/business/deliveries.csv?account_id=${acct.id}`, headers: { authorization: `Bearer ${tokens.bizboss}` } });
  assert.equal(res.statusCode, 200);
  assert.match(String(res.headers['content-type']), /text\/csv/);
  assert.match(res.body, /Ref,Run,Your reference,Booked by/);
  assert.ok(res.body.includes('INV-55') && !res.body.includes('0400') && !res.body.includes('+61'), 'no phone numbers in the export');
  // Previous-round runs show up as problems (the returned parcel).
  assert.ok((await call('GET', '/business/deliveries?status=problem', 'rider')).deliveries.some((d: any) => d.outcome === 'returned'));

  const base = { pickup: TODD_MALL, sender_name: 'Desert Conference Centre', sender_phone: '08 8950 1234', payment_method: 'corporate', corporate_account_id: acct.id, prohibited_items: ALL_ITEMS,
    scheduled_for: new Date(Date.now() + 3 * 3600_000).toISOString() };
  const bad = await call('POST', '/business/deliveries/import', 'bizboss', { ...base, csv: 'name,mobile,address\nA,0400000561,Todd Mall\nB,123,Araluen Arts Centre', dry_run: false });
  assert.equal(bad.error, 'csv_errors');
  assert.equal(await one(`SELECT 1 FROM trips WHERE rider_id = $1`, [boss]), null, 'nothing booked when a row is wrong');
  const csv = 'name,mobile,address,size,reference\nA One,0400000561,Araluen Arts Centre,S,E-1\nB Two,0400000562,Braitling,M,E-2\nC Three,0400000563,Alice Springs Hospital,S,E-3';
  const dry = await call('POST', '/business/deliveries/import', 'bizboss', { ...base, csv });
  assert.equal(dry.booked, false);
  assert.equal(dry.runs.length, 1);
  assert.ok(dry.total_cents > 0);
  const booked = await call('POST', '/business/deliveries/import', 'bizboss', { ...base, csv, dry_run: false });
  assert.equal(booked.status, 201, JSON.stringify(booked));
  assert.equal(booked.runs[0].trips.length, 3);
  const b = await one(`SELECT source, stops FROM courier_batches WHERE id = $1`, [booked.runs[0].batch.id]);
  assert.deepEqual(b, { source: 'csv', stops: 3 });
  assert.equal((await call('GET', `/business/deliveries?account_id=${acct.id}&q=E-2`, 'bizboss')).deliveries[0].run_ref, booked.runs[0].batch.ref);
  for (const x of booked.runs[0].trips) await call('POST', `/trips/${x.id}/cancel`, 'bizboss', {});
  await call('POST', `/trips/${t.trip.id}/cancel`, 'rider', {});
});

test('multi-drop run: driver pulling out passes the whole run on; sender no-show at the pickup ends every drop', async () => {
  await onlyD1Online();
  await call('POST', '/driver/online', 'd2', { online: true, lat: TODD_MALL.lat + 0.01, lng: TODD_MALL.lng, battery_pct: 90 });
  const body = { pickup: TODD_MALL, sender_name: 'Shop', sender_phone: '08 8950 1234', payment_method: 'wallet', prohibited_items: ALL_ITEMS,
    drops: [{ dropoff: YEPERENYE, parcel: drop('One') }, { dropoff: HOSPITAL, parcel: drop('Two') }] };
  const r = await call('POST', '/courier/runs', 'rider', body);
  assert.equal(r.status, 201, JSON.stringify(r));
  await waitForOffer('d1');
  await call('POST', `/driver/offers/${r.trips[0].id}/accept`, 'd1');
  const c = await call('POST', `/driver/trips/${r.trips[0].id}/cancel`, 'd1', { reason: 'vehicle_issue' });
  assert.equal(c.trip.released, true);
  const st = await q('SELECT status, driver_id FROM trips WHERE batch_id = $1 ORDER BY batch_seq', [r.batch.id]);
  assert.ok(st.every((x: any) => x.status === 'requested' && !x.driver_id), 'the whole run is searching again');
  const o2 = await waitForOffer('d2');
  assert.equal(o2.trip_id, r.trips[0].id);
  assert.equal(o2.run.stops, 2);
  await call('POST', `/driver/offers/${r.trips[0].id}/accept`, 'd2');
  await call('POST', `/driver/trips/${r.trips[0].id}/arrive`, 'd2');
  await call('POST', `/driver/trips/${r.trips[0].id}/cancel`, 'd2', { reason: 'rider_no_show' });
  const end = await q('SELECT status FROM trips WHERE batch_id = $1', [r.batch.id]);
  assert.ok(end.every((x: any) => x.status === 'cancelled_driver'), JSON.stringify(end));
  await call('POST', '/driver/online', 'd2', { online: false });
});

test('before migration 016: single parcels, tracking, dispatch and earnings still work; runs, windows and returns say migration_pending', async () => {
  const cols: [string, string][] = [['trips', 'batch_id'], ['trips', 'batch_seq'], ['trips', 'pickup_window_end'], ['parcels', 'outcome'], ['parcels', 'safe_place'], ['parcels', 'pod_distance_m'],
    ['parcels', 'eta_at'], ['parcels', 'customer_ref'], ['parcels', 'prohibited_checklist'], ['parcels', 'recipient_notes'], ['parcels', 'failed_reason']];
  for (const [tb, c] of cols) await q(`ALTER TABLE ${tb} RENAME COLUMN ${c} TO ${c}_off`);
  resetCourierReady();
  try {
    await onlyD1Online();
    const parcel = { size: 'S', description: 'Keys', sender_name: 'Demo', sender_phone: '0400000100', recipient_name: 'Nan', recipient_phone: '0400000555', prohibited_items: ALL_ITEMS, safe_place: 'x', leave_unattended: true };
    const t = await call('POST', '/trips', 'rider', { kind: 'courier', service: 'courier_s', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'wallet', parcel });
    assert.equal(t.status, 201, JSON.stringify(t));
    await driveToArrived(t.trip.id);
    assert.equal((await call('GET', '/driver/trips/active', 'd1')).trip.id, t.trip.id);
    await call('POST', `/driver/trips/${t.trip.id}/start`, 'd1');
    await call('POST', '/driver/location', 'd1', { lat: HOSPITAL.lat, lng: HOSPITAL.lng });
    assert.equal(await smsCount(t.trip.id, 'parcel_on_way'), 1, 'ETA text still goes');
    const tok = (await one('SELECT share_token FROM trips WHERE id = $1', [t.trip.id])).share_token;
    const tr = await call('GET', `/public/track/${tok}`);
    assert.deepEqual([tr.status, tr.trip.parcel.can_add_instructions], [200, false]);
    assert.equal((await call('POST', `/driver/trips/${t.trip.id}/delivery-failed`, 'd1', { reason: 'refused' })).error, 'migration_pending');
    const pin = (await one('SELECT delivery_pin FROM parcels WHERE trip_id = $1', [t.trip.id])).delivery_pin;
    assert.equal((await call('POST', `/driver/trips/${t.trip.id}/complete`, 'd1', { delivery_pin: pin })).trip.status, 'completed');
    assert.equal((await call('POST', '/courier/runs', 'rider', { pickup: TODD_MALL, sender_name: 'S', sender_phone: '0889501234', payment_method: 'wallet', prohibited_items: ALL_ITEMS,
      drops: [{ dropoff: YEPERENYE, parcel: drop('A') }, { dropoff: HOSPITAL, parcel: drop('B') }] })).error, 'migration_pending');
    assert.equal((await call('POST', '/trips', 'rider', { kind: 'courier', service: 'courier_s', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'wallet', parcel,
      scheduled_for: new Date(Date.now() + 3600_000).toISOString(), pickup_window_end: new Date(Date.now() + 7200_000).toISOString() })).error, 'migration_pending');
    await dispatchTick();
    assert.equal((await call('GET', '/driver/earnings', 'd1')).status, 200);
    assert.equal((await call('GET', '/business/deliveries', 'rider')).status, 200);
    assert.equal((await call('GET', '/driver/offers', 'd1')).status, 200);
    assert.equal((await call('GET', '/public/config')).courier.runs, false);
  } finally {
    for (const [tb, c] of cols) await q(`ALTER TABLE ${tb} RENAME COLUMN ${c}_off TO ${c}`);
    resetCourierReady();
  }
});

// ───────────────────────── Round 12: community and cultural fit ─────────────────────────
import { readFileSync as readFile12 } from 'node:fs';
import { resetCommunityReady } from '../src/lib/community.js';

const TOMORROW = () => new Date(Date.now() + 24 * 3600_000).toISOString();
const nextYear = () => `${new Date().getFullYear() + 1}-06-30`;

test('languages: English default, Arrernte (aer) and Kriol drafts only, old "arr" means Arrernte; translation file is reviewable; dual place names', async () => {
  const strings = JSON.parse(readFile12(new URL('../../../packages/shared/src/i18n/strings.json', import.meta.url), 'utf8'));
  assert.deepEqual(Object.keys(strings.languages), ['en', 'aer', 'rop']);
  for (const [key, e] of Object.entries<any>(strings.strings)) {
    assert.ok(typeof e.en === 'string' && e.en.length > 0, `${key}: English is the source`);
    for (const l of ['aer', 'rop']) {
      if (!e[l]) continue;
      assert.ok(e[l].text, `${key}.${l} has text`);
      // Nothing is "reviewed" unless someone from the community is named as the reviewer.
      if (e[l].status === 'reviewed') assert.ok(e[l].reviewed_by && e[l].reviewed_on, `${key}.${l}: reviewed needs a reviewer and date`);
      else assert.equal(e[l].status, 'draft', `${key}.${l} is marked draft`);
    }
  }
  const cfg = await call('GET', '/public/config');
  assert.deepEqual(Object.fromEntries(Object.entries<any>(cfg.languages).map(([k, v]) => [k, v.status])), { en: 'source', aer: 'draft', rop: 'draft' });

  assert.equal((await call('PATCH', '/me', 'rider', { language: 'arr' })).user.language, 'aer');
  assert.equal((await call('PATCH', '/me', 'rider', { language: 'rop' })).user.language, 'rop');
  assert.equal((await call('PATCH', '/me', 'rider', { language: 'xx' })).status, 400);
  assert.equal((await call('PATCH', '/me', 'rider', { language: 'en' })).user.language, 'en');

  const hit = (await call('GET', '/places/search?q=rungutjirba', 'rider')).places[0];
  assert.equal(hit.name, 'Rungutjirba (Simpsons Gap)');
  assert.equal(hit.english_name, 'Simpsons Gap');
  assert.equal(hit.sacred, true);
  assert.match(hit.note, /Sacred site/);
  assert.equal((await call('GET', '/places/search?q=simpsons', 'rider')).places[0].arrernte_name, 'Rungutjirba', 'the English name finds it too');
  assert.equal((await call('GET', '/public/places?q=Ntaripe')).places[0].english_name, 'Heavitree Gap');
  assert.ok((await call('GET', '/public/places?q=mparntwe')).places.some((p: any) => p.english_name === 'Todd Mall'));
  assert.equal((await call('GET', '/public/places?q=todd mall')).places[0].note, undefined, 'only sacred sites carry the note');
});

test('concession fares: off by default; rider applies with the last 4 digits; admin approves; DingoGo-funded line with a cap; validation', async () => {
  const cfg = await call('GET', '/public/config');
  assert.equal(cfg.community_pricing.concession, false);
  assert.equal((await call('PUT', '/me/concession', 'rider', { type: 'pensioner', last4: '1234', expires: nextYear() })).error, 'concession_off');
  const before = await call('POST', '/quotes', 'rider', { service: 'ride', pickup: TODD_MALL, dropoff: AIRPORT });

  if (!tokens.dispatcher) await login('dispatcher', '+61400000002', 'admin');
  assert.equal((await call('PUT', '/admin/community-pricing', 'dispatcher', { enabled: true, concession_pct: 50 })).status, 403, 'admin only');
  assert.equal((await call('PUT', '/admin/community-pricing', 'admin', { enabled: true, concession_pct: 0 })).status, 400);
  assert.equal((await call('PUT', '/admin/community-pricing', 'admin', { enabled: true, concession_pct: 90 })).status, 400);
  assert.equal((await call('PUT', '/admin/community-pricing', 'admin', { enabled: true, concession_pct: 50, types: ['library_card'] })).status, 400);
  const saved = await call('PUT', '/admin/community-pricing', 'admin', { enabled: true, concession_pct: 50, concession_max_cents: 1000, services: ['ride'], types: ['pensioner', 'health_care'] });
  assert.equal(saved.settings.concession_pct, 50);
  assert.ok(await one(`SELECT 1 FROM audit_log WHERE action = 'setting' AND entity_id = 'community_pricing'`));
  assert.equal((await call('GET', '/public/config')).community_pricing.pct, 50);

  assert.equal((await call('PUT', '/me/concession', 'rider', { type: 'seniors', last4: '1234', expires: nextYear() })).error, 'concession_type');
  assert.equal((await call('PUT', '/me/concession', 'rider', { type: 'pensioner', last4: '123456789', expires: nextYear() })).status, 400, 'never the whole number');
  assert.equal((await call('PUT', '/me/concession', 'rider', { type: 'pensioner', last4: '1234', expires: '2020-01-01' })).error, 'concession_expired');
  const applied = await call('PUT', '/me/concession', 'rider', { type: 'pensioner', last4: '1234', expires: nextYear() });
  assert.equal(applied.user.concession.status, 'pending');
  const pending = await call('POST', '/quotes', 'rider', { service: 'ride', pickup: TODD_MALL, dropoff: AIRPORT });
  assert.ok(!pending.quote.lines.some((l: any) => l.label.startsWith('Concession')), 'nothing until checked');

  const riderId = (await one(`SELECT id FROM users WHERE phone = '+61400000100'`)).id;
  const queue = await call('GET', '/admin/concessions', 'dispatcher');
  assert.ok(queue.items.some((u: any) => u.id === riderId && u.concession.last4 === '1234'));
  assert.equal((await call('POST', `/admin/concessions/${riderId}/review`, 'admin', { status: 'rejected' })).error, 'note_required');
  assert.equal((await call('POST', `/admin/concessions/${riderId}/review`, 'dispatcher', { status: 'approved' })).concession.status, 'approved');
  const q2 = await call('POST', '/quotes', 'rider', { service: 'ride', pickup: TODD_MALL, dropoff: AIRPORT });
  const line = q2.quote.lines.find((l: any) => l.label === 'Concession (−50%)');
  assert.ok(line, JSON.stringify(q2.quote.lines));
  assert.equal(line.cents, -1000, 'capped at $10 a trip');
  assert.equal(q2.quote.trip_cents, before.quote.trip_cents, 'the driver earns on the same fare (DingoGo funds the concession)');
  assert.ok(q2.quote.lines.some((l: any) => l.label === 'NT passenger levy' && l.cents === 100), 'levy is never discounted');
  const parcel = await call('POST', '/quotes', 'rider', { service: 'courier_s', pickup: TODD_MALL, dropoff: AIRPORT });
  assert.ok(!parcel.quote.lines.some((l: any) => l.label.startsWith('Concession')), 'only the services chosen');
  // An expired card stops the concession.
  await q(`UPDATE users SET concession = jsonb_set(concession, '{expires}', '"2020-01-01"') WHERE id = $1`, [riderId]);
  assert.ok(!(await call('POST', '/quotes', 'rider', { service: 'ride', pickup: TODD_MALL, dropoff: AIRPORT })).quote.lines.some((l: any) => l.label.startsWith('Concession')));
  // Pure engine: percent of the discountable amount, no cap → full percent.
  const rule = { service: 'ride', label: 'Ride', base_cents: 300, per_km_cents: 160, per_min_cents: 25, booking_fee_cents: 100, min_fare_cents: 1000, night_pct: 0, holiday_pct: 0, levy_cents: 100 };
  const fq = quoteFare(rule, { distance_m: 10_000, duration_s: 900, at: new Date('2026-11-02T02:00:00Z'), concession: { pct: 25, max_cents: null, label: 'Concession (−25%)' } });
  assert.equal(fq.lines.find((l) => l.label === 'Concession (−25%)')!.cents, -Math.round((fq.trip_cents + 100) * 0.25));

  await call('DELETE', '/me/concession', 'rider');
  await call('PUT', '/admin/community-pricing', 'admin', { enabled: false, concession_pct: 50 });
});

test('organisation books rides for a client with consent; client is told and can withdraw; organisation sees only its bookings', async () => {
  const acct = (await one(`INSERT INTO corporate_accounts (name, kind, billing_email) VALUES ('Mparntwe Health Transport (test)', 'health_service', 'ht@example.com') RETURNING id`)).id;
  const mk = async (phone: string, name: string) => (await one(`INSERT INTO users (phone, name, referral_code) VALUES ($1,$2,$3) RETURNING id`, [phone, name, 'R12' + phone.slice(-5)])).id;
  const lead = await mk('+61400000931', 'Health Lead'), worker = await mk('+61400000932', 'Health Worker'), other = await mk('+61400000933', 'Other Worker');
  await q(`INSERT INTO corporate_members (account_id, user_id, role) VALUES ($1,$2,'manager'), ($1,$3,'member'), ($1,$4,'member')`, [acct, lead, worker, other]);
  tokens.hlead = signToken({ id: lead, role: 'rider' }); tokens.hwork = signToken({ id: worker, role: 'rider' }); tokens.hother = signToken({ id: other, role: 'rider' });
  const biz = (await call('GET', '/me', 'rider')).corporate_accounts[0];
  const consent = { account_id: acct, name: 'Mary Kngwarreye', phone: '0400 000 934', method: 'verbal', confirm: true };
  assert.equal((await call('POST', '/business/clients', 'rider', { ...consent, account_id: biz.id })).status, 403, 'a plain business account cannot book for clients');
  assert.equal((await call('POST', '/business/clients', 'rider', consent)).status, 403, 'members only');
  assert.equal((await call('POST', '/business/clients', 'hwork', { ...consent, confirm: false })).status, 400);
  assert.equal((await call('POST', '/business/clients', 'hwork', { ...consent, phone: '08 8950 1234' })).error, 'client_phone');
  const made = await call('POST', '/business/clients', 'hwork', consent);
  assert.equal(made.status, 201, JSON.stringify(made));
  assert.deepEqual([made.client.client, made.client.phone_tail, made.client.current], ['Mary K.', '…934', true]);
  assert.equal((await call('POST', '/business/clients', 'hlead', consent)).error, 'consent_exists');
  const client = (await one(`SELECT id FROM users WHERE phone = '+61400000934'`)).id;
  tokens.client12 = signToken({ id: client, role: 'rider' });
  await flushBackground(3000);
  assert.ok(await one(`SELECT 1 FROM comms_log WHERE user_id = $1 AND template = 'client_consent_recorded'`, [client]), 'the client is texted');
  assert.ok(await one(`SELECT 1 FROM audit_log WHERE action = 'client_consent_recorded' AND entity_id = $1`, [acct]));

  const ride = { account_id: acct, consent_id: made.client.id, pickup: TODD_MALL, dropoff: HOSPITAL, scheduled_for: TOMORROW(), notes: 'Appointment 10 am, ward 3' };
  const qt = await call('POST', '/business/rides/quote', 'hwork', ride);
  assert.ok(qt.quote.total_cents > 0);
  const b = await call('POST', '/business/rides', 'hwork', ride);
  assert.equal(b.status, 201, JSON.stringify(b));
  assert.equal(b.trip.client, 'Mary K.');
  assert.equal(b.trip.verify_pin, undefined, 'the PIN is the client’s');
  assert.ok(!JSON.stringify(b).includes('0400000934') && !JSON.stringify(b).includes('+61400000934'), 'no full client phone');
  const row = await one(`SELECT rider_id, booked_by, channel, payment_method, corporate_account_id FROM trips WHERE id = $1`, [b.trip.id]);
  assert.deepEqual(row, { rider_id: client, booked_by: worker, channel: 'org', payment_method: 'corporate', corporate_account_id: acct });
  await flushBackground(3000);
  assert.equal(await smsCount(b.trip.id, 'ride_booked_for_you'), 1, 'trip texts go to the client');
  // The client sees the trip and the consent; the organisation sees only what it booked.
  assert.ok((await call('GET', '/trips', 'client12')).trips.some((t: any) => t.id === b.trip.id));
  const mine = await call('GET', '/me/consents', 'client12');
  assert.equal(mine.consents[0].organisation, 'Mparntwe Health Transport (test)');
  assert.equal(mine.consents[0].current, true);
  assert.equal((await call('GET', `/business/rides?account_id=${acct}`, 'hother')).rides.length, 0, 'other members see only their own bookings');
  assert.equal((await call('GET', `/business/rides?account_id=${acct}`, 'hlead')).rides[0].id, b.trip.id, 'managers see the account');
  assert.equal((await call('GET', `/business/rides?account_id=${acct}`, 'rider')).status, 403);
  assert.equal((await call('POST', `/business/rides/${b.trip.id}/cancel`, 'hother')).status, 403);
  // The client's own trips (not booked by the organisation) never show.
  const own = await call('GET', `/business/clients?account_id=${acct}`, 'hother');
  assert.equal(own.clients[0].client_full_name, 'Mary Kngwarreye');
  const cancelled = await call('POST', `/business/rides/${b.trip.id}/cancel`, 'hwork');
  assert.equal(cancelled.trip.status, 'cancelled_rider');

  // Client says stop.
  assert.equal((await call('POST', `/me/consents/${mine.consents[0].id}/withdraw`, 'client12')).ok, true);
  const refused = await call('POST', '/business/rides', 'hwork', ride);
  assert.deepEqual([refused.status, refused.error], [403, 'consent_required']);
  assert.equal((await call('GET', `/business/clients?account_id=${acct}`, 'hwork')).clients[0].current, false);
  assert.equal((await call('GET', '/me/export', 'client12')).booking_consents[0].withdrawn_at != null, true, 'in the data export');
  // New consent with an expiry that has passed → refused.
  const again = await call('POST', '/business/clients', 'hlead', { ...consent, method: 'written', expires_at: nextYear() });
  assert.equal(again.status, 201);
  await q(`UPDATE client_consents SET expires_at = now() - interval '1 day' WHERE id = $1`, [again.client.id]);
  assert.equal((await call('POST', '/business/rides', 'hwork', { ...ride, consent_id: again.client.id })).error, 'consent_required');
});

test('Sorry Business: cancelling for it passes the trip on and never counts; leave pauses offers and reminders; going online ends it', async () => {
  await onlyD1Online();
  const d1 = (await one(`SELECT id FROM users WHERE phone = '+61400000011'`)).id;
  const flagsBefore = (await one<{ n: number }>(`SELECT count(*)::int n FROM compliance_flags WHERE driver_id = $1`, [d1]))!.n;
  const cancelsBefore = (await call('GET', '/driver/me', 'd1')).acceptance.cancelled_7d;
  const t = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'wallet', assistance_animal: true });
  assert.equal(t.status, 201, JSON.stringify(t));
  const offer = await waitForOffer('d1');
  assert.equal(offer.trip_id, t.trip.id);
  await call('POST', `/driver/offers/${t.trip.id}/accept`, 'd1');
  assert.equal((await call('POST', '/driver/leave', 'd1', { kind: 'sorry_business' })).error, 'on_trip', 'leave needs the trip passed on first');
  const c = await call('POST', `/driver/trips/${t.trip.id}/cancel`, 'd1', { reason: 'sorry_business', note: 'private family matter' });
  assert.equal(c.status, 200, JSON.stringify(c));
  assert.equal(c.trip.released, true, 'the rider keeps the booking');
  assert.equal(c.leave.kind, 'sorry_business');
  assert.equal((await one(`SELECT status FROM trip_offers WHERE trip_id = $1 AND driver_id = $2`, [t.trip.id, d1])).status, 'released');
  assert.equal((await one<{ n: number }>(`SELECT count(*)::int n FROM compliance_flags WHERE driver_id = $1`, [d1]))!.n, flagsBefore, 'no repeat-cancel or assistance-animal flag');
  const ev = await one(`SELECT data FROM trip_events WHERE trip_id = $1 AND type = 'driver_released'`, [t.trip.id]);
  assert.equal(ev.data.reason, 'sorry_business', 'nothing else written down');
  const me = await call('GET', '/driver/me', 'd1');
  assert.equal(me.acceptance.cancelled_7d, cancelsBefore, 'not counted as a cancellation');
  assert.deepEqual([me.driver.online, me.driver.leave.kind], [false, 'sorry_business']);
  assert.equal((await call('GET', '/admin/drivers/on-leave', 'admin')).items.find((x: any) => x.user_id === d1).label, 'Sorry Business');
  // No paper reminders while on leave.
  const { sendDocExpiryReminders } = await import('../src/services/docExpiry.js');
  await q(`UPDATE drivers SET licence_expiry = (now() AT TIME ZONE 'Australia/Darwin')::date + 14 WHERE user_id = $1`, [d1]);
  const n0 = (await one<{ n: number }>(`SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND category = 'documents'`, [d1]))!.n;
  await sendDocExpiryReminders({ force: true });
  await flushBackground(3000);
  assert.equal((await one<{ n: number }>(`SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND category = 'documents'`, [d1]))!.n, n0);
  await call('POST', `/trips/${t.trip.id}/cancel`, 'rider', {});
  // Back: going online ends the leave.
  assert.equal((await call('POST', '/driver/online', 'd1', { online: true, lat: TODD_MALL.lat, lng: TODD_MALL.lng, battery_pct: 90 })).status, 200);
  assert.equal((await call('GET', '/driver/me', 'd1')).driver.leave, null);
  // Leave taken from the app (no trip): offline at once; "I'm back" ends it.
  const l = await call('POST', '/driver/leave', 'd1', { kind: 'cultural', until: nextYear() });
  assert.equal(l.leave.kind, 'cultural');
  assert.equal((await one(`SELECT online FROM drivers WHERE user_id = $1`, [d1])).online, false);
  assert.equal((await call('DELETE', '/driver/leave', 'd1')).leave, null);
  assert.equal((await call('POST', '/driver/leave', 'd1', { kind: 'holiday' })).status, 400);
  await q(`UPDATE drivers SET licence_expiry = (now() AT TIME ZONE 'Australia/Darwin')::date + 400 WHERE user_id = $1`, [d1]);
});

test('before migration 017: everything else works; concession, client bookings and leave are off or say migration_pending', async () => {
  await q(`ALTER TABLE client_consents RENAME TO client_consents_off`);
  await q(`ALTER TABLE users RENAME COLUMN concession TO concession_off`);
  await q(`ALTER TABLE drivers RENAME COLUMN leave TO leave_off`);
  resetCommunityReady();
  try {
    const cfg = await call('GET', '/public/config');
    assert.deepEqual([cfg.client_bookings, cfg.community_pricing.concession], [false, false]);
    assert.equal((await call('GET', '/me', 'rider')).user.concession, null);
    assert.equal((await call('POST', '/quotes', 'rider', { service: 'ride', pickup: TODD_MALL, dropoff: AIRPORT })).status, 200);
    assert.equal((await call('PUT', '/me/concession', 'rider', { type: 'pensioner', last4: '1234', expires: nextYear() })).status, 503);
    assert.deepEqual((await call('GET', '/me/consents', 'rider')).consents, []);
    assert.equal((await call('GET', '/me/export', 'rider')).status, 200);
    assert.equal((await call('GET', `/business/clients?account_id=${crypto.randomUUID()}`, 'rider')).error, 'migration_pending');
    assert.equal((await call('POST', '/driver/leave', 'd1', { kind: 'sorry_business' })).error, 'migration_pending');
    assert.equal((await call('GET', '/admin/concessions', 'admin')).ready, false);
    // Sorry Business cancel still passes the trip on and isn't counted (just no leave saved).
    await onlyD1Online();
    const t = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'wallet' });
    await waitForOffer('d1');
    await call('POST', `/driver/offers/${t.trip.id}/accept`, 'd1');
    const c = await call('POST', `/driver/trips/${t.trip.id}/cancel`, 'd1', { reason: 'sorry_business' });
    assert.deepEqual([c.status, c.trip.released, c.leave], [200, true, undefined]);
    await call('POST', `/trips/${t.trip.id}/cancel`, 'rider', {});
    assert.equal((await call('POST', '/driver/online', 'd1', { online: true, lat: TODD_MALL.lat, lng: TODD_MALL.lng, battery_pct: 90 })).status, 200);
    const { sendDocExpiryReminders } = await import('../src/services/docExpiry.js');
    await sendDocExpiryReminders({ force: true });
  } finally {
    await q(`ALTER TABLE client_consents_off RENAME TO client_consents`);
    await q(`ALTER TABLE users RENAME COLUMN concession_off TO concession`);
    await q(`ALTER TABLE drivers RENAME COLUMN leave_off TO leave`);
    resetCommunityReady();
  }
});

// ───────────── Round 13: website growth ─────────────
test('driver application funnel: reference + private status link, applicant texted; admin stages, note and funnel; withdraw; guessing limited', async () => {
  const ip = '10.213.0.1';
  const a = await call('POST', '/public/driver-applications', undefined, {
    name: 'Kumanjayi Test Applicant', phone: '0412 555 013', email: 'apply13@example.com', has_cpv_authority: false,
    source: 'Facebook / Driver-Ad!!', drive_state: 'NT', message: 'Car: Toyota Camry',
  }, ip);
  assert.equal(a.status, 201, JSON.stringify(a));
  assert.match(a.ref, /^DA-[A-Z0-9]{6}$/);
  assert.match(a.status_token, /^[a-z0-9]{20}$/);
  assert.ok(a.status_url.endsWith(`/drive/status/${a.status_token}`));
  const stored = await one(`SELECT source, drive_state, status, updated_at FROM driver_applications WHERE id = $1`, [a.id]);
  assert.deepEqual([stored.source, stored.drive_state, stored.status], ['facebook / driver-ad', 'NT', 'new']);
  await flushBackground();
  assert.ok(await one(`SELECT 1 FROM comms_log WHERE template = 'driver_application_received' AND to_tail = '013'`), 'applicant texted the status link');

  // The status page shows the stage and first name only.
  const s = await call('GET', `/public/driver-applications/status/${a.status_token}`, undefined, undefined, ip);
  assert.equal(s.status, 200);
  assert.equal(s.headers['cache-control'], 'no-store');
  assert.deepEqual([s.application.ref, s.application.first_name, s.application.stage, s.application.stage_label, s.application.can_withdraw],
    [a.ref, 'Kumanjayi', 'new', 'Received', true]);
  assert.deepEqual(s.application.steps.map((x: any) => [x.key, x.current]), [['new', true], ['contacted', false], ['onboarding', false], ['approved', false]]);
  const body = JSON.stringify(s.application);
  for (const secret of ['0412', 'apply13@example.com', 'Toyota', 'facebook']) assert.ok(!body.includes(secret), `status page leaks ${secret}`);

  // Admin: list hides the token, has funnel counts by stage and source; stage + note → applicant texted; audit.
  const list = await call('GET', '/admin/applications', 'admin');
  const mine = list.items.find((x: any) => x.id === a.id);
  assert.ok(mine && !('status_token' in mine) && mine.ref === a.ref);
  assert.ok(list.funnel.stages.new >= 1 && list.funnel.sources.some((x: any) => x.source === 'facebook / driver-ad'));
  assert.equal((await call('PATCH', `/admin/applications/${a.id}`, 'admin', { status: 'nonsense' })).status, 400);
  const up = await call('PATCH', `/admin/applications/${a.id}`, 'admin', { status: 'contacted', public_note: 'Book your medical at the Flynn Drive clinic.' });
  assert.equal(up.status, 200);
  assert.ok(!('status_token' in up.item));
  assert.ok(await one(`SELECT 1 FROM comms_log WHERE template = 'driver_application_update'`), 'stage change texted');
  assert.ok(await one(`SELECT 1 FROM audit_log WHERE entity = 'driver_applications' AND entity_id = $1`, [a.id]), 'audited');
  const s2 = await call('GET', `/public/driver-applications/status/${a.status_token}`, undefined, undefined, ip);
  assert.deepEqual([s2.application.stage_label, s2.application.note], ["We've called", 'Book your medical at the Flynn Drive clinic.']);
  assert.deepEqual(s2.application.steps.map((x: any) => x.done), [true, false, false, false]);

  // Applicant withdraws; can't withdraw twice; declined path shows "Not right now" as the last step.
  const w = await call('POST', `/public/driver-applications/status/${a.status_token}/withdraw`, undefined, {}, ip);
  assert.deepEqual([w.status, w.application.stage, w.application.can_withdraw], [200, 'withdrawn', false]);
  assert.equal((await call('POST', `/public/driver-applications/status/${a.status_token}/withdraw`, undefined, {}, ip)).status, 409);
  await call('PATCH', `/admin/applications/${a.id}`, 'admin', { status: 'declined', notify: false });
  const d = await call('GET', `/public/driver-applications/status/${a.status_token}`, undefined, undefined, ip);
  assert.deepEqual(d.application.steps.map((x: any) => x.key), ['new', 'contacted', 'onboarding', 'declined']);

  // Wrong tokens are 404 and counted per IP; after the limit even a right token is refused from that address.
  const guessIp = '10.213.0.99';
  assert.equal((await call('GET', '/public/driver-applications/status/zzzzzzzzzzzzzzzzzzzz', undefined, undefined, guessIp)).status, 404);
  assert.equal((await call('GET', '/public/driver-applications/status/not-a-token', undefined, undefined, guessIp)).status, 404);
  for (let i = 0; i < config.rateLimits.publicFormPerIp * 6; i++) await q(`INSERT INTO rate_events (bucket, key) VALUES ('application_token_ip', $1)`, [guessIp]);
  assert.equal((await call('GET', `/public/driver-applications/status/${a.status_token}`, undefined, undefined, guessIp)).status, 429);
});

test('referral invite links: code check says only valid/invalid and the bonus, misses limited per IP; sign-up with the code links the friend', async () => {
  const me = await one(`SELECT referral_code, name FROM users WHERE phone = '+61400000100'`);
  const ok = await call('GET', `/public/referrals/${me.referral_code.toLowerCase()}`, undefined, undefined, '10.213.1.1');
  assert.deepEqual([ok.status, ok.valid, ok.code, ok.bonus_points], [200, true, me.referral_code.toUpperCase(), config.loyalty.referralBonusPoints]);
  assert.ok(!JSON.stringify(ok).includes(me.name.split(' ')[0] + ' '), 'no referrer name');
  assert.deepEqual(Object.keys(ok).filter((k) => k !== 'status' && k !== 'headers').sort(), ['bonus_points', 'code', 'valid']);
  const miss = await call('GET', '/public/referrals/NOPE9999', undefined, undefined, '10.213.1.2');
  assert.deepEqual([miss.status, miss.valid, miss.code], [200, false, null]);
  assert.equal((await call('GET', '/public/referrals/bad%20code!', undefined, undefined, '10.213.1.2')).valid, false);
  for (let i = 0; i < config.rateLimits.publicFormPerIp * 6; i++) await q(`INSERT INTO rate_events (bucket, key) VALUES ('referral_check_ip', '10.213.1.3')`);
  assert.equal((await call('GET', `/public/referrals/${me.referral_code}`, undefined, undefined, '10.213.1.3')).status, 429);
  // The invite link's code works at sign-up (the rider app pre-fills it from ?ref=).
  const ip = '10.213.1.4';
  const r = await call('POST', '/auth/otp/request', undefined, { phone: '0412 555 014' }, ip);
  const v = await call('POST', '/auth/otp/verify', undefined, { phone: '0412 555 014', code: r.dev_code, name: 'Invited Friend', referral_code: me.referral_code.toLowerCase() }, ip);
  assert.equal(v.status, 200);
  assert.ok(await one(`SELECT 1 FROM referrals rf JOIN users u ON u.id = rf.referee_id WHERE u.phone = '+61412555014'`));
});

test('before migration 018: driver applications are still taken (no status link); status links say migration_pending; admin stages still save', async () => {
  const { resetApplicationsReady } = await import('../src/lib/growth.js');
  const cols = ['ref', 'status_token', 'public_note', 'source', 'drive_state', 'updated_at'];
  for (const c of cols) await q(`ALTER TABLE driver_applications RENAME COLUMN ${c} TO ${c}_off`);
  resetApplicationsReady();
  try {
    const a = await call('POST', '/public/driver-applications', undefined, { name: 'Old Form', phone: '0412 555 015', email: 'old13@example.com', source: 'google' }, '10.213.2.1');
    assert.deepEqual([a.status, a.ref, a.status_token], [201, undefined, undefined]);
    assert.equal((await call('GET', '/public/driver-applications/status/abcdefghijklmnopqrst', undefined, undefined, '10.213.2.1')).error, 'migration_pending');
    const list = await call('GET', '/admin/applications', 'admin');
    assert.deepEqual([list.status, list.status_links, list.funnel.sources], [200, false, []]);
    assert.equal((await call('PATCH', `/admin/applications/${a.id}`, 'admin', { status: 'contacted' })).item.status, 'contacted');
    assert.equal((await call('PATCH', `/admin/applications/${a.id}`, 'admin', { public_note: 'x' })).error, 'migration_pending');
  } finally {
    for (const c of cols) await q(`ALTER TABLE driver_applications RENAME COLUMN ${c}_off TO ${c}`);
    resetApplicationsReady();
  }
});

// ───────────── Round 14: safety and trust ─────────────
const textCount = async (template: string, tripId?: string) =>
  (await one<{ n: number }>(`SELECT count(*)::int n FROM comms_log WHERE template = $1 ${tripId ? 'AND trip_id = $2' : ''}`, tripId ? [template, tripId] : [template]))!.n;
async function rideInProgress() {
  await clearOpenTrips();
  await onlyOnline(['d1']);
  const t = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card' });
  assert.equal(t.status, 201, JSON.stringify(t));
  await waitForOffer('d1');
  assert.equal((await call('POST', `/driver/offers/${t.trip.id}/accept`, 'd1')).status, 200);
  await call('POST', `/driver/trips/${t.trip.id}/arrive`, 'd1');
  const pin = (await one('SELECT verify_pin FROM trips WHERE id = $1', [t.trip.id])).verify_pin;
  assert.equal((await call('POST', `/driver/trips/${t.trip.id}/start`, 'd1', { pin })).trip.status, 'in_progress');
  return t.trip;
}
const setPolicy = async (v: any) => { const r = await call('PUT', '/admin/safety/policy', 'admin', v); assert.equal(r.status, 200, JSON.stringify(r)); return r.policy; };
const resetPolicy = () => q(`DELETE FROM settings WHERE key = 'safety_policy'`);
/** Sign in with the dev code (no new code request: those are limited to one per 30 s per number). */
const code0 = (phone: string) => call('POST', '/auth/otp/verify', undefined, { phone, code: '000000' }, `10.214.${++loginIp % 250}.9`);
const SELFIE = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 0xff, 0xd9]).toString('base64');

test('safety rules: fatigue limits and breaks, policy validation, night window, contacts list', async () => {
  const { fatigueStatus, checkSafetyPolicy, SAFETY_POLICY_DEFAULTS, isNight, contactsOf, darwinHour } = await import('../src/lib/safety.js');
  const p = SAFETY_POLICY_DEFAULTS.fatigue;           // 12 h in 24 h then a 6 h rest; 20 min break after 5 h
  const now = new Date('2026-11-19T12:00:00Z');
  const h = (n: number) => new Date(now.getTime() - n * 3600e3).toISOString();
  // Online 4 h 50 min straight: 10 min left before a break.
  let s = fatigueStatus([{ started_at: h(4 + 50 / 60), ended_at: null }], p, now);
  assert.deepEqual([s.reason, s.minutes_left, s.continuous_min], [null, 10, 290]);
  // 5 h straight, now offline 5 min: break needed until 20 min after stopping. A 10-minute gap doesn't count as a break.
  s = fatigueStatus([{ started_at: h(5 + 5 / 60), ended_at: h(5 / 60) }], p, now);
  assert.equal(s.reason, 'break');
  assert.equal(s.rest_until, new Date(now.getTime() + 15 * 60e3).toISOString());
  s = fatigueStatus([{ started_at: h(5), ended_at: h(3) }, { started_at: h(3 - 10 / 60), ended_at: null }], p, now);
  assert.equal(s.continuous_min, 300, 'short gap: still one stretch (5 h since it started)');
  // After a 30-minute break the stretch starts again.
  s = fatigueStatus([{ started_at: h(7), ended_at: h(3) }, { started_at: h(2.5), ended_at: null }], p, now);
  assert.deepEqual([s.reason, s.continuous_min, s.online_min_24h], [null, 150, 390]);
  // 12 h online in short stretches with breaks: the daily limit, then a 6 h rest. A 6 h rest resets the count.
  const day = [0, 1, 2, 3].map((i) => ({ started_at: h(14 - i * 3.5), ended_at: h(14 - i * 3.5 - 3) }));
  s = fatigueStatus(day, p, now);
  assert.deepEqual([s.online_min_24h, s.reason], [720, 'daily_limit']);
  assert.equal(s.rest_until, new Date(Date.parse(day[3].ended_at) + 360 * 60e3).toISOString());
  s = fatigueStatus(day, p, new Date(Date.parse(day[3].ended_at) + 361 * 60e3));
  assert.deepEqual([s.reason, s.rest_until, s.online_min_24h], [null, null, 0], 'rested: free to go online');
  assert.equal(fatigueStatus(day, { ...p, enabled: false }, now).reason, null);
  // Policy: validated with clear messages, defaults filled in.
  assert.deepEqual(checkSafetyPolicy({}).fatigue, p);
  assert.throws(() => checkSafetyPolicy({ fatigue: { max_online_min_24h: 2000 } }), /daily|24 hours/i);
  assert.throws(() => checkSafetyPolicy({ identity_check: { mode: 'retina' } }), /Photo check/);
  assert.throws(() => checkSafetyPolicy({ fatigue: { break_after_min: 480, max_online_min_24h: 300 } }), /before the daily limit/);
  // Night window wraps past midnight (Darwin time).
  assert.equal(isNight({ from_hour: 21, to_hour: 6 }, new Date('2026-11-19T13:00:00Z')), true, '10:30 pm');
  assert.equal(isNight({ from_hour: 21, to_hour: 6 }, new Date('2026-11-19T03:00:00Z')), false, '12:30 pm');
  assert.equal(darwinHour(new Date('2026-11-19T13:00:00Z')), 22);
  // Contacts: trusted contacts + the emergency contact, one per number.
  assert.deepEqual(contactsOf({ trusted_contacts: [{ name: 'A', phone: '+61411000001' }], emergency_contact: { name: 'A again', phone: '+614 1100 0001' } }).length, 1);
});

test('trusted contacts: validated; trips shared automatically (always / at night) or on demand; SOS texts every contact; driver SOS gives the car position only', async () => {
  const mine = [{ name: 'Aunty May', phone: '0411 000 001' }, { name: 'Jo', phone: '+61411000002' }];
  assert.equal((await call('PUT', '/me/safety', 'rider', { trusted_contacts: [{ name: 'Me', phone: '0400 000 100' }] })).status, 400, 'not your own number');
  assert.equal((await call('PUT', '/me/safety', 'rider', { trusted_contacts: [mine[0], mine[0]] })).status, 400, 'no duplicates');
  assert.equal((await call('PUT', '/me/safety', 'rider', { trusted_contacts: Array.from({ length: 6 }, (_, i) => ({ name: `C${i}`, phone: `+6141100010${i}` })) })).status, 400);
  assert.equal((await call('PUT', '/me/safety', 'rider', { auto_share: 'sometimes' })).status, 400);
  const saved = await call('PUT', '/me/safety', 'rider', { trusted_contacts: mine, auto_share: 'night' });
  assert.deepEqual([saved.status, saved.trusted_contacts[0].phone, saved.auto_share], [200, '+61411000001', 'night']);
  const { darwinHour } = await import('../src/lib/safety.js');
  const hr = darwinHour();
  try {
    // Night trips only, and it's not night: nothing sent.
    await setPolicy({ night: { from_hour: (hr + 2) % 24, to_hour: (hr + 3) % 24 } });
    let trip = await rideInProgress();
    await flushBackground(3000);
    assert.equal(await textCount('trip_shared', trip.id), 0);
    // It's night: shared when the driver accepts.
    await setPolicy({ night: { from_hour: hr, to_hour: (hr + 1) % 24 } });
    trip = await rideInProgress();
    await flushBackground(3000);
    assert.equal(await textCount('trip_shared', trip.id), 2, 'both contacts texted the live link');
    const ev = await one(`SELECT data FROM trip_events WHERE trip_id = $1 AND type = 'shared_with_contacts'`, [trip.id]);
    assert.deepEqual([ev.data.count, ev.data.auto], [2, true], 'no phone numbers on the timeline');
    assert.equal((await call('GET', '/me/safety', 'rider')).trusted_contacts.length, 2);
    // On demand, at most 3 times a trip; strangers can't.
    for (let i = 0; i < 3; i++) assert.equal((await call('POST', `/trips/${trip.id}/share-contacts`, 'rider')).sent, 2);
    assert.equal((await call('POST', `/trips/${trip.id}/share-contacts`, 'rider')).status, 429);
    assert.equal((await call('POST', `/trips/${trip.id}/share-contacts`, 'd2')).status, 404);
    // SOS: trusted contacts and the emergency contact (one text each).
    const sos = await call('POST', `/trips/${trip.id}/sos`, 'rider', { lat: -23.70, lng: 133.88 });
    assert.deepEqual([sos.status, sos.contacts_texted], [200, 3]);
    await flushBackground(3000);
    assert.equal(await textCount('sos_contact', trip.id), 3);
    // Driver SOS: on the trip timeline; the driver's contact gets a map link to the car, never the rider's trip link.
    assert.equal((await call('PUT', '/me/safety', 'd1', { trusted_contacts: [{ name: 'Partner', phone: '0411 000 009' }] })).status, 200);
    await withComms(async () => {
      comms.sms = [];
      const d = await call('POST', '/driver/sos', 'd1', { lat: -23.71, lng: 133.87, message: 'Passenger threatening' });
      assert.deepEqual([d.status, d.contacts_texted], [200, 1]);
      await flushBackground(3000);
      const text = comms.sms.find((x) => x.params.To === '+61411000009')!;
      assert.match(text.params.Body, /maps\.google\.com\/\?q=-23\.71000,133\.87000/);
      assert.ok(!text.params.Body.includes('/track/'), 'no trip link (the rider\'s addresses)');
    });
    assert.ok(await one(`SELECT 1 FROM trip_events WHERE trip_id = $1 AND type = 'sos' AND data->>'role' = 'driver'`, [trip.id]));
    // "Every trip": shared even by day.
    await call('PUT', '/me/safety', 'rider', { auto_share: 'always' });
    await setPolicy({ night: { from_hour: (hr + 2) % 24, to_hour: (hr + 3) % 24 } });
    trip = await rideInProgress();
    await flushBackground(3000);
    assert.equal(await textCount('trip_shared', trip.id), 2);
    assert.equal((await call('GET', '/me/export', 'rider')).user.trusted_contacts.length, 2, 'in the data export');
  } finally {
    await call('PUT', '/me/safety', 'rider', { trusted_contacts: [], auto_share: 'off' });
    await call('PUT', '/me/safety', 'd1', { trusted_contacts: [] });
    await resetPolicy();
    await q(`UPDATE sos_alerts SET status = 'resolved' WHERE status <> 'resolved'`);
    await clearOpenTrips();
  }
});

test('check-ins: a long stop asks "Are you OK?"; OK closes it; no answer or "Get help" raises an SOS and texts contacts; route deviation and ops ask too', async () => {
  const { runSafetyChecks } = await import('../src/services/safety.js');
  await call('PUT', '/me/safety', 'rider', { trusted_contacts: [{ name: 'Aunty May', phone: '0411 000 001' }] });
  const STOP = { lat: -23.7300, lng: 133.8650 };   // 2.5 km past the hospital: not the pickup or drop-off
  const stopFor = async (tripId: string, minutes: number) => {
    await q(`UPDATE trips SET started_at = now() - interval '20 minutes' WHERE id = $1`, [tripId]);
    await q(`INSERT INTO trip_track (trip_id, lat, lng, at) VALUES ($1,$2,$3, now() - make_interval(mins => $4)), ($1,$2,$3, now() - interval '1 minute'), ($1,$2,$3, now())`,
      [tripId, STOP.lat, STOP.lng, minutes]);
  };
  try {
    let trip = await rideInProgress();
    // Moving car: nothing.
    await q(`UPDATE trips SET started_at = now() - interval '20 minutes' WHERE id = $1`, [trip.id]);
    await q(`INSERT INTO trip_track (trip_id, lat, lng, at) VALUES ($1, -23.7200, 133.8700, now() - interval '6 minutes'), ($1, $2, $3, now())`, [trip.id, STOP.lat, STOP.lng]);
    await runSafetyChecks({ force: true });
    assert.deepEqual((await call('GET', `/safety/checks?trip_id=${trip.id}`, 'rider')).checks, []);
    // Stopped 6 minutes away from either end: asked.
    await stopFor(trip.id, 6);
    await runSafetyChecks({ force: true });
    const [check] = (await call('GET', `/safety/checks?trip_id=${trip.id}`, 'rider')).checks;
    assert.equal(check.reason, 'long_stop');
    assert.ok(Date.parse(check.answer_by) > Date.now(), 'answer by');
    await flushBackground(3000);
    assert.ok(await one(`SELECT 1 FROM notifications WHERE user_id = (SELECT rider_id FROM trips WHERE id = $1) AND title = 'Are you OK?'`, [trip.id]));
    await runSafetyChecks({ force: true });
    assert.equal((await one<{ n: number }>(`SELECT count(*)::int n FROM safety_checks WHERE trip_id = $1`, [trip.id]))!.n, 1, 'asked once');
    assert.equal((await call('POST', `/safety/checks/${check.id}`, 'd1', { answer: 'ok' })).status, 404, 'only the rider answers');
    assert.equal((await call('POST', `/safety/checks/${check.id}`, 'rider', { answer: 'ok' })).status, 'ok');
    assert.ok(await one(`SELECT 1 FROM trip_events WHERE trip_id = $1 AND type = 'check_in_ok'`, [trip.id]));

    // No answer within the time: escalated to an SOS alert (ops runbook) and the rider's contacts are texted.
    trip = await rideInProgress();
    await stopFor(trip.id, 7);
    await runSafetyChecks({ force: true });
    const c2 = (await call('GET', `/safety/checks?trip_id=${trip.id}`, 'rider')).checks[0];
    await q(`UPDATE safety_checks SET created_at = now() - interval '4 minutes' WHERE id = $1`, [c2.id]);
    await runSafetyChecks({ force: true });
    const esc = await one(`SELECT status, sos_id FROM safety_checks WHERE id = $1`, [c2.id]);
    assert.equal(esc.status, 'escalated');
    const alert = await one(`SELECT role, message, trip_id FROM sos_alerts WHERE id = $1`, [esc.sos_id]);
    assert.deepEqual([alert.role, alert.trip_id], ['rider', trip.id]);
    assert.match(alert.message, /No answer to a safety check \(long stop\)/);
    await flushBackground(3000);
    assert.equal(await textCount('check_in_escalated_contact', trip.id), 2, 'trusted contact + emergency contact');
    const inc = await call('GET', `/admin/sos/${esc.sos_id}`, 'admin');
    assert.equal(inc.status, 200, 'the usual incident view and runbook');
    // A late "I'm OK" is recorded on the incident for ops.
    assert.equal((await call('POST', `/safety/checks/${c2.id}`, 'rider', { answer: 'ok' })).status, 'escalated');
    assert.ok((await call('GET', `/admin/sos/${esc.sos_id}`, 'admin')).timeline.some((e: any) => /after the check-in was escalated/.test(e.text)));

    // Route deviation asks the same question; "Get help" raises an SOS at once.
    await clearOpenTrips();
    trip = await rideInProgress();
    await call('POST', '/driver/location', 'd1', { lat: -23.60, lng: 133.70 });
    const dev = (await call('GET', `/safety/checks?trip_id=${trip.id}`, 'rider')).checks[0];
    assert.equal(dev.reason, 'route_deviation');
    const help = await call('POST', `/safety/checks/${dev.id}`, 'rider', { answer: 'help' });
    assert.deepEqual([help.status, help.emergency_number], ['help', '000']);
    assert.match((await one(`SELECT message FROM sos_alerts WHERE id = $1`, [help.sos_id])).message, /Asked for help/);
    // Ops can ask (a worried family member rang); one at a time; admin list.
    const ask = await call('POST', `/admin/trips/${trip.id}/check-in`, 'dispatcher');
    assert.equal(ask.check.reason, 'ops');
    assert.equal((await call('POST', `/admin/trips/${trip.id}/check-in`, 'dispatcher')).error, 'check_pending');
    assert.ok((await call('GET', '/admin/safety/checks', 'dispatcher')).items.some((x: any) => x.id === ask.check.id));
    assert.equal((await call('POST', `/admin/trips/${trip.id}/check-in`, 'rider')).status, 403);
    // Switched off: no long-stop checks.
    await setPolicy({ check_ins: { enabled: false } });
    trip = await rideInProgress();
    await stopFor(trip.id, 8);
    await runSafetyChecks({ force: true });
    assert.deepEqual((await call('GET', `/safety/checks?trip_id=${trip.id}`, 'rider')).checks, []);
  } finally {
    await call('PUT', '/me/safety', 'rider', { trusted_contacts: [] });
    await resetPolicy();
    await q(`UPDATE safety_checks SET status = 'ok' WHERE status = 'pending'`);
    await q(`UPDATE sos_alerts SET status = 'resolved' WHERE status <> 'resolved'`);
    await clearOpenTrips();
  }
});

test('fatigue: time online is recorded; over the break limit the driver goes offline after the trip, is told when to come back and can\'t go online until then', async () => {
  const { runSafetyChecks, enforceFatigue } = await import('../src/services/safety.js');
  const d1 = await driverId('+61400000011');
  try {
    await onlyOnline(['d1']);
    assert.ok(await one(`SELECT 1 FROM driver_online_sessions WHERE driver_id = $1 AND ended_at IS NULL`, [d1]), 'session open while online');
    // Pretend d1 has been online for 4 h 45 min: warned once, 15 min left.
    await q(`UPDATE driver_online_sessions SET started_at = now() - interval '285 minutes', warned_at = NULL WHERE driver_id = $1 AND ended_at IS NULL`, [d1]);
    let s = await call('GET', '/driver/safety', 'd1');
    assert.deepEqual([s.fatigue.reason, s.fatigue.minutes_left], [null, 15]);
    await enforceFatigue(d1); await enforceFatigue(d1);
    await flushBackground(3000);
    assert.equal((await one<{ n: number }>(`SELECT count(*)::int n FROM notifications WHERE user_id = $1 AND title = 'Break coming up' AND created_at > now() - interval '1 minute'`, [d1]))!.n, 1);
    // Over the limit on a trip: kept online until it ends, then offline at once.
    const t = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'card' });
    await waitForOffer('d1');
    await q(`UPDATE driver_online_sessions SET started_at = now() - interval '301 minutes' WHERE driver_id = $1 AND ended_at IS NULL`, [d1]);
    await rideToEnd(t.trip.id, 'd1');
    assert.equal((await one(`SELECT online FROM drivers WHERE user_id = $1`, [d1])).online, false, 'offline after the trip');
    assert.equal((await one(`SELECT end_reason FROM driver_online_sessions WHERE driver_id = $1 ORDER BY id DESC LIMIT 1`, [d1])).end_reason, 'fatigue');
    await flushBackground(3000);
    assert.ok(await one(`SELECT 1 FROM notifications WHERE user_id = $1 AND title = 'Time for a break'`, [d1]));
    const r = await call('POST', '/driver/online', 'd1', { online: true, lat: TODD_MALL.lat, lng: TODD_MALL.lng, battery_pct: 90 });
    assert.deepEqual([r.status, r.error], [409, 'fatigue_rest']);
    assert.match(r.message, /break/i);
    assert.ok(Date.parse(r.details.fatigue.rest_until) > Date.now());
    // The admin list shows who is resting.
    assert.ok((await call('GET', '/admin/safety/fatigue', 'dispatcher')).items.some((x: any) => x.driver_id === d1 && x.reason === 'break'));
    // After the break: back online.
    await q(`UPDATE driver_online_sessions SET ended_at = now() - interval '21 minutes' WHERE driver_id = $1 AND end_reason = 'fatigue'`, [d1]);
    assert.equal((await call('POST', '/driver/online', 'd1', { online: true, lat: TODD_MALL.lat, lng: TODD_MALL.lng, battery_pct: 90 })).status, 200);
    // The tick also takes an idle driver offline; sessions follow the online flag whatever changed it.
    await q(`UPDATE driver_online_sessions SET started_at = now() - interval '13 hours' WHERE driver_id = $1 AND ended_at IS NULL`, [d1]);
    await runSafetyChecks({ force: true });
    assert.equal((await one(`SELECT online FROM drivers WHERE user_id = $1`, [d1])).online, false);
    assert.equal((await call('POST', '/driver/online', 'd1', { online: true, lat: TODD_MALL.lat, lng: TODD_MALL.lng, battery_pct: 90 })).message.includes('daily limit'), true);
    // Limits off: no refusal.
    await setPolicy({ fatigue: { enabled: false } });
    assert.equal((await call('POST', '/driver/online', 'd1', { online: true, lat: TODD_MALL.lat, lng: TODD_MALL.lng, battery_pct: 90 })).status, 200);
    assert.equal((await call('PUT', '/admin/safety/policy', 'dispatcher', { fatigue: { enabled: true } })).status, 403, 'admins only');
    assert.equal((await call('PUT', '/admin/safety/policy', 'admin', { fatigue: { break_min: 2 } })).status, 400);
    assert.ok(await one(`SELECT 1 FROM audit_log WHERE action = 'safety_policy_updated'`));
  } finally {
    await resetPolicy();
    await q(`DELETE FROM driver_online_sessions WHERE driver_id = $1`, [d1]);
    await call('POST', '/driver/online', 'd1', { online: false });
    await clearOpenTrips();
  }
});

test('photo check: off by default; when on, a fresh selfie of your own before going online; DingoGo reviews; not accepted takes you offline; face match when set up', async () => {
  const d3 = await driverId('+61400000013');
  const face = { score: 0.95, calls: 0 };
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (c) => { b += c; }); req.on('end', () => { face.calls++; const j = JSON.parse(b); res.end(JSON.stringify(j.selfie && j.reference ? { score: face.score } : {})); }); });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const prev = { ...config.safety };
  const selfie = async (who = 'd3') => (await call('POST', '/uploads', who, { data_url: SELFIE, purpose: 'selfie' })).url as string;
  try {
    await call('POST', '/driver/online', 'd3', { online: false });
    assert.equal((await call('GET', '/driver/safety', 'd3')).identity.due, false, 'off by default');
    await setPolicy({ identity_check: { mode: 'photo_review' } });
    const r = await call('POST', '/driver/online', 'd3', { online: true, lat: -23.70, lng: 133.88, battery_pct: 90 });
    assert.deepEqual([r.status, r.error], [409, 'identity_check_needed']);
    assert.equal((await call('POST', '/uploads', 'rider', { data_url: SELFIE, purpose: 'selfie' })).status, 403, 'drivers only');
    const other = await selfie('d2');
    assert.equal((await call('POST', '/driver/identity-check', 'd3', { photo_url: other })).error, 'invalid_file', 'your own photo');
    const old = await selfie();
    await q(`UPDATE uploads SET created_at = now() - interval '11 minutes' WHERE name = $1`, [old.slice(9)]);
    assert.equal((await call('POST', '/driver/identity-check', 'd3', { photo_url: old })).error, 'photo_too_old');
    const p1 = await selfie();
    const c1 = await call('POST', '/driver/identity-check', 'd3', { photo_url: p1 });
    assert.deepEqual([c1.status, c1.check.status, c1.check.method], [201, 'pending', 'photo_review']);
    assert.equal((await call('POST', '/driver/identity-check', 'd3', { photo_url: p1 })).error, 'photo_used');
    assert.equal((await call('POST', '/driver/online', 'd3', { online: true, lat: -23.70, lng: 133.88, battery_pct: 90 })).status, 200, 'online while it waits for review');
    // Private file: no plain link.
    assert.equal((await app.inject({ method: 'GET', url: p1 })).statusCode, 401);
    const queue = await call('GET', '/admin/identity-checks', 'dispatcher');
    const item = queue.items.find((x: any) => x.id === c1.check.id);
    assert.match(item.photo_url, /sig=/, 'signed for staff');
    assert.equal((await call('PATCH', `/admin/identity-checks/${c1.check.id}`, 'dispatcher', { status: 'rejected' })).status, 400, 'say why');
    await call('PATCH', `/admin/identity-checks/${c1.check.id}`, 'dispatcher', { status: 'rejected', note: 'Face covered' });
    assert.equal((await one(`SELECT online FROM drivers WHERE user_id = $1`, [d3])).online, false, 'taken offline');
    assert.equal((await call('POST', '/driver/online', 'd3', { online: true, lat: -23.70, lng: 133.88, battery_pct: 90 })).error, 'identity_check_rejected');
    const c2 = await call('POST', '/driver/identity-check', 'd3', { photo_url: await selfie() });
    await call('PATCH', `/admin/identity-checks/${c2.check.id}`, 'dispatcher', { status: 'approved' });
    assert.equal((await call('POST', '/driver/online', 'd3', { online: true, lat: -23.70, lng: 133.88, battery_pct: 90 })).status, 200);
    // Daily: yesterday's photo isn't enough.
    await q(`UPDATE identity_checks SET created_at = created_at - interval '25 hours' WHERE driver_id = $1`, [d3]);
    await call('POST', '/driver/online', 'd3', { online: false });
    assert.equal((await call('POST', '/driver/online', 'd3', { online: true, lat: -23.70, lng: 133.88, battery_pct: 90 })).error, 'identity_check_needed');
    // Face match: approved at once against the last approved photo; a poor match waits for review; provider down → review.
    await setPolicy({ identity_check: { mode: 'face_match' } });
    Object.assign(config.safety, { faceMatchUrl: `http://127.0.0.1:${(srv.address() as AddressInfo).port}/match`, faceMatchKey: 'k' });
    const m1 = await call('POST', '/driver/identity-check', 'd3', { photo_url: await selfie() });
    assert.deepEqual([m1.check.status, m1.check.method, Number(m1.check.match_score)], ['approved', 'face_match', 0.95]);
    face.score = 0.4;
    const m2 = await call('POST', '/driver/identity-check', 'd3', { photo_url: await selfie() });
    assert.deepEqual([m2.check.status, Number(m2.check.match_score)], ['pending', 0.4]);
    srv.close();
    const m3 = await call('POST', '/driver/identity-check', 'd3', { photo_url: await selfie() });
    assert.deepEqual([m3.check.status, m3.check.method], ['pending', 'photo_review']);
    assert.equal(face.calls, 2);
  } finally {
    Object.assign(config.safety, prev);
    srv.close();
    await resetPolicy();
    await q(`DELETE FROM identity_checks WHERE driver_id = $1`, [d3]);
    await call('POST', '/driver/online', 'd3', { online: false });
  }
});

test('safety reports: categories, private evidence, critical reports put the other person on hold; ops work the report and the reporter is told', async () => {
  const d1 = await driverId('+61400000011');
  try {
    const trip = await rideInProgress();
    const cats = await call('GET', '/safety/report-categories');
    assert.ok(cats.categories.some((c: any) => c.key === 'wrong_driver_or_car' && c.severity === 'high'));
    const ev = await call('POST', '/uploads', 'rider', { data_url: PNG, purpose: 'evidence' });
    const notMine = await call('POST', '/uploads', 'd2', { data_url: PNG, purpose: 'evidence' });
    assert.equal((await call('POST', '/safety/reports', 'rider', { trip_id: trip.id, category: 'dangerous_driving', description: 'Speeding', evidence: [] })).status, 400, 'a little more detail');
    assert.equal((await call('POST', '/safety/reports', 'rider', { trip_id: trip.id, category: 'dangerous_driving', description: 'Speeding on Larapinta Drive', evidence: [notMine.url] })).error, 'invalid_file');
    assert.equal((await call('POST', '/safety/reports', 'd2', { trip_id: trip.id, category: 'other', description: 'Not my trip at all here' })).status, 404);
    // Critical while the driver is still on the trip: ops are told to hold them after it ends (no hold mid-trip).
    const crit = await call('POST', '/safety/reports', 'rider', { trip_id: trip.id, category: 'sexual_misconduct', description: 'The driver touched me without consent', evidence: [ev.url] });
    assert.deepEqual([crit.status, crit.report.severity, crit.report.ref.startsWith('IR-')], [201, 'critical', true]);
    assert.ok(crit.numbers.some((n: any) => n.number === '1800 737 732'), '1800RESPECT offered');
    assert.equal((await one(`SELECT blocked FROM users WHERE id = $1`, [d1])).blocked, false, 'not mid-trip');
    await call('POST', `/driver/trips/${trip.id}/complete`, 'd1', {});
    // After the trip: a second critical report puts the driver on hold at once.
    const crit2 = await call('POST', '/safety/reports', 'rider', { trip_id: trip.id, category: 'physical_assault', description: 'He grabbed my arm when I got out' });
    assert.equal(crit2.status, 201);
    const held = await one(`SELECT blocked, (SELECT online FROM drivers WHERE user_id = $1) online FROM users WHERE id = $1`, [d1]);
    assert.deepEqual([held.blocked, held.online], [true, false]);
    assert.equal((await one(`SELECT held, status FROM incident_reports WHERE id = $1`, [crit2.report.id])).status, 'investigating');
    const standing = await call('GET', `/admin/users/${d1}/standing`, 'dispatcher');
    assert.deepEqual([standing.restriction.reason_code, standing.restriction.action], ['under_review', 'suspend']);
    // Ops: list (critical first), detail with signed evidence and other reports about the same person, notes, status, outcome.
    const list = await call('GET', '/admin/incidents', 'dispatcher');
    assert.equal(list.items[0].severity, 'critical');
    const det = await call('GET', `/admin/incidents/${crit.report.id}`, 'dispatcher');
    assert.match(det.report.evidence[0].file_url, /sig=/);
    assert.equal(det.other_reports_about_subject.length, 1);
    assert.equal((await app.inject({ method: 'GET', url: ev.url })).statusCode, 401, 'evidence is private');
    await call('PATCH', `/admin/incidents/${crit.report.id}`, 'dispatcher', { note: 'Called the rider, police report made' });
    await call('PATCH', `/admin/incidents/${crit.report.id}`, 'dispatcher', { status: 'actioned', outcome: 'We have taken action on the driver\'s account.' });
    await flushBackground(3000);
    const told = await one(`SELECT body FROM notifications WHERE title = 'Your safety report' ORDER BY id DESC LIMIT 1`);
    assert.match(told.body, new RegExp(crit.report.ref));
    assert.equal((await call('GET', `/admin/incidents/${crit.report.id}`, 'dispatcher')).notes.length, 2);
    // Reporter sees their reports (no details about the other person).
    const mine = await call('GET', '/safety/reports', 'rider');
    const r1 = mine.reports.find((x: any) => x.id === crit.report.id);
    assert.deepEqual([r1.status, r1.subject_id, r1.description], ['actioned', undefined, undefined]);
    assert.equal((await call('GET', `/admin/incidents/${crit.report.id}`, 'rider')).status, 403);
    // Drivers report riders too; a general report (no trip) has no subject.
    const gen = await call('POST', '/safety/reports', 'd2', { category: 'contact_after_trip', description: 'A rider keeps texting my personal number' });
    assert.deepEqual([gen.status, gen.report.severity], [201, 'high']);
    // Limit per day.
    await q(`INSERT INTO rate_events (bucket, key) SELECT 'incident_report', $1 FROM generate_series(1, 10)`, [await driverId('+61400000012')]);
    assert.equal((await call('POST', '/safety/reports', 'd2', { category: 'other', description: 'One more report for today' })).status, 429);
  } finally {
    await q(`UPDATE users SET blocked = false WHERE id = $1`, [d1]);
    await q(`INSERT INTO account_actions (user_id, action, reason_code, public_reason) VALUES ($1, 'lift', 'other', 'test cleanup')`, [d1]);
    await q(`DELETE FROM rate_events WHERE bucket = 'incident_report'`);
    await clearOpenTrips();
  }
});

test('restrict and appeal: suspended with a reason and end date; sign-in refused with the reason and an appeal-only token; appeal once; overturn lifts; suspensions end by themselves', async () => {
  await login('banme', '0400 000 771');
  const id = (await one(`SELECT id FROM users WHERE phone = '+61400000771'`)).id;
  const admin = (await one(`SELECT id FROM users WHERE phone = '+61400000001'`)).id;
  assert.equal((await call('POST', `/admin/users/${id}/restrict`, 'dispatcher', { action: 'suspend', reason_code: 'abuse' })).status, 403, 'admins only');
  assert.equal((await call('POST', `/admin/users/${admin}/restrict`, 'admin', { action: 'ban', reason_code: 'other' })).status, 403, 'not yourself');
  assert.equal((await call('POST', `/admin/users/${id}/restrict`, 'admin', { action: 'ban', reason_code: 'abuse', until: new Date(Date.now() + 864e5).toISOString() })).status, 400, 'end dates are for suspensions');
  const until = new Date(Date.now() + 7 * 864e5).toISOString();
  const s = await call('POST', `/admin/users/${id}/restrict`, 'admin', { action: 'suspend', reason_code: 'abuse', note: 'Swore at the driver (trip DG-TEST)', until });
  assert.equal(s.status, 200);
  assert.equal((await call('GET', '/me', 'banme')).status, 401, 'signed out');
  await flushBackground(3000);
  assert.equal((await one(`SELECT count(*)::int n FROM comms_log WHERE template = 'account_restricted' AND user_id = $1`, [id])).n, 1);
  // Sign-in: refused with the reason (not the private note) and an appeal token.
  const v = await code0('0400 000 771');
  assert.deepEqual([v.status, v.error, v.details.kind], [403, 'account_restricted', 'suspend']);
  assert.match(v.message, /Abusive/);
  assert.ok(!JSON.stringify(v).includes('Swore'), 'private note stays private');
  tokens.appeal = v.details.appeal_token;
  assert.equal((await call('GET', '/me', 'appeal')).status, 401, 'the appeal token is not a sign-in');
  const ws = await app.injectWS(`/ws?token=${tokens.appeal}`);
  ws.send(JSON.stringify({ type: 'ping' }));
  assert.equal(await new Promise<number>((res) => ws.on('close', (c: number) => res(c))), 4001);
  const view = await call('GET', '/appeal', 'appeal');
  assert.deepEqual([view.restriction.kind, Date.parse(view.restriction.until), view.appeal], ['suspend', Date.parse(until), null]);
  assert.equal((await call('POST', '/appeal', 'appeal', { message: 'Sorry' })).status, 400);
  const a = await call('POST', '/appeal', 'appeal', { message: 'I was upset about the fare and I apologise to the driver.' });
  assert.equal(a.status, 201);
  assert.equal((await call('POST', '/appeal', 'appeal', { message: 'Please look again at my account, thank you.' })).error, 'appeal_pending');
  assert.equal((await call('GET', '/appeal', 'rider')).status, 401);
  // Ops decide: overturn lifts the account and texts the person.
  const queue = await call('GET', '/admin/appeals', 'dispatcher');
  assert.ok(queue.items.some((x: any) => x.id === a.appeal.id && x.reason_code === 'abuse'));
  assert.equal((await call('PATCH', `/admin/appeals/${a.appeal.id}`, 'dispatcher', { decision: 'overturned' })).status, 403);
  assert.equal((await call('PATCH', `/admin/appeals/${a.appeal.id}`, 'admin', { decision: 'overturned', note: 'First time, apology accepted' })).status, 200);
  assert.equal((await call('PATCH', `/admin/appeals/${a.appeal.id}`, 'admin', { decision: 'upheld' })).error, 'appeal_decided');
  assert.equal((await one(`SELECT blocked FROM users WHERE id = $1`, [id])).blocked, false);
  tokens.banme = (await code0('0400 000 771')).token;
  assert.equal((await call('GET', '/me', 'banme')).status, 200);
  // A suspension whose end date has passed lifts itself at the next sign-in.
  await call('POST', `/admin/users/${id}/restrict`, 'admin', { action: 'suspend', reason_code: 'repeated_cancellations', until: new Date(Date.now() + 864e5).toISOString() });
  assert.equal((await call('POST', `/admin/users/${id}/restrict`, 'admin', { action: 'ban', reason_code: 'fraud' })).error, 'already_restricted');
  await q(`UPDATE account_actions SET until = now() - interval '1 minute' WHERE user_id = $1 AND action = 'suspend' AND until > now()`, [id]);
  const back = await code0('0400 000 771');
  assert.equal(back.status, 200, 'suspension over: signed in');
  tokens.banme = back.token;
  // Ban, lift by staff (pending appeals resolved), warning (no block), standing history; the old block switch is recorded too.
  await call('POST', `/admin/users/${id}/restrict`, 'admin', { action: 'ban', reason_code: 'fraud', public_reason: 'Promo codes were misused.' });
  const lift = await call('POST', `/admin/users/${id}/lift`, 'admin', { note: 'Checked with the bank: not them' });
  assert.equal(lift.status, 200);
  assert.equal((await call('POST', `/admin/users/${id}/lift`, 'admin', {})).error, 'not_restricted');
  assert.equal((await call('POST', `/admin/users/${id}/restrict`, 'admin', { action: 'warning', reason_code: 'abuse' })).status, 200);
  assert.equal((await one(`SELECT blocked FROM users WHERE id = $1`, [id])).blocked, false, 'a warning doesn\'t block');
  await call('PATCH', `/admin/users/${id}`, 'admin', { blocked: true });
  const st = await call('GET', `/admin/users/${id}/standing`, 'admin');
  assert.deepEqual(st.actions.map((x: any) => x.action), ['ban', 'warning', 'lift', 'ban', 'lift', 'suspend', 'lift', 'suspend']);
  await call('PATCH', `/admin/users/${id}`, 'admin', { blocked: false });
  assert.equal(st.actions[0].by_name !== undefined, true);
  assert.ok((await call('GET', '/me/export', 'banme')).account_actions.length >= 8, 'in the data export');
});

test('emergency card: what to tell 000 (landmark or street address, GPS, car and trip) and support numbers', async () => {
  const geo = http.createServer((req, res) => res.end(JSON.stringify({ features: [{ properties: { label: '10 Gap Rd, The Gap NT 0870' } }] })));
  await new Promise<void>((r) => geo.listen(0, '127.0.0.1', r));
  const prev = { ...config.safety };
  try {
    const plain = await call('GET', '/safety/emergency-card?lat=-23.6984&lng=133.8822', 'rider');
    assert.equal(plain.landmark.name, 'Todd Mall');
    assert.match(plain.say, /I'm at Todd Mall, Alice Springs\. GPS: latitude minus 23\.69840, longitude 133\.88220\./);
    assert.ok(plain.numbers.some((n: any) => n.number === '000'));
    assert.equal((await call('GET', '/safety/emergency-card?lat=-23.7150&lng=133.8770', 'rider')).landmark.direction, 'south');
    const trip = await rideInProgress();
    await call('POST', '/driver/location', 'd1', { lat: -23.7070, lng: 133.8775 });
    const card = await call('GET', `/safety/emergency-card?trip_id=${trip.id}`, 'rider');
    assert.equal(card.trip.ref, trip.ref);
    assert.match(card.say, /I'm in a DingoGo car: .*rego/);
    assert.match(card.dms, /23° 42' .*S, 133° 52' .*E/);
    const dcard = await call('GET', `/safety/emergency-card?lat=-23.707&lng=133.8775`, 'd1');
    assert.match(dcard.say, /I'm a DingoGo driver in a/);
    Object.assign(config.safety, { reverseGeocodeUrl: `http://127.0.0.1:${(geo.address() as AddressInfo).port}/reverse` });
    const addr = await call('GET', `/safety/emergency-card?lat=-23.707&lng=133.8775`, 'rider');
    assert.match(addr.say, /^My location is 10 Gap Rd, The Gap NT 0870\./);
    assert.equal((await call('GET', `/safety/emergency-card?lat=-23.707&lng=133.8775&trip_id=${trip.id}`, 'd2')).trip, null, 'not someone else\'s trip');
    assert.equal((await call('GET', '/safety/emergency-card')).status, 401);
  } finally {
    Object.assign(config.safety, prev);
    geo.close();
    await clearOpenTrips();
  }
});

test('before migration 019: trips, SOS, going online and sign-in all work; safety features are off or say migration_pending', async () => {
  const { resetSafetyReady } = await import('../src/lib/safety.js');
  const tables = ['safety_checks', 'driver_online_sessions', 'identity_checks', 'appeals', 'account_actions', 'incident_reports'];
  for (const t of tables) await q(`ALTER TABLE ${t} RENAME TO ${t}_off`);
  await q(`ALTER TABLE users RENAME COLUMN trusted_contacts TO trusted_contacts_off`);
  await q(`ALTER TABLE users RENAME COLUMN auto_share TO auto_share_off`);
  resetSafetyReady();
  try {
    assert.equal((await call('GET', '/me/safety', 'rider')).ready, false);
    assert.equal((await call('PUT', '/me/safety', 'rider', { auto_share: 'always' })).error, 'migration_pending');
    assert.deepEqual((await call('GET', '/me', 'rider')).user.trusted_contacts, []);
    const trip = await rideInProgress();               // going online + accept (auto-share) + start
    const sos = await call('POST', `/trips/${trip.id}/sos`, 'rider', {});
    assert.deepEqual([sos.status, sos.contacts_texted], [200, 1], 'emergency contact still texted');
    assert.equal((await call('POST', '/driver/sos', 'd1', {})).status, 200);
    await call('POST', '/driver/location', 'd1', { lat: -23.60, lng: 133.70 });   // route deviation: the plain notice
    await flushBackground(3000);
    assert.ok(await one(`SELECT 1 FROM notifications WHERE title = 'Is everything OK?' AND created_at > now() - interval '1 minute'`));
    const { runSafetyChecks } = await import('../src/services/safety.js');
    assert.equal(await runSafetyChecks({ force: true }), null);
    await call('POST', `/driver/trips/${trip.id}/complete`, 'd1', {});
    assert.equal((await call('GET', '/driver/safety', 'd1')).ready, false);
    assert.equal((await call('POST', '/safety/reports', 'rider', { category: 'other', description: 'Something happened here' })).error, 'migration_pending');
    assert.deepEqual((await call('GET', '/safety/reports', 'rider')).reports, []);
    assert.equal((await call('GET', '/safety/emergency-card?lat=-23.6984&lng=133.8822', 'rider')).landmark.name, 'Todd Mall');
    assert.equal((await call('GET', '/admin/incidents', 'admin')).ready, false);
    assert.equal((await call('GET', '/me/export', 'rider')).status, 200);
    // The block switch still works; a blocked account gets the plain message and no appeal token.
    const id = (await one(`SELECT id FROM users WHERE phone = '+61400000771'`)).id;
    await call('PATCH', `/admin/users/${id}`, 'admin', { blocked: true });
    const v = await code0('0400 000 771');
    assert.deepEqual([v.status, v.error, v.details.appeal_token], [403, 'account_restricted', null]);
    await call('PATCH', `/admin/users/${id}`, 'admin', { blocked: false });
  } finally {
    for (const t of tables) await q(`ALTER TABLE ${t}_off RENAME TO ${t}`);
    await q(`ALTER TABLE users RENAME COLUMN trusted_contacts_off TO trusted_contacts`);
    await q(`ALTER TABLE users RENAME COLUMN auto_share_off TO auto_share`);
    resetSafetyReady();
    await q(`UPDATE sos_alerts SET status = 'resolved' WHERE status <> 'resolved'`);
    await clearOpenTrips();
  }
});

// ───────── Round 15: consolidation (business limits, statements, credit trips) ─────────

test('business accounts: monthly limit enforced at booking (live trips count, refunds give room back), refunds on the statement, fields checked', async () => {
  await clearOpenTrips();
  await onlyOnline(['d1']);
  const base = { name: 'Limit Test Pty (test)', kind: 'business', billing_email: 'limit@example.com' };
  assert.equal((await call('POST', '/admin/corporate', 'admin', { ...base, kind: 'bogus' })).status, 400);
  assert.equal((await call('POST', '/admin/corporate', 'admin', { ...base, discount_pct: 80 })).status, 400, 'discount is 0–50%');
  assert.equal((await call('POST', '/admin/corporate', 'admin', { ...base, abn: '1234' })).status, 400);
  assert.equal((await call('POST', '/admin/corporate', 'rider', base)).status, 403);
  const made = await call('POST', '/admin/corporate', 'admin', { ...base, abn: '11 222 333 444', discount_pct: 0 });
  assert.equal(made.status, 201, JSON.stringify(made));
  assert.equal(made.item.abn, '11222333444');
  const acct = made.item.id;
  assert.equal((await call('PATCH', `/admin/corporate/${acct}`, 'admin', { name: base.name, discount_pct: null, invoice_terms_days: null })).item.discount_pct, 0, 'a cleared required field stays as it was');
  assert.equal((await call('POST', `/admin/corporate/${acct}/members`, 'admin', { phone: '0400 000 100' })).status, 200);
  const body = { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'corporate', corporate_account_id: acct };

  const t1 = await call('POST', '/trips', 'rider', body);
  assert.equal(t1.status, 201, 'no limit set: books');
  const quote = t1.trip.quote_cents as number;
  await waitForOffer('d1');
  assert.equal((await rideToEnd(t1.trip.id, 'd1')).final_cents, quote);

  const limit = quote + Math.floor(quote / 2);
  await call('PATCH', `/admin/corporate/${acct}`, 'admin', { monthly_limit_cents: limit });
  const over = await call('POST', '/trips', 'rider', body);
  assert.deepEqual([over.status, over.error], [402, 'account_limit_reached'], JSON.stringify(over));
  assert.deepEqual([over.details.used_cents, over.details.left_cents], [quote, limit - quote]);
  assert.match(over.message, /Limit Test Pty \(test\) has reached its monthly limit/);
  assert.equal((await call('POST', '/trips', 'rider', { ...body, payment_method: 'card' })).status, 201, 'paying another way still works');
  await clearOpenTrips();

  // A refund on a business trip is a credit on the statement and gives the room back.
  const refund = quote - Math.floor(quote / 2);
  assert.equal((await call('POST', `/admin/trips/${t1.trip.id}/refund`, 'admin', { cents: refund, reason: 'Wrong pickup' })).status, 200);
  const st = await call('GET', `/admin/corporate/${acct}/statement`, 'admin');
  assert.equal(st.lines.length, 1);
  assert.deepEqual([st.lines[0].final_cents, st.lines[0].refunded_cents], [quote, refund]);
  assert.deepEqual([st.charges_cents, st.refunds_cents, st.total_cents], [quote, refund, quote - refund]);
  assert.equal(st.gst_cents, Math.round((quote - refund) / 11));
  assert.deepEqual(st.limit, { limit_cents: limit, used_cents: quote - refund, left_cents: limit - quote + refund });
  const t2 = await call('POST', '/trips', 'rider', body);
  assert.equal(t2.status, 201, JSON.stringify(t2));
  assert.equal((await call('GET', `/admin/corporate/${acct}/statement`, 'admin')).limit.left_cents, limit - (quote - refund) - t2.trip.quote_cents, 'a live trip counts at its price');
  await clearOpenTrips();
  await call('PATCH', `/admin/corporate/${acct}`, 'admin', { monthly_limit_cents: null });
  assert.equal((await call('GET', `/admin/corporate/${acct}/statement`, 'admin')).limit, null, 'empty limit = no limit');
  await q(`UPDATE corporate_accounts SET active = false WHERE id = $1`, [acct]);
});

test('credit trips: a longer route never takes DingoGo credit below zero; a late-cancel fee is never more than the price', async () => {
  await clearOpenTrips();
  await onlyOnline(['d1']);
  const start = await wallet();
  const setWallet = (c: number) => q(`UPDATE users SET wallet_cents = $1 WHERE phone = '+61400000100'`, [c]);
  try {
    await setWallet(10_000);
    const t = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'wallet' });
    assert.equal(t.status, 201, JSON.stringify(t));
    const id = t.trip.id, quote = t.trip.quote_cents as number;
    assert.equal(await wallet(), 10_000 - quote, 'taken at booking');
    await setWallet(123);   // spent on something else meanwhile
    await waitForOffer('d1');
    await call('POST', `/driver/offers/${id}/accept`, 'd1');
    await call('POST', `/driver/trips/${id}/arrive`, 'd1');
    const row = await one('SELECT verify_pin, est_distance_m FROM trips WHERE id = $1', [id]);
    await call('POST', `/driver/trips/${id}/start`, 'd1', { pin: row.verify_pin });
    const done = await call('POST', `/driver/trips/${id}/complete`, 'd1', { actual_distance_m: row.est_distance_m * 3 });
    assert.equal(done.trip.final_cents, quote + 120, 'the extra is what credit is left (5c-rounded), not the full +20%');
    assert.equal(await wallet(), 3);
    const fb = (await one('SELECT fare_breakdown FROM trips WHERE id = $1', [id])).fare_breakdown;
    assert.ok(fb.lines.some((l: any) => l.label === 'Route change adjustment (part waived: not enough DingoGo credit)' && l.cents === 120), JSON.stringify(fb.lines));
    const led = await ledgerFor(id);
    assert.equal(led.fare, fb.trip_cents + 120, 'the driver is paid the route change that was charged');

    // A $1 trip (promo covers the fare, the levy is still paid) costs $1 to cancel late, not $3.
    await setWallet(10_000);
    await q(`INSERT INTO promo_codes (code, kind, value, per_user_limit) VALUES ('R15FREE', 'fixed', 99999, 5) ON CONFLICT (code) DO UPDATE SET active = true`);
    const c = await call('POST', '/trips', 'rider', { kind: 'ride', service: 'ride', pickup: TODD_MALL, dropoff: HOSPITAL, payment_method: 'wallet', promo_code: 'R15FREE' });
    assert.equal(c.status, 201, JSON.stringify(c));
    assert.equal(c.trip.quote_cents, 100, 'only the levy');
    await waitForOffer('d1');
    await call('POST', `/driver/offers/${c.trip.id}/accept`, 'd1');
    await q(`UPDATE trips SET accepted_at = now() - interval '5 minutes' WHERE id = $1`, [c.trip.id]);
    assert.equal((await call('POST', `/trips/${c.trip.id}/cancel`, 'rider', {})).status, 200);
    const after = await one('SELECT cancel_fee_cents FROM trips WHERE id = $1', [c.trip.id]);
    assert.equal(after.cancel_fee_cents, 100);
    assert.equal(await wallet(), 10_000 - 100, 'credit never below what the trip cost');
    assert.equal((await one(`SELECT data FROM trip_events WHERE trip_id = $1 AND type = 'cancelled_rider'`, [c.trip.id])).data.fee_waived, 'capped');
    assert.equal((await ledgerFor(c.trip.id)).cancel_fee, 75);
  } finally {
    await setWallet(start);
    await q(`UPDATE promo_codes SET active = false WHERE code = 'R15FREE'`);
    await clearOpenTrips();
  }
});
