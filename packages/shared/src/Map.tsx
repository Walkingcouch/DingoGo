import { useEffect, useMemo } from 'react';
import { MapContainer, TileLayer, Marker, Polyline, Circle, useMap, Tooltip } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

export const ALICE = { lat: -23.6980, lng: 133.8807 };
const env = (import.meta as any).env ?? {};
/** OSM tiles for development only. In production set VITE_TILE_URL to a commercial tile provider (MapTiler, Stadia, Mapbox). */
const TILE_URL = env.VITE_TILE_URL ?? 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
const TILE_ATTR = env.VITE_TILE_ATTR ?? '&copy; OpenStreetMap contributors';

export type Pt = { lat: number; lng: number };
export type MapMarker = Pt & { id: string; kind: 'pickup' | 'dropoff' | 'car' | 'car-busy' | 'car-off' | 'me' | 'sos' | 'partner'; label?: string; heading?: number | null; onClick?: () => void };

const COLORS: Record<string, string> = { pickup: '#4E7D5B', dropoff: '#14213D', car: '#E8912D', 'car-busy': '#7B5C8F', 'car-off': '#9AA0AE', me: '#2F6FED', sos: '#A63D2A', partner: '#B86A12' };

function icon(m: MapMarker) {
  const c = COLORS[m.kind];
  if (m.kind.startsWith('car')) {
    const rot = m.heading ?? 0;
    return L.divIcon({ className: '', iconSize: [34, 34], iconAnchor: [17, 17],
      html: `<div style="width:34px;height:34px;border-radius:50%;background:${c};border:3px solid #fff;box-shadow:0 2px 6px rgba(0,0,0,.35);display:grid;place-items:center">
        <svg width="16" height="16" viewBox="0 0 24 24" style="transform:rotate(${rot}deg)"><path fill="#fff" d="M12 2 L19 20 L12 16 L5 20 Z"/></svg></div>` });
  }
  if (m.kind === 'me') return L.divIcon({ className: '', iconSize: [20, 20], iconAnchor: [10, 10], html: `<div class="dg-pin" style="width:20px;height:20px;background:${c}"></div>` });
  if (m.kind === 'sos') return L.divIcon({ className: '', iconSize: [30, 30], iconAnchor: [15, 15], html: `<div class="dg-pin" style="width:30px;height:30px;background:${c};color:#fff;font:700 11px sans-serif;display:grid;place-items:center">SOS</div>` });
  const letter = m.kind === 'pickup' ? 'A' : m.kind === 'dropoff' ? 'B' : '☕';
  return L.divIcon({ className: '', iconSize: [30, 40], iconAnchor: [15, 38],
    html: `<svg width="30" height="40" viewBox="0 0 30 40"><path d="M15 39 C15 39 2 23 2 14 A13 13 0 0 1 28 14 C28 23 15 39 15 39Z" fill="${c}" stroke="#fff" stroke-width="2.5"/><text x="15" y="19" text-anchor="middle" font-family="sans-serif" font-weight="700" font-size="12" fill="#fff">${letter}</text></svg>` });
}

function Fit({ points, padding }: { points: Pt[]; padding: number }) {
  const map = useMap();
  const key = points.map((p) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`).join('|');
  useEffect(() => {
    if (!points.length) return;
    if (points.length === 1) map.setView([points[0].lat, points[0].lng], Math.max(map.getZoom(), 14));
    else map.fitBounds(L.latLngBounds(points.map((p) => [p.lat, p.lng] as [number, number])), { padding: [padding, padding], maxZoom: 15 });
  }, [key]); // eslint-disable-line
  return null;
}
function Clicks({ onClick }: { onClick?: (p: Pt) => void }) {
  const map = useMap();
  useEffect(() => {
    if (!onClick) return;
    const h = (e: L.LeafletMouseEvent) => onClick({ lat: e.latlng.lat, lng: e.latlng.lng });
    map.on('click', h);
    return () => { map.off('click', h); };
  }, [onClick, map]);
  return null;
}

export function DgMap({ markers = [], route, track, fit = true, padding = 60, zones, onMapClick, style, className, zoom = 13 }: {
  markers?: MapMarker[]; route?: Pt[] | null; track?: Pt[] | null; fit?: boolean; padding?: number;
  zones?: { lat: number; lng: number; radius_km: number; active: boolean; name: string }[];
  onMapClick?: (p: Pt) => void; style?: React.CSSProperties; className?: string; zoom?: number;
}) {
  const fitPts = useMemo(() => (fit ? [...markers.filter((m) => m.kind !== 'car-off'), ...(route ?? [])] : []), [fit, markers, route]);
  return (
    <MapContainer center={[ALICE.lat, ALICE.lng]} zoom={zoom} zoomControl={false} attributionControl style={{ width: '100%', height: '100%', ...style }} className={className}>
      <TileLayer url={TILE_URL} attribution={TILE_ATTR} />
      {zones?.map((z) => <Circle key={z.name} center={[z.lat, z.lng]} radius={z.radius_km * 1000} pathOptions={{ color: z.active ? '#E8912D' : '#9AA0AE', weight: 2, dashArray: z.active ? undefined : '6 6', fillOpacity: 0.04 }} />)}
      {track && track.length > 1 && <Polyline positions={track.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color: '#E8912D', weight: 5, opacity: 0.9 }} />}
      {route && route.length > 1 && <Polyline positions={route.map((p) => [p.lat, p.lng] as [number, number])} pathOptions={{ color: '#14213D', weight: 4, dashArray: '2 8', lineCap: 'round' }} />}
      {markers.map((m) => (
        <Marker key={m.id} position={[m.lat, m.lng]} icon={icon(m)} eventHandlers={m.onClick ? { click: m.onClick } : undefined}>
          {m.label && <Tooltip direction="top" offset={[0, -24]}>{m.label}</Tooltip>}
        </Marker>
      ))}
      {fit && <Fit points={fitPts} padding={padding} />}
      <Clicks onClick={onMapClick} />
    </MapContainer>
  );
}
