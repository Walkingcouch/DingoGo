/**
 * Apply pending migrations (advisory-locked: safe while the API or another runner is migrating too).
 *   npm run db:migrate            apply pending migrations
 *   npm run db:migrate -- --status  list applied / pending, change nothing
 *   --reset                       DROP everything first (local databases only, or ALLOW_DB_RESET=yes)
 * Uses MIGRATION_DATABASE_URL if set (owner role), else DATABASE_URL.
 */
import pg from 'pg';
import { config } from '../src/config.js';
import { isLocalDatabase, migrate, migrationsDir, schemaStatus } from '../src/lib/migrator.js';

const url = config.ops.migrationDatabaseUrl || config.databaseUrl;
const ssl = /sslmode=require|supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined;
const pool = new pg.Pool({ connectionString: url, max: 1, ssl });

if (process.argv.includes('--status')) {
  const s = await schemaStatus(pool);
  console.log(`Schema version: ${s.version ?? '(empty database)'} — this code expects ${s.expected}`);
  console.log(s.pending.length ? `Pending (${s.pending.length}): ${s.pending.join(', ')}` : 'No pending migrations.');
  if (s.unknown.length) console.log(`In the database but not in this code (older deploy?): ${s.unknown.join(', ')}`);
  await pool.end();
  process.exit(0);
}

if (process.argv.includes('--reset')) {
  if (!isLocalDatabase(url) && process.env.ALLOW_DB_RESET !== 'yes') {
    console.error(`Refusing to drop the schema of a non-local database (${new URL(url).hostname}). Set ALLOW_DB_RESET=yes if you really mean it.`);
    await pool.end();
    process.exit(1);
  }
  console.log('Dropping schema public');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}

console.log(`Migrations from ${migrationsDir()}`);
const r = await migrate({ pool, lockTimeoutMs: Number(process.env.MIGRATE_LOCK_TIMEOUT_MS ?? 10000), log: (m) => console.log(m) });
await pool.end();
if (r.error) { console.error(`Stopped at ${r.error.migration}: ${r.error.message}`); process.exit(1); }
if (r.busy) { console.error('Another migration runner held the lock for 10 minutes; try again.'); process.exit(1); }
console.log(r.applied.length ? `Applied ${r.applied.length} migration(s) in ${r.ms} ms.` : 'Already up to date.');
