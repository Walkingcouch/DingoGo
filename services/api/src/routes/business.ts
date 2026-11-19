/**
 * Business senders (Round 11): shops, pharmacies and community organisations sending several parcels.
 * Multi-drop runs (quote and book), the deliveries dashboard with a CSV export, and CSV import of deliveries.
 * A business account's managers see every delivery on the account; members see their own.
 */
import type { FastifyInstance, FastifyReply } from 'fastify';
import { one, q } from '../db.js';
import { requireUser } from '../auth.js';
import { ApiError, bad, forbidden } from '../lib/errors.js';
import { latLng, parse, z } from '../lib/validate.js';
import { CSV_COLUMNS, FAIL_REASONS, MAX_DROPS, csvToDrops, orderStops, type ParcelIn } from '../lib/courier.js';
import { courierPending, courierReady } from '../lib/courierSchema.js';
import { dollars, toCsv } from '../lib/csv.js';
import { parcelSchema } from './rider.js';
import * as trips from '../services/trips.js';

const runBase = z.object({
  pickup: latLng,
  sender_name: z.string().min(1).max(80),
  sender_phone: z.string().min(8).max(20),
  payment_method: z.enum(['card', 'cash', 'corporate', 'wallet']),
  corporate_account_id: z.string().uuid().nullable().optional(),
  scheduled_for: z.string().datetime().nullable().optional(),
  pickup_window_end: z.string().datetime().nullable().optional(),
  promo_code: z.string().max(30).nullable().optional(),
  ndis_number: z.string().regex(/^\d{9}$/).optional(),
  notes: z.string().max(300).optional(),
  prohibited_items: z.array(z.string().max(30)).max(20).optional(),
  prohibited_ack: z.boolean().default(false),
  /** Deliver in the order given (otherwise nearest drop first). */
  keep_order: z.boolean().optional(),
});
const dropParcel = parcelSchema.omit({ sender_name: true, sender_phone: true, prohibited_items: true, prohibited_ack: true });

type Base = z.infer<typeof runBase>;
const parcelOf = (b: Base, p: z.infer<typeof dropParcel>): ParcelIn =>
  ({ ...p, sender_name: b.sender_name, sender_phone: b.sender_phone, prohibited_ack: b.prohibited_ack, prohibited_items: b.prohibited_items });
const baseInput = (b: Base) => ({
  kind: 'courier' as const, pickup: b.pickup, payment_method: b.payment_method, corporate_account_id: b.corporate_account_id ?? null,
  scheduled_for: b.scheduled_for ?? null, pickup_window_end: b.pickup_window_end ?? null, promo_code: b.promo_code ?? null,
  ndis_number: b.ndis_number, notes: b.notes,
});

/** Book drops as runs of up to MAX_DROPS (a single drop is an ordinary parcel booking). */
async function book(userId: string, b: Base, drops: { dropoff: any; parcel: ParcelIn }[], source: 'app' | 'csv') {
  const out: { batch: any; trips: any[] }[] = [];
  for (let i = 0; i < drops.length; i += MAX_DROPS) {
    const chunk = drops.slice(i, i + MAX_DROPS);
    if (chunk.length === 1) {
      const t = await trips.createTrip(userId, { ...baseInput(b), service: trips.sizeService(chunk[0].parcel.size), dropoff: chunk[0].dropoff, parcel: chunk[0].parcel });
      out.push({ batch: null, trips: [t] });
    } else out.push(await trips.createRun(userId, baseInput(b), chunk, { source }));
  }
  return out;
}

/** Which deliveries this person may see for an account: managers all, members their own. Null account → their own. */
async function scope(userId: string, accountId?: string) {
  if (!accountId) return { sql: 't.rider_id = $1', args: [userId], manager: false };
  const m = await one(`SELECT m.role FROM corporate_members m JOIN corporate_accounts a ON a.id = m.account_id WHERE m.account_id = $1 AND m.user_id = $2 AND a.active`, [accountId, userId]);
  if (!m) throw forbidden('You are not a member of that business account');
  return m.role === 'manager'
    ? { sql: 't.corporate_account_id = $1', args: [accountId], manager: true }
    : { sql: 't.corporate_account_id = $1 AND t.rider_id = $2', args: [accountId, userId], manager: false };
}

const listQuery = z.object({
  account_id: z.string().uuid().optional(),
  status: z.enum(['all', 'active', 'done', 'problem']).default('all'),
  from: z.string().date().optional(), to: z.string().date().optional(),
  q: z.string().max(60).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

async function deliveries(userId: string, f: z.infer<typeof listQuery>) {
  const s = await scope(userId, f.account_id);
  const ready = await courierReady();
  const args: unknown[] = [...s.args];
  const add = (v: unknown) => { args.push(v); return `$${args.length}`; };
  const where = [s.sql, `t.kind = 'courier'`];
  if (f.status === 'active') where.push(`t.status IN ('scheduled','requested','accepted','arrived','in_progress')`);
  if (f.status === 'done') where.push(`t.status = 'completed'`);
  if (f.status === 'problem') {
    where.push(ready ? `(p.outcome IN ('returning','returned') OR t.status IN ('no_drivers','cancelled_driver','cancelled_admin') OR t.payment_status = 'failed')`
      : `(t.status IN ('no_drivers','cancelled_driver','cancelled_admin') OR t.payment_status = 'failed')`);
  }
  if (f.from) where.push(`coalesce(t.scheduled_for, t.requested_at) >= (${add(f.from)}::date)::timestamp AT TIME ZONE 'Australia/Darwin'`);
  if (f.to) where.push(`coalesce(t.scheduled_for, t.requested_at) < (${add(f.to)}::date + 1)::timestamp AT TIME ZONE 'Australia/Darwin'`);
  if (f.q) {
    const like = add(`%${f.q.replace(/[%_\\]/g, '')}%`);
    where.push(`(t.ref ILIKE ${like} OR p.recipient_name ILIKE ${like} OR t.dropoff_address ILIKE ${like}${ready ? ` OR p.customer_ref ILIKE ${like}` : ''})`);
  }
  const extra = ready
    ? `, p.customer_ref, p.outcome, p.eta_at, p.failed_reason, p.safe_place, t.batch_seq, t.pickup_window_end, b.ref AS run_ref`
    : `, NULL::text AS customer_ref, NULL::text AS outcome, NULL::timestamptz AS eta_at, NULL::text AS failed_reason, NULL::text AS safe_place,
       NULL::int AS batch_seq, NULL::timestamptz AS pickup_window_end, NULL::text AS run_ref`;
  const rows = await q(
    `SELECT t.id, t.ref, t.status, t.service, t.requested_at, t.scheduled_for, t.completed_at, t.cancelled_at, t.dropoff_address,
            t.quote_cents, t.final_cents, t.payment_method, t.payment_status, t.rider_id, ru.name AS booked_by,
            p.size, p.recipient_name, p.delivered_at, p.pod_received_by, p.pod_photo_url IS NOT NULL AS has_photo,
            (p.pod_signature IS NOT NULL) AS signed ${extra}
     FROM trips t JOIN parcels p ON p.trip_id = t.id JOIN users ru ON ru.id = t.rider_id
     ${ready ? 'LEFT JOIN courier_batches b ON b.id = t.batch_id' : ''}
     WHERE ${where.join(' AND ')}
     ORDER BY coalesce(t.scheduled_for, t.requested_at) DESC, t.ref LIMIT ${f.limit}`, args);
  for (const r of rows) {
    r.proof = r.signed ? 'signature' : r.has_photo ? 'photo' : r.delivered_at ? 'pin' : null;
    r.failed_reason = r.failed_reason ? (FAIL_REASONS as Record<string, string>)[r.failed_reason] ?? r.failed_reason : null;
    if (!r.outcome && r.delivered_at) r.outcome = 'delivered';
    delete r.signed; delete r.has_photo;
  }
  return { rows, manager: s.manager };
}

function sendCsv(reply: FastifyReply, filename: string, body: string) {
  reply.header('content-type', 'text/csv; charset=utf-8');
  reply.header('content-disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  reply.header('cache-control', 'no-store');
  return reply.send(body);
}

export default async function businessRoutes(app: FastifyInstance) {
  /** Price a multi-drop run (drops in delivery order, nearest first unless keep_order). */
  app.post('/courier/runs/quote', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({
      pickup: latLng, drops: z.array(z.object({ dropoff: latLng, size: z.enum(['S', 'M', 'L']) })).min(1).max(MAX_DROPS),
      scheduled_for: z.string().datetime().nullable().optional(), corporate_account_id: z.string().uuid().nullable().optional(),
      promo_code: z.string().max(30).nullable().optional(), keep_order: z.boolean().optional(),
    }), req.body);
    const drops = (b.keep_order ? b.drops : orderStops(b.pickup, b.drops)).map((d) => ({ ...d, index: b.drops.indexOf(d) }));
    const r = await trips.quoteRun(me.id, { pickup: b.pickup, scheduled_for: b.scheduled_for, corporate_account_id: b.corporate_account_id, promo_code: b.promo_code }, drops);
    return { ...r, stops: r.stops.map((s, i) => ({ ...s, index: drops[i].index })), runs_available: await courierReady() };
  });

  /** Book a multi-drop run: one pickup, up to MAX_DROPS drops, one driver. */
  app.post('/courier/runs', async (req, reply) => {
    const me = await requireUser(req);
    const b = parse(runBase.extend({ drops: z.array(z.object({ dropoff: latLng, parcel: dropParcel })).min(2).max(MAX_DROPS) }), req.body);
    const drops = (b.keep_order ? b.drops : orderStops(b.pickup, b.drops)).map((d) => ({ dropoff: d.dropoff, parcel: parcelOf(b, d.parcel) }));
    const r = await trips.createRun(me.id, baseInput(b), drops, { source: 'app' });
    reply.code(201);
    return { batch: r.batch, trips: r.trips.map((t) => trips.viewFor(t, me)) };
  });

  /** Deliveries dashboard. */
  app.get('/business/deliveries', async (req) => {
    const me = await requireUser(req);
    const f = parse(listQuery, req.query);
    const { rows, manager } = await deliveries(me.id, f);
    const count = (k: (r: any) => boolean) => rows.filter(k).length;
    return {
      deliveries: rows, manager, runs_available: await courierReady(),
      summary: {
        total: rows.length, active: count((r) => ['scheduled', 'requested', 'accepted', 'arrived', 'in_progress'].includes(r.status) && r.outcome !== 'returning'),
        delivered: count((r) => r.outcome === 'delivered'), returned: count((r) => r.outcome === 'returning' || r.outcome === 'returned'),
        not_sent: count((r) => ['no_drivers', 'cancelled_rider', 'cancelled_driver', 'cancelled_admin'].includes(r.status)),
        spent_cents: rows.reduce((n, r) => n + (r.status === 'completed' ? Number(r.final_cents ?? 0) : 0), 0),
      },
    };
  });

  app.get('/business/deliveries.csv', async (req, reply) => {
    const me = await requireUser(req);
    const f = parse(listQuery.extend({ limit: z.coerce.number().int().min(1).max(5000).default(5000) }), req.query);
    const { rows } = await deliveries(me.id, f);
    const csv = toCsv<any>([
      ['Ref', (r) => r.ref], ['Run', (r) => r.run_ref ? `${r.run_ref} #${r.batch_seq}` : ''], ['Your reference', (r) => r.customer_ref],
      ['Booked by', (r) => r.booked_by], ['Booked for', (r) => r.scheduled_for ?? r.requested_at], ['Status', (r) => r.status],
      ['Outcome', (r) => r.outcome], ['Recipient', (r) => r.recipient_name], ['Address', (r) => r.dropoff_address], ['Size', (r) => r.size],
      ['Delivered at', (r) => r.delivered_at], ['Received by', (r) => r.pod_received_by], ['Proof', (r) => r.proof],
      ['Not delivered because', (r) => r.failed_reason], ['Price incl. GST', (r) => dollars(r.final_cents ?? r.quote_cents)],
      ['Payment', (r) => r.payment_method], ['Payment status', (r) => r.payment_status],
    ], rows);
    return sendCsv(reply, `dingogo-deliveries-${new Date().toISOString().slice(0, 10)}.csv`, csv);
  });

  /** CSV import: check every row (dry_run, or any row wrong → nothing booked), then book as runs of up to MAX_DROPS. */
  app.post('/business/deliveries/import', async (req, reply) => {
    const me = await requireUser(req);
    const b = parse(runBase.extend({ csv: z.string().min(1).max(200_000), dry_run: z.boolean().default(true) }), req.body);
    if (!(await courierReady()) && !b.dry_run) throw new ApiError(503, 'migration_pending', `${courierPending()}. Book each parcel on its own for now.`);
    const parsed = csvToDrops(b.csv);
    const ordered = b.keep_order ? parsed.drops : orderStops(b.pickup, parsed.drops);
    const runs: { rows: number[]; total_cents: number; distance_m: number; stops: { row: number; total_cents: number }[] }[] = [];
    if (!parsed.errors.length && ordered.length) {
      for (let i = 0; i < ordered.length; i += MAX_DROPS) {
        const chunk = ordered.slice(i, i + MAX_DROPS);
        const r = await trips.quoteRun(me.id, { pickup: b.pickup, scheduled_for: b.scheduled_for, corporate_account_id: b.corporate_account_id },
          chunk.map((d) => ({ dropoff: d.dropoff, size: d.parcel.size })));
        runs.push({ rows: chunk.map((d) => d.row), total_cents: r.total_cents, distance_m: r.distance_m, stops: r.stops.map((s, k) => ({ row: chunk[k].row, total_cents: s.quote.total_cents })) });
      }
    }
    const preview = { drops: ordered.map((d) => ({ row: d.row, address: d.dropoff.address, recipient_name: d.parcel.recipient_name, size: d.parcel.size, reference: d.parcel.customer_ref ?? null })),
      errors: parsed.errors, runs, total_cents: runs.reduce((n, r) => n + r.total_cents, 0), columns: CSV_COLUMNS };
    if (b.dry_run) return { ...preview, booked: false };
    if (parsed.errors.length) throw bad('csv_errors', `${parsed.errors.length} row${parsed.errors.length > 1 ? 's' : ''} need fixing before anything is booked`, parsed.errors);
    if (!ordered.length) throw bad('csv_empty', 'No deliveries in the file');
    // Rows are checked as one booking each: every phone and weight again (checkParcel) before anything is created.
    const drops = ordered.map((d) => ({ dropoff: d.dropoff, parcel: parcelOf(b, d.parcel as any) }));
    const made = await book(me.id, { ...b, keep_order: true }, drops, 'csv');
    reply.code(201);
    return { ...preview, booked: true, runs: made.map((r) => ({ batch: r.batch, trips: r.trips.map((t) => ({ id: t.id, ref: t.ref, status: t.status, quote_cents: t.quote_cents })) })) };
  });
}
