/** State rules (jurisdictions), official check links and VIN hints for staff. Defaults cover an older API. */

export interface Jurisdiction {
  code: string; name: string; vehicle_max_age_years: number; levy_cents: number; levy_label: string;
  inspection_months: number | null; rego_check_url: string; regulator?: string | null;
  driver_docs: string[]; vehicle_docs: string[]; notes?: string | null; active: boolean;
}

export const PPSR_URL = 'https://www.ppsr.gov.au/carcheck';

export const DEFAULT_JURISDICTIONS: Jurisdiction[] = [
  { code: 'NT', name: 'Northern Territory', vehicle_max_age_years: 13, levy_cents: 100, levy_label: 'NT passenger levy', inspection_months: null, active: true,
    rego_check_url: 'https://nt.gov.au/driving/registration/rego-check', regulator: 'NT Motor Vehicle Registry',
    driver_docs: ['licence', 'h_endorsement', 'cpvid', 'police_check', 'medical', 'abn', 'gst'],
    vehicle_docs: ['vehicle_rego', 'insurance', 'vehicle_cvl', 'roadworthy', 'compliance_plate'] },
  { code: 'SA', name: 'South Australia', vehicle_max_age_years: 8, levy_cents: 0, levy_label: 'SA passenger levy', inspection_months: 12, active: false,
    rego_check_url: 'https://www.sa.gov.au/topics/driving-and-transport/vehicles-and-registration/vehicle-registration/checking-that-a-vehicle-is-registered',
    regulator: 'Department for Infrastructure and Transport (DIT)',
    driver_docs: ['licence', 'sa_driver_accreditation', 'sa_operator_accreditation', 'wwcc', 'police_check', 'medical', 'abn', 'gst'],
    vehicle_docs: ['vehicle_rego', 'ctp_spv', 'insurance', 'sa_inspection', 'public_liability', 'compliance_plate'] },
];

/** Accepts `{ items }`, `{ jurisdictions }` or a bare array, and fills any gaps from the defaults. */
export function jurisdictionList(data: any): Jurisdiction[] {
  const api: any[] = Array.isArray(data) ? data : data?.items ?? data?.jurisdictions ?? [];
  const known = DEFAULT_JURISDICTIONS.map((d) => {
    const a = api.find((j) => j?.code === d.code) ?? {};
    const list = (x: unknown, fb: string[]) => (Array.isArray(x) && x.length ? (x as string[]) : fb);
    return { ...d, ...a, driver_docs: list(a.driver_docs, d.driver_docs), vehicle_docs: list(a.vehicle_docs, d.vehicle_docs),
      vehicle_max_age_years: Number(a.vehicle_max_age_years ?? d.vehicle_max_age_years), rego_check_url: a.rego_check_url || d.rego_check_url };
  });
  return [...known, ...api.filter((j) => j?.code && !known.some((k) => k.code === j.code))];
}
export const findJ = (list: Jurisdiction[], code?: string | null) => list.find((j) => j.code === (code ?? 'NT')) ?? list[0];
export const minYearFor = (j: Pick<Jurisdiction, 'vehicle_max_age_years'>) => new Date().getFullYear() - (Number(j.vehicle_max_age_years) - 1);

// ───────── VIN ─────────
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789'; // 1980…2009; the cycle repeats every 30 years

/** Model year from VIN position 10 (most recent year in the cycle no later than next year). A hint only. */
export function vinYear(raw?: string | null): number | null {
  const vin = String(raw ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (vin.length !== 17 || /[IOQ]/.test(vin)) return null;
  const i = YEAR_CODES.indexOf(vin[9]);
  if (i < 0) return null;
  const max = new Date().getFullYear() + 1;
  let y = 1980 + i;
  while (y + 30 <= max) y += 30;
  return y;
}
