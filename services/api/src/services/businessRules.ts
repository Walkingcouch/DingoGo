/**
 * Round 24: business account rules applied inside a booking (called from `insertTrip` for trips billed to an account):
 * cost centre, purpose and PO checked against the account's rules, cost-centre budget, approval, and the overdue-invoice hold.
 * Needs migration 027 (`businessReady()`); before it account bookings work as before and business fields answer 503.
 */
import { config } from '../config.js';
import { one, type Q } from '../db.js';
import { ApiError } from '../lib/errors.js';
import { settingValue } from '../lib/cache.js';
import { BILLING_DEFAULTS, checkBilling, checkBooking, rulesOf, type BillingSettings, type BookingFields, type CostCentreRow, type RuleCheck } from '../lib/business.js';

// ── Migration 027 ──
let ready = false;
let checkedAt = 0;
export async function businessReady(): Promise<boolean> {
  if (ready) return true;
  if (checkedAt && Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const r = await one<{ n: number }>(
      `SELECT (SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()
                 AND table_name IN ('account_cost_centres', 'account_purposes', 'account_invoices', 'account_recurring_trips'))::int
            + (SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'corporate_accounts'
                 AND column_name IN ('status', 'application', 'applied_at', 'reviewed_at', 'reviewed_by', 'review_note', 'contact_name',
                                     'contact_phone', 'address', 'booking_rules'))::int
            + (SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'trips'
                 AND column_name IN ('cost_centre_id', 'purpose_code', 'po_number', 'approval_status', 'approval_by', 'approval_at', 'recurring_id'))::int AS n`);
    ready = r!.n === 21;
  } catch { ready = false; }
  return ready;
}
export function resetBusinessReady() { ready = false; checkedAt = 0; }
export const businessPending = () => new ApiError(503, 'migration_pending', 'This needs database migration 027 (business accounts and invoicing). Call DingoGo to set it up for now.');
export async function needBusiness() { if (!(await businessReady())) throw businessPending(); }

export async function billingSettings(): Promise<BillingSettings> {
  const v = await settingValue('business_billing').catch(() => null);
  if (!v) return BILLING_DEFAULTS;
  try { return checkBilling(v); } catch { return BILLING_DEFAULTS; }
}

/** Darwin date today (YYYY-MM-DD). */
export const darwinToday = (at = new Date()) => new Date(at.getTime() + 9.5 * 3600e3).toISOString().slice(0, 10);

export interface BusinessInput extends BookingFields { recurring_id?: string | null }
export interface BusinessCheck extends RuleCheck { recurring_id: string | null }

/** Spend on a cost centre in a Darwin month, counted like the account limit (completed, fees, booked at their quote, less refunds). */
async function costCentreMonthCents(c: Q, costCentreId: string, month: string) {
  const r = await one<{ n: number }>(
    `SELECT coalesce(sum(CASE WHEN t.status = 'completed' THEN coalesce(t.final_cents, t.quote_cents)
                              WHEN t.status::text LIKE 'cancelled%' THEN coalesce(t.cancel_fee_cents, 0)
                              WHEN t.status IN ('scheduled','requested','accepted','arrived','in_progress') THEN t.quote_cents ELSE 0 END
                         + coalesce((SELECT sum(p.amount_cents) FROM payments p WHERE p.trip_id = t.id AND p.kind = 'refund' AND p.status = 'succeeded'), 0)), 0)::int n
     FROM trips t WHERE t.cost_centre_id = $1 AND t.payment_method = 'corporate'
       AND to_char(coalesce(t.completed_at, t.cancelled_at, t.scheduled_for, t.requested_at) AT TIME ZONE $3, 'YYYY-MM') = $2`,
    [costCentreId, month, config.timezone], c);
  return Math.max(0, r?.n ?? 0);
}

/**
 * The account's rules for one booking (inside the booking transaction, after the monthly limit). `bookerId` is who made the
 * booking (the rider, or the colleague / organisation member who booked for them). Ops phone bookings are taken on the customer's
 * word: fields are checked if given, never required, and never held for approval.
 */
export async function checkAccountBooking(c: Q, o: {
  accountId: string; bookerId: string; input: BusinessInput & { ndis_number?: string | null }; totalCents: number; at: Date; scheduled: boolean; opsBooking: boolean;
}): Promise<BusinessCheck | null> {
  const f = o.input;
  const given = !!(f.cost_centre_id || f.purpose_code || f.po_number || f.recurring_id);
  if (!(await businessReady())) {
    if (given) throw businessPending();
    return null;
  }
  const acct = await one(`SELECT id, name, booking_rules FROM corporate_accounts WHERE id = $1`, [o.accountId], c);
  if (!acct) return null;
  const rules = { ...rulesOf(acct.booking_rules) };
  if (o.opsBooking) Object.assign(rules, { require_cost_centre: false, require_purpose: false, require_po: false, require_ndis_number: false, approval_over_cents: 0 });

  // Overdue invoices: optional hold on new bookings (admin → Business → Billing).
  const billing = await billingSettings();
  if (billing.hold_after_days > 0 && !o.opsBooking) {
    const late = await one(
      `SELECT number, due_on::text AS due_on FROM account_invoices WHERE account_id = $1 AND status = 'issued' AND due_on < $2::date - $3::int ORDER BY due_on LIMIT 1`,
      [o.accountId, darwinToday(), billing.hold_after_days], c);
    if (late) throw new ApiError(402, 'account_overdue', `${acct.name} has an overdue invoice (${late.number}). New bookings on the account are paused until it is paid. Ask the account manager, or pay another way.`, { invoice: late.number });
  }

  const cc: CostCentreRow | null = f.cost_centre_id
    ? await one(`SELECT id, code, name, approver_id, monthly_budget_cents, active FROM account_cost_centres WHERE id = $1 AND account_id = $2`, [f.cost_centre_id, o.accountId], c)
    : null;
  const purposeOk = f.purpose_code
    ? !!(await one(`SELECT 1 FROM account_purposes WHERE account_id = $1 AND code = $2 AND active`, [o.accountId, String(f.purpose_code).trim()], c))
    : true;
  const member = await one<{ role: string }>(`SELECT role FROM corporate_members WHERE account_id = $1 AND user_id = $2`, [o.accountId, o.bookerId], c);
  const out = checkBooking(rules, f, { costCentre: cc, purposeOk, bookerId: o.bookerId, bookerRole: member?.role ?? null, totalCents: o.totalCents, scheduled: o.scheduled });
  if (out.approval === 'refuse') {
    throw new ApiError(403, 'approval_required', `Trips over $${(rules.approval_over_cents / 100).toFixed(2)} on ${acct.name} need an approver's OK. Book it ahead so an approver can say yes, or ask an approver to book it.`,
      { approval_over_cents: rules.approval_over_cents });
  }
  if (cc && Number(cc.monthly_budget_cents ?? 0) > 0) {
    await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`cost_centre:${cc.id}`]);
    const month = new Intl.DateTimeFormat('en-CA', { timeZone: config.timezone, year: 'numeric', month: '2-digit' }).format(o.at).slice(0, 7);
    const used = await costCentreMonthCents(c, cc.id, month);
    const budget = Number(cc.monthly_budget_cents);
    if (used + o.totalCents > budget) {
      const left = Math.max(0, budget - used);
      throw new ApiError(402, 'cost_centre_budget_reached', `Cost centre ${cc.code} (${cc.name}) has reached its monthly budget${left > 0 ? ` ($${(left / 100).toFixed(2)} left this month)` : ''}. Choose another cost centre or ask the account manager.`,
        { budget_cents: budget, used_cents: used, left_cents: left, month });
    }
  }
  return { ...out, recurring_id: f.recurring_id ?? null };
}
