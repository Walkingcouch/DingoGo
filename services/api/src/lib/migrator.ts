/**
 * Database migrations: one runner for `npm run db:migrate`, `npm run db:bootstrap` and AUTO_MIGRATE at cold start.
 *
 * Safe to run from several places at once (Vercel starts many instances; a coordinator may run the CLI at the same time):
 * every migration is applied in its own transaction that first takes a transaction-level advisory lock and then re-reads
 * `schema_migrations`, so each file is applied exactly once. Transaction-level locks work through the Supabase pooler
 * (session-level locks don't survive transaction pooling).
 *
 * A migration that fails (or waits too long for a table lock) is rolled back; the error is returned, never thrown, so the API
 * keeps serving on the old schema (new code degrades gracefully until the migration is fixed).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

/** 'DGMG' — the advisory lock every migration runner takes. */
export const MIGRATION_LOCK_KEY = 0x44474d47;

/** Where the .sql files are: MIGRATIONS_DIR, next to the Vercel bundle, or services/api/migrations from src/lib or dist/src/lib. */
export function migrationsDir(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [process.env.MIGRATIONS_DIR, path.join(here, 'migrations'), path.resolve(here, '../../migrations'), path.resolve(here, '../../../migrations')]
    .filter(Boolean) as string[];
  return candidates.find((d) => fs.existsSync(d) && fs.readdirSync(d).some((f) => f.endsWith('.sql'))) ?? candidates[candidates.length - 1];
}

export interface Migration { name: string; sql: string }
export function listMigrations(dir = migrationsDir()): Migration[] {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => /^\d+_[\w.-]+\.sql$/.test(f)).sort()
    // 001_init.sql creates schema_migrations itself; the runner already has.
    .map((name) => ({ name, sql: fs.readFileSync(path.join(dir, name), 'utf8').replace(/CREATE TABLE schema_migrations[^;]+;/, '') }));
}

type Queryable = Pick<pg.PoolClient, 'query'>;

export interface SchemaStatus {
  /** Applied migration names (from the database). */
  applied: string[];
  /** Migration files this code ships with. */
  files: string[];
  /** Files not yet applied. */
  pending: string[];
  /** Applied in the database but not in this code (the database is ahead: an older deploy is running). */
  unknown: string[];
  /** Latest applied migration, e.g. "015_comms.sql". */
  version: string | null;
  /** Latest file this code knows about. */
  expected: string | null;
}
export async function schemaStatus(c: Queryable, dir = migrationsDir()): Promise<SchemaStatus> {
  const files = listMigrations(dir).map((m) => m.name);
  const has = (await c.query(`SELECT to_regclass('public.schema_migrations') IS NOT NULL AS ok`)).rows[0]?.ok;
  const applied: string[] = has ? (await c.query('SELECT name FROM schema_migrations ORDER BY name')).rows.map((r) => r.name) : [];
  const done = new Set(applied);
  return {
    applied, files,
    pending: files.filter((f) => !done.has(f)),
    unknown: applied.filter((a) => !files.includes(a)),
    version: applied[applied.length - 1] ?? null,
    expected: files[files.length - 1] ?? null,
  };
}

export interface MigrateOptions {
  /** Pool to use (default: a new pool on `url`). */
  pool?: pg.Pool;
  url?: string;
  dir?: string;
  /** Wait this long for another runner holding the lock before giving up (the API serves on; the other runner finishes). */
  waitMs?: number;
  /** Per-statement limit inside a migration (0 = none). */
  statementTimeoutMs?: number;
  /** Give up on a migration that can't get its table locks this fast, instead of queueing every query behind it. */
  lockTimeoutMs?: number;
  /** Apply only files up to and including this name (tests, staged roll-outs). */
  upTo?: string;
  log?: (msg: string) => void;
}
export interface MigrateResult {
  applied: string[];
  pending: string[];
  /** True when another runner held the lock for longer than waitMs. */
  busy: boolean;
  /** The database had no DingoGo schema at all when this run started. */
  fresh: boolean;
  error: { migration: string; message: string; code?: string } | null;
  ms: number;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function migrate(opts: MigrateOptions = {}): Promise<MigrateResult> {
  const started = Date.now();
  const own = !opts.pool;
  const pool = opts.pool ?? new pg.Pool({ connectionString: opts.url, max: 1, ssl: opts.url && /sslmode=require|supabase\.(co|com)/.test(opts.url) ? { rejectUnauthorized: false } : undefined });
  const all = listMigrations(opts.dir).filter((m) => !opts.upTo || m.name <= opts.upTo);
  const say = opts.log ?? (() => {});
  const out: MigrateResult = { applied: [], pending: [], busy: false, fresh: false, error: null, ms: 0 };
  const waitUntil = Date.now() + (opts.waitMs ?? 600_000);
  let first = true;
  const c = await pool.connect();
  try {
    for (;;) {
      await c.query('BEGIN');
      let committed = false;
      try {
        const got = (await c.query('SELECT pg_try_advisory_xact_lock($1) AS ok', [MIGRATION_LOCK_KEY])).rows[0].ok;
        if (!got) {
          await c.query('ROLLBACK'); committed = true;
          if (Date.now() > waitUntil) { out.busy = true; break; }
          await sleep(250);
          continue;
        }
        if (first) {
          out.fresh = (await c.query(`SELECT to_regclass('public.users') IS NULL AND to_regclass('public.schema_migrations') IS NULL AS fresh`)).rows[0].fresh;
          first = false;
        }
        await c.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
        const done = new Set((await c.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
        const next = all.find((m) => !done.has(m.name));
        if (!next) { await c.query('COMMIT'); committed = true; break; }
        if (opts.statementTimeoutMs) await c.query(`SET LOCAL statement_timeout = ${Math.floor(opts.statementTimeoutMs)}`);
        if (opts.lockTimeoutMs) await c.query(`SET LOCAL lock_timeout = ${Math.floor(opts.lockTimeoutMs)}`);
        try {
          await c.query(next.sql);
        } catch (e: any) {
          await c.query('ROLLBACK'); committed = true;
          out.error = { migration: next.name, message: String(e?.message ?? e).slice(0, 500), code: e?.code };
          say(`✗ failed ${next.name}: ${out.error.message}`);
          break;
        }
        await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [next.name]);
        await c.query('COMMIT'); committed = true;
        out.applied.push(next.name);
        say(`✓ applied ${next.name}`);
      } finally {
        if (!committed) await c.query('ROLLBACK').catch(() => {});
      }
    }
    const done = new Set((await c.query(`SELECT name FROM schema_migrations`).catch(() => ({ rows: [] as any[] }))).rows.map((r) => r.name));
    out.pending = all.filter((m) => !done.has(m.name)).map((m) => m.name);
  } finally {
    c.release();
    if (own) await pool.end();
  }
  out.ms = Date.now() - started;
  return out;
}

/** Local or throwaway databases only, for scripts that drop everything. */
export function isLocalDatabase(url: string) {
  try {
    const h = new URL(url).hostname;
    return ['localhost', '127.0.0.1', '::1', '[::1]', 'db', 'postgres'].includes(h) || h.endsWith('.local');
  } catch { return false; }
}
