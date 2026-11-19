/** Round 24: business account rules, billing, recurring trips and accounting exports (pure; no database). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  BILLING_DEFAULTS, DEFAULT_RULES, checkBilling, checkBooking, checkRecurrence, checkRules, invoiceNumber, isoWeekday, mayBookForOthers, myobCsv,
  occurrences, reminderDue, rulesOf, weekdayList, xeroCsv, type IssuedInvoice,
} from '../src/lib/business.js';

const cc = { id: 'cc1', code: 'RENAL', name: 'Renal unit', approver_id: 'u-boss', monthly_budget_cents: null, active: true };
const ctx = (o: Partial<Parameters<typeof checkBooking>[2]> = {}) =>
  ({ costCentre: null, purposeOk: true, bookerId: 'u1', bookerRole: 'member', totalCents: 2500, scheduled: false, ...o });
const code = (fn: () => unknown) => { try { fn(); return null; } catch (e: any) { return e.code; } };

test('booking rules: defaults, validation, stored rules read leniently and never shared', () => {
  assert.deepEqual(checkRules({}), DEFAULT_RULES);
  assert.equal(code(() => checkRules({ require_po: 'yes' })), 'invalid_rules');
  assert.equal(code(() => checkRules({ approval_over_cents: -1 })), 'invalid_rules');
  assert.equal(code(() => checkRules({ default_po: 'PO=1;DROP' })), 'invalid_rules');
  assert.equal(code(() => checkRules({ book_for_others: 'anyone' })), 'invalid_rules');
  assert.equal(checkRules({ default_po: '  ' }).default_po, null);
  assert.equal(checkRules({ default_po: 'PO 4500-123/A' }).default_po, 'PO 4500-123/A');
  const bad = rulesOf({ approval_over_cents: 'lots' });
  assert.deepEqual(bad, DEFAULT_RULES);
  bad.require_po = true;
  assert.equal(DEFAULT_RULES.require_po, false, 'fallback is a copy');
});

test('one booking against the rules: required fields, unknown values, default PO and approval outcomes', () => {
  const r = checkRules({ require_cost_centre: true, require_purpose: true, require_po: true, approval_over_cents: 4000, require_ndis_number: true });
  assert.equal(code(() => checkBooking(r, {}, ctx())), 'cost_centre_required');
  assert.equal(code(() => checkBooking(r, { cost_centre_id: 'x' }, ctx())), 'invalid_cost_centre');
  assert.equal(code(() => checkBooking(r, { cost_centre_id: 'cc1' }, ctx({ costCentre: { ...cc, active: false } }))), 'invalid_cost_centre');
  assert.equal(code(() => checkBooking(r, { cost_centre_id: 'cc1' }, ctx({ costCentre: cc }))), 'purpose_required');
  assert.equal(code(() => checkBooking(r, { cost_centre_id: 'cc1', purpose_code: 'X' }, ctx({ costCentre: cc, purposeOk: false }))), 'invalid_purpose');
  assert.equal(code(() => checkBooking(r, { cost_centre_id: 'cc1', purpose_code: 'DIAL' }, ctx({ costCentre: cc }))), 'po_required');
  assert.equal(code(() => checkBooking(r, { cost_centre_id: 'cc1', purpose_code: 'DIAL', po_number: 'PO1' }, ctx({ costCentre: cc }))), 'ndis_required');
  const ok = checkBooking(r, { cost_centre_id: 'cc1', purpose_code: ' DIAL ', po_number: 'PO1', ndis_number: '430000000' }, ctx({ costCentre: cc }));
  assert.deepEqual(ok, { cost_centre_id: 'cc1', purpose_code: 'DIAL', po_number: 'PO1', approval: null });
  // The account's standing PO fills in a blank one.
  assert.equal(checkBooking(checkRules({ require_po: true, default_po: 'GOV-77' }), {}, ctx()).po_number, 'GOV-77');
  // Approval over $40: approvers, managers and the cost centre's approver approve their own; others wait (booked ahead) or are refused (now).
  const a = checkRules({ approval_over_cents: 4000 });
  assert.equal(checkBooking(a, {}, ctx({ totalCents: 4000 })).approval, null, 'at the amount is fine');
  assert.equal(checkBooking(a, {}, ctx({ totalCents: 4100 })).approval, 'refuse');
  assert.equal(checkBooking(a, {}, ctx({ totalCents: 4100, scheduled: true })).approval, 'pending');
  assert.equal(checkBooking(a, {}, ctx({ totalCents: 4100, bookerRole: 'approver' })).approval, 'approved');
  assert.equal(checkBooking(a, {}, ctx({ totalCents: 4100, bookerRole: 'manager' })).approval, 'approved');
  assert.equal(checkBooking(a, { cost_centre_id: 'cc1' }, ctx({ totalCents: 4100, costCentre: cc, bookerId: 'u-boss' })).approval, 'approved');
  assert.equal(checkBooking(DEFAULT_RULES, {}, ctx({ totalCents: 999_999 })).approval, null, 'no approval rule');
});

test('who may book for others and for guests', () => {
  assert.equal(mayBookForOthers(DEFAULT_RULES, 'member', true), null);
  assert.match(mayBookForOthers({ ...DEFAULT_RULES, book_for_others: 'approvers' }, 'member', false)!, /approvers/);
  assert.equal(mayBookForOthers({ ...DEFAULT_RULES, book_for_others: 'approvers' }, 'approver', false), null);
  assert.match(mayBookForOthers({ ...DEFAULT_RULES, book_for_others: 'nobody' }, 'approver', false)!, /managers/);
  assert.equal(mayBookForOthers({ ...DEFAULT_RULES, book_for_others: 'nobody' }, 'manager', false), null);
  assert.match(mayBookForOthers({ ...DEFAULT_RULES, guests: false }, 'manager', true)!, /own members/);
});

test('billing settings and overdue reminders: one a day, a missed day sends the latest once, paid invoices never', () => {
  assert.deepEqual(checkBilling({}), BILLING_DEFAULTS);
  assert.deepEqual(checkBilling({ reminder_days: [14, 1, 7, 7] }).reminder_days, [1, 7, 14]);
  assert.equal(code(() => checkBilling({ reminder_days: [0] })), 'invalid_billing');
  assert.equal(code(() => checkBilling({ hold_after_days: 400 })), 'invalid_billing');
  assert.equal(code(() => checkBilling({ auto_issue: 'on' })), 'invalid_billing');
  assert.equal(checkBilling({ xero_account_code: '' }).xero_account_code, '200');
  const inv = { status: 'issued', due_on: '2026-12-14', reminders: 0, last_reminder_on: null as string | null };
  const days = [1, 7, 14];
  assert.equal(reminderDue(inv, days, '2026-12-14'), null, 'due today is not overdue');
  assert.equal(reminderDue(inv, days, '2026-12-15'), 1);
  assert.equal(reminderDue({ ...inv, reminders: 1, last_reminder_on: '2026-12-15' }, days, '2026-12-15'), null, 'once a day');
  assert.equal(reminderDue({ ...inv, reminders: 1, last_reminder_on: '2026-12-15' }, days, '2026-12-18'), null, 'next one at 7 days');
  assert.equal(reminderDue({ ...inv, reminders: 1, last_reminder_on: '2026-12-15' }, days, '2026-12-21'), 2);
  assert.equal(reminderDue(inv, days, '2027-01-10'), 3, 'missed days: the latest one, once');
  assert.equal(reminderDue({ ...inv, reminders: 3, last_reminder_on: '2027-01-10' }, days, '2027-02-10'), null, 'no more after the last');
  assert.equal(reminderDue({ ...inv, status: 'paid' }, days, '2027-01-10'), null);
  assert.equal(reminderDue(inv, [], '2027-01-10'), null, 'reminders off');
  assert.equal(invoiceNumber('2026-11', 7), 'INV-202611-0007');
});

test('recurring trips: weekdays in Darwin, return legs, end date, public holidays and skipped dates', () => {
  assert.equal(isoWeekday('2026-11-23'), 1);   // Monday
  assert.equal(isoWeekday('2026-11-29'), 7);   // Sunday
  const today = '2026-11-20';
  assert.equal(code(() => checkRecurrence({ weekdays: [], pickup_time: '07:00', starts_on: today, skip_holidays: true, skip_dates: [] }, today)), 'invalid_recurrence');
  assert.equal(code(() => checkRecurrence({ weekdays: [1], pickup_time: '7am', starts_on: today, skip_holidays: true, skip_dates: [] }, today)), 'invalid_recurrence');
  assert.equal(code(() => checkRecurrence({ weekdays: [1], pickup_time: '11:00', return_time: '10:00', starts_on: today, skip_holidays: true, skip_dates: [] }, today)), 'invalid_recurrence');
  assert.equal(code(() => checkRecurrence({ weekdays: [1], pickup_time: '07:00', starts_on: '2026-11-19', skip_holidays: true, skip_dates: [] }, today)), 'invalid_recurrence');
  assert.equal(code(() => checkRecurrence({ weekdays: [1], pickup_time: '07:00', starts_on: today, ends_on: '2028-01-01', skip_holidays: true, skip_dates: [] }, today)), 'invalid_recurrence');
  const rule = checkRecurrence({ weekdays: [5, 1, 3, 3], pickup_time: '07:15', return_time: '11:45', starts_on: '2026-12-21', ends_on: '2027-01-08',
    skip_holidays: true, skip_dates: ['2026-12-23'] }, today);
  assert.deepEqual(rule.weekdays, [1, 3, 5]);
  const hol = ['2026-12-25', '2026-12-28', '2027-01-01'];
  const o = occurrences(rule, '2026-12-01', '2027-01-31', hol);
  const dates = [...new Set(o.trips.map((t) => t.date))];
  // Mon 21, (Wed 23 skipped), Fri 25 holiday, Mon 28 holiday, Wed 30, Fri 1 Jan holiday, Mon 4, Wed 6, Fri 8 (last day).
  assert.deepEqual(dates, ['2026-12-21', '2026-12-30', '2027-01-04', '2027-01-06', '2027-01-08']);
  assert.equal(o.trips.length, 10, 'there and back each day');
  assert.deepEqual(o.trips.slice(0, 2).map((t) => [t.time, t.leg]), [['07:15', 'there'], ['11:45', 'back']]);
  assert.deepEqual(o.skipped, [{ date: '2026-12-23', reason: 'skipped' }, { date: '2026-12-25', reason: 'holiday' }, { date: '2026-12-28', reason: 'holiday' }, { date: '2027-01-01', reason: 'holiday' }]);
  // Holidays kept when the series says so (a dialysis unit open on public holidays).
  assert.equal(occurrences({ ...rule, skip_holidays: false, return_time: null }, '2026-12-01', '2027-01-31', hol).trips.length, 8);
  assert.equal(weekdayList([1, 3, 5]), 'Mon, Wed and Fri');
  assert.equal(weekdayList([1, 2, 3, 4, 5]), 'weekdays');
  assert.equal(weekdayList([2]), 'Tue');
});

test('accounting exports: Xero tax-inclusive lines with tracking; MYOB service sales with GST split and a blank line between invoices', () => {
  const inv = (n: string, po = ''): IssuedInvoice => ({ number: n, month: '2026-11', po_number: po, issued_on: '2026-12-01', due_on: '2026-12-15', total_cents: 4400, gst_cents: 400,
    terms_days: 14, bill_to: { name: 'Central Renal, Unit "B"', abn: '51824753556', email: 'ap@example.com', address: '1 Gap Rd', kind: 'health_service' },
    lines: [
      { date: '2026-11-03', trip_ref: 'DG-AAAAAA', traveller: 'Mary K.', description: 'Trip: Home to Renal unit', amount_cents: 3300, refunded_cents: 0, cost_centre: 'RENAL Renal unit',
        purpose: 'Dialysis', po_number: 'PO-9', ndis_number: null, cancellation: false },
      { date: '2026-11-04', trip_ref: 'DG-BBBBBB', traveller: 'Mary K.', description: '=HYPERLINK("x")', amount_cents: 1100, refunded_cents: 0, cost_centre: null,
        purpose: null, po_number: null, ndis_number: '430000000', cancellation: false },
      { date: '2026-11-05', trip_ref: 'DG-CCCCCC', traveller: 'Mary K.', description: 'Trip: refunded', amount_cents: 900, refunded_cents: 900, cost_centre: null,
        purpose: null, po_number: null, ndis_number: null, cancellation: false },
    ] });
  const x = xeroCsv([inv('INV-202611-0001', 'GOV-1')], BILLING_DEFAULTS).replace(/^﻿/, '').trim().split('\r\n');
  assert.equal(x[0].split(',')[0], '*ContactName');
  assert.ok(x[0].includes('*InvoiceNumber') && x[0].includes('*TaxType') && x[0].includes('TrackingOption1'));
  assert.equal(x.length, 3, 'header + two lines (a fully refunded line is left out)');
  assert.ok(x[1].startsWith('"Central Renal, Unit ""B""",ap@example.com,1 Gap Rd,INV-202611-0001,GOV-1,01/12/2026,15/12/2026,'));
  assert.ok(x[1].includes(',1,33.00,200,GST on Income,Cost centre,RENAL Renal unit,AUD'));
  assert.ok(x[2].includes('NDIS 430000000'));
  assert.ok(!x[2].includes(',=HYPERLINK'), 'formula text is neutralised');
  const m = myobCsv([inv('INV-202611-0001'), inv('INV-202611-0002')], BILLING_DEFAULTS).replace(/^﻿/, '').split('\r\n');
  assert.ok(m[0].startsWith('Co./Last Name,Invoice #,Date,Customer PO'));
  assert.ok(m[1].includes(',INV-202611-0001,01/12/2026,PO-9,'));
  assert.ok(m[1].includes(',4-1000,30.00,33.00,RENAL Renal unit,GST,3.00,2,14,DingoGo 2026-11'));
  assert.equal(m[3], '', 'blank line between invoices');
  assert.ok(m[4].includes('INV-202611-0002'));
});
