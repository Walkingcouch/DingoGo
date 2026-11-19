import { useState } from 'react';
import { ApiError, Icon, get, post, useLoad } from '@dingogo/shared';
import { Sheet } from '../Sheet';
import { useDriver } from '../state';

/** Round 28: community shuttles assigned to this driver: manifest, leave, board or no-show, parcels left at the store, check in, done. */
export function DriverShuttles() {
  const { data, reload } = useLoad(() => get('/driver/regional/runs').catch(() => ({ runs: [] })));
  const [open, setOpen] = useState<any>(null);
  const runs = (data?.runs ?? []).filter((r: any) => r.status !== 'cancelled');
  if (!runs.length) return null;
  return (
    <section className="panel" aria-labelledby="sh-h">
      <h2 id="sh-h" style={{ marginTop: 0 }}>Community shuttles</h2>
      <ul className="list">
        {runs.map((r: any) => (
          <li key={r.id}>
            <span className="session-ic" aria-hidden><Icon name="route" size={20} /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{r.label}</div>
              <div className="sub">{r.when}, {r.seats_taken} of {r.seats} seats, {r.parcels_taken} parcels{r.status === 'departed' ? ', on the road' : r.status === 'completed' ? ', done' : ''}</div>
            </div>
            {r.status !== 'completed' && <button className="link-btn" onClick={() => setOpen(r)} aria-label={`Manifest for ${r.label}, ${r.when}`}>Manifest</button>}
          </li>
        ))}
      </ul>
      {open && <Manifest run={open} onClose={() => { setOpen(null); void reload(); }} />}
    </section>
  );
}

function Manifest({ run, onClose }: { run: any; onClose: () => void }) {
  const { pos, showToast } = useDriver();
  const { data, error, reload } = useLoad(() => get(`/driver/regional/runs/${run.id}/manifest`), [run.id]);
  const [err, setErr] = useState<string | null>(null);
  const status = data?.run.status ?? run.status;
  async function act(path: string, body: unknown = {}, ok?: string) {
    setErr(null);
    try { await post(path, body); if (ok) showToast(ok); await reload(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'No signal: try again when you have coverage'); }
  }
  const at = { lat: pos?.lat, lng: pos?.lng };
  return (
    <Sheet onClose={onClose} labelledBy="mf-h">
      <h2 id="mf-h" style={{ marginTop: 0 }}>{run.label}</h2>
      <p className="dg-muted" style={{ marginTop: 0 }}>{run.when} · {run.ref}</p>
      {error && <p className="dg-error">{error}</p>}
      {data && (<>
        {data.route.coverage_gaps.map((g: any, i: number) => <p key={i} className="dg-note" style={{ margin: '4px 0' }}><Icon name="nosignal" size={18} /> {g.note}</p>)}
        {data.route.permit_note && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>Permits: {data.route.permit_note}</p>}
        <h3>Passengers ({data.totals.seats})</h3>
        <ul className="list">
          {data.seats.map((s: any) => (
            <li key={s.id}>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 700 }}>{s.name} · {s.seats} seat{s.seats === 1 ? '' : 's'}</div><div className="sub">{s.pickup} to {s.dropoff}{s.phone_last3 ? `, phone ends ${s.phone_last3}` : ''}</div></div>
              {s.status === 'booked' || s.status === 'boarded' || s.status === 'no_show' ? (
                <div role="group" aria-label={`${s.name}: on board?`}>
                  <button className="link-btn" aria-pressed={s.status === 'boarded'} onClick={() => act(`/driver/regional/bookings/${s.id}/board`, { status: 'boarded' })}>On board</button>
                  <button className="link-btn" aria-pressed={s.status === 'no_show'} onClick={() => act(`/driver/regional/bookings/${s.id}/board`, { status: 'no_show' })}>Didn't come</button>
                </div>) : <span className="sub">{s.status}</span>}
            </li>
          ))}
          {!data.seats.length && <li className="dg-muted">No passengers booked.</li>}
        </ul>
        <h3>Parcels ({data.totals.parcels})</h3>
        <ul className="list">
          {data.parcels.map((p: any) => (
            <li key={p.id}>
              <div style={{ flex: 1 }}><div style={{ fontWeight: 700 }}>{p.ref} · size {p.size}</div><div className="sub">{p.description}, for {p.recipient}, to {p.store}</div></div>
              {p.status === 'booked' && status === 'departed'
                ? <button className="link-btn" onClick={() => act(`/driver/regional/bookings/${p.id}/at-store`, {}, 'Left at the store: they are texted a code')}>Left at store</button>
                : <span className="sub">{p.status === 'at_store' ? 'At the store' : p.status === 'collected' ? 'Collected' : p.status}</span>}
            </li>
          ))}
          {!data.parcels.length && <li className="dg-muted">No parcels.</li>}
        </ul>
        {err && <p className="dg-error" role="alert">{err}</p>}
        {(status === 'open' || status === 'closed') && <button className="dg-btn dg-btn--block btn-xl" onClick={() => act(`/driver/regional/runs/${run.id}/depart`, at, 'On the road. Check in when you can.')}>Leaving now</button>}
        {status === 'departed' && (<>
          <button className="dg-btn dg-btn--dark dg-btn--block btn-xl" onClick={() => act(`/driver/regional/runs/${run.id}/checkin`, at, 'Checked in')}><Icon name="check" size={22} />Check in: all OK</button>
          <button className="dg-btn dg-btn--green dg-btn--block btn-xl" style={{ marginTop: 10 }} onClick={() => act(`/driver/regional/runs/${run.id}/complete`, at, 'Shuttle done. Your pay is in Earnings.')}>Arrived: shuttle done</button>
        </>)}
      </>)}
      <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 10 }} onClick={onClose}>Close</button>
    </Sheet>
  );
}
