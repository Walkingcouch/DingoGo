import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ApiError, Icon, get, money, post, useLoad } from '@dingogo/shared';
import { Page, Spinner } from '../components/ui';

/** Round 28: community trips. Fixed-price private car to a community (and back), shared shuttle seats, parcels to the community
 *  store, and your bookings. Shuttle seats and parcels are paid with DingoGo credit (top up at a DingoGo community store). */
export function CommunityScreen() {
  const { data, error, loading, reload } = useLoad(() => get('/regional'));
  return (
    <Page title="Community trips" back="/">
      <p className="dg-muted" style={{ marginTop: 0 }}>Between Alice Springs and communities. Fixed prices, booked ahead. Parts of the road have no mobile coverage: tell someone when you expect to arrive.</p>
      {error && <p className="dg-error" role="alert">{error}</p>}
      {loading && !data && <Spinner />}
      {data && (<>
        {data.bookings.length > 0 && <MyBookings rows={data.bookings} onChange={reload} />}
        {data.corridors.map((c: any) => <Route key={c.id} c={c} runs={data.runs.filter((r: any) => r.corridor === c.id)} ready={data.ready} wallet={data.wallet_cents} onBooked={reload}
          notice={data.min_notice_hours} maxSeats={data.max_seats} />)}
        <p className="dg-muted">Your DingoGo credit: <strong>{money(data.wallet_cents)}</strong>. Top up with cash at a DingoGo community store, or with a voucher in Account.</p>
        <p className="dg-muted">No smartphone? Text BUS and the place to the DingoGo number, e.g. BUS NTARIA FRI 2.</p>
      </>)}
    </Page>
  );
}

function MyBookings({ rows, onChange }: { rows: any[]; onChange: () => void }) {
  const [err, setErr] = useState<string | null>(null);
  async function cancel(id: string) {
    setErr(null);
    try { await post(`/regional/bookings/${id}/cancel`, {}); onChange(); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not cancel'); }
  }
  return (
    <section className="section" aria-labelledby="cb-h">
      <h2 id="cb-h" className="section__title">Your shuttle bookings</h2>
      <ul className="list">
        {rows.map((b) => (
          <li key={b.id} className="row"><span className="row__main"><strong>{b.run.when}: {b.run.label}</strong>
            <span className="dg-muted">{b.ref}, {b.kind === 'seat' ? `${b.seats} seat${b.seats === 1 ? '' : 's'} from ${b.pickup_name}` : `parcel for ${b.parcel?.recipient_name} to ${b.dropoff_name}`}, {money(b.price_cents)}, {STATUS[b.status] ?? b.status}</span></span>
            {['booked', 'pending'].includes(b.status) && b.run.status === 'open' && <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => cancel(b.id)}>Cancel</button>}</li>
        ))}
      </ul>
      {err && <p className="dg-error" role="alert">{err}</p>}
    </section>
  );
}
const STATUS: Record<string, string> = { booked: 'booked', pending: 'waiting for your YES', boarded: 'travelled', no_show: 'missed', cancelled: 'cancelled', at_store: 'at the store', collected: 'collected' };

function Route({ c, runs, ready, wallet, onBooked, notice, maxSeats }: { c: any; runs: any[]; ready: boolean; wallet: number; onBooked: () => void; notice: number; maxSeats: number }) {
  const [mode, setMode] = useState<'' | 'seat' | 'parcel' | 'car'>('');
  return (
    <section className="section" aria-labelledby={`rt-${c.id}`}>
      <h2 id={`rt-${c.id}`} className="section__title">{c.place.name}</h2>
      <p style={{ margin: '0 0 6px' }}>About {c.road_km} km, {Math.round(c.minutes / 5) * 5} min{c.unsealed_km ? `, ${c.unsealed_km} km unsealed` : ''}.
        Shuttle seat {money(c.seat_cents)} each way. Private car {money(c.private_cents)}{c.return_discount_pct ? `, trip back booked together ${c.return_discount_pct}% off` : ''}.</p>
      {c.coverage_gaps.length > 0 && <p className="dg-note" style={{ margin: '4px 0' }}><Icon name="nosignal" size={18} /> No mobile coverage on parts of the road. Your driver checks in with DingoGo on the way.</p>}
      {c.permit_note && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>Permits: {c.permit_note}</p>}
      <div className="seg" role="group" aria-label={`Book for ${c.place.name}`}>
        <button type="button" aria-pressed={mode === 'seat'} onClick={() => setMode(mode === 'seat' ? '' : 'seat')} disabled={!ready}>Shuttle seat</button>
        <button type="button" aria-pressed={mode === 'parcel'} onClick={() => setMode(mode === 'parcel' ? '' : 'parcel')} disabled={!ready || !c.pickup_points.some((p: any) => p.parcels)}>Send a parcel</button>
        <button type="button" aria-pressed={mode === 'car'} onClick={() => setMode(mode === 'car' ? '' : 'car')}>Private car</button>
      </div>
      {!ready && <p className="dg-muted">Online booking opens soon. Call DingoGo to book.</p>}
      {mode === 'seat' && <SeatForm c={c} runs={runs} wallet={wallet} maxSeats={maxSeats} onDone={() => { setMode(''); onBooked(); }} />}
      {mode === 'parcel' && <ParcelForm c={c} runs={runs.filter((r) => r.parcels_left > 0 && r.direction === 'out')} wallet={wallet} onDone={() => { setMode(''); onBooked(); }} />}
      {mode === 'car' && <CarForm c={c} notice={notice} />}
    </section>
  );
}

function SeatForm({ c, runs, wallet, maxSeats, onDone }: { c: any; runs: any[]; wallet: number; maxSeats: number; onDone: () => void }) {
  const open = runs.filter((r) => r.seats_left > 0);
  const [runId, setRunId] = useState(open[0]?.id ?? '');
  const [seats, setSeats] = useState(1);
  const run = open.find((r) => r.id === runId);
  const side = run?.direction === 'back' ? 'community' : 'town';
  const points = c.pickup_points.filter((p: any) => p.side === side);
  const [point, setPoint] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open.length) return <p className="dg-muted">No shuttles with seats in the next three weeks. Call DingoGo.</p>;
  const price = c.seat_cents * seats;
  async function book(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await post('/regional/bookings', { run_id: runId, kind: 'seat', seats, pickup_point: point || points[0]?.id }); onDone(); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not book'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={book}>
      <label className="dg-field"><span>Shuttle</span><select className="dg-select" value={runId} onChange={(e) => { setRunId(e.target.value); setPoint(''); }}>
        {open.map((r) => <option key={r.id} value={r.id}>{r.when}: {r.label} ({r.seats_left} left)</option>)}</select></label>
      <label className="dg-field"><span>Seats</span><select className="dg-select" value={seats} onChange={(e) => setSeats(Number(e.target.value))}>
        {Array.from({ length: Math.min(maxSeats, run?.seats_left ?? 1) }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}</select></label>
      <label className="dg-field"><span>Pickup point</span><select className="dg-select" value={point || points[0]?.id} onChange={(e) => setPoint(e.target.value)}>
        {points.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <p>{money(price)} from your DingoGo credit{wallet < price ? ` (you have ${money(wallet)})` : ''}.</p>
      {err && <p className="dg-error" role="alert">{err}</p>}
      <button className="dg-btn dg-btn--block" disabled={busy || wallet < price}>{busy ? 'Booking…' : `Book ${seats} seat${seats === 1 ? '' : 's'}`}</button>
    </form>
  );
}

function ParcelForm({ c, runs, wallet, onDone }: { c: any; runs: any[]; wallet: number; onDone: () => void }) {
  const stores = c.pickup_points.filter((p: any) => p.parcels);
  const [f, setF] = useState({ run_id: runs[0]?.id ?? '', store: stores[0]?.id ?? '', size: 'S', description: '', recipient_name: '', recipient_phone: '', ok: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!runs.length) return <p className="dg-muted">No shuttle with room for parcels soon. Call DingoGo.</p>;
  const price = c.parcel_cents[f.size];
  async function book(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      await post('/regional/bookings', { run_id: f.run_id, kind: 'parcel', dropoff_point: f.store,
        parcel: { size: f.size, description: f.description, recipient_name: f.recipient_name, recipient_phone: f.recipient_phone, prohibited_ok: f.ok } });
      onDone();
    } catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not book'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={book}>
      <label className="dg-field"><span>Shuttle</span><select className="dg-select" value={f.run_id} onChange={(e) => setF({ ...f, run_id: e.target.value })}>
        {runs.map((r) => <option key={r.id} value={r.id}>{r.when}: {r.label}</option>)}</select></label>
      <label className="dg-field"><span>Collect from</span><select className="dg-select" value={f.store} onChange={(e) => setF({ ...f, store: e.target.value })}>
        {stores.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="dg-field"><span>Size</span><select className="dg-select" value={f.size} onChange={(e) => setF({ ...f, size: e.target.value })}>
        <option value="S">Small, up to 5 kg ({money(c.parcel_cents.S)})</option><option value="M">Medium, up to 15 kg ({money(c.parcel_cents.M)})</option><option value="L">Large, up to 25 kg ({money(c.parcel_cents.L)})</option></select></label>
      <label className="dg-field"><span>What it is</span><input className="dg-input" value={f.description} onChange={(e) => setF({ ...f, description: e.target.value })} required maxLength={200} /></label>
      <label className="dg-field"><span>Who collects it</span><input className="dg-input" value={f.recipient_name} onChange={(e) => setF({ ...f, recipient_name: e.target.value })} required maxLength={80} /></label>
      <label className="dg-field"><span>Their mobile (we text them a collection code)</span><input className="dg-input" type="tel" value={f.recipient_phone} onChange={(e) => setF({ ...f, recipient_phone: e.target.value })} required /></label>
      <label className="dg-check"><input type="checkbox" checked={f.ok} onChange={(e) => setF({ ...f, ok: e.target.checked })} /><span>No alcohol, drugs, weapons or dangerous goods</span></label>
      <p>{money(price)} from your DingoGo credit{wallet < price ? ` (you have ${money(wallet)})` : ''}.</p>
      {err && <p className="dg-error" role="alert">{err}</p>}
      <button className="dg-btn dg-btn--block" disabled={busy || !f.ok || wallet < price}>{busy ? 'Booking…' : 'Send the parcel'}</button>
    </form>
  );
}

/** Private car: fixed price, booked ahead, with the trip back if wanted. Uses the normal booking (card or credit). */
function CarForm({ c, notice }: { c: any; notice: number }) {
  const nav = useNavigate();
  const town = c.pickup_points.find((p: any) => p.side === 'town');
  const [dir, setDir] = useState<'out' | 'back'>('out');
  const [when, setWhen] = useState('');
  const [back, setBack] = useState('');
  const [pay, setPay] = useState<'card' | 'wallet'>('card');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const iso = (v: string) => new Date(v + ':00+09:30').toISOString();
  async function book(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    const placeEnd = { lat: c.place.lat, lng: c.place.lng, address: c.place.name };
    const townEnd = { lat: town.lat, lng: town.lng, address: town.name };
    try {
      const t = await post('/trips', { kind: 'ride', service: 'ride', payment_method: pay, pickup: dir === 'out' ? townEnd : placeEnd, dropoff: dir === 'out' ? placeEnd : townEnd,
        scheduled_for: iso(when), ...(back ? { return_scheduled_for: iso(back) } : {}) });
      nav(`/trip/${t.trip.id}`);
    } catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not book'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={book}>
      <div className="seg" role="group" aria-label="Which way">
        <button type="button" aria-pressed={dir === 'out'} onClick={() => setDir('out')}>From Alice Springs</button>
        <button type="button" aria-pressed={dir === 'back'} onClick={() => setDir('back')}>To Alice Springs</button>
      </div>
      <p className="dg-muted">Pickup in town: {town?.name}. Book at least {notice} hours ahead. Up to 4 passengers.</p>
      <label className="dg-field"><span>Leave at (Alice Springs time)</span><input className="dg-input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} required /></label>
      <label className="dg-field"><span>Trip back (optional, {c.return_discount_pct}% off)</span><input className="dg-input" type="datetime-local" value={back} onChange={(e) => setBack(e.target.value)} /></label>
      <label className="dg-field"><span>Pay with</span><select className="dg-select" value={pay} onChange={(e) => setPay(e.target.value as any)}><option value="card">Card</option><option value="wallet">DingoGo credit</option></select></label>
      {err && <p className="dg-error" role="alert">{err}</p>}
      <button className="dg-btn dg-btn--block" disabled={busy || !when}>{busy ? 'Booking…' : `Book for ${money(c.private_cents)}${back ? ' plus the trip back' : ''}`}</button>
    </form>
  );
}
