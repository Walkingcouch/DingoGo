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
const CAMRY = { rego: 'cd 88 pp', make: 'Toyota', model: 'Camry', year: 2018, colour: 'White', seats: 4, doors: 4, fuel_type: 'petrol', registered_owner: true };

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
    decision: 'approve', cvl_number: 'CVL-9001', cvl_expiry: exp, rego_expiry: exp, insurance_expiry: exp, roadworthy_date: new Date().toISOString().slice(0, 10) });
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
