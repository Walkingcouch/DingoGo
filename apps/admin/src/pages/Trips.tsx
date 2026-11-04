import { useState } from 'react';
import { get, post, money, dateTime, time, km, mins, STATUS_LABEL, COURIER_STATUS_LABEL, statusTone, useLoad, Icon } from '@dingogo/shared';
import { DgMap, type MapMarker } from '@dingogo/shared/map';
import { Page } from '../ctx';
import { Chip, Drawer, ErrorMsg, Modal, Table, exportCsv, useRun, type Col } from '../ui';
import { CHANNEL, EVENT_TYPE, OFFER_STATUS, PARCEL_SIZE, PAYMENT_KIND, PAYMENT_METHOD, PAYMENT_STATUS, SERVICE_NAME, label } from '../labels';

const SERVICES: [string, string][] = [['ride', 'Ride'], ['pet', 'Pet-friendly'], ['courier_s', 'Courier small'], ['courier_m', 'Courier medium'], ['courier_l', 'Courier large'], ['hourly', 'Hourly hire']];

export default function Trips() {
  const [status, setStatus] = useState('');
  const [kind, setKind] = useState('');
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [booking, setBooking] = useState(false);
  const { data, error, reload } = useLoad(() => get(`/admin/trips?status=${status}&kind=${kind}&q=${encodeURIComponent(search)}`), [status, kind, search]);

  const cols: Col<any>[] = [
    { key: 'ref', label: 'Ref', nowrap: true, render: (t) => <strong>{t.ref}</strong> },
    { key: 'status', label: 'Status', render: (t) => <Chip tone={statusTone(t.status)}>{(t.service.startsWith('courier') ? COURIER_STATUS_LABEL : STATUS_LABEL)[t.status] ?? label({}, t.status)}</Chip>, csv: (t) => t.status },
    { key: 'service', label: 'Service', nowrap: true, render: (t) => label(SERVICE_NAME, t.service) },
    { key: 'when', label: 'When', nowrap: true, render: (t) => dateTime(t.scheduled_for ?? t.requested_at), csv: (t) => t.scheduled_for ?? t.requested_at },
    { key: 'rider_name', label: 'Rider', truncate: 160 },
    { key: 'driver_name', label: 'Driver', truncate: 160 },
    { key: 'route', label: 'Route', render: (t) => <span className="route" title={`${t.pickup_address} to ${t.dropoff_address}`}><span className="trunc">{t.pickup_address}</span><span className="trunc sub">to {t.dropoff_address}</span></span>, csv: (t) => `${t.pickup_address} -> ${t.dropoff_address}` },
    { key: 'payment_method', label: 'Payment', nowrap: true, render: (t) => label(PAYMENT_METHOD, t.payment_method) },
    { key: 'final_cents', label: 'Fare', num: true, render: (t) => money(t.final_cents ?? t.quote_cents), csv: (t) => ((t.final_cents ?? t.quote_cents) / 100).toFixed(2) },
  ];

  return (
    <Page title="Trips" right={<>
      <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => data && exportCsv('dingogo-trips.csv', data.trips, cols)}>Export CSV</button>
      <button className="dg-btn dg-btn--sm" onClick={() => setBooking(true)}>New phone booking</button>
    </>}>
      <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setSearch(q); }}>
        <input className="dg-input" placeholder="Ref, name, phone or address" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search trips" style={{ minWidth: 200, flex: '1 1 220px', maxWidth: 320 }} />
        <select className="dg-select" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status">
          <option value="">All statuses</option><option value="active">In progress</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="dg-select" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Type"><option value="">Rides and courier</option><option value="ride">Rides</option><option value="courier">Courier</option></select>
        <button className="dg-btn dg-btn--sm dg-btn--dark">Search</button>
      </form>
      <ErrorMsg error={error} />
      <Table rows={data?.trips} cols={cols} onRow={(t) => setOpen(t.id)} empty={search || status || kind ? 'No trips match these filters.' : 'No trips yet. Phone bookings and app requests appear here.'} />
      {open && <TripDrawer id={open} onClose={() => { setOpen(null); void reload(); }} />}
      {booking && <PhoneBooking onClose={(id) => { setBooking(false); void reload(); if (id) setOpen(id); }} />}
    </Page>
  );
}

function TripDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, reload } = useLoad(() => get(`/admin/trips/${id}`), [id]);
  const [refund, setRefund] = useState({ amount: '', reason: '' });
  const run = useRun();
  const t = data?.trip;
  const markers: MapMarker[] = t ? [
    { id: 'p', kind: 'pickup', lat: t.pickup_lat, lng: t.pickup_lng, label: t.pickup_address },
    { id: 'd', kind: 'dropoff', lat: t.dropoff_lat, lng: t.dropoff_lng, label: t.dropoff_address },
  ] : [];
  const live = t && ['scheduled', 'requested', 'accepted', 'arrived'].includes(t.status);
  return (
    <Drawer title={t ? <>{t.ref} <Chip tone={statusTone(t.status)}>{STATUS_LABEL[t.status]}</Chip></> : 'Trip'} onClose={onClose}
      actions={live ? <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={async () => { if (confirm('Cancel this trip? The rider is not charged.')) { await run(() => post(`/admin/trips/${id}/cancel`, { reason: 'Cancelled by DingoGo' }), 'Trip cancelled'); void reload(); } }}>Cancel trip</button> : undefined}>
      <ErrorMsg error={error} />
      {t && (<>
        <div style={{ height: 220, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)', marginBottom: 14 }}>
          <DgMap markers={markers} track={data.track} padding={30} />
        </div>
        <dl className="kv">
          <dt>Service</dt><dd>{label(SERVICE_NAME, t.service)}{t.channel !== 'app' && ` (booked by ${label(CHANNEL, t.channel).toLowerCase()})`}</dd>
          <dt>From</dt><dd>{t.pickup_address}</dd><dt>To</dt><dd>{t.dropoff_address}</dd>
          <dt>Rider</dt><dd>{t.rider?.name} {t.rider?.phone && <a href={`tel:${t.rider.phone}`}>{t.rider.phone}</a>}</dd>
          <dt>Driver</dt><dd>{t.driver ? <>{t.driver.name} {t.driver.phone && <a href={`tel:${t.driver.phone}`}>{t.driver.phone}</a>}</> : '—'}</dd>
          <dt>Vehicle</dt><dd>{t.vehicle ? `${t.vehicle.colour} ${t.vehicle.make} ${t.vehicle.model}, ${t.vehicle.rego}` : '—'}</dd>
          <dt>Estimate</dt><dd>{km(t.est_distance_m)}, {mins(t.est_duration_s)}</dd>
          <dt>Trip PIN</dt><dd>{t.verify_pin}</dd>
          <dt>Payment</dt><dd>{label(PAYMENT_METHOD, t.payment_method)}, {label(PAYMENT_STATUS, t.payment_status).toLowerCase()}</dd>
          {t.scheduled_for && <><dt>Scheduled</dt><dd>{dateTime(t.scheduled_for)}</dd></>}
          {(t.has_pet || t.assistance_animal || t.needs_wheelchair || t.women_driver_pref) && <><dt>Needs</dt><dd>{[t.has_pet && 'Pet', t.assistance_animal && 'Assistance animal', t.needs_wheelchair && 'Wheelchair', t.women_driver_pref && 'Female driver preferred'].filter(Boolean).join(', ')}</dd></>}
          {t.ndis_number && <><dt>NDIS no.</dt><dd>{t.ndis_number}</dd></>}
          {t.notes && <><dt>Notes</dt><dd>{t.notes}</dd></>}
          {t.cancel_reason && <><dt>Cancel reason</dt><dd>{t.cancel_reason}</dd></>}
          {t.rider_rating && <><dt>Rating</dt><dd><span className="stars" aria-label={`${t.rider_rating} out of 5`}>{Array.from({ length: 5 }, (_, i) => <Icon key={i} name="star" size={16} style={{ fill: i < t.rider_rating ? 'var(--ochre)' : 'none', color: i < t.rider_rating ? 'var(--ochre)' : 'var(--line)' }} />)}</span> {t.rider_feedback}</dd></>}
        </dl>
        {t.parcel && (<>
          <h3 style={{ marginTop: 18 }}>Parcel</h3>
          <dl className="kv">
            <dt>Size</dt><dd>{label(PARCEL_SIZE, t.parcel.size)}, {t.parcel.description}</dd>
            <dt>Sender</dt><dd>{t.parcel.sender_name} {t.parcel.sender_phone}</dd>
            <dt>Recipient</dt><dd>{t.parcel.recipient_name} {t.parcel.recipient_phone}</dd>
            <dt>Delivery PIN</dt><dd>{t.parcel.delivery_pin}</dd>
            <dt>Delivered</dt><dd>{t.parcel.delivered_at ? `${dateTime(t.parcel.delivered_at)} to ${t.parcel.pod_received_by ?? 'recipient'}` : 'Not yet'}</dd>
          </dl>
        </>)}
        <h3 style={{ marginTop: 18 }}>Fare</h3>
        <table className="tbl"><tbody>
          {t.fare_breakdown.lines.map((l: any, i: number) => <tr key={i}><td>{l.label}</td><td className="num">{money(l.cents)}</td></tr>)}
          <tr><td><strong>{t.final_cents != null ? 'Charged' : 'Quoted'}</strong></td><td className="num"><strong>{money(t.final_cents ?? t.quote_cents)}</strong></td></tr>
          {t.tip_cents > 0 && <tr><td>Tip</td><td className="num">{money(t.tip_cents)}</td></tr>}
          {t.cancel_fee_cents > 0 && <tr><td>Cancellation fee</td><td className="num">{money(t.cancel_fee_cents)}</td></tr>}
        </tbody></table>

        <h3 style={{ marginTop: 18 }}>Timeline</h3>
        <ul className="timeline">
          {data.events.map((e: any) => <li key={e.id}><strong>{label(EVENT_TYPE, e.type)}</strong> <span className="dg-muted">{time(e.at)}</span>{e.data?.reason && <span className="sub">{e.data.reason}</span>}</li>)}
        </ul>
        {data.offers.length > 0 && (<>
          <h3 style={{ marginTop: 18 }}>Driver offers</h3>
          <table className="tbl"><tbody>{data.offers.map((o: any) => <tr key={o.driver_id}><td>{o.name}</td><td>{label(OFFER_STATUS, o.status)}</td><td className="num">{time(o.offered_at)}</td></tr>)}</tbody></table>
        </>)}
        {data.payments.length > 0 && (<>
          <h3 style={{ marginTop: 18 }}>Payments</h3>
          <table className="tbl"><tbody>{data.payments.map((p: any) => <tr key={p.id}><td>{label(PAYMENT_KIND, p.kind)}</td><td>{label({ stripe: 'Stripe', mock: 'Test payment', cash: 'Cash', wallet: 'DingoGo credit', corporate: 'Business account' }, p.provider)}</td><td>{label(PAYMENT_STATUS, p.status)}</td><td className="num">{money(p.amount_cents)}</td></tr>)}</tbody></table>
        </>)}
        {(t.final_cents || t.cancel_fee_cents) > 0 && (
          <form className="panel" style={{ marginTop: 18 }} onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => post(`/admin/trips/${id}/refund`, { cents: Math.round(Number(refund.amount) * 100), reason: refund.reason }), 'Refund issued');
            if (r) { setRefund({ amount: '', reason: '' }); void reload(); }
          }}>
            <h3>Refund</h3>
            <div className="form-grid">
              <label className="dg-field"><span>Amount ($)</span><input className="dg-input" type="number" step="0.01" min="0.01" required value={refund.amount} onChange={(e) => setRefund({ ...refund, amount: e.target.value })} /></label>
              <label className="dg-field"><span>Reason (sent to rider)</span><input className="dg-input" required value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} /></label>
            </div>
            <button className="dg-btn dg-btn--sm dg-btn--dark">Issue refund</button>
          </form>
        )}
      </>)}
    </Drawer>
  );
}

function PlacePicker({ label, value, onChange }: { label: string; value: any; onChange: (p: any) => void }) {
  const [q, setQ] = useState(value?.address ?? '');
  const [opts, setOpts] = useState<any[]>([]);
  return (
    <label className="dg-field full" style={{ position: 'relative' }}>
      <span>{label}</span>
      <input className="dg-input" value={q} required placeholder="Search a place in Alice Springs"
        onChange={async (e) => { setQ(e.target.value); onChange(null); setOpts((await get(`/places/search?q=${encodeURIComponent(e.target.value)}`)).places); }}
        onFocus={async () => !opts.length && setOpts((await get(`/places/search?q=${encodeURIComponent(q)}`)).places)} />
      {!value && opts.length > 0 && (
        <div className="panel" style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 5, padding: 4, maxHeight: 220, overflowY: 'auto' }}>
          {opts.map((p) => <button type="button" key={p.name} className="dg-btn dg-btn--ghost dg-btn--sm dg-btn--block" style={{ justifyContent: 'flex-start', border: 'none' }}
            onClick={() => { onChange({ lat: p.lat, lng: p.lng, address: p.name }); setQ(p.name); setOpts([]); }}>{p.name}</button>)}
        </div>
      )}
      {value && <small className="dg-muted">{value.address}</small>}
    </label>
  );
}

function PhoneBooking({ onClose }: { onClose: (id?: string) => void }) {
  const [f, setF] = useState({ phone: '', name: '', service: 'ride', payment_method: 'cash', corporate_account_id: '', passengers: '1', notes: '', scheduled_for: '', assistance_animal: false });
  const [pickup, setPickup] = useState<any>(null);
  const [dropoff, setDropoff] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const accounts = useLoad(() => get('/admin/corporate'));
  const run = useRun();
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!pickup || !dropoff) return setErr('Choose both pickup and drop-off from the list');
    if (f.service.startsWith('courier')) return setErr('Book courier jobs in the customer app (parcel details and recipient PIN are required)');
    const trip: any = { kind: 'ride', service: f.service, pickup, dropoff, payment_method: f.payment_method, passengers: Number(f.passengers), notes: f.notes || undefined, assistance_animal: f.assistance_animal };
    if (f.payment_method === 'corporate') trip.corporate_account_id = f.corporate_account_id;
    if (f.scheduled_for) trip.scheduled_for = new Date(f.scheduled_for).toISOString();
    const r = await run(() => post('/admin/bookings', { phone: f.phone, name: f.name, trip }), 'Booking created');
    if (r) onClose(r.trip.id);
  }
  return (
    <Modal title="New phone booking" onClose={() => onClose()}>
      <p className="dg-muted" style={{ marginTop: 0 }}>For customers who call or walk in. The trip is dispatched like an app booking; payment is cash, DingoGo credit or a business account.</p>
      <form onSubmit={submit}>
        <div className="form-grid">
          <label className="dg-field"><span>Customer mobile</span><input className="dg-input" type="tel" required value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
          <label className="dg-field"><span>Customer name</span><input className="dg-input" required value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
          <PlacePicker label="Pickup" value={pickup} onChange={setPickup} />
          <PlacePicker label="Drop-off" value={dropoff} onChange={setDropoff} />
          <label className="dg-field"><span>Service</span><select className="dg-select" value={f.service} onChange={(e) => setF({ ...f, service: e.target.value })}>{SERVICES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className="dg-field"><span>Passengers</span><input className="dg-input" type="number" min={1} max={4} value={f.passengers} onChange={(e) => setF({ ...f, passengers: e.target.value })} /></label>
          <label className="dg-field"><span>Payment</span><select className="dg-select" value={f.payment_method} onChange={(e) => setF({ ...f, payment_method: e.target.value })}>
            <option value="cash">Cash to driver</option><option value="wallet">DingoGo credit</option><option value="corporate">Business / NDIS account</option></select></label>
          {f.payment_method === 'corporate' && <label className="dg-field"><span>Account</span><select className="dg-select" required value={f.corporate_account_id} onChange={(e) => setF({ ...f, corporate_account_id: e.target.value })}>
            <option value="">Choose…</option>{accounts.data?.items.map((a: any) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>}
          <label className="dg-field"><span>Pickup time (leave blank for now)</span><input className="dg-input" type="datetime-local" value={f.scheduled_for} onChange={(e) => setF({ ...f, scheduled_for: e.target.value })} /></label>
          <label className="dg-check"><input type="checkbox" checked={f.assistance_animal} onChange={(e) => setF({ ...f, assistance_animal: e.target.checked })} /><span>Travelling with an assistance animal</span></label>
          <label className="dg-field full"><span>Note for driver</span><input className="dg-input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        </div>
        <ErrorMsg error={err} />
        <div className="actions"><button className="dg-btn">Book and dispatch</button><button type="button" className="dg-btn dg-btn--ghost" onClick={() => onClose()}>Cancel</button></div>
      </form>
    </Modal>
  );
}
