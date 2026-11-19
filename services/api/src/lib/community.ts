/**
 * Round 12: community and cultural fit — languages, concession pricing, organisations booking rides for clients with consent,
 * and driver leave (Sorry Business). Rules and defaults here; the database parts need migration 017 (checked by communityReady).
 */
import { one, pool, type Q } from '../db.js';
import { bad } from './errors.js';

// ── Languages ── English is the default and the source. Arrernte (aer) and Kriol (rop) wording is a community draft
// (packages/shared/src/i18n/strings.json). "arr" was used for Arrernte before, but that ISO 639-3 code is another language.
export const LANGS = ['en', 'aer', 'rop'] as const;
export type Lang = (typeof LANGS)[number];
export const LANGUAGE_INFO: Record<Lang, { name: string; status: 'source' | 'draft' }> = {
  en: { name: 'English', status: 'source' },
  aer: { name: 'Arrernte (Eastern/Central, Mparntwe)', status: 'draft' },
  rop: { name: 'Kriol', status: 'draft' },
};
export const normaliseLang = (l?: string | null): Lang => (l === 'arr' ? 'aer' : (LANGS as readonly string[]).includes(l ?? '') ? (l as Lang) : 'en');

// ── Migration 017 ──
let ready = false;
let checkedAt = 0;
export async function communityReady(): Promise<boolean> {
  if (ready) return true;
  if (checkedAt && Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const r = await one<{ n: number }>(
      `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = 'client_consents')::int
            + (SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema()
                 AND ((table_name = 'users' AND column_name = 'concession') OR (table_name = 'drivers' AND column_name = 'leave')))::int AS n`);
    ready = r!.n === 3;
  } catch { ready = false; }
  return ready;
}
export function resetCommunityReady() { ready = false; checkedAt = 0; }
export const communityPending = 'This needs database migration 017';

// ── Concession / community pricing (off by default; DingoGo funds the discount, the driver's pay is unchanged) ──
export const CONCESSION_TYPES = {
  pensioner: 'Pensioner Concession Card',
  health_care: 'Health Care Card',
  seniors: 'NT Seniors Card',
  dva: 'DVA Gold or White Card',
  student: 'Student concession card',
} as const;
export type ConcessionType = keyof typeof CONCESSION_TYPES;

export interface CommunityPricing {
  enabled: boolean;
  /** Percent off the fare and booking fee (not the levy or fuel surcharge). */
  concession_pct: number;
  /** Most taken off one trip, in cents (0 = no cap). */
  concession_max_cents: number;
  /** Services the concession applies to. */
  services: string[];
  /** Cards accepted. */
  types: ConcessionType[];
}
export const COMMUNITY_PRICING_DEFAULTS: CommunityPricing = {
  enabled: false, concession_pct: 0, concession_max_cents: 0, services: ['ride', 'pet'], types: ['pensioner', 'health_care', 'seniors', 'dva'],
};

export async function loadCommunityPricing(c: Q = pool): Promise<CommunityPricing> {
  const v = (await one(`SELECT value FROM settings WHERE key = 'community_pricing'`, [], c))?.value ?? {};
  return { ...COMMUNITY_PRICING_DEFAULTS, ...v };
}

export function checkCommunityPricing(v: any): CommunityPricing {
  const s = { ...COMMUNITY_PRICING_DEFAULTS, ...(v ?? {}) } as CommunityPricing;
  if (typeof s.enabled !== 'boolean') throw bad('validation_error', 'enabled must be true or false');
  if (!Number.isInteger(s.concession_pct) || s.concession_pct < 0 || s.concession_pct > 75) throw bad('validation_error', 'Concession is a whole percent from 0 to 75');
  if (!Number.isInteger(s.concession_max_cents) || s.concession_max_cents < 0 || s.concession_max_cents > 100_00) throw bad('validation_error', 'Cap per trip is 0 to $100');
  if (!Array.isArray(s.services) || !s.services.every((x) => typeof x === 'string' && x.length <= 30)) throw bad('validation_error', 'services must be a list');
  if (!Array.isArray(s.types) || !s.types.every((x) => x in CONCESSION_TYPES)) throw bad('validation_error', `Card types are ${Object.keys(CONCESSION_TYPES).join(', ')}`);
  if (s.enabled && s.concession_pct === 0) throw bad('validation_error', 'Set a concession percent before switching it on');
  return { enabled: s.enabled, concession_pct: s.concession_pct, concession_max_cents: s.concession_max_cents, services: [...new Set(s.services)], types: [...new Set(s.types)] };
}

/** YYYY-MM-DD in Darwin time: a card that expires today is good until local midnight, not 9:30 am (UTC midnight). */
export const localDate = (at: Date = new Date(), tz = 'Australia/Darwin') =>
  new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at);

/** The concession this rider gets on this service at this time, or null. `card` is users.concession. */
export function concessionFor(card: any, service: string, rules: CommunityPricing, at = new Date()) {
  if (!rules.enabled || !rules.concession_pct || !card || card.status !== 'approved') return null;
  if (!rules.services.includes(service) || !rules.types.includes(card.type)) return null;
  if (card.expires && String(card.expires) < localDate(at)) return null;
  return { pct: rules.concession_pct, max_cents: rules.concession_max_cents || null, label: `Concession (−${rules.concession_pct}%)` };
}

// ── Organisations booking for clients ──
/** Account kinds. Community kinds may book rides for clients (with the client's consent). */
export const ACCOUNT_KINDS = ['business', 'ndis_plan_manager', 'community_org', 'aboriginal_corporation', 'health_service', 'government'] as const;
export const CLIENT_BOOKING_KINDS = ['ndis_plan_manager', 'community_org', 'aboriginal_corporation', 'health_service', 'government'];
export const CONSENT_METHODS = ['verbal', 'written', 'standing'] as const;

/** "Mary K." — what an organisation and the driver see of a client by default. */
export function clientName(full: string | null | undefined) {
  const parts = String(full ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'Client';
  return parts.length === 1 ? parts[0] : `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

// ── Driver leave ──
export const LEAVE_KINDS = { sorry_business: 'Sorry Business', cultural: 'Cultural business', family: 'Family' } as const;
export type LeaveKind = keyof typeof LEAVE_KINDS;
/** A driver cancel reason that is never counted against the driver (the trip goes to the next driver). */
export const NO_FAULT_CANCEL_REASONS = ['sorry_business'] as const;
