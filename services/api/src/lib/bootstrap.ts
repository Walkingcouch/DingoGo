/**
 * Bootstrap a database (migrations → security → base data) and AUTO_MIGRATE at cold start.
 * Used by scripts/bootstrap.ts (`npm run db:bootstrap`) and by the API (src/vercel.ts, src/index.ts).
 */
import pg from 'pg';
import { config } from '../config.js';
import { pool as apiPool } from '../db.js';
import { migrate, type MigrateResult } from './migrator.js';
import { applyDbSecurity, type SecurityResult } from './dbSecurity.js';
import { seedBase, type BaseSeedResult } from './baseSeed.js';
import { log, logError, reportError } from './log.js';

export const sslFor = (url: string) => (/sslmode=require|supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined);

export interface BootstrapResult {
  migrate: MigrateResult;
  security: SecurityResult | null;
  seed: BaseSeedResult | null;
}

/** Migrations, then RLS/grants, then the production base data (and the first admin). Stops after a failed migration. */
export async function bootstrapDatabase(pool: pg.Pool, opts: { seed?: boolean; security?: boolean; waitMs?: number; lockTimeoutMs?: number; log?: (m: string) => void } = {}): Promise<BootstrapResult> {
  const m = await migrate({ pool, waitMs: opts.waitMs, lockTimeoutMs: opts.lockTimeoutMs, log: opts.log });
  if (m.error || m.busy) return { migrate: m, security: null, seed: null };
  const security = opts.security === false ? null : await applyDbSecurity(pool, { apiRole: config.ops.apiRole || undefined, apiRolePassword: config.ops.apiRolePassword || undefined, rls: config.ops.rls });
  const seed = opts.seed === false ? null : await seedBase(pool, { adminPhone: config.ops.adminPhone, adminName: config.ops.adminName, adminEmail: config.ops.adminEmail, demoNumbers: config.otpDemoNumbers });
  return { migrate: m, security, seed };
}

export interface AutoMigrateReport {
  at: string;
  ms: number;
  applied: string[];
  pending: string[];
  busy: boolean;
  fresh: boolean;
  error: MigrateResult['error'];
  security?: { rls_enabled: number; skipped: number; error?: string };
  seeded?: { admin: string; error?: string };
}
let running: Promise<AutoMigrateReport | null> | null = null;
let last: AutoMigrateReport | null = null;
export const lastAutoMigrate = () => last;

/** AUTO_MIGRATE=true: apply pending migrations once per process (cold start). Never throws; the API serves on whatever happens. */
export function autoMigrateOnce(): Promise<AutoMigrateReport | null> {
  if (!config.ops.autoMigrate) return Promise.resolve(null);
  running ??= runAuto().catch((e) => { logError('auto-migrate', e); running = null; return null; });
  return running;
}
/** Tests: forget the cold-start run so the next call migrates again. */
export function resetAutoMigrate() { running = null; last = null; }

async function runAuto(): Promise<AutoMigrateReport> {
  const url = config.ops.migrationDatabaseUrl;
  const pool = url ? new pg.Pool({ connectionString: url, max: 1, ssl: sslFor(url), connectionTimeoutMillis: 8000 }) : apiPool;
  try {
    const m = await migrate({ pool, waitMs: config.ops.autoMigrateWaitMs, statementTimeoutMs: config.ops.autoMigrateStatementTimeoutMs, lockTimeoutMs: config.ops.migrateLockTimeoutMs });
    const rep: AutoMigrateReport = { at: new Date().toISOString(), ms: m.ms, applied: m.applied, pending: m.pending, busy: m.busy, fresh: m.fresh, error: m.error };
    if (m.applied.length) {
      // New tables need RLS and grants too. Only after a change: re-checking every cold start would cost queries for nothing.
      try {
        const s = await applyDbSecurity(pool, { apiRole: config.ops.apiRole || undefined, apiRolePassword: config.ops.apiRolePassword || undefined, rls: config.ops.rls });
        rep.security = { rls_enabled: s.rls_enabled.length, skipped: s.rls_skipped.length };
      } catch (e: any) { rep.security = { rls_enabled: 0, skipped: 0, error: String(e?.message ?? e).slice(0, 200) }; logError('auto-migrate security', e); }
    }
    if (m.fresh && m.applied.length && !m.error) {
      // A brand-new empty database: add what it needs to take bookings (never demo data).
      try {
        const s = await seedBase(pool, { adminPhone: config.ops.adminPhone, adminName: config.ops.adminName, adminEmail: config.ops.adminEmail, demoNumbers: config.otpDemoNumbers });
        rep.seeded = { admin: s.admin.status };
      } catch (e: any) { rep.seeded = { admin: 'failed', error: String(e?.message ?? e).slice(0, 200) }; logError('auto-migrate seed', e); }
    }
    if (m.error) {
      log.error({ where: 'auto-migrate', migration: m.error.migration, code: m.error.code, error: m.error.message }, 'migration failed; serving on the current schema');
      reportError(Object.assign(new Error(`Migration ${m.error.migration} failed: ${m.error.message}`), { code: m.error.code }), { where: 'auto-migrate' });
    } else if (m.busy) log.warn({ where: 'auto-migrate', pending: m.pending }, 'another instance is migrating; serving on');
    else if (m.applied.length) log.info({ where: 'auto-migrate', applied: m.applied, ms: m.ms, fresh: m.fresh }, 'migrations applied');
    last = rep;
    return rep;
  } finally {
    if (pool !== apiPool) await pool.end().catch(() => {});
  }
}
