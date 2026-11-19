import crypto from 'node:crypto';

/** Weak ETag for a JSON body (same bytes → same tag). */
export const etagOf = (body: string) => `W/"${crypto.createHash('sha1').update(body).digest('base64url').slice(0, 27)}"`;

/** Does an If-None-Match header (one tag, a list, or *) match? Weak comparison, as RFC 9110 asks for GET. */
export function etagMatches(header: string | string[] | undefined, tag: string) {
  if (!header) return false;
  const want = tag.replace(/^W\//, '');
  return String(header).split(',').some((t) => { const x = t.trim(); return x === '*' || x.replace(/^W\//, '') === want; });
}
