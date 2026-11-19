/**
 * Links between the website and the rider app (Round 13): a fare estimate you can share (/fares?from=…&to=…&service=…) and the
 * "Book this ride" hand-off, which carries the same trip into the rider app, plus a friend's referral code (?ref=). Places travel
 * as "lat,lng,Name". Anything that doesn't look like a place in Australia, a known service or a referral code is ignored.
 */
export type LinkPlace = { name: string; lat: number; lng: number };
export const LINK_SERVICES = ['ride', 'pet', 'courier_s', 'courier_m', 'courier_l'] as const;
export type LinkService = (typeof LINK_SERVICES)[number];
export type TripLink = { from?: LinkPlace; to?: LinkPlace; service?: LinkService; ref?: string };

const round = (n: number) => Math.round(n * 1e5) / 1e5;

export function placeParam(p: LinkPlace) {
  return `${round(p.lat)},${round(p.lng)},${p.name.replace(/[\u0000-\u001f]/g, '').slice(0, 80)}`;
}

export function parsePlaceParam(v: string | null | undefined): LinkPlace | undefined {
  if (!v) return undefined;
  const m = /^(-?\d{1,2}(?:\.\d{1,7})?),(-?\d{1,3}(?:\.\d{1,7})?)(?:,(.*))?$/s.exec(v.trim());
  if (!m) return undefined;
  const lat = Number(m[1]); const lng = Number(m[2]);
  // Mainland Australia and Tasmania, roughly. Keeps junk and other countries out of the fare engine.
  if (!(lat <= -9 && lat >= -44 && lng >= 112 && lng <= 154)) return undefined;
  const name = (m[3] ?? '').replace(/[\u0000-\u001f<>]/g, '').trim().slice(0, 80) || 'Dropped pin';
  return { name, lat, lng };
}

export function tripLinkQuery(t: TripLink) {
  const p = new URLSearchParams();
  if (t.from) p.set('from', placeParam(t.from));
  if (t.to) p.set('to', placeParam(t.to));
  if (t.service) p.set('service', t.service);
  if (t.ref) p.set('ref', t.ref);
  const s = p.toString();
  return s ? `?${s}` : '';
}

export function parseTripLink(search: string): TripLink {
  const p = new URLSearchParams(search);
  const service = p.get('service');
  const ref = (p.get('ref') ?? '').trim().toUpperCase();
  return {
    from: parsePlaceParam(p.get('from')), to: parsePlaceParam(p.get('to')),
    service: (LINK_SERVICES as readonly string[]).includes(service ?? '') ? service as LinkService : undefined,
    ref: /^[A-Z0-9]{4,12}$/.test(ref) ? ref : undefined,
  };
}

const KEY = 'dg_handoff';
/** Rider app: keep what the link carried until the booking screen (or the sign-up form) uses it — it survives the sign-in step. */
export function saveHandoff(t: TripLink) {
  if (!t.from && !t.to && !t.service && !t.ref) return;
  try { sessionStorage.setItem(KEY, JSON.stringify({ ...readHandoff(), ...t })); } catch { /* private mode: the link just won't pre-fill */ }
}
export function readHandoff(): TripLink {
  try { return JSON.parse(sessionStorage.getItem(KEY) ?? '{}') ?? {}; } catch { return {}; }
}
/** Take the trip part (from/to/service) and leave the referral code for the sign-up form, or the other way round. */
export function takeHandoff(part: 'trip' | 'ref'): TripLink {
  const h = readHandoff();
  const rest: TripLink = part === 'trip' ? { ref: h.ref } : { from: h.from, to: h.to, service: h.service };
  try {
    if (rest.from || rest.to || rest.service || rest.ref) sessionStorage.setItem(KEY, JSON.stringify(rest)); else sessionStorage.removeItem(KEY);
  } catch { /* ignore */ }
  return part === 'trip' ? { from: h.from, to: h.to, service: h.service } : { ref: h.ref };
}
