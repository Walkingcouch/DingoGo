import { one, pool, type Q } from '../db.js';
import { ageRule } from './jurisdictions.js';
import { vinYearMismatch } from './vin.js';

export const FUEL_TYPES = ['electric', 'plug_in_hybrid', 'hybrid', 'petrol', 'diesel'] as const;
export type FuelType = (typeof FUEL_TYPES)[number];
export const GREEN_FUELS: readonly string[] = ['electric', 'plug_in_hybrid', 'hybrid'];
/** Document types that belong to a car rather than the driver. */
export const VEHICLE_DOC_TYPES: readonly string[] = ['vehicle_rego', 'insurance', 'vehicle_cvl', 'roadworthy', 'owner_permission',
  'compliance_plate', 'ctp_spv', 'sa_inspection', 'public_liability'];
export const VERIFIED_SOURCES = ['vin', 'compliance_plate', 'rego_papers', 'plate_lookup', 'other'] as const;

export const isGreen = (fuel?: string | null) => !!fuel && GREEN_FUELS.includes(fuel);
export const isEv = (fuel?: string | null) => fuel === 'electric';
/** SQL fragment: `<alias>.fuel_type IN (...)` */
export const greenSql = (alias = 'v') => `${alias}.fuel_type IN ('electric','plug_in_hybrid','hybrid')`;

/** Rego as stored for driver-added cars: uppercase, no whitespace. */
export const normaliseRego = (s: string) => s.toUpperCase().replace(/\s+/g, '');

/** Vehicle JSON for API responses: adds computed `green` / `is_ev`; strips the roof-display secret unless asked. */
export function vehicleOut<T extends Record<string, any> | null | undefined>(v: T, opts: { keepSecrets?: boolean } = {}) {
  if (!v) return v;
  const out: Record<string, any> = {
    ...v, green: isGreen(v.fuel_type), is_ev: isEv(v.fuel_type),
    // Year used for the age rule: DingoGo-verified year if checked, else the year the driver entered.
    compliance_year: v.verified_year ?? v.year ?? null,
    checks: { vin_year: v.vin_year ?? null, vin_year_mismatch: vinYearMismatch(v.vin_year, v.year) },
  };
  if (!opts.keepSecrets) delete out.display_key;
  return out;
}

/** Max vehicle age for a state (jurisdictions.vehicle_max_age_years): manufactured less than N years ago → year >= currentYear - (N - 1).
 *  Falls back to the old global setting / 13 if the state is unknown. */
export async function vehicleAgeRule(state = 'NT', c: Q = pool) {
  const j = await one(`SELECT vehicle_max_age_years FROM jurisdictions WHERE code = $1`, [state], c);
  let maxAge = Number(j?.vehicle_max_age_years);
  if (!(maxAge > 0)) {
    const s = await one(`SELECT value FROM settings WHERE key = 'vehicle_max_age_years'`, [], c);
    maxAge = Number(s?.value) > 0 ? Number(s!.value) : 13;
  }
  return { state, ...ageRule(maxAge) };
}
