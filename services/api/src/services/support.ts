/**
 * Round 22: customer support and dispute resolution. Ticket threads with references, priority, owner and SLA due times;
 * customer replies and satisfaction scores; "Get help with this trip" options; the fare review with automatic refunds within the
 * admin limits; lost property between rider and driver with a courier return. Needs migration 026 (`supportReady()`); before it
 * the old single-message tickets keep working and the rest answers 503 `migration_pending`.
 */
import { config } from '../config.js';
import { one, pool, q, tx, type Q } from '../db.js';
import { ApiError, bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { settingValue, invalidateConfig } from '../lib/cache.js';
import { audit } from '../lib/audit.js';
import { supportRef } from '../lib/ids.js';
import { limit } from '../lib/rateLimit.js';
import {
  DEFAULT_SUPPORT_POLICY, LOST_LABEL, LOST_OPEN, autoRefundDecision, checkSupportPolicy, fillPlaceholders, priorityFor, reviewFare, slaDue, slaState,
  type LostStatus, type Priority, type SupportPolicy,
} from '../lib/support.js';
import { toOps } from '../realtime.js';
import { send } from './notify.js';
import * as trips from './trips.js';
import { notifyRefund, refundIn } from './refunds.js';
import { logError } from '../lib/log.js';

// ── Migration 026 ──
let ready = false;
let checkedAt = 0;
export async function supportReady(): Promise<boolean> {
  if (ready) return true;
  if (checkedAt && Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const r = await one<{ n: number }>(
      `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()
                 AND table_name IN ('support_messages', 'support_canned_replies', 'lost_items'))::int
            + (SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'support_tickets'
                 AND column_name IN ('ref', 'role', 'priority', 'assigned_to', 'first_response_due_at', 'resolve_due_at', 'first_response_at',
                                     'resolved_at', 'last_customer_at', 'csat_score', 'csat_comment', 'csat_at', 'review'))::int AS n`);
    ready = r!.n === 16;
  } catch { ready = false; }
  return ready;
}
export function resetSupportReady() { ready = false; checkedAt = 0; }
export const supportPending = () => new ApiError(503, 'migration_pending', 'This needs database migration 026 (support desk). Send us a message or call DingoGo instead.');
async function needReady() { if (!(await supportReady())) throw supportPending(); }

// ── Policy ──
export async function supportPolicy(): Promise<SupportPolicy> {
  const v = await settingValue('support_policy').catch(() => null);
  if (!v) return DEFAULT_SUPPORT_POLICY;
  try { return checkSupportPolicy(v); } catch { return DEFAULT_SUPPORT_POLICY; }
}
export async function saveSupportPolicy(actorId: string, input: unknown) {
  const value = checkSupportPolicy(input);
  await q(`INSERT INTO settings (key, value) VALUES ('support_policy', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(value)]);
  invalidateConfig('setting:support_policy');
  await audit(actorId, 'support_policy_updated', 'settings', 'support_policy', value);
  return value;
}

/** "Thu 2:40 pm" in Darwin time. */
export const whenLocal = (d: Date | string) =>
  new Intl.DateTimeFormat('en-AU', { timeZone: config.timezone, weekday: 'short', hour: 'numeric', minute: '2-digit' }).format(new Date(d));

const isStaff = (u: { role: string }) => u.role === 'admin' || u.role === 'dispatcher';

// ── Tickets ──
export interface NewTicket {
  userId: string; role: string; tripId?: string | null; category: string; subject: string; message: string;
  priority?: Priority; review?: unknown;
}

/** A new ticket with its first message (the customer's words). Before 026: the old single-message row. */
export async function createTicket(n: NewTicket, c: Q = pool) {
  if (!(await supportReady())) {
    return one(`INSERT INTO support_tickets (user_id, trip_id, category, subject, message) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [n.userId, n.tripId ?? null, n.category, n.subject, n.message], c);
  }
  const policy = await supportPolicy();
  const priority = n.priority ?? priorityFor(n.category, policy);
  const now = new Date();
  const due = slaDue(now, priority, policy);
  let t: any = null;
  for (let i = 0; i < 3 && !t; i++) {
    t = await one(
      `INSERT INTO support_tickets (user_id, trip_id, category, subject, message, ref, role, priority, first_response_due_at, resolve_due_at, last_customer_at, review, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$11,$11) ON CONFLICT (ref) WHERE ref IS NOT NULL DO NOTHING RETURNING *`,
      [n.userId, n.tripId ?? null, n.category, n.subject, n.message, supportRef(), n.role, priority, due.first_response_due_at, due.resolve_due_at, now,
        n.review == null ? null : JSON.stringify(n.review)], c);
  }
  if (!t) throw new ApiError(500, 'ref_clash', 'Could not save the message. Please try again.');
  await c.query(`INSERT INTO support_messages (ticket_id, author_id, author_role, body) VALUES ($1,$2,'customer',$3)`, [t.id, n.userId, n.message]);
  return t;
}

/** Message from DingoGo's automatic checks (not a person, so it doesn't stop the first-response clock unless `answers`). */
async function systemMessage(c: Q, ticketId: string, body: string, opts: { internal?: boolean; answers?: boolean } = {}) {
  await c.query(`INSERT INTO support_messages (ticket_id, author_role, body, internal) VALUES ($1,'system',$2,$3)`, [ticketId, body, !!opts.internal]);
  if (opts.answers && !opts.internal) await c.query(`UPDATE support_tickets SET first_response_at = coalesce(first_response_at, now()), updated_at = now() WHERE id = $1`, [ticketId]);
}

function afterNew(t: any, userId: string) {
  toOps('support.new', t);
  void send(userId, 'ticket_received', { ref: t.ref ?? `#${String(t.id).slice(0, 8)}`, reply_by: t.first_response_due_at ? whenLocal(t.first_response_due_at) : null },
    { data: { ticket_id: t.id } });
}

/** POST /support: a message from a rider or driver (optionally about one of their trips). */
export async function openTicket(me: { id: string; role: string }, b: { trip_id?: string; category: string; subject: string; message: string }) {
  let trip: any = null;
  if (b.trip_id) {
    trip = await trips.getTrip(b.trip_id);
    if (!trips.canView(trip, me)) throw forbidden();
  }
  await limit('support_new', me.id, 20, 86400, 'You have sent a lot of messages today. Please call DingoGo if it is urgent.');
  const t = await createTicket({ userId: me.id, role: me.id === trip?.driver_id || me.role === 'driver' ? 'driver' : 'rider', tripId: b.trip_id ?? null,
    category: b.category, subject: b.subject, message: b.message });
  // A rider saying a driver refused their assistance animal (unlawful under the DDA) gets the same compliance review as a driver
  // declining or cancelling such a trip, even if the rider didn't tick "assistance animal" when booking (the driver saw the dog and left).
  if (b.category === 'assistance_animal_refused' && trip && trip.rider_id === me.id) {
    const flagged = await trips.flagRiderReportedRefusal(trip, b.message);
    if (flagged) t.flagged = true;
  }
  afterNew(t, me.id);
  return t;
}

/** What the customer sees of a ticket (no owner, notes or working). */
function customerSummary(t: any, policy: SupportPolicy) {
  const resolvedAt = t.resolved_at ?? (t.status === 'resolved' ? t.updated_at : null);
  const reopenable = t.status !== 'resolved' || (resolvedAt && Date.now() - new Date(resolvedAt).getTime() < policy.reopen_days * 86400_000);
  return {
    id: t.id, ref: t.ref ?? null, category: t.category, subject: t.subject, message: t.message, status: t.status, trip_id: t.trip_id,
    trip_ref: t.trip_ref ?? undefined, created_at: t.created_at, updated_at: t.updated_at, resolution: t.resolution ?? null,
    reply_by: t.status === 'open' && !t.first_response_at ? t.first_response_due_at ?? null : null,
    awaiting: t.status === 'resolved' ? null : t.status === 'pending' ? 'you' : 'dingogo',
    can_reply: !!reopenable, can_rate: t.status === 'resolved' && t.csat_score == null && t.ref != null,
    csat_score: t.csat_score ?? null, last_reply_at: t.last_reply_at ?? null,
  };
}

export async function myTickets(me: { id: string }) {
  if (!(await supportReady())) {
    const rows = await q(`SELECT s.*, t.ref AS trip_ref FROM support_tickets s LEFT JOIN trips t ON t.id = s.trip_id WHERE s.user_id = $1 ORDER BY s.created_at DESC`, [me.id]);
    return { ready: false, tickets: rows.map((t) => customerSummary(t, DEFAULT_SUPPORT_POLICY)) };
  }
  const policy = await supportPolicy();
  const rows = await q(
    `SELECT s.*, t.ref AS trip_ref,
       (SELECT max(m.created_at) FROM support_messages m WHERE m.ticket_id = s.id AND m.author_role <> 'customer' AND NOT m.internal) AS last_reply_at
     FROM support_tickets s LEFT JOIN trips t ON t.id = s.trip_id WHERE s.user_id = $1 ORDER BY s.updated_at DESC LIMIT 100`, [me.id]);
  return { ready: true, tickets: rows.map((t) => customerSummary(t, policy)) };
}

async function ownTicket(id: string, me: { id: string }) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Message');
  const t = await one(`SELECT s.*, t.ref AS trip_ref FROM support_tickets s LEFT JOIN trips t ON t.id = s.trip_id WHERE s.id = $1`, [id]);
  if (!t || t.user_id !== me.id) throw notFound('Message');
  return t;
}

export async function myThread(id: string, me: { id: string }) {
  const t = await ownTicket(id, me);
  if (!(await supportReady())) {
    const messages = [{ id: 1, from: 'you', body: t.message, created_at: t.created_at },
      ...(t.resolution ? [{ id: 2, from: 'dingogo', body: t.resolution, created_at: t.updated_at }] : [])];
    return { ready: false, ticket: { ...customerSummary(t, DEFAULT_SUPPORT_POLICY), can_reply: false, can_rate: false }, messages };
  }
  const rows = await q(`SELECT id, author_role, body, created_at FROM support_messages WHERE ticket_id = $1 AND NOT internal ORDER BY id`, [t.id]);
  return {
    ready: true, ticket: customerSummary(t, await supportPolicy()),
    messages: rows.map((m) => ({ id: Number(m.id), from: m.author_role === 'customer' ? 'you' : 'dingogo', automatic: m.author_role === 'system', body: m.body, created_at: m.created_at })),
  };
}

/** Customer adds to their ticket. A pending ticket goes back to the desk; a resolved one reopens within `reopen_days`. */
export async function customerReply(id: string, me: { id: string; name?: string | null }, body: string) {
  await needReady();
  const t = await ownTicket(id, me);
  const policy = await supportPolicy();
  if (!customerSummary(t, policy).can_reply) throw conflict('ticket_closed', 'This was sorted a while ago. Please send us a new message instead.');
  await limit('support_reply', `${me.id}:${t.id}`, 20, 3600, 'You are sending messages very fast. Please wait a little.');
  const reopened = t.status !== 'open';
  await tx(async (c) => {
    await c.query(`INSERT INTO support_messages (ticket_id, author_id, author_role, body) VALUES ($1,$2,'customer',$3)`, [t.id, me.id, body]);
    // A reopened ticket gets a fresh resolve clock from now (its first response was already given).
    const due = reopened && t.status === 'resolved' ? slaDue(new Date(), t.priority as Priority, policy).resolve_due_at : null;
    await c.query(`UPDATE support_tickets SET status = 'open', last_customer_at = now(), updated_at = now(), resolved_at = NULL,
                     resolve_due_at = coalesce($2, resolve_due_at) WHERE id = $1`, [t.id, due]);
  });
  toOps('support.reply', { id: t.id, ref: t.ref, reopened });
  return myThread(id, me);
}

/** 1 to 5 after the ticket is resolved, once. */
export async function rateTicket(id: string, me: { id: string }, score: number, comment?: string | null) {
  await needReady();
  const t = await ownTicket(id, me);
  if (t.status !== 'resolved') throw conflict('not_resolved', 'You can rate this once it has been sorted.');
  const r = await one(`UPDATE support_tickets SET csat_score = $2, csat_comment = $3, csat_at = now() WHERE id = $1 AND csat_score IS NULL RETURNING id`,
    [t.id, score, comment?.trim() || null]);
  if (!r) throw conflict('already_rated', 'Thanks, you have already rated this.');
  toOps('support.rated', { id: t.id, ref: t.ref, score });
  return { ok: true, csat_score: score };
}

// ── Staff desk ──
const STAFF_COLS = `s.id, s.ref, s.user_id, s.trip_id, s.category, s.subject, left(s.message, 160) AS preview, s.status, s.priority, s.role,
  s.assigned_to, a.name AS assigned_name, s.created_at, s.updated_at, s.first_response_due_at, s.resolve_due_at, s.first_response_at,
  s.resolved_at, s.last_customer_at, s.csat_score, u.name AS user_name, u.phone AS user_phone, t.ref AS trip_ref`;
export type QueueView = 'open' | 'mine' | 'unassigned' | 'overdue' | 'resolved' | 'all';

export async function staffQueue(me: { id: string }, o: { view?: QueueView; q?: string; category?: string }) {
  if (!(await supportReady())) {
    const items = await q(`SELECT s.*, u.name AS user_name, u.phone AS user_phone, t.ref AS trip_ref FROM support_tickets s LEFT JOIN users u ON u.id = s.user_id
      LEFT JOIN trips t ON t.id = s.trip_id ORDER BY (s.status = 'open') DESC, s.created_at DESC LIMIT 300`);
    return { ready: false, items, summary: null };
  }
  const where: string[] = [];
  const args: unknown[] = [];
  const view = o.view ?? 'open';
  if (view === 'open') where.push(`s.status <> 'resolved'`);
  if (view === 'mine') { args.push(me.id); where.push(`s.status <> 'resolved' AND s.assigned_to = $1`); }
  if (view === 'unassigned') where.push(`s.status <> 'resolved' AND s.assigned_to IS NULL`);
  if (view === 'overdue') where.push(`s.status = 'open' AND ((s.first_response_at IS NULL AND s.first_response_due_at < now()) OR s.resolve_due_at < now())`);
  if (view === 'resolved') where.push(`s.status = 'resolved'`);
  if (o.category) { args.push(o.category); where.push(`s.category = $${args.length}`); }
  if (o.q?.trim()) {
    args.push(`%${o.q.trim().replace(/[%_\\]/g, (m) => '\\' + m)}%`);
    const p = `$${args.length}`;
    where.push(`(s.ref ILIKE ${p} OR s.subject ILIKE ${p} OR u.name ILIKE ${p} OR u.phone ILIKE ${p} OR t.ref ILIKE ${p})`);
  }
  const items = await q(
    `SELECT ${STAFF_COLS} FROM support_tickets s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN users a ON a.id = s.assigned_to LEFT JOIN trips t ON t.id = s.trip_id
     ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
     ORDER BY (s.status = 'open') DESC, CASE s.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
       CASE WHEN s.first_response_at IS NULL THEN s.first_response_due_at ELSE s.resolve_due_at END ASC NULLS LAST, s.created_at DESC LIMIT 300`, args);
  const now = Date.now();
  const summary = await one(
    `SELECT count(*) FILTER (WHERE status <> 'resolved')::int AS open,
            count(*) FILTER (WHERE status = 'open' AND ((first_response_at IS NULL AND first_response_due_at < now()) OR resolve_due_at < now()))::int AS overdue,
            count(*) FILTER (WHERE status <> 'resolved' AND assigned_to IS NULL)::int AS unassigned,
            count(*) FILTER (WHERE status <> 'resolved' AND assigned_to = $1)::int AS mine,
            round(avg(csat_score) FILTER (WHERE csat_at > now() - interval '30 days'), 2)::float AS csat_30d,
            count(csat_score) FILTER (WHERE csat_at > now() - interval '30 days')::int AS csat_count_30d,
            count(*) FILTER (WHERE resolved_at > now() - interval '30 days')::int AS resolved_30d,
            count(*) FILTER (WHERE resolved_at > now() - interval '30 days' AND resolved_at <= resolve_due_at)::int AS resolved_in_time_30d,
            count(*) FILTER (WHERE first_response_at > now() - interval '30 days' AND first_response_at <= first_response_due_at)::int AS first_in_time_30d,
            count(*) FILTER (WHERE first_response_at > now() - interval '30 days')::int AS first_30d
     FROM support_tickets`, [me.id]);
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  return {
    ready: true,
    items: items.map((t) => ({ ...t, sla: slaState(t, now) })),
    summary: { ...summary, sla_resolved_pct_30d: pct(summary!.resolved_in_time_30d, summary!.resolved_30d), sla_first_pct_30d: pct(summary!.first_in_time_30d, summary!.first_30d) },
  };
}

async function staffRow(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Ticket');
  const t = await one(`SELECT s.*, u.name AS user_name, u.phone AS user_phone, u.role AS user_role, u.created_at AS user_since, a.name AS assigned_name, t.ref AS trip_ref
    FROM support_tickets s LEFT JOIN users u ON u.id = s.user_id LEFT JOIN users a ON a.id = s.assigned_to LEFT JOIN trips t ON t.id = s.trip_id WHERE s.id = $1`, [id]);
  if (!t) throw notFound('Ticket');
  return t;
}

export async function staffTicket(id: string) {
  const t = await staffRow(id);
  const trip = t.trip_id ? await one(
    `SELECT t.id, t.ref, t.kind, t.service, t.status, t.quote_cents, t.final_cents, t.tip_cents, t.cancel_fee_cents, t.payment_method, t.payment_status,
            t.requested_at, t.completed_at, t.cancelled_at, t.pickup_address, t.dropoff_address, du.name AS driver_name, ru.name AS rider_name,
            (SELECT coalesce(sum(-p.amount_cents), 0)::int FROM payments p WHERE p.trip_id = t.id AND p.kind = 'refund' AND p.status = 'succeeded') AS refunded_cents
     FROM trips t LEFT JOIN users du ON du.id = t.driver_id JOIN users ru ON ru.id = t.rider_id WHERE t.id = $1`, [t.trip_id]) : null;
  const related = t.user_id ? await q(`SELECT id, ${await supportReady() ? 'ref, ' : ''}subject, status, created_at FROM support_tickets WHERE user_id = $1 AND id <> $2 ORDER BY created_at DESC LIMIT 10`, [t.user_id, t.id]) : [];
  if (!(await supportReady())) {
    const messages = [{ id: 1, author_role: 'customer', author_name: t.user_name, body: t.message, internal: false, created_at: t.created_at },
      ...(t.resolution ? [{ id: 2, author_role: 'staff', author_name: null, body: t.resolution, internal: false, created_at: t.updated_at }] : [])];
    return { ready: false, ticket: t, messages, trip, related, lost_item: null, canned: [] };
  }
  const messages = await q(`SELECT m.id, m.author_role, u.name AS author_name, m.body, m.internal, m.created_at FROM support_messages m
    LEFT JOIN users u ON u.id = m.author_id WHERE m.ticket_id = $1 ORDER BY m.id`, [t.id]);
  const lost = t.trip_id ? await one(`SELECT * FROM lost_items WHERE trip_id = $1 ORDER BY created_at DESC LIMIT 1`, [t.trip_id]) : null;
  const canned = (await q(`SELECT id, title, body, category FROM support_canned_replies WHERE active ORDER BY (category = $1) DESC NULLS LAST, title`, [t.category]))
    .map((c) => ({ ...c, filled: fillPlaceholders(c.body, { name: t.user_name, trip_ref: t.trip_ref, ticket_ref: t.ref }) }));
  return { ready: true, ticket: { ...t, sla: slaState(t) }, messages, trip, related, lost_item: lost ? await lostView(lost) : null, canned };
}

async function isStaffUser(id: string) {
  const u = await one(`SELECT role FROM users WHERE id = $1 AND deleted_at IS NULL AND NOT blocked`, [id]);
  return !!u && isStaff(u);
}

/** Status, priority (due times worked out again from when it came in) and owner. `resolution` (old apps) is a public reply. */
export async function staffUpdate(id: string, me: { id: string }, b: { status?: 'open' | 'pending' | 'resolved'; priority?: Priority; assigned_to?: string | null; resolution?: string }) {
  if (!(await supportReady())) {
    if (b.priority !== undefined || b.assigned_to !== undefined) throw supportPending();
    if (!b.status) throw bad('validation_error', 'status: Required');
    const t = await one(`UPDATE support_tickets SET status = $2, resolution = coalesce($3, resolution), updated_at = now() WHERE id = $1 RETURNING *`, [id, b.status, b.resolution ?? null]);
    if (!t) throw notFound('Ticket');
    await audit(me.id, 'ticket_' + b.status, 'support_ticket', t.id, b.resolution ? { resolution: b.resolution } : undefined);
    if (t.user_id && b.resolution) void send(t.user_id, 'ticket_reply', { subject: t.subject, resolution: b.resolution }, { data: { ticket_id: t.id } });
    return t;
  }
  const t = await staffRow(id);
  if (b.resolution) return (await staffReply(id, me, { body: b.resolution, status: b.status })).ticket;
  if (b.assigned_to && !(await isStaffUser(b.assigned_to))) throw bad('not_staff', 'Tickets can only be given to DingoGo staff');
  const policy = await supportPolicy();
  const sets: string[] = ['updated_at = now()'];
  const args: unknown[] = [t.id];
  const put = (col: string, v: unknown) => { args.push(v); sets.push(`${col} = $${args.length}`); };
  if (b.status && b.status !== t.status) {
    put('status', b.status);
    if (b.status === 'resolved') sets.push('resolved_at = now()');
    else if (t.status === 'resolved') sets.push('resolved_at = NULL');
  }
  if (b.priority && b.priority !== t.priority) {
    const due = slaDue(t.created_at, b.priority, policy);
    put('priority', b.priority); put('first_response_due_at', due.first_response_due_at); put('resolve_due_at', due.resolve_due_at);
  }
  if (b.assigned_to !== undefined && b.assigned_to !== t.assigned_to) put('assigned_to', b.assigned_to);
  const row = await one(`UPDATE support_tickets SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, args);
  if (b.status && b.status !== t.status) {
    await audit(me.id, 'ticket_' + b.status, 'support_ticket', t.id);
    if (b.status === 'resolved' && t.user_id) void send(t.user_id, 'ticket_resolved', { ref: t.ref, subject: t.subject }, { data: { ticket_id: t.id } });
  }
  if (b.priority && b.priority !== t.priority) await audit(me.id, 'ticket_priority', 'support_ticket', t.id, { from: t.priority, to: b.priority });
  if (b.assigned_to !== undefined && b.assigned_to !== t.assigned_to) await audit(me.id, 'ticket_assigned', 'support_ticket', t.id, { to: b.assigned_to });
  toOps('support.updated', { id: t.id, ref: t.ref });
  return row;
}

/** Staff reply to the customer (push + inbox) or an internal note; optional status change at the same time. The first public
 *  reply stops the first-response clock. A ticket nobody owns is taken by whoever replies. */
export async function staffReply(id: string, me: { id: string }, b: { body: string; internal?: boolean; status?: 'open' | 'pending' | 'resolved'; canned_id?: string }) {
  if (!(await supportReady())) {
    if (b.internal) throw supportPending();
    const t = await staffUpdate(id, me, { status: b.status ?? 'pending', resolution: b.body });
    return { ticket: t };
  }
  const t = await staffRow(id);
  const status = b.status ?? t.status;
  const row = await tx(async (c) => {
    await c.query(`INSERT INTO support_messages (ticket_id, author_id, author_role, body, internal) VALUES ($1,$2,'staff',$3,$4)`, [t.id, me.id, b.body, !!b.internal]);
    return one(
      `UPDATE support_tickets SET updated_at = now(), status = $2,
         first_response_at = CASE WHEN $3 THEN first_response_at ELSE coalesce(first_response_at, now()) END,
         resolution = CASE WHEN $3 THEN resolution ELSE $4 END,
         resolved_at = CASE WHEN $2 = 'resolved' THEN coalesce(CASE WHEN status = 'resolved' THEN resolved_at END, now()) ELSE NULL END,
         assigned_to = coalesce(assigned_to, $5)
       WHERE id = $1 RETURNING *`, [t.id, status, !!b.internal, b.body, me.id], c);
  });
  await audit(me.id, b.internal ? 'ticket_note' : 'ticket_reply', 'support_ticket', t.id, { status, canned_id: b.canned_id ?? null });
  if (!b.internal && t.user_id) void send(t.user_id, 'ticket_reply', { subject: t.subject, resolution: b.body }, { data: { ticket_id: t.id } });
  if (status === 'resolved' && t.status !== 'resolved' && t.user_id) void send(t.user_id, 'ticket_resolved', { ref: t.ref, subject: t.subject }, { data: { ticket_id: t.id } });
  toOps('support.updated', { id: t.id, ref: t.ref });
  return { ticket: row };
}

export async function staffMembers() {
  return q(`SELECT id, name, role FROM users WHERE role IN ('admin', 'dispatcher') AND deleted_at IS NULL ORDER BY name`);
}

// ── Canned replies ──
export async function cannedList() {
  if (!(await supportReady())) return { ready: false, items: [] };
  return { ready: true, items: await q(`SELECT * FROM support_canned_replies ORDER BY active DESC, category NULLS LAST, title`) };
}
export async function cannedSave(me: { id: string }, id: string | null, b: { title?: string; body?: string; category?: string | null; active?: boolean }) {
  await needReady();
  let row: any;
  if (id) {
    row = await one(`UPDATE support_canned_replies SET title = coalesce($2, title), body = coalesce($3, body),
      category = CASE WHEN $5 THEN $4 ELSE category END, active = coalesce($6, active), updated_at = now() WHERE id = $1 RETURNING *`,
    [id, b.title ?? null, b.body ?? null, b.category ?? null, b.category !== undefined, b.active ?? null]);
    if (!row) throw notFound('Canned reply');
  } else {
    if (!b.title || !b.body) throw bad('validation_error', 'A canned reply needs a title and the words');
    row = await one(`INSERT INTO support_canned_replies (title, body, category, created_by) VALUES ($1,$2,$3,$4) RETURNING *`, [b.title, b.body, b.category ?? null, me.id]);
  }
  await audit(me.id, id ? 'canned_updated' : 'canned_created', 'support_canned_reply', row.id, { title: row.title });
  return row;
}
export async function cannedDelete(me: { id: string }, id: string) {
  await needReady();
  const r = await one(`DELETE FROM support_canned_replies WHERE id = $1 RETURNING id, title`, [id]);
  if (!r) throw notFound('Canned reply');
  await audit(me.id, 'canned_deleted', 'support_canned_reply', id, { title: r.title });
  return { ok: true };
}

// ── Trip help ──
type Option = { key: string; title: string; sub: string };
const daysSince = (d: Date | string | null | undefined) => (d ? (Date.now() - new Date(d).getTime()) / 86400_000 : Infinity);

/** GET /trips/:id/help: what fits this trip for this person, open cases and earlier tickets about it. */
export async function tripHelp(tripId: string, me: { id: string; role: string }) {
  const t = await trips.getTrip(tripId);
  const role = me.id === t.rider_id ? 'rider' : t.driver_id && me.id === t.driver_id ? 'driver' : null;
  if (!role) throw notFound('Trip');
  const isReady = await supportReady();
  const policy = await supportPolicy();
  const done = t.status === 'completed';
  const lost = isReady ? await openLost(t.id) : null;
  const tickets = isReady
    ? await q(`SELECT id, ref, category, subject, status, created_at, (review IS NOT NULL) AS fare_review FROM support_tickets WHERE trip_id = $1 AND user_id = $2 ORDER BY created_at DESC`, [t.id, me.id])
    : await q(`SELECT id, category, subject, status, created_at FROM support_tickets WHERE trip_id = $1 AND user_id = $2 ORDER BY created_at DESC`, [t.id, me.id]);
  const reviewed = tickets.some((x: any) => x.fare_review);
  const inWindow = daysSince(t.completed_at) <= policy.lost_property.report_within_days;
  const options: Option[] = [];
  if (role === 'rider') {
    if (done && isReady && !reviewed && t.payment_status !== 'failed' && t.parcel?.outcome !== 'returned') {
      options.push({ key: 'fare_review', title: 'My fare was higher than expected', sub: 'We check it against your price and the route. Small differences are refunded straight away.' });
    }
    if (t.cancel_fee_cents > 0) options.push({ key: 'cancel_fee', title: 'I was charged a cancellation fee', sub: 'Tell us what happened and we will look at it.' });
    if (done && t.driver_id && t.kind === 'ride' && inWindow && !lost) {
      options.push({ key: 'lost_item', title: 'I left something in the car', sub: isReady ? 'We tell your driver straight away, and you can message them.' : 'We will contact your driver.' });
    }
    if (t.driver_id) {
      options.push({ key: 'driver_feedback', title: 'Feedback about my driver', sub: 'Rude, late, the car, the way they drove.' });
      options.push({ key: 'safety', title: 'I felt unsafe', sub: 'Goes to our safety team. In danger now? Call 000.' });
    }
    if (t.kind === 'courier') options.push({ key: 'parcel', title: 'A problem with the parcel', sub: 'Not delivered, damaged or late.' });
    if (t.kind === 'ride' && (t.assistance_animal || t.status === 'cancelled_driver')) options.push({ key: 'assistance_animal', title: 'A driver refused my assistance animal', sub: 'This is against the law. We follow up every report.' });
  } else {
    if (done && t.kind === 'ride' && inWindow && !lost && isReady) options.push({ key: 'found_item', title: 'The rider left something in my car', sub: 'We tell the rider and help get it back to them.' });
    options.push({ key: 'safety', title: 'Report a safety problem', sub: 'Abuse, threats, damage to the car. In danger now? Call 000.' });
    options.push({ key: 'pay', title: 'A question about my pay for this trip', sub: 'Fare, tip, cancellation pay or cash.' });
  }
  options.push({ key: 'other', title: 'Something else', sub: 'Send us a message about this trip.' });
  return {
    ready: isReady, role,
    trip: { id: t.id, ref: t.ref, kind: t.kind, service: t.service, status: t.status, quote_cents: t.quote_cents, final_cents: t.final_cents,
      cancel_fee_cents: t.cancel_fee_cents, payment_status: t.payment_status, completed_at: t.completed_at,
      // The rider's own addresses, offered as where to send a lost item.
      ...(role === 'rider' ? { pickup: { lat: t.pickup_lat, lng: t.pickup_lng, address: t.pickup_address }, dropoff: { lat: t.dropoff_lat, lng: t.dropoff_lng, address: t.dropoff_address } } : {}) },
    options, lost_item: lost ? await lostView(lost, role) : null, tickets,
  };
}

/** Fare review: check the charge against the upfront price and the GPS track; refund a difference within the admin limits
 *  at once, otherwise a person looks at it. Once per trip (two taps at once: the second waits and is refused). */
export async function fareReview(tripId: string, me: { id: string; role: string }, message?: string | null) {
  await needReady();
  const t = await trips.getTrip(tripId);
  if (t.rider_id !== me.id) throw notFound('Trip');
  if (t.status !== 'completed') throw conflict('not_completed', 'You can ask us to check the fare once the trip has finished.');
  if (t.parcel?.outcome === 'returned') throw conflict('not_reviewable', 'This delivery came back to you, so its price includes the return. Send us a message instead.');
  const policy = await supportPolicy();
  await limit('fare_review', me.id, 10, 86400, 'You have asked us to check a lot of fares today. Please send us a message instead.');
  const result = await tx(async (c) => {
    await c.query(`SELECT pg_advisory_xact_lock(hashtext('fare_review:' || $1))`, [t.id]);
    const prior = await one(`SELECT id, ref FROM support_tickets WHERE trip_id = $1 AND review IS NOT NULL LIMIT 1`, [t.id], c);
    if (prior) throw new ApiError(409, 'already_reviewed', `We have already checked this fare (${prior.ref}). Reply there if something is still wrong.`, { ticket_id: prior.id });
    const track = await q(`SELECT lat, lng, at FROM trip_track WHERE trip_id = $1 AND at >= coalesce($2, at) ORDER BY at`, [t.id, t.started_at], c);
    const rule = await trips.loadRule(t.service, c).catch(() => null);
    const refunded = (await one<{ n: number }>(`SELECT coalesce(sum(-amount_cents), 0)::int n FROM payments WHERE trip_id = $1 AND kind = 'refund' AND status = 'succeeded'`, [t.id], c))!.n;
    const review = reviewFare({ quote_cents: t.quote_cents, final_cents: t.final_cents, est_distance_m: t.est_distance_m, actual_distance_m: t.actual_distance_m,
      per_km_cents: rule?.per_km_cents ?? 0, service: t.service, track, refunded_cents: refunded, payment_failed: t.payment_status === 'failed' }, policy.fare_review);
    const n30 = (await one<{ n: number }>(
      `SELECT count(*)::int n FROM support_tickets WHERE user_id = $1 AND created_at > now() - interval '30 days' AND (review->>'auto_refund_cents')::int > 0`, [me.id], c))!.n;
    const decision = autoRefundDecision(review, policy.fare_review, n30);
    const held = 'held' in decision ? decision.held : null;
    const priority: Priority = held === 'over_limit' || held === 'too_many' ? 'high' : 'normal';
    const ticket = await createTicket({ userId: me.id, role: 'rider', tripId: t.id, category: 'fare', subject: `Fare check for ${t.ref}`,
      message: message?.trim() || 'Please check my fare.', priority, review: { ...review, decision: held ?? 'refund', auto_refund_cents: 0 } }, c);
    let refund: Awaited<ReturnType<typeof refundIn>> | null = null;
    let outcome: 'refunded' | 'explained' | 'with_team';
    if (decision.refund_cents > 0) {
      // Inside the same transaction: the refund and the ticket that records it commit together (or not at all).
      await c.query('SAVEPOINT auto_refund');
      try {
        refund = await refundIn(c, t.id, decision.refund_cents, 'reason' in decision ? decision.reason : 'Fare review', null, { ticket: ticket.ref });
        await c.query('RELEASE SAVEPOINT auto_refund');
      } catch (e) {
        await c.query('ROLLBACK TO SAVEPOINT auto_refund');
        logError('fare review refund', e);
        refund = null;
      }
    }
    if (refund) {
      outcome = 'refunded';
      await systemMessage(c, ticket.id, `${review.explanation} We have refunded $${(refund.refunded_cents / 100).toFixed(2)} to the way you paid. Card refunds usually show in 3 to 5 business days.`, { answers: true });
      await c.query(`UPDATE support_tickets SET status = 'resolved', resolved_at = now(), review = review || jsonb_build_object('auto_refund_cents', $2::int) WHERE id = $1`, [ticket.id, refund.refunded_cents]);
    } else if (['as_quoted', 'supported', 'refunded_already', 'not_charged'].includes(review.verdict)) {
      outcome = 'explained';
      await systemMessage(c, ticket.id, `${review.explanation} If something else went wrong on the trip, reply here and a person will look at it.`, { answers: true });
      await c.query(`UPDATE support_tickets SET status = 'resolved', resolved_at = now() WHERE id = $1`, [ticket.id]);
    } else {
      outcome = 'with_team';
      const why = held === 'over_limit' ? 'The difference is more than we refund automatically.' : held === 'too_many' ? 'Recent automatic refunds on this account.'
        : held === 'unverified_to_person' ? 'No GPS track to check.' : held === 'policy_off' ? 'Automatic refunds are switched off.' : 'Refund did not go through automatically.';
      await systemMessage(c, ticket.id, `${review.explanation} A person from our team will look at it and reply here.`);
      await systemMessage(c, ticket.id, `Fare review: ${review.verdict}, difference $${(review.overcharge_cents / 100).toFixed(2)}. Held for a person: ${why}`, { internal: true });
    }
    await trips.event(c, t.id, 'fare_review', me.id, { ticket: ticket.ref, verdict: review.verdict, refund_cents: refund?.refunded_cents ?? 0, held });
    const saved = await one(`SELECT * FROM support_tickets WHERE id = $1`, [ticket.id], c);
    return { ticket: saved, review, outcome, refund };
  });
  if (result.refund) notifyRefund(result.refund, `Fare check ${result.ticket.ref}`);
  if (result.outcome === 'with_team') afterNew(result.ticket, me.id);
  else toOps('support.new', result.ticket);
  return {
    outcome: result.outcome, refund_cents: result.refund?.refunded_cents ?? 0, explanation: result.review.explanation,
    review: { verdict: result.review.verdict, quote_cents: result.review.quote_cents, charged_cents: result.review.charged_cents, overcharge_cents: result.review.overcharge_cents },
    ticket: customerSummary(result.ticket, policy),
  };
}

// ── Lost property ──
async function openLost(tripId: string, c: Q = pool) {
  const row = await one(`SELECT * FROM lost_items WHERE trip_id = $1 ORDER BY (status = ANY($2)) DESC, created_at DESC LIMIT 1`, [tripId, LOST_OPEN], c);
  return row ? syncLost(row) : null;
}

/** A courier return that has been delivered closes the case; one that didn't happen goes back to "driver has it". */
async function syncLost(row: any) {
  if (row.status !== 'return_booked' || !row.return_trip_id) return row;
  const r = await one<{ status: string }>(`SELECT status FROM trips WHERE id = $1`, [row.return_trip_id]);
  if (r?.status === 'completed') {
    return (await one(`UPDATE lost_items SET status = 'returned', closed_at = now(), updated_at = now() WHERE id = $1 AND status = 'return_booked' RETURNING *`, [row.id])) ?? row;
  }
  if (r && ['cancelled_rider', 'cancelled_driver', 'cancelled_admin', 'no_drivers'].includes(r.status)) {
    return (await one(`UPDATE lost_items SET status = 'found', return_trip_id = NULL, updated_at = now() WHERE id = $1 AND status = 'return_booked' RETURNING *`, [row.id])) ?? row;
  }
  return row;
}

async function lostView(row: any, viewer: 'rider' | 'driver' | 'staff' = 'staff') {
  const ret = row.return_trip_id ? await one(`SELECT id, ref, status FROM trips WHERE id = $1`, [row.return_trip_id]) : null;
  return {
    id: row.id, trip_id: row.trip_id, status: row.status as LostStatus, label: LOST_LABEL[row.status as LostStatus] ?? row.status, description: row.description,
    reported_by: row.reported_by, driver_note: row.driver_note, created_at: row.created_at, updated_at: row.updated_at,
    // The handover place is for the rider's courier booking and the team; the rider sees it once the driver has given it.
    handover: row.handover_address ? { address: row.handover_address, lat: row.handover_lat, lng: row.handover_lng } : null,
    return_trip: ret, ticket_id: viewer === 'driver' ? undefined : row.ticket_id,
    can_return: viewer === 'rider' && row.status === 'found',
    can_answer: viewer === 'driver' && (row.status === 'reported' || row.status === 'found' || row.status === 'collect'),
  };
}

/** Until when rider and driver can still message and call each other about a lost item (null when there is no open case). */
export async function lostContactUntil(tripId: string): Promise<Date | null> {
  if (!(await supportReady())) return null;
  const row = await one<{ created_at: string }>(`SELECT created_at FROM lost_items WHERE trip_id = $1 AND status = ANY($2) ORDER BY created_at DESC LIMIT 1`, [tripId, LOST_OPEN]);
  if (!row) return null;
  const until = new Date(new Date(row.created_at).getTime() + (await supportPolicy()).lost_property.contact_days * 86400_000);
  return until.getTime() > Date.now() ? until : null;
}

const firstName = (n?: string | null) => (n ?? '').trim().split(/\s+/)[0] || '';

async function lostTrip(tripId: string, me: { id: string }, as: 'rider' | 'driver') {
  const t = await trips.getTrip(tripId);
  if ((as === 'rider' ? t.rider_id : t.driver_id) !== me.id) throw notFound('Trip');
  if (t.status !== 'completed' || !t.driver_id || t.kind !== 'ride') throw conflict('not_reportable', 'Lost property can be reported for finished rides.');
  const policy = await supportPolicy();
  if (daysSince(t.completed_at) > policy.lost_property.report_within_days) {
    throw conflict('too_late', `Lost property can be reported up to ${policy.lost_property.report_within_days} days after the trip. Please call DingoGo.`);
  }
  return t;
}
const openCaseClash = (e: any) => { if (e?.code === '23505') throw conflict('lost_item_open', 'There is already a lost property case for this trip. Open it from the trip.'); throw e; };

/** Rider: "I left something in the car". The driver is told straight away; messages and calls stay open while the case is. */
export async function reportLost(tripId: string, me: { id: string; role: string; name?: string | null }, description: string) {
  await needReady();
  const t = await lostTrip(tripId, me, 'rider');
  const out = await tx(async (c) => {
    const ticket = await createTicket({ userId: me.id, role: 'rider', tripId: t.id, category: 'lost_item', subject: `Lost item on ${t.ref}`, message: description }, c);
    const row = await one(`INSERT INTO lost_items (trip_id, ticket_id, rider_id, driver_id, reported_by, description) VALUES ($1,$2,$3,$4,'rider',$5) RETURNING *`,
      [t.id, ticket.id, t.rider_id, t.driver_id, description], c).catch(openCaseClash);
    await systemMessage(c, ticket.id, 'We have asked your driver to check the car. You can message or call them from the trip screen (your number stays hidden). We will let you know what they say.');
    await trips.event(c, t.id, 'lost_item_reported', me.id, { by: 'rider' });
    return { ticket, row };
  });
  void send(t.driver_id, 'lost_item_driver', { ref: t.ref, item: description.slice(0, 120) }, { data: { trip_id: t.id, lost_item_id: out.row.id } });
  afterNew(out.ticket, me.id);
  return { lost_item: await lostView(out.row, 'rider'), ticket: customerSummary(out.ticket, await supportPolicy()) };
}

/** Driver: "the rider left something in my car" (optionally with where it can be collected). The rider is told. */
export async function reportFound(tripId: string, me: { id: string; role: string }, b: { description: string; handover?: { lat: number; lng: number; address?: string } | null; note?: string | null }) {
  await needReady();
  const t = await lostTrip(tripId, me, 'driver');
  const out = await tx(async (c) => {
    const ticket = await createTicket({ userId: me.id, role: 'driver', tripId: t.id, category: 'lost_item', subject: `Found item after ${t.ref}`, message: b.description, priority: 'normal' }, c);
    const row = await one(
      `INSERT INTO lost_items (trip_id, ticket_id, rider_id, driver_id, reported_by, description, status, driver_note, handover_address, handover_lat, handover_lng)
       VALUES ($1,$2,$3,$4,'driver',$5,'found',$6,$7,$8,$9) RETURNING *`,
      [t.id, ticket.id, t.rider_id, t.driver_id, b.description, b.note ?? null, b.handover?.address ?? null, b.handover?.lat ?? null, b.handover?.lng ?? null], c).catch(openCaseClash);
    await systemMessage(c, ticket.id, 'Thanks. We have told the rider. They can book a courier to collect it from you or arrange a pickup with you through Messages.');
    await trips.event(c, t.id, 'lost_item_reported', me.id, { by: 'driver' });
    return { ticket, row };
  });
  void send(t.rider_id, 'lost_item_found', { ref: t.ref, item: b.description.slice(0, 120), asked: false }, { data: { trip_id: t.id, lost_item_id: out.row.id } });
  afterNew(out.ticket, me.id);
  return { lost_item: await lostView(out.row, 'driver') };
}

async function lostRow(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw notFound('Lost property case');
  const row = await one(`SELECT l.*, t.ref AS trip_ref FROM lost_items l JOIN trips t ON t.id = l.trip_id WHERE l.id = $1`, [id]);
  if (!row) throw notFound('Lost property case');
  return syncLost(row).then((r) => ({ ...r, trip_ref: row.trip_ref }));
}

/** Driver answers: found (with a handover place for a courier) or not found. */
export async function respondLost(id: string, me: { id: string }, b: { found: boolean; note?: string | null; handover?: { lat: number; lng: number; address?: string } | null }) {
  await needReady();
  const row = await lostRow(id);
  if (row.driver_id !== me.id) throw notFound('Lost property case');
  if (!['reported', 'found', 'collect'].includes(row.status) || (!b.found && row.status !== 'reported')) throw conflict('bad_state', 'This case has moved on. Check the trip for details.');
  const status = b.found ? (row.status === 'collect' ? 'collect' : 'found') : 'not_found';
  const updated = await tx(async (c) => {
    const u = await one(
      `UPDATE lost_items SET status = $2, driver_note = coalesce($3, driver_note), handover_address = coalesce($4, handover_address),
         handover_lat = coalesce($5, handover_lat), handover_lng = coalesce($6, handover_lng), updated_at = now(),
         closed_at = CASE WHEN $2 = 'not_found' THEN now() END WHERE id = $1 RETURNING *`,
      [row.id, status, b.note ?? null, b.handover?.address ?? null, b.handover?.lat ?? null, b.handover?.lng ?? null], c);
    if (row.ticket_id && row.reported_by === 'rider') {
      await systemMessage(c, row.ticket_id, b.found
        ? `Your driver has your item.${b.note ? ` They said: "${b.note}".` : ''} Open the trip and tap "Get help with this trip" to have it sent by courier, or message your driver to arrange a pickup.`
        : `Your driver checked the car and could not find it.${b.note ? ` They said: "${b.note}".` : ''} Reply here if you think it was another trip.`);
      await c.query(`UPDATE support_tickets SET status = $2, updated_at = now(), resolved_at = CASE WHEN $2 = 'resolved' THEN now() END WHERE id = $1 AND status <> 'resolved'`,
        [row.ticket_id, b.found ? 'open' : 'pending']);
    }
    await trips.event(c, row.trip_id, b.found ? 'lost_item_found' : 'lost_item_not_found', me.id);
    return u;
  });
  if (row.rider_id && row.status === 'reported') {
    if (b.found) void send(row.rider_id, 'lost_item_found', { ref: row.trip_ref, item: row.description.slice(0, 120), asked: true }, { data: { trip_id: row.trip_id, lost_item_id: row.id } });
    else void send(row.rider_id, 'lost_item_not_found', { ref: row.trip_ref }, { data: { trip_id: row.trip_id } });
  }
  toOps('lost_item.updated', { id: row.id, status });
  return { lost_item: await lostView(updated, 'driver') };
}

/** Rider chooses how to get it back: a courier job from the driver's handover place to an address (normal courier price,
 *  paid like any delivery), or a pickup arranged with the driver through Messages. */
export async function arrangeReturn(id: string, me: { id: string; role: string; name?: string | null }, b: { method: 'courier' | 'collect';
  dropoff?: { lat: number; lng: number; address?: string }; payment_method?: 'card' | 'wallet'; instructions?: string | null }) {
  await needReady();
  const row = await lostRow(id);
  if (row.rider_id !== me.id) throw notFound('Lost property case');
  if (row.status !== 'found') throw conflict('bad_state', row.status === 'reported' ? 'Your driver hasn\'t checked the car yet.' : 'This case has moved on. Check the trip for details.');
  if (b.method === 'collect') {
    const u = await tx(async (c) => {
      const r = await one(`UPDATE lost_items SET status = 'collect', updated_at = now() WHERE id = $1 RETURNING *`, [row.id], c);
      if (row.ticket_id) await systemMessage(c, row.ticket_id, 'The rider will collect the item. Use Messages on the trip to agree a time and a public place.');
      await trips.event(c, row.trip_id, 'lost_item_collect', me.id);
      return r;
    });
    if (row.driver_id) void send(row.driver_id, 'lost_item_collect', { ref: row.trip_ref, item: row.description.slice(0, 120) }, { data: { trip_id: row.trip_id, lost_item_id: row.id } });
    return { lost_item: await lostView(u, 'rider'), return_trip: null };
  }
  if (row.handover_lat == null || row.handover_lng == null) throw conflict('no_handover', 'Your driver hasn\'t said where the courier can collect it yet. Message them on the trip, or choose to collect it.');
  if (!b.dropoff) throw bad('validation_error', 'dropoff: where should we bring it?');
  const drv = await one<{ name: string; phone: string }>(`SELECT name, phone FROM users WHERE id = $1`, [row.driver_id]);
  const rider = await one<{ name: string; phone: string }>(`SELECT name, phone FROM users WHERE id = $1`, [me.id]);
  if (!drv?.phone || !rider?.phone) throw conflict('no_contact', 'We can\'t book a courier for this one. Please call DingoGo.');
  const pickup = { lat: row.handover_lat, lng: row.handover_lng, address: row.handover_address ?? 'Driver handover' };
  const trip = await trips.createTrip(me.id, {
    kind: 'courier', service: 'courier_s', pickup, dropoff: b.dropoff, payment_method: b.payment_method ?? 'card', channel: 'app',
    notes: `Lost property return for ${row.trip_ref}`,
    parcel: {
      size: 'S', description: `Lost property from ${row.trip_ref}: ${row.description}`.slice(0, 200),
      sender_name: `${firstName(drv.name) || 'Your'} (DingoGo driver)`, sender_phone: drv.phone,
      recipient_name: rider.name || 'DingoGo rider', recipient_phone: rider.phone,
      instructions: (b.instructions?.trim() || 'Lost property return. Collect from the DingoGo driver.').slice(0, 300), prohibited_ack: true,
    },
  });
  const u = await tx(async (c) => {
    const r = await one(`UPDATE lost_items SET status = 'return_booked', return_trip_id = $2, updated_at = now() WHERE id = $1 AND status = 'found' RETURNING *`, [row.id, trip.id], c);
    if (!r) throw conflict('bad_state', 'This case has moved on.');
    if (row.ticket_id) await systemMessage(c, row.ticket_id, `Courier ${trip.ref} is booked to bring it to ${b.dropoff!.address ?? 'you'}. Track it from your trips.`);
    await trips.event(c, row.trip_id, 'lost_item_courier', me.id, { courier_trip: trip.ref });
    return r;
  }).catch(async (e) => { await trips.cancelTrip(me, trip.id, 'Lost property case changed').catch(() => undefined); throw e; });
  if (row.driver_id) void send(row.driver_id, 'lost_item_courier', { ref: trip.ref, address: pickup.address }, { data: { trip_id: row.trip_id, lost_item_id: row.id } });
  return { lost_item: await lostView(u, 'rider'), return_trip: { id: trip.id, ref: trip.ref, status: trip.status, quote_cents: trip.quote_cents } };
}

export async function driverLostItems(me: { id: string }) {
  if (!(await supportReady())) return { ready: false, items: [] };
  const rows = await q(`SELECT l.*, t.ref AS trip_ref, t.completed_at, ru.name AS rider_name FROM lost_items l JOIN trips t ON t.id = l.trip_id
    LEFT JOIN users ru ON ru.id = l.rider_id WHERE l.driver_id = $1 AND (l.status = ANY($2) OR l.updated_at > now() - interval '7 days') ORDER BY l.created_at DESC LIMIT 50`, [me.id, LOST_OPEN]);
  const items: any[] = [];
  for (const r of rows) {
    const s = await syncLost(r);
    items.push({ ...(await lostView(s, 'driver')), trip_ref: r.trip_ref, trip_completed_at: r.completed_at, rider_first_name: firstName(r.rider_name) || null });
  }
  return { ready: true, items };
}

export async function adminLostItems(o: { status?: 'open' | 'all' }) {
  if (!(await supportReady())) return { ready: false, items: [] };
  const rows = await q(`SELECT l.*, t.ref AS trip_ref, ru.name AS rider_name, du.name AS driver_name, st.ref AS ticket_ref FROM lost_items l JOIN trips t ON t.id = l.trip_id
    LEFT JOIN users ru ON ru.id = l.rider_id LEFT JOIN users du ON du.id = l.driver_id LEFT JOIN support_tickets st ON st.id = l.ticket_id
    ${o.status === 'all' ? '' : 'WHERE l.status = ANY($1)'} ORDER BY l.created_at DESC LIMIT 200`, o.status === 'all' ? [] : [LOST_OPEN]);
  const items: any[] = [];
  for (const r of rows) items.push({ ...(await lostView(await syncLost(r))), trip_ref: r.trip_ref, rider_name: r.rider_name, driver_name: r.driver_name, ticket_ref: r.ticket_ref });
  return { ready: true, items };
}

export async function adminUpdateLost(id: string, me: { id: string }, b: { status: LostStatus; note?: string | null }) {
  await needReady();
  const row = await lostRow(id);
  const closed = ['returned', 'closed', 'not_found'].includes(b.status);
  const u = await one(`UPDATE lost_items SET status = $2, driver_note = coalesce($3, driver_note), updated_at = now(), closed_at = CASE WHEN $4 THEN now() END WHERE id = $1 RETURNING *`,
    [row.id, b.status, b.note ?? null, closed]).catch(openCaseClash);
  await audit(me.id, 'lost_item_' + b.status, 'lost_item', row.id, b.note ? { note: b.note } : undefined);
  return { lost_item: await lostView(u) };
}

