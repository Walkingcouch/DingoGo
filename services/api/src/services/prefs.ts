/**
 * Notification preferences (users.notification_prefs, migration 015) and marketing consent records (Spam Act 2003).
 * The in-app inbox always gets service messages; settings decide push and texts. Safety messages can't be switched off.
 * Marketing ("offers") needs the separate opt-in (users.marketing_opt_in) and every change is recorded with the wording shown.
 * Before migration 015 everything falls back to the defaults below.
 */
import { one, q } from '../db.js';
import { ApiError } from '../lib/errors.js';
import { MARKETING_CONSENT_WORDING, type Category } from '../lib/messages.js';

export const PUSH_KEYS = ['trip', 'chat', 'account', 'documents', 'promo'] as const;
export type PushKey = (typeof PUSH_KEYS)[number];
export interface Prefs { push: Record<PushKey, boolean>; sms: { trip: boolean } }
export const DEFAULT_PREFS: Prefs = { push: { trip: true, chat: true, account: true, documents: true, promo: true }, sms: { trip: false } };

export const CATEGORY_INFO: { key: Category; label: string; help: string; locked?: boolean; roles?: string[] }[] = [
  { key: 'trip', label: 'Trip updates', help: 'Driver on the way, arrived, trip finished.' },
  { key: 'chat', label: 'Messages', help: 'Messages from your driver or rider during a trip.' },
  { key: 'account', label: 'Account and payments', help: 'Receipts, refunds, payouts, replies from DingoGo.' },
  { key: 'documents', label: 'Papers running out', help: 'Reminders before your licence, rego or insurance expire.', roles: ['driver'] },
  { key: 'safety', label: 'Safety', help: 'Safety checks and alerts. Always on.', locked: true },
  { key: 'promo', label: 'Offers', help: 'Only if you say yes to offers below.' },
];

const missing = (e: any) => e?.code === '42P01' || e?.code === '42703';

export function mergePrefs(raw: any): Prefs {
  const out: Prefs = { push: { ...DEFAULT_PREFS.push }, sms: { ...DEFAULT_PREFS.sms } };
  if (raw && typeof raw === 'object') {
    for (const k of PUSH_KEYS) if (typeof raw.push?.[k] === 'boolean') out.push[k] = raw.push[k];
    if (typeof raw.sms?.trip === 'boolean') out.sms.trip = raw.sms.trip;
  }
  return out;
}

export interface Recipient { id: string; phone: string | null; name: string; marketing_opt_in: boolean; prefs: Prefs; deleted: boolean }
export async function loadRecipient(userId: string): Promise<Recipient | null> {
  let u: any;
  try {
    u = await one('SELECT id, phone, name, marketing_opt_in, deleted_at, notification_prefs FROM users WHERE id = $1', [userId]);
  } catch (e) {
    if (!missing(e)) throw e;
    u = await one('SELECT id, phone, name, marketing_opt_in, deleted_at FROM users WHERE id = $1', [userId]);
  }
  if (!u) return null;
  const phone = u.phone && !String(u.phone).startsWith('deleted:') ? u.phone : null;
  return { id: u.id, phone, name: u.name, marketing_opt_in: !!u.marketing_opt_in, prefs: mergePrefs(u.notification_prefs), deleted: !!u.deleted_at };
}

/** May this category be pushed to this person? Safety always; offers only with marketing consent. */
export function pushAllowed(r: Recipient, category: string) {
  if (r.deleted) return false;
  if (category === 'safety') return true;
  if (category === 'promo') return r.marketing_opt_in && r.prefs.push.promo;
  return (r.prefs.push as any)[category] !== false;
}

export async function savePrefs(userId: string, prefs: Prefs) {
  try { await q('UPDATE users SET notification_prefs = $2 WHERE id = $1', [userId, JSON.stringify(prefs)]); } catch (e) {
    if (missing(e)) throw new ApiError(503, 'migration_pending', 'Notification settings are not switched on yet. Please try again later.');
    throw e;
  }
}

/** Record a marketing consent given or withdrawn. Never fails the request (best-effort before migration 015). */
export async function recordConsent(c: { userId?: string | null; phone?: string | null; granted: boolean; channel?: 'all' | 'sms' | 'push';
  source: 'app' | 'sms_stop' | 'carrier' | 'admin'; wording?: string | null; ip?: string | null }) {
  try {
    await q(`INSERT INTO marketing_consents (user_id, phone, granted, channel, source, wording, ip) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [c.userId ?? null, c.phone ?? null, c.granted, c.channel ?? 'all', c.source, c.wording ?? (c.granted ? MARKETING_CONSENT_WORDING : null), c.ip ?? null]);
  } catch (e) { if (!missing(e)) console.error('marketing_consents', e); }
}

export async function lastConsent(userId: string) {
  try {
    return await one<{ granted: boolean; source: string; created_at: string; wording: string | null }>(
      'SELECT granted, source, created_at, wording FROM marketing_consents WHERE user_id = $1 ORDER BY id DESC LIMIT 1', [userId]);
  } catch (e) { if (!missing(e)) throw e; return null; }
}

/** Set the marketing opt-in and record it if it changed. */
export async function setMarketing(userId: string, granted: boolean, source: 'app' | 'sms_stop' | 'admin', ip?: string | null) {
  const before = await one<{ marketing_opt_in: boolean; phone: string }>('SELECT marketing_opt_in, phone FROM users WHERE id = $1', [userId]);
  if (!before) return false;
  if (before.marketing_opt_in === granted) return false;
  await q('UPDATE users SET marketing_opt_in = $2 WHERE id = $1', [userId, granted]);
  await recordConsent({ userId, phone: before.phone, granted, source, ip });
  return true;
}
