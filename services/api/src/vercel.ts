/** Vercel serverless entry (Build Output API): every /api/* request lands here as /api?__path=<rest>. */
import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildServer } from './index.js';
import { ensureDb } from './db.js';

let ready: Promise<Awaited<ReturnType<typeof buildServer>>> | null = null;

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // Restore the API path: /api/trips/123?x=1  →  /trips/123?x=1
  const u = new URL(req.url ?? '/', 'http://x');
  const p = u.searchParams.get('__path');
  if (p !== null) { u.searchParams.delete('__path'); req.url = '/' + p + (u.search || ''); }
  else if (u.pathname.startsWith('/api')) req.url = (u.pathname.slice(4) || '/') + u.search;
  try { await ensureDb(); } catch {
    res.statusCode = 503; res.setHeader('content-type', 'application/json');
    return res.end(JSON.stringify({ error: 'db_unavailable', message: 'Service is starting up, please try again.' }));
  }
  ready ??= buildServer().then(async (app) => { await app.ready(); return app; });
  const app = await ready;
  app.server.emit('request', req, res);
}
