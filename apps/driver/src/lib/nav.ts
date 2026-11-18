import type { NavApp } from './prefs';

export const NAV_APPS: { key: NavApp; label: string }[] = [
  { key: 'google', label: 'Google Maps' },
  { key: 'waze', label: 'Waze' },
  { key: 'apple', label: 'Apple Maps' },
];
export const navLabel = (k: NavApp) => NAV_APPS.find((a) => a.key === k)?.label ?? 'Maps';

/** Turn-by-turn directions to a point in the driver's navigation app. Universal links: they open the app when it's installed
 *  (Android and iPhone) and the website when it isn't. */
export function navUrl(app: NavApp, lat: number, lng: number) {
  const ll = `${lat.toFixed(6)},${lng.toFixed(6)}`;
  if (app === 'waze') return `https://waze.com/ul?ll=${ll}&navigate=yes`;
  if (app === 'apple') return `https://maps.apple.com/?daddr=${ll}&dirflg=d`;
  return `https://www.google.com/maps/dir/?api=1&destination=${ll}&travelmode=driving`;
}
