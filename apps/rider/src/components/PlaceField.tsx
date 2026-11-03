import { useEffect, useId, useRef, useState } from 'react';
import { get } from '@dingogo/shared';

export type Place = { lat: number; lng: number; address: string };
type Hit = { name: string; address: string; lat: number; lng: number };

/** Address field with Alice Springs place search. Combobox pattern, keyboard-friendly. */
export function PlaceField({ label, value, onChange, dot, onFocusField, active, placeholder }: {
  label: string; value: Place | null; onChange: (p: Place | null) => void; dot: 'A' | 'B';
  onFocusField?: () => void; active?: boolean; placeholder: string;
}) {
  const id = useId();
  const [text, setText] = useState(value?.address ?? '');
  const [hits, setHits] = useState<Hit[]>([]);
  const [open, setOpen] = useState(false);
  const [hi, setHi] = useState(0);
  const timer = useRef<any>();

  useEffect(() => { setText(value?.address ?? ''); }, [value?.address, value?.lat]);

  function search(q: string) {
    clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      try { const r = await get<{ places: Hit[] }>(`/places/search?q=${encodeURIComponent(q)}`); setHits(r.places); setHi(0); } catch { setHits([]); }
    }, 150);
  }
  function pick(h: Hit) {
    onChange({ lat: h.lat, lng: h.lng, address: h.name });
    setText(h.name); setOpen(false);
  }

  return (
    <div className={`place ${active ? 'is-active' : ''}`}>
      <span className={`place__dot place__dot--${dot}`} aria-hidden="true">{dot}</span>
      <label htmlFor={id} className="sr-only">{label}</label>
      <input id={id} className="place__input" placeholder={placeholder} value={text} autoComplete="off"
        role="combobox" aria-expanded={open && hits.length > 0} aria-controls={`${id}-list`} aria-autocomplete="list"
        onFocus={() => { onFocusField?.(); setOpen(true); search(text === value?.address ? '' : text); }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onChange={(e) => { setText(e.target.value); setOpen(true); search(e.target.value); if (!e.target.value) onChange(null); }}
        onKeyDown={(e) => {
          if (!open || !hits.length) return;
          if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(h + 1, hits.length - 1)); }
          if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
          if (e.key === 'Enter') { e.preventDefault(); pick(hits[hi]); }
          if (e.key === 'Escape') setOpen(false);
        }} />
      {value && <button type="button" className="place__clear" aria-label={`Clear ${label.toLowerCase()}`} onClick={() => { onChange(null); setText(''); }}>×</button>}
      {open && hits.length > 0 && (
        <ul id={`${id}-list`} role="listbox" className="place__list">
          {hits.map((h, i) => (
            <li key={h.name} role="option" aria-selected={i === hi} className={i === hi ? 'is-hi' : ''} onMouseDown={(e) => { e.preventDefault(); pick(h); }}>
              <strong>{h.name}</strong><span>{h.address}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
