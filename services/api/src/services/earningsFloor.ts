/**
 * Weekly earnings floor per engaged hour (admin → Pricing → Driver pay). Off by default.
 *
 * Engaged time: from accepting a trip to the end of it (completed, or cancelled by the rider / DingoGo / the driver for a
 * rider-side reason such as a no-show), each trip capped at twice its estimated time plus 45 minutes.
 * Counted earnings: fares less the service fee, pickup pay, fuel surcharge and cancellation fees. Tips never count.
 * Top-up = floor × engaged hours − counted earnings (never negative), paid into the driver ledger once per driver per week.
 */
import type pg from 'pg';
import { config } from '../config.js';
import { one, pool, q, tx, type Q } from '../db.js';
import { ApiError, bad, conflict } from '../lib/errors.js';
import { loadDriverPay, TRIP_PAY_KINDS, weekStartOf } from '../lib/driverPay.js';
import { RIDER_SIDE_CANCEL_REASONS } from './trips.js';
import { notify } from './notify.js';

export interface FloorRow {
  driver_id: string; name: string | null; trips: number; engaged_s: number; earnings_cents: number;
  floor_cents: number; topup_cents: number; per_engaged_hour_cents: number | null;
  paid_cents?: number | null; paid_at?: string | null;
}

const isMonday = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(d + 'T00:00:00Z').getUTCDay() === 1;
const addDays = (d: string, n: number) => new Date(new Date(d + 'T00:00:00Z').getTime() + n * 864e5).toISOString().slice(0, 10);

export function parseWeek(week?: string | null) {
  const w = week || weekStartOf(new Date(Date.now() - 7 * 864e5));   // default: last full week
  if (!isMonday(w)) throw bad('week', 'Week must be a Monday (YYYY-MM-DD)');
  return w;
}

/** Engaged time and counted earnings per driver for the week starting `week` (a Monday, Darwin time). */
export async function floorRows(week: string, rateCents: number, c: Q = pool, driverId?: string): Promise<FloorRow[]> {
  const rows = await q(
    `WITH bounds AS (SELECT ($1::date)::timestamp AT TIME ZONE $2 AS f, ($1::date + 7)::timestamp AT TIME ZONE $2 AS t),
     tr AS (
       SELECT t.driver_id, count(*) FILTER (WHERE t.status = 'completed')::int trips,
              sum(least(extract(epoch FROM coalesce(t.completed_at, t.cancelled_at) - t.accepted_at), t.est_duration_s * 2 + 2700))::int engaged_s
       FROM trips t, bounds b
       WHERE t.driver_id IS NOT NULL AND t.accepted_at IS NOT NULL
         AND (t.status IN ('completed','cancelled_rider','cancelled_admin')
              OR (t.status = 'cancelled_driver' AND split_part(coalesce(t.cancel_reason, ''), ':', 1) = ANY($3)))
         AND coalesce(t.completed_at, t.cancelled_at) >= b.f AND coalesce(t.completed_at, t.cancelled_at) < b.t
         AND ($5::uuid IS NULL OR t.driver_id = $5)
       GROUP BY 1),
     earn AS (
       SELECT l.driver_id, sum(l.amount_cents)::int cents FROM driver_ledger l, bounds b
       WHERE l.kind = ANY($4) AND l.created_at >= b.f AND l.created_at < b.t AND ($5::uuid IS NULL OR l.driver_id = $5)
       GROUP BY 1)
     SELECT tr.driver_id, u.name, tr.trips, greatest(tr.engaged_s, 0) engaged_s, coalesce(earn.cents, 0) earnings_cents
     FROM tr JOIN users u ON u.id = tr.driver_id LEFT JOIN earn ON earn.driver_id = tr.driver_id
     WHERE tr.engaged_s > 0 ORDER BY u.name`,
    [week, config.timezone, [...RIDER_SIDE_CANCEL_REASONS], [...TRIP_PAY_KINDS], driverId ?? null], c);
  return rows.map((r) => {
    const floor = Math.round((r.engaged_s / 3600) * rateCents);
    return {
      ...r, floor_cents: floor, topup_cents: Math.max(0, floor - r.earnings_cents),
      per_engaged_hour_cents: r.engaged_s > 0 ? Math.round(r.earnings_cents / (r.engaged_s / 3600)) : null,
    };
  });
}

/** Admin report: preview for any week, plus what was paid if the week has been settled. */
export async function floorReport(weekParam?: string | null) {
  const week = parseWeek(weekParam);
  const s = await loadDriverPay();
  const rate = s.earnings_floor.cents_per_engaged_hour;
  const rows: FloorRow[] = await floorRows(week, rate);
  let migrationPending = false;
  let settled: any[] = [];
  try {
    settled = await q(`SELECT w.*, u.name FROM driver_pay_weeks w JOIN users u ON u.id = w.driver_id WHERE week_start = $1`, [week]);
  } catch (e: any) {
    if (e?.code !== '42P01') throw e;
    migrationPending = true;
  }
  // Settled weeks show what was recorded at the time (rate, earnings, top-up); drivers added later show the live preview.
  const byId = new Map(rows.map((r) => [r.driver_id, r]));
  for (const p of settled) {
    const r: FloorRow = byId.get(p.driver_id) ?? {
      driver_id: p.driver_id, name: p.name, trips: p.trips, engaged_s: p.engaged_s, earnings_cents: p.earnings_cents,
      floor_cents: p.floor_cents, topup_cents: p.topup_cents, per_engaged_hour_cents: null,
    };
    r.paid_cents = p.topup_cents;
    r.paid_at = p.created_at;
    byId.set(p.driver_id, r);
  }
  const all = [...byId.values()].sort((a, b) => String(a.name ?? '').localeCompare(String(b.name ?? '')));
  const today = weekStartOf(new Date());
  return {
    week_start: week, week_end: addDays(week, 6), enabled: s.earnings_floor.enabled, auto_weekly: s.earnings_floor.auto_weekly,
    cents_per_engaged_hour: rate, week_over: addDays(week, 7) <= today, settled: settled.length > 0, migration_pending: migrationPending,
    rows: all,
    totals: {
      drivers: all.length, engaged_s: all.reduce((n, r) => n + r.engaged_s, 0),
      earnings_cents: all.reduce((n, r) => n + r.earnings_cents, 0),
      topup_cents: all.reduce((n, r) => n + (r.paid_cents ?? r.topup_cents), 0),
      drivers_topped_up: all.filter((r) => (r.paid_cents ?? r.topup_cents) > 0).length,
    },
  };
}

/** Pay the top-ups for a finished week. Safe to run twice (one row per driver per week; a second run pays nobody again). */
export async function runEarningsFloor(weekParam: string | null | undefined, actorId: string | null) {
  const week = parseWeek(weekParam);
  const s = await loadDriverPay();
  if (!s.earnings_floor.enabled) throw conflict('floor_off', 'The earnings floor is switched off (Pricing, Driver pay)');
  if (addDays(week, 7) > weekStartOf(new Date())) throw conflict('week_not_over', 'Top-ups can be paid once the week has ended (Sunday midnight, Darwin time)');
  const rate = s.earnings_floor.cents_per_engaged_hour;
  try {
    const paid = await tx(async (c: pg.PoolClient) => {
      await c.query(`SELECT pg_advisory_xact_lock(hashtext('earnings_floor'), hashtext($1))`, [week]);
      const rows = await floorRows(week, rate, c);
      const out: { driver_id: string; topup_cents: number; ref: string }[] = [];
      let recorded = 0;
      for (const r of rows) {
        const ins = await one(
          `INSERT INTO driver_pay_weeks (driver_id, week_start, trips, engaged_s, earnings_cents, rate_cents, floor_cents, topup_cents, run_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (driver_id, week_start) DO NOTHING RETURNING driver_id`,
          [r.driver_id, week, r.trips, r.engaged_s, r.earnings_cents, rate, r.floor_cents, r.topup_cents, actorId], c);
        if (!ins) continue;
        recorded++;
        if (r.topup_cents > 0) {
          const hours = (r.engaged_s / 3600).toFixed(1);
          const l = await one(
            `INSERT INTO driver_ledger (driver_id, kind, amount_cents, note) VALUES ($1,'earnings_floor',$2,$3) RETURNING id`,
            [r.driver_id, r.topup_cents, `Earnings floor, week of ${week}: ${hours} engaged h at $${(rate / 100).toFixed(2)}/h`], c);
          await c.query(`UPDATE driver_pay_weeks SET ledger_id = $3 WHERE driver_id = $1 AND week_start = $2`, [r.driver_id, week, l!.id]);
          out.push({ driver_id: r.driver_id, topup_cents: r.topup_cents, ref: week });
        }
      }
      if (actorId) {
        await c.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES ($1,'earnings_floor_run','driver_pay_weeks',$2,$3)`,
          [actorId, week, JSON.stringify({ recorded, topped_up: out.length, cents: out.reduce((n, x) => n + x.topup_cents, 0) })]);
      }
      return { recorded, out };
    });
    for (const p of paid.out) {
      void notify(p.driver_id, 'Earnings floor top-up', `$${(p.topup_cents / 100).toFixed(2)} added for the week of ${week}, so you earned at least $${(rate / 100).toFixed(2)} per engaged hour.`);
    }
    return { week_start: week, recorded: paid.recorded, drivers_topped_up: paid.out.length, topup_cents: paid.out.reduce((n, x) => n + x.topup_cents, 0) };
  } catch (e: any) {
    if (e?.code === '42P01') throw new ApiError(503, 'migration_pending', 'Earnings floor needs database migration 012 before top-ups can be paid');
    throw e;
  }
}

/** Called from the dispatch tick: when the floor and its automatic weekly run are on, settle last week (at most hourly per instance). */
let lastAuto = 0;
export async function autoEarningsFloor(now = Date.now()) {
  if (now - lastAuto < 3600_000) return;
  lastAuto = now;
  const s = await loadDriverPay();
  if (!s.earnings_floor.enabled || !s.earnings_floor.auto_weekly) return;
  await runEarningsFloor(weekStartOf(new Date(now - 7 * 864e5)), null).catch((e) => {
    if (!(e instanceof ApiError)) console.error('earnings floor', e);
  });
}

/** The driver's own week so far (earnings screen). */
export async function myFloorWeek(driverId: string) {
  const s = await loadDriverPay();
  const week = weekStartOf(new Date());
  const rate = s.earnings_floor.cents_per_engaged_hour;
  const [r] = await floorRows(week, rate, pool, driverId);
  return {
    enabled: s.earnings_floor.enabled, cents_per_engaged_hour: rate, week_start: week, week_end: addDays(week, 6),
    engaged_s: r?.engaged_s ?? 0, trips: r?.trips ?? 0, earnings_cents: r?.earnings_cents ?? 0,
    floor_cents: r?.floor_cents ?? 0, projected_topup_cents: s.earnings_floor.enabled ? (r?.topup_cents ?? 0) : 0,
    per_engaged_hour_cents: r?.per_engaged_hour_cents ?? null,
  };
}
