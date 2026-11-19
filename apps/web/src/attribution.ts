/**
 * Where a visitor came from (first page of this visit): utm tags if the link had them, else the referring site's host. Kept in
 * sessionStorage only (gone when the tab closes), and sent with a driver application so ops can see which ads work.
 */
const KEY = 'dg_src';
export function captureSource() {
  try {
    if (sessionStorage.getItem(KEY)) return;
    const p = new URLSearchParams(location.search);
    const utm = [p.get('utm_source'), p.get('utm_campaign')].filter(Boolean).join(' / ');
    let ref = '';
    try { const h = document.referrer ? new URL(document.referrer).host : ''; if (h && h !== location.host) ref = h.replace(/^www\./, ''); } catch { /* bad referrer */ }
    sessionStorage.setItem(KEY, (utm || ref || 'direct').slice(0, 80));
  } catch { /* storage blocked */ }
}
export function source(): string | undefined {
  try { return sessionStorage.getItem(KEY) || undefined; } catch { return undefined; }
}
