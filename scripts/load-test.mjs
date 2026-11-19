#!/usr/bin/env node
/**
 * Small, dependency-free load test of the API's hot paths (Round 18). Each scenario runs for --seconds with --concurrency
 * workers and reports requests/s, p50/p95/p99 latency, errors, 304s and bytes per response.
 *
 *   node scripts/load-test.mjs --base http://127.0.0.1:4100/api --tokens /tmp/load-tokens.json [--seconds 10] [--concurrency 10]
 *                              [--only quote,trip_poll] [--etag] [--json out.json]
 *
 * Tokens come from services/api/scripts/seed-load.ts. With --etag, polling scenarios send If-None-Match like the apps do.
 * Never point this at the live site: it writes location pings and quotes as the seeded load accounts.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i > 0 ? process.argv[i + 1] : d; };
const flag = (k) => process.argv.includes(`--${k}`);
const BASE = arg('base', 'http://127.0.0.1:4100/api').replace(/\/$/, '');
if (/vercel\.app|dingogo\.com/.test(BASE) && !flag('i-know')) { console.error('Refusing to load-test a live host.'); process.exit(1); }
const SECONDS = Number(arg('seconds', 10));
const CONC = Number(arg('concurrency', 10));
const ETAG = flag('etag');
const tok = JSON.parse(readFileSync(arg('tokens', 'load-tokens.json'), 'utf8'));
const liveRiders = tok.riders.filter((r) => r.trip_id);
const pick = (a, i) => a[i % a.length];
const jitter = (n) => n + (Math.random() - 0.5) * 0.01;

/** Each scenario: (i) => request. `key` groups ETags per poller (one phone polls one URL). */
const SCENARIOS = {
  public_config: () => ({ method: 'GET', path: '/public/config', key: 'cfg' }),
  quote: (i) => ({ method: 'POST', path: '/quotes', token: pick(tok.riders, i).token,
    body: { service: 'ride', pickup: { lat: jitter(-23.6984), lng: jitter(133.8822) }, dropoff: { lat: -23.8067, lng: 133.9022 } } }),
  trip_poll: (i) => { const r = pick(liveRiders, i); return { method: 'GET', path: `/trips/${r.trip_id}`, token: r.token, key: `t${i % liveRiders.length}` }; },
  offers_poll: (i) => { const d = pick(tok.drivers, i); return { method: 'GET', path: '/driver/offers', token: d.token, key: `o${i % tok.drivers.length}` }; },
  driver_active: (i) => { const d = pick(tok.drivers, i); return { method: 'GET', path: '/driver/trips/active', token: d.token, key: `a${i % tok.drivers.length}` }; },
  location_ping: (i) => ({ method: 'POST', path: '/driver/location', token: pick(tok.drivers, i).token, body: { lat: jitter(-23.70), lng: jitter(133.88), heading: 90 } }),
  admin_live: () => ({ method: 'GET', path: '/admin/live', token: tok.admin, key: 'live' }),
};
// What a busy hour looks like with realtime off: mostly polls and pings, some quotes.
const MIX = [['offers_poll', 30], ['location_ping', 30], ['trip_poll', 20], ['driver_active', 8], ['quote', 6], ['public_config', 4], ['admin_live', 2]];
const mixPick = (i) => { let r = (i * 7919) % 100; for (const [k, w] of MIX) { if (r < w) return k; r -= w; } return MIX[0][0]; };

const STATS = BASE.replace(/\/api$/, '') + '/__stats';   // scripts/serve-vercel.ts only; absent elsewhere
const stats = async () => { try { const r = await fetch(STATS); return r.ok ? await r.json() : null; } catch { return null; } };

async function run(name) {
  await stats();
  const lat = []; let errors = 0, notModified = 0, bytes = 0, n = 0; const codes = {};
  const etags = new Map();
  const end = Date.now() + SECONDS * 1000;
  let seq = 0;
  async function worker() {
    while (Date.now() < end) {
      const i = seq++;
      const sc = name === 'mixed' ? mixPick(i) : name;
      const r = SCENARIOS[sc](i);
      const headers = { ...(r.body ? { 'content-type': 'application/json' } : {}), ...(r.token ? { authorization: `Bearer ${r.token}` } : {}) };
      const ek = r.key ? `${sc}:${r.key}` : null;
      if (ETAG && ek && etags.has(ek)) headers['if-none-match'] = etags.get(ek);
      const t = performance.now();
      try {
        const res = await fetch(BASE + r.path, { method: r.method, headers, body: r.body ? JSON.stringify(r.body) : undefined });
        const buf = await res.arrayBuffer();
        lat.push(performance.now() - t); n++; bytes += buf.byteLength;
        codes[res.status] = (codes[res.status] ?? 0) + 1;
        if (res.status === 304) notModified++;
        else if (res.status >= 400) errors++;
        const e = res.headers.get('etag'); if (ek && e) etags.set(ek, e);
      } catch { errors++; }
    }
  }
  const t0 = Date.now();
  await Promise.all(Array.from({ length: CONC }, worker));
  const secs = (Date.now() - t0) / 1000;
  lat.sort((a, b) => a - b);
  const st = await stats();
  const p = (q) => lat.length ? Math.round(lat[Math.min(lat.length - 1, Math.floor(q * lat.length))] * 10) / 10 : null;
  return { scenario: name, requests: n, rps: Math.round(n / secs), p50: p(0.5), p95: p(0.95), p99: p(0.99), errors, not_modified: notModified,
    avg_bytes: n ? Math.round(bytes / n) : 0, queries_per_req: st && n ? Math.round(st.queries / n * 10) / 10 : null,
    max_connections: st?.max_connections ?? null, codes };
}

const only = arg('only', '') ? arg('only').split(',') : [...Object.keys(SCENARIOS), 'mixed'];
const results = [];
for (const s of only) {
  if (!SCENARIOS[s] && s !== 'mixed') { console.error(`unknown scenario ${s}`); continue; }
  const r = await run(s);
  results.push(r);
  console.log(`${s.padEnd(14)} ${String(r.rps).padStart(5)} req/s  p50 ${String(r.p50).padStart(6)} ms  p95 ${String(r.p95).padStart(6)} ms  p99 ${String(r.p99).padStart(6)} ms  ` +
    `err ${r.errors}  304 ${r.not_modified}  ${r.avg_bytes} B/resp` + (r.queries_per_req != null ? `  ${r.queries_per_req} q/req  conn ${r.max_connections}` : ''));
}
if (arg('json')) writeFileSync(arg('json'), JSON.stringify({ base: BASE, seconds: SECONDS, concurrency: CONC, etag: ETAG, results }, null, 1));
