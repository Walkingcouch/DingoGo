import { useEffect, useRef, useState } from 'react';
import { ApiError, ChatThread, DELIVERY_FAIL_REASONS, EmergencyCard, Icon, REALTIME, assetUrl, connectRealtime, get, km, money, post, uploadFile, useTripChat } from '@dingogo/shared';
import { DgMap, type MapMarker } from '@dingogo/shared/map';
import { needFlags, useDriver } from '../state';
import { SignaturePad } from './SignaturePad';
import { Sheet } from '../Sheet';
import { NAV_APPS, navLabel, navUrl } from '../lib/nav';
import { usePrefs } from '../lib/prefs';
import type { Step } from '../lib/outbox';

/** Reasons about the passenger or parcel end the trip. The driver's own reasons pass it to another driver and count as a cancellation. */
const RIDER_SIDE: [string, string][] = [
  ['rider_no_show', 'Passenger didn’t show'],
  ['rider_requested', 'Passenger asked to cancel'],
  ['unsafe', 'I feel unsafe'],
  ['parcel_prohibited', 'Parcel looks prohibited (alcohol, weapons…)'],
];
const DRIVER_SIDE: [string, string][] = [
  ['vehicle_issue', 'Problem with the car'],
  ['other', 'I can’t make it (something else)'],
];
const DONE = ['completed', 'cancelled_rider', 'cancelled_driver', 'cancelled_admin', 'no_drivers'];

export function ActiveTrip() {
  const { trip, setTrip, reloadTrip, pos, reloadMe, showToast, tripAction } = useDriver();
  const [prefs] = usePrefs();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pin, setPin] = useState('');
  const [cancelOpen, setCancelOpen] = useState(false);
  const [sosOpen, setSosOpen] = useState(false);
  const [support, setSupport] = useState<string | null>(null);
  const [chatOpen, setChatOpen] = useState(false);
  const [relay, setRelay] = useState<string | null>(null);
  const t = trip;
  const chatLive = !t.released && ['accepted', 'arrived', 'in_progress'].includes(t.status) && !t.pending_sync;
  const chat = useTripChat(chatLive ? t.id : null, chatOpen);
  useEffect(() => {
    if (!chatLive) return;
    get(`/trips/${t.id}/contact`).then((c) => setRelay(c.call?.number ?? null)).catch(() => setRelay(null));
    if (!REALTIME) return;
    const rt = connectRealtime((m) => { if (m.type === 'message.new' && m.data?.trip_id === t.id) chat.refresh(); });
    return () => rt.close();
  }, [chatLive, t.id]); // eslint-disable-line
  const seen = useRef(0);
  useEffect(() => {
    if (chat.unread > seen.current && !chatOpen) { showToast(t.kind === 'courier' ? 'New message from the customer' : 'New message from your passenger'); navigator.vibrate?.(200); }
    seen.current = chat.unread;
  }, [chat.unread, chatOpen]); // eslint-disable-line
  const isCourier = t.kind === 'courier';
  const parcel = t.parcel;
  // After a failed delivery the parcel goes back to the sender: the next stop is the pickup.
  const returning = isCourier && parcel?.outcome === 'returning';
  const [failOpen, setFailOpen] = useState(false);
  const run = t.batch as { ref: string; stops: any[] } | undefined;
  const runText = run ? `Drop ${t.batch_seq} of ${run.stops.length}` : null;

  useEffect(() => { get('/public/config').then((c) => setSupport(c.support?.phone ?? null)).catch(() => undefined); }, []);
  useEffect(() => { setError(null); setPin(''); }, [t.status]);

  /** Arrived / start / complete: works with no signal too (kept on the phone and sent when signal returns). */
  async function step(s: Step, body?: Record<string, unknown>) {
    setBusy(true); setError(null);
    try { return await tripAction(s, body); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'); }
    finally { setBusy(false); }
  }
  /** Cancelling needs DingoGo there and then (the trip may go to another driver). */
  async function act(path: string, body?: unknown) {
    setBusy(true); setError(null);
    try { const r = await post(`/driver/trips/${t.id}/${path}`, body); setTrip(r.trip); return r; }
    catch (e) { setError(e instanceof ApiError && e.code !== 'offline' ? e.message : 'No signal, so the trip can’t be cancelled yet. Try again, or call DingoGo support.'); }
    finally { setBusy(false); }
  }

  const done = t.released || DONE.includes(t.status);
  const firstName = t.rider?.name?.split(' ')[0] ?? 'passenger';
  const stageTitle = {
    accepted: isCourier ? 'Head to pickup' : `Pick up ${firstName}`,
    arrived: isCourier ? 'Collect the parcel' : 'Check the PIN',
    in_progress: returning ? 'Take it back to the sender' : isCourier ? 'Deliver the parcel' : 'Drive to drop-off',
  }[t.status as 'accepted' | 'arrived' | 'in_progress'] ?? t.status;
  const toDrop = t.status === 'in_progress' && !returning;
  useStageAnnouncement(done ? null : `${stageTitle}. ${toDrop ? t.dropoff_address : t.pickup_address}`, stageTitle);
  if (done) return <TripDone onClose={() => { setTrip(null); void reloadMe(); void reloadTrip(); }} />;

  const target = toDrop ? { lat: t.dropoff_lat, lng: t.dropoff_lng, address: t.dropoff_address } : { lat: t.pickup_lat, lng: t.pickup_lng, address: t.pickup_address };
  const toWhere = toDrop ? (isCourier ? 'delivery' : 'drop-off') : returning ? 'sender' : 'pickup';
  const markers: MapMarker[] = [
    ...(pos ? [{ id: 'me', kind: 'car' as const, lat: pos.lat, lng: pos.lng, heading: pos.heading }] : []),
    ...(!toDrop ? [{ id: 'p', kind: 'pickup' as const, lat: t.pickup_lat, lng: t.pickup_lng }] : []),
    { id: 'd', kind: 'dropoff' as const, lat: t.dropoff_lat, lng: t.dropoff_lng },
  ];

  return (
    <div className="trip">
      <div style={{ position: 'relative', minHeight: 0 }}>
        <DgMap markers={markers} padding={50} />
        <button className="sos" onClick={() => setSosOpen(true)} aria-label="SOS, emergency help"><Icon name="sos" size={22} />SOS</button>
      </div>
      <section className="trip-sheet">
        <div className="trip-meta"><span className="dg-muted">{t.ref}</span>{t.payment_method === 'cash' && <span className="dg-chip dg-chip--ochre"><Icon name="cash" size={16} />Cash {money(t.quote_cents)}</span>}</div>
        <h1 className="stage">{stageTitle}</h1>
        {runText && <p className="dg-chip" style={{ margin: '0 0 6px' }}>{runText}, run {run!.ref}</p>}
        <p className="addr">{target.address}</p>
        {t.pending_sync && <p className="sync-note"><Icon name="info" size={18} />No signal. Saved on your phone, sends when signal returns.</p>}

        {t.status !== 'arrived' && (
          <div className="nav-go">
            <a className="dg-btn dg-btn--dark btn-xl" href={navUrl(prefs.nav, target.lat, target.lng)} target="_blank" rel="noreferrer">
              <Icon name="navigation" size={24} />Navigate to {toWhere}<span className="sr-only"> in {navLabel(prefs.nav)} (opens the app)</span>
            </a>
            <p className="nav-other">
              <span className="dg-muted">{navLabel(prefs.nav)}. Or:</span>
              {NAV_APPS.filter((a) => a.key !== prefs.nav).map((a) => <a key={a.key} href={navUrl(a.key, target.lat, target.lng)} target="_blank" rel="noreferrer">{a.label}</a>)}
            </p>
          </div>
        )}

        <TripFlags t={t} />
        {t.fare_breakdown?.regional && ['accepted', 'arrived', 'in_progress'].includes(t.status) && <LongTrip t={t} pos={pos} />}

        {chatLive && chat.available && (
          <div className="contact-row">
            <button className="dg-btn dg-btn--ghost" onClick={() => setChatOpen(true)} aria-haspopup="dialog">
              <Icon name="chat" size={22} />Message{chat.unread > 0 && <span className="dg-badge" aria-label={`${chat.unread} unread`}>{chat.unread}</span>}
            </button>
            {relay && !t.rider?.needs?.hearing && <a className="dg-btn dg-btn--ghost" href={`tel:${relay}`}><Icon name="phone" size={22} />Call</a>}
          </div>
        )}

        {t.status === 'accepted' && (
          <button className="dg-btn dg-btn--block btn-xl" onClick={() => step('arrive')} disabled={busy}>{busy ? 'Updating…' : 'I’ve arrived'}</button>
        )}

        {t.status === 'arrived' && !isCourier && (
          <form onSubmit={(e) => { e.preventDefault(); void step('start', { pin }); }}>
            <label className="dg-field"><span>Ask the passenger for their 4-digit PIN</span>
              <input className="dg-input pin-input" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} autoComplete="off" aria-describedby="pin-help" />
            </label>
            <p id="pin-help" className="dg-muted" style={{ marginTop: 0, fontSize: 'var(--fs-sm)' }}>Matching PINs means you've got the right person.</p>
            <button className="dg-btn dg-btn--block btn-xl" disabled={busy || pin.length !== 4}>{busy ? 'Starting…' : 'Start trip'}</button>
          </form>
        )}

        {t.status === 'arrived' && isCourier && (
          <>
            {run ? <p><strong>Collect {run.stops.filter((x) => x.status === 'arrived').length} parcels</strong> for this run: {run.stops.map((x) => x.recipient_name).join(', ')}.</p> : parcel && <ParcelInfo p={parcel} />}
            <p className="dg-note">Check the parcel. Refuse alcohol, weapons, drugs or dangerous goods. Cancel with "Parcel looks prohibited".</p>
            <button className="dg-btn dg-btn--block btn-xl" onClick={() => step('start')} disabled={busy}>{busy ? 'Updating…' : 'Parcel collected'}</button>
          </>
        )}

        {t.status === 'in_progress' && !isCourier && (
          <button className="dg-btn dg-btn--green dg-btn--block btn-xl" onClick={() => step('complete', { lat: pos?.lat, lng: pos?.lng })} disabled={busy}>{busy ? 'Finishing…' : 'Complete trip'}</button>
        )}

        {t.status === 'in_progress' && isCourier && parcel && <ParcelInfo p={parcel} />}
        {t.status === 'in_progress' && isCourier && <ProofOfDelivery parcel={parcel} returning={returning} busy={busy} onSubmit={(b) => step('complete', { ...b, lat: pos?.lat, lng: pos?.lng })} />}
        {t.status === 'in_progress' && isCourier && !returning && (
          <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 12 }} onClick={() => setFailOpen(true)}>Couldn’t deliver</button>
        )}

        {error && <p className="dg-error" role="alert" style={{ marginTop: 12 }}>{error}</p>}

        {(t.status === 'accepted' || t.status === 'arrived') && (
          <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 12 }} onClick={() => setCancelOpen(true)}>Cancel trip</button>
        )}
        {support && <p style={{ textAlign: 'center', marginBottom: 0 }}><a href={`tel:${support.replace(/\s/g, '')}`}>Call DingoGo support</a></p>}
      </section>

      {cancelOpen && <CancelSheet onClose={() => setCancelOpen(false)} onCancel={async (reason) => {
        const r = await act('cancel', { reason });
        if (r) {
          setCancelOpen(false);
          showToast(reason === 'sorry_business' ? 'Trip passed on. You are paused. Look after yourself and your family.' : r.trip?.released ? 'Trip passed to another driver' : 'Trip cancelled');
          if (reason === 'sorry_business') void reloadMe();
        }
      }} busy={busy} isCourier={isCourier} />}
      {sosOpen && <SosSheet tripId={t.id} onClose={() => setSosOpen(false)} />}
      {failOpen && <FailSheet parcel={parcel} busy={busy} onClose={() => setFailOpen(false)} onSubmit={async (b) => {
        const r = await act('delivery-failed', { ...b, lat: pos?.lat, lng: pos?.lng });
        if (r) { setFailOpen(false); showToast('Not delivered. Take it back to the sender.'); }
      }} />}
      {chatOpen && (
        <Sheet onClose={() => setChatOpen(false)} labelledBy="chat-h">
          <h2 id="chat-h" style={{ marginTop: 0 }}>Messages with {isCourier ? 'the customer' : firstName}</h2>
          <ChatThread chat={chat} otherLabel={isCourier ? 'Customer' : 'Passenger'}
            hint={t.rider?.needs?.hearing ? 'This passenger is Deaf or hard of hearing: message, don’t call.' : 'Pull over before you type. Quick replies are one tap.'} />
          <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 10 }} onClick={() => setChatOpen(false)}>Close</button>
        </Sheet>
      )}
    </div>
  );
}

function TripFlags({ t }: { t: any }) {
  const flags: [string, string][] = [];
  if (t.passengers > 1) flags.push(['users', `${t.passengers} passengers`]);
  if (t.has_pet) flags.push(['paw', `Pet${t.pet_details ? `: ${t.pet_details}` : ''}`]);
  if (t.assistance_animal) flags.push(['shield', 'Assistance animal']);
  if (t.needs_wheelchair) flags.push(['access', 'Wheelchair']);
  flags.push(...needFlags(t.rider?.needs));
  if (t.notes) flags.push(['chat', `“${t.notes}”`]);
  if (!flags.length) return null;
  return <ul className="trip-flags">{flags.map(([ic, f]) => <li key={f}><Icon name={ic} size={18} />{f}</li>)}</ul>;
}

function ParcelInfo({ p }: { p: any }) {
  return (
    <div className="panel" style={{ marginBottom: 12 }}>
      <div className="info-row"><span className="dg-muted">Parcel</span><strong>Size {p.size}{p.weight_kg ? `, ${p.weight_kg} kg` : ''}</strong></div>
      <div className="info-row"><span className="dg-muted">Contents</span><strong>{p.description}</strong></div>
      <div className="info-row"><span className="dg-muted">From</span><strong>{p.sender_name}</strong></div>
      <div className="info-row"><span className="dg-muted">To</span><strong>{p.recipient_name}</strong></div>
      {p.instructions && <div className="info-row"><span className="dg-muted">Notes</span><strong>{p.instructions}</strong></div>}
      {p.recipient_notes && <div className="info-row"><span className="dg-muted">From the recipient</span><strong>{p.recipient_notes}</strong></div>}
      {p.leave_unattended && <div className="info-row"><span className="dg-muted">If nobody's home</span><strong>Leave it{p.safe_place ? `: ${p.safe_place}` : ' in a safe place'} (photo)</strong></div>}
      {p.requires_signature && <div className="info-row"><span className="dg-muted">Handover</span><strong>Signature needed</strong></div>}
      {p.outcome === 'returning' && <div className="info-row"><span className="dg-muted">Not delivered</span><strong>Return to {p.sender_name}</strong></div>}
    </div>
  );
}

function ProofOfDelivery({ parcel, busy, onSubmit, returning }: { parcel: any; busy: boolean; onSubmit: (b: any) => void; returning?: boolean }) {
  // Back at the sender: the person taking it gives their name and signs (or a photo of the handover).
  const modes = (returning ? [['signature', 'Signature'], ['photo', 'Photo']] : [['pin', 'PIN'], ['signature', 'Signature'], ...(parcel?.leave_unattended ? [['photo', 'Photo']] : [])]) as [string, string][];
  const [mode, setMode] = useState(returning || parcel?.requires_signature ? 'signature' : 'pin');
  const [pin, setPin] = useState('');
  const [sig, setSig] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function onPhoto(f?: File) {
    if (!f) return;
    setUploading(true); setErr(null);
    try { const r = await uploadFile(f, 'pod'); setPhoto(r.url); setPreview(r.view_url ?? null); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Upload failed'); } finally { setUploading(false); }
  }
  const ready = mode === 'pin' ? pin.length === 4 : mode === 'signature' ? !!sig && name.trim().length > 1 : !!photo && (!returning || name.trim().length > 1);

  return (
    <div>
      {parcel && !returning && <p style={{ marginTop: 0 }}>For <strong>{parcel.recipient_name}</strong>{parcel.requires_signature ? ', signature required' : ''}.</p>}
      {returning && <p style={{ marginTop: 0 }}>Hand it back to <strong>{parcel?.sender_name}</strong>. Ask for their name.</p>}
      {returning && mode === 'photo' && <label className="dg-field"><span>Taken back by</span><input className="dg-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" /></label>}
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
          <span className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>Your phone may ask to use the camera. The photo goes only to the sender, the recipient and DingoGo.</span>
          <input className="dg-input" type="file" accept="image/*" capture="environment" onChange={(e) => onPhoto(e.target.files?.[0])} />
          {uploading && <span className="dg-muted">Uploading…</span>}
          {photo && <span className="dg-chip dg-chip--green">Photo saved</span>}
          {preview && <img src={assetUrl(preview)} alt="Delivery photo you took" style={{ maxWidth: 160, borderRadius: 8, marginTop: 8 }} />}
        </div>
      )}
      {err && <p className="dg-error">{err}</p>}
      <button className="dg-btn dg-btn--green dg-btn--block btn-xl" style={{ marginTop: 12 }} disabled={busy || !ready}
        onClick={() => onSubmit(mode === 'pin' ? { delivery_pin: pin } : mode === 'signature' ? { pod_signature: sig, pod_received_by: name.trim() } : { pod_photo_url: photo, ...(returning ? { pod_received_by: name.trim() } : {}) })}>
        {busy ? 'Finishing…' : returning ? 'Returned to the sender' : 'Mark delivered'}
      </button>
    </div>
  );
}

function FailSheet({ parcel, busy, onClose, onSubmit }: { parcel: any; busy: boolean; onClose: () => void; onSubmit: (b: any) => void }) {
  const [reason, setReason] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [photo, setPhoto] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function onPhoto(f?: File) {
    if (!f) return;
    try { setPhoto((await uploadFile(f, 'pod')).url); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Upload failed'); }
  }
  // "Nobody home" when the sender allowed a safe place: leave it there instead.
  const reasons = DELIVERY_FAIL_REASONS.filter(([k]) => !(k === 'no_one_home' && parcel?.leave_unattended));
  return (
    <Sheet onClose={onClose} labelledBy="fail-h">
      <h2 id="fail-h">Why couldn’t you deliver?</h2>
      <p className="dg-note">The parcel goes back to {parcel?.sender_name ?? 'the sender'}. You’re paid for the return. We text the sender and the recipient.</p>
      <div style={{ display: 'grid', gap: 8 }} role="radiogroup" aria-label="Reason">
        {reasons.map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={reason === k} className="dg-btn dg-btn--ghost dg-btn--block"
          style={{ justifyContent: 'flex-start', minHeight: 52, ...(reason === k ? { outline: '3px solid var(--ochre)' } : {}) }} onClick={() => setReason(k)}>{l}</button>)}
      </div>
      <label className="dg-field"><span>What happened{reason === 'other' ? '' : ' (optional)'}</span><input className="dg-input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} /></label>
      <label className="dg-field"><span>Photo of the door or gate (optional)</span><input className="dg-input" type="file" accept="image/*" capture="environment" onChange={(e) => onPhoto(e.target.files?.[0])} /></label>
      {photo && <span className="dg-chip dg-chip--green">Photo saved</span>}
      {err && <p className="dg-error" role="alert">{err}</p>}
      <button className="dg-btn dg-btn--dark dg-btn--block btn-xl" style={{ marginTop: 12 }} disabled={busy || !reason || (reason === 'other' && !note.trim())}
        onClick={() => onSubmit({ reason, note: note.trim() || undefined, photo_url: photo ?? undefined })}>{busy ? 'Saving…' : 'Not delivered: return it'}</button>
      <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 10 }} onClick={onClose}>Back</button>
    </Sheet>
  );
}

function CancelSheet({ onClose, onCancel, busy, isCourier }: { onClose: () => void; onCancel: (r: string) => void; busy: boolean; isCourier: boolean }) {
  const { me } = useDriver();
  const n = me?.acceptance?.cancelled_7d ?? 0;
  const review = me?.acceptance?.cancel_review_at ?? 3;
  const btn = (k: string, l: string) => <button key={k} className="dg-btn dg-btn--ghost dg-btn--block" style={{ justifyContent: 'flex-start', minHeight: 56 }} disabled={busy} onClick={() => onCancel(k)}>{l}</button>;
  const reasons = RIDER_SIDE.filter(([k]) => isCourier || k !== 'parcel_prohibited');
  return (
    <Sheet onClose={onClose} labelledBy="cx-h">
        <h2 id="cx-h">Why are you cancelling?</h2>
        <h3 className="dg-note" style={{ margin: '0 0 6px' }}>{isCourier ? 'About the pickup or parcel' : 'About the passenger'}: the trip ends</h3>
        <div style={{ display: 'grid', gap: 8 }}>{reasons.map(([k, l]) => btn(k, l))}</div>
        <h3 className="dg-note" style={{ margin: '14px 0 6px' }}>You can’t do it: we offer it to another driver</h3>
        <div style={{ display: 'grid', gap: 8 }}>{DRIVER_SIDE.map(([k, l]) => btn(k, l))}</div>
        <p className="dg-note">These count as a cancellation on your record{n > 0 ? ` (${n} in the last 7 days)` : ''}. DingoGo reviews drivers who cancel {review} or more trips in a week.</p>
        <h3 className="dg-note" style={{ margin: '14px 0 6px' }}>Sorry Business or a family emergency</h3>
        <div style={{ display: 'grid', gap: 8 }}>{btn('sorry_business', 'I have to go: Sorry Business or family')}</div>
        <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>We offer the trip to another driver and pause you. This never counts against you, and we don't ask why.</p>
        <button className="dg-btn dg-btn--dark dg-btn--block" style={{ marginTop: 12 }} onClick={onClose}>Keep the trip</button>
    </Sheet>
  );
}

function SosSheet({ onClose, tripId }: { onClose: () => void; tripId?: string }) {
  const { pos } = useDriver();
  const [sent, setSent] = useState(false);
  const [texted, setTexted] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  async function alertOps() {
    try { const r = await post('/driver/sos', { lat: pos?.lat, lng: pos?.lng }); setTexted(r.contacts_texted ?? 0); setSent(true); }
    catch { setErr('Alert not sent. Call 000 directly.'); }
  }
  return (
    <Sheet onClose={onClose} labelledBy="sos-h">
        <h2 id="sos-h">Emergency help</h2>
        <a className="dg-btn dg-btn--danger dg-btn--block btn-xl" href="tel:000" onClick={() => void alertOps()}><Icon name="phone" size={22} />Call 000</a>
        <button className="dg-btn dg-btn--dark dg-btn--block btn-xl" style={{ marginTop: 10 }} onClick={alertOps} disabled={sent}><Icon name={sent ? 'check' : 'pin'} size={22} />{sent ? 'DingoGo has been alerted' : 'Alert DingoGo with my location'}</button>
        {sent && <p className="dg-note" role="status">The operations team can see your location and will call you.{texted ? ` We've texted your ${texted === 1 ? 'trusted contact' : `${texted} trusted contacts`} where you are.` : ''}</p>}
        {err && <p className="dg-error" role="alert">{err}</p>}
        <EmergencyCard tripId={tripId} pos={pos ? { lat: pos.lat, lng: pos.lng } : null} />
        <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 10 }} onClick={onClose}>Close</button>
    </Sheet>
  );
}

function TripDone({ onClose }: { onClose: () => void }) {
  const { trip: t } = useDriver();
  const [rating, setRating] = useState(0);
  const [rated, setRated] = useState(false);
  const completed = t.status === 'completed';
  async function rate(n: number) {
    setRating(n);
    try { await post(`/trips/${t.id}/rate`, { rating: n }); setRated(true); }
    catch (e) { if (!(e instanceof ApiError) || e.code !== 'offline') setRated(true); /* already rated; with no signal they can tap again */ }
  }
  return (
    <div className="screen" style={{ display: 'grid', alignContent: 'center', minHeight: '100%' }}>
      {completed ? (
        <>
          <p className="dg-muted" style={{ margin: 0 }}>{t.ref}</p>
          <h1>{t.kind === 'courier' ? (t.parcel?.outcome === 'returned' ? 'Returned to the sender' : 'Delivered') : 'Trip complete'}</h1>
          {t.pending_sync && <p className="sync-note" role="status"><Icon name="info" size={18} />No signal. Saved on your phone and sent to DingoGo when signal returns. The fare shown is the quoted fare.</p>}
          <div className="big-num">{money(t.final_cents)}</div>
          <p className="dg-muted" style={{ marginTop: 0 }}>Fare incl. GST{t.actual_distance_m || t.est_distance_m ? `, ${km(t.actual_distance_m ?? t.est_distance_m)}` : ''}.{t.payment_method === 'cash' ? ' Collect this amount in cash.' : ' Paid in the app.'}</p>
          {t.kind === 'ride' && (
            <div className="panel" style={{ textAlign: 'center' }}>
              <p style={{ margin: 0, fontWeight: 700 }}>How was {t.rider?.name?.split(' ')[0] ?? 'your passenger'}?</p>
              <div className="stars" role="radiogroup" aria-label={`Rate ${t.rider?.name?.split(' ')[0] ?? 'your passenger'}`}>
                {[1, 2, 3, 4, 5].map((n) => <button key={n} role="radio" className={n <= rating ? 'on' : ''} aria-label={`${n} star${n > 1 ? 's' : ''}`} aria-checked={n === rating} aria-disabled={rated || undefined} onClick={() => !rated && rate(n)}><Icon name="star" size={36} style={n <= rating ? { fill: 'currentColor' } : undefined} /></button>)}
              </div>
              <p className="dg-muted" role="status" style={{ margin: 0, minHeight: '1.5em' }}>{rated ? 'Thanks' : ''}</p>
            </div>
          )}
        </>
      ) : t.released ? (
        <>
          <p className="dg-muted" style={{ margin: 0 }}>{t.ref}</p>
          <h1>Passed to another driver</h1>
          {t.released_by === 'driver'
            ? <p className="dg-muted">We're offering the trip to the next driver, so the {t.kind === 'courier' ? 'sender' : 'passenger'} still gets picked up. This counts as a cancellation on your record.</p>
            : <p className="dg-muted">This trip has gone to another driver because we couldn't reach you. It doesn't count against you. Call DingoGo if you were still on your way.</p>}
        </>
      ) : (
        <>
          <h1>Trip cancelled</h1>
          <p className="dg-muted">{t.ref} won't count against you if the passenger cancelled.</p>
        </>
      )}
      {(() => {
        // Multi-drop run: more drops (or a return) still to do.
        const next = t.batch?.stops?.find((x: any) => x.id !== t.id && ['accepted', 'arrived', 'in_progress'].includes(x.status));
        return <button className="dg-btn dg-btn--block btn-xl" style={{ marginTop: 16 }} onClick={onClose}>{next ? `Next: ${next.outcome === 'returning' ? 'return to the sender' : next.dropoff_address}` : 'Back to driving'}</button>;
      })()}
    </div>
  );
}

/** Says each new step once to screen readers (polite) and shows it in the app switcher title. */
function useStageAnnouncement(text: string | null, title: string) {
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!text || text === last.current) return;
    last.current = text;
    document.title = `${title} | DingoGo Driver`;
    const el = document.getElementById('announce');
    if (el) { el.textContent = ''; setTimeout(() => { el.textContent = text; }, 50); }
  }, [text, title]);
  useEffect(() => () => { document.title = 'DingoGo Driver'; }, []);
}

/** Round 28: a community trip. The road, where coverage drops out, permits, and a big "Check in" button (ops are warned if you go quiet
 *  for longer than the no-coverage stretch, and alerted if you're well past the expected arrival). */
function LongTrip({ t, pos }: { t: any; pos: { lat: number; lng: number } | null }) {
  const r = t.fare_breakdown.regional;
  const [last, setLast] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function checkIn() {
    setErr(null);
    try { const x = await post(`/driver/trips/${t.id}/checkin`, { lat: pos?.lat, lng: pos?.lng }); setLast(x.at); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'No signal: try again when you have coverage'); }
  }
  return (
    <section className="panel" aria-labelledby="lt-h">
      <h2 id="lt-h" style={{ marginTop: 0 }}>Community trip: {r.place}</h2>
      <p style={{ margin: '0 0 6px' }}>About {r.road_km} km{r.unsealed_km ? `, ${r.unsealed_km} km unsealed` : ''}, {Math.round(r.minutes / 5) * 5} min. Check in about every {r.checkin_every_min} min.</p>
      {r.coverage_gaps?.map((g: any, i: number) => <p key={i} className="dg-note" style={{ margin: '4px 0' }}><Icon name="nosignal" size={18} /> {g.note}</p>)}
      <ol className="dg-muted" style={{ fontSize: 'var(--fs-sm)', margin: '6px 0' }}>{r.checkins?.map((c: string) => <li key={c}>{c}</li>)}</ol>
      {r.fuel_note && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>{r.fuel_note}</p>}
      {r.permit_note && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>Permits: {r.permit_note}</p>}
      <button className="dg-btn dg-btn--dark dg-btn--block btn-xl" onClick={checkIn}><Icon name="check" size={22} />Check in: all OK</button>
      {last && <p className="dg-muted" role="status">Checked in at {new Date(last).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}.</p>}
      {err && <p className="dg-error" role="alert">{err}</p>}
    </section>
  );
}
