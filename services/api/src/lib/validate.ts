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
