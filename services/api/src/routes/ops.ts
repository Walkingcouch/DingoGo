/**
 * Operations tooling (Round 7): search everything, SOS incident view and runbook, server-side CSV exports, daily ops summary,
 * audit log with filters. Uses only existing tables (audit_log carries incident notes and runbook steps), so it works before
 * migration 013 (which only adds indexes).
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { one, q } from '../db.js';
import { requireUser } from '../auth.js';
import { bad, notFound } from '../lib/errors.js';
import { parse, z } from '../lib/validate.js';
import { audit } from '../lib/audit.js';
import { toCsv, dollars, type CsvCol } from '../lib/csv.js';
import { toOps } from '../realtime.js';
import { darwinToday, gstReport, levyReport, phoneTail, tripFilters, validDate } from '../services/reports.js';

const ops = (req: FastifyRequest) => requireUser(req, 'admin', 'dispatcher');
const admin = (req: FastifyRequest) => requireUser(req, 'admin');
const TZ = `'Australia/Darwin'`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** SOS runbook: what ops works through for every emergency alert. Ticking a step is recorded on the incident timeline. */
export const SOS_RUNBOOK = [
  { key: 'danger', label: 'Ask if anyone is in danger right now. If yes, call 000 first (police, fire, ambulance).' },
  { key: 'call_raiser', label: 'Call the person who raised the alert.' },
  { key: 'location', label: 'Check their location and the trip track.' },
  { key: 'other_party', label: 'Contact the other person on the trip (driver or rider).' },
  { key: 'police', label: 'Police told, if needed (000, or 131 444 if not urgent).' },
  { key: 'welfare', label: 'Check they are safe now and know how to reach us.' },
  { key: 'account_action', label: 'Decide on the driver or rider account (suspend, block or no action) and note why.' },
] as const;
const STEP_KEYS = SOS_RUNBOOK.map((s) => s.key) as [string, ...string[]];

/** Local Darwin time for CSV cells (spreadsheets show what ops sees on screen). */
const local = (d: Date | string | null | undefined) => {
  if (!d) return '';
  const t = new Date(new Date(d).getTime() + 9.5 * 3600e3).toISOString();
  return `${t.slice(0, 10)} ${t.slice(11, 16)}`;
};

function sendCsv(reply: FastifyReply, filename: string, body: string) {
  reply.header('content-type', 'text/csv; charset=utf-8');
  reply.header('content-disposition', `attachment; filename="${filename.replace(/[^\w.-]/g, '_')}"`);
  reply.header('cache-control', 'no-store');
  return reply.send(body);
}

const dayBounds = (n: string) => `(${n}::date)::timestamp AT TIME ZONE ${TZ}`;
const nextDay = (n: string) => `((${n}::date + 1)::timestamp AT TIME ZONE ${TZ})`;

/** Incident view of one SOS alert: who raised it, the trip, the runbook and a timeline (alert, staff actions, notes, trip events). */
export async function sosIncident(id: string) {
  if (!UUID.test(id)) throw notFound('Alert');
  const alert = await one(
    `SELECT s.*, u.name AS user_name, u.phone AS user_phone, h.name AS handled_by_name FROM sos_alerts s
     JOIN users u ON u.id = s.user_id LEFT JOIN users h ON h.id = s.handled_by WHERE s.id = $1`, [id]);
  if (!alert) throw notFound('Alert');
  const trip = alert.trip_id ? await one(
    `SELECT t.id, t.ref, t.kind, t.status, t.pickup_address, t.dropoff_address, t.share_token, t.pickup_lat, t.pickup_lng, t.dropoff_lat, t.dropoff_lng,
            t.rider_id, ru.name AS rider_name, ru.phone AS rider_phone, t.driver_id, du.name AS driver_name, du.phone AS driver_phone,
            v.rego, v.make, v.model, v.colour, d.lat AS driver_lat, d.lng AS driver_lng, d.last_seen_at AS driver_last_seen_at
     FROM trips t JOIN users ru ON ru.id = t.rider_id LEFT JOIN users du ON du.id = t.driver_id
     LEFT JOIN drivers d ON d.user_id = t.driver_id LEFT JOIN vehicles v ON v.id = t.vehicle_id WHERE t.id = $1`, [alert.trip_id]) : null;
  const track = trip ? await q(
    `SELECT lat, lng, at FROM trip_track WHERE trip_id = $1 AND at BETWEEN $2::timestamptz - interval '30 minutes' AND coalesce($3::timestamptz, now()) ORDER BY at`,
    [trip.id, alert.created_at, alert.resolved_at]) : [];
  const actions = await q(
    `SELECT a.id, a.action, a.data, a.at, a.actor_id, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.entity = 'sos' AND a.entity_id = $1 ORDER BY a.at, a.id`, [id]);
  const tripEvents = trip ? await q(
    `SELECT e.type, e.at, e.data, u.name AS actor_name FROM trip_events e LEFT JOIN users u ON u.id = e.actor_id
     WHERE e.trip_id = $1 AND e.at BETWEEN $2::timestamptz - interval '30 minutes' AND coalesce($3::timestamptz, now()) + interval '30 minutes'
     ORDER BY e.at`, [trip.id, alert.created_at, alert.resolved_at]) : [];

  type Entry = { at: string; kind: string; text: string; by?: string | null };
  const timeline: Entry[] = [{ at: alert.created_at, kind: 'raised', text: `${alert.user_name ?? 'Someone'} (${alert.role}) raised an emergency alert${alert.message ? `: ${alert.message}` : ''}`, by: alert.user_name }];
  for (const a of actions) {
    const d = a.data ?? {};
    if (a.action === 'sos_step') timeline.push({ at: a.at, kind: 'step', text: SOS_RUNBOOK.find((s) => s.key === d.step)?.label ?? String(d.step), by: a.actor_name });
    else if (a.action === 'sos_note') timeline.push({ at: a.at, kind: 'note', text: String(d.text ?? ''), by: a.actor_name });
    else if (a.action === 'sos_acknowledged') timeline.push({ at: a.at, kind: 'acknowledged', text: d.text ? `Acknowledged: ${d.text}` : 'Acknowledged', by: a.actor_name });
    else if (a.action === 'sos_resolved') timeline.push({ at: a.at, kind: 'resolved', text: d.text ? `Resolved: ${d.text}` : 'Resolved', by: a.actor_name });
  }
  // Alerts handled before Round 7 have notes but no audit rows: show them once.
  if (alert.notes && !actions.some((a) => a.action === 'sos_resolved' || a.action === 'sos_note')) {
    timeline.push({ at: alert.resolved_at ?? alert.created_at, kind: 'note', text: alert.notes, by: alert.handled_by_name });
  }
  for (const e of tripEvents) if (e.type !== 'sos') timeline.push({ at: e.at, kind: 'trip', text: `Trip: ${String(e.type).replace(/_/g, ' ')}`, by: e.actor_name });
  timeline.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

  const runbook = SOS_RUNBOOK.map((s) => {
    const done = actions.find((a) => a.action === 'sos_step' && a.data?.step === s.key);
    return { ...s, done_at: done?.at ?? null, done_by: done?.actor_name ?? null };
  });
  return { alert, trip, track, timeline, runbook };
}

export default async function opsRoutes(app: FastifyInstance) {
  // ───────────── Search everything ─────────────
  /** One box: trips by ref or phone, people by name/phone/email, drivers by name/phone/rego, cars by rego/VIN. */
  app.get('/admin/search', async (req) => {
    await ops(req);
    const s = String((req.query as any).q ?? '').trim().slice(0, 100);
    if (s.length < 2) return { q: s, trips: [], drivers: [], people: [], vehicles: [] };
    const like = `%${s}%`;
    const tail = phoneTail(s);
    const phoneLike = tail ? `%${tail}%` : null;
    const rego = s.toUpperCase().replace(/\s+/g, '');
    const regoLike = /^[A-Z0-9]{2,17}$/.test(rego) ? `%${rego}%` : null;
    const [trips, drivers, people, vehicles] = await Promise.all([
      q(`SELECT t.id, t.ref, t.kind, t.service, t.status, t.requested_at, t.pickup_address, t.dropoff_address, ru.name AS rider_name, du.name AS driver_name
         FROM trips t JOIN users ru ON ru.id = t.rider_id LEFT JOIN users du ON du.id = t.driver_id
         WHERE t.ref ILIKE $1 OR ($2::text IS NOT NULL AND (ru.phone LIKE $2 OR du.phone LIKE $2))
         ORDER BY (upper(t.ref) = upper($3)) DESC, t.requested_at DESC LIMIT 8`, [like, phoneLike, s]),
      q(`SELECT d.user_id AS id, u.name, u.phone, d.status, d.online, v.rego FROM drivers d JOIN users u ON u.id = d.user_id LEFT JOIN vehicles v ON v.id = d.vehicle_id
         WHERE u.deleted_at IS NULL AND (u.name ILIKE $1 OR ($2::text IS NOT NULL AND u.phone LIKE $2)
           OR ($3::text IS NOT NULL AND replace(upper(coalesce(v.rego,'')), ' ', '') LIKE $3))
         ORDER BY u.name LIMIT 8`, [like, phoneLike, regoLike]),
      q(`SELECT u.id, u.name, u.phone, u.email, u.role, u.blocked, u.test_account,
                (SELECT count(*)::int FROM trips t WHERE t.rider_id = u.id) AS trips
         FROM users u WHERE u.deleted_at IS NULL AND u.role <> 'driver'
           AND (u.name ILIKE $1 OR coalesce(u.email,'') ILIKE $1 OR ($2::text IS NOT NULL AND u.phone LIKE $2))
         ORDER BY u.name LIMIT 8`, [like, phoneLike]),
      regoLike ? q(`SELECT v.id, v.rego, v.make, v.model, v.colour, v.status, v.fuel_type, ou.name AS owner_name,
                coalesce((SELECT d.user_id FROM drivers d WHERE d.vehicle_id = v.id LIMIT 1), v.owner_driver_id) AS driver_id
         FROM vehicles v LEFT JOIN users ou ON ou.id = v.owner_driver_id
         WHERE replace(upper(v.rego), ' ', '') LIKE $1 OR upper(coalesce(v.vin,'')) LIKE $1 ORDER BY v.rego LIMIT 8`, [regoLike]) : Promise.resolve([]),
    ]);
    return { q: s, trips, drivers, people, vehicles };
  });

  // ───────────── SOS incident view ─────────────
  app.get('/admin/sos/:id', async (req) => {
    await ops(req);
    return { ...(await sosIncident((req.params as any).id)), runbook_steps: SOS_RUNBOOK };
  });

  /** Add a note or tick a runbook step. The first action on an open alert also acknowledges it (someone has it). */
  app.post('/admin/sos/:id/notes', async (req) => {
    const me = await ops(req);
    const id = (req.params as any).id;
    const b = parse(z.object({ text: z.string().trim().min(1).max(1000).optional(), step: z.enum(STEP_KEYS).optional() }).refine((v) => v.text || v.step, 'Add a note or a step'), req.body);
    if (!UUID.test(id)) throw notFound('Alert');
    const alert = await one('SELECT id, status FROM sos_alerts WHERE id = $1', [id]);
    if (!alert) throw notFound('Alert');
    if (b.step && await one(`SELECT 1 FROM audit_log WHERE entity = 'sos' AND entity_id = $1 AND action = 'sos_step' AND data->>'step' = $2`, [id, b.step])) {
      // Already ticked (another dispatcher, or a double click): nothing new to record.
    } else if (b.step) await audit(me.id, 'sos_step', 'sos', id, { step: b.step, text: b.text ?? null });
    if (b.text && !b.step) await audit(me.id, 'sos_note', 'sos', id, { text: b.text });
    if (alert.status === 'open') {
      const s = await one(`UPDATE sos_alerts SET status = 'acknowledged', handled_by = $2 WHERE id = $1 AND status = 'open' RETURNING *`, [id, me.id]);
      if (s) { await audit(me.id, 'sos_acknowledged', 'sos', id); toOps('sos.updated', s); }
    }
    return sosIncident(id);
  });

  // ───────────── CSV exports ─────────────
  app.get('/admin/export/:name', async (req, reply) => {
    const name = String((req.params as any).name);
    const p = req.query as Record<string, string | undefined>;
    const me = name === 'trips.csv' ? await ops(req) : await admin(req);
    let csv: string; let file: string; let rows = 0;
    if (name === 'trips.csv') {
      const to = validDate(p.to, darwinToday());
      const from = validDate(p.from, new Date(Date.parse(to) - 30 * 864e5).toISOString().slice(0, 10));
      if (Date.parse(to) - Date.parse(from) > 366 * 864e5 || from > to) throw bad('bad_range', 'Choose up to a year, with the start before the end');
      const { where, vals } = tripFilters({ ...p, from, to });
      // No phone numbers or PINs in exports: names, places and money only.
      const list = await q(
        `SELECT t.ref, t.kind, t.service, t.status, t.channel, t.requested_at, t.scheduled_for, t.completed_at, t.cancelled_at, t.cancel_reason,
                t.pickup_address, t.dropoff_address, ru.name AS rider_name, du.name AS driver_name, v.rego, t.payment_method, t.payment_status,
                t.quote_cents, t.final_cents, t.tip_cents, t.cancel_fee_cents, (t.fare_breakdown->>'levy_cents')::int AS levy_cents,
                coalesce(t.actual_distance_m, t.est_distance_m) AS distance_m, t.rider_rating
         FROM trips t JOIN users ru ON ru.id = t.rider_id LEFT JOIN users du ON du.id = t.driver_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
         WHERE ${where.join(' AND ')} ORDER BY t.requested_at LIMIT 50000`, vals);
      const cols: CsvCol<any>[] = [
        ['Ref', (r) => r.ref], ['Type', (r) => r.kind], ['Service', (r) => r.service], ['Status', (r) => r.status], ['Booked via', (r) => r.channel],
        ['Requested (Darwin)', (r) => local(r.requested_at)], ['Booked for', (r) => local(r.scheduled_for)], ['Completed', (r) => local(r.completed_at)],
        ['Cancelled', (r) => local(r.cancelled_at)], ['Cancel reason', (r) => r.cancel_reason], ['Pickup', (r) => r.pickup_address], ['Drop-off', (r) => r.dropoff_address],
        ['Rider', (r) => r.rider_name], ['Driver', (r) => r.driver_name], ['Rego', (r) => r.rego], ['Payment', (r) => r.payment_method], ['Payment status', (r) => r.payment_status],
        ['Quote ($)', (r) => dollars(r.quote_cents)], ['Fare ($)', (r) => dollars(r.final_cents)], ['Tip ($)', (r) => dollars(r.tip_cents)],
        ['Cancel fee ($)', (r) => dollars(r.cancel_fee_cents)], ['Levy ($)', (r) => dollars(r.levy_cents)], ['Km', (r) => (r.distance_m == null ? '' : (r.distance_m / 1000).toFixed(1))],
        ['Rider rating', (r) => r.rider_rating],
      ];
      csv = toCsv(cols, list); rows = list.length; file = `dingogo-trips-${from}-to-${to}.csv`;
    } else if (name === 'payouts.csv') {
      const to = validDate(p.to, darwinToday());
      const from = validDate(p.from, new Date(Date.parse(to) - 30 * 864e5).toISOString().slice(0, 10));
      const list = await q(
        `SELECT l.created_at, l.driver_id, u.name, -l.amount_cents AS cents, l.note, d.abn, (d.bank_bsb IS NOT NULL AND d.bank_account IS NOT NULL) AS has_bank
         FROM driver_ledger l JOIN users u ON u.id = l.driver_id LEFT JOIN drivers d ON d.user_id = l.driver_id
         WHERE l.kind = 'payout' AND l.created_at >= ${dayBounds('$1')} AND l.created_at < ${nextDay('$2')} ORDER BY l.created_at`, [from, to]);
      csv = toCsv<any>([
        ['Paid (Darwin)', (r) => local(r.created_at)], ['Driver', (r) => r.name], ['Driver ID', (r) => r.driver_id], ['ABN', (r) => r.abn],
        ['Amount ($)', (r) => dollars(r.cents)], ['Bank details on file', (r) => (r.driver_id ? (r.has_bank ? 'Yes' : 'No') : '')], ['Note', (r) => r.note],
      ], [...list, { name: 'Total', cents: list.reduce((s, r) => s + r.cents, 0) }]);
      rows = list.length; file = `dingogo-payouts-${from}-to-${to}.csv`;
    } else if (name === 'levy.csv') {
      const l = await levyReport(p.month, p.state ?? 'NT');
      csv = toCsv<any>([
        ['Month', () => l.month], ['State', () => l.state], ['Driver', (r) => r.name], ['Passenger trips', (r) => r.trips],
        ['Levy per trip ($)', () => dollars(l.levy_rate_cents)], ['Levy payable ($)', (r) => dollars(r.trips * l.levy_rate_cents)],
      ], [...l.per_driver, { name: 'Total', trips: l.passenger_trips }]);
      rows = l.per_driver.length; file = `dingogo-levy-${l.state}-${l.month}.csv`;
    } else if (name === 'gst.csv') {
      const g = await gstReport(p.from, p.to);
      csv = toCsv<any>([
        ['From', () => g.from], ['To', () => g.to], ['Type', (r) => r.kind], ['Via', (r) => r.provider], ['Count', (r) => r.n],
        ['Amount incl. GST ($)', (r) => dollars(r.amount_cents)], ['GST ($)', (r) => dollars(r.gst_cents)],
      ], [...g.rows, { kind: 'DingoGo service fees', provider: 'driver ledger', amount_cents: g.dingogo_service_fees_cents, gst_cents: g.gst_on_service_fees_cents }]);
      rows = g.rows.length; file = `dingogo-gst-${g.from}-to-${g.to}.csv`;
    } else throw notFound('Export');
    await audit(me.id, 'export', 'report', name, { ...p, rows });
    return sendCsv(reply, file, csv);
  });

  // ───────────── Daily ops summary ─────────────
  /** One Darwin day: what happened (trips, money, safety, support, drivers) and what still needs attention now. */
  app.get('/admin/summary/daily', async (req) => {
    await ops(req);
    const date = validDate((req.query as any).date, darwinToday());
    const D = [date];
    const inDay = (col: string) => `${col} >= ${dayBounds('$1')} AND ${col} < ${nextDay('$1')}`;
    const [trips, done, cancels, safety, flags, support, docs, drivers, money, attention] = await Promise.all([
      one(`SELECT count(*)::int requested,
                  count(*) FILTER (WHERE kind = 'ride')::int rides, count(*) FILTER (WHERE kind = 'courier')::int courier,
                  count(*) FILTER (WHERE channel <> 'app')::int phone_or_staff,
                  count(*) FILTER (WHERE status = 'completed')::int completed,
                  count(*) FILTER (WHERE status = 'cancelled_rider')::int cancelled_rider,
                  count(*) FILTER (WHERE status = 'cancelled_driver')::int cancelled_driver,
                  count(*) FILTER (WHERE status = 'cancelled_admin')::int cancelled_admin,
                  count(*) FILTER (WHERE status = 'no_drivers')::int no_drivers,
                  count(*) FILTER (WHERE status IN ('scheduled','requested','accepted','arrived','in_progress'))::int still_open
           FROM trips WHERE ${inDay('requested_at')}`, D),
      one(`SELECT count(*)::int completed, count(*) FILTER (WHERE kind = 'ride')::int passenger_trips,
                  coalesce(sum(final_cents),0)::int fares_cents, coalesce(sum(tip_cents),0)::int tips_cents,
                  round(avg(extract(epoch FROM (arrived_at - accepted_at)) / 60) FILTER (WHERE arrived_at > accepted_at)::numeric, 1)::float avg_pickup_min,
                  round(avg(rider_rating)::numeric, 2)::float avg_rating,
                  coalesce(sum(coalesce(actual_distance_m, est_distance_m)),0)::bigint distance_m
           FROM trips WHERE status = 'completed' AND ${inDay('completed_at')}`, D),
      q(`SELECT coalesce(nullif(cancel_reason, ''), 'No reason given') AS reason, count(*)::int n FROM trips
         WHERE status::text LIKE 'cancelled%' AND ${inDay('cancelled_at')} GROUP BY 1 ORDER BY n DESC LIMIT 8`, D),
      one(`SELECT count(*) FILTER (WHERE ${inDay('created_at')})::int raised, count(*) FILTER (WHERE ${inDay('resolved_at')})::int resolved FROM sos_alerts`, D),
      q(`SELECT kind, count(*)::int n FROM compliance_flags WHERE ${inDay('created_at')} GROUP BY kind ORDER BY n DESC`, D),
      one(`SELECT count(*) FILTER (WHERE ${inDay('created_at')})::int opened,
                  count(*) FILTER (WHERE status = 'resolved' AND ${inDay('updated_at')})::int resolved FROM support_tickets`, D),
      one(`SELECT count(*) FILTER (WHERE status = 'approved')::int approved, count(*) FILTER (WHERE status = 'rejected')::int rejected
           FROM driver_documents WHERE ${inDay('reviewed_at')}`, D),
      one(`SELECT (SELECT count(*)::int FROM audit_log WHERE action = 'update' AND entity = 'driver' AND data->>'status' = 'approved' AND ${inDay('at')}) approved,
                  (SELECT count(*)::int FROM driver_applications WHERE ${inDay('created_at')}) applications,
                  (SELECT count(DISTINCT driver_id)::int FROM trips WHERE status = 'completed' AND ${inDay('completed_at')}) drove`, D),
      one(`SELECT (SELECT coalesce(-sum(amount_cents),0)::int FROM driver_ledger WHERE kind = 'payout' AND ${inDay('created_at')}) payouts_cents,
                  (SELECT count(*)::int FROM driver_ledger WHERE kind = 'payout' AND ${inDay('created_at')}) payouts,
                  (SELECT coalesce(-sum(amount_cents),0)::int FROM payments WHERE kind = 'refund' AND status = 'succeeded' AND ${inDay('created_at')}) refunds_cents,
                  (SELECT coalesce(-sum(amount_cents),0)::int FROM driver_ledger WHERE kind = 'commission' AND ${inDay('created_at')}) service_fees_cents`, D),
      one(`SELECT (SELECT count(*)::int FROM sos_alerts WHERE status <> 'resolved') open_sos,
                  (SELECT count(*)::int FROM compliance_flags WHERE status = 'open') open_flags,
                  (SELECT count(*)::int FROM support_tickets WHERE status = 'open') open_tickets,
                  (SELECT count(*)::int FROM driver_documents WHERE status = 'pending') pending_docs,
                  (SELECT count(*)::int FROM vehicles WHERE status = 'pending') pending_vehicles,
                  (SELECT count(*)::int FROM driver_applications WHERE status = 'new') new_applications,
                  (SELECT count(*)::int FROM trips WHERE status = 'requested' AND requested_at < now() - interval '5 minutes') searching_over_5_min,
                  (SELECT count(*)::int FROM trips WHERE status = 'scheduled' AND scheduled_for < now() + interval '2 hours') booked_next_2_hours`),
    ]);
    return {
      date, trips, completed: { ...done, distance_km: Math.round(Number(done!.distance_m) / 1000) }, cancellations: cancels,
      safety: { ...safety, flags }, support, documents: docs, drivers, money, attention,
    };
  });

  // ───────────── Audit log ─────────────
  /** Staff actions, newest first, with filters. Page with `before` (the last id you got). `actions`/`actors` fill the filter menus. */
  app.get('/admin/audit', async (req) => {
    await admin(req);
    const p = req.query as Record<string, string | undefined>;
    const where: string[] = []; const vals: unknown[] = [];
    const add = (sql: (n: string) => string, v: unknown) => { vals.push(v); where.push(sql(`$${vals.length}`)); };
    if (p.actor) { if (!UUID.test(p.actor)) throw bad('bad_actor'); add((n) => `a.actor_id = ${n}`, p.actor); }
    if (p.action) add((n) => `a.action = ${n}`, p.action.slice(0, 60));
    if (p.entity) add((n) => `a.entity = ${n}`, p.entity.slice(0, 60));
    if (p.entity_id) add((n) => `a.entity_id = ${n}`, p.entity_id.slice(0, 80));
    if (p.from) add((n) => `a.at >= ${dayBounds(n)}`, validDate(p.from, '2000-01-01'));
    if (p.to) add((n) => `a.at < ${nextDay(n)}`, validDate(p.to, darwinToday()));
    if (p.q) add((n) => `(a.data::text ILIKE ${n} OR a.entity_id ILIKE ${n} OR a.action ILIKE ${n})`, `%${p.q.slice(0, 100)}%`);
    if (p.before) { if (!/^\d{1,18}$/.test(p.before)) throw bad('bad_cursor'); add((n) => `a.id < ${n}`, p.before); }
    const limit = Math.min(Math.max(Number(p.limit) || 100, 1), 200);
    vals.push(limit + 1);
    const items = await q(
      `SELECT a.*, u.name AS actor_name, u.role AS actor_role FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY a.id DESC LIMIT $${vals.length}`, vals);
    const more = items.length > limit;
    if (more) items.pop();
    const menus = p.before ? {} : {
      actions: (await q(`SELECT action, count(*)::int n FROM audit_log GROUP BY action ORDER BY action`)),
      entities: (await q(`SELECT entity, count(*)::int n FROM audit_log WHERE entity IS NOT NULL GROUP BY entity ORDER BY entity`)),
      actors: (await q(`SELECT DISTINCT a.actor_id AS id, u.name, u.role FROM audit_log a JOIN users u ON u.id = a.actor_id ORDER BY u.name LIMIT 200`)),
    };
    return { items, next_before: more ? String(items[items.length - 1].id) : null, ...menus };
  });
}
