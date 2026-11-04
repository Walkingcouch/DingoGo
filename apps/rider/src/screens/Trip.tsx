import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Icon,
  ApiError, REALTIME, COURIER_STATUS_LABEL, STATUS_LABEL, connectRealtime, date, dateTime, get, km, money, post, statusTone, time, useInterval, Ranges,
} from '@dingogo/shared';
import { DgMap, type MapMarker } from '@dingogo/shared/map';
import { ACTIVE, shareUrl, useMe } from '../ctx';
import { Dialog, Spinner, Stars, shareOrCopy, useCopy } from '../components/ui';

const RIDE_STEPS = ['requested', 'accepted', 'arrived', 'in_progress', 'completed'];

export function TripScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  const { reload: reloadMe } = useMe();
  const [trip, setTrip] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [carPos, setCarPos] = useState<{ lat: number; lng: number; heading?: number | null } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await get(`/trips/${id}`);
      setTrip(r.trip); setErr(null);
      if (r.trip.driver?.lat) setCarPos((p) => p ?? { lat: r.trip.driver.lat, lng: r.trip.driver.lng, heading: r.trip.driver.heading });
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not load trip'); }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  const live = trip && ACTIVE.includes(trip.status);
  useEffect(() => {
    if (!id) return;
    const rt = connectRealtime((m) => {
      if (m.type === 'driver.location' && m.data.trip_id === id) setCarPos({ lat: m.data.lat, lng: m.data.lng, heading: m.data.heading });
      if (m.type === 'trip.updated' && m.data.id === id) void load();
    }, { subscribe: [`trip:${id}`] });
    return () => rt.close();
  }, [id, load]);
  useInterval(() => void load(), live ? (REALTIME ? 10000 : 4000) : null);
  useEffect(() => { if (trip?.status === 'completed') void reloadMe(); }, [trip?.status]); // eslint-disable-line

  if (err) return <div className="page"><p className="dg-error">{err}</p><Link to="/" className="dg-btn">Back to home</Link></div>;
  if (!trip) return <div className="page"><Spinner label="Loading trip" /></div>;

  if (live) return <LiveTrip trip={trip} carPos={carPos} reload={load} onClose={() => nav('/')} />;
  return <TripDetail trip={trip} reload={load} />;
}

function LiveTrip({ trip, carPos, reload, onClose }: { trip: any; carPos: any; reload: () => Promise<void>; onClose: () => void }) {
  const labels = trip.kind === 'courier' ? COURIER_STATUS_LABEL : STATUS_LABEL;
  const [sosOpen, setSosOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const { copy, copied } = useCopy();
  const step = RIDE_STEPS.indexOf(trip.status);

  const markers: MapMarker[] = [
    { id: 'p', kind: 'pickup', lat: trip.pickup_lat, lng: trip.pickup_lng, label: trip.pickup_address },
    ...(trip.service !== 'tour' ? [{ id: 'd', kind: 'dropoff' as const, lat: trip.dropoff_lat, lng: trip.dropoff_lng, label: trip.dropoff_address }] : []),
    ...(carPos ? [{ id: 'car', kind: 'car' as const, ...carPos, label: trip.vehicle?.rego }] : []),
  ];
  const v = trip.vehicle;
  const d = trip.driver;
  const sub = trip.status === 'requested'
    ? `We're asking the nearest driver. This usually takes under a minute.`
    : trip.status === 'accepted' ? (trip.kind === 'courier' ? 'Heading to collect your parcel.' : 'Heading to your pickup.')
    : trip.status === 'arrived' ? (trip.kind === 'courier' ? 'Driver is at the pickup.' : `Look for ${v?.colour ?? ''} ${v?.make ?? ''} ${v?.model ?? ''}, rego ${v?.rego ?? ''}.`)
    : trip.kind === 'courier' ? `On its way to ${trip.dropoff_address}.` : `On the way to ${trip.dropoff_address}.`;

  return (
    <div className="live">
      <div className="live__map">
        <DgMap markers={markers} padding={70} />
        <button className="iconbtn iconbtn--float" style={{ left: 12 }} onClick={onClose} aria-label="Back to home">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <button className="sos" onClick={() => setSosOpen(true)} aria-haspopup="dialog">SOS</button>
      </div>
      <div className="sheet sheet--live">
        <div className="sheet__grab" aria-hidden="true" />
        <p className="live__ref dg-muted">{trip.ref}</p>
        <h1 className="live__status" aria-live="polite">{labels[trip.status]}</h1>
        <p className="live__sub">{sub}</p>

        <ol className="steps" aria-label="Trip progress">
          {RIDE_STEPS.slice(0, 4).map((s, i) => (
            <li key={s} className={i < step ? 'is-done' : i === step ? 'is-now' : ''}><span className="sr-only">{labels[s]}{i === step ? ' (current)' : ''}</span></li>
          ))}
        </ol>

        {trip.status === 'requested' && <div className="searching" aria-hidden="true"><span /><span /><span /></div>}

        {trip.kind === 'ride' && trip.verify_pin && ['accepted', 'arrived'].includes(trip.status) && (
          <div className="pin">
            <div>
              <strong>Your trip PIN</strong>
              <p className="dg-muted">Tell the driver this PIN before you get in. If they don't ask, check the rego matches.</p>
            </div>
            <span className="pin__n" aria-label={`PIN ${trip.verify_pin.split('').join(' ')}`}>{trip.verify_pin}</span>
          </div>
        )}

        {d && (
          <div className="driver">
            <div className="driver__av" aria-hidden="true">{d.name?.[0]}</div>
            <div className="driver__info">
              <strong>{d.name}</strong>
              <span className="dg-muted">{d.rating ? <><Icon name="star" size={14} /> {Number(d.rating).toFixed(1)}</> : 'New driver'}{d.languages?.length ? `, speaks ${d.languages.map(langName).join(' and ')}` : ''}</span>
              {v && <span>{v.colour} {v.make} {v.model}</span>}
            </div>
            {v && (
              <div className="driver__car">
                <span className="rego">{v.rego}</span>
                {v.battery_pct != null && <span className="dg-chip dg-chip--green"><Icon name="battery" size={14} /> {v.battery_pct}%</span>}
              </div>
            )}
          </div>
        )}

        {trip.kind === 'courier' && trip.parcel && (
          <div className="callout callout--dusk" style={{ marginTop: '.8rem' }}>
            <strong>{trip.parcel.description}</strong> for {trip.parcel.recipient_name}. We've texted them a tracking link and a delivery PIN.
          </div>
        )}

        <div className="live__actions">
          <button className="dg-btn dg-btn--ghost" onClick={() => shareOrCopy({ title: 'My DingoGo trip', text: `Follow my DingoGo trip ${trip.ref}:`, url: shareUrl(trip.share_token) }, copy)}>
            {copied ? 'Link copied' : 'Share my trip'}
          </button>
          {trip.status !== 'in_progress' && <button className="dg-btn dg-btn--ghost" onClick={() => setCancelOpen(true)}>Cancel</button>}
        </div>
        <dl className="kv">
          <div><dt>From</dt><dd>{trip.pickup_address}</dd></div>
          {trip.service !== 'tour' && <div><dt>To</dt><dd>{trip.dropoff_address}</dd></div>}
          <div><dt>Price</dt><dd className="dg-money">{money(trip.quote_cents)} <span className="dg-muted">({payLabel(trip.payment_method)})</span></dd></div>
        </dl>
      </div>
      <SosDialog open={sosOpen} onClose={() => setSosOpen(false)} trip={trip} />
      <CancelDialog open={cancelOpen} onClose={() => setCancelOpen(false)} trip={trip} onDone={reload} />
    </div>
  );
}

const LANGS: Record<string, string> = { en: 'English', arr: 'Arrernte', wbp: 'Warlpiri', pjt: 'Pitjantjatjara', luritja: 'Luritja' };
const langName = (l: string) => LANGS[l.toLowerCase()] ?? l;

export const payLabel = (m: string) => ({ card: 'card', cash: 'cash', wallet: 'DingoGo credit', corporate: 'business account' } as Record<string, string>)[m] ?? m;

function SosDialog({ open, onClose, trip }: { open: boolean; onClose: () => void; trip: any }) {
  const [state, setState] = useState<'confirm' | 'sending' | 'sent' | 'error'>('confirm');
  const [res, setRes] = useState<any>(null);
  useEffect(() => { if (open) setState('confirm'); }, [open]);

  async function send() {
    setState('sending');
    const pos: any = await new Promise((r) => {
      if (!navigator.geolocation) return r({});
      navigator.geolocation.getCurrentPosition((p) => r({ lat: p.coords.latitude, lng: p.coords.longitude }), () => r({}), { timeout: 4000 });
    });
    try { setRes(await post(`/trips/${trip.id}/sos`, pos)); setState('sent'); } catch { setState('error'); }
  }

  return (
    <Dialog open={open} onClose={onClose} title={state === 'sent' ? 'Help is being alerted' : 'Emergency help'}>
      {state === 'confirm' && (
        <>
          <p>If you're in danger, call Triple Zero now. You can also alert the DingoGo safety team, who will see your live location and contact you.</p>
          <a className="dg-btn dg-btn--danger dg-btn--block sos-call" href="tel:000">Call 000</a>
          <button className="dg-btn dg-btn--dark dg-btn--block" style={{ marginTop: 10 }} onClick={send}>Alert DingoGo safety team</button>
          <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 10 }} onClick={onClose}>I'm OK, go back</button>
        </>
      )}
      {state === 'sending' && <Spinner label="Sending alert" />}
      {state === 'sent' && (
        <>
          <p><strong>Our safety team has your trip, driver and location.</strong> If you set an emergency contact, we've texted them your live trip link too.</p>
          <a className="dg-btn dg-btn--danger dg-btn--block sos-call" href={`tel:${res?.emergency_number ?? '000'}`}>Call {res?.emergency_number ?? '000'}</a>
          <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>Stay on the line with 000 if you can. Keep this screen open.</p>
          <button className="dg-btn dg-btn--ghost dg-btn--block" onClick={onClose}>Close</button>
        </>
      )}
      {state === 'error' && (
        <>
          <p className="dg-error">The alert didn't send, probably no signal. Call 000 directly.</p>
          <a className="dg-btn dg-btn--danger dg-btn--block sos-call" href="tel:000">Call 000</a>
          <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 10 }} onClick={send}>Try the alert again</button>
        </>
      )}
    </Dialog>
  );
}

function CancelDialog({ open, onClose, trip, onDone }: { open: boolean; onClose: () => void; trip: any; onDone: () => Promise<void> }) {
  const [fee, setFee] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    get('/public/config').then((c) => setFee(c.services.find((s: any) => s.service === trip.service)?.cancel_fee_cents ?? null)).catch(() => {});
  }, [open, trip.service]);
  const assigned = !!trip.driver_id;
  const sinceAccept = trip.accepted_at ? (Date.now() - new Date(trip.accepted_at).getTime()) / 1000 : 0;
  const likelyFee = assigned && (trip.status === 'arrived' || sinceAccept > 120);

  async function go() {
    setBusy(true); setErr(null);
    try { await post(`/trips/${trip.id}/cancel`, { reason: 'Rider cancelled in app' }); onClose(); await onDone(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not cancel'); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Cancel this trip?">
      {!assigned && <p>No driver has been assigned yet, so there's no charge.</p>}
      {assigned && !likelyFee && <p>Your driver is on the way. You can cancel free within 2 minutes of them accepting.</p>}
      {likelyFee && <p className="callout callout--earth">A cancellation fee of <strong>{money(fee ?? 600)}</strong> applies because your driver {trip.status === 'arrived' ? 'is already waiting for you' : 'has been driving to you for more than 2 minutes'}. Most of it goes to the driver.</p>}
      {err && <p className="dg-error">{err}</p>}
      <button className="dg-btn dg-btn--danger dg-btn--block" disabled={busy} onClick={go}>{busy ? 'Cancelling…' : likelyFee ? `Cancel and pay ${money(fee ?? 600)}` : 'Cancel trip'}</button>
      <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 10 }} onClick={onClose}>Keep my trip</button>
    </Dialog>
  );
}

function TripDetail({ trip, reload }: { trip: any; reload: () => Promise<void> }) {
  const labels = trip.kind === 'courier' ? COURIER_STATUS_LABEL : STATUS_LABEL;
  const [cancelOpen, setCancelOpen] = useState(false);
  const done = trip.status === 'completed';
  const markers: MapMarker[] = [
    { id: 'p', kind: 'pickup', lat: trip.pickup_lat, lng: trip.pickup_lng },
    ...(trip.service !== 'tour' ? [{ id: 'd', kind: 'dropoff' as const, lat: trip.dropoff_lat, lng: trip.dropoff_lng }] : []),
  ];
  return (
    <div className="page detail">
      <header className="page__head">
        <Link to="/trips" className="iconbtn" aria-label="Back to trips"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 5l-7 7 7 7" /></svg></Link>
        <h1>{done ? (trip.kind === 'courier' ? 'Delivered' : 'Thanks for riding') : labels[trip.status]}</h1>
      </header>
      <div className="detail__map"><DgMap markers={markers} route={trip.service !== 'tour' ? [{ lat: trip.pickup_lat, lng: trip.pickup_lng }, { lat: trip.dropoff_lat, lng: trip.dropoff_lng }] : null} padding={30} /></div>
      <p className="dg-muted" style={{ margin: '.8rem 0 0' }}>{trip.ref}, {dateTime(trip.scheduled_for ?? trip.requested_at)} <span className={`dg-chip dg-chip--${statusTone(trip.status)}`}>{labels[trip.status]}</span></p>
      <dl className="kv">
        <div><dt>From</dt><dd>{trip.pickup_address}</dd></div>
        {trip.service !== 'tour' && <div><dt>To</dt><dd>{trip.dropoff_address}</dd></div>}
        {trip.driver && <div><dt>Driver</dt><dd>{trip.driver.name}{trip.vehicle ? `, ${trip.vehicle.rego}` : ''}</dd></div>}
        {trip.parcel?.pod_received_by && <div><dt>Received by</dt><dd>{trip.parcel.pod_received_by}, {time(trip.parcel.delivered_at)}</dd></div>}
        <div><dt>{done ? 'Paid' : 'Price'}</dt><dd className="dg-money">{money(trip.final_cents ?? trip.quote_cents)} <span className="dg-muted">({payLabel(trip.payment_method)})</span></dd></div>
        {trip.cancel_fee_cents > 0 && <div><dt>Cancellation fee</dt><dd className="dg-money">{money(trip.cancel_fee_cents)}</dd></div>}
      </dl>

      {trip.status === 'scheduled' && (
        <>
          <div className="callout callout--green">We'll start finding your driver 15 minutes before {time(trip.scheduled_for)} on {date(trip.scheduled_for)} and send you a notification.</div>
          <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 12 }} onClick={() => setCancelOpen(true)}>Cancel booking</button>
          <CancelDialog open={cancelOpen} onClose={() => setCancelOpen(false)} trip={trip} onDone={reload} />
        </>
      )}
      {trip.status === 'no_drivers' && <div className="callout callout--earth">No car was free for this trip, so you haven't been charged. Try again in a few minutes, or call us to book ahead.</div>}
      {done && <AfterTrip trip={trip} reload={reload} />}
      {(done || trip.cancel_fee_cents > 0) && <Receipt tripId={trip.id} />}
      <Link className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 16 }} to={`/account/help?trip=${trip.id}`}>Get help with this trip</Link>
    </div>
  );
}

function AfterTrip({ trip, reload }: { trip: any; reload: () => Promise<void> }) {
  const [rating, setRating] = useState(trip.rider_rating ?? 0);
  const [feedback, setFeedback] = useState('');
  const [rated, setRated] = useState(!!trip.rider_rating);
  const [tipBusy, setTipBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function rate() {
    setErr(null);
    try { await post(`/trips/${trip.id}/rate`, { rating, feedback: feedback || undefined }); setRated(true); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not save rating'); }
  }
  async function tip(cents: number) {
    setTipBusy(true); setErr(null);
    try { await post(`/trips/${trip.id}/tip`, { cents }); await reload(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not add tip'); }
    finally { setTipBusy(false); }
  }
  const first = trip.driver?.name?.split(' ')[0] ?? 'your driver';

  return (
    <section className="after">
      {!rated ? (
        <>
          <h2>How was your trip with {first}?</h2>
          <Stars value={rating} onChange={setRating} />
          {rating > 0 && (
            <>
              <label className="dg-field" style={{ marginTop: '.8rem' }}><span>{rating >= 4 ? 'Anything you liked?' : 'What could be better?'} (optional)</span>
                <textarea className="dg-textarea" value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={500} /></label>
              <button className="dg-btn dg-btn--dark" onClick={rate}>Send rating</button>
            </>
          )}
        </>
      ) : <p className="callout callout--green">Thanks for rating {first}.</p>}
      {trip.kind === 'ride' && trip.driver && (
        trip.tip_cents > 0 ? <p className="dg-muted">You tipped {money(trip.tip_cents)}. All of it goes to {first}.</p> : (
          <div className="tips">
            <h3>Add a tip for {first}</h3>
            <p className="dg-muted" style={{ marginTop: 0, fontSize: 'var(--fs-sm)' }}>100% goes to the driver.</p>
            <div className="tips__row">
              {[200, 500, 1000].map((c) => <button key={c} className="dg-btn dg-btn--ghost" disabled={tipBusy} onClick={() => tip(c)}>{money(c)}</button>)}
            </div>
          </div>
        )
      )}
      {err && <p className="dg-error">{err}</p>}
    </section>
  );
}

export function Receipt({ tripId }: { tripId: string }) {
  const [r, setR] = useState<any | null>(null);
  useEffect(() => { get(`/trips/${tripId}/receipt`).then((x) => setR(x.receipt)).catch(() => {}); }, [tripId]);
  if (!r) return null;
  return (
    <details className="receipt">
      <summary>Tax invoice</summary>
      <div className="receipt__body">
        <p><strong>{r.supplier?.name ?? 'DingoGo'}</strong><br />ABN {r.supplier?.abn ?? 'TBC'}<br />{r.supplier?.address}</p>
        <p className="dg-muted">Trip {r.trip_ref}, {dateTime(r.date)}<br />{r.from}{r.to && r.to !== r.from ? ` to ${r.to}` : ''}<br />{r.driver ? `Driver ${r.driver}, ${r.vehicle}` : ''}</p>
        <table className="quote__lines">
          <tbody>
            {r.lines.map((l: any, i: number) => <tr key={i}><td>{l.label}</td><td className="dg-money">{money(l.cents)}</td></tr>)}
            {r.tip_cents > 0 && <tr><td>Tip (not subject to GST)</td><td className="dg-money">{money(r.tip_cents)}</td></tr>}
            <tr className="quote__sum"><td>Total paid ({payLabel(r.payment_method)})</td><td className="dg-money">{money(r.total_cents)}</td></tr>
            <tr><td>Includes GST</td><td className="dg-money">{money(r.gst_cents)}</td></tr>
          </tbody>
        </table>
        <p className="co2"><Icon name="leaf" size={18} style={{ color: 'var(--saltbush)' }} /> {km(r.distance_km * 1000)} electric. About {r.co2_saved_kg} kg of CO₂ not burned compared with a petrol car.</p>
        <button className="dg-btn dg-btn--ghost dg-btn--sm" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      <Ranges height={18} fill="var(--line)" />
    </details>
  );
}
