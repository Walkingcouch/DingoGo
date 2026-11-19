/**
 * Round 16 — tax, compliance and reporting: pure rules (no database) for ABNs, reporting periods (BAS quarters, SERR halves,
 * levy months, all on Darwin dates), what the ATO's Sharing Economy Reporting Regime needs about each driver, record retention
 * and NDIS invoice settings. Live-DB lag: `taxReady()` says whether migration 020 is in.
 */
import { one } from '../db.js';
import { bad } from './errors.js';

/** ATO ABN check: subtract 1 from the first digit, weight the digits 10,1,3,…,19; the sum must divide by 89. */
export function abnValid(abn: string | null | undefined): boolean {
  const d = String(abn ?? '').replace(/\s/g, '');
  if (!/^\d{11}$/.test(d)) return false;
  const w = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = d.split('').reduce((s, c, i) => s + (Number(c) - (i === 0 ? 1 : 0)) * w[i], 0);
  return sum % 89 === 0;
}
/** "51 824 753 556" for documents. */
export const abnFormat = (abn: string | null | undefined) => {
  const d = String(abn ?? '').replace(/\s/g, '');
  return /^\d{11}$/.test(d) ? `${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 8)} ${d.slice(8)}` : (abn || 'not provided');
};

// ───────────── Periods (Darwin dates, inclusive) ─────────────
export interface Period { key: string; kind: 'month' | 'quarter' | 'half'; from: string; to: string; label: string; due: string }
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');
const lastDay = (y: number, m: number) => new Date(Date.UTC(y, m, 0)).getUTCDate();   // m is 1-based
const iso = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`;
export const darwinNow = () => new Date(Date.now() + 9.5 * 3600e3).toISOString().slice(0, 10);

/** Calendar quarter "2026-Q4" (Oct–Dec). BAS due on the 28th of the month after, except Oct–Dec: 28 February. */
export function quarterPeriod(key?: string): Period {
  const today = darwinNow();
  const m = /^(\d{4})-Q([1-4])$/.exec(String(key ?? ''));
  if (key && !m) throw bad('bad_period', 'Quarter looks like 2026-Q4');
  const y = m ? Number(m[1]) : Number(today.slice(0, 4));
  const qn = m ? Number(m[2]) : Math.floor((Number(today.slice(5, 7)) - 1) / 3) + 1;
  const sm = (qn - 1) * 3 + 1, em = sm + 2;
  const due = qn === 4 ? iso(y + 1, 2, 28) : iso(y, em + 1, 28);
  const fyQ = qn >= 3 ? qn - 2 : qn + 2, fy = qn >= 3 ? `${y}–${String(y + 1).slice(2)}` : `${y - 1}–${String(y).slice(2)}`;
  return { key: `${y}-Q${qn}`, kind: 'quarter', from: iso(y, sm, 1), to: iso(y, em, lastDay(y, em)),
    label: `${MONTHS[sm - 1]}–${MONTHS[em - 1]} ${y} (Q${fyQ} ${fy})`, due };
}
/** SERR reporting period "2026-H1" (1 Jan–30 Jun, due 31 Jul) or "2026-H2" (1 Jul–31 Dec, due 31 Jan). */
export function halfPeriod(key?: string): Period {
  const today = darwinNow();
  const m = /^(\d{4})-H([12])$/.exec(String(key ?? ''));
  if (key && !m) throw bad('bad_period', 'Reporting period looks like 2026-H2');
  const y = m ? Number(m[1]) : Number(today.slice(0, 4));
  const h = m ? Number(m[2]) : Number(today.slice(5, 7)) <= 6 ? 1 : 2;
  return h === 1
    ? { key: `${y}-H1`, kind: 'half', from: iso(y, 1, 1), to: iso(y, 6, 30), label: `1 January – 30 June ${y}`, due: iso(y, 7, 31) }
    : { key: `${y}-H2`, kind: 'half', from: iso(y, 7, 1), to: iso(y, 12, 31), label: `1 July – 31 December ${y}`, due: iso(y + 1, 1, 31) };
}
/** Levy month "2026-11"; due on `dueDay` of the next month. */
export function monthPeriod(key?: string, dueDay = 21): Period {
  const m = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(String(key ?? ''));
  if (key && !m) throw bad('bad_period', 'Month looks like 2026-11');
  const k = m ? key! : darwinNow().slice(0, 7);
  const y = Number(k.slice(0, 4)), mo = Number(k.slice(5, 7));
  const ny = mo === 12 ? y + 1 : y, nm = mo === 12 ? 1 : mo + 1;
  return { key: k, kind: 'month', from: iso(y, mo, 1), to: iso(y, mo, lastDay(y, mo)), label: `${MONTHS[mo - 1]} ${y}`,
    due: iso(ny, nm, Math.min(dueDay, lastDay(ny, nm))) };
}
export const longDate = (d: string | Date | null | undefined) => {
  if (!d) return '';
  const s = typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : new Date(new Date(d).getTime() + 9.5 * 3600e3).toISOString().slice(0, 10);
  return `${Number(s.slice(8, 10))} ${MONTHS[Number(s.slice(5, 7)) - 1]} ${s.slice(0, 4)}`;
};
export const cents = (c: number | null | undefined) => {
  const n = Number(c ?? 0);
  return `${n < 0 ? '-' : ''}$${(Math.abs(n) / 100).toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ',')}`;
};
/** GST inside a GST-inclusive amount. */
export const gstIn = (c: number) => Math.round(c / 11);

// ───────────── SERR: what we need about each seller ─────────────
export const SELLER_TYPES = ['individual', 'entity'] as const;
export interface SellerDetails {
  seller_type?: string | null; given_name?: string | null; family_name?: string | null; date_of_birth?: string | Date | null; business_name?: string | null;
  abn?: string | null; address_line?: string | null; suburb?: string | null; postcode?: string | null; address_state?: string | null;
  email?: string | null; phone?: string | null; bank_bsb?: string | null; bank_account?: string | null; gst_registered?: boolean | null;
}
/** Fields the ATO's SERR report needs that we don't have (or that fail a check), in plain words for ops and the driver. */
export function missingSellerDetails(d: SellerDetails): string[] {
  const out: string[] = [];
  const entity = d.seller_type === 'entity';
  if (entity) { if (!d.business_name) out.push('Business name'); }
  else {
    if (!d.given_name) out.push('Given name');
    if (!d.family_name) out.push('Family name');
    if (!d.date_of_birth) out.push('Date of birth');
  }
  if (!d.abn) out.push(entity ? 'ABN' : 'ABN (or the reason there is none)');
  else if (!abnValid(d.abn)) out.push('ABN fails the ATO check');
  if (!d.address_line || !d.suburb || !d.postcode || !d.address_state) out.push('Address');
  if (!d.email) out.push('Email');
  if (!d.phone || String(d.phone).startsWith('deleted:')) out.push('Phone');
  if (!d.bank_bsb || !d.bank_account) out.push('Bank account');
  if (!d.gst_registered) out.push('GST registration');
  return out;
}
export const AU_STATES = ['NT', 'SA', 'WA', 'QLD', 'NSW', 'ACT', 'VIC', 'TAS'] as const;

// ───────────── Record retention ─────────────
/** How long records are kept. ATO: tax records (trips, payments, driver pay, invoices) at least 5 years — that floor can't be lowered. */
export interface RetentionPolicy {
  tax_years: number; gps_track_months: number; chat_months: number; comms_log_months: number; notifications_months: number;
  security_log_days: number; auto: boolean;
}
export const RETENTION_DEFAULTS: RetentionPolicy = {
  tax_years: 5, gps_track_months: 24, chat_months: 12, comms_log_months: 24, notifications_months: 12, security_log_days: 90, auto: false,
};
export const TAX_MIN_YEARS = 5;
export function checkRetention(v: unknown): RetentionPolicy {
  const o = { ...RETENTION_DEFAULTS, ...(v && typeof v === 'object' ? v as object : {}) } as any;
  const int = (k: keyof RetentionPolicy, min: number, max: number) => {
    const n = Number(o[k]);
    if (!Number.isInteger(n) || n < min || n > max) throw bad('invalid_policy', `${String(k).replace(/_/g, ' ')} must be a whole number from ${min} to ${max}`, { field: k });
    return n;
  };
  return {
    tax_years: int('tax_years', TAX_MIN_YEARS, 10), gps_track_months: int('gps_track_months', 3, 120), chat_months: int('chat_months', 1, 120),
    comms_log_months: int('comms_log_months', 3, 120), notifications_months: int('notifications_months', 1, 120),
    security_log_days: int('security_log_days', 7, 3650), auto: !!o.auto,
  };
}
/** A deleted driver's tax identity is kept until 5 years (tax_years) after the end of the financial year of their last payment. */
export function purgeAfter(lastActivity: Date | string, taxYears = TAX_MIN_YEARS): string {
  const d = new Date(new Date(lastActivity).getTime() + 9.5 * 3600e3);
  const fyEnd = d.getUTCMonth() >= 6 ? d.getUTCFullYear() + 1 : d.getUTCFullYear();   // FY ends 30 June
  return iso(fyEnd + taxYears, 6, 30);
}

// ───────────── NDIS ─────────────
/** NDIS invoicing settings. The support item and GST code must be confirmed against the current NDIS Pricing Arrangements and
 *  with the accountant before invoices are sent; blank registration number = DingoGo is not an NDIS-registered provider
 *  (invoices are for plan-managed and self-managed participants; no NDIA bulk claim file). */
export interface NdisSettings { registration_number: string; support_item: string; support_name: string; gst_code: 'P1' | 'P2' | 'P5'; payment_terms_days: number }
export const NDIS_DEFAULTS: NdisSettings = { registration_number: '', support_item: '', support_name: 'Transport', gst_code: 'P1', payment_terms_days: 14 };
export const GST_CODES = { P1: 'Taxable (GST included)', P2: 'GST free', P5: 'Out of scope' } as const;
export function checkNdis(v: unknown): NdisSettings {
  const o = { ...NDIS_DEFAULTS, ...(v && typeof v === 'object' ? v as object : {}) } as any;
  const reg = String(o.registration_number ?? '').trim();
  if (reg && !/^\d{9}$/.test(reg)) throw bad('invalid_ndis', 'NDIS provider registration number is 9 digits', { field: 'registration_number' });
  const item = String(o.support_item ?? '').trim();
  if (item && !/^\d{2}_\d{3}_\d{4}_\d_\d(_T)?$/.test(item)) throw bad('invalid_ndis', 'Support item number looks like 02_051_0108_1_1', { field: 'support_item' });
  if (!['P1', 'P2', 'P5'].includes(o.gst_code)) throw bad('invalid_ndis', 'GST code is P1, P2 or P5', { field: 'gst_code' });
  const terms = Number(o.payment_terms_days);
  if (!Number.isInteger(terms) || terms < 0 || terms > 60) throw bad('invalid_ndis', 'Payment terms are 0–60 days', { field: 'payment_terms_days' });
  return { registration_number: reg, support_item: item, support_name: String(o.support_name ?? 'Transport').slice(0, 80) || 'Transport', gst_code: o.gst_code, payment_terms_days: terms };
}

// ───────────── Levy returns ─────────────
export interface LevySettings { due_day: number }
export const LEVY_DEFAULTS: LevySettings = { due_day: 21 };

// ───────────── Migration 020 ─────────────
let ready = false;
let checkedAt = 0;
export async function taxReady(): Promise<boolean> {
  if (ready) return true;
  if (checkedAt && Date.now() - checkedAt < 60_000) return false;
  checkedAt = Date.now();
  try {
    const r = await one<{ n: number }>(
      `SELECT (SELECT count(*) FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'drivers'
                 AND column_name IN ('seller_type','given_name','family_name','date_of_birth','address_line','suburb','postcode','address_state'))
            + (SELECT count(*) FROM information_schema.tables WHERE table_schema = current_schema()
                 AND table_name IN ('levy_lodgements','privacy_requests','retained_tax_identities')) AS n`);
    ready = Number(r!.n) === 11;
  } catch { ready = false; }
  return ready;
}
export function resetTaxReady() { ready = false; checkedAt = 0; }
export const taxPending = () => 'This needs database migration 020';
