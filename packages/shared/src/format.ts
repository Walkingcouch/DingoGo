export const money = (cents?: number | null, opts: { free?: boolean } = {}) =>
  cents == null ? '—' : cents === 0 && opts.free ? 'Free' : (cents < 0 ? '−' : '') + '$' + (Math.abs(cents) / 100).toFixed(2);

const TZ = 'Australia/Darwin';
export const time = (d?: string | Date | null) => (d ? new Date(d).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit', timeZone: TZ }) : '—');
export const date = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }) : '—');
export const dateTime = (d?: string | Date | null) => (d ? `${date(d)}, ${time(d)}` : '—');
export const dayName = (d?: string | Date | null) => (d ? new Date(d).toLocaleDateString('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: TZ }) : '—');
export const km = (m?: number | null) => (m == null ? '—' : `${(m / 1000).toFixed(1)} km`);
export const mins = (s?: number | null) => (s == null ? '—' : `${Math.max(1, Math.round(s / 60))} min`);
export function ago(d?: string | Date | null) {
  if (!d) return '—';
  const s = (Date.now() - new Date(d).getTime()) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return date(d);
}

export const STATUS_LABEL: Record<string, string> = {
  scheduled: 'Scheduled', requested: 'Finding a driver', accepted: 'Driver on the way', arrived: 'Driver has arrived',
  in_progress: 'On the way', completed: 'Completed', cancelled_rider: 'Cancelled', cancelled_driver: 'Cancelled by driver',
  cancelled_admin: 'Cancelled by DingoGo', no_drivers: 'No drivers available',
};
export const COURIER_STATUS_LABEL: Record<string, string> = {
  ...STATUS_LABEL, accepted: 'Driver heading to pickup', arrived: 'Driver at pickup', in_progress: 'Parcel on its way', completed: 'Delivered',
};
export const statusTone = (s: string) =>
  s === 'completed' ? 'green' : s.startsWith('cancelled') || s === 'no_drivers' ? 'red' : s === 'scheduled' ? '' : 'ochre';

export const SERVICE_ICON: Record<string, string> = { ride: '🚗', pet: '🐕', courier_s: '📦', courier_m: '📦', courier_l: '📦', tour: '🏜️', hourly: '🎉' };
export const initials = (name?: string) => (name ?? '?').split(/\s+/).map((p) => p[0]).slice(0, 2).join('').toUpperCase();
