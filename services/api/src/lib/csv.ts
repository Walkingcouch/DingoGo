/** CSV for spreadsheets (RFC 4180, CRLF, UTF-8 BOM so Excel reads accents). Text that a spreadsheet would run as a formula
 *  (=, +, -, @, tab, CR at the start) gets a leading apostrophe; plain numbers such as "-12.50" are left alone. */
export type CsvCol<T> = [header: string, value: (r: T) => unknown];

const FORMULA = /^[=+\-@\t\r]/;
const NUMBER = /^-?\d+(\.\d+)?$/;

export function csvCell(v: unknown): string {
  if (v == null) return '';
  let s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  if (typeof v === 'string' && FORMULA.test(s) && !NUMBER.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv<T>(cols: CsvCol<T>[], rows: T[]): string {
  const lines = [cols.map(([h]) => csvCell(h)).join(',')];
  for (const r of rows) lines.push(cols.map(([, f]) => csvCell(f(r))).join(','));
  return '﻿' + lines.join('\r\n') + '\r\n';
}

/** Cents → "12.50" (negative "-3.00"); null stays empty. */
export const dollars = (c: number | null | undefined) => (c == null ? '' : (c / 100).toFixed(2));
