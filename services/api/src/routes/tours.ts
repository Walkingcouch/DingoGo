/**
 * Round 19: tours, hire and tourism. Public tour catalogue in visitor languages with availability, advisories, safety advice
 * and hotel pickups; hire quotes the customer accepts by link; rider cancellation terms; hotel / visitor-centre bookings for
 * guests with commission; admin advisories, Aboriginal guides and their payments, commissions, hire quotes and the policy.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { one, q, tx } from '../db.js';
import { requireUser } from '../auth.js';
import { ApiError, bad, forbidden, notFound } from '../lib/errors.js';
import { limit } from '../lib/rateLimit.js';
import { audit } from '../lib/audit.js';
import { toCsv, dollars } from '../lib/csv.js';
import { latLng, parse, phone, z } from '../lib/validate.js';
import { referralCode } from '../lib/ids.js';
import { invalidateConfig, settingValue } from '../lib/cache.js';
import {
  ADVISORY_KINDS, PROTOCOLS, VISITOR_LANGS, VISITOR_LANG_NAMES, availability, checkTourPolicy, darwinParts, isVisitorLang, localiseTour, safetyFor,
  type TourProduct,
} from '../lib/tours.js';
import * as tours from '../services/tours.js';
import * as trips from '../services/trips.js';
import { sendSmsT } from '../services/notify.js';

/** Each desk booking texts the guest: a cap per desk a day (Round 26). */
export const PARTNER_TOUR_BOOKINGS_PER_DAY = 40;
const ops = (req: FastifyRequest) => requireUser(req, 'admin', 'dispatcher');
const admin = (req: FastifyRequest) => requireUser(req, 'admin');
const langOf = (req: FastifyRequest) => {
  const l = String((req.query as any)?.lang ?? '').slice(0, 5).toLowerCase();
  return isVisitorLang(l) ? l : 'en';
};

/** What the catalogue shows about money: deposit, the 48-hour rule and change of mind. */
async function termsSummary() {
  const policy = await tours.tourPolicy();
  const cancel = (await settingValue('cancellation_policy')) ?? { scheduled_free_hours: { tour: 48, hourly: 24 }, scheduled_late_pct: 50 };
  return {
    deposit_pct: policy.deposit_pct, change_of_mind_min: policy.change_of_mind_min,
    free_cancel_hours: cancel.scheduled_free_hours?.tour ?? 48, hire_free_cancel_hours: cancel.scheduled_free_hours?.hourly ?? 24,
    late_pct: cancel.scheduled_late_pct ?? 50, hire: policy.hire,
  };
}

const view = (p: TourProduct, lang: string) => {
  const l = localiseTour(p, lang);
  const { translations, ...rest } = l;
  return { ...rest, has_translation: Object.keys(translations ?? {}), protocols: Object.fromEntries(p.itinerary.flatMap((s) => s.protocols ?? []).map((k) => [k, PROTOCOLS[k]])) };
};

async function catalogue(req: FastifyRequest) {
  const lang = langOf(req);
  const [list, advisories, terms] = await Promise.all([tours.loadTours(true), tours.loadAdvisories(), termsSummary()]);
  return {
    tours: list.map((p) => view(p, lang)),
    lang, languages: Object.fromEntries(VISITOR_LANGS.map((l) => [l, { ...VISITOR_LANG_NAMES[l], status: 'machine' }])),
    advisories: advisories.map(({ id, kind, title, message, starts_on, ends_on, tour_ids, latest_start, closes }) => ({ id, kind, title, message, starts_on, ends_on, tour_ids, latest_start, closes })),
    terms,
  };
}

/** Hotels, visitor centres and tour desks that are DingoGo partners: offered as pickup points. */
async function pickupPoints() {
  if (!(await tours.toursReady())) return [];
  return q(`SELECT id, name, kind, address, lat, lng FROM partners WHERE active AND kind = ANY($1) AND lat IS NOT NULL ORDER BY name`, [tours.TOUR_PARTNER_KINDS]);
}

export default async function tourRoutes(app: FastifyInstance) {
  // ───────────── Catalogue (public and in the rider app) ─────────────
  app.get('/public/tours', async (req) => catalogue(req));
  app.get('/tours', async (req) => { await requireUser(req); return catalogue(req); });

  app.get('/public/tours/:slug', async (req) => {
    const p = await tours.loadTour((req.params as any).slug);
    if (!p || !p.active) throw notFound('Tour');
    const guests = Math.min(Math.max(Number((req.query as any).guests ?? 2) || 2, 1), p.max_passengers);
    return { tour: view(p, langOf(req)), safety: safetyFor(p, darwinParts(new Date()).month, guests), pickups: p.hotel_pickup ? await pickupPoints() : [], terms: await termsSummary() };
  });

  /** Start times by Darwin date for the next `days` (max 62), with the reason a time can't be booked. */
  app.get('/public/tours/:slug/availability', async (req) => {
    const p = await tours.loadTour((req.params as any).slug);
    if (!p || !p.active) throw notFound('Tour');
    const qs = req.query as any;
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(qs.from ?? '')) ? String(qs.from) : darwinParts(new Date()).date;
    const days = Math.min(Math.max(Number(qs.days ?? 14) || 14, 1), 62);
    return { tour_id: p.id, from, days: availability(p, await tours.loadAdvisories(), from, days) };
  });

  app.get('/public/tour-advisories', async () => ({ advisories: (await catalogue({ query: {} } as any)).advisories }));
  app.get('/public/tour-pickups', async () => ({ pickups: await pickupPoints() }));

  // ───────────── Hire ─────────────
  /** Price calculator for hire by the hour / day / car (no booking). */
  app.post('/public/hire/quote', async (req) => {
    const b = parse(z.object({ hours_per_day: z.number().min(0.5).max(24), days: z.number().int().min(1).max(30), vehicles: z.number().int().min(1).max(20) }), req.body);
    return { quote: await tours.quoteHire(b) };
  });
  app.get('/public/hire/:token', async (req) => tours.publicHireQuote((req.params as any).token));
  app.post('/public/hire/:token/accept', async (req) => {
    const b = parse(z.object({ name: z.string().min(2).max(80), agree: z.literal(true) }), req.body);
    await limit('hire_accept_ip', req.ip, 20, 3600);
    return tours.acceptHireQuote((req.params as any).token, b.name);
  });

  // ───────────── Rider ─────────────
  /** What cancelling a booked tour or hire would cost now (fee, deposit back, until when it's free). */
  app.get('/trips/:id/cancel-terms', async (req) => {
    const me = await requireUser(req);
    const t = await one(`SELECT * FROM trips WHERE id = $1`, [(req.params as any).id]);
    if (!t || t.rider_id !== me.id) throw notFound('Trip');
    const terms = await tours.cancelTermsFor(t);
    const dep = t.fare_breakdown?.deposit?.status === 'paid' ? Number(t.fare_breakdown.deposit.cents) : 0;
    const fee = terms?.fee_cents ?? null;
    return { terms, deposit_cents: dep, deposit_back_cents: fee == null ? null : Math.max(0, dep - fee), extra_charge_cents: fee == null ? null : Math.max(0, fee - dep) };
  });

  // ───────────── Partners: hotels, visitor centres, tour desks ─────────────
  const tourPartner = async (req: any) => {
    const me = await requireUser(req, 'partner', 'admin');
    const pid = me.role === 'admin' ? (req.query?.partner_id ?? req.body?.partner_id ?? me.partner_id) : me.partner_id;
    if (!pid) throw forbidden('No partner business linked to this account');
    if (!(await tours.toursReady())) throw tours.migrationPending();
    const p = await one(`SELECT * FROM partners WHERE id = $1 AND active`, [pid]);
    if (!p) throw forbidden('This partner account is switched off');
    if (!(tours.TOUR_PARTNER_KINDS as readonly string[]).includes(p.kind)) throw forbidden('Tour bookings are for hotels, visitor centres and tour desks');
    return { me, p };
  };

  app.get('/partner/tours', async (req) => {
    const { p } = await tourPartner(req);
    const [list, bookings, terms] = await Promise.all([
      tours.loadTours(true),
      q(`SELECT t.id, t.ref, t.status, t.scheduled_for, t.passengers, t.quote_cents, t.pickup_address, tp.name AS tour_name,
                split_part(u.name, ' ', 1) AS guest, right(u.phone, 3) AS guest_phone_last3, tc.cents AS commission_cents, tc.status AS commission_status
         FROM tour_commissions tc JOIN trips t ON t.id = tc.trip_id JOIN users u ON u.id = t.rider_id LEFT JOIN tour_packages tp ON tp.id = t.tour_package_id
         WHERE tc.partner_id = $1 ORDER BY t.scheduled_for DESC LIMIT 100`, [p.id]),
      termsSummary(),
    ]);
    return { partner: { id: p.id, name: p.name, kind: p.kind, address: p.address, lat: p.lat, lng: p.lng, commission_pct: Number(p.tour_commission_pct), account_linked: !!p.corporate_account_id },
      tours: list.map((t) => view(t, 'en')), bookings, terms };
  });

  /** Book a tour for a guest at the desk. Billed to the partner's DingoGo business account; the guest is texted. */
  app.post('/partner/tours/bookings', async (req, reply) => {
    const { me, p } = await tourPartner(req);
    const b = parse(z.object({
      tour_id: z.string().uuid(), scheduled_for: z.string().datetime(), guests: z.number().int().min(1).max(13),
      guest_name: z.string().min(1).max(80), guest_phone: phone, pickup: latLng.optional(), notes: z.string().max(300).optional(),
    }), req.body);
    if (!p.corporate_account_id) throw new ApiError(409, 'partner_account_required', 'Ask DingoGo to link a business account to your desk before booking for guests');
    const tour = await tours.loadTour(b.tour_id);
    if (!tour || !tour.active) throw notFound('Tour');
    const pickup = b.pickup ?? (p.lat != null ? { lat: p.lat, lng: p.lng, address: p.address ?? p.name } : null);
    if (!pickup) throw bad('pickup_required', 'Add a pickup address');
    // Round 26: the guest's own mobile only — not a closed account, a driver's or a DingoGo staff number (the trip would be theirs).
    let u = await one('SELECT * FROM users WHERE phone = $1', [b.guest_phone]);
    if (u?.deleted_at) throw bad('guest_phone', 'That number belongs to a closed DingoGo account. Use another mobile for the guest.', { field: 'guest_phone' });
    if (u && u.role !== 'rider') throw bad('guest_phone', 'That number belongs to a DingoGo staff or driver account. Use the guest’s own mobile.', { field: 'guest_phone' });
    await limit('partner_tour_booking', p.id, PARTNER_TOUR_BOOKINGS_PER_DAY, 86400, 'That is a lot of tour bookings from this desk today. Call DingoGo to book more.');
    if (!u) u = await one(`INSERT INTO users (phone, name, referral_code) VALUES ($1,$2,$3) RETURNING *`, [b.guest_phone, b.guest_name, referralCode(b.guest_name)]);
    const trip = await trips.createTrip(u.id, {
      kind: 'ride', service: 'tour', tour_package_id: tour.id, pickup, dropoff: pickup, scheduled_for: b.scheduled_for, passengers: b.guests,
      notes: b.notes, payment_method: 'corporate', corporate_account_id: p.corporate_account_id, channel: 'partner', booked_by: me.id,
    });
    // Commission on the tour price (not the levy or a guide's fee), fixed at booking; earned when the tour is done.
    const pct = Number(p.tour_commission_pct);
    const base = Number(trip.fare_breakdown?.trip_cents ?? tour.price_cents);
    const cents = Math.round((base * pct) / 100);
    await q(`INSERT INTO tour_commissions (trip_id, partner_id, booked_by, pct, base_cents, cents) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (trip_id) DO NOTHING`,
      [trip.id, p.id, me.id, pct, base, cents]);
    void sendSmsT(b.guest_phone, 'tour_booked_for_you', { partner: p.name, tour: tour.name, ref: trip.ref, when: tours.whenText(trip.scheduled_for), pickup: pickup.address ?? p.name }, { tripId: trip.id });
    await audit(me.id, 'partner_tour_booking', 'trip', trip.id, { partner_id: p.id, tour_id: tour.id, guests: b.guests });
    reply.code(201);
    return { booking: { id: trip.id, ref: trip.ref, status: trip.status, scheduled_for: trip.scheduled_for, quote_cents: trip.quote_cents, commission_cents: cents } };
  });

  app.post('/partner/tours/bookings/:id/cancel', async (req) => {
    const { me, p } = await tourPartner(req);
    const c = await one(`SELECT * FROM tour_commissions WHERE trip_id = $1 AND partner_id = $2`, [(req.params as any).id, p.id]);
    if (!c) throw notFound('Booking');
    // Cancelled as the desk (staff of the account billed): the same 48-hour terms as the guest.
    const t = await one(`SELECT rider_id FROM trips WHERE id = $1`, [c.trip_id]);
    const out = await trips.cancelTrip({ id: t.rider_id, role: 'rider' }, c.trip_id, `Cancelled by ${p.name}`);
    await audit(me.id, 'partner_tour_cancel', 'trip', c.trip_id, { partner_id: p.id, fee: out.cancel_fee_cents });
    return { booking: { id: out.id, ref: out.ref, status: out.status, cancel_fee_cents: out.cancel_fee_cents } };
  });

  app.get('/partner/tours/commissions', async (req) => {
    const { p } = await tourPartner(req);
    const r = await tours.partnerCommissions(p.id);
    if ((req.query as any).format === 'csv') {
      return toCsv([['Month', (x: any) => x.month], ['Booking', (x: any) => x.ref], ['Tour', (x: any) => x.tour_name], ['Status', (x: any) => x.status],
        ['Tour price', (x: any) => dollars(x.base_cents)], ['Rate %', (x: any) => x.pct], ['Commission', (x: any) => dollars(x.cents)], ['Paid ref', (x: any) => x.paid_ref ?? '']], r.items);
    }
    return { commission_pct: Number(p.tour_commission_pct), ...r };
  });

  // ───────────── Admin ─────────────
  app.get('/admin/tour-policy', async (req) => { await ops(req); return { policy: await tours.tourPolicy(), terms: await termsSummary() }; });
  app.put('/admin/tour-policy', async (req) => {
    const me = await admin(req);
    const value = checkTourPolicy((req.body as any)?.policy ?? req.body);
    await q(`INSERT INTO settings (key, value) VALUES ('tour_policy', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(value)]);
    invalidateConfig();
    await audit(me.id, 'update', 'settings', 'tour_policy', value);
    return { policy: value };
  });

  const advisoryBody = z.object({
    kind: z.enum(ADVISORY_KINDS), title: z.string().min(3).max(80), message: z.string().min(3).max(400),
    starts_on: z.string().date(), ends_on: z.string().date(), tour_ids: z.array(z.string().uuid()).max(50).default([]),
    latest_start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).nullable().optional(), closes: z.boolean().default(false), active: z.boolean().default(true),
    notify: z.boolean().default(true),
  });
  app.get('/admin/tour-advisories', async (req) => {
    await ops(req);
    if (!(await tours.toursReady())) return { items: [], ready: false };
    return { items: await q(`SELECT *, starts_on::text AS starts_on, ends_on::text AS ends_on FROM tour_advisories ORDER BY tour_advisories.ends_on DESC, tour_advisories.starts_on DESC LIMIT 200`), ready: true };
  });
  app.post('/admin/tour-advisories', async (req, reply) => {
    const me = await ops(req);
    if (!(await tours.toursReady())) throw tours.migrationPending();
    const b = parse(advisoryBody, req.body);
    if (b.ends_on < b.starts_on) throw bad('invalid_dates', 'The end date is before the start date');
    if (b.kind === 'heat' && !b.latest_start && !b.closes) throw bad('latest_start_required', 'A heat advisory sets the latest start for walks, or closes the tours');
    const a = await one(
      `INSERT INTO tour_advisories (kind, title, message, starts_on, ends_on, tour_ids, latest_start, closes, active, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *, starts_on::text AS starts_on, ends_on::text AS ends_on`,
      [b.kind, b.title, b.message, b.starts_on, b.ends_on, b.tour_ids, b.latest_start ?? null, b.closes, b.active, me.id]);
    invalidateConfig('tour_advisories');
    const notified = b.notify && b.active ? await tours.notifyAdvisory(a) : 0;
    await audit(me.id, 'create', 'tour_advisories', a.id, { ...b, notified });
    reply.code(201);
    return { item: a, notified };
  });
  app.patch('/admin/tour-advisories/:id', async (req) => {
    const me = await ops(req);
    if (!(await tours.toursReady())) throw tours.migrationPending();
    const b = parse(advisoryBody.partial().omit({ notify: true }), req.body);
    const sets = Object.keys(b).map((k, i) => `${k} = $${i + 2}`);
    if (!sets.length) throw bad('empty');
    const a = await one(`UPDATE tour_advisories SET ${sets.join(', ')} WHERE id = $1 RETURNING *, starts_on::text AS starts_on, ends_on::text AS ends_on`,
      [(req.params as any).id, ...Object.values(b)]);
    if (!a) throw notFound();
    invalidateConfig('tour_advisories');
    await audit(me.id, 'update', 'tour_advisories', a.id, b);
    return { item: a };
  });

  // Guides: who they are (name shown to guests only with consent), what they're owed and paid.
  const guideBody = z.object({
    name: z.string().min(2).max(80), phone: phone.nullable().optional(), email: z.string().email().nullable().optional(), community: z.string().max(120).nullable().optional(),
    bio: z.string().max(1000).nullable().optional(), show_name: z.boolean().optional(), abn: z.string().regex(/^\d{11}$/, 'ABN is 11 digits').nullable().optional(),
    bank_ref: z.string().max(80).nullable().optional(), active: z.boolean().optional(),
  });
  app.get('/admin/tour-guides', async (req) => {
    await ops(req);
    if (!(await tours.toursReady())) return { items: [], ready: false };
    return { ready: true, items: await q(
      `SELECT g.*, coalesce(sum(j.owed_cents) FILTER (WHERE j.status = 'owed'), 0)::int AS owed_cents, count(j.*) FILTER (WHERE j.status = 'assigned')::int AS upcoming
       FROM tour_guides g LEFT JOIN tour_guide_jobs j ON j.guide_id = g.id GROUP BY g.id ORDER BY g.active DESC, g.name`) };
  });
  app.post('/admin/tour-guides', async (req, reply) => {
    const me = await admin(req);
    if (!(await tours.toursReady())) throw tours.migrationPending();
    const b = parse(guideBody, req.body);
    const keys = Object.keys(b);
    const g = await one(`INSERT INTO tour_guides (${keys.join(',')}) VALUES (${keys.map((_, i) => `$${i + 1}`).join(',')}) RETURNING *`, Object.values(b));
    await audit(me.id, 'create', 'tour_guides', g.id, { name: b.name });
    reply.code(201);
    return { item: g };
  });
  app.patch('/admin/tour-guides/:id', async (req) => {
    const me = await admin(req);
    if (!(await tours.toursReady())) throw tours.migrationPending();
    const b = parse(guideBody.partial(), req.body);
    const keys = Object.keys(b);
    if (!keys.length) throw bad('empty');
    const g = await one(`UPDATE tour_guides SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *`, [(req.params as any).id, ...Object.values(b)]);
    if (!g) throw notFound();
    await audit(me.id, 'update', 'tour_guides', g.id, { fields: keys });
    return { item: g };
  });

  /** Upcoming tour and hire bookings for ops: guide, partner and deposit at a glance. */
  app.get('/admin/tour-bookings', async (req) => {
    await ops(req);
    const ready = await tours.toursReady();
    const items = await q(
      `SELECT t.id, t.ref, t.service, t.status, t.scheduled_for, t.passengers, t.quote_cents, t.payment_method, t.payment_status, t.pickup_address,
              t.channel, t.tour_package_id, t.est_duration_s, tp.name AS tour_name, u.name AS rider_name, t.fare_breakdown->'deposit' AS deposit
              ${ready ? `, j.guide_id, j.status AS guide_status, g.name AS guide_name, pa.name AS partner_name, tc.cents AS commission_cents` : ''}
       FROM trips t JOIN users u ON u.id = t.rider_id LEFT JOIN tour_packages tp ON tp.id = t.tour_package_id
       ${ready ? `LEFT JOIN tour_guide_jobs j ON j.trip_id = t.id LEFT JOIN tour_guides g ON g.id = j.guide_id
                  LEFT JOIN tour_commissions tc ON tc.trip_id = t.id LEFT JOIN partners pa ON pa.id = tc.partner_id` : ''}
       WHERE t.service IN ('tour','hourly') AND (t.status IN ('scheduled','requested','accepted','arrived','in_progress') OR t.scheduled_for > now() - interval '7 days')
       ORDER BY t.scheduled_for NULLS LAST LIMIT 300`);
    const list = await tours.loadTours(false);
    for (const it of items) (it as any).guided = list.find((p) => p.id === it.tour_package_id)?.guided_by === 'aboriginal_guide';
    return { items, ready };
  });
  app.post('/admin/trips/:id/guide', async (req) => {
    const me = await ops(req);
    const b = parse(z.object({ guide_id: z.string().uuid().nullable() }), req.body);
    const job = await tours.assignGuide((req.params as any).id, b.guide_id, me.id);
    await audit(me.id, 'assign_guide', 'trip', (req.params as any).id, b);
    return { job };
  });

  app.get('/admin/tour-guide-jobs', async (req) => {
    await ops(req);
    if (!(await tours.toursReady())) return { items: [], ready: false };
    const items = await q(
      `SELECT j.*, g.name AS guide_name, g.abn, g.bank_ref, t.ref, t.status AS trip_status, t.scheduled_for, tp.name AS tour_name
       FROM tour_guide_jobs j JOIN tour_guides g ON g.id = j.guide_id JOIN trips t ON t.id = j.trip_id LEFT JOIN tour_packages tp ON tp.id = t.tour_package_id
       ORDER BY (j.status = 'owed') DESC, t.scheduled_for DESC LIMIT 300`);
    if ((req.query as any).format === 'csv') {
      return toCsv([['Guide', (x: any) => x.guide_name], ['ABN', (x: any) => x.abn ?? ''], ['Booking', (x: any) => x.ref], ['Tour', (x: any) => x.tour_name],
        ['Date', (x: any) => x.scheduled_for ? new Date(x.scheduled_for).toISOString().slice(0, 10) : ''], ['Status', (x: any) => x.status],
        ['Fee', (x: any) => dollars(x.fee_cents)], ['Owed', (x: any) => dollars(x.owed_cents)], ['Paid ref', (x: any) => x.paid_ref ?? '']], items);
    }
    return { items, ready: true };
  });
  /** Mark guide jobs paid (one payment run with one reference). Only what's owed is marked. */
  app.post('/admin/tour-guide-jobs/pay', async (req) => {
    const me = await admin(req);
    if (!(await tours.toursReady())) throw tours.migrationPending();
    const b = parse(z.object({ trip_ids: z.array(z.string().uuid()).min(1).max(200), paid_ref: z.string().min(2).max(80) }), req.body);
    const rows = await q(`UPDATE tour_guide_jobs SET status = 'paid', paid_at = now(), paid_ref = $2, paid_by = $3 WHERE trip_id = ANY($1) AND status = 'owed' RETURNING trip_id, owed_cents`,
      [b.trip_ids, b.paid_ref, me.id]);
    await audit(me.id, 'pay_guides', 'tour_guide_jobs', String(rows.length), { ...b, cents: rows.reduce((n, r) => n + r.owed_cents, 0) });
    return { paid: rows.length, cents: rows.reduce((n, r) => n + r.owed_cents, 0) };
  });

  app.get('/admin/tour-commissions', async (req) => {
    await ops(req);
    if (!(await tours.toursReady())) return { partners: [], ready: false };
    const rows = await q(
      `SELECT p.id AS partner_id, p.name, p.kind, p.tour_commission_pct, p.corporate_account_id,
              to_char(tc.earned_at AT TIME ZONE 'Australia/Darwin', 'YYYY-MM') AS month,
              count(tc.*) FILTER (WHERE tc.status = 'earned')::int AS earned_n, coalesce(sum(tc.cents) FILTER (WHERE tc.status = 'earned'), 0)::int AS earned_cents,
              coalesce(sum(tc.cents) FILTER (WHERE tc.status = 'paid'), 0)::int AS paid_cents, coalesce(sum(tc.cents) FILTER (WHERE tc.status = 'pending'), 0)::int AS pending_cents
       FROM partners p LEFT JOIN tour_commissions tc ON tc.partner_id = p.id
       WHERE p.kind = ANY($1) GROUP BY p.id, month ORDER BY p.name, month DESC NULLS LAST`, [tours.TOUR_PARTNER_KINDS]);
    return { partners: rows, ready: true };
  });
  /** Mark a partner's earned commission for a Darwin month paid. A month still running can't be paid. */
  app.post('/admin/tour-commissions/pay', async (req) => {
    const me = await admin(req);
    if (!(await tours.toursReady())) throw tours.migrationPending();
    const b = parse(z.object({ partner_id: z.string().uuid(), month: z.string().regex(/^\d{4}-\d{2}$/), paid_ref: z.string().min(2).max(80) }), req.body);
    if (b.month >= darwinParts(new Date()).date.slice(0, 7)) throw bad('month_open', 'That month is not over yet');
    const rows = await tx(async (c) => q(
      `UPDATE tour_commissions SET status = 'paid', paid_at = now(), paid_ref = $3 WHERE partner_id = $1 AND status = 'earned'
         AND to_char(earned_at AT TIME ZONE 'Australia/Darwin', 'YYYY-MM') = $2 RETURNING cents`, [b.partner_id, b.month, b.paid_ref], c));
    await audit(me.id, 'pay_commission', 'tour_commissions', b.partner_id, { ...b, bookings: rows.length });
    return { paid: rows.length, cents: rows.reduce((n, r) => n + r.cents, 0) };
  });

  // Hire quotes: worked out from the hourly rule and sent to the customer with a link to accept.
  app.post('/admin/hire-requests/:id/quote', async (req) => {
    const me = await ops(req);
    const b = parse(z.object({
      hours_per_day: z.number().min(0.5).max(24), days: z.number().int().min(1).max(30), vehicles: z.number().int().min(1).max(20),
      start_date: z.string().date().nullable().optional(), note: z.string().max(500).nullable().optional(), total_override_cents: z.number().int().min(0).max(10_000_000).nullable().optional(),
    }), req.body);
    const out = await tours.sendHireQuote((req.params as any).id, b);
    await audit(me.id, 'hire_quote', 'hire_requests', (req.params as any).id, { ...b, total: out.item.quote_cents, texted: out.texted });
    return { ...out, item: { ...out.item, quote_token: undefined } };
  });

}
