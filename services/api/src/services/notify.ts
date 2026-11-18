/**
 * Notifications: in-app inbox + realtime + push + SMS. Wording lives in lib/messages.ts; settings in services/prefs.ts.
 * Providers are no-ops until configured. Everything here is tracked background work (`bg`), so `void send(...)` still
 * completes on serverless before the response goes out.
 */
import { q } from '../db.js';
import { toUser } from '../realtime.js';
import { bg } from '../lib/background.js';
import { render, type Category, type TemplateKey, type VarsOf } from '../lib/messages.js';
import { loadRecipient, pushAllowed, type Recipient } from './prefs.js';
import { sendPush } from './push.js';
import { sendSmsNow, type SmsMeta, type SmsResult } from './sms.js';

/** Send a text. Tracked as background work, so callers may fire and forget (it still completes on serverless). */
export function sendSms(to: string, body: string, meta?: SmsMeta): Promise<SmsResult> {
  return bg(sendSmsNow(to, body, meta)).then((r) => r ?? { sent: false, provider: 'error', status: 'failed' });
}

/** Render a template and text it (SMS-only templates: sign-in code, parcel recipient, SOS contact…). */
export function sendSmsT<K extends TemplateKey>(to: string, key: K, vars: VarsOf<K>, meta: Omit<SmsMeta, 'template' | 'kind'> = {}) {
  const m = render(key, vars);
  return sendSms(to, m.sms ?? m.body ?? '', { ...meta, template: key, kind: m.smsKind ?? 'transactional' });
}

export interface NotifyOpts {
  /** false: push and realtime only (chat messages are kept in the trip thread instead of the inbox). */
  inbox?: boolean;
  /** Collapse key: a newer push with the same tag replaces the older one on the phone. */
  tag?: string;
}

/** In-app inbox + realtime + push, with the person's notification settings applied. */
export function notify(userId: string, title: string, body: string, data?: Record<string, unknown>, category: Category | string = 'trip', opts: NotifyOpts = {}) {
  return bg((async () => {
    const r = await loadRecipient(userId);
    if (!r) return null;
    return deliver(r, title, body, data, category, opts);
  })());
}

async function deliver(r: Recipient, title: string, body: string, data: Record<string, unknown> | undefined, category: string, opts: NotifyOpts) {
  // Offers go only to people who said yes to them (Spam Act), in the inbox as well as by push.
  if (category === 'promo' && !r.marketing_opt_in) return null;
  if (r.deleted) return null;
  let row: any = null;
  if (opts.inbox !== false) {
    [row] = await q('INSERT INTO notifications (user_id, title, body, data, category) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [r.id, title, body, data ?? null, category]);
    toUser(r.id, 'notification', row);
  }
  if (pushAllowed(r, category)) await sendPush(r.id, { title, body, data, tag: opts.tag, category });
  return row;
}

export interface SendOpts extends NotifyOpts {
  data?: Record<string, unknown>;
  /** The trip this is about: texts for trip updates go to riders who booked by phone (often no smartphone) or asked for texts. */
  trip?: { id: string; channel?: string | null } | null;
}

/** Send a templated message: inbox + push by the person's settings, plus a text for trip updates where that applies. */
export function send<K extends TemplateKey>(userId: string, key: K, vars: VarsOf<K>, opts: SendOpts = {}) {
  return bg((async () => {
    const r = await loadRecipient(userId);
    if (!r) return null;
    const m = render(key, vars);
    const data = opts.data ?? (opts.trip ? { trip_id: opts.trip.id } : undefined);
    const row = m.title ? await deliver(r, m.title, m.body ?? '', data, m.category, opts) : null;
    if (m.sms && r.phone && !r.deleted && m.category === 'trip') {
      const phoneBooking = opts.trip?.channel === 'phone' || opts.trip?.channel === 'sms';
      if (phoneBooking || r.prefs.sms.trip) {
        await sendSmsNow(r.phone, m.sms, { template: key, kind: m.smsKind ?? 'transactional', userId: r.id, tripId: opts.trip?.id ?? null });
      }
    }
    return row;
  })());
}
