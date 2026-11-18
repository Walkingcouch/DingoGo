import { one, q } from '../db.js';
import { getJurisdiction } from '../lib/jurisdictions.js';
import { bad } from '../lib/errors.js';

const TZ = `'Australia/Darwin'`;
const isMonth = (s?: string) => !!s && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
const isDate = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/** Today's date in Darwin (YYYY-MM-DD). */
export const darwinToday = () => new Date(Date.now() + 9.5 * 3600e3).toISOString().slice(0, 10);
export const validDate = (s: string | undefined, fallback: string) => (isDate(s) ? s! : fallback);

/** Passenger services levy for a month and state: completed passenger trips (rides, not courier) counted against the state of their pickup zone. */
export async function levyReport(month?: string, stateIn = 'NT') {
  const m = isMonth(month) ? month! : darwinToday().slice(0, 7);
  const state = String(stateIn).toUpperCase();
  const inState = `coalesce((SELECT z.state FROM zones z WHERE z.id = t.zone_id), 'NT') = $2`;
  const r = await one(
    `SELECT count(*)::int trips, coalesce(sum((fare_breakdown->>'levy_cents')::int),0)::int levy_collected_cents
     FROM trips t WHERE status = 'completed' AND kind = 'ride'
       AND to_char(completed_at AT TIME ZONE ${TZ}, 'YYYY-MM') = $1 AND ${inState}`, [m, state]);
  const perDriver = await q(
    `SELECT u.name, t.driver_id, count(*)::int trips FROM trips t JOIN users u ON u.id = t.driver_id
     WHERE t.status = 'completed' AND t.kind = 'ride' AND to_char(t.completed_at AT TIME ZONE ${TZ}, 'YYYY-MM') = $1 AND ${inState}
     GROUP BY u.name, t.driver_id ORDER BY trips DESC, u.name`, [m, state]);
  const j = await getJurisdiction(state);
  const levyRate = state === 'NT' ? await one(`SELECT value FROM settings WHERE key = 'nt_levy_cents'`) : null;
  const rate = Number(levyRate?.value ?? j?.levy_cents ?? 100);
  return { month: m, state, levy_label: j?.levy_label ?? 'NT passenger levy', passenger_trips: r!.trips, levy_rate_cents: rate,
    levy_payable_cents: r!.trips * rate, levy_collected_cents: r!.levy_collected_cents, per_driver: perDriver };
}

/** GST summary of money in and out by kind and provider, plus DingoGo's own service fees (Darwin dates, inclusive). */
export async function gstReport(from?: string, to?: string) {
  const f = validDate(from, new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10));
  const t = validDate(to, darwinToday());
  const rows = await q(
    `SELECT kind, provider, count(*)::int n, sum(amount_cents)::int amount_cents, sum(gst_cents)::int gst_cents
     FROM payments WHERE status IN ('succeeded','pending') AND kind IN ('capture','cash','invoice','subscription','refund','tip')
       AND (created_at AT TIME ZONE ${TZ})::date BETWEEN $1 AND $2
     GROUP BY kind, provider ORDER BY kind, provider`, [f, t]);
  const fees = await one(
    `SELECT coalesce(-sum(amount_cents),0)::int commission_cents FROM driver_ledger WHERE kind = 'commission' AND (created_at AT TIME ZONE ${TZ})::date BETWEEN $1 AND $2`, [f, t]);
  return { from: f, to: t, rows, dingogo_service_fees_cents: fees!.commission_cents, gst_on_service_fees_cents: Math.round(fees!.commission_cents / 11) };
}

const TRIP_STATUSES = ['scheduled', 'requested', 'accepted', 'arrived', 'in_progress', 'completed', 'cancelled_rider', 'cancelled_driver', 'cancelled_admin', 'no_drivers'];

/** Digits to look for in a stored (+61…) phone number, from what staff typed ("0400 000 100", "+61 400…", "000 100"). Null if it isn't a phone. */
export function phoneTail(s: string): string | null {
  if (!/^[+\d\s().-]+$/.test(s.trim())) return null;
  const d = s.replace(/\D/g, '');
  return d.length >= 6 ? d.slice(-Math.min(9, d.length)) : null;
}

/** WHERE clauses for trip lists and exports (aliases: t trips, ru rider, du driver, v vehicle).
 *  status: active | cancelled | a trip status; kind; q (ref, names, phones in any format, addresses, rego); from/to (Darwin dates, requested); rider_id; driver_id. */
export function tripFilters(p: Record<string, string | undefined>) {
  const where: string[] = []; const vals: unknown[] = [];
  const add = (sql: (n: string) => string, v: unknown) => { vals.push(v); where.push(sql(`$${vals.length}`)); };
  const status = p.status || '';
  if (status === 'active') where.push(`t.status IN ('requested','accepted','arrived','in_progress')`);
  else if (status === 'cancelled') where.push(`t.status::text LIKE 'cancelled%'`);
  else if (status) { if (!TRIP_STATUSES.includes(status)) throw bad('invalid_status', 'Unknown trip status'); add((n) => `t.status = ${n}`, status); }
  if (p.kind === 'ride' || p.kind === 'courier') add((n) => `t.kind = ${n}`, p.kind);
  const s = String(p.q ?? '').trim().slice(0, 100);
  if (s) {
    add((n) => `(t.ref ILIKE ${n} OR ru.name ILIKE ${n} OR du.name ILIKE ${n} OR t.pickup_address ILIKE ${n} OR t.dropoff_address ILIKE ${n})`, `%${s}%`);
    const last = where.pop()!;
    const extra: string[] = [];
    const tail = phoneTail(s);
    if (tail) { vals.push(`%${tail}%`); extra.push(`ru.phone LIKE $${vals.length} OR du.phone LIKE $${vals.length}`); }
    const rego = s.toUpperCase().replace(/\s+/g, '');
    if (/^[A-Z0-9]{2,9}$/.test(rego)) { vals.push(`%${rego}%`); extra.push(`replace(upper(coalesce(v.rego,'')), ' ', '') LIKE $${vals.length}`); }
    where.push(extra.length ? `(${last.slice(1, -1)} OR ${extra.join(' OR ')})` : last);
  }
  if (p.from && isDate(p.from)) add((n) => `t.requested_at >= (${n}::date)::timestamp AT TIME ZONE ${TZ}`, p.from);
  if (p.to && isDate(p.to)) add((n) => `t.requested_at < ((${n}::date + 1)::timestamp AT TIME ZONE ${TZ})`, p.to);
  const uuid = /^[0-9a-f-]{36}$/i;
  if (p.rider_id && uuid.test(p.rider_id)) add((n) => `t.rider_id = ${n}`, p.rider_id);
  if (p.driver_id && uuid.test(p.driver_id)) add((n) => `t.driver_id = ${n}`, p.driver_id);
  return { where, vals };
}
