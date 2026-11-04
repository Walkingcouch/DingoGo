/**
 * Seed data for local development & demos. Partner businesses, advertisers and people are FICTIONAL placeholders.
 * Fares are set just under the NT-regulated Alice Springs taxi tariff ($5.30 flagfall + $2.45/km day, May 2026).
 */
import { pool, q, one } from '../src/db.js';
import { quoteFare } from '../src/lib/fares.js';
import { displayKey, pin4, referralCode, shareToken, tripRef } from '../src/lib/ids.js';

const exists = await one(`SELECT 1 FROM users LIMIT 1`).catch(() => null);
if (exists && !process.argv.includes('--force')) {
  console.log('Database already seeded (use --force after migrate --reset).');
  await pool.end();
  process.exit(0);
}

const today = new Date();
const plusDays = (n: number) => new Date(today.getTime() + n * 864e5).toISOString().slice(0, 10);

// ── Zones
await q(`INSERT INTO zones (id, name, centre_lat, centre_lng, radius_km, active, launch_note) VALUES
  ('alice-springs', 'Alice Springs (Mparntwe)', -23.6980, 133.8807, 25, true, 'Phase 1 — launch'),
  ('tennant-creek', 'Tennant Creek', -19.6497, 134.1912, 15, false, 'Phase 2'),
  ('yulara', 'Yulara / Ayers Rock Resort', -25.2406, 130.9889, 20, false, 'Phase 2 — needs charging plan (450 km from Alice)'),
  ('darwin', 'Darwin', -12.4634, 130.8456, 35, false, 'Phase 3')`);

// ── Fares (cents)
await q(`INSERT INTO fare_rules (service, label, base_cents, per_km_cents, per_min_cents, booking_fee_cents, min_fare_cents, cancel_fee_cents, free_wait_min, wait_per_min_cents, night_pct, holiday_pct, levy_cents, description) VALUES
  ('ride',      'DingoGo Ride',        300, 160, 25, 100, 1000, 300, 3, 50, 20, 15, 100, 'Up to 4 passengers. Electric and hybrid cars get your trip first'),
  ('pet',       'Pet-friendly Ride',   500, 160, 25, 100, 1400, 300, 3, 50, 20, 15, 100, 'Seat covers & harness point. Pets must be leashed or crated'),
  ('courier_s', 'Courier — Small',     600, 120, 15,   0, 1200, 300, 5,  0,  0,  0,   0, 'Satchel or small box, up to 5 kg'),
  ('courier_m', 'Courier — Medium',    900, 140, 20,   0, 1600, 300, 5,  0,  0,  0,   0, 'Box up to 15 kg (fits on back seat)'),
  ('courier_l', 'Courier — Large',    1400, 160, 25,   0, 2400, 300, 5,  0,  0,  0,   0, 'Up to 25 kg, fits in a standard car boot'),
  ('tour',      'Private Tour',          0,   0,  0,   0,    0, 2500, 10, 0,  0,  0, 100, 'Fixed-price private tours, up to 4 guests'),
  ('hourly',    'Hourly Hire',           0,   0, 125, 0, 7500, 2500, 10, 0,  0,  0, 100, 'Events & corporate — $75/hr, 1 hour minimum')`);

await q(`INSERT INTO public_holidays (day, name) VALUES
  ('2026-12-25','Christmas Day'), ('2026-12-26','Boxing Day'), ('2026-12-28','Boxing Day (additional)'),
  ('2027-01-01','New Year''s Day'), ('2027-01-26','Australia Day'), ('2027-03-26','Good Friday'), ('2027-03-27','Easter Saturday'),
  ('2027-03-29','Easter Monday'), ('2027-04-26','Anzac Day (observed)'), ('2027-05-03','May Day'), ('2027-06-14','King''s Birthday'),
  ('2027-07-02','Alice Springs Show Day'), ('2027-08-02','Picnic Day')`);

await q(`INSERT INTO plans (code, name, price_cents, ride_discount_pct, free_deliveries, waive_booking_fee, perks) VALUES
  ('pass', 'DingoGo Pass', 999, 10, 2, true, ARRAY['10% off every ride','No booking fees','2 free small deliveries / month','Double points at partner cafés']),
  ('pass_biz', 'DingoGo Pass Business', 2999, 15, 8, true, ARRAY['15% off every ride','No booking fees','8 free deliveries / month','Priority dispatch'])`);

await q(`INSERT INTO promo_codes (code, kind, value, max_discount_cents, max_uses, per_user_limit, first_trip_only, description) VALUES
  ('WELCOME', 'percent', 50, 1000, NULL, 1, true, '50% off your first trip (up to $10)'),
  ('DELIVER5', 'fixed', 500, NULL, 500, 1, false, '$5 off a delivery')`);

await q(`INSERT INTO settings (key, value) VALUES
  ('business', $1), ('support', $2), ('nt_levy_cents', '100'), ('home_tariff_cents_per_kwh', '30'),
  ('roof_display', $3)`,
  [JSON.stringify({ name: 'DingoGo Rideshare & Courier', legal_name: 'DingoGo Pty Ltd (TBC)', abn: 'TBC', address: 'Alice Springs NT 0870', email: 'contact@aperrke.com.au', owners: 'Johnathan Ah Chee & Micah Bartlett', aboriginal_owned: true }),
   JSON.stringify({ phone: '0432 101 175', email: 'contact@aperrke.com.au', hours: '6am – midnight, 7 days', emergency: '000' }),
   JSON.stringify({ mode: 'ads', note: 'Confirm in writing with NT Passenger Transport Division that roof screens are permitted before switching on in service.' })]);

// ── People
async function user(phone: string, name: string, role: string, extra: Record<string, unknown> = {}) {
  const cols = ['phone', 'name', 'role', 'referral_code', ...Object.keys(extra)];
  const vals = [phone, name, role, referralCode(name), ...Object.values(extra)];
  return (await one(`INSERT INTO users (${cols.join(',')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, vals))!;
}
const admin = await user('+61400000001', 'DingoGo Admin', 'admin', { email: 'admin@example.com' });
await user('+61400000002', 'Dispatch Desk', 'dispatcher');

// ── Vehicles: DingoGo fleet — 3 × BYD Dolphin (60.5 kWh Extended Range, ~427 km WLTP), electric, approved
const veh = async (rego: string, colour: string, extra: Record<string, unknown>) => (await one(
  `INSERT INTO vehicles (rego, make, model, fuel_type, battery_kwh, range_km, status, year, rego_state, verified_year, verified_source, colour, battery_pct, odometer_km, rego_expiry, inspection_expiry, insurance_expiry, cvl_number, cvl_expiry, roadworthy_date, ${Object.keys(extra).join(',')})
   VALUES ($1, 'BYD', 'Dolphin', 'electric', 60.5, 427, 'approved', 2026, 'NT', 2026, 'rego_papers', $2, $3, $4, $5, $5, $5, $6, $5, $7, ${Object.keys(extra).map((_, i) => `$${i + 8}`).join(',')}) RETURNING *`,
  [rego, colour, 80 + Math.floor(Math.random() * 15), 1200 + Math.floor(Math.random() * 3000), plusDays(300), `CVL-${rego}`, plusDays(-20), ...Object.values(extra)]))!;
const v1 = await veh('CA 12 DG', 'Atlantis Grey', { pet_friendly: true, has_roof_display: true, display_key: 'led_demo_vehicle_one_key', ownership: 'fleet' });
const v2 = await veh('CA 34 DG', 'Surf Blue', { has_roof_display: true, display_key: displayKey(), ownership: 'leased_to_driver', lease_weekly_cents: 11333 });
const v3 = await veh('CA 56 DG', 'Ski White', { ownership: 'leased_to_driver', lease_weekly_cents: 11333 });

const drivers = [
  { phone: '+61400000011', name: 'Tjala Kemarre', v: v1, lat: -23.6985, lng: 133.8810, pets: true, female: false, langs: ['en', 'Arrernte'] },
  { phone: '+61400000012', name: 'Sarah Nampijinpa', v: v2, lat: -23.7050, lng: 133.8720, pets: false, female: true, langs: ['en', 'Warlpiri'] },
  { phone: '+61400000013', name: 'Ben Okafor', v: v3, lat: -23.6920, lng: 133.8900, pets: false, female: false, langs: ['en'] },
];
const driverRows: any[] = [];
for (const d of drivers) {
  const u = await user(d.phone, d.name, 'driver', { email: `${d.name.split(' ')[0].toLowerCase()}@example.com` });
  await q(`INSERT INTO drivers (user_id, status, vehicle_id, licence_no, licence_expiry, cpv_authority_no, h_endorsement_expiry, abn, gst_registered,
             bank_bsb, bank_account, languages, accepts_pets, female_driver, police_check_date, medical_date, da_training_date, lat, lng, last_seen_at, bio)
           VALUES ($1,'approved',$2,$3,$4,$5,$4,$6,true,'085001','123456',$7,$8,$9,$10,$10,$10,$11,$12, now(), $13)`,
    [u.id, d.v.id, `NT${Math.floor(1e6 + Math.random() * 9e6)}`, plusDays(700), `H${Math.floor(1e5 + Math.random() * 9e5)}`,
      String(51824753556 + Math.floor(Math.random() * 1000)), d.langs, d.pets, d.female, plusDays(-30), d.lat, d.lng,
      `Local driver, ${d.langs.join(' & ')} speaker.`]);
  // NT driver documents (jurisdictions.driver_docs for NT) + disability awareness
  for (const type of ['licence', 'h_endorsement', 'cpvid', 'police_check', 'medical', 'abn', 'gst', 'disability_awareness']) {
    await q(`INSERT INTO driver_documents (driver_id, type, number, expires_at, status, reviewer_id, reviewed_at) VALUES ($1,$2,$3,$4,'approved',$5, now())`,
      [u.id, type, 'on file', ['licence', 'h_endorsement', 'cpvid'].includes(type) ? plusDays(700) : null, admin.id]);
  }
  driverRows.push(u);
}
// An applicant awaiting review
const applicant = await user('+61400000014', 'Jordan Pepperill', 'driver');
await q(`INSERT INTO drivers (user_id, status, licence_no, abn) VALUES ($1, 'pending_documents', 'NT7712345', '51824753999')`, [applicant.id]);
await q(`INSERT INTO driver_documents (driver_id, type, number, expires_at) VALUES ($1, 'licence', 'NT7712345', $2), ($1, 'police_check', 'NPC-2026-1188', NULL)`, [applicant.id, plusDays(900)]);
// …bringing their own car, waiting for DingoGo to check it (so the admin "Cars to check" queue isn't empty)
const ownCar = await one(
  `INSERT INTO vehicles (rego, make, model, year, colour, seats, doors, fuel_type, ownership, owner_driver_id, status, registered_owner, rego_expiry, roadworthy_date,
     rego_state, vin, vin_year)
   VALUES ('CB47JP', 'Toyota', 'Camry Hybrid', 2019, 'Silver Pearl', 4, 4, 'hybrid', 'driver_owned', $1, 'pending', true, $2, $3,
     'NT', 'JTNBZ3HK9K3012345', 2019) RETURNING *`,
  [applicant.id, plusDays(200), plusDays(-10)]);
await q('UPDATE drivers SET vehicle_id = $2 WHERE user_id = $1', [applicant.id, ownCar.id]);
await q(`INSERT INTO driver_documents (driver_id, vehicle_id, type, number, expires_at) VALUES
  ($1, $2, 'vehicle_rego', 'CB47JP', $3), ($1, $2, 'insurance', 'TPP-55102', $4), ($1, $2, 'roadworthy', 'RW-2026-3391', NULL),
  ($1, $2, 'compliance_plate', 'Built 03/2019', NULL)`,
  [applicant.id, ownCar.id, plusDays(200), plusDays(320)]);

const rider = await user('+61400000100', 'Demo Rider', 'rider', { email: 'rider@example.com', loyalty_points: 1250, wallet_cents: 1500, marketing_opt_in: true,
  emergency_contact: JSON.stringify({ name: 'Demo Contact', phone: '+61400000199' }) });
const riders = [rider];
for (const [i, n] of ['Kim Turner', 'Ali Hassan', 'Rosie Perrurle', 'Tom Chen', 'Mia Brooks', 'Jack Wilson'].entries()) {
  riders.push(await user(`+6140000020${i}`, n, 'rider', { loyalty_points: Math.floor(Math.random() * 900) }));
}

// ── Partners & rewards (fictional demo businesses)
const partner = async (name: string, address: string, lat: number, lng: number, ab: boolean) => (await one(
  `INSERT INTO partners (name, kind, address, lat, lng, aboriginal_owned, settlement_cents_per_redemption, email) VALUES ($1,'cafe',$2,$3,$4,$5,350,'partner@example.com') RETURNING *`,
  [name, address, lat, lng, ab]))!;
const p1 = await partner('Spinifex Café (demo)', 'Todd Mall, Alice Springs', -23.6979, 133.8823, true);
const p2 = await partner('Red Centre Roasters (demo)', 'Gregory Tce, Alice Springs', -23.7005, 133.8812, false);
const p3 = await partner('Desert Bean Kiosk (demo)', 'Larapinta Dr, Araluen', -23.7030, 133.8640, true);
await user('+61400000300', 'Café Counter', 'partner', { partner_id: p1.id });
await q(`INSERT INTO rewards (partner_id, title, description, points_cost, kind) VALUES
  ($1, 'Free regular coffee', 'Any regular hot coffee', 800, 'voucher'),
  ($1, 'Free muffin or slice', 'From the counter', 600, 'voucher'),
  ($2, 'Free regular coffee', 'Any regular hot or iced coffee', 800, 'voucher'),
  ($3, 'Free bush-tea or coffee', 'Native lemon myrtle tea or regular coffee', 700, 'voucher')`, [p1.id, p2.id, p3.id]);
await q(`INSERT INTO rewards (title, description, points_cost, kind, credit_cents) VALUES
  ('$5 ride credit', 'Added to your DingoGo wallet', 500, 'ride_credit', 500),
  ('$12 ride credit', 'Added to your DingoGo wallet', 1100, 'ride_credit', 1200)`);

// ── Corporate / NDIS / community accounts
const corp = await one(`INSERT INTO corporate_accounts (name, kind, abn, billing_email, discount_pct, monthly_limit_cents) VALUES
  ('Desert Conference Centre (demo)', 'business', '11222333444', 'accounts@example.com', 5, 300000) RETURNING *`);
await q(`INSERT INTO corporate_accounts (name, kind, billing_email, invoice_terms_days) VALUES ('Central Plan Managers (demo NDIS)', 'ndis_plan_manager', 'ndis@example.com', 7)`);
await q(`INSERT INTO corporate_members (account_id, user_id, role) VALUES ($1, $2, 'member')`, [corp.id, rider.id]);

// ── Tours (fixed price per vehicle, up to 4 guests)
await q(`INSERT INTO tour_packages (slug, name, summary, description, duration_min, price_cents, stops, cultural_note, requires_permit) VALUES
  ('town-heritage', 'Mparntwe Town & Telegraph Station', 'Two hours around town: Anzac Hill, the Telegraph Station and the Royal Flying Doctor base.',
   'An easy introduction to Alice Springs. Your driver takes you to Anzac Hill for the view over the MacDonnell Ranges, the historic Telegraph Station where the town began, and the RFDS Tourist Facility. Plenty of time for photos.',
   120, 22000, '["Anzac Hill","Alice Springs Telegraph Station","RFDS Tourist Facility"]', 'Alice Springs is Mparntwe, Arrernte Country. Some places around town are sacred sites — your driver will tell you where not to climb or photograph.', false),
  ('west-macs-gaps', 'West MacDonnell Gaps', 'Half day to Simpsons Gap (Rungutjirba) and Standley Chasm (Angkerle Atwatye).',
   'Head west along Larapinta Drive into Tjoritja / West MacDonnell National Park. Walk into Simpsons Gap to look for black-footed rock-wallabies, then continue to Standley Chasm (entry fee payable at the kiosk). Includes cold water.',
   270, 42000, '["Simpsons Gap (Rungutjirba)","Standley Chasm (Angkerle Atwatye)"]', 'Standley Chasm is owned and run by the Iwupataka Land Trust. Please follow signage and the requests of Traditional Owners.', true),
  ('desert-sunset', 'Desert Park & Sunset', 'Alice Springs Desert Park then sunset at Anzac Hill.',
   'Drop-off at Alice Springs Desert Park with a pick-up time that suits you (park entry not included), then on to Anzac Hill for sunset over the ranges.',
   210, 29000, '["Alice Springs Desert Park","Anzac Hill"]', NULL, false),
  ('east-macs-gaps', 'Emily & Jessie Gaps', 'Short trip east to Anthwerrke and Atherrke.',
   'Visit the rock art and waterholes at Emily Gap (Anthwerrke) and Jessie Gap (Atherrke) in the East MacDonnell Ranges, both important Arrernte sites connected to the caterpillar Dreaming.',
   150, 26000, '["Emily Gap (Anthwerrke)","Jessie Gap (Atherrke)"]', 'Anthwerrke is a registered sacred site. Swimming and climbing are not permitted; please photograph the rock art only from the viewing area.', false)`);

// ── Advertising (demo)
const adv = await one(`INSERT INTO advertisers (name, contact_name, email) VALUES ('Spinifex Café (demo)', 'Owner', 'partner@example.com') RETURNING *`);
const adv2 = await one(`INSERT INTO advertisers (name, contact_name, email, community) VALUES ('Community Health Message (demo)', 'Comms', 'health@example.com', true) RETURNING *`);
await q(`INSERT INTO ad_campaigns (advertiser_id, name, headline, subline, bg_colour, fg_colour, starts_on, ends_on, hour_from, hour_to, cpm_cents, weight, status) VALUES
  ($1, 'Morning coffee', 'Spinifex Café ☕', 'Todd Mall · open 6:30am', '#2F7D5B', '#FFFFFF', current_date - 5, current_date + 60, 6, 12, 1500, 2, 'approved'),
  ($2, 'Stay hydrated', 'Hot day? Drink water 💧', 'Check on your mob & neighbours', '#1F5F8B', '#FFFFFF', current_date - 5, current_date + 90, 0, 24, 0, 1, 'approved'),
  ($1, 'Lunch special', 'Lunch at Spinifex', 'Show your DingoGo app for 10% off', '#B4472B', '#FFF5E6', current_date, current_date + 30, 11, 15, 1500, 1, 'pending')`, [adv.id, adv2.id]);
const camps = await q(`SELECT id FROM ad_campaigns WHERE status = 'approved'`);

// ── Vouchers for cash customers
await q(`INSERT INTO gift_vouchers (code, value_cents, batch, expires_at) VALUES ('DGDEMO2026', 2000, 'demo', now() + interval '1 year'), ('DGDEMO5000', 5000, 'demo', now() + interval '1 year')`);

// ── History: ~70 completed trips over the last 14 days (for dashboards & earnings)
const places = [
  { a: 'Alice Springs Airport', lat: -23.8067, lng: 133.9022 }, { a: 'Todd Mall', lat: -23.6984, lng: 133.8822 },
  { a: 'Alice Springs Hospital', lat: -23.7076, lng: 133.8770 }, { a: 'Braitling', lat: -23.6830, lng: 133.8680 },
  { a: 'Larapinta', lat: -23.6950, lng: 133.8350 }, { a: 'Eastside', lat: -23.6950, lng: 133.8960 },
  { a: 'Lasseters Hotel Casino', lat: -23.7178, lng: 133.8869 }, { a: 'Yeperenye Shopping Centre', lat: -23.7008, lng: 133.8818 },
  { a: 'Gillen', lat: -23.7090, lng: 133.8600 }, { a: 'Desert Park', lat: -23.7076, lng: 133.8205 },
];
const rules = Object.fromEntries((await q('SELECT * FROM fare_rules')).map((r) => [r.service, r]));
const { haversine } = await import('../src/lib/geo.js');
for (let i = 0; i < 70; i++) {
  const from = places[Math.floor(Math.random() * places.length)];
  let to = places[Math.floor(Math.random() * places.length)];
  if (to === from) to = places[(places.indexOf(from) + 3) % places.length];
  const service = Math.random() < 0.2 ? 'courier_s' : Math.random() < 0.1 ? 'pet' : 'ride';
  const kind = service.startsWith('courier') ? 'courier' : 'ride';
  const dist = Math.round(haversine(from, to) * 1.3);
  const dur = Math.round(dist / 1000 / 38 * 3600 + 60);
  const at = new Date(Date.now() - Math.random() * 14 * 864e5);
  const quote = quoteFare(rules[service], { distance_m: dist, duration_s: dur, at });
  const d = driverRows[Math.floor(Math.random() * driverRows.length)];
  const r = riders[Math.floor(Math.random() * riders.length)];
  const vehicle = (await one('SELECT vehicle_id FROM drivers WHERE user_id = $1', [d.id])).vehicle_id;
  const pm = kind === 'courier' && Math.random() < 0.3 ? 'cash' : Math.random() < 0.1 ? 'wallet' : 'card';
  const rating = Math.random() < 0.7 ? (Math.random() < 0.85 ? 5 : 4) : null;
  const t = await one(
    `INSERT INTO trips (ref, kind, service, status, zone_id, rider_id, driver_id, vehicle_id, pickup_lat, pickup_lng, pickup_address, dropoff_lat, dropoff_lng, dropoff_address,
       est_distance_m, est_duration_s, actual_distance_m, quote_cents, final_cents, fare_breakdown, payment_method, payment_status, verify_pin, share_token, rider_rating,
       requested_at, accepted_at, arrived_at, started_at, completed_at, tip_cents)
     VALUES ($1,$2,$3,'completed','alice-springs',$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$13,$15,$15,$16,$17,$18,$19,$20,$21,
       $22::timestamptz, $22::timestamptz + interval '1 minute', $22::timestamptz + interval '6 minutes', $22::timestamptz + interval '8 minutes', $22::timestamptz + interval '8 minutes' + make_interval(secs => $14::int), $23) RETURNING *`,
    [tripRef(), kind, service, r.id, d.id, vehicle, from.lat, from.lng, from.a, to.lat, to.lng, to.a, dist, dur, quote.total_cents, JSON.stringify(quote),
      pm, pm === 'cash' ? 'cash_collected' : 'captured', pin4(), shareToken(), rating, at, Math.random() < 0.2 ? 300 : 0]);
  await q(`INSERT INTO payments (trip_id, user_id, provider, kind, amount_cents, gst_cents, status, created_at) VALUES ($1,$2,$3,$4,$5,$6,'succeeded',$7)`,
    [t.id, r.id, pm === 'cash' ? 'cash' : 'mock', pm === 'cash' ? 'cash' : 'capture', t.final_cents, Math.round(t.final_cents / 11), t.completed_at]);
  const commission = Math.round(quote.trip_cents * 0.25);
  await q(`INSERT INTO driver_ledger (driver_id, trip_id, kind, amount_cents, note, created_at) VALUES ($1,$2,'fare',$3,$4,$6), ($1,$2,'commission',$5,'DingoGo service fee 25%',$6)`,
    [d.id, t.id, quote.trip_cents, `Fare ${t.ref}`, -commission, t.completed_at]);
  if (pm === 'cash') await q(`INSERT INTO driver_ledger (driver_id, trip_id, kind, amount_cents, note, created_at) VALUES ($1,$2,'cash_collected',$3,'Cash fare held by driver',$4)`, [d.id, t.id, -t.final_cents, t.completed_at]);
  if (t.tip_cents) await q(`INSERT INTO driver_ledger (driver_id, trip_id, kind, amount_cents, note, created_at) VALUES ($1,$2,'tip',$3,'Tip — 100% to driver',$4)`, [d.id, t.id, t.tip_cents, t.completed_at]);
  if (kind === 'courier') {
    await q(`INSERT INTO parcels (trip_id, size, description, sender_name, sender_phone, recipient_name, recipient_phone, delivery_pin, prohibited_ack, picked_up_at, delivered_at, pod_received_by)
             VALUES ($1,'S','Documents',$2,$3,'Recipient','+61400000999',$4,true,$5,$6,'Recipient')`, [t.id, r.name, r.phone, pin4(), t.started_at, t.completed_at]);
  }
  // ad plays while driving
  if (vehicle !== v3.id) for (let k = 0; k < 6; k++) {
    await q(`INSERT INTO ad_plays (campaign_id, vehicle_id, at, lat, lng) VALUES ($1,$2,$3,$4,$5)`, [camps[k % camps.length].id, vehicle, t.started_at, from.lat, from.lng]);
  }
}
await q(`UPDATE users u SET rating_avg = x.avg, rating_count = x.n FROM
  (SELECT driver_id, round(avg(rider_rating)::numeric,2) avg, count(rider_rating)::int n FROM trips WHERE rider_rating IS NOT NULL GROUP BY driver_id) x WHERE x.driver_id = u.id`);
// Charging history
for (const [i, d] of driverRows.entries()) {
  const vehicle = [v1, v2, v3][i];
  for (let k = 0; k < 6; k++) {
    const start = new Date(Date.now() - (k * 2 + 1) * 864e5 + 20 * 3600e3);
    const kwh = 18 + Math.round(Math.random() * 20);
    await q(`INSERT INTO charging_sessions (driver_id, vehicle_id, location, started_at, ended_at, kwh, tariff_cents_per_kwh, cost_cents, start_pct, end_pct)
             VALUES ($1,$2,$3,$4,$5,$6,30,$7,$8,$9)`,
      [d.id, vehicle.id, k === 2 ? 'public' : 'home', start, new Date(start.getTime() + 5 * 3600e3), kwh, Math.round(kwh * 30), 30 + k, 85 + (k % 3) * 5]);
    await q(`INSERT INTO battery_logs (vehicle_id, driver_id, at, pct, ambient_c) VALUES ($1,$2,$3,$4,$5)`, [vehicle.id, d.id, start, 30 + k, 33 + Math.random() * 8]);
  }
}
await q(`INSERT INTO hire_requests (kind, contact_name, contact_email, organisation, event_date, passengers, vehicles, details) VALUES
  ('conference', 'Event Coordinator', 'events@example.com', 'Desert Conference Centre (demo)', $1, 40, 3, 'Airport transfers for delegates over 2 days')`, [plusDays(21)]);
await q(`INSERT INTO driver_applications (name, phone, email, suburb, has_licence_years, wants_lease, languages, message) VALUES
  ('Applicant Example', '0400 000 555', 'applicant@example.com', 'Braitling', 6, true, 'English, Luritja', 'Keen to drive evenings & weekends')`);

console.log(`✓ Seeded. Admin +61400000001 · Rider +61400000100 · Drivers +61400000011..13 · Café partner +61400000300 · OTP in dev: 000000
  Roof display demo key: led_demo_vehicle_one_key`);
await pool.end();
