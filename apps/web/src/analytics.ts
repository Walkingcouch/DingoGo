/**
 * Privacy-friendly analytics (Round 13), off unless VITE_ANALYTICS_DOMAIN is set at build time. Plausible-compatible: no cookies,
 * nothing stored on the device, no personal data. Honours Do Not Track. Paths go through `analyticsPath` (share-trip tokens,
 * status links and invite codes removed; only utm_* tags kept). Self-hosted Plausible or a proxy: VITE_ANALYTICS_SRC / _API.
 */
import { analyticsPath } from './seo';

const env = (import.meta as any).env ?? {};
const DOMAIN: string = env.VITE_ANALYTICS_DOMAIN || '';
const SRC: string = env.VITE_ANALYTICS_SRC || 'https://plausible.io/js/script.manual.js';
const API: string = env.VITE_ANALYTICS_API || '';

type Plausible = ((event: string, opts?: { u?: string; props?: Record<string, string> }) => void) & { q?: unknown[] };
declare global { interface Window { plausible?: Plausible } }

const dnt = () => typeof navigator !== 'undefined' && (navigator.doNotTrack === '1' || (window as any).doNotTrack === '1' || (navigator as any).globalPrivacyControl === true);
export const analyticsOn = () => !!DOMAIN && typeof window !== 'undefined' && !dnt();

let started = false;
function start() {
  if (started || !analyticsOn()) return started;
  started = true;
  window.plausible = window.plausible || (Object.assign((...a: unknown[]) => { (window.plausible!.q = window.plausible!.q || []).push(a); }, {}) as Plausible);
  const s = document.createElement('script');
  s.defer = true; s.src = SRC; s.dataset.domain = DOMAIN;
  if (API) s.dataset.api = API;
  document.head.appendChild(s);
  return true;
}

export function pageview(pathWithQuery: string) {
  if (!start()) return;
  window.plausible!('pageview', { u: location.origin + analyticsPath(pathWithQuery) });
}

/** Named events only, with small non-personal props (service, page). */
export function track(event: 'Book' | 'Share price' | 'Driver application' | 'Call' | 'Invite opened', props: Record<string, string> = {}) {
  if (!start()) return;
  window.plausible!(event, { u: location.origin + analyticsPath(location.pathname), props });
}
