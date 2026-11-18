import type { MouseEvent, ReactNode } from 'react';
import { assetUrl, get } from './api';

/** Name of an upload from `/uploads/<name>` (plain or signed). */
const nameOf = (path: string) => /\/uploads\/([^/?#]+)/.exec(path)?.[1] ?? null;
/** Signed links carry `exp` (unix seconds). Null when the link isn't signed. */
const expiryOf = (path: string) => {
  const m = /[?&]exp=(\d+)/.exec(path);
  return m ? Number(m[1]) * 1000 : null;
};

/**
 * Link to an uploaded file. Driver documents and delivery photos come from the API as short-lived signed links;
 * if the page has been open long enough for the link to lapse, a fresh one is fetched before opening it.
 */
export function FileLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  const onClick = async (e: MouseEvent<HTMLAnchorElement>) => {
    const exp = expiryOf(href);
    const name = nameOf(href);
    if (exp == null || !name || exp - Date.now() > 60_000) return; // not signed, or still good
    e.preventDefault();
    const w = window.open('', '_blank'); // open now, while we still have the click (pop-up blockers)
    if (w) w.opener = null;
    try {
      const r = await get<{ url: string }>(`/uploads/${encodeURIComponent(name)}/link`);
      if (w) w.location.href = assetUrl(r.url); else window.location.href = assetUrl(r.url);
    } catch {
      w?.close();
      window.alert('Couldn’t open the file. Reload the page and try again.');
    }
  };
  return <a className={className} href={assetUrl(href)} target="_blank" rel="noreferrer" onClick={onClick}>{children}</a>;
}
