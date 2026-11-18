import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { pool } from './db.js';
import { ApiError } from './lib/errors.js';
import { activeUser, verifyToken, type AuthUser } from './auth.js';
import { subscribe, trackUser, unsubscribe } from './realtime.js';
import { one } from './db.js';
import { signUploadUrls } from './lib/uploads.js';
import { dispatchTick, shareLinkExpired } from './services/trips.js';
import { flushBackground } from './lib/background.js';
import authRoutes from './routes/auth.js';
import riderRoutes from './routes/rider.js';
import driverRoutes from './routes/driver.js';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';
import partnerRoutes from './routes/partner.js';
import displayRoutes from './routes/display.js';
import uploadRoutes from './routes/uploads.js';

export async function buildServer() {
  const app = Fastify({ logger: process.env.LOG_LEVEL ? { level: process.env.LOG_LEVEL } : false, bodyLimit: 1024 * 1024, trustProxy: config.trustProxy as any });
  await app.register(cors, { origin: config.corsOrigins.includes('*') ? true : config.corsOrigins, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] });
  await app.register(websocket);

  app.setErrorHandler((err: any, _req, reply) => {
    if (err instanceof ApiError) return reply.code(err.status).send({ error: err.code, message: err.message, details: err.details });
    if (err.validation) return reply.code(400).send({ error: 'validation_error', message: err.message });
    // Postgres constraint errors (e.g. from admin CRUD) → 4xx instead of a 500.
    if (err.code === '23505') return reply.code(409).send({ error: 'duplicate', message: err.detail ?? 'That already exists' });
    if (err.code === '23514' || err.code === '22P02' || err.code === '23503') return reply.code(400).send({ error: 'invalid_value', message: err.detail ?? err.message });
    if (err.code === '23502') return reply.code(400).send({ error: 'missing_field', message: `${err.column ?? 'A required field'} is required` });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'request_error', message: err.message });
    console.error(err);
    return reply.code(500).send({ error: 'server_error', message: 'Something went wrong' });
  });

  // Security headers on every API response. JSON with personal data must not be cached by browsers or proxies.
  const hsts = config.serverless || process.env.NODE_ENV === 'production';
  app.addHook('onSend', async (req, reply, payload) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    if (!reply.hasHeader('Referrer-Policy')) reply.header('Referrer-Policy', 'no-referrer');
    reply.header('X-Frame-Options', 'DENY');
    if (hsts) reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    const type = String(reply.getHeader('content-type') ?? '');
    if (type.startsWith('application/json')) {
      if (!reply.hasHeader('Content-Security-Policy')) reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
      if (!reply.hasHeader('Cache-Control') && (req.headers.authorization || req.url.startsWith('/public/track'))) reply.header('Cache-Control', 'no-store');
    }
    return payload;
  });
  // Private uploads (driver documents, delivery photos) leave the API only as short-lived signed links.
  app.addHook('preSerialization', async (_req, _reply, payload) => signUploadUrls(payload));

  // Serverless: no background timer, so run the dispatcher (offer expiry, re-offers, scheduled releases)
  // on the requests that apps poll anyway — throttled to once every 3 s per instance.
  if (config.serverless) {
    let last = 0;
    app.addHook('preHandler', async (req) => {
      if (!/^\/(driver|trips|admin\/live|public\/track)/.test(req.url)) return;
      if (Date.now() - last < 3000) return;
      last = Date.now();
      await dispatchTick().catch((e) => console.error('tick', e));
    });
    // The function may be frozen once the response is sent: finish notifications/SMS started by this request first.
    app.addHook('onSend', async (_req, _reply, payload) => { await flushBackground(3000); return payload; });
  }

  // Realtime: /ws?token=JWT  (or ?share=<trip share token> for read-only public tracking)
  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const isOps = (u: AuthUser) => u.role === 'admin' || u.role === 'dispatcher';
  app.get('/ws', { websocket: true }, async (socket, req) => {
    const { token, share } = req.query as { token?: string; share?: string };
    if (share) {
      const t = await one('SELECT id, status, completed_at, cancelled_at FROM trips WHERE share_token = $1', [String(share).slice(0, 100)]);
      if (!t) return socket.close(4004, 'not found');
      if (shareLinkExpired(t)) return socket.close(4010, 'link expired');
      subscribe(socket, `trip:${t.id}`);
      socket.send(JSON.stringify({ type: 'hello', data: { channels: [`trip:${t.id}`] } }));
      return;
    }
    // Listen straight away (apps send their subscribes as soon as the socket opens); handle them once the account is checked.
    let me: AuthUser | undefined;
    const ready = (async () => {
      const p = token ? verifyToken(token) : null;
      // The token alone isn't enough: the account must still exist and not be blocked, and the role comes from the database.
      me = p ? await activeUser(p.sub).catch(() => undefined) : undefined;
      return me;
    })();
    socket.on('message', async (raw: Buffer) => {
      try {
        const u = await ready;
        if (!u || raw.length > 2048) return;
        const m = JSON.parse(String(raw));
        if (m.type === 'ping') return socket.send(JSON.stringify({ type: 'pong' }));
        if ((m.type === 'subscribe' || m.type === 'unsubscribe') && typeof m.channel === 'string' && m.channel.startsWith('trip:')) {
          const id = m.channel.slice(5);
          if (!UUID.test(id)) return;
          if (m.type === 'unsubscribe') return unsubscribe(socket, m.channel);
          const t = await one('SELECT rider_id, driver_id FROM trips WHERE id = $1', [id]).catch(() => null);
          const viewer = me ?? u;
          if (t && (t.rider_id === viewer.id || t.driver_id === viewer.id || isOps(viewer))) subscribe(socket, m.channel);
        }
      } catch { /* ignore malformed */ }
    });
    const first = await ready;
    if (!first) return socket.close(4001, 'unauthorised');
    trackUser(socket, first.id);
    const channels = [`user:${first.id}`];
    const opsAtStart = isOps(first);
    if (opsAtStart) channels.push('ops');
    channels.forEach((c) => subscribe(socket, c));
    socket.send(JSON.stringify({ type: 'hello', data: { channels } }));
    // Re-check every minute: blocked, deleted or demoted accounts lose the socket (and with it ops events).
    const recheck = setInterval(async () => {
      if (socket.readyState > 1) return clearInterval(recheck);
      const now = await activeUser(first.id).catch(() => me);   // DB hiccup: keep the socket
      if (!now) return socket.close(4001, 'unauthorised');
      if (isOps(now) !== opsAtStart) return socket.close(4003, 'access changed');
      me = now;
    }, 60_000);
    socket.on('close', () => clearInterval(recheck));
  });

  await app.register(publicRoutes);
  await app.register(authRoutes);
  await app.register(riderRoutes);
  await app.register(driverRoutes);
  await app.register(adminRoutes);
  await app.register(partnerRoutes);
  await app.register(displayRoutes);
  await app.register(uploadRoutes);
  return app;
}

let timer: NodeJS.Timeout | undefined;
export function startDispatcher() {
  timer = setInterval(() => void dispatchTick().catch((e) => console.error('tick', e)), config.dispatch.tickMs);
  return () => clearInterval(timer);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const app = await buildServer();
  startDispatcher();
  await app.listen({ port: config.port, host: config.host });
  console.log(`🐕 DingoGo API listening on http://${config.host}:${config.port}`);
  const shutdown = async () => { clearInterval(timer); await app.close(); await pool.end(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
