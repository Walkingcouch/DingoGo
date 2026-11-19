/**
 * GET /health/deep — is this deploy healthy end to end?
 * Database (reachable, latency), schema version and pending migrations, last AUTO_MIGRATE run, base data present, RLS coverage,
 * integrations configured (names only, never keys). Anyone gets the summary; admins (bearer token) and monitors with
 * X-Health-Token get the details. 503 when the database is down, 200 otherwise (status "ok" or "degraded").
 */
import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { pool, poolStats } from '../db.js';
import { cacheStats } from '../lib/cache.js';
import { loadUser } from '../auth.js';
import { schemaStatus } from '../lib/migrator.js';
import { securityStatus } from '../lib/dbSecurity.js';
import { baseDataStatus } from '../lib/baseSeed.js';
import { lastAutoMigrate } from '../lib/bootstrap.js';
import { environment, release, sentryConfigured } from '../lib/log.js';
import { plateLookupConfigured } from '../lib/plateLookup.js';
import { replyableSender } from '../services/sms.js';
import { pushProviders } from '../services/push.js';

const on = (x: boolean) => (x ? 'configured' : 'not_configured');
/** Which outside services are set up (shared with GET /admin/integrations). */
export function integrationStatus() {
  return {
    plate_lookup: on(plateLookupConfigured()),
    payments: on(!!config.stripe.secretKey), payments_webhook: on(!!config.stripe.webhookSecret), card_elements: on(!!config.stripe.publishableKey),
    sms: on(!!(config.twilio.sid && config.twilio.token)),
    routing: on(!!(config.orsKey || config.osrmUrl)),
    sms_replies: on(!!config.twilio.token && !!replyableSender()), sms_relay: on(!!(config.twilio.relayNumber && config.twilio.sid && config.twilio.token)),
    push_fcm: on(pushProviders().fcm), push_web: on(pushProviders().web), push_expo: on(config.expoPushEnabled),
    error_reporting: on(sentryConfigured()),
    email: on(!!(config.email.resendApiKey && config.email.from)),
  };
}

const safeEqual = (a: string, b: string) => {
  const x = Buffer.from(a), y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
async function mayReadDetails(req: FastifyRequest) {
  const t = req.headers['x-health-token'];
  if (config.ops.healthToken && typeof t === 'string' && safeEqual(t, config.ops.healthToken)) return true;
  const u = await loadUser(req).catch(() => undefined);   // database down: no sign-in check possible, summary only
  return u?.role === 'admin' || u?.role === 'dispatcher';
}
const timed = async <T>(f: () => Promise<T>): Promise<{ ok: true; value: T; ms: number } | { ok: false; error: string; code?: string; ms: number }> => {
  const t = Date.now();
  try { return { ok: true, value: await f(), ms: Date.now() - t }; }
  catch (e: any) { return { ok: false, error: String(e?.message ?? e).replace(/postgres(ql)?:\/\/[^\s]+/g, '[url]').slice(0, 200), code: e?.code, ms: Date.now() - t }; }
};

export async function deepHealth(full: boolean) {
  const db = await timed(() => pool.query('SELECT 1'));
  const schema = db.ok ? await timed(() => schemaStatus(pool)) : null;
  const base = db.ok ? await timed(() => baseDataStatus(pool)) : null;
  const sec = db.ok && full ? await timed(() => securityStatus(pool)) : null;
  const s = schema?.ok ? schema.value : null;
  const auto = lastAutoMigrate();
  const problems: string[] = [];
  if (!db.ok) problems.push('database_unreachable');
  if (s?.pending.length) problems.push('migrations_pending');
  if (schema && !schema.ok) problems.push('schema_unreadable');
  if (base?.ok && !base.value.ok) problems.push('base_data_missing');
  if (base && !base.ok) problems.push('base_data_unreadable');
  if (auto?.error) problems.push('auto_migrate_failed');
  const status = !db.ok ? 'down' : problems.length ? 'degraded' : 'ok';
  const summary = {
    ok: status === 'ok', status, service: 'dingogo-api', release, time: new Date().toISOString(),
    db: { ok: db.ok, ms: db.ms },
    schema: s ? { version: s.version, up_to_date: s.pending.length === 0 } : null,
    problems,
  };
  if (!full) return summary;
  return {
    ...summary,
    environment,
    serverless: config.serverless,
    db: { ok: db.ok, ms: db.ms, ...(db.ok ? {} : { error: db.error, code: db.code }) },
    schema: s ? { version: s.version, expected: s.expected, applied: s.applied.length, pending: s.pending, unknown: s.unknown } : schema && !schema.ok ? { error: schema.error } : null,
    auto_migrate: { enabled: config.ops.autoMigrate, last: auto },
    base_data: base?.ok ? base.value : base ? { error: base.error } : null,
    security: sec?.ok ? sec.value : sec ? { error: sec.error } : null,
    integrations: integrationStatus(),
    // Round 18: connections in use on this instance and the in-memory config cache.
    performance: {
      pool: poolStats(), query_timeout_ms: config.perf.dbQueryTimeoutMs, statement_timeout_ms: config.perf.dbStatementTimeoutMs,
      config_cache: cacheStats(), dispatch_tick_every_ms: config.serverless ? config.perf.tickEveryMs : config.dispatch.tickMs,
    },
  };
}

export default async function healthRoutes(app: FastifyInstance) {
  app.get('/health/deep', async (req, reply) => {
    const out = await deepHealth(await mayReadDetails(req));
    reply.header('Cache-Control', 'no-store');
    return reply.code(out.db.ok ? 200 : 503).send(out);
  });
}
