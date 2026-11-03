import { useEffect, useState } from 'react';
import { ApiError, get, km, money, post, uploadFile } from '@dingogo/shared';
import { DgMap, type MapMarker } from '@dingogo/shared/map';
import { useDriver } from '../state';
import { SignaturePad } from './SignaturePad';

const mapsLinks = (lat: number, lng: number) => ({
  google: `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}&travelmode=driving`,
  apple: `https://maps.apple.com/?daddr=${lat},${lng}&dirflg=d`,
});

const CANCEL_REASONS: [string, string][] = [
  ['rider_no_show', 'Passenger didn’t show'],
  ['unsafe', 'I feel unsafe'],
  ['parcel_prohibited', 'Parcel looks prohibited (alcohol, weapons…)'],
  ['vehicle_issue', 'Problem with the car'],
  ['rider_requested', 'Passenger asked to cancel'],
  ['other', 'Something else'],
];

export function ActiveTrip() {
  const { trip, setTrip, reloadTrip, pos, reloadMe, showToast } = useDriver();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  const [support, setSupport] = useState<string | null>(null);
  const t = trip;
  const isCourier = t.kind === 'courier';
  const parcel = t.parcel;

  useEffect(() => { get('/public/config').then((c) => setSupport(c.support?.phone ?? null)).catch(() => undefined); }, []);
  useEffect(() => { setError(null); setPin(''); }, [t.status]);

  async function act(path: string, body?: unknown) {
    setBusy(true); setError(null);
    try { const r = await post(`/driver/trips/${t.id}/${path}`, body); setTrip(r.trip); return r; }
    catch (e) { setError(e instanceof ApiError ? e.message : 'No connection — try again'); }
    finally { setBusy(false); }
  }

  const done = ['completed', 'cancelled_rider', 'cancelled_driver', 'cancelled_admin', 'no_drivers'].includes(t.status);
  if (done) return <TripDone onClose={() => { setTrip(null); void reloadMe(); void reloadTrip(); }} />;

  const target = t.status === 'in_progress' ? { lat: t.dropoff_lat, lng: t.dropoff_lng, address: t.dropoff_address } : { lat: t.pickup_lat, lng: t.pickup_lng, address: t.pickup_address };
  const links = mapsLinks(target.lat, target.lng);
  const markers: MapMarker[] = [
    ...(pos ? [{ id: 'me', kind: 'car' as const, lat: pos.lat, lng: pos.lng, heading: pos.heading }] : []),
    ...(t.status !== 'in_progress' ? [{ id: 'p', kind: 'pickup' as const, lat: t.pickup_lat, lng: t.pickup_lng }] : []),
    { id: 'd', kind: 'dropoff' as const, lat: t.dropoff_lat, lng: t.dropoff_lng },
  ];

  const stageTitle = {
    accepted: isCourier ? 'Head to pickup' : `Pick up ${t.rider?.name?.split(' ')[0] ?? 'passenger'}`,
    arrived: isCourier ? 'Collect the parcel' : 'Check the PIN',
    in_progress: isCourier ? 'Deliver the parcel' : 'Drive to drop-off',
  }[t.status as 'accepted' | 'arrived' | 'in_progress'] ?? t.status;

  return (
    <div className="trip">
      <div style={{ position: 'relative', minHeight: 0 }}>
        <DgMap markers={markers} padding={50} />
        <button className="sos" onClick={() => setSosOpen(true)}>SOS</button>
      </div>
      <section className="trip-sheet" aria-live="polite">
        <p className="dg-muted" style={{ margin: 0, fontSize: 'var(--fs-sm)' }}>{t.ref}{t.payment_method === 'cash' ? `, cash fare ${money(t.quote_cents)}` : ''}</p>
        <h1 className="stage">{stageTitle}</h1>
        <p className="addr">{target.address}</p>

        {t.status !== 'arrived' && (
          <div className="btn-row" style={{ margin: '14px 0' }}>
            <a className="dg-btn dg-btn--dark" href={links.google} target="_blank" rel="noreferrer">Google Maps</a>
            <a className="dg-btn dg-btn--ghost" href={links.apple} target="_blank" rel="noreferrer">Apple Maps</a>
          </div>
        )}

        <TripFlags t={t} />

        {t.status === 'accepted' && (
          <button className="dg-btn dg-btn--block btn-xl" onClick={() => act('arrive')} disabled={busy}>{busy ? 'Updating…' : 'I’ve arrived'}</button>
        )}

        {t.status === 'arrived' && !isCourier && (
          <form onSubmit={(e) => { e.preventDefault(); void act('start', { pin }); }}>
            <label className="dg-field"><span>Ask the passenger for their 4-digit PIN</span>
              <input className="dg-input pin-input" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoComplete="off" aria-describedby="pin-help" />
            </label>
            <p id="pin-help" className="dg-muted" style={{ marginTop: 0, fontSize: 'var(--fs-sm)' }}>Matching PINs means you've got the right person.</p>
            <button className="dg-btn dg-btn--block btn-xl" disabled={busy || pin.length !== 4}>{busy ? 'Starting…' : 'Start trip'}</button>
          </form>
        )}

        {t.status === 'arrived' && isCourier && (
          <>
            {parcel && <ParcelInfo p={parcel} />}
            <p className="dg-note">Check the parcel. Refuse alcohol, weapons, drugs or dangerous goods — cancel with "Parcel looks prohibited".</p>
            <button className="dg-btn dg-btn--block btn-xl" onClick={() => act('start')} disabled={busy}>{busy ? 'Updating…' : 'Parcel collected'}</button>
          </>
        )}

        {t.status === 'in_progress' && !isCourier && (
          <button className="dg-btn dg-btn--green dg-btn--block btn-xl" onClick={() => act('complete', { lat: pos?.lat, lng: pos?.lng })} disabled={busy}>{busy ? 'Finishing…' : 'Complete trip'}</button>
        )}

        {t.status === 'in_progress' && isCourier && <ProofOfDelivery parcel={parcel} busy={busy} onSubmit={(b) => act('complete', { ...b, lat: pos?.lat, lng: pos?.lng })} />}

        {error && <p className="dg-error" role="alert" style={{ marginTop: 12 }}>{error}</p>}

        {(t.status === 'accepted' || t.status === 'arrived') && (
          <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 12 }} onClick={() => setCancelOpen(true)}>Cancel trip</button>
        )}
        {support && <p style={{ textAlign: 'center', marginBottom: 0 }}><a href={`tel:${support.replace(/\s/g, '')}`}>Call DingoGo support</a></p>}
      </section>

      {cancelOpen && <CancelSheet onClose={() => setCancelOpen(false)} onCancel={async (reason) => {
        const r = await act('cancel', { reason });
        if (r) { setCancelOpen(false); showToast('Trip cancelled'); }
      }} busy={busy} />}
      {sosOpen && <SosSheet onClose={() => setSosOpen(false)} />}
    </div>
  );
}

function TripFlags({ t }: { t: any }) {
  const flags: string[] = [];
  if (t.passengers > 1) flags.push(`👥 ${t.passengers} passengers`);
  if (t.has_pet) flags.push(`🐕 Pet${t.pet_details ? `: ${t.pet_details}` : ''}`);
  if (t.assistance_animal) flags.push('🦮 Assistance animal');
  if (t.needs_wheelchair) flags.push('♿ Wheelchair');
  if (t.notes) flags.push(`“${t.notes}”`);
  if (!flags.length) return null;
  return <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 14 }}>{flags.map((f) => <span key={f} className="dg-chip dg-chip--ochre" style={{ fontSize: 'var(--fs-sm)', whiteSpace: 'normal' }}>{f}</span>)}</div>;
}

function ParcelInfo({ p }: { p: any }) {
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="info-row"><span className="dg-muted">Parcel</span><strong>Size {p.size}{p.weight_kg ? `, ${p.weight_kg} kg` : ''}</strong></div>
      <div className="info-row"><span className="dg-muted">Contents</span><strong>{p.description}</strong></div>
      <div className="info-row"><span className="dg-muted">From</span><strong>{p.sender_name}</strong></div>
      <div className="info-row"><span className="dg-muted">To</span><strong>{p.recipient_name}</strong></div>
      {p.instructions && <div className="info-row"><span className="dg-muted">Notes</span><strong>{p.instructions}</strong></div>}
    </div>
  );
}

function ProofOfDelivery({ parcel, busy, onSubmit }: { parcel: any; busy: boolean; onSubmit: (b: any) => void }) {
  const modes = [['pin', 'PIN'], ['signature', 'Signature'], ...(parcel?.leave_unattended ? [['photo', 'Photo']] : [])] as [string, string][];
  const [mode, setMode] = useState(parcel?.requires_signature ? 'signature' : 'pin');
  const [pin, setPin] = useState('');
  const [sig, setSig] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onPhoto(f?: File) {
    if (!f) return;
    setUploading(true); setErr(null);
    try { setPhoto((await uploadFile(f, 'pod')).url); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Upload failed'); } finally { setUploading(false); }
  }
  const ready = mode === 'pin' ? pin.length === 4 : mode === 'signature' ? !!sig && name.trim().length > 1 : !!photo;

  return (
    <div>
      {parcel && <p style={{ marginTop: 0 }}>For <strong>{parcel.recipient_name}</strong>{parcel.requires_signature ? ' — signature required' : ''}.</p>}
      <div className="seg" role="group" aria-label="Proof of delivery">
        {modes.filter(([k]) => !(parcel?.requires_signature && k !== 'signature')).map(([k, l]) => <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}>{l}</button>)}
      </div>
      {mode === 'pin' && (
        <label className="dg-field"><span>Recipient's delivery PIN (sent to them by SMS)</span>
          <input className="dg-input pin-input" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
        </label>
      )}
      {mode === 'signature' && (
        <>
          <label className="dg-field"><span>Received by</span><input className="dg-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>
          <SignaturePad onChange={setSig} />
        </>
      )}
      {mode === 'photo' && (
        <div className="dg-field">
          <span>Photo of the parcel where you left it</span>
          <input className="dg-input" type="file" accept="image/*" capture="environment" onChange={(e) => onPhoto(e.target.files?.[0])} />
          {uploading && <span className="dg-muted">Uploading…</span>}
          {photo && <span className="dg-chip dg-chip--green">Photo saved</span>}
        </div>
      )}
      {err && <p className="dg-error">{err}</p>}
      <button className="dg-btn dg-btn--green dg-btn--block btn-xl" style={{ marginTop: 12 }} disabled={busy || !ready}
        onClick={() => onSubmit(mode === 'pin' ? { delivery_pin: pin } : mode === 'signature' ? { pod_signature: sig, pod_received_by: name.trim() } : { pod_photo_url: photo })}>
        {busy ? 'Finishing…' : 'Mark delivered'}
      </button>
    </div>
  );
}

function CancelSheet({ onClose, onCancel, busy }: { onClose: () => void; onCancel: (r: string) => void; busy: boolean }) {
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="cx-h">
        <h2 id="cx-h">Why are you cancelling?</h2>
        <div style={{ display: 'grid', gap: 8 }}>
          {CANCEL_REASONS.map(([k, l]) => <button key={k} className="dg-btn dg-btn--ghost dg-btn--block" style={{ justifyContent: 'flex-start', minHeight: 56 }} disabled={busy} onClick={() => onCancel(k)}>{l}</button>)}
        </div>
        <button className="dg-btn dg-btn--dark dg-btn--block" style={{ marginTop: 12 }} onClick={onClose}>Keep the trip</button>
      </div>
    </div>
  );
}

function SosSheet({ onClose }: { onClose: () => void }) {
  const { pos } = useDriver();
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function alertOps() {
    try { await post('/driver/sos', { lat: pos?.lat, lng: pos?.lng }); setSent(true); }
    catch { setErr('Alert not sent — call 000 directly.'); }
  }
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="sos-h">
        <h2 id="sos-h">Emergency help</h2>
        <a className="dg-btn dg-btn--danger dg-btn--block btn-xl" href="tel:000" onClick={() => void alertOps()}>Call 000</a>
        <button className="dg-btn dg-btn--dark dg-btn--block btn-xl" style={{ marginTop: 10 }} onClick={alertOps} disabled={sent}>{sent ? 'DingoGo has been alerted' : 'Alert DingoGo with my location'}</button>
        {sent && <p className="dg-note">The operations team can see your location and will call you.</p>}
        {err && <p className="dg-error">{err}</p>}
        <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 10 }} onClick={onClose}>Close</button>
      </div>
    </div>
  );
}

function TripDone({ onClose }: { onClose: () => void }) {
  const { trip: t } = useDriver();
  const [rating, setRating] = useState(0);
  const [rated, setRated] = useState(false);
  const completed = t.status === 'completed';
  async function rate(n: number) {
    setRating(n);
    try { await post(`/trips/${t.id}/rate`, { rating: n }); setRated(true); } catch { /* already rated */ setRated(true); }
  }
  return (
    <div className="screen" style={{ display: 'grid', alignContent: 'center', minHeight: '100%' }}>
      {completed ? (
        <>
          <p className="dg-muted" style={{ margin: 0 }}>{t.ref}</p>
          <h1>{t.kind === 'courier' ? 'Delivered' : 'Trip complete'}</h1>
          <div className="big-num">{money(t.final_cents)}</div>
          <p className="dg-muted" style={{ marginTop: 0 }}>Fare incl. GST{t.actual_distance_m || t.est_distance_m ? `, ${km(t.actual_distance_m ?? t.est_distance_m)}` : ''}.{t.payment_method === 'cash' ? ' Collect this amount in cash.' : ' Paid in the app.'}</p>
          {t.kind === 'ride' && (
            <div className="panel" style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, fontWeight: 700 }}>How was {t.rider?.name?.split(' ')[0] ?? 'your passenger'}?</p>
              <div className="stars" role="group" aria-label="Rate passenger">
                {[1, 2, 3, 4, 5].map((n) => <button key={n} className={n <= rating ? 'on' : ''} aria-label={`${n} star${n > 1 ? 's' : ''}`} onClick={() => !rated && rate(n)}>★</button>)}
              </div>
              {rated && <p className="dg-muted" style={{ margin: 0 }}>Thanks</p>}
            </div>
          )}
        </>
      ) : (
        <>
          <h1>Trip cancelled</h1>
          <p className="dg-muted">{t.ref} won't count against you if the passenger cancelled.</p>
        </>
      )}
      <button className="dg-btn dg-btn--block btn-xl" style={{ marginTop: 16 }} onClick={onClose}>Back to driving</button>
    </div>
  );
}
