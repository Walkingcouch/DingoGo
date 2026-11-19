/**
 * Runs the Vercel entry (src/vercel.ts) behind a plain HTTP server, as one serverless instance would: dispatch on requests,
 * VERCEL pool size, no background timer. For load tests only (scripts/load-test.mjs):
 *
 *   PORT=4100 DATABASE_URL=postgres://dingogo:dingogo@localhost:5432/dingogo_load npx tsx scripts/serve-vercel.ts
 *
 * DB_LATENCY_MS=5 adds that much to every query, like a database a few milliseconds away (Vercel → Supabase).
 * GET /__stats returns database queries sent and the most connections the pool opened since the last call (then resets), so the
 * load script can report queries per request.
 */
import http from 'node:http';
import pg from 'pg';

process.env.VERCEL ??= '1';
let queries = 0;
const orig = pg.Client.prototype.query;
// DB_LATENCY_MS: add a network round trip to every query (a serverless function talking to a database in another data centre).
const lag = Number(process.env.DB_LATENCY_MS ?? 0);
(pg.Client.prototype as any).query = function (this: unknown, ...a: any[]) {
  queries++;
  if (!lag) return (orig as any).apply(this, a);
  const cb = typeof a[a.length - 1] === 'function' ? a.pop() : null;
  if (cb) return (orig as any).apply(this, [...a, (...r: unknown[]) => setTimeout(() => cb(...r), lag)]);
  const out = (orig as any).apply(this, a);
  return out && typeof out.then === 'function' ? out.then((v: unknown) => new Promise((r) => setTimeout(() => r(v), lag)), (e: unknown) => new Promise((_, j) => setTimeout(() => j(e), lag))) : out;
};
const { default: handler } = await import('../src/vercel.js');
const db = await import('../src/db.js');
let maxConn = 0;
setInterval(() => { maxConn = Math.max(maxConn, db.pool.totalCount); }, 5).unref();
const port = Number(process.env.PORT ?? 4100);
http.createServer((req, res) => {
  if (req.url === '/__stats') {
    const out = { queries, max_connections: Math.max(maxConn, db.pool.totalCount) };
    queries = 0; maxConn = 0;
    res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify(out));
  }
  void handler(req, res);
}).listen(port, '127.0.0.1', () => console.error(`serve-vercel on http://127.0.0.1:${port}/api`));
