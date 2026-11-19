import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, VISITOR_LANGS, get, money, post, saveVisitorLang, savedVisitorLang, tv, useLoad, visitorIsMachine, visitorLangName, type VisitorLang } from '@dingogo/shared';
import { PlaceField, type Place } from '../components/PlaceField';
import { useMe } from '../ctx';

/** Round 19: tours with their itinerary and protocols, start times from availability, heat and closure advisories, outback
 *  safety, hotel pickups, the deposit and the 48-hour terms, in a visitor language (machine translation, flagged). */
const dayLabel = (d: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
const hours = (m: number) => (m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);
const REASON: Record<string, string> = { tour_too_soon: 'Too soon', heat_advisory: 'Heat', tour_closed: 'Closed', tour_out_of_season: 'Not this month', tour_not_that_day: 'Not this day' };

export function ToursPanel({ pickup, setPickup, onFocusPickup, payMethod }: { pickup: Place | null; setPickup: (p: Place | null) => void; onFocusPickup: () => void; payMethod: string }) {
  const [lang, setLangState] = useState<VisitorLang>(savedVisitorLang());
  const setLang = (l: VisitorLang) => { setLangState(l); saveVisitorLang(l); };
  const { data, error, loading } = useLoad(() => get<any>(`/tours?lang=${lang}`), [lang]);
  const { reload } = useMe();
  const nav = useNavigate();
  const [selId, setSelId] = useState<string | null>(null);
  const sel = data?.tours.find((t: any) => t.id === selId) ?? null;
  const [guests, setGuests] = useState(2);
  const detail = useLoad(() => (sel ? get<any>(`/public/tours/${sel.slug}?lang=${lang}&guests=${guests}`) : Promise.resolve(null)), [sel?.slug, lang, guests]);
  const avail = useLoad(() => (sel ? get<any>(`/public/tours/${sel.slug}/availability?days=28`) : Promise.resolve(null)), [sel?.slug]);
  const [day, setDay] = useState<string | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const cfg = useLoad(() => get('/public/config'), []);
  const cashRide = !!cfg.data?.cash_payments?.ride;
  const [pay, setPay] = useState<'card' | 'cash' | 'wallet'>(payMethod === 'cash' && cashRide ? 'cash' : 'card');
  const pm = useLoad(() => get('/payment-methods'), []);
  const cardsOff = pm.data?.cards?.mode === 'off';
  useEffect(() => { if (cardsOff && pay === 'card') setPay('wallet'); }, [cardsOff]); // eslint-disable-line react-hooks/exhaustive-deps
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const days = useMemo(() => (avail.data?.days ?? []).filter((d: any) => d.times.some((t: any) => t.ok) || d.advisories.length), [avail.data]);
  useEffect(() => { setDay(null); setTime(null); }, [selId]);
  useEffect(() => { if (!day && days.length) setDay(days.find((d: any) => d.times.some((t: any) => t.ok))?.date ?? null); }, [days, day]);
  const today = days.find((d: any) => d.date === day);
  const terms = data?.terms;

  async function book() {
    if (!sel || !pickup || !day || !time) return;
    setBusy(true); setErr(null);
    try {
      const r = await post('/trips', {
        kind: 'ride', service: 'tour', tour_package_id: sel.id, pickup, dropoff: pickup, scheduled_for: new Date(`${day}T${time}:00+09:30`).toISOString(),
        passengers: guests, payment_method: pay,
      });
      void reload();
      nav(`/trips/${r.trip.id}`);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not book the tour'); }
    finally { setBusy(false); }
  }

  const langPicker = (
    <label className="dg-field" style={{ maxWidth: 220 }}><span>{tv('language', lang)}</span>
      <select className="dg-select" value={lang} onChange={(e) => setLang(e.target.value as VisitorLang)}>
        {VISITOR_LANGS.map((l) => <option key={l} value={l}>{visitorLangName(l)}</option>)}
      </select></label>
  );
  const machine = visitorIsMachine(lang) && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }} role="note">{tv('machine_note', lang)}</p>;
  const advisories = (data?.advisories ?? []).filter((a: any) => !sel || !a.tour_ids?.length || a.tour_ids.includes(sel.id));

  if (loading) return <p className="dg-muted">Loading tours…</p>;
  if (error) return <p className="dg-error">{error}</p>;
  if (!sel) {
    return (
      <div className="tours">
        {langPicker}{machine}
        <p className="dg-muted" style={{ marginTop: 0 }}>{tv('tours_intro', lang)}</p>
        {advisories.map((a: any) => <div key={a.id} className="callout callout--earth" role="status"><strong>{a.title}.</strong> {a.message}</div>)}
        {data!.tours.map((t: any) => (
          <button key={t.id} className="tour" onClick={() => setSelId(t.id)}>
            <span className="tour__top"><strong>{t.name}</strong><span className="dg-money">{money(t.price_cents + t.guide_fee_cents)}</span></span>
            <span className="tour__sum">{t.summary}</span>
            <span className="tour__meta">
              <span className="dg-chip">{hours(t.duration_min)}</span>
              <span className="dg-chip">{tv('up_to_guests', lang, { n: t.max_passengers })}</span>
              {t.guided_by === 'aboriginal_guide' && <span className="dg-chip dg-chip--ochre">{tv('aboriginal_guide', lang)}</span>}
              {t.requires_permit && <span className="dg-chip dg-chip--ochre">Park fees may apply</span>}
            </span>
          </button>
        ))}
      </div>
    );
  }
  const total = sel.price_cents + sel.guide_fee_cents + 100;
  const depositPct = sel.deposit_pct ?? terms?.deposit_pct ?? 0;
  return (
    <div className="tours">
      <button className="linkbtn" onClick={() => setSelId(null)}>All tours</button>
      {langPicker}{machine}
      <h2 style={{ fontSize: 'var(--fs-xl)', marginTop: '.4rem' }}>{sel.name}</h2>
      <p>{sel.description}</p>
      {sel.guided_by === 'aboriginal_guide' && <p><span className="dg-chip dg-chip--ochre">{tv('aboriginal_guide', lang)}</span> Your guide is paid {money(sel.guide_fee_cents)} in full.</p>}
      <h3 style={{ fontSize: 'var(--fs-md)' }}>{tv('stops', lang)}</h3>
      <ol className="tour-stops">
        {sel.itinerary.map((s: any) => (
          <li key={s.name}><strong>{s.name}</strong> <span className="dg-muted">about {s.minutes} min</span>
            {s.note && <><br /><span>{s.note}</span></>}
            {s.protocols?.length > 0 && <ul className="dg-muted" style={{ fontSize: 'var(--fs-sm)', margin: '.2rem 0 0' }}>{s.protocols.map((p: string) => <li key={p}>{sel.protocols[p]}</li>)}</ul>}
          </li>
        ))}
      </ol>
      {sel.cultural_note && <div className="callout callout--earth"><strong>{tv('respect_country', lang)}.</strong> {sel.cultural_note}</div>}
      {advisories.map((a: any) => <div key={a.id} className="callout callout--earth" role="status"><strong>{a.title}.</strong> {a.message}</div>)}

      <label className="dg-field" style={{ marginTop: '1rem' }}><span>{tv('guests', lang)}</span>
        <select className="dg-select" value={guests} onChange={(e) => setGuests(Number(e.target.value))}>
          {Array.from({ length: sel.max_passengers }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
        </select></label>
      <label className="dg-field"><span>{tv('date', lang)}</span>
        <select className="dg-select" value={day ?? ''} onChange={(e) => { setDay(e.target.value); setTime(null); }}>
          {!days.length && <option value="">No dates in the next 4 weeks</option>}
          {days.map((d: any) => <option key={d.date} value={d.date}>{dayLabel(d.date)}{d.times.some((t: any) => t.ok) ? '' : ` (${d.advisories[0]?.title ?? 'not available'})`}</option>)}
        </select></label>
      {today && (
        <fieldset className="dg-field"><legend>{tv('start_time', lang)}</legend>
          <div className="row" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {today.times.map((t: any) => (
              <button key={t.time} type="button" className={`dg-btn dg-btn--sm ${time === t.time ? 'dg-btn--dark' : 'dg-btn--ghost'}`} disabled={!t.ok}
                aria-pressed={time === t.time} onClick={() => setTime(t.time)}>{t.time}{!t.ok && ` (${REASON[t.reason] ?? 'unavailable'})`}</button>
            ))}
          </div>
          {today.advisories.map((a: any) => <p key={a.id} className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>{a.title}: {a.message}</p>)}
        </fieldset>
      )}
      <div className="places" style={{ marginTop: '.6rem' }}>
        <PlaceField label={tv('pickup', lang)} dot="A" value={pickup} onChange={setPickup} placeholder="Where should we collect you?" active onFocusField={onFocusPickup} />
      </div>
      {detail.data?.pickups?.length > 0 && (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '.4rem 0' }} aria-label={tv('pickup_hotel', lang)}>
          {detail.data.pickups.map((h: any) => <button key={h.id} type="button" className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => setPickup({ lat: h.lat, lng: h.lng, address: h.address ?? h.name } as Place)}>{h.name}</button>)}
        </div>
      )}
      <label className="dg-field"><span>Pay with</span>
        <select className="dg-select" value={pay} onChange={(e) => setPay(e.target.value as any)}>
          {!cardsOff && <option value="card">Card{depositPct > 0 ? ` (${depositPct}% deposit now)` : ''}</option>}
          <option value="wallet">DingoGo credit (paid now)</option>{cashRide && <option value="cash">Cash on the day</option>}
        </select></label>
      <p className="quote__total dg-money" style={{ margin: '.2rem 0 .3rem' }}>{money(total)} <small className="dg-muted" style={{ fontSize: 'var(--fs-sm)', fontWeight: 400 }}>incl. GST and $1 NT passenger levy</small></p>
      {pay === 'card' && depositPct > 0 && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)', margin: 0 }}>{tv('deposit_now', lang, { pct: depositPct })}</p>}
      {terms && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>{tv('cancel_terms', lang, { h: terms.free_cancel_hours, pct: terms.late_pct })} Heat or closures on the day: free.</p>}
      {detail.data?.safety && (
        <details style={{ margin: '.4rem 0 .8rem' }}><summary>{tv('safety_title', lang)}</summary>
          <ul style={{ fontSize: 'var(--fs-sm)' }}>{detail.data.safety.map((s: string) => <li key={s}>{s}</li>)}</ul></details>
      )}
      {err && <p className="dg-error" role="alert">{err}</p>}
      <button className="dg-btn dg-btn--dark dg-btn--block" disabled={!pickup || !day || !time || busy} onClick={book}>{busy ? 'Booking…' : tv('book_tour', lang)}</button>
      {!pickup && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>Add a pickup address to book.</p>}
      {pickup && !time && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>Choose a start time.</p>}
    </div>
  );
}
