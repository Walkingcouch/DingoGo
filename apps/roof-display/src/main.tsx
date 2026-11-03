/**
 * DingoGo roof LED display player. Runs full-screen on the screen's controller (Android stick, Raspberry Pi kiosk, etc.).
 * URL: /?key=<vehicle display key>[&api=https://api.example]
 * - Polls the playlist every refresh_s, sends GPS if available so geofenced campaigns show in the right place.
 * - Rotates items by weight, each for its own `seconds`.
 * - Logs every play and uploads in batches every 60 s (kept in localStorage while offline).
 * - Caches the last playlist so screens keep working through mobile blackspots.
 * - mode "off" → screen stays dark. Never displays availability / "for hire" messaging (NT CPV rules).
 */
import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';

type Item = { id: string; headline: string; subline?: string | null; bg_colour: string; fg_colour: string; weight: number; seconds: number; advertiser?: string };
type Playlist = { vehicle: string; mode: 'ads' | 'off'; refresh_s?: number; items: Item[] };
type Play = { campaign_id: string; at: string; lat?: number; lng?: number; seconds: number };

const params = new URLSearchParams(location.search);
const KEY = params.get('key') ?? '';
const env = (import.meta as any).env ?? {};
const API = (params.get('api') ?? env.VITE_API_URL ?? `${location.protocol}//${location.hostname}:4000`).replace(/\/$/, '');
const CACHE = 'dingogo.roof.playlist';
const QUEUE = 'dingogo.roof.plays';
const BANNED = /\b(available|for hire|vacant|hail)\b/i; // defence in depth: never show availability messaging

const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* full or blocked */ } },
};

/** Weighted rotation: each item appears `weight` times per cycle, spread out so the same ad doesn't repeat back-to-back. */
function buildCycle(items: Item[]): Item[] {
  const safe = items.filter((i) => !BANNED.test(`${i.headline} ${i.subline ?? ''}`));
  const buckets = safe.map((i) => ({ i, left: Math.max(1, Math.min(10, i.weight || 1)) }));
  const out: Item[] = [];
  while (buckets.some((b) => b.left > 0)) {
    for (const b of buckets) if (b.left > 0) { out.push(b.i); b.left--; }
  }
  return out;
}

/** Shrinks a single-line headline until it fits the panel width. */
function Fit({ text }: { text: string }) {
  const ref = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    const fit = () => {
      el.style.fontSize = '';
      let size = parseFloat(getComputedStyle(el).fontSize);
      const max = el.parentElement!.clientWidth * 0.94;
      while (el.scrollWidth > max && size > 12) { size *= 0.94; el.style.fontSize = `${size}px`; }
    };
    fit();
    addEventListener('resize', fit);
    void document.fonts?.ready.then(fit);
    return () => removeEventListener('resize', fit);
  }, [text]);
  return <b ref={ref}>{text}</b>;
}

function Player() {
  const [pl, setPl] = useState<Playlist | null>(() => store.get<Playlist | null>(CACHE, null));
  const [idx, setIdx] = useState(0);
  const [online, setOnline] = useState(true);
  const pos = useRef<{ lat: number; lng: number } | null>(null);

  // GPS (optional)
  useEffect(() => {
    if (!navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition((p) => { pos.current = { lat: p.coords.latitude, lng: p.coords.longitude }; }, () => {}, { enableHighAccuracy: false, maximumAge: 30000 });
    return () => navigator.geolocation.clearWatch(id);
  }, []);

  // Playlist polling
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const load = async () => {
      let next = 120;
      try {
        const q = new URLSearchParams({ key: KEY });
        if (pos.current) { q.set('lat', String(pos.current.lat)); q.set('lng', String(pos.current.lng)); }
        const r = await fetch(`${API}/display/playlist?${q}`, { signal: AbortSignal.timeout(10000) });
        if (r.status === 403) { setPl({ vehicle: '', mode: 'off', items: [] }); store.set(CACHE, null); }
        else if (r.ok) { const j: Playlist = await r.json(); setPl(j); store.set(CACHE, j); next = j.refresh_s ?? 120; }
        setOnline(true);
      } catch { setOnline(false); next = 30; }
      t = setTimeout(load, next * 1000);
    };
    void load();
    return () => clearTimeout(t);
  }, []);

  // Upload plays every 60 s
  useEffect(() => {
    const flush = async () => {
      const q = store.get<Play[]>(QUEUE, []);
      if (!q.length) return;
      try {
        const r = await fetch(`${API}/display/plays`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-display-key': KEY }, body: JSON.stringify({ plays: q.slice(0, 500) }) });
        if (r.ok) store.set(QUEUE, store.get<Play[]>(QUEUE, []).slice(Math.min(q.length, 500)));
      } catch { /* retry next round */ }
    };
    const t = setInterval(flush, 60000);
    addEventListener('online', flush);
    return () => { clearInterval(t); removeEventListener('online', flush); };
  }, []);

  const cycle = useMemo(() => (pl?.mode === 'ads' ? buildCycle(pl.items) : []), [pl]);
  const cur = cycle.length ? cycle[idx % cycle.length] : null;

  // Advance + log play
  useEffect(() => {
    if (!cur) return;
    const t = setTimeout(() => {
      if (!cur.id.startsWith('house')) {
        const q = store.get<Play[]>(QUEUE, []);
        q.push({ campaign_id: cur.id, at: new Date().toISOString(), seconds: cur.seconds, ...(pos.current ?? {}) });
        store.set(QUEUE, q.slice(-5000));
      }
      setIdx((i) => i + 1);
    }, Math.max(3, cur.seconds) * 1000);
    return () => clearTimeout(t);
  }, [cur, idx]);

  if (!KEY) return <div className="setup">DingoGo roof display. Open this page with ?key=YOUR_DISPLAY_KEY (issued in the operations console under Fleet).</div>;
  if (!pl || pl.mode === 'off' || !cur) return <div aria-label="Display off" style={{ position: 'absolute', inset: 0, background: '#000' }} />;

  return (
    <>
      {cycle.map((it, i) => {
        const on = i === idx % cycle.length;
        return (
          <div key={`${it.id}-${i}`} className={'slide' + (it.id.startsWith('house') ? ' house' : '')} aria-hidden={!on}
            style={{ background: it.bg_colour, color: it.fg_colour, opacity: on ? 1 : 0 }}>
            <Fit text={it.headline} />
            {it.subline && <span>{it.subline}</span>}
          </div>
        );
      })}
      {!online && <div title="Offline: showing cached playlist" style={{ position: 'absolute', right: 6, bottom: 6, width: 8, height: 8, borderRadius: 4, background: '#E8912D', opacity: .7 }} />}
    </>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><Player /></React.StrictMode>);
