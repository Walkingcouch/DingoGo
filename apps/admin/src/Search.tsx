import { forwardRef, useEffect, useId, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { get, dateTime, STATUS_LABEL } from '@dingogo/shared';
import { DRIVER_STATUS, ROLE, VEHICLE_STATUS, label } from './labels';

type Hit = { key: string; group: string; title: string; sub: string; to: string };

function toHits(r: any): Hit[] {
  const out: Hit[] = [];
  for (const t of r.trips ?? []) out.push({ key: 't' + t.id, group: 'Trips', title: `${t.ref} · ${STATUS_LABEL[t.status] ?? t.status}`, sub: `${t.rider_name}${t.driver_name ? `, driver ${t.driver_name}` : ''} · ${dateTime(t.requested_at)}`, to: `/trips?open=${t.id}` });
  for (const d of r.drivers ?? []) out.push({ key: 'd' + d.id, group: 'Drivers', title: d.name || d.phone, sub: [d.phone, d.rego, label(DRIVER_STATUS, d.status), d.online ? 'online' : ''].filter(Boolean).join(' · '), to: `/drivers?open=${d.id}` });
  for (const p of r.people ?? []) out.push({ key: 'p' + p.id, group: 'Riders and staff', title: p.name || p.phone, sub: [p.phone, label(ROLE, p.role), `${p.trips} trips`, p.blocked ? 'blocked' : ''].filter(Boolean).join(' · '), to: `/trips?q=${encodeURIComponent(p.phone)}` });
  for (const v of r.vehicles ?? []) out.push({ key: 'v' + v.id, group: 'Cars', title: v.rego, sub: [[v.colour, v.make, v.model].filter(Boolean).join(' '), v.owner_name, label(VEHICLE_STATUS, v.status)].filter(Boolean).join(' · '), to: v.driver_id ? `/drivers?open=${v.driver_id}` : `/trips?q=${encodeURIComponent(v.rego)}` });
  return out;
}

/** Search trips, drivers, riders and cars from anywhere: an ARIA combobox with grouped results. "/" focuses it (see Shortcuts). */
export const GlobalSearch = forwardRef<HTMLInputElement>(function GlobalSearch(_, ref) {
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [active, setActive] = useState(-1);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const nav = useNavigate();
  const id = useId();
  const seq = useRef(0);
  const wrap = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const s = q.trim();
    if (s.length < 2) { setHits(null); setActive(-1); return; }
    const n = ++seq.current;
    setBusy(true);
    const t = setTimeout(() => {
      get(`/admin/search?q=${encodeURIComponent(s)}`)
        .then((r) => { if (n === seq.current) { setHits(toHits(r)); setActive(-1); setOpen(true); } })
        .catch(() => { if (n === seq.current) setHits([]); })
        .finally(() => { if (n === seq.current) setBusy(false); });
    }, 250);
    return () => clearTimeout(t);
  }, [q]);
  useEffect(() => {
    const out = (e: MouseEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', out);
    return () => document.removeEventListener('mousedown', out);
  }, []);

  const go = (h: Hit) => { setOpen(false); setQ(''); setHits(null); nav(h.to); };
  const list = open && hits !== null;
  const groups = hits ? [...new Set(hits.map((h) => h.group))] : [];
  return (
    <div className="gsearch" ref={wrap} role="search">
      <label htmlFor={`${id}-in`} className="sr-only">Search trips, drivers, riders and cars</label>
      <input id={`${id}-in`} ref={ref} className="dg-input gsearch__in" type="search" autoComplete="off" value={q}
        placeholder="Search ref, phone, name or rego  ( / )"
        role="combobox" aria-expanded={list} aria-controls={`${id}-list`} aria-autocomplete="list"
        aria-activedescendant={list && active >= 0 ? `${id}-o${active}` : undefined}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        onFocus={() => hits && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && hits?.length) { e.preventDefault(); setOpen(true); setActive((a) => (a + 1) % hits.length); }
          else if (e.key === 'ArrowUp' && hits?.length) { e.preventDefault(); setActive((a) => (a <= 0 ? hits.length - 1 : a - 1)); }
          else if (e.key === 'Enter' && hits?.length) { e.preventDefault(); go(hits[Math.max(active, 0)]); }
          else if (e.key === 'Escape') { if (open && hits) { e.preventDefault(); setOpen(false); } else if (q) { e.preventDefault(); setQ(''); } else (e.target as HTMLInputElement).blur(); }
        }} />
      <span className="sr-only" role="status" aria-live="polite">{busy ? '' : hits === null ? '' : hits.length ? `${hits.length} results. Use the up and down arrows to choose.` : 'No results'}</span>
      {list && (
        <div className="gsearch__pop" id={`${id}-list`} role="listbox" aria-label="Search results">
          {!hits!.length && <div className="gsearch__none" role="presentation">Nothing found for “{q.trim()}”. Try a trip ref, phone or rego.</div>}
          {groups.map((g) => (
            <div key={g} role="group" aria-label={g}>
              <div className="gsearch__group" role="presentation">{g}</div>
              {hits!.map((h, i) => h.group !== g ? null : (
                <div key={h.key} id={`${id}-o${i}`} role="option" aria-selected={i === active} className={'gsearch__opt' + (i === active ? ' on' : '')}
                  onMouseDown={(e) => e.preventDefault()} onClick={() => go(h)} onMouseEnter={() => setActive(i)}>
                  <strong>{h.title}</strong><span>{h.sub}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
});
