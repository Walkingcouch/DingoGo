import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { one, q, tx } from '../db.js';
import { requireUser, signAppealToken, signToken } from '../auth.js';
import { currentRestriction, liftIfEnded } from '../services/safety.js';
import { safetyReady } from '../lib/safety.js';
import { bad, ApiError } from '../lib/errors.js';
import { referralCode, sha256 } from '../lib/ids.js';
import { parse, phone, z } from '../lib/validate.js';
import { limit, record, tooMany } from '../lib/rateLimit.js';
import { disconnectUser } from '../realtime.js';
import { sendSmsT } from '../services/notify.js';
import { withdrawOffers } from '../services/trips.js';
import { loadRecipient, setMarketing } from '../services/prefs.js';
import { CONCESSION_TYPES, LANGS, communityPending, communityReady, loadCommunityPricing, localDate, normaliseLang, type ConcessionType } from '../lib/community.js';
import { audit } from '../lib/audit.js';
import { recordPrivacyRequest, retainDriverTaxIdentity } from '../services/tax.js';
import { logError } from '../lib/log.js';

/** Compare two hex hashes in constant time. */
function sameHash(a: string, b: string) {
  const x = Buffer.from(a, 'hex'); const y = Buffer.from(b, 'hex');
  return x.length === y.length && x.length > 0 && crypto.timingSafeEqual(x, y);
}
const OTP_MAX_TRIES = 5;

const publicUser = (u: any) => ({
  id: u.id, phone: u.phone, email: u.email, name: u.name, role: u.role, language: normaliseLang(u.language),
  accessibility: u.accessibility, emergency_contact: u.emergency_contact, referral_code: u.referral_code,
  loyalty_points: u.loyalty_points, wallet_cents: u.wallet_cents, marketing_opt_in: u.marketing_opt_in,
  rating_avg: u.rating_avg, partner_id: u.partner_id, created_at: u.created_at, concession: u.concession ?? null,
  trusted_contacts: u.trusted_contacts ?? [], auto_share: u.auto_share ?? 'off',
});

// Demo sign-in only for the exact seeded demo numbers, and only when demo mode is switched on (OTP_DEMO_PREFIXES set).
const demoModeOn = () => config.otpDevMode || config.otpDemoPrefixes.length > 0;
const isSeededDemo = (p: string) => config.otpDemoPrefixes.length > 0 && config.otpDemoNumbers.includes(p);
/** Seeded demo numbers, plus any account an admin created as a test account. */
async function isDemoPhone(p: string) {
  if (isSeededDemo(p)) return true;
  if (!demoModeOn()) return false;
  const u = await one('SELECT 1 FROM users WHERE phone = $1 AND test_account AND deleted_at IS NULL', [p]);
  return !!u;
}

/** Admin or dispatcher account in good standing (Round 29: may sign in with the code from the server log before SMS is set up). */
async function isStaffPhone(p: string) {
  return !!(await one(`SELECT 1 FROM users WHERE phone = $1 AND role IN ('admin','dispatcher') AND deleted_at IS NULL AND NOT blocked`, [p]));
}

export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/otp/request', async (req) => {
    const body = parse(z.object({ phone }), req.body);
    // Per IP as well as per number: one sender can't pump SMS to many numbers.
    await limit('otp_request_ip', req.ip, config.rateLimits.otpRequestPerIp, 3600, 'Too many sign-in codes from this connection. Try again in an hour.');
    // Rate limits (stop SMS pumping & harassment): 1 request / 30 s and 5 / hour per number.
    const recent = await one(`SELECT count(*)::int n, max(at) last FROM otp_requests WHERE phone = $1 AND at > now() - interval '1 hour'`, [body.phone]);
    if (recent && recent.last && Date.now() - new Date(recent.last).getTime() < 30_000) throw new ApiError(429, 'otp_too_soon', 'Please wait 30 seconds before asking for another code');
    if (recent && recent.n >= 5) throw new ApiError(429, 'otp_limit', 'Too many codes requested. Try again in an hour.');
    await q('INSERT INTO otp_requests (phone, ip) VALUES ($1, $2)', [body.phone, req.ip ?? null]);
    const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
    await q(
      `INSERT INTO otp_codes (phone, code_hash, expires_at, attempts) VALUES ($1, $2, now() + interval '10 minutes', 0)
       ON CONFLICT (phone) DO UPDATE SET code_hash = $2, expires_at = now() + interval '10 minutes', attempts = 0`,
      [body.phone, sha256(code)]);
    const demo = await isDemoPhone(body.phone);
    const staff = await isStaffPhone(body.phone);
    const sent = await sendSmsT(body.phone, 'otp', { code }, { logCodes: staff });
    // Round 29: before Twilio is set up (a brand-new deploy), staff can still sign in: the code is written to the server log
    // (`[sms:dev]`), which only people with access to the hosting account can read. Everyone else waits for SMS.
    const staffFromLog = !sent.sent && sent.status === 'dev_log' && process.env.LOG_SMS !== 'false' && staff;
    if (!sent.sent && !config.otpDevMode && !demo && !staffFromLog) {
      throw new ApiError(503, 'sms_unavailable', 'Sign-in by text message isn’t switched on yet. Please try again later.');
    }
    return { ok: true, phone: body.phone, ...(config.otpDevMode ? { dev_code: code } : {}), ...(demo ? { demo: true } : {}), ...(staffFromLog && !config.otpDevMode ? { code_in_log: true } : {}) };
  });

  app.post('/auth/otp/verify', async (req) => {
    const body = parse(z.object({
      phone, code: z.string().regex(/^\d{6}$/), name: z.string().max(80).optional(),
      referral_code: z.string().max(20).optional(), app: z.enum(['rider', 'driver', 'admin', 'partner', 'account']).default('rider'),
    }), req.body);

    if (await tooMany('otp_verify_fail_ip', req.ip, config.rateLimits.otpVerifyFailPerIp, 3600)) {
      throw new ApiError(429, 'too_many_attempts', 'Too many wrong codes from this connection. Try again in an hour.');
    }
    const devBypass = body.code === '000000' && (config.otpDevMode || await isDemoPhone(body.phone));
    if (devBypass) {
      await q('DELETE FROM otp_codes WHERE phone = $1', [body.phone]);
    } else {
      // Count the try before comparing, in one statement, so guesses sent at the same time can't get past the limit.
      const otp = await one<{ code_hash: string; attempts: number }>(
        `UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = $1 AND expires_at > now() RETURNING code_hash, attempts`, [body.phone]);
      if (!otp) throw bad('otp_expired', 'Code expired — request a new one');
      if (otp.attempts > OTP_MAX_TRIES) throw new ApiError(429, 'otp_locked', 'Too many attempts — request a new code');
      if (!sameHash(otp.code_hash, sha256(body.code))) {
        await record('otp_verify_fail_ip', req.ip);
        throw bad('otp_invalid', 'Incorrect code');
      }
      // Single use: only one of two simultaneous correct requests gets the code.
      const used = await one('DELETE FROM otp_codes WHERE phone = $1 AND code_hash = $2 RETURNING 1', [body.phone, otp.code_hash]);
      if (!used) throw bad('otp_expired', 'Code expired — request a new one');
    }

    const user = await tx(async (c) => {
      let u = await one('SELECT * FROM users WHERE phone = $1 AND deleted_at IS NULL', [body.phone], c);
      let isNew = false;
      // Round 21: the website's account page (delete my account) signs in existing accounts only: it never creates one.
      if (!u && body.app === 'account') throw new ApiError(404, 'no_account', 'There’s no DingoGo account for this number.');
      if (!u) {
        isNew = true;
        const name = body.name?.trim() || '';
        u = await one(
          `INSERT INTO users (phone, name, role, referral_code) VALUES ($1, $2, $3, $4) RETURNING *`,
          [body.phone, name, body.app === 'driver' ? 'driver' : 'rider', referralCode(name)], c);
        if (body.referral_code) {
          const referrer = await one('SELECT id FROM users WHERE upper(referral_code) = upper($1)', [body.referral_code], c);
          if (referrer && referrer.id !== u.id) {
            await c.query('UPDATE users SET referred_by = $2 WHERE id = $1', [u.id, referrer.id]);
            await c.query('INSERT INTO referrals (referee_id, referrer_id) VALUES ($1, $2)', [u.id, referrer.id]);
          }
        }
      }
      // A rider signing in to the driver app becomes a driver applicant (keeps their rider history).
      if (body.app === 'driver') {
        if (u.role === 'rider') u = await one(`UPDATE users SET role = 'driver' WHERE id = $1 RETURNING *`, [u.id], c);
        await c.query(`INSERT INTO drivers (user_id) VALUES ($1) ON CONFLICT DO NOTHING`, [u.id]);
      }
      if (body.app === 'admin' && !['admin', 'dispatcher'].includes(u.role)) throw new ApiError(403, 'forbidden', 'This account does not have admin access');
      if (body.app === 'partner' && u.role !== 'partner' && u.role !== 'admin') throw new ApiError(403, 'forbidden', 'This account is not linked to a partner business');
      return { ...u, isNew };
    });
    // Suspended or banned: no sign-in. They see why, and get a short token that can only ask us to look again (/appeal).
    if (user.blocked && !(await liftIfEnded(user.id))) {
      const r = await currentRestriction(user.id);
      throw new ApiError(403, 'account_restricted', r?.public_reason ?? 'This account is on hold. Please call DingoGo.', {
        kind: r?.action ?? 'ban', reason: r?.public_reason ?? null, until: r?.until ?? null,
        appeal_token: (await safetyReady()) ? signAppealToken(user.id) : null,
      });
    }
    return { token: signToken(user), user: publicUser(user), is_new: user.isNew };
  });

  app.get('/me', async (req) => {
    const me = await requireUser(req);
    const u = await one('SELECT * FROM users WHERE id = $1', [me.id]);
    const sub = await one(
      `SELECT s.*, p.name AS plan_name, p.ride_discount_pct, p.free_deliveries, p.waive_booking_fee FROM subscriptions s JOIN plans p ON p.code = s.plan_code
       WHERE s.user_id = $1 AND s.status = 'active' AND s.period_end > now()`, [me.id]);
    const corporate = await q(
      `SELECT a.id, a.name, a.kind, m.role FROM corporate_members m JOIN corporate_accounts a ON a.id = m.account_id WHERE m.user_id = $1 AND a.active`, [me.id]);
    return { user: publicUser(u), subscription: sub, corporate_accounts: corporate };
  });

  app.patch('/me', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({
      name: z.string().min(1).max(80).optional(),
      email: z.string().email().optional().or(z.literal('')),
      // English, Arrernte (aer) or Kriol (rop); "arr" from older apps means Arrernte.
      language: z.enum([...LANGS, 'arr']).transform((l) => normaliseLang(l)).optional(),
      accessibility: z.record(z.string().max(40), z.any()).refine((v) => JSON.stringify(v).length <= 2000, 'too much detail').optional(),
      emergency_contact: z.object({ name: z.string().max(80), phone: z.string().max(20) }).nullable().optional(),
      marketing_opt_in: z.boolean().optional(),
    }), req.body);
    const { marketing_opt_in, ...rest } = b;
    // Marketing consent is recorded (Spam Act) with the wording shown, only when it changes.
    if (marketing_opt_in !== undefined) await setMarketing(me.id, marketing_opt_in, 'app', req.ip);
    const sets: string[] = []; const vals: unknown[] = [me.id];
    for (const [k, v] of Object.entries(rest)) { vals.push(v === '' ? null : v); sets.push(`${k} = $${vals.length}`); }
    if (!sets.length) {
      if (marketing_opt_in === undefined) return { ok: true };
      return { user: publicUser(await one('SELECT * FROM users WHERE id = $1', [me.id])) };
    }
    const u = await one(`UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
    return { user: publicUser(u) };
  });

  /** Australian Privacy Principles: users can request deletion. We anonymise personal data but keep tax records for 5 years (ATO record-keeping). */
  app.delete('/me', async (req) => {
    const me = await requireUser(req);
    const live = await one(`SELECT 1 FROM trips WHERE (rider_id = $1 OR driver_id = $1) AND status IN ('requested','accepted','arrived','in_progress')`, [me.id]);
    if (live) throw bad('trip_in_progress', 'Finish or cancel your current trip first');
    await setMarketing(me.id, false, 'app', req.ip);   // the withdrawal is recorded before the number is removed
    // Round 16: a driver's tax identity is kept apart for the ATO's 5 years (SERR, tax invoices), then purged; bank details,
    // address, date of birth and licence numbers come off the driver record now (before
    // the name, email and phone are anonymised below).
    const isDriver = await one('SELECT 1 FROM drivers WHERE user_id = $1', [me.id]);
    if (isDriver) await retainDriverTaxIdentity(me.id);
    await q(`UPDATE users SET name = 'Deleted user', email = NULL, phone = 'deleted:' || id::text, emergency_contact = NULL,
             accessibility = '{}'::jsonb, marketing_opt_in = false, deleted_at = now() WHERE id = $1`, [me.id]);
    if (await safetyReady()) await q(`UPDATE users SET trusted_contacts = '[]'::jsonb, auto_share = 'off' WHERE id = $1`, [me.id]);
    await q('DELETE FROM push_tokens WHERE user_id = $1', [me.id]);
    // Round 17: the birthday and bonus opt-ins go with the account (migration 021); unused points are forfeited.
    await q('DELETE FROM loyalty_profiles WHERE user_id = $1', [me.id]).catch((e) => { if (e?.code !== '42P01') throw e; });
    await q('UPDATE users SET loyalty_points = 0 WHERE id = $1', [me.id]);
    await q('UPDATE drivers SET online = false WHERE user_id = $1', [me.id]);
    await withdrawOffers(me.id);
    // Two parameters: one value as both uuid (actor) and text (entity id) made Postgres refuse the insert, so every deletion
    // answered 500 after the account had already been anonymised (fixed in Round 16).
    await audit(me.id, 'account_deleted', 'user', me.id);
    disconnectUser(me.id, 'account deleted');
    await recordPrivacyRequest({ user_id: me.id, kind: 'deletion', channel: 'app', status: 'completed', details: isDriver ? 'Driver account; tax records kept for 5 years' : undefined })
      .catch((e) => logError('privacy request', e));
    return { ok: true };
  });

  /** Data export (APP 12 — access to personal information). */
  app.get('/me/export', async (req) => {
    const me = await requireUser(req);
    const [user] = await q('SELECT * FROM users WHERE id = $1', [me.id]);
    const trips = await q('SELECT ref, kind, service, status, pickup_address, dropoff_address, requested_at, completed_at, final_cents FROM trips WHERE rider_id = $1 ORDER BY requested_at DESC', [me.id]);
    const loyalty = await q('SELECT points, reason, created_at FROM loyalty_ledger WHERE user_id = $1 ORDER BY created_at DESC', [me.id]);
    // Round 9: messages I sent in trip chats, marketing consent history and notification settings. Missing before migration 015.
    const opt = <T>(p: Promise<T>, empty: T) => p.catch((e) => { if (e?.code === '42P01' || e?.code === '42703') return empty; throw e; });
    const messages = await opt(q(`SELECT t.ref AS trip_ref, m.body, m.via, m.created_at FROM trip_messages m JOIN trips t ON t.id = m.trip_id
      WHERE m.sender_id = $1 ORDER BY m.id DESC LIMIT 5000`, [me.id]), []);
    const marketing_consents = await opt(q('SELECT granted, channel, source, wording, created_at FROM marketing_consents WHERE user_id = $1 ORDER BY id', [me.id]), []);
    const notification_prefs = (await loadRecipient(me.id))?.prefs ?? null;
    // Round 12: organisations I let book rides for me (migration 017).
    const booking_consents = await opt(q(`SELECT a.name AS organisation, c.method, c.given_at, c.expires_at, c.withdrawn_at FROM client_consents c
      JOIN corporate_accounts a ON a.id = c.account_id WHERE c.client_id = $1 ORDER BY c.given_at`, [me.id]), []);
    // Round 14: my safety reports, check-ins and account standing (migration 019). Trusted contacts are on `user`.
    const safety_reports = await opt(q(`SELECT ref, category, status, outcome, description, created_at FROM incident_reports WHERE reporter_id = $1 ORDER BY created_at`, [me.id]), []);
    const check_ins = await opt(q(`SELECT reason, status, created_at, answered_at FROM safety_checks WHERE user_id = $1 ORDER BY created_at`, [me.id]), []);
    const account_actions = await opt(q(`SELECT action, public_reason, until, created_at FROM account_actions WHERE user_id = $1 ORDER BY created_at`, [me.id]), []);
    // Round 16: drivers also get their driver record (bank numbers shown as the last 3 digits), papers, pay and time online.
    const drv = await one('SELECT * FROM drivers WHERE user_id = $1', [me.id]);
    let driver: Record<string, unknown> | null = null;
    if (drv) {
      const tail = (s: string | null) => (s ? `•••${String(s).slice(-3)}` : null);
      const { lat, lng, heading, ...rest } = drv;
      driver = {
        profile: { ...rest, bank_bsb: tail(drv.bank_bsb), bank_account: tail(drv.bank_account) },
        documents: await q('SELECT type, number, expires_at, status, note, created_at, reviewed_at FROM driver_documents WHERE driver_id = $1 ORDER BY created_at', [me.id]),
        pay: await q('SELECT kind, amount_cents, note, created_at FROM driver_ledger WHERE driver_id = $1 ORDER BY id', [me.id]),
        trips: await q('SELECT ref, kind, service, status, pickup_address, dropoff_address, accepted_at, completed_at, final_cents FROM trips WHERE driver_id = $1 ORDER BY requested_at DESC', [me.id]),
        online_sessions: await opt(q('SELECT started_at, ended_at, end_reason FROM driver_online_sessions WHERE driver_id = $1 ORDER BY started_at', [me.id]), []),
      };
    }
    // Round 17: birthday and bonus opt-ins, gift vouchers I bought (migration 021).
    const loyalty_profile = await opt(one('SELECT birthday_md, birthday_opt_in, streak_opt_in, updated_at FROM loyalty_profiles WHERE user_id = $1', [me.id]), null);
    const gift_vouchers_bought = await opt(q(`SELECT value_cents, from_name, recipient_name, message, created_at, expires_at, redeemed_at IS NOT NULL AS used
      FROM gift_vouchers WHERE purchased_by = $1 ORDER BY created_at`, [me.id]), []);
    // Round 21: what the apps explained before asking for location, notifications or the camera, and the answers (migration 025).
    const permission_disclosures = await opt(q(`SELECT app, kind, version, accepted, platform, app_version, created_at FROM permission_disclosures
      WHERE user_id = $1 ORDER BY created_at`, [me.id]), []);
    await recordPrivacyRequest({ user_id: me.id, kind: 'access', channel: 'app', status: 'completed' }).catch((e) => logError('privacy request', e));
    return { exported_at: new Date().toISOString(), user: publicUser(user), trips, loyalty, messages, marketing_consents, notification_prefs, booking_consents,
      safety_reports, check_ins, account_actions, driver, loyalty_profile, gift_vouchers_bought, permission_disclosures };
  });

  app.post('/me/push-token', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({ token: z.string().min(10).max(4096), platform: z.enum(['ios', 'android', 'web']) }), req.body);
    await q(`INSERT INTO push_tokens (user_id, token, platform) VALUES ($1,$2,$3) ON CONFLICT (user_id, token) DO UPDATE SET updated_at = now()`,
      [me.id, b.token, b.platform]);
    return { ok: true };
  });

  app.get('/me/notifications', async (req) => {
    const me = await requireUser(req);
    return { notifications: await q('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [me.id]) };
  });
  // ───────────── Concession card (Round 12) ─────────────
  /** Apply for concession fares: card type, the last 4 digits and the expiry (never the whole number). DingoGo checks it. */
  app.put('/me/concession', async (req) => {
    const me = await requireUser(req);
    if (!(await communityReady())) throw new ApiError(503, 'migration_pending', `Concession cards: ${communityPending}`);
    const rules = await loadCommunityPricing();
    if (!rules.enabled) throw bad('concession_off', 'Concession fares are not available yet');
    const b = parse(z.object({
      type: z.enum(Object.keys(CONCESSION_TYPES) as [ConcessionType, ...ConcessionType[]]),
      last4: z.string().regex(/^\d{4}$/, 'The last 4 digits of the card'),
      expires: z.string().date(),
    }), req.body);
    if (!rules.types.includes(b.type)) throw bad('concession_type', 'That card is not accepted for concession fares');
    if (b.expires < localDate()) throw bad('concession_expired', 'That card has expired');
    const card = { ...b, status: 'pending', applied_at: new Date().toISOString() };
    const u = await one(`UPDATE users SET concession = $2 WHERE id = $1 RETURNING *`, [me.id, JSON.stringify(card)]);
    await audit(me.id, 'concession_applied', 'user', me.id, { type: b.type });
    return { user: publicUser(u) };
  });
  app.delete('/me/concession', async (req) => {
    const me = await requireUser(req);
    if (!(await communityReady())) return { ok: true };
    await q(`UPDATE users SET concession = NULL WHERE id = $1`, [me.id]);
    return { ok: true };
  });

  // ───────────── Organisations that book rides for me (Round 12) ─────────────
  app.get('/me/consents', async (req) => {
    const me = await requireUser(req);
    if (!(await communityReady())) return { consents: [] };
    return { consents: await q(
      `SELECT c.id, a.name AS organisation, a.kind, c.method, c.given_at, c.expires_at, c.withdrawn_at,
              (c.withdrawn_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > now())) AS current
       FROM client_consents c JOIN corporate_accounts a ON a.id = c.account_id WHERE c.client_id = $1 ORDER BY c.given_at DESC`, [me.id]) };
  });
  /** The client says stop: the organisation can't book for them any more (booked trips stay; they can cancel those). */
  app.post('/me/consents/:id/withdraw', async (req) => {
    const me = await requireUser(req);
    if (!(await communityReady())) throw new ApiError(503, 'migration_pending', communityPending);
    const r = await one(`UPDATE client_consents SET withdrawn_at = now(), withdrawn_by = $2 WHERE id = $1 AND client_id = $2 AND withdrawn_at IS NULL RETURNING id, account_id`,
      [(req.params as any).id, me.id]);
    if (!r) throw bad('not_found', 'Nothing to withdraw');
    await audit(me.id, 'client_consent_withdrawn', 'corporate_account', r.account_id, { consent_id: r.id, by: 'client' });
    return { ok: true };
  });

  app.post('/me/notifications/read', async (req) => {
    const me = await requireUser(req);
    await q('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [me.id]);
    return { ok: true };
  });
}
