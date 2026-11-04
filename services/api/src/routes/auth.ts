import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { one, q, tx } from '../db.js';
import { requireUser, signToken } from '../auth.js';
import { bad, ApiError } from '../lib/errors.js';
import { referralCode, sha256 } from '../lib/ids.js';
import { parse, phone, z } from '../lib/validate.js';
import { sendSms } from '../services/notify.js';

const publicUser = (u: any) => ({
  id: u.id, phone: u.phone, email: u.email, name: u.name, role: u.role, language: u.language,
  accessibility: u.accessibility, emergency_contact: u.emergency_contact, referral_code: u.referral_code,
  loyalty_points: u.loyalty_points, wallet_cents: u.wallet_cents, marketing_opt_in: u.marketing_opt_in,
  rating_avg: u.rating_avg, partner_id: u.partner_id, created_at: u.created_at,
});

// Demo sign-in only for the exact seeded demo numbers, and only when demo mode is switched on (OTP_DEMO_PREFIXES set).
const isDemoPhone = (p: string) => config.otpDemoPrefixes.length > 0 && config.otpDemoNumbers.includes(p);

export default async function authRoutes(app: FastifyInstance) {
  app.post('/auth/otp/request', async (req) => {
    const body = parse(z.object({ phone }), req.body);
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
    const demo = isDemoPhone(body.phone);
    const sent = await sendSms(body.phone, `Your DingoGo code is ${code}. It expires in 10 minutes. Never share this code.`);
    if (!sent.sent && !config.otpDevMode && !demo) {
      throw new ApiError(503, 'sms_unavailable', 'Sign-in by text message isn’t switched on yet. Please try again later.');
    }
    return { ok: true, phone: body.phone, ...(config.otpDevMode ? { dev_code: code } : {}), ...(demo ? { demo: true } : {}) };
  });

  app.post('/auth/otp/verify', async (req) => {
    const body = parse(z.object({
      phone, code: z.string().regex(/^\d{6}$/), name: z.string().max(80).optional(),
      referral_code: z.string().max(20).optional(), app: z.enum(['rider', 'driver', 'admin', 'partner']).default('rider'),
    }), req.body);

    const otp = await one('SELECT * FROM otp_codes WHERE phone = $1', [body.phone]);
    const devBypass = (config.otpDevMode || isDemoPhone(body.phone)) && body.code === '000000';
    if (!devBypass) {
      if (!otp || new Date(otp.expires_at) < new Date()) throw bad('otp_expired', 'Code expired — request a new one');
      if (otp.attempts >= 5) throw new ApiError(429, 'otp_locked', 'Too many attempts — request a new code');
      if (otp.code_hash !== sha256(body.code)) {
        await q('UPDATE otp_codes SET attempts = attempts + 1 WHERE phone = $1', [body.phone]);
        throw bad('otp_invalid', 'Incorrect code');
      }
    }
    await q('DELETE FROM otp_codes WHERE phone = $1', [body.phone]);

    const user = await tx(async (c) => {
      let u = await one('SELECT * FROM users WHERE phone = $1 AND deleted_at IS NULL', [body.phone], c);
      let isNew = false;
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
    return { token: signToken(user), user: publicUser(user), is_new: user.isNew };
  });

  app.get('/me', async (req) => {
    const me = await requireUser(req);
    const u = await one('SELECT * FROM users WHERE id = $1', [me.id]);
    const sub = await one(
      `SELECT s.*, p.name AS plan_name, p.ride_discount_pct, p.free_deliveries, p.waive_booking_fee FROM subscriptions s JOIN plans p ON p.code = s.plan_code
       WHERE s.user_id = $1 AND s.status = 'active' AND s.period_end > now()`, [me.id]);
    const corporate = await q(
      `SELECT a.id, a.name, m.role FROM corporate_members m JOIN corporate_accounts a ON a.id = m.account_id WHERE m.user_id = $1 AND a.active`, [me.id]);
    return { user: publicUser(u), subscription: sub, corporate_accounts: corporate };
  });

  app.patch('/me', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({
      name: z.string().min(1).max(80).optional(),
      email: z.string().email().optional().or(z.literal('')),
      language: z.string().max(8).optional(),
      accessibility: z.record(z.string(), z.any()).optional(),
      emergency_contact: z.object({ name: z.string().max(80), phone: z.string().max(20) }).nullable().optional(),
      marketing_opt_in: z.boolean().optional(),
    }), req.body);
    const sets: string[] = []; const vals: unknown[] = [me.id];
    for (const [k, v] of Object.entries(b)) { vals.push(v === '' ? null : v); sets.push(`${k} = $${vals.length}`); }
    if (!sets.length) return { ok: true };
    const u = await one(`UPDATE users SET ${sets.join(', ')} WHERE id = $1 RETURNING *`, vals);
    return { user: publicUser(u) };
  });

  /** Australian Privacy Principles: users can request deletion. We anonymise personal data but keep tax records for 5 years (ATO record-keeping). */
  app.delete('/me', async (req) => {
    const me = await requireUser(req);
    const live = await one(`SELECT 1 FROM trips WHERE (rider_id = $1 OR driver_id = $1) AND status IN ('requested','accepted','arrived','in_progress')`, [me.id]);
    if (live) throw bad('trip_in_progress', 'Finish or cancel your current trip first');
    await q(`UPDATE users SET name = 'Deleted user', email = NULL, phone = 'deleted:' || id::text, emergency_contact = NULL,
             accessibility = '{}'::jsonb, marketing_opt_in = false, deleted_at = now() WHERE id = $1`, [me.id]);
    await q('DELETE FROM push_tokens WHERE user_id = $1', [me.id]);
    await q(`INSERT INTO audit_log (actor_id, action, entity, entity_id) VALUES ($1, 'account_deleted', 'user', $1)`, [me.id]);
    return { ok: true };
  });

  /** Data export (APP 12 — access to personal information). */
  app.get('/me/export', async (req) => {
    const me = await requireUser(req);
    const [user] = await q('SELECT * FROM users WHERE id = $1', [me.id]);
    const trips = await q('SELECT ref, kind, service, status, pickup_address, dropoff_address, requested_at, completed_at, final_cents FROM trips WHERE rider_id = $1 ORDER BY requested_at DESC', [me.id]);
    const loyalty = await q('SELECT points, reason, created_at FROM loyalty_ledger WHERE user_id = $1 ORDER BY created_at DESC', [me.id]);
    return { exported_at: new Date().toISOString(), user: publicUser(user), trips, loyalty };
  });

  app.post('/me/push-token', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({ token: z.string().min(10), platform: z.enum(['ios', 'android', 'web']) }), req.body);
    await q(`INSERT INTO push_tokens (user_id, token, platform) VALUES ($1,$2,$3) ON CONFLICT (user_id, token) DO UPDATE SET updated_at = now()`,
      [me.id, b.token, b.platform]);
    return { ok: true };
  });

  app.get('/me/notifications', async (req) => {
    const me = await requireUser(req);
    return { notifications: await q('SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50', [me.id]) };
  });
  app.post('/me/notifications/read', async (req) => {
    const me = await requireUser(req);
    await q('UPDATE notifications SET read_at = now() WHERE user_id = $1 AND read_at IS NULL', [me.id]);
    return { ok: true };
  });
}
