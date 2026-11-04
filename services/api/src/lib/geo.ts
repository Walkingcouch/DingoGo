import { config } from '../config.js';

export interface LatLng { lat: number; lng: number }

const R = 6371e3;
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance in metres. */
export function haversine(a: LatLng, b: LatLng): number {
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export interface Route { distance_m: number; duration_s: number; source: 'osrm' | 'ors' | 'estimate'; geometry?: [number, number][] }

/**
 * Road distance/time. Uses OSRM when OSRM_URL is configured (self-hosted recommended),
 * otherwise a calibrated estimate: straight-line × 1.3 road factor; 38 km/h in town, 90 km/h for long legs.
 */
let lastErr = '';
export const lastRouteError = () => lastErr;

const cache = new Map<string, { at: number; r: Route }>();

export async function route(a: LatLng, b: LatLng): Promise<Route> {
  // Cache by ~10 m grid for 10 minutes: quotes are re-requested often and the free routing plan is capped per day.
  const k = [a.lat, a.lng, b.lat, b.lng].map((n) => n.toFixed(4)).join(',');
  const hit = cache.get(k);
  if (hit && Date.now() - hit.at < 600_000) return hit.r;
  const r = await routeUncached(a, b);
  if (r.source !== 'estimate') { if (cache.size > 2000) cache.clear(); cache.set(k, { at: Date.now(), r }); }
  return r;
}

async function routeUncached(a: LatLng, b: LatLng): Promise<Route> {
  if (!config.osrmUrl && config.orsKey) {
    try {
      const url = `https://api.openrouteservice.org/v2/directions/driving-car?start=${a.lng},${a.lat}&end=${b.lng},${b.lat}`;
      const res = await fetch(url, { headers: { Authorization: config.orsKey, Accept: 'application/geo+json' }, signal: AbortSignal.timeout(3000) });
      if (!res.ok) lastErr = `ors ${res.status}: ${(await res.text()).slice(0, 200)}`;
      if (res.ok) {
        const j: any = await res.json();
        const f = j.features?.[0];
        const sum = f?.properties?.summary;
        if (f && sum && sum.distance != null) return {
          distance_m: Math.round(sum.distance), duration_s: Math.round(sum.duration ?? 0), source: 'ors',
          geometry: f.geometry?.coordinates?.map(([lng, lat]: number[]) => [lat, lng]),
        };
      }
    } catch (e) { lastErr = `ors ${(e as Error).message}`; }
  }
  if (config.osrmUrl) {
    try {
      const url = `${config.osrmUrl}/route/v1/driving/${a.lng},${a.lat};${b.lng},${b.lat}?overview=simplified&geometries=geojson`;
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (res.ok) {
        const j: any = await res.json();
        const r = j.routes?.[0];
        if (r) return {
          distance_m: Math.round(r.distance), duration_s: Math.round(r.duration), source: 'osrm',
          geometry: r.geometry?.coordinates?.map(([lng, lat]: number[]) => [lat, lng]),
        };
      }
    } catch { /* fall through to estimate */ }
  }
  const straight = haversine(a, b);
  const distance_m = Math.round(Math.max(straight * 1.3, 300));
  const kmh = distance_m > 15000 ? 90 : 38;
  const duration_s = Math.round((distance_m / 1000 / kmh) * 3600 + 60);
  return { distance_m, duration_s, source: 'estimate' };
}

export function withinZone(p: LatLng, z: { centre_lat: number; centre_lng: number; radius_km: number }) {
  return haversine(p, { lat: z.centre_lat, lng: z.centre_lng }) <= z.radius_km * 1000;
}
