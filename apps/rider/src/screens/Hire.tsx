import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, get, money, post, useLoad } from '@dingogo/shared';
import { PlaceField, type Place } from '../components/PlaceField';
import { useMe } from '../ctx';

const dayAfter = () => {
  const d = new Date(Date.now() + 26 * 3600e3); d.setMinutes(0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

/** Round 19: a car and driver by the hour, booked in the app (priced by the hours, not the drive). */
function ByTheHour({ pickup, setPickup, onFocusPickup }: { pickup: Place | null; setPickup: (p: Place | null) => void; onFocusPickup: () => void }) {
  const { reload } = useMe();
  const nav = useNavigate();
  const cfg = useLoad(() => get('/public/tours'), []);
  const hp = cfg.data?.terms?.hire;
  const [hrs, setHrs] = useState(2);
  const [when, setWhen] = useState(dayAfter());
  const [quote, setQuote] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const body = () => ({ service: 'hourly', pickup, dropoff: pickup, hire_hours: hrs, scheduled_for: new Date(when).toISOString() });
  async function price() {
    if (!pickup) return;
    setErr(null);
    try { setQuote((await post('/quotes', body())).quote); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not price it'); }
  }
  async function book() {
    setBusy(true); setErr(null);
    try {
      const r = await post('/trips', { ...body(), kind: 'ride', payment_method: 'card' });
      void reload(); nav(`/trips/${r.trip.id}`);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not book'); }
    finally { setBusy(false); }
  }
  return (
    <section style={{ marginBottom: '1.2rem' }}>
      <h3 style={{ fontSize: 'var(--fs-md)', margin: '0 0 .4rem' }}>Book a car by the hour</h3>
      <div className="places"><PlaceField label="Pickup" dot="A" value={pickup} onChange={(p) => { setPickup(p); setQuote(null); }} placeholder="Where should we start?" active onFocusField={onFocusPickup} /></div>
      <div className="grid2" style={{ marginTop: '.6rem' }}>
        <label className="dg-field"><span>Start</span><input className="dg-input" type="datetime-local" value={when} onChange={(e) => { setWhen(e.target.value); setQuote(null); }} /></label>
        <label className="dg-field"><span>Hours</span>
          <select className="dg-select" value={hrs} onChange={(e) => { setHrs(Number(e.target.value)); setQuote(null); }}>
            {Array.from({ length: hp?.max_hours_per_day ?? 10 }, (_, i) => i + 1).filter((n) => n >= (hp?.min_hours ?? 1)).map((n) => <option key={n} value={n}>{n}</option>)}
          </select></label>
      </div>
      <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>Book at least {hp?.notice_hours ?? 24} hours ahead. Free to cancel until {cfg.data?.terms?.hire_free_cancel_hours ?? 24} hours before, then {cfg.data?.terms?.late_pct ?? 50}%. For several days or cars, ask for a quote below.</p>
      {quote && <p className="quote__total dg-money" style={{ margin: '.2rem 0 .6rem' }}>{money(quote.total_cents)} <small className="dg-muted" style={{ fontSize: 'var(--fs-sm)', fontWeight: 400 }}>incl. GST and levy, card held before the start</small></p>}
      {err && <p className="dg-error" role="alert">{err}</p>}
      {quote
        ? <button className="dg-btn dg-btn--dark dg-btn--block" disabled={busy} onClick={book}>{busy ? 'Booking…' : `Book ${hrs} hour${hrs > 1 ? 's' : ''}`}</button>
        : <button className="dg-btn dg-btn--ghost dg-btn--block" disabled={!pickup} onClick={price}>See the price</button>}
    </section>
  );
}

export function HirePanel(props: { pickup: Place | null; setPickup: (p: Place | null) => void; onFocusPickup: () => void }) {
  const { me } = useMe();
  const [f, setF] = useState({ kind: 'event', contact_name: me?.user.name ?? '', contact_email: me?.user.email ?? '', contact_phone: me?.user.phone ?? '', organisation: '', event_date: '', passengers: '', vehicles: '1', details: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await post('/public/hire-requests', {
        kind: f.kind, contact_name: f.contact_name, contact_email: f.contact_email, contact_phone: f.contact_phone || undefined,
        organisation: f.organisation || undefined, event_date: f.event_date || undefined,
        passengers: f.passengers ? Number(f.passengers) : undefined, vehicles: Number(f.vehicles) || undefined, details: f.details || undefined,
      });
      setDone(true);
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Could not send'); }
    finally { setBusy(false); }
  }

  if (done) return (
    <div className="callout callout--green" role="status">
      <strong>Request sent.</strong> We'll email {f.contact_email} with a quote, usually within one business day.
      <button className="dg-btn dg-btn--ghost dg-btn--sm" style={{ marginTop: '.6rem' }} onClick={() => setDone(false)}>Send another</button>
    </div>
  );
  return (<>
    <ByTheHour {...props} />
    <h3 style={{ fontSize: 'var(--fs-md)', margin: '0 0 .4rem' }}>Events, several days or several cars</h3>
    <form onSubmit={submit}>
      <p className="dg-muted" style={{ marginTop: 0 }}>Weddings, conferences, festivals, airport transfers for a group, or a car for the day. Tell us what you need and we'll send a quote. Hourly hire starts at $75 an hour.</p>
      <label className="dg-field"><span>What's it for?</span>
        <select className="dg-select" value={f.kind} onChange={set('kind')}>
          <option value="event">Event</option><option value="wedding">Wedding</option><option value="conference">Conference</option>
          <option value="festival">Festival</option><option value="corporate">Business account</option><option value="ndis">NDIS transport</option><option value="other">Something else</option>
        </select></label>
      <div className="grid2">
        <label className="dg-field"><span>Your name</span><input className="dg-input" required value={f.contact_name} onChange={set('contact_name')} /></label>
        <label className="dg-field"><span>Email</span><input className="dg-input" type="email" required value={f.contact_email} onChange={set('contact_email')} /></label>
        <label className="dg-field"><span>Phone</span><input className="dg-input" type="tel" value={f.contact_phone} onChange={set('contact_phone')} /></label>
        <label className="dg-field"><span>Organisation</span><input className="dg-input" value={f.organisation} onChange={set('organisation')} /></label>
        <label className="dg-field"><span>Date</span><input className="dg-input" type="date" value={f.event_date} onChange={set('event_date')} /></label>
        <label className="dg-field"><span>Number of people</span><input className="dg-input" inputMode="numeric" value={f.passengers} onChange={(e) => setF({ ...f, passengers: e.target.value.replace(/\D/g, '') })} /></label>
      </div>
      <label className="dg-field"><span>Details</span><textarea className="dg-textarea" value={f.details} onChange={set('details')} placeholder="Times, places, anything special" /></label>
      {err && <p className="dg-error" role="alert">{err}</p>}
      <button className="dg-btn dg-btn--dark dg-btn--block" disabled={busy}>{busy ? 'Sending…' : 'Ask for a quote'}</button>
    </form>
  </>);
}
