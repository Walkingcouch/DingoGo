/**
 * Round 21: Android App Links for the rider app. A link to the website that Android hands to the app
 * (AndroidManifest.xml: https://<site>/track/… and /rider/…) becomes an in-app address:
 *   /track/<token>          → /track/<token>   (shared trip, no sign-in needed)
 *   /rider/<path>?from=…    → /<path>?from=…    (website "Book this ride", fare and invite links: the usual hand-off)
 * Anything else is ignored (the app stays where it is).
 */
const TRACK = /^\/track\/([a-z0-9_-]{8,80})\/?$/i;

export function appLinkRoute(href: string): string | null {
  let u: URL;
  try { u = new URL(href); } catch { return null; }
  if (u.protocol !== 'https:') return null;
  const t = u.pathname.match(TRACK);
  if (t) return `/track/${t[1]}`;
  if (/^\/rider(\/|$)/.test(u.pathname)) {
    const rest = u.pathname.replace(/^\/rider/, '') || '/';
    if (rest.includes('//') || rest.includes('..')) return null;
    return rest + u.search;
  }
  return null;
}

/** In the Android app: call `go` with the in-app address each time a website link opens the app (also the link that started it,
 *  which Capacitor keeps until this listener is added). Does nothing in a browser. Returns a function that stops listening. */
export function onAppLink(go: (route: string) => void): () => void {
  const c = typeof window !== 'undefined' ? (window as any).Capacitor : undefined;
  if (!c?.isNativePlatform?.() || !c.isPluginAvailable?.('App')) return () => undefined;
  const handle = c.Plugins.App.addListener('appUrlOpen', (e: { url: string }) => {
    const r = appLinkRoute(e.url);
    if (r) go(r);
  });
  return () => { void Promise.resolve(handle).then((h: any) => h?.remove?.()).catch(() => undefined); };
}
