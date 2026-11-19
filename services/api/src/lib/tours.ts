/**
 * Round 19: tours, hire and tourism. Pure rules (no database): tour products (itinerary, cultural protocols, season, start times,
 * notice, guests, hotel pickup, Aboriginal guide and fee, deposit), availability and booking checks against heat and closure
 * advisories, deposit and the 48-hour cancellation terms, hire quotes by the hour / day / vehicle, visitor-language content
 * (machine translations flagged for review) and outback safety advice.
 *
 * The four seeded tours get their itinerary and translations from BUILT_IN / SEED_TRANSLATIONS until staff edit them, so all of
 * this works before migration 023 adds the columns (see services/tours.ts `toursReady()`).
 */
import { bad } from './errors.js';
import { z } from './validate.js';
import type { FareRule } from './fares.js';

// ───────────────────────── Visitor languages ─────────────────────────
/** Common visitor languages for the tour screens. Machine-translated and flagged until a fluent reviewer checks them.
 *  Kept apart from the community languages (Arrernte, Kriol), which are never machine-translated. */
export const VISITOR_LANGS = ['de', 'fr', 'it', 'ja', 'ko', 'zh'] as const;
export type VisitorLang = (typeof VISITOR_LANGS)[number];
export const VISITOR_LANG_NAMES: Record<VisitorLang, { name: string; english_name: string }> = {
  de: { name: 'Deutsch', english_name: 'German' }, fr: { name: 'Français', english_name: 'French' },
  it: { name: 'Italiano', english_name: 'Italian' }, ja: { name: '日本語', english_name: 'Japanese' },
  ko: { name: '한국어', english_name: 'Korean' }, zh: { name: '简体中文', english_name: 'Chinese (Simplified)' },
};
export const isVisitorLang = (l: unknown): l is VisitorLang => (VISITOR_LANGS as readonly string[]).includes(String(l));

export interface TourText { name?: string; summary?: string; description?: string; cultural_note?: string; status: 'machine' | 'reviewed'; reviewed_by?: string; reviewed_on?: string }

// ───────────────────────── Products ─────────────────────────
/** Cultural and site protocols a stop can carry. The wording is what guests read before booking and on the day. */
export const PROTOCOLS = {
  no_climbing: 'Please do not climb on the rocks here.',
  no_swimming: 'Swimming is not permitted here.',
  photos_restricted: 'Photos only where the signs allow. Please ask before photographing people.',
  stay_on_path: 'Stay on the marked path.',
  follow_owners: 'Please follow signs and the requests of Traditional Owners.',
  gender_restricted: "Some places are men's or women's sites. Your driver or guide will show you where you can go.",
  quiet: 'Please keep voices low.',
  entry_fee: 'Entry fee payable on the day (not included).',
} as const;
export type Protocol = keyof typeof PROTOCOLS;
const PROTOCOL_KEYS = Object.keys(PROTOCOLS) as [Protocol, ...Protocol[]];

export interface Stop { name: string; minutes: number; note?: string | null; protocols?: Protocol[] }
export const GUIDED_BY = ['driver', 'aboriginal_guide'] as const;

export interface TourProduct {
  id: string; slug: string; name: string; summary: string; description: string; duration_min: number; price_cents: number;
  max_passengers: number; cultural_note: string | null; requires_permit: boolean; image_url: string | null; active: boolean;
  stops: string[];
  itinerary: Stop[];
  /** Months the tour runs (1-12) and weekdays (0 = Sunday). */
  season_months: number[];
  days: number[];
  /** Darwin-time start times, "HH:MM". */
  start_times: string[];
  /** Book at least this many hours ahead. */
  min_notice_hours: number;
  /** Walks in the open: a heat advisory sets the latest start. */
  heat_sensitive: boolean;
  hotel_pickup: boolean;
  guided_by: (typeof GUIDED_BY)[number];
  /** Paid in full to the Aboriginal guide; added to the price, outside discounts and the driver's fare. */
  guide_fee_cents: number;
  /** Deposit taken on the card at booking (null = the default in tour_policy). */
  deposit_pct: number | null;
  translations: Partial<Record<VisitorLang, TourText>>;
}

const ALL_MONTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

/** Itinerary and timetable for the seeded tours (used while the row's own itinerary is empty, e.g. before migration 023). */
export const BUILT_IN: Record<string, Partial<TourProduct>> = {
  'town-heritage': {
    itinerary: [
      { name: 'Anzac Hill (Untyeyetweleye)', minutes: 25, note: 'View over the town and the MacDonnell Ranges.', protocols: ['stay_on_path'] },
      { name: 'Alice Springs Telegraph Station', minutes: 50, note: 'Where the town began, beside the Todd River waterhole.', protocols: ['entry_fee'] },
      { name: 'RFDS Tourist Facility', minutes: 35, protocols: ['entry_fee'] },
    ],
    start_times: ['08:00', '10:00', '14:00'], min_notice_hours: 12,
  },
  'west-macs-gaps': {
    itinerary: [
      { name: 'Simpsons Gap (Rungutjirba)', minutes: 60, note: 'Look for black-footed rock-wallabies near the gap.', protocols: ['stay_on_path', 'no_swimming', 'follow_owners'] },
      { name: 'Standley Chasm (Angkerle Atwatye)', minutes: 75, note: 'Owned and run by the Iwupataka Land Trust.', protocols: ['entry_fee', 'stay_on_path', 'follow_owners'] },
    ],
    start_times: ['07:00', '08:00'], min_notice_hours: 24, heat_sensitive: true,
  },
  'desert-sunset': {
    itinerary: [
      { name: 'Alice Springs Desert Park', minutes: 150, protocols: ['entry_fee'] },
      { name: 'Anzac Hill (Untyeyetweleye)', minutes: 40, note: 'Sunset over the ranges.', protocols: ['stay_on_path'] },
    ],
    start_times: ['14:00', '15:00'], min_notice_hours: 12,
  },
  'east-macs-gaps': {
    itinerary: [
      { name: 'Emily Gap (Anthwerrke)', minutes: 50, note: 'Registered sacred site of the caterpillar Dreaming.', protocols: ['no_climbing', 'no_swimming', 'photos_restricted'] },
      { name: 'Jessie Gap (Atherrke)', minutes: 40, protocols: ['stay_on_path', 'photos_restricted'] },
    ],
    start_times: ['07:30', '09:00', '15:00'], min_notice_hours: 12, heat_sensitive: true,
  },
};

const M = 'machine' as const;
/** Machine translations of the seeded tours' names and summaries. Descriptions fall back to English. Needs a fluent reviewer. */
export const SEED_TRANSLATIONS: Record<string, Partial<Record<VisitorLang, TourText>>> = {
  'town-heritage': {
    de: { name: 'Mparntwe: Stadt und Telegrafenstation', summary: 'Zwei Stunden durch die Stadt: Anzac Hill, die Telegrafenstation und die Basis des Royal Flying Doctor Service.', status: M },
    fr: { name: 'Mparntwe : la ville et la station télégraphique', summary: 'Deux heures en ville : Anzac Hill, la station télégraphique et la base du Royal Flying Doctor Service.', status: M },
    it: { name: 'Mparntwe: città e stazione del telegrafo', summary: 'Due ore in città: Anzac Hill, la stazione del telegrafo e la base del Royal Flying Doctor Service.', status: M },
    ja: { name: 'ムパーントゥエ市内と電信局', summary: '市内を2時間で巡ります。アンザック・ヒル、電信局、ロイヤル・フライング・ドクター基地。', status: M },
    ko: { name: '음파른트웨 시내와 전신국', summary: '시내 2시간 투어: 안작 힐, 전신국, 로열 플라잉 닥터 기지.', status: M },
    zh: { name: 'Mparntwe 市区与电报站', summary: '市区两小时游览：澳新军团山、电报站和皇家飞行医生基地。', status: M },
  },
  'west-macs-gaps': {
    de: { name: 'Schluchten der West MacDonnell Ranges', summary: 'Halbtagestour zum Simpsons Gap (Rungutjirba) und zum Standley Chasm (Angkerle Atwatye).', status: M },
    fr: { name: 'Les gorges des West MacDonnell', summary: 'Une demi-journée vers Simpsons Gap (Rungutjirba) et Standley Chasm (Angkerle Atwatye).', status: M },
    it: { name: 'Le gole dei West MacDonnell', summary: 'Mezza giornata a Simpsons Gap (Rungutjirba) e Standley Chasm (Angkerle Atwatye).', status: M },
    ja: { name: 'ウエスト・マクドネル山脈の渓谷', summary: 'シンプソンズ・ギャップ (Rungutjirba) とスタンレー・キャズム (Angkerle Atwatye) への半日ツアー。', status: M },
    ko: { name: '웨스트 맥도넬 협곡', summary: '심슨스 갭(Rungutjirba)과 스탠리 캐즘(Angkerle Atwatye) 반나절 투어.', status: M },
    zh: { name: '西麦克唐奈山峡谷', summary: '半日游：辛普森峡 (Rungutjirba) 和斯坦利峡谷 (Angkerle Atwatye)。', status: M },
  },
  'desert-sunset': {
    de: { name: 'Desert Park und Sonnenuntergang', summary: 'Alice Springs Desert Park, danach Sonnenuntergang auf dem Anzac Hill.', status: M },
    fr: { name: 'Desert Park et coucher de soleil', summary: "L'Alice Springs Desert Park, puis le coucher de soleil depuis Anzac Hill.", status: M },
    it: { name: 'Desert Park e tramonto', summary: "L'Alice Springs Desert Park e poi il tramonto da Anzac Hill.", status: M },
    ja: { name: 'デザート・パークと夕日', summary: 'アリススプリングス・デザート・パークの後、アンザック・ヒルで夕日を。', status: M },
    ko: { name: '데저트 파크와 일몰', summary: '앨리스스프링스 데저트 파크 관람 후 안작 힐에서 일몰 감상.', status: M },
    zh: { name: '沙漠公园与日落', summary: '游览爱丽斯泉沙漠公园，然后在澳新军团山观赏日落。', status: M },
  },
  'east-macs-gaps': {
    de: { name: 'Emily Gap und Jessie Gap', summary: 'Kurzer Ausflug nach Osten zu Anthwerrke und Atherrke.', status: M },
    fr: { name: 'Emily Gap et Jessie Gap', summary: "Courte excursion vers l'est jusqu'à Anthwerrke et Atherrke.", status: M },
    it: { name: 'Emily Gap e Jessie Gap', summary: 'Breve gita a est verso Anthwerrke e Atherrke.', status: M },
    ja: { name: 'エミリー・ギャップとジェシー・ギャップ', summary: '東へ少し足をのばして Anthwerrke と Atherrke へ。', status: M },
    ko: { name: '에밀리 갭과 제시 갭', summary: '동쪽의 Anthwerrke와 Atherrke로 가는 짧은 여행.', status: M },
    zh: { name: '艾米丽峡与杰西峡', summary: '向东短途游览 Anthwerrke 和 Atherrke。', status: M },
  },
};

const arr = <T>(v: unknown, d: T[]): T[] => (Array.isArray(v) && v.length ? (v as T[]) : d);

/** A tour row (with or without the migration 023 columns) as a full product. */
export function normaliseTour(row: any): TourProduct {
  const b = BUILT_IN[row.slug] ?? {};
  const stops: string[] = Array.isArray(row.stops) ? row.stops : [];
  const ownItinerary = Array.isArray(row.itinerary) && row.itinerary.length ? row.itinerary : null;
  const itinerary: Stop[] = ownItinerary ?? b.itinerary
    ?? stops.map((name) => ({ name, minutes: Math.max(10, Math.round((row.duration_min ?? 60) / Math.max(1, stops.length) / 5) * 5) }));
  const translations = { ...(SEED_TRANSLATIONS[row.slug] ?? {}), ...(row.translations && typeof row.translations === 'object' ? row.translations : {}) };
  return {
    id: row.id, slug: row.slug, name: row.name, summary: row.summary, description: row.description,
    duration_min: Number(row.duration_min), price_cents: Number(row.price_cents), max_passengers: Number(row.max_passengers ?? 4),
    cultural_note: row.cultural_note ?? null, requires_permit: !!row.requires_permit, image_url: row.image_url ?? null, active: row.active !== false,
    stops: stops.length ? stops : itinerary.map((s) => s.name),
    itinerary,
    season_months: arr(row.season_months, ALL_MONTHS).map(Number),
    days: arr(row.days, ALL_DAYS).map(Number),
    // Until staff give a seeded tour its own itinerary, its timetable, notice and heat rule come from BUILT_IN.
    start_times: ownItinerary ? arr(row.start_times, ['08:00']) : (b.start_times ?? arr(row.start_times, ['08:00'])),
    min_notice_hours: Number(ownItinerary ? row.min_notice_hours ?? 12 : b.min_notice_hours ?? row.min_notice_hours ?? 12),
    heat_sensitive: ownItinerary ? !!row.heat_sensitive : !!(b.heat_sensitive ?? row.heat_sensitive),
    hotel_pickup: row.hotel_pickup ?? true,
    guided_by: row.guided_by === 'aboriginal_guide' ? 'aboriginal_guide' : 'driver',
    guide_fee_cents: row.guided_by === 'aboriginal_guide' ? Number(row.guide_fee_cents ?? 0) : 0,
    deposit_pct: row.deposit_pct == null ? null : Number(row.deposit_pct),
    translations,
  };
}

/** The product as a visitor reading `lang` sees it: translated fields where there are some (English otherwise), flagged. */
export function localiseTour(p: TourProduct, lang?: string | null) {
  const out: TourProduct & { lang: string; machine_translated: boolean; translated_fields: string[] } = { ...p, lang: 'en', machine_translated: false, translated_fields: [] };
  if (!isVisitorLang(lang)) return out;
  const tr = p.translations[lang];
  out.lang = lang;
  if (!tr) return out;
  for (const k of ['name', 'summary', 'description', 'cultural_note'] as const) {
    if (tr[k]) { (out as any)[k] = tr[k]; out.translated_fields.push(k); }
  }
  out.machine_translated = out.translated_fields.length > 0 && tr.status !== 'reviewed';
  return out;
}

const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Times are HH:MM (24-hour)');
const textSchema = z.object({
  name: z.string().max(120).optional(), summary: z.string().max(400).optional(), description: z.string().max(4000).optional(),
  cultural_note: z.string().max(1000).optional(), status: z.enum(['machine', 'reviewed']).default('machine'),
  reviewed_by: z.string().max(80).optional(), reviewed_on: z.string().max(20).optional(),
});
/** Admin tour fields (Round 19 columns), checked before they're written. */
export const tourFields = z.object({
  slug: z.string().regex(/^[a-z0-9-]{3,60}$/, 'Slug: lower-case letters, numbers and hyphens').optional(),
  name: z.string().min(2).max(120).optional(), summary: z.string().min(2).max(400).optional(), description: z.string().min(2).max(4000).optional(),
  duration_min: z.number().int().min(30).max(14 * 60).optional(), price_cents: z.number().int().min(0).max(1_000_000).optional(),
  max_passengers: z.number().int().min(1).max(13).optional(),
  stops: z.array(z.string().min(1).max(120)).max(20).optional(),
  cultural_note: z.string().max(1000).nullable().optional(), requires_permit: z.boolean().optional(), image_url: z.string().max(500).nullable().optional(),
  active: z.boolean().optional(),
  itinerary: z.array(z.object({ name: z.string().min(1).max(120), minutes: z.number().int().min(5).max(600), note: z.string().max(400).nullable().optional(),
    protocols: z.array(z.enum(PROTOCOL_KEYS)).max(8).optional() })).max(20).optional(),
  season_months: z.array(z.number().int().min(1).max(12)).min(1).max(12).optional(),
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7).optional(),
  start_times: z.array(hhmm).min(1).max(12).optional(),
  min_notice_hours: z.number().int().min(1).max(24 * 14).optional(),
  heat_sensitive: z.boolean().optional(), hotel_pickup: z.boolean().optional(),
  guided_by: z.enum(GUIDED_BY).optional(), guide_fee_cents: z.number().int().min(0).max(200_000).optional(),
  deposit_pct: z.number().int().min(0).max(100).nullable().optional(),
  translations: z.record(z.string(), textSchema).optional(),
});
export const ROUND19_TOUR_COLUMNS = ['itinerary', 'season_months', 'days', 'start_times', 'min_notice_hours', 'heat_sensitive', 'hotel_pickup',
  'guided_by', 'guide_fee_cents', 'deposit_pct', 'translations'] as const;

/** Cross-field checks: stops fit the duration, guide fee only for guided tours, translations only in visitor languages and
 *  never "reviewed" without a reviewer. */
export function checkTourFields(d: z.infer<typeof tourFields>, before?: any) {
  const merged = { ...(before ?? {}), ...d };
  if (d.itinerary && merged.duration_min && d.itinerary.reduce((n, s) => n + s.minutes, 0) > Number(merged.duration_min)) {
    throw bad('itinerary_too_long', 'The stops add up to more than the tour\'s duration (driving time is extra)');
  }
  if ((d.guide_fee_cents ?? 0) > 0 && merged.guided_by !== 'aboriginal_guide') throw bad('guide_fee_needs_guide', 'A guide fee is only for tours led by an Aboriginal guide');
  for (const [l, tr] of Object.entries(d.translations ?? {})) {
    if (!isVisitorLang(l)) throw bad('invalid_language', `Translations are for ${VISITOR_LANGS.join(', ')}`);
    if (tr.status === 'reviewed' && !(tr.reviewed_by && tr.reviewed_on)) throw bad('reviewer_required', 'A reviewed translation needs the reviewer\'s name and date');
  }
  const out: Record<string, unknown> = { ...d };
  if (d.itinerary && !d.stops) out.stops = d.itinerary.map((s) => s.name);
  return out;
}

// ───────────────────────── Policy ─────────────────────────
export interface HirePolicy {
  min_hours: number; max_hours_per_day: number;
  /** A day longer than this many hours is charged as this many (the day rate). */
  day_cap_hours: number;
  multi_day_min_days: number; multi_day_pct: number;
  quote_valid_days: number;
  /** Book hourly hire online at least this many hours ahead. */
  notice_hours: number;
}
export interface TourPolicy {
  /** Card deposit at booking for tours (a tour's own deposit_pct wins). 0 = pay at the tour. */
  deposit_pct: number;
  /** A late booking (inside the free window) can still be cancelled free this many minutes after booking. */
  change_of_mind_min: number;
  hire: HirePolicy;
}
export const DEFAULT_TOUR_POLICY: TourPolicy = {
  deposit_pct: 20, change_of_mind_min: 10,
  hire: { min_hours: 1, max_hours_per_day: 10, day_cap_hours: 8, multi_day_min_days: 3, multi_day_pct: 10, quote_valid_days: 14, notice_hours: 24 },
};
const policySchema = z.object({
  deposit_pct: z.number().int().min(0).max(100),
  change_of_mind_min: z.number().int().min(0).max(120),
  hire: z.object({
    min_hours: z.number().min(1).max(8), max_hours_per_day: z.number().int().min(1).max(12), day_cap_hours: z.number().min(1).max(12),
    multi_day_min_days: z.number().int().min(2).max(30), multi_day_pct: z.number().min(0).max(50), quote_valid_days: z.number().int().min(1).max(90),
    notice_hours: z.number().int().min(1).max(24 * 14),
  }),
});
export function mergeTourPolicy(v: any): TourPolicy {
  return { ...DEFAULT_TOUR_POLICY, ...(v ?? {}), hire: { ...DEFAULT_TOUR_POLICY.hire, ...(v?.hire ?? {}) } };
}
/** Admin save: whole policy checked (unknown keys dropped). */
export function checkTourPolicy(v: unknown): TourPolicy {
  const r = policySchema.safeParse(mergeTourPolicy(v));
  if (!r.success) throw bad('validation_error', r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; '));
  if (r.data.hire.day_cap_hours < r.data.hire.min_hours) throw bad('validation_error', 'The day rate cap must be at least the minimum hours');
  return r.data;
}

// ───────────────────────── Darwin time ─────────────────────────
const TZ = 'Australia/Darwin';
const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
export function darwinParts(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-AU', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    minute: '2-digit', hourCycle: 'h23', weekday: 'short' }).formatToParts(d).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, month: Number(p.month), weekday: WD[p.weekday] ?? 0 };
}
/** NT has no daylight saving: Darwin is always UTC+9:30. */
export const darwinTime = (date: string, time: string) => new Date(`${date}T${time}:00+09:30`);
export const addDays = (date: string, n: number) => new Date(Date.parse(`${date}T00:00:00Z`) + n * 86400_000).toISOString().slice(0, 10);

// ───────────────────────── Advisories ─────────────────────────
export const ADVISORY_KINDS = ['heat', 'closure', 'fire', 'flood', 'road', 'water'] as const;
export interface Advisory {
  id: string; kind: (typeof ADVISORY_KINDS)[number]; title: string; message: string;
  starts_on: string; ends_on: string;
  /** Tours it applies to; empty = every tour. */
  tour_ids: string[];
  /** Heat: heat-sensitive tours must start by this Darwin time ("HH:MM"). */
  latest_start: string | null;
  /** Closure: no bookings for the tours it covers on those days. */
  closes: boolean;
  active: boolean;
}
const dayStr = (v: unknown) => (v instanceof Date ? v.toISOString().slice(0, 10) : String(v).slice(0, 10));
export function advisoriesOn(list: Advisory[], tourId: string | null, day: string): Advisory[] {
  return list.filter((a) => a.active && dayStr(a.starts_on) <= day && day <= dayStr(a.ends_on) && (!a.tour_ids?.length || (tourId != null && a.tour_ids.includes(tourId))));
}

// ───────────────────────── Booking checks and availability ─────────────────────────
export interface StartProblem { code: string; message: string }
/** Why a tour can't start at `start` for `guests`, or null. Darwin dates and times throughout. */
export function checkStart(p: TourProduct, start: Date, o: { now?: number; guests?: number; advisories?: Advisory[]; ignoreNotice?: boolean } = {}): StartProblem | null {
  const now = o.now ?? Date.now();
  if (!p.active) return { code: 'tour_unavailable', message: 'This tour is not taking bookings' };
  if ((o.guests ?? 1) > p.max_passengers) return { code: 'too_many_guests', message: `This tour takes up to ${p.max_passengers} guests per car` };
  if (!o.ignoreNotice && start.getTime() < now + p.min_notice_hours * 3600_000) {
    return { code: 'tour_too_soon', message: `Book this tour at least ${p.min_notice_hours} hours ahead` };
  }
  const d = darwinParts(start);
  if (!p.season_months.includes(d.month)) return { code: 'tour_out_of_season', message: 'This tour does not run in that month' };
  if (!p.days.includes(d.weekday)) return { code: 'tour_not_that_day', message: 'This tour does not run on that day of the week' };
  if (!p.start_times.includes(d.time)) return { code: 'tour_start_time', message: `Start times are ${p.start_times.join(', ')} (Alice Springs time)` };
  const on = advisoriesOn(o.advisories ?? [], p.id, d.date);
  const closed = on.find((a) => a.closes);
  if (closed) return { code: 'tour_closed', message: `${closed.title}: ${closed.message}` };
  const heat = on.find((a) => a.kind === 'heat' && a.latest_start);
  if (heat && p.heat_sensitive && d.time > heat.latest_start!) {
    return { code: 'heat_advisory', message: `${heat.title}: this tour must start by ${heat.latest_start} on that day` };
  }
  return null;
}

export interface DayAvailability { date: string; times: { time: string; ok: boolean; reason?: string }[]; advisories: Pick<Advisory, 'id' | 'kind' | 'title' | 'message'>[] }
export function availability(p: TourProduct, advisories: Advisory[], from: string, days: number, now = Date.now()): DayAvailability[] {
  const out: DayAvailability[] = [];
  for (let i = 0; i < Math.min(Math.max(days, 1), 62); i++) {
    const date = addDays(from, i);
    const times = p.start_times.map((time) => {
      const problem = checkStart(p, darwinTime(date, time), { now, advisories });
      return problem ? { time, ok: false, reason: problem.code } : { time, ok: true };
    });
    out.push({ date, times, advisories: advisoriesOn(advisories, p.id, date).map(({ id, kind, title, message }) => ({ id, kind, title, message })) });
  }
  return out;
}

// ───────────────────────── Deposit and cancellation ─────────────────────────
const round5 = (c: number) => Math.round(c / 5) * 5;
export const depositCents = (totalCents: number, pct: number) => (pct > 0 && totalCents > 0 ? Math.min(totalCents, round5((totalCents * pct) / 100)) : 0);

export interface CancelTerms { fee_cents: number; reason: 'free_before' | 'change_of_mind' | 'advisory' | 'late'; free_until: string | null }
/** Tours and hire: free until `freeHours` before the start; inside that, `latePct` of the price, except in the first
 *  `changeOfMindMin` minutes after booking, or when an advisory (heat, closure) covers the day. */
export function scheduledCancel(o: { quoteCents: number; scheduledFor: Date | string; bookedAt?: Date | string | null; freeHours: number; latePct: number;
  changeOfMindMin: number; advisory?: boolean; now?: number }): CancelTerms {
  const now = o.now ?? Date.now();
  const start = new Date(o.scheduledFor).getTime();
  const freeUntil = new Date(start - o.freeHours * 3600_000);
  if (o.advisory) return { fee_cents: 0, reason: 'advisory', free_until: freeUntil.toISOString() };
  if (now < freeUntil.getTime()) return { fee_cents: 0, reason: 'free_before', free_until: freeUntil.toISOString() };
  if (o.bookedAt && now - new Date(o.bookedAt).getTime() < o.changeOfMindMin * 60_000 && now < start) {
    return { fee_cents: 0, reason: 'change_of_mind', free_until: freeUntil.toISOString() };
  }
  return { fee_cents: Math.round((o.quoteCents * o.latePct) / 100), reason: 'late', free_until: freeUntil.toISOString() };
}

// ───────────────────────── Hire quotes ─────────────────────────
export interface HireRequest { hours_per_day: number; days: number; vehicles: number }
export interface HireQuote {
  lines: { label: string; cents: number }[]; hourly_cents: number; charged_hours_per_day: number;
  subtotal_cents: number; discount_cents: number; levy_cents: number; total_cents: number; gst_cents: number;
  hours_per_day: number; days: number; vehicles: number;
}
/** Hire by the hour / day / vehicle from the hourly fare rule: a minimum per day, a day rate cap, a multi-day discount, the
 *  passenger levy per car per day. GST-inclusive like every fare. */
export function hireQuote(rule: Pick<FareRule, 'per_min_cents' | 'min_fare_cents' | 'levy_cents'>, r: HireRequest, policy: HirePolicy): HireQuote {
  if (!(r.days >= 1 && r.days <= 30) || !(r.vehicles >= 1 && r.vehicles <= 20)) throw bad('validation_error', 'Hire is 1 to 30 days and 1 to 20 cars');
  if (!(r.hours_per_day > 0 && r.hours_per_day <= policy.max_hours_per_day)) {
    throw bad('hire_hours', `Hire is up to ${policy.max_hours_per_day} hours a day per driver (fatigue rules); book more cars or days for longer`);
  }
  const hourly = Math.round(rule.per_min_cents * 60);
  const minHours = Math.max(policy.min_hours, hourly > 0 ? rule.min_fare_cents / hourly : 0);
  const charged = Math.min(Math.max(r.hours_per_day, minHours), policy.day_cap_hours);
  const perCarDay = Math.round(hourly * charged);
  const lines = [{ label: `${r.vehicles} car${r.vehicles > 1 ? 's' : ''} x ${r.days} day${r.days > 1 ? 's' : ''} x ${charged} h at $${(hourly / 100).toFixed(2)}/h`, cents: perCarDay * r.days * r.vehicles }];
  if (charged < r.hours_per_day) lines.push({ label: `Day rate: ${r.hours_per_day} h charged as ${charged} h`, cents: 0 });
  const subtotal = lines[0].cents;
  const discount = r.days >= policy.multi_day_min_days && policy.multi_day_pct > 0 ? Math.round((subtotal * policy.multi_day_pct) / 100) : 0;
  if (discount) lines.push({ label: `Multi-day (-${policy.multi_day_pct}%)`, cents: -discount });
  const levy = (rule.levy_cents ?? 0) * r.days * r.vehicles;
  if (levy) lines.push({ label: 'NT passenger levy (per car per day)', cents: levy });
  const total = round5(subtotal - discount) + levy;
  return { lines, hourly_cents: hourly, charged_hours_per_day: charged, subtotal_cents: subtotal, discount_cents: discount, levy_cents: levy,
    total_cents: total, gst_cents: Math.round(total / 11), ...r };
}

// ───────────────────────── Outback safety ─────────────────────────
/** Water to carry: a litre per person for each hour out (rounded up), at least one. */
export const waterLitres = (durationMin: number, guests: number) => Math.max(1, Math.ceil(durationMin / 60)) * Math.max(1, guests);
export const HOT_MONTHS = [10, 11, 12, 1, 2, 3];
export function safetyFor(p: Pick<TourProduct, 'duration_min' | 'heat_sensitive' | 'requires_permit'>, month: number, guests = 1): string[] {
  const out = [
    `Bring ${waterLitres(p.duration_min, guests)} L of water for ${guests > 1 ? `${guests} people` : 'one person'} (a litre each per hour). We carry spare cold water.`,
    'Wear a hat, sunscreen and closed shoes.',
    'Phone coverage is patchy outside town. Your driver carries a satellite messenger and a first aid kit.',
  ];
  if (HOT_MONTHS.includes(month)) out.push(p.heat_sensitive
    ? 'Summer: walks start early. On days over 40 degrees walking tracks may close and we will move or refund your tour.'
    : 'Summer: days are often over 40 degrees. Drink before you feel thirsty.');
  if (p.requires_permit) out.push('Some stops charge entry or need a permit. Your driver will explain on the day.');
  return out;
}
