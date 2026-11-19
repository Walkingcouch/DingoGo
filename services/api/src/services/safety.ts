/**
 * Round 14: safety and trust — the work behind the rules in lib/safety.ts.
 * - Trip sharing with trusted contacts (automatic for every trip or for night trips, or on demand) and texts on SOS / escalation.
 * - Ride check-ins ("Are you OK?") raised by long stops, route deviations or ops; unanswered or "Get help" → an SOS alert.
 * - Online sessions and fatigue limits (warn, then offline once the trip ends; refuse going online until rested).
 * - Driver photo checks before going online (DingoGo review, or a face-match provider when configured).
 * - Account restrictions (suspend / ban / warning / lift) and suspensions that end by themselves.
 * - The emergency card: what to tell 000 (address or nearest landmark, GPS, car and trip).
 * Everything checks safetyReady() first: before migration 019 it does nothing (or the routes answer migration_pending).
 */
import { config } from '../config.js';
import { one, pool, q, type Q } from '../db.js';
import { toOps, toUser, disconnectUser } from '../realtime.js';
import { ApiError } from '../lib/errors.js';
import { haversine, type LatLng } from '../lib/geo.js';
import { PLACES, placeLabel } from '../lib/places.js';
import { logError } from '../lib/log.js';
import { bg } from '../lib/background.js';
import { firstName } from '../lib/messages.js';
import { uploadNameOf } from '../lib/uploads.js';
import {
  RESTRICT_REASONS, SAFETY_NUMBERS, contactsOf, darwinClock, fatigueStatus, isNight, loadSafetyPolicy, safetyReady,
  type FatigueStatus, type RestrictReason, type SafetyPolicy,
} from '../lib/safety.js';
import { notify, send, sendSmsT } from './notify.js';

const trackUrl = (shareToken: string) => `${config.publicWebUrl}/track/${shareToken}`;
const tripEvent = (c: Q, tripId: string, type: string, actorId: string | null, data?: unknown) =>
  c.query('INSERT INTO trip_events (trip_id, type, actor_id, data) VALUES ($1,$2,$3,$4)', [tripId, type, actorId, data ?? null]);
const withdrawOffers = async (driverId: string) => (await import('./trips.js')).withdrawOffers(driverId);
const LIVE = `('accepted','arrived','in_progress')`;
const hoursText = (min: number) => (min % 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min / 60} h`);

// ───────────── Trusted contacts and trip sharing ─────────────

/** Text the rider's trusted contacts the live trip link. Returns how many were texted. */
export async function shareWithContacts(tripId: string, opts: { auto: boolean; actorId?: string | null }) {
  if (!(await safetyReady())) return 0;
  const t = await one(
    `SELECT t.id, t.ref, t.kind, t.share_token, t.rider_id, ru.name AS rider_name, ru.trusted_contacts, du.name AS driver_name,
            v.rego, v.colour, v.make, v.model
     FROM trips t JOIN users ru ON ru.id = t.rider_id LEFT JOIN users du ON du.id = t.driver_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
     WHERE t.id = $1`, [tripId]);
  if (!t || !t.rego) return 0;
  const contacts = contactsOf({ trusted_contacts: t.trusted_contacts });
  for (const c of contacts) {
    void sendSmsT(c.phone, 'trip_shared', {
      name: firstName(t.rider_name || 'A DingoGo rider') || 'A DingoGo rider', driver: firstName(t.driver_name ?? '') || 'DingoGo driver',
      car: [t.colour, t.make, t.model].filter(Boolean).join(' '), rego: t.rego, url: trackUrl(t.share_token),
    }, { userId: t.rider_id, tripId: t.id });
  }
  if (contacts.length) await tripEvent(pool, t.id, 'shared_with_contacts', opts.actorId ?? null, { count: contacts.length, auto: opts.auto });
  return contacts.length;
}

/** On accept: share rides automatically if the rider chose "every trip", or "night trips" and it's night. */
export function autoShare(trip: { id: string; kind: string; rider_id: string }) {
  if (trip.kind !== 'ride') return;
  void bg((async () => {
    if (!(await safetyReady())) return;
    const u = await one(`SELECT auto_share FROM users WHERE id = $1`, [trip.rider_id]);
    if (!u || u.auto_share === 'off') return;
    if (u.auto_share === 'night' && !isNight((await loadSafetyPolicy()).night)) return;
    await shareWithContacts(trip.id, { auto: true });
  })());
}

/** SOS or an escalated check-in: text every contact (trusted contacts + the emergency contact). */
export async function textContactsOnAlert(userId: string, kind: 'sos' | 'escalated', trip: { id: string; ref: string; share_token: string } | null,
  pos?: { lat?: number | null; lng?: number | null }) {
  const cols = (await safetyReady()) ? 'name, emergency_contact, trusted_contacts, role' : 'name, emergency_contact, role';
  const u = await one(`SELECT ${cols} FROM users WHERE id = $1`, [userId]);
  if (!u) return 0;
  const contacts = contactsOf(u);
  const name = firstName(u.name || '') || 'Your contact';
  for (const c of contacts) {
    if (u.role === 'driver') {
      // A driver's contacts get the car's position, never the rider's trip link (pickup and drop-off addresses).
      const where = pos?.lat != null && pos?.lng != null ? `https://maps.google.com/?q=${pos.lat.toFixed(5)},${pos.lng.toFixed(5)}` : 'not known';
      void sendSmsT(c.phone, 'sos_contact', { name, ref: trip?.ref ?? 'no trip', url: where }, { userId, tripId: trip?.id ?? null });
    } else if (trip) {
      if (kind === 'sos') void sendSmsT(c.phone, 'sos_contact', { name, ref: trip.ref, url: trackUrl(trip.share_token) }, { userId, tripId: trip.id });
      else void sendSmsT(c.phone, 'check_in_escalated_contact', { name, ref: trip.ref, url: trackUrl(trip.share_token) }, { userId, tripId: trip.id });
    }
  }
  return contacts.length;
}

// ───────────── Check-ins ─────────────

/** "Are you OK?" to the rider of a live ride. One pending check per trip. Returns the check, or null if one is already waiting. */
export async function createCheck(trip: { id: string; ref: string; rider_id: string }, reason: 'long_stop' | 'route_deviation' | 'ops',
  detail?: Record<string, unknown>, actorId: string | null = null) {
  if (!(await safetyReady())) return null;
  const policy = await loadSafetyPolicy();
  const check = await one(
    `INSERT INTO safety_checks (trip_id, user_id, reason, detail)
     SELECT $1, $2, $3, $4 WHERE NOT EXISTS (SELECT 1 FROM safety_checks WHERE trip_id = $1 AND status = 'pending') RETURNING *`,
    [trip.id, trip.rider_id, reason, detail ?? null]);
  if (!check) return null;
  await tripEvent(pool, trip.id, 'check_in', actorId, { check_id: check.id, reason, ...(detail ?? {}) });
  void send(trip.rider_id, 'safety_check', { ref: trip.ref, reason, minutes: policy.check_ins.answer_min },
    { data: { trip_id: trip.id, check_id: check.id, action: 'safety_check' }, tag: `check-${trip.id}` });
  toUser(trip.rider_id, 'safety.check', { ...check, answer_min: policy.check_ins.answer_min });
  toOps('safety.check_in', { trip_id: trip.id, ref: trip.ref, reason, check_id: check.id });
  return check;
}

/** An unanswered check, or "Get help": raise an SOS alert (ops runbook), and text the rider's contacts if the policy says so. */
async function escalate(check: any, why: 'no_answer' | 'help', policy: SafetyPolicy) {
  const t = await one(
    `SELECT t.id, t.ref, t.share_token, t.rider_id, d.lat, d.lng, u.name AS rider_name FROM trips t JOIN users u ON u.id = t.rider_id
     LEFT JOIN drivers d ON d.user_id = t.driver_id WHERE t.id = $1`, [check.trip_id]);
  if (!t) return null;
  const reasonText = check.reason === 'long_stop' ? 'long stop' : check.reason === 'route_deviation' ? 'off the route' : 'ops check';
  const message = why === 'help' ? `Asked for help at a safety check (${reasonText})` : `No answer to a safety check (${reasonText})`;
  const alert = await one(`INSERT INTO sos_alerts (trip_id, user_id, role, lat, lng, message) VALUES ($1,$2,'rider',$3,$4,$5) RETURNING *`,
    [t.id, t.rider_id, t.lat ?? null, t.lng ?? null, message]);
  await q(`UPDATE safety_checks SET status = $2, escalated_at = now(), sos_id = $3, answered_at = CASE WHEN $2 = 'help' THEN now() ELSE answered_at END WHERE id = $1`,
    [check.id, why === 'help' ? 'help' : 'escalated', alert.id]);
  await tripEvent(pool, t.id, why === 'help' ? 'check_in_help' : 'check_in_escalated', why === 'help' ? t.rider_id : null, { check_id: check.id, sos_id: alert.id });
  toOps('sos.new', { ...alert, trip_ref: t.ref, user_name: t.rider_name, source: 'check_in' });
  if (policy.check_ins.text_contacts_on_escalation) await textContactsOnAlert(t.rider_id, 'escalated', t);
  return alert;
}

/** The rider answers a check: "ok" closes it; "help" raises an SOS at once. Answering after it was escalated is recorded for ops. */
export async function answerCheck(userId: string, checkId: string, answer: 'ok' | 'help') {
  const check = await one(`SELECT * FROM safety_checks WHERE id = $1 AND user_id = $2`, [checkId, userId]);
  if (!check) throw new ApiError(404, 'not_found', 'Check not found');
  const policy = await loadSafetyPolicy();
  if (check.status === 'pending') {
    if (answer === 'help') {
      const alert = await escalate(check, 'help', policy);
      return { status: 'help', sos_id: alert?.id ?? null, emergency_number: '000' };
    }
    const r = await one(`UPDATE safety_checks SET status = 'ok', answered_at = now() WHERE id = $1 AND status = 'pending' RETURNING status`, [checkId]);
    if (r) { await tripEvent(pool, check.trip_id, 'check_in_ok', userId, { check_id: checkId }); toOps('safety.check_answered', { check_id: checkId, trip_id: check.trip_id, answer }); }
    return { status: r?.status ?? 'ok' };
  }
  if (check.status === 'escalated' && !check.answered_at) {
    await q(`UPDATE safety_checks SET answered_at = now(), detail = coalesce(detail, '{}'::jsonb) || jsonb_build_object('late_answer', $2::text) WHERE id = $1`, [checkId, answer]);
    await tripEvent(pool, check.trip_id, 'check_in_late_answer', userId, { check_id: checkId, answer });
    toOps('safety.check_answered', { check_id: checkId, trip_id: check.trip_id, answer, late: true, sos_id: check.sos_id });
    if (answer === 'ok' && check.sos_id) {
      await q(`INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES ($1, 'sos_note', 'sos', $2, $3)`,
        [userId, check.sos_id, JSON.stringify({ text: 'Rider answered "I\'m OK" after the check-in was escalated' })]);
    }
  }
  return { status: check.status };
}

/** Long stops: a ride in progress whose car hasn't moved (within 150 m) for `long_stop_min`, away from the pickup and drop-off,
 *  with a fresh signal (silence is the driver-silent alert's job). One check at a time, and at most one per 3 × long_stop_min. */
async function findLongStops(policy: SafetyPolicy) {
  const N = policy.check_ins.long_stop_min;
  const rides = await q(
    `SELECT t.id, t.ref, t.rider_id, t.driver_id, t.pickup_lat, t.pickup_lng, t.dropoff_lat, t.dropoff_lng FROM trips t
     WHERE t.status = 'in_progress' AND t.kind = 'ride' AND t.service <> 'tour' AND t.batch_id IS NULL
       AND t.started_at < now() - make_interval(mins => $1)
       AND NOT EXISTS (SELECT 1 FROM safety_checks s WHERE s.trip_id = t.id AND (s.status = 'pending' OR s.created_at > now() - make_interval(mins => $1 * 3)))`, [N]);
  let raised = 0;
  for (const t of rides) {
    const pts = await q<{ lat: number; lng: number; at: Date; old: boolean }>(
      `(SELECT lat, lng, at, true AS old FROM trip_track WHERE trip_id = $1 AND at <= now() - make_interval(mins => $2) ORDER BY at DESC LIMIT 1)
       UNION ALL
       (SELECT lat, lng, at, false FROM trip_track WHERE trip_id = $1 AND at > now() - make_interval(mins => $2) ORDER BY at DESC LIMIT 200)`, [t.id, N]);
    const anchor = pts.find((p) => p.old);
    const recent = pts.filter((p) => !p.old);
    if (!anchor || !recent.length) continue;
    const latest = recent[0];
    if (Date.now() - new Date(latest.at).getTime() > 2 * 60_000) continue;          // no fresh signal: driver-silent alert covers it
    if (![anchor, ...recent].every((p) => haversine(p, latest) <= 150)) continue;   // still moving
    const fromPickup = haversine(latest, { lat: t.pickup_lat, lng: t.pickup_lng });
    const fromDrop = haversine(latest, { lat: t.dropoff_lat, lng: t.dropoff_lng });
    if (fromPickup < 300 || fromDrop < 300) continue;                               // waiting at either end is normal
    const minutes = Math.round((Date.now() - new Date(anchor.at).getTime()) / 60_000);
    const c = await createCheck(t, 'long_stop', { minutes, lat: latest.lat, lng: latest.lng });
    if (c) { raised++; toOps('safety.long_stop', { trip_id: t.id, ref: t.ref, minutes, lat: latest.lat, lng: latest.lng }); }
  }
  return raised;
}

// ───────────── Online sessions and fatigue ─────────────

/** Record going online / offline (open or close the driver's session). Safe to call twice. */
export async function sessionOnline(driverId: string, online: boolean, reason = 'driver', c: Q = pool) {
  if (!(await safetyReady())) return;
  if (online) {
    await c.query(`INSERT INTO driver_online_sessions (driver_id) VALUES ($1) ON CONFLICT (driver_id) WHERE ended_at IS NULL DO NOTHING`, [driverId]);
  } else {
    await c.query(`UPDATE driver_online_sessions SET ended_at = now(), end_reason = $2 WHERE driver_id = $1 AND ended_at IS NULL`, [driverId, reason]);
  }
}

async function sessionsFor(driverIds: string[]) {
  const rows = await q(
    `SELECT driver_id, started_at, ended_at, warned_at FROM driver_online_sessions
     WHERE driver_id = ANY($1) AND coalesce(ended_at, now()) > now() - interval '48 hours' ORDER BY started_at`, [driverIds]);
  const by = new Map<string, any[]>();
  for (const r of rows) { if (!by.has(r.driver_id)) by.set(r.driver_id, []); by.get(r.driver_id)!.push(r); }
  return by;
}

export async function driverFatigue(driverId: string, policy?: SafetyPolicy): Promise<FatigueStatus | null> {
  if (!(await safetyReady())) return null;
  const p = policy ?? await loadSafetyPolicy();
  return fatigueStatus((await sessionsFor([driverId])).get(driverId) ?? [], p.fatigue);
}

/** Sessions follow the online flag, whatever set it (stale-signal offline, blocks, leave, admin): open missing ones, close
 *  ones left open for drivers who are offline (at their last signal). */
async function syncSessions() {
  await q(`INSERT INTO driver_online_sessions (driver_id) SELECT d.user_id FROM drivers d
           WHERE d.online AND NOT EXISTS (SELECT 1 FROM driver_online_sessions s WHERE s.driver_id = d.user_id AND s.ended_at IS NULL)
           ON CONFLICT (driver_id) WHERE ended_at IS NULL DO NOTHING`);
  await q(`UPDATE driver_online_sessions s SET ended_at = greatest(s.started_at, least(now(), coalesce(d.last_seen_at, now()))), end_reason = 'sync'
           FROM drivers d WHERE d.user_id = s.driver_id AND s.ended_at IS NULL AND NOT d.online`);
}

/** Over a limit and not on a trip: offline now, told when they can come back. Near a limit: warned once per session. */
export async function enforceFatigue(onlyDriver?: string) {
  if (!(await safetyReady())) return 0;
  const policy = await loadSafetyPolicy();
  if (!policy.fatigue.enabled) return 0;
  const online = await q(
    `SELECT d.user_id, EXISTS (SELECT 1 FROM trips t WHERE t.driver_id = d.user_id AND t.status IN ${LIVE}) AS on_trip
     FROM drivers d WHERE d.online ${onlyDriver ? 'AND d.user_id = $1' : ''}`, onlyDriver ? [onlyDriver] : []);
  if (!online.length) return 0;
  const by = await sessionsFor(online.map((d) => d.user_id));
  let n = 0;
  for (const d of online) {
    const ss = by.get(d.user_id) ?? [];
    const st = fatigueStatus(ss, policy.fatigue);
    const open = ss.find((s) => !s.ended_at);
    if (st.reason) {
      if (d.on_trip) continue;                         // never mid-trip: offline as soon as it ends
      const off = await one(`UPDATE drivers SET online = false WHERE user_id = $1 AND online RETURNING user_id`, [d.user_id]);
      if (!off) continue;
      await sessionOnline(d.user_id, false, 'fatigue');
      await withdrawOffers(d.user_id);
      const after = await driverFatigue(d.user_id, policy);
      const until = after?.rest_until ? darwinClock(new Date(after.rest_until)) : 'soon';
      const mins = st.reason === 'break' ? st.continuous_min : st.online_min_24h;
      void send(d.user_id, 'fatigue_offline', { kind: st.reason, until, hours: hoursText(mins) }, { data: { action: 'fatigue', rest_until: after?.rest_until ?? null } });
      toOps('driver.status', { driver_id: d.user_id, online: false, reason: 'fatigue' });
      n++;
    } else if (open && !open.warned_at && st.minutes_left != null && policy.fatigue.warn_before_min > 0 && st.minutes_left <= policy.fatigue.warn_before_min) {
      const kind = policy.fatigue.max_online_min_24h - st.online_min_24h <= policy.fatigue.break_after_min - st.continuous_min ? 'daily_limit' : 'break';
      await q(`UPDATE driver_online_sessions SET warned_at = now() WHERE driver_id = $1 AND ended_at IS NULL`, [d.user_id]);
      void send(d.user_id, 'fatigue_warning', { minutes: st.minutes_left, kind }, { data: { action: 'fatigue' } });
    }
  }
  return n;
}

// ───────────── Photo checks ─────────────

/** Why the driver can't go online yet for safety reasons (fatigue rest, photo check), or null. */
export async function onlineBlock(driverId: string): Promise<ApiError | null> {
  if (!(await safetyReady())) return null;
  const policy = await loadSafetyPolicy();
  const f = await driverFatigue(driverId, policy);
  if (f?.rest_until) {
    const until = darwinClock(new Date(f.rest_until));
    return new ApiError(409, 'fatigue_rest', f.reason === 'break'
      ? `Time for a break: you've been online ${hoursText(f.continuous_min)}. You can go online again from ${until}.`
      : `You've reached the daily limit (${hoursText(f.online_min_24h)} online). Rest and go online again from ${until}.`, { fatigue: f });
  }
  if (policy.identity_check.mode !== 'off') {
    const last = await one(`SELECT status, created_at FROM identity_checks WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 1`, [driverId]);
    if (last?.status === 'rejected') return new ApiError(409, 'identity_check_rejected', 'Your last photo check was not accepted. Take a new photo to go online.');
    if (!last || Date.now() - new Date(last.created_at).getTime() > policy.identity_check.every_hours * 3600e3) {
      return new ApiError(409, 'identity_check_needed', 'Take a quick photo of yourself so we know it\'s you driving today.');
    }
  }
  return null;
}

export async function identityStatus(driverId: string, policy: SafetyPolicy) {
  const last = await one(`SELECT id, status, method, note, created_at, reviewed_at FROM identity_checks WHERE driver_id = $1 ORDER BY created_at DESC LIMIT 1`, [driverId]);
  const due = policy.identity_check.mode !== 'off' && (!last || last.status === 'rejected'
    || Date.now() - new Date(last.created_at).getTime() > policy.identity_check.every_hours * 3600e3);
  return { mode: policy.identity_check.mode, every_hours: policy.identity_check.every_hours, due, last };
}

async function uploadBase64(ref: string) {
  const name = uploadNameOf(ref);
  const f = name ? await one<{ data: Buffer }>('SELECT data FROM uploads WHERE name = $1', [name]) : null;
  return f ? f.data.toString('base64') : null;
}

/** Ask the face-match provider. null = not configured, no reference photo yet, or it failed (DingoGo reviews instead). */
async function faceMatch(selfieRef: string, referenceRef: string): Promise<number | null> {
  if (!config.safety.faceMatchUrl) return null;
  try {
    const [selfie, reference] = await Promise.all([uploadBase64(selfieRef), uploadBase64(referenceRef)]);
    if (!selfie || !reference) return null;
    const res = await fetch(config.safety.faceMatchUrl, {
      method: 'POST', signal: AbortSignal.timeout(config.safety.faceMatchTimeoutMs),
      headers: { 'Content-Type': 'application/json', ...(config.safety.faceMatchKey ? { Authorization: `Bearer ${config.safety.faceMatchKey}` } : {}) },
      body: JSON.stringify({ selfie, reference }),
    });
    if (!res.ok) return null;
    const j: any = await res.json();
    return typeof j?.score === 'number' && j.score >= 0 && j.score <= 1 ? j.score : null;
  } catch (e) { logError('face match', e); return null; }
}

/** The driver sends a selfie. With face_match and a provider, a match against the last approved photo is approved at once;
 *  otherwise DingoGo reviews it (the driver can go online meanwhile; a rejected photo takes them offline). */
export async function submitIdentityCheck(driverId: string, photoRef: string) {
  const policy = await loadSafetyPolicy();
  const base = await one(`SELECT photo_url FROM identity_checks WHERE driver_id = $1 AND status = 'approved' ORDER BY created_at DESC LIMIT 1`, [driverId]);
  let score: number | null = null;
  if (policy.identity_check.mode === 'face_match' && base) score = await faceMatch(photoRef, base.photo_url);
  const approved = score != null && score >= policy.identity_check.match_threshold;
  const check = await one(
    `INSERT INTO identity_checks (driver_id, photo_url, method, status, match_score, reviewed_at) VALUES ($1,$2,$3,$4,$5,$6)
     RETURNING id, status, method, match_score, created_at`,
    [driverId, photoRef, score != null ? 'face_match' : 'photo_review', approved ? 'approved' : 'pending', score, approved ? new Date() : null]);
  if (!approved) toOps('safety.identity_check', { driver_id: driverId, check_id: check.id, match_score: score });
  return check;
}

/** DingoGo's decision on a photo. Not accepted: the driver goes offline (not mid-trip: ops are told instead). */
export async function reviewIdentityCheck(id: string, staffId: string, status: 'approved' | 'rejected', note: string | null) {
  const c = await one(`UPDATE identity_checks SET status = $2, note = $3, reviewed_by = $4, reviewed_at = now() WHERE id = $1 RETURNING *`,
    [id, status, note, staffId]);
  if (!c) throw new ApiError(404, 'not_found', 'Photo check not found');
  if (status === 'rejected') {
    const live = await one(`SELECT ref FROM trips WHERE driver_id = $1 AND status IN ${LIVE} LIMIT 1`, [c.driver_id]);
    if (live) toOps('safety.identity_rejected_on_trip', { driver_id: c.driver_id, ref: live.ref });
    else {
      const off = await one(`UPDATE drivers SET online = false WHERE user_id = $1 AND online RETURNING user_id`, [c.driver_id]);
      if (off) { await sessionOnline(c.driver_id, false, 'identity'); await withdrawOffers(c.driver_id); toOps('driver.status', { driver_id: c.driver_id, online: false, reason: 'identity_check' }); }
    }
  }
  void send(c.driver_id, 'identity_check_reviewed', { approved: status === 'approved', note }, { data: { action: 'identity_check' } });
  return c;
}

// ───────────── Account standing ─────────────

export interface RestrictInput { action: 'suspend' | 'ban' | 'warning'; reason_code: RestrictReason; public_reason?: string | null; note?: string | null; until?: string | null; incident_id?: string | null }

/** Suspend, ban or warn an account. Suspend/ban: blocked, offline, offers withdrawn, signed out everywhere, told by text. */
export async function restrictAccount(userId: string, b: RestrictInput, byId: string | null, c: Q = pool) {
  const publicReason = (b.public_reason?.trim() || RESTRICT_REASONS[b.reason_code]).slice(0, 300);
  const until = b.action === 'suspend' && b.until ? new Date(b.until) : null;
  const action = await one(
    `INSERT INTO account_actions (user_id, action, reason_code, public_reason, note, until, incident_id, by_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [userId, b.action, b.reason_code, publicReason, b.note ?? null, until, b.incident_id ?? null, byId], c);
  if (b.action === 'warning') {
    void notify(userId, 'A note from DingoGo', publicReason, { action: 'account_warning' }, 'account');
    return action;
  }
  await c.query(`UPDATE users SET blocked = true WHERE id = $1`, [userId]);
  const off = await one(`UPDATE drivers SET online = false WHERE user_id = $1 AND online RETURNING user_id`, [userId], c);
  if (off) await sessionOnline(userId, false, 'blocked', c);
  await withdrawOffers(userId);
  disconnectUser(userId, 'blocked');
  const u = await one(`SELECT phone FROM users WHERE id = $1 AND deleted_at IS NULL`, [userId], c);
  const untilText = until ? new Intl.DateTimeFormat('en-AU', { timeZone: config.timezone, day: 'numeric', month: 'short', year: 'numeric' }).format(until) : null;
  if (u?.phone) void sendSmsT(u.phone, 'account_restricted', { kind: b.action, reason: publicReason, until: untilText }, { userId });
  toOps('account.restricted', { user_id: userId, action: b.action, reason_code: b.reason_code });
  return action;
}

/** Lift a suspension or ban (staff, an upheld appeal, or a suspension whose end date passed). */
export async function liftAccount(userId: string, byId: string | null, note: string | null, opts: { silent?: boolean } = {}) {
  const u = await one(`UPDATE users SET blocked = false WHERE id = $1 AND blocked RETURNING phone`, [userId]);
  if (!u) return null;
  const action = await one(
    `INSERT INTO account_actions (user_id, action, reason_code, public_reason, note, by_id) VALUES ($1,'lift','other','Your account is active again.',$2,$3) RETURNING *`,
    [userId, note, byId]);
  if (!opts.silent && u.phone) void sendSmsT(u.phone, 'account_restored', {}, { userId });
  toOps('account.restored', { user_id: userId });
  return action;
}

/** The suspension or ban in force for a blocked account (latest suspend/ban since the last lift), or null. */
export async function currentRestriction(userId: string) {
  if (!(await safetyReady())) return null;
  return one(
    `SELECT a.id, a.action, a.reason_code, a.public_reason, a.until, a.created_at FROM account_actions a
     WHERE a.user_id = $1 AND a.action IN ('suspend','ban')
       AND a.created_at > coalesce((SELECT max(created_at) FROM account_actions WHERE user_id = $1 AND action = 'lift'), '-infinity')
     ORDER BY a.created_at DESC LIMIT 1`, [userId]);
}

/** A blocked account whose suspension end date has passed is active again. True if it was lifted. */
export async function liftIfEnded(userId: string) {
  const r = await currentRestriction(userId);
  if (r?.action === 'suspend' && r.until && new Date(r.until).getTime() <= Date.now()) {
    return !!(await liftAccount(userId, null, 'Suspension ended'));
  }
  return false;
}

async function liftEndedSuspensions() {
  const due = await q(
    `SELECT DISTINCT a.user_id FROM account_actions a JOIN users u ON u.id = a.user_id
     WHERE u.blocked AND a.action = 'suspend' AND a.until IS NOT NULL AND a.until <= now() AND a.created_at > now() - interval '400 days'`);
  for (const d of due) await liftIfEnded(d.user_id).catch((e) => logError('lift suspension', e));
}

// ───────────── The tick ─────────────

let lastRun = 0;
/** Run from the dispatcher tick (every `SAFETY_TICK_S`): online sessions, fatigue, long stops, unanswered check-ins, ended suspensions. */
export async function runSafetyChecks(opts: { force?: boolean } = {}) {
  if (!opts.force && Date.now() - lastRun < config.safety.tickS * 1000) return null;
  lastRun = Date.now();
  if (!(await safetyReady())) return null;
  const policy = await loadSafetyPolicy();
  const out = { fatigued: 0, long_stops: 0, escalated: 0 };
  await syncSessions().catch((e) => logError('online sessions', e));
  out.fatigued = await enforceFatigue().catch((e) => { logError('fatigue', e); return 0; });
  if (policy.check_ins.enabled) {
    out.long_stops = await findLongStops(policy).catch((e) => { logError('long stops', e); return 0; });
    const late = await q(`SELECT * FROM safety_checks WHERE status = 'pending' AND created_at < now() - make_interval(mins => $1)`, [policy.check_ins.answer_min]);
    for (const c of late) {
      // Claim it first, so two ticks can't both raise an alert.
      const mine = await one(`UPDATE safety_checks SET status = 'escalated' WHERE id = $1 AND status = 'pending' RETURNING *`, [c.id]);
      if (mine && await escalate(mine, 'no_answer', policy).catch((e) => { logError('escalate', e); return null; })) out.escalated++;
    }
  }
  await liftEndedSuspensions().catch((e) => logError('suspensions', e));
  return out;
}

// ───────────── Emergency card ─────────────

const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
function bearing(from: LatLng, to: LatLng) {
  const r = (d: number) => (d * Math.PI) / 180;
  const y = Math.sin(r(to.lng - from.lng)) * Math.cos(r(to.lat));
  const x = Math.cos(r(from.lat)) * Math.sin(r(to.lat)) - Math.sin(r(from.lat)) * Math.cos(r(to.lat)) * Math.cos(r(to.lng - from.lng));
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}
const dms = (v: number, pos: string, neg: string) => {
  const a = Math.abs(v); const d = Math.floor(a); const m = Math.floor((a - d) * 60); const s = ((a - d) * 60 - m) * 60;
  return `${d}° ${m}' ${s.toFixed(1)}" ${v < 0 ? neg : pos}`;
};

async function reverseGeocode(p: LatLng): Promise<string | null> {
  if (!config.safety.reverseGeocodeUrl) return null;
  try {
    const u = new URL(config.safety.reverseGeocodeUrl);
    u.searchParams.set('point.lat', String(p.lat)); u.searchParams.set('point.lon', String(p.lng)); u.searchParams.set('size', '1');
    const res = await fetch(u, { headers: config.orsKey ? { Authorization: config.orsKey } : {}, signal: AbortSignal.timeout(1500) });
    if (!res.ok) return null;
    const j: any = await res.json();
    const label = j?.features?.[0]?.properties?.label;
    return typeof label === 'string' && label.length < 200 ? label : null;
  } catch { return null; }
}

/** What to tell 000, read out or shown: address (if a geocoder is set up) or the nearest landmark, GPS, the car and trip. */
export async function emergencyCard(me: { id: string; role: string }, at: Partial<LatLng>, tripId?: string) {
  const live = await one(
    `SELECT t.id, t.ref, t.kind, t.rider_id, t.driver_id, t.pickup_address, t.dropoff_address, t.status, d.lat AS car_lat, d.lng AS car_lng,
            v.rego, v.colour, v.make, v.model, du.name AS driver_name, ru.name AS rider_name
     FROM trips t LEFT JOIN drivers d ON d.user_id = t.driver_id LEFT JOIN vehicles v ON v.id = t.vehicle_id
     LEFT JOIN users du ON du.id = t.driver_id JOIN users ru ON ru.id = t.rider_id
     WHERE (t.rider_id = $1 OR t.driver_id = $1) AND t.status IN ${LIVE} ${tripId ? 'AND t.id = $2' : ''}
     ORDER BY t.requested_at DESC LIMIT 1`, tripId ? [me.id, tripId] : [me.id]).catch(() => null);
  const lat = at.lat ?? live?.car_lat ?? null, lng = at.lng ?? live?.car_lng ?? null;
  let address: string | null = null, landmark: { name: string; distance_m: number; direction: string } | null = null;
  if (lat != null && lng != null) {
    const p = { lat, lng };
    address = await reverseGeocode(p);
    const near = PLACES.map((x) => ({ x, d: haversine(p, x) })).sort((a, b) => a.d - b.d)[0];
    if (near) landmark = { name: placeLabel(near.x), distance_m: Math.round(near.d / 10) * 10, direction: DIRS[Math.round(bearing(near.x, p) / 45) % 8] };
  }
  const car = live?.rego ? `${[live.colour, live.make, live.model].filter(Boolean).join(' ')}, rego ${live.rego.split('').join(' ')}` : null;
  const lines: string[] = [];
  if (address) lines.push(`My location is ${address}.`);
  else if (landmark) lines.push(landmark.distance_m < 150 ? `I'm at ${landmark.name}, Alice Springs.` : `I'm about ${landmark.distance_m >= 1000 ? `${(landmark.distance_m / 1000).toFixed(1)} kilometres` : `${landmark.distance_m} metres`} ${landmark.direction} of ${landmark.name}, Alice Springs.`);
  if (lat != null && lng != null) lines.push(`GPS: latitude ${lat < 0 ? 'minus ' : ''}${Math.abs(lat).toFixed(5)}, longitude ${lng.toFixed(5)}.`);
  if (live && car) lines.push(me.id === live.driver_id ? `I'm a DingoGo driver in a ${car}.` : `I'm in a DingoGo car: ${car}. Driver ${firstName(live.driver_name ?? '')}.`);
  if (live) lines.push(`Trip ${live.ref}, from ${live.pickup_address} to ${live.dropoff_address}.`);
  return {
    emergency_number: '000',
    say: lines.join(' '),
    address, landmark,
    lat, lng, dms: lat != null && lng != null ? `${dms(lat, 'N', 'S')}, ${dms(lng, 'E', 'W')}` : null,
    trip: live ? { id: live.id, ref: live.ref, pickup: live.pickup_address, dropoff: live.dropoff_address, car, status: live.status } : null,
    numbers: SAFETY_NUMBERS,
  };
}
