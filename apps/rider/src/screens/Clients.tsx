import { useState } from 'react';
import { ApiError, date, dateTime, get, money, post, STATUS_LABEL, useLoad } from '@dingogo/shared';
import { Page, Spinner } from '../components/ui';
import { PlaceField, type Place } from '../components/PlaceField';
import { CLIENT_KINDS, useMe } from '../ctx';

/** Account kinds that can book rides for clients (community organisations, Aboriginal corporations, health services, NDIS). */
const METHOD: Record<string, string> = { verbal: 'Told us in person or by phone', written: 'Signed a form', standing: 'Care or support plan' };

/** Staff of a community organisation book rides for their clients, with each client's consent on record. */
export function ClientsScreen() {
  const { me } = useMe();
  const accounts = (me?.corporate_accounts ?? []).filter((a) => CLIENT_KINDS.includes(a.kind ?? ''));
  const [accountId, setAccountId] = useState<string>('');
  const acct = accounts.find((a) => a.id === accountId) ?? accounts[0];
  if (!me) return <Page title="Book for clients" back="/account"><Spinner /></Page>;
  if (!acct) return <Page title="Book for clients" back="/account"><p>Booking for clients is for community, health and NDIS accounts. Ask DingoGo to set one up.</p></Page>;
  return (
    <Page title="Book for clients" back="/account">
      {accounts.length > 1 && (
        <label className="dg-field"><span>Organisation</span>
          <select className="dg-select" value={acct.id} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      )}
      <Body key={acct.id} accountId={acct.id} manager={acct.role === 'manager'} />
    </Page>
  );
}

function Body({ accountId, manager }: { accountId: string; manager: boolean }) {
  const clients = useLoad(() => get<{ clients: any[] }>(`/business/clients?account_id=${accountId}`), [accountId]);
  const rides = useLoad(() => get<{ rides: any[] }>(`/business/rides?account_id=${accountId}`), [accountId]);
  const [booking, setBooking] = useState<any | null>(null);
  const current = clients.data?.clients.filter((c) => c.current) ?? [];
  return (
    <>
      <p className="dg-muted" style={{ marginTop: 0 }}>Book only for clients who have said yes. We text them when you add them and for every ride, and they can stop it at any time. You see only the rides you book.</p>
      {clients.error && <p className="dg-error" role="alert">{clients.error}</p>}
      <h2 className="section__title">Clients</h2>
      {clients.loading ? <Spinner /> : current.length === 0 ? <p>No clients yet.</p> : (
        <ul className="list">
          {current.map((c) => (
            <li key={c.id} className="row"><span className="row__main"><strong>{c.client_full_name}</strong>
              <span className="dg-muted">Mobile {c.phone_tail}. {METHOD[c.method] ?? c.method}, {date(c.given_at)}{c.expires_at ? `, until ${date(c.expires_at)}` : ''}</span></span>
              <button className="dg-btn dg-btn--sm" onClick={() => setBooking(c)}>Book a ride</button></li>
          ))}
        </ul>
      )}
      {booking && <BookRide accountId={accountId} client={booking} onDone={async () => { setBooking(null); await rides.reload(); }} onCancel={() => setBooking(null)} />}
      <AddClient accountId={accountId} onDone={clients.reload} />
      <h2 className="section__title" style={{ marginTop: 28 }}>{manager ? 'Rides booked for clients' : 'Rides you booked'}</h2>
      {rides.loading ? <Spinner /> : !rides.data?.rides.length ? <p className="dg-muted">None yet.</p> : (
        <ul className="list">
          {rides.data.rides.map((r) => (
            <li key={r.id} className="row"><span className="row__main"><strong>{r.client}: {r.pickup_address} to {r.dropoff_address}</strong>
              <span className="dg-muted">{r.ref}, {dateTime(r.scheduled_for ?? r.requested_at)}, {STATUS_LABEL[r.status] ?? r.status}{r.driver ? `, ${r.driver.name}${r.driver.car?.rego ? ` (${r.driver.car.rego})` : ''}` : ''}, {money(r.final_cents ?? r.quote_cents)}</span></span>
              {['scheduled', 'requested', 'accepted'].includes(r.status) && (
                <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={async () => { await post(`/business/rides/${r.id}/cancel`, {}); await rides.reload(); }}>Cancel</button>
              )}</li>
          ))}
        </ul>
      )}
    </>
  );
}

function AddClient({ accountId, onDone }: { accountId: string; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: '', phone: '', method: 'verbal', note: '', expires_at: '', confirm: false });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!open) return <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>Add a client</button>;
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      await post('/business/clients', { account_id: accountId, name: f.name, phone: f.phone, method: f.method, note: f.note || undefined, expires_at: f.expires_at || null, confirm: f.confirm });
      setOpen(false); setF({ name: '', phone: '', method: 'verbal', note: '', expires_at: '', confirm: false }); await onDone();
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Could not save'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save} className="block" style={{ marginTop: 12 }}>
      <h3 style={{ marginTop: 0 }}>Add a client</h3>
      <div className="grid2">
        <label className="dg-field"><span>Client's name</span><input className="dg-input" value={f.name} maxLength={80} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="dg-field"><span>Client's mobile</span><input className="dg-input" type="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
      </div>
      <label className="dg-field"><span>How they said yes</span>
        <select className="dg-select" value={f.method} onChange={(e) => setF({ ...f, method: e.target.value })}>{Object.entries(METHOD).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
      <div className="grid2">
        <label className="dg-field"><span>Note (optional)</span><input className="dg-input" value={f.note} maxLength={200} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. renal clinic, Tue and Thu" /></label>
        <label className="dg-field"><span>Ends on (optional)</span><input className="dg-input" type="date" value={f.expires_at} onChange={(e) => setF({ ...f, expires_at: e.target.value })} /></label>
      </div>
      <label className="dg-check"><input type="checkbox" checked={f.confirm} onChange={(e) => setF({ ...f, confirm: e.target.checked })} />
        <span>The client agreed to us booking DingoGo rides for them, and knows DingoGo will text them</span></label>
      {err && <p className="dg-error" role="alert">{err}</p>}
      <button className="dg-btn dg-btn--block" disabled={busy || !f.name.trim() || !f.phone.trim() || !f.confirm}>{busy ? 'Saving…' : 'Save client'}</button>
    </form>
  );
}

function BookRide({ accountId, client, onDone, onCancel }: { accountId: string; client: any; onDone: () => Promise<void>; onCancel: () => void }) {
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [when, setWhen] = useState('');
  const [notes, setNotes] = useState('');
  const [animal, setAnimal] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [quote, setQuote] = useState<any | null>(null);
  const body = () => ({ account_id: accountId, consent_id: client.id, pickup, dropoff, scheduled_for: when ? new Date(when).toISOString() : null,
    notes: notes || undefined, assistance_animal: animal });
  async function price() {
    setErr(null);
    try { setQuote((await post('/business/rides/quote', body())).quote); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not price it'); }
  }
  async function book(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await post('/business/rides', body()); await onDone(); } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Could not book'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={book} className="block" style={{ marginTop: 12 }} aria-label={`Book a ride for ${client.client_full_name}`}>
      <h3 style={{ marginTop: 0 }}>Ride for {client.client_full_name}</h3>
      <div className="places">
        <PlaceField label="Pickup" dot="A" value={pickup} onChange={(p) => { setPickup(p); setQuote(null); }} placeholder="Pickup" />
        <PlaceField label="Drop-off" dot="B" value={dropoff} onChange={(p) => { setDropoff(p); setQuote(null); }} placeholder="Drop-off" />
      </div>
      <label className="dg-field"><span>When (leave empty for now)</span><input className="dg-input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
      <label className="dg-field"><span>Note for the driver</span><input className="dg-input" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. walking frame, meet at the front desk" /></label>
      <label className="dg-check"><input type="checkbox" checked={animal} onChange={(e) => setAnimal(e.target.checked)} /><span>Travelling with an assistance animal</span></label>
      {quote && <p className="dg-note">Price {money(quote.total_cents)}, billed to your account.</p>}
      {err && <p className="dg-error" role="alert">{err}</p>}
      <div className="grid2">
        <button type="button" className="dg-btn dg-btn--ghost" onClick={pickup && dropoff ? price : onCancel}>{pickup && dropoff ? 'Check price' : 'Close'}</button>
        <button className="dg-btn" disabled={busy || !pickup || !dropoff}>{busy ? 'Booking…' : 'Book ride'}</button>
      </div>
    </form>
  );
}
