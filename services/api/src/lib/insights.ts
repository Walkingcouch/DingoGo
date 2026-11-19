/**
 * Round 27: owner insights — pure rules (no database), so they are easy to test and reuse.
 *  - the insights policy (running costs, card fee, utilisation, seasonality calendar, taxi tariff, weekly email) and its checks
 *  - the Alice Springs taxi tariff (NT Government Gazette S53, from 1 July 2026)
 *  - unit economics of one trip (where the rider's dollar goes)
 *  - seasonality factors, the demand forecast and drivers needed per hour
 *  - the pricing simulator and the rider cohort table
 * Money in cents. Days are Darwin calendar days 'YYYY-MM-DD'; weekdays 0 = Monday … 6 = Sunday; hours 0–23 Darwin time.
 */
import { z } from 'zod';
import { isoDay } from './validate.js';
import { bad } from './errors.js';
import { quoteFare, localHour, type FareRule } from './fares.js';

const day = isoDay('Use a real date as YYYY-MM-DD');
const factor = z.number().min(0.2).max(3);
const cents = (max: number) => z.number().int().min(0).max(max);

export const POLICY_SCHEMA = z.object({
  /** Fuel or charging, tyres and servicing per km (not depreciation, insurance or rego): what a km costs a driver to drive. */
  running_cost_cents_per_km: z.object({
    electric: cents(200), plug_in_hybrid: cents(200), hybrid: cents(200), petrol: cents(200), diesel: cents(200), other: cents(200),
  }).strict(),
  /** Card processing (Stripe standard domestic cards): percent plus a fixed amount per charge. */
  card_fee: z.object({ pct: z.number().min(0).max(10), fixed_cents: cents(200) }).strict(),
  /** Share of an online hour a driver should spend on trips (pickup + trip) before more drivers are needed. */
  target_utilisation_pct: z.number().int().min(20).max(95),
  /** Drivers to keep online during service hours even when the forecast is quiet. */
  min_drivers_online: z.number().int().min(0).max(50),
  service_hours: z.object({ from: z.number().int().min(0).max(23), to: z.number().int().min(1).max(24) }).strict()
    .refine((v) => v.to > v.from, 'Service hours must end after they start'),
  /** Used when a trip has no recorded drive to the pickup. */
  default_pickup_km: z.number().min(0).max(30),
  seasonality: z.object({
    tourist_season: z.object({ months: z.array(z.number().int().min(1).max(12)).max(12), factor }).strict(),
    school_holidays: z.object({ factor, ranges: z.array(z.object({ name: z.string().trim().min(1).max(80), from: day, to: day, confirmed: z.boolean().default(false) }).strict()).max(20) }).strict(),
    public_holiday_factor: factor,
    events: z.array(z.object({
      name: z.string().trim().min(1).max(80), from: day, to: day, factor,
      /** Only these Darwin hours (from inclusive, to exclusive); omit for the whole day. */
      hours: z.object({ from: z.number().int().min(0).max(23), to: z.number().int().min(1).max(24) }).strict().nullable().default(null),
      confirmed: z.boolean().default(false),
    }).strict()).max(40),
  }).strict(),
  taxi_tariff: z.object({
    source: z.string().trim().min(1).max(160),
    day: z.object({ flagfall_cents: cents(5000), per_km_cents: cents(2000) }).strict(),
    night: z.object({ flagfall_cents: cents(5000), per_km_cents: cents(2000) }).strict(),
    /** Tariff 1 (day) applies Monday to Friday from `day_from_hour` to before `day_to_hour`, not on public holidays. */
    day_from_hour: z.number().int().min(0).max(23), day_to_hour: z.number().int().min(1).max(24),
  }).strict(),
  weekly_email: z.object({
    enabled: z.boolean(), recipients: z.array(z.string().trim().email().max(120)).max(10),
    /** Darwin hour on Monday from which last week's summary goes out. */
    hour: z.number().int().min(0).max(23),
  }).strict(),
}).strict();

export type InsightsPolicy = z.infer<typeof POLICY_SCHEMA>;

/** Defaults. Event and school-holiday dates are starting points for the owners to confirm (`confirmed: false` shows "check the date"). */
export const INSIGHTS_DEFAULTS: InsightsPolicy = {
  running_cost_cents_per_km: { electric: 8, plug_in_hybrid: 11, hybrid: 14, petrol: 20, diesel: 19, other: 20 },
  card_fee: { pct: 1.75, fixed_cents: 30 },
  target_utilisation_pct: 60,
  min_drivers_online: 2,
  service_hours: { from: 6, to: 24 },
  default_pickup_km: 1.5,
  seasonality: {
    tourist_season: { months: [4, 5, 6, 7, 8, 9], factor: 1.15 },
    school_holidays: {
      factor: 1.05,
      ranges: [
        { name: 'Summer school holidays', from: '2026-12-18', to: '2027-01-27', confirmed: false },
        { name: 'Term 1 break', from: '2027-04-10', to: '2027-04-18', confirmed: false },
        { name: 'Term 2 break', from: '2027-06-26', to: '2027-07-19', confirmed: false },
        { name: 'Term 3 break', from: '2027-09-25', to: '2027-10-10', confirmed: false },
      ],
    },
    public_holiday_factor: 1.1,
    events: [
      { name: 'New Year’s Eve', from: '2026-12-31', to: '2026-12-31', factor: 1.8, hours: { from: 18, to: 24 }, confirmed: true },
      { name: 'Parrtjima — A Festival in Light', from: '2027-04-02', to: '2027-04-11', factor: 1.25, hours: { from: 17, to: 24 }, confirmed: false },
      { name: 'Finke Desert Race', from: '2027-06-11', to: '2027-06-14', factor: 1.4, hours: null, confirmed: false },
      { name: 'Alice Springs Show', from: '2027-07-02', to: '2027-07-03', factor: 1.3, hours: null, confirmed: false },
      { name: 'Henley-on-Todd Regatta', from: '2027-08-21', to: '2027-08-21', factor: 1.3, hours: null, confirmed: false },
    ],
  },
  taxi_tariff: {
    source: 'NT Government Gazette S53, from 1 July 2026',
    day: { flagfall_cents: 550, per_km_cents: 245 },
    night: { flagfall_cents: 680, per_km_cents: 289 },
    day_from_hour: 6, day_to_hour: 18,
  },
  weekly_email: { enabled: false, recipients: [], hour: 7 },
};

/** Stored policy merged over the defaults (one level deep), read leniently: a bad stored value falls back to the defaults. */
export function policyOf(stored: unknown): InsightsPolicy {
  const d = structuredClone(INSIGHTS_DEFAULTS);
  if (!stored || typeof stored !== 'object') return d;
  const merged: any = { ...d };
  for (const [k, v] of Object.entries(stored as Record<string, unknown>)) {
    if (!(k in d)) continue;
    merged[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof (d as any)[k] === 'object' ? { ...(d as any)[k], ...v } : v;
  }
  const r = POLICY_SCHEMA.safeParse(merged);
  return r.success ? r.data : d;
}

/** Admin save: the full policy, checked (400 `invalid_insights_policy` with the first problem). */
export function checkPolicy(input: unknown): InsightsPolicy {
  const merged: any = { ...structuredClone(INSIGHTS_DEFAULTS) };
  if (input && typeof input === 'object') {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      merged[k] = v && typeof v === 'object' && !Array.isArray(v) && typeof (INSIGHTS_DEFAULTS as any)[k] === 'object' ? { ...(INSIGHTS_DEFAULTS as any)[k], ...v } : v;
    }
  }
  const r = POLICY_SCHEMA.safeParse(merged);
  if (!r.success) {
    const i = r.error.issues[0];
    throw bad('invalid_insights_policy', `${i.path.join('.') || 'policy'}: ${i.message}`);
  }
  const p = r.data;
  for (const x of [...p.seasonality.school_holidays.ranges, ...p.seasonality.events]) {
    if (x.to < x.from) throw bad('invalid_insights_policy', `${x.name}: the end date is before the start`);
  }
  for (const e of p.seasonality.events) if (e.hours && e.hours.to <= e.hours.from) throw bad('invalid_insights_policy', `${e.name}: hours must end after they start`);
  if (p.taxi_tariff.day_to_hour <= p.taxi_tariff.day_from_hour) throw bad('invalid_insights_policy', 'taxi_tariff: day hours must end after they start');
  if (p.weekly_email.enabled && !p.weekly_email.recipients.length) throw bad('invalid_insights_policy', 'weekly_email: add at least one email address');
  p.seasonality.tourist_season.months = [...new Set(p.seasonality.tourist_season.months)].sort((a, b) => a - b);
  p.weekly_email.recipients = [...new Set(p.weekly_email.recipients.map((e) => e.toLowerCase()))];
  return p;
}

// ───────────── Dates (Darwin) ─────────────
export const darwinDay = (at: Date) => new Date(at.getTime() + 9.5 * 3600e3).toISOString().slice(0, 10);
export const addDays = (d: string, n: number) => new Date(Date.parse(d + 'T00:00:00Z') + n * 864e5).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
/** 0 = Monday … 6 = Sunday. */
export const weekdayOf = (d: string) => (new Date(d + 'T00:00:00Z').getUTCDay() + 6) % 7;
export const WEEKDAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
/** Monday of the Darwin week containing `d`. */
export const mondayOf = (d: string) => addDays(d, -weekdayOf(d));
/** A Darwin wall-clock time as an instant. */
export const darwinInstant = (d: string, hour = 0, min = 0) => new Date(Date.parse(`${d}T00:00:00Z`) + (hour * 60 + min) * 60e3 - 9.5 * 3600e3);

// ───────────── Taxi tariff ─────────────
export type Tariff = InsightsPolicy['taxi_tariff'];
/** Which taxi tariff applies at a moment: day (tariff 1) on weekdays inside the day hours unless a public holiday; otherwise night/weekend. */
export function taxiTariffAt(at: Date, holiday: boolean, t: Tariff): 'day' | 'night' {
  const d = darwinDay(at);
  const h = localHour(at);
  return !holiday && weekdayOf(d) < 5 && h >= t.day_from_hour && h < t.day_to_hour ? 'day' : 'night';
}
/** Metered taxi fare for a distance (flagfall + per km, to the 10c the meter counts in), before waiting time and card surcharge. */
export function taxiFare(km: number, at: Date, holiday: boolean, t: Tariff) {
  const tariff = taxiTariffAt(at, holiday, t);
  const r = t[tariff];
  return { tariff, cents: Math.round((r.flagfall_cents + r.per_km_cents * Math.max(0, km)) / 10) * 10 };
}

// ───────────── Unit economics of one trip ─────────────
export interface TripMoneyIn {
  status: string; payment_method: string; final_cents: number | null; tip_cents: number; cancel_fee_cents: number;
  fare_breakdown: { lines?: { label: string; cents: number }[]; levy_cents?: number; booking_fee_cents?: number; guide_fee_cents?: number } | null;
}
export type DiscountKind = 'promo' | 'points' | 'pass' | 'business' | 'concession';
/** Which DingoGo-funded discount a fare line is (negative lines only). */
export function discountKind(label: string): DiscountKind {
  if (label.startsWith('Promo')) return 'promo';
  if (label.startsWith('Dingo Points')) return 'points';
  if (label.startsWith('DingoGo Pass') || label.startsWith('Free delivery')) return 'pass';
  if (label.startsWith('Business account')) return 'business';
  return 'concession';
}
export const DISCOUNT_LABEL: Record<DiscountKind, string> = { promo: 'Promo codes', points: 'Dingo Points redeemed', pass: 'DingoGo Pass', business: 'Business account discount', concession: 'Concessions' };
export const cardFee = (amount: number, p: InsightsPolicy['card_fee']) => (amount > 0 ? Math.round((amount * p.pct) / 100) + p.fixed_cents : 0);

/**
 * Where the rider's money went. `ledger` is the driver ledger for the trip (fare, commission, pickup pay, fuel surcharge, cancel fee,
 * tip). DingoGo keeps what the rider paid less the levy (to government), the guide fee (to the guide) and the driver's pay; that
 * amount is explained by the service fee and booking fee less the discounts DingoGo funded (drivers earn on the undiscounted fare)
 * and 5c rounding. GST is estimated as 1/11 of what DingoGo keeps (its own taxable supplies); card fees are an estimate from the policy.
 */
export function unitEconomics(t: TripMoneyIn, ledger: { kind: string; amount_cents: number }[], opts: { policy: InsightsPolicy; pointsIssued?: number; refundsCents?: number }) {
  const fb = t.fare_breakdown ?? {};
  const completed = t.status === 'completed';
  const sum = (k: string) => ledger.filter((l) => l.kind === k).reduce((s, l) => s + Number(l.amount_cents), 0);
  const riderPaid = (completed ? Number(t.final_cents ?? 0) : 0) + Number(t.cancel_fee_cents ?? 0);
  const levy = completed ? Number(fb.levy_cents ?? 0) : 0;
  const guide = completed ? Number(fb.guide_fee_cents ?? 0) : 0;
  const fare = sum('fare'), fee = -sum('commission'), pickup = sum('pickup_pay'), fuel = sum('fuel_surcharge'), cancelShare = sum('cancel_fee');
  const driverPay = fare - fee + pickup + fuel + cancelShare;
  const tip = Number(t.tip_cents ?? 0);
  const booking = completed ? Number(fb.booking_fee_cents ?? 0) : 0;
  const discounts: Record<DiscountKind, number> = { promo: 0, points: 0, pass: 0, business: 0, concession: 0 };
  if (completed) for (const l of fb.lines ?? []) if (Number(l.cents) < 0) discounts[discountKind(l.label)] += -Number(l.cents);
  const discountTotal = Object.values(discounts).reduce((s, n) => s + n, 0);
  const kept = riderPaid - levy - guide - driverPay;
  const cancelKept = completed ? 0 : Number(t.cancel_fee_cents ?? 0) - cancelShare;
  const rounding = kept - (fee + booking + cancelKept - discountTotal);
  const gst = Math.round(Math.max(0, kept) / 11);
  const card = t.payment_method === 'card' ? cardFee(riderPaid, opts.policy.card_fee) + cardFee(tip, opts.policy.card_fee) : 0;
  const refunds = Math.max(0, opts.refundsCents ?? 0);
  const net = kept - gst - card - refunds;
  return {
    rider_paid_cents: riderPaid, tip_cents: tip,
    levy_cents: levy, guide_fee_cents: guide,
    driver: { fare_cents: fare, service_fee_cents: fee, pickup_pay_cents: pickup, fuel_surcharge_cents: fuel, cancel_fee_cents: cancelShare, pay_cents: driverPay },
    dingogo: {
      service_fee_cents: fee, booking_fee_cents: booking, cancel_fee_cents: cancelKept, discounts, discounts_cents: discountTotal, other_cents: rounding,
      kept_cents: kept, gst_cents: gst, card_fees_cents: card, refunds_cents: refunds, net_cents: net,
    },
    points_issued: opts.pointsIssued ?? 0, points_issued_cents: opts.pointsIssued ?? 0, // 100 points = $1
    take_rate_pct: riderPaid - levy - guide > 0 ? round1((kept / (riderPaid - levy - guide)) * 100) : null,
  };
}

export const round1 = (n: number) => Math.round(n * 10) / 10;
export const pct = (a: number, b: number) => (b > 0 ? round1((a / b) * 100) : null);
/** Change from `before` to `now` in percent (null when there was nothing before). */
export const change = (now: number | null, before: number | null) => (now == null || before == null || before === 0 ? null : round1(((now - before) / Math.abs(before)) * 100));

// ───────────── Seasonality and forecast ─────────────
export interface DayFactor { factor: number; reasons: string[] }
/** Expected demand relative to an ordinary day at that hour: tourist season × school holidays × public holiday × events. */
export function factorFor(d: string, hour: number, p: InsightsPolicy, holidays: Map<string, string> | Set<string>): DayFactor {
  const s = p.seasonality;
  let f = 1; const reasons: string[] = [];
  const month = Number(d.slice(5, 7));
  if (s.tourist_season.months.includes(month) && s.tourist_season.factor !== 1) { f *= s.tourist_season.factor; reasons.push('Tourist season'); }
  const sh = s.school_holidays.ranges.find((r) => d >= r.from && d <= r.to);
  if (sh && s.school_holidays.factor !== 1) { f *= s.school_holidays.factor; reasons.push(sh.name); }
  if (holidays.has(d) && s.public_holiday_factor !== 1) {
    f *= s.public_holiday_factor;
    reasons.push(holidays instanceof Map ? holidays.get(d) ?? 'Public holiday' : 'Public holiday');
  }
  for (const e of s.events) {
    if (d < e.from || d > e.to) continue;
    if (e.hours && (hour < e.hours.from || hour >= e.hours.to)) continue;
    f *= e.factor; reasons.push(e.name);
  }
  return { factor: Math.round(f * 1000) / 1000, reasons };
}

/** Drivers needed for a forecast hour: enough driving time at the target utilisation, never below the minimum during service hours. */
export function driversNeeded(trips: number, minutesPerTrip: number, hour: number, p: InsightsPolicy) {
  const inService = hour >= p.service_hours.from && hour < p.service_hours.to;
  const work = trips > 0 ? Math.ceil(((trips * minutesPerTrip) / 60 / (p.target_utilisation_pct / 100)) - 1e-9) : 0;
  return Math.max(inService ? p.min_drivers_online : 0, work);
}

export interface ForecastInput {
  /** Requests per Darwin day and hour (zero hours may be left out). */
  history: { day: string; hour: number; n: number }[];
  /** Inclusive range the history covers (whole weeks work best). */
  historyFrom: string; historyTo: string;
  start: string; days: number;
  policy: InsightsPolicy; holidays: Map<string, string> | Set<string>;
  /** Accept → end of trip, in minutes (pickup drive and the trip itself). */
  minutesPerTrip: number;
  /** Drivers usually online, [weekday][hour]. */
  usualOnline?: number[][];
}

export interface ForecastHour { hour: number; trips: number; factor: number; drivers_needed: number; usual_online: number | null; gap: number | null; booked?: number }
export interface ForecastDay {
  date: string; weekday: string; trips: number; reasons: string[]; peak_hour: number; peak_trips: number; peak_drivers: number; short_hours: number; hours: ForecastHour[];
}

/**
 * Demand forecast: an hour-of-week baseline from the history with each past day's seasonality taken out first and recent weeks
 * weighted more (0.85 per week of age), a gentle trend (last 4 weeks against the 4 before, capped at ±5% a week), then each future
 * hour's seasonality put back. Drivers needed per hour and the gap against drivers usually online.
 */
export function forecast(inp: ForecastInput) {
  const p = inp.policy;
  const counts = new Map<string, number>();
  for (const r of inp.history) counts.set(`${r.day}|${r.hour}`, (counts.get(`${r.day}|${r.hour}`) ?? 0) + Number(r.n));
  const num = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const den = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const span = Math.max(0, daysBetween(inp.historyFrom, inp.historyTo)) + 1;
  let recent = 0, prior = 0;
  for (let i = 0; i < span; i++) {
    const d = addDays(inp.historyFrom, i);
    const age = Math.floor(daysBetween(d, inp.historyTo) / 7);
    const w = Math.pow(0.85, age);
    const wd = weekdayOf(d);
    for (let h = 0; h < 24; h++) {
      const n = counts.get(`${d}|${h}`) ?? 0;
      const adj = n / factorFor(d, h, p, inp.holidays).factor;
      num[wd][h] += w * adj; den[wd][h] += w;
      const back = daysBetween(d, inp.historyTo);
      if (back < 28) recent += adj; else if (back < 56) prior += adj;
    }
  }
  const baseline = num.map((row, wd) => row.map((v, h) => (den[wd][h] > 0 ? v / den[wd][h] : 0)));
  const weekly = recent > 20 && prior > 20 ? Math.min(1.05, Math.max(0.95, Math.pow(recent / prior, 1 / 4))) : 1;
  const days: ForecastDay[] = [];
  for (let k = 0; k < inp.days; k++) {
    const d = addDays(inp.start, k);
    const wd = weekdayOf(d);
    const trend = Math.pow(weekly, (daysBetween(inp.historyTo, d)) / 7);
    const hours: ForecastHour[] = [];
    const reasons = new Set<string>();
    for (let h = 0; h < 24; h++) {
      const f = factorFor(d, h, p, inp.holidays);
      f.reasons.forEach((r) => reasons.add(r));
      const trips = baseline[wd][h] * f.factor * trend;
      const need = driversNeeded(trips, inp.minutesPerTrip, h, p);
      const usual = inp.usualOnline?.[wd]?.[h] ?? null;
      hours.push({ hour: h, trips: round1(trips), factor: f.factor, drivers_needed: need, usual_online: usual == null ? null : round1(usual), gap: usual == null ? null : round1(need - usual) });
    }
    const total = hours.reduce((s, x) => s + x.trips, 0);
    const peak = hours.reduce((a, b) => (b.trips > a.trips ? b : a), hours[0]);
    const short = hours.filter((x) => x.gap != null && x.gap >= 1);
    days.push({
      date: d, weekday: WEEKDAYS[wd], trips: round1(total), reasons: [...reasons],
      peak_hour: peak.hour, peak_trips: peak.trips, peak_drivers: Math.max(...hours.map((x) => x.drivers_needed)),
      short_hours: short.length, hours,
    });
  }
  return { weekly_trend: Math.round(weekly * 1000) / 1000, minutes_per_trip: round1(inp.minutesPerTrip), days };
}

// ───────────── Pricing simulator ─────────────
export interface SimTrip { distance_m: number; duration_s: number; at: Date; holiday: boolean }
export interface SimInput {
  rule: FareRule; proposed: FareRule; feePct: number; proposedFeePct: number; tariff: Tariff;
  trips: SimTrip[]; elasticity: number; minutesPerTrip: number;
}

function priceOne(rule: FareRule, feePct: number, t: SimTrip) {
  const q = quoteFare(rule, { distance_m: t.distance_m, duration_s: t.duration_s, at: t.at, isHoliday: t.holiday });
  const driver = q.trip_cents - Math.round((q.trip_cents * feePct) / 100);
  return { fare: q.total_cents, driver, take: q.total_cents - driver - q.levy_cents, trip: q.trip_cents };
}

/** Replays recent trips (list prices: no promos, demand multiplier or long-pickup charge) at today's and the proposed rates. */
export function simulate(s: SimInput) {
  const agg = (rule: FareRule, fee: number) => {
    let fare = 0, driver = 0, take = 0, under = 0;
    for (const t of s.trips) {
      const r = priceOne(rule, fee, t);
      fare += r.fare; driver += r.driver; take += r.take;
      if (r.fare < taxiFare(t.distance_m / 1000, t.at, t.holiday, s.tariff).cents) under++;
    }
    const n = s.trips.length;
    const perHour = n && s.minutesPerTrip > 0 ? Math.round((driver / n) * (60 / s.minutesPerTrip)) : null;
    return {
      trips: n, fare_cents: fare, driver_pay_cents: driver, take_cents: take,
      avg_fare_cents: n ? Math.round(fare / n) : null, avg_driver_pay_cents: n ? Math.round(driver / n) : null, avg_take_cents: n ? Math.round(take / n) : null,
      under_taxi_pct: pct(under, n), driver_pay_per_engaged_hour_cents: perHour,
    };
  };
  const now = agg(s.rule, s.feePct);
  const prop = agg(s.proposed, s.proposedFeePct);
  // Volume response to the average price change (elasticity 0 = no change, −0.3 = 10% dearer → about 3% fewer trips).
  const ratio = now.avg_fare_cents && prop.avg_fare_cents ? prop.avg_fare_cents / now.avg_fare_cents : 1;
  const volume = s.elasticity !== 0 ? Math.pow(ratio, s.elasticity) : 1;
  const est = {
    trips: Math.round(prop.trips * volume), volume_factor: Math.round(volume * 1000) / 1000,
    fare_cents: Math.round(prop.fare_cents * volume), driver_pay_cents: Math.round(prop.driver_pay_cents * volume), take_cents: Math.round(prop.take_cents * volume),
  };
  // Standard trips around town, on a weekday at midday and a Friday night (dates are only used for the tariff and surcharges).
  const noon = darwinInstant('2026-11-18', 12), friNight = darwinInstant('2026-11-20', 23);
  const EX = [
    { name: 'Short hop in town (3 km)', km: 3, min: 7 }, { name: 'Town to the hospital (5 km)', km: 5, min: 10 },
    { name: 'Suburbs to town (8 km)', km: 8, min: 13 }, { name: 'Town to the airport (15 km)', km: 15, min: 16 },
  ];
  const SLOTS: [string, Date][] = [['Weekday midday', noon], ['Friday 11pm', friNight]];
  const examples = EX.flatMap((e) => SLOTS.map(([when, at]) => {
    const t: SimTrip = { distance_m: e.km * 1000, duration_s: e.min * 60, at, holiday: false };
    const a = priceOne(s.rule, s.feePct, t), b = priceOne(s.proposed, s.proposedFeePct, t);
    const taxi = taxiFare(e.km, at, false, s.tariff);
    return { name: e.name, when, km: e.km, min: e.min, now_cents: a.fare, proposed_cents: b.fare, taxi_cents: taxi.cents, taxi_tariff: taxi.tariff,
      driver_now_cents: a.driver, driver_proposed_cents: b.driver, take_now_cents: a.take, take_proposed_cents: b.take };
  }));
  return {
    now, proposed: prop, estimate: est, elasticity: s.elasticity,
    change: { avg_fare_pct: change(prop.avg_fare_cents, now.avg_fare_cents), driver_pay_pct: change(prop.driver_pay_cents, now.driver_pay_cents), take_pct: change(est.take_cents, now.take_cents) },
    examples,
  };
}

// ───────────── Cohorts ─────────────
/** Months after `from` ('YYYY-MM'). */
export const monthDiff = (from: string, to: string) => (Number(to.slice(0, 4)) - Number(from.slice(0, 4))) * 12 + Number(to.slice(5, 7)) - Number(from.slice(5, 7));
export const addMonths = (m: string, n: number) => { const t = Number(m.slice(0, 4)) * 12 + Number(m.slice(5, 7)) - 1 + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, '0')}`; };

/**
 * Monthly cohort retention: riders grouped by the month of their first completed trip; for each later month, the share who took
 * at least one trip. `rows` = { cohort, month, riders } (riders of `cohort` active in `month`). Months after `current` are null.
 */
export function cohortTable(rows: { cohort: string; month: string; riders: number }[], current: string, months = 6) {
  const by = new Map<string, Map<number, number>>();
  for (const r of rows) {
    const k = monthDiff(r.cohort, r.month);
    if (k < 0) continue;
    if (!by.has(r.cohort)) by.set(r.cohort, new Map());
    by.get(r.cohort)!.set(k, (by.get(r.cohort)!.get(k) ?? 0) + Number(r.riders));
  }
  return [...by.keys()].sort().map((cohort) => {
    const m = by.get(cohort)!;
    const size = m.get(0) ?? 0;
    const retained = Array.from({ length: months + 1 }, (_, k) => (monthDiff(cohort, current) < k ? null : pct(m.get(k) ?? 0, size)));
    return { cohort, riders: size, retained };
  });
}
