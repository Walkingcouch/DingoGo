import { one, pool, type Q } from '../db.js';

export const FUEL_TYPES = ['electric', 'plug_in_hybrid', 'hybrid', 'petrol', 'diesel'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];
export const GREEN_FUELS: readonly string[] = ['electric', 'plug_in_hybrid', 'hybrid'];
/** Document types that belong to a car rather than the driver. */
export const VEHICLE_DOC_TYPES: readonly string[] = ['vehicle_rego', 'insurance', 'vehicle_cvl', 'roadworthy', 'owner_permission'];

export const isGreen = (fuel?: string | null) => !!fuel && GREEN_FUELS.includes(fuel);
export const isEv = (fuel?: string | null) => fuel === 'electric';
/** SQL fragment: `<alias>.fuel_type IN (...)` */
export const greenSql = (alias = 'v') => `${alias}.fuel_type IN ('electric','plug_in_hybrid','hybrid')`;

/** Rego as stored for driver-added cars: uppercase, no whitespace. */
export const normaliseRego = (s: string) => s.toUpperCase().replace(/\s+/g, '');

/** Vehicle JSON for API responses: adds computed `green` / `is_ev`; strips the roof-display secret unless asked. */
export function vehicleOut<T extends Record<string, any> | null | undefined>(v: T, opts: { keepSecrets?: boolean } = {}) {
  if (!v) return v;
  const out: Record<string, any> = { ...v, green: isGreen(v.fuel_type), is_ev: isEv(v.fuel_type) };
  if (!opts.keepSecrets) delete out.display_key;
  return out;
}

/** NT max vehicle age: manufactured less than N years ago → year >= currentYear - (N - 1). */
export async function vehicleAgeRule(c: Q = pool) {
  const s = await one(`SELECT value FROM settings WHERE key = 'vehicle_max_age_years'`, [], c);
  const maxAge = Number(s?.value) > 0 ? Number(s!.value) : 13;
  const year = Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Darwin', year: 'numeric' }).format(new Date()));
  return { max_age_years: maxAge, min_year: year - (maxAge - 1), current_year: year };
}
