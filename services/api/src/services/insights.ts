/**
 * Round 27: owner insights — the business-health report, unit economics, supply vs demand, rider cohorts, the demand forecast and
 * driver plan, the pricing simulator and the weekly owner summary (JSON, PDF, email). Reads existing tables only (no migration);
 * the policy lives in the `insights_policy` setting. Test accounts (users.test_account) are left out unless asked for.
 */
import { isIsoDay } from '../lib/validate.js';
import { one, q } from '../db.js';
import { settingValue } from '../lib/cache.js';
import { bad, notFound } from '../lib/errors.js';
import { log, logError } from '../lib/log.js';
import { Pdf } from '../lib/pdf.js';
import { emailConfigured, escapeHtml, sendEmail } from '../lib/email.js';
import { audit } from '../lib/audit.js';
import { loadDriverPay } from '../lib/driverPay.js';
import type { FareRule } from '../lib/fares.js';
import { isPublicHoliday } from './trips.js';
import {
  DISCOUNT_LABEL, WEEKDAYS, discountKind, addDays, change, cohortTable, darwinDay, daysBetween, factorFor, forecast, mondayOf, pct, policyOf, round1,
  simulate, taxiFare, unitEconomics, weekdayOf, addMonths, type DiscountKind, type InsightsPolicy, type SimTrip,
} from '../lib/insights.js';

const TZ = `'Australia/Darwin'`;
const startOf = (n: string) => `((${n}::date)::timestamp AT TIME ZONE ${TZ})`;
const endOf = (n: string) => `(((${n}::date) + 1)::timestamp AT TIME ZONE ${TZ})`;
const KIND_SQL = `CASE WHEN t.kind = 'courier' THEN 'courier' WHEN t.service IN ('tour','hourly') THEN 'tours' ELSE 'rides' END`;
const DAY = { test: (s: string) => isIsoDay(s) };
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function loadPolicy(): Promise<InsightsPolicy> {
  return policyOf(await settingValue('insights_policy'));
}

export function periodOf(p: { from?: string; to?: string; days?: string | number }, defaultDays = 28) {
  const today = darwinDay(new Date());
  const to = p.to && DAY.test(p.to) ? p.to : addDays(today, -1);
  const days = Math.min(Math.max(Number(p.days) || defaultDays, 1), 366);
  const from = p.from && DAY.test(p.from) ? p.from : addDays(to, -(days - 1));
  if (from > to) throw bad('bad_range', 'Choose a start date before the end date');
  if (daysBetween(from, to) > 366) throw bad('bad_range', 'Choose up to a year');
  return { from, to, days: daysBetween(from, to) + 1 };
}

const n = (v: unknown) => Number(v ?? 0);

/** Everything about one period: requests and outcomes, money, drivers' time and pay, riders, mix, green km. */
async function periodStats(from: string, to: string, policy: InsightsPolicy, includeTest: boolean) {
  const P = [from, to, includeTest];
  const costs = JSON.stringify(policy.running_cost_cents_per_km);
  const cf = policy.card_fee;
  const rider = `JOIN users ru ON ru.id = t.rider_id AND (NOT ru.test_account OR $3)`;
  const [req, days, money, disc, cancels, refunds, points, online, riders] = await Promise.all([
    one(`SELECT count(*)::int requests,
              count(*) FILTER (WHERE t.status = 'completed')::int completed,
              count(*) FILTER (WHERE t.status = 'no_drivers')::int no_drivers,
              count(*) FILTER (WHERE t.status = 'cancelled_rider' AND t.accepted_at IS NULL)::int rider_gave_up,
              count(*) FILTER (WHERE t.status = 'cancelled_rider' AND t.accepted_at IS NOT NULL)::int rider_after_accept,
              count(*) FILTER (WHERE t.status = 'cancelled_driver')::int driver_cancelled,
              count(*) FILTER (WHERE t.status = 'cancelled_admin')::int ops_cancelled,
              avg(extract(epoch FROM t.accepted_at - t.requested_at)) FILTER (WHERE t.accepted_at >= t.requested_at)::float wait_s,
              avg(extract(epoch FROM t.arrived_at - t.accepted_at)) FILTER (WHERE t.arrived_at > t.accepted_at)::float pickup_s,
              (percentile_cont(0.9) WITHIN GROUP (ORDER BY extract(epoch FROM t.arrived_at - t.accepted_at)) FILTER (WHERE t.arrived_at > t.accepted_at))::float pickup_p90_s
         FROM trips t ${rider}
         WHERE coalesce(t.scheduled_for, t.requested_at) >= ${startOf('$1')} AND coalesce(t.scheduled_for, t.requested_at) < ${endOf('$2')}`, P),
    q(`SELECT to_char(coalesce(t.scheduled_for, t.requested_at) AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day, count(*)::int requests,
              count(*) FILTER (WHERE t.status = 'no_drivers' OR (t.status = 'cancelled_rider' AND t.accepted_at IS NULL))::int unfilled
         FROM trips t ${rider}
         WHERE coalesce(t.scheduled_for, t.requested_at) >= ${startOf('$1')} AND coalesce(t.scheduled_for, t.requested_at) < ${endOf('$2')} GROUP BY 1`, P),
    q(`WITH c AS (
           SELECT t.id, t.kind, t.service, t.payment_method, t.final_cents, t.tip_cents, t.fare_breakdown, t.accepted_at, t.completed_at,
                  ${KIND_SQL} AS mix, coalesce(t.actual_distance_m, t.est_distance_m) AS m, coalesce(v.fuel_type, 'other') AS fuel,
                  coalesce(v.fuel_type IN ('electric','plug_in_hybrid','hybrid'), false) AS green, v.fuel_type = 'electric' AS ev,
                  to_char(t.completed_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day
           FROM trips t ${rider} LEFT JOIN vehicles v ON v.id = t.vehicle_id
           WHERE t.status = 'completed' AND t.completed_at >= ${startOf('$1')} AND t.completed_at < ${endOf('$2')}),
         l AS (SELECT trip_id, sum(amount_cents) FILTER (WHERE kind = 'fare') fare, -sum(amount_cents) FILTER (WHERE kind = 'commission') fee,
                      sum(amount_cents) FILTER (WHERE kind = 'pickup_pay') pickup, sum(amount_cents) FILTER (WHERE kind = 'fuel_surcharge') fuel
               FROM driver_ledger WHERE trip_id IN (SELECT id FROM c) GROUP BY trip_id)
       SELECT c.day, c.mix, count(*)::int trips,
              sum(c.final_cents)::bigint gross, sum(coalesce((c.fare_breakdown->>'levy_cents')::int, 0))::bigint levy,
              sum(coalesce((c.fare_breakdown->>'guide_fee_cents')::int, 0))::bigint guide,
              sum(coalesce((c.fare_breakdown->>'booking_fee_cents')::int, 0))::bigint booking,
              sum(c.tip_cents)::bigint tips,
              sum(coalesce(l.fare, 0))::bigint fare, sum(coalesce(l.fee, 0))::bigint fee, sum(coalesce(l.pickup, 0))::bigint pickup, sum(coalesce(l.fuel, 0))::bigint fuel,
              sum(CASE WHEN c.payment_method = 'card' THEN
                    (CASE WHEN c.final_cents > 0 THEN round(c.final_cents * $4::numeric / 100) + $5 ELSE 0 END)
                  + (CASE WHEN c.tip_cents > 0 THEN round(c.tip_cents * $4::numeric / 100) + $5 ELSE 0 END) ELSE 0 END)::bigint card,
              sum(c.m)::bigint m, sum(c.m) FILTER (WHERE c.green)::bigint green_m, sum(c.m) FILTER (WHERE c.ev)::bigint ev_m,
              sum(coalesce(pk.m, $7::numeric * 1000))::bigint pickup_m,
              sum((c.m + coalesce(pk.m, $7::numeric * 1000)) / 1000.0 * coalesce(($6::jsonb ->> c.fuel)::numeric, ($6::jsonb ->> 'other')::numeric))::bigint running,
              sum(extract(epoch FROM c.completed_at - c.accepted_at)) FILTER (WHERE c.completed_at > c.accepted_at)::float engaged_s
       FROM c LEFT JOIN l ON l.trip_id = c.id
       LEFT JOIN LATERAL (SELECT (e.data->>'pickup_m')::numeric AS m FROM trip_events e WHERE e.trip_id = c.id AND e.type = 'accepted' AND e.data ? 'pickup_m'
                          AND e.data->>'pickup_m' IS NOT NULL ORDER BY e.at DESC LIMIT 1) pk ON true
       GROUP BY c.day, c.mix`, [...P, cf.pct, cf.fixed_cents, costs, policy.default_pickup_km]),
    q(`SELECT e->>'label' AS label, sum(-(e->>'cents')::int)::bigint cents
         FROM trips t ${rider}, jsonb_array_elements(coalesce(t.fare_breakdown->'lines', '[]'::jsonb)) e
        WHERE t.status = 'completed' AND t.completed_at >= ${startOf('$1')} AND t.completed_at < ${endOf('$2')} AND (e->>'cents')::int < 0
        GROUP BY 1`, P),
    one(`SELECT count(*)::int n, coalesce(sum(t.cancel_fee_cents), 0)::bigint fees,
                coalesce(sum((SELECT sum(amount_cents) FROM driver_ledger l WHERE l.trip_id = t.id AND l.kind = 'cancel_fee')), 0)::bigint driver_share,
                coalesce(sum(CASE WHEN t.payment_method = 'card' THEN round(t.cancel_fee_cents * $4::numeric / 100) + $5 ELSE 0 END), 0)::bigint card
         FROM trips t ${rider}
         WHERE t.status::text LIKE 'cancelled%' AND t.cancel_fee_cents > 0 AND t.cancelled_at >= ${startOf('$1')} AND t.cancelled_at < ${endOf('$2')}`, [...P, cf.pct, cf.fixed_cents]),
    one(`SELECT coalesce(-sum(p.amount_cents), 0)::bigint cents, count(*)::int n FROM payments p
         LEFT JOIN trips t ON t.id = p.trip_id LEFT JOIN users ru ON ru.id = coalesce(t.rider_id, p.user_id)
         WHERE p.kind = 'refund' AND p.status = 'succeeded' AND p.created_at >= ${startOf('$1')} AND p.created_at < ${endOf('$2')} AND (ru.id IS NULL OR NOT ru.test_account OR $3)`, P),
    one(`SELECT coalesce(sum(l.points), 0)::bigint issued FROM loyalty_ledger l JOIN users ru ON ru.id = l.user_id AND (NOT ru.test_account OR $3)
         WHERE l.points > 0 AND l.trip_id IS NOT NULL AND l.created_at >= ${startOf('$1')} AND l.created_at < ${endOf('$2')}`, P),
    one(`SELECT coalesce(sum(extract(epoch FROM least(coalesce(s.ended_at, now()), ${endOf('$2')}) - greatest(s.started_at, ${startOf('$1')}))), 0)::float online_s,
                count(DISTINCT s.driver_id)::int drivers_online
         FROM driver_online_sessions s JOIN users du ON du.id = s.driver_id AND (NOT du.test_account OR $3)
         WHERE s.started_at < ${endOf('$2')} AND coalesce(s.ended_at, now()) > ${startOf('$1')}`, P).catch(() => ({ online_s: 0, drivers_online: 0, missing: true })),
    one(`WITH r AS (SELECT t.rider_id, count(*)::int n FROM trips t ${rider}
                    WHERE t.status = 'completed' AND t.completed_at >= ${startOf('$1')} AND t.completed_at < ${endOf('$2')} GROUP BY t.rider_id)
         SELECT count(*)::int riders, count(*) FILTER (WHERE n >= 2)::int repeat_riders,
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM trips x WHERE x.rider_id = r.rider_id AND x.status = 'completed' AND x.completed_at < ${startOf('$1')}))::int returning_riders,
                (SELECT count(DISTINCT t.driver_id)::int FROM trips t ${rider} WHERE t.status = 'completed' AND t.completed_at >= ${startOf('$1')} AND t.completed_at < ${endOf('$2')}) drivers_active
         FROM r`, P),
  ]);

  // Totals and per-day series from the per (day, mix) money rows.
  const T = { trips: 0, gross: 0, levy: 0, guide: 0, booking: 0, tips: 0, fare: 0, fee: 0, pickup: 0, fuel: 0, card: 0, m: 0, green_m: 0, ev_m: 0, pickup_m: 0, running: 0, engaged_s: 0 };
  const mix: Record<string, { trips: number; gross_cents: number; km: number }> = { rides: { trips: 0, gross_cents: 0, km: 0 }, courier: { trips: 0, gross_cents: 0, km: 0 }, tours: { trips: 0, gross_cents: 0, km: 0 } };
  const perDay = new Map<string, { completed: number; gross: number; kept: number; rides: number; courier: number; tours: number }>();
  for (const r of money) {
    for (const k of Object.keys(T) as (keyof typeof T)[]) T[k] += n(r[k]);
    const mx = mix[r.mix] ?? (mix[r.mix] = { trips: 0, gross_cents: 0, km: 0 });
    mx.trips += n(r.trips); mx.gross_cents += n(r.gross); mx.km += n(r.m) / 1000;
    const d = perDay.get(r.day) ?? { completed: 0, gross: 0, kept: 0, rides: 0, courier: 0, tours: 0 };
    d.completed += n(r.trips); d.gross += n(r.gross);
    d.kept += n(r.gross) - n(r.levy) - n(r.guide) - (n(r.fare) - n(r.fee) + n(r.pickup) + n(r.fuel));
    (d as any)[r.mix] = ((d as any)[r.mix] ?? 0) + n(r.trips);
    perDay.set(r.day, d);
  }
  const discounts: Record<DiscountKind, number> = { promo: 0, points: 0, pass: 0, business: 0, concession: 0 };
  for (const r of disc) discounts[discountKind(String(r.label))] += n(r.cents);
  const discountTotal = Object.values(discounts).reduce((s, x) => s + x, 0);

  const driverPay = T.fare - T.fee + T.pickup + T.fuel + n(cancels!.driver_share);
  const cancelKept = n(cancels!.fees) - n(cancels!.driver_share);
  const gross = T.gross + n(cancels!.fees);
  const kept = gross - T.levy - T.guide - driverPay;
  const gst = Math.round(Math.max(0, kept) / 11);
  const card = T.card + n(cancels!.card);
  const refundsCents = n(refunds!.cents);
  const net = kept - gst - card - refundsCents;
  const base = gross - T.levy - T.guide;
  const onlineH = n((online as any).online_s) / 3600;
  const engagedH = T.engaged_s / 3600;
  const earnings = driverPay + T.tips;
  const afterCosts = earnings - T.running;

  const requests = n(req!.requests);
  const unfilled = n(req!.no_drivers) + n(req!.rider_gave_up);
  const dayList: { day: string; requests: number; unfilled: number; completed: number; rides: number; courier: number; tours: number; gross_cents: number; kept_cents: number }[] = [];
  const reqByDay = new Map(days.map((d: any) => [d.day, d]));
  for (let i = 0; i <= daysBetween(from, to); i++) {
    const d = addDays(from, i);
    const m = perDay.get(d); const r: any = reqByDay.get(d);
    dayList.push({ day: d, requests: n(r?.requests), unfilled: n(r?.unfilled), completed: m?.completed ?? 0, rides: m?.rides ?? 0, courier: m?.courier ?? 0, tours: m?.tours ?? 0,
      gross_cents: m?.gross ?? 0, kept_cents: m?.kept ?? 0 });
  }
  const completed = T.trips;
  const per = (c: number) => (completed ? Math.round(c / completed) : null);
  return {
    from, to, days: daysBetween(from, to) + 1,
    trips: {
      requests, completed, per_day: round1(completed / (daysBetween(from, to) + 1)),
      completion_pct: pct(n(req!.completed), requests),
      unfilled, unfilled_pct: pct(unfilled, requests), no_drivers: n(req!.no_drivers), rider_gave_up: n(req!.rider_gave_up),
      cancellations: {
        rider_before_accept: n(req!.rider_gave_up), rider_after_accept: n(req!.rider_after_accept), driver: n(req!.driver_cancelled), ops: n(req!.ops_cancelled),
        rate_pct: pct(n(req!.rider_gave_up) + n(req!.rider_after_accept) + n(req!.driver_cancelled) + n(req!.ops_cancelled), requests),
        rider_pct: pct(n(req!.rider_gave_up) + n(req!.rider_after_accept), requests), driver_pct: pct(n(req!.driver_cancelled), requests),
        fees_charged: n(cancels!.n), fees_cents: n(cancels!.fees),
      },
      avg_wait_to_accept_min: req!.wait_s == null ? null : round1(req!.wait_s / 60),
      avg_pickup_min: req!.pickup_s == null ? null : round1(req!.pickup_s / 60),
      p90_pickup_min: req!.pickup_p90_s == null ? null : round1(req!.pickup_p90_s / 60),
    },
    money: {
      gross_cents: gross, levy_cents: T.levy, guide_fees_cents: T.guide, tips_cents: T.tips,
      driver_pay_cents: driverPay, service_fees_cents: T.fee, booking_fees_cents: T.booking, cancel_fees_kept_cents: cancelKept,
      discounts, discounts_cents: discountTotal, kept_cents: kept, gst_cents: gst, card_fees_cents: card, refunds_cents: refundsCents, net_cents: net,
      take_rate_pct: pct(kept, base), net_margin_pct: pct(net, base),
      points_issued: n(points!.issued), points_issued_cents: n(points!.issued),
      per_trip: {
        rider_paid_cents: per(T.gross), levy_cents: per(T.levy), driver_pay_cents: per(T.fare - T.fee + T.pickup + T.fuel), service_fee_cents: per(T.fee),
        booking_fee_cents: per(T.booking), discounts_cents: per(discountTotal), card_fees_cents: per(T.card), gst_cents: per(gst), kept_cents: per(kept), net_cents: per(net),
      },
    },
    drivers: {
      active: n(riders!.drivers_active), online: n((online as any).drivers_online), online_hours: round1(onlineH), engaged_hours: round1(engagedH),
      utilisation_pct: onlineH > 0 ? pct(engagedH, onlineH) : null,
      earnings_cents: earnings, running_costs_cents: T.running, after_costs_cents: afterCosts,
      per_online_hour_cents: onlineH > 0 ? Math.round(afterCosts / onlineH) : null,
      per_engaged_hour_cents: engagedH > 0 ? Math.round(afterCosts / engagedH) : null,
      km: Math.round(T.m / 1000), pickup_km: Math.round(T.pickup_m / 1000),
      online_data: !(online as any).missing,
    },
    riders: {
      active: n(riders!.riders), repeat: n(riders!.repeat_riders), repeat_pct: pct(n(riders!.repeat_riders), n(riders!.riders)),
      returning: n(riders!.returning_riders), returning_pct: pct(n(riders!.returning_riders), n(riders!.riders)), new: n(riders!.riders) - n(riders!.returning_riders),
    },
    mix: Object.entries(mix).map(([k, v]) => ({ kind: k, trips: v.trips, share_pct: pct(v.trips, completed), gross_cents: v.gross_cents, km: Math.round(v.km) })),
    green: { km: Math.round(T.m / 1000), green_km: Math.round(T.green_m / 1000), ev_km: Math.round(T.ev_m / 1000), green_km_pct: pct(T.green_m, T.m) },
    daily: dayList,
  };
}

/** Business health for a period with the previous period of the same length alongside, and the changes that matter. */
export async function healthReport(p: { from?: string; to?: string; days?: string | number; include_test?: string | boolean }) {
  const { from, to, days } = periodOf(p);
  const policy = await loadPolicy();
  const includeTest = p.include_test === true || p.include_test === 'true';
  const prevTo = addDays(from, -1), prevFrom = addDays(prevTo, -(days - 1));
  const [now, prev] = await Promise.all([periodStats(from, to, policy, includeTest), periodStats(prevFrom, prevTo, policy, includeTest)]);
  return {
    ...now, include_test: includeTest,
    previous: { from: prevFrom, to: prevTo, trips: prev.trips, money: prev.money, drivers: prev.drivers, riders: prev.riders, green: prev.green },
    changes: {
      completed_pct: change(now.trips.completed, prev.trips.completed), gross_pct: change(now.money.gross_cents, prev.money.gross_cents),
      kept_pct: change(now.money.kept_cents, prev.money.kept_cents), net_pct: change(now.money.net_cents, prev.money.net_cents),
      unfilled_pts: now.trips.unfilled_pct == null || prev.trips.unfilled_pct == null ? null : round1(now.trips.unfilled_pct - prev.trips.unfilled_pct),
      per_online_hour_pct: change(now.drivers.per_online_hour_cents, prev.drivers.per_online_hour_cents),
    },
    assumptions: {
      card_fee: policy.card_fee, running_cost_cents_per_km: policy.running_cost_cents_per_km, default_pickup_km: policy.default_pickup_km,
      notes: [
        'DingoGo keeps what riders paid less the levy, guide fees and drivers’ pay; GST is estimated as 1/11 of that.',
        'Card fees are an estimate from the policy rate, not Stripe’s statement.',
        'Driver running costs cover trip and pickup km only (fuel or charging, tyres, servicing); not depreciation, insurance or driving between trips.',
      ],
    },
  };
}

/** Unit economics of one trip (admin trip drawer). */
export async function tripEconomics(id: string) {
  if (!UUID.test(id)) throw notFound('Trip');
  const t = await one(`SELECT id, ref, kind, service, status, payment_method, final_cents, tip_cents, cancel_fee_cents, fare_breakdown,
                              coalesce(actual_distance_m, est_distance_m) AS m, accepted_at, completed_at, vehicle_id FROM trips WHERE id = $1`, [id]);
  if (!t) throw notFound('Trip');
  const policy = await loadPolicy();
  const [ledger, pts, ref, car, pk] = await Promise.all([
    q(`SELECT kind, amount_cents FROM driver_ledger WHERE trip_id = $1`, [id]),
    one(`SELECT coalesce(sum(points), 0)::int n FROM loyalty_ledger WHERE trip_id = $1 AND points > 0`, [id]),
    one(`SELECT coalesce(-sum(amount_cents), 0)::int n FROM payments WHERE trip_id = $1 AND kind = 'refund' AND status = 'succeeded'`, [id]),
    t.vehicle_id ? one(`SELECT fuel_type FROM vehicles WHERE id = $1`, [t.vehicle_id]) : Promise.resolve(null),
    one(`SELECT (data->>'pickup_m')::int AS m FROM trip_events WHERE trip_id = $1 AND type = 'accepted' AND data->>'pickup_m' IS NOT NULL ORDER BY at DESC LIMIT 1`, [id]),
  ]);
  const e = unitEconomics(t as any, ledger as any, { policy, pointsIssued: pts!.n, refundsCents: ref!.n });
  const km = (n(t.m) + (pk?.m ?? policy.default_pickup_km * 1000)) / 1000;
  const fuel = (car?.fuel_type ?? 'other') as keyof InsightsPolicy['running_cost_cents_per_km'];
  const running = t.status === 'completed' ? Math.round(km * (policy.running_cost_cents_per_km[fuel] ?? policy.running_cost_cents_per_km.other)) : 0;
  const engagedMin = t.completed_at && t.accepted_at ? (new Date(t.completed_at).getTime() - new Date(t.accepted_at).getTime()) / 60e3 : null;
  const driverAfter = e.driver.pay_cents + e.tip_cents - running;
  return {
    trip: { id: t.id, ref: t.ref, status: t.status, kind: t.kind, service: t.service, payment_method: t.payment_method },
    ...e,
    driver_costs: { km: round1(km), pickup_km: round1((pk?.m ?? policy.default_pickup_km * 1000) / 1000), running_cost_cents: running, fuel_type: car?.fuel_type ?? null,
      after_costs_cents: driverAfter, engaged_min: engagedMin == null ? null : round1(engagedMin),
      per_engaged_hour_cents: engagedMin && engagedMin > 0 ? Math.round(driverAfter / (engagedMin / 60)) : null },
    discount_labels: DISCOUNT_LABEL,
  };
}

/** Requests, unfilled requests and drivers online by weekday and hour, averaged per week over the last `weeks` whole weeks. */
export async function supplyDemand(p: { weeks?: string | number; include_test?: string | boolean }) {
  const weeks = Math.min(Math.max(Math.round(Number(p.weeks) || 8), 1), 26);
  const includeTest = p.include_test === true || p.include_test === 'true';
  const to = addDays(mondayOf(darwinDay(new Date())), -1);   // last Sunday
  const from = addDays(to, -(weeks * 7 - 1));
  const P = [from, to, includeTest];
  const [demand, supply] = await Promise.all([
    q(`SELECT (extract(isodow FROM coalesce(t.scheduled_for, t.requested_at) AT TIME ZONE ${TZ})::int - 1) AS wd,
              extract(hour FROM coalesce(t.scheduled_for, t.requested_at) AT TIME ZONE ${TZ})::int AS h, count(*)::int requests,
              count(*) FILTER (WHERE t.status = 'completed')::int completed,
              count(*) FILTER (WHERE t.status = 'no_drivers' OR (t.status = 'cancelled_rider' AND t.accepted_at IS NULL))::int unfilled
       FROM trips t JOIN users ru ON ru.id = t.rider_id AND (NOT ru.test_account OR $3)
       WHERE coalesce(t.scheduled_for, t.requested_at) >= ${startOf('$1')} AND coalesce(t.scheduled_for, t.requested_at) < ${endOf('$2')} GROUP BY 1, 2`, P),
    usualOnlineGrid(from, to, includeTest),
  ]);
  const cells: { weekday: number; hour: number; requests: number; completed: number; unfilled: number; online: number; requests_per_driver: number | null }[] = [];
  for (let wd = 0; wd < 7; wd++) for (let h = 0; h < 24; h++) {
    const d: any = demand.find((x: any) => x.wd === wd && x.h === h);
    const req = n(d?.requests) / weeks, unf = n(d?.unfilled) / weeks, online = supply.grid[wd][h];
    cells.push({ weekday: wd, hour: h, requests: round1(req), completed: round1(n(d?.completed) / weeks), unfilled: round1(unf), online: round1(online),
      requests_per_driver: online > 0 ? round1(req / online) : null });
  }
  const busiest = [...cells].sort((a, b) => b.requests - a.requests).slice(0, 5);
  const short = [...cells].filter((c) => c.unfilled > 0).sort((a, b) => b.unfilled - a.unfilled || b.requests - a.requests).slice(0, 5);
  return { from, to, weeks, cells, busiest, shortest: short, online_data: supply.ok, weekdays: WEEKDAYS };
}

/** Average drivers online per weekday and hour across [from, to] from online sessions (each session split into the hours it covers). */
async function usualOnlineGrid(from: string, to: string, includeTest: boolean) {
  const grid = Array.from({ length: 7 }, () => new Array(24).fill(0));
  const weeks = (daysBetween(from, to) + 1) / 7;
  try {
    const rows = await q(
      `WITH s AS (SELECT greatest(s.started_at, ${startOf('$1')}) AS a, least(coalesce(s.ended_at, now()), ${endOf('$2')}) AS b
                  FROM driver_online_sessions s JOIN users du ON du.id = s.driver_id AND (NOT du.test_account OR $3)
                  WHERE s.started_at < ${endOf('$2')} AND coalesce(s.ended_at, now()) > ${startOf('$1')}),
            h AS (SELECT s.a, s.b, g AS hr FROM s, generate_series(date_trunc('hour', s.a), s.b, interval '1 hour') g)
       SELECT (extract(isodow FROM hr AT TIME ZONE ${TZ})::int - 1) AS wd, extract(hour FROM hr AT TIME ZONE ${TZ})::int AS h,
              sum(extract(epoch FROM least(b, hr + interval '1 hour') - greatest(a, hr)))::float / 3600 AS driver_hours
       FROM h WHERE least(b, hr + interval '1 hour') > greatest(a, hr) GROUP BY 1, 2`, [from, to, includeTest]);
    for (const r of rows) grid[r.wd][r.h] = n(r.driver_hours) / weeks;
    return { grid, ok: true };
  } catch (e) {
    logError('insights online grid', e);
    return { grid, ok: false };
  }
}

/** Monthly rider cohorts (first completed trip) for the last `months` months, with the share still riding each month after. */
export async function cohorts(p: { months?: string | number; include_test?: string | boolean }) {
  const months = Math.min(Math.max(Math.round(Number(p.months) || 6), 1), 12);
  const includeTest = p.include_test === true || p.include_test === 'true';
  const current = darwinDay(new Date()).slice(0, 7);
  const first = addMonths(current, -(months - 1));
  const rows = await q(
    `WITH f AS (SELECT t.rider_id, min(to_char(t.completed_at AT TIME ZONE ${TZ}, 'YYYY-MM')) AS cohort
                FROM trips t JOIN users ru ON ru.id = t.rider_id AND (NOT ru.test_account OR $2)
                WHERE t.status = 'completed' GROUP BY t.rider_id),
          a AS (SELECT DISTINCT t.rider_id, to_char(t.completed_at AT TIME ZONE ${TZ}, 'YYYY-MM') AS month FROM trips t WHERE t.status = 'completed')
     SELECT f.cohort, a.month, count(*)::int riders FROM f JOIN a ON a.rider_id = f.rider_id WHERE f.cohort >= $1 GROUP BY 1, 2`, [first, includeTest]);
  return { months, current, first, cohorts: cohortTable(rows as any, current, months) };
}

async function holidaysMap(from: string, to: string) {
  const rows = await q(`SELECT to_char(day, 'YYYY-MM-DD') AS day, name FROM public_holidays WHERE day BETWEEN $1 AND $2`, [from, to]);
  return new Map<string, string>(rows.map((r: any) => [r.day, r.name]));
}

/** Accept → end of trip, in minutes, over recent completed trips (25 when there is no history). */
async function minutesPerTrip(includeTest: boolean) {
  const r = await one(`SELECT avg(extract(epoch FROM t.completed_at - t.accepted_at))::float s, count(*)::int n FROM trips t
                       JOIN users ru ON ru.id = t.rider_id AND (NOT ru.test_account OR $1)
                       WHERE t.status = 'completed' AND t.completed_at > now() - interval '56 days' AND t.completed_at > t.accepted_at`, [includeTest]);
  return r && r.n >= 10 && r.s > 0 ? Math.min(r.s / 60, 120) : 25;
}

/** Demand forecast and driver plan for the next `days` days (from tomorrow, or `start`), from the last 8 whole weeks. */
export async function demandForecast(p: { days?: string | number; start?: string; weeks?: string | number; include_test?: string | boolean }) {
  const days = Math.min(Math.max(Math.round(Number(p.days) || 14), 1), 42);
  const weeks = Math.min(Math.max(Math.round(Number(p.weeks) || 8), 2), 26);
  const includeTest = p.include_test === true || p.include_test === 'true';
  const today = darwinDay(new Date());
  const start = p.start && DAY.test(p.start) ? p.start : addDays(today, 1);
  const historyTo = addDays(today, -1);
  const historyFrom = addDays(historyTo, -(weeks * 7 - 1));
  const policy = await loadPolicy();
  const [history, holidays, mpt, online] = await Promise.all([
    q(`SELECT to_char(coalesce(t.scheduled_for, t.requested_at) AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day,
              extract(hour FROM coalesce(t.scheduled_for, t.requested_at) AT TIME ZONE ${TZ})::int AS hour, count(*)::int n
       FROM trips t JOIN users ru ON ru.id = t.rider_id AND (NOT ru.test_account OR $3)
       WHERE coalesce(t.scheduled_for, t.requested_at) >= ${startOf('$1')} AND coalesce(t.scheduled_for, t.requested_at) < ${endOf('$2')}
         AND t.status <> 'scheduled' GROUP BY 1, 2`, [historyFrom, historyTo, includeTest]),
    holidaysMap(historyFrom, addDays(start, days)),
    minutesPerTrip(includeTest),
    usualOnlineGrid(addDays(historyTo, -27), historyTo, includeTest),
  ]);
  // Bookings already made for the forecast days (a floor under the forecast for that hour).
  const booked = await q(`SELECT to_char(t.scheduled_for AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day, extract(hour FROM t.scheduled_for AT TIME ZONE ${TZ})::int AS hour, count(*)::int n
                          FROM trips t WHERE t.status = 'scheduled' AND t.scheduled_for >= ${startOf('$1')} AND t.scheduled_for < ${endOf('$2')} GROUP BY 1, 2`,
    [start, addDays(start, days - 1)]);
  const f = forecast({ history: history as any, historyFrom, historyTo, start, days, policy, holidays, minutesPerTrip: mpt, usualOnline: online.ok ? online.grid : undefined });
  for (const b of booked) {
    const d = f.days.find((x) => x.date === b.day); const h = d?.hours[b.hour];
    if (h) h.booked = b.n;
  }
  const events = policy.seasonality.events.filter((e) => e.to >= start && e.from <= addDays(start, days - 1));
  return {
    ...f, start, history: { from: historyFrom, to: historyTo, weeks, requests: history.reduce((s: number, r: any) => s + n(r.n), 0) },
    online_data: online.ok, target_utilisation_pct: policy.target_utilisation_pct, min_drivers_online: policy.min_drivers_online,
    service_hours: policy.service_hours, events,
    unconfirmed: [...policy.seasonality.school_holidays.ranges, ...policy.seasonality.events].filter((x) => !x.confirmed && x.to >= start).map((x) => x.name),
  };
}

// ───────────── Pricing simulator ─────────────
const RULE_KEYS = ['base_cents', 'per_km_cents', 'per_min_cents', 'booking_fee_cents', 'min_fare_cents', 'night_pct'] as const;

export async function simulatePricing(b: {
  service: string; days: number; elasticity: number; fee_pct?: number | null;
  proposed: Partial<Record<(typeof RULE_KEYS)[number], number>>; include_test?: boolean;
}) {
  const rule = await one<FareRule & { active: boolean }>(`SELECT * FROM fare_rules WHERE service = $1`, [b.service]);
  if (!rule) throw notFound('Service');
  if (rule.service === 'tour' || rule.service === 'hourly') throw bad('not_metered', 'Tours and hourly hire have package prices, not per-km fares');
  const policy = await loadPolicy();
  const pay = await loadDriverPay();
  const feeNow = pay.service_fee.own_car_pct;
  const proposed: FareRule = { ...rule };
  for (const k of RULE_KEYS) if (b.proposed[k] != null) (proposed as any)[k] = b.proposed[k];
  const to = addDays(darwinDay(new Date()), -1), from = addDays(to, -(b.days - 1));
  const rows = await q(
    `SELECT coalesce(t.actual_distance_m, t.est_distance_m) AS m, t.est_duration_s AS s, coalesce(t.started_at, t.requested_at) AS at,
            EXISTS (SELECT 1 FROM public_holidays h WHERE h.day = (coalesce(t.started_at, t.requested_at) AT TIME ZONE ${TZ})::date) AS holiday
     FROM trips t JOIN users ru ON ru.id = t.rider_id AND (NOT ru.test_account OR $4)
     WHERE t.status = 'completed' AND t.service = $3 AND t.completed_at >= ${startOf('$1')} AND t.completed_at < ${endOf('$2')}
     ORDER BY t.completed_at DESC LIMIT 5000`, [from, to, b.service, !!b.include_test]);
  const trips: SimTrip[] = rows.map((r: any) => ({ distance_m: n(r.m), duration_s: n(r.s), at: new Date(r.at), holiday: !!r.holiday }));
  const mpt = await minutesPerTrip(!!b.include_test);
  const out = simulate({ rule, proposed, feePct: feeNow, proposedFeePct: b.fee_pct ?? feeNow, tariff: policy.taxi_tariff, trips, elasticity: b.elasticity, minutesPerTrip: mpt });
  return {
    service: rule.service, from, to, minutes_per_trip: round1(mpt), fee_pct: { now: feeNow, proposed: b.fee_pct ?? feeNow },
    rule: Object.fromEntries(RULE_KEYS.map((k) => [k, (rule as any)[k]])), proposed_rule: Object.fromEntries(RULE_KEYS.map((k) => [k, (proposed as any)[k]])),
    taxi_tariff: policy.taxi_tariff, ...out,
    note: 'List prices: no promos, Pass or points, demand multiplier or long-pickup charge. Driver pay is the fare less the service fee (own-car rate).',
  };
}

/** Taxi comparison for the website estimator (public): the metered fare for this distance now. */
export async function taxiComparison(km: number, at = new Date()) {
  const policy = await loadPolicy();
  const holiday = await isPublicHoliday(at);
  const t = taxiFare(km, at, holiday, policy.taxi_tariff);
  return { cents: t.cents, tariff: t.tariff, source: policy.taxi_tariff.source };
}

// ───────────── Weekly owner summary ─────────────
export function weekOf(p: { week?: string }) {
  const lastMonday = addDays(mondayOf(darwinDay(new Date())), -7);
  const week = p.week && DAY.test(p.week) ? mondayOf(p.week) : lastMonday;
  if (week > lastMonday) throw bad('week_not_finished', 'Choose a week that has finished');
  return week;
}

export async function weeklySummary(week: string) {
  const to = addDays(week, 6);
  const h = await healthReport({ from: week, to });
  // The week ahead: from the day after the summary week, or today if that has passed.
  const today = darwinDay(new Date());
  const fc = await demandForecast({ days: 7, start: addDays(to, 1) > today ? addDays(to, 1) : today });
  const busiest = h.daily.reduce((a, b) => (b.completed > a.completed ? b : a), h.daily[0]);
  const watch: string[] = [];
  if ((h.trips.unfilled_pct ?? 0) >= 5) watch.push(`${h.trips.unfilled} requests (${h.trips.unfilled_pct}%) went unfilled: no driver found or the rider gave up waiting.`);
  if ((h.trips.avg_pickup_min ?? 0) >= 10) watch.push(`Average pickup took ${h.trips.avg_pickup_min} minutes.`);
  if ((h.trips.cancellations.driver_pct ?? 0) >= 3) watch.push(`Drivers cancelled ${h.trips.cancellations.driver_pct}% of requests.`);
  if (h.drivers.per_online_hour_cents != null && h.drivers.per_online_hour_cents < 2500) watch.push(`Drivers made ${money(h.drivers.per_online_hour_cents)} per online hour after running costs.`);
  if (h.money.net_cents < 0) watch.push('DingoGo’s net contribution was below zero: discounts, card fees and refunds were more than fees kept.');
  const short = fc.days.flatMap((d) => d.hours.filter((x) => x.gap != null && x.gap >= 1).map((x) => ({ date: d.date, weekday: d.weekday, hour: x.hour, gap: x.gap!, needed: x.drivers_needed })))
    .sort((a, b) => b.gap - a.gap).slice(0, 5);
  if (short.length) watch.push(`Next week ${short.length === 5 ? 'at least 5 hours' : `${short.length} hour${short.length > 1 ? 's' : ''}`} may need more drivers than usually go online.`);
  if (fc.unconfirmed.length) watch.push(`Check the dates for: ${fc.unconfirmed.slice(0, 4).join(', ')} (Insights → Settings).`);
  return {
    week, to, health: h, busiest_day: busiest ? { day: busiest.day, completed: busiest.completed } : null,
    next_week: { from: fc.days[0]?.date, to: fc.days[fc.days.length - 1]?.date, trips: round1(fc.days.reduce((s, d) => s + d.trips, 0)),
      peak_drivers: Math.max(0, ...fc.days.map((d) => d.peak_drivers)), events: fc.events.map((e) => e.name), short_hours: short,
      days: fc.days.map((d) => ({ date: d.date, weekday: d.weekday, trips: d.trips, peak_hour: d.peak_hour, peak_drivers: d.peak_drivers, reasons: d.reasons })) },
    watch,
  };
}

const money = (c: number | null | undefined) => (c == null ? '—' : `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toFixed(2)}`);
const ch = (v: number | null, unit = '%') => (v == null ? '' : ` (${v > 0 ? '+' : v < 0 ? '−' : ''}${Math.abs(v)}${unit} on the week before)`);
const hourName = (h: number) => (h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`);
const dayName = (d: string) => new Date(d + 'T00:00:00Z').toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' });

/** The summary as label/value rows (shared by the PDF, the email and its plain-text part). */
function summaryRows(s: Awaited<ReturnType<typeof weeklySummary>>) {
  const h = s.health;
  return {
    headline: [
      ['Trips completed', `${h.trips.completed}${ch(h.changes.completed_pct)}`],
      ['Requests', `${h.trips.requests} (${h.trips.unfilled_pct ?? 0}% unfilled)`],
      ['Riders paid (incl. levy)', `${money(h.money.gross_cents)}${ch(h.changes.gross_pct)}`],
      ['DingoGo kept', `${money(h.money.kept_cents)} (take rate ${h.money.take_rate_pct ?? 0}%)${ch(h.changes.kept_pct)}`],
      ['Net contribution', `${money(h.money.net_cents)} after GST, card fees and refunds${ch(h.changes.net_pct)}`],
      ['Paid to drivers', `${money(h.money.driver_pay_cents)} plus ${money(h.money.tips_cents)} tips`],
    ] as [string, string][],
    service: [
      ['Average wait for a driver to accept', h.trips.avg_wait_to_accept_min == null ? '—' : `${h.trips.avg_wait_to_accept_min} min`],
      ['Average pickup time', h.trips.avg_pickup_min == null ? '—' : `${h.trips.avg_pickup_min} min (9 in 10 within ${h.trips.p90_pickup_min} min)`],
      ['Cancellations', `${h.trips.cancellations.rate_pct ?? 0}% (riders ${h.trips.cancellations.rider_pct ?? 0}%, drivers ${h.trips.cancellations.driver_pct ?? 0}%)`],
      ['Drivers who drove', `${h.drivers.active}; ${h.drivers.online_hours} hours online, ${h.drivers.utilisation_pct ?? 0}% of it on trips`],
      ['Driver pay per online hour', `${money(h.drivers.per_online_hour_cents)} after running costs`],
      ['Riders', `${h.riders.active} (${h.riders.new} new, ${h.riders.repeat_pct ?? 0}% rode more than once)`],
      ['Courier share of trips', `${h.mix.find((m) => m.kind === 'courier')?.share_pct ?? 0}%`],
      ['Km in electric or hybrid cars', `${h.green.green_km_pct ?? 0}% of ${h.green.km} km`],
    ] as [string, string][],
    next: <[string, string][]>[
      ['Forecast trips', `${s.next_week.trips} (${dayName(s.next_week.from)} to ${dayName(s.next_week.to)})`],
      ['Most drivers needed at once', String(s.next_week.peak_drivers)],
      ...(s.next_week.events.length ? [['Events', s.next_week.events.join(', ')] as [string, string]] : []),
      ...s.next_week.short_hours.map((x) => [`Short of drivers ${dayName(x.date)} ${hourName(x.hour)}`, `need ${x.needed}, about ${x.gap} more than usual`] as [string, string]),
    ],
  };
}

export function weeklyPdf(s: Awaited<ReturnType<typeof weeklySummary>>) {
  const r = summaryRows(s);
  const pdf = new Pdf(`DingoGo week of ${s.week}`, `DingoGo owner summary, week of ${dayName(s.week)}`);
  pdf.heading(`DingoGo week in review: ${dayName(s.week)} to ${dayName(s.to)}`);
  pdf.para('Darwin time. Test accounts are left out. Card fees, GST and driver running costs are estimates (see Insights → Settings).', 8.5);
  pdf.heading('The week', 12); pdf.rows(r.headline);
  pdf.heading('Service and drivers', 12); pdf.rows(r.service);
  pdf.heading('Per completed trip', 12);
  const t = s.health.money.per_trip;
  pdf.rows([['Rider paid', money(t.rider_paid_cents)], ['NT levy', money(t.levy_cents)], ['Driver pay', money(t.driver_pay_cents)], ['Service fee', money(t.service_fee_cents)],
    ['Booking fee', money(t.booking_fee_cents)], ['Discounts funded by DingoGo', money(t.discounts_cents)], ['Card fees (estimate)', money(t.card_fees_cents)],
    ['GST (estimate)', money(t.gst_cents)], ['DingoGo kept', money(t.kept_cents)], ['Net contribution', money(t.net_cents)]], { boldLast: true });
  pdf.heading('Each day', 12);
  pdf.table([{ label: 'Day', width: 0.28 }, { label: 'Requests', width: 0.14, align: 'right' }, { label: 'Unfilled', width: 0.14, align: 'right' },
    { label: 'Completed', width: 0.14, align: 'right' }, { label: 'Riders paid', width: 0.15, align: 'right' }, { label: 'Kept', width: 0.15, align: 'right' }],
    s.health.daily.map((d) => [dayName(d.day), String(d.requests), String(d.unfilled), String(d.completed), money(d.gross_cents), money(d.kept_cents)]));
  pdf.heading('Next week', 12); pdf.rows(r.next);
  if (s.watch.length) { pdf.heading('Worth a look', 12); for (const w of s.watch) pdf.para(`• ${w}`); }
  return pdf.toBuffer();
}

export function weeklyEmail(s: Awaited<ReturnType<typeof weeklySummary>>) {
  const r = summaryRows(s);
  const subject = `DingoGo week of ${dayName(s.week)}: ${s.health.trips.completed} trips, ${money(s.health.money.kept_cents)} kept`;
  const table = (rows: [string, string][]) => `<table cellpadding="6" style="border-collapse:collapse;font:14px/1.4 Arial,sans-serif;color:#1d1a17">${rows.map(([k, v]) =>
    `<tr><td style="border-bottom:1px solid #e6ded3;color:#5c5349">${escapeHtml(k)}</td><td style="border-bottom:1px solid #e6ded3;font-weight:bold">${escapeHtml(v)}</td></tr>`).join('')}</table>`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px;background:#faf6f0">
<h1 style="font:bold 20px Arial,sans-serif;color:#1d1a17;margin:0 0 4px">DingoGo week in review</h1>
<p style="font:14px Arial,sans-serif;color:#5c5349;margin:0 0 16px">${escapeHtml(dayName(s.week))} to ${escapeHtml(dayName(s.to))}, Darwin time. The PDF has every day.</p>
<h2 style="font:bold 16px Arial,sans-serif;color:#1d1a17">The week</h2>${table(r.headline)}
<h2 style="font:bold 16px Arial,sans-serif;color:#1d1a17">Service and drivers</h2>${table(r.service)}
<h2 style="font:bold 16px Arial,sans-serif;color:#1d1a17">Next week</h2>${table(r.next)}
${s.watch.length ? `<h2 style="font:bold 16px Arial,sans-serif;color:#1d1a17">Worth a look</h2><ul style="font:14px/1.5 Arial,sans-serif;color:#1d1a17">${s.watch.map((w) => `<li>${escapeHtml(w)}</li>`).join('')}</ul>` : ''}
<p style="font:12px Arial,sans-serif;color:#5c5349;margin-top:20px">Card fees, GST and driver running costs are estimates. Change the settings or stop these emails in the admin console: Insights → Settings.</p>
</body></html>`;
  const text = [`DingoGo week in review: ${dayName(s.week)} to ${dayName(s.to)}`, '', ...[...r.headline, ...r.service].map(([k, v]) => `${k}: ${v}`), '', 'Next week',
    ...r.next.map(([k, v]) => `${k}: ${v}`), ...(s.watch.length ? ['', 'Worth a look', ...s.watch.map((w) => `- ${w}`)] : [])].join('\n');
  return { subject, html, text };
}

/** Send a week's summary to the policy's recipients (or `to`). Records the outcome in the audit log. */
export async function sendWeekly(week: string, opts: { actorId: string | null; to?: string[] }) {
  const policy = await loadPolicy();
  const to = opts.to?.length ? opts.to : policy.weekly_email.recipients;
  if (!to.length) throw bad('no_recipients', 'Add an email address in Insights → Settings first');
  const s = await weeklySummary(week);
  const e = weeklyEmail(s);
  const r = await sendEmail({ to, subject: e.subject, html: e.html, text: e.text, key: `owner-weekly-${week}-${to.join(',')}`,
    attachments: [{ filename: `dingogo-week-${week}.pdf`, content: weeklyPdf(s) }] });
  await audit(opts.actorId, 'owner_weekly_email', 'report', week, { recipients: to.length, sent: r.sent, provider: r.provider, error: r.error ?? null });
  return { week, recipients: to.length, ...r };
}

let lastWeeklyCheck = 0;
/** Dispatcher tick: once the Darwin Monday hour has passed, send last week's summary once (claimed across instances). Off by default. */
export async function runOwnerWeeklyIfDue(now = new Date()) {
  if (now.getTime() - lastWeeklyCheck < 10 * 60e3) return null;
  lastWeeklyCheck = now.getTime();
  const policy = await loadPolicy();
  if (!policy.weekly_email.enabled || !policy.weekly_email.recipients.length || !emailConfigured()) return null;
  const today = darwinDay(now);
  const hour = Number(new Intl.DateTimeFormat('en-AU', { hour: 'numeric', hourCycle: 'h23', timeZone: 'Australia/Darwin' }).format(now));
  if (weekdayOf(today) === 0 && hour < policy.weekly_email.hour) return null;
  const week = addDays(mondayOf(today), -7);
  const claimed = await one(
    `INSERT INTO settings (key, value) VALUES ('_owner_weekly', jsonb_build_object('week', $1::text, 'at', now()))
     ON CONFLICT (key) DO UPDATE SET value = excluded.value WHERE settings.value->>'week' IS DISTINCT FROM $1::text RETURNING key`, [week]);
  if (!claimed) return null;
  const r = await sendWeekly(week, { actorId: null }).catch((e) => { logError('owner weekly email', e); return null; });
  log.info({ owner_weekly: { week, sent: r?.sent ?? false } }, 'owner weekly summary');
  return r;
}
/** Tests: run the weekly check again without waiting 10 minutes. */
export const resetWeeklyCheck = () => { lastWeeklyCheck = 0; };

