import Fastify from 'fastify';
import cors from '@fastify/cors';
import websocket from '@fastify/websocket';
import { config } from './config.js';
import { pool } from './db.js';
import { ApiError } from './lib/errors.js';
import { verifyToken } from './auth.js';
import { subscribe, unsubscribe } from './realtime.js';
import { one } from './db.js';
import { dispatchTick } from './services/trips.js';
import authRoutes from './routes/auth.js';
import riderRoutes from './routes/rider.js';
import driverRoutes from './routes/driver.js';
import adminRoutes from './routes/admin.js';
import publicRoutes from './routes/public.js';
import partnerRoutes from './routes/partner.js';
import displayRoutes from './routes/display.js';
import uploadRoutes from './routes/uploads.js';

export async function buildServer() {
  const app = Fastify({ logger: process.env.LOG_LEVEL ? { level: process.env.LOG_LEVEL } : false, bodyLimit: 1024 * 1024 });
  await app.register(cors, { origin: config.corsOrigins.includes('*') ? true : config.corsOrigins });
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
  }

  // Realtime: /ws?token=JWT  (or ?share=<trip share token> for read-only public tracking)
  app.get('/ws', { websocket: true }, async (socket, req) => {
    const { token, share } = req.query as { token?: string; share?: string };
    if (share) {
      const t = await one('SELECT id FROM trips WHERE share_token = $1', [share]);
      if (!t) return socket.close(4004, 'not found');
      subscribe(socket, `trip:${t.id}`);
      socket.send(JSON.stringify({ type: 'hello', data: { channels: [`trip:${t.id}`] } }));
      return;
    }
    const p = token ? verifyToken(token) : null;
    if (!p) return socket.close(4001, 'unauthorised');
    const channels = [`user:${p.sub}`];
    if (p.role === 'admin' || p.role === 'dispatcher') channels.push('ops');
    channels.forEach((c) => subscribe(socket, c));
    socket.send(JSON.stringify({ type: 'hello', data: { channels } }));
    socket.on('message', async (raw: Buffer) => {
      try {
        const m = JSON.parse(String(raw));
        if (m.type === 'ping') return socket.send(JSON.stringify({ type: 'pong' }));
        if ((m.type === 'subscribe' || m.type === 'unsubscribe') && typeof m.channel === 'string' && m.channel.startsWith('trip:')) {
          const id = m.channel.slice(5);
          const t = await one('SELECT rider_id, driver_id FROM trips WHERE id = $1', [id]).catch(() => null);
          const ok = t && (t.rider_id === p.sub || t.driver_id === p.sub || p.role === 'admin' || p.role === 'dispatcher');
          if (!ok) return;
          if (m.type === 'subscribe') subscribe(socket, m.channel); else unsubscribe(socket, m.channel);
        }
      } catch { /* ignore malformed */ }
    });
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
