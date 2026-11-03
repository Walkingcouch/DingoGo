import { useState } from 'react';
import { ApiError, post } from '@dingogo/shared';
import { useMe } from '../ctx';

export function HirePanel() {
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
  return (
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
  );
}
