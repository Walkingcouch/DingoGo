/**
 * VIN model-year hints for the apps (admin car checks, driver "Your car"). One decoder for both, using the same rule as the API
 * (services/api/src/lib/vin.ts): position 10, 30-year cycle, the most recent year that isn't after next year in Darwin time.
 * A hint only: many Japanese-market imports don't encode the year. DingoGo confirms it from the compliance plate or rego papers.
 */
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789'; // 1980…2009, then the cycle repeats every 30 years

/** Uppercase letters and digits only. */
export const cleanVin = (s: string) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

const darwinYear = () => Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Darwin', year: 'numeric' }).format(new Date()));

/** Model year from VIN position 10, with a short plain-English note for the driver. */
export function decodeVin(raw: string | null | undefined, nowYear = darwinYear()): { valid: boolean; year: number | null; note: string } {
  const vin = cleanVin(raw ?? '');
  if (vin.length !== 17) return { valid: false, year: null, note: vin.length ? `${vin.length} of 17 characters` : '' };
  if (/[IOQ]/.test(vin)) return { valid: false, year: null, note: 'VINs never use the letters I, O or Q. Check for 1 or 0.' };
  const i = YEAR_CODES.indexOf(vin[9]);
  if (i < 0) return { valid: true, year: null, note: 'Can’t read the year from this VIN. That’s fine for some imports.' };
  let y = 1980 + i;
  while (y + 30 <= nowYear + 1) y += 30;
  return { valid: true, year: y, note: '' };
}

/** Just the year (or null), for staff screens. */
export const vinYear = (raw?: string | null): number | null => decodeVin(raw).year;
