/**
 * Round 22: customer support rules (pure; no database). Ticket categories and priority, SLA due times and timer states, the
 * support policy (admin → Support → Policy), the fare review that checks a charge against the upfront price and the GPS track,
 * the automatic-refund decision, canned-reply placeholders and lost-property states.
 */
import { bad } from './errors.js';
import { haversine, type LatLng } from './geo.js';
import { routeChangeExtra } from './fares.js';

export const CATEGORIES = ['lost_item', 'fare', 'safety', 'driver', 'parcel', 'accessibility', 'assistance_animal_refused', 'app', 'pay', 'other'] as const;
export type Category = typeof CATEGORIES[number];
export const PRIORITIES = ['urgent', 'high', 'normal', 'low'] as const;
export type Priority = typeof PRIORITIES[number];
export const STATUSES = ['open', 'pending', 'resolved'] as const;
export type TicketStatus = typeof STATUSES[number];

export interface SupportPolicy {
  /** Calendar minutes/hours (the desk answers 7 days); first response = first staff reply the customer can see. */
  sla: Record<Priority, { first_response_min: number; resolve_hours: number }>;
  priority_by_category: Record<Category, Priority>;
  fare_review: {
    auto_refund: boolean;
    /** Largest automatic refund on one trip. Above it a person decides. */
    max_cents: number;
    /** Automatic refunds per rider in 30 days (more goes to a person). */
    max_per_rider_30d: number;
    /** Differences up to this are treated as no difference (rounding). */
    tolerance_cents: number;
    /** GPS points needed to trust the track. With fewer, the route-change charge can't be checked. */
    min_track_points: number;
    /** Allowance on the tracked distance (a sampled GPS line is shorter than the road). */
    track_allowance_pct: number;
    /** No usable track: refund an unchecked route-change charge within the limits (benefit of the doubt), or pass it to a person. */
    unverified: 'refund' | 'ticket';
  };
  lost_property: { report_within_days: number; contact_days: number };
  /** A customer reply reopens a resolved ticket for this many days; later, they start a new one. */
  reopen_days: number;
}

export const DEFAULT_SUPPORT_POLICY: SupportPolicy = {
  sla: {
    urgent: { first_response_min: 15, resolve_hours: 4 },
    high: { first_response_min: 60, resolve_hours: 24 },
    normal: { first_response_min: 240, resolve_hours: 72 },
    low: { first_response_min: 1440, resolve_hours: 168 },
  },
  priority_by_category: {
    safety: 'urgent', assistance_animal_refused: 'high', lost_item: 'high', parcel: 'high', fare: 'normal', driver: 'normal',
    accessibility: 'high', pay: 'normal', app: 'normal', other: 'low',
  },
  fare_review: { auto_refund: true, max_cents: 1500, max_per_rider_30d: 2, tolerance_cents: 50, min_track_points: 5, track_allowance_pct: 10, unverified: 'refund' },
  lost_property: { report_within_days: 30, contact_days: 7 },
  reopen_days: 14,
};

const int = (v: unknown, lo: number, hi: number, what: string) => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < lo || v > hi) throw bad('invalid_policy', `${what}: a whole number from ${lo} to ${hi}`);
  return v;
};

/** Validated policy (missing parts take the defaults). 400 `invalid_policy`. */
export function checkSupportPolicy(input: any): SupportPolicy {
  const d = DEFAULT_SUPPORT_POLICY;
  const sla = {} as SupportPolicy['sla'];
  for (const p of PRIORITIES) {
    const s = { ...d.sla[p], ...(input?.sla?.[p] ?? {}) };
    sla[p] = { first_response_min: int(s.first_response_min, 5, 10080, `${p} first response (minutes)`), resolve_hours: int(s.resolve_hours, 1, 720, `${p} resolve (hours)`) };
    if (sla[p].first_response_min > sla[p].resolve_hours * 60) throw bad('invalid_policy', `${p}: the first reply must be due before the ticket is due to be resolved`);
  }
  const pbc = { ...d.priority_by_category, ...(input?.priority_by_category ?? {}) } as Record<string, unknown>;
  for (const c of CATEGORIES) if (!PRIORITIES.includes(pbc[c] as Priority)) throw bad('invalid_policy', `Priority for ${c}: urgent, high, normal or low`);
  if (pbc.safety !== 'urgent') throw bad('invalid_policy', 'Safety tickets are always urgent');
  const f = { ...d.fare_review, ...(input?.fare_review ?? {}) };
  if (typeof f.auto_refund !== 'boolean') throw bad('invalid_policy', 'Automatic refunds: on or off');
  if (!['refund', 'ticket'].includes(f.unverified)) throw bad('invalid_policy', 'No GPS track: refund or ticket');
  const l = { ...d.lost_property, ...(input?.lost_property ?? {}) };
  return {
    sla,
    priority_by_category: Object.fromEntries(CATEGORIES.map((c) => [c, pbc[c]])) as SupportPolicy['priority_by_category'],
    fare_review: {
      auto_refund: f.auto_refund,
      max_cents: int(f.max_cents, 0, 10000, 'Largest automatic refund (cents)'),
      max_per_rider_30d: int(f.max_per_rider_30d, 0, 10, 'Automatic refunds per rider in 30 days'),
      tolerance_cents: int(f.tolerance_cents, 0, 500, 'Tolerance (cents)'),
      min_track_points: int(f.min_track_points, 2, 100, 'GPS points needed'),
      track_allowance_pct: int(f.track_allowance_pct, 0, 30, 'Allowance on the tracked distance (%)'),
      unverified: f.unverified,
    },
    lost_property: { report_within_days: int(l.report_within_days, 1, 90, 'Report lost items within (days)'), contact_days: int(l.contact_days, 1, 30, 'Keep chat and calls open (days)') },
    reopen_days: int(input?.reopen_days ?? d.reopen_days, 1, 90, 'Reopen resolved tickets within (days)'),
  };
}

export const priorityFor = (category: string, policy: SupportPolicy = DEFAULT_SUPPORT_POLICY): Priority =>
  policy.priority_by_category[category as Category] ?? 'normal';

/** Due times from when the ticket came in. */
export function slaDue(createdAt: Date | string, priority: Priority, policy: SupportPolicy = DEFAULT_SUPPORT_POLICY) {
  const at = new Date(createdAt).getTime();
  const s = policy.sla[priority] ?? policy.sla.normal;
  return { first_response_due_at: new Date(at + s.first_response_min * 60_000), resolve_due_at: new Date(at + s.resolve_hours * 3_600_000) };
}

export type TimerState = 'met' | 'missed' | 'due' | 'overdue' | null;
export interface SlaView { first_response: TimerState; resolve: TimerState; minutes_left: number | null; overdue: boolean }

/** Where a ticket stands against its due times. `minutes_left` is for the next timer still running (negative once late). */
export function slaState(t: { status: string; first_response_due_at?: Date | string | null; resolve_due_at?: Date | string | null;
  first_response_at?: Date | string | null; resolved_at?: Date | string | null }, now = Date.now()): SlaView {
  const ms = (d: Date | string | null | undefined) => (d ? new Date(d).getTime() : null);
  const frDue = ms(t.first_response_due_at), rsDue = ms(t.resolve_due_at), fr = ms(t.first_response_at), rs = ms(t.resolved_at);
  const timer = (due: number | null, doneAt: number | null, done: boolean): TimerState => {
    if (due == null) return null;
    if (done) return doneAt != null && doneAt <= due ? 'met' : 'missed';
    return now > due ? 'overdue' : 'due';
  };
  const resolved = t.status === 'resolved';
  const first = timer(frDue, fr, fr != null || resolved);
  const resolve = timer(rsDue, rs, resolved);
  // A ticket waiting on the customer (pending) doesn't run the resolve clock as "late" for the desk.
  const waiting = t.status === 'pending';
  const next = first === 'due' || first === 'overdue' ? frDue : !resolved && !waiting ? rsDue : null;
  return {
    first_response: first, resolve: waiting && resolve === 'overdue' ? 'due' : resolve,
    minutes_left: next == null ? null : Math.round((next - now) / 60_000),
    overdue: first === 'overdue' || (!waiting && resolve === 'overdue'),
  };
}

/** Length of a GPS track in metres. Points closer than 10 s apart that imply more than 200 km/h are skipped as GPS jumps. */
export function trackDistanceM(points: (LatLng & { at?: Date | string })[]): number {
  let m = 0;
  let prev: (LatLng & { at?: Date | string }) | null = null;
  for (const p of points) {
    if (prev) {
      const d = haversine(prev, p);
      const dt = prev.at && p.at ? (new Date(p.at).getTime() - new Date(prev.at).getTime()) / 1000 : null;
      if (dt != null && dt > 0 && d / dt > 55) continue; // > 200 km/h: a jump, keep the previous point
      m += d;
    }
    prev = p;
  }
  return Math.round(m);
}

export type FareVerdict = 'as_quoted' | 'supported' | 'overcharged' | 'unverified' | 'refunded_already' | 'not_charged';
export interface FareReview {
  verdict: FareVerdict;
  quote_cents: number;
  charged_cents: number;
  extra_cents: number;
  fair_cents: number;
  /** What the rider paid above what the check supports, less what was already refunded. */
  overcharge_cents: number;
  refunded_cents: number;
  est_distance_m: number;
  reported_distance_m: number | null;
  tracked_distance_m: number | null;
  track_points: number;
  explanation: string;
}

/**
 * Fare review: riders pay the upfront price unless the driven distance was more than 25% over the estimate (then the extra
 * kilometres, capped at +20%). Check the extra against the GPS track: the track (plus an allowance) decides what extra was fair.
 */
export function reviewFare(o: { quote_cents: number; final_cents: number | null; est_distance_m: number; actual_distance_m: number | null;
  per_km_cents: number; service: string; track: (LatLng & { at?: Date | string })[]; refunded_cents: number; payment_failed?: boolean },
  policy: SupportPolicy['fare_review'] = DEFAULT_SUPPORT_POLICY.fare_review): FareReview {
  const charged = o.final_cents ?? o.quote_cents;
  const extra = Math.max(0, charged - o.quote_cents);
  const enough = o.track.length >= policy.min_track_points;
  const tracked = enough ? trackDistanceM(o.track) : null;
  const base = { quote_cents: o.quote_cents, charged_cents: charged, extra_cents: extra, est_distance_m: o.est_distance_m,
    reported_distance_m: o.actual_distance_m ?? null, tracked_distance_m: tracked, track_points: o.track.length, refunded_cents: o.refunded_cents };
  const km = (m: number | null) => (m == null ? '?' : (m / 1000).toFixed(1));
  if (o.payment_failed) {
    return { ...base, verdict: 'not_charged', fair_cents: charged, overcharge_cents: 0, explanation: 'The payment for this trip did not go through, so there is nothing to refund yet.' };
  }
  if (extra <= policy.tolerance_cents) {
    return { ...base, verdict: 'as_quoted', fair_cents: charged, overcharge_cents: 0,
      explanation: `You paid the price shown when you booked (${dollars(o.quote_cents)}). Upfront prices don't change with traffic or the route the car takes.` };
  }
  let fair: number;
  let verdict: FareVerdict;
  let explanation: string;
  if (tracked == null) {
    fair = o.quote_cents;
    verdict = 'unverified';
    explanation = `A route change added ${dollars(extra)}, and we don't have enough GPS points from the car to check the distance.`;
  } else {
    const allowed = Math.round(tracked * (1 + policy.track_allowance_pct / 100));
    const dist = Math.min(allowed, o.actual_distance_m ?? allowed);
    fair = o.quote_cents + routeChangeExtra({ quoteCents: o.quote_cents, estDistanceM: o.est_distance_m, actualDistanceM: dist, perKmCents: o.per_km_cents, service: o.service });
    if (charged - fair <= policy.tolerance_cents) {
      verdict = 'supported'; fair = charged;
      explanation = `The car's GPS track (${km(tracked)} km against ${km(o.est_distance_m)} km estimated) shows the longer route, so the route change charge of ${dollars(extra)} stands.`;
    } else {
      verdict = 'overcharged';
      explanation = `The car's GPS track is ${km(tracked)} km against ${km(o.est_distance_m)} km estimated, which supports ${fair > o.quote_cents ? `only ${dollars(fair - o.quote_cents)} of` : 'none of'} the ${dollars(extra)} route change charge.`;
    }
  }
  const over = Math.max(0, charged - fair - o.refunded_cents);
  if (verdict !== 'supported' && over <= policy.tolerance_cents && o.refunded_cents > 0) {
    return { ...base, verdict: 'refunded_already', fair_cents: fair, overcharge_cents: 0, explanation: `${explanation} The difference has already been refunded.` };
  }
  return { ...base, verdict, fair_cents: fair, overcharge_cents: verdict === 'supported' ? 0 : over, explanation };
}

export type RefundDecision = { refund_cents: number; reason: string } | { refund_cents: 0; held: 'policy_off' | 'over_limit' | 'too_many' | 'unverified_to_person' | 'nothing' };

/** Whether the review's difference is refunded automatically (within the admin limits) or goes to a person. */
export function autoRefundDecision(r: FareReview, policy: SupportPolicy['fare_review'], autoRefunds30d: number): RefundDecision {
  if (!(r.overcharge_cents > 0) || !['overcharged', 'unverified'].includes(r.verdict)) return { refund_cents: 0, held: 'nothing' };
  if (!policy.auto_refund) return { refund_cents: 0, held: 'policy_off' };
  if (r.verdict === 'unverified' && policy.unverified !== 'refund') return { refund_cents: 0, held: 'unverified_to_person' };
  if (r.overcharge_cents > policy.max_cents) return { refund_cents: 0, held: 'over_limit' };
  if (autoRefunds30d >= policy.max_per_rider_30d) return { refund_cents: 0, held: 'too_many' };
  return { refund_cents: r.overcharge_cents, reason: r.verdict === 'unverified' ? 'Fare review: route change charge could not be checked' : 'Fare review: route change charge not supported by the GPS track' };
}

/** `{first_name}`, `{trip_ref}`, `{ticket_ref}`, `{name}` in a canned reply. Unknown placeholders are left as typed. */
export function fillPlaceholders(body: string, v: { name?: string | null; trip_ref?: string | null; ticket_ref?: string | null }) {
  const first = (v.name ?? '').trim().split(/\s+/)[0] || 'there';
  const map: Record<string, string> = { first_name: first, name: (v.name ?? '').trim() || 'there', trip_ref: v.trip_ref ?? 'your trip', ticket_ref: v.ticket_ref ?? 'your message' };
  return body.replace(/\{(\w+)\}/g, (m, k) => map[k] ?? m);
}

export const LOST_STATUSES = ['reported', 'found', 'not_found', 'collect', 'return_booked', 'returned', 'closed'] as const;
export type LostStatus = typeof LOST_STATUSES[number];
export const LOST_OPEN: LostStatus[] = ['reported', 'found', 'collect', 'return_booked'];
export const LOST_LABEL: Record<LostStatus, string> = {
  reported: 'Asked the driver', found: 'Driver has it', not_found: 'Not found in the car', collect: 'Pickup arranged',
  return_booked: 'Courier booked', returned: 'Returned', closed: 'Closed',
};

const dollars = (c: number) => `$${(c / 100).toFixed(2)}`;
