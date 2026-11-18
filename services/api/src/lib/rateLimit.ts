/**
 * Rate limits kept in Postgres (table rate_events), so they hold across serverless instances.
 * Fails open if the table is missing (code deployed before migration 011) — never blocks sign-in because of our own setup.
 */
import { one, q } from '../db.js';
import { ApiError } from './errors.js';

let warned = false;
const missingTable = (e: any) => {
  if (e?.code !== '42P01') throw e;
  if (!warned) { warned = true; console.error('rate_events table missing — run migration 011; rate limits are off'); }
};

/** Has `key` already used `limit` events of this bucket in the last `windowS` seconds? */
export async function tooMany(bucket: string, key: string | null | undefined, limit: number, windowS: number): Promise<boolean> {
  if (!key || !(limit > 0)) return false;
  try {
    const r = await one<{ n: number }>(
      `SELECT count(*)::int n FROM rate_events WHERE bucket = $1 AND key = $2 AND at > now() - make_interval(secs => $3)`, [bucket, key, windowS]);
    return (r?.n ?? 0) >= limit;
  } catch (e) { missingTable(e); return false; }
}

/** Count one event (e.g. a failed attempt). Now and then prunes rows older than a day. */
export async function record(bucket: string, key: string | null | undefined) {
  if (!key) return;
  try {
    await q('INSERT INTO rate_events (bucket, key) VALUES ($1, $2)', [bucket, key]);
    if (Math.random() < 0.01) await q(`DELETE FROM rate_events WHERE at < now() - interval '1 day'`);
  } catch (e) { missingTable(e); }
}

/** Count this request and refuse it (429 rate_limited) once `limit` per `windowS` seconds is passed. */
export async function limit(bucket: string, key: string | null | undefined, max: number, windowS: number,
  message = 'Too many requests. Please wait a while and try again.') {
  if (!key || !(max > 0)) return;
  if (await tooMany(bucket, key, max, windowS)) {
    throw new ApiError(429, 'rate_limited', message, { retry_after_s: windowS });
  }
  await record(bucket, key);
}
