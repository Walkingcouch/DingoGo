/**
 * Round 24: business and government customers.
 *
 * - Applications: an organisation applies from the website; ops approve (the contact becomes the manager) or decline.
 * - Set-up by the account's managers: members (member / approver / manager), cost centres, purpose codes and booking rules.
 * - Approvals: bookings over the account's approval amount by someone who isn't an approver wait for an approver.
 * - Booking for someone else: a colleague on the account or a guest, texted about the trip.
 * - Monthly invoices: issued for a closed Darwin month with frozen lines, PDF tax invoice, paid / void, reminders, Xero/MYOB CSV.
 * - Usage dashboard for managers and approvers.
 * - Recurring trips booked 14 days ahead, skipping public holidays and chosen dates.
 * Needs migration 027 (`businessReady()`); before it these answer 503 migration_pending.
 */
import { config } from '../config.js';
import { one, pool, q, tx, type Q } from '../db.js';
import { ApiError, bad, conflict, forbidden, notFound } from '../lib/errors.js';
import { audit } from '../lib/audit.js';
import { auMobile } from '../lib/courier.js';
import { CLIENT_BOOKING_KINDS, clientName } from '../lib/community.js';
import { businessApplicationRef, recurringRef, referralCode } from '../lib/ids.js';
import { logError } from '../lib/log.js';
import { Pdf } from '../lib/pdf.js';
import { abnFormat, cents, gstIn, longDate, GST_CODES } from '../lib/tax.js';
import { addDays, darwinTime } from '../lib/tours.js';
import {
  canApprove, checkRecurrence, checkRules, daysBetween, invoiceNumber, mayBookForOthers, myobCsv, occurrences, reminderDue, rulesOf, weekdayList, xeroCsv,
  type BookingRules, type IssuedInvoice, type InvoiceLine, type MemberRole, type RecurrenceRule,
} from '../lib/business.js';
import { billingSettings, businessReady, darwinToday, needBusiness } from './businessRules.js';
import { send, sendSmsT } from './notify.js';
import * as trips from './trips.js';

export interface Me { id: string; role: string; name?: string | null }
const isStaff = (me: Me) => me.role === 'admin' || me.role === 'dispatcher';
const firstName = (s: string | null | undefined) => String(s ?? '').trim().split(/\s+/)[0] || 'Someone';
const prevMonth = (today = darwinToday()) => {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`;
};
export const RECURRING_HORIZON_DAYS = 14;

// ───────────── Access ─────────────
export interface Access { account: any; role: MemberRole; staff: boolean; rules: BookingRules }
/** The caller's place on an active account (staff act as a manager). */
export async function access(me: Me, accountId: string, c: Q = pool): Promise<Access> {
  await needBusiness();
  if (isStaff(me)) {
    const a = await one(`SELECT * FROM corporate_accounts WHERE id = $1`, [accountId], c);
    if (!a) throw notFound('Account');
    return { account: a, role: 'manager', staff: true, rules: rulesOf(a.booking_rules) };
  }
  const m = await one(`SELECT m.role AS member_role, a.* FROM corporate_members m JOIN corporate_accounts a ON a.id = m.account_id
                       WHERE m.account_id = $1 AND m.user_id = $2 AND a.active`, [accountId, me.id], c);
  if (!m) throw forbidden('You are not a member of that business account');
  return { account: m, role: (m.member_role === 'manager' || m.member_role === 'approver' ? m.member_role : 'member'), staff: false, rules: rulesOf(m.booking_rules) };
}
const needManager = (a: Access) => { if (a.role !== 'manager') throw forbidden('Only the account manager can change this'); };
const needApprover = (a: Access) => { if (!canApprove(a.role)) throw forbidden('Only approvers and managers can see this'); };
const accountOut = (a: any) => ({ id: a.id, name: a.name, kind: a.kind, abn: a.abn, billing_email: a.billing_email, address: a.address ?? null,
  monthly_limit_cents: a.monthly_limit_cents, invoice_terms_days: a.invoice_terms_days, discount_pct: a.discount_pct, active: a.active, status: a.status });

// ───────────── Applications ─────────────
export async function apply(b: {
  organisation: string; kind: string; abn: string; billing_email: string; contact_name: string; contact_phone: string; address?: string | null;
  expected_monthly_cents?: number | null; needs?: string[]; notes?: string | null;
}) {
  await needBusiness();
  const mobile = auMobile(b.contact_phone);
  if (!mobile) throw bad('contact_phone', 'Give a mobile number: we text it when the account is open, and it signs in as the manager', { field: 'contact_phone' });
  const exists = await one(`SELECT 1 FROM corporate_accounts WHERE replace(abn, ' ', '') = $1 AND status IN ('pending', 'approved') AND (active OR status = 'pending')`, [b.abn]);
  if (exists) throw conflict('account_exists', 'This ABN already has a DingoGo account or an application being checked. Call us and we will add you to it.');
  const ref = businessApplicationRef();
  const row = await one(
    `INSERT INTO corporate_accounts (name, kind, abn, billing_email, active, status, application, applied_at, contact_name, contact_phone, address)
     VALUES ($1,$2,$3,$4,false,'pending',$5,now(),$6,$7,$8) RETURNING id, name, status, applied_at`,
    [b.organisation, b.kind, b.abn, b.billing_email, JSON.stringify({ ref, expected_monthly_cents: b.expected_monthly_cents ?? null, needs: b.needs ?? [], notes: b.notes ?? null }),
      b.contact_name, mobile, b.address ?? null]);
  void sendSmsT(mobile, 'business_application_received', { org: b.organisation, ref });
  return { ...row, ref };
}

export async function applications(status = 'pending') {
  await needBusiness();
  return q(`SELECT a.*, r.name AS reviewed_by_name FROM corporate_accounts a LEFT JOIN users r ON r.id = a.reviewed_by
            WHERE a.status = $1 ORDER BY a.applied_at DESC NULLS LAST LIMIT 200`, [status]);
}

export async function review(me: Me, id: string, d: { approve: boolean; note?: string | null; monthly_limit_cents?: number | null; invoice_terms_days?: number; discount_pct?: number }) {
  await needBusiness();
  const out = await tx(async (c) => {
    const a = await one(`SELECT * FROM corporate_accounts WHERE id = $1 FOR UPDATE`, [id], c);
    if (!a) throw notFound('Application');
    if (a.status !== 'pending') throw conflict('already_reviewed', `This application was already ${a.status}`);
    if (!d.approve) {
      await c.query(`UPDATE corporate_accounts SET status = 'declined', active = false, reviewed_at = now(), reviewed_by = $2, review_note = $3 WHERE id = $1`, [id, me.id, d.note ?? null]);
      return { a, user: null };
    }
    let u = await one(`SELECT id, name, deleted_at FROM users WHERE phone = $1`, [a.contact_phone], c);
    if (u?.deleted_at) u = null;
    if (!u) u = await one(`INSERT INTO users (phone, name, referral_code) VALUES ($1,$2,$3) ON CONFLICT (phone) DO UPDATE SET phone = EXCLUDED.phone RETURNING id, name`,
      [a.contact_phone, a.contact_name ?? a.name, referralCode(a.contact_name ?? a.name)], c);
    await q(`INSERT INTO corporate_members (account_id, user_id, role) VALUES ($1,$2,'manager') ON CONFLICT (account_id, user_id) DO UPDATE SET role = 'manager'`, [id, u!.id], c);
    await q(
      `UPDATE corporate_accounts SET status = 'approved', active = true, reviewed_at = now(), reviewed_by = $2, review_note = $3,
         monthly_limit_cents = $4, invoice_terms_days = coalesce($5, invoice_terms_days), discount_pct = coalesce($6, discount_pct) WHERE id = $1`,
      [id, me.id, d.note ?? null, d.monthly_limit_cents ?? null, d.invoice_terms_days ?? null, d.discount_pct ?? null], c);
    return { a, user: u };
  });
  await audit(me.id, d.approve ? 'business_application_approved' : 'business_application_declined', 'corporate_account', id, { note: d.note ?? null });
  const a = await one(`SELECT * FROM corporate_accounts WHERE id = $1`, [id]);
  if (d.approve && out.user) {
    void send(out.user.id, 'business_account_approved', { org: a.name, terms: a.invoice_terms_days });
    void sendSmsT(a.contact_phone, 'business_account_approved', { org: a.name, terms: a.invoice_terms_days }, { userId: out.user.id });
  } else if (!d.approve && a.contact_phone) {
    void sendSmsT(a.contact_phone, 'business_account_declined', { org: a.name, note: d.note ?? null });
  }
  return { account: a };
}

// ───────────── Set-up ─────────────
export async function setup(me: Me, accountId: string) {
  const a = await access(me, accountId);
  const [costCentres, purposes] = await Promise.all([
    q(`SELECT cc.*, u.name AS approver_name FROM account_cost_centres cc LEFT JOIN users u ON u.id = cc.approver_id WHERE cc.account_id = $1 ORDER BY cc.active DESC, cc.code`, [accountId]),
    q(`SELECT * FROM account_purposes WHERE account_id = $1 ORDER BY active DESC, code`, [accountId]),
  ]);
  // Approvers and managers see everyone with their mobile; members who may book for colleagues see names only.
  const all = await q(`SELECT u.id, u.name, u.phone, m.role FROM corporate_members m JOIN users u ON u.id = m.user_id WHERE m.account_id = $1 AND u.deleted_at IS NULL ORDER BY m.role DESC, u.name`, [accountId]);
  const members = canApprove(a.role) ? all
    : a.rules.book_for_others === 'everyone' ? all.filter((x) => x.id !== me.id).map((x) => ({ id: x.id, name: x.name })) : [];
  return { account: accountOut(a.account), role: a.role, rules: a.rules, cost_centres: costCentres.filter((x) => canApprove(a.role) || x.active).map((x) => ({ ...x, approver_id: x.approver_id })),
    purposes: purposes.filter((x) => canApprove(a.role) || x.active), members };
}

export async function saveRules(me: Me, accountId: string, input: unknown) {
  const a = await access(me, accountId); needManager(a);
  const rules = checkRules({ ...a.rules, ...(input && typeof input === 'object' ? input as object : {}) });
  await q(`UPDATE corporate_accounts SET booking_rules = $2 WHERE id = $1`, [accountId, JSON.stringify(rules)]);
  await audit(me.id, 'business_rules_updated', 'corporate_account', accountId, rules);
  return { rules };
}

const CODE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,19}$/;
async function checkApprover(accountId: string, approverId: string | null | undefined) {
  if (!approverId) return null;
  if (!(await one(`SELECT 1 FROM corporate_members WHERE account_id = $1 AND user_id = $2`, [accountId, approverId]))) throw bad('invalid_approver', 'The approver must be on the account');
  return approverId;
}
export async function saveCostCentre(me: Me, accountId: string, id: string | null, b: { code?: string; name?: string; approver_id?: string | null; monthly_budget_cents?: number | null; active?: boolean }) {
  const a = await access(me, accountId); needManager(a);
  if (b.code !== undefined && !CODE.test(b.code)) throw bad('invalid_code', 'A code is up to 20 letters, numbers or . _ -', { field: 'code' });
  const approver = b.approver_id === undefined ? undefined : await checkApprover(accountId, b.approver_id);
  try {
    const row = id
      ? await one(`UPDATE account_cost_centres SET code = coalesce($3, code), name = coalesce($4, name), approver_id = CASE WHEN $5::boolean THEN $6::uuid ELSE approver_id END,
                     monthly_budget_cents = CASE WHEN $7::boolean THEN $8::int ELSE monthly_budget_cents END, active = coalesce($9, active)
                   WHERE id = $1 AND account_id = $2 RETURNING *`,
        [id, accountId, b.code ?? null, b.name ?? null, approver !== undefined, approver ?? null, b.monthly_budget_cents !== undefined, b.monthly_budget_cents || null, b.active ?? null])
      : await one(`INSERT INTO account_cost_centres (account_id, code, name, approver_id, monthly_budget_cents) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
        [accountId, b.code, b.name, approver ?? null, b.monthly_budget_cents || null]);
    if (!row) throw notFound('Cost centre');
    await audit(me.id, id ? 'cost_centre_updated' : 'cost_centre_added', 'corporate_account', accountId, { id: row.id, code: row.code });
    return { cost_centre: row };
  } catch (e: any) {
    if (e?.code === '23505') throw conflict('code_taken', 'That code is already used on this account');
    throw e;
  }
}
export async function savePurpose(me: Me, accountId: string, id: string | null, b: { code?: string; label?: string; active?: boolean }) {
  const a = await access(me, accountId); needManager(a);
  if (b.code !== undefined && !CODE.test(b.code)) throw bad('invalid_code', 'A code is up to 20 letters, numbers or . _ -', { field: 'code' });
  try {
    const row = id
      ? await one(`UPDATE account_purposes SET label = coalesce($3, label), active = coalesce($4, active) WHERE id = $1 AND account_id = $2 RETURNING *`, [id, accountId, b.label ?? null, b.active ?? null])
      : await one(`INSERT INTO account_purposes (account_id, code, label) VALUES ($1,$2,$3) RETURNING *`, [accountId, b.code, b.label]);
    if (!row) throw notFound('Purpose');
    return { purpose: row };
  } catch (e: any) {
    if (e?.code === '23505') throw conflict('code_taken', 'That code is already used on this account');
    throw e;
  }
}

/** Add (or change the role of) a member by mobile. New numbers get an account and a text. */
export async function addMember(me: Me, accountId: string, b: { phone: string; name: string; role: MemberRole }) {
  const a = await access(me, accountId); needManager(a);
  const mobile = auMobile(b.phone);
  if (!mobile) throw bad('phone', 'Use an Australian mobile number', { field: 'phone' });
  let u = await one(`SELECT id, name, deleted_at FROM users WHERE phone = $1`, [mobile]);
  if (u?.deleted_at) throw bad('phone', 'That number belongs to a closed DingoGo account');
  if (!u) u = await one(`INSERT INTO users (phone, name, referral_code) VALUES ($1,$2,$3) RETURNING id, name`, [mobile, b.name, referralCode(b.name)]);
  const before = await one(`SELECT role FROM corporate_members WHERE account_id = $1 AND user_id = $2`, [accountId, u!.id]);
  await q(`INSERT INTO corporate_members (account_id, user_id, role) VALUES ($1,$2,$3) ON CONFLICT (account_id, user_id) DO UPDATE SET role = $3`, [accountId, u!.id, b.role]);
  await audit(me.id, 'business_member_saved', 'corporate_account', accountId, { user_id: u!.id, role: b.role });
  if (!before) {
    const by = a.staff ? 'DingoGo' : firstName(me.name ?? (await one(`SELECT name FROM users WHERE id = $1`, [me.id]))?.name);
    void send(u!.id, 'business_member_added', { org: a.account.name, role: b.role, by });
    void sendSmsT(mobile, 'business_member_added', { org: a.account.name, role: b.role, by }, { userId: u!.id });
  }
  return { member: { id: u!.id, name: u!.name, phone: mobile, role: b.role } };
}
export async function removeMember(me: Me, accountId: string, userId: string) {
  const a = await access(me, accountId); needManager(a);
  const managers = await q(`SELECT user_id FROM corporate_members WHERE account_id = $1 AND role = 'manager'`, [accountId]);
  if (managers.length === 1 && managers[0].user_id === userId) throw conflict('last_manager', 'An account needs a manager: make someone else manager first');
  await q(`DELETE FROM corporate_members WHERE account_id = $1 AND user_id = $2`, [accountId, userId]);
  await q(`UPDATE account_cost_centres SET approver_id = NULL WHERE account_id = $1 AND approver_id = $2`, [accountId, userId]);
  await audit(me.id, 'business_member_removed', 'corporate_account', accountId, { user_id: userId });
  return { ok: true };
}

// ───────────── Approvals ─────────────
/** Approvers for a pending trip: the cost centre's approver, else the account's managers and approvers. */
async function approversFor(t: any): Promise<string[]> {
  const cc = t.cost_centre_id ? await one(`SELECT approver_id FROM account_cost_centres WHERE id = $1`, [t.cost_centre_id]) : null;
  if (cc?.approver_id) return [cc.approver_id];
  return (await q(`SELECT user_id FROM corporate_members WHERE account_id = $1 AND role IN ('manager', 'approver')`, [t.corporate_account_id])).map((r) => r.user_id);
}
/** After a booking that waits for approval (called from trips.afterCreate). */
export async function notifyApprovers(t: any) {
  const acct = await one(`SELECT name FROM corporate_accounts WHERE id = $1`, [t.corporate_account_id]);
  const who = (await one(`SELECT name FROM users WHERE id = $1`, [t.booked_by ?? t.rider_id]))?.name;
  for (const id of await approversFor(t)) {
    if (id === (t.booked_by ?? t.rider_id)) continue;
    void send(id, 'business_approval_needed', { org: acct?.name ?? 'Your account', ref: t.ref, who: firstName(who), when: trips.pickupWhen(t.scheduled_for), cents: t.quote_cents },
      { data: { trip_id: t.id, account_id: t.corporate_account_id } });
  }
}

const tripRow = `t.id, t.ref, t.status, t.scheduled_for, t.requested_at, t.completed_at, t.pickup_address, t.dropoff_address, t.quote_cents, t.final_cents,
  t.purpose_code, t.po_number, t.approval_status, t.approval_at, t.recurring_id, t.booked_by, t.rider_id, t.cost_centre_id,
  u.name AS traveller, bu.name AS booked_by_name, cc.code AS cost_centre_code, cc.name AS cost_centre_name`;
const tripJoins = `JOIN users u ON u.id = t.rider_id LEFT JOIN users bu ON bu.id = t.booked_by LEFT JOIN account_cost_centres cc ON cc.id = t.cost_centre_id`;

export async function pendingApprovals(me: Me, accountId: string) {
  const a = await access(me, accountId);
  const ccOnly = !canApprove(a.role);
  const rows = await q(`SELECT ${tripRow} FROM trips t ${tripJoins}
     WHERE t.corporate_account_id = $1 AND t.approval_status = 'pending' AND t.status = 'scheduled' ${ccOnly ? 'AND cc.approver_id = $2' : ''}
     ORDER BY t.scheduled_for LIMIT 200`, ccOnly ? [accountId, me.id] : [accountId]);
  return { approvals: rows };
}

export async function decide(me: Me, tripId: string, d: { approve: boolean; note?: string | null }) {
  await needBusiness();
  const t = await one(`SELECT t.*, cc.approver_id AS cc_approver FROM trips t LEFT JOIN account_cost_centres cc ON cc.id = t.cost_centre_id WHERE t.id = $1`, [tripId]);
  if (!t || !t.corporate_account_id) throw notFound('Trip');
  const a = await access(me, t.corporate_account_id);
  if (!canApprove(a.role) && t.cc_approver !== me.id) throw forbidden('Only approvers and managers can approve trips');
  if (t.approval_status !== 'pending' || t.status !== 'scheduled') throw conflict('not_pending', 'This trip is not waiting for approval');
  if (d.approve) {
    const r = await one(`UPDATE trips SET approval_status = 'approved', approval_by = $2, approval_at = now() WHERE id = $1 AND approval_status = 'pending' AND status = 'scheduled' RETURNING id`, [tripId, me.id]);
    if (!r) throw conflict('not_pending', 'This trip is not waiting for approval');
    await trips.event(pool, tripId, 'approved', me.id, { note: d.note ?? null });
    void send(t.rider_id, 'business_trip_approved', { ref: t.ref, when: trips.pickupWhen(t.scheduled_for) }, { trip: t });
    if (t.booked_by && t.booked_by !== t.rider_id) void send(t.booked_by, 'business_trip_approved', { ref: t.ref, when: trips.pickupWhen(t.scheduled_for) }, { data: { trip_id: t.id } });
  } else {
    // Claim the decision first, so two approvers at once can't both act.
    const r = await one(`UPDATE trips SET approval_status = 'declined', approval_by = $2, approval_at = now() WHERE id = $1 AND approval_status = 'pending' AND status = 'scheduled' RETURNING id`, [tripId, me.id]);
    if (!r) throw conflict('not_pending', 'This trip is not waiting for approval');
    await trips.cancelTrip({ id: me.id, role: 'admin' }, tripId, `Not approved by the account${d.note ? `: ${d.note}` : ''}`);
    void send(t.rider_id, 'business_trip_declined', { ref: t.ref, when: trips.pickupWhen(t.scheduled_for), note: d.note ?? null }, { trip: t });
    if (t.booked_by && t.booked_by !== t.rider_id) void send(t.booked_by, 'business_trip_declined', { ref: t.ref, when: trips.pickupWhen(t.scheduled_for), note: d.note ?? null }, { data: { trip_id: t.id } });
  }
  await audit(me.id, d.approve ? 'business_trip_approved' : 'business_trip_declined', 'trip', tripId, { note: d.note ?? null });
  return { trip: await one(`SELECT ${tripRow} FROM trips t ${tripJoins} WHERE t.id = $1`, [tripId]) };
}

// ───────────── Booking for someone else ─────────────
export type Traveller = { self: true } | { member_id: string } | { consent_id: string } | { name: string; phone: string };
/** Who the trip is for. Colleagues must be on the account; guests get a DingoGo account by mobile; community accounts book
 *  non-staff only with the client's consent (Round 12). */
export async function resolveTraveller(me: Me, a: Access, t: Traveller): Promise<{ id: string; name: string; phone: string | null; consentId: string | null; self: boolean }> {
  if ('self' in t || ('member_id' in t && t.member_id === me.id)) {
    const u = await one(`SELECT id, name, phone FROM users WHERE id = $1`, [me.id]);
    return { ...u, consentId: null, self: true };
  }
  if ('consent_id' in t) {
    const c = await one(`SELECT c.*, u.name, u.phone FROM client_consents c JOIN users u ON u.id = c.client_id
       WHERE c.id = $1 AND c.account_id = $2 AND c.withdrawn_at IS NULL AND (c.expires_at IS NULL OR c.expires_at > now())`, [t.consent_id, a.account.id]).catch(() => null);
    if (!c) throw new ApiError(403, 'consent_required', 'This client has not given (or has withdrawn) consent for your organisation to book for them');
    return { id: c.client_id, name: c.name, phone: c.phone, consentId: c.id, self: false };
  }
  const guest = !('member_id' in t);
  const why = a.staff ? null : mayBookForOthers(a.rules, a.role, guest);
  if (why) throw forbidden(why);
  if ('member_id' in t) {
    const u = await one(`SELECT u.id, u.name, u.phone FROM corporate_members m JOIN users u ON u.id = m.user_id WHERE m.account_id = $1 AND m.user_id = $2 AND u.deleted_at IS NULL`, [a.account.id, t.member_id]);
    if (!u) throw bad('traveller', 'That person is not on this account', { field: 'member_id' });
    return { ...u, consentId: null, self: false };
  }
  if (CLIENT_BOOKING_KINDS.includes(a.account.kind)) {
    throw new ApiError(403, 'consent_required', 'Community, health and NDIS accounts book for clients with their consent: use Book for clients, or add the person to the account as staff');
  }
  const mobile = auMobile(t.phone);
  if (!mobile) throw bad('traveller', "The traveller needs an Australian mobile for their trip texts", { field: 'phone' });
  let u = await one(`SELECT id, name, phone, role, deleted_at FROM users WHERE phone = $1`, [mobile]);
  if (u?.deleted_at) throw bad('traveller', 'That number belongs to a closed DingoGo account', { field: 'phone' });
  if (u && u.role !== 'rider') throw bad('traveller', 'That number belongs to a DingoGo staff or driver account. Use the traveller’s own mobile.', { field: 'phone' });
  if (!u) u = await one(`INSERT INTO users (phone, name, referral_code) VALUES ($1,$2,$3) RETURNING id, name, phone`, [mobile, t.name, referralCode(t.name)]);
  // An existing customer keeps their own name; the booker sees the name they typed.
  return { id: u!.id, name: t.name, phone: mobile, consentId: null, self: false };
}

export interface ForBody {
  account_id: string; traveller: Traveller; service?: string; pickup: any; dropoff: any; scheduled_for?: string | null; passengers?: number;
  needs_wheelchair?: boolean; assistance_animal?: boolean; women_driver_pref?: boolean; notes?: string; ndis_number?: string;
  cost_centre_id?: string | null; purpose_code?: string | null; po_number?: string | null;
}
export async function quoteFor(me: Me, b: ForBody) {
  const a = await access(me, b.account_id);
  const { quote, route } = await trips.buildQuote(me.id, { service: b.service ?? 'ride', pickup: b.pickup, dropoff: b.dropoff, scheduled_for: b.scheduled_for ?? null,
    corporate_account_id: a.account.id }, undefined, { opsBooking: true });
  return { quote, route: { distance_m: route.distance_m, duration_s: route.duration_s },
    needs_approval: a.rules.approval_over_cents > 0 && quote.total_cents > a.rules.approval_over_cents && !canApprove(a.role) };
}
export async function bookFor(me: Me, b: ForBody) {
  const a = await access(me, b.account_id);
  if (!a.account.active) throw forbidden('This account is closed');
  const who = await resolveTraveller(me, a, b.traveller);
  const t = await trips.createTrip(who.id, {
    kind: 'ride', service: b.service ?? 'ride', pickup: b.pickup, dropoff: b.dropoff, scheduled_for: b.scheduled_for ?? null, passengers: b.passengers,
    needs_wheelchair: b.needs_wheelchair, assistance_animal: b.assistance_animal, women_driver_pref: b.women_driver_pref, notes: b.notes, ndis_number: b.ndis_number,
    payment_method: 'corporate', corporate_account_id: a.account.id, channel: who.self ? 'app' : 'org', booked_by: who.self ? undefined : me.id,
    cost_centre_id: b.cost_centre_id ?? null, purpose_code: b.purpose_code ?? null, po_number: b.po_number ?? null,
  });
  await audit(me.id, 'business_trip_booked', 'trip', t.id, { account_id: a.account.id, for: who.self ? 'self' : who.consentId ? 'client' : 'other' });
  if (!who.self) {
    const booker = firstName(me.name ?? (await one(`SELECT name FROM users WHERE id = $1`, [me.id]))?.name);
    void send(who.id, 'ride_booked_for_you', { org: a.staff ? a.account.name : `${booker} at ${a.account.name}`, ref: t.ref, when: trips.pickupWhen(t.scheduled_for ?? new Date()), pickup: t.pickup_address },
      { trip: { id: t.id, channel: 'org' } });
  }
  return { trip: { id: t.id, ref: t.ref, status: t.status, scheduled_for: t.scheduled_for, quote_cents: t.quote_cents, approval_status: t.approval_status ?? null,
    traveller: who.self ? 'You' : clientName(who.name), pickup_address: t.pickup_address, dropoff_address: t.dropoff_address } };
}

/** Trips on the account: approvers/managers see all, members those they took or booked. */
export async function accountTrips(me: Me, accountId: string, f: { month?: string; limit?: number }) {
  const a = await access(me, accountId);
  const all = canApprove(a.role);
  const vals: unknown[] = [accountId];
  const where = [`t.corporate_account_id = $1`, `t.payment_method = 'corporate'`];
  if (!all) { vals.push(me.id); where.push(`(t.rider_id = $2 OR t.booked_by = $2)`); }
  if (f.month) { vals.push(f.month); where.push(`to_char(coalesce(t.scheduled_for, t.requested_at) AT TIME ZONE '${config.timezone}', 'YYYY-MM') = $${vals.length}`); }
  const rows = await q(`SELECT ${tripRow} FROM trips t ${tripJoins} WHERE ${where.join(' AND ')} ORDER BY coalesce(t.scheduled_for, t.requested_at) DESC LIMIT ${Math.min(500, f.limit ?? 100)}`, vals);
  return { trips: rows.map((r) => ({ ...r, traveller: all || r.rider_id === me.id ? r.traveller : clientName(r.traveller) })) };
}

// ───────────── Invoice lines and usage ─────────────
/** Trips and late-cancel fees billed to the account in a Darwin month, with refunds so far and the business fields. */
async function billedLines(accountId: string, month: string, c: Q = pool) {
  return q(
    `SELECT t.id, t.ref, coalesce(t.completed_at, t.cancelled_at) AS at, to_char(coalesce(t.completed_at, t.cancelled_at) AT TIME ZONE $3, 'YYYY-MM-DD') AS day,
            u.name AS traveller, bu.name AS booked_by, t.rider_id, t.pickup_address, t.dropoff_address,
            coalesce(t.final_cents, t.cancel_fee_cents)::int AS amount_cents, t.ndis_number, (t.status <> 'completed') AS cancellation,
            t.po_number, t.purpose_code, coalesce(p.label, t.purpose_code) AS purpose, cc.code AS cc_code, cc.name AS cc_name,
            coalesce((SELECT -sum(x.amount_cents) FROM payments x WHERE x.trip_id = t.id AND x.kind = 'refund' AND x.status = 'succeeded'), 0)::int AS refunded_cents
     FROM trips t JOIN users u ON u.id = t.rider_id LEFT JOIN users bu ON bu.id = t.booked_by
     LEFT JOIN account_cost_centres cc ON cc.id = t.cost_centre_id LEFT JOIN account_purposes p ON p.account_id = t.corporate_account_id AND p.code = t.purpose_code
     WHERE t.corporate_account_id = $1 AND t.payment_method = 'corporate'
       AND (t.status = 'completed' OR (t.status::text LIKE 'cancelled%' AND t.cancel_fee_cents > 0))
       AND to_char(coalesce(t.completed_at, t.cancelled_at) AT TIME ZONE $3, 'YYYY-MM') = $2
     ORDER BY coalesce(t.completed_at, t.cancelled_at)`, [accountId, month, config.timezone], c);
}
const toLine = (r: any): InvoiceLine => ({
  date: r.day, trip_ref: r.ref, traveller: r.traveller, booked_by: r.booked_by ?? null,
  description: `${r.cancellation ? 'Late cancellation' : 'Trip'}: ${r.pickup_address} to ${r.dropoff_address}`,
  amount_cents: r.amount_cents, refunded_cents: r.refunded_cents, cost_centre: r.cc_code ? `${r.cc_code} ${r.cc_name}` : null,
  purpose: r.purpose ?? null, po_number: r.po_number ?? null, ndis_number: r.ndis_number ?? null, cancellation: r.cancellation,
});

export async function usage(me: Me, accountId: string, month?: string) {
  const a = await access(me, accountId); needApprover(a);
  const m = month && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : trips.localMonth();
  const lines = await billedLines(accountId, m);
  const group = (key: (l: any) => string) => {
    const by = new Map<string, { key: string; trips: number; spend_cents: number }>();
    for (const l of lines) {
      const k = key(l); const g = by.get(k) ?? { key: k, trips: 0, spend_cents: 0 };
      g.trips += l.cancellation ? 0 : 1; g.spend_cents += l.amount_cents - l.refunded_cents; by.set(k, g);
    }
    return [...by.values()].sort((x, y) => y.spend_cents - x.spend_cents);
  };
  const charges = lines.reduce((n, l) => n + l.amount_cents, 0);
  const refunds = lines.reduce((n, l) => n + l.refunded_cents, 0);
  const done = lines.filter((l) => !l.cancellation).length;
  const limit = Number(a.account.monthly_limit_cents ?? 0);
  const used = limit > 0 ? await trips.accountMonthCents(pool, accountId, m) : 0;
  const [pending, booked, invoices, series] = await Promise.all([
    one<{ n: number }>(`SELECT count(*)::int n FROM trips WHERE corporate_account_id = $1 AND approval_status = 'pending' AND status = 'scheduled'`, [accountId]),
    one<{ n: number; c: number }>(`SELECT count(*)::int n, coalesce(sum(quote_cents), 0)::int c FROM trips WHERE corporate_account_id = $1 AND payment_method = 'corporate' AND status = 'scheduled'`, [accountId]),
    q(`SELECT id, number, month, total_cents, due_on::text AS due_on, status FROM account_invoices WHERE account_id = $1 AND status = 'issued' ORDER BY due_on`, [accountId]),
    one<{ n: number }>(`SELECT count(*)::int n FROM account_recurring_trips WHERE account_id = $1 AND active`, [accountId]),
  ]);
  const today = darwinToday();
  const overdue = invoices.filter((i) => i.due_on < today);
  return {
    account: accountOut(a.account), month: m,
    totals: { trips: done, cancellation_fees: lines.length - done, charges_cents: charges, refunds_cents: refunds, spend_cents: charges - refunds,
      gst_cents: gstIn(charges - refunds), average_cents: done ? Math.round((charges - refunds) / done) : 0 },
    limit: limit > 0 ? { limit_cents: limit, used_cents: used, left_cents: Math.max(0, limit - used) } : null,
    by_cost_centre: group((l) => (l.cc_code ? `${l.cc_code} ${l.cc_name}` : 'No cost centre')),
    by_purpose: group((l) => l.purpose ?? 'No purpose'),
    by_traveller: group((l) => l.traveller ?? 'Unknown').slice(0, 20),
    by_day: group((l) => l.day).sort((x, y) => x.key.localeCompare(y.key)),
    approvals_waiting: pending?.n ?? 0, booked: { trips: booked?.n ?? 0, quote_cents: booked?.c ?? 0 }, recurring_series: series?.n ?? 0,
    invoices: { open: invoices.length, open_cents: invoices.reduce((n, i) => n + i.total_cents, 0), overdue: overdue.length,
      overdue_cents: overdue.reduce((n, i) => n + i.total_cents, 0), list: invoices.map((i) => ({ ...i, overdue_days: Math.max(0, daysBetween(i.due_on, today)) })) },
  };
}

// ───────────── Invoices ─────────────
const invOut = (r: any, today = darwinToday()) => ({
  ...r, issued_on: String(r.issued_on instanceof Date ? r.issued_on.toISOString().slice(0, 10) : r.issued_on).slice(0, 10),
  due_on: String(r.due_on instanceof Date ? r.due_on.toISOString().slice(0, 10) : r.due_on).slice(0, 10),
  overdue_days: r.status === 'issued' ? Math.max(0, daysBetween(String(r.due_on).slice(0, 10), today)) : 0,
});
const INV_COLS = `i.id, i.number, i.account_id, i.month, i.po_number, i.issued_on::text AS issued_on, i.due_on::text AS due_on, i.charges_cents, i.refunds_cents,
  i.total_cents, i.gst_cents, i.status, i.paid_on::text AS paid_on, i.paid_ref, i.void_reason, i.reminders, i.last_reminder_on::text AS last_reminder_on, i.created_at`;

/** Issue invoices for a closed Darwin month: every account with billed trips (or one account). Never twice (per account, month and PO). */
export async function issueInvoices(o: { month?: string; accountId?: string; actorId: string | null }) {
  await needBusiness();
  const month = o.month ?? prevMonth();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad('bad_period', 'Month looks like 2026-11');
  if (month >= trips.localMonth()) throw bad('month_not_closed', 'Invoices are issued once the month has ended (Darwin time)');
  const accounts = o.accountId
    ? await q(`SELECT * FROM corporate_accounts WHERE id = $1`, [o.accountId])
    : await q(`SELECT DISTINCT a.* FROM corporate_accounts a JOIN trips t ON t.corporate_account_id = a.id AND t.payment_method = 'corporate'
               WHERE to_char(coalesce(t.completed_at, t.cancelled_at) AT TIME ZONE $2, 'YYYY-MM') = $1`, [month, config.timezone]);
  const issued: any[] = []; const skipped: { account: string; reason: string }[] = [];
  const today = darwinToday();
  for (const a of accounts) {
    const made = await tx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`invoice:${a.id}:${month}`]);
      const lines = (await billedLines(a.id, month, c)).map(toLine);
      if (!lines.length) { skipped.push({ account: a.name, reason: 'No trips billed to the account that month' }); return []; }
      const rules = rulesOf(a.booking_rules);
      const groups = new Map<string, InvoiceLine[]>();
      for (const l of lines) { const k = rules.invoice_per_po ? (l.po_number ?? '') : ''; groups.set(k, [...(groups.get(k) ?? []), l]); }
      const out: any[] = [];
      for (const [po, ls] of groups) {
        if (await one(`SELECT 1 FROM account_invoices WHERE account_id = $1 AND month = $2 AND po_number = $3 AND status <> 'void'`, [a.id, month, po], c)) {
          skipped.push({ account: a.name, reason: `Already issued${po ? ` for PO ${po}` : ''}` }); continue;
        }
        await c.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`invoice-number:${month}`]);
        const n = (await one<{ n: number }>(`SELECT count(*)::int n FROM account_invoices WHERE month = $1`, [month], c))!.n + 1;
        const charges = ls.reduce((s, l) => s + l.amount_cents, 0); const refunds = ls.reduce((s, l) => s + l.refunded_cents, 0);
        const total = charges - refunds;
        const billTo = { name: a.name, abn: a.abn ?? null, email: a.billing_email, address: a.address ?? null, kind: a.kind, contact_name: a.contact_name ?? null, terms_days: a.invoice_terms_days };
        out.push(await one(
          `INSERT INTO account_invoices (number, account_id, month, po_number, issued_on, due_on, charges_cents, refunds_cents, total_cents, gst_cents, bill_to, lines, created_by)
           VALUES ($1,$2,$3,$4,$5::date,$5::date + $6::int,$7,$8,$9,$10,$11,$12,$13) RETURNING id, number, account_id, month, po_number, issued_on::text AS issued_on, due_on::text AS due_on, total_cents, gst_cents, status`,
          [invoiceNumber(month, n), a.id, month, po, today, a.invoice_terms_days, charges, refunds, total, gstIn(total), JSON.stringify(billTo), JSON.stringify(ls), o.actorId], c));
      }
      return out;
    });
    for (const inv of made) {
      issued.push({ ...inv, account: a.name });
      for (const m of await q(`SELECT user_id FROM corporate_members WHERE account_id = $1 AND role = 'manager'`, [a.id])) {
        void send(m.user_id, 'invoice_issued', { org: a.name, number: inv.number, cents: inv.total_cents, due: longDate(inv.due_on) }, { data: { invoice_id: inv.id } });
      }
    }
  }
  if (issued.length) await audit(o.actorId, 'business_invoices_issued', 'settings', 'business_billing', { month, numbers: issued.map((i) => i.number) });
  return { month, issued, skipped };
}

export async function listInvoices(f: { month?: string; status?: string; accountId?: string }) {
  await needBusiness();
  const vals: unknown[] = []; const where: string[] = [];
  const add = (v: unknown) => { vals.push(v); return `$${vals.length}`; };
  if (f.month) where.push(`i.month = ${add(f.month)}`);
  if (f.accountId) where.push(`i.account_id = ${add(f.accountId)}`);
  if (f.status === 'overdue') where.push(`i.status = 'issued' AND i.due_on < ${add(darwinToday())}::date`);
  else if (f.status && f.status !== 'all') where.push(`i.status = ${add(f.status)}`);
  const rows = await q(`SELECT ${INV_COLS}, a.name AS account FROM account_invoices i JOIN corporate_accounts a ON a.id = i.account_id
     ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY i.issued_on DESC, i.number DESC LIMIT 500`, vals);
  const today = darwinToday();
  const out = rows.map((r) => invOut(r, today));
  const open = out.filter((r) => r.status === 'issued');
  return { invoices: out, summary: { open: open.length, open_cents: open.reduce((n, r) => n + r.total_cents, 0),
    overdue: open.filter((r) => r.overdue_days > 0).length, overdue_cents: open.filter((r) => r.overdue_days > 0).reduce((n, r) => n + r.total_cents, 0) } };
}

export async function getInvoice(id: string) {
  await needBusiness();
  const r = await one(`SELECT ${INV_COLS}, i.bill_to, i.lines, a.name AS account FROM account_invoices i JOIN corporate_accounts a ON a.id = i.account_id WHERE i.id = $1`, [id]);
  if (!r) throw notFound('Invoice');
  return invOut(r);
}
/** A manager's (or approver's) view of their account's invoices. */
export async function myInvoices(me: Me, accountId: string) {
  const a = await access(me, accountId); needApprover(a);
  return listInvoices({ accountId });
}
export async function myInvoice(me: Me, id: string) {
  const inv = await getInvoice(id);
  const a = await access(me, inv.account_id); needApprover(a);
  return inv;
}

export async function markPaid(me: Me, id: string, b: { paid_on?: string; paid_ref?: string | null }) {
  await needBusiness();
  const r = await one(`UPDATE account_invoices SET status = 'paid', paid_on = coalesce($2::date, $4::date), paid_ref = $3, updated_by = $5 WHERE id = $1 AND status = 'issued' RETURNING number`,
    [id, b.paid_on ?? null, b.paid_ref ?? null, darwinToday(), me.id]);
  if (!r) throw conflict('not_open', 'Only an unpaid invoice can be marked paid');
  await audit(me.id, 'business_invoice_paid', 'account_invoice', id, b);
  return getInvoice(id);
}
export async function voidInvoice(me: Me, id: string, reason: string) {
  await needBusiness();
  const r = await one(`UPDATE account_invoices SET status = 'void', void_reason = $2, updated_by = $3 WHERE id = $1 AND status = 'issued' RETURNING number`, [id, reason, me.id]);
  if (!r) throw conflict('not_open', 'Only an unpaid invoice can be voided (record a credit for a paid one)');
  await audit(me.id, 'business_invoice_void', 'account_invoice', id, { reason });
  return getInvoice(id);
}

const asIssued = (inv: any): IssuedInvoice => ({ number: inv.number, month: inv.month, po_number: inv.po_number, issued_on: inv.issued_on, due_on: inv.due_on,
  total_cents: inv.total_cents, gst_cents: inv.gst_cents, bill_to: inv.bill_to, lines: inv.lines, terms_days: Number(inv.bill_to?.terms_days ?? daysBetween(inv.issued_on, inv.due_on)) });

export async function exportInvoices(month: string, format: 'xero' | 'myob') {
  await needBusiness();
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw bad('bad_period', 'Month looks like 2026-11');
  const rows = await q(`SELECT ${INV_COLS}, i.bill_to, i.lines FROM account_invoices i WHERE i.month = $1 AND i.status <> 'void' ORDER BY i.number`, [month]);
  const s = await billingSettings();
  const list = rows.map((r) => asIssued(invOut(r)));
  return format === 'xero' ? xeroCsv(list, s) : myobCsv(list, s);
}

/** PDF tax invoice. NDIS plan-manager invoices list supports per participant with the NDIS number and support item. */
export async function invoicePdf(inv: any) {
  const { business, ndisSettings } = await import('./tax.js');
  const [biz, ndis, s] = await Promise.all([business(), ndisSettings(), billingSettings()]);
  const b = inv.bill_to; const lines: InvoiceLine[] = inv.lines;
  const isNdis = b.kind === 'ndis_plan_manager' || lines.some((l) => l.ndis_number);
  const doc = new Pdf(`DingoGo tax invoice ${inv.number}`, `${biz.trading_name} · tax invoice ${inv.number}${inv.status === 'void' ? ' · VOID' : ''}`);
  doc.heading(inv.status === 'void' ? 'Tax invoice (void)' : 'Tax invoice');
  doc.rows([['Invoice number', inv.number], ['Date of issue', longDate(inv.issued_on)], ['Payment due', longDate(inv.due_on)],
    ['Period', inv.month], ...(inv.po_number ? [['Purchase order', inv.po_number] as [string, string]] : [])]);
  doc.rule();
  doc.para(`From: ${biz.name}${biz.trading_name !== biz.name ? ` trading as ${biz.trading_name}` : ''}, ABN ${abnFormat(biz.abn)}${biz.address ? `, ${biz.address}` : ''}`, 10, true);
  if (isNdis) doc.para(ndis.registration_number ? `NDIS registered provider ${ndis.registration_number}. Support item ${ndis.support_item || 'to be set'} (${ndis.support_name}), GST code ${ndis.gst_code}.` : 'DingoGo is not an NDIS-registered provider.', 9);
  doc.para(`To: ${b.name}${b.abn ? `, ABN ${abnFormat(b.abn)}` : ''}${b.address ? `, ${b.address}` : ''}${b.contact_name ? `, attention ${b.contact_name}` : ''} (${b.email})`, 10);
  doc.gap();
  const amount = (l: InvoiceLine) => cents(l.amount_cents) + (l.refunded_cents ? ` (refund -${cents(l.refunded_cents)})` : '');
  const detail = (l: InvoiceLine) => [l.cost_centre, l.purpose, !inv.po_number && l.po_number ? `PO ${l.po_number}` : null].filter(Boolean).join(' · ');
  const cols = [{ label: 'Date', width: 0.12 }, { label: 'Trip', width: 0.12 }, { label: 'Traveller', width: 0.16 }, { label: 'Route', width: 0.32 },
    { label: 'Cost centre / purpose', width: 0.14 }, { label: 'Amount', width: 0.14, align: 'right' as const }];
  const row = (l: InvoiceLine) => [longDate(l.date), l.trip_ref, l.traveller ?? '', l.description, detail(l), amount(l)];
  if (isNdis) {
    const by = new Map<string, InvoiceLine[]>();
    for (const l of lines) { const k = l.ndis_number ? `${l.traveller} (NDIS ${l.ndis_number})` : `${l.traveller} (no NDIS number)`; by.set(k, [...(by.get(k) ?? []), l]); }
    for (const [who, ls] of by) {
      doc.para(`Participant: ${who}`, 10, true);
      const sub = ls.reduce((n, l) => n + l.amount_cents - l.refunded_cents, 0);
      doc.table([{ label: 'Date', width: 0.13 }, { label: 'Support', width: 0.45 }, { label: 'Item number', width: 0.2 }, { label: 'GST', width: 0.07 }, { label: 'Amount', width: 0.15, align: 'right' }],
        [...ls.map((l) => [longDate(l.date), `${l.description} (${l.trip_ref})`, ndis.support_item || 'to be set', ndis.gst_code, amount(l)]), ['', 'Subtotal', '', '', cents(sub)]], { size: 8.5, boldLast: true });
    }
  } else {
    doc.table(cols, lines.map(row), { size: 8 });
  }
  const rows: [string, string][] = [];
  if (inv.refunds_cents) rows.push(['Trips and fees', cents(inv.charges_cents)], ['Refunds', `-${cents(inv.refunds_cents)}`]);
  rows.push(['Total incl. GST', cents(inv.total_cents)]);
  doc.rows(rows, { boldLast: true });
  doc.rows([[isNdis && ndis.gst_code !== 'P1' ? `GST (${GST_CODES[ndis.gst_code]})` : 'GST included', cents(isNdis && ndis.gst_code !== 'P1' ? 0 : inv.gst_cents)]]);
  doc.gap();
  doc.para(`Please pay by ${longDate(inv.due_on)} quoting ${inv.number}.${s.pay_to ? ` ${s.pay_to}` : ' Payment details: call DingoGo.'}`, 9.5, true);
  doc.para('Each trip is supplied by the driver named on its trip receipt; DingoGo issues this invoice and collects payment as their agent and for its own booking fee. Trip receipts with each driver\'s ABN are in the DingoGo app.', 8);
  if (inv.status === 'void') doc.para(`This invoice was voided${inv.void_reason ? `: ${inv.void_reason}` : ''}. Do not pay it.`, 10, true);
  return doc.toBuffer();
}

// ───────────── Reminders and automatic issue ─────────────
export async function runReminders(o: { today?: string; actorId?: string | null } = {}) {
  await needBusiness();
  const today = o.today ?? darwinToday();
  const s = await billingSettings();
  const open = await q(`SELECT i.id, i.number, i.account_id, i.total_cents, i.status, i.due_on::text AS due_on, i.reminders, i.last_reminder_on::text AS last_reminder_on, a.name
                        FROM account_invoices i JOIN corporate_accounts a ON a.id = i.account_id WHERE i.status = 'issued' AND i.due_on < $1::date`, [today]);
  const sent: { number: string; reminder: number; days: number; to: number }[] = [];
  for (const inv of open) {
    const n = reminderDue(inv, s.reminder_days, today);
    if (!n) continue;
    const r = await one(`UPDATE account_invoices SET reminders = $2, last_reminder_on = $3::date WHERE id = $1 AND reminders = $4 AND status = 'issued' RETURNING id`, [inv.id, n, today, inv.reminders]);
    if (!r) continue;
    const days = daysBetween(inv.due_on, today);
    const managers = await q(`SELECT u.id, u.phone FROM corporate_members m JOIN users u ON u.id = m.user_id WHERE m.account_id = $1 AND m.role = 'manager' AND u.deleted_at IS NULL`, [inv.account_id]);
    for (const m of managers) {
      void send(m.id, 'invoice_overdue', { org: inv.name, number: inv.number, cents: inv.total_cents, days }, { data: { invoice_id: inv.id } });
      if (m.phone) void sendSmsT(m.phone, 'invoice_overdue', { org: inv.name, number: inv.number, cents: inv.total_cents, days }, { userId: m.id });
    }
    await audit(o.actorId ?? null, 'business_invoice_reminder', 'account_invoice', inv.id, { reminder: n, days_overdue: days, managers: managers.length });
    sent.push({ number: inv.number, reminder: n, days, to: managers.length });
  }
  return { today, sent };
}

let lastBilling = 0;
/** From the dispatcher tick (every few hours at most): last month's invoices on the 1st when automatic, then reminders. */
export async function runBillingIfDue() {
  if (Date.now() - lastBilling < 3 * 3600e3) return;
  lastBilling = Date.now();
  if (!(await businessReady())) return;
  const s = await billingSettings();
  if (s.auto_issue) {
    const month = prevMonth();
    const last = (await one(`SELECT value FROM settings WHERE key = 'business_billing_last_issue'`))?.value;
    if (last?.month !== month) {
      await issueInvoices({ month, actorId: null });
      await q(`INSERT INTO settings (key, value) VALUES ('business_billing_last_issue', $1) ON CONFLICT (key) DO UPDATE SET value = $1`, [JSON.stringify({ month, at: new Date().toISOString() })]);
    }
  }
  await runReminders();
}
export function resetBillingClock() { lastBilling = 0; lastRecurring = 0; }

// ───────────── Recurring trips ─────────────
export interface RecurringBody extends RecurrenceRule {
  account_id: string; traveller: Traveller; pickup: any; dropoff: any; dry_run?: boolean;
  options?: { cost_centre_id?: string | null; purpose_code?: string | null; po_number?: string | null; ndis_number?: string; notes?: string;
    needs_wheelchair?: boolean; assistance_animal?: boolean; passengers?: number; women_driver_pref?: boolean };
}
const holidays = async () => (await q<{ day: string }>(`SELECT day::text AS day FROM public_holidays`)).map((h) => h.day);

export async function createRecurring(me: Me, b: RecurringBody) {
  const a = await access(me, b.account_id);
  if (!a.account.active) throw forbidden('This account is closed');
  const today = darwinToday();
  const rule = checkRecurrence({ weekdays: b.weekdays, pickup_time: b.pickup_time, return_time: b.return_time ?? null, starts_on: b.starts_on, ends_on: b.ends_on ?? null,
    skip_holidays: b.skip_holidays, skip_dates: b.skip_dates ?? [] }, today);
  const who = await resolveTraveller(me, a, b.traveller);
  const hol = await holidays();
  const preview = occurrences(rule, today, addDays(today, RECURRING_HORIZON_DAYS - 1), hol);
  if (b.dry_run) return { preview: { trips: preview.trips.slice(0, 40), skipped: preview.skipped }, traveller: who.self ? 'You' : clientName(who.name) };
  const row = await one(
    `INSERT INTO account_recurring_trips (ref, account_id, created_by, rider_id, consent_id, pickup, dropoff, weekdays, pickup_time, return_time, starts_on, ends_on,
       skip_holidays, skip_dates, options) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
    [recurringRef(), a.account.id, me.id, who.id, who.consentId, JSON.stringify(b.pickup), JSON.stringify(b.dropoff), rule.weekdays, rule.pickup_time, rule.return_time,
      rule.starts_on, rule.ends_on ?? null, rule.skip_holidays, rule.skip_dates, JSON.stringify(b.options ?? {})]);
  await audit(me.id, 'business_recurring_created', 'corporate_account', a.account.id, { id: row.id, ref: row.ref });
  const run = await generateSeries(row.id, { notify: false });
  if (!who.self) {
    const first = run.booked[0]?.scheduled_for;
    void send(who.id, 'regular_rides_booked', { org: a.staff ? a.account.name : `${firstName(me.name ?? (await one(`SELECT name FROM users WHERE id = $1`, [me.id]))?.name)} at ${a.account.name}`,
      days: weekdayList(rule.weekdays), time: timeText(rule.pickup_time), pickup: b.pickup.address ?? 'your pickup', next: first ? trips.pickupWhen(first) : 'soon' },
      { trip: { id: run.booked[0]?.id ?? row.id, channel: 'org' } });
  }
  return { series: await seriesOut(row.id), booked: run.booked, problems: run.problems, skipped: run.skipped };
}
const timeText = (hhmm: string) => {
  const [h, m] = hhmm.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`;
};

async function seriesOut(id: string) {
  const r = await one(`SELECT s.*, u.name AS traveller, cb.name AS created_by_name, s.starts_on::text AS starts_on, s.ends_on::text AS ends_on, s.booked_through::text AS booked_through,
       (SELECT array_agg(d::text ORDER BY d) FROM unnest(s.skip_dates) d) AS skip_list,
       (SELECT count(*)::int FROM trips t WHERE t.recurring_id = s.id AND t.status = 'scheduled') AS upcoming,
       (SELECT min(t.scheduled_for) FROM trips t WHERE t.recurring_id = s.id AND t.status = 'scheduled') AS next_at
     FROM account_recurring_trips s JOIN users u ON u.id = s.rider_id LEFT JOIN users cb ON cb.id = s.created_by WHERE s.id = $1`, [id]);
  if (!r) return null;
  const { skip_list, skip_dates, ...rest } = r;
  return { ...rest, skip_dates: skip_list ?? [], days: weekdayList(r.weekdays) };
}

/** Book a series' trips up to the horizon. Never twice for the same time (unique index); problems are recorded on the series. */
export async function generateSeries(id: string, o: { notify?: boolean; now?: Date } = {}) {
  const now = o.now ?? new Date();
  const today = darwinToday(now);
  const s = await one(`SELECT *, starts_on::text AS starts_on, ends_on::text AS ends_on, booked_through::text AS booked_through,
       (SELECT array_agg(d::text) FROM unnest(skip_dates) d) AS skip_list FROM account_recurring_trips WHERE id = $1`, [id]);
  const out = { booked: [] as any[], problems: [] as { date: string; time: string; reason: string }[], skipped: [] as { date: string; reason: string }[] };
  if (!s || !s.active) return out;
  const acct = await one(`SELECT * FROM corporate_accounts WHERE id = $1`, [s.account_id]);
  const stop = async (reason: string) => {
    await q(`UPDATE account_recurring_trips SET active = false, stopped_reason = $2 WHERE id = $1`, [id, reason]);
    if (s.created_by) void send(s.created_by, 'recurring_problem', { ref: s.ref, date: longDate(today), reason: `${reason}. The series has stopped.` });
  };
  if (!acct?.active) { await stop('The account is closed'); return out; }
  if (s.consent_id) {
    const c = await one(`SELECT 1 FROM client_consents WHERE id = $1 AND withdrawn_at IS NULL AND (expires_at IS NULL OR expires_at > now())`, [s.consent_id]);
    if (!c) { await stop('The client withdrew consent (or it expired)'); return out; }
  }
  const to = addDays(today, RECURRING_HORIZON_DAYS - 1);
  const from = s.booked_through && s.booked_through >= today ? addDays(s.booked_through, 1) : today;
  const rule: RecurrenceRule = { weekdays: s.weekdays, pickup_time: s.pickup_time, return_time: s.return_time, starts_on: s.starts_on, ends_on: s.ends_on,
    skip_holidays: s.skip_holidays, skip_dates: s.skip_list ?? [] };
  const occ = occurrences(rule, from, to, await holidays());
  out.skipped = occ.skipped;
  const opt = s.options ?? {};
  for (const x of occ.trips) {
    const at = darwinTime(x.date, x.time);
    if (at.getTime() < now.getTime() + 30 * 60_000) continue;   // too soon to book (and booked trips are at least 20 minutes ahead)
    if (await one(`SELECT 1 FROM trips WHERE recurring_id = $1 AND scheduled_for = $2`, [id, at])) continue;
    const [pickup, dropoff] = x.leg === 'there' ? [s.pickup, s.dropoff] : [s.dropoff, s.pickup];
    try {
      const t = await trips.createTrip(s.rider_id, {
        kind: 'ride', service: 'ride', pickup, dropoff, scheduled_for: at.toISOString(), passengers: opt.passengers, needs_wheelchair: opt.needs_wheelchair,
        assistance_animal: opt.assistance_animal, women_driver_pref: opt.women_driver_pref, notes: opt.notes, ndis_number: opt.ndis_number,
        payment_method: 'corporate', corporate_account_id: s.account_id,
        channel: s.created_by && s.created_by !== s.rider_id ? 'org' : 'app', booked_by: s.created_by && s.created_by !== s.rider_id ? s.created_by : undefined,
        cost_centre_id: opt.cost_centre_id ?? null, purpose_code: opt.purpose_code ?? null, po_number: opt.po_number ?? null, recurring_id: id,
      });
      out.booked.push({ id: t.id, ref: t.ref, scheduled_for: t.scheduled_for, leg: x.leg, approval_status: t.approval_status ?? null });
    } catch (e: any) {
      if (e?.code === '23505') continue;     // booked by another run at the same moment
      if (!(e instanceof ApiError)) { logError('recurring trip', e); }
      out.problems.push({ date: x.date, time: x.time, reason: e instanceof ApiError ? e.message : 'Something went wrong booking it' });
    }
  }
  await q(`UPDATE account_recurring_trips SET booked_through = GREATEST(coalesce(booked_through, $2::date), $2::date), last_run = $3 WHERE id = $1`,
    [id, to, JSON.stringify({ at: now.toISOString(), booked: out.booked.length, problems: out.problems.slice(0, 20), skipped: out.skipped.slice(0, 20) })]);
  if (o.notify !== false && out.problems.length && s.created_by) {
    const p = out.problems[0];
    void send(s.created_by, 'recurring_problem', { ref: s.ref, date: `${longDate(p.date)} ${timeText(p.time)}`, reason: `${p.reason}${out.problems.length > 1 ? ` (and ${out.problems.length - 1} more)` : ''}` });
  }
  return out;
}

let lastRecurring = 0;
/** From the dispatcher tick, hourly at most: top up every active series to the horizon. */
export async function runRecurringIfDue() {
  if (Date.now() - lastRecurring < 3600e3) return;
  lastRecurring = Date.now();
  if (!(await businessReady())) return;
  const horizon = addDays(darwinToday(), RECURRING_HORIZON_DAYS - 1);
  const due = await q(`SELECT id FROM account_recurring_trips WHERE active AND (booked_through IS NULL OR booked_through < $1::date)
                         AND (ends_on IS NULL OR ends_on >= $2::date) ORDER BY booked_through NULLS FIRST LIMIT 25`, [horizon, darwinToday()]);
  for (const d of due) await generateSeries(d.id).catch((e) => logError('recurring series', e));
}

export async function listRecurring(me: Me, accountId: string) {
  const a = await access(me, accountId);
  const ids = await q(`SELECT id FROM account_recurring_trips WHERE account_id = $1 ${canApprove(a.role) ? '' : 'AND (created_by = $2 OR rider_id = $2)'} ORDER BY active DESC, created_at DESC LIMIT 200`,
    canApprove(a.role) ? [accountId] : [accountId, me.id]);
  return { series: (await Promise.all(ids.map((r) => seriesOut(r.id)))).filter(Boolean) };
}

async function seriesAccess(me: Me, id: string) {
  await needBusiness();
  const s = await one(`SELECT * FROM account_recurring_trips WHERE id = $1`, [id]);
  if (!s) throw notFound('Series');
  const a = await access(me, s.account_id);
  if (!canApprove(a.role) && s.created_by !== me.id) throw forbidden('Only the person who set it up or an approver can change this series');
  return s;
}
/** Skip one date (clinic closed): added to the series and any trip booked that day is cancelled. */
export async function skipDate(me: Me, id: string, date: string) {
  const s = await seriesAccess(me, id);
  await q(`UPDATE account_recurring_trips SET skip_dates = (SELECT array_agg(DISTINCT d) FROM unnest(array_append(skip_dates, $2::date)) d) WHERE id = $1`, [id, date]);
  const booked = await q(`SELECT id FROM trips WHERE recurring_id = $1 AND status = 'scheduled' AND to_char(scheduled_for AT TIME ZONE $3, 'YYYY-MM-DD') = $2`, [id, date, config.timezone]);
  for (const t of booked) await trips.cancelTrip({ id: s.rider_id, role: 'rider' }, t.id, 'Date skipped in the regular booking').catch((e) => logError('skip recurring', e));
  await audit(me.id, 'business_recurring_skip', 'corporate_account', s.account_id, { id, date, cancelled: booked.length });
  return { series: await seriesOut(id), cancelled: booked.length };
}
export async function stopRecurring(me: Me, id: string, cancelBooked: boolean) {
  const s = await seriesAccess(me, id);
  await q(`UPDATE account_recurring_trips SET active = false, stopped_reason = coalesce(stopped_reason, $2) WHERE id = $1`, [id, 'Stopped']);
  let cancelled = 0;
  if (cancelBooked) {
    for (const t of await q(`SELECT id FROM trips WHERE recurring_id = $1 AND status = 'scheduled'`, [id])) {
      await trips.cancelTrip({ id: s.rider_id, role: 'rider' }, t.id, 'Regular booking stopped').then(() => cancelled++).catch((e) => logError('stop recurring', e));
    }
  }
  await audit(me.id, 'business_recurring_stopped', 'corporate_account', s.account_id, { id, cancelled });
  return { series: await seriesOut(id), cancelled };
}

/** Months an account has activity in (for the usage month picker). */
export const monthsBack = (n: number, from = darwinToday().slice(0, 7)) => {
  const out: string[] = []; let [y, m] = from.split('-').map(Number);
  for (let i = 0; i < n; i++) { out.push(`${y}-${String(m).padStart(2, '0')}`); m--; if (!m) { m = 12; y--; } }
  return out;
};
