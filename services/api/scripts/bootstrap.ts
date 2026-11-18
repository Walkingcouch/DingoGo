/**
 * Bootstrap a database for production in one command:
 *   1. every migration (advisory-locked),
 *   2. security: Row Level Security on every table, Supabase anon/authenticated locked out, optional API role (DB_API_ROLE),
 *   3. production base data (zones, fare rules, jurisdictions, settings with roof screens off, plans, holidays, tours),
 *   4. the first admin from BOOTSTRAP_ADMIN_PHONE (+ BOOTSTRAP_ADMIN_NAME, BOOTSTRAP_ADMIN_EMAIL).
 * Demo data (fictional drivers, cafés, trips, demo sign-ins) only with DEMO_DATA=true.
 * Safe to run again: nothing is overwritten. `--check` reports what's there and changes nothing.
 *
 *   MIGRATION_DATABASE_URL=… (or DATABASE_URL=…) BOOTSTRAP_ADMIN_PHONE=04xx xxx xxx npm run db:bootstrap
 */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';
import { config } from '../src/config.js';
import { schemaStatus } from '../src/lib/migrator.js';
import { securityStatus } from '../src/lib/dbSecurity.js';
import { baseDataStatus } from '../src/lib/baseSeed.js';
import { bootstrapDatabase, sslFor } from '../src/lib/bootstrap.js';

const url = config.ops.migrationDatabaseUrl || config.databaseUrl;
const host = (() => { try { return new URL(url).hostname; } catch { return '(invalid DATABASE_URL)'; } })();
const pool = new pg.Pool({ connectionString: url, max: 1, ssl: sslFor(url), connectionTimeoutMillis: 10000 });
const fail = async (msg: string) => { console.error(`✗ ${msg}`); await pool.end().catch(() => {}); process.exit(1); };

try { await pool.query('SELECT 1'); } catch (e: any) { await fail(`Can't reach the database at ${host}: ${e.message}`); }

async function report() {
  const s = await schemaStatus(pool);
  console.log(`Schema: ${s.version ?? '(empty)'} of ${s.expected}${s.pending.length ? ` — ${s.pending.length} pending: ${s.pending.join(', ')}` : ' — up to date'}`);
  if (s.applied.length) {
    const sec = await securityStatus(pool);
    console.log(`Security: ${sec.tables_without_rls.length ? `${sec.tables_without_rls.length} table(s) without RLS: ${sec.tables_without_rls.slice(0, 8).join(', ')}` : 'RLS on every table'}` +
      `${sec.client_role_grants.length ? `; Supabase client roles can still reach: ${sec.client_role_grants.slice(0, 5).join(', ')}` : ''}`);
    const b = await baseDataStatus(pool).catch(() => null);
    if (b) console.log(`Base data: ${b.active_zones} active zone(s), ${b.fare_rules} fare rule(s), ${b.active_jurisdictions} active state(s), ${b.admins} admin(s)${b.ok ? '' : ' — INCOMPLETE'}`);
    return { s, b };
  }
  return { s, b: null };
}

console.log(`Database: ${host}`);
if (process.argv.includes('--check')) {
  const { s, b } = await report();
  await pool.end();
  process.exit(s.pending.length || !b?.ok ? 2 : 0);
}

const r = await bootstrapDatabase(pool, { lockTimeoutMs: Number(process.env.MIGRATE_LOCK_TIMEOUT_MS ?? 10000), log: (m) => console.log(m) });
if (r.migrate.error) await fail(`Migration ${r.migrate.error.migration} failed: ${r.migrate.error.message}`);
if (r.migrate.busy) await fail('Another migration runner held the lock for 10 minutes; try again.');
console.log(r.migrate.applied.length ? `✓ ${r.migrate.applied.length} migration(s) applied` : '✓ migrations up to date');
if (r.security) {
  console.log(`✓ security: RLS turned on for ${r.security.rls_enabled.length} table(s)` +
    (r.security.locked_roles.length ? `, ${r.security.locked_roles.join(' and ')} locked out` : ' (no Supabase client roles here)') +
    (r.security.api_role ? `, API role ${r.security.api_role} granted row access` : ''));
  for (const s of r.security.rls_skipped) console.warn(`  ! ${s.table}: ${s.reason}`);
}
if (r.seed) {
  const added = Object.entries(r.seed.inserted).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`);
  console.log(`✓ base data: ${added.length ? added.join(', ') : 'already there'}`);
  const a = r.seed.admin;
  if (a.status === 'not_set') console.warn('  ! No BOOTSTRAP_ADMIN_PHONE: no admin created. Run again with BOOTSTRAP_ADMIN_PHONE=<mobile> to add one.');
  else console.log(`✓ admin ${a.phone}: ${a.status}`);
}

if (process.env.DEMO_DATA === 'true') {
  console.log('Loading demo data (DEMO_DATA=true)…');
  execFileSync(process.execPath, ['--import', 'tsx', path.resolve(import.meta.dirname, 'seed.ts')], {
    stdio: 'inherit', env: { ...process.env, DATABASE_URL: url },
  });
}

await report();
await pool.end();
