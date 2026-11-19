/**
 * Round 28: remote and regional reach. Pure rules (no database): community routes ("corridors") from Alice Springs with fixed
 * prices, pickup points, permit notes, mobile coverage gaps, fuel and charging notes and a check-in schedule; matching a trip to a
 * corridor; the most a metered town fare may travel; shuttle seat and parcel prices; the EV range a long trip needs; SMS keyword
 * parsing for people booking by text; community store top-up limits; and the tiny low-data booking page.
 *
 * Permits: a lot of Central Australia is Aboriginal land. Whether a visitor, driver or passenger needs a permit depends on where
 * they go and why (the Central Land Council issues them; people going home, and travel on some public roads, may not need one).
 * DingoGo doesn't decide that: the notes below say where a permit *may* be needed and point to the CLC. Check with the owners and
 * the communities before going live; coverage gaps and distances are approximate and marked unconfirmed.
 */
import { bad } from './errors.js';
import { haversine, type LatLng } from './geo.js';
import { z } from './validate.js';
import { darwinParts, darwinTime, addDays } from './tours.js';

// ───────────────────────── Policy ─────────────────────────
const point = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/), name: z.string().min(2).max(80),
  side: z.enum(['town', 'community']), lat: z.number().min(-45).max(-10), lng: z.number().min(110).max(155),
  /** A community store partner that holds parcels for collection (partner portal). */
  partner_id: z.string().uuid().nullable().default(null),
  parcels: z.boolean().default(false), note: z.string().max(200).nullable().default(null),
});
const gap = z.object({ from_km: z.number().min(0).max(2000), to_km: z.number().min(0).max(2000), note: z.string().max(200) })
  .refine((g) => g.to_km > g.from_km, 'A coverage gap ends after it starts');
const corridor = z.object({
  id: z.string().regex(/^[a-z0-9-]{2,40}$/),
  name: z.string().min(2).max(80),
  /** The community end. The town end is the zone the trip starts or ends in (Alice Springs). */
  place: z.object({ name: z.string().min(2).max(80), alt_names: z.array(z.string().min(2).max(60)).max(6).default([]),
    lat: z.number().min(-45).max(-10), lng: z.number().min(110).max(155) }),
  /** Drop-offs and pickups within this distance of the place count as the community end. */
  radius_km: z.number().min(1).max(40).default(8),
  road_km: z.number().min(20).max(2000), minutes: z.number().int().min(15).max(900),
  unsealed_km: z.number().min(0).max(2000).default(0),
  active: z.boolean().default(true),
  /** Private car, one way (the price covers the drive back empty). */
  private_cents: z.number().int().min(1000).max(500000),
  /** Booking the trip back at the same time: the return leg costs this much less. */
  return_discount_pct: z.number().min(0).max(60).default(0),
  seat_cents: z.number().int().min(0).max(100000),
  parcel_cents: z.object({ S: z.number().int().min(0).max(50000), M: z.number().int().min(0).max(50000), L: z.number().int().min(0).max(50000) }),
  /** Shuttle days (0 = Sunday) and departure times, Darwin time. */
  shuttle_days: z.array(z.number().int().min(0).max(6)).max(7).default([]),
  depart_out: z.string().regex(/^\d{2}:\d{2}$/).default('07:30'),
  depart_back: z.string().regex(/^\d{2}:\d{2}$/).default('14:00'),
  shuttle_seats: z.number().int().min(1).max(12).default(4),
  parcel_capacity: z.number().int().min(0).max(40).default(6),
  /** The shuttle driver is paid, per leg, the larger of this and run_share_pct of the seats and parcels carried (driver ledger). */
  run_pay_cents: z.number().int().min(0).max(300000).default(0),
  run_share_pct: z.number().min(0).max(100).default(75),
  pickup_points: z.array(point).max(12).default([]),
  permit_note: z.string().max(400).nullable().default(null),
  coverage_gaps: z.array(gap).max(10).default([]),
  fuel_note: z.string().max(300).nullable().default(null),
  /** EVs can charge at the community end, so the range check doesn't add the drive home. */
  charging_at_destination: z.boolean().default(false),
  /** Distances, gaps and notes checked with the community / on the road. */
  confirmed: z.boolean().default(false),
});
export type Corridor = z.infer<typeof corridor>;
export type PickupPoint = z.infer<typeof point>;

export const regionalPolicySchema = z.object({
  /** Metered town fares only go this far (straight line from the zone centre). Further: a community route, or call us. */
  max_metered_km: z.number().min(25).max(300).default(60),
  /** Long trips booked online need this much notice (phone bookings any time). */
  min_notice_hours: z.number().min(0).max(72).default(2),
  /** Drivers on a long trip check in this often (tap "Check in"; any location ping counts too). */
  checkin_every_min: z.number().int().min(15).max(180).default(45),
  /** A long trip not finished this long after its expected arrival raises an alert. */
  overdue_after_min: z.number().int().min(15).max(240).default(45),
  /** Seats asked for by text or the low-data page are held this long for the "YES". */
  pending_hold_min: z.number().int().min(5).max(120).default(30),
  /** Seats and parcels can be booked (and cancelled with a refund) until this long before departure. */
  cutoff_min: z.number().int().min(0).max(1440).default(60),
  max_seats_per_booking: z.number().int().min(1).max(8).default(4),
  topups: z.object({
    min_cents: z.number().int().min(100).max(10000).default(500),
    max_cents: z.number().int().min(500).max(100000).default(20000),
    per_rider_day_cents: z.number().int().min(500).max(200000).default(30000),
    per_store_day_cents: z.number().int().min(1000).max(1000000).default(200000),
    void_min: z.number().int().min(0).max(120).default(15),
  }).default({ min_cents: 500, max_cents: 20000, per_rider_day_cents: 30000, per_store_day_cents: 200000, void_min: 15 }),
  corridors: z.array(corridor).max(20),
});
export type RegionalPolicy = z.infer<typeof regionalPolicySchema>;

const CLC = 'Central Land Council (clc.org.au)';
export const DEFAULT_REGIONAL_POLICY: RegionalPolicy = regionalPolicySchema.parse({
  corridors: [
    {
      id: 'ntaria', name: 'Alice Springs - Ntaria (Hermannsburg)',
      place: { name: 'Ntaria (Hermannsburg)', alt_names: ['Ntaria', 'Hermannsburg'], lat: -23.9425, lng: 132.7780 },
      road_km: 128, minutes: 95, private_cents: 26000, return_discount_pct: 30, seat_cents: 4000, parcel_cents: { S: 1500, M: 2500, L: 4000 },
      shuttle_days: [2, 5], depart_out: '07:30', depart_back: '14:00', run_pay_cents: 15000,
      pickup_points: [
        { id: 'alice-todd-mall', name: 'Todd Mall (Parsons St end)', side: 'town', lat: -23.6984, lng: 133.8822 },
        { id: 'alice-hospital', name: 'Alice Springs Hospital, main entrance', side: 'town', lat: -23.7076, lng: 133.8770 },
        { id: 'ntaria-store', name: 'Ntaria community store', side: 'community', lat: -23.9422, lng: 132.7776, parcels: true },
        { id: 'ntaria-clinic', name: 'Ntaria clinic', side: 'community', lat: -23.9431, lng: 132.7792 },
      ],
      permit_note: `Ntaria is on Aboriginal land. Going home or along the public road may not need a permit; visiting the community or going further (Palm Valley, Finke Gorge) may. Check with the ${CLC}.`,
      coverage_gaps: [{ from_km: 45, to_km: 115, note: 'Little or no mobile coverage on Larapinta Drive (approximate)' }],
      fuel_note: 'Fill up in Alice Springs. Fuel at Hermannsburg is not always open.',
    },
    {
      id: 'ltyentye-apurte', name: 'Alice Springs - Ltyentye Apurte (Santa Teresa)',
      place: { name: 'Ltyentye Apurte (Santa Teresa)', alt_names: ['Ltyentye Apurte', 'Santa Teresa'], lat: -24.1310, lng: 134.3730 },
      road_km: 82, minutes: 80, unsealed_km: 40, private_cents: 19000, return_discount_pct: 30, seat_cents: 3000, parcel_cents: { S: 1200, M: 2000, L: 3500 },
      shuttle_days: [1, 4], depart_out: '08:00', depart_back: '13:30', run_pay_cents: 11000,
      pickup_points: [
        { id: 'alice-todd-mall', name: 'Todd Mall (Parsons St end)', side: 'town', lat: -23.6984, lng: 133.8822 },
        { id: 'alice-hospital', name: 'Alice Springs Hospital, main entrance', side: 'town', lat: -23.7076, lng: 133.8770 },
        { id: 'santa-teresa-store', name: 'Ltyentye Apurte community store', side: 'community', lat: -24.1312, lng: 134.3728, parcels: true },
      ],
      permit_note: `Ltyentye Apurte is on Aboriginal land. Visitors usually need a permit unless invited; people going home don't. Check with the ${CLC} or the community.`,
      coverage_gaps: [{ from_km: 20, to_km: 75, note: 'No mobile coverage for most of Santa Teresa Road (approximate)' }],
      fuel_note: 'Part of the road is unsealed: check it is open after rain. Fill up in Alice Springs.',
    },
    {
      id: 'yulara', name: 'Alice Springs - Yulara (Ayers Rock Resort)', active: false,
      place: { name: 'Yulara', alt_names: ['Ayers Rock Resort', 'Uluru'], lat: -25.2406, lng: 130.9889 },
      radius_km: 15, road_km: 445, minutes: 290, private_cents: 95000, return_discount_pct: 20, seat_cents: 12000, parcel_cents: { S: 2500, M: 4000, L: 6000 },
      shuttle_days: [], depart_out: '07:00', depart_back: '13:00', run_pay_cents: 45000,
      pickup_points: [
        { id: 'alice-todd-mall', name: 'Todd Mall (Parsons St end)', side: 'town', lat: -23.6984, lng: 133.8822 },
        { id: 'yulara-town-square', name: 'Yulara town square', side: 'community', lat: -25.2410, lng: 130.9850 },
      ],
      permit_note: 'No land council permit for the highway or Yulara. Uluru-Kata Tjuta National Park needs a park pass; Aboriginal communities off the highway may need a permit.',
      coverage_gaps: [{ from_km: 90, to_km: 200, note: 'Patchy coverage on the Stuart Highway south of Alice (approximate)' },
        { from_km: 210, to_km: 420, note: 'Long stretches with no coverage on the Lasseter Highway (approximate)' }],
      fuel_note: 'Stop at Erldunda. Overnight rest before the drive back: 900 km in a day is over the fatigue limit.',
      charging_at_destination: true,
    },
  ],
});

export function checkRegionalPolicy(v: unknown): RegionalPolicy {
  const p = regionalPolicySchema.safeParse(v);
  if (!p.success) throw bad('invalid_policy', p.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  const ids = new Set<string>();
  for (const c of p.data.corridors) {
    if (ids.has(c.id)) throw bad('invalid_policy', `Two routes are called ${c.id}`);
    ids.add(c.id);
    const pts = new Set<string>();
    for (const pt of c.pickup_points) { if (pts.has(pt.id)) throw bad('invalid_policy', `${c.id}: two pickup points are called ${pt.id}`); pts.add(pt.id); }
    for (const g of c.coverage_gaps) if (g.to_km > c.road_km + 5) throw bad('invalid_policy', `${c.id}: a coverage gap goes past the end of the road`);
  }
  return p.data;
}
/** Stored policy read leniently: anything that doesn't pass the checks falls back to the defaults. */
export function readRegionalPolicy(v: unknown): RegionalPolicy {
  if (!v) return DEFAULT_REGIONAL_POLICY;
  try { return checkRegionalPolicy(v); } catch { return DEFAULT_REGIONAL_POLICY; }
}

// ───────────────────────── Matching a trip ─────────────────────────
export interface ZoneLike { centre_lat: number; centre_lng: number; radius_km: number }
export interface CorridorMatch { corridor: Corridor; direction: 'out' | 'back' }

/** A trip between a town zone and a community: out (town to community) or back. Inactive routes match only for staff. */
export function matchCorridor(policy: RegionalPolicy, pickup: LatLng, dropoff: LatLng, zones: ZoneLike[], opts: { staff?: boolean } = {}): CorridorMatch | null {
  const inTown = (p: LatLng) => zones.some((z) => haversine(p, { lat: z.centre_lat, lng: z.centre_lng }) <= z.radius_km * 1000);
  for (const c of policy.corridors) {
    if (!c.active && !opts.staff) continue;
    const near = (p: LatLng) => haversine(p, c.place) <= c.radius_km * 1000;
    if (near(dropoff) && inTown(pickup)) return { corridor: c, direction: 'out' };
    if (near(pickup) && inTown(dropoff)) return { corridor: c, direction: 'back' };
  }
  return null;
}

/** Straight-line km from the zone centre beyond which a metered town fare isn't offered. */
export function tooFarForMeter(policy: RegionalPolicy, zone: ZoneLike, dropoff: LatLng) {
  const km = haversine(dropoff, { lat: zone.centre_lat, lng: zone.centre_lng }) / 1000;
  return km > Math.max(policy.max_metered_km, zone.radius_km) ? Math.round(km) : 0;
}

/** What a long trip costs and what riders and drivers are told about it (kept on the trip as `fare_breakdown.regional`). */
export interface RegionalInfo {
  corridor: string; name: string; direction: 'out' | 'back'; place: string; road_km: number; minutes: number; unsealed_km: number;
  return_leg: boolean; pair_trip_id?: string | null; empty_return_km: number; charging_at_destination: boolean;
  permit_note: string | null; coverage_gaps: { from_km: number; to_km: number; note: string }[]; fuel_note: string | null;
  checkin_every_min: number; checkins: string[];
}
export function regionalInfo(m: CorridorMatch, policy: RegionalPolicy, returnLeg = false): RegionalInfo {
  const c = m.corridor;
  return {
    corridor: c.id, name: c.name, direction: m.direction, place: c.place.name, road_km: c.road_km, minutes: c.minutes, unsealed_km: c.unsealed_km,
    return_leg: returnLeg, empty_return_km: m.direction === 'out' && !returnLeg ? c.road_km : 0, charging_at_destination: c.charging_at_destination,
    permit_note: c.permit_note, coverage_gaps: c.coverage_gaps, fuel_note: c.fuel_note,
    checkin_every_min: policy.checkin_every_min, checkins: checkinPlan(c, m.direction, policy.checkin_every_min),
  };
}
export function fixedPriceFor(c: Corridor, returnLeg: boolean) {
  const cents = returnLeg ? c.private_cents * (1 - c.return_discount_pct / 100) : c.private_cents;
  return Math.round(cents / 5) * 5;
}
export function priceLabel(c: Corridor, direction: 'out' | 'back', returnLeg: boolean) {
  const route = direction === 'out' ? `Alice Springs to ${c.place.name}` : `${c.place.name} to Alice Springs`;
  return `Fixed price: ${route}${returnLeg && c.return_discount_pct > 0 ? ` (return trip, -${c.return_discount_pct}%)` : ''}`;
}

/** Where the driver checks in: leaving, before and after each coverage gap, and about every `every` minutes in between. */
export function checkinPlan(c: Corridor, direction: 'out' | 'back', every: number): string[] {
  const kmPerMin = c.road_km / c.minutes;
  const marks = new Set<number>([0]);
  for (let m = every; m < c.minutes; m += every) marks.add(Math.round(m * kmPerMin));
  const out: string[] = [];
  const gaps = c.coverage_gaps.map((g) => direction === 'out' ? g : { from_km: c.road_km - g.to_km, to_km: c.road_km - g.from_km, note: g.note });
  for (const g of gaps) { marks.add(Math.max(0, Math.round(g.from_km - 2))); marks.add(Math.min(c.road_km, Math.round(g.to_km + 2))); }
  const from = direction === 'out' ? 'Alice Springs' : c.place.name;
  const to = direction === 'out' ? c.place.name : 'Alice Springs';
  for (const km of [...marks].sort((a, b) => a - b)) {
    const g = gaps.find((x) => Math.abs(x.from_km - 2 - km) <= 1);
    const after = gaps.find((x) => Math.abs(x.to_km + 2 - km) <= 1);
    if (km === 0) out.push(`Leaving ${from}`);
    else if (g) out.push(`About ${km} km: before the no-coverage stretch (${Math.round(g.to_km - g.from_km)} km)`);
    else if (after) out.push(`About ${km} km: back in coverage`);
    else out.push(`About ${km} km`);
  }
  out.push(`Arrived at ${to}`);
  return out;
}

/** Minutes a car can be out of coverage on this route (the longest gap at the route's average speed). */
export function longestGapMin(c: { road_km: number; minutes: number; coverage_gaps: { from_km: number; to_km: number }[] }) {
  const g = Math.max(0, ...c.coverage_gaps.map((x) => x.to_km - x.from_km));
  return Math.round(g / (c.road_km / c.minutes));
}

/** Metres of battery range an EV needs: to the pickup, the trip, the drive back to town (unless it can charge there) and a reserve. */
export function rangeNeededM(o: { toPickupM: number; tripM: number; info: Pick<RegionalInfo, 'direction' | 'road_km' | 'charging_at_destination'>; reserveKm: number }) {
  const home = o.info.direction === 'out' && !o.info.charging_at_destination ? o.info.road_km * 1000 : 0;
  return o.toPickupM + o.tripM + home + o.reserveKm * 1000;
}

// ───────────────────────── Shuttles and parcels ─────────────────────────
/** Shuttle departures on a route's days, Darwin time, for the next `days` days from `fromDate` (both directions). */
export function shuttleTimes(c: Corridor, fromDate: string, days: number) {
  const out: { direction: 'out' | 'back'; departs_at: Date }[] = [];
  for (let i = 0; i < days; i++) {
    const date = addDays(fromDate, i);
    const wd = new Date(`${date}T12:00:00Z`).getUTCDay();
    if (!c.shuttle_days.includes(wd)) continue;
    out.push({ direction: 'out', departs_at: darwinTime(date, c.depart_out) });
    out.push({ direction: 'back', departs_at: darwinTime(date, c.depart_back) });
  }
  return out;
}
/** What the shuttle driver earns for one leg: the run pay, or their share of what was carried if that is more. */
export const runDriverPay = (c: Pick<Corridor, 'run_pay_cents' | 'run_share_pct'>, takingsCents: number) =>
  Math.max(c.run_pay_cents, Math.round(takingsCents * c.run_share_pct / 100));
export const seatPrice = (c: Corridor, seats: number) => c.seat_cents * seats;
export const parcelPrice = (c: Corridor, size: 'S' | 'M' | 'L') => c.parcel_cents[size];
export const runLabel = (c: Pick<Corridor, 'place'>, direction: 'out' | 'back') =>
  direction === 'out' ? `Alice Springs to ${c.place.name}` : `${c.place.name} to Alice Springs`;
/** "Fri 21 Nov 7:30am" in Darwin time (plain GSM text). */
export function whenText(d: Date | string) {
  const f = new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Darwin', weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true });
  return f.format(new Date(d)).replace(/,/g, '').replace(/\s?(am|pm)$/i, (x) => x.trim().toLowerCase()).replace(/ | /g, ' ');
}

// ───────────────────────── Booking by text ─────────────────────────
const WEEKDAYS: Record<string, number> = { sun: 0, sunday: 0, mon: 1, monday: 1, tue: 2, tues: 2, tuesday: 2, wed: 3, wednesday: 3,
  thu: 4, thur: 4, thurs: 4, thursday: 4, fri: 5, friday: 5, sat: 6, saturday: 6 };
const TOWN = ['alice', 'alice springs', 'town', 'mparntwe'];
export type SmsCommand =
  | { kind: 'book'; place: string; direction: 'out' | 'back'; day: number | 'today' | 'tomorrow' | null; seats: number }
  | { kind: 'yes' } | { kind: 'no' } | { kind: 'list' } | { kind: 'cancel'; ref: string | null } | { kind: 'balance' } | { kind: 'usage' };

const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();

/** Booking words in a text: "BUS NTARIA FRI 2", "BUS FROM SANTA TERESA THU", "YES", "NO", "MY BUS", "CANCEL SB-ABC123", "BAL".
 *  Returns null for anything else (so the text can go to a trip chat). */
export function parseSms(body: string): SmsCommand | null {
  const s = norm(body);
  if (!s) return null;
  if (/^(yes|y|yep|yeah|ok)$/.test(s)) return { kind: 'yes' };
  if (/^(no|n|nah)$/.test(s)) return { kind: 'no' };
  if (/^(my bus|my seats|bookings|my bookings|seats)$/.test(s)) return { kind: 'list' };
  if (/^(bal|balance|credit)$/.test(s)) return { kind: 'balance' };
  // A bare CANCEL is a carrier opt-out word (like STOP): it never reaches here, and isn't a booking word. CANCEL with a ref is.
  const cancel = /^cancel (sb [a-z0-9]{6}|sb[a-z0-9]{6}|[a-z0-9]{6})$/.exec(s);
  if (cancel) return { kind: 'cancel', ref: `SB-${cancel[1].replace(/^sb ?/, '').toUpperCase()}` };
  const m = /^(bus|shuttle|seat|seats|book)(?: (.*))?$/.exec(s);
  if (!m) return null;
  const words = (m[2] ?? '').split(' ').filter(Boolean);
  if (!words.length) return { kind: 'usage' };
  let day: number | 'today' | 'tomorrow' | null = null; let seats = 1;
  const rest: string[] = [];
  for (const w of words) {
    if (w in WEEKDAYS) day = WEEKDAYS[w];
    else if (w === 'today' || w === 'tomorrow') day = w;
    else if (/^\d{1,2}$/.test(w)) seats = Number(w);
    else if (w !== 'for' && w !== 'on' && w !== 'seat' && w !== 'seats' && w !== 'people') rest.push(w);
  }
  const text = rest.join(' ').replace(/^to /, '');
  const from = /(?:^| )from (.+?)(?: to (.+))?$/.exec(text);
  let place = text; let direction: 'out' | 'back' = 'out';
  if (from) {
    const origin = from[1].trim(); const dest = (from[2] ?? text.slice(0, from.index).trim()).trim();
    if (TOWN.includes(origin)) { place = dest; direction = 'out'; } else { place = origin; direction = 'back'; }
  } else if (TOWN.some((t) => text.startsWith(t + ' '))) {
    place = text.replace(new RegExp(`^(${TOWN.join('|')}) (to )?`), '');
  }
  place = place.replace(/ to$/, '').trim();
  if (!place || TOWN.includes(place)) return { kind: 'usage' };
  return { kind: 'book', place, direction, day, seats };
}

/** The route a place word means: name, other names or a word of them ("hermannsburg", "santa teresa", "ntaria"). */
export function findCorridor(policy: RegionalPolicy, word: string): Corridor | null {
  const w = norm(word);
  if (w.length < 3) return null;
  const names = (c: Corridor) => [c.id.replace(/-/g, ' '), c.place.name, ...c.place.alt_names].map(norm);
  return policy.corridors.find((c) => c.active && names(c).some((n) => n === w || n.startsWith(w) || n.split(' ').includes(w)
    || n.replace(/[()]/g, '').split(' ').some((x) => x.length >= 4 && x === w))) ?? null;
}

/** The weekday a shuttle on `day` leaves (Darwin), or null for "next". */
export function dayFilter(day: number | 'today' | 'tomorrow' | null, now = new Date()): { weekday?: number; date?: string } {
  if (day == null) return {};
  const today = darwinParts(now).date;
  if (day === 'today') return { date: today };
  if (day === 'tomorrow') return { date: addDays(today, 1) };
  return { weekday: day };
}

// ───────────────────────── Community store top-ups ─────────────────────────
export function checkTopup(p: RegionalPolicy['topups'], cents: number, o: { riderTodayCents: number; storeTodayCents: number }) {
  if (!Number.isInteger(cents) || cents < p.min_cents || cents > p.max_cents) {
    throw bad('topup_amount', `Top up between $${(p.min_cents / 100).toFixed(2)} and $${(p.max_cents / 100).toFixed(2)}`);
  }
  if (cents % 5 !== 0) throw bad('topup_amount', 'Top up in whole 5 cents (cash)');
  if (o.riderTodayCents + cents > p.per_rider_day_cents) throw bad('topup_rider_limit', `That is more than $${(p.per_rider_day_cents / 100).toFixed(0)} for one person today`);
  if (o.storeTodayCents + cents > p.per_store_day_cents) throw bad('topup_store_limit', 'This store has reached its top-up limit for today. Call DingoGo.');
}

// ───────────────────────── Low-data page ─────────────────────────
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export interface LiteRun { id: string; corridor: string; direction: 'out' | 'back'; departs_at: Date | string; seats_left: number }
/** The whole low-data booking page: no scripts, no images, no web fonts, one small style block. Works on 2G and old phones. */
export function litePage(o: { policy: RegionalPolicy; runs: LiteRun[]; phone: string | null; message?: string | null; error?: string | null; formAction: string }) {
  const parts: string[] = [];
  parts.push(`<!doctype html><html lang="en-AU"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + `<title>DingoGo community trips</title><meta name="robots" content="noindex">`
    + `<style>body{font:16px/1.4 sans-serif;max-width:36em;margin:0 auto;padding:8px 12px;color:#111;background:#fff}h1{font-size:1.3em}h2{font-size:1.1em;margin:1em 0 .3em}`
    + `.n{background:#fff4d6;padding:6px;border-left:3px solid #b07400}.e{background:#fde2e1;padding:6px;border-left:3px solid #b3261e}label{display:block;margin:.4em 0}`
    + `input,select,button{font:inherit;padding:6px;max-width:100%}button{background:#1f5133;color:#fff;border:0;padding:8px 14px}small{color:#444}</style></head><body>`);
  parts.push(`<h1>DingoGo community trips</h1><p>Shared seats and parcels between Alice Springs and communities. Paid with DingoGo credit (top up at a DingoGo store).`
    + `${o.phone ? ` Or call <a href="tel:${esc(o.phone.replace(/\s/g, ''))}">${esc(o.phone)}</a>.` : ''}</p>`);
  parts.push(`<p><small>Book by text: send BUS and the place, e.g. BUS NTARIA FRI 2. Reply YES to book.</small></p>`);
  if (o.message) parts.push(`<p class="n">${esc(o.message)}</p>`);
  if (o.error) parts.push(`<p class="e">${esc(o.error)}</p>`);
  const active = o.policy.corridors.filter((c) => c.active);
  for (const c of active) {
    const runs = o.runs.filter((r) => r.corridor === c.id);
    parts.push(`<h2>${esc(c.place.name)}</h2><p>Seat ${money(c.seat_cents)} each way. Parcel from ${money(c.parcel_cents.S)}. Private car ${money(c.private_cents)}.`
      + ` About ${c.road_km} km, ${Math.round(c.minutes / 5) * 5} min.</p>`);
    if (c.permit_note) parts.push(`<p><small>Permits: ${esc(c.permit_note)}</small></p>`);
    if (c.coverage_gaps.length) parts.push(`<p><small>No mobile coverage on parts of the road. Tell someone when you expect to arrive.</small></p>`);
    if (!runs.length) { parts.push('<p>No shuttles booked in yet. Call us.</p>'); continue; }
    parts.push('<ul>' + runs.map((r) => `<li>${esc(whenText(r.departs_at))}: ${esc(runLabel(c, r.direction))}, ${r.seats_left > 0 ? `${r.seats_left} seat${r.seats_left === 1 ? '' : 's'} left` : 'full'}</li>`).join('') + '</ul>');
  }
  const open = o.runs.filter((r) => r.seats_left > 0);
  if (open.length) {
    parts.push(`<h2>Book a seat</h2><form method="post" action="${esc(o.formAction)}"><label>Shuttle <select name="run_id" required>`
      + open.map((r) => { const c = active.find((x) => x.id === r.corridor)!; return `<option value="${esc(r.id)}">${esc(whenText(r.departs_at))} ${esc(runLabel(c, r.direction))}</option>`; }).join('')
      + `</select></label><label>Seats <select name="seats">${[1, 2, 3, 4].slice(0, o.policy.max_seats_per_booking).map((n) => `<option>${n}</option>`).join('')}</select></label>`
      + `<label>Mobile number <input name="phone" type="tel" inputmode="tel" autocomplete="tel" required maxlength="16"></label>`
      + `<button type="submit">Text me to confirm</button></form><p><small>We text you. Reply YES within ${o.policy.pending_hold_min} minutes to book. The seat price comes off your DingoGo credit.</small></p>`);
  }
  parts.push('<p><small>DingoGo is Aboriginal-owned, based in Mparntwe (Alice Springs).</small></p></body></html>');
  return parts.join('');
}
