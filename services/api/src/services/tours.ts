/**
 * Round 19: tours, hire and tourism (database side). Products and advisories through the config cache, booking checks, the
 * deposit, guide jobs and partner commissions around a tour's life, advisory notices to booked guests, and hire quotes.
 * Everything new needs migration 023 (`toursReady()`); before it, tours keep working with the built-in itineraries and
 * timetables from lib/tours.ts, no advisories, and the new admin parts answer 503 `migration_pending`.
 */
import crypto from 'node:crypto';
import type pg from 'pg';
import { one, q } from '../db.js';
import { ApiError, bad, notFound } from '../lib/errors.js';
import { cached, settingValue } from '../lib/cache.js';
import { config } from '../config.js';
import { logError } from '../lib/log.js';
import { send, sendSmsT } from './notify.js';
import { toOps } from '../realtime.js';
import {
  advisoriesOn, checkStart, darwinParts, hireQuote, mergeTourPolicy, normaliseTour, scheduledCancel,
  type Advisory, type HireRequest, type TourPolicy, type TourProduct,
} from '../lib/tours.js';
import type { FareRule } from '../lib/fares.js';

let ready = false;
let checkedAt = 0;
/** True once migration 023's columns and tables exist (re-checked once a minute until then). */
export async function toursReady(): Promise<boolean> {
  if (ready) return true;
  if (checkedAt && Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const r = await one<{ n: number }>(
      `SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema()
                 AND ((table_name = 'tour_packages' AND column_name IN ('itinerary','season_months','days','start_times','min_notice_hours','heat_sensitive',
                        'hotel_pickup','guided_by','guide_fee_cents','deposit_pct','translations'))
                   OR (table_name = 'partners' AND column_name IN ('tour_commission_pct','corporate_account_id'))
                   OR (table_name = 'hire_requests' AND column_name IN ('quote','quote_token','quote_sent_at','quote_expires_at','start_date','accepted_at','accepted_name'))))
            + (SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()
                 AND table_name IN ('tour_advisories','tour_guides','tour_guide_jobs','tour_commissions')) AS n`);
    ready = Number(r!.n) === 24;
  } catch { ready = false; }
  return ready;
}
export function resetToursReady() { ready = false; checkedAt = 0; }
export const migrationPending = () => new ApiError(503, 'migration_pending', 'This needs database migration 023 (tours and hire)');

export async function tourPolicy(): Promise<TourPolicy> { return mergeTourPolicy(await settingValue('tour_policy')); }

/** Every tour (or the bookable ones) as full products. Cached like fare rules; dropped on staff writes. */
export async function loadTours(activeOnly = true): Promise<TourProduct[]> {
  const rows = await cached('tour_packages', () => q('SELECT * FROM tour_packages ORDER BY price_cents'));
  return rows.filter((r: any) => !activeOnly || r.active).map(normaliseTour);
}
export async function loadTour(idOrSlug: string): Promise<TourProduct | null> {
  return (await loadTours(false)).find((t) => t.id === idOrSlug || t.slug === idOrSlug) ?? null;
}

/** Advisories still running (ends today or later, Darwin date). Empty before migration 023. */
export async function loadAdvisories(): Promise<Advisory[]> {
  if (!(await toursReady())) return [];
  const today = darwinParts(new Date()).date;
  const rows = await cached('tour_advisories', () => q(`SELECT *, starts_on::text AS starts_on, ends_on::text AS ends_on FROM tour_advisories WHERE active ORDER BY tour_advisories.starts_on`));
  return rows.filter((a: any) => a.ends_on >= today);
}

/** Booking checks for a tour start (also used by quotes): product rules, then heat and closure advisories. */
export async function checkTourBooking(tourId: string, scheduledFor: string | null | undefined, guests: number | undefined, o: { staff?: boolean } = {}) {
  const p = await loadTour(tourId);
  if (!p || !p.active) throw notFound('Tour');
  if (!scheduledFor) throw bad('tour_needs_date', 'Choose a date and start time for the tour');
  // Staff phone bookings may be later than the online notice (the office has checked a driver is free).
  const problem = checkStart(p, new Date(scheduledFor), { guests, advisories: await loadAdvisories(), ignoreNotice: o.staff });
  if (problem) throw bad(problem.code, problem.message);
  return p;
}

/** Deposit percent for a tour booking (the tour's own, else the policy's). */
export const depositPctFor = (p: TourProduct | null, policy: TourPolicy) => (p?.deposit_pct ?? policy.deposit_pct);

/** Cancellation terms for a booked tour or hire as the rider would get them now. */
export async function cancelTermsFor(t: any, now = Date.now()) {
  const policy = (await settingValue('cancellation_policy')) ?? { free_window_s: 120, scheduled_free_hours: { tour: 48, hourly: 24 }, scheduled_late_pct: 50 };
  const freeHours = policy.scheduled_free_hours?.[t.service];
  if (!freeHours || !t.scheduled_for) return null;
  const tp = await tourPolicy();
  const day = darwinParts(new Date(t.scheduled_for)).date;
  const on = t.service === 'tour' ? advisoriesOn(await loadAdvisories(), t.tour_package_id, day) : [];
  const p = t.tour_package_id ? await loadTour(t.tour_package_id) : null;
  // A closure, or heat on a heat-sensitive walk, makes cancelling free.
  const advisory = on.some((a) => a.closes || (a.kind === 'heat' && p?.heat_sensitive));
  return scheduledCancel({ quoteCents: t.quote_cents, scheduledFor: t.scheduled_for, bookedAt: t.status === 'scheduled' ? t.requested_at : null,
    freeHours, latePct: policy.scheduled_late_pct ?? 50, changeOfMindMin: tp.change_of_mind_min, advisory, now });
}

// ───────────────────────── Around a tour's life ─────────────────────────
/** Completed: the guide is owed the full fee and the partner's commission is earned. */
export async function onTourCompleted(c: pg.PoolClient, t: any) {
  if (t.service !== 'tour' || !(await toursReady())) return;
  await c.query(`UPDATE tour_guide_jobs SET status = 'owed', owed_cents = fee_cents, owed_at = now() WHERE trip_id = $1 AND status = 'assigned'`, [t.id]);
  await c.query(`UPDATE tour_commissions SET status = 'earned', earned_at = now() WHERE trip_id = $1 AND status = 'pending'`, [t.id]);
}
/** Cancelled: no commission; the guide gets the same share of their fee as the late fee is of the price (nothing if free). */
export async function onTourCancelled(c: pg.PoolClient, t: any, feeCents: number) {
  if (t.service !== 'tour' || !(await toursReady())) return;
  await c.query(`UPDATE tour_commissions SET status = 'void' WHERE trip_id = $1 AND status = 'pending'`, [t.id]);
  const share = feeCents > 0 && t.quote_cents > 0 ? feeCents / t.quote_cents : 0;
  await c.query(
    `UPDATE tour_guide_jobs SET status = CASE WHEN $2::numeric > 0 THEN 'owed' ELSE 'cancelled' END,
            owed_cents = round(fee_cents * $2::numeric)::int, owed_at = CASE WHEN $2::numeric > 0 THEN now() END
     WHERE trip_id = $1 AND status = 'assigned'`, [t.id, share]);
}

export async function assignGuide(tripId: string, guideId: string | null, actorId: string) {
  if (!(await toursReady())) throw migrationPending();
  const t = await one(`SELECT * FROM trips WHERE id = $1`, [tripId]);
  if (!t || t.service !== 'tour') throw notFound('Tour booking');
  if (!['scheduled', 'requested', 'accepted', 'arrived'].includes(t.status)) throw bad('bad_state', `The tour is ${t.status}`);
  const p = await loadTour(t.tour_package_id);
  if (p?.guided_by !== 'aboriginal_guide') throw bad('not_guided', 'This tour is not led by an Aboriginal guide');
  if (!guideId) {
    await q(`DELETE FROM tour_guide_jobs WHERE trip_id = $1 AND status = 'assigned'`, [tripId]);
    return null;
  }
  const g = await one(`SELECT * FROM tour_guides WHERE id = $1 AND active`, [guideId]);
  if (!g) throw notFound('Guide');
  const fee = Number(t.fare_breakdown?.guide_fee_cents ?? p.guide_fee_cents ?? 0);
  const job = await one(
    `INSERT INTO tour_guide_jobs (trip_id, guide_id, fee_cents, assigned_by) VALUES ($1,$2,$3,$4)
     ON CONFLICT (trip_id) DO UPDATE SET guide_id = $2, fee_cents = $3, assigned_by = $4, assigned_at = now() WHERE tour_guide_jobs.status = 'assigned'
     RETURNING *`, [tripId, guideId, fee, actorId]);
  if (!job) throw bad('already_settled', 'The guide for this tour has already been paid or settled');
  if (g.phone) {
    void sendSmsT(g.phone, 'guide_assigned', { tour: p.name, when: whenText(t.scheduled_for), pickup: t.pickup_address, ref: t.ref, cents: fee }, { tripId });
  }
  return job;
}

export const whenText = (d: Date | string) => new Intl.DateTimeFormat('en-AU', { timeZone: config.timezone, weekday: 'short', day: 'numeric', month: 'short',
  hour: 'numeric', minute: '2-digit' }).format(new Date(d)).replace(/\s?([ap])m$/i, ' $1m').replace(',', '');

/** Riders with a booked tour on a day and tour an advisory covers: told once, with what it means for them. */
export async function notifyAdvisory(a: Advisory) {
  const rows = await q(
    `SELECT t.id, t.ref, t.rider_id, t.tour_package_id, t.scheduled_for FROM trips t
     WHERE t.service = 'tour' AND t.status = 'scheduled'
       AND (t.scheduled_for AT TIME ZONE 'Australia/Darwin')::date BETWEEN $1::date AND $2::date
       AND (cardinality($3::uuid[]) = 0 OR t.tour_package_id = ANY($3::uuid[]))`, [a.starts_on, a.ends_on, a.tour_ids ?? []]);
  let n = 0;
  for (const t of rows) {
    const p = await loadTour(t.tour_package_id);
    const affects = a.closes || (a.kind === 'heat' && p?.heat_sensitive);
    void send(t.rider_id, 'tour_advisory', { ref: t.ref, tour: p?.name ?? 'your tour', title: a.title, message: a.message, free: !!affects }, { data: { trip_id: t.id } });
    n++;
  }
  if (n) toOps('tour.advisory', { id: a.id, notified: n });
  await q(`UPDATE tour_advisories SET notified = notified + $2 WHERE id = $1`, [a.id, n]).catch((e) => logError('advisory count', e));
  return n;
}

// ───────────────────────── Partners (hotels, visitor centres, tour desks) ─────────────────────────
export const TOUR_PARTNER_KINDS = ['hotel', 'visitor_centre', 'tour_desk'] as const;

/** Commission per Darwin month for a partner: earned, paid, the rows. */
export async function partnerCommissions(partnerId: string) {
  const rows = await q(
    `SELECT tc.*, t.ref, t.scheduled_for, t.status AS trip_status, p.name AS tour_name,
            to_char(coalesce(tc.earned_at, tc.created_at) AT TIME ZONE 'Australia/Darwin', 'YYYY-MM') AS month
     FROM tour_commissions tc JOIN trips t ON t.id = tc.trip_id LEFT JOIN tour_packages p ON p.id = t.tour_package_id
     WHERE tc.partner_id = $1 ORDER BY tc.created_at DESC LIMIT 500`, [partnerId]);
  const months = new Map<string, { month: string; earned_cents: number; paid_cents: number; pending_cents: number; bookings: number }>();
  for (const r of rows) {
    const m = months.get(r.month) ?? { month: r.month, earned_cents: 0, paid_cents: 0, pending_cents: 0, bookings: 0 };
    m.bookings++;
    if (r.status === 'earned') m.earned_cents += r.cents;
    if (r.status === 'paid') m.paid_cents += r.cents;
    if (r.status === 'pending') m.pending_cents += r.cents;
    months.set(r.month, m);
  }
  return { months: [...months.values()].sort((a, b) => b.month.localeCompare(a.month)), items: rows };
}

// ───────────────────────── Hire quotes ─────────────────────────
export async function quoteHire(req: HireRequest) {
  const rule = await one<FareRule>(`SELECT * FROM fare_rules WHERE service = 'hourly'`);
  if (!rule) throw notFound('Hourly hire');
  return hireQuote(rule, req, (await tourPolicy()).hire);
}

/** Send (or re-send) a quote: a private link the customer opens to accept, valid for the policy's days. */
export async function sendHireQuote(id: string, req: HireRequest & { start_date?: string | null; note?: string | null; total_override_cents?: number | null }) {
  if (!(await toursReady())) throw migrationPending();
  const h = await one(`SELECT * FROM hire_requests WHERE id = $1`, [id]);
  if (!h) throw notFound('Hire request');
  if (h.accepted_at) throw bad('already_accepted', 'The customer has already accepted a quote');
  const quote: any = await quoteHire(req);
  if (req.total_override_cents != null) {
    quote.lines.push({ label: 'Adjusted by DingoGo', cents: req.total_override_cents - quote.total_cents });
    quote.total_cents = req.total_override_cents; quote.gst_cents = Math.round(req.total_override_cents / 11);
  }
  quote.note = req.note ?? null;
  const policy = await tourPolicy();
  const token = h.quote_token ?? crypto.randomBytes(18).toString('base64url');
  const row = await one(
    `UPDATE hire_requests SET quote = $2, quote_cents = $3, quote_token = $4, quote_sent_at = now(), quote_expires_at = now() + make_interval(days => $5),
            start_date = coalesce($6::date, start_date, event_date), status = 'quoted' WHERE id = $1 RETURNING *`,
    [id, JSON.stringify(quote), quote.total_cents, token, policy.hire.quote_valid_days, req.start_date ?? null]);
  const url = `${config.publicWebUrl}/hire/${token}`;
  let texted = false;
  if (h.contact_phone) texted = (await sendSmsT(h.contact_phone, 'hire_quote', { name: h.contact_name.split(' ')[0], cents: quote.total_cents, url, days: policy.hire.quote_valid_days })).sent;
  return { item: row, url, texted };
}

/** What the customer sees on the quote link (no staff notes, no other requests). */
export async function publicHireQuote(token: string) {
  if (!(await toursReady()) || !/^[A-Za-z0-9_-]{20,40}$/.test(token)) throw notFound('Quote');
  const h = await one(`SELECT * FROM hire_requests WHERE quote_token = $1`, [token]);
  if (!h || !h.quote) throw notFound('Quote');
  const cancel = (await settingValue('cancellation_policy')) ?? { scheduled_free_hours: { hourly: 24 }, scheduled_late_pct: 50 };
  return {
    quote: {
      kind: h.kind, contact_name: h.contact_name, organisation: h.organisation, start_date: h.start_date ?? h.event_date, passengers: h.passengers,
      ...h.quote, expires_at: h.quote_expires_at, expired: !h.accepted_at && new Date(h.quote_expires_at) < new Date(),
      accepted_at: h.accepted_at, accepted_name: h.accepted_name, status: h.status,
      terms: {
        free_cancel_hours: cancel.scheduled_free_hours?.hourly ?? 24, late_pct: cancel.scheduled_late_pct ?? 50,
        text: `Free to cancel up to ${cancel.scheduled_free_hours?.hourly ?? 24} hours before the start. After that, ${cancel.scheduled_late_pct ?? 50}% of the price for that day. Drivers work at most 10 hours a day with breaks.`,
      },
    },
  };
}

export async function acceptHireQuote(token: string, name: string) {
  if (!(await toursReady()) || !/^[A-Za-z0-9_-]{20,40}$/.test(token)) throw notFound('Quote');
  const h = await one(`SELECT * FROM hire_requests WHERE quote_token = $1`, [token]);
  if (!h || !h.quote) throw notFound('Quote');
  if (h.accepted_at) return publicHireQuote(token);  // a second tap is fine
  if (new Date(h.quote_expires_at) < new Date()) throw bad('quote_expired', 'This quote has expired. Reply to us and we will send a new one.');
  if (h.status === 'declined') throw bad('quote_withdrawn', 'This quote is no longer available');
  const row = await one(`UPDATE hire_requests SET accepted_at = now(), accepted_name = $2, status = 'confirmed' WHERE id = $1 AND accepted_at IS NULL RETURNING *`, [h.id, name.trim()]);
  if (row) {
    await q(`INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES (NULL, 'hire_quote_accepted', 'hire_requests', $1, $2)`,
      [h.id, JSON.stringify({ name: name.trim(), cents: h.quote_cents })]);
    toOps('hire.accepted', { id: h.id, cents: h.quote_cents });
  }
  return publicHireQuote(token);
}

