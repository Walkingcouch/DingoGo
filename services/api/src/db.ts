import pg from 'pg';
import { config } from './config.js';

// Return int8/numeric as JS numbers (amounts are cents; safe within 2^53).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
// Keep DATE columns as 'YYYY-MM-DD' strings (avoid timezone shifting).
pg.types.setTypeParser(1082, (v) => v);

// Round 18: pool size, idle close and a per-query limit from config.perf (DB_POOL_MAX, DB_IDLE_TIMEOUT_MS, DB_QUERY_TIMEOUT_MS).
// No startup parameters are sent (the Supabase transaction pooler may refuse them); the server-side statement limit is set per
// transaction in tx() instead.
const makePool = (url: string) => {
  const p = new pg.Pool({
    connectionString: url,
    max: Math.max(1, config.perf.dbPoolMax),
    idleTimeoutMillis: config.perf.dbIdleMs,
    connectionTimeoutMillis: 8000,
    ...(config.perf.dbQueryTimeoutMs > 0 ? { query_timeout: config.perf.dbQueryTimeoutMs } : {}),
    ssl: /sslmode=require|supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined,
  });
  // Round 21: an idle connection closed by the server (pooler restart, failover, "terminating connection due to administrator
  // command") makes the pool emit 'error'. Unhandled, that crashed the whole process; now it is logged and the pool opens a new
  // connection on the next query.
  p.on('error', (e) => { void import('./lib/log.js').then((m) => m.logError('database idle connection', e)).catch(() => undefined); });
  return p;
};

/** Live binding: importers always see the current pool (swapped by ensureDb if the first URL is unreachable). */
export let pool = makePool(config.databaseUrl);

/** DATABASE_URL_FALLBACKS: comma-separated alternates (e.g. Supabase pooler hosts aws-0 / aws-1). First that answers wins. */
let checked: Promise<void> | null = null;
export function ensureDb() {
  checked ??= (async () => {
    const urls = [config.databaseUrl, ...(process.env.DATABASE_URL_FALLBACKS ?? '').split(',').filter(Boolean)];
    for (const url of urls) {
      const p = url === config.databaseUrl ? pool : makePool(url);
      try { await p.query('SELECT 1'); pool = p; return; }
      catch (e) { console.error('db connect failed', url.replace(/:[^:@/]+@/, ':***@'), (e as Error).message); if (p !== pool) void p.end(); }
    }
    checked = null;
    throw new Error('No database reachable');
  })();
  return checked;
}

/** Pool use right now (health check, load tests). */
export const poolStats = () => ({ max: Math.max(1, config.perf.dbPoolMax), total: pool.totalCount, idle: pool.idleCount, waiting: pool.waitingCount });

export type Q = Pick<pg.PoolClient, 'query'>;

export async function q<T = any>(sql: string, params: unknown[] = [], client: Q = pool): Promise<T[]> {
  const res = await client.query(sql, params as any[]);
  return res.rows as T[];
}

export async function one<T = any>(sql: string, params: unknown[] = [], client: Q = pool): Promise<T | null> {
  const rows = await q<T>(sql, params, client);
  return rows[0] ?? null;
}

export async function tx<T>(fn: (c: pg.PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    // BEGIN and the statement limit in one round trip (SET LOCAL ends with the transaction, so it is safe with a pooler).
    const st = Math.floor(config.perf.dbStatementTimeoutMs);
    await c.query(st > 0 ? `BEGIN; SET LOCAL statement_timeout = ${st}` : 'BEGIN');
    const out = await fn(c);
    await c.query('COMMIT');
    return out;
  } catch (e) {
    await c.query('ROLLBACK');
    throw e;
  } finally {
    c.release();
  }
}
