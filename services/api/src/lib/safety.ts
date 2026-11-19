/**
 * Round 14: safety and trust — rules and defaults. Trusted contacts and automatic trip sharing, ride check-ins, long-stop
 * detection, driver fatigue limits, driver photo checks, incident reports and account restrictions with appeals.
 * The database parts need migration 019 (checked by safetyReady); without it every feature here is off or says migration_pending.
 */
import { one, pool, type Q } from '../db.js';
import { config } from '../config.js';
import { bad } from './errors.js';

// ── Migration 019 ──
let ready = false;
let checkedAt = 0;
const TABLES = ['safety_checks', 'driver_online_sessions', 'identity_checks', 'incident_reports', 'account_actions', 'appeals'];
export async function safetyReady(): Promise<boolean> {
  if (ready) return true;
  if (checkedAt && Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const r = await one<{ n: number }>(
      `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema() AND table_name = ANY($1))::int
            + (SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema()
                 AND table_name = 'users' AND column_name IN ('trusted_contacts', 'auto_share'))::int AS n`, [TABLES]);
    ready = r!.n === TABLES.length + 2;
  } catch { ready = false; }
  return ready;
}
export function resetSafetyReady() { ready = false; checkedAt = 0; }
export const safetyPending = 'This needs database migration 019';

// ── Policy (admin → Safety → Policy) ──
export type IdentityMode = 'off' | 'photo_review' | 'face_match';
export interface SafetyPolicy {
  /** Photo check before going online. off | photo_review (DingoGo looks at the selfie) | face_match (provider, falls back to review). */
  identity_check: { mode: IdentityMode; every_hours: number; match_threshold: number };
  /** Fatigue limits. Defaults follow common point-to-point guidance (12 hours in 24 with a long rest, regular breaks); check them
   *  against current NT and SA guidance before relying on them. */
  fatigue: { enabled: boolean; max_online_min_24h: number; rest_min: number; break_after_min: number; break_min: number; warn_before_min: number };
  /** "Are you OK?" during rides. */
  check_ins: { enabled: boolean; long_stop_min: number; answer_min: number; text_contacts_on_escalation: boolean };
  /** Night window for "share night trips" (Darwin time, 24 h clock; wraps past midnight). */
  night: { from_hour: number; to_hour: number };
  /** A critical report (sexual misconduct, assault) puts the reported account on hold until DingoGo has looked at it. */
  incidents: { auto_hold_critical: boolean };
}
export const SAFETY_POLICY_DEFAULTS: SafetyPolicy = {
  identity_check: { mode: 'off', every_hours: 24, match_threshold: 0.9 },
  fatigue: { enabled: true, max_online_min_24h: 720, rest_min: 360, break_after_min: 300, break_min: 20, warn_before_min: 30 },
  check_ins: { enabled: true, long_stop_min: 5, answer_min: 3, text_contacts_on_escalation: true },
  night: { from_hour: 21, to_hour: 6 },
  incidents: { auto_hold_critical: true },
};

export async function loadSafetyPolicy(c: Q = pool): Promise<SafetyPolicy> {
  const v = (await one(`SELECT value FROM settings WHERE key = 'safety_policy'`, [], c).catch(() => null))?.value ?? {};
  const d = SAFETY_POLICY_DEFAULTS;
  return {
    identity_check: { ...d.identity_check, ...(v.identity_check ?? {}) },
    fatigue: { ...d.fatigue, ...(v.fatigue ?? {}) },
    check_ins: { ...d.check_ins, ...(v.check_ins ?? {}) },
    night: { ...d.night, ...(v.night ?? {}) },
    incidents: { ...d.incidents, ...(v.incidents ?? {}) },
  };
}

const int = (v: unknown, lo: number, hi: number, what: string) => {
  if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) throw bad('validation_error', `${what} must be a whole number from ${lo} to ${hi}`);
  return v as number;
};
const bool = (v: unknown, what: string) => { if (typeof v !== 'boolean') throw bad('validation_error', `${what} must be true or false`); return v; };

export function checkSafetyPolicy(input: any): SafetyPolicy {
  const d = SAFETY_POLICY_DEFAULTS;
  const i = { ...d.identity_check, ...(input?.identity_check ?? {}) };
  const f = { ...d.fatigue, ...(input?.fatigue ?? {}) };
  const c = { ...d.check_ins, ...(input?.check_ins ?? {}) };
  const n = { ...d.night, ...(input?.night ?? {}) };
  const x = { ...d.incidents, ...(input?.incidents ?? {}) };
  if (!['off', 'photo_review', 'face_match'].includes(i.mode)) throw bad('validation_error', 'Photo check is off, photo_review or face_match');
  if (typeof i.match_threshold !== 'number' || i.match_threshold < 0.5 || i.match_threshold > 0.99) throw bad('validation_error', 'Match threshold is 0.5 to 0.99');
  const out: SafetyPolicy = {
    identity_check: { mode: i.mode, every_hours: int(i.every_hours, 1, 168, 'Photo check interval (hours)'), match_threshold: i.match_threshold },
    fatigue: {
      enabled: bool(f.enabled, 'Fatigue limits'),
      max_online_min_24h: int(f.max_online_min_24h, 240, 960, 'Most minutes online in 24 hours'),
      rest_min: int(f.rest_min, 240, 720, 'Rest after the daily limit (minutes)'),
      break_after_min: int(f.break_after_min, 60, 480, 'Break after (minutes online)'),
      break_min: int(f.break_min, 10, 120, 'Break length (minutes)'),
      warn_before_min: int(f.warn_before_min, 0, 120, 'Warning before a limit (minutes)'),
    },
    check_ins: {
      enabled: bool(c.enabled, 'Check-ins'),
      long_stop_min: int(c.long_stop_min, 2, 30, 'Long stop (minutes)'),
      answer_min: int(c.answer_min, 1, 15, 'Time to answer a check-in (minutes)'),
      text_contacts_on_escalation: bool(c.text_contacts_on_escalation, 'Text trusted contacts on no answer'),
    },
    night: { from_hour: int(n.from_hour, 0, 23, 'Night starts (hour)'), to_hour: int(n.to_hour, 0, 23, 'Night ends (hour)') },
    incidents: { auto_hold_critical: bool(x.auto_hold_critical, 'Hold accounts on critical reports') },
  };
  if (out.fatigue.break_after_min >= out.fatigue.max_online_min_24h) throw bad('validation_error', 'The break must come before the daily limit');
  return out;
}

/** Darwin hour of day (NT has no daylight saving). */
export const darwinHour = (at = new Date()) => Number(new Intl.DateTimeFormat('en-AU', { timeZone: config.timezone, hour: 'numeric', hourCycle: 'h23' }).format(at));
export function isNight(p: SafetyPolicy['night'], at = new Date()) {
  const h = darwinHour(at);
  return p.from_hour > p.to_hour ? h >= p.from_hour || h < p.to_hour : h >= p.from_hour && h < p.to_hour;
}
export const darwinClock = (d: Date) => new Intl.DateTimeFormat('en-AU', { timeZone: config.timezone, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);

// ── Trusted contacts ──
export const AUTO_SHARE = ['off', 'night', 'always'] as const;
export type AutoShare = (typeof AUTO_SHARE)[number];
export const MAX_TRUSTED_CONTACTS = 5;

/** Everyone to text for a person: trusted contacts plus the older single emergency contact, one per phone number. */
export function contactsOf(u: { trusted_contacts?: any; emergency_contact?: any } | null | undefined): { name: string; phone: string }[] {
  const list = [...(Array.isArray(u?.trusted_contacts) ? u!.trusted_contacts : []), ...(u?.emergency_contact?.phone ? [u.emergency_contact] : [])];
  const seen = new Set<string>();
  return list.filter((c) => {
    const p = String(c?.phone ?? '').replace(/[\s()-]/g, '');
    if (!p || seen.has(p)) return false;
    seen.add(p); return true;
  }).map((c) => ({ name: String(c.name ?? ''), phone: String(c.phone) }));
}

// ── Incident reports ──
export const INCIDENT_CATEGORIES = {
  sexual_misconduct: { label: 'Sexual harassment or assault', severity: 'critical' },
  physical_assault: { label: 'Physical violence', severity: 'critical' },
  impaired_driving: { label: 'Driver seemed drunk or on drugs', severity: 'high' },
  dangerous_driving: { label: 'Dangerous driving', severity: 'high' },
  threats_abuse: { label: 'Threats or abuse', severity: 'high' },
  discrimination: { label: 'Racism or discrimination', severity: 'high' },
  wrong_driver_or_car: { label: 'Driver or car didn\'t match the app', severity: 'high' },
  contact_after_trip: { label: 'Unwanted contact after the trip', severity: 'high' },
  unsafe_vehicle: { label: 'Unsafe car', severity: 'normal' },
  rude_behaviour: { label: 'Rude or unprofessional', severity: 'normal' },
  other: { label: 'Something else', severity: 'normal' },
} as const satisfies Record<string, { label: string; severity: 'critical' | 'high' | 'normal' }>;
export type IncidentCategory = keyof typeof INCIDENT_CATEGORIES;
export const INCIDENT_STATUSES = ['open', 'investigating', 'actioned', 'closed'] as const;

// ── Account restrictions ──
export const RESTRICT_REASONS = {
  under_review: 'Your account is on hold while we look into a safety report.',
  safety_incident: 'A safety report about you was upheld.',
  abuse: 'Abusive or threatening behaviour towards a driver, rider or our team.',
  fraud: 'Fraud or misuse of payments, promotions or credit.',
  document_fraud: 'Documents or identity details that weren\'t genuine.',
  repeated_cancellations: 'Repeated cancellations or no-shows.',
  identity_check: 'Your photo check didn\'t match your account.',
  other: 'A breach of the DingoGo terms.',
} as const;
export type RestrictReason = keyof typeof RESTRICT_REASONS;

// ── Support numbers on the emergency card ──
export const SAFETY_NUMBERS = [
  { label: 'Police, fire, ambulance (emergency)', number: '000' },
  { label: 'NT Police (not urgent)', number: '131 444' },
  { label: '1800RESPECT (sexual assault, family and domestic violence)', number: '1800 737 732' },
  { label: 'Lifeline (crisis support)', number: '13 11 14' },
];

// ── Fatigue: pure maths over online sessions ──
export interface Session { started_at: Date | string; ended_at: Date | string | null }
export interface FatigueStatus {
  enabled: boolean;
  online_min_24h: number; max_online_min_24h: number;
  continuous_min: number; break_after_min: number;
  /** Minutes until the next limit while online (null when offline or limits are off). */
  minutes_left: number | null;
  /** When the driver may go online again (null = now). */
  rest_until: string | null;
  reason: 'daily_limit' | 'break' | null;
}

/**
 * Daily limit: online minutes since the last rest of `rest_min` (and within 24 h) reach `max_online_min_24h` → offline until
 * `rest_min` after they stopped. Break: online for `break_after_min` without `break_min` off → offline for `break_min`.
 * Gaps shorter than a break don't count as one.
 */
export function fatigueStatus(sessions: Session[], p: SafetyPolicy['fatigue'], now = new Date()): FatigueStatus {
  const off: FatigueStatus = { enabled: false, online_min_24h: 0, max_online_min_24h: p.max_online_min_24h, continuous_min: 0, break_after_min: p.break_after_min, minutes_left: null, rest_until: null, reason: null };
  const N = now.getTime();
  const ss = sessions.map((s) => ({ a: new Date(s.started_at).getTime(), b: s.ended_at ? new Date(s.ended_at).getTime() : N }))
    .filter((s) => s.b > N - 48 * 3600e3 && s.b >= s.a).sort((x, y) => x.a - y.a);
  const online = sessions.some((s) => !s.ended_at);
  // Count since the last long rest (or 24 h ago).
  let restEnd = N - 24 * 3600e3;
  for (let i = 0; i < ss.length; i++) {
    const gapStart = i === 0 ? -Infinity : ss[i - 1].b;
    if (ss[i].a - gapStart >= p.rest_min * 60e3) restEnd = Math.max(restEnd, ss[i].a);
  }
  const last = ss[ss.length - 1];
  if (!online && last && N - last.b >= p.rest_min * 60e3) restEnd = N;
  let used = 0;
  for (const s of ss) used += Math.max(0, Math.min(s.b, N) - Math.max(s.a, restEnd));
  // Continuous block: walk back while gaps are shorter than a break.
  let blockStart = last?.a ?? N;
  for (let i = ss.length - 1; i > 0; i--) {
    if (ss[i].a - ss[i - 1].b < p.break_min * 60e3) blockStart = ss[i - 1].a; else break;
  }
  const blockEnd = last ? last.b : N;
  let continuous = last ? blockEnd - blockStart : 0;
  if (!online && last && N - last.b >= p.break_min * 60e3) continuous = 0;
  const st: FatigueStatus = { ...off, enabled: p.enabled, online_min_24h: Math.floor(used / 60e3), continuous_min: Math.floor(continuous / 60e3) };
  if (!p.enabled) return st;
  const lastEnd = online ? N : (last?.b ?? N);
  if (used >= p.max_online_min_24h * 60e3) {
    st.reason = 'daily_limit';
    st.rest_until = new Date(lastEnd + p.rest_min * 60e3).toISOString();
  } else if (continuous >= p.break_after_min * 60e3) {
    st.reason = 'break';
    st.rest_until = new Date(lastEnd + p.break_min * 60e3).toISOString();
  }
  if (st.rest_until && Date.parse(st.rest_until) <= N && !online) { st.rest_until = null; st.reason = null; }
  if (online && !st.reason) {
    st.minutes_left = Math.max(0, Math.floor(Math.min(p.max_online_min_24h * 60e3 - used, p.break_after_min * 60e3 - continuous) / 60e3));
  }
  return st;
}
