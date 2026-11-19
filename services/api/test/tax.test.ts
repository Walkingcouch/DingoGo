/** Round 16: pure tax and compliance rules — ABN check, BAS/SERR/levy periods, SERR missing details, retention, NDIS settings,
 *  driver BAS figures and the PDF writer. No database. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  abnFormat, abnValid, cents, checkNdis, checkRetention, halfPeriod, longDate, missingSellerDetails, monthPeriod, purgeAfter, quarterPeriod,
} from '../src/lib/tax.js';
import { driverFigures } from '../src/services/tax.js';
import { Pdf, textWidth, wrap } from '../src/lib/pdf.js';

test('ABN: ATO check digits, spaces allowed, formatting', () => {
  for (const ok of ['51824753556', '53 004 085 616', '33051775556']) assert.ok(abnValid(ok), ok);
  for (const no of ['11222333444', '51824753999', '5182475355', '', null, 'abcdefghijk']) assert.equal(abnValid(no as any), false, String(no));
  assert.equal(abnFormat('51824753556'), '51 824 753 556');
  assert.equal(abnFormat(null), 'not provided');
});

test('periods: BAS quarters with due dates and financial-year labels, SERR halves, levy months', () => {
  const q4 = quarterPeriod('2026-Q4');
  assert.deepEqual([q4.from, q4.to, q4.due], ['2026-10-01', '2026-12-31', '2027-02-28'], 'Oct–Dec is due 28 February');
  assert.match(q4.label, /Oct–Dec 2026 \(Q2 2026–27\)/);
  const q3 = quarterPeriod('2026-Q3');
  assert.deepEqual([q3.from, q3.to, q3.due], ['2026-07-01', '2026-09-30', '2026-10-28']);
  assert.match(q3.label, /Q1 2026–27/);
  const q1 = quarterPeriod('2026-Q1');
  assert.deepEqual([q1.to, q1.due], ['2026-03-31', '2026-04-28']);
  assert.match(q1.label, /Q3 2025–26/);
  assert.throws(() => quarterPeriod('2026-Q5'), /Quarter looks like/);
  assert.match(quarterPeriod().key, /^\d{4}-Q[1-4]$/, 'default is the current quarter');

  const h1 = halfPeriod('2026-H1');
  assert.deepEqual([h1.from, h1.to, h1.due], ['2026-01-01', '2026-06-30', '2026-07-31'], 'SERR January–June is due 31 July');
  const h2 = halfPeriod('2026-H2');
  assert.deepEqual([h2.from, h2.to, h2.due], ['2026-07-01', '2026-12-31', '2027-01-31'], 'SERR July–December is due 31 January');
  assert.throws(() => halfPeriod('2026-H3'));

  const dec = monthPeriod('2026-12', 21);
  assert.deepEqual([dec.from, dec.to, dec.due, dec.label], ['2026-12-01', '2026-12-31', '2027-01-21', 'Dec 2026']);
  assert.equal(monthPeriod('2027-01', 31).due, '2027-02-28', 'due day clipped to the month');
  assert.equal(monthPeriod('2028-02').to, '2028-02-29', 'leap year');
  assert.throws(() => monthPeriod('2026-13'));
  assert.equal(longDate('2026-02-28'), '28 Feb 2026');
  assert.equal(cents(123456), '$1,234.56');
  assert.equal(cents(-300), '-$3.00');
});

test('SERR missing details: individuals need names, date of birth, address, ABN that passes, email, phone, bank and GST', () => {
  const full = { seller_type: 'individual', given_name: 'Tjala', family_name: 'Kemarre', date_of_birth: '1985-03-14', abn: '51824753556',
    address_line: '1 Example St', suburb: 'Gillen', postcode: '0870', address_state: 'NT', email: 'a@example.com', phone: '+61400000011',
    bank_bsb: '085001', bank_account: '123456', gst_registered: true };
  assert.deepEqual(missingSellerDetails(full), []);
  assert.deepEqual(missingSellerDetails({ ...full, date_of_birth: null, suburb: '', abn: '11222333444' }), ['Date of birth', 'ABN fails the ATO check', 'Address']);
  assert.deepEqual(missingSellerDetails({ ...full, seller_type: 'entity', given_name: null, family_name: null, date_of_birth: null, business_name: null }), ['Business name'],
    'entities need a business name, not a date of birth');
  assert.deepEqual(missingSellerDetails({ ...full, phone: 'deleted:abc', bank_account: null, gst_registered: false, email: null }), ['Email', 'Phone', 'Bank account', 'GST registration']);
});

test('record retention: tax records at least 5 years; other limits checked; deleted drivers kept 5 years after the financial year', () => {
  const p = checkRetention({});
  assert.equal(p.tax_years, 5);
  assert.equal(p.auto, false, 'automatic purging is off until switched on');
  assert.throws(() => checkRetention({ tax_years: 4 }), /tax years must be a whole number from 5/);
  assert.throws(() => checkRetention({ gps_track_months: 0 }));
  assert.throws(() => checkRetention({ chat_months: 1.5 }));
  assert.equal(checkRetention({ tax_years: 7, auto: true }).tax_years, 7);
  assert.equal(purgeAfter('2026-11-19T03:00:00Z'), '2032-06-30', 'FY 2026–27 + 5 years');
  assert.equal(purgeAfter('2026-03-01T03:00:00Z'), '2031-06-30', 'FY 2025–26 + 5 years');
  assert.equal(purgeAfter('2026-06-30T15:00:00Z'), '2032-06-30', '30 June 15:00 UTC is 1 July in Darwin');
});

test('NDIS settings: registration number, support item format, GST code, terms', () => {
  assert.deepEqual(checkNdis({}), { registration_number: '', support_item: '', support_name: 'Transport', gst_code: 'P1', payment_terms_days: 14 });
  assert.equal(checkNdis({ registration_number: '405123456', support_item: '02_051_0108_1_1', gst_code: 'P2' }).gst_code, 'P2');
  assert.throws(() => checkNdis({ registration_number: '12' }), /9 digits/);
  assert.throws(() => checkNdis({ support_item: 'transport' }), /looks like/);
  assert.throws(() => checkNdis({ gst_code: 'P9' }));
  assert.throws(() => checkNdis({ payment_terms_days: 90 }));
});

test('driver BAS figures from the pay ledger: G1 sales incl. cancel fees, 1A, fees as G11 with 1B, tips and the rest outside', () => {
  const f = driverFigures({ fare: 11000, commission: -2750, pickup_pay: 330, fuel_surcharge: 110, cancel_fee: 225, tip: 500, lease: -2200, bonus: 1000, cash_collected: -1500, payout: -5000 }, 4);
  assert.equal(f.sales_cents, 11000 + 330 + 110 + 225);
  assert.equal(f.gst_on_sales_cents, Math.round(11665 / 11));
  assert.deepEqual([f.service_fees_cents, f.lease_cents, f.fees_cents, f.gst_credits_cents], [2750, 2200, 4950, 450]);
  assert.equal(f.net_gst_cents, f.gst_on_sales_cents - 450);
  assert.deepEqual([f.tips_cents, f.other_payments_cents, f.cash_held_cents, f.paid_out_cents, f.trips], [500, 1000, 1500, 5000, 4]);
  const unregistered = driverFigures({ fare: 1100, commission: -275 }, 1, false);
  assert.deepEqual([unregistered.gst_on_sales_cents, unregistered.gst_credits_cents], [0, 0], 'no GST figures if not registered');
});

test('PDF writer: valid structure, searchable text, escaping, wrapping and page breaks with table headers repeated', () => {
  assert.ok(textWidth('WWW', 10) > textWidth('iii', 10));
  assert.deepEqual(wrap('one two three four', textWidth('three four', 10) + 1, 10), ['one two', 'three four']);
  const doc = new Pdf('Test (1)', 'Footer');
  doc.heading('Tax invoice');
  doc.para('Fees (incl. GST) – $10.00 for Mparntwe’s drivers \\ back');
  doc.table([{ label: 'Item', width: 0.7 }, { label: 'Amount', width: 0.3, align: 'right' }], Array.from({ length: 120 }, (_, i) => [`Line ${i}`, '$1.00']));
  const buf = doc.toBuffer();
  const s = buf.toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4'));
  assert.ok(s.trimEnd().endsWith('%%EOF'));
  assert.match(s, /\(Tax invoice\) Tj/);
  assert.match(s, /\(Fees \\\(incl\. GST\\\) \x96 \$10\.00 for Mparntwe\x92s drivers \\\\ back\) Tj/, 'parentheses, backslash, en dash and apostrophe encoded');
  const pages = Number(/\/Count (\d+)/.exec(s)![1]);
  assert.ok(pages >= 3, `120 rows need several pages (${pages})`);
  assert.equal(s.match(/\(Amount\) Tj/g)!.length, pages, 'table header on every page');
  assert.match(s, /\(Footer   Page 1 of \d+\) Tj/);
  // xref offsets point at the objects
  const xref = Number(/startxref\n(\d+)/.exec(s)![1]);
  assert.equal(s.slice(xref, xref + 4), 'xref');
  const first = /0000000000 65535 f \n(\d{10})/.exec(s)![1];
  assert.equal(s.slice(Number(first), Number(first) + 7), '1 0 obj');
});
