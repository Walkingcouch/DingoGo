import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, post, money, dateTime, time, km, mins, STATUS_LABEL, COURIER_STATUS_LABEL, statusTone, useLoad, Icon, FileLink } from '@dingogo/shared';
import { DgMap, type MapMarker } from '@dingogo/shared/map';
import { Page } from '../ctx';
import { Chip, Drawer, ErrorMsg, Modal, Table, downloadCsv, downloadFile, useAsk, useRun, useToast, type Col } from '../ui';
import { CHANNEL, COMMS_STATUS, COMMS_TEMPLATE, EVENT_TYPE, LEDGER_KIND, OFFER_STATUS, PARCEL_SIZE, PARCEL_OUTCOME, FAIL_REASON, PAYMENT_KIND, PAYMENT_METHOD, PAYMENT_PROVIDER, PAYMENT_ROW_STATUS, PAYMENT_STATUS, SERVICE_NAME, label } from '../labels';

const SERVICES: [string, string][] = [['ride', 'Ride'], ['pet', 'Pet-friendly'], ['courier_s', 'Courier small'], ['courier_m', 'Courier medium'], ['courier_l', 'Courier large'], ['tour', 'Tour'], ['hourly', 'Hourly hire']];

type Filters = { q: string; status: string; kind: string; from: string; to: string };
const NO_FILTERS: Filters = { q: '', status: '', kind: '', from: '', to: '' };
const SAVED_KEY = 'dingogo.admin.tripFilters';
function loadSaved(): { name: string; f: Filters }[] {
  try { const v = JSON.parse(localStorage.getItem(SAVED_KEY) ?? '[]'); return Array.isArray(v) ? v.slice(0, 20) : []; } catch { return []; }
}
function storeSaved(v: { name: string; f: Filters }[]) { try { localStorage.setItem(SAVED_KEY, JSON.stringify(v)); } catch { /* private window */ } }
const darwinDay = (offset = 0) => new Date(Date.now() + 9.5 * 3600e3 + offset * 864e5).toISOString().slice(0, 10);

export default function Trips() {
  // Filters live in the URL, so a link (or the back button) opens the same view.
  const [params, setParams] = useSearchParams();
  const applied: Filters = { q: params.get('q') ?? '', status: params.get('status') ?? '', kind: params.get('kind') ?? '', from: params.get('from') ?? '', to: params.get('to') ?? '' };
  const key = JSON.stringify(applied);
  const [f, setF] = useState<Filters>(applied);
  useEffect(() => setF(applied), [key]); // eslint-disable-line
  const open = params.get('open');
  const apply = (next: Filters, extra: Record<string, string | null> = {}) => setParams(() => {
    const n = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) if (v) n.set(k, v);
    for (const [k, v] of Object.entries(extra)) if (v) n.set(k, v);
    return n;
  });
  const setOpen = (id: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (id) n.set('open', id); else n.delete('open'); return n; });
  const [booking, setBooking] = useState(false);
  const [saved, setSaved] = useState(loadSaved);
  const run = useRun();
  const ask = useAsk();
  const qs = new URLSearchParams(Object.entries(applied).filter(([, v]) => v)).toString();
  const { data, error, reload } = useLoad(() => get(`/admin/trips?${qs}`), [qs]);
  const filtered = Object.values(applied).some(Boolean);

  async function saveCurrent() {
    const name = await ask({ title: 'Save these filters', label: 'Name', help: 'Kept on this computer. Pick it from “Saved filters” next time.', ok: 'Save' });
    if (!name) return;
    const next = [...saved.filter((x) => x.name !== name), { name: name.slice(0, 40), f: applied }];
    setSaved(next); storeSaved(next);
  }
  const removeSaved = (name: string) => { const next = saved.filter((x) => x.name !== name); setSaved(next); storeSaved(next); };

  const cols: Col<any>[] = [
    { key: 'ref', label: 'Ref', nowrap: true, render: (t) => <strong>{t.ref}</strong> },
    { key: 'status', label: 'Status', render: (t) => <Chip tone={statusTone(t.status)}>{(t.service.startsWith('courier') ? COURIER_STATUS_LABEL : STATUS_LABEL)[t.status] ?? label({}, t.status)}</Chip> },
    { key: 'service', label: 'Service', nowrap: true, render: (t) => label(SERVICE_NAME, t.service) },
    { key: 'when', label: 'When', nowrap: true, render: (t) => dateTime(t.scheduled_for ?? t.requested_at) },
    { key: 'rider_name', label: 'Rider', truncate: 160 },
    { key: 'driver_name', label: 'Driver', truncate: 160, render: (t) => t.driver_name ? <>{t.driver_name}{t.rego && <span className="sub">{t.rego}</span>}</> : <span className="dg-muted">—</span> },
    { key: 'route', label: 'Route', render: (t) => <span className="route" title={`${t.pickup_address} to ${t.dropoff_address}`}><span className="trunc">{t.pickup_address}</span><span className="trunc sub">to {t.dropoff_address}</span></span> },
    { key: 'payment_method', label: 'Payment', nowrap: true, render: (t) => label(PAYMENT_METHOD, t.payment_method) },
    { key: 'final_cents', label: 'Fare', num: true, render: (t) => money(t.final_cents ?? t.quote_cents) },
  ];
  const set = (k: keyof Filters, v: string) => setF({ ...f, [k]: v });

  return (
    <Page title="Trips" right={<>
      <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadCsv(`/admin/export/trips.csv?${new URLSearchParams(Object.entries({ ...applied, from: applied.from || darwinDay(-30), to: applied.to || darwinDay() }).filter(([, v]) => v))}`), 'Export downloaded')}
        title="All trips matching these filters (up to a year; last 30 days if no dates are set)">Export CSV</button>
      <button className="dg-btn dg-btn--sm" onClick={() => setBooking(true)}>New phone booking</button>
    </>}>
      <form className="toolbar" role="search" aria-label="Filter trips" onSubmit={(e) => { e.preventDefault(); apply(f); }}>
        <input className="dg-input" type="search" placeholder="Ref, name, phone, rego or address" value={f.q} onChange={(e) => set('q', e.target.value)} aria-label="Search trips" style={{ minWidth: 200, flex: '1 1 220px', maxWidth: 320 }} />
        <select className="dg-select" value={f.status} onChange={(e) => set('status', e.target.value)} aria-label="Status">
          <option value="">All statuses</option><option value="active">In progress</option><option value="cancelled">Cancelled (any)</option>
          {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="dg-select" value={f.kind} onChange={(e) => set('kind', e.target.value)} aria-label="Type"><option value="">Rides and courier</option><option value="ride">Rides</option><option value="courier">Courier</option></select>
        <label className="inline-field"><span>From</span><input className="dg-input" type="date" value={f.from} onChange={(e) => set('from', e.target.value)} /></label>
        <label className="inline-field"><span>To</span><input className="dg-input" type="date" value={f.to} onChange={(e) => set('to', e.target.value)} /></label>
        <button className="dg-btn dg-btn--sm dg-btn--dark">Search</button>
        {filtered && <button type="button" className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => apply(NO_FILTERS)}>Clear</button>}
      </form>
      <div className="toolbar saved-filters" aria-label="Quick filters" role="group">
        <span className="dg-muted">Quick:</span>
        <button type="button" className="chip-btn" onClick={() => apply({ ...NO_FILTERS, status: 'active' })}>In progress</button>
        <button type="button" className="chip-btn" onClick={() => apply({ ...NO_FILTERS, from: darwinDay(), to: darwinDay() })}>Today</button>
        <button type="button" className="chip-btn" onClick={() => apply({ ...NO_FILTERS, status: 'no_drivers', from: darwinDay(-7) })}>No drivers, 7 days</button>
        <button type="button" className="chip-btn" onClick={() => apply({ ...NO_FILTERS, status: 'scheduled' })}>Booked ahead</button>
        {saved.map((x) => (
          <span key={x.name} className="chip-btn chip-btn--saved">
            <button type="button" onClick={() => apply(x.f)}>{x.name}</button>
            <button type="button" aria-label={`Delete saved filter ${x.name}`} onClick={() => removeSaved(x.name)}><Icon name="x" size={14} /></button>
          </span>
        ))}
        {filtered && <button type="button" className="chip-btn chip-btn--add" onClick={saveCurrent}>Save these filters</button>}
      </div>
      <ErrorMsg error={error} />
      <p className="sr-only" role="status">{data ? `${data.trips.length} trips${data.trips.length >= 100 ? ' shown (newest 100)' : ''}` : ''}</p>
      <Table rows={data?.trips} cols={cols} onRow={(t) => setOpen(t.id)} empty={filtered ? 'No trips match these filters.' : 'No trips yet. Phone bookings and app requests appear here.'} />
      {open && <TripDrawer id={open} onClose={() => { setOpen(null); void reload(); }} />}
      {booking && <PhoneBooking onClose={(id) => { setBooking(false); void reload(); if (id) setOpen(id); }} />}
    </Page>
  );
}

function TripDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, reload } = useLoad(() => get(`/admin/trips/${id}`), [id]);
  const [refund, setRefund] = useState({ amount: '', reason: '' });
  const run = useRun();
  const toast = useToast();
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
          {(t.has_pet || t.assistance_animal || t.needs_wheelchair || t.women_driver_pref || t.rider?.needs) && <><dt>Needs</dt><dd>{[t.has_pet && 'Pet', t.assistance_animal && 'Assistance animal', t.needs_wheelchair && 'Wheelchair', t.women_driver_pref && 'Female driver preferred',
            t.rider?.needs?.hearing && 'Deaf or hard of hearing', t.rider?.needs?.vision && 'Blind or low vision', t.rider?.needs?.mobility && 'Mobility aid', t.rider?.needs?.notes && `“${t.rider.needs.notes}”`].filter(Boolean).join(', ')}</dd></>}
          {t.ndis_number && <><dt>NDIS no.</dt><dd>{t.ndis_number}</dd></>}
          {t.notes && <><dt>Notes</dt><dd>{t.notes}</dd></>}
          {t.cancel_reason && <><dt>Cancel reason</dt><dd>{t.cancel_reason}</dd></>}
          {t.rider_rating && <><dt>Rating</dt><dd><span className="stars" role="img" aria-label={`${t.rider_rating} out of 5`}>{Array.from({ length: 5 }, (_, i) => <Icon key={i} name="star" size={16} style={{ fill: i < t.rider_rating ? 'var(--ochre)' : 'none', color: i < t.rider_rating ? 'var(--ochre)' : 'var(--line)' }} />)}</span> {t.rider_feedback}</dd></>}
        </dl>
        {t.parcel && (<>
          <h3 style={{ marginTop: 18 }}>Parcel</h3>
          <dl className="kv">
            <dt>Size</dt><dd>{label(PARCEL_SIZE, t.parcel.size)}, {t.parcel.description}</dd>
            <dt>Sender</dt><dd>{t.parcel.sender_name} {t.parcel.sender_phone}</dd>
            <dt>Recipient</dt><dd>{t.parcel.recipient_name} {t.parcel.recipient_phone}</dd>
            <dt>Delivery PIN</dt><dd>{t.parcel.delivery_pin}</dd>
            <dt>Delivered</dt><dd>{t.parcel.delivered_at ? `${dateTime(t.parcel.delivered_at)} to ${t.parcel.pod_received_by ?? 'recipient'}` : 'Not yet'}{t.parcel.pod_photo_url && <> · <FileLink href={t.parcel.pod_photo_url}>Delivery photo</FileLink></>}</dd>
            {t.parcel.customer_ref && <><dt>Sender's reference</dt><dd>{t.parcel.customer_ref}</dd></>}
            {t.batch && <><dt>Run</dt><dd>{t.batch.ref}, drop {t.batch_seq} of {t.batch.stops.length}: {t.batch.stops.map((x: any) => `${x.ref} ${label(PARCEL_OUTCOME, x.outcome ?? x.status)}`).join(', ')}</dd></>}
            {t.pickup_window_end && <><dt>Pickup window</dt><dd>{dateTime(t.scheduled_for)} to {dateTime(t.pickup_window_end)}</dd></>}
            {(t.parcel.safe_place || t.parcel.recipient_notes) && <><dt>Safe place / notes</dt><dd>{[t.parcel.safe_place, t.parcel.recipient_notes && `Recipient: ${t.parcel.recipient_notes}`].filter(Boolean).join(' · ')}</dd></>}
            {t.parcel.outcome && <><dt>Outcome</dt><dd>{label(PARCEL_OUTCOME, t.parcel.outcome)}{t.parcel.failed_reason ? `: ${label(FAIL_REASON, t.parcel.failed_reason)}` : ''}{t.parcel.failed_note ? ` (${t.parcel.failed_note})` : ''}
              {t.parcel.failed_photo_url && <> · <FileLink href={t.parcel.failed_photo_url}>Photo</FileLink></>}{t.parcel.pod_distance_m != null ? ` · handed over ${t.parcel.pod_distance_m} m from the address` : ''}</dd></>}
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
        {data.messages?.length > 0 && (<>
          <h3 style={{ marginTop: 18 }}>Messages</h3>
          <p className="dg-muted" style={{ margin: '0 0 6px', fontSize: 'var(--fs-sm)' }}>Kept with the trip as a safety record.</p>
          <ul className="timeline">
            {data.messages.map((m: any) => <li key={m.id}><strong>{m.sender_role === 'dingogo' ? `DingoGo (${m.sender_name ?? 'staff'})` : m.sender_role === 'driver' ? 'Driver' : 'Rider'}</strong>{' '}
              <span className="dg-muted">{time(m.created_at)}{m.via === 'sms' ? ', by text' : ''}{m.read_at ? ', read' : ''}</span><span className="sub">{m.body}</span></li>)}
          </ul>
        </>)}
        {(live || data.messages?.length > 0) && data.trip.driver_id && <StaffMessage tripId={id} onSent={() => void reload()} />}
        {data.comms?.length > 0 && (<>
          <h3 style={{ marginTop: 18 }}>Texts and calls</h3>
          <table className="tbl"><tbody>{data.comms.map((c: any) => <tr key={c.id}><td>{label(COMMS_TEMPLATE, c.template ?? c.channel)}{c.to_tail && <span className="sub">to …{c.to_tail}</span>}</td>
            <td>{label(COMMS_STATUS, c.status)}{c.error && <span className="sub">{c.error}</span>}</td><td className="num">{time(c.at)}</td></tr>)}</tbody></table>
        </>)}
        {data.offers.length > 0 && (<>
          <h3 style={{ marginTop: 18 }}>Driver offers</h3>
          <table className="tbl"><tbody>{data.offers.map((o: any) => <tr key={o.driver_id}><td>{o.name}</td><td>{label(OFFER_STATUS, o.status)}</td><td className="num">{time(o.offered_at)}</td></tr>)}</tbody></table>
        </>)}
        {data.payments.length > 0 && (<>
          <h3 style={{ marginTop: 18 }}>Payments</h3>
          <table className="tbl"><tbody>{data.payments.map((p: any) => <tr key={p.id}><td>{label(PAYMENT_KIND, p.kind)}</td><td>{label(PAYMENT_PROVIDER, p.provider)}{p.provider === 'stripe' && p.provider_ref && <span className="sub">{p.provider_ref}</span>}</td><td>{label(PAYMENT_ROW_STATUS, p.status)}</td><td className="num">{money(p.amount_cents)}</td></tr>)}</tbody></table>
        </>)}
        {t.payment_status === 'failed' && t.payment_method === 'card' && (
          <div className="panel" style={{ marginTop: 18 }}>
            <h3>Payment failed</h3>
            <p className="dg-muted">The card payment for this trip didn't go through. The rider has been asked to pay in the app. Retry charges their current default card.</p>
            <button className="dg-btn dg-btn--sm dg-btn--dark" onClick={async () => {
              const r: any = await run(() => post(`/admin/trips/${id}/retry-payment`));
              if (r) { toast(r.ok ? 'Payment taken' : (r.error ?? 'The card was declined again'), !r.ok); void reload(); }
            }}>Retry charge</button>
          </div>
        )}
        {data.driver_ledger?.length > 0 && (<>
          <h3 style={{ marginTop: 18 }}>Driver pay</h3>
          <table className="tbl"><tbody>
            {data.driver_ledger.map((l: any) => <tr key={l.id}><td>{label(LEDGER_KIND, l.kind)}{l.note && <span className="sub">{l.note}</span>}</td><td className="num">{money(l.amount_cents)}</td></tr>)}
            <tr><td><strong>Driver total</strong></td><td className="num"><strong>{money(data.driver_ledger.filter((l: any) => l.kind !== 'cash_collected').reduce((s: number, l: any) => s + l.amount_cents, 0))}</strong></td></tr>
          </tbody></table>
        </>)}
        {t.kind === 'ride' && ['accepted', 'arrived', 'in_progress'].includes(t.status) && (
          <div className="panel" style={{ marginTop: 18 }}>
            <h3>Check on the rider</h3>
            <p className="dg-muted">Sends "Are you OK?" to the rider's phone. No answer in a few minutes raises an emergency alert.</p>
            <button className="dg-btn dg-btn--sm dg-btn--dark" onClick={async () => { const r = await run(() => post(`/admin/trips/${id}/check-in`), 'Asked the rider'); if (r) void reload(); }}>Ask "Are you OK?"</button>
          </div>
        )}
        {t.status === 'no_drivers' && (
          <div className="panel" style={{ marginTop: 18 }}>
            <h3>No driver found</h3>
            <p className="dg-muted">Search again takes the payment again (card hold, credit or points) and looks for a driver for another few minutes.</p>
            <button className="dg-btn dg-btn--sm dg-btn--dark" onClick={async () => { const r = await run(() => post(`/admin/trips/${id}/redispatch`), 'Searching again'); if (r) void reload(); }}>Search again</button>
          </div>
        )}
        {(t.final_cents || t.cancel_fee_cents) > 0 && (
          <div className="panel" style={{ marginTop: 18 }}>
            <h3>Chargeback evidence</h3>
            <p className="dg-muted">Timeline, PIN or delivery proof, GPS track, chat, receipt and payments, for a bank dispute. Downloading is recorded.</p>
            <div className="actions">
              <button type="button" className="dg-btn dg-btn--sm dg-btn--dark" onClick={() => run(() => downloadFile(`/admin/trips/${id}/evidence-pack?format=pdf`), 'Evidence pack downloaded')}>Evidence pack (PDF)</button>
              <button type="button" className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadFile(`/admin/trips/${id}/evidence-pack?format=json`), 'Evidence pack downloaded')}>JSON</button>
            </div>
          </div>
        )}
        {(t.final_cents || t.cancel_fee_cents) > 0 && (
          <form className="panel" style={{ marginTop: 18 }} onSubmit={async (e) => {
            e.preventDefault();
            const r = await run(() => post(`/admin/trips/${id}/refund`, { cents: Math.round(Number(refund.amount) * 100), reason: refund.reason }), 'Refund issued');
            if (r) { setRefund({ amount: '', reason: '' }); void reload(); }
          }}>
            <h3>Refund</h3>
            {(() => {
              const paid = (t.final_cents ?? t.cancel_fee_cents ?? 0) + (t.tip_cents ?? 0);
              const refunded = -data.payments.filter((p: any) => p.kind === 'refund' && p.status === 'succeeded').reduce((s: number, p: any) => s + p.amount_cents, 0);
              return <p className="dg-muted">Paid {money(paid)}{refunded > 0 ? ` · refunded ${money(refunded)}` : ''} · up to {money(Math.max(paid - refunded, 0))} can be refunded</p>;
            })()}
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

/** DingoGo can write into the trip chat (rider and driver both see it), e.g. after a route-deviation alert. */
function StaffMessage({ tripId, onSent }: { tripId: string; onSent: () => void }) {
  const [text, setText] = useState('');
  const run = useRun();
  return (
    <form className="toolbar" style={{ marginTop: 8 }} onSubmit={async (e) => {
      e.preventDefault();
      if (!text.trim()) return;
      const r = await run(() => post(`/trips/${tripId}/messages`, { body: text.trim() }), 'Message sent to rider and driver');
      if (r) { setText(''); onSent(); }
    }}>
      <input className="dg-input" maxLength={500} value={text} onChange={(e) => setText(e.target.value)} aria-label="Message to rider and driver" placeholder="Message rider and driver as DingoGo" style={{ flex: 1, minWidth: 200 }} />
      <button className="dg-btn dg-btn--sm dg-btn--dark">Send</button>
    </form>
  );
}
