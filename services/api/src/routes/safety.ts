/**
 * Round 14: safety and trust endpoints — trusted contacts and trip sharing, check-ins, the emergency card, safety reports,
 * driver photo checks and fatigue status, appeals from restricted accounts, and the admin side (policy, queues, standing).
 * Before migration 019 these answer 503 migration_pending (the emergency card and sharing status still work).
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { one, q } from '../db.js';
import { requireUser, verifyAppealToken } from '../auth.js';
import { ApiError, bad, conflict, forbidden, notFound, unauthorised } from '../lib/errors.js';
import { parse, phone, z } from '../lib/validate.js';
import { limit } from '../lib/rateLimit.js';
import { audit } from '../lib/audit.js';
import { incidentRef } from '../lib/ids.js';
import { ownUpload } from '../lib/uploads.js';
import { toOps } from '../realtime.js';
import {
  AUTO_SHARE, autoHoldBlocker, INCIDENT_CATEGORIES, INCIDENT_STATUSES, MAX_TRUSTED_CONTACTS, RESTRICT_REASONS, SAFETY_NUMBERS, checkSafetyPolicy,
  fatigueStatus, loadSafetyPolicy, safetyPending, safetyReady, type IncidentCategory, type RestrictReason,
} from '../lib/safety.js';
import {
  answerCheck, createCheck, currentRestriction, driverFatigue, emergencyCard, identityStatus, liftAccount, restrictAccount,
  reviewIdentityCheck, shareWithContacts, submitIdentityCheck,
} from '../services/safety.js';
import { send } from '../services/notify.js';

const needReady = async () => { if (!(await safetyReady())) throw new ApiError(503, 'migration_pending', `${safetyPending}.`); };
const isOps = (role: string) => role === 'admin' || role === 'dispatcher';
const LIVE = ['accepted', 'arrived', 'in_progress'];
const uuid = z.string().uuid();
const idParam = (req: FastifyRequest) => parse(z.object({ id: uuid }), req.params).id;

/** Hold the subject of a critical report (unless they're on a live trip: then ops are told to do it after). */
async function holdForReport(report: any, subjectId: string) {
  const live = await one(`SELECT ref FROM trips WHERE (driver_id = $1 OR rider_id = $1) AND status IN ('accepted','arrived','in_progress') LIMIT 1`, [subjectId]);
  if (live) { toOps('incident.hold_deferred', { incident_id: report.id, ref: report.ref, subject_id: subjectId, trip_ref: live.ref }); return false; }
  const staff = await one(`SELECT role FROM users WHERE id = $1`, [subjectId]);
  if (!staff || isOps(staff.role)) return false;
  await restrictAccount(subjectId, { action: 'suspend', reason_code: 'under_review', incident_id: report.id, note: `Automatic hold: ${report.ref}` }, null);
  await q(`UPDATE incident_reports SET held = true, status = 'investigating' WHERE id = $1`, [report.id]);
  return true;
}

export default async function safetyRoutes(app: FastifyInstance) {
  // ───────────── Trusted contacts and trip sharing ─────────────
  app.get('/me/safety', async (req) => {
    const me = await requireUser(req);
    if (!(await safetyReady())) return { ready: false, trusted_contacts: [], auto_share: 'off', night: null, numbers: SAFETY_NUMBERS };
    const u = await one(`SELECT trusted_contacts, auto_share FROM users WHERE id = $1`, [me.id]);
    const p = await loadSafetyPolicy();
    return { ready: true, trusted_contacts: u?.trusted_contacts ?? [], auto_share: u?.auto_share ?? 'off', night: p.night, numbers: SAFETY_NUMBERS };
  });

  app.put('/me/safety', async (req) => {
    const me = await requireUser(req);
    await needReady();
    const b = parse(z.object({
      trusted_contacts: z.array(z.object({ name: z.string().trim().min(1).max(60), phone })).max(MAX_TRUSTED_CONTACTS).optional(),
      auto_share: z.enum(AUTO_SHARE).optional(),
    }), req.body);
    const own = (await one(`SELECT phone FROM users WHERE id = $1`, [me.id]))?.phone;
    if (b.trusted_contacts?.some((c) => c.phone === own)) throw bad('validation_error', 'Add someone else\'s number, not your own');
    if (b.trusted_contacts && new Set(b.trusted_contacts.map((c) => c.phone)).size !== b.trusted_contacts.length) throw bad('validation_error', 'Each contact needs a different number');
    const u = await one(
      `UPDATE users SET trusted_contacts = coalesce($2::jsonb, trusted_contacts), auto_share = coalesce($3, auto_share) WHERE id = $1
       RETURNING trusted_contacts, auto_share`,
      [me.id, b.trusted_contacts ? JSON.stringify(b.trusted_contacts) : null, b.auto_share ?? null]);
    if (u.auto_share !== 'off' && !u.trusted_contacts.length) return { ...u, warning: 'Add a trusted contact so we have someone to share your trips with.' };
    return u;
  });

  /** "Share with my contacts" during a ride: texts each trusted contact the live trip link. At most 3 times per trip. */
  app.post('/trips/:id/share-contacts', async (req) => {
    const me = await requireUser(req);
    await needReady();
    const t = await one(`SELECT id, rider_id, status, kind FROM trips WHERE id = $1`, [idParam(req)]);
    if (!t || t.rider_id !== me.id) throw notFound('Trip');
    if (!LIVE.includes(t.status)) throw conflict('bad_state', 'You can share a trip once a driver is on the way');
    const n = (await one<{ n: number }>(`SELECT count(*)::int n FROM trip_events WHERE trip_id = $1 AND type = 'shared_with_contacts' AND NOT coalesce((data->>'auto')::boolean, false)`, [t.id]))!.n;
    if (n >= 3) throw new ApiError(429, 'share_limit', 'Your contacts already have the link for this trip');
    const sent = await shareWithContacts(t.id, { auto: false, actorId: me.id });
    if (!sent) throw bad('no_contacts', 'Add a trusted contact first (Account, Safety)');
    return { sent };
  });

  // ───────────── Check-ins ─────────────
  app.get('/safety/checks', async (req) => {
    const me = await requireUser(req);
    if (!(await safetyReady())) return { checks: [] };
    const { trip_id } = parse(z.object({ trip_id: uuid.optional() }), req.query);
    const p = await loadSafetyPolicy();
    const checks = await q(
      `SELECT id, trip_id, reason, status, created_at FROM safety_checks WHERE user_id = $1 AND status = 'pending' ${trip_id ? 'AND trip_id = $2' : ''}
       ORDER BY created_at DESC LIMIT 5`, trip_id ? [me.id, trip_id] : [me.id]);
    return { checks: checks.map((c) => ({ ...c, answer_by: new Date(new Date(c.created_at).getTime() + p.check_ins.answer_min * 60e3).toISOString() })) };
  });

  app.post('/safety/checks/:id', async (req) => {
    const me = await requireUser(req);
    await needReady();
    const b = parse(z.object({ answer: z.enum(['ok', 'help']) }), req.body);
    return answerCheck(me.id, idParam(req), b.answer);
  });

  // ───────────── Emergency card ─────────────
  app.get('/safety/emergency-card', async (req) => {
    const me = await requireUser(req);
    const p = parse(z.object({ lat: z.coerce.number().min(-90).max(90).optional(), lng: z.coerce.number().min(-180).max(180).optional(), trip_id: uuid.optional() }), req.query);
    return emergencyCard(me, p, p.trip_id);
  });

  // ───────────── Safety reports ─────────────
  app.get('/safety/report-categories', async () => ({
    categories: Object.entries(INCIDENT_CATEGORIES).map(([key, v]) => ({ key, label: v.label, severity: v.severity })),
    numbers: SAFETY_NUMBERS,
  }));

  app.post('/safety/reports', async (req, reply) => {
    const me = await requireUser(req);
    await needReady();
    const b = parse(z.object({
      trip_id: uuid.optional(),
      category: z.enum(Object.keys(INCIDENT_CATEGORIES) as [IncidentCategory, ...IncidentCategory[]]),
      description: z.string().trim().min(10, 'Tell us a little more (at least 10 characters)').max(2000),
      evidence: z.array(z.string().max(300)).max(4).optional(),
    }), req.body);
    await limit('incident_report', me.id, 10, 86400, 'You have sent a lot of reports today. Call DingoGo if you need help now.');
    let trip: any = null, role = me.role === 'driver' ? 'driver' : 'rider', subject: string | null = null;
    if (b.trip_id) {
      trip = await one(`SELECT id, ref, rider_id, driver_id, status, arrived_at, started_at, completed_at, cancelled_at FROM trips WHERE id = $1`, [b.trip_id]);
      if (!trip || (trip.rider_id !== me.id && trip.driver_id !== me.id)) throw notFound('Trip');
      role = trip.driver_id === me.id ? 'driver' : 'rider';
      subject = role === 'driver' ? trip.rider_id : trip.driver_id;
    }
    const evidence: { file_url: string }[] = [];
    for (const ref of b.evidence ?? []) evidence.push({ file_url: await ownUpload(ref, me.id, 'evidence') });
    const severity = INCIDENT_CATEGORIES[b.category].severity;
    const report = await one(
      `INSERT INTO incident_reports (ref, reporter_id, reporter_role, trip_id, subject_id, category, severity, description, evidence)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, ref, category, severity, status, created_at`,
      [incidentRef(), me.id, role, trip?.id ?? null, subject, b.category, severity, b.description, JSON.stringify(evidence)]);
    if (trip) await q(`INSERT INTO trip_events (trip_id, type, actor_id, data) VALUES ($1,'incident_reported',$2,$3)`, [trip.id, me.id, { incident_id: report.id, category: b.category }]);
    let held = false; let hold_skipped: string | null = null;
    if (severity === 'critical' && subject && (await loadSafetyPolicy()).incidents.auto_hold_critical) {
      // Round 26: a made-up report must not be a way to take a driver (or rider) off the road. Holds only for a real, recent trip,
      // and one per reporter a month; the rest wait for a person (still critical, top of the queue).
      const mine = (await one<{ n: number }>(`SELECT count(*)::int n FROM incident_reports WHERE reporter_id = $1 AND held AND created_at > now() - interval '30 days'`, [me.id]))!.n;
      hold_skipped = autoHoldBlocker(trip, mine);
      if (!hold_skipped) held = await holdForReport(report, subject);
    }
    toOps('incident.new', { id: report.id, ref: report.ref, category: b.category, severity, trip_ref: trip?.ref ?? null, held, hold_skipped });
    if (hold_skipped) await q(`INSERT INTO trip_events (trip_id, type, actor_id, data) VALUES ($1,'incident_hold_skipped',NULL,$2)`, [trip.id, { incident_id: report.id, reason: hold_skipped }]);
    void send(me.id, 'incident_received', { ref: report.ref, critical: severity === 'critical' }, { data: { incident_id: report.id } });
    reply.code(201);
    const numbers = ['sexual_misconduct', 'physical_assault', 'threats_abuse', 'contact_after_trip'].includes(b.category) ? SAFETY_NUMBERS : SAFETY_NUMBERS.slice(0, 2);
    return { report: { ...report, label: INCIDENT_CATEGORIES[b.category].label }, numbers };
  });

  app.get('/safety/reports', async (req) => {
    const me = await requireUser(req);
    if (!(await safetyReady())) return { reports: [] };
    const rows = await q(
      `SELECT r.id, r.ref, r.category, r.status, r.outcome, r.created_at, r.updated_at, t.ref AS trip_ref FROM incident_reports r
       LEFT JOIN trips t ON t.id = r.trip_id WHERE r.reporter_id = $1 ORDER BY r.created_at DESC LIMIT 50`, [me.id]);
    return { reports: rows.map((r) => ({ ...r, label: (INCIDENT_CATEGORIES as any)[r.category]?.label ?? r.category })) };
  });

  // ───────────── Driver: photo check and fatigue ─────────────
  app.get('/driver/safety', async (req) => {
    const me = await requireUser(req, 'driver');
    if (!(await safetyReady())) return { ready: false, fatigue: null, identity: { mode: 'off', due: false, last: null } };
    const p = await loadSafetyPolicy();
    return { ready: true, fatigue: await driverFatigue(me.id, p), identity: await identityStatus(me.id, p), policy: { fatigue: p.fatigue } };
  });

  app.post('/driver/identity-check', async (req, reply) => {
    const me = await requireUser(req, 'driver');
    await needReady();
    const b = parse(z.object({ photo_url: z.string().max(300) }), req.body);
    const ref = await ownUpload(b.photo_url, me.id, 'selfie');
    const f = await one(`SELECT mime, created_at FROM uploads WHERE name = $1`, [ref.slice('/uploads/'.length)]);
    if (!f?.mime?.startsWith('image/')) throw bad('bad_file', 'Take a photo (not a PDF)');
    // A fresh photo: taken in the last 10 minutes, so an old picture can't be reused.
    if (Date.now() - new Date(f.created_at).getTime() > 10 * 60_000) throw bad('photo_too_old', 'Take a new photo now');
    if (await one(`SELECT 1 FROM identity_checks WHERE photo_url = $1`, [ref])) throw conflict('photo_used', 'Take a new photo now');
    reply.code(201);
    return { check: await submitIdentityCheck(me.id, ref) };
  });

  // ───────────── Appeals (restricted accounts, with the appeal token from sign-in) ─────────────
  const appealUser = (req: FastifyRequest) => {
    const h = req.headers.authorization;
    const id = h?.startsWith('Bearer ') ? verifyAppealToken(h.slice(7)) : null;
    if (!id) throw unauthorised('Sign in again to see your account');
    return id;
  };
  app.get('/appeal', async (req) => {
    const userId = appealUser(req);
    await needReady();
    const r = await currentRestriction(userId);
    const appeal = await one(`SELECT id, status, message, decision_note, created_at, decided_at FROM appeals WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`, [userId]);
    return { restriction: r ? { kind: r.action, reason: r.public_reason, until: r.until, since: r.created_at } : null, appeal };
  });
  app.post('/appeal', async (req, reply) => {
    const userId = appealUser(req);
    await needReady();
    const b = parse(z.object({ message: z.string().trim().min(20, 'Tell us what happened (at least 20 characters)').max(1500) }), req.body);
    const r = await currentRestriction(userId);
    if (!r) throw conflict('not_restricted', 'Your account isn\'t restricted. Sign in again.');
    const last = await one(`SELECT status FROM appeals WHERE user_id = $1 AND action_id = $2 ORDER BY created_at DESC LIMIT 1`, [userId, r.id]);
    if (last?.status === 'pending') throw conflict('appeal_pending', 'We already have your appeal and will be in touch');
    if (last?.status === 'upheld') throw conflict('appeal_decided', 'We have already looked at an appeal for this decision');
    const a = await one(`INSERT INTO appeals (user_id, action_id, message) VALUES ($1,$2,$3) RETURNING id, status, created_at`, [userId, r.id, b.message]);
    toOps('appeal.new', { id: a.id, user_id: userId });
    reply.code(201);
    return { appeal: a };
  });

  // ───────────── Admin ─────────────
  app.get('/admin/safety/overview', async (req) => {
    await requireUser(req, 'admin', 'dispatcher');
    if (!(await safetyReady())) return { ready: false };
    const c = await one(
      `SELECT (SELECT count(*)::int FROM safety_checks WHERE status IN ('pending','escalated','help') AND created_at > now() - interval '24 hours') checks,
              (SELECT count(*)::int FROM identity_checks WHERE status = 'pending') photo_checks,
              (SELECT count(*)::int FROM incident_reports WHERE status IN ('open','investigating')) incidents,
              (SELECT count(*)::int FROM incident_reports WHERE status IN ('open','investigating') AND severity = 'critical') critical,
              (SELECT count(*)::int FROM appeals WHERE status = 'pending') appeals`);
    return { ready: true, ...c };
  });

  app.get('/admin/safety/policy', async (req) => {
    await requireUser(req, 'admin', 'dispatcher');
    return { policy: await loadSafetyPolicy(), ready: await safetyReady(), reasons: RESTRICT_REASONS, categories: INCIDENT_CATEGORIES };
  });
  app.put('/admin/safety/policy', async (req) => {
    const me = await requireUser(req, 'admin');
    const policy = checkSafetyPolicy(req.body);
    await q(`INSERT INTO settings (key, value) VALUES ('safety_policy', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(policy)]);
    await audit(me.id, 'safety_policy_updated', 'settings', 'safety_policy', policy);
    return { policy };
  });

  app.get('/admin/safety/checks', async (req) => {
    await requireUser(req, 'admin', 'dispatcher');
    if (!(await safetyReady())) return { ready: false, items: [] };
    return { ready: true, items: await q(
      `SELECT s.*, t.ref AS trip_ref, u.name AS rider_name FROM safety_checks s JOIN trips t ON t.id = s.trip_id JOIN users u ON u.id = s.user_id
       WHERE s.created_at > now() - interval '7 days' ORDER BY s.created_at DESC LIMIT 100`) };
  });
  /** Ops ask the rider "Are you OK?" (e.g. after a call from a worried family member). */
  app.post('/admin/trips/:id/check-in', async (req) => {
    const me = await requireUser(req, 'admin', 'dispatcher');
    await needReady();
    const t = await one(`SELECT id, ref, rider_id, status FROM trips WHERE id = $1`, [idParam(req)]);
    if (!t) throw notFound('Trip');
    if (!LIVE.includes(t.status)) throw conflict('bad_state', 'The trip isn\'t live');
    const c = await createCheck(t, 'ops', undefined, me.id);
    if (!c) throw conflict('check_pending', 'A check-in is already waiting for an answer');
    await audit(me.id, 'check_in_sent', 'trip', t.id, { check_id: c.id });
    return { check: c };
  });

  app.get('/admin/safety/fatigue', async (req) => {
    await requireUser(req, 'admin', 'dispatcher');
    if (!(await safetyReady())) return { ready: false, items: [] };
    const p = await loadSafetyPolicy();
    const rows = await q(
      `SELECT d.user_id, u.name, d.online, s.started_at, s.ended_at FROM drivers d JOIN users u ON u.id = d.user_id
       JOIN driver_online_sessions s ON s.driver_id = d.user_id WHERE coalesce(s.ended_at, now()) > now() - interval '48 hours' ORDER BY s.started_at`);
    const by = new Map<string, { name: string; online: boolean; ss: any[] }>();
    for (const r of rows) { if (!by.has(r.user_id)) by.set(r.user_id, { name: r.name, online: r.online, ss: [] }); by.get(r.user_id)!.ss.push(r); }
    const items = [...by.entries()].map(([id, v]) => ({ driver_id: id, name: v.name, online: v.online, ...fatigueStatus(v.ss, p.fatigue) }))
      .filter((x) => x.online || x.rest_until).sort((a, b) => b.online_min_24h - a.online_min_24h);
    return { ready: true, policy: p.fatigue, items };
  });

  app.get('/admin/identity-checks', async (req) => {
    await requireUser(req, 'admin', 'dispatcher');
    if (!(await safetyReady())) return { ready: false, items: [] };
    const { status } = parse(z.object({ status: z.enum(['pending', 'approved', 'rejected', 'all']).default('pending') }), req.query);
    const items = await q(
      `SELECT c.id, c.driver_id, c.photo_url, c.method, c.status, c.match_score, c.note, c.created_at, c.reviewed_at, u.name AS driver_name,
              (SELECT photo_url FROM identity_checks p WHERE p.driver_id = c.driver_id AND p.status = 'approved' AND p.id <> c.id ORDER BY created_at DESC LIMIT 1) AS reference_url,
              (SELECT file_url FROM driver_documents dd WHERE dd.driver_id = c.driver_id AND dd.type = 'licence' AND dd.file_url IS NOT NULL ORDER BY created_at DESC LIMIT 1) AS licence_url
       FROM identity_checks c JOIN users u ON u.id = c.driver_id ${status === 'all' ? '' : 'WHERE c.status = $1'} ORDER BY c.created_at ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 100`,
      status === 'all' ? [] : [status]);
    return { ready: true, items };
  });
  app.patch('/admin/identity-checks/:id', async (req) => {
    const me = await requireUser(req, 'admin', 'dispatcher');
    await needReady();
    const b = parse(z.object({ status: z.enum(['approved', 'rejected']), note: z.string().trim().max(300).optional() }), req.body);
    if (b.status === 'rejected' && !b.note) throw bad('validation_error', 'Say why the photo wasn\'t accepted');
    const c = await reviewIdentityCheck(idParam(req), me.id, b.status, b.note ?? null);
    await audit(me.id, 'identity_check_reviewed', 'driver', c.driver_id, { check_id: c.id, status: b.status, note: b.note ?? null });
    return { check: c };
  });

  app.get('/admin/incidents', async (req) => {
    await requireUser(req, 'admin', 'dispatcher');
    if (!(await safetyReady())) return { ready: false, items: [] };
    const p = parse(z.object({ status: z.enum([...INCIDENT_STATUSES, 'active', 'all']).default('active'), severity: z.enum(['critical', 'high', 'normal']).optional() }), req.query);
    const where: string[] = []; const vals: unknown[] = [];
    if (p.status === 'active') where.push(`r.status IN ('open','investigating')`);
    else if (p.status !== 'all') { vals.push(p.status); where.push(`r.status = $${vals.length}`); }
    if (p.severity) { vals.push(p.severity); where.push(`r.severity = $${vals.length}`); }
    const items = await q(
      `SELECT r.id, r.ref, r.category, r.severity, r.status, r.reporter_role, r.held, r.created_at, r.updated_at, t.ref AS trip_ref,
              ru.name AS reporter_name, su.name AS subject_name, r.subject_id
       FROM incident_reports r JOIN users ru ON ru.id = r.reporter_id LEFT JOIN users su ON su.id = r.subject_id LEFT JOIN trips t ON t.id = r.trip_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY CASE r.severity WHEN 'critical' THEN 0 WHEN 'high' THEN 1 ELSE 2 END, r.created_at DESC LIMIT 200`, vals);
    return { ready: true, items: items.map((r) => ({ ...r, label: (INCIDENT_CATEGORIES as any)[r.category]?.label ?? r.category })) };
  });
  app.get('/admin/incidents/:id', async (req) => {
    await requireUser(req, 'admin', 'dispatcher');
    await needReady();
    const id = idParam(req);
    const r = await one(
      `SELECT r.*, t.ref AS trip_ref, t.pickup_address, t.dropoff_address, t.share_token, ru.name AS reporter_name, ru.phone AS reporter_phone,
              su.name AS subject_name, su.phone AS subject_phone, su.role AS subject_role, su.blocked AS subject_blocked
       FROM incident_reports r JOIN users ru ON ru.id = r.reporter_id LEFT JOIN users su ON su.id = r.subject_id LEFT JOIN trips t ON t.id = r.trip_id WHERE r.id = $1`, [id]);
    if (!r) throw notFound('Report');
    const [notes, about] = await Promise.all([
      q(`SELECT a.at, a.action, a.data, u.name AS actor_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id WHERE a.entity = 'incident' AND a.entity_id = $1 ORDER BY a.at`, [id]),
      r.subject_id ? q(`SELECT id, ref, category, severity, status, created_at FROM incident_reports WHERE subject_id = $1 AND id <> $2 ORDER BY created_at DESC LIMIT 20`, [r.subject_id, id]) : [],
    ]);
    return { report: { ...r, label: (INCIDENT_CATEGORIES as any)[r.category]?.label ?? r.category }, notes, other_reports_about_subject: about };
  });
  app.patch('/admin/incidents/:id', async (req) => {
    const me = await requireUser(req, 'admin', 'dispatcher');
    await needReady();
    const id = idParam(req);
    const b = parse(z.object({ status: z.enum(INCIDENT_STATUSES).optional(), outcome: z.string().trim().max(500).optional(), note: z.string().trim().max(2000).optional() }), req.body);
    const cur = await one(`SELECT * FROM incident_reports WHERE id = $1`, [id]);
    if (!cur) throw notFound('Report');
    const r = await one(
      `UPDATE incident_reports SET status = coalesce($2, status), outcome = coalesce($3, outcome), handled_by = $4, updated_at = now() WHERE id = $1 RETURNING *`,
      [id, b.status ?? null, b.outcome ?? null, me.id]);
    if (b.status && b.status !== cur.status) await audit(me.id, 'incident_status', 'incident', id, { from: cur.status, to: b.status, outcome: b.outcome ?? null });
    if (b.note) await audit(me.id, 'incident_note', 'incident', id, { text: b.note });
    if (b.status && b.status !== cur.status && (b.status === 'actioned' || b.status === 'closed') && !['actioned', 'closed'].includes(cur.status)) {
      void send(cur.reporter_id, 'incident_update', { ref: cur.ref, outcome: r.outcome }, { data: { incident_id: id } });
    }
    return { report: r };
  });

  // Account standing: suspend, ban, warn, lift; appeals.
  app.get('/admin/users/:id/standing', async (req) => {
    await requireUser(req, 'admin', 'dispatcher');
    const id = idParam(req);
    const u = await one(`SELECT id, name, role, blocked FROM users WHERE id = $1`, [id]);
    if (!u) throw notFound('User');
    if (!(await safetyReady())) return { ready: false, user: u, actions: [], appeals: [], reports_about: [] };
    const [actions, appeals, reports] = await Promise.all([
      q(`SELECT a.*, s.name AS by_name, r.ref AS incident_ref FROM account_actions a LEFT JOIN users s ON s.id = a.by_id LEFT JOIN incident_reports r ON r.id = a.incident_id
         WHERE a.user_id = $1 ORDER BY a.created_at DESC LIMIT 50`, [id]),
      q(`SELECT * FROM appeals WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`, [id]),
      q(`SELECT id, ref, category, severity, status, created_at FROM incident_reports WHERE subject_id = $1 ORDER BY created_at DESC LIMIT 20`, [id]),
    ]);
    return { ready: true, user: u, restriction: u.blocked ? await currentRestriction(id) : null, actions, appeals, reports_about: reports, reasons: RESTRICT_REASONS };
  });
  app.post('/admin/users/:id/restrict', async (req) => {
    const me = await requireUser(req, 'admin');
    await needReady();
    const id = idParam(req);
    const b = parse(z.object({
      action: z.enum(['suspend', 'ban', 'warning']),
      reason_code: z.enum(Object.keys(RESTRICT_REASONS) as [RestrictReason, ...RestrictReason[]]),
      public_reason: z.string().trim().max(300).optional(), note: z.string().trim().max(1000).optional(),
      until: z.string().datetime({ offset: true }).optional(), incident_id: uuid.optional(),
    }), req.body);
    if (id === me.id) throw forbidden('You can\'t restrict your own account');
    const u = await one(`SELECT role, blocked FROM users WHERE id = $1 AND deleted_at IS NULL`, [id]);
    if (!u) throw notFound('User');
    if (b.until && (b.action !== 'suspend' || Date.parse(b.until) <= Date.now())) throw bad('validation_error', 'An end date is for suspensions, and must be in the future');
    if (b.action !== 'warning' && u.blocked) throw conflict('already_restricted', 'This account is already suspended or banned. Lift it first to change the decision.');
    const a = await restrictAccount(id, b, me.id);
    await audit(me.id, `account_${b.action}`, 'user', id, { reason_code: b.reason_code, until: b.until ?? null, incident_id: b.incident_id ?? null });
    return { action: a };
  });
  app.post('/admin/users/:id/lift', async (req) => {
    const me = await requireUser(req, 'admin');
    await needReady();
    const id = idParam(req);
    const b = parse(z.object({ note: z.string().trim().max(1000).optional() }), req.body);
    const a = await liftAccount(id, me.id, b.note ?? null);
    if (!a) throw conflict('not_restricted', 'This account isn\'t suspended or banned');
    await q(`UPDATE appeals SET status = 'overturned', decided_by = $2, decided_at = now(), decision_note = $3 WHERE user_id = $1 AND status = 'pending'`, [id, me.id, b.note ?? 'Account restored']);
    await audit(me.id, 'account_lift', 'user', id, { note: b.note ?? null });
    return { action: a };
  });

  app.get('/admin/appeals', async (req) => {
    await requireUser(req, 'admin', 'dispatcher');
    if (!(await safetyReady())) return { ready: false, items: [] };
    const { status } = parse(z.object({ status: z.enum(['pending', 'upheld', 'overturned', 'all']).default('pending') }), req.query);
    return { ready: true, items: await q(
      `SELECT ap.*, u.name AS user_name, u.role AS user_role, a.action AS restriction, a.reason_code, a.public_reason, a.note AS restriction_note, a.created_at AS restricted_at,
              r.ref AS incident_ref
       FROM appeals ap JOIN users u ON u.id = ap.user_id LEFT JOIN account_actions a ON a.id = ap.action_id LEFT JOIN incident_reports r ON r.id = a.incident_id
       ${status === 'all' ? '' : 'WHERE ap.status = $1'} ORDER BY ap.created_at ${status === 'pending' ? 'ASC' : 'DESC'} LIMIT 100`, status === 'all' ? [] : [status]) };
  });
  app.patch('/admin/appeals/:id', async (req) => {
    const me = await requireUser(req, 'admin');
    await needReady();
    const id = idParam(req);
    const b = parse(z.object({ decision: z.enum(['upheld', 'overturned']), note: z.string().trim().max(1000).optional() }), req.body);
    const ap = await one(`UPDATE appeals SET status = $2, decision_note = $3, decided_by = $4, decided_at = now() WHERE id = $1 AND status = 'pending' RETURNING *`,
      [id, b.decision, b.note ?? null, me.id]);
    if (!ap) throw conflict('appeal_decided', 'This appeal has already been decided');
    if (b.decision === 'overturned') await liftAccount(ap.user_id, me.id, `Appeal accepted${b.note ? `: ${b.note}` : ''}`, { silent: true });
    const u = await one(`SELECT phone FROM users WHERE id = $1`, [ap.user_id]);
    if (u?.phone) {
      const { sendSmsT } = await import('../services/notify.js');
      void sendSmsT(u.phone, 'appeal_decided', { overturned: b.decision === 'overturned', note: b.note ?? null }, { userId: ap.user_id });
    }
    await audit(me.id, 'appeal_decided', 'user', ap.user_id, { appeal_id: id, decision: b.decision, note: b.note ?? null });
    return { appeal: ap };
  });
}
