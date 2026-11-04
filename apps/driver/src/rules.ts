/** State rules (jurisdictions) and VIN hints. The API sends the rules; these defaults cover an older API that doesn't. */

export type StateCode = 'NT' | 'SA';
export interface Jurisdiction {
  code: StateCode; name: string; vehicle_max_age_years: number; levy_cents?: number; levy_label?: string;
  inspection_months?: number | null; rego_check_url?: string; regulator?: string;
  driver_docs: string[]; vehicle_docs: string[]; notes?: string | null; active: boolean;
}

export const DEFAULT_JURISDICTIONS: Jurisdiction[] = [
  { code: 'NT', name: 'Northern Territory', vehicle_max_age_years: 13, levy_cents: 100, levy_label: 'NT passenger levy', inspection_months: null, active: true,
    driver_docs: ['licence', 'h_endorsement', 'cpvid', 'police_check', 'medical', 'abn', 'gst'],
    vehicle_docs: ['vehicle_rego', 'insurance', 'vehicle_cvl', 'roadworthy', 'compliance_plate'] },
  { code: 'SA', name: 'South Australia', vehicle_max_age_years: 8, levy_cents: 0, levy_label: 'SA passenger levy', inspection_months: 12, active: false,
    driver_docs: ['licence', 'sa_driver_accreditation', 'sa_operator_accreditation', 'wwcc', 'police_check', 'medical', 'abn', 'gst'],
    vehicle_docs: ['vehicle_rego', 'ctp_spv', 'insurance', 'sa_inspection', 'public_liability', 'compliance_plate'] },
];

/** Merge whatever the API sent over the defaults, so missing fields never break a screen. */
export function jurisdictionList(fromApi?: any[] | null): Jurisdiction[] {
  const api = Array.isArray(fromApi) ? fromApi : [];
  return DEFAULT_JURISDICTIONS.map((d) => {
    const a = api.find((j) => j?.code === d.code) ?? {};
    const docs = (x: unknown, fb: string[]) => (Array.isArray(x) && x.length ? (x as string[]) : fb);
    return { ...d, ...a, driver_docs: docs(a.driver_docs, d.driver_docs), vehicle_docs: docs(a.vehicle_docs, d.vehicle_docs),
      vehicle_max_age_years: Number(a.vehicle_max_age_years ?? d.vehicle_max_age_years), active: a.active ?? d.active };
  });
}
export const findJ = (list: Jurisdiction[], code?: string | null) => list.find((j) => j.code === code) ?? list[0];
/** Oldest model year allowed: a car must be under max_age years old. */
export const minYearFor = (j: Jurisdiction) => new Date().getFullYear() - (j.vehicle_max_age_years - 1);
export const STATE_SHORT: Record<string, string> = { NT: 'NT', SA: 'SA' };

// ───────── VIN ─────────
const YEAR_CODES = 'ABCDEFGHJKLMNPRSTVWXY123456789'; // 1980…2009, then the cycle repeats every 30 years

export function cleanVin(s: string) { return s.toUpperCase().replace(/[^A-Z0-9]/g, ''); }

/** Model year from VIN position 10: the most recent year in the 30-year cycle that's no later than next year. A hint, not proof. */
export function decodeVin(raw: string): { valid: boolean; year: number | null; note: string } {
  const vin = cleanVin(raw);
  if (vin.length !== 17) return { valid: false, year: null, note: vin.length ? `${vin.length} of 17 characters` : '' };
  if (/[IOQ]/.test(vin)) return { valid: false, year: null, note: 'VINs never use the letters I, O or Q. Check for 1 or 0.' };
  const i = YEAR_CODES.indexOf(vin[9]);
  if (i < 0) return { valid: true, year: null, note: 'Can’t read the year from this VIN. That’s fine for some imports.' };
  const max = new Date().getFullYear() + 1;
  let y = 1980 + i;
  while (y + 30 <= max) y += 30;
  return { valid: true, year: y, note: '' };
}

// ───────── What each paper is, in plain English ─────────
export interface DocInfo { title: string; help: string; number?: string; expiry?: string; numberRequired?: boolean }

/** Driver papers. NT's H endorsement and CPV card are one step, so cpvid has no entry of its own. */
export function driverDocInfo(type: string, state: StateCode): DocInfo | null {
  const sa = state === 'SA';
  switch (type) {
    case 'licence': return { title: 'Driver licence', help: sa ? 'Full (unrestricted) licence, held for at least 6 months.' : 'Full NT (or interstate) licence with at least 12 months’ driving history in the last 3 years.' };
    case 'h_endorsement': return { title: 'H endorsement & CPV identity card', help: 'Apply through NT Motor Vehicle Registry after passing the hire-and-reward knowledge test. Fee about $117.' };
    case 'sa_driver_accreditation': return { title: 'SA driver accreditation', help: 'From the Department for Infrastructure and Transport (DIT). It lasts 3 years, paid yearly.', number: 'Accreditation number', expiry: 'Expiry date', numberRequired: true };
    case 'sa_operator_accreditation': return { title: 'SA operator accreditation', help: 'Rideshare drivers in SA also need operator accreditation from DIT. It lasts 5 years.', number: 'Accreditation number', expiry: 'Expiry date', numberRequired: true };
    case 'wwcc': return { title: 'Working with children check', help: 'From the SA Department of Human Services screening unit.', number: 'Check number', expiry: 'Expiry date', numberRequired: true };
    case 'police_check': return { title: 'National police check', help: 'Must be dated within the last 3 months when you apply.' };
    case 'medical': return { title: 'Medical certificate', help: sa ? 'Commercial vehicle driver medical from your GP, dated within the last 3 months.' : 'Commercial driver medical from your GP, dated within the last 3 months.' };
    case 'abn': return { title: 'ABN', help: 'You drive as a sole trader. Apply free at abr.gov.au.' };
    case 'gst': return { title: 'GST registration', help: 'The ATO requires rideshare drivers to register for GST before their first trip, whatever they earn.' };
    default: return null;
  }
}

/** Car papers, in the order each state's process happens. */
export function carDocInfo(type: string, state: StateCode): DocInfo {
  const sa = state === 'SA';
  switch (type) {
    case 'vehicle_rego': return { title: 'Registration papers', help: sa ? 'Your SA rego certificate.' : 'Your NT rego certificate. CTP insurance comes with your rego.', expiry: 'Rego expiry date' };
    case 'ctp_spv': return { title: 'CTP: small passenger vehicle', help: 'Proof your CTP has been upgraded to the “small passenger vehicle” class.', expiry: 'Expiry date' };
    case 'insurance': return { title: 'Insurance certificate', help: 'At least third-party property cover, with you named as a driver.', number: 'Policy number', expiry: 'Expiry date' };
    case 'roadworthy': return { title: 'Roadworthy report', help: 'From an approved inspection station. It must be less than 6 weeks old when you apply for the CVL.', number: 'Report number' };
    case 'vehicle_cvl': return { title: 'Rideshare licence (CVL)', help: 'Apply at the Motor Vehicle Registry (MVR) with your roadworthy. Ask for a Commercial Vehicle Licence, class Rideshare – SPV.', number: 'CVL number', expiry: 'CVL expiry date', numberRequired: true };
    case 'sa_inspection': return { title: 'Annual inspection', help: 'Report from an approved inspection station (RAA or Rightway). Needed every year.', number: 'Report number', expiry: 'Next inspection due' };
    case 'public_liability': return { title: 'Public liability insurance', help: 'At least $5 million cover, as an SA rideshare operator.', number: 'Policy number', expiry: 'Expiry date' };
    case 'compliance_plate': return { title: 'Compliance plate', help: 'Photo of the build plate (inside the door frame or engine bay) showing when the car was made.' };
    case 'owner_permission': return { title: 'Owner’s written permission', help: 'Only if the car isn’t registered in your name. A signed letter from the owner saying you can use it for rideshare.' };
    default: return { title: type.replace(/_/g, ' '), help: '' };
  }
}

/** Every paper's short name, for lists. */
export const DOC_LABEL: Record<string, string> = {
  licence: 'Driver licence', h_endorsement: 'H endorsement', cpvid: 'CPV identity card', police_check: 'Police check', medical: 'Medical',
  abn: 'ABN', gst: 'GST', insurance: 'Car insurance', vehicle_cvl: 'Car rideshare licence (CVL)', roadworthy: 'Roadworthy report', first_aid: 'First aid',
  vehicle_rego: 'Car registration', owner_permission: 'Owner’s permission', compliance_plate: 'Compliance plate photo',
  sa_driver_accreditation: 'SA driver accreditation', sa_operator_accreditation: 'SA operator accreditation', sa_inspection: 'SA annual inspection',
  ctp_spv: 'CTP (small passenger vehicle)', public_liability: 'Public liability insurance',
  disability_awareness: 'Disability awareness', wwcc: 'Working with children check',
};
