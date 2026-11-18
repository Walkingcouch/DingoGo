/**
 * SMS through Twilio, behind config. Without TWILIO_ACCOUNT_SID/TWILIO_AUTH_TOKEN texts are written to the log (development).
 * Every text is logged in `comms_log` by template and the last 3 digits of the number only — never the text (codes, PINs).
 * Numbers that replied STOP (table `sms_opt_outs`) get only essential texts. Works before migration 015 (no log, no opt-outs).
 */
import { logError, log } from '../lib/log.js';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { one, q } from '../db.js';
import { gsmFriendly, type SmsKind } from '../lib/messages.js';

export interface SmsMeta { template?: string; kind?: SmsKind; userId?: string | null; tripId?: string | null; from?: string }
export interface SmsResult { sent: boolean; provider: string; status: string; ref?: string; error?: string }

const missing = (e: any) => e?.code === '42P01' || e?.code === '42703';
let warned = false;
function tolerate(e: any) {
  if (!missing(e)) throw e;
  if (!warned) { warned = true; log.warn('comms tables missing — run migration 015 (SMS log, opt-outs, chat are off)'); }
}

export const smsConfigured = () => !!(config.twilio.sid && config.twilio.token && (config.twilio.from || config.twilio.messagingServiceSid));
const isNumber = (s: string) => /^\+\d{8,15}$/.test(s);
/** A sender that can receive "STOP" replies (Spam Act): a Messaging Service (has numbers) or a real number. */
export function replyableSender(): { from?: string; messagingServiceSid?: string } | null {
  const t = config.twilio;
  if (t.marketingFrom && isNumber(t.marketingFrom)) return { from: t.marketingFrom };
  if (t.messagingServiceSid) return { messagingServiceSid: t.messagingServiceSid };
  if (isNumber(t.from)) return { from: t.from };
  return null;
}

/** +61 412 345 678, 0412 345 678 → +61412345678. */
export function e164(raw: string) {
  const s = String(raw ?? '').replace(/[\s()-]/g, '');
  if (s.startsWith('+')) return s;
  if (s.startsWith('0')) return '+61' + s.slice(1);
  if (s.startsWith('61')) return '+' + s;
  return s;
}
export const tail = (phone: string) => (phone ? phone.replace(/\D/g, '').slice(-3) : null);

export async function isOptedOut(phone: string) {
  try { return !!(await one('SELECT 1 FROM sms_opt_outs WHERE phone = $1', [e164(phone)])); } catch (e) { tolerate(e); return false; }
}
export async function optOut(phone: string, source: 'sms_stop' | 'carrier' | 'admin') {
  try { await q(`INSERT INTO sms_opt_outs (phone, source) VALUES ($1, $2) ON CONFLICT (phone) DO NOTHING`, [e164(phone), source]); } catch (e) { tolerate(e); }
}
export async function optIn(phone: string) {
  try { await q('DELETE FROM sms_opt_outs WHERE phone = $1', [e164(phone)]); } catch (e) { tolerate(e); }
}

export async function logComms(row: { channel: 'sms' | 'push' | 'call'; template?: string | null; to?: string | null; userId?: string | null; tripId?: string | null;
  status: string; provider?: string | null; ref?: string | null; error?: string | null }) {
  try {
    await q(`INSERT INTO comms_log (channel, template, to_tail, user_id, trip_id, status, provider, provider_ref, error) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [row.channel, row.template ?? null, row.to ? tail(row.to) : null, row.userId ?? null, row.tripId ?? null, row.status, row.provider ?? null, row.ref ?? null,
        row.error ? String(row.error).slice(0, 300) : null]);
  } catch (e: any) { if (missing(e)) tolerate(e); else logError('comms_log', e); }
}

/** Send one text now. Use `sendSms` from notify.ts for fire-and-forget (tracked so it finishes on serverless). */
export async function sendSmsNow(toRaw: string, bodyRaw: string, meta: SmsMeta = {}): Promise<SmsResult> {
  const to = e164(toRaw);
  const kind = meta.kind ?? 'transactional';
  const body = gsmFriendly(bodyRaw);
  const log = (r: SmsResult) => logComms({ channel: 'sms', template: meta.template, to, userId: meta.userId, tripId: meta.tripId,
    status: r.status, provider: r.provider, ref: r.ref, error: r.error }).then(() => r);
  if (!/^\+\d{8,15}$/.test(to)) return log({ sent: false, provider: 'none', status: 'bad_number' });
  if (kind !== 'essential' && await isOptedOut(to)) return log({ sent: false, provider: 'none', status: 'skipped_opt_out' });

  const t = config.twilio;
  if (!(t.sid && t.token) || !(t.from || t.messagingServiceSid || meta.from)) {
    if (process.env.LOG_SMS !== 'false') console.log(`[sms:dev] → ${to}: ${body}`);
    return log({ sent: false, provider: 'dev-log', status: 'dev_log' });
  }
  const params = new URLSearchParams({ To: to, Body: body });
  if (meta.from) params.set('From', meta.from);
  else if (kind === 'marketing') {
    const s = replyableSender();
    if (!s) return log({ sent: false, provider: 'twilio', status: 'no_reply_number', error: 'Marketing texts need a sender that takes STOP replies' });
    if (s.messagingServiceSid) params.set('MessagingServiceSid', s.messagingServiceSid); else params.set('From', s.from!);
  } else if (t.messagingServiceSid) params.set('MessagingServiceSid', t.messagingServiceSid);
  else params.set('From', t.from);

  try {
    const res = await fetch(`${t.apiBase}/2010-04-01/Accounts/${encodeURIComponent(t.sid)}/Messages.json`, {
      method: 'POST',
      headers: { Authorization: 'Basic ' + Buffer.from(`${t.sid}:${t.token}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params,
      signal: AbortSignal.timeout(t.timeoutMs),
    });
    const j: any = await res.json().catch(() => ({}));
    if (res.ok) return log({ sent: true, provider: 'twilio', status: 'sent', ref: j.sid });
    // 21610: the person replied STOP to our number (Twilio blocks further texts). Remember it so we stop trying.
    if (j.code === 21610) await optOut(to, 'carrier');
    const status = j.code === 21610 ? 'unsubscribed' : j.code === 21211 || j.code === 21614 ? 'bad_number' : 'failed';
    return log({ sent: false, provider: 'twilio', status, error: `${j.code ?? res.status} ${j.message ?? ''}`.trim() });
  } catch (e: any) {
    return log({ sent: false, provider: 'twilio', status: 'failed', error: e?.name === 'TimeoutError' ? 'timeout' : String(e?.message ?? e) });
  }
}

// ── Incoming texts: opt-out keywords ──
// Same words Twilio's own opt-out handling uses, so our records match what Twilio will block.
const STOP = new Set(['STOP', 'STOPALL', 'STOP ALL', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT', 'OPTOUT', 'OPT OUT']);
const START = new Set(['START', 'UNSTOP']);
const HELP = new Set(['HELP', 'INFO']);
export function keyword(body: string): 'stop' | 'start' | 'help' | null {
  const k = String(body ?? '').trim().toUpperCase().replace(/[^A-Z ]/g, '').replace(/\s+/g, ' ').trim();
  if (STOP.has(k)) return 'stop';
  if (START.has(k)) return 'start';
  if (HELP.has(k)) return 'help';
  return null;
}

// ── Twilio webhooks ──
/** X-Twilio-Signature: base64(HMAC-SHA1(auth token, full URL + each POST param name and value, sorted by name)). */
export function twilioSignature(token: string, url: string, params: Record<string, string>) {
  const data = url + Object.keys(params).sort().map((k) => k + params[k]).join('');
  return crypto.createHmac('sha1', token).update(data, 'utf8').digest('base64');
}
export function checkTwilioSignature(token: string, url: string, params: Record<string, string>, given: string | undefined) {
  if (!given) return false;
  const a = Buffer.from(twilioSignature(token, url, params)); const b = Buffer.from(given);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const xml = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]!));
export const twiml = {
  empty: () => '<?xml version="1.0" encoding="UTF-8"?><Response/>',
  message: (text: string) => `<?xml version="1.0" encoding="UTF-8"?><Response><Message>${xml(gsmFriendly(text))}</Message></Response>`,
  say: (text: string) => `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Nicole" language="en-AU">${xml(text)}</Say></Response>`,
  dial: (intro: string, callerId: string, number: string) =>
    `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="Polly.Nicole" language="en-AU">${xml(intro)}</Say>` +
    `<Dial callerId="${xml(callerId)}" timeLimit="900" answerOnBridge="true"><Number>${xml(number)}</Number></Dial></Response>`,
};
