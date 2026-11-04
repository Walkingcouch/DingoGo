/**
 * VIN (vehicle identification number) checks. Free and offline.
 * The model year in position 10 is a HINT, not proof: many cars sold in Australia (especially Japanese-market builds)
 * don't encode the year reliably. DingoGo confirms the year from the compliance plate / rego papers.
 */

/** 17 characters, letters and digits, never I, O or Q. */
const VIN_RE = /^[A-HJ-NPR-Z0-9]{17}$/;
/** Position-10 year codes in order, starting at 1980 (A). 30-year cycle; I, O, Q, U, Z and 0 are never used. */
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789';

export interface VinResult { valid: boolean; year: number | null; note: string }

/** Uppercase, strip spaces and dashes. */
export const normaliseVin = (s: string) => s.toUpperCase().replace(/[\s-]+/g, '');

function currentYear() {
  return Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Darwin', year: 'numeric' }).format(new Date()));
}

export function decodeVin(input: string | null | undefined, nowYear = currentYear()): VinResult {
  const vin = normaliseVin(input ?? '');
  if (vin.length !== 17) return { valid: false, year: null, note: 'A VIN has 17 letters and numbers' };
  if (/[IOQ]/.test(vin)) return { valid: false, year: null, note: 'A VIN never uses the letters I, O or Q (check for 1 and 0)' };
  if (!VIN_RE.test(vin)) return { valid: false, year: null, note: 'A VIN only has letters and numbers' };
  const idx = YEAR_CODES.indexOf(vin[9]);
  if (idx < 0) return { valid: true, year: null, note: 'This VIN does not show a model year — check the compliance plate' };
  // Candidates 1980+idx, 2010+idx, 2040+idx… pick the most recent that is not after next year.
  let year = 1980 + idx;
  while (year + 30 <= nowYear + 1) year += 30;
  return { valid: true, year, note: `VIN suggests a ${year} model (a hint only — confirm on the compliance plate)` };
}

/** Claimed year vs VIN year differ by more than a year → flag for the admin (never blocks). */
export const vinYearMismatch = (vinYear: number | null | undefined, year: number | null | undefined) =>
  vinYear != null && year != null && Math.abs(vinYear - year) > 1;
