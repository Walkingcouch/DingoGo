/**
 * Round 28: remote and regional reach (database side). Community routes policy; long-trip safety checks; scheduled shared shuttles
 * with seat and parcel bookings, the driver's manifest and the store pickup; booking by text and from the low-data page; community
 * store top-ups of DingoGo credit for cash; caller lookup for phone bookings.
 *
 * Needs migration 028 (`regionalReady()`): before it the routes, prices and notes still show, and bookings answer 503 migration_pending.
 * Seats and parcels are paid with DingoGo credit (wallet), taken when the booking is confirmed and given back when it is cancelled
 * before the cut-off or the run is cancelled.
 */
import { isIsoMonth } from '../lib/validate.js';
import { config } from '../config.js';
import { one, pool, q, tx, type Q } from '../db.js';
import { audit } from '../lib/audit.js';
import { settingValue, invalidateConfig } from '../lib/cache.js';
import { auMobile } from '../lib/courier.js';
import { ApiError, bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { collectCode, referralCode, runRef, seatRef, sha256, topupRef } from '../lib/ids.js';
import { firstName } from '../lib/messages.js';
import { record, tooMany } from '../lib/rateLimit.js';
import {
  checkRegionalPolicy, checkTopup, dayFilter, findCorridor, longestGapMin, parcelPrice, parseSms, readRegionalPolicy, runDriverPay, runLabel,
  seatPrice, shuttleTimes, whenText, type Corridor, type RegionalPolicy, type SmsCommand,
} from '../lib/regional.js';
import { darwinParts } from '../lib/tours.js';
import { toOps } from '../realtime.js';
import { sendSmsT } from './notify.js';

// ── Migration 028 ──
let ready = false; let checkedAt = 0;
export async function regionalReady(): Promise<boolean> {
  if (ready) return true;
  if (checkedAt && Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const r = await one<{ n: number }>(
      `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()
                 AND table_name IN ('regional_runs', 'regional_bookings', 'partner_topups'))::int
            + (SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'drivers' AND column_name = 'long_trips')::int AS n`);
    ready = r?.n === 4;
  } catch { ready = false; }
  return ready;
}
export function resetRegionalReady() { ready = false; checkedAt = 0; }
export const regionalPending = () => new ApiError(503, 'migration_pending', 'Community trips need database migration 028. Call DingoGo to book for now.');
export async function needRegional() { if (!(await regionalReady())) throw regionalPending(); }

export async function regionalPolicy(): Promise<RegionalPolicy> {
  return readRegionalPolicy(await settingValue('regional_policy').catch(() => null));
}
export async function saveRegionalPolicy(actorId: string, value: unknown) {
  const p = checkRegionalPolicy(value);
  await q(`INSERT INTO settings (key, value) VALUES ('regional_policy', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [JSON.stringify(p)]);
  invalidateConfig('setting:regional_policy');
  await audit(actorId, 'regional_policy_updated', 'settings', 'regional_policy', { corridors: p.corridors.map((c) => ({ id: c.id, active: c.active, private_cents: c.private_cents, seat_cents: c.seat_cents })) });
  return p;
}
export const supportPhone = async () => ((await settingValue('support').catch(() => null))?.phone as string | undefined) ?? null;

/** What riders, the website and the low-data page see about a route (no partner ids). */
export function publicCorridor(c: Corridor) {
  return {
    id: c.id, name: c.name, place: c.place, road_km: c.road_km, minutes: c.minutes, unsealed_km: c.unsealed_km, active: c.active,
    private_cents: c.private_cents, return_discount_pct: c.return_discount_pct, seat_cents: c.seat_cents, parcel_cents: c.parcel_cents,
    shuttle_days: c.shuttle_days, depart_out: c.depart_out, depart_back: c.depart_back,
    pickup_points: c.pickup_points.map((p) => ({ id: p.id, name: p.name, side: p.side, lat: p.lat, lng: p.lng, parcels: p.parcels, note: p.note })),
    permit_note: c.permit_note, coverage_gaps: c.coverage_gaps, fuel_note: c.fuel_note, confirmed: c.confirmed,
  };
}

// ───────────────────────── Runs ─────────────────────────
const TAKEN = `coalesce((SELECT sum(b.seats) FROM regional_bookings b WHERE b.run_id = r.id AND b.kind = 'seat'
  AND (b.status IN ('booked','boarded') OR (b.status = 'pending' AND b.hold_until > now()))), 0)::int`;
const PARCELS = `(SELECT count(*) FROM regional_bookings b WHERE b.run_id = r.id AND b.kind = 'parcel'
  AND (b.status IN ('booked','at_store','collected','delivered') OR (b.status = 'pending' AND b.hold_until > now())))::int`;
const RUN_COLS = `r.*, ${TAKEN} AS seats_taken, ${PARCELS} AS parcels_taken, du.name AS driver_name`;

function runView(r: any, policy: RegionalPolicy) {
  const c = policy.corridors.find((x) => x.id === r.corridor);
  return {
    id: r.id, ref: r.ref, corridor: r.corridor, direction: r.direction, label: c ? runLabel(c, r.direction) : r.corridor,
    departs_at: r.departs_at, when: whenText(r.departs_at), seats: r.seats, seats_taken: Number(r.seats_taken ?? 0),
    seats_left: Math.max(0, r.seats - Number(r.seats_taken ?? 0)), parcel_capacity: r.parcel_capacity, parcels_taken: Number(r.parcels_taken ?? 0),
    status: r.status, driver_id: r.driver_id, driver_name: r.driver_name ? firstName(r.driver_name) : null, notes: r.notes,
    last_checkin_at: r.last_checkin_at, departed_at: r.departed_at, completed_at: r.completed_at,
    seat_cents: c?.seat_cents ?? null, parcel_cents: c?.parcel_cents ?? null,
  };
}
export type RunView = ReturnType<typeof runView>;

export async function listRuns(o: { from?: Date; days?: number; corridor?: string; open?: boolean; driverId?: string } = {}) {
  const policy = await regionalPolicy();
  const from = o.from ?? new Date(Date.now() - 12 * 3600_000);
  const to = new Date(from.getTime() + (o.days ?? 21) * 86400_000);
  const rows = await q(
    `SELECT ${RUN_COLS} FROM regional_runs r LEFT JOIN users du ON du.id = r.driver_id
     WHERE r.departs_at BETWEEN $1 AND $2 AND ($3::text IS NULL OR r.corridor = $3) AND ($4::boolean IS NOT TRUE OR r.status = 'open')
       AND ($5::uuid IS NULL OR r.driver_id = $5) ORDER BY r.departs_at LIMIT 300`,
    [from, to, o.corridor ?? null, o.open ?? null, o.driverId ?? null]);
  return rows.map((r) => runView(r, policy));
}
/** Open runs riders can still book (before the cut-off), on active routes. */
export async function bookableRuns(days = 21) {
  const policy = await regionalPolicy();
  const cutoff = new Date(Date.now() + policy.cutoff_min * 60_000);
  const active = new Set(policy.corridors.filter((c) => c.active).map((c) => c.id));
  return (await listRuns({ from: cutoff, days, open: true })).filter((r) => active.has(r.corridor));
}
async function runRow(id: string, c: Q = pool, lock = false) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Shuttle');
  const r = await one(`SELECT * FROM regional_runs WHERE id = $1${lock ? ' FOR UPDATE' : ''}`, [id], c);
  if (!r) throw notFound('Shuttle');
  return r;
}
const corridorOf = (policy: RegionalPolicy, id: string) => {
  const c = policy.corridors.find((x) => x.id === id);
  if (!c) throw bad('unknown_route', 'No community route with that id');
  return c;
};

export async function createRun(actorId: string, b: { corridor: string; direction: 'out' | 'back'; departs_at: string; seats?: number; parcel_capacity?: number; notes?: string | null }) {
  await needRegional();
  const c = corridorOf(await regionalPolicy(), b.corridor);
  const at = new Date(b.departs_at);
  if (!(at.getTime() > Date.now())) throw bad('run_in_past', 'Choose a departure time in the future');
  const r = await one(
    `INSERT INTO regional_runs (ref, corridor, direction, departs_at, seats, parcel_capacity, notes, created_by)
     SELECT $1,$2,$3,$4,$5,$6,$7,$8 WHERE NOT EXISTS (SELECT 1 FROM regional_runs WHERE corridor = $2 AND direction = $3 AND departs_at = $4 AND status <> 'cancelled')
     RETURNING *`, [runRef(), c.id, b.direction, at, b.seats ?? c.shuttle_seats, b.parcel_capacity ?? c.parcel_capacity, b.notes ?? null, actorId]);
  if (!r) throw conflict('run_exists', 'There is already a shuttle on that route at that time');
  await audit(actorId, 'regional_run_created', 'regional_run', r.id, { corridor: c.id, direction: b.direction, departs_at: at });
  return r;
}

/** Shuttles on each route's days for the next `days` days (both directions); ones already there are left alone. */
export async function scheduleRuns(actorId: string, o: { corridor?: string; days: number }) {
  await needRegional();
  const policy = await regionalPolicy();
  const today = darwinParts(new Date()).date;
  let created = 0;
  for (const c of policy.corridors.filter((x) => x.active && (!o.corridor || x.id === o.corridor))) {
    for (const t of shuttleTimes(c, today, o.days)) {
      if (t.departs_at.getTime() <= Date.now()) continue;
      const r = await one(
        `INSERT INTO regional_runs (ref, corridor, direction, departs_at, seats, parcel_capacity, created_by)
         SELECT $1,$2,$3,$4,$5,$6,$7 WHERE NOT EXISTS (SELECT 1 FROM regional_runs WHERE corridor = $2 AND direction = $3 AND departs_at = $4 AND status <> 'cancelled')
         RETURNING id`, [runRef(), c.id, t.direction, t.departs_at, c.shuttle_seats, c.parcel_capacity, actorId]);
      if (r) created++;
    }
  }
  await audit(actorId, 'regional_runs_scheduled', 'regional_run', o.corridor ?? 'all', { days: o.days, created });
  return { created };
}

export async function updateRun(actorId: string, id: string, b: { driver_id?: string | null; seats?: number; parcel_capacity?: number; status?: 'open' | 'closed' | 'cancelled'; notes?: string | null }) {
  await needRegional();
  const policy = await regionalPolicy();
  const out = await tx(async (c) => {
    const r = await runRow(id, c, true);
    if (['completed', 'cancelled'].includes(r.status)) throw conflict('run_finished', 'This shuttle has finished or was cancelled');
    if (b.driver_id) {
      const d = await one(`SELECT d.status, (to_jsonb(d)->>'long_trips')::boolean AS long_trips FROM drivers d JOIN users u ON u.id = d.user_id
        WHERE d.user_id = $1 AND NOT u.blocked AND u.deleted_at IS NULL`, [b.driver_id], c);
      if (!d || d.status !== 'approved') throw bad('driver_not_approved', 'That driver is not approved to drive');
      if (!d.long_trips) throw bad('driver_not_opted_in', 'That driver has not said yes to long trips (driver app, Profile)');
    }
    if (b.seats !== undefined) {
      const taken = await one<{ n: number }>(`SELECT ${TAKEN.replace(/r\.id/g, '$1')} AS n`, [id], c);
      if (b.seats < Number(taken?.n ?? 0)) throw bad('seats_below_booked', `${taken!.n} seats are already booked`);
    }
    const sets: string[] = []; const vals: unknown[] = [id];
    for (const k of ['driver_id', 'seats', 'parcel_capacity', 'notes'] as const) if (b[k] !== undefined) { vals.push(b[k]); sets.push(`${k} = $${vals.length}`); }
    if (b.status) {
      if (b.status !== 'cancelled' && r.status !== 'open' && r.status !== 'closed') throw conflict('run_on_road', 'This shuttle is on the road');
      vals.push(b.status); sets.push(`status = $${vals.length}`);
      if (b.status === 'cancelled') sets.push('cancelled_at = now()');
    }
    const row = sets.length ? await one(`UPDATE regional_runs SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals, c) : r;
    const refunded: { booking: any; cents: number }[] = [];
    if (b.status === 'cancelled') {
      const live = await q(`SELECT * FROM regional_bookings WHERE run_id = $1 AND status IN ('pending','booked') FOR UPDATE`, [id], c);
      for (const bk of live) refunded.push({ booking: bk, cents: await refundBooking(c, bk, 'cancelled') });
    }
    return { row, refunded };
  });
  await audit(actorId, 'regional_run_updated', 'regional_run', id, b);
  const c = policy.corridors.find((x) => x.id === out.row.corridor);
  for (const { booking, cents } of out.refunded) {
    const u = await one('SELECT phone FROM users WHERE id = $1', [booking.user_id]);
    if (u?.phone) void sendSmsT(u.phone, 'regional_run_cancelled', { ref: booking.ref, what: c ? runLabel(c, out.row.direction) : 'shuttle', when: whenText(out.row.departs_at), refund_cents: cents }, { userId: booking.user_id });
  }
  return out.row;
}

/** Give back what was paid (credit) and mark the booking. Returns the cents given back. */
async function refundBooking(c: Q, bk: any, status: 'cancelled' | 'expired') {
  const back = Math.max(0, Number(bk.paid_cents) - Number(bk.refunded_cents));
  if (back > 0 && bk.payment_method === 'wallet') await c.query('UPDATE users SET wallet_cents = wallet_cents + $2 WHERE id = $1', [bk.user_id, back]);
  await c.query(`UPDATE regional_bookings SET status = $2, cancelled_at = now(), refunded_cents = refunded_cents + $3 WHERE id = $1`, [bk.id, status, back]);
  return back;
}

// ───────────────────────── Bookings ─────────────────────────
export interface BookingIn {
  run_id: string; kind: 'seat' | 'parcel'; seats?: number; pickup_point?: string | null; dropoff_point?: string | null;
  parcel?: { size: 'S' | 'M' | 'L'; description: string; recipient_name: string; recipient_phone: string; prohibited_ok: boolean } | null;
}
interface BookOpts { userId: string; channel: 'app' | 'sms' | 'web' | 'phone'; bookedBy?: string | null; pending?: boolean; staff?: boolean }

/** Book a seat or a parcel on a shuttle. `pending`: held for a YES by text (nothing paid yet). Otherwise paid from credit now. */
export async function book(input: BookingIn, o: BookOpts) {
  await needRegional();
  const policy = await regionalPolicy();
  const res = await tx(async (c) => {
    const run = await runRow(input.run_id, c, true);
    const cor = corridorOf(policy, run.corridor);
    if (!cor.active && !o.staff) throw bad('route_closed', 'This route is not taking bookings');
    if (run.status !== 'open') throw conflict('run_closed', 'This shuttle is not taking bookings');
    const cutoff = new Date(run.departs_at).getTime() - (o.staff ? 0 : policy.cutoff_min * 60_000);
    if (Date.now() > cutoff) throw conflict('run_cutoff', o.staff ? 'This shuttle has left' : `Bookings close ${policy.cutoff_min} minutes before the shuttle leaves. Call us.`);
    const fromSide = run.direction === 'out' ? 'town' : 'community';
    const toSide = run.direction === 'out' ? 'community' : 'town';
    const pick = (id: string | null | undefined, side: string, parcels = false) => {
      const pts = cor.pickup_points.filter((p) => p.side === side && (!parcels || p.parcels));
      const p = id ? pts.find((x) => x.id === id) : pts[0];
      if (!p) throw bad('invalid_point', parcels ? 'Choose a store that holds parcels on this route' : 'Choose a pickup point on this route');
      return p;
    };
    let seats = 0; let price = 0; let parcel: any = null; let code: string | null = null;
    const pickup = pick(input.pickup_point, fromSide);
    let dropoff;
    if (input.kind === 'seat') {
      seats = Math.round(Number(input.seats ?? 1));
      if (!(seats >= 1 && seats <= policy.max_seats_per_booking)) throw bad('seats', `Book 1 to ${policy.max_seats_per_booking} seats`);
      const taken = await one<{ n: number }>(`SELECT ${TAKEN.replace(/r\.id/g, '$1')} AS n`, [run.id], c);
      if (Number(taken?.n ?? 0) + seats > run.seats) throw conflict('run_full', `Only ${Math.max(0, run.seats - Number(taken?.n ?? 0))} seats left on this shuttle`);
      dropoff = pick(input.dropoff_point, toSide);
      price = seatPrice(cor, seats);
    } else {
      const p = input.parcel;
      if (!p) throw bad('parcel_required', 'Parcel details are required');
      if (!p.prohibited_ok) throw bad('prohibited_check', 'Confirm the parcel has nothing on the prohibited list (alcohol, drugs, weapons, dangerous goods)');
      const phone = auMobile(p.recipient_phone);
      if (!phone) throw bad('recipient_mobile', 'The person collecting needs an Australian mobile: we text them the collection code');
      const n = await one<{ n: number }>(`SELECT ${PARCELS.replace(/r\.id/g, '$1')} AS n`, [run.id], c);
      if (Number(n?.n ?? 0) >= run.parcel_capacity) throw conflict('run_full', 'No room for more parcels on this shuttle');
      dropoff = pick(input.dropoff_point, toSide, true);
      price = parcelPrice(cor, p.size);
      code = collectCode();
      parcel = { size: p.size, description: p.description.slice(0, 200), recipient_name: p.recipient_name.slice(0, 80), recipient_phone: phone };
    }
    const user = await one('SELECT id, name, phone, wallet_cents FROM users WHERE id = $1 FOR UPDATE', [o.userId], c);
    if (!user) throw notFound('Account');
    if (Number(user.wallet_cents) < price) {
      throw new ApiError(402, 'wallet_insufficient', `This costs $${(price / 100).toFixed(2)} of DingoGo credit and you have $${(Number(user.wallet_cents) / 100).toFixed(2)}. Top up at a DingoGo store, or call us.`,
        { price_cents: price, wallet_cents: Number(user.wallet_cents) });
    }
    if (o.pending) await c.query(`UPDATE regional_bookings SET status = 'expired' WHERE user_id = $1 AND status = 'pending'`, [o.userId]);
    const bk = await one(
      `INSERT INTO regional_bookings (ref, run_id, kind, user_id, seats, pickup_point, dropoff_point, parcel, collect_code_hash, price_cents, payment_method,
         paid_cents, status, channel, booked_by, hold_until, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'wallet',$11,$12,$13,$14,$15,$16) RETURNING *`,
      [seatRef(), run.id, input.kind, o.userId, seats, pickup.id, dropoff.id, parcel ? JSON.stringify(parcel) : null, code ? sha256(code) : null, price,
        o.pending ? 0 : price, o.pending ? 'pending' : 'booked', o.channel, o.bookedBy ?? null,
        o.pending ? new Date(Date.now() + policy.pending_hold_min * 60_000) : null, o.pending ? null : new Date()], c);
    if (!o.pending && price > 0) await c.query('UPDATE users SET wallet_cents = wallet_cents - $2 WHERE id = $1', [o.userId, price]);
    return { bk, run, cor, pickup, dropoff, user, code };
  });
  if (!o.pending) afterBooked(res.bk, res.run, res.cor, res.user, res.code);
  return { booking: bookingView(res.bk, res.run, policy), pickup: res.pickup, dropoff: res.dropoff };
}

/** After a parcel is booked: tell the person collecting it (the code comes when it is at the store). */
function afterBooked(bk: any, run: any, cor: Corridor, user: any, _code: string | null) {
  if (bk.kind === 'parcel' && bk.parcel?.recipient_phone) {
    const store = cor.pickup_points.find((p) => p.id === bk.dropoff_point)?.name ?? cor.place.name;
    void sendSmsT(bk.parcel.recipient_phone, 'regional_parcel_booked', { sender: firstName(user.name ?? 'Someone'), ref: bk.ref, when: whenText(run.departs_at), store }, { userId: null });
  }
}

/** Confirm the held booking for a YES text: take the credit now. */
export async function confirmPending(userId: string) {
  const policy = await regionalPolicy();
  const res = await tx(async (c) => {
    const bk = await one(`SELECT * FROM regional_bookings WHERE user_id = $1 AND status = 'pending' AND hold_until > now() ORDER BY created_at DESC LIMIT 1 FOR UPDATE`, [userId], c);
    if (!bk) return null;
    const run = await runRow(bk.run_id, c, true);
    const cor = corridorOf(policy, run.corridor);
    if (run.status !== 'open' || new Date(run.departs_at).getTime() < Date.now()) {
      await c.query(`UPDATE regional_bookings SET status = 'expired' WHERE id = $1`, [bk.id]);
      return { error: 'run_closed' as const, bk, run, cor };
    }
    const u = await one('SELECT id, name, phone, wallet_cents FROM users WHERE id = $1 FOR UPDATE', [userId], c);
    if (Number(u.wallet_cents) < bk.price_cents) return { error: 'wallet' as const, bk, run, cor, balance: Number(u.wallet_cents) };
    await c.query('UPDATE users SET wallet_cents = wallet_cents - $2 WHERE id = $1', [userId, bk.price_cents]);
    const done = await one(`UPDATE regional_bookings SET status = 'booked', paid_cents = price_cents, confirmed_at = now(), hold_until = NULL WHERE id = $1 RETURNING *`, [bk.id], c);
    return { done, run, cor, user: u, balance: Number(u.wallet_cents) - bk.price_cents };
  });
  if (res && 'done' in res && res.done) afterBooked(res.done, res.run, res.cor, res.user, null);
  return res;
}

export function bookingView(b: any, run: any, policy: RegionalPolicy) {
  const c = policy.corridors.find((x) => x.id === run.corridor);
  const pt = (id: string | null) => c?.pickup_points.find((p) => p.id === id)?.name ?? id;
  return {
    id: b.id, ref: b.ref, kind: b.kind, status: b.status, seats: b.seats, price_cents: b.price_cents, paid_cents: b.paid_cents, refunded_cents: b.refunded_cents,
    channel: b.channel, pickup_point: b.pickup_point, pickup_name: pt(b.pickup_point), dropoff_point: b.dropoff_point, dropoff_name: pt(b.dropoff_point),
    parcel: b.parcel ? { size: b.parcel.size, description: b.parcel.description, recipient_name: b.parcel.recipient_name } : null,
    hold_until: b.hold_until, created_at: b.created_at,
    run: { id: run.id, ref: run.ref, corridor: run.corridor, direction: run.direction, label: c ? runLabel(c, run.direction) : run.corridor, departs_at: run.departs_at, when: whenText(run.departs_at), status: run.status },
  };
}

export async function myBookings(userId: string) {
  const policy = await regionalPolicy();
  const rows = await q(
    `SELECT b.*, row_to_json(r) AS run FROM regional_bookings b JOIN regional_runs r ON r.id = b.run_id
     WHERE b.user_id = $1 AND (r.departs_at > now() - interval '14 days') AND b.status NOT IN ('expired')
     ORDER BY r.departs_at DESC LIMIT 50`, [userId]);
  return rows.map((b) => bookingView(b, b.run, policy));
}

/** Cancel a booking: credit back in full until the cut-off (staff any time before the shuttle leaves). */
export async function cancelBooking(actor: { id: string; role: string }, id: string, opts: { ref?: string } = {}) {
  await needRegional();
  const policy = await regionalPolicy();
  const staff = actor.role === 'admin' || actor.role === 'dispatcher';
  const out = await tx(async (c) => {
    const bk = opts.ref
      ? await one(`SELECT * FROM regional_bookings WHERE ref = $1 AND user_id = $2 FOR UPDATE`, [opts.ref, actor.id], c)
      : /^[0-9a-f-]{36}$/i.test(id) ? await one(`SELECT * FROM regional_bookings WHERE id = $1 FOR UPDATE`, [id], c) : null;
    if (!bk || (!staff && bk.user_id !== actor.id)) throw notFound('Booking');
    if (!['pending', 'booked'].includes(bk.status)) throw conflict('not_cancellable', 'This booking can no longer be cancelled');
    const run = await runRow(bk.run_id, c, true);
    const left = new Date(run.departs_at).getTime() - Date.now();
    if (run.status !== 'open' && run.status !== 'closed') throw conflict('not_cancellable', 'This shuttle has left');
    if (!staff && left < policy.cutoff_min * 60_000) throw conflict('too_late', `Bookings can be cancelled until ${policy.cutoff_min} minutes before the shuttle leaves. Call us.`);
    const cents = await refundBooking(c, bk, 'cancelled');
    return { bk: { ...bk, status: 'cancelled', refunded_cents: Number(bk.refunded_cents) + cents }, run, cents };
  });
  if (staff) await audit(actor.id, 'regional_booking_cancelled', 'regional_booking', out.bk.id, { refund_cents: out.cents });
  return { booking: bookingView(out.bk, out.run, policy), refund_cents: out.cents };
}

// ───────────────────────── Manifest and the driver ─────────────────────────
export async function manifest(runId: string, viewer: { id: string; role: string }) {
  await needRegional();
  const policy = await regionalPolicy();
  const r = await one(`SELECT ${RUN_COLS} FROM regional_runs r LEFT JOIN users du ON du.id = r.driver_id WHERE r.id = $1`, [runId]).catch(() => null);
  if (!r) throw notFound('Shuttle');
  const staff = viewer.role === 'admin' || viewer.role === 'dispatcher';
  if (!staff && r.driver_id !== viewer.id) throw notFound('Shuttle');
  const c = corridorOf(policy, r.corridor);
  const rows = await q(
    `SELECT b.*, u.name, u.phone FROM regional_bookings b JOIN users u ON u.id = b.user_id
     WHERE b.run_id = $1 AND b.status IN ('booked','boarded','no_show','at_store','collected','delivered') ORDER BY b.kind, b.pickup_point, b.created_at`, [runId]);
  const pt = (id: string) => c.pickup_points.find((p) => p.id === id);
  const tail = (p: string | null) => (p ? p.replace(/\D/g, '').slice(-3) : null);
  return {
    run: runView(r, policy),
    route: { name: c.name, road_km: c.road_km, minutes: c.minutes, unsealed_km: c.unsealed_km, permit_note: c.permit_note, coverage_gaps: c.coverage_gaps,
      fuel_note: c.fuel_note, checkin_every_min: policy.checkin_every_min },
    seats: rows.filter((b) => b.kind === 'seat').map((b) => ({
      id: b.id, ref: b.ref, name: staff ? b.name : firstName(b.name ?? ''), seats: b.seats, status: b.status,
      pickup: pt(b.pickup_point)?.name ?? b.pickup_point, dropoff: pt(b.dropoff_point)?.name ?? b.dropoff_point,
      phone: staff ? b.phone : null, phone_last3: tail(b.phone), channel: b.channel,
    })),
    parcels: rows.filter((b) => b.kind === 'parcel').map((b) => ({
      id: b.id, ref: b.ref, size: b.parcel?.size, description: b.parcel?.description, recipient: firstName(b.parcel?.recipient_name ?? ''),
      store: pt(b.dropoff_point)?.name ?? b.dropoff_point, status: b.status, sender: firstName(b.name ?? ''),
    })),
    totals: {
      seats: rows.filter((b) => b.kind === 'seat' && b.status !== 'no_show').reduce((n, b) => n + b.seats, 0),
      parcels: rows.filter((b) => b.kind === 'parcel').length,
    },
  };
}
export function manifestCsv(m: Awaited<ReturnType<typeof manifest>>) {
  const cell = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? "'" : '') + s.replace(/"/g, '""')}"` : s; };
  const lines = [['type', 'ref', 'name', 'seats_or_size', 'from', 'to', 'phone', 'status'].join(',')];
  for (const s of m.seats) lines.push([cell('seat'), cell(s.ref), cell(s.name), s.seats, cell(s.pickup), cell(s.dropoff), cell(s.phone ?? ''), s.status].join(','));
  for (const p of m.parcels) lines.push([cell('parcel'), cell(p.ref), cell(p.recipient), cell(p.size), '', cell(p.store), '', p.status].join(','));
  return lines.join('\n') + '\n';
}

async function driverRun(c: Q, driverId: string, runId: string) {
  const r = await runRow(runId, c, true);
  if (r.driver_id !== driverId) throw notFound('Shuttle');
  return r;
}
export async function driverRunAction(driverId: string, runId: string, action: 'depart' | 'checkin' | 'complete', p?: { lat?: number; lng?: number }) {
  await needRegional();
  const policy = await regionalPolicy();
  const out = await tx(async (c) => {
    const r = await driverRun(c, driverId, runId);
    if (action === 'depart') {
      if (!['open', 'closed'].includes(r.status)) throw conflict('run_state', 'This shuttle has already left');
      if (new Date(r.departs_at).getTime() - Date.now() > 3 * 3600_000) throw conflict('run_too_early', 'This shuttle leaves later');
      await c.query(`UPDATE regional_bookings SET status = 'expired' WHERE run_id = $1 AND status = 'pending'`, [r.id]);
      return one(`UPDATE regional_runs SET status = 'departed', departed_at = now(), last_checkin_at = now() WHERE id = $1 RETURNING *`, [r.id], c);
    }
    if (r.status !== 'departed') throw conflict('run_state', 'Start the shuttle first');
    if (action === 'checkin') return one(`UPDATE regional_runs SET last_checkin_at = now(), alerts = alerts - 'missed_for' WHERE id = $1 RETURNING *`, [r.id], c);
    // Complete: seats not marked are counted as travelled; parcels not left at a store stay with ops. The driver is paid for the leg.
    await c.query(`UPDATE regional_bookings SET status = 'boarded', boarded_at = coalesce(boarded_at, now()) WHERE run_id = $1 AND kind = 'seat' AND status = 'booked'`, [r.id]);
    const takings = await one<{ cents: number }>(
      `SELECT coalesce(sum(paid_cents - refunded_cents), 0)::int AS cents FROM regional_bookings WHERE run_id = $1 AND status IN ('boarded','no_show','at_store','collected','delivered','booked')`, [r.id], c);
    const cor = corridorOf(policy, r.corridor);
    const payCents = runDriverPay(cor, Number(takings?.cents ?? 0));
    if (payCents > 0) {
      await c.query(`INSERT INTO driver_ledger (driver_id, kind, amount_cents, note) VALUES ($1, 'shuttle_run', $2, $3)`,
        [driverId, payCents, `Shuttle ${r.ref} ${runLabel(cor, r.direction)}`]);
    }
    return one(`UPDATE regional_runs SET status = 'completed', completed_at = now(), last_checkin_at = now() WHERE id = $1 RETURNING *`, [r.id], c);
  });
  if (action === 'checkin') toOps('regional.checkin', { run_id: runId, lat: p?.lat ?? null, lng: p?.lng ?? null });
  return out;
}

export async function boardBooking(driverId: string, bookingId: string, status: 'boarded' | 'no_show') {
  await needRegional();
  return tx(async (c) => {
    const bk = /^[0-9a-f-]{36}$/i.test(bookingId) ? await one(`SELECT * FROM regional_bookings WHERE id = $1 FOR UPDATE`, [bookingId], c) : null;
    if (!bk || bk.kind !== 'seat') throw notFound('Booking');
    const r = await driverRun(c, driverId, bk.run_id);
    if (!['open', 'closed', 'departed'].includes(r.status)) throw conflict('run_state', 'This shuttle has finished');
    if (!['booked', 'boarded', 'no_show'].includes(bk.status)) throw conflict('not_boardable', 'This booking was cancelled');
    return one(`UPDATE regional_bookings SET status = $2, boarded_at = CASE WHEN $2 = 'boarded' THEN now() END WHERE id = $1 RETURNING id, ref, status`, [bk.id, status], c);
  });
}

/** The driver leaves a parcel at the community store: the person collecting it is texted a new code. */
export async function parcelAtStore(driverId: string, bookingId: string) {
  await needRegional();
  const policy = await regionalPolicy();
  const code = collectCode();
  const res = await tx(async (c) => {
    const bk = /^[0-9a-f-]{36}$/i.test(bookingId) ? await one(`SELECT * FROM regional_bookings WHERE id = $1 FOR UPDATE`, [bookingId], c) : null;
    if (!bk || bk.kind !== 'parcel') throw notFound('Parcel');
    const r = await driverRun(c, driverId, bk.run_id);
    if (r.status !== 'departed') throw conflict('run_state', 'Start the shuttle first');
    if (bk.status !== 'booked') throw conflict('parcel_state', 'This parcel is already at the store or was cancelled');
    const sender = await one('SELECT name FROM users WHERE id = $1', [bk.user_id], c);
    const row = await one(`UPDATE regional_bookings SET status = 'at_store', at_store_at = now(), collect_code_hash = $2 WHERE id = $1 RETURNING *`, [bk.id, sha256(code)], c);
    return { row, run: r, sender };
  });
  const cor = corridorOf(policy, res.run.corridor);
  const store = cor.pickup_points.find((p) => p.id === res.row.dropoff_point)?.name ?? cor.place.name;
  void sendSmsT(res.row.parcel.recipient_phone, 'regional_parcel_at_store', { sender: firstName(res.sender?.name ?? 'Someone'), ref: res.row.ref, store, code }, { userId: null });
  return { id: res.row.id, ref: res.row.ref, status: res.row.status };
}

/** Store points a partner looks after (route id + point id). */
async function storePoints(partnerId: string) {
  const policy = await regionalPolicy();
  return policy.corridors.flatMap((c) => c.pickup_points.filter((p) => p.partner_id === partnerId).map((p) => ({ corridor: c.id, point: p.id, name: p.name })));
}
export async function storeParcels(partnerId: string) {
  await needRegional();
  const pts = await storePoints(partnerId);
  if (!pts.length) return { points: [], parcels: [] };
  const rows = await q(
    `SELECT b.id, b.ref, b.status, b.parcel, b.at_store_at, b.collected_at, b.dropoff_point, r.corridor FROM regional_bookings b JOIN regional_runs r ON r.id = b.run_id
     WHERE b.kind = 'parcel' AND (b.status = 'at_store' OR (b.status = 'collected' AND b.collected_at > now() - interval '7 days')) ORDER BY b.at_store_at DESC LIMIT 200`);
  const mine = rows.filter((b) => pts.some((p) => p.corridor === b.corridor && p.point === b.dropoff_point));
  return {
    points: pts.map((p) => p.name),
    parcels: mine.map((b) => ({ id: b.id, ref: b.ref, status: b.status, size: b.parcel?.size, recipient: firstName(b.parcel?.recipient_name ?? ''),
      phone_last3: String(b.parcel?.recipient_phone ?? '').slice(-3), at_store_at: b.at_store_at, collected_at: b.collected_at })),
  };
}
export async function collectParcel(partnerId: string, actorId: string, code: string) {
  await needRegional();
  const pts = await storePoints(partnerId);
  const bk = await one(`SELECT b.*, r.corridor FROM regional_bookings b JOIN regional_runs r ON r.id = b.run_id WHERE b.kind = 'parcel' AND b.status = 'at_store' AND b.collect_code_hash = $1`,
    [sha256(code.trim())]);
  if (!bk || !pts.some((p) => p.corridor === bk.corridor && p.point === bk.dropoff_point)) return null;
  const done = await one(`UPDATE regional_bookings SET status = 'collected', collected_at = now(), collected_by_partner = $2 WHERE id = $1 AND status = 'at_store' RETURNING id, ref, status, parcel`, [bk.id, partnerId]);
  if (done) await audit(actorId, 'regional_parcel_collected', 'regional_booking', bk.id, { partner_id: partnerId });
  return done ? { id: done.id, ref: done.ref, status: done.status, recipient: firstName(done.parcel?.recipient_name ?? '') } : null;
}

// ───────────────────────── Long-trip and shuttle safety ─────────────────────────
let lastCheck = 0;
/** From the dispatcher tick (once a minute): held seats that expired; long trips and shuttles that missed a check-in or are overdue. */
export async function runRegionalChecks(opts: { force?: boolean } = {}) {
  if (!opts.force && Date.now() - lastCheck < 60_000) return null;
  lastCheck = Date.now();
  if (!(await regionalReady())) return null;
  const policy = await regionalPolicy();
  const out = { expired: 0, missed: 0, overdue: 0 };
  out.expired = (await q(`UPDATE regional_bookings SET status = 'expired' WHERE status = 'pending' AND hold_until <= now() RETURNING 1`)).length;

  // Private long trips (fare_breakdown.regional): last sign of life = start, a check-in or a GPS point.
  const trips = await q(
    `SELECT t.id, t.ref, t.rider_id, t.driver_id, t.started_at, t.est_duration_s, t.fare_breakdown->'regional' AS reg,
            greatest(t.started_at, (SELECT max(e.at) FROM trip_events e WHERE e.trip_id = t.id AND e.type = 'regional_checkin'),
                     (SELECT max(k.at) FROM trip_track k WHERE k.trip_id = t.id)) AS last_seen,
            (SELECT max(e.at) FROM trip_events e WHERE e.trip_id = t.id AND e.type = 'regional_checkin_missed') AS missed_at,
            EXISTS (SELECT 1 FROM trip_events e WHERE e.trip_id = t.id AND e.type = 'regional_overdue') AS overdue_raised
     FROM trips t WHERE t.status = 'in_progress' AND t.fare_breakdown ? 'regional'`);
  for (const t of trips) {
    const cor = policy.corridors.find((c) => c.id === t.reg?.corridor);
    const allowMin = policy.checkin_every_min + (cor ? longestGapMin(cor) : 60) + 10;
    const silentMin = (Date.now() - new Date(t.last_seen).getTime()) / 60_000;
    if (silentMin > allowMin && !(t.missed_at && new Date(t.missed_at) > new Date(t.last_seen))) {
      await q(`INSERT INTO trip_events (trip_id, type, actor_id, data) VALUES ($1, 'regional_checkin_missed', NULL, $2)`, [t.id, JSON.stringify({ minutes: Math.round(silentMin) })]);
      toOps('regional.checkin_missed', { trip_id: t.id, ref: t.ref, minutes: Math.round(silentMin) });
      out.missed++;
    }
    const dueAt = new Date(t.started_at).getTime() + Number(t.est_duration_s) * 1000 * 1.2 + policy.overdue_after_min * 60_000;
    if (Date.now() > dueAt && !t.overdue_raised) {
      const sos = await one(`INSERT INTO sos_alerts (trip_id, user_id, role, message) VALUES ($1, $2, 'rider', $3) RETURNING *`,
        [t.id, t.rider_id, `Long trip overdue: ${t.reg?.name ?? 'community trip'} not finished ${policy.overdue_after_min} min after it was expected`]);
      await q(`INSERT INTO trip_events (trip_id, type, actor_id, data) VALUES ($1, 'regional_overdue', NULL, $2)`, [t.id, JSON.stringify({ sos_id: sos.id })]);
      toOps('sos.new', { ...sos, trip_ref: t.ref, source: 'regional_overdue' });
      out.overdue++;
    }
  }

  // Shuttles on the road.
  const runs = await q(`SELECT * FROM regional_runs WHERE status = 'departed'`);
  for (const r of runs) {
    const cor = policy.corridors.find((c) => c.id === r.corridor);
    if (!cor || !r.driver_id) continue;
    const last = new Date(r.last_checkin_at ?? r.departed_at).getTime();
    const allowMin = policy.checkin_every_min + longestGapMin(cor) + 10;
    if ((Date.now() - last) / 60_000 > allowMin && r.alerts?.missed_for !== new Date(last).toISOString()) {
      await q(`UPDATE regional_runs SET alerts = alerts || jsonb_build_object('missed_for', $2::text) WHERE id = $1`, [r.id, new Date(last).toISOString()]);
      toOps('regional.checkin_missed', { run_id: r.id, ref: r.ref, minutes: Math.round((Date.now() - last) / 60_000) });
      out.missed++;
    }
    const dueAt = new Date(r.departed_at).getTime() + cor.minutes * 60_000 * 1.3 + policy.overdue_after_min * 60_000;
    if (Date.now() > dueAt && !r.alerts?.overdue) {
      const sos = await one(`INSERT INTO sos_alerts (user_id, role, message) VALUES ($1, 'driver', $2) RETURNING *`,
        [r.driver_id, `Shuttle ${r.ref} overdue: ${runLabel(cor, r.direction)} not finished ${policy.overdue_after_min} min after it was expected`]);
      await q(`UPDATE regional_runs SET alerts = alerts || jsonb_build_object('overdue', $2::text) WHERE id = $1`, [r.id, sos.id]);
      toOps('sos.new', { ...sos, source: 'regional_overdue', run_ref: r.ref });
      out.overdue++;
    }
  }
  return out;
}

/** Long trips and shuttles on the road now, for the ops page. */
export async function onTheRoad() {
  const policy = await regionalPolicy();
  const trips = await q(
    `SELECT t.id, t.ref, t.status, t.started_at, t.est_duration_s, t.scheduled_for, t.fare_breakdown->'regional' AS reg, du.name AS driver_name,
            greatest(t.started_at, (SELECT max(e.at) FROM trip_events e WHERE e.trip_id = t.id AND e.type = 'regional_checkin'),
                     (SELECT max(k.at) FROM trip_track k WHERE k.trip_id = t.id)) AS last_seen
     FROM trips t LEFT JOIN users du ON du.id = t.driver_id
     WHERE t.fare_breakdown ? 'regional' AND (t.status IN ('accepted','arrived','in_progress','requested')
        OR (t.status = 'scheduled' AND t.scheduled_for < now() + interval '7 days')) ORDER BY coalesce(t.started_at, t.scheduled_for) LIMIT 100`);
  const runs = (await regionalReady()) ? await q(`SELECT ${RUN_COLS} FROM regional_runs r LEFT JOIN users du ON du.id = r.driver_id WHERE r.status = 'departed' ORDER BY r.departed_at`) : [];
  return {
    trips: trips.map((t) => ({ id: t.id, ref: t.ref, status: t.status, name: t.reg?.name, direction: t.reg?.direction, return_leg: !!t.reg?.return_leg,
      driver_name: t.driver_name ? firstName(t.driver_name) : null, scheduled_for: t.scheduled_for, started_at: t.started_at, last_seen: t.status === 'in_progress' ? t.last_seen : null,
      expected_at: t.started_at ? new Date(new Date(t.started_at).getTime() + Number(t.est_duration_s) * 1000).toISOString() : null })),
    runs: runs.map((r) => runView(r, policy)),
  };
}

// ───────────────────────── Booking by text ─────────────────────────
const usersByPhone = (phone: string) => one(`SELECT id, name, phone, wallet_cents FROM users WHERE phone = $1 AND deleted_at IS NULL AND NOT blocked ORDER BY created_at LIMIT 1`, [phone]);
export async function hasPending(phone: string) {
  if (!(await regionalReady())) return false;
  return !!(await one(`SELECT 1 FROM regional_bookings b JOIN users u ON u.id = b.user_id WHERE u.phone = $1 AND b.status = 'pending' AND b.hold_until > now()`, [phone]));
}

/** Find the shuttle a text asks for: the route, direction and day, with room for the seats. */
async function runForText(cor: Corridor, cmd: Extract<SmsCommand, { kind: 'book' }>, cutoffMin: number) {
  const f = dayFilter(cmd.day);
  return one(
    `SELECT r.*, ${TAKEN} AS seats_taken FROM regional_runs r
     WHERE r.corridor = $1 AND r.direction = $2 AND r.status = 'open' AND r.departs_at > now() + make_interval(mins => $3)
       AND ($4::int IS NULL OR extract(dow FROM r.departs_at AT TIME ZONE 'Australia/Darwin')::int = $4)
       AND ($5::date IS NULL OR (r.departs_at AT TIME ZONE 'Australia/Darwin')::date = $5)
       AND r.seats - ${TAKEN} >= $6
     ORDER BY r.departs_at LIMIT 1`, [cor.id, cmd.direction, cutoffMin, f.weekday ?? null, f.date ?? null, cmd.seats]);
}

/** Answer a booking text. Returns the reply (GSM-7 text), or null when the text isn't a booking word. */
export async function handleBookingSms(phone: string, cmd: SmsCommand): Promise<string | null> {
  const { render } = await import('../lib/messages.js');
  const support = (await supportPhone()) ?? 'DingoGo';
  if (!(await regionalReady())) return render('regional_usage', { support }).sms!;
  if (await tooMany('sms_booking', phone, 30, 3600)) return null;
  await record('sms_booking', phone);
  const policy = await regionalPolicy();
  const user = await usersByPhone(phone);
  switch (cmd.kind) {
    case 'usage': return render('regional_usage', { support }).sms!;
    case 'balance': return render('regional_balance', { cents: Number(user?.wallet_cents ?? 0) }).sms!;
    case 'book': {
      const cor = findCorridor(policy, cmd.place);
      if (!cor) return render('regional_usage', { support }).sms!;
      if (cmd.seats < 1 || cmd.seats > policy.max_seats_per_booking) return render('regional_seats', { max: policy.max_seats_per_booking }).sms!;
      const run = await runForText(cor, cmd, policy.cutoff_min);
      if (!run) return render('regional_no_run', { place: cor.place.name, support }).sms!;
      const price = seatPrice(cor, cmd.seats);
      if (!user || Number(user.wallet_cents) < price) return render('regional_need_credit', { cents: price, balance: Number(user?.wallet_cents ?? 0), support }).sms!;
      try {
        const r = await book({ run_id: run.id, kind: 'seat', seats: cmd.seats }, { userId: user.id, channel: 'sms', pending: true });
        return render('regional_hold', { seats: cmd.seats, what: runLabel(cor, run.direction), when: whenText(run.departs_at), cents: price, minutes: policy.pending_hold_min, pickup: r.pickup.name }).sms!;
      } catch (e: any) {
        if (e instanceof ApiError) return render('regional_no_run', { place: cor.place.name, support }).sms!;
        throw e;
      }
    }
    case 'yes': {
      if (!user) return render('regional_nothing_pending', {}).sms!;
      const r = await confirmPending(user.id);
      if (!r) return render('regional_nothing_pending', {}).sms!;
      if ('error' in r && r.error === 'wallet') return render('regional_need_credit', { cents: r.bk.price_cents, balance: r.balance ?? 0, support }).sms!;
      if ('error' in r) return render('regional_no_run', { place: r.cor.place.name, support }).sms!;
      const pickup = r.cor.pickup_points.find((p) => p.id === r.done.pickup_point)?.name ?? '';
      return render('regional_booked', { ref: r.done.ref, seats: r.done.seats, what: runLabel(r.cor, r.run.direction), when: whenText(r.run.departs_at), pickup, balance: r.balance }).sms!;
    }
    case 'no': {
      if (!user) return render('regional_nothing_pending', {}).sms!;
      const n = await q(`UPDATE regional_bookings SET status = 'cancelled', cancelled_at = now() WHERE user_id = $1 AND status = 'pending' RETURNING 1`, [user.id]);
      return n.length ? render('regional_not_booked', {}).sms! : render('regional_nothing_pending', {}).sms!;
    }
    case 'list': {
      if (!user) return render('regional_list', { lines: [] }).sms!;
      const rows = await q(
        `SELECT b.ref, b.seats, b.kind, r.departs_at, r.corridor, r.direction FROM regional_bookings b JOIN regional_runs r ON r.id = b.run_id
         WHERE b.user_id = $1 AND b.status = 'booked' AND r.departs_at > now() ORDER BY r.departs_at LIMIT 3`, [user.id]);
      return render('regional_list', { lines: rows.map((b) => {
        const c = policy.corridors.find((x) => x.id === b.corridor);
        return `${b.ref} ${whenText(b.departs_at)} ${c ? runLabel(c, b.direction) : ''}${b.kind === 'seat' ? `, ${b.seats} seat${b.seats === 1 ? '' : 's'}` : ', parcel'}`;
      }) }).sms!;
    }
    case 'cancel': {
      if (!user) return render('regional_list', { lines: [] }).sms!;
      let ref = cmd.ref;
      if (!ref) {
        const rows = await q(`SELECT b.ref FROM regional_bookings b JOIN regional_runs r ON r.id = b.run_id WHERE b.user_id = $1 AND b.status = 'booked' AND r.departs_at > now()`, [user.id]);
        if (rows.length !== 1) return render('regional_cancel_which', {}).sms!;
        ref = rows[0].ref;
      }
      try {
        const r = await cancelBooking({ id: user.id, role: 'rider' }, '', { ref: ref! });
        return render('regional_cancelled', { ref: r.booking.ref, refund_cents: r.refund_cents }).sms!;
      } catch (e: any) {
        if (e instanceof ApiError && e.code === 'too_late') return render('regional_cancel_late', { ref: ref!, support }).sms!;
        if (e instanceof ApiError) return render('regional_cancel_which', {}).sms!;
        throw e;
      }
    }
  }
}
export { parseSms };

/** The low-data page's booking: a held seat and a text asking for YES (the text proves the number is theirs). Same answer either way. */
export async function liteBook(b: { run_id: string; seats: number; phone: string }) {
  await needRegional();
  const policy = await regionalPolicy();
  const phone = auMobile(b.phone);
  if (!phone) throw bad('mobile', 'Enter an Australian mobile number');
  if (await tooMany('lite_book_phone', phone, 3, 3600)) throw new ApiError(429, 'too_many_requests', 'Too many tries for that number. Wait an hour or call us.');
  await record('lite_book_phone', phone);
  const support = (await supportPhone()) ?? 'DingoGo';
  const run = await runRow(b.run_id).catch(() => null);
  const cor = run ? policy.corridors.find((c) => c.id === run.corridor) : null;
  if (!run || !cor) throw notFound('Shuttle');
  const user = await usersByPhone(phone);
  const price = seatPrice(cor, b.seats);
  if (!user || Number(user.wallet_cents) < price) {
    void sendSmsT(phone, 'regional_need_credit', { cents: price, balance: Number(user?.wallet_cents ?? 0), support }, { userId: user?.id ?? null });
    return { phone };
  }
  const r = await book({ run_id: run.id, kind: 'seat', seats: b.seats }, { userId: user.id, channel: 'web', pending: true });
  void sendSmsT(phone, 'regional_hold', { seats: b.seats, what: runLabel(cor, run.direction), when: whenText(run.departs_at), cents: price, minutes: policy.pending_hold_min, pickup: r.pickup.name }, { userId: user.id });
  return { phone };
}

// ───────────────────────── Community store top-ups ─────────────────────────
const darwinDayStart = () => new Date(`${darwinParts(new Date()).date}T00:00:00+09:30`);
export async function createTopup(partnerId: string, actorId: string, b: { phone: string; cents: number; name?: string | null }) {
  await needRegional();
  const policy = await regionalPolicy();
  const p = await one('SELECT id, name, kind, active FROM partners WHERE id = $1', [partnerId]);
  if (!p?.active || p.kind !== 'community_store') throw forbidden('Top-ups are for DingoGo community stores');
  const phone = auMobile(b.phone);
  if (!phone) throw bad('mobile', 'Enter the person’s Australian mobile number');
  const res = await tx(async (c) => {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`topup:${partnerId}`]);
    let u = await one('SELECT id, name, phone, wallet_cents FROM users WHERE phone = $1 AND deleted_at IS NULL FOR UPDATE', [phone], c);
    if (!u) {
      const name = String(b.name ?? '').trim();
      if (name.length < 2) throw bad('name_required', 'New to DingoGo: enter their name too');
      u = await one(`INSERT INTO users (phone, name, referral_code) VALUES ($1,$2,$3) RETURNING id, name, phone, wallet_cents`, [phone, name.slice(0, 80), referralCode(name)], c);
    }
    const since = darwinDayStart();
    const sums = await one<{ rider: number; store: number }>(
      `SELECT coalesce(sum(cents) FILTER (WHERE user_id = $1), 0)::int AS rider, coalesce(sum(cents) FILTER (WHERE partner_id = $2), 0)::int AS store
       FROM partner_topups WHERE voided_at IS NULL AND created_at >= $3 AND (user_id = $1 OR partner_id = $2)`, [u.id, partnerId, since], c);
    checkTopup(policy.topups, b.cents, { riderTodayCents: Number(sums?.rider ?? 0), storeTodayCents: Number(sums?.store ?? 0) });
    const t = await one(`INSERT INTO partner_topups (ref, partner_id, user_id, cents, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [topupRef(), partnerId, u.id, b.cents, actorId], c);
    const w = await one<{ wallet_cents: number }>('UPDATE users SET wallet_cents = wallet_cents + $2 WHERE id = $1 RETURNING wallet_cents', [u.id, b.cents], c);
    return { t, u, balance: Number(w!.wallet_cents) };
  });
  await audit(actorId, 'store_topup', 'partner_topup', res.t.id, { partner_id: partnerId, cents: b.cents, user_id: res.u.id });
  void sendSmsT(phone, 'topup_receipt', { cents: b.cents, store: p.name, balance: res.balance, ref: res.t.ref }, { userId: res.u.id });
  return { topup: { id: res.t.id, ref: res.t.ref, cents: res.t.cents, created_at: res.t.created_at, name: firstName(res.u.name ?? ''), phone_last3: phone.slice(-3) } };
}

/** A mistake at the counter (wrong number or amount): undo within `void_min`, if the credit hasn't been spent. */
export async function voidTopup(partnerId: string, actorId: string, id: string) {
  await needRegional();
  const policy = await regionalPolicy();
  const res = await tx(async (c) => {
    const t = /^[0-9a-f-]{36}$/i.test(id) ? await one('SELECT * FROM partner_topups WHERE id = $1 AND partner_id = $2 FOR UPDATE', [id, partnerId], c) : null;
    if (!t) throw notFound('Top-up');
    if (t.voided_at) throw conflict('already_voided', 'This top-up was already undone');
    if (Date.now() - new Date(t.created_at).getTime() > policy.topups.void_min * 60_000) throw conflict('too_late', `Top-ups can be undone for ${policy.topups.void_min} minutes. Call DingoGo.`);
    const w = await one('UPDATE users SET wallet_cents = wallet_cents - $2 WHERE id = $1 AND wallet_cents >= $2 RETURNING wallet_cents, phone', [t.user_id, t.cents], c);
    if (!w) throw conflict('credit_spent', 'Some of this credit has been spent. Call DingoGo.');
    await c.query('UPDATE partner_topups SET voided_at = now(), voided_by = $2 WHERE id = $1', [t.id, actorId]);
    return { t, phone: w.phone };
  });
  await audit(actorId, 'store_topup_voided', 'partner_topup', id, { partner_id: partnerId, cents: res.t.cents });
  const p = await one('SELECT name FROM partners WHERE id = $1', [partnerId]);
  if (res.phone) void sendSmsT(res.phone, 'topup_voided', { cents: res.t.cents, store: p?.name ?? 'the store', ref: res.t.ref }, { userId: res.t.user_id });
  return { ok: true };
}

const monthRange = (month: string) => {
  if (!isIsoMonth(month)) throw bad('month', 'Month is YYYY-MM');
  const [y, m] = month.split('-').map(Number);
  const next = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return [new Date(`${month}-01T00:00:00+09:30`), new Date(`${next}-01T00:00:00+09:30`)];
};
export async function storeTopups(partnerId: string, month = darwinParts(new Date()).date.slice(0, 7)) {
  await needRegional();
  const [from, to] = monthRange(month);
  const rows = await q(
    `SELECT t.id, t.ref, t.cents, t.created_at, t.voided_at, t.settled_at, u.name, u.phone FROM partner_topups t JOIN users u ON u.id = t.user_id
     WHERE t.partner_id = $1 AND t.created_at >= $2 AND t.created_at < $3 ORDER BY t.created_at DESC`, [partnerId, from, to]);
  const live = rows.filter((r) => !r.voided_at);
  return {
    month,
    topups: rows.map((r) => ({ id: r.id, ref: r.ref, cents: r.cents, created_at: r.created_at, voided: !!r.voided_at, settled: !!r.settled_at,
      name: firstName(r.name ?? ''), phone_last3: String(r.phone ?? '').slice(-3) })),
    total_cents: live.reduce((n, r) => n + r.cents, 0),
    owed_cents: live.filter((r) => !r.settled_at).reduce((n, r) => n + r.cents, 0),
  };
}
export async function topupSummary(month = darwinParts(new Date()).date.slice(0, 7)) {
  await needRegional();
  const [from, to] = monthRange(month);
  const rows = await q(
    `SELECT p.id AS partner_id, p.name, count(t.*)::int AS n, coalesce(sum(t.cents),0)::int AS total_cents,
            coalesce(sum(t.cents) FILTER (WHERE t.settled_at IS NULL),0)::int AS owed_cents, max(t.settled_ref) AS settled_ref
     FROM partner_topups t JOIN partners p ON p.id = t.partner_id
     WHERE t.voided_at IS NULL AND t.created_at >= $1 AND t.created_at < $2 GROUP BY p.id, p.name ORDER BY p.name`, [from, to]);
  return { month, stores: rows, owed_cents: rows.reduce((n, r) => n + r.owed_cents, 0) };
}
export async function settleTopups(actorId: string, b: { partner_id: string; month: string; ref: string }) {
  await needRegional();
  const [from, to] = monthRange(b.month);
  const rows = await q(`UPDATE partner_topups SET settled_at = now(), settled_ref = $4 WHERE partner_id = $1 AND created_at >= $2 AND created_at < $3
    AND voided_at IS NULL AND settled_at IS NULL RETURNING cents`, [b.partner_id, from, to, b.ref]);
  const cents = rows.reduce((n, r) => n + r.cents, 0);
  await audit(actorId, 'store_topups_settled', 'partner', b.partner_id, { month: b.month, ref: b.ref, cents, count: rows.length });
  return { settled: rows.length, cents };
}

// ───────────────────────── Phone bookings: who is calling ─────────────────────────
export async function callerLookup(rawPhone: string) {
  const phone = auMobile(rawPhone) ?? (rawPhone.startsWith('+') ? rawPhone.replace(/[^\d+]/g, '') : null);
  if (!phone) throw bad('phone', 'Enter a phone number');
  const u = await one(`SELECT id, name, phone, wallet_cents, blocked, language, accessibility, created_at FROM users WHERE phone = $1 AND deleted_at IS NULL`, [phone]);
  if (!u) return { phone, user: null, trips: [], bookings: [], consents: [] };
  const trips = await q(
    `SELECT id, ref, kind, service, status, pickup_address, dropoff_address, scheduled_for, requested_at, quote_cents, payment_method
     FROM trips WHERE rider_id = $1 AND (status IN ('scheduled','requested','accepted','arrived','in_progress') OR requested_at > now() - interval '30 days')
     ORDER BY coalesce(scheduled_for, requested_at) DESC LIMIT 10`, [u.id]);
  const bookings = (await regionalReady()) ? await myBookings(u.id) : [];
  const consents = await q(
    `SELECT c.account_id, a.name AS org, c.method, c.expires_at FROM client_consents c JOIN corporate_accounts a ON a.id = c.account_id
     WHERE c.client_id = $1 AND c.withdrawn_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > now())`, [u.id]).catch(() => []);
  return { phone, user: { id: u.id, name: u.name, wallet_cents: u.wallet_cents, blocked: u.blocked, language: u.language, accessibility: u.accessibility }, trips, bookings: bookings.slice(0, 10), consents };
}

export async function regionalBas(from: Date, to: Date) {
  if (!(await regionalReady())) return { takings: 0, driver_pay: 0 };
  const t = await one<{ cents: number }>(
    `SELECT coalesce(sum(b.paid_cents - b.refunded_cents), 0)::int AS cents FROM regional_bookings b JOIN regional_runs r ON r.id = b.run_id
     WHERE r.status = 'completed' AND r.completed_at >= $1 AND r.completed_at < $2`, [from, to]);
  const d = await one<{ cents: number }>(`SELECT coalesce(sum(amount_cents), 0)::int AS cents FROM driver_ledger WHERE kind = 'shuttle_run' AND created_at >= $1 AND created_at < $2`, [from, to]);
  return { takings: Number(t?.cents ?? 0), driver_pay: Number(d?.cents ?? 0) };
}
