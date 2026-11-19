import Fastify, { LogController } from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { pool } from './db.js';
import { ApiError } from './lib/errors.js';
import { activeUser, verifyToken, type AuthUser } from './auth.js';
import { subscribe, trackUser, unsubscribe } from './realtime.js';
import { one } from './db.js';
import { signUploadUrls } from './lib/uploads.js';
import { claimTick, dispatchTick, shareLinkExpired } from './services/trips.js';
import { invalidateConfig } from './lib/cache.js';
import { etagMatches, etagOf } from './lib/etag.js';
import { flushBackground } from './lib/background.js';
import authRoutes from './routes/auth.js';
import riderRoutes from './routes/rider.js';
import driverRoutes from './routes/driver.js';
import adminRoutes from './routes/admin.js';
import opsRoutes from './routes/ops.js';
import publicRoutes from './routes/public.js';
import partnerRoutes from './routes/partner.js';
import displayRoutes from './routes/display.js';
import uploadRoutes from './routes/uploads.js';
import paymentRoutes from './routes/payments.js';
import commsRoutes from './routes/comms.js';
import healthRoutes from './routes/health.js';
import businessRoutes from './routes/business.js';
import clientRoutes from './routes/clients.js';
import businessAccountRoutes from './routes/businessAccounts.js';
import communityRoutes from './routes/community.js';
import safetyRoutes from './routes/safety.js';
import taxRoutes from './routes/tax.js';
import loyaltyRoutes from './routes/loyalty.js';
import tourRoutes from './routes/tours.js';
import fleetRoutes from './routes/fleet.js';
import storeRoutes from './routes/store.js';
import supportRoutes from './routes/support.js';
import insightsRoutes from './routes/insights.js';
import regionalRoutes from './routes/regional.js';
import { log, logError, reportError, requestId, safePath } from './lib/log.js';
import { autoMigrateOnce } from './lib/bootstrap.js';

/** Postgres/driver errors that mean "can't reach the database" (not a bug in the request). */
const DB_DOWN = new Set(['ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', '57P01', '57P02', '57P03', '53300', '08000', '08001', '08003', '08004', '08006']);
export const isDbDown = (e: any) => !!e && (DB_DOWN.has(e.code)
  || /Connection terminated|connection timeout|timeout exceeded when trying to connect|Client has encountered a connection error|No database reachable|too many clients|remaining connection slots/i.test(String(e.message ?? '')));
/** Missing table or column: the code is ahead of the database (a migration not applied yet). */
export const isSchemaLag = (e: any) => e?.code === '42P01' || e?.code === '42703';

/** Every route the server registers (method + path), filled by buildServer: the authorisation matrix test checks each one. */
export const routeTable: { method: string; url: string }[] = [];

export async function buildServer() {
  const app = Fastify({
    // Structured JSON logs (src/lib/log.ts) with a request id per request; one line per request is written in onResponse below.
    loggerInstance: log, logController: new LogController({ disableRequestLogging: true, requestIdLogLabel: 'request_id' }),
    genReqId: (req) => requestId(req.headers),
    bodyLimit: 1024 * 1024, trustProxy: config.trustProxy as any,
  });
  routeTable.length = 0;
  app.addHook('onRoute', (r) => {
    for (const m of ([] as string[]).concat(r.method)) if (m !== 'HEAD' && m !== 'OPTIONS') routeTable.push({ method: m, url: r.url });
  });
  app.addHook('onRequest', async (req, reply) => { reply.header('X-Request-Id', req.id); });
  app.addHook('onResponse', async (req, reply) => {
    const ms = Math.round(reply.elapsedTime);
    const vercel = req.headers['x-vercel-id'];
    const line = { method: req.method, route: safePath(req.routeOptions?.url, req.url), status: reply.statusCode, ms,
      ...(req.user ? { user_id: req.user.id, role: req.user.role } : {}), ...(typeof vercel === 'string' ? { vercel_id: vercel.slice(0, 128) } : {}) };
    if (reply.statusCode >= 500) req.log.warn(line, 'request failed');
    else req.log.info(line, 'request');
  });
  await app.register(cors, { origin: config.corsOrigins.includes('*') ? true : config.corsOrigins, methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'],
    exposedHeaders: ['ETag', 'X-Request-Id', 'Retry-After'] });
  await app.register(websocket);

  app.setErrorHandler((err: any, req, reply) => {
    if (err instanceof ApiError) return reply.code(err.status).send({ error: err.code, message: err.message, details: err.details });
    if (err.validation) return reply.code(400).send({ error: 'validation_error', message: err.message });
    // Postgres constraint errors (e.g. from admin CRUD) → 4xx instead of a 500.
    if (err.code === '23505') return reply.code(409).send({ error: 'duplicate', message: err.detail ?? 'That already exists' });
    if (err.code === '23514' || err.code === '22P02' || err.code === '23503') return reply.code(400).send({ error: 'invalid_value', message: err.detail ?? err.message });
    if (err.code === '23502') return reply.code(400).send({ error: 'missing_field', message: `${err.column ?? 'A required field'} is required` });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: 'request_error', message: err.message });
    const ctx = { where: 'request', request_id: req.id, route: safePath(req.routeOptions?.url, req.url), method: req.method, user_id: req.user?.id };
    if (isDbDown(err)) {
      req.log.error({ err, ...ctx }, 'database unreachable');
      reportError(err, { ...ctx, where: 'db_unavailable' });
      return reply.code(503).header('Retry-After', '30').send({ error: 'db_unavailable', message: 'DingoGo can’t reach its database right now. Please try again in a few minutes.', request_id: req.id });
    }
    if (isSchemaLag(err)) {
      req.log.error({ err, ...ctx }, 'schema behind the code (migration pending)');
      reportError(err, { ...ctx, where: 'migration_pending' });
      return reply.code(503).header('Retry-After', '60').send({ error: 'migration_pending', message: 'This part of DingoGo is being updated. Please try again soon.', request_id: req.id });
    }
    req.log.error({ err, ...ctx }, 'unhandled error');
    reportError(err, ctx);
    return reply.code(500).send({ error: 'server_error', message: 'Something went wrong', request_id: req.id });
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
  // Round 18: a GET answer with the same JSON as the copy the app already holds (If-None-Match) is a bodiless 304. Polls of a
  // trip that hasn't changed, an empty offers list or the live map cost a few bytes instead of the whole payload.
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.method !== 'GET' || reply.statusCode !== 200 || typeof payload !== 'string' || payload.length > 2_000_000) return payload;
    if (!String(reply.getHeader('content-type') ?? '').startsWith('application/json')) return payload;
    const tag = etagOf(payload);
    reply.header('ETag', tag);
    if (etagMatches(req.headers['if-none-match'], tag)) { reply.code(304); return ''; }
    return payload;
  });
  // Config the team changed (fares, zones, holidays, settings): drop this instance's cached copy straight away.
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.method !== 'GET' && req.method !== 'HEAD' && reply.statusCode < 400 && (req.user?.role === 'admin' || req.user?.role === 'dispatcher')) invalidateConfig();
    return payload;
  });
  // Private uploads (driver documents, delivery photos) leave the API only as short-lived signed links.
  app.addHook('preSerialization', async (_req, _reply, payload) => signUploadUrls(payload));

  // Serverless: no background timer, so run the dispatcher (offer expiry, re-offers, scheduled releases)
  // on the requests that apps poll anyway — throttled to once every 3 s per instance.
  // Round 18: many instances poll at once, so the tick is claimed in the database first (one cheap conditional write): one
  // instance runs it per DISPATCH_TICK_EVERY_MS, the others skip it.
  if (config.serverless) {
    let last = 0;
    const every = config.perf.tickEveryMs;
    app.addHook('preHandler', async (req) => {
      if (!/^\/(driver|trips|admin\/live|public\/track)/.test(req.url)) return;
      if (Date.now() - last < every) return;
      last = Date.now();
      if (!(await claimTick(every).catch(() => true))) return;
      await dispatchTick().catch((e) => logError('dispatch tick', e));
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

  await app.register(healthRoutes);
  await app.register(publicRoutes);
  await app.register(authRoutes);
  await app.register(riderRoutes);
  await app.register(driverRoutes);
  await app.register(adminRoutes);
  await app.register(opsRoutes);
  await app.register(partnerRoutes);
  await app.register(displayRoutes);
  await app.register(uploadRoutes);
  await app.register(paymentRoutes);
  await app.register(commsRoutes);
  await app.register(businessRoutes);
  await app.register(clientRoutes);
  await app.register(businessAccountRoutes);
  await app.register(communityRoutes);
  await app.register(safetyRoutes);
  await app.register(taxRoutes);
  await app.register(loyaltyRoutes);
  await app.register(tourRoutes);
  await app.register(fleetRoutes);
  await app.register(storeRoutes);
  await app.register(supportRoutes);
  await app.register(insightsRoutes);
  await app.register(regionalRoutes);
  return app;
}

let timer: NodeJS.Timeout | undefined;
export function startDispatcher() {
  timer = setInterval(() => void dispatchTick().catch((e) => logError('dispatch tick', e)), config.dispatch.tickMs);
  return () => clearInterval(timer);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  process.on('unhandledRejection', (e) => logError('unhandled rejection', e));
  process.on('uncaughtException', (e) => { logError('uncaught exception', e); setTimeout(() => process.exit(1), 2000).unref(); });
  await autoMigrateOnce();   // AUTO_MIGRATE=true only; never throws
  const app = await buildServer();
  startDispatcher();
  await app.listen({ port: config.port, host: config.host });
  log.info({ host: config.host, port: config.port }, 'DingoGo API listening');
  console.log(`DingoGo API listening on http://${config.host}:${config.port}`);
  const shutdown = async () => { clearInterval(timer); await app.close(); await pool.end(); process.exit(0); };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
