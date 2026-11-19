/**
 * Round 17 — rider growth and loyalty: programme settings (expiry, tiers, birthday/streak bonuses, referral rules, win-back), the promo
 * code rules (hours, days, services, event area, budget), Darwin-time helpers, ledger labels and gift-card rules. Pure, plus
 * `loyaltyReady()` for migration 021 (live-DB lag: until it exists the old behaviour stays and the new parts are off).
 */
import { one } from '../db.js';
import { haversine, type LatLng } from './geo.js';

export interface Tier { key: string; name: string; min_trips: number; multiplier: number }
export interface LoyaltySettings {
  /** Months with no points activity and no trip before points expire (0 = never). */
  expiry_months: number;
  /** Warning sent this many days before; points never expire without a warning sent at least this long ago. */
  warn_days: number;
  tiers: Tier[];
  /** Opt-in bonuses (0 = off). */
  birthday_points: number;
  streak_weeks: number;
  streak_points: number;
  referral_bonus_points: number;
  /** The friend's first trip must cost at least this for the referral bonus. */
  referral_min_fare_cents: number;
  /** Referral bonuses one rider can earn per Darwin month. */
  referral_monthly_cap: number;
  /** Win-back: riders with no trip for this many days, sent at most once every `winback_every_days`. */
  winback_days: number;
  winback_every_days: number;
}

export const LOYALTY_DEFAULTS: LoyaltySettings = {
  expiry_months: 12, warn_days: 30,
  tiers: [
    { key: 'member', name: 'Member', min_trips: 0, multiplier: 1 },
    { key: 'silver', name: 'Silver', min_trips: 10, multiplier: 1.25 },
    { key: 'gold', name: 'Gold', min_trips: 30, multiplier: 1.5 },
  ],
  birthday_points: 200, streak_weeks: 4, streak_points: 300,
  referral_bonus_points: 500, referral_min_fare_cents: 500, referral_monthly_cap: 10,
  winback_days: 60, winback_every_days: 90,
};

const int = (v: unknown, lo: number, hi: number, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.round(n))) : d;
};

/** Settings as stored (`settings.loyalty`), with every number bounded. Tiers sorted by trips; the first always starts at 0. */
export function mergeLoyalty(raw: any): LoyaltySettings {
  const r = raw && typeof raw === 'object' ? raw : {};
  const d = LOYALTY_DEFAULTS;
  let tiers: Tier[] = Array.isArray(r.tiers) && r.tiers.length ? r.tiers.slice(0, 5).map((t: any, i: number) => ({
    key: String(t?.key ?? `tier${i}`).toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 20) || `tier${i}`,
    name: String(t?.name ?? `Tier ${i + 1}`).trim().slice(0, 30) || `Tier ${i + 1}`,
    min_trips: int(t?.min_trips, 0, 1000, 0),
    multiplier: Math.min(3, Math.max(1, Math.round(Number(t?.multiplier ?? 1) * 100) / 100 || 1)),
  })) : d.tiers.map((t) => ({ ...t }));
  tiers = tiers.sort((a, b) => a.min_trips - b.min_trips);
  tiers[0].min_trips = 0;
  return {
    expiry_months: int(r.expiry_months, 0, 60, d.expiry_months),
    warn_days: int(r.warn_days, 7, 90, d.warn_days),
    tiers,
    birthday_points: int(r.birthday_points, 0, 5000, d.birthday_points),
    streak_weeks: int(r.streak_weeks, 2, 26, d.streak_weeks),
    streak_points: int(r.streak_points, 0, 5000, d.streak_points),
    referral_bonus_points: int(r.referral_bonus_points, 0, 5000, d.referral_bonus_points),
    referral_min_fare_cents: int(r.referral_min_fare_cents, 0, 10000, d.referral_min_fare_cents),
    referral_monthly_cap: int(r.referral_monthly_cap, 0, 100, d.referral_monthly_cap),
    winback_days: int(r.winback_days, 14, 365, d.winback_days),
    winback_every_days: int(r.winback_every_days, 14, 365, d.winback_every_days),
  };
}

/** The rider's tier from completed trips in the last 12 months, and how far to the next. */
export function tierFor(trips: number, tiers: Tier[]) {
  let i = 0;
  for (let k = 0; k < tiers.length; k++) if (trips >= tiers[k].min_trips) i = k;
  const next = tiers[i + 1] ?? null;
  return { tier: tiers[i], next, trips_to_next: next ? next.min_trips - trips : 0, trips };
}

/** Points for a paid fare at this tier: whole points, nothing on $0. */
export const tierPoints = (paidCents: number, pointsPerDollar: number, multiplier: number) =>
  Math.max(0, Math.floor((paidCents / 100) * pointsPerDollar * (multiplier || 1)));

// ───────────── Darwin time ─────────────
const TZ = 'Australia/Darwin';
const parts = (at: Date) => Object.fromEntries(new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
}).formatToParts(at).map((p) => [p.type, p.value]));
const DOW: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Hour (0–23), weekday (0 = Sunday), date and month-day in Darwin. */
export function darwin(at: Date = new Date()) {
  const p = parts(at);
  const date = `${p.year}-${p.month}-${p.day}`;
  return { hour: Number(p.hour) % 24, dow: DOW[p.weekday] ?? 0, date, md: `${p.month}-${p.day}`, year: Number(p.year), month: `${p.year}-${p.month}` };
}

/** The Monday (YYYY-MM-DD) of the Darwin week containing `at`. */
export function weekOf(at: Date = new Date()) {
  const d = darwin(at);
  const day = new Date(`${d.date}T00:00:00Z`);
  day.setUTCDate(day.getUTCDate() - ((d.dow + 6) % 7));
  return day.toISOString().slice(0, 10);
}

/** Weeks in a row (ending with `current`) that have a trip. `weeks` are Monday dates. */
export function streakLength(weeks: Iterable<string>, current: string) {
  const set = new Set(weeks);
  let n = 0;
  const d = new Date(`${current}T00:00:00Z`);
  while (set.has(d.toISOString().slice(0, 10))) { n++; d.setUTCDate(d.getUTCDate() - 7); }
  return n;
}

const leap = (y: number) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
/** Is today (Darwin date) this rider's birthday? 29 February counts on 28 February in other years. */
export function isBirthday(md: string | null | undefined, date: string) {
  if (!md) return false;
  const [y, m, d] = date.split('-');
  if (md === '02-29' && !leap(Number(y))) return `${m}-${d}` === '02-28';
  return md === `${m}-${d}`;
}

/** When points last touched expire: `months` after the last activity (null = never). */
export function expiryFrom(lastActivity: Date | string | null, months: number) {
  if (!lastActivity || !months) return null;
  const d = new Date(lastActivity);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d;
}

// ───────────── Promo rules ─────────────
export interface PromoRules {
  services?: string[] | null; hour_from?: number | null; hour_to?: number | null; days?: number[] | null;
  geo_lat?: number | null; geo_lng?: number | null; geo_radius_m?: number | null;
}
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const hourLabel = (h: number) => (h === 0 || h === 24 ? 'midnight' : h === 12 ? 'midday' : h < 12 ? `${h} am` : `${h - 12} pm`);

/** In the hour window? `to` is exclusive; a window like 22–6 runs over midnight. */
export function inHours(hour: number, from: number | null | undefined, to: number | null | undefined) {
  if (from == null || to == null) return true;
  return from < to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** Why this booking can't use the code (code + plain message), or null. Times are Darwin time. */
export function promoRuleError(p: PromoRules, ctx: { service: string; at: Date; pickup: LatLng; dropoff: LatLng }) {
  if (p.services?.length && !p.services.includes(ctx.service)) {
    return { code: 'promo_service', message: 'That promo code is not for this kind of trip' };
  }
  const d = darwin(ctx.at);
  if (p.days?.length && !p.days.map(Number).includes(d.dow)) {
    return { code: 'promo_time', message: `That promo code works on ${p.days.map((x) => DAY_NAMES[Number(x)] ?? '').filter(Boolean).join(', ')} only` };
  }
  if (!inHours(d.hour, p.hour_from, p.hour_to)) {
    return { code: 'promo_time', message: `That promo code works from ${hourLabel(p.hour_from!)} to ${hourLabel(p.hour_to!)} only` };
  }
  if (p.geo_lat != null && p.geo_lng != null && p.geo_radius_m) {
    const c = { lat: Number(p.geo_lat), lng: Number(p.geo_lng) };
    const r = Number(p.geo_radius_m);
    if (haversine(ctx.pickup, c) > r && haversine(ctx.dropoff, c) > r) {
      return { code: 'promo_area', message: 'That promo code is for trips to or from the event only' };
    }
  }
  return null;
}

/** The promo discount on a booked trip (its fare lines), so a cancelled trip gives the budget back exactly. */
export function promoDiscountOf(fb: { lines?: { label: string; cents: number }[] } | null | undefined, code: string | null | undefined) {
  if (!code || !fb?.lines) return 0;
  return 0 - fb.lines.filter((l) => l.label === `Promo ${code}`).reduce((n, l) => n + Number(l.cents ?? 0), 0);
}

// ───────────── Ledger and gift cards ─────────────
const REASONS: Record<string, string> = {
  trip_earned: 'Trip', redeemed_on_trip: 'Used on a trip', referral_bonus: 'Friend referral', refund_cancelled_trip: 'Points back (trip cancelled)',
  admin_adjustment: 'Adjustment by DingoGo', expired: 'Expired (no activity)', birthday_bonus: 'Birthday bonus', streak_bonus: 'Weekly streak bonus',
};
export function ledgerLabel(reason: string) {
  if (reason.startsWith('reward:')) return `Swapped for ${reason.slice(7)}`;
  return REASONS[reason] ?? reason.replace(/_/g, ' ');
}

/** Australian Consumer Law: gift cards sold to consumers carry at least a 3-year expiry. */
export const GIFT_CARD_MIN_DAYS = 3 * 365 + 1;
export const GIFT_VALUES_CENTS = [1000, 2000, 2500, 5000, 10000];

// ───────────── Migration 021 ─────────────
let ready = false;
let checkedAt = 0;
export async function loyaltyReady(): Promise<boolean> {
  if (ready) return true;
  if (checkedAt && Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const r = await one<{ n: number }>(
      `SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema()
                 AND ((table_name = 'promo_codes' AND column_name IN ('budget_cents','spent_cents','services','hour_from','hour_to','days','geo_lat','geo_lng','geo_radius_m','targeted'))
                   OR (table_name = 'reward_redemptions' AND column_name = 'settlement_cents')
                   OR (table_name = 'gift_vouchers' AND column_name IN ('needs_activation','purchased_by','from_name','recipient_name','message','payment_ref'))))
            + (SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()
                 AND table_name IN ('promo_grants','loyalty_profiles','loyalty_notices','partner_settlements')) AS n`);
    ready = Number(r!.n) === 21;
  } catch { ready = false; }
  return ready;
}
export function resetLoyaltyReady() { ready = false; checkedAt = 0; }
