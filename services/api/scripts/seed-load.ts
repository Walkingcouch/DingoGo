/**
 * Realistic volume for performance work (Round 18): on top of the demo seed, adds LOAD_DRIVERS (50) approved drivers with cars,
 * LOAD_RIDERS (500) riders and about LOAD_TRIPS (5000) past trips over LOAD_DAYS (120) days with offers, events, GPS tracks, ledger lines,
 * payments, points and notifications, plus driver online shifts (Round 27: shaped like real demand, for the owner insights), and a
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
// Cars: a realistic fuel mix for Alice Springs own-car drivers (15% electric, 35% hybrid, 40% petrol, 10% diesel).
await q(`INSERT INTO vehicles (rego, make, model, year, colour, fuel_type, status, ownership, owner_driver_id, battery_pct, range_km, seats)
         SELECT 'LD' || lpad(d.n::text, 4, '0'), 'Toyota', 'Camry', 2022, 'White',
                CASE WHEN d.n % 20 < 3 THEN 'electric' WHEN d.n % 20 < 10 THEN 'hybrid' WHEN d.n % 20 < 18 THEN 'petrol' ELSE 'diesel' END,
                'approved', 'driver_owned', d.id, 80, 420, 4
         FROM unnest($1::uuid[], $2::int[]) AS d(id, n) ON CONFLICT (rego) DO NOTHING`, [drivers.map((d) => d.id), drivers.map((d) => d.n)]);
await q(`UPDATE drivers d SET vehicle_id = v.id FROM vehicles v WHERE v.owner_driver_id = d.user_id AND d.vehicle_id IS NULL AND d.user_id = ANY($1)`,
  [drivers.map((d) => d.id)]);

// ───────────── Round 27: a realistic history for the owner insights ─────────────
// Deterministic (same seed → same data). Over LOAD_DAYS (120) days: riders join over time and a few ride often; demand follows
// Alice Springs hours (school and work mornings, lunch, after school, Friday and Saturday nights), weekdays and the tourist season,
// grows through the period; drivers work part-time shifts, so trips go to a free driver who is online, wait when everyone is busy
// and end as "no drivers" when nobody is online. Fares come from the fare engine with the real fare rules (promos, points, Pass),
// couriers in business hours, a few tours, payment mix, tips, cancellations with reasons and fees, refunds and points earned.
{
  const DAYS = Number(process.env.LOAD_DAYS ?? 120);
  let seed = 27;
  const rnd = () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pick = <T,>(xs: T[]) => xs[Math.floor(rnd() * xs.length)];
  const logn = (median: number, sigma: number) => median * Math.exp(sigma * Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(2 * Math.PI * rnd()));
  const { quoteFare } = await import('../src/lib/fares.js');
  const rules = Object.fromEntries((await q<any>(`SELECT * FROM fare_rules`)).map((r) => [r.service, r]));
  const holidays = new Set((await q<{ day: string }>(`SELECT day::text AS day FROM public_holidays`)).map((h) => h.day));
  const promo = (await q<any>(`SELECT code, kind, value, max_discount_cents FROM promo_codes WHERE code = 'WELCOME'`))[0] ?? null;
  const TZ_MS = 9.5 * 3600e3;
  const dayStr = (ms: number) => new Date(ms + TZ_MS).toISOString().slice(0, 10);
  const todayLocal = Date.parse(dayStr(Date.now()) + 'T00:00:00Z') - TZ_MS;   // Darwin midnight today, as an instant
  const firstDay = todayLocal - DAYS * 864e5;

  // Demand shape. Hours 0–23 (Darwin), weekdays Monday = 0.
  const HOUR_WEEKDAY = [0.3, 0.15, 0.1, 0.1, 0.2, 0.6, 1.6, 3.2, 3.6, 2.4, 2.0, 2.2, 2.8, 2.6, 2.2, 2.9, 3.1, 3.0, 2.4, 1.8, 1.4, 1.1, 0.8, 0.5];
  const HOUR_WEEKEND = [1.3, 1.1, 0.7, 0.3, 0.2, 0.3, 0.6, 1.0, 1.6, 2.2, 2.6, 2.8, 2.9, 2.6, 2.3, 2.2, 2.3, 2.6, 2.9, 3.0, 2.8, 2.6, 2.2, 1.7];
  const WEEKDAY = [0.9, 0.85, 0.9, 1.0, 1.3, 1.35, 0.85];
  const season = (ms: number) => { const m = Number(dayStr(ms).slice(5, 7)); return m >= 4 && m <= 9 ? 1.15 : m === 12 || m <= 2 ? 0.9 : 1; };
  const hourW = (wd: number, h: number) => (wd === 4 && h >= 18) || wd === 5 || (wd === 6 && h < 18) ? HOUR_WEEKEND[h] : HOUR_WEEKDAY[h];

  // Request times: for each day and hour, a Poisson-ish count scaled so the total is about N_TRIPS, growing ~40% over the period.
  let totalW = 0;
  const slots: { ms: number; w: number }[] = [];
  for (let d = 0; d < DAYS; d++) for (let h = 0; h < 24; h++) {
    const ms = firstDay + d * 864e5 + h * 3600e3;
    const wd = (new Date(ms + TZ_MS).getUTCDay() + 6) % 7;
    const w = hourW(wd, h) * WEEKDAY[wd] * season(ms) * (holidays.has(dayStr(ms)) ? 1.1 : 1) * (0.8 + 0.4 * d / DAYS);
    slots.push({ ms, w }); totalW += w;
  }
  const times: number[] = [];
  for (const s of slots) {
    const lambda = (s.w / totalW) * N_TRIPS;
    let k = Math.floor(lambda); if (rnd() < lambda - k) k++;
    for (let i = 0; i < k; i++) times.push(s.ms + Math.floor(rnd() * 3600e3));
  }
  times.sort((a, b) => a - b);

  // Riders join through the period (more lately); some ride often (Pareto weights), most now and then.
  const riderJoin = riders.map((_, i) => firstDay + Math.floor(Math.pow(rnd(), 0.7) * DAYS) * 864e5 * (i < 40 ? 0 : 1));
  const riderW = riders.map(() => Math.pow(1 - rnd(), -1 / 1.3));
  await q(`UPDATE users u SET created_at = x.at FROM unnest($1::uuid[], $2::timestamptz[]) AS x(id, at) WHERE u.id = x.id`,
    [riders.map((r) => r.id), riderJoin.map((ms) => new Date(ms))]);
  const pickRider = (ms: number) => {
    for (let tries = 0; tries < 30; tries++) {
      const i = Math.floor(rnd() * riders.length);
      if (riderJoin[i] <= ms && rnd() < Math.min(1, riderW[i] / 4)) return i;
    }
    return 0;
  };

  // Drivers: part-time shifts of 4–8 hours. Each day, drivers go online until most hours have about what demand needs (a driver
  // does ~2 trips an hour at best), give or take: some days are short-staffed, nights and early mornings most of all.
  type Shift = { d: number; a: number; b: number };
  const shifts: Shift[] = [];
  const driverW = drivers.map(() => 0.3 + rnd());   // some drivers work far more than others
  for (let day = 0; day < DAYS; day++) {
    const cover = new Array(32).fill(0);
    const need = Array.from({ length: 24 }, (_, h) => {
      const exp = (slots[day * 24 + h].w / totalW) * N_TRIPS;
      const staffing = (h < 5 ? 0.55 : h < 7 ? 0.75 : 1) * (0.7 + rnd() * 0.6);
      return Math.round(Math.max(h >= 6 && h < 23 ? 1 : 0, (exp * 0.55 + 0.4) * staffing));
    });
    const used = new Set<number>();
    for (let h = 0; h < 24; h++) {
      while (cover[h] < need[h] && used.size < drivers.length) {
        let i = -1;
        for (let t = 0; t < 50 && (i < 0 || used.has(i)); t++) { const c = Math.floor(rnd() * drivers.length); if (rnd() < driverW[c] / 1.3) i = c; }
        if (i < 0 || used.has(i)) break;
        used.add(i);
        const len = 4 + rnd() * 4;
        const a = firstDay + day * 864e5 + (h + rnd() * 0.5) * 3600e3;
        shifts.push({ d: i, a, b: a + len * 3600e3 });
        for (let k = h; k < Math.min(32, h + Math.floor(len)); k++) cover[k]++;
      }
    }
  }
  shifts.sort((x, y) => x.a - y.a);
  const busy = new Array(drivers.length).fill(0);
  const feePct = 25;

  const tripRows: any[] = []; const events: any[] = []; const ledger: any[] = []; const pays: any[] = []; const points: any[] = [];
  let g = 0;
  for (const at of times) {
    g++;
    const ref = 'LT' + String(g).padStart(6, '0');
    const local = new Date(at + TZ_MS); const h = local.getUTCHours(); const wd = (local.getUTCDay() + 6) % 7;
    const ri = pickRider(at);
    // Kind and service.
    const businessHours = wd < 5 && h >= 8 && h < 18;
    const r0 = rnd();
    const kind = businessHours && r0 < 0.3 ? 'courier' : !businessHours && r0 < 0.04 ? 'courier' : 'ride';
    let service = kind === 'courier' ? pick(['courier_s', 'courier_s', 'courier_m', 'courier_l']) : rnd() < 0.03 ? 'pet' : 'ride';
    if (kind === 'ride' && h >= 8 && h <= 14 && rnd() < 0.02) service = 'tour';
    const airport = kind === 'ride' && service !== 'tour' && rnd() < 0.08;
    const km = service === 'tour' ? 30 : airport ? 14 + rnd() * 3 : Math.min(25, Math.max(0.8, logn(kind === 'courier' ? 5 : 4.2, 0.55)));
    const min = service === 'tour' ? 120 : km / (h >= 7 && h <= 9 || h >= 15 && h <= 17 ? 32 : 40) * 60 + 1.5 + rnd() * 2;
    const rule = rules[service];
    // Discounts DingoGo funds: Pass on regular riders, a welcome promo, points now and then.
    const pass = riderW[ri] > 3 && rnd() < 0.5 && kind === 'ride';
    const usePromo = promo && rnd() < 0.05 && service !== 'tour';
    const usePoints = !usePromo && rnd() < 0.05 && service !== 'tour';
    const quote = quoteFare(rule, {
      distance_m: Math.round(km * 1000), duration_s: Math.round(min * 60), at: new Date(at), isHoliday: holidays.has(dayStr(at)),
      plan: pass ? { ride_discount_pct: 10, waive_booking_fee: true, free_delivery: false } : null,
      promo: usePromo ? promo : null, pointsToRedeem: usePoints ? 300 + Math.floor(rnd() * 3) * 100 : 0, availablePoints: 2000,
      fixedPriceCents: service === 'tour' ? 22000 : undefined,
    });
    const payment = kind === 'courier' && rnd() < 0.3 ? 'cash' : rnd() < 0.12 ? 'wallet' : 'card';

    // Find a free online driver. Everyone busy: wait for the first to free up (up to 10 min); nobody online: no drivers.
    const onNow = shifts.filter((s) => s.a <= at && s.b > at).map((s) => s.d);
    let driver = -1, acceptMs = at + (15 + rnd() * 50) * 1000;
    const free = onNow.filter((d) => busy[d] <= at);
    if (free.length) driver = pick(free);
    else if (onNow.length) {
      const soonest = onNow.reduce((x, y) => (busy[y] < busy[x] ? y : x));
      if (busy[soonest] - at < 10 * 60e3) { driver = soonest; acceptMs = busy[soonest] + 20e3; }
    }
    const nightly = h < 5 || h >= 22;
    let status = 'completed';
    const roll = rnd();
    if (driver < 0) status = rnd() < 0.7 ? 'no_drivers' : 'cancelled_rider';
    else if (roll < 0.035 + (acceptMs - at > 4 * 60e3 ? 0.15 : 0)) { status = 'cancelled_rider'; driver = -2; }   // gave up before a driver accepted
    else if (roll < 0.065) status = 'cancelled_rider';                                                           // after a driver accepted
    else if (roll < 0.08) status = 'cancelled_driver';
    const assigned = driver >= 0;
    const pickupKm = assigned ? Math.min(12, logn(nightly ? 2.6 : 1.8, 0.5)) : 0;
    const arriveMs = acceptMs + (pickupKm / 35 * 60 + 1 + rnd() * 2) * 60e3;
    const startMs = arriveMs + (0.5 + rnd() * 2.5) * 60e3;
    const endMs = startMs + min * 60e3;
    let cancelMs: number | null = null, cancelFee = 0, cancelReason: string | null = null;
    if (status === 'no_drivers') cancelMs = null;
    else if (status === 'cancelled_rider' && !assigned) { cancelMs = at + (1 + rnd() * 5) * 60e3; cancelReason = pick(['Took too long', 'Found another ride', 'Changed my plans']); }
    else if (status === 'cancelled_rider') {
      cancelMs = acceptMs + (0.5 + rnd() * 6) * 60e3; cancelReason = pick(['Driver too far away', 'Changed my plans', 'Booked by mistake']);
      if (cancelMs - acceptMs > 2 * 60e3 && payment !== 'cash') cancelFee = 300;
    } else if (status === 'cancelled_driver') { cancelMs = acceptMs + (1 + rnd() * 4) * 60e3; cancelReason = pick(['rider_no_show', 'rider_requested']); }
    if (assigned) busy[driver] = status === 'completed' ? endMs : cancelMs ?? acceptMs;
    const done = status === 'completed';
    const tip = done && payment === 'card' && rnd() < 0.1 ? pick([200, 300, 500]) : 0;
    const d = assigned ? drivers[driver] : null;
    tripRows.push({
      ref, kind, service, status, rider_id: riders[ri].id, driver_id: d?.id ?? null, n: d?.n ?? null,
      plat: -23.70 + (rnd() - 0.5) * 0.05, plng: 133.88 + (rnd() - 0.5) * 0.05, dlat: airport ? -23.8067 : -23.70 + (rnd() - 0.5) * 0.05, dlng: airport ? 133.9022 : 133.88 + (rnd() - 0.5) * 0.05,
      paddr: 'Load pickup ' + g, daddr: airport ? 'Alice Springs Airport' : 'Load drop-off ' + g,
      m: Math.round(km * 1000), s: Math.round(min * 60), quote: quote.total_cents, final: done ? quote.total_cents : null, fb: quote,
      discount: quote.discount_cents, points: quote.points_redeemed, promo: usePromo ? promo.code : null, tip, cancel_fee: cancelFee, cancel_reason: cancelReason,
      payment, pstatus: done ? (payment === 'cash' ? 'cash_collected' : 'captured') : 'none',
      requested_at: new Date(at), accepted_at: assigned ? new Date(acceptMs) : null, arrived_at: assigned && (done || status === 'cancelled_driver') ? new Date(arriveMs) : null,
      started_at: done ? new Date(startMs) : null, completed_at: done ? new Date(endMs) : null, cancelled_at: cancelMs ? new Date(cancelMs) : null,
      rating: done && rnd() < 0.6 ? (rnd() < 0.8 ? 5 : 4) : null,
    });
    events.push({ ref, at: new Date(at), type: 'requested', data: {} });
    if (assigned) {
      events.push({ ref, at: new Date(acceptMs), type: 'accepted', data: { driver_id: d!.id, pickup_m: Math.round(pickupKm * 1000) } });
      if (done) { events.push({ ref, at: new Date(arriveMs), type: 'arrived', data: {} }, { ref, at: new Date(startMs), type: 'started', data: {} }, { ref, at: new Date(endMs), type: 'completed', data: {} }); }
    }
    if (done) {
      const fee = Math.round(quote.trip_cents * feePct / 100);
      ledger.push({ ref, kind: 'fare', amount: quote.trip_cents, at: new Date(endMs) }, { ref, kind: 'commission', amount: -fee, at: new Date(endMs) });
      if (tip) ledger.push({ ref, kind: 'tip', amount: tip, at: new Date(endMs) });
      if (payment === 'cash') ledger.push({ ref, kind: 'cash_collected', amount: -quote.total_cents, at: new Date(endMs) });
      pays.push({ ref, provider: payment === 'card' ? 'mock' : payment, kind: payment === 'cash' ? 'cash' : 'capture', amount: quote.total_cents, at: new Date(endMs) });
      if (rnd() < 0.005) pays.push({ ref, provider: 'mock', kind: 'refund', amount: -Math.round(quote.total_cents / 2), at: new Date(endMs + 864e5) });
      points.push({ ref, points: Math.floor(quote.total_cents / 100), at: new Date(endMs) });
    }
    if (cancelFee) ledger.push({ ref, kind: 'cancel_fee', amount: Math.round(cancelFee * 0.75), at: new Date(cancelMs!) });
  }

  const chunk = async <T,>(rows: T[], f: (part: T[]) => Promise<unknown>) => { for (let i = 0; i < rows.length; i += 1000) await f(rows.slice(i, i + 1000)); };
  await chunk(tripRows, (part) => q(`
    INSERT INTO trips (ref, kind, service, status, rider_id, driver_id, vehicle_id, zone_id, pickup_lat, pickup_lng, pickup_address,
                       dropoff_lat, dropoff_lng, dropoff_address, est_distance_m, est_duration_s, actual_distance_m, quote_cents, final_cents, fare_breakdown,
                       discount_cents, points_redeemed, promo_code, tip_cents, cancel_fee_cents, cancel_reason, payment_method, payment_status,
                       verify_pin, share_token, requested_at, accepted_at, arrived_at, started_at, completed_at, cancelled_at, rider_rating)
    SELECT x.ref, x.kind::trip_kind, x.service, x.status::trip_status, x.rider_id, x.driver_id, dr.vehicle_id, 'alice-springs', x.plat, x.plng, x.paddr,
           x.dlat, x.dlng, x.daddr, x.m, x.s, CASE WHEN x.status = 'completed' THEN x.m END, x.quote, x.final, x.fb,
           x.discount, x.points, x.promo, x.tip, x.cancel_fee, x.cancel_reason, x.payment::payment_method, x.pstatus::payment_status,
           '1234', 'lt' || md5(x.ref), x.requested_at, x.accepted_at, x.arrived_at, x.started_at, x.completed_at, x.cancelled_at, x.rating
    FROM jsonb_to_recordset($1::jsonb) AS x(ref text, kind text, service text, status text, rider_id uuid, driver_id uuid, plat float8, plng float8, paddr text,
         dlat float8, dlng float8, daddr text, m int, s int, quote int, final int, fb jsonb, discount int, points int, promo text, tip int, cancel_fee int,
         cancel_reason text, payment text, pstatus text, requested_at timestamptz, accepted_at timestamptz, arrived_at timestamptz, started_at timestamptz,
         completed_at timestamptz, cancelled_at timestamptz, rating int)
    LEFT JOIN drivers dr ON dr.user_id = x.driver_id
    ON CONFLICT (ref) DO NOTHING`, [JSON.stringify(part)]));
  await chunk(events, (part) => q(`INSERT INTO trip_events (trip_id, at, type, actor_id, data)
    SELECT t.id, x.at, x.type, CASE WHEN x.type = 'accepted' THEN t.driver_id END, x.data
    FROM jsonb_to_recordset($1::jsonb) AS x(ref text, at timestamptz, type text, data jsonb) JOIN trips t ON t.ref = x.ref`, [JSON.stringify(part)]));
  await chunk(ledger, (part) => q(`INSERT INTO driver_ledger (driver_id, trip_id, kind, amount_cents, created_at)
    SELECT t.driver_id, t.id, x.kind, x.amount, x.at FROM jsonb_to_recordset($1::jsonb) AS x(ref text, kind text, amount int, at timestamptz) JOIN trips t ON t.ref = x.ref`, [JSON.stringify(part)]));
  await chunk(pays, (part) => q(`INSERT INTO payments (trip_id, user_id, provider, kind, amount_cents, gst_cents, status, created_at)
    SELECT t.id, t.rider_id, x.provider, x.kind, x.amount, round(x.amount / 11.0), 'succeeded', x.at
    FROM jsonb_to_recordset($1::jsonb) AS x(ref text, provider text, kind text, amount int, at timestamptz) JOIN trips t ON t.ref = x.ref`, [JSON.stringify(part)]));
  await chunk(points, (part) => q(`INSERT INTO loyalty_ledger (user_id, points, reason, trip_id, created_at)
    SELECT t.rider_id, x.points, 'trip_earned', t.id, x.at FROM jsonb_to_recordset($1::jsonb) AS x(ref text, points int, at timestamptz) JOIN trips t ON t.ref = x.ref`, [JSON.stringify(part)]));
  // Online time: the past shifts, and an open session for each driver online now.
  await chunk(shifts.filter((s) => s.a < Date.now()), (part) => q(`INSERT INTO driver_online_sessions (driver_id, started_at, ended_at, end_reason)
    SELECT x.driver_id, x.a, least(x.b, now()), 'driver' FROM jsonb_to_recordset($1::jsonb) AS x(driver_id uuid, a timestamptz, b timestamptz)`,
    [JSON.stringify(part.map((s) => ({ driver_id: drivers[s.d].id, a: new Date(s.a), b: new Date(s.b) })))]));
  await q(`INSERT INTO driver_online_sessions (driver_id, started_at) SELECT user_id, now() - interval '90 minutes' FROM drivers d
           WHERE d.online AND d.user_id = ANY($1) AND NOT EXISTS (SELECT 1 FROM driver_online_sessions s WHERE s.driver_id = d.user_id AND s.ended_at IS NULL)`,
    [drivers.map((d) => d.id)]);
  console.log(`seed-load: ${tripRows.length} past trips over ${DAYS} days, ${shifts.length} driver shifts`);
}

await q(`INSERT INTO trip_offers (trip_id, driver_id, status, offered_at, expires_at)
         SELECT id, driver_id, CASE WHEN status = 'completed' THEN 'accepted' ELSE 'expired' END, requested_at, requested_at + interval '20 s'
         FROM trips WHERE ref LIKE 'LT%' AND driver_id IS NOT NULL ON CONFLICT DO NOTHING`);
await q(`INSERT INTO trip_track (trip_id, at, lat, lng)
         SELECT t.id, t.started_at + k * interval '30 s', t.pickup_lat + k * 0.0005, t.pickup_lng + k * 0.0005
         FROM trips t CROSS JOIN generate_series(1, 30) k WHERE t.ref LIKE 'LT%' AND t.status = 'completed'`);
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
