/** Vercel serverless entry (Build Output API): every /api/* request lands here as /api?__path=<rest>. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildServer } from './index.js';
import { ensureDb } from './db.js';
import { autoMigrateOnce } from './lib/bootstrap.js';
import { logError, requestId } from './lib/log.js';

let ready: Promise<Awaited<ReturnType<typeof buildServer>>> | null = null;
process.on('unhandledRejection', (e) => logError('unhandled rejection', e));

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // Restore the API path: /api/trips/123?x=1  →  /trips/123?x=1
  const u = new URL(req.url ?? '/', 'http://x');
  const p = u.searchParams.get('__path');
  if (p !== null) { u.searchParams.delete('__path'); req.url = '/' + p + (u.search || ''); }
  else if (u.pathname.startsWith('/api')) req.url = (u.pathname.slice(4) || '/') + u.search;
  // Health checks still answer when the database is unreachable (they report it); everything else gets a clear 503.
  const health = /^\/health(\/|\?|$)/.test(req.url ?? '');
  let dbUp = true;
  try { await ensureDb(); } catch { dbUp = false; }
  if (!dbUp && !health) {
    const id = requestId(req.headers);
    res.statusCode = 503;
    res.setHeader('content-type', 'application/json');
    res.setHeader('retry-after', '30');
    res.setHeader('x-request-id', id);
    res.setHeader('cache-control', 'no-store');
    return res.end(JSON.stringify({ error: 'db_unavailable', message: 'DingoGo can’t reach its database right now. Please try again in a few minutes.', request_id: id }));
  }
  // AUTO_MIGRATE=true: roll the schema forward once per cold start, before the first request is served (advisory-locked).
  if (dbUp) await autoMigrateOnce();
  ready ??= buildServer().then(async (app) => { await app.ready(); return app; });
  const app = await ready;
  app.server.emit('request', req, res);
}
