/**
 * Trip chat between rider and driver (and DingoGo staff), plus finding the trip behind a call or text to the relay number.
 * Polling-friendly: clients ask for messages after the last id they have (`after`), every few seconds while the chat is open.
 * Messages are kept with the trip as a safety record (ops can read them). Table trip_messages (migration 015).
 */
import { config } from '../config.js';
import { one, q } from '../db.js';
import { ApiError, conflict } from '../lib/errors.js';
import { limit } from '../lib/rateLimit.js';
import { render } from '../lib/messages.js';
import { toTrip, toUser } from '../realtime.js';
import { notify, sendSms } from './notify.js';

export type ChatRole = 'rider' | 'driver' | 'dingogo';
export const CHAT_AFTER_MIN = 30;
const LIVE = new Set(['accepted', 'arrived', 'in_progress']);

export const QUICK_REPLIES: Record<ChatRole, { key: string; text: string; courier?: boolean; ride?: boolean }[]> = {
  rider: [
    { key: 'coming_out', text: "I'm coming out now" },
    { key: 'at_pickup', text: "I'm at the pickup spot" },
    { key: 'wait_2', text: 'Please wait 2 minutes' },
    { key: 'cant_see', text: "I can't see you. Where are you?" },
    { key: 'moved', text: "I'm waiting a bit away from the pin. I'll wave." },
    { key: 'thanks', text: 'Thank you' },
  ],
  driver: [
    { key: 'on_way', text: "On my way" },
    { key: 'here', text: "I'm here" },
    { key: 'outside', text: "I'm outside. Look for my rego." , ride: true },
    { key: 'at_door', text: "I'm at the door with the parcel", courier: true },
    { key: 'late_5', text: 'Running about 5 minutes late, sorry' },
    { key: 'cant_find', text: "I can't find you. Where are you?" },
    { key: 'thanks', text: 'Thank you' },
  ],
  dingogo: [],
};
export function quickRepliesFor(role: ChatRole, kind: string) {
  return QUICK_REPLIES[role].filter((r) => (kind === 'courier' ? !r.ride : !r.courier)).map(({ key, text }) => ({ key, text }));
}

const missing = (e: any) => e?.code === '42P01' || e?.code === '42703';
const pending = () => new ApiError(503, 'migration_pending', 'Messages are not switched on yet. Please call DingoGo if you need to reach your driver or rider.');
async function guard<T>(p: Promise<T>): Promise<T> {
  try { return await p; } catch (e) { if (missing(e)) throw pending(); throw e; }
}

export function chatRole(t: any, me: { id: string; role: string }): ChatRole | null {
  if (me.id === t.rider_id) return 'rider';
  if (t.driver_id && me.id === t.driver_id) return 'driver';
  if (me.role === 'admin' || me.role === 'dispatcher') return 'dingogo';
  return null;
}

/** Open while the trip is on (driver assigned) and for 30 minutes after drop-off (left something in the car). Staff can always write. */
export function chatOpen(t: any, role: ChatRole | null, now = Date.now()) {
  if (!role) return false;
  if (role === 'dingogo') return true;
  if (!t.driver_id) return false;
  if (LIVE.has(t.status)) return true;
  return t.status === 'completed' && !!t.completed_at && now - new Date(t.completed_at).getTime() < CHAT_AFTER_MIN * 60_000;
}

function out(m: any, me: { id: string }) {
  return { id: Number(m.id), from: m.sender_role as ChatRole, mine: m.sender_id === me.id, body: m.body, quick: m.quick, via: m.via,
    created_at: m.created_at, read_at: m.read_at };
}

export async function listMessages(t: any, me: { id: string; role: string }, opts: { after?: number; peek?: boolean } = {}) {
  const role = chatRole(t, me);
  if (!role) throw new ApiError(404, 'not_found', 'Trip not found');
  const rows = await guard(q(`SELECT * FROM trip_messages WHERE trip_id = $1 AND id > $2 ORDER BY id LIMIT 200`, [t.id, opts.after ?? 0]));
  const unreadRow = role === 'dingogo' ? { n: 0 } : await one<{ n: number }>(
    `SELECT count(*)::int n FROM trip_messages WHERE trip_id = $1 AND read_at IS NULL AND sender_role <> $2`, [t.id, role]);
  // Reading marks what the other side sent as read (shown to them as "Read"). Staff reading a thread doesn't.
  if (!opts.peek && role !== 'dingogo' && (unreadRow?.n ?? 0) > 0) {
    await q(`UPDATE trip_messages SET read_at = now() WHERE trip_id = $1 AND read_at IS NULL AND sender_role <> $2`, [t.id, role]);
  }
  const open = chatOpen(t, role);
  return {
    messages: rows.map((m) => out(m, me)),
    unread: opts.peek ? unreadRow?.n ?? 0 : 0,
    can_send: open,
    closes_at: role !== 'dingogo' && t.status === 'completed' && t.completed_at ? new Date(new Date(t.completed_at).getTime() + CHAT_AFTER_MIN * 60_000).toISOString() : null,
    quick_replies: open ? quickRepliesFor(role, t.kind) : [],
    role,
  };
}

/** Plain text only: control characters removed, blank lines squeezed. */
export function cleanText(s: string) {
  return s.replace(/[\u0000-\u0009\u000b-\u001f\u007f​-‏‪-‮]/g, '').replace(/\n{3,}/g, '\n\n').trim();
}

export async function postMessage(t: any, sender: { id: string; role: string; name?: string | null },
  input: { body?: string; quick?: string; client_id?: string; via?: 'app' | 'sms' }) {
  const role = chatRole(t, sender);
  if (!role) throw new ApiError(404, 'not_found', 'Trip not found');
  if (!chatOpen(t, role)) throw conflict('chat_closed', `Messages are open while the trip is on and for ${CHAT_AFTER_MIN} minutes after drop-off.`);
  let text = '';
  let quick: string | null = null;
  if (input.quick) {
    const qr = quickRepliesFor(role, t.kind).find((r) => r.key === input.quick);
    if (!qr) throw new ApiError(400, 'bad_quick_reply', 'Unknown quick reply');
    text = qr.text; quick = qr.key;
  } else text = cleanText(input.body ?? '').slice(0, 500);
  if (!text) throw new ApiError(400, 'empty_message', 'Type a message');
  // A retry after a lost reply (same client_id): return what is already stored, without counting it against the limit.
  if (input.client_id) {
    const m = await guard(one('SELECT * FROM trip_messages WHERE trip_id = $1 AND sender_id = $2 AND client_id = $3', [t.id, sender.id, input.client_id]));
    if (m) return { message: out(m, sender), replayed: true };
  }
  await limit('chat_send', `${sender.id}:${t.id}`, 20, 300, 'You are sending messages very fast. Please wait a minute.');

  const inserted = await guard(one(
    `INSERT INTO trip_messages (trip_id, sender_id, sender_role, body, quick, via, client_id) VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (trip_id, sender_id, client_id) WHERE client_id IS NOT NULL DO NOTHING RETURNING *`,
    [t.id, sender.id, role, text, quick, input.via ?? 'app', input.client_id ?? null]));
  if (!inserted) {
    // Same client_id again (a retry after a lost reply): the message is already there.
    const m = await one('SELECT * FROM trip_messages WHERE trip_id = $1 AND sender_id = $2 AND client_id = $3', [t.id, sender.id, input.client_id]);
    return { message: out(m, sender), replayed: true };
  }
  const msg = out(inserted, sender);
  const { mine: _mine, ...pub } = msg;
  toTrip(t.id, 'message.new', { trip_id: t.id, ...pub });
  const to = role === 'rider' ? [t.driver_id] : role === 'driver' ? [t.rider_id] : [t.rider_id, t.driver_id];
  for (const uid of to.filter(Boolean)) {
    toUser(uid, 'message.new', { trip_id: t.id, ...pub });
    const m = render('chat_message', { from: role, name: role === 'dingogo' ? null : sender.name, text });
    void notify(uid, m.title!, m.body!, { trip_id: t.id, chat: true }, 'chat', { inbox: false, tag: `chat-${t.id}` });
  }
  // Riders who booked by phone may not have the app: pass driver and staff messages on by text from the relay number,
  // so their reply comes back into this thread.
  if (role !== 'rider' && config.twilio.relayNumber && (t.channel === 'phone' || t.channel === 'sms')) {
    const rider = await one<{ phone: string }>('SELECT phone FROM users WHERE id = $1 AND deleted_at IS NULL', [t.rider_id]);
    if (rider?.phone) {
      const s = render('chat_relay_sms', { from: role, name: sender.name, text });
      void sendSms(rider.phone, s.sms!, { template: 'chat_relay_sms', kind: 'transactional', userId: t.rider_id, tripId: t.id, from: config.twilio.relayNumber });
    }
  }
  return { message: msg, replayed: false };
}

/** The live trip (or one that ended under 30 minutes ago, for texts) behind a phone number calling or texting the relay. */
export async function tripForPhone(phone: string, opts: { recent?: boolean } = {}) {
  const t = await one(
    `SELECT t.*, ru.phone AS rider_phone, ru.name AS rider_name, du.phone AS driver_phone, du.name AS driver_name
     FROM trips t JOIN users ru ON ru.id = t.rider_id LEFT JOIN users du ON du.id = t.driver_id
     WHERE t.driver_id IS NOT NULL AND (ru.phone = $1 OR du.phone = $1)
       AND (t.status IN ('accepted','arrived','in_progress')
            OR ($2 AND t.status = 'completed' AND t.completed_at > now() - make_interval(mins => $3)))
     ORDER BY (t.status IN ('accepted','arrived','in_progress')) DESC, (du.phone = $1) DESC, coalesce(t.accepted_at, t.requested_at) DESC
     LIMIT 1`, [phone, !!opts.recent, CHAT_AFTER_MIN]);
  if (!t) return null;
  const callerIs: 'rider' | 'driver' = t.driver_phone === phone ? 'driver' : 'rider';
  return { trip: t, callerIs, callerId: callerIs === 'rider' ? t.rider_id : t.driver_id, callerName: callerIs === 'rider' ? t.rider_name : t.driver_name,
    other: callerIs === 'rider' ? t.driver_phone : t.rider_phone };
}

/** How the rider and driver can reach each other on this trip. */
export function contactFor(t: any, role: ChatRole | null) {
  const live = LIVE.has(t.status) && !!t.driver_id;
  const relay = config.twilio.relayNumber && config.twilio.sid && config.twilio.token ? config.twilio.relayNumber : null;
  const call = live && relay && (role === 'rider' || role === 'driver') ? relay : null;
  return {
    chat: chatOpen(t, role),
    call: call ? { number: call, note: 'Call from the mobile number on your account. Your own number stays hidden.' } : null,
    text: call ? { number: call } : null,
    reason: !live ? 'not_live' : !relay ? 'relay_off' : null,
  };
}
