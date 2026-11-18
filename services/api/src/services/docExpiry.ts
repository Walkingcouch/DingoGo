/** Driver document expiry: what runs out soon (shown in the driver app) and reminders at 30, 14 and 3 days.
 *  No new tables: reminders are de-duplicated against the driver's own notifications (data.reminder). */
import { q } from '../db.js';
import { docLabel, getJurisdiction } from '../lib/jurisdictions.js';
import { send } from './notify.js';
import { render } from '../lib/messages.js';

/** Reminder points, in days before the expiry date (Darwin time). */
export const EXPIRY_REMINDER_DAYS = [30, 14, 3] as const;
const WINDOW_DAYS = EXPIRY_REMINDER_DAYS[0];

export interface Expiring {
  /** Stable key for the credential (e.g. `licence`, `vehicle:<id>:insurance`). */
  key: string;
  label: string;
  expires_on: string;            // YYYY-MM-DD
  days_left: number;             // negative once expired
  level: 'expired' | 'urgent' | 'soon' | 'upcoming';
  /** A newer copy has been sent and is waiting for DingoGo to check it. */
  replacement_pending: boolean;
  vehicle_id?: string;
}

/** Vehicle documents whose expiry DingoGo records on the car itself when it checks it. */
const VEHICLE_FIELD: Record<string, string> = { vehicle_cvl: 'cvl_expiry', vehicle_rego: 'rego_expiry', insurance: 'insurance_expiry', sa_inspection: 'inspection_expiry' };
const DRIVER_FIELD: Record<string, string> = { licence: 'licence_expiry', h_endorsement: 'h_endorsement_expiry' };

const levelOf = (d: number): Expiring['level'] => (d < 0 ? 'expired' : d <= 3 ? 'urgent' : d <= 14 ? 'soon' : 'upcoming');

/** Credentials of this driver (and their current car) that expire within 30 days or have expired. Soonest first. */
export async function expiringDocs(driverId: string): Promise<Expiring[]> {
  const [d] = await q(
    `SELECT d.state, d.licence_expiry::text, d.h_endorsement_expiry::text, d.vehicle_id,
            v.rego, v.cvl_expiry::text, v.rego_expiry::text, v.insurance_expiry::text, v.inspection_expiry::text, v.rego_state,
            (now() AT TIME ZONE 'Australia/Darwin')::date::text AS today
     FROM drivers d LEFT JOIN vehicles v ON v.id = d.vehicle_id WHERE d.user_id = $1`, [driverId]);
  if (!d) return [];
  const j = await getJurisdiction(d.state);
  const vj = d.vehicle_id && d.rego_state && d.rego_state !== d.state ? await getJurisdiction(d.rego_state) : j;
  // Latest approved expiry per document type (driver's own, and the current car's), plus whether a newer copy is waiting.
  const docs = await q(
    `SELECT type, vehicle_id, max(expires_at) FILTER (WHERE status = 'approved')::text AS expires_on,
            bool_or(status = 'pending') AS pending
     FROM driver_documents WHERE driver_id = $1 AND (vehicle_id IS NULL OR vehicle_id = $2)
     GROUP BY type, vehicle_id`, [driverId, d.vehicle_id]);
  const pending = (type: string, vehicle: boolean) => !!docs.find((x) => x.type === type && (vehicle ? x.vehicle_id === d.vehicle_id : x.vehicle_id == null))?.pending;

  const items: { key: string; label: string; date: string | null; pending: boolean; vehicle_id?: string }[] = [];
  items.push({ key: 'licence', label: docLabel('licence'), date: d.licence_expiry, pending: pending('licence', false) });
  if (j?.driver_docs.includes('h_endorsement')) items.push({ key: 'h_endorsement', label: docLabel('h_endorsement'), date: d.h_endorsement_expiry, pending: pending('h_endorsement', false) });
  for (const x of docs) {
    if (!x.expires_on || DRIVER_FIELD[x.type] || (x.vehicle_id && VEHICLE_FIELD[x.type])) continue;
    if (x.vehicle_id) items.push({ key: `vehicle:${x.vehicle_id}:${x.type}`, label: `${d.rego}: ${docLabel(x.type)}`, date: x.expires_on, pending: !!x.pending, vehicle_id: x.vehicle_id });
    else items.push({ key: x.type, label: docLabel(x.type), date: x.expires_on, pending: !!x.pending });
  }
  if (d.vehicle_id) {
    const car = (type: string, date: string | null, label: string) =>
      items.push({ key: `vehicle:${d.vehicle_id}:${type}`, label: `${d.rego}: ${label}`, date, pending: pending(type, true), vehicle_id: d.vehicle_id });
    if (!vj || vj.vehicle_docs.includes('vehicle_cvl')) car('vehicle_cvl', d.cvl_expiry, 'rideshare licence (CVL)');
    if (vj?.inspection_months) car('sa_inspection', d.inspection_expiry, 'annual inspection');
    car('vehicle_rego', d.rego_expiry, 'registration');
    car('insurance', d.insurance_expiry, 'insurance');
  }

  const today = Date.parse(d.today + 'T00:00:00Z');
  const out: Expiring[] = [];
  for (const it of items) {
    if (!it.date) continue; // never recorded: shown as a compliance issue, not an expiry
    const days = Math.round((Date.parse(it.date + 'T00:00:00Z') - today) / 86400000);
    if (days > WINDOW_DAYS) continue;
    out.push({ key: it.key, label: it.label, expires_on: it.date, days_left: days, level: levelOf(days), replacement_pending: it.pending, ...(it.vehicle_id ? { vehicle_id: it.vehicle_id } : {}) });
  }
  return out.sort((a, b) => a.days_left - b.days_left);
}

/** The reminder point a credential has reached: 30, 14 or 3 (the smallest one at or above the days left). */
export function reminderPoint(daysLeft: number): number | null {
  if (daysLeft < 0) return null;
  let point: number | null = null;
  for (const p of EXPIRY_REMINDER_DAYS) if (daysLeft <= p) point = p;
  return point;
}

export const expiryText = (e: Pick<Expiring, 'days_left' | 'label'>) => render('document_expiring', e).title!;

let lastRun = 0;
/** Send each approved driver one reminder per credential per reminder point (30, 14, 3 days). Skipped when a newer copy is
 *  already waiting for checking. Runs from the dispatch tick, at most every 30 minutes per instance, 8 am to 8 pm Darwin time.
 *  Two serverless instances running at the same moment could both send one; that is a repeated in-app message, nothing worse. */
export async function sendDocExpiryReminders(opts: { force?: boolean; now?: Date } = {}) {
  const now = opts.now ?? new Date();
  if (!opts.force) {
    if (now.getTime() - lastRun < 30 * 60_000) return { sent: 0 };
    const hour = Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Darwin', hour: 'numeric', hourCycle: 'h23' }).format(now));
    if (hour < 8 || hour >= 20) return { sent: 0 };
  }
  lastRun = now.getTime();
  const drivers = await q<{ user_id: string }>(
    `SELECT d.user_id FROM drivers d JOIN users u ON u.id = d.user_id
     WHERE d.status = 'approved' AND u.deleted_at IS NULL AND coalesce(u.blocked, false) = false`);
  let sent = 0;
  for (const { user_id } of drivers) {
    const items = await expiringDocs(user_id);
    for (const e of items) {
      const point = reminderPoint(e.days_left);
      if (point == null || e.replacement_pending) continue;
      const reminder = `${e.key}:${e.expires_on}:${point}`;
      const [seen] = await q(`SELECT 1 FROM notifications WHERE user_id = $1 AND category = 'documents' AND data->>'reminder' = $2 LIMIT 1`, [user_id, reminder]);
      if (seen) continue;
      await send(user_id, 'document_expiring', { label: e.label, days_left: e.days_left }, { data: { reminder, key: e.key, expires_on: e.expires_on, days_left: e.days_left } });
      sent++;
    }
  }
  return { sent };
}
