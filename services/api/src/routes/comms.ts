import type { FastifyInstance, FastifyRequest } from 'fastify';
import { config } from '../config.js';
import { one, pool, q } from '../db.js';
import { requireUser } from '../auth.js';
import { ApiError, notFound } from '../lib/errors.js';
import { parse, z } from '../lib/validate.js';
import { MARKETING_CONSENT_WORDING, render } from '../lib/messages.js';
import { chatRole, contactFor, listMessages, postMessage, tripForPhone } from '../services/chat.js';
import { CATEGORY_INFO, lastConsent, loadRecipient, mergePrefs, recordConsent, savePrefs, setMarketing } from '../services/prefs.js';
import { pushProviders } from '../services/push.js';
import { checkTwilioSignature, e164, isOptedOut, keyword, logComms, optIn, optOut, smsConfigured, twiml } from '../services/sms.js';
import { event } from '../services/trips.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function tripRow(id: string) {
  if (!UUID.test(id)) throw notFound('Trip');
  const t = await one('SELECT * FROM trips WHERE id = $1', [id]);
  if (!t) throw notFound('Trip');
  return t;
}
const supportPhone = async () => ((await one(`SELECT value FROM settings WHERE key = 'support'`).catch(() => null))?.value?.phone as string | undefined) ?? null;

/** Trip chat, contact options, notification settings, and the Twilio webhooks (incoming texts and calls). */
export default async function commsRoutes(app: FastifyInstance) {
  // Twilio posts form-encoded bodies. Only routes in this plugin see this parser.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 64 * 1024 },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))));

  // ───────────── Trip chat ─────────────
  app.get('/trips/:id/messages', async (req) => {
    const me = await requireUser(req);
    const t = await tripRow((req.params as any).id);
    const qs = req.query as { after?: string; peek?: string };
    const after = qs.after && /^\d{1,15}$/.test(qs.after) ? Number(qs.after) : 0;
    return listMessages(t, me, { after, peek: qs.peek === '1' || qs.peek === 'true' });
  });

  app.post('/trips/:id/messages', async (req, reply) => {
    const me = await requireUser(req);
    const b = parse(z.object({
      body: z.string().max(2000).optional(), quick: z.string().max(40).optional(),
      client_id: z.string().regex(/^[A-Za-z0-9_-]{8,80}$/, 'bad client_id').optional(),
    }), req.body);
    const t = await tripRow((req.params as any).id);
    const r = await postMessage(t, me, b);
    reply.code(r.replayed ? 200 : 201);
    return r;
  });

  app.get('/trips/:id/contact', async (req) => {
    const me = await requireUser(req);
    const t = await tripRow((req.params as any).id);
    const role = chatRole(t, me);
    if (!role) throw notFound('Trip');
    return contactFor(t, role);
  });

  // ───────────── Notification settings ─────────────
  async function prefsView(me: { id: string; role: string }) {
    const r = await loadRecipient(me.id);
    if (!r) throw notFound('Account');
    const consent = await lastConsent(me.id);
    return {
      prefs: r.prefs,
      marketing: { opted_in: r.marketing_opt_in, wording: MARKETING_CONSENT_WORDING,
        last_change: consent ? { granted: consent.granted, source: consent.source, at: consent.created_at } : null },
      sms_opted_out: r.phone ? await isOptedOut(r.phone) : false,
      categories: CATEGORY_INFO.filter((c) => !c.roles || c.roles.includes(me.role)),
      channels: { push: pushProviders(), web_push_key: config.push.vapidPublicKey || null, sms: smsConfigured() },
    };
  }
  app.get('/me/notification-prefs', async (req) => prefsView(await requireUser(req)));

  const flags = (keys: string[]) => z.object(Object.fromEntries(keys.map((k) => [k, z.boolean().optional()]))).strict();
  app.put('/me/notification-prefs', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({
      push: flags(['trip', 'chat', 'account', 'documents', 'promo']).optional(),
      sms: flags(['trip']).optional(),
      marketing: z.boolean().optional(),
    }).strict(), req.body);
    if (b.marketing !== undefined) await setMarketing(me.id, b.marketing, 'app', req.ip);
    if (b.push || b.sms) {
      const cur = (await loadRecipient(me.id))!.prefs;
      await savePrefs(me.id, mergePrefs({ push: { ...cur.push, ...b.push }, sms: { ...cur.sms, ...b.sms } }));
    }
    return prefsView(me);
  });

  /** Sign-out: stop pushes to this device (someone else may use it next). */
  app.delete('/me/push-token', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({ token: z.string().min(10).max(4096) }), req.body);
    const r = await q('DELETE FROM push_tokens WHERE user_id = $1 AND token = $2 RETURNING 1', [me.id, b.token]);
    return { ok: true, removed: r.length };
  });

  // ───────────── Twilio webhooks ─────────────
  function verifyTwilio(req: FastifyRequest) {
    const token = config.twilio.token;
    if (!token) throw new ApiError(503, 'sms_not_configured', 'Set TWILIO_AUTH_TOKEN to receive texts and calls');
    const params = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, string>;
    // The URL Twilio signed. Without TWILIO_WEBHOOK_BASE_URL, work it out from the request (on Vercel the API sits under /api).
    const host = `${String(req.headers['x-forwarded-proto'] ?? req.protocol).split(',')[0]}://${req.headers['x-forwarded-host'] ?? req.headers.host}`;
    const urls = config.twilio.webhookBaseUrl ? [config.twilio.webhookBaseUrl + req.url] : [host + req.url, host + '/api' + req.url];
    const sig = req.headers['x-twilio-signature'] as string | undefined;
    if (!urls.some((u) => checkTwilioSignature(token, u, params, sig))) {
      throw new ApiError(403, 'bad_signature', 'Twilio signature did not match');
    }
    return params;
  }
  const relay = () => (config.twilio.relayNumber ? e164(config.twilio.relayNumber) : null);

  /** Incoming text: STOP / START / HELP keywords on any DingoGo number; anything else to the relay number goes into the trip chat. */
  app.post('/comms/twilio/sms', async (req, reply) => {
    const p = verifyTwilio(req);
    reply.type('text/xml');
    const from = e164(p.From ?? ''); const to = e164(p.To ?? ''); const body = String(p.Body ?? '');
    const kw = keyword(body);
    if (kw === 'stop') {
      await optOut(from, 'sms_stop');
      const users = await q<{ id: string }>('SELECT id FROM users WHERE phone = $1 AND deleted_at IS NULL', [from]);
      for (const u of users) {
        const changed = await setMarketing(u.id, false, 'sms_stop');
        if (!changed) await recordConsent({ userId: u.id, phone: from, granted: false, channel: 'sms', source: 'sms_stop' });
      }
      if (!users.length) await recordConsent({ phone: from, granted: false, channel: 'sms', source: 'sms_stop' });
      return twiml.message(render('sms_stop_ack', {}).sms!);
    }
    if (kw === 'start') { await optIn(from); return twiml.message(render('sms_start_ack', {}).sms!); }
    if (kw === 'help') return twiml.message(render('sms_help', { support: await supportPhone() }).sms!);

    const r = relay();
    if (!r || to !== r) return twiml.empty();
    const found = await tripForPhone(from, { recent: true });
    if (!found) return twiml.message(render('relay_no_trip_sms', { support: await supportPhone() }).sms!);
    try {
      await postMessage(found.trip, { id: found.callerId, role: found.callerIs, name: found.callerName }, { body: body.slice(0, 500), via: 'sms' });
    } catch (e: any) {
      if (e instanceof ApiError) return twiml.message(`DingoGo: your text wasn't passed on (${e.message})`);
      throw e;
    }
    return twiml.empty();
  });

  /** Incoming call to the relay number: connect the rider and driver of the caller's live trip without showing either number. */
  app.post('/comms/twilio/voice', async (req, reply) => {
    const p = verifyTwilio(req);
    reply.type('text/xml');
    const from = e164(p.From ?? '');
    const r = relay();
    const support = await supportPhone();
    const noTrip = `Sorry, we couldn't find a live DingoGo trip for this phone number. ${support ? `For help, call DingoGo on ${support.split('').join(' ')}.` : 'Please use the DingoGo app.'}`;
    if (!r) return twiml.say(noTrip);
    const found = await tripForPhone(from);
    if (!found || !found.other || String(found.other).startsWith('deleted:')) {
      await logComms({ channel: 'call', template: 'relay_call', userId: null, status: 'no_trip' });
      return twiml.say(noTrip);
    }
    await event(pool, found.trip.id, 'relay_call', found.callerId, { by: found.callerIs });
    await logComms({ channel: 'call', template: 'relay_call', to: found.other, userId: found.callerId, tripId: found.trip.id, status: 'bridged', provider: 'twilio', ref: p.CallSid ?? null });
    return twiml.dial(`Connecting you to your DingoGo ${found.callerIs === 'rider' ? 'driver' : 'rider'}.`, r, found.other);
  });
}
