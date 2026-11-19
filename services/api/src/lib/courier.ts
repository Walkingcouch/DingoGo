/**
 * Courier rules that don't need the database: parcel sizes and weights, the prohibited-items checklist, Australian phone
 * numbers for the texts, failed-delivery reasons, drop ordering for multi-drop runs and the CSV format businesses import.
 */
import { bad } from './errors.js';
import { haversine, type LatLng } from './geo.js';
import { searchPlaces } from './places.js';

export type ParcelSize = 'S' | 'M' | 'L';
/** Heaviest parcel per size (kg). Matches the fare rule descriptions; anything heavier than L needs a van (not offered). */
export const SIZE_MAX_KG: Record<ParcelSize, number> = { S: 5, M: 15, L: 25 };
export const SIZE_SERVICE: Record<ParcelSize, string> = { S: 'courier_s', M: 'courier_m', L: 'courier_l' };
/** Declared value limit: items worth more can't be insured in transit (website prohibited items policy). */
export const MAX_DECLARED_CENTS = 100_000;
/** Most drops in one run. */
export const MAX_DROPS = 10;

/** The sender ticks every line before booking. Keys are stable; wording lives on the website and in the apps
 *  (packages/shared/src/courier.ts). Bump the version when the list changes so we know what each sender agreed to. */
export const PROHIBITED_VERSION = 1;
export const PROHIBITED_KEYS = ['alcohol', 'drugs', 'weapons', 'dangerous_goods', 'valuables', 'animals', 'hot_food'] as const;

/** Why a delivery couldn't be made. The parcel then goes back to the sender. */
export const FAIL_REASONS = {
  no_one_home: 'Nobody home and no safe place allowed',
  no_safe_place: 'No safe place to leave it',
  refused: 'Recipient refused the parcel',
  wrong_address: 'Address not found or wrong',
  no_access: 'Couldn’t get in (locked gate, dogs, no access)',
  unsafe: 'Unsafe to deliver',
  other: 'Something else',
} as const;
export type FailReason = keyof typeof FAIL_REASONS;

/** An Australian mobile in +614XXXXXXXX form, or null. Recipients get the tracking link and PIN by text, so it must be a mobile. */
export function auMobile(raw: string | null | undefined): string | null {
  let s = String(raw ?? '').replace(/[\s().-]/g, '');
  if (s.startsWith('+61')) s = '0' + s.slice(3);
  else if (s.startsWith('61') && s.length === 11) s = '0' + s.slice(2);
  return /^04\d{8}$/.test(s) ? '+61' + s.slice(1) : null;
}
/** Any Australian phone number (mobile or landline with area code), +61 form, or null. Shops often give a landline. */
export function auPhone(raw: string | null | undefined): string | null {
  const m = auMobile(raw);
  if (m) return m;
  let s = String(raw ?? '').replace(/[\s().-]/g, '');
  if (s.startsWith('+61')) s = '0' + s.slice(3);
  return /^0[2378]\d{8}$/.test(s) ? '+61' + s.slice(1) : null;
}

export interface ParcelIn {
  size: ParcelSize; weight_kg?: number; description: string; declared_value_cents?: number;
  sender_name: string; sender_phone: string; recipient_name: string; recipient_phone: string;
  instructions?: string; leave_unattended?: boolean; requires_signature?: boolean; safe_place?: string | null;
  prohibited_ack: boolean; prohibited_items?: string[]; customer_ref?: string;
}

/** Check and tidy a parcel before booking. Returns the parcel with phones in +61 form and what the sender agreed to. */
export function checkParcel(p: ParcelIn, where = 'parcel') {
  if (p.weight_kg != null && p.weight_kg > SIZE_MAX_KG[p.size]) {
    const fits = (Object.keys(SIZE_MAX_KG) as ParcelSize[]).find((s) => p.weight_kg! <= SIZE_MAX_KG[s]);
    throw bad('parcel_too_heavy', fits
      ? `${where}: ${p.weight_kg} kg is too heavy for size ${p.size} (up to ${SIZE_MAX_KG[p.size]} kg). Choose size ${fits}.`
      : `${where}: parcels can be up to ${SIZE_MAX_KG.L} kg. Split it into smaller parcels.`);
  }
  if (p.weight_kg != null && p.weight_kg <= 0) throw bad('validation_error', `${where}: weight must be more than 0 kg`);
  if (p.declared_value_cents != null && p.declared_value_cents > MAX_DECLARED_CENTS) {
    throw bad('declared_value_too_high', `${where}: we can carry items worth up to $${MAX_DECLARED_CENTS / 100}. More valuable items can't be insured.`);
  }
  const recipient = auMobile(p.recipient_phone);
  if (!recipient) throw bad('recipient_mobile', `${where}: the recipient's number must be an Australian mobile (04…), so we can text them the tracking link and PIN`);
  const sender = auPhone(p.sender_phone);
  if (!sender) throw bad('sender_phone', `${where}: enter the sender's Australian phone number`);
  // Prohibited items: the new apps send every ticked line; older apps send one tick box (still accepted).
  let checklist: { version: number; items: string[] } | null = null;
  if (p.prohibited_items) {
    const missing = PROHIBITED_KEYS.filter((k) => !p.prohibited_items!.includes(k));
    if (missing.length) throw bad('prohibited_ack_required', `${where}: please tick every line of the prohibited items check`, { missing });
    checklist = { version: PROHIBITED_VERSION, items: [...PROHIBITED_KEYS] };
  } else if (!p.prohibited_ack) {
    throw bad('prohibited_ack_required', 'Please confirm the parcel contains no alcohol, weapons, drugs or dangerous goods');
  }
  if (p.requires_signature && p.leave_unattended) throw bad('validation_error', `${where}: a parcel that needs a signature can't be left in a safe place`);
  const safePlace = p.leave_unattended ? (p.safe_place?.trim() || null) : null;
  return { ...p, recipient_phone: recipient, sender_phone: sender, safe_place: safePlace, checklist };
}

/** Delivery order for a run: nearest drop first from the pickup, then nearest to the last drop (good enough for a town). */
export function orderStops<T extends { dropoff: LatLng }>(pickup: LatLng, drops: T[]): T[] {
  const left = [...drops];
  const out: T[] = [];
  let at = pickup;
  while (left.length) {
    let best = 0;
    for (let i = 1; i < left.length; i++) if (haversine(at, left[i].dropoff) < haversine(at, left[best].dropoff)) best = i;
    const [next] = left.splice(best, 1);
    out.push(next);
    at = next.dropoff;
  }
  return out;
}

// ───────────── CSV import ─────────────

/** RFC 4180 CSV: quoted fields, doubled quotes, commas and line breaks inside quotes; CRLF or LF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = []; let cell = ''; let quoted = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"' && s[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(cell); cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/** Columns a business can put in its CSV (header row, any order, case and spaces ignored). */
export const CSV_COLUMNS = ['recipient_name', 'recipient_phone', 'address', 'lat', 'lng', 'size', 'weight_kg', 'description', 'instructions',
  'safe_place', 'leave_unattended', 'requires_signature', 'reference', 'declared_value'] as const;
const ALIASES: Record<string, string> = {
  name: 'recipient_name', recipient: 'recipient_name', mobile: 'recipient_phone', phone: 'recipient_phone', recipient_mobile: 'recipient_phone',
  latitude: 'lat', longitude: 'lng', lon: 'lng', weight: 'weight_kg', kg: 'weight_kg', contents: 'description', notes: 'instructions',
  ref: 'reference', order: 'reference', order_number: 'reference', signature: 'requires_signature', safe_drop: 'leave_unattended',
  value: 'declared_value', delivery_address: 'address',
};
export const CSV_MAX_ROWS = 50;

export interface CsvDrop {
  row: number;
  dropoff: LatLng & { address: string };
  parcel: Omit<ParcelIn, 'sender_name' | 'sender_phone' | 'prohibited_ack' | 'prohibited_items'>;
}
export interface CsvResult { drops: CsvDrop[]; errors: { row: number; error: string }[]; columns: string[] }

const yes = (v: string) => /^(y|yes|true|1|x)$/i.test(v.trim());

/** Turn a delivery CSV into drops. Addresses without lat/lng are matched against known Alice Springs places; anything
 *  else is reported by row (the whole file is checked, so the business can fix every line in one go). */
export function csvToDrops(text: string): CsvResult {
  const rows = parseCsv(text);
  if (!rows.length) return { drops: [], errors: [{ row: 1, error: 'The file is empty' }], columns: [] };
  const head = rows[0].map((h) => h.trim().toLowerCase().replace(/[\s-]+/g, '_')).map((h) => ALIASES[h] ?? h);
  const errors: CsvResult['errors'] = [];
  for (const need of ['recipient_name', 'recipient_phone', 'address']) {
    if (!head.includes(need)) errors.push({ row: 1, error: `Missing column "${need}"` });
  }
  if (errors.length) return { drops: [], errors, columns: head };
  const body = rows.slice(1);
  if (body.length > CSV_MAX_ROWS) return { drops: [], errors: [{ row: 1, error: `Up to ${CSV_MAX_ROWS} deliveries per file (this one has ${body.length})` }], columns: head };
  const drops: CsvDrop[] = [];
  body.forEach((cells, i) => {
    const row = i + 2;
    const v = (k: string) => (cells[head.indexOf(k)] ?? '').trim();
    const fail = (error: string) => errors.push({ row, error });
    const name = v('recipient_name'); const phone = v('recipient_phone'); const address = v('address');
    if (!name) return fail('Recipient name is missing');
    if (name.length > 80) return fail('Recipient name is longer than 80 characters');
    if (!auMobile(phone)) return fail(`"${phone}" isn't an Australian mobile`);
    if (!address || address.length > 300) return fail('Address is missing or too long');
    let lat = Number(v('lat')); let lng = Number(v('lng'));
    if (!v('lat') || !v('lng') || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      const hit = searchPlaces(address)[0];
      if (!hit) return fail(`Couldn't find "${address}". Add lat and lng columns, or book this one in the app.`);
      lat = hit.lat; lng = hit.lng;
    }
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return fail('lat/lng out of range');
    const size = (v('size') || 'S').toUpperCase();
    if (!['S', 'M', 'L'].includes(size)) return fail(`Size "${v('size')}" should be S, M or L`);
    const weight = v('weight_kg') ? Number(v('weight_kg').replace(/kg$/i, '')) : undefined;
    if (weight != null && !(weight > 0 && weight <= SIZE_MAX_KG[size as ParcelSize])) {
      return fail(`${v('weight_kg')} kg doesn't fit size ${size} (up to ${SIZE_MAX_KG[size as ParcelSize]} kg)`);
    }
    const declared = v('declared_value') ? Math.round(Number(v('declared_value').replace(/[$,]/g, '')) * 100) : undefined;
    if (declared != null && !(declared >= 0 && declared <= MAX_DECLARED_CENTS)) return fail(`Declared value can be up to $${MAX_DECLARED_CENTS / 100}`);
    const unattended = yes(v('leave_unattended')) || !!v('safe_place');
    const signature = yes(v('requires_signature'));
    if (unattended && signature) return fail('Choose either a safe place or a signature, not both');
    const description = v('description') || 'Parcel';
    if (description.length > 200 || v('instructions').length > 300 || v('safe_place').length > 120 || v('reference').length > 40) {
      return fail('A field is too long (description 200, instructions 300, safe place 120, reference 40 characters)');
    }
    drops.push({
      row, dropoff: { lat, lng, address },
      parcel: {
        size: size as ParcelSize, weight_kg: weight, description, declared_value_cents: declared,
        recipient_name: name, recipient_phone: phone, instructions: v('instructions') || undefined,
        leave_unattended: unattended, requires_signature: signature, safe_place: v('safe_place') || undefined,
        customer_ref: v('reference') || undefined,
      },
    });
  });
  return { drops, errors, columns: head };
}
