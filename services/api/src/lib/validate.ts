import { z, type ZodTypeAny } from 'zod';
import { bad } from './errors.js';

export function parse<S extends ZodTypeAny>(schema: S, data: unknown): z.infer<S> {
  const r = schema.safeParse(data ?? {});
  if (!r.success) {
    const first = r.error.issues[0];
    throw bad('validation_error', `${first.path.join('.') || 'input'}: ${first.message}`, r.error.issues);
  }
  return r.data;
}

export const latLng = z.object({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180), address: z.string().max(300).optional() });
export const phone = z.string().transform((s) => s.replace(/[\s()-]/g, '')).pipe(z.string().regex(/^\+?\d{8,15}$/, 'Enter a valid phone number'))
  .transform((s) => (s.startsWith('0') ? '+61' + s.slice(1) : s.startsWith('+') ? s : '+' + s));
export { z };

/** Round 30: a real calendar day as YYYY-MM-DD (the regex alone let `2026-02-31` through to Postgres, which answered 500). */
export const isIsoDay = (s?: unknown): s is string =>
  typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`))
  && new Date(`${s}T00:00:00Z`).toISOString().slice(0, 10) === s;
/** A month as YYYY-MM with a month 01–12. */
export const isIsoMonth = (s?: unknown): s is string => typeof s === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(s);
export const isoDay = (msg = 'Use a real date as YYYY-MM-DD') => z.string().refine(isIsoDay, msg);
export const isoMonth = (msg = 'Month looks like 2026-11') => z.string().refine(isIsoMonth, msg);
