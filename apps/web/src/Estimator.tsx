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

const SERVICES = [
  { id: 'ride', label: 'Ride' },
  { id: 'pet', label: 'Ride with a pet' },
  { id: 'courier_s', label: 'Small parcel' },
  { id: 'courier_m', label: 'Medium parcel' },
  { id: 'courier_l', label: 'Large parcel' },
];

type Quote = { total_cents: number; gst_cents: number; distance_km: number; duration_min: number; lines: { label: string; cents: number }[] };

const TODD_MALL: Place = { name: 'Todd Mall', address: 'Todd Mall, Alice Springs NT 0870', lat: -23.6984, lng: 133.8822 };
const AIRPORT: Place = { name: 'Alice Springs Airport', address: 'Santa Teresa Rd, Alice Springs NT 0870', lat: -23.8067, lng: 133.9022 };

/** Alice Springs taxi tariffs (NT Government, from 22 May 2026): day $5.30 + $2.45/km; night & weekend $6.60 + $2.89/km. */
const isNightQuote = (q: { lines: { label: string }[] }) => q.lines.some((l) => l.label.startsWith('Late-night'));
const taxiEstimate = (km: number, night: boolean) => Math.round(night ? 660 + 289 * km : 530 + 245 * km);

export function Estimator({ initialService = 'ride', compact = false }: { initialService?: string; compact?: boolean }) {
  const [from, setFrom] = useState<Place | null>(TODD_MALL);
  const [to, setTo] = useState<Place | null>(AIRPORT);
  const [service, setService] = useState(initialService);
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

  const isRide = service === 'ride' || service === 'pet';
  const c = contact(useConfig());
  return (
    <section className="est" aria-label="Fare estimate">
      <div className="est-legs">
        <PlaceInput label="Pickup" letter="A" value={from} onChange={setFrom} />
        <PlaceInput label="Where to?" letter="B" value={to} onChange={setTo} />
      </div>
      <div className="seg" role="group" aria-label="Service">
        {SERVICES.filter((s) => !compact || s.id === 'ride' || s.id === 'pet' || s.id === 'courier_s').map((s) => (
          <button key={s.id} type="button" aria-pressed={service === s.id} onClick={() => setService(s.id)}>{s.label}</button>
        ))}
      </div>
      <div className="est-result" aria-live="polite" aria-busy={loading}>
        {error && <p className="dg-error">{error}</p>}
        {quote && !error && (
          <>
            <div className="est-total">
              <span>
                <span className="dg-muted">Estimated fare</span><br />
                <span style={{ fontSize: '.92rem' }}>{quote.distance_km} km, about {quote.duration_min} min</span>
              </span>
              <strong style={{ opacity: loading ? .5 : 1 }}>{money(quote.total_cents)}</strong>
            </div>
            <details>
              <summary style={{ cursor: 'pointer', fontSize: '.92rem', marginTop: 6 }}>How this price is made</summary>
              <ul className="est-lines">
                {quote.lines.filter((l) => l.cents !== 0).map((l) => <li key={l.label}><span>{l.label}</span><span>{money(l.cents)}</span></li>)}
                <li><span>Includes GST</span><span>{money(quote.gst_cents)}</span></li>
              </ul>
            </details>
            {isRide && inArea && (
              <p className="est-compare">
                A taxi on the {isNightQuote(quote) ? 'night' : 'day'} tariff for the same distance would be about <b>{money(taxiEstimate(quote.distance_km, isNightQuote(quote)))}</b> before waiting time and card surcharge. Both figures are estimates; your DingoGo price is fixed when you book.
              </p>
            )}
            {!inArea && <p className="dg-note" style={{ marginTop: 10 }}>That pickup is outside Alice Springs. We're starting in town first.</p>}
          </>
        )}
      </div>
      {!compact && (
        <div className="est-foot">
          <a className="dg-btn" href="#app">Book in the app</a>
          <a className="dg-btn dg-btn--ghost" href={`tel:${c.phone.replace(/\s/g, '')}`}>Book by phone</a>
        </div>
      )}
    </section>
  );
}
