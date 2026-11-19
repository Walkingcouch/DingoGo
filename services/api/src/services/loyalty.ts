/**
 * Round 17 — loyalty: tiers and points on completion (with referral and streak bonuses), points expiry with warnings, birthday bonuses,
 * balance history, promo use/budget taken and given back, café statements and stats, gift vouchers bought online, win-back for lapsed
 * riders. Everything that needs migration 021 checks `loyaltyReady()` first and stays off (or answers migration_pending) without it.
 */
import type pg from 'pg';
import { one, pool, q, tx, type Q } from '../db.js';
import { config } from '../config.js';
import { ApiError, bad, conflict } from '../lib/errors.js';
import { logError } from '../lib/log.js';
import { Pdf } from '../lib/pdf.js';
import { toCsv, dollars } from '../lib/csv.js';
import { longDate } from '../lib/tax.js';
import {
  GIFT_CARD_MIN_DAYS, darwin, expiryFrom, isBirthday, ledgerLabel, loyaltyReady, mergeLoyalty, promoDiscountOf, streakLength, tierFor,
  tierPoints, weekOf, type LoyaltySettings,
} from '../lib/loyalty.js';
import { render } from '../lib/messages.js';
import { notify, send, sendSmsT } from './notify.js';

const TZ = `'${config.timezone}'`;
export const pendingMsg = 'This needs database migration 021';
export const pending = () => new ApiError(503, 'migration_pending', 'This is not switched on yet. Please try again later.');

export async function loadLoyalty(c: Q = pool): Promise<LoyaltySettings> {
  const row = await one(`SELECT value FROM settings WHERE key = 'loyalty'`, [], c);
  return mergeLoyalty({ referral_bonus_points: config.loyalty.referralBonusPoints, ...(row?.value ?? {}) });
}
export async function saveLoyalty(value: unknown) {
  const s = mergeLoyalty(value);
  await q(`INSERT INTO settings (key, value) VALUES ('loyalty', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify(s)]);
  return s;
}

/** Completed trips as the rider in the last 12 months. */
export async function tripsLastYear(userId: string, c: Q = pool) {
  const r = await one<{ n: number }>(`SELECT count(*)::int n FROM trips WHERE rider_id = $1 AND status = 'completed' AND completed_at > now() - interval '12 months'`, [userId], c);
  return r!.n;
}

async function award(c: Q, userId: string, points: number, reason: string, tripId: string | null = null) {
  if (points <= 0) return;
  await c.query('UPDATE users SET loyalty_points = loyalty_points + $2 WHERE id = $1', [userId, points]);
  await c.query('INSERT INTO loyalty_ledger (user_id, points, reason, trip_id) VALUES ($1,$2,$3,$4)', [userId, points, reason, tripId]);
}
/** Record something given or sent once; false if it already was. */
async function once(c: Q, userId: string, kind: string, period: string) {
  const r = await c.query('INSERT INTO loyalty_notices (user_id, kind, period) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING 1', [userId, kind, period]);
  return (r.rowCount ?? 0) > 0;
}

/** On completion (inside settle's transaction): tier points on what the rider paid, the weekly streak bonus (opt-in) and the referral bonus. */
export async function onTripCompleted(c: pg.PoolClient, t: { id: string; rider_id: string; kind: string }, paidCents: number) {
  const s = await loadLoyalty(c);
  const trips = await tripsLastYear(t.rider_id, c);
  const { tier } = tierFor(trips, s.tiers);
  await award(c, t.rider_id, tierPoints(paidCents, config.loyalty.pointsPerDollar, tier.multiplier), 'trip_earned', t.id);

  if (s.streak_points > 0 && await loyaltyReady()) {
    const prof = await one('SELECT streak_opt_in FROM loyalty_profiles WHERE user_id = $1', [t.rider_id], c);
    if (prof?.streak_opt_in) {
      const rows = await q<{ at: string }>(`SELECT completed_at AS at FROM trips WHERE rider_id = $1 AND status = 'completed' AND completed_at > now() - ($2 || ' days')::interval`,
        [t.rider_id, String((s.streak_weeks + 1) * 7)], c);
      const now = weekOf(new Date());
      const n = streakLength([...rows.map((r) => weekOf(new Date(r.at))), now], now);
      if (n >= s.streak_weeks && n % s.streak_weeks === 0 && await once(c, t.rider_id, 'streak', now)) {
        await award(c, t.rider_id, s.streak_points, 'streak_bonus', t.id);
        setImmediate(() => void send(t.rider_id, 'streak_bonus', { points: s.streak_points, weeks: n }, { data: {} }));
      }
    }
  }

  // Referral: both get the bonus after the friend's first trip that cost at least the minimum. Not for blocked, deleted or test
  // referrers; the referrer's bonuses are capped per Darwin month (the friend still gets theirs).
  const ref = await one(`SELECT * FROM referrals WHERE referee_id = $1 AND status = 'pending' FOR UPDATE`, [t.rider_id], c);
  if (!ref || paidCents < s.referral_min_fare_cents || s.referral_bonus_points <= 0) return;
  const who = await one(`SELECT (SELECT test_account FROM users WHERE id = $2) AS referee_test, blocked, deleted_at, test_account FROM users WHERE id = $1`, [ref.referrer_id, t.rider_id], c);
  if (!who || who.blocked || who.deleted_at || who.test_account !== who.referee_test) {
    await c.query(`UPDATE referrals SET status = 'void' WHERE referee_id = $1`, [t.rider_id]);
    return;
  }
  const bonus = s.referral_bonus_points;
  const month = darwin().month;
  const got = await one<{ n: number }>(
    `SELECT count(*)::int n FROM loyalty_ledger WHERE user_id = $1 AND reason = 'referral_bonus' AND to_char(created_at AT TIME ZONE ${TZ}, 'YYYY-MM') = $2`, [ref.referrer_id, month], c);
  await c.query(`UPDATE referrals SET status = 'rewarded', rewarded_at = now() WHERE referee_id = $1`, [t.rider_id]);
  await award(c, t.rider_id, bonus, 'referral_bonus', t.id);
  if (got!.n < s.referral_monthly_cap) {
    await award(c, ref.referrer_id, bonus, 'referral_bonus', t.id);
    setImmediate(() => void send(ref.referrer_id, 'referral_bonus', { points: bonus }, { data: {} }));
  }
}

// ───────────── Promo codes: use and budget ─────────────
/** Take one use (and the discount from the budget) at booking. Conditional, so two riders at once can't overshoot a cap. */
export async function takePromo(c: Q, code: string, discountCents: number, opts: { force?: boolean } = {}) {
  const ready = await loyaltyReady();
  const guard = opts.force ? '' : ` AND (max_uses IS NULL OR uses < max_uses)${ready ? ' AND (budget_cents IS NULL OR spent_cents + $2 <= budget_cents)' : ''}`;
  const r = await c.query(`UPDATE promo_codes SET uses = uses + 1${ready ? ', spent_cents = spent_cents + $2' : ''} WHERE code = $1${guard} RETURNING code`,
    ready ? [code, discountCents] : [code]);
  if (!r.rowCount) throw bad('promo_exhausted', 'That promo code has just run out');
}
/** Give the use and the discount back (cancelled, no drivers, card declined at release). */
export async function givePromoBack(c: Q, t: { promo_code?: string | null; fare_breakdown?: any }) {
  if (!t.promo_code) return;
  if (await loyaltyReady()) {
    await c.query('UPDATE promo_codes SET uses = greatest(uses - 1, 0), spent_cents = greatest(spent_cents - $2, 0) WHERE code = $1',
      [t.promo_code, promoDiscountOf(t.fare_breakdown, t.promo_code)]);
  } else {
    await c.query('UPDATE promo_codes SET uses = greatest(uses - 1, 0) WHERE code = $1', [t.promo_code]);
  }
}

// ───────────── Rider summary and history ─────────────
async function lastActivity(userId: string, c: Q = pool): Promise<Date | null> {
  const r = await one(
    `SELECT greatest((SELECT max(created_at) FROM loyalty_ledger WHERE user_id = $1 AND reason <> 'expired'),
                     (SELECT max(completed_at) FROM trips WHERE rider_id = $1 AND status = 'completed')) AS at`, [userId], c);
  return r?.at ? new Date(r.at) : null;
}

export async function profile(userId: string) {
  if (!(await loyaltyReady())) return null;
  const p = await one('SELECT birthday_md, birthday_opt_in, streak_opt_in FROM loyalty_profiles WHERE user_id = $1', [userId]);
  return { birthday_md: p?.birthday_md ?? null, birthday_opt_in: !!p?.birthday_opt_in, streak_opt_in: !!p?.streak_opt_in };
}
export async function saveProfile(userId: string, b: { birthday_md?: string | null; birthday_opt_in?: boolean; streak_opt_in?: boolean }) {
  if (!(await loyaltyReady())) throw pending();
  const cur = (await profile(userId))!;
  const next = { ...cur, ...Object.fromEntries(Object.entries(b).filter(([, v]) => v !== undefined)) };
  if (next.birthday_opt_in && !next.birthday_md) throw bad('birthday_required', 'Add your birthday (day and month) to get the birthday bonus');
  // Changing the birthday can't earn a second bonus in a year (the bonus is recorded per year, not per date).
  await q(`INSERT INTO loyalty_profiles (user_id, birthday_md, birthday_opt_in, streak_opt_in, updated_at) VALUES ($1,$2,$3,$4, now())
           ON CONFLICT (user_id) DO UPDATE SET birthday_md = $2, birthday_opt_in = $3, streak_opt_in = $4, updated_at = now()`,
    [userId, next.birthday_md ?? null, !!next.birthday_opt_in, !!next.streak_opt_in]);
  return profile(userId);
}

/** What the Rewards screen shows on top of points: tier and progress, when points expire, bonuses, the rider's streak. */
export async function summary(userId: string, points: number) {
  const s = await loadLoyalty();
  const trips = await tripsLastYear(userId);
  const t = tierFor(trips, s.tiers);
  const last = await lastActivity(userId);
  const expires = points > 0 ? expiryFrom(last, s.expiry_months) : null;
  let streak = 0;
  const prof = await profile(userId);
  if (prof?.streak_opt_in) {
    const rows = await q<{ at: string }>(`SELECT completed_at AS at FROM trips WHERE rider_id = $1 AND status = 'completed' AND completed_at > now() - interval '30 weeks'`, [userId]);
    const weeks = rows.map((r) => weekOf(new Date(r.at)));
    const now = weekOf();
    // A streak is still alive this week if last week had a trip.
    streak = weeks.includes(now) ? streakLength(weeks, now) : streakLength(weeks, weekOf(new Date(Date.now() - 7 * 86400e3)));
  }
  return {
    tier: { ...t.tier, trips_last_year: trips, next: t.next ? { name: t.next.name, min_trips: t.next.min_trips, multiplier: t.next.multiplier, trips_to_go: t.trips_to_next } : null },
    tiers: s.tiers,
    expiry: { months: s.expiry_months, expires_at: expires?.toISOString() ?? null, rule: s.expiry_months ? `Points stay while you ride. They expire after ${s.expiry_months} months with no trips or points activity, and we tell you ${s.warn_days} days before.` : 'Points don’t expire.' },
    bonuses: { birthday_points: s.birthday_points, streak_weeks: s.streak_weeks, streak_points: s.streak_points, ready: !!prof },
    profile: prof, streak_weeks_now: streak,
    referral: { bonus_points: s.referral_bonus_points, min_fare_cents: s.referral_min_fare_cents },
  };
}

/** Points history with labels and the balance after each line, newest first, 50 at a time (`before` = id of the last row shown). */
export async function history(userId: string, before?: number | null) {
  const u = await one<{ loyalty_points: number }>('SELECT loyalty_points FROM users WHERE id = $1', [userId]);
  const rows = await q<any>(
    `SELECT l.id::int, l.points, l.reason, l.created_at, t.ref AS trip_ref,
            $3::int - coalesce((SELECT sum(x.points) FROM loyalty_ledger x WHERE x.user_id = $1 AND x.id > l.id), 0)::int AS balance
     FROM loyalty_ledger l LEFT JOIN trips t ON t.id = l.trip_id
     WHERE l.user_id = $1 ${before ? 'AND l.id < $2' : 'AND $2::bigint IS NULL'} ORDER BY l.id DESC LIMIT 51`, [userId, before ?? null, u?.loyalty_points ?? 0]);
  const more = rows.length > 50;
  return {
    points: u?.loyalty_points ?? 0,
    items: rows.slice(0, 50).map((r) => ({ ...r, label: ledgerLabel(r.reason) })),
    next: more ? rows[49].id : null,
  };
}

// ───────────── Scheduled: expiry, birthdays, stale café codes ─────────────
let lastRun = 0;
export async function runLoyaltyIfDue() {
  if (Date.now() - lastRun < 3 * 3600e3) return;
  lastRun = Date.now();
  if (!(await loyaltyReady())) return;
  await runLoyalty().catch((e) => logError('loyalty run', e));
}

export async function runLoyalty(now = new Date()) {
  const out = { warned: 0, expired: 0, expired_points: 0, birthdays: 0, codes_expired: 0 };
  if (!(await loyaltyReady())) return { ...out, ready: false };
  const s = await loadLoyalty();
  // Café reward codes past their use-by date are marked expired (they were left "issued" until someone tried them).
  out.codes_expired = (await q(`UPDATE reward_redemptions SET status = 'expired' WHERE status = 'issued' AND expires_at < $1 RETURNING 1`, [now])).length;

  if (s.expiry_months > 0) {
    const rows = await q<any>(
      `SELECT u.id, u.loyalty_points, u.created_at,
              greatest((SELECT max(created_at) FROM loyalty_ledger WHERE user_id = u.id AND reason <> 'expired'),
                       (SELECT max(completed_at) FROM trips WHERE rider_id = u.id AND status = 'completed')) AS last_at
       FROM users u WHERE u.loyalty_points > 0 AND u.deleted_at IS NULL
         AND NOT EXISTS (SELECT 1 FROM loyalty_ledger l WHERE l.user_id = u.id AND l.reason <> 'expired' AND l.created_at > $1::timestamptz - ($2 || ' months')::interval + ($3 || ' days')::interval)
         AND NOT EXISTS (SELECT 1 FROM trips t WHERE t.rider_id = u.id AND t.status = 'completed' AND t.completed_at > $1::timestamptz - ($2 || ' months')::interval + ($3 || ' days')::interval)
       LIMIT 500`, [now, String(s.expiry_months), String(s.warn_days)]);
    for (const r of rows) {
      const last = new Date(r.last_at ?? r.created_at);
      const expires = expiryFrom(last, s.expiry_months)!;
      const period = last.toISOString().slice(0, 10);
      const warn = await one<{ created_at: string }>(`SELECT created_at FROM loyalty_notices WHERE user_id = $1 AND kind = 'expiry_warning' AND period = $2`, [r.id, period]);
      if (!warn) {
        // Warn first; the points can only go `warn_days` after the warning, even when the job ran late.
        if (await once(pool, r.id, 'expiry_warning', period)) {
          out.warned++;
          const when = new Date(Math.max(expires.getTime(), now.getTime() + s.warn_days * 86400e3));
          await send(r.id, 'points_expiring', { points: r.loyalty_points, date: longDate(when) }, { data: { screen: 'rewards' } });
        }
        continue;
      }
      if (now < expires || now.getTime() - new Date(warn.created_at).getTime() < s.warn_days * 86400e3) continue;
      const gone = await tx(async (c) => {
        const u = await one<{ loyalty_points: number }>('SELECT loyalty_points FROM users WHERE id = $1 FOR UPDATE', [r.id], c);
        const pts = u?.loyalty_points ?? 0;
        if (pts <= 0) return 0;
        await c.query('UPDATE users SET loyalty_points = 0 WHERE id = $1', [r.id]);
        await c.query(`INSERT INTO loyalty_ledger (user_id, points, reason) VALUES ($1,$2,'expired')`, [r.id, -pts]);
        return pts;
      });
      if (gone) { out.expired++; out.expired_points += gone; }
    }
  }

  if (s.birthday_points > 0) {
    const d = darwin(now);
    const mds = [d.md, ...(d.md === '02-28' ? ['02-29'] : [])];
    const rows = await q<any>(
      `SELECT p.user_id, p.birthday_md FROM loyalty_profiles p JOIN users u ON u.id = p.user_id
       WHERE p.birthday_opt_in AND p.birthday_md = ANY($1) AND u.deleted_at IS NULL AND NOT u.blocked`, [mds]);
    for (const r of rows) {
      if (!isBirthday(r.birthday_md, d.date)) continue;
      const given = await tx(async (c) => {
        if (!(await once(c, r.user_id, 'birthday', String(d.year)))) return false;
        await award(c, r.user_id, s.birthday_points, 'birthday_bonus');
        return true;
      });
      if (given) { out.birthdays++; await send(r.user_id, 'birthday_bonus', { points: s.birthday_points }, { data: { screen: 'rewards' } }); }
    }
  }
  return { ...out, ready: true };
}

// ───────────── Win-back for lapsed riders ─────────────
/** Riders who said yes to offers, rode before, and haven't ridden for `days` (and weren't sent a win-back in `every` days). */
async function lapsed(days: number, every: number) {
  return q<{ id: string; phone: string; name: string; last_trip: string }>(
    `SELECT u.id, u.phone, u.name, max(t.completed_at) AS last_trip
     FROM users u JOIN trips t ON t.rider_id = u.id AND t.status = 'completed'
     WHERE u.role = 'rider' AND u.marketing_opt_in AND u.deleted_at IS NULL AND NOT u.blocked AND NOT u.test_account
       AND NOT EXISTS (SELECT 1 FROM trips x WHERE x.rider_id = u.id AND x.status IN ('scheduled','requested','accepted','arrived','in_progress'))
       AND NOT EXISTS (SELECT 1 FROM loyalty_notices n WHERE n.user_id = u.id AND n.kind = 'winback' AND n.created_at > now() - ($2 || ' days')::interval)
     GROUP BY u.id HAVING max(t.completed_at) < now() - ($1 || ' days')::interval
     ORDER BY max(t.completed_at) DESC LIMIT 2000`, [String(days), String(every)]);
}

export async function winbackPreview(days?: number) {
  if (!(await loyaltyReady())) throw pending();
  const s = await loadLoyalty();
  const d = days ?? s.winback_days;
  const rows = await lapsed(d, s.winback_every_days);
  const consented = await one<{ n: number }>(`SELECT count(*)::int n FROM users WHERE role = 'rider' AND deleted_at IS NULL AND NOT marketing_opt_in`);
  return { days: d, every_days: s.winback_every_days, count: rows.length, not_consented: consented!.n,
    sample: rows.slice(0, 10).map((r) => ({ first_name: r.name.split(/\s+/)[0], last_trip: r.last_trip })) };
}

export async function winbackSend(b: { days?: number; title: string; body: string; promo_code?: string | null; channel: 'app' | 'sms' }, actorId: string) {
  if (!(await loyaltyReady())) throw pending();
  const s = await loadLoyalty();
  let code: string | null = null;
  if (b.promo_code) {
    const p = await one('SELECT code, active FROM promo_codes WHERE upper(code) = upper($1)', [b.promo_code]);
    if (!p?.active) throw bad('promo_invalid', 'That promo code does not exist or is switched off');
    code = p.code;
  }
  const rows = await lapsed(b.days ?? s.winback_days, s.winback_every_days);
  const period = new Date().toISOString().slice(0, 10);
  let sent = 0, skipped = 0;
  const bodyText = code ? `${b.body} Use code ${code}.` : b.body;
  for (let i = 0; i < rows.length; i += 10) {
    await Promise.all(rows.slice(i, i + 10).map(async (u) => {
      if (!(await once(pool, u.id, 'winback', period))) { skipped++; return; }
      if (code) await q(`INSERT INTO promo_grants (code, user_id, reason) VALUES ($1,$2,'winback') ON CONFLICT DO NOTHING`, [code, u.id]);
      if (b.channel === 'sms') {
        const r = await sendSmsT(u.phone, 'promo', { title: b.title, body: bodyText }, { userId: u.id });
        if (r.sent || r.status === 'dev_log') sent++; else skipped++;
      } else {
        const m = render('promo', { title: b.title, body: bodyText });
        await notify(u.id, m.title!, m.body!, { screen: 'ride', ...(code ? { promo_code: code } : {}) }, 'promo');
        sent++;
      }
    }));
  }
  const { audit } = await import('../lib/audit.js');
  await audit(actorId, 'winback_sent', 'loyalty_notices', period, { count: sent, skipped, channel: b.channel, promo_code: code });
  return { sent, skipped, promo_code: code };
}

// ───────────── Partner cafés: stats and statements ─────────────
const monthSql = (col: string) => `to_char(${col} AT TIME ZONE ${TZ}, 'YYYY-MM')`;

/** The Darwin month for "this month" and the last `n` months, newest first. */
export function recentMonths(n: number, now = new Date()) {
  const out: string[] = [];
  let [y, m] = darwin(now).month.split('-').map(Number);
  for (let i = 0; i < n; i++) { out.push(`${y}-${String(m).padStart(2, '0')}`); m--; if (!m) { m = 12; y--; } }
  return out;
}

async function rateSql() {
  return (await loyaltyReady()) ? 'coalesce(rr.settlement_cents, p.settlement_cents_per_redemption)' : 'p.settlement_cents_per_redemption';
}

export async function partnerStats(pid: string) {
  const months = recentMonths(6);
  const rate = await rateSql();
  const byMonth = await q<any>(
    `SELECT ${monthSql('rr.redeemed_at')} AS month, count(*)::int redeemed, coalesce(sum(${rate}), 0)::int owed_cents, count(DISTINCT rr.user_id)::int customers
     FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id JOIN partners p ON p.id = r.partner_id
     WHERE r.partner_id = $1 AND rr.status = 'redeemed' AND ${monthSql('rr.redeemed_at')} = ANY($2) GROUP BY 1`, [pid, months]);
  const now = months[0];
  const byReward = await q<any>(
    `SELECT r.title, count(*)::int redeemed FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id
     WHERE r.partner_id = $1 AND rr.status = 'redeemed' AND ${monthSql('rr.redeemed_at')} = $2 GROUP BY r.title ORDER BY 2 DESC`, [pid, now]);
  const repeat = await one<{ n: number }>(
    `SELECT count(*)::int n FROM (SELECT rr.user_id FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id
       WHERE r.partner_id = $1 AND rr.status = 'redeemed' AND rr.redeemed_at > now() - interval '6 months' GROUP BY rr.user_id HAVING count(*) > 1) x`, [pid]);
  const waiting = await one<{ issued: number; expired: number }>(
    `SELECT count(*) FILTER (WHERE rr.status = 'issued' AND rr.expires_at > now())::int issued, count(*) FILTER (WHERE rr.status = 'expired' OR (rr.status = 'issued' AND rr.expires_at <= now()))::int expired
     FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id WHERE r.partner_id = $1 AND rr.issued_at > now() - interval '6 months'`, [pid]);
  const map = Object.fromEntries(byMonth.map((r) => [r.month, r]));
  return {
    month: now,
    months: months.map((m) => ({ month: m, redeemed: map[m]?.redeemed ?? 0, owed_cents: map[m]?.owed_cents ?? 0, customers: map[m]?.customers ?? 0 })),
    by_reward: byReward, repeat_customers_6m: repeat!.n, codes_waiting: waiting!.issued, codes_expired_6m: waiting!.expired,
  };
}

/** One café's statement for a Darwin month: each reward served at the rate fixed when it was served, and whether DingoGo has paid. */
export async function partnerStatement(pid: string, month: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad('bad_month', 'Month looks like 2026-11');
  const p = await one('SELECT id, name, address, email, settlement_cents_per_redemption FROM partners WHERE id = $1', [pid]);
  if (!p) throw bad('not_found', 'Partner not found');
  const rate = await rateSql();
  const lines = await q<any>(
    `SELECT rr.redeemed_at, rr.code, r.title, ${rate}::int AS cents FROM reward_redemptions rr JOIN rewards r ON r.id = rr.reward_id JOIN partners p ON p.id = r.partner_id
     WHERE r.partner_id = $1 AND rr.status = 'redeemed' AND ${monthSql('rr.redeemed_at')} = $2 ORDER BY rr.redeemed_at`, [pid, month]);
  const paid = (await loyaltyReady()) ? await one('SELECT redeemed, amount_cents, paid_at, paid_ref FROM partner_settlements WHERE partner_id = $1 AND month = $2', [pid, month]) : null;
  const biz = (await one(`SELECT value FROM settings WHERE key = 'business'`))?.value ?? {};
  const total = lines.reduce((n, l) => n + l.cents, 0);
  const open = month >= darwin().month;
  return {
    partner: { id: p.id, name: p.name, address: p.address }, month, from: biz.legal_name ?? biz.name ?? 'DingoGo', from_abn: biz.abn ?? null,
    lines, redeemed: lines.length, total_cents: total, open,
    status: paid ? 'paid' : open ? 'open' : 'due', paid,
  };
}
export function statementCsv(s: Awaited<ReturnType<typeof partnerStatement>>) {
  return toCsv<any>([['Date', (l) => String(l.redeemed_at instanceof Date ? l.redeemed_at.toISOString() : l.redeemed_at).slice(0, 16).replace('T', ' ')],
    ['Code', (l) => l.code], ['Reward', (l) => l.title], ['Amount', (l) => dollars(l.cents)]],
  [...s.lines, { redeemed_at: '', code: 'Total', title: `${s.redeemed} served`, cents: s.total_cents }]);
}
export function statementPdf(s: Awaited<ReturnType<typeof partnerStatement>>) {
  const money = (c: number) => `$${(c / 100).toFixed(2)}`;
  const doc = new Pdf(`Rewards statement ${s.month}`, `${s.from} · Rewards statement for ${s.partner.name} · ${s.month}`);
  doc.heading('Rewards statement');
  doc.rows([['Partner', s.partner.name], ['Address', s.partner.address ?? ''], ['Month', s.month], ['From', `${s.from}${s.from_abn ? ` (ABN ${s.from_abn})` : ''}`],
    ['Rewards served', String(s.redeemed)], ['Amount', money(s.total_cents)],
    ['Status', s.paid ? `Paid ${longDate(s.paid.paid_at)}${s.paid.paid_ref ? `, reference ${s.paid.paid_ref}` : ''}` : s.open ? 'Month still open' : 'To be paid']]);
  doc.rule();
  if (s.lines.length) {
    doc.table([{ label: 'Date', width: 0.25 }, { label: 'Code', width: 0.2 }, { label: 'Reward', width: 0.35 }, { label: 'Amount', width: 0.2, align: 'right' }],
      [...s.lines.map((l) => [longDate(l.redeemed_at), l.code, l.title, money(l.cents)]), ['Total', '', `${s.redeemed} served`, money(s.total_cents)]], { boldLast: true });
  } else doc.para('No rewards served this month.');
  doc.para('DingoGo reimburses each reward served at the rate agreed when it was served. Questions: reply to your DingoGo contact.', 8.5);
  return doc.toBuffer();
}

/** Admin: every partner's month (served, owed, paid or not). */
export async function settlementsFor(month: string) {
  const rate = await rateSql();
  const ready = await loyaltyReady();
  return q<any>(
    `SELECT p.id, p.name, count(rr.id)::int redeemed, coalesce(sum(${rate}), 0)::int owed_cents
            ${ready ? ', s.paid_at, s.paid_ref, s.amount_cents AS paid_cents' : ''}
     FROM partners p JOIN rewards r ON r.partner_id = p.id
     JOIN reward_redemptions rr ON rr.reward_id = r.id AND rr.status = 'redeemed' AND ${monthSql('rr.redeemed_at')} = $1
     ${ready ? 'LEFT JOIN partner_settlements s ON s.partner_id = p.id AND s.month = $1' : ''}
     GROUP BY p.id ${ready ? ', s.paid_at, s.paid_ref, s.amount_cents' : ''} ORDER BY owed_cents DESC`, [month]);
}

export async function markPaid(pid: string, month: string, ref: string | null, actorId: string) {
  if (!(await loyaltyReady())) throw pending();
  if (month >= darwin().month) throw conflict('month_open', 'A month can be paid once it is over');
  const s = await partnerStatement(pid, month);
  if (!s.redeemed) throw bad('nothing_owed', 'Nothing was served that month');
  const row = await one(
    `INSERT INTO partner_settlements (partner_id, month, redeemed, amount_cents, paid_ref, paid_by) VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (partner_id, month) DO NOTHING RETURNING *`, [pid, month, s.redeemed, s.total_cents, ref, actorId]);
  if (!row) throw conflict('already_paid', 'That month is already marked paid');
  return row;
}

// ───────────── Gift vouchers bought online ─────────────
export function giftCardExpiry(days: number, sold: boolean) {
  return sold ? Math.max(days, GIFT_CARD_MIN_DAYS) : days;
}

export async function myGifts(userId: string) {
  if (!(await loyaltyReady())) return [];
  return q(`SELECT code, value_cents, from_name, recipient_name, message, created_at, expires_at, redeemed_at IS NOT NULL AS used
            FROM gift_vouchers WHERE purchased_by = $1 ORDER BY created_at DESC LIMIT 50`, [userId]);
}
