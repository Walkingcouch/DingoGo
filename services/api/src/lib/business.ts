/**
 * Round 24: business and government customers — pure rules (no database).
 *
 * - Booking rules per account (cost centre / purpose / PO required, default PO, approval over an amount, one invoice per PO,
 *   NDIS number required, who may book for others) and the check of one booking against them.
 * - Billing settings (automatic issue, reminder days, hold after N days overdue, accounting codes) and which reminder is due.
 * - Recurring trips: the dates a weekly rule falls on, skipping public holidays and chosen dates.
 * - Accounting exports: Xero sales invoices and MYOB AccountRight service sales, from issued invoices.
 */
import { bad } from './errors.js';
import { csvCell, dollars, toCsv } from './csv.js';
import { addDays } from './tours.js';

// ───────────── Members and roles ─────────────
export const MEMBER_ROLES = ['member', 'approver', 'manager'] as const;
export type MemberRole = (typeof MEMBER_ROLES)[number];
/** Managers and approvers can approve bookings and see the account's usage; only managers change set-up. */
export const canApprove = (role: string | null | undefined) => role === 'manager' || role === 'approver';

// ───────────── Booking rules ─────────────
export interface BookingRules {
  require_cost_centre: boolean;
  require_purpose: boolean;
  require_po: boolean;
  /** Used when a booking gives no PO (a standing government purchase order). */
  default_po: string | null;
  /** Bookings over this (cents, incl. GST) by someone who isn't an approver need approval. 0 = never. */
  approval_over_cents: number;
  /** One invoice per PO number each month (government customers often need this). */
  invoice_per_po: boolean;
  require_ndis_number: boolean;
  /** Who may book a trip for someone else on the account. */
  book_for_others: 'everyone' | 'approvers' | 'nobody';
  /** May people outside the account (visitors, candidates) be booked as guests? */
  guests: boolean;
}
export const DEFAULT_RULES: BookingRules = {
  require_cost_centre: false, require_purpose: false, require_po: false, default_po: null, approval_over_cents: 0,
  invoice_per_po: false, require_ndis_number: false, book_for_others: 'everyone', guests: true,
};
const PO = /^[A-Za-z0-9][A-Za-z0-9 ./_-]{0,39}$/;
export const poValid = (s: string) => PO.test(s);

export function checkRules(v: unknown): BookingRules {
  const o = { ...DEFAULT_RULES, ...(v && typeof v === 'object' ? v as object : {}) } as any;
  const bool = (k: keyof BookingRules) => { if (typeof o[k] !== 'boolean') throw bad('invalid_rules', `${k} is yes or no`, { field: k }); };
  for (const k of ['require_cost_centre', 'require_purpose', 'require_po', 'invoice_per_po', 'require_ndis_number', 'guests'] as const) bool(k);
  const amt = Number(o.approval_over_cents ?? 0);
  if (!Number.isInteger(amt) || amt < 0 || amt > 1_000_000) throw bad('invalid_rules', 'Approval amount is $0 to $10,000', { field: 'approval_over_cents' });
  const po = o.default_po == null || String(o.default_po).trim() === '' ? null : String(o.default_po).trim();
  if (po && !poValid(po)) throw bad('invalid_rules', 'A PO number is up to 40 letters, numbers, spaces or . / _ -', { field: 'default_po' });
  if (!['everyone', 'approvers', 'nobody'].includes(o.book_for_others)) throw bad('invalid_rules', 'Who can book for others: everyone, approvers or nobody', { field: 'book_for_others' });
  return {
    require_cost_centre: o.require_cost_centre, require_purpose: o.require_purpose, require_po: o.require_po, default_po: po,
    approval_over_cents: amt, invoice_per_po: o.invoice_per_po, require_ndis_number: o.require_ndis_number,
    book_for_others: o.book_for_others, guests: o.guests,
  };
}
/** Stored rules, read leniently (bad stored values fall back to the defaults rather than stopping bookings). */
export function rulesOf(v: unknown): BookingRules {
  try { return checkRules(v); } catch { return { ...DEFAULT_RULES }; }
}

export interface BookingFields { cost_centre_id?: string | null; purpose_code?: string | null; po_number?: string | null; ndis_number?: string | null }
export interface CostCentreRow { id: string; code: string; name: string; approver_id: string | null; monthly_budget_cents: number | null; active: boolean }
export interface RuleCheck {
  cost_centre_id: string | null; purpose_code: string | null; po_number: string | null;
  /** null: no approval needed; 'approved': the booker can approve it; 'pending': held for an approver; 'refuse': needs approval but is for now. */
  approval: null | 'approved' | 'pending' | 'refuse';
}

/** One booking against the account's rules. Throws 400 with the field for a missing or unknown value. */
export function checkBooking(rules: BookingRules, f: BookingFields, ctx: {
  costCentre: CostCentreRow | null; purposeOk: boolean; bookerId: string; bookerRole: string | null; totalCents: number; scheduled: boolean;
}): RuleCheck {
  if (f.cost_centre_id && (!ctx.costCentre || !ctx.costCentre.active)) throw bad('invalid_cost_centre', 'That cost centre is not on this account', { field: 'cost_centre_id' });
  if (rules.require_cost_centre && !ctx.costCentre) throw bad('cost_centre_required', 'Choose a cost centre for this account', { field: 'cost_centre_id' });
  const purpose = f.purpose_code ? String(f.purpose_code).trim() : null;
  if (purpose && !ctx.purposeOk) throw bad('invalid_purpose', 'That trip purpose is not on this account', { field: 'purpose_code' });
  if (rules.require_purpose && !purpose) throw bad('purpose_required', 'Choose the purpose of the trip', { field: 'purpose_code' });
  const po = f.po_number ? String(f.po_number).trim() : rules.default_po;
  if (po && !poValid(po)) throw bad('invalid_po', 'A PO number is up to 40 letters, numbers, spaces or . / _ -', { field: 'po_number' });
  if (rules.require_po && !po) throw bad('po_required', 'This account needs a purchase order (PO) number', { field: 'po_number' });
  if (rules.require_ndis_number && !f.ndis_number) throw bad('ndis_required', "This account needs the participant's NDIS number", { field: 'ndis_number' });
  let approval: RuleCheck['approval'] = null;
  if (rules.approval_over_cents > 0 && ctx.totalCents > rules.approval_over_cents) {
    const approver = canApprove(ctx.bookerRole) || (!!ctx.costCentre?.approver_id && ctx.costCentre.approver_id === ctx.bookerId);
    approval = approver ? 'approved' : ctx.scheduled ? 'pending' : 'refuse';
  }
  return { cost_centre_id: ctx.costCentre?.id ?? null, purpose_code: purpose, po_number: po, approval };
}

/** May this member book for someone else (and for a guest)? */
export function mayBookForOthers(rules: BookingRules, role: string, guest: boolean): string | null {
  if (rules.book_for_others === 'nobody' && role !== 'manager') return 'This account only lets managers book for other people';
  if (rules.book_for_others === 'approvers' && !canApprove(role)) return 'On this account only approvers and managers book for other people';
  if (guest && !rules.guests) return 'This account books only for its own members';
  return null;
}

// ───────────── Billing settings ─────────────
export interface BillingSettings {
  /** Issue last month's invoices automatically on the 1st (Darwin). */
  auto_issue: boolean;
  /** Days overdue on which managers are reminded (e.g. 1, 7, 14). */
  reminder_days: number[];
  /** New bookings on an account are refused once an invoice is this many days overdue. 0 = never. */
  hold_after_days: number;
  /** How to pay, printed on every invoice (bank details or a payment link). */
  pay_to: string;
  xero_account_code: string;
  xero_tax_type: string;
  myob_income_account: string;
  myob_tax_code: string;
}
export const BILLING_DEFAULTS: BillingSettings = {
  auto_issue: false, reminder_days: [1, 7, 14], hold_after_days: 0, pay_to: '',
  xero_account_code: '200', xero_tax_type: 'GST on Income', myob_income_account: '4-1000', myob_tax_code: 'GST',
};
export function checkBilling(v: unknown): BillingSettings {
  const o = { ...BILLING_DEFAULTS, ...(v && typeof v === 'object' ? v as object : {}) } as any;
  if (typeof o.auto_issue !== 'boolean') throw bad('invalid_billing', 'Automatic issue is yes or no', { field: 'auto_issue' });
  const days = Array.isArray(o.reminder_days) ? o.reminder_days.map(Number) : [];
  if (days.length > 6 || days.some((d: number) => !Number.isInteger(d) || d < 1 || d > 120)) throw bad('invalid_billing', 'Up to 6 reminder days, each 1 to 120 days overdue', { field: 'reminder_days' });
  const hold = Number(o.hold_after_days ?? 0);
  if (!Number.isInteger(hold) || hold < 0 || hold > 180) throw bad('invalid_billing', 'Hold after 0 to 180 days overdue (0 = never)', { field: 'hold_after_days' });
  const text = (k: string, max: number) => {
    const s = String(o[k] ?? '').trim();
    if (s.length > max) throw bad('invalid_billing', `${k} is too long`, { field: k });
    return s;
  };
  return {
    auto_issue: o.auto_issue, reminder_days: [...new Set<number>(days)].sort((a, b) => a - b), hold_after_days: hold, pay_to: text('pay_to', 400),
    xero_account_code: text('xero_account_code', 20) || BILLING_DEFAULTS.xero_account_code, xero_tax_type: text('xero_tax_type', 40) || BILLING_DEFAULTS.xero_tax_type,
    myob_income_account: text('myob_income_account', 20) || BILLING_DEFAULTS.myob_income_account, myob_tax_code: text('myob_tax_code', 10) || BILLING_DEFAULTS.myob_tax_code,
  };
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000);

/** Which reminder (1-based) is due today for an unpaid invoice, or null. One a day at most; a missed day sends the latest one once. */
export function reminderDue(inv: { status: string; due_on: string; reminders: number; last_reminder_on: string | null }, days: number[], today: string): number | null {
  if (inv.status !== 'issued' || !days.length) return null;
  const overdue = daysBetween(inv.due_on, today);
  if (overdue < 1) return null;
  if (inv.last_reminder_on && inv.last_reminder_on >= today) return null;
  const reached = days.filter((d) => d <= overdue).length;   // reminders that should have gone by now
  return reached > inv.reminders ? reached : null;
}

/** Invoice number for the n-th invoice of a month: INV-202611-0007. */
export const invoiceNumber = (month: string, n: number) => `INV-${month.replace('-', '')}-${String(n).padStart(4, '0')}`;

// ───────────── Recurring trips ─────────────
export const WEEKDAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
/** ISO weekday of a YYYY-MM-DD date: 1 = Monday … 7 = Sunday. */
export const isoWeekday = (date: string) => { const d = new Date(`${date}T00:00:00Z`).getUTCDay(); return d === 0 ? 7 : d; };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export interface RecurrenceRule { weekdays: number[]; pickup_time: string; return_time?: string | null; starts_on: string; ends_on?: string | null; skip_holidays: boolean; skip_dates: string[] }
export function checkRecurrence(r: RecurrenceRule, today: string) {
  const days = [...new Set(r.weekdays)].sort();
  if (!days.length || days.some((d) => !Number.isInteger(d) || d < 1 || d > 7)) throw bad('invalid_recurrence', 'Choose at least one day of the week', { field: 'weekdays' });
  if (!HHMM.test(r.pickup_time)) throw bad('invalid_recurrence', 'Pickup time looks like 07:30', { field: 'pickup_time' });
  if (r.return_time != null && r.return_time !== '') {
    if (!HHMM.test(r.return_time)) throw bad('invalid_recurrence', 'Return time looks like 11:45', { field: 'return_time' });
    if (r.return_time <= r.pickup_time) throw bad('invalid_recurrence', 'The return trip is after the pickup', { field: 'return_time' });
  }
  if (r.starts_on < today) throw bad('invalid_recurrence', 'Start today or later', { field: 'starts_on' });
  if (r.ends_on && r.ends_on < r.starts_on) throw bad('invalid_recurrence', 'The end date is after the start', { field: 'ends_on' });
  if (r.ends_on && daysBetween(r.starts_on, r.ends_on) > 366) throw bad('invalid_recurrence', 'A series runs up to a year; start a new one after', { field: 'ends_on' });
  if (r.skip_dates.length > 60) throw bad('invalid_recurrence', 'Up to 60 dates to skip', { field: 'skip_dates' });
  return { ...r, weekdays: days, return_time: r.return_time || null };
}

export interface Occurrence { date: string; time: string; leg: 'there' | 'back' }
/** Every trip the rule books between two dates (inclusive), with the dates it skips and why. */
export function occurrences(r: RecurrenceRule, from: string, to: string, holidays: string[]): { trips: Occurrence[]; skipped: { date: string; reason: 'holiday' | 'skipped' }[] } {
  const trips: Occurrence[] = []; const skipped: { date: string; reason: 'holiday' | 'skipped' }[] = [];
  const start = from > r.starts_on ? from : r.starts_on;
  const end = r.ends_on && r.ends_on < to ? r.ends_on : to;
  const hol = new Set(holidays); const skip = new Set(r.skip_dates);
  for (let d = start, i = 0; d <= end && i < 400; d = addDays(d, 1), i++) {
    if (!r.weekdays.includes(isoWeekday(d))) continue;
    if (skip.has(d)) { skipped.push({ date: d, reason: 'skipped' }); continue; }
    if (r.skip_holidays && hol.has(d)) { skipped.push({ date: d, reason: 'holiday' }); continue; }
    trips.push({ date: d, time: r.pickup_time, leg: 'there' });
    if (r.return_time) trips.push({ date: d, time: r.return_time, leg: 'back' });
  }
  return { trips, skipped };
}
/** "Mon, Wed and Fri" */
export function weekdayList(days: number[]) {
  const n = days.map((d) => WEEKDAY_NAMES[d - 1]);
  if (n.length === 7) return 'every day';
  if (n.length === 5 && days.join() === '1,2,3,4,5') return 'weekdays';
  return n.length > 1 ? `${n.slice(0, -1).join(', ')} and ${n.at(-1)}` : n[0];
}

// ───────────── Accounting exports ─────────────
export interface InvoiceLine {
  date: string; trip_ref: string; traveller: string; description: string; amount_cents: number; refunded_cents: number;
  cost_centre: string | null; purpose: string | null; po_number: string | null; ndis_number: string | null; cancellation: boolean;
  booked_by?: string | null;
}
export interface IssuedInvoice {
  number: string; month: string; po_number: string; issued_on: string; due_on: string; total_cents: number; gst_cents: number;
  bill_to: { name: string; abn: string | null; email: string; address: string | null; kind: string }; lines: InvoiceLine[]; terms_days: number;
}
const auDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
const lineNet = (l: InvoiceLine) => l.amount_cents - l.refunded_cents;
const lineText = (l: InvoiceLine) => `${l.trip_ref} ${l.date}: ${l.description}${l.traveller ? ` (${l.traveller})` : ''}${l.purpose ? ` - ${l.purpose}` : ''}${l.ndis_number ? ` - NDIS ${l.ndis_number}` : ''}`;

/** Xero "Import invoices" CSV (Sales → Import). Amounts are tax inclusive: choose "Tax inclusive" when importing. */
export function xeroCsv(invoices: IssuedInvoice[], s: BillingSettings) {
  const rows = invoices.flatMap((inv) => inv.lines.filter((l) => lineNet(l) !== 0).map((l) => ({ inv, l })));
  return toCsv<{ inv: IssuedInvoice; l: InvoiceLine }>([
    ['*ContactName', (r) => r.inv.bill_to.name], ['EmailAddress', (r) => r.inv.bill_to.email], ['POAddressLine1', (r) => r.inv.bill_to.address ?? ''],
    ['*InvoiceNumber', (r) => r.inv.number], ['Reference', (r) => r.inv.po_number || r.l.po_number || ''], ['*InvoiceDate', (r) => auDate(r.inv.issued_on)],
    ['*DueDate', (r) => auDate(r.inv.due_on)], ['*Description', (r) => lineText(r.l)], ['*Quantity', () => '1'], ['*UnitAmount', (r) => dollars(lineNet(r.l))],
    ['*AccountCode', () => s.xero_account_code], ['*TaxType', () => s.xero_tax_type], ['TrackingName1', (r) => (r.l.cost_centre ? 'Cost centre' : '')],
    ['TrackingOption1', (r) => r.l.cost_centre ?? ''], ['Currency', () => 'AUD'],
  ], rows);
}

/** MYOB AccountRight "Sales - Service" import (tab-free CSV): one row per line, a blank line between invoices. */
export function myobCsv(invoices: IssuedInvoice[], s: BillingSettings) {
  const head = ['Co./Last Name', 'Invoice #', 'Date', 'Customer PO', 'Description', 'Account #', 'Amount', 'Inc-Tax Amount', 'Job', 'Tax Code',
    'GST Amount', 'Terms - Payment is Due', '           - Balance Due Days', 'Journal Memo'];
  const out: string[] = [head.map(csvCell).join(',')];
  invoices.forEach((inv, i) => {
    if (i > 0) out.push('');
    for (const l of inv.lines.filter((x) => lineNet(x) !== 0)) {
      const net = lineNet(l); const gst = Math.round(net / 11);
      out.push([inv.bill_to.name, inv.number, auDate(inv.issued_on), inv.po_number || l.po_number || '', lineText(l), s.myob_income_account,
        dollars(net - gst), dollars(net), l.cost_centre ?? '', s.myob_tax_code, dollars(gst), '2', String(inv.terms_days), `DingoGo ${inv.month}`].map(csvCell).join(','));
    }
  });
  return '﻿' + out.join('\r\n') + '\r\n';
}
