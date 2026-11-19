/**
 * Round 16 — tax, compliance and reporting.
 *
 * GST model (as the GST summary has said since Round 7): each driver is registered for GST and supplies the ride or delivery;
 * DingoGo collects the fare on the driver's behalf and supplies its own services — the service fee and car lease to drivers,
 * and the booking fee, the passenger levy, DingoGo Pass and its share of cancellation fees to riders. Everything here is a
 * worksheet for the driver's or DingoGo's BAS and the ATO's Sharing Economy Reporting Regime; the accountant confirms it.
 */
import { one, q, type Q, pool } from '../db.js';
import { ApiError, bad, conflict, notFound } from '../lib/errors.js';
import { getJurisdiction } from '../lib/jurisdictions.js';
import { levyReport } from './reports.js';
import { Pdf } from '../lib/pdf.js';
import { toCsv, dollars, type CsvCol } from '../lib/csv.js';
import {
  abnFormat, abnValid, cents, checkNdis, checkRetention, darwinNow, gstIn, halfPeriod, longDate, missingSellerDetails, monthPeriod,
  purgeAfter, quarterPeriod, taxPending, taxReady, GST_CODES, LEVY_DEFAULTS, NDIS_DEFAULTS, RETENTION_DEFAULTS,
  type NdisSettings, type Period, type RetentionPolicy,
} from '../lib/tax.js';

const TZ = `'Australia/Darwin'`;
const inPeriod = (col: string, a = '$1', b = '$2') => `(${col} AT TIME ZONE ${TZ})::date BETWEEN ${a}::date AND ${b}::date`;
const opt = <T>(p: Promise<T>, empty: T) => p.catch((e) => { if (e?.code === '42P01' || e?.code === '42703') return empty; throw e; });
export const needTax = async () => { if (!(await taxReady())) throw new ApiError(503, 'migration_pending', `${taxPending()}.`); };

export async function business() {
  const biz = (await one(`SELECT value FROM settings WHERE key = 'business'`))?.value ?? {};
  const support = (await one(`SELECT value FROM settings WHERE key = 'support'`))?.value ?? {};
  return {
    name: String(biz.legal_name || biz.name || 'DingoGo'), trading_name: String(biz.name || 'DingoGo'), abn: biz.abn ?? null,
    abn_ok: abnValid(biz.abn), address: String(biz.address ?? ''), email: String(support.email || biz.email || ''), phone: String(support.phone ?? ''),
  };
}
async function setting<T>(key: string, defaults: T): Promise<T> {
  const v = (await one(`SELECT value FROM settings WHERE key = $1`, [key]))?.value;
  return { ...defaults, ...(v && typeof v === 'object' ? v : {}) };
}

// ───────────── Driver ledger → BAS figures ─────────────
const SALES = ['fare', 'pickup_pay', 'fuel_surcharge', 'cancel_fee'];
const OTHER = ['bonus', 'earnings_floor', 'charging_credit', 'adjustment'];
export interface DriverFigures {
  trips: number; fares_cents: number; pickup_pay_cents: number; fuel_surcharge_cents: number; cancel_fees_cents: number;
  sales_cents: number; gst_on_sales_cents: number; service_fees_cents: number; lease_cents: number; fees_cents: number; gst_credits_cents: number;
  net_gst_cents: number; tips_cents: number; other_payments_cents: number; cash_held_cents: number; paid_out_cents: number;
}
/** Sums by ledger kind → the driver's BAS figures. GST only if the driver is registered (they must be, from the first trip). */
export function driverFigures(by: Record<string, number>, trips: number, gstRegistered = true): DriverFigures {
  const v = (k: string) => Number(by[k] ?? 0);
  const sales = SALES.reduce((s, k) => s + v(k), 0);
  const fees = -v('commission') - v('lease');
  const g1a = gstRegistered ? gstIn(sales) : 0, g1b = gstRegistered ? gstIn(fees) : 0;
  return {
    trips, fares_cents: v('fare'), pickup_pay_cents: v('pickup_pay'), fuel_surcharge_cents: v('fuel_surcharge'), cancel_fees_cents: v('cancel_fee'),
    sales_cents: sales, gst_on_sales_cents: g1a, service_fees_cents: -v('commission'), lease_cents: -v('lease'), fees_cents: fees, gst_credits_cents: g1b,
    net_gst_cents: g1a - g1b, tips_cents: v('tip'), other_payments_cents: OTHER.reduce((s, k) => s + v(k), 0),
    cash_held_cents: -v('cash_collected'), paid_out_cents: -v('payout'),
  };
}

async function driverIdentity(driverId: string, c: Q = pool) {
  const ready = await taxReady();
  const d = await one(
    `SELECT u.id, u.name, u.email, u.phone, u.deleted_at, d.abn, d.gst_registered, d.bank_bsb, d.bank_account, d.status
            ${ready ? ', d.seller_type, d.given_name, d.family_name, d.date_of_birth, d.business_name, d.address_line, d.suburb, d.postcode, d.address_state, d.tax_details_updated_at' : ''}
     FROM users u JOIN drivers d ON d.user_id = u.id WHERE u.id = $1`, [driverId], c);
  if (!d) throw notFound('Driver');
  if (d.deleted_at && ready) {
    const r = await one(`SELECT identity FROM retained_tax_identities WHERE driver_id = $1`, [driverId], c);
    if (r) Object.assign(d, r.identity);
  }
  if (d.date_of_birth instanceof Date) d.date_of_birth = d.date_of_birth.toISOString().slice(0, 10);
  const legal = d.seller_type === 'entity' ? d.business_name : [d.given_name, d.family_name].filter(Boolean).join(' ');
  return { ...d, legal_name: legal || d.name };
}

/** One driver's quarter: BAS figures (G1, 1A, G11, 1B), month by month. */
export async function driverStatement(driverId: string, quarter?: string) {
  const p = quarterPeriod(quarter);
  const who = await driverIdentity(driverId);
  const rows = await q(
    `SELECT to_char(created_at AT TIME ZONE ${TZ}, 'YYYY-MM') AS month, kind, sum(amount_cents)::int cents,
            count(DISTINCT trip_id) FILTER (WHERE kind = 'fare')::int trips
     FROM driver_ledger WHERE driver_id = $3 AND ${inPeriod('created_at')} GROUP BY 1, 2 ORDER BY 1`, [p.from, p.to, driverId]);
  const months: { month: string; by: Record<string, number>; trips: number }[] = [];
  for (const r of rows) {
    let m = months.find((x) => x.month === r.month);
    if (!m) months.push(m = { month: r.month, by: {}, trips: 0 });
    m.by[r.kind] = r.cents; m.trips += r.trips;
  }
  const all: Record<string, number> = {};
  for (const m of months) for (const [k, v] of Object.entries(m.by)) all[k] = (all[k] ?? 0) + v;
  const gst = !!who.gst_registered;
  return {
    period: p, business: await business(),
    driver: { id: who.id, name: who.legal_name, abn: who.abn ?? null, abn_ok: abnValid(who.abn), gst_registered: gst },
    totals: driverFigures(all, months.reduce((s, m) => s + m.trips, 0), gst),
    months: months.map((m) => ({ month: m.month, ...driverFigures(m.by, m.trips, gst) })),
    warnings: [
      ...(!gst ? ['You are not marked as registered for GST. Rideshare drivers must register for GST from the first trip, whatever they earn.'] : []),
      ...(!abnValid(who.abn) ? ['Your ABN is missing or fails the ATO check. Update it in the app (Profile → Tax details).'] : []),
    ],
    notes: [
      'G1 (total sales) is what riders paid for your trips, including GST: fares, pickup pay, fuel surcharge and your share of cancellation fees. DingoGo collects it on your behalf.',
      'G11 and 1B are DingoGo’s service fees and car lease charged to you; the tax invoice for them is in the app.',
      'Tips are not part of the fare and have no GST. Bonuses, earnings-floor top-ups and charging credits are listed separately: ask your tax agent how to report them.',
      'Figures are on Darwin dates. Check them with your tax agent before you lodge.',
    ],
  };
}
type Statement = Awaited<ReturnType<typeof driverStatement>>;

const BAS_ROWS = (t: DriverFigures): [string, string][] => [
  ['G1 Total sales (incl. GST)', cents(t.sales_cents)], ['   Fares', cents(t.fares_cents)], ['   Pickup pay', cents(t.pickup_pay_cents)],
  ['   Fuel surcharge', cents(t.fuel_surcharge_cents)], ['   Cancellation fees (your share)', cents(t.cancel_fees_cents)],
  ['1A GST on sales', cents(t.gst_on_sales_cents)],
  ['G11 Fees charged by DingoGo (incl. GST)', cents(t.fees_cents)], ['   Service fees', cents(t.service_fees_cents)], ['   Car lease', cents(t.lease_cents)],
  ['1B GST credits on DingoGo fees', cents(t.gst_credits_cents)], ['Net GST (1A − 1B)', cents(t.net_gst_cents)],
];

export function statementCsv(s: Statement) {
  const cols: CsvCol<any>[] = [
    ['Driver', () => s.driver.name], ['ABN', () => s.driver.abn], ['Quarter', () => s.period.key], ['Month', (r) => r.month], ['Trips', (r) => r.trips],
    ['G1 Total sales incl GST ($)', (r) => dollars(r.sales_cents)], ['Fares ($)', (r) => dollars(r.fares_cents)], ['Pickup pay ($)', (r) => dollars(r.pickup_pay_cents)],
    ['Fuel surcharge ($)', (r) => dollars(r.fuel_surcharge_cents)], ['Cancellation fees ($)', (r) => dollars(r.cancel_fees_cents)],
    ['1A GST on sales ($)', (r) => dollars(r.gst_on_sales_cents)], ['G11 DingoGo fees incl GST ($)', (r) => dollars(r.fees_cents)],
    ['Service fees ($)', (r) => dollars(r.service_fees_cents)], ['Car lease ($)', (r) => dollars(r.lease_cents)], ['1B GST credits ($)', (r) => dollars(r.gst_credits_cents)],
    ['Net GST ($)', (r) => dollars(r.net_gst_cents)], ['Tips, no GST ($)', (r) => dollars(r.tips_cents)], ['Other payments from DingoGo ($)', (r) => dollars(r.other_payments_cents)],
    ['Cash fares you kept ($)', (r) => dollars(r.cash_held_cents)], ['Paid to your bank ($)', (r) => dollars(r.paid_out_cents)],
  ];
  return toCsv(cols, [...s.months, { month: 'Total', ...s.totals }]);
}

export function statementPdf(s: Statement) {
  const doc = new Pdf(`DingoGo driver statement ${s.period.key}`, `${s.business.trading_name} · driver GST statement · ${s.driver.name}`);
  doc.heading('Driver GST statement (BAS worksheet)');
  doc.para(`${s.period.label}. BAS due ${longDate(s.period.due)} (quarterly lodgers; your due date may differ if a tax agent lodges for you).`);
  doc.rows([['Driver', s.driver.name], ['ABN', abnFormat(s.driver.abn)], ['Registered for GST', s.driver.gst_registered ? 'Yes' : 'No'],
    ['Platform', `${s.business.name} (ABN ${abnFormat(s.business.abn)})`], ['Trips', String(s.totals.trips)]]);
  for (const w of s.warnings) doc.para(`Check: ${w}`, 9.5, true);
  doc.rule();
  doc.heading('Your BAS figures', 12);
  doc.rows(BAS_ROWS(s.totals));
  doc.heading('Not on the BAS (for your records)', 12);
  doc.rows([['Tips (100% yours, no GST)', cents(s.totals.tips_cents)], ['Other payments from DingoGo (bonuses, earnings floor, charging, adjustments)', cents(s.totals.other_payments_cents)],
    ['Cash fares you kept', cents(s.totals.cash_held_cents)], ['Paid to your bank this quarter', cents(s.totals.paid_out_cents)]]);
  if (s.months.length) {
    doc.heading('Month by month', 12);
    doc.table([{ label: 'Month', width: 0.14 }, { label: 'Trips', width: 0.1, align: 'right' }, { label: 'G1 sales', width: 0.16, align: 'right' },
      { label: '1A GST', width: 0.14, align: 'right' }, { label: 'G11 fees', width: 0.16, align: 'right' }, { label: '1B GST', width: 0.14, align: 'right' },
      { label: 'Net GST', width: 0.16, align: 'right' }],
    [...s.months, { month: 'Total', ...s.totals }].map((m: any) => [m.month, String(m.trips), cents(m.sales_cents), cents(m.gst_on_sales_cents), cents(m.fees_cents), cents(m.gst_credits_cents), cents(m.net_gst_cents)]),
    { boldLast: true });
  }
  for (const n of s.notes) doc.para(n, 8.5);
  return doc.toBuffer();
}

/** Tax invoice from DingoGo to the driver for the quarter's service fees and car lease (GST-inclusive). */
export async function feeInvoice(driverId: string, quarter?: string) {
  const s = await driverStatement(driverId, quarter);
  const t = s.totals;
  if (t.fees_cents <= 0) throw conflict('no_fees', 'DingoGo charged you no fees in this quarter, so there is no invoice');
  const lines = [
    ...(t.service_fees_cents ? [{ label: `DingoGo service fees on ${t.trips} trip${t.trips === 1 ? '' : 's'}`, cents: t.service_fees_cents }] : []),
    ...(t.lease_cents ? [{ label: 'Car lease', cents: t.lease_cents }] : []),
  ];
  const [y, qn] = s.period.key.split('-Q');
  return {
    title: 'Tax invoice', number: `DGF-${y}Q${qn}-${driverId.replace(/-/g, '').slice(0, 8).toUpperCase()}`, issued: darwinNow(),
    period: s.period, supplier: s.business, customer: s.driver, lines, total_cents: t.fees_cents, gst_cents: gstIn(t.fees_cents),
    note: 'Fees are charged as they are earned and taken from your pay; nothing more is owed.',
  };
}
export function feeInvoicePdf(inv: Awaited<ReturnType<typeof feeInvoice>>) {
  const doc = new Pdf(`DingoGo tax invoice ${inv.number}`, `${inv.supplier.trading_name} · tax invoice ${inv.number}`);
  doc.heading('Tax invoice');
  doc.rows([['Invoice number', inv.number], ['Date of issue', longDate(inv.issued)], ['Period', inv.period.label]]);
  doc.rule();
  doc.para(`From: ${inv.supplier.name}, ABN ${abnFormat(inv.supplier.abn)}${inv.supplier.address ? `, ${inv.supplier.address}` : ''}`, 10, true);
  doc.para(`To: ${inv.customer.name}, ABN ${abnFormat(inv.customer.abn)}`, 10, true);
  doc.gap();
  doc.table([{ label: 'Description', width: 0.7 }, { label: 'Amount (incl. GST)', width: 0.3, align: 'right' }],
    [...inv.lines.map((l) => [l.label, cents(l.cents)]), ['Total (including GST)', cents(inv.total_cents)]], { size: 10, boldLast: true });
  doc.rows([['GST included in the total', cents(inv.gst_cents)]], { boldLast: true });
  doc.para(inv.note, 9);
  if (!abnValid(inv.supplier.abn)) doc.para('DingoGo’s ABN has not been entered yet: this invoice is a draft until it is.', 9, true);
  return doc.toBuffer();
}

// ───────────── DingoGo's own BAS worksheet ─────────────
export async function dingogoBas(quarter?: string) {
  const p = quarterPeriod(quarter);
  const args = [p.from, p.to];
  const led = Object.fromEntries((await q(
    `SELECT kind, sum(amount_cents)::int cents FROM driver_ledger WHERE ${inPeriod('created_at')} GROUP BY kind`, args)).map((r) => [r.kind, r.cents]));
  const v = (k: string) => Number(led[k] ?? 0);
  const trips = await one(
    `SELECT count(*)::int n, coalesce(sum((fare_breakdown->>'booking_fee_cents')::int),0)::int booking, coalesce(sum((fare_breakdown->>'levy_cents')::int),0)::int levy,
            coalesce(sum((fare_breakdown->>'discount_cents')::int),0)::int discounts, coalesce(sum(final_cents),0)::int paid
     FROM trips WHERE status = 'completed' AND ${inPeriod('completed_at')}`, args);
  const cancels = await one(`SELECT coalesce(sum(cancel_fee_cents),0)::int fees FROM trips WHERE status::text LIKE 'cancelled%' AND cancel_fee_cents > 0 AND ${inPeriod('cancelled_at')}`, args);
  const pay = Object.fromEntries((await q(
    `SELECT kind, sum(amount_cents)::int cents, sum(gst_cents)::int gst FROM payments WHERE status IN ('succeeded','pending') AND kind IN ('subscription','refund','tip')
       AND ${inPeriod('created_at')} GROUP BY kind`, args)).map((r) => [r.kind, r]));
  const lines = [
    { key: 'service_fees', label: 'Service fees charged to drivers', cents: -v('commission') },
    { key: 'lease', label: 'Car lease charged to drivers', cents: -v('lease') },
    { key: 'booking_fees', label: 'Booking fees paid by riders', cents: trips!.booking },
    { key: 'levy', label: 'Passenger levy collected from riders (part of the price)', cents: trips!.levy },
    { key: 'pass', label: 'DingoGo Pass subscriptions', cents: Number(pay.subscription?.cents ?? 0) },
    { key: 'cancel_share', label: 'DingoGo’s share of cancellation fees', cents: Math.max(0, cancels!.fees - v('cancel_fee')) },
  ].map((l) => ({ ...l, gst_cents: gstIn(l.cents) }));
  const g1 = lines.reduce((s, l) => s + l.cents, 0);
  const a1 = lines.reduce((s, l) => s + l.gst_cents, 0);
  const refunds = -Number(pay.refund?.cents ?? 0), refundsGst = -Number(pay.refund?.gst ?? 0);
  const driverSales = SALES.reduce((s, k) => s + v(k), 0);
  const unregistered = await q(
    `SELECT u.name, d.user_id AS driver_id, sum(l.amount_cents)::int sales_cents FROM driver_ledger l JOIN drivers d ON d.user_id = l.driver_id JOIN users u ON u.id = d.user_id
     WHERE l.kind = ANY($3) AND NOT d.gst_registered AND ${inPeriod('l.created_at')} GROUP BY u.name, d.user_id ORDER BY u.name`, [...args, SALES]);
  const biz = await business();
  return {
    period: p, business: biz, lines, g1_cents: g1, gst_on_sales_cents: a1,
    refunds_cents: refunds, gst_on_refunds_cents: refundsGst, gst_after_refunds_cents: a1 - refundsGst,
    on_behalf: { trips: trips!.n, driver_sales_cents: driverSales, driver_gst_cents: gstIn(driverSales), tips_cents: v('tip'),
      discounts_funded_cents: trips!.discounts, other_driver_payments_cents: OTHER.reduce((s, k) => s + v(k), 0) },
    warnings: [
      ...(!biz.abn_ok ? ['DingoGo’s ABN is not set (admin → Settings → business): tax invoices and the SERR report need it.'] : []),
      ...(unregistered.length ? [`${unregistered.length} driver${unregistered.length === 1 ? ' is' : 's are'} not marked as GST-registered but had trips this quarter.`] : []),
    ],
    unregistered_drivers: unregistered,
    notes: [
      'G1/1A: DingoGo’s own taxable sales. Fares are the drivers’ sales, collected on their behalf, and are not in G1.',
      'Refunds: DingoGo funds refunds to riders (drivers keep their pay), shown as a decreasing adjustment. Rider discounts (promos, points, concessions, account discounts) are funded by DingoGo and paid to drivers; their GST treatment is for the accountant.',
      'Purchases (G10/G11, 1B) and PAYG come from the accounts system, not from DingoGo’s app.',
    ],
  };
}
type Bas = Awaited<ReturnType<typeof dingogoBas>>;
export function basCsv(b: Bas) {
  const rows: any[] = [
    ...b.lines.map((l) => ({ section: 'G1 DingoGo sales', label: l.label, cents: l.cents, gst: l.gst_cents })),
    { section: 'G1 DingoGo sales', label: 'G1 total / 1A GST on sales', cents: b.g1_cents, gst: b.gst_on_sales_cents },
    { section: 'Adjustments', label: 'Refunds to riders', cents: -b.refunds_cents, gst: -b.gst_on_refunds_cents },
    { section: 'Adjustments', label: '1A after refunds', cents: null, gst: b.gst_after_refunds_cents },
    { section: 'On behalf of drivers (not DingoGo sales)', label: 'Driver fares and fees collected', cents: b.on_behalf.driver_sales_cents, gst: b.on_behalf.driver_gst_cents },
    { section: 'On behalf of drivers (not DingoGo sales)', label: 'Tips passed to drivers (no GST)', cents: b.on_behalf.tips_cents, gst: 0 },
    { section: 'For the accountant', label: 'Rider discounts funded by DingoGo', cents: b.on_behalf.discounts_funded_cents, gst: null },
    { section: 'For the accountant', label: 'Other payments to drivers (bonuses, earnings floor, charging, adjustments)', cents: b.on_behalf.other_driver_payments_cents, gst: null },
  ];
  return toCsv<any>([['Quarter', () => b.period.key], ['Section', (r) => r.section], ['Item', (r) => r.label],
    ['Amount incl GST ($)', (r) => dollars(r.cents)], ['GST ($)', (r) => dollars(r.gst)]], rows);
}
export function basPdf(b: Bas) {
  const doc = new Pdf(`DingoGo BAS worksheet ${b.period.key}`, `${b.business.trading_name} · BAS worksheet · ${b.period.key}`);
  doc.heading('DingoGo BAS worksheet');
  doc.para(`${b.period.label}. Due ${longDate(b.period.due)}. ${b.business.name}, ABN ${abnFormat(b.business.abn)}.`);
  for (const w of b.warnings) doc.para(`Check: ${w}`, 9.5, true);
  doc.rule();
  doc.table([{ label: 'DingoGo sales (G1)', width: 0.6 }, { label: 'Incl. GST', width: 0.2, align: 'right' }, { label: 'GST (1A)', width: 0.2, align: 'right' }],
    [...b.lines.map((l) => [l.label, cents(l.cents), cents(l.gst_cents)]), ['Total', cents(b.g1_cents), cents(b.gst_on_sales_cents)]], { size: 9.5, boldLast: true });
  doc.rows([['Refunds to riders (decreasing adjustment)', `-${cents(b.refunds_cents)}`], ['GST on refunds', `-${cents(b.gst_on_refunds_cents)}`],
    ['1A after refunds', cents(b.gst_after_refunds_cents)]], { boldLast: true });
  doc.heading('Collected on behalf of drivers (their sales, not DingoGo’s)', 12);
  doc.rows([['Completed trips', String(b.on_behalf.trips)], ['Driver fares and fees (incl. GST)', cents(b.on_behalf.driver_sales_cents)],
    ['GST the drivers report', cents(b.on_behalf.driver_gst_cents)], ['Tips passed to drivers (no GST)', cents(b.on_behalf.tips_cents)],
    ['Rider discounts DingoGo funded', cents(b.on_behalf.discounts_funded_cents)], ['Other payments to drivers', cents(b.on_behalf.other_driver_payments_cents)]]);
  for (const n of b.notes) doc.para(n, 8.5);
  return doc.toBuffer();
}

// ───────────── SERR (Sharing Economy Reporting Regime) ─────────────
export const SERR_ACTIVITY: Record<string, string> = { ride: 'Ride-sourcing', courier: 'Delivery services' };
const mask = (s: string | null | undefined) => (s ? `•••${String(s).slice(-3)}` : null);
export async function serrReport(periodKey?: string) {
  const p = halfPeriod(periodKey);
  const ready = await taxReady();
  const rows = await q(
    `SELECT l.driver_id, coalesce(t.kind::text, 'ride') AS activity, count(DISTINCT l.trip_id) FILTER (WHERE l.kind IN ('fare','cancel_fee'))::int transactions,
            coalesce(sum(l.amount_cents) FILTER (WHERE l.kind = ANY($3)), 0)::int gross_cents,
            coalesce(-sum(l.amount_cents) FILTER (WHERE l.kind = 'commission'), 0)::int commission_cents,
            min(l.created_at) AS first_at, max(l.created_at) AS last_at
     FROM driver_ledger l LEFT JOIN trips t ON t.id = l.trip_id
     WHERE l.kind IN ('fare','pickup_pay','fuel_surcharge','cancel_fee','commission') AND ${inPeriod('l.created_at')}
     GROUP BY l.driver_id, 2 ORDER BY l.driver_id, 2`, [p.from, p.to, SALES]);
  const sellers: any[] = [];
  const ids = [...new Set(rows.map((r) => r.driver_id))];
  const who = new Map<string, any>();
  for (const id of ids) who.set(id, await driverIdentity(id));
  for (const r of rows) {
    if (r.gross_cents <= 0 && r.commission_cents <= 0) continue;
    const d = who.get(r.driver_id);
    const missing = ready ? missingSellerDetails(d) : ['Tax details (database migration 020 pending)'];
    sellers.push({
      driver_id: r.driver_id, seller_type: d.seller_type ?? 'individual', name: d.legal_name, given_name: d.given_name ?? null, family_name: d.family_name ?? null,
      date_of_birth: d.date_of_birth ?? null, business_name: d.business_name ?? null, abn: d.abn ?? null,
      address: { line: d.address_line ?? null, suburb: d.suburb ?? null, state: d.address_state ?? null, postcode: d.postcode ?? null, country: 'AU' },
      email: d.email ?? null, phone: String(d.phone ?? '').startsWith('deleted:') ? null : d.phone ?? null, bank_bsb: d.bank_bsb ?? null, bank_account: d.bank_account ?? null,
      deleted: !!d.deleted_at, activity: SERR_ACTIVITY[r.activity] ?? r.activity, transactions: r.transactions,
      gross_cents: r.gross_cents, gst_cents: d.gst_registered ? gstIn(r.gross_cents) : 0, commission_cents: r.commission_cents,
      start: longDateIso(r.first_at), end: longDateIso(r.last_at), missing,
    });
  }
  const biz = await business();
  const today = darwinNow();
  return {
    period: p, operator: { name: biz.name, abn: biz.abn, abn_ok: biz.abn_ok, email: biz.email, phone: biz.phone },
    overdue: today > p.due, sellers,
    totals: {
      sellers: new Set(sellers.map((s) => s.driver_id)).size, transactions: sellers.reduce((n, s) => n + s.transactions, 0),
      gross_cents: sellers.reduce((n, s) => n + s.gross_cents, 0), gst_cents: sellers.reduce((n, s) => n + s.gst_cents, 0),
      commission_cents: sellers.reduce((n, s) => n + s.commission_cents, 0),
      incomplete: new Set(sellers.filter((s) => s.missing.length).map((s) => s.driver_id)).size,
    },
    notes: [
      'One line per driver per activity. Gross payments are what riders paid for the driver’s supply (incl. GST); commission is DingoGo’s service fee.',
      'Lodge through the ATO’s SERR channel in the approved XML format (SBR / business software or the ATO’s portal). This file holds the data for it; activity codes are mapped at lodgement.',
      'Drivers with missing details: remind them from Tax → Missing details. Report what you have by the due date; the ATO accepts reasonable efforts to get the rest.',
    ],
  };
}
const longDateIso = (d: Date | string) => new Date(new Date(d).getTime() + 9.5 * 3600e3).toISOString().slice(0, 10);
export const serrView = (r: Awaited<ReturnType<typeof serrReport>>) => ({ ...r, sellers: r.sellers.map((s) => ({ ...s, bank_bsb: mask(s.bank_bsb), bank_account: mask(s.bank_account) })) });
export function serrCsv(r: Awaited<ReturnType<typeof serrReport>>) {
  return toCsv<any>([
    ['Reporting period start', () => r.period.from], ['Reporting period end', () => r.period.to], ['Platform operator', () => r.operator.name], ['Operator ABN', () => r.operator.abn],
    ['Seller type', (s) => (s.seller_type === 'entity' ? 'Entity' : 'Individual')], ['Given name', (s) => s.given_name], ['Family name', (s) => s.family_name],
    ['Date of birth', (s) => s.date_of_birth], ['Business or trading name', (s) => s.business_name], ['ABN', (s) => s.abn],
    ['Address', (s) => s.address.line], ['Suburb', (s) => s.address.suburb], ['State', (s) => s.address.state], ['Postcode', (s) => s.address.postcode], ['Country', (s) => s.address.country],
    ['Email', (s) => s.email], ['Phone', (s) => s.phone], ['BSB', (s) => s.bank_bsb], ['Account number', (s) => s.bank_account],
    ['Activity', (s) => s.activity], ['Activity start', (s) => s.start], ['Activity end', (s) => s.end], ['Transactions', (s) => s.transactions],
    ['Gross payments incl GST ($)', (s) => dollars(s.gross_cents)], ['GST ($)', (s) => dollars(s.gst_cents)], ['Commission ($)', (s) => dollars(s.commission_cents)],
    ['Missing details', (s) => s.missing.join('; ')], ['Account deleted', (s) => (s.deleted ? 'Yes' : '')],
  ], r.sellers);
}

/** Drivers whose SERR details are incomplete: approved drivers and anyone paid in the last 18 months. */
export async function missingDetails() {
  const ready = await taxReady();
  const ids = await q(
    `SELECT d.user_id FROM drivers d JOIN users u ON u.id = d.user_id
     WHERE (d.status = 'approved' AND u.deleted_at IS NULL)
        OR EXISTS (SELECT 1 FROM driver_ledger l WHERE l.driver_id = d.user_id AND l.kind = 'fare' AND l.created_at > now() - interval '18 months')`);
  const out: any[] = [];
  for (const { user_id } of ids) {
    const d = await driverIdentity(user_id);
    const missing = ready ? missingSellerDetails(d) : ['Tax details (database migration 020 pending)'];
    if (missing.length) out.push({ driver_id: user_id, name: d.name, status: d.status, deleted: !!d.deleted_at, missing, updated_at: d.tax_details_updated_at ?? null });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ───────────── Passenger levy returns ─────────────
export async function levyReturn(month?: string, state = 'NT') {
  const st = String(state).toUpperCase();
  const j = await getJurisdiction(st);
  if (!j) throw bad('unknown_state', 'No such state');
  const lv = await setting('levy_returns', LEVY_DEFAULTS);
  const p = monthPeriod(month, Number(lv.due_day) || 21);
  const l = await levyReport(p.key, st);
  const days = await q(
    `SELECT to_char(completed_at AT TIME ZONE ${TZ}, 'YYYY-MM-DD') AS day, count(*)::int trips FROM trips t
     WHERE status = 'completed' AND kind = 'ride' AND to_char(completed_at AT TIME ZONE ${TZ}, 'YYYY-MM') = $1
       AND coalesce((SELECT z.state FROM zones z WHERE z.id = t.zone_id), 'NT') = $2 GROUP BY 1 ORDER BY 1`, [p.key, st]);
  const lodged = (await taxReady()) ? await one(
    `SELECT l.*, u.name AS lodged_by_name FROM levy_lodgements l LEFT JOIN users u ON u.id = l.lodged_by WHERE state = $1 AND month = $2`, [st, p.key]) : null;
  return {
    period: p, state: st, jurisdiction: { name: j.name, regulator: j.regulator ?? null, active: !!(j as any).active, levy_label: l.levy_label },
    operator: await business(), passenger_trips: l.passenger_trips, levy_rate_cents: l.levy_rate_cents, levy_payable_cents: l.levy_payable_cents,
    levy_collected_cents: l.levy_collected_cents, days, per_driver: l.per_driver, lodged,
    overdue: !lodged && darwinNow() > p.due && l.passenger_trips > 0,
    note: `Completed passenger trips (rides, not courier jobs) starting in ${st}, on Darwin dates. The due date (day ${lv.due_day} of the next month) is a setting: confirm it with the ${j.regulator ?? 'regulator'}.`,
  };
}
type LevyReturn = Awaited<ReturnType<typeof levyReturn>>;
export function levyReturnCsv(r: LevyReturn) {
  return toCsv<any>([['State', () => r.state], ['Month', () => r.period.key], ['Day', (x) => x.day], ['Passenger trips', (x) => x.trips],
    ['Levy per trip ($)', () => dollars(r.levy_rate_cents)], ['Levy payable ($)', (x) => dollars(x.trips * r.levy_rate_cents)]],
  [...r.days, { day: 'Total', trips: r.passenger_trips }]);
}
export function levyReturnPdf(r: LevyReturn) {
  const doc = new Pdf(`Levy return ${r.state} ${r.period.key}`, `${r.operator.trading_name} · ${r.jurisdiction.levy_label} return · ${r.state} ${r.period.key}`);
  doc.heading(`${r.jurisdiction.levy_label}: monthly return`);
  doc.rows([['Booking service', `${r.operator.name} (ABN ${abnFormat(r.operator.abn)})`], ['State', `${r.jurisdiction.name}${r.jurisdiction.active ? '' : ' (not yet operating)'}`],
    ['Regulator', r.jurisdiction.regulator ?? ''], ['Month', r.period.label], ['Due', longDate(r.period.due)],
    ['Lodged', r.lodged ? `${longDate(r.lodged.lodged_at)}${r.lodged.reference ? `, reference ${r.lodged.reference}` : ''}` : 'Not yet']]);
  doc.rule();
  doc.rows([['Completed passenger trips', String(r.passenger_trips)], ['Levy per trip', cents(r.levy_rate_cents)], ['Levy payable', cents(r.levy_payable_cents)],
    ['Collected from riders', cents(r.levy_collected_cents)]], { boldLast: false });
  if (r.days.length) {
    doc.heading('Trips by day', 12);
    doc.table([{ label: 'Day', width: 0.4 }, { label: 'Passenger trips', width: 0.3, align: 'right' }, { label: 'Levy', width: 0.3, align: 'right' }],
      [...r.days.map((d) => [longDate(d.day), String(d.trips), cents(d.trips * r.levy_rate_cents)]), ['Total', String(r.passenger_trips), cents(r.levy_payable_cents)]], { boldLast: true });
  }
  doc.para(r.note, 8.5);
  return doc.toBuffer();
}
/** The last 12 months of returns for a state: trips, payable, lodged or not, overdue. */
export async function levyReturns(state = 'NT') {
  const st = String(state).toUpperCase();
  const lv = await setting('levy_returns', LEVY_DEFAULTS);
  const months: string[] = [];
  const now = darwinNow();
  let y = Number(now.slice(0, 4)), m = Number(now.slice(5, 7));
  for (let i = 0; i < 12; i++) { months.push(`${y}-${String(m).padStart(2, '0')}`); m--; if (!m) { m = 12; y--; } }
  const counts = Object.fromEntries((await q(
    `SELECT to_char(completed_at AT TIME ZONE ${TZ}, 'YYYY-MM') AS month, count(*)::int trips FROM trips t
     WHERE status = 'completed' AND kind = 'ride' AND completed_at > now() - interval '13 months'
       AND coalesce((SELECT z.state FROM zones z WHERE z.id = t.zone_id), 'NT') = $1 GROUP BY 1`, [st])).map((r) => [r.month, r.trips]));
  const lodged = (await taxReady()) ? Object.fromEntries((await q(`SELECT * FROM levy_lodgements WHERE state = $1`, [st])).map((r) => [r.month, r])) : {};
  const rate = (await levyReport(months[0], st)).levy_rate_cents;
  return {
    state: st, due_day: lv.due_day, months: months.map((k) => {
      const p = monthPeriod(k, lv.due_day); const trips = Number(counts[k] ?? 0); const l = lodged[k];
      return { month: k, label: p.label, due: p.due, trips, payable_cents: trips * rate, lodged_at: l?.lodged_at ?? null, reference: l?.reference ?? null,
        lodged_amount_cents: l?.amount_cents ?? null, overdue: !l && trips > 0 && now > p.due, current: k === now.slice(0, 7) };
    }),
  };
}
export async function recordLodgement(by: string, state: string, month: string, reference?: string) {
  await needTax();
  const r = await levyReturn(month, state);
  if (r.period.key >= darwinNow().slice(0, 7)) throw bad('month_not_over', 'Lodge a month once it has ended');
  return one(`INSERT INTO levy_lodgements (state, month, trips, amount_cents, reference, lodged_by) VALUES ($1,$2,$3,$4,$5,$6)
              ON CONFLICT (state, month) DO UPDATE SET trips = $3, amount_cents = $4, reference = $5, lodged_by = $6, lodged_at = now() RETURNING *`,
  [r.state, r.period.key, r.passenger_trips, r.levy_payable_cents, reference ?? null, by]);
}

// ───────────── Record retention ─────────────
export async function retentionPolicy(): Promise<RetentionPolicy> {
  return checkRetention((await one(`SELECT value FROM settings WHERE key = 'record_retention'`))?.value ?? RETENTION_DEFAULTS);
}
/** What the policy removes: [category, label, SQL condition table]. Tax records (trips, payments, driver pay, invoices, audit log)
 *  are never removed by this job; deleted drivers' tax identities go once their 5 years are up. */
const PURGES = (p: RetentionPolicy) => [
  { key: 'gps', label: 'Trip GPS tracks', table: 'trip_track', where: `at < now() - make_interval(months => ${p.gps_track_months})` },
  { key: 'chat', label: 'Trip chat messages', table: 'trip_messages', where: `created_at < now() - make_interval(months => ${p.chat_months})` },
  { key: 'comms', label: 'Text and push delivery log', table: 'comms_log', where: `at < now() - make_interval(months => ${p.comms_log_months})` },
  { key: 'notifications', label: 'In-app notifications', table: 'notifications', where: `created_at < now() - make_interval(months => ${p.notifications_months})` },
  { key: 'otp', label: 'Sign-in code requests', table: 'otp_requests', where: `at < now() - make_interval(days => ${p.security_log_days})` },
  { key: 'rate', label: 'Rate-limit counters', table: 'rate_events', where: `at < now() - make_interval(days => ${Math.min(p.security_log_days, 30)})` },
  { key: 'tax_identities', label: 'Deleted drivers’ tax details past 5 years', table: 'retained_tax_identities', where: `purge_after < (now() AT TIME ZONE ${TZ})::date` },
];
export async function runRetention(opts: { dryRun: boolean; actor?: string | null }) {
  const policy = await retentionPolicy();
  const out: { key: string; label: string; rows: number }[] = [];
  for (const x of PURGES(policy)) {
    const sql = opts.dryRun ? `SELECT count(*)::int n FROM ${x.table} WHERE ${x.where}` : `WITH d AS (DELETE FROM ${x.table} WHERE ${x.where} RETURNING 1) SELECT count(*)::int n FROM d`;
    const r = await opt(one(sql), null);
    out.push({ key: x.key, label: x.label, rows: r ? Number(r.n) : 0 });
  }
  if (!opts.dryRun) {
    await pool.query(`INSERT INTO settings (key, value) VALUES ('record_retention_last_run', $1) ON CONFLICT (key) DO UPDATE SET value = $1`,
      [JSON.stringify({ at: new Date().toISOString(), by: opts.actor ?? 'auto', removed: out })]);
    await pool.query('INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES ($1,$2,$3,$4,$5)',
      [opts.actor ?? null, 'retention_run', 'settings', 'record_retention', JSON.stringify({ removed: out })]);
  }
  return { policy, dry_run: opts.dryRun, removed: out, kept: [
    `Trips, payments, driver pay, invoices and the audit log: at least ${policy.tax_years} years (ATO record keeping).`,
    'Driver documents: while the driver is with DingoGo and for the claims period after.',
  ] };
}
let lastAuto = 0;
/** Daily, when the policy says `auto`: called from the dispatcher tick. */
export async function runRetentionIfDue() {
  if (Date.now() - lastAuto < 6 * 3600e3) return;
  lastAuto = Date.now();
  const p = await retentionPolicy().catch(() => null);
  if (!p?.auto) return;
  const last = (await one(`SELECT value FROM settings WHERE key = 'record_retention_last_run'`))?.value;
  if (last?.at && Date.now() - Date.parse(last.at) < 20 * 3600e3) return;
  await runRetention({ dryRun: false, actor: null });
}

// ───────────── Privacy (APP) requests ─────────────
export const PRIVACY_KINDS = ['access', 'correction', 'deletion', 'complaint'] as const;
export const PRIVACY_CHANNELS = ['app', 'email', 'phone', 'letter', 'in_person'] as const;
/** Record a request; self-service ones (export, delete) are recorded as completed straight away. Never fails the caller. */
export async function recordPrivacyRequest(r: { user_id?: string | null; kind: string; channel?: string; status?: string; requester?: string; details?: string; handled_by?: string | null }, c: Q = pool) {
  if (!(await taxReady())) return null;
  const { incidentRef } = await import('../lib/ids.js');
  const done = r.status === 'completed';
  return one(`INSERT INTO privacy_requests (ref, user_id, kind, channel, status, requester, details, completed_at, handled_by, outcome)
              VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
  [incidentRef().replace('IR-', 'PR-'), r.user_id ?? null, r.kind, r.channel ?? 'app', r.status ?? 'open', r.requester ?? null, r.details ?? null,
    done ? new Date() : null, r.handled_by ?? null, done && r.channel === 'app' ? 'Self-service in the app' : null], c);
}

/** Before a driver's account is anonymised: keep what the ATO needs (SERR, tax records) for 5 years, then clear it from the driver row. */
export async function retainDriverTaxIdentity(driverId: string, c: Q = pool) {
  if (!(await taxReady())) {
    await c.query(`UPDATE drivers SET bank_bsb = NULL, bank_account = NULL WHERE user_id = $1 AND NOT EXISTS (SELECT 1 FROM driver_ledger WHERE driver_id = $1)`, [driverId]);
    return false;
  }
  const last = await one(`SELECT max(created_at) AS at FROM driver_ledger WHERE driver_id = $1`, [driverId], c);
  if (last?.at) {
    const d = await driverIdentity(driverId, c);
    const policy = await retentionPolicy();
    const identity = { name: d.name, email: d.email, phone: d.phone, abn: d.abn, gst_registered: d.gst_registered, bank_bsb: d.bank_bsb, bank_account: d.bank_account,
      seller_type: d.seller_type, given_name: d.given_name, family_name: d.family_name, date_of_birth: d.date_of_birth, business_name: d.business_name,
      address_line: d.address_line, suburb: d.suburb, postcode: d.postcode, address_state: d.address_state };
    await c.query(`INSERT INTO retained_tax_identities (driver_id, identity, purge_after) VALUES ($1,$2,$3)
                   ON CONFLICT (driver_id) DO UPDATE SET identity = $2, purge_after = $3, deleted_at = now()`,
    [driverId, JSON.stringify(identity), purgeAfter(last.at, policy.tax_years)]);
  }
  await c.query(`UPDATE drivers SET bank_bsb = NULL, bank_account = NULL, given_name = NULL, family_name = NULL, date_of_birth = NULL, business_name = NULL,
                   address_line = NULL, suburb = NULL, postcode = NULL, address_state = NULL, licence_no = NULL, cpv_authority_no = NULL, bio = NULL WHERE user_id = $1`, [driverId]);
  return !!last?.at;
}

// ───────────── NDIS invoices ─────────────
export async function ndisSettings(): Promise<NdisSettings> {
  return checkNdis((await one(`SELECT value FROM settings WHERE key = 'ndis'`))?.value ?? NDIS_DEFAULTS);
}
/** NDIS-funded trips in a month (trips booked with a participant's NDIS number), grouped into one invoice per participant. */
export async function ndisInvoices(month?: string, filter: { ndis?: string; riderId?: string } = {}) {
  const p = monthPeriod(month);
  const vals: unknown[] = [p.from, p.to]; const extra: string[] = [];
  if (filter.ndis) { vals.push(filter.ndis); extra.push(`t.ndis_number = $${vals.length}`); }
  if (filter.riderId) { vals.push(filter.riderId); extra.push(`t.rider_id = $${vals.length}`); }
  const trips = await q(
    `SELECT t.id, t.ref, t.ndis_number, t.rider_id, u.name AS participant, t.pickup_address, t.dropoff_address, t.status, t.kind, t.service,
            coalesce(t.completed_at, t.cancelled_at) AS at, coalesce(t.final_cents, t.cancel_fee_cents)::int AS cents, (t.status <> 'completed') AS cancellation,
            coalesce(t.actual_distance_m, t.est_distance_m) AS distance_m, a.name AS account_name, a.kind AS account_kind,
            coalesce((SELECT -sum(amount_cents) FROM payments WHERE trip_id = t.id AND kind = 'refund' AND status = 'succeeded'), 0)::int AS refunded_cents
     FROM trips t JOIN users u ON u.id = t.rider_id LEFT JOIN corporate_accounts a ON a.id = t.corporate_account_id
     WHERE t.ndis_number IS NOT NULL AND (t.status = 'completed' OR (t.status::text LIKE 'cancelled%' AND t.cancel_fee_cents > 0))
       AND ${inPeriod('coalesce(t.completed_at, t.cancelled_at)')} ${extra.map((x) => `AND ${x}`).join(' ')}
     ORDER BY t.ndis_number, at`, vals);
  const s = await ndisSettings();
  const biz = await business();
  const by = new Map<string, any>();
  for (const t of trips) {
    let inv = by.get(t.ndis_number);
    if (!inv) {
      by.set(t.ndis_number, inv = {
        number: `NDIS-${p.key.replace('-', '')}-${t.ndis_number}`, participant: t.participant, ndis_number: t.ndis_number, rider_id: t.rider_id,
        bill_to: t.account_name ? `${t.account_name}${t.account_kind === 'ndis_plan_manager' ? ' (plan manager)' : ''}` : `${t.participant} (self-managed)`,
        lines: [] as any[], total_cents: 0, gst_cents: 0,
      });
    }
    const amount = Math.max(0, t.cents - t.refunded_cents);
    const gst = s.gst_code === 'P1' ? gstIn(amount) : 0;
    inv.lines.push({ date: longDateIso(t.at), trip_ref: t.ref, description: `${t.cancellation ? 'Late cancellation' : s.support_name}: ${t.pickup_address} to ${t.dropoff_address}`,
      support_item: s.support_item || null, quantity: 1, unit_cents: amount, gst_code: s.gst_code, gst_cents: gst, km: t.distance_m ? Math.round(t.distance_m / 100) / 10 : null,
      cancellation: t.cancellation, refunded_cents: t.refunded_cents });
    inv.total_cents += amount; inv.gst_cents += gst;
  }
  const issued = darwinNow();
  const due = new Date(Date.parse(issued) + s.payment_terms_days * 864e5).toISOString().slice(0, 10);
  return { period: p, provider: { ...biz, registration_number: s.registration_number || null }, settings: s, issued, due, invoices: [...by.values()] };
}
type NdisSet = Awaited<ReturnType<typeof ndisInvoices>>;
export function ndisInvoicePdf(set: NdisSet, inv: NdisSet['invoices'][number]) {
  const doc = new Pdf(`NDIS invoice ${inv.number}`, `${set.provider.trading_name} · NDIS invoice ${inv.number}`);
  doc.heading(set.settings.gst_code === 'P1' ? 'Tax invoice (NDIS)' : 'Invoice (NDIS)');
  doc.rows([['Invoice number', inv.number], ['Date of issue', longDate(set.issued)], ['Payment due', longDate(set.due)], ['Supports delivered', `${longDate(set.period.from)} to ${longDate(set.period.to)}`]]);
  doc.rule();
  doc.para(`Provider: ${set.provider.name}, ABN ${abnFormat(set.provider.abn)}${set.provider.registration_number ? `, NDIS provider ${set.provider.registration_number}` : ' (not an NDIS-registered provider)'}`, 10, true);
  doc.para(`Participant: ${inv.participant}, NDIS number ${inv.ndis_number}`, 10, true);
  doc.para(`Bill to: ${inv.bill_to}`, 10);
  doc.gap();
  doc.table([{ label: 'Date', width: 0.13 }, { label: 'Support', width: 0.43 }, { label: 'Item number', width: 0.18 }, { label: 'Qty', width: 0.06, align: 'right' },
    { label: 'GST', width: 0.06 }, { label: 'Amount', width: 0.14, align: 'right' }],
  [...inv.lines.map((l: any) => [longDate(l.date), `${l.description} (${l.trip_ref}${l.km ? `, ${l.km} km` : ''})`, l.support_item ?? 'to be set', String(l.quantity), l.gst_code, cents(l.unit_cents)]),
    ['', 'Total', '', '', '', cents(inv.total_cents)]], { size: 8.5, boldLast: true });
  doc.rows([[`GST (${GST_CODES[set.settings.gst_code as keyof typeof GST_CODES]})`, cents(inv.gst_cents)]]);
  if (!set.settings.support_item) doc.para('The NDIS support item number has not been set (admin → Tax → NDIS): plan managers need it before they can pay.', 9, true);
  doc.para('Prices are what DingoGo charged for each trip, after any refund. Questions: ' + [set.provider.email, set.provider.phone].filter(Boolean).join(', '), 8.5);
  return doc.toBuffer();
}
export function ndisInvoiceCsv(set: NdisSet) {
  const rows = set.invoices.flatMap((inv) => inv.lines.map((l: any) => ({ ...l, inv })));
  return toCsv<any>([['Invoice number', (r) => r.inv.number], ['Participant', (r) => r.inv.participant], ['NDIS number', (r) => r.inv.ndis_number], ['Bill to', (r) => r.inv.bill_to],
    ['Date', (r) => r.date], ['Trip', (r) => r.trip_ref], ['Description', (r) => r.description], ['Support item', (r) => r.support_item], ['Quantity', (r) => r.quantity],
    ['Amount ($)', (r) => dollars(r.unit_cents)], ['GST code', (r) => r.gst_code], ['GST ($)', (r) => dollars(r.gst_cents)]], rows);
}
/** NDIA bulk payment request file (registered providers claiming through the myplace provider portal): one row per trip. */
export function ndisBulkClaimCsv(set: NdisSet) {
  if (!set.settings.registration_number || !set.settings.support_item) throw conflict('ndis_not_set_up', 'Set the NDIS provider registration number and support item first (Tax → NDIS)');
  const rows = set.invoices.flatMap((inv) => inv.lines.map((l: any) => ({ ...l, ndis: inv.ndis_number })));
  return toCsv<any>([
    ['RegistrationNumber', () => set.settings.registration_number], ['NDISNumber', (r) => r.ndis], ['SupportsDeliveredFrom', (r) => r.date.replace(/-/g, '/')],
    ['SupportsDeliveredTo', (r) => r.date.replace(/-/g, '/')], ['SupportNumber', (r) => r.support_item], ['ClaimReference', (r) => r.trip_ref], ['Quantity', (r) => r.quantity],
    ['Hours', () => ''], ['UnitPrice', (r) => dollars(r.unit_cents)], ['GSTCode', (r) => r.gst_code], ['AuthorisedBy', () => ''], ['ParticipantApproved', () => ''],
    ['InKindFundingProgram', () => ''], ['ClaimType', (r) => (r.cancellation ? 'CANC' : '')], ['CancellationReason', (r) => (r.cancellation ? 'NSDO' : '')],
    ['ABN of Support Provider', () => String(set.provider.abn ?? '').replace(/\s/g, '')],
  ], rows);
}

export { quarterPeriod, halfPeriod, monthPeriod, type Period };
