/**
 * Paid number-plate lookup (regcheck.org.uk "CheckAustralia"). OFF unless REGCHECK_USERNAME is set.
 * Each call costs a provider credit, so it is only ever triggered by an admin (POST /admin/vehicles/:id/lookup).
 *
 * ⚠ UNTESTED AGAINST THE LIVE PROVIDER. The response format below is taken from the provider's published examples:
 *   an XML envelope whose <vehicleJson> element holds a JSON string (XML-escaped). Field names vary between
 *   countries/versions, so parsing is deliberately defensive: every field is optional and the full parsed object is
 *   kept as `raw` for the admin to read. If the live format differs, fix it here only — nothing else depends on it.
 *   A lookup result is a hint for the admin; it never approves a car by itself.
 */
import { config } from '../config.js';
import { ApiError } from './errors.js';

export interface PlateLookup {
  year: number | null; make: string | null; model: string | null; vin: string | null;
  description: string | null; expiry: string | null; raw: unknown;
}

export const plateLookupConfigured = () => !!config.regcheckUsername;

const decodeXml = (s: string) => s
  .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)))
  .replace(/&amp;/g, '&');

/** Values come either as plain strings/numbers or as { CurrentTextValue: '...' } objects. */
function text(v: unknown): string | null {
  if (v == null) return null;
  if (typeof v === 'string') return v.trim() || null;
  if (typeof v === 'number') return String(v);
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    return text(o.CurrentTextValue ?? o.Value ?? o.value ?? o.Text ?? null);
  }
  return null;
}
const pick = (o: Record<string, unknown>, keys: string[]) => {
  for (const k of keys) { const t = text(o[k]); if (t) return t; }
  return null;
};

/** Parse the provider's XML response. Exported for unit tests. Throws ApiError 502 if no usable <vehicleJson>. */
export function parseRegCheckXml(xml: string): PlateLookup {
  const m = /<vehicleJson[^>]*>([\s\S]*?)<\/vehicleJson>/i.exec(xml);
  if (!m || !m[1].trim()) throw new ApiError(502, 'lookup_failed', 'The plate lookup service did not return vehicle details (check the plate and state)');
  let raw: unknown;
  try {
    let body = m[1].trim();
    const cdata = /^<!\[CDATA\[([\s\S]*)\]\]>$/.exec(body);
    body = cdata ? cdata[1] : decodeXml(body);
    raw = JSON.parse(body);
  } catch {
    throw new ApiError(502, 'lookup_failed', 'The plate lookup service returned something we could not read');
  }
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const yearText = pick(o, ['RegistrationYear', 'ManufactureYearFrom', 'YearOfManufacture', 'Year', 'ModelYear']);
  const year = yearText && /^\d{4}/.test(yearText) ? Number(yearText.slice(0, 4)) : null;
  return {
    year,
    make: pick(o, ['CarMake', 'MakeDescription', 'Make']),
    model: pick(o, ['CarModel', 'ModelDescription', 'Model']),
    vin: pick(o, ['VechileIdentificationNumber', 'VehicleIdentificationNumber', 'VIN', 'Vin']),
    description: pick(o, ['Description', 'Variant']),
    expiry: pick(o, ['Expiry', 'RegistrationExpiry', 'ExpiryDate', 'RegoExpiry']),
    raw,
  };
}

export async function lookupPlate(rego: string, state: string): Promise<PlateLookup> {
  if (!plateLookupConfigured()) throw new ApiError(501, 'lookup_not_configured', 'Paid plate lookup not set up — add a provider key');
  const url = `${config.regcheckUrl}?RegistrationNumber=${encodeURIComponent(rego)}&State=${encodeURIComponent(state)}&username=${encodeURIComponent(config.regcheckUsername)}`;
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(15000) });
  } catch (e) {
    throw new ApiError(502, 'lookup_failed', `Plate lookup service unreachable: ${(e as Error).message}`);
  }
  const body = await res.text();
  if (!res.ok) throw new ApiError(502, 'lookup_failed', `Plate lookup failed (${res.status}): ${body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)}`);
  return parseRegCheckXml(body);
}
