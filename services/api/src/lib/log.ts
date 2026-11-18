/**
 * Structured logging (JSON lines via pino) and error reporting.
 *
 * - One logger for the whole API: Fastify uses it (with a request id per request) and code outside requests (dispatch tick,
 *   background sends, migrations) uses `log` / `logError`.
 * - Never log tokens, share links, OTP codes or personal data: requests are logged by route pattern (no query string), the
 *   Authorization header and cookies are redacted.
 * - `reportError` sends unexpected errors to Sentry when SENTRY_DSN is set (envelope API over fetch, no SDK), and to any reporter
 *   registered with `setErrorReporter` (tests, another service). Off without either.
 */
import pino, { type DestinationStream, type Logger } from 'pino';
import crypto from 'node:crypto';
import { bg } from './background.js';

const env = process.env;
const production = env.NODE_ENV === 'production' || !!env.VERCEL || env.SERVERLESS === 'true';

/** Default level: info in production/serverless, warn otherwise (so tests and dev stay quiet but errors still show). */
export const logLevel = env.LOG_LEVEL || (production ? 'info' : 'warn');
export const release = env.GIT_SHA || env.VERCEL_GIT_COMMIT_SHA || env.npm_package_version || 'dev';
export const environment = env.SENTRY_ENVIRONMENT || env.VERCEL_ENV || (production ? 'production' : 'development');

const REDACT = ['req.headers.authorization', 'req.headers.cookie', 'headers.authorization', 'headers.cookie', '*.token', '*.code', '*.password'];

function make(dest?: DestinationStream): Logger {
  return pino({
    level: logLevel,
    base: { service: 'dingogo-api', release },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: { paths: REDACT, censor: '[redacted]' },
    formatters: { level: (label) => ({ level: label }) },
    serializers: { err: pino.stdSerializers.err, error: pino.stdSerializers.err },
  }, dest);
}

export let log: Logger = make();

/** Tests: send log lines somewhere they can be read. Returns the new logger (Fastify instances built afterwards use it). */
export function setLogDestination(dest: DestinationStream) { log = make(dest); return log; }

/** Paths that must never appear in logs (share-trip tokens, signed upload names, partner codes): keep the route pattern instead. */
export function safePath(routePattern: string | undefined, url: string) {
  if (routePattern) return routePattern;
  return url.split('?')[0].replace(/\/[A-Za-z0-9_-]{16,}(?=\/|$)/g, '/:id');
}

/** A request id from the caller (a proxy or monitor) is kept only if it looks like an id (no log injection), else a fresh UUID.
 *  Vercel's own id is logged next to it (vercel_id) so a line can be found in Vercel's logs too. */
export function requestId(headers: Record<string, string | string[] | undefined>) {
  const given = headers['x-request-id'];
  if (typeof given === 'string' && /^[A-Za-z0-9._:-]{8,64}$/.test(given)) return given;
  return crypto.randomUUID();
}

// ── Error reporting ──────────────────────────────────────────────────────────

export interface ErrorContext {
  where?: string;          // 'request', 'dispatch', 'background', 'migrate', ...
  request_id?: string;
  route?: string;
  method?: string;
  status?: number;
  user_id?: string;        // account id only (a UUID), never a phone number or name
  extra?: Record<string, unknown>;
}
type Reporter = (err: unknown, ctx: ErrorContext) => void | Promise<void>;
const reporters = new Set<Reporter>();
/** Register another error sink (returns a remover). */
export function setErrorReporter(f: Reporter) { reporters.add(f); return () => { reporters.delete(f); }; }

interface Dsn { endpoint: string; key: string }
export function parseDsn(dsn: string): Dsn | null {
  try {
    const u = new URL(dsn);
    const project = u.pathname.replace(/^\/+|\/+$/g, '').split('/').pop();
    if (!u.username || !project || !/^\d+$/.test(project)) return null;
    const prefix = u.pathname.replace(/\/?[^/]*\/?$/, '');
    return { endpoint: `${u.protocol}//${u.host}${prefix}/api/${project}/envelope/`, key: u.username };
  } catch { return null; }
}
let dsn: Dsn | null | undefined;
const sentry = () => (dsn === undefined ? (dsn = env.SENTRY_DSN ? parseDsn(env.SENTRY_DSN) : null) : dsn);
export const sentryConfigured = () => !!sentry();

/** Stack frames in Sentry's shape (oldest first). File paths are kept; no local variables. */
function frames(stack?: string) {
  return (stack ?? '').split('\n').slice(1, 40).map((l) => {
    const m = l.match(/at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/);
    return m ? { function: m[1] ?? '?', filename: m[2], lineno: Number(m[3]), colno: Number(m[4]) } : null;
  }).filter(Boolean).reverse();
}

async function sendToSentry(err: unknown, ctx: ErrorContext) {
  const d = sentry();
  if (!d) return;
  const e = err instanceof Error ? err : new Error(String(err));
  const eventId = crypto.randomUUID().replace(/-/g, '');
  const event = {
    event_id: eventId,
    timestamp: Date.now() / 1000,
    platform: 'node',
    level: 'error',
    release, environment,
    server_name: 'dingogo-api',
    exception: { values: [{ type: e.name, value: e.message.slice(0, 1000), stacktrace: { frames: frames(e.stack) } }] },
    tags: { where: ctx.where ?? 'unknown', ...(ctx.route ? { route: ctx.route } : {}), ...(ctx.method ? { method: ctx.method } : {}),
      ...(ctx.request_id ? { request_id: ctx.request_id } : {}), ...((e as any).code ? { pg_code: String((e as any).code) } : {}) },
    ...(ctx.user_id ? { user: { id: ctx.user_id } } : {}),
    ...(ctx.extra ? { extra: ctx.extra } : {}),
  };
  const body = `${JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() })}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), Number(env.SENTRY_TIMEOUT_MS ?? 3000));
  try {
    await fetch(d.endpoint, {
      method: 'POST', signal: ctl.signal, body,
      headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=dingogo-api/1.0, sentry_key=${d.key}` },
    });
  } catch { /* reporting must never break the API */ } finally { clearTimeout(t); }
}

/** Report an unexpected error (not ApiErrors / validation). Fire and forget: tracked so serverless waits for it before freezing. */
export function reportError(err: unknown, ctx: ErrorContext = {}) {
  if (sentry()) bg(sendToSentry(err, ctx));
  for (const r of reporters) { try { const p = r(err, ctx); if (p) bg(Promise.resolve(p).catch(() => undefined)); } catch { /* ignore */ } }
}

/** Log and report an error from code outside a request (dispatch tick, background sends). */
export function logError(where: string, err: unknown, extra?: Record<string, unknown>) {
  log.error({ err, where, ...extra }, `${where} failed`);
  reportError(err, { where, extra });
}
