import { one, pool, q, type Q } from '../db.js';

export const STATES = ['NT', 'SA'] as const;
export type StateCode = (typeof STATES)[number];

export interface Jurisdiction {
  code: string; name: string; vehicle_max_age_years: number; levy_cents: number; levy_label: string;
  inspection_months: number | null; rego_check_url: string | null; regulator: string | null;
  driver_docs: string[]; vehicle_docs: string[]; notes: string | null; active: boolean;
}

/** Plain-English labels + one-line help for every document type (apps may use or override these). */
export const DOCUMENT_TYPES: Record<string, { label: string; help: string; vehicle?: boolean }> = {
  licence: { label: 'Driver licence', help: 'Front and back of your full (unrestricted) driver licence' },
  h_endorsement: { label: 'H endorsement', help: 'NT commercial passenger vehicle endorsement on your licence' },
  cpvid: { label: 'CPVID card', help: 'NT commercial passenger vehicle identity card (class Rideshare)' },
  police_check: { label: 'Police check', help: 'National police certificate' },
  medical: { label: 'Medical', help: 'Commercial vehicle driver medical certificate' },
  abn: { label: 'ABN', help: 'Your Australian Business Number' },
  gst: { label: 'GST registration', help: 'Proof you are registered for GST (rideshare drivers register from the first trip)' },
  wwcc: { label: 'Working with children check', help: 'Your current working with children check' },
  sa_driver_accreditation: { label: 'SA driver accreditation', help: 'South Australian point-to-point driver accreditation' },
  sa_operator_accreditation: { label: 'SA operator accreditation', help: 'South Australian operator accreditation (rideshare drivers need both)' },
  first_aid: { label: 'First aid', help: 'First aid certificate (optional)' },
  disability_awareness: { label: 'Disability awareness training', help: 'Certificate of completion' },
  vehicle_rego: { label: 'Registration papers', help: 'Current registration certificate for the car', vehicle: true },
  insurance: { label: 'Insurance', help: 'At least third-party property insurance naming you as a driver', vehicle: true },
  vehicle_cvl: { label: 'Commercial Vehicle Licence (CVL)', help: 'NT rideshare CVL for this car', vehicle: true },
  roadworthy: { label: 'Roadworthy report', help: 'Roadworthy inspection report (under 6 weeks old when applying for the CVL)', vehicle: true },
  compliance_plate: { label: 'Compliance plate', help: 'Photo of the build plate (inside the door frame or engine bay) showing when the car was made', vehicle: true },
  ctp_spv: { label: 'CTP (small passenger vehicle)', help: 'CTP insurance upgraded to "small passenger vehicle"', vehicle: true },
  sa_inspection: { label: 'SA vehicle inspection', help: 'Annual inspection report from an approved station (RAA or Rightway)', vehicle: true },
  public_liability: { label: 'Public liability insurance', help: 'Operator public liability cover of at least $5 million', vehicle: true },
  owner_permission: { label: "Owner's permission", help: "The registered owner's written permission for you to use the car", vehicle: true },
};
export const DOC_TYPE_KEYS = Object.keys(DOCUMENT_TYPES) as [string, ...string[]];
export const docLabel = (t: string) => DOCUMENT_TYPES[t]?.label ?? t.replace(/_/g, ' ');

function currentYear() {
  return Number(new Intl.DateTimeFormat('en-AU', { timeZone: 'Australia/Darwin', year: 'numeric' }).format(new Date()));
}

/** min_year = current_year − (max_age − 1): manufactured less than max_age years ago. */
export function ageRule(maxAge: number) {
  const year = currentYear();
  return { max_age_years: maxAge, min_year: year - (maxAge - 1), current_year: year };
}

export async function getJurisdiction(code: string, c: Q = pool): Promise<Jurisdiction | null> {
  return one<Jurisdiction>('SELECT * FROM jurisdictions WHERE code = $1', [code], c);
}

/** Jurisdiction rows plus computed min_year (for apps: "{min_year} or newer"). */
export const withRules = (j: Jurisdiction) => ({ ...j, ...ageRule(j.vehicle_max_age_years) });

export async function listJurisdictions(c: Q = pool) {
  const rows = await q<Jurisdiction>('SELECT * FROM jurisdictions ORDER BY active DESC, code', [], c);
  const zones = await q('SELECT id, name, state, active, launch_note FROM zones ORDER BY name', [], c);
  return rows.map((j) => ({ ...withRules(j), zones: zones.filter((z) => z.state === j.code).map(({ state, ...z }) => z) }));
}
