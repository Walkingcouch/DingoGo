/**
 * Round 29: go-live hardening. Runs on its own scratch database (created, bootstrapped without demo data and dropped here), with the
 * API in production sign-in mode (no dev codes): staff sign in with the code from the server log before SMS is set up, everyone else
 * waits for SMS; business details are checked; community routes start closed; the launch checks in /health/deep; production-safe
 * config defaults on Vercel (child processes).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';

const BASE = process.env.DATABASE_URL ?? 'postgres://dingogo:dingogo@localhost:5432/dingogo_test';
const urlFor = (db: string) => { const u = new URL(BASE); u.pathname = '/' + db; return u.toString(); };
const DB = `dingogo_golive_${process.pid}`;
const ROOT = path.resolve(import.meta.dirname, '..');
const server = new pg.Pool({ connectionString: urlFor('postgres'), max: 1 });
const ADMIN = '+61412345678';

// Texts written to the log (no Twilio here), as the hosting log would show them.
const logged: { to: string; body: string }[] = [];
const origLog = console.log;

let app: any;
let dbm: typeof import('../src/db.js');
let R: typeof import('../src/lib/readiness.js');
let A: typeof import('../src/routes/admin.js');
let flush: () => Promise<void>;
let ipn = 0;
async function call(method: string, url: string, token?: string, body?: unknown) {
  const res = await app.inject({ method, url, payload: body, remoteAddress: `10.77.0.${++ipn}`, headers: token ? { authorization: `Bearer ${token}` } : {} });
  return { status: res.statusCode, ...(res.body ? JSON.parse(res.body) : {}) } as any;
}
const codeFor = (phone: string) => [...logged].reverse().find((m) => m.to === phone)?.body.match(/\b(\d{6})\b/)?.[1];

before(async () => {
  await server.query(`DROP DATABASE IF EXISTS ${DB}`);
  await server.query(`CREATE DATABASE ${DB}`);
  Object.assign(process.env, {
    DATABASE_URL: urlFor(DB), OTP_DEV_MODE: 'false', LOG_SMS: 'true', LOG_LEVEL: 'error', BOOTSTRAP_ADMIN_PHONE: '0412 345 678',
    JWT_SECRET: 'golive-test-secret-0123456789abcdefghij', TWILIO_ACCOUNT_SID: '', TWILIO_AUTH_TOKEN: '', OTP_DEMO_PREFIXES: '',
  });
  console.log = (...a: unknown[]) => {
    const m = a.join(' ').match(/\[sms:dev\] → (\S+): (.*)/s);
    if (m) logged.push({ to: m[1], body: m[2] }); else origLog(...a);
  };
  dbm = await import('../src/db.js');
  const B = await import('../src/lib/bootstrap.js');
  const r = await B.bootstrapDatabase(dbm.pool, {});
  assert.equal(r.migrate.error, null);
  assert.equal(r.seed?.admin.status, 'created');
  R = await import('../src/lib/readiness.js');
  A = await import('../src/routes/admin.js');
  flush = (await import('../src/lib/background.js')).flushBackground;
  app = await (await import('../src/index.js')).buildServer();
});
after(async () => {
  console.log = origLog;
  await app?.close();
  await dbm?.pool.end().catch(() => {});
  await server.query(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`).catch(() => {});
  await server.end();
});

test('before SMS is set up: staff sign in with the code from the server log, nobody else can', async () => {
  const r = await call('POST', '/auth/otp/request', undefined, { phone: '0412 345 678' });
  assert.equal(r.status, 200, JSON.stringify(r));
  assert.equal(r.code_in_log, true);
  assert.equal(r.dev_code, undefined, 'no code on screen in production');
  await flush();
  const code = codeFor(ADMIN);
  assert.match(code ?? '', /^\d{6}$/);
  const v = await call('POST', '/auth/otp/verify', undefined, { phone: ADMIN, code, app: 'admin' });
  assert.equal(v.status, 200);
  assert.equal(v.user.role, 'admin');
  assert.equal((await call('POST', '/auth/otp/verify', undefined, { phone: ADMIN, code: '000000', app: 'admin' })).status, 400, '000000 refused');

  // A rider (new number) and a blocked dispatcher get the plain "not switched on yet".
  const rider = await call('POST', '/auth/otp/request', undefined, { phone: '0412 000 222' });
  assert.equal(rider.status, 503);
  assert.equal(rider.error, 'sms_unavailable');
  assert.equal(rider.code_in_log, undefined);
  await dbm.q(`INSERT INTO users (phone, name, role, blocked, referral_code) VALUES ('+61412000333', 'Desk', 'dispatcher', true, 'DESK1'), ('+61412000444', 'Desk two', 'dispatcher', false, 'DESK2')`);
  assert.equal((await call('POST', '/auth/otp/request', undefined, { phone: '+61412000333' })).status, 503, 'blocked staff');
  assert.equal((await call('POST', '/auth/otp/request', undefined, { phone: '+61412000444' })).code_in_log, true, 'dispatcher');
});

test('bootstrap: community routes closed, roof screens off; business details checked', async () => {
  const reg = (await dbm.one(`SELECT value FROM settings WHERE key = 'regional_policy'`))?.value;
  assert.ok(reg?.corridors?.length >= 2);
  assert.ok(reg.corridors.every((c: any) => c.active === false), 'every route closed until the owners open it');
  assert.equal((await dbm.one(`SELECT value FROM settings WHERE key = 'roof_display'`)).value.mode, 'off');

  // Unit: the check itself.
  assert.equal(A.checkBusinessDetails({ name: 'DingoGo', abn: 'TBC' }).abn, 'TBC');
  assert.equal(A.checkBusinessDetails({ name: 'DingoGo', abn: '' }).abn, 'TBC');
  assert.equal(A.checkBusinessDetails({ name: 'DingoGo', abn: '51 824 753 556', email: '' }).abn, '51824753556');
  assert.equal((A.checkBusinessDetails({ name: 'DingoGo', abn: '51824753556', aboriginal_owned: true }) as any).aboriginal_owned, true, 'other fields kept');
  assert.throws(() => A.checkBusinessDetails({ name: 'DingoGo', abn: '12 345 678 901' }), /ATO check/);
  assert.throws(() => A.checkBusinessDetails({ abn: 'TBC' }), /Trading name/);
  assert.throws(() => A.checkBusinessDetails({ name: 'DingoGo', email: 'not an email' }), /Email/);
});

test('launch checks: /health/deep lists what is left, admin page saves change them', async () => {
  const { signToken } = await import('../src/auth.js');
  const admin = signToken({ id: (await dbm.one('SELECT id FROM users WHERE phone = $1', [ADMIN])).id, role: 'admin' });
  const h = await call('GET', '/health/deep', admin);
  assert.equal(h.status, 'ok', 'launch items never make the deploy unhealthy');
  assert.equal(h.launch.ready, false);
  const item = (id: string) => h.launch.items.find((x: any) => x.id === id);
  assert.equal(item('jwt_secret').ok, true);
  assert.equal(item('otp_dev_mode').ok, true);
  assert.equal(item('demo_data').ok, true);
  assert.equal(item('business_abn').ok, false);
  assert.equal(item('sms').ok, false);
  assert.equal(item('community_routes').ok, true, 'closed routes are fine');
  assert.equal((await call('GET', '/health/deep')).launch, undefined, 'summary only without a token');
  for (const x of h.launch.items) assert.doesNotMatch(JSON.stringify(x), /golive-test-secret/, 'never a secret');

  const biz = (await call('GET', '/admin/settings', admin)).items.find((x: any) => x.key === 'business').value;
  assert.equal((await call('PUT', '/admin/settings/business', admin, { value: { ...biz, abn: '12 345 678 901' } })).error, 'invalid_abn');
  const ok = await call('PUT', '/admin/settings/business', admin, { value: { ...biz, abn: '51 824 753 556', legal_name: 'DingoGo Pty Ltd' } });
  assert.equal(ok.status, 200);
  assert.equal(ok.item.value.abn, '51824753556');
  const h2 = await call('GET', '/health/deep', admin);
  assert.equal(h2.launch.items.find((x: any) => x.id === 'business_abn').ok, true);
  assert.equal(h2.launch.items.find((x: any) => x.id === 'legal_name').ok, true);

  // A rider sees no community routes, and a long metered trip is still refused.
  const riderId = (await dbm.one(`INSERT INTO users (phone, name, role, referral_code) VALUES ('+61412000555', 'Rider', 'rider', 'RIDE1') RETURNING id`)).id;
  const rider = signToken({ id: riderId, role: 'rider' });
  const c = await call('GET', '/regional', rider);
  assert.equal(c.status, 200);
  assert.equal(c.corridors.length, 0);
  const qt = await call('POST', '/quotes', rider, { service: 'ride', pickup: { lat: -23.6984, lng: 133.8822 }, dropoff: { lat: -23.9425, lng: 132.778 } });
  assert.equal(qt.error, 'too_far_for_town_fare');
});

test('launch checks (unit): placeholders and unsafe settings are flagged', () => {
  const env = { jwtSecret: 'change-me-to-a-long-random-string', otpDevMode: true, demoPrefixes: 1, mockCards: 'all', publicWebUrl: 'http://localhost:5173',
    corsOrigins: ['*'], healthToken: false, autoMigrate: false, demoAccounts: 10, integrations: {} };
  const items = R.readinessItems(env, { business: { abn: 'TBC', legal_name: 'DingoGo Pty Ltd (TBC)' }, roof_display: { mode: 'ads' } });
  const bad = items.filter((x) => !x.ok).map((x) => x.id);
  for (const id of ['jwt_secret', 'otp_dev_mode', 'demo_sign_in', 'demo_data', 'mock_cards', 'public_web_url', 'cors', 'health_token', 'sms', 'business_abn',
    'legal_name', 'roof_display', 'payments', 'routing', 'auto_migrate', 'driver_pay', 'billing_pay_to']) assert.ok(bad.includes(id), id);
  // No regional setting = code defaults (routes open, not checked) → flagged.
  assert.equal(items.find((x) => x.id === 'community_routes')!.ok, false);
  const good = R.readinessItems({ jwtSecret: 'k'.repeat(48), otpDevMode: false, demoPrefixes: 0, mockCards: 'test', publicWebUrl: 'https://dingogo.com.au',
    corsOrigins: ['https://dingogo.com.au'], healthToken: true, autoMigrate: true, demoAccounts: 0,
    integrations: { sms: 'configured', payments: 'configured', payments_webhook: 'configured', card_elements: 'configured', routing: 'configured', sms_replies: 'configured', push_fcm: 'configured', error_reporting: 'configured' } },
  { business: { abn: '51824753556', legal_name: 'DingoGo Pty Ltd' }, roof_display: { mode: 'off' }, regional_policy: { corridors: [] },
    driver_pay: { service_fee: { own_car_pct: 20, green_pct: 15 } }, business_billing: { pay_to: 'BSB 085-005 Account 1234 5678' } });
  assert.deepEqual(good.filter((x) => !x.ok).map((x) => x.id), []);
  assert.ok(items.every((x) => ['must', 'keys', 'confirm'].includes(x.group) && x.where.length > 3));
});

test('config on Vercel: production defaults whatever NODE_ENV says, placeholder secrets refused', () => {
  const run = (env: Record<string, string>) => spawnSync(process.execPath, ['--import', 'tsx', '-e',
    `const { config } = await import('./src/config.ts'); console.log(JSON.stringify({ dev: config.otpDevMode, cards: config.mockCards, prod: config.production }));`],
  { cwd: ROOT, encoding: 'utf8', env: { PATH: process.env.PATH ?? '', HOME: process.env.HOME ?? '', ...env } });
  const ok = run({ VERCEL: '1', JWT_SECRET: 's'.repeat(40) });
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(JSON.parse(ok.stdout.trim().split('\n').pop()!), { dev: false, cards: 'test', prod: true });
  for (const jwt of [undefined, 'change-me-to-a-long-random-string', 'dev-only-change-me']) {
    const r = run({ VERCEL: '1', ...(jwt ? { JWT_SECRET: jwt } : {}) });
    assert.notEqual(r.status, 0, `JWT_SECRET ${jwt ?? '(unset)'} must be refused`);
    assert.match(r.stderr, /JWT_SECRET must be set/);
  }
  const local = run({});
  assert.equal(local.status, 0, local.stderr);
  assert.deepEqual(JSON.parse(local.stdout.trim().split('\n').pop()!), { dev: true, cards: 'all', prod: false }, 'local development unchanged');
  const explicit = run({ VERCEL: '1', JWT_SECRET: 's'.repeat(40), OTP_DEV_MODE: 'true' });
  assert.equal(JSON.parse(explicit.stdout.trim().split('\n').pop()!).dev, true, 'an explicit OTP_DEV_MODE still wins');
});
