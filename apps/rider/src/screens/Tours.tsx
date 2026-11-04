import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, get, money, post, useLoad } from '@dingogo/shared';
import { PlaceField, type Place } from '../components/PlaceField';
import { useMe } from '../ctx';

const minSchedule = () => {
  const d = new Date(Date.now() + 60 * 60000); d.setMinutes(0, 0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function ToursPanel({ pickup, setPickup, onFocusPickup, payMethod }: { pickup: Place | null; setPickup: (p: Place | null) => void; onFocusPickup: () => void; payMethod: string }) {
  const { data, error, loading } = useLoad(() => get<{ tours: any[] }>('/tours'));
  const { reload } = useMe();
  const nav = useNavigate();
  const [sel, setSel] = useState<any | null>(null);
  const [when, setWhen] = useState(minSchedule());
  const [guests, setGuests] = useState(2);
  const cfg = useLoad(() => get('/public/config'), []);
  const cashRide = !!cfg.data?.cash_payments?.ride;
  const [pay, setPay] = useState<'card' | 'cash'>(payMethod === 'cash' && cashRide ? 'cash' : 'card');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function book() {
    if (!sel || !pickup) return;
    setBusy(true); setErr(null);
    try {
      const r = await post('/trips', {
        kind: 'ride', service: 'tour', tour_package_id: sel.id, pickup, dropoff: pickup, scheduled_for: new Date(when).toISOString(),
        passengers: guests, payment_method: pay,
      });
      void reload();
      nav(`/trips/${r.trip.id}`);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not book the tour'); }
    finally { setBusy(false); }
  }

  if (loading) return <p className="dg-muted">Loading tours…</p>;
  if (error) return <p className="dg-error">{error}</p>;
  if (!sel) {
    return (
      <div className="tours">
        <p className="dg-muted" style={{ marginTop: 0 }}>Private tours with a local driver. One price for up to {data?.tours[0]?.max_passengers ?? 4} guests, with a local driver.</p>
        {data!.tours.map((t) => (
          <button key={t.id} className="tour" onClick={() => setSel(t)}>
            <span className="tour__top"><strong>{t.name}</strong><span className="dg-money">{money(t.price_cents)}</span></span>
            <span className="tour__sum">{t.summary}</span>
            <span className="tour__meta">
              <span className="dg-chip">{Math.round(t.duration_min / 60 * 10) / 10} hours</span>
              {t.requires_permit && <span className="dg-chip dg-chip--ochre">Park fees may apply</span>}
            </span>
          </button>
        ))}
      </div>
    );
  }
  return (
    <div className="tours">
      <button className="linkbtn" onClick={() => setSel(null)}>All tours</button>
      <h2 style={{ fontSize: 'var(--fs-xl)', marginTop: '.4rem' }}>{sel.name}</h2>
      <p>{sel.description}</p>
      {sel.stops?.length > 0 && <p><strong>Stops:</strong> {sel.stops.join(', ')}</p>}
      {sel.cultural_note && <div className="callout callout--earth"><strong>Respect for Country.</strong> {sel.cultural_note}</div>}
      <div className="places" style={{ marginTop: '1rem' }}>
        <PlaceField label="Pickup" dot="A" value={pickup} onChange={setPickup} placeholder="Where should we collect you?" active onFocusField={onFocusPickup} />
      </div>
      <div className="grid2" style={{ marginTop: '.8rem' }}>
        <label className="dg-field"><span>Date and start time</span>
          <input className="dg-input" type="datetime-local" min={minSchedule()} value={when} onChange={(e) => setWhen(e.target.value)} /></label>
        <label className="dg-field"><span>Guests</span>
          <select className="dg-select" value={guests} onChange={(e) => setGuests(Number(e.target.value))}>
            {Array.from({ length: sel.max_passengers }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}
          </select></label>
      </div>
      <label className="dg-field"><span>Pay with</span>
        <select className="dg-select" value={pay} onChange={(e) => setPay(e.target.value as any)}>
          <option value="card">Card</option>{cashRide && <option value="cash">Cash on the day</option>}
        </select></label>
      <p className="quote__total dg-money" style={{ margin: '.2rem 0 .8rem' }}>{money(sel.price_cents + 100)} <small className="dg-muted" style={{ fontSize: 'var(--fs-sm)', fontWeight: 400 }}>incl. GST and $1 NT passenger levy</small></p>
      {err && <p className="dg-error" role="alert">{err}</p>}
      <button className="dg-btn dg-btn--dark dg-btn--block" disabled={!pickup || !when || busy} onClick={book}>{busy ? 'Booking…' : 'Book this tour'}</button>
      {!pickup && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>Add a pickup address to book.</p>}
    </div>
  );
}
