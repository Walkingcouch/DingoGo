/**
 * Realistic volume for performance work (Round 18): on top of the demo seed, adds LOAD_DRIVERS (50) approved drivers with cars,
 * LOAD_RIDERS (500) riders and LOAD_TRIPS (5000) past trips with offers, events, GPS tracks, ledger lines and notifications, plus a
 * handful of live trips (searching, on the way, under way). Writes signed tokens for scripts/load-test.mjs to `--out` (default
 * ./load-tokens.json). Local databases only: run `npm run db:reset` on a scratch database first.
 *
 *   DATABASE_URL=postgres://dingogo:dingogo@localhost:5432/dingogo_load npx tsx scripts/seed-load.ts --out /tmp/load-tokens.json
 */
import { writeFileSync } from 'node:fs';
import { pool, q } from '../src/db.js';
import { config } from '../src/config.js';
import { isLocalDatabase } from '../src/lib/migrator.js';
import { signToken } from '../src/auth.js';

if (!isLocalDatabase(config.databaseUrl)) {
  console.error('seed-load: refusing a non-local database (it writes thousands of fictional rows).');
  await pool.end();
  process.exit(1);
}
const N_DRIVERS = Number(process.env.LOAD_DRIVERS ?? 50);
const N_RIDERS = Number(process.env.LOAD_RIDERS ?? 500);
const N_TRIPS = Number(process.env.LOAD_TRIPS ?? 5000);
const outArg = process.argv.indexOf('--out');
const out = outArg > 0 ? process.argv[outArg + 1] : 'load-tokens.json';
const t0 = Date.now();

// People: 61 49x xxx xxx numbers are never real mobiles handed out by the seed or the demo list.
await q(`INSERT INTO users (phone, name, role, referral_code)
         SELECT '+6149' || lpad(g::text, 7, '0'), 'Load driver ' || g, 'driver', 'LD' || lpad(g::text, 6, '0') FROM generate_series(1, $1) g
         ON CONFLICT (phone) DO NOTHING`, [N_DRIVERS]);
await q(`INSERT INTO users (phone, name, role, referral_code)
         SELECT '+6148' || lpad(g::text, 7, '0'), 'Load rider ' || g, 'rider', 'LR' || lpad(g::text, 6, '0') FROM generate_series(1, $1) g
         ON CONFLICT (phone) DO NOTHING`, [N_RIDERS]);
const drivers = await q<{ id: string; n: number }>(`SELECT id, substr(phone, 6)::int AS n FROM users WHERE phone LIKE '+6149%' ORDER BY phone`);
const riders = await q<{ id: string }>(`SELECT id FROM users WHERE phone LIKE '+6148%' ORDER BY phone`);

// Cars: a mix of fuels (EV/hybrid get trips first), all approved. Drivers spread over Alice Springs, half of them online.
await q(`INSERT INTO drivers (user_id, status, online, lat, lng, last_seen_at, state)
         SELECT d.id, 'approved', d.n % 2 = 0, -23.70 + (random() - 0.5) * 0.06, 133.88 + (random() - 0.5) * 0.06, now(), 'NT'
         FROM unnest($1::uuid[], $2::int[]) AS d(id, n) ON CONFLICT (user_id) DO NOTHING`, [drivers.map((d) => d.id), drivers.map((d) => d.n)]);
await q(`INSERT INTO vehicles (rego, make, model, year, colour, fuel_type, status, ownership, owner_driver_id, battery_pct, range_km, seats)
         SELECT 'LD' || lpad(d.n::text, 4, '0'), 'Toyota', 'Camry', 2022, 'White',
                (ARRAY['electric','hybrid','petrol','diesel'])[1 + d.n % 4], 'approved', 'driver_owned', d.id, 80, 420, 4
         FROM unnest($1::uuid[], $2::int[]) AS d(id, n) ON CONFLICT (rego) DO NOTHING`, [drivers.map((d) => d.id), drivers.map((d) => d.n)]);
await q(`UPDATE drivers d SET vehicle_id = v.id FROM vehicles v WHERE v.owner_driver_id = d.user_id AND d.vehicle_id IS NULL AND d.user_id = ANY($1)`,
  [drivers.map((d) => d.id)]);

// Past trips over the last 120 days: 90% completed, the rest cancelled or no drivers.
await q(`
  INSERT INTO trips (ref, kind, service, status, rider_id, driver_id, vehicle_id, zone_id, pickup_lat, pickup_lng, pickup_address,
                     dropoff_lat, dropoff_lng, dropoff_address, est_distance_m, est_duration_s, quote_cents, final_cents, fare_breakdown,
                     payment_method, payment_status, verify_pin, share_token, requested_at, accepted_at, started_at, completed_at, cancelled_at)
  SELECT 'LT' || lpad(g::text, 6, '0'), 'ride', 'ride', s.status::trip_status, r.id, d.user_id, d.vehicle_id, 'alice-springs',
         -23.70 + (random() - 0.5) * 0.05, 133.88 + (random() - 0.5) * 0.05, 'Load pickup ' || g,
         -23.70 + (random() - 0.5) * 0.05, 133.88 + (random() - 0.5) * 0.05, 'Load drop-off ' || g,
         4000, 600, 1500, CASE WHEN s.status = 'completed' THEN 1500 END,
         '{"lines":[{"label":"Base fare","cents":300}],"trip_cents":1300,"total_cents":1500}'::jsonb,
         'card', CASE WHEN s.status = 'completed' THEN 'captured' ELSE 'none' END::payment_status, '1234', 'lt' || md5(g::text),
         at, at + interval '1 min', at + interval '6 min', CASE WHEN s.status = 'completed' THEN at + interval '18 min' END,
         CASE WHEN s.status <> 'completed' THEN at + interval '2 min' END
  FROM generate_series(1, $1) g
  CROSS JOIN LATERAL (SELECT now() - (random() * 120) * interval '1 day' - interval '1 hour' AS at) a
  CROSS JOIN LATERAL (SELECT CASE WHEN g % 10 = 0 THEN 'cancelled_rider' WHEN g % 31 = 0 THEN 'no_drivers' ELSE 'completed' END AS status) s
  JOIN LATERAL (SELECT id FROM users WHERE phone LIKE '+6148%' ORDER BY phone OFFSET (g % $2) LIMIT 1) r ON true
  JOIN LATERAL (SELECT user_id, vehicle_id FROM drivers WHERE user_id = ($3::uuid[])[1 + g % $4]) d ON true
  ON CONFLICT (ref) DO NOTHING`, [N_TRIPS, riders.length, drivers.map((d) => d.id), drivers.length]);

await q(`INSERT INTO trip_offers (trip_id, driver_id, status, offered_at, expires_at)
         SELECT id, driver_id, CASE WHEN status = 'completed' THEN 'accepted' ELSE 'expired' END, requested_at, requested_at + interval '20 s'
         FROM trips WHERE ref LIKE 'LT%' AND driver_id IS NOT NULL ON CONFLICT DO NOTHING`);
await q(`INSERT INTO trip_events (trip_id, at, type, data)
         SELECT t.id, t.requested_at + e.o * interval '1 min', e.type, jsonb_build_object('driver_id', t.driver_id, 'pickup_m', 1200)
         FROM trips t CROSS JOIN (VALUES ('requested', 0), ('offered', 0), ('accepted', 1), ('arrived', 5), ('started', 6), ('completed', 18)) e(type, o)
         WHERE t.ref LIKE 'LT%'`);
await q(`INSERT INTO trip_track (trip_id, at, lat, lng)
         SELECT t.id, t.started_at + k * interval '30 s', t.pickup_lat + k * 0.0005, t.pickup_lng + k * 0.0005
         FROM trips t CROSS JOIN generate_series(1, 30) k WHERE t.ref LIKE 'LT%' AND t.status = 'completed'`);
await q(`INSERT INTO driver_ledger (driver_id, trip_id, kind, amount_cents, created_at)
         SELECT t.driver_id, t.id, k.kind, k.amount, t.completed_at
         FROM trips t CROSS JOIN (VALUES ('fare', 1300), ('commission', -325)) k(kind, amount) WHERE t.ref LIKE 'LT%' AND t.status = 'completed'`);
await q(`INSERT INTO notifications (user_id, title, body, created_at, read_at)
         SELECT t.rider_id, 'Your driver is on the way', 'Trip ' || t.ref, t.requested_at, t.requested_at FROM trips t WHERE t.ref LIKE 'LT%'`);

// Live trips right now: 5 searching, 5 accepted (each with its own online driver), so polls and the tick have work to do.
const online = await q<{ user_id: string; vehicle_id: string }>(
  `SELECT user_id, vehicle_id FROM drivers WHERE online AND user_id = ANY($1) ORDER BY user_id LIMIT 5`, [drivers.map((d) => d.id)]);
const live: { id: string; rider: string; driver?: string; status: string }[] = [];
for (let i = 0; i < 10; i++) {
  const d = i >= 5 ? online[i - 5] : null;
  const r = riders[i];
  const t = (await q(
    `INSERT INTO trips (ref, kind, service, status, rider_id, driver_id, vehicle_id, zone_id, pickup_lat, pickup_lng, pickup_address,
                        dropoff_lat, dropoff_lng, dropoff_address, est_distance_m, est_duration_s, quote_cents, fare_breakdown, payment_method,
                        verify_pin, share_token, requested_at, accepted_at)
     VALUES ($1, 'ride', 'ride', $2, $3, $4, $5, 'alice-springs', -23.698, 133.882, 'Todd Mall', -23.8067, 133.9022, 'Alice Springs Airport',
             15000, 900, 3500, '{"lines":[],"trip_cents":3200,"total_cents":3500}', 'cash', '4321', $6, now(), $7)
     ON CONFLICT (ref) DO UPDATE SET status = excluded.status RETURNING id`,
    [`LL${String(i).padStart(4, '0')}`, d ? 'accepted' : 'requested', r.id, d?.user_id ?? null, d?.vehicle_id ?? null, `ll${i}${Date.now()}`, d ? new Date() : null]))[0];
  live.push({ id: t.id, rider: r.id, driver: d?.user_id, status: d ? 'accepted' : 'requested' });
}
await q(`ANALYZE`);

const admin = (await q(`SELECT id FROM users WHERE role = 'admin' ORDER BY created_at LIMIT 1`))[0];
const tok = (id: string, role: any) => signToken({ id, role });
const onlineIds = await q<{ user_id: string }>(`SELECT user_id FROM drivers WHERE online AND user_id = ANY($1)`, [drivers.map((d) => d.id)]);
writeFileSync(out, JSON.stringify({
  admin: admin ? tok(admin.id, 'admin') : null,
  riders: live.map((l) => ({ token: tok(l.rider, 'rider'), trip_id: l.id })).concat(riders.slice(10, 60).map((r) => ({ token: tok(r.id, 'rider'), trip_id: null as any }))),
  drivers: onlineIds.map((d) => ({ token: tok(d.user_id, 'driver'), on_trip: live.some((l) => l.driver === d.user_id) })),
}, null, 1));
const counts = (await q(`SELECT (SELECT count(*) FROM trips) trips, (SELECT count(*) FROM drivers) drivers, (SELECT count(*) FROM trip_track) track,
                                (SELECT count(*) FROM trip_events) events, (SELECT count(*) FROM trip_offers) offers`))[0];
console.log(`seed-load: ${JSON.stringify(counts)} in ${((Date.now() - t0) / 1000).toFixed(1)} s; tokens → ${out}`);
await pool.end();
