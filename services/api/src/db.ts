import pg from 'pg';
import { config } from './config.js';

// Return int8/numeric as JS numbers (amounts are cents; safe within 2^53).
pg.types.setTypeParser(20, (v) => Number(v));
pg.types.setTypeParser(1700, (v) => Number(v));
// Keep DATE columns as 'YYYY-MM-DD' strings (avoid timezone shifting).
pg.types.setTypeParser(1082, (v) => v);

const makePool = (url: string) => new pg.Pool({
  connectionString: url,
  max: process.env.VERCEL ? 3 : 10,
  idleTimeoutMillis: 10000,
  connectionTimeoutMillis: 8000,
  ssl: /sslmode=require|supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined,
});

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
    await c.query('BEGIN');
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
