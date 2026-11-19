/**
 * Round 26: authorisation matrix (role × route). Every route the API registers must be in test/helpers/routeAccess.ts, and each
 * listing is checked against the running API: signed out → 401, every role that isn't listed → 403 (before anything happens).
 * A new route without a role check, or one missing from the list, fails here. Run with the seeded test database.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer, routeTable } from '../src/index.js';
import { one, pool } from '../src/db.js';
import { signToken, type Role } from '../src/auth.js';
import { config } from '../src/config.js';
import { ROUTE_ACCESS, type Access } from './helpers/routeAccess.js';

process.env.LOG_SMS = 'false';
let app: Awaited<ReturnType<typeof buildServer>>;
const ROLES = ['rider', 'driver', 'partner', 'dispatcher', 'admin'] as const;
const PHONES: Record<(typeof ROLES)[number], string> = {
  rider: '+61400000100', driver: '+61400000011', partner: '+61400000300', dispatcher: '+61400000002', admin: '+61400000001',
};
const tokens: Record<string, string> = {};
const Z = '00000000-0000-0000-0000-000000000000';
let ip = 0;
const key = (r: { method: string; url: string }) => `${r.method} ${r.url}`;

async function hit(method: string, url: string, who?: string, headers: Record<string, string> = {}) {
  const res = await app.inject({
    method: method as any, url: url.replace(/:[A-Za-z_]+/g, Z), remoteAddress: `10.226.${Math.floor(++ip / 250) % 250}.${ip % 250}`,
    payload: method === 'GET' || method === 'DELETE' ? undefined : {},
    headers: { ...(who ? { authorization: `Bearer ${tokens[who]}` } : {}), ...headers },
  });
  return res.statusCode;
}

before(async () => {
  app = await buildServer();
  await app.ready();
  for (const r of ROLES) {
    const u = await one<{ id: string; role: Role }>('SELECT id, role FROM users WHERE phone = $1', [PHONES[r]]);
    assert.equal(u?.role, r, `seeded ${r} account`);
    tokens[r] = signToken(u!);
  }
});
after(async () => { await app.close(); await pool.end(); });

test('every registered route is in the access list, and the list has nothing stale', () => {
  const live = new Set(routeTable.map(key));
  const missing = [...live].filter((k) => !(k in ROUTE_ACCESS));
  const stale = Object.keys(ROUTE_ACCESS).filter((k) => !live.has(k));
  assert.deepEqual(missing, [], 'add these routes to test/helpers/routeAccess.ts with who may call them');
  assert.deepEqual(stale, [], 'these routes are listed but no longer exist');
  assert.ok(live.size > 350, `${live.size} routes`);
});

test('the list follows the path rules: /admin is staff, /driver is drivers, /partner is partners, public routes are known', () => {
  const PUBLIC_OUTSIDE = ['GET /places/search', 'GET /plans', 'GET /safety/report-categories', 'GET /uploads/:name', 'GET /.well-known/assetlinks.json',
    'GET /lite', 'POST /lite/book'];   // Round 28: the low-data page needs a short address
  const roles = (a: Access) => (Array.isArray(a) ? a : null);
  for (const [k, a] of Object.entries(ROUTE_ACCESS)) {
    const path = k.split(' ')[1];
    const r = roles(a);
    if (path.startsWith('/admin/')) assert.ok(r && r.every((x) => x === 'admin' || x === 'dispatcher'), `${k} must be admin or dispatcher only`);
    if (path.startsWith('/driver/')) assert.deepEqual(r, ['driver'], `${k} must be drivers only`);
    if (path.startsWith('/partner/')) assert.ok(r && r.includes('partner') && r.every((x) => x === 'partner' || x === 'admin'), `${k} must be partners only`);
    if (a === 'public') {
      assert.ok(/^\/(public|health|auth)\b/.test(path) || PUBLIC_OUTSIDE.includes(k), `${k} is public outside /public: add it to PUBLIC_OUTSIDE only if it must be`);
      assert.ok(!k.startsWith('DELETE ') && !k.startsWith('PATCH ') && !k.startsWith('PUT '), `${k}: public routes don't change or delete records`);
    }
  }
});

test('signed out: every route that needs an account answers 401 (or its own credential check)', async () => {
  const wrong: string[] = [];
  for (const r of routeTable) {
    const a = ROUTE_ACCESS[key(r)];
    if (!a || a === 'public' || a === 'websocket' || a === 'webhook') continue;
    const s = await hit(r.method, r.url);
    const want = a === 'device' ? 403 : 401;
    if (s !== want) wrong.push(`${key(r)} → ${s} (want ${want})`);
  }
  assert.deepEqual(wrong, []);
});

test('every role not listed for a route is refused with 403', async () => {
  const wrong: string[] = [];
  let checked = 0;
  for (const r of routeTable) {
    const a = ROUTE_ACCESS[key(r)];
    if (!Array.isArray(a)) continue;
    for (const role of ROLES) {
      if (a.includes(role)) continue;
      const s = await hit(r.method, r.url, role);
      checked++;
      if (s !== 403) wrong.push(`${key(r)} as ${role} → ${s}`);
    }
  }
  assert.deepEqual(wrong, []);
  assert.ok(checked > 900, `${checked} role checks`);
});

test('own credentials: appeal routes refuse sign-in tokens, roof screens need their key, webhooks need a valid signature', async () => {
  for (const [k, a] of Object.entries(ROUTE_ACCESS)) {
    const [m, u] = k.split(' ');
    if (a === 'appeal') for (const role of ROLES) assert.equal(await hit(m, u, role), 401, `${k} as ${role}`);
    if (a === 'device') {
      assert.equal(await hit(m, u, 'admin'), 403, `${k} with a staff token`);
      assert.equal(await hit(m, u, undefined, { 'x-display-key': 'not-a-real-key' }), 403, `${k} with a wrong key`);
    }
  }
  // With the provider secrets set, unsigned or wrongly signed webhooks are refused (never processed).
  const prev = { stripe: config.stripe.webhookSecret, twilio: config.twilio.token };
  try {
    config.stripe.webhookSecret = 'whsec_authz_test';
    config.twilio.token = 'authz_test_token';
    for (const [k, a] of Object.entries(ROUTE_ACCESS)) {
      if (a !== 'webhook') continue;
      const [m, u] = k.split(' ');
      const unsigned = await hit(m, u);
      assert.ok(unsigned === 400 || unsigned === 403, `${k} unsigned → ${unsigned}`);
      const bad = await hit(m, u, undefined, { 'stripe-signature': `t=${Math.floor(Date.now() / 1000)},v1=${'0'.repeat(64)}`, 'x-twilio-signature': 'AAAA' });
      assert.ok(bad === 400 || bad === 403, `${k} wrongly signed → ${bad}`);
    }
  } finally {
    config.stripe.webhookSecret = prev.stripe;
    config.twilio.token = prev.twilio;
  }
});
