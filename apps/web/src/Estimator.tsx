import { useEffect, useId, useRef, useState } from 'react';
import { ApiError, get, money, post } from '@dingogo/shared';
import { contact, useConfig } from './config';

export type Place = { name: string; address: string; lat: number; lng: number };

/** Accessible combobox over the API's Alice Springs place list. */
export function PlaceInput({ label, letter, value, onChange }: { label: string; letter: 'A' | 'B'; value: Place | null; onChange: (p: Place) => void }) {
  const id = useId();
  const [text, setText] = useState(value?.name ?? '');
  const [items, setItems] = useState<Place[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => { setText(value?.name ?? ''); }, [value?.name]);
  useEffect(() => {
    if (!open) return;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      get<{ places: Place[] }>(`/public/places?q=${encodeURIComponent(text === value?.name ? '' : text)}`)
        .then((r) => { setItems(r.places); setActive(0); }).catch(() => setItems([]));
    }, 150);
  }, [text, open]); // eslint-disable-line

  const pick = (p: Place) => { onChange(p); setText(p.name); setOpen(false); };
  return (
    <div className="place">
      <div className="place-row">
        <span className={`place-dot ${letter.toLowerCase()}`} aria-hidden="true">{letter}</span>
        <label className="sr-only" htmlFor={id}>{label}</label>
        <input id={id} className="dg-input" placeholder={label} value={text} autoComplete="off"
          role="combobox" aria-expanded={open && items.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list"
          aria-activedescendant={open && items[active] ? `${id}-o${active}` : undefined}
          onFocus={(e) => { setOpen(true); e.currentTarget.select(); }}
          onBlur={() => setTimeout(() => setOpen(false), 150)}
          onChange={(e) => { setText(e.target.value); setOpen(true); }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') { e.preventDefault(); setActive((a) => Math.min(a + 1, items.length - 1)); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
            else if (e.key === 'Enter' && open && items[active]) { e.preventDefault(); pick(items[active]); }
            else if (e.key === 'Escape') setOpen(false);
          }} />
      </div>
      {open && items.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="place-list">
          {items.map((p, i) => (
            <li key={p.name} id={`${id}-o${i}`} role="option" aria-selected={i === active} onMouseDown={(e) => { e.preventDefault(); pick(p); }}>
              {p.name}<small>{p.address}</small>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const MODES = [
  { id: 'ride', label: 'Ride' },
  { id: 'pet', label: 'With a pet' },
  { id: 'parcel', label: 'Parcel' },
] as const;
const SIZES = [
  { id: 'courier_s', label: 'Small', hint: 'satchel, up to 5 kg' },
  { id: 'courier_m', label: 'Medium', hint: 'box, up to 15 kg' },
  { id: 'courier_l', label: 'Large', hint: 'up to 25 kg' },
];

type Quote = { total_cents: number; gst_cents: number; distance_km: number; duration_min: number; lines: { label: string; cents: number }[] };

export const TODD_MALL: Place = { name: 'Todd Mall', address: 'Todd Mall, Alice Springs NT 0870', lat: -23.6984, lng: 133.8822 };
export const AIRPORT: Place = { name: 'Alice Springs Airport', address: 'Santa Teresa Rd, Alice Springs NT 0870', lat: -23.8067, lng: 133.9022 };

/** Where "Book" goes: the live rider web app (same site in production). */
const env = (import.meta as any).env ?? {};
export const RIDER_URL: string = env.VITE_RIDER_URL || '/rider/';
/** Android test builds (GitHub release "android-latest"). Swap for the Google Play listing once published. */
export const ANDROID_RIDER_APK = 'https://github.com/Walkingcouch/DingoGo/releases/download/android-latest/dingogo-rider.apk';
export const ANDROID_DRIVER_APK = 'https://github.com/Walkingcouch/DingoGo/releases/download/android-latest/dingogo-driver.apk';

/** Alice Springs taxi tariffs (NT Government, from 22 May 2026): day $5.30 + $2.45/km; night & weekend $6.60 + $2.89/km. */
const isNightQuote = (q: { lines: { label: string }[] }) => q.lines.some((l) => l.label.startsWith('Late-night'));
const taxiEstimate = (km: number, night: boolean) => Math.round(night ? 660 + 289 * km : 530 + 245 * km);

export function Estimator({ initialService = 'ride', compact = false }: { initialService?: string; compact?: boolean }) {
  const [from, setFrom] = useState<Place | null>(TODD_MALL);
  const [to, setTo] = useState<Place | null>(AIRPORT);
  const initialMode = initialService.startsWith('courier') ? 'parcel' : initialService === 'pet' ? 'pet' : 'ride';
  const [mode, setMode] = useState<'ride' | 'pet' | 'parcel'>(initialMode);
  const [size, setSize] = useState(initialService.startsWith('courier') ? initialService : 'courier_s');
  const service = mode === 'parcel' ? size : mode;
  const [quote, setQuote] = useState<Quote | null>(null);
  const [inArea, setInArea] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!from || !to) return;
    let stale = false;
    setLoading(true);
    post<{ quote: Quote; in_service_area: boolean }>('/public/estimate', { service, pickup: from, dropoff: to })
      .then((r) => { if (!stale) { setQuote(r.quote); setInArea(r.in_service_area); setError(null); } })
      .catch((e) => { if (!stale) setError(e instanceof ApiError ? e.message : 'Price unavailable right now'); })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [from, to, service]);

  const isRide = mode !== 'parcel';
  const c = contact(useConfig());
  const swap = () => { const f = from; setFrom(to); setTo(f); };
  return (
    <section className={`est${compact ? ' est--compact' : ''}`} aria-label="Fare estimate">
      <div className="est-tabs" role="group" aria-label="What are you booking?">
        {MODES.map((m) => (
          <button key={m.id} type="button" aria-pressed={mode === m.id} onClick={() => setMode(m.id)}>{m.label}</button>
        ))}
      </div>
      <div className="est-legs">
        <PlaceInput label="Pickup" letter="A" value={from} onChange={setFrom} />
        <PlaceInput label={mode === 'parcel' ? 'Deliver to' : 'Where to?'} letter="B" value={to} onChange={setTo} />
        <button type="button" className="est-swap" onClick={swap} aria-label="Swap pickup and destination">⇅</button>
      </div>
      {mode === 'parcel' && (
        <div className="est-sizes" role="group" aria-label="Parcel size">
          {SIZES.map((s) => (
            <button key={s.id} type="button" aria-pressed={size === s.id} onClick={() => setSize(s.id)}>
              <b>{s.label}</b><small>{s.hint}</small>
            </button>
          ))}
        </div>
      )}
      <div className="est-result" aria-live="polite" aria-busy={loading}>
        {error && <p className="dg-error">{error}</p>}
        {!quote && !error && <p className="dg-muted est-wait">Working out your price…</p>}
        {quote && !error && (
          <>
            <div className="est-total">
              <div>
                <span className="est-label">{isRide ? 'Your fixed price' : 'Delivery price'}</span>
                <span className="est-meta">{quote.distance_km} km, about {quote.duration_min} min, GST included</span>
              </div>
              <strong key={quote.total_cents} className="est-price" style={{ opacity: loading ? .45 : 1 }}>{money(quote.total_cents)}</strong>
            </div>
            <details className="est-why">
              <summary>How this price is made</summary>
              <ul className="est-lines">
                {quote.lines.filter((l) => l.cents !== 0).map((l) => <li key={l.label}><span>{l.label}</span><span>{money(l.cents)}</span></li>)}
                <li><span>Includes GST</span><span>{money(quote.gst_cents)}</span></li>
              </ul>
            </details>
            {isRide && inArea && (
              <p className="est-compare">
                A taxi on the {isNightQuote(quote) ? 'night' : 'day'} tariff would be about <b>{money(taxiEstimate(quote.distance_km, isNightQuote(quote)))}</b> for this distance, before waiting time and card surcharge.
              </p>
            )}
            {!inArea && <p className="dg-note" style={{ marginTop: 10 }}>That pickup is outside Alice Springs. We're starting in town first.</p>}
          </>
        )}
      </div>
      <div className="est-foot">
        <a className="dg-btn est-book" href={RIDER_URL}>{mode === 'parcel' ? 'Send this parcel' : 'Book this ride'}</a>
        {!compact && <a className="dg-btn dg-btn--ghost" href={`tel:${c.phone.replace(/\s/g, '')}`}>Call {c.phone}</a>}
      </div>
    </section>
  );
}
