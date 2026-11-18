/**
 * Round 10: operability. Runs against its own throwaway databases (created and dropped here), so it never touches the e2e
 * database and can run alongside it: bootstrap, migrations under concurrency and failure, AUTO_MIGRATE, /health/deep,
 * structured logs with request ids, error mapping, Sentry reporting, the Vercel entry with the database down, script guards
 * and backups.
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { Writable } from 'node:stream';
import type { AddressInfo } from 'node:net';
import pg from 'pg';

const BASE = process.env.DATABASE_URL ?? 'postgres://dingogo:dingogo@localhost:5432/dingogo_test';
const urlFor = (db: string, user?: string, pass?: string) => {
  const u = new URL(BASE); u.pathname = '/' + db;
  if (user) { u.username = user; u.password = pass ?? ''; }
  return u.toString();
};
const suffix = `${process.pid}`;
const DB = `dingogo_ops_${suffix}`, DB2 = `dingogo_ops2_${suffix}`, DB3 = `dingogo_ops3_${suffix}`, DB4 = `dingogo_ops4_${suffix}`;
const API_ROLE = `dingogo_api_t${suffix}`;
const ROOT = path.resolve(import.meta.dirname, '..');
const server = new pg.Pool({ connectionString: urlFor('postgres'), max: 2 });

// A fake Sentry: records envelopes.
const envelopes: { url: string; auth: string; body: string }[] = [];
const sentry = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => { envelopes.push({ url: req.url ?? '', auth: String(req.headers['x-sentry-auth'] ?? ''), body: b }); res.end('{}'); });
});

// Log lines written by the API in this process.
const lines: any[] = [];
const sink = new Writable({ write(chunk, _e, cb) { for (const l of String(chunk).split('\n').filter(Boolean)) { try { lines.push(JSON.parse(l)); } catch { /* not JSON */ } } cb(); } });

let M: typeof import('../src/lib/migrator.js');
let B: typeof import('../src/lib/bootstrap.js');
let S: typeof import('../src/lib/dbSecurity.js');
let Seed: typeof import('../src/lib/baseSeed.js');
let L: typeof import('../src/lib/log.js');
let dbm: typeof import('../src/db.js');
let cfg: typeof import('../src/config.js')['config'];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until(f: () => boolean, ms = 3000) { const t = Date.now(); while (!f() && Date.now() - t < ms) await wait(20); }

before(async () => {
  for (const d of [DB, DB2, DB3, DB4]) { await server.query(`DROP DATABASE IF EXISTS ${d}`); await server.query(`CREATE DATABASE ${d}`); }
  // Supabase's client roles (cluster-wide; harmless if they already exist).
  await server.query(`DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon NOLOGIN; END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
  EXCEPTION WHEN unique_violation OR duplicate_object THEN NULL; END $$`);
  await new Promise<void>((r) => sentry.listen(0, '127.0.0.1', () => r()));
  Object.assign(process.env, {
    DATABASE_URL: urlFor(DB),
    SENTRY_DSN: `http://publickey@127.0.0.1:${(sentry.address() as AddressInfo).port}/42`,
    LOG_LEVEL: 'info',
    HEALTH_TOKEN: 'health-token-for-tests',
    LOG_SMS: 'false',
  });
  cfg = (await import('../src/config.js')).config;
  L = await import('../src/lib/log.js');
  L.setLogDestination(sink);
  M = await import('../src/lib/migrator.js');
  B = await import('../src/lib/bootstrap.js');
  S = await import('../src/lib/dbSecurity.js');
  Seed = await import('../src/lib/baseSeed.js');
  dbm = await import('../src/db.js');
});

after(async () => {
  await dbm?.pool.end().catch(() => {});
  sentry.close();
  for (const d of [DB, DB2, DB3, DB4]) await server.query(`DROP DATABASE IF EXISTS ${d} WITH (FORCE)`).catch(() => {});
  await server.query(`DROP OWNED BY ${API_ROLE}`).catch(() => {});
  await server.query(`DROP ROLE IF EXISTS ${API_ROLE}`).catch(() => {});
  await server.end();
});

test('bootstrap: fresh database gets every migration, RLS, Supabase roles locked out, an API role, base data and the admin — no demo data; re-run changes nothing', async () => {
  Object.assign(cfg.ops, { adminPhone: '0412 000 777', adminName: 'Ops Admin', apiRole: API_ROLE, apiRolePassword: 'api-role-pass-1' });
  const pool = dbm.pool;
  const r = await B.bootstrapDatabase(pool);
  const files = M.listMigrations().map((m) => m.name);
  assert.ok(files.length >= 15 && files[0] === '001_init.sql');
  assert.deepEqual(r.migrate.applied, files);
  assert.equal(r.migrate.fresh, true);
  assert.equal(r.migrate.error, null);
  assert.deepEqual((await M.schemaStatus(pool)).pending, []);

  // Base data, production flavour.
  const one = async (sql: string) => (await pool.query(sql)).rows[0];
  assert.equal((await one(`SELECT active FROM zones WHERE id = 'alice-springs'`)).active, true);
  assert.equal((await one(`SELECT count(*)::int n FROM fare_rules`)).n, 7);
  assert.equal((await one(`SELECT base_cents, per_km_cents, per_min_cents, booking_fee_cents, levy_cents FROM fare_rules WHERE service = 'ride'`)).per_km_cents, 160);
  assert.equal((await one(`SELECT active FROM jurisdictions WHERE code = 'NT'`)).active, true);
  assert.equal((await one(`SELECT active FROM jurisdictions WHERE code = 'SA'`)).active, false, 'SA stays hidden');
  assert.equal((await one(`SELECT value->>'mode' m FROM settings WHERE key = 'roof_display'`)).m, 'off', 'roof screens off until NT approval');
  assert.ok((await one(`SELECT value FROM settings WHERE key = 'cash_payments'`)).value.courier === true);
  assert.equal((await one(`SELECT count(*)::int n FROM tour_packages`)).n, 4);
  // No demo data.
  for (const t of ['drivers', 'vehicles', 'trips', 'partners', 'promo_codes', 'gift_vouchers', 'corporate_accounts', 'ad_campaigns']) {
    assert.equal((await one(`SELECT count(*)::int n FROM ${t}`)).n, 0, `${t} empty`);
  }
  const users = (await pool.query(`SELECT phone, role, name FROM users`)).rows;
  assert.deepEqual(users, [{ phone: '+61412000777', role: 'admin', name: 'Ops Admin' }]);
  assert.equal(r.seed?.admin.status, 'created');
  assert.equal((await one(`SELECT count(*)::int n FROM audit_log WHERE action = 'bootstrap.admin_created'`)).n, 1);
  assert.equal((await Seed.baseDataStatus(pool)).ok, true);

  // Security: RLS everywhere, client roles can't see a thing, API role reads and writes rows but can't change the schema.
  const sec = await S.securityStatus(pool);
  assert.deepEqual(sec.tables_without_rls, []);
  assert.deepEqual(sec.client_role_grants, []);
  assert.deepEqual(r.security?.locked_roles, ['anon', 'authenticated']);
  const c = await pool.connect();
  try {
    for (const role of ['anon', 'authenticated']) {
      await c.query('BEGIN'); await c.query(`SET LOCAL ROLE ${role}`);
      await assert.rejects(c.query('SELECT * FROM users'), (e: any) => e.code === '42501');
      await c.query('ROLLBACK');
    }
  } finally { c.release(); }
  const apiPool = new pg.Pool({ connectionString: urlFor(DB, API_ROLE, 'api-role-pass-1'), max: 1 });
  try {
    assert.equal((await apiPool.query('SELECT count(*)::int n FROM fare_rules')).rows[0].n, 7, 'RLS policy lets the API role read');
    await apiPool.query(`INSERT INTO rate_events (bucket, key) VALUES ('test', 'x')`);
    assert.equal((await apiPool.query(`UPDATE zones SET launch_note = 'Launch' WHERE id = 'alice-springs' RETURNING id`)).rowCount, 1);
    await assert.rejects(apiPool.query('CREATE TABLE sneaky (x int)'), (e: any) => e.code === '42501');
    await assert.rejects(apiPool.query('DROP TABLE users'), (e: any) => e.code === '42501');
  } finally { await apiPool.end(); }

  // Run again: nothing applied, nothing inserted, admin kept, edits kept.
  await pool.query(`UPDATE fare_rules SET base_cents = 333 WHERE service = 'ride'`);
  const again = await B.bootstrapDatabase(pool);
  assert.deepEqual(again.migrate.applied, []);
  assert.equal(again.migrate.fresh, false);
  assert.ok(Object.values(again.seed!.inserted).every((n) => n === 0), JSON.stringify(again.seed!.inserted));
  assert.equal(again.seed?.admin.status, 'exists');
  assert.equal(again.security?.rls_enabled.length, 0);
  assert.equal(again.security?.policies_created, 0);
  assert.equal((await one(`SELECT base_cents FROM fare_rules WHERE service = 'ride'`)).base_cents, 333, 'admin edits survive');
  await pool.query(`UPDATE fare_rules SET base_cents = 300 WHERE service = 'ride'`);

  // Admin by env: demo numbers refused, bad numbers refused, an existing rider is promoted (audited).
  await assert.rejects(Seed.seedBase(pool, { adminPhone: '0400 000 001', demoNumbers: cfg.otpDemoNumbers }), /demo number/);
  await assert.rejects(Seed.seedBase(pool, { adminPhone: 'not a phone' }), /not a valid phone/);
  await pool.query(`INSERT INTO users (phone, name, role, referral_code) VALUES ('+61412000888', 'Later Admin', 'rider', 'LATER1')`);
  assert.equal((await Seed.seedBase(pool, { adminPhone: '+61412000888' })).admin.status, 'promoted');
  assert.equal((await one(`SELECT role FROM users WHERE phone = '+61412000888'`)).role, 'admin');
  Object.assign(cfg.ops, { apiRole: '', apiRolePassword: '' });
});

test('migrator: concurrent runners apply each migration once; a held lock means "busy"; a failing migration rolls back; a table lock times out instead of queueing', async () => {
  const url = urlFor(DB2);
  const first = await M.migrate({ url, upTo: '013_ops_indexes.sql' });
  assert.equal(first.applied.at(-1), '013_ops_indexes.sql');
  assert.deepEqual(first.pending, [], 'pending is counted within upTo');
  const rest = M.listMigrations().map((m) => m.name).filter((n) => n > '013_ops_indexes.sql');
  assert.ok(rest.includes('014_payments_stripe.sql'));
  // Four runners at once (cold starts on several instances).
  const runs = await Promise.all([1, 2, 3, 4].map(() => M.migrate({ url, waitMs: 30000 })));
  const applied = runs.flatMap((r) => r.applied).sort();
  assert.deepEqual(applied, rest, 'each pending migration applied exactly once');
  assert.ok(runs.every((r) => !r.error && !r.busy && r.pending.length === 0));
  const p2 = new pg.Pool({ connectionString: url, max: 3 });
  try {
    assert.equal((await p2.query('SELECT count(*)::int n FROM schema_migrations')).rows[0].n, M.listMigrations().length);

    // Another runner holds the lock: give up after waitMs, say busy.
    const holder = await p2.connect();
    await holder.query('BEGIN'); await holder.query('SELECT pg_advisory_xact_lock($1)', [M.MIGRATION_LOCK_KEY]);
    const busy = await M.migrate({ url, waitMs: 300 });
    assert.equal(busy.busy, true);
    await holder.query('ROLLBACK'); holder.release();

    // A broken migration: rolled back whole, not recorded, later files not run, error returned (not thrown).
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-mig-'));
    for (const m of M.listMigrations()) fs.writeFileSync(path.join(dir, m.name), m.sql);
    fs.writeFileSync(path.join(dir, '900_broken.sql'), 'CREATE TABLE half_done (x int);\nSELECT * FROM no_such_table;');
    fs.writeFileSync(path.join(dir, '901_after.sql'), 'CREATE TABLE after_broken (x int);');
    const bad = await M.migrate({ url, dir });
    assert.equal(bad.error?.migration, '900_broken.sql');
    assert.equal(bad.error?.code, '42P01');
    assert.deepEqual(bad.pending, ['900_broken.sql', '901_after.sql']);
    assert.equal((await p2.query(`SELECT to_regclass('half_done') IS NULL AS gone, to_regclass('after_broken') IS NULL AS not_run`)).rows[0].gone, true);
    assert.equal((await p2.query(`SELECT to_regclass('after_broken') IS NULL AS not_run`)).rows[0].not_run, true);

    // A migration that needs a table someone is using: lock_timeout stops it queueing every request behind it.
    fs.rmSync(path.join(dir, '900_broken.sql')); fs.rmSync(path.join(dir, '901_after.sql'));
    fs.writeFileSync(path.join(dir, '902_alter.sql'), 'ALTER TABLE zones ADD COLUMN ops_test int;');
    const reader = await p2.connect();
    await reader.query('BEGIN'); await reader.query('LOCK TABLE zones IN ACCESS SHARE MODE');
    const t0 = Date.now();
    const locked = await M.migrate({ url, dir, lockTimeoutMs: 300 });
    assert.equal(locked.error?.code, '55P03');
    assert.ok(Date.now() - t0 < 5000);
    await reader.query('ROLLBACK'); reader.release();
    const ok = await M.migrate({ url, dir, lockTimeoutMs: 300 });
    assert.deepEqual(ok.applied, ['902_alter.sql']);
    fs.rmSync(dir, { recursive: true });
  } finally { await p2.end(); }
});

test('AUTO_MIGRATE and /health/deep: pending migration reported (summary for anyone, details for admins / X-Health-Token), applied once at cold start with RLS on the new table', async () => {
  const { buildServer } = await import('../src/index.js');
  const { signToken } = await import('../src/auth.js');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-mig-'));
  for (const m of M.listMigrations()) fs.writeFileSync(path.join(dir, m.name), m.sql);
  fs.writeFileSync(path.join(dir, '950_health_extra.sql'), 'CREATE TABLE health_extra (id int PRIMARY KEY);');
  process.env.MIGRATIONS_DIR = dir;
  const app = await buildServer();
  try {
    const anon = await app.inject({ method: 'GET', url: '/health/deep' });
    assert.equal(anon.statusCode, 200);
    const a = anon.json();
    assert.equal(a.status, 'degraded');
    assert.deepEqual(a.problems, ['migrations_pending']);
    assert.equal(a.schema.up_to_date, false);
    assert.equal(a.schema.pending, undefined, 'no migration names for anonymous callers');
    assert.equal(a.integrations, undefined);
    assert.equal(anon.headers['cache-control'], 'no-store');
    const wrong = (await app.inject({ method: 'GET', url: '/health/deep', headers: { 'x-health-token': 'nope' } })).json();
    assert.equal(wrong.integrations, undefined);

    const full = (await app.inject({ method: 'GET', url: '/health/deep', headers: { 'x-health-token': 'health-token-for-tests' } })).json();
    assert.deepEqual(full.schema.pending, ['950_health_extra.sql']);
    assert.equal(full.schema.expected, '950_health_extra.sql');
    assert.equal(full.base_data.ok, true);
    assert.deepEqual(full.security.tables_without_rls, []);
    assert.equal(full.integrations.error_reporting, 'configured');
    assert.equal(full.integrations.payments, 'not_configured');
    assert.equal(full.auto_migrate.enabled, false);
    assert.ok(!JSON.stringify(full).includes('dingogo:dingogo'), 'no connection string');

    // Cold start with AUTO_MIGRATE=true.
    cfg.ops.autoMigrate = true;
    B.resetAutoMigrate();
    const [r1, r2] = await Promise.all([B.autoMigrateOnce(), B.autoMigrateOnce()]);
    assert.equal(r1, r2, 'once per process');
    assert.deepEqual(r1?.applied, ['950_health_extra.sql']);
    assert.equal(r1?.security?.rls_enabled, 1, 'the new table got RLS');
    assert.equal(r1?.fresh, false);
    assert.equal(r1?.seeded, undefined, 'existing database: no seeding');
    assert.ok(lines.some((l) => l.msg === 'migrations applied' && l.applied?.includes('950_health_extra.sql')));

    const admin = (await dbm.pool.query(`SELECT id FROM users WHERE phone = '+61412000777'`)).rows[0];
    const after = await app.inject({ method: 'GET', url: '/health/deep', headers: { authorization: `Bearer ${signToken({ id: admin.id, role: 'admin' })}` } });
    const h = after.json();
    assert.equal(h.status, 'ok', JSON.stringify(h.problems));
    assert.deepEqual(h.schema.pending, []);
    assert.deepEqual(h.auto_migrate.last.applied, ['950_health_extra.sql']);
    assert.deepEqual(h.security.tables_without_rls, []);

    // A failing migration at cold start: the API serves on, health says so, the error is reported.
    fs.writeFileSync(path.join(dir, '951_broken.sql'), 'SELECT * FROM missing_for_health;');
    B.resetAutoMigrate(); envelopes.length = 0;
    const r3 = await B.autoMigrateOnce();
    assert.equal(r3?.error?.migration, '951_broken.sql');
    const h2 = (await app.inject({ method: 'GET', url: '/health/deep', headers: { 'x-health-token': 'health-token-for-tests' } })).json();
    assert.equal(h2.status, 'degraded');
    assert.ok(h2.problems.includes('auto_migrate_failed') && h2.problems.includes('migrations_pending'));
    assert.equal((await app.inject({ method: 'GET', url: '/health' })).statusCode, 200, 'still serving');
    await until(() => envelopes.length > 0);
    assert.match(envelopes[0].body, /Migration 951_broken\.sql failed/);
  } finally {
    cfg.ops.autoMigrate = false; B.resetAutoMigrate();
    delete process.env.MIGRATIONS_DIR;
    fs.rmSync(dir, { recursive: true });
    await app.close();
  }
});

test('AUTO_MIGRATE on a brand-new empty database (owner via MIGRATION_DATABASE_URL): schema, RLS and base data with the admin, no demo data', async () => {
  Object.assign(cfg.ops, { autoMigrate: true, migrationDatabaseUrl: urlFor(DB4), adminPhone: '0412 000 555' });
  B.resetAutoMigrate();
  try {
    const r = await B.autoMigrateOnce();
    assert.equal(r?.fresh, true);
    assert.equal(r?.applied.length, M.listMigrations().length);
    assert.equal(r?.seeded?.admin, 'created');
    assert.ok((r?.security?.rls_enabled ?? 0) > 40);
    const p4 = new pg.Pool({ connectionString: urlFor(DB4), max: 1 });
    try {
      assert.equal((await Seed.baseDataStatus(p4)).ok, true);
      assert.equal((await p4.query(`SELECT count(*)::int n FROM users`)).rows[0].n, 1);
      assert.equal((await p4.query(`SELECT count(*)::int n FROM drivers`)).rows[0].n, 0);
    } finally { await p4.end(); }
  } finally {
    Object.assign(cfg.ops, { autoMigrate: false, migrationDatabaseUrl: '', adminPhone: '0412 000 777' });
    B.resetAutoMigrate();
  }
});

test('logging and errors: request ids in and out, one JSON line per request without tokens, 503 for database down / schema lag, 500s reported to Sentry without personal data', async () => {
  const { buildServer, isDbDown, isSchemaLag } = await import('../src/index.js');
  const app = await buildServer();
  app.get('/__test/boom', async () => { throw new Error('boom for sentry'); });
  app.get('/__test/dbdown', async () => { throw Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:5432'), { code: 'ECONNREFUSED' }); });
  try {
    lines.length = 0; envelopes.length = 0;
    const r = await app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'monitor-1234-abcd' } });
    assert.equal(r.statusCode, 200);
    assert.equal(r.headers['x-request-id'], 'monitor-1234-abcd');
    const bad = await app.inject({ method: 'GET', url: '/health', headers: { 'x-request-id': 'bad id {"x":1}' } });
    assert.match(String(bad.headers['x-request-id']), /^[0-9a-f-]{36}$/, 'unsafe ids replaced');
    const fresh = await app.inject({ method: 'GET', url: '/health' });
    assert.notEqual(fresh.headers['x-request-id'], bad.headers['x-request-id']);

    // Share-trip token and bearer token never reach the logs; the route pattern does.
    const share = 'ShareTokenSecretValue123456';
    await app.inject({ method: 'GET', url: `/public/track/${share}?x=secretquery`, headers: { authorization: 'Bearer very.secret.jwt' } });
    await until(() => lines.some((l) => l.route === '/public/track/:token'));
    const line = lines.find((l) => l.route === '/public/track/:token');
    assert.equal(line.status, 404);
    assert.ok(typeof line.ms === 'number' && line.request_id);
    assert.equal(line.service, 'dingogo-api');
    const reqLine = lines.find((l) => l.request_id === 'monitor-1234-abcd' && l.msg === 'request');
    assert.equal(reqLine.route, '/health');
    assert.equal(reqLine.level, 'info');
    const all = JSON.stringify(lines);
    for (const secret of [share, 'secretquery', 'very.secret.jwt']) assert.ok(!all.includes(secret), `${secret} not logged`);

    // Unexpected error: 500 with the request id, error line, Sentry event with tags and no request data.
    const boom = await app.inject({ method: 'GET', url: '/__test/boom', headers: { authorization: 'Bearer very.secret.jwt', 'x-request-id': 'boom-req-0001' } });
    assert.equal(boom.statusCode, 500);
    assert.deepEqual(boom.json(), { error: 'server_error', message: 'Something went wrong', request_id: 'boom-req-0001' });
    await until(() => envelopes.length > 0);
    const env = envelopes[0];
    assert.equal(env.url, '/api/42/envelope/');
    assert.match(env.auth, /sentry_key=publickey/);
    const event = JSON.parse(env.body.trim().split('\n')[2]);
    assert.equal(event.exception.values[0].value, 'boom for sentry');
    assert.equal(event.tags.request_id, 'boom-req-0001');
    assert.equal(event.tags.route, '/__test/boom');
    assert.ok(event.exception.values[0].stacktrace.frames.length > 0);
    assert.ok(!env.body.includes('very.secret.jwt'));
    assert.ok(lines.some((l) => l.level === 'error' && l.request_id === 'boom-req-0001' && l.err?.message === 'boom for sentry'));

    // Database unreachable: 503 db_unavailable, Retry-After.
    const down = await app.inject({ method: 'GET', url: '/__test/dbdown' });
    assert.equal(down.statusCode, 503);
    assert.equal(down.json().error, 'db_unavailable');
    assert.equal(down.headers['retry-after'], '30');
    assert.ok(isDbDown({ code: '57P01' }) && isDbDown(new Error('Connection terminated unexpectedly')) && !isDbDown({ code: '23505' }));
    assert.ok(isSchemaLag({ code: '42P01' }) && !isSchemaLag({ code: '23505' }));

    // Code ahead of the schema (table not there yet): 503 migration_pending, not a bare 500.
    await dbm.pool.query('ALTER TABLE tour_packages RENAME TO tour_packages_away');
    try {
      const lag = await app.inject({ method: 'GET', url: '/public/tours' });
      assert.equal(lag.statusCode, 503);
      assert.equal(lag.json().error, 'migration_pending');
      assert.ok(lag.json().request_id);
    } finally { await dbm.pool.query('ALTER TABLE tour_packages_away RENAME TO tour_packages'); }

    // Errors outside requests (dispatch tick, background) are logged and reported too.
    envelopes.length = 0;
    L.logError('dispatch tick', new Error('tick exploded'));
    await until(() => envelopes.length > 0);
    assert.equal(JSON.parse(envelopes[0].body.trim().split('\n')[2]).tags.where, 'dispatch tick');
    assert.deepEqual(L.parseDsn('https://abc@o1.ingest.sentry.io/123'), { endpoint: 'https://o1.ingest.sentry.io/api/123/envelope/', key: 'abc' });
    assert.equal(L.parseDsn('not a dsn'), null);
  } finally { await app.close(); }
});

test('Vercel entry with the database unreachable: requests get 503 db_unavailable with a request id; /health/deep still answers "down"', () => {
  const r = spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'test/helpers/vercel-down.ts')], {
    cwd: ROOT, encoding: 'utf8', timeout: 60000,
    env: { ...process.env, DATABASE_URL: 'postgres://nobody:nothing@127.0.0.1:1/none', DATABASE_URL_FALLBACKS: '', SENTRY_DSN: '', LOG_LEVEL: 'silent' },
  });
  const m = r.stdout.match(/RESULT (.+)/);
  assert.ok(m, r.stdout + r.stderr);
  const out = JSON.parse(m![1]);
  assert.equal(out.trips.status, 503);
  assert.equal(out.trips.body.error, 'db_unavailable');
  assert.match(out.trips.body.message, /can’t reach its database/);
  assert.equal(out.trips.retry_after, '30');
  assert.equal(out.trips.body.request_id, out.trips.request_id);
  assert.equal(out.deep.status, 503);
  assert.equal(out.deep.body.status, 'down');
  assert.deepEqual(out.deep.body.problems, ['database_unreachable']);
});

test('scripts: reset and demo seed refuse a non-local database; bootstrap CLI with DEMO_DATA=true loads demo data on top; --check; backups (pg_dump and JSON)', async () => {
  const tsx = (script: string, args: string[], env: Record<string, string>) => spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, script), ...args], {
    cwd: ROOT, encoding: 'utf8', timeout: 120000, env: { ...process.env, LOG_LEVEL: 'silent', SENTRY_DSN: '', ...env },
  });
  const remote = 'postgres://postgres:pw@db.abcdefghij.supabase.co:5432/postgres';
  assert.equal(M.isLocalDatabase(remote), false);
  assert.equal(M.isLocalDatabase('postgres://u:p@localhost:5432/x'), true);
  const reset = tsx('scripts/migrate.ts', ['--reset'], { DATABASE_URL: remote, MIGRATION_DATABASE_URL: '' });
  assert.equal(reset.status, 1);
  assert.match(reset.stderr, /Refusing to drop/);
  const demo = tsx('scripts/seed.ts', [], { DATABASE_URL: remote, DEMO_DATA: '' });
  assert.equal(demo.status, 1);
  assert.match(demo.stderr, /Refusing to load demo data/);

  const boot = tsx('scripts/bootstrap.ts', [], { DATABASE_URL: urlFor(DB3), MIGRATION_DATABASE_URL: '', DEMO_DATA: 'true', BOOTSTRAP_ADMIN_PHONE: '0412 000 999' });
  assert.equal(boot.status, 0, boot.stdout + boot.stderr);
  assert.match(boot.stdout, /admin \+61412000999: created/);
  assert.match(boot.stdout, /Seeded\./);
  const check = tsx('scripts/bootstrap.ts', ['--check'], { DATABASE_URL: urlFor(DB3), MIGRATION_DATABASE_URL: '' });
  assert.equal(check.status, 0, check.stdout + check.stderr);
  assert.match(check.stdout, /up to date/);
  assert.match(check.stdout, /RLS on every table/);
  const p3 = new pg.Pool({ connectionString: urlFor(DB3), max: 1 });
  const q = async (sql: string) => String(Object.values((await p3.query(sql)).rows[0])[0]);
  assert.equal(await q(`SELECT count(*) FROM users WHERE role = 'admin'`), '2', 'bootstrap admin + demo admin');
  assert.equal(await q(`SELECT value->>'mode' FROM settings WHERE key = 'roof_display'`), 'ads', 'demo turns roof screens on');
  assert.ok(Number(await q('SELECT count(*) FROM trips')) > 50);

  // Backups.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dg-bak-'));
  const json = tsx('scripts/backup.ts', ['--json', '--out', path.join(dir, 'json')], { DATABASE_URL: urlFor(DB3), MIGRATION_DATABASE_URL: '' });
  assert.equal(json.status, 0, json.stdout + json.stderr);
  const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'json/_manifest.json'), 'utf8'));
  assert.equal(manifest.schema_version, M.listMigrations().at(-1)!.name);
  assert.equal(manifest.rows.users, Number(await q('SELECT count(*) FROM users')));
  await p3.end();
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'json/fare_rules.json'), 'utf8')).length, 7);
  if (spawnSync('pg_dump', ['--version']).status === 0) {
    const dump = tsx('scripts/backup.ts', ['--out', path.join(dir, 'db.dump')], { DATABASE_URL: urlFor(DB3), MIGRATION_DATABASE_URL: '' });
    // An older pg_dump than the server (some CI images) refuses: that's the machine, not the script.
    if (/version mismatch/.test(dump.stderr)) { fs.rmSync(dir, { recursive: true }); return; }
    assert.equal(dump.status, 0, dump.stdout + dump.stderr);
    const list = execFileSync('pg_restore', ['--list', path.join(dir, 'db.dump')], { encoding: 'utf8' });
    assert.match(list, /TABLE DATA public trips/);
    assert.equal(fs.statSync(path.join(dir, 'db.dump')).mode & 0o077, 0, 'backup readable by its owner only');
  }
  fs.rmSync(dir, { recursive: true });
});
