/**
 * Upload privacy. Driver documents (licences, rego papers…) and proof-of-delivery photos are private: they are only
 * served with a short-lived signed link (HMAC of name + expiry) or to the owner / DingoGo staff with a bearer token.
 * The database keeps the plain reference `/uploads/<name>`; API responses sign it on the way out (signUploadUrls).
 * Driver photo checks (selfie) and safety-report evidence (Round 14) are private too. Ad images and avatars stay public.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { one } from '../db.js';
import { bad } from './errors.js';

export const PRIVATE_PURPOSES = ['pod', 'document', 'selfie', 'evidence'] as const;
export const isPrivatePurpose = (p: string) => (PRIVATE_PURPOSES as readonly string[]).includes(p);
/** Upload names start with their purpose (`pod-…`, `document-…`), so responses can be signed without a lookup. */
const PRIVATE_REF = /^\/uploads\/((?:pod|document|selfie|evidence)-[A-Za-z0-9._-]+)$/;
const NAME = /^[A-Za-z0-9._-]{1,120}$/;

const key = () => crypto.createHmac('sha256', config.jwtSecret).update('dingogo-upload-link-v1').digest();
const mac = (name: string, exp: number) => crypto.createHmac('sha256', key()).update(`${name}.${exp}`).digest('base64url').slice(0, 32);

/** Expiry rounded up to a 10-minute step so a page that polls gets the same URL (images stay cached). */
function expiry(now = Date.now()) {
  const step = 600;
  return Math.ceil((Math.floor(now / 1000) + config.uploadLinkTtlS) / step) * step;
}

export function signedUploadPath(name: string, now = Date.now()) {
  const exp = expiry(now);
  return `/uploads/${name}?exp=${exp}&sig=${mac(name, exp)}`;
}

export type SigCheck = 'ok' | 'expired' | 'bad';
export function checkSignature(name: string, exp: unknown, sig: unknown, now = Date.now()): SigCheck {
  const e = Number(exp);
  if (!Number.isInteger(e) || typeof sig !== 'string' || sig.length !== 32) return 'bad';
  const want = Buffer.from(mac(name, e));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !crypto.timingSafeEqual(want, got)) return 'bad';
  return e * 1000 < now ? 'expired' : 'ok';
}

/** Replace private `/uploads/…` references in `*_url` fields with signed links (in place). */
export function signUploadUrls<T>(payload: T, depth = 0): T {
  if (!payload || typeof payload !== 'object' || depth > 8) return payload;
  if (Array.isArray(payload)) { for (const x of payload) signUploadUrls(x, depth + 1); return payload; }
  const proto = Object.getPrototypeOf(payload);
  if (proto !== Object.prototype && proto !== null) return payload; // Dates, Buffers, etc.
  for (const [k, v] of Object.entries(payload as Record<string, unknown>)) {
    if (typeof v === 'string') {
      if (k.endsWith('_url')) {
        const m = PRIVATE_REF.exec(v);
        if (m) (payload as any)[k] = signedUploadPath(m[1]);
      }
    } else if (v && typeof v === 'object') signUploadUrls(v, depth + 1);
  }
  return payload;
}

/** Pull the upload name out of a reference the apps send back (plain, signed, or with the API base in front). */
export function uploadNameOf(ref: string): string | null {
  const m = /(?:^|\/)uploads\/([^/?#]+)(?:[?#].*)?$/.exec(ref.trim());
  return m && NAME.test(m[1]) ? m[1] : null;
}

/** A file reference must be one of the caller's own uploads with the right purpose. Returns the canonical `/uploads/<name>`. */
export async function ownUpload(ref: string, ownerId: string, purpose: string): Promise<string> {
  const name = uploadNameOf(ref);
  const f = name ? await one('SELECT owner_id, purpose FROM uploads WHERE name = $1', [name]) : null;
  if (!f || f.owner_id !== ownerId || f.purpose !== purpose) {
    throw bad('invalid_file', 'Upload the file again and retry');
  }
  return `/uploads/${name}`;
}

/** Does the file really start like the type it claims? Stops HTML or scripts being uploaded as an "image". */
export function contentMatches(mime: string, data: Buffer): boolean {
  const starts = (...bytes: number[]) => bytes.every((b, i) => data[i] === b);
  switch (mime) {
    case 'image/png': return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case 'image/jpeg': return starts(0xff, 0xd8, 0xff);
    case 'image/webp': return data.subarray(0, 4).toString('latin1') === 'RIFF' && data.subarray(8, 12).toString('latin1') === 'WEBP';
    case 'application/pdf': return data.subarray(0, 1024).indexOf('%PDF-', 0, 'latin1') !== -1; // readers allow junk before the header
    default: return false;
  }
}
