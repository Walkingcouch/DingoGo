/**
 * Round 28: community trips. Public routes and the low-data page; riders' shuttle seats and parcels; drivers' shuttle manifest,
 * boarding, store drop-offs and long-trip check-ins; community store top-ups and parcel collection; ops runs, phone bookings,
 * caller lookup, store cash and the routes policy.
 */
import type { FastifyInstance } from 'fastify';
import { one, pool, q } from '../db.js';
import { requireUser } from '../auth.js';
import { config } from '../config.js';
import { ApiError, bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { referralCode } from '../lib/ids.js';
import { record, tooMany } from '../lib/rateLimit.js';
import { litePage, parseSms } from '../lib/regional.js';
import { isoMonth, parse, phone, z } from '../lib/validate.js';
import { toOps } from '../realtime.js';
import * as reg from '../services/regional.js';
import { smsConfigured } from '../services/sms.js';
import { event } from '../services/trips.js';

const UUID = z.string().uuid();
const pointId = z.string().regex(/^[a-z0-9-]{2,40}$/).nullable().optional();
const bookingSchema = z.object({
  run_id: UUID, kind: z.enum(['seat', 'parcel']), seats: z.number().int().min(1).max(8).optional(),
  pickup_point: pointId, dropoff_point: pointId,
  parcel: z.object({ size: z.enum(['S', 'M', 'L']), description: z.string().trim().min(2).max(200), recipient_name: z.string().trim().min(1).max(80),
    recipient_phone: z.string().min(8).max(20), prohibited_ok: z.boolean() }).nullable().optional(),
});

export default async function regionalRoutes(app: FastifyInstance) {
  // The low-data page posts a plain HTML form. Only routes in this plugin see this parser.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 8 * 1024 },
    (_req, body, done) => done(null, Object.fromEntries(new URLSearchParams(String(body)))));

  // ───────────── Public ─────────────
  app.get('/public/regional', async () => {
    const policy = await reg.regionalPolicy();
    const runs = (await reg.regionalReady()) ? await reg.bookableRuns(21) : [];
    return {
      ready: await reg.regionalReady(),
      corridors: policy.corridors.filter((c) => c.active).map(reg.publicCorridor),
      runs: runs.map((r) => ({ id: r.id, corridor: r.corridor, direction: r.direction, label: r.label, departs_at: r.departs_at, when: r.when, seats_left: r.seats_left,
        parcels_left: Math.max(0, r.parcel_capacity - r.parcels_taken) })),
      max_metered_km: policy.max_metered_km, min_notice_hours: policy.min_notice_hours, cutoff_min: policy.cutoff_min,
      sms_booking: smsConfigured(), support_phone: await reg.supportPhone(),
    };
  });

  /** Low-data booking page: no scripts, no map, a few KB. */
  const lite = async (reply: any, o: { message?: string | null; error?: string | null; status?: number } = {}) => {
    const policy = await reg.regionalPolicy();
    const runs = (await reg.regionalReady()) ? await reg.bookableRuns(14) : [];
    reply.code(o.status ?? 200).header('content-type', 'text/html; charset=utf-8')
      .header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'")
      .header('cache-control', 'no-store');
    return litePage({ policy, runs, phone: await reg.supportPhone(), message: o.message, error: o.error, formAction: config.serverless ? '/api/lite/book' : '/lite/book' });
  };
  app.get('/lite', async (_req, reply) => lite(reply));
  app.post('/lite/book', async (req, reply) => {
    const ip = req.ip;
    if (await tooMany('lite_book_ip', ip, 10, 3600)) return lite(reply, { error: 'Too many tries from here. Wait an hour or call us.', status: 429 });
    await record('lite_book_ip', ip);
    const b = (req.body && typeof req.body === 'object' ? req.body : {}) as Record<string, string>;
    if (!(await reg.regionalReady())) return lite(reply, { error: 'Booking online is not open yet. Call us to book.', status: 503 });
    if (!smsConfigured()) return lite(reply, { error: 'We can not confirm bookings by text right now. Call us to book.', status: 503 });
    const seats = Number(b.seats ?? 1);
    if (!UUID.safeParse(b.run_id).success || !(seats >= 1 && seats <= 8)) return lite(reply, { error: 'Choose a shuttle and the number of seats.', status: 400 });
    try {
      const r = await reg.liteBook({ run_id: b.run_id, seats, phone: String(b.phone ?? '').slice(0, 20) });
      const masked = `${r.phone.replace('+61', '0').slice(0, 4)} xxx x${r.phone.slice(-2)}`;
      return lite(reply, { message: `We have sent a text to ${masked}. Reply YES to it to book. No text? Check the number or call us.` });
    } catch (e: any) {
      if (e instanceof ApiError) return lite(reply, { error: e.message, status: e.status });
      throw e;
    }
  });

  // ───────────── Riders ─────────────
  app.get('/regional', async (req) => {
    const me = await requireUser(req);
    const policy = await reg.regionalPolicy();
    const ready = await reg.regionalReady();
    return {
      ready,
      corridors: policy.corridors.filter((c) => c.active).map(reg.publicCorridor),
      runs: ready ? await reg.bookableRuns(21) : [],
      bookings: ready ? await reg.myBookings(me.id) : [],
      wallet_cents: Number((await one('SELECT wallet_cents FROM users WHERE id = $1', [me.id]))?.wallet_cents ?? 0),
      min_notice_hours: policy.min_notice_hours, cutoff_min: policy.cutoff_min, max_seats: policy.max_seats_per_booking,
    };
  });
  app.post('/regional/bookings', async (req, reply) => {
    const me = await requireUser(req);
    const b = parse(bookingSchema, req.body);
    const r = await reg.book(b as reg.BookingIn, { userId: me.id, channel: 'app' });
    reply.code(201);
    return r;
  });
  app.post('/regional/bookings/:id/cancel', async (req) => {
    const me = await requireUser(req);
    return reg.cancelBooking(me, (req.params as any).id);
  });

  // ───────────── Drivers ─────────────
  app.get('/driver/regional/runs', async (req) => {
    const me = await requireUser(req, 'driver');
    await reg.needRegional();
    return { runs: await reg.listRuns({ driverId: me.id, from: new Date(Date.now() - 2 * 86400_000), days: 30 }) };
  });
  app.get('/driver/regional/runs/:id/manifest', async (req) => {
    const me = await requireUser(req, 'driver');
    return reg.manifest((req.params as any).id, me);
  });
  app.post('/driver/regional/runs/:id/:action', async (req) => {
    const me = await requireUser(req, 'driver');
    const { id, action } = req.params as any;
    if (!['depart', 'checkin', 'complete'].includes(action)) throw notFound('Action');
    const b = parse(z.object({ lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional() }), req.body ?? {});
    return { run: await reg.driverRunAction(me.id, id, action, b) };
  });
  app.post('/driver/regional/bookings/:id/board', async (req) => {
    const me = await requireUser(req, 'driver');
    const b = parse(z.object({ status: z.enum(['boarded', 'no_show']) }), req.body);
    return { booking: await reg.boardBooking(me.id, (req.params as any).id, b.status) };
  });
  app.post('/driver/regional/bookings/:id/at-store', async (req) => {
    const me = await requireUser(req, 'driver');
    return { booking: await reg.parcelAtStore(me.id, (req.params as any).id) };
  });
  /** Long trip: "I'm OK, here" (any GPS point counts too). Coverage gaps mean a missed check-in is a warning, not an alarm. */
  app.post('/driver/trips/:id/checkin', async (req) => {
    const me = await requireUser(req, 'driver');
    const b = parse(z.object({ lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), note: z.string().max(200).optional() }), req.body ?? {});
    const id = (req.params as any).id;
    const t = UUID.safeParse(id).success ? await one(`SELECT id, ref, driver_id, status, fare_breakdown ? 'regional' AS regional FROM trips WHERE id = $1`, [id]) : null;
    if (!t || t.driver_id !== me.id) throw notFound('Trip');
    if (!t.regional) throw bad('not_long_trip', 'Check-ins are for community trips');
    if (!['accepted', 'arrived', 'in_progress'].includes(t.status)) throw conflict('trip_not_live', 'This trip is not on the road');
    await event(pool, t.id, 'regional_checkin', me.id, { lat: b.lat ?? null, lng: b.lng ?? null, note: b.note ?? null });
    toOps('regional.checkin', { trip_id: t.id, ref: t.ref, lat: b.lat ?? null, lng: b.lng ?? null });
    return { ok: true, at: new Date().toISOString() };
  });

  // ───────────── Community stores (partner portal) ─────────────
  const store = async (req: any) => {
    const me = await requireUser(req, 'partner');
    if (!me.partner_id) throw forbidden('No partner business linked to this account');
    return { me, pid: me.partner_id as string };
  };
  const wrongCode = async (userId: string) => {
    if (await tooMany('partner_code_fail', userId, config.rateLimits.partnerCodeFailsPerUser, 3600)) {
      throw new ApiError(429, 'too_many_attempts', 'Too many wrong codes. Try again in an hour, or call DingoGo.');
    }
  };
  app.get('/partner/topups', async (req) => {
    const { pid } = await store(req);
    return reg.storeTopups(pid, (req.query as any).month);
  });
  app.post('/partner/topups', async (req, reply) => {
    const { me, pid } = await store(req);
    const b = parse(z.object({ phone: z.string().min(8).max(20), cents: z.number().int(), name: z.string().trim().max(80).nullable().optional(), confirm: z.literal(true) }), req.body);
    const r = await reg.createTopup(pid, me.id, b);
    reply.code(201);
    return r;
  });
  app.post('/partner/topups/:id/void', async (req) => {
    const { me, pid } = await store(req);
    return reg.voidTopup(pid, me.id, (req.params as any).id);
  });
  app.get('/partner/regional/parcels', async (req) => {
    const { pid } = await store(req);
    return reg.storeParcels(pid);
  });
  app.post('/partner/regional/collect', async (req) => {
    const { me, pid } = await store(req);
    await wrongCode(me.id);
    const b = parse(z.object({ code: z.string().trim().regex(/^\d{6}$/, 'The code is 6 numbers') }), req.body);
    const r = await reg.collectParcel(pid, me.id, b.code);
    if (!r) { await record('partner_code_fail', me.id); throw bad('code_invalid', 'No parcel waiting here with that code'); }
    return { parcel: r };
  });

  // ───────────── Ops ─────────────
  const ops = (req: any) => requireUser(req, 'admin', 'dispatcher');
  const admin = (req: any) => requireUser(req, 'admin');
  app.get('/admin/regional', async (req) => {
    await ops(req);
    const ready = await reg.regionalReady();
    return {
      ready, policy: await reg.regionalPolicy(),
      runs: ready ? await reg.listRuns({ days: 28 }) : [],
      on_the_road: await reg.onTheRoad(),
      drivers: ready ? await q(`SELECT d.user_id AS id, u.name FROM drivers d JOIN users u ON u.id = d.user_id
        WHERE d.status = 'approved' AND (to_jsonb(d)->>'long_trips')::boolean AND NOT u.blocked AND u.deleted_at IS NULL ORDER BY u.name`) : [],
    };
  });
  app.put('/admin/regional/policy', async (req) => {
    const me = await admin(req);
    return { policy: await reg.saveRegionalPolicy(me.id, (req.body as any)?.policy ?? req.body) };
  });
  app.post('/admin/regional/runs', async (req, reply) => {
    const me = await ops(req);
    const b = parse(z.object({ corridor: z.string().max(40), direction: z.enum(['out', 'back']), departs_at: z.string().datetime({ offset: true }),
      seats: z.number().int().min(1).max(12).optional(), parcel_capacity: z.number().int().min(0).max(40).optional(), notes: z.string().max(300).nullable().optional() }), req.body);
    reply.code(201);
    return { run: await reg.createRun(me.id, b) };
  });
  app.post('/admin/regional/runs/schedule', async (req) => {
    const me = await ops(req);
    const b = parse(z.object({ corridor: z.string().max(40).optional(), days: z.number().int().min(1).max(56) }), req.body);
    return reg.scheduleRuns(me.id, b);
  });
  app.patch('/admin/regional/runs/:id', async (req) => {
    const me = await ops(req);
    const b = parse(z.object({ driver_id: UUID.nullable().optional(), seats: z.number().int().min(1).max(12).optional(), parcel_capacity: z.number().int().min(0).max(40).optional(),
      status: z.enum(['open', 'closed', 'cancelled']).optional(), notes: z.string().max(300).nullable().optional() }), req.body);
    return { run: await reg.updateRun(me.id, (req.params as any).id, b) };
  });
  app.get('/admin/regional/runs/:id/manifest', async (req, reply) => {
    const me = await ops(req);
    const m = await reg.manifest((req.params as any).id, me);
    if ((req.query as any).format === 'csv') {
      reply.header('content-type', 'text/csv; charset=utf-8').header('content-disposition', `attachment; filename="manifest-${m.run.ref}.csv"`);
      return reg.manifestCsv(m);
    }
    return m;
  });
  /** A seat or parcel booked for a caller (no smartphone): paid from their credit, texted to them. */
  app.post('/admin/regional/bookings', async (req, reply) => {
    const me = await ops(req);
    const b = parse(bookingSchema.extend({ phone, name: z.string().trim().min(1).max(80) }), req.body);
    let u = await one('SELECT id FROM users WHERE phone = $1 AND deleted_at IS NULL', [b.phone]);
    if (!u) u = await one(`INSERT INTO users (phone, name, referral_code) VALUES ($1,$2,$3) RETURNING id`, [b.phone, b.name, referralCode(b.name)]);
    const r = await reg.book(b as reg.BookingIn, { userId: u.id, channel: 'phone', bookedBy: me.id, staff: true });
    reply.code(201);
    return r;
  });
  app.post('/admin/regional/bookings/:id/cancel', async (req) => {
    const me = await ops(req);
    return reg.cancelBooking(me, (req.params as any).id);
  });
  app.get('/admin/callers', async (req) => {
    await ops(req);
    return reg.callerLookup(String((req.query as any).phone ?? '').slice(0, 20));
  });
  app.get('/admin/regional/topups', async (req) => {
    await admin(req);
    return reg.topupSummary((req.query as any).month);
  });
  app.post('/admin/regional/topups/settle', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ partner_id: UUID, month: isoMonth(), ref: z.string().trim().min(2).max(60) }), req.body);
    return reg.settleTopups(me.id, b);
  });
}

/** The SMS webhook's booking step (comms routes): booking words to any DingoGo number, unless the text belongs in a live trip's chat. */
export async function bookingReply(from: string, body: string, o: { liveTrip: boolean }) {
  const cmd = parseSms(body);
  if (!cmd) return null;
  if (o.liveTrip && !((cmd.kind === 'yes' || cmd.kind === 'no') && await reg.hasPending(from))) return null;
  return reg.handleBookingSms(from, cmd);
}
