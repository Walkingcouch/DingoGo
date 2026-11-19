/**
 * Live tracking of a shared trip or parcel (no sign-in): the website's /track/<token> page and, since Round 21, the rider app
 * when a share link opens it (Android App Links). Moved here from apps/web/src/pages/Track.tsx.
 * Its own entry (`@dingogo/shared/track`) so the map code stays out of bundles that don't show it.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { ApiError, REALTIME, assetUrl, connectRealtime, get, post } from './api';
import { PARCEL_OUTCOME_LABEL } from './courier';
import { COURIER_STATUS_LABEL, STATUS_LABEL, time } from './format';
import { usePoll } from './hooks';
import { DgMap, type MapMarker } from './LazyMap';

/** How the host app draws an internal link (the website uses react-router's Link; the rider app a plain link to the website). */
export type RenderLink = (href: string, label: ReactNode, className?: string) => ReactNode;
const anchor: RenderLink = (href, label, className) => <a href={href} className={className}>{label}</a>;

type T = {
  ref: string; kind: 'ride' | 'courier'; status: string; pickup_address: string; pickup_lat: number; pickup_lng: number;
  dropoff_address: string; dropoff_lat: number; dropoff_lng: number; requested_at: string; accepted_at: string | null; started_at: string | null;
  completed_at: string | null; est_duration_s: number; driver_first_name: string | null; rego: string | null; make: string | null; model: string | null;
  colour: string | null; driver_lat?: number; driver_lng?: number; rider_first_name: string;
  parcel?: {
    sender_name: string; recipient_first_name: string; outcome: string | null; eta_at: string | null; delivered_at: string | null;
    pickup_window: { from: string; to: string } | null; leave_unattended: boolean; requires_signature: boolean; safe_place: string | null;
    recipient_notes: string | null; left_photo_url: string | null; failed_reason: string | null; can_add_instructions: boolean;
  } | null;
};

/** Parcel recipients: where it was left (with the photo), and a safe place or note for the driver before it arrives. */
function ParcelBox({ token, p, done, onSaved }: { token: string; p: NonNullable<T['parcel']>; done: boolean; onSaved: () => void }) {
  const [notes, setNotes] = useState('');
  const [place, setPlace] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null); setMsg(null);
    try {
      await post(`/public/track/${token}/instructions`, { notes: notes.trim() || undefined, safe_place: place.trim() || undefined });
      setMsg('Saved. Your driver will see it.'); setNotes(''); setPlace(''); onSaved();
    } catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not save. Try again.'); } finally { setBusy(false); }
  }
  return (
    <div style={{ marginTop: 12 }}>
      {done && p.left_photo_url && (
        <figure style={{ margin: '0 0 12px' }}>
          <img src={assetUrl(p.left_photo_url)} alt="Photo the driver took of where your parcel was left" style={{ maxWidth: '100%', borderRadius: 8 }} />
          <figcaption className="dg-muted">Left{p.safe_place ? `: ${p.safe_place}` : ' in a safe place'}.</figcaption>
        </figure>
      )}
      {!done && p.safe_place && <p style={{ margin: '0 0 6px' }}>If you're out, the driver will leave it: <b>{p.safe_place}</b>.</p>}
      {!done && p.requires_signature && <p style={{ margin: '0 0 6px' }}>Someone needs to be there to sign for it.</p>}
      {p.recipient_notes && <p className="dg-muted" style={{ margin: '0 0 6px' }}>Your note: {p.recipient_notes}</p>}
      {p.can_add_instructions && (
        <form onSubmit={save} aria-labelledby="ins-h">
          <h2 id="ins-h" style={{ fontSize: '1.05rem', margin: '10px 0 6px' }}>Help the driver find you</h2>
          <label className="dg-field"><span>Note for the driver</span><input className="dg-input" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. blue door, unit 4 at the back" /></label>
          {!p.requires_signature && (
            <label className="dg-field"><span>If I'm out, leave it here</span><input className="dg-input" value={place} maxLength={120} onChange={(e) => setPlace(e.target.value)} placeholder="e.g. behind the side gate" /></label>
          )}
          {err && <p className="dg-error" role="alert">{err}</p>}
          {msg && <p role="status">{msg}</p>}
          <button className="dg-btn" disabled={busy || (!notes.trim() && !place.trim())}>{busy ? 'Saving…' : 'Save'}</button>
        </form>
      )}
    </div>
  );
}

export function SharedTrack({ token, homeHref = '/', safetyHref = '/safety', renderLink = anchor, className, onLoaded }: {
  token: string; homeHref?: string; safetyHref?: string; renderLink?: RenderLink; className?: string;
  /** Called with the trip reference once loaded (the website puts it in the page title). */
  onLoaded?: (ref: string | null) => void;
}) {
  const [trip, setTrip] = useState<T | null>(null);
  const [track, setTrack] = useState<{ lat: number; lng: number }[]>([]);
  const [live, setLive] = useState(false);
  const [car, setCar] = useState<{ lat: number; lng: number; heading?: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  useEffect(() => { onLoaded?.(trip?.ref ?? null); }, [trip?.ref]); // eslint-disable-line react-hooks/exhaustive-deps

  const load = useCallback(async () => {
    try {
      const r = await get<{ trip: T; track: { lat: number; lng: number }[]; live: boolean }>(`/public/track/${token}`);
      setTrip(r.trip); setTrack(r.track); setLive(r.live); setError(null);
      if (r.trip.driver_lat != null && r.trip.driver_lng != null) setCar({ lat: r.trip.driver_lat, lng: r.trip.driver_lng });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'notfound' : e instanceof ApiError && e.status === 410 ? 'expired' : 'offline');
    }
  }, [token]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const rt = connectRealtime((m) => {
      if (m.type === 'driver.location') { setCar({ lat: m.data.lat, lng: m.data.lng, heading: m.data.heading }); setTrack((t) => [...t, { lat: m.data.lat, lng: m.data.lng }]); }
      if (m.type === 'trip.updated') void load();
    }, { share: token });
    return () => rt.close();
  }, [token, load]);
  // Round 18: a hidden tab checks every 30 s (and at once when it comes back into view).
  usePoll(() => (live ? load() : tick((n) => n + 1)), live ? (REALTIME ? 30000 : 6000) : 60000, { hiddenMs: 30000 });

  if (error === 'expired' && !trip) {
    return (
      <section className={`dg-track-msg ${className ?? ''}`}><div>
        <h1>This trip has finished</h1>
        <p>To protect everyone's privacy, tracking links stop working a day after the trip ends.</p>
        {renderLink(homeHref, 'Go to DingoGo', 'dg-btn')}
      </div></section>
    );
  }
  if (error === 'notfound') {
    return (
      <section className={`dg-track-msg ${className ?? ''}`}><div>
        <h1>This tracking link isn't valid</h1>
        <p>Check you've copied the whole link from the text message. Links stop showing the car once a trip has finished.</p>
        {renderLink(homeHref, 'Go to DingoGo', 'dg-btn')}
      </div></section>
    );
  }
  if (!trip) return <section className={`dg-track-msg ${className ?? ''}`}><div><p className="dg-muted" role="status">{error ? 'No connection. Retrying…' : 'Loading trip…'}</p></div></section>;

  const labels = trip.kind === 'courier' ? COURIER_STATUS_LABEL : STATUS_LABEL;
  const done = trip.status === 'completed';
  const ended = done || trip.status.startsWith('cancelled') || trip.status === 'no_drivers';
  const p = trip.parcel;
  const eta = p?.eta_at ? new Date(p.eta_at) : trip.status === 'in_progress' && trip.started_at ? new Date(new Date(trip.started_at).getTime() + trip.est_duration_s * 1000) : null;

  const markers: MapMarker[] = [
    { id: 'a', kind: 'pickup', lat: trip.pickup_lat, lng: trip.pickup_lng, label: trip.pickup_address },
    { id: 'b', kind: 'dropoff', lat: trip.dropoff_lat, lng: trip.dropoff_lng, label: trip.dropoff_address },
    ...(car && live ? [{ id: 'car', kind: 'car' as const, lat: car.lat, lng: car.lng, heading: car.heading, label: trip.rego ?? 'Driver' }] : []),
  ];

  return (
    <div className={`dg-track ${className ?? ''}`}>
      <div className="dg-track__side">
        <p className="dg-muted" style={{ margin: 0 }}>{trip.kind === 'courier' ? 'Parcel' : `${trip.rider_first_name}'s trip`} {trip.ref}</p>
        <p className="dg-track__status" role="status" aria-live="polite">{live && <span className="dg-live-dot" aria-hidden="true" />}{labels[trip.status] ?? trip.status}</p>
        {p?.outcome === 'returning' || p?.outcome === 'returned'
          ? <p style={{ margin: 0 }}><b>{PARCEL_OUTCOME_LABEL[p.outcome]}.</b> We couldn't deliver it{p.failed_reason ? ` (${p.failed_reason.toLowerCase()})` : ''}. {p.sender_name} will be in touch.</p>
          : <>
            {eta && !ended && trip.status === 'in_progress' && <p style={{ margin: 0 }}>Expected to arrive around <b>{time(eta)}</b></p>}
            {done && <p style={{ margin: 0 }}>{trip.kind === 'courier' ? 'Delivered' : 'Arrived'} at {time(trip.completed_at)}.</p>}
          </>}
        {trip.status === 'scheduled' && <p style={{ margin: 0 }}>{p?.pickup_window ? `Collected between ${time(p.pickup_window.from)} and ${time(p.pickup_window.to)}.` : "We'll find a driver shortly before pickup."}</p>}
        {p && <ParcelBox token={token} p={p} done={done} onSaved={load} />}
        {trip.driver_first_name && !ended && (
          <div className="dg-track__car">
            <span className="dg-track__rego">{trip.rego}</span>
            <span><b>{trip.driver_first_name}</b><br /><span className="dg-muted">{trip.colour} {trip.make} {trip.model}</span></span>
          </div>
        )}
        <ul className="dg-track__legs" aria-label="Route">
          <li><span className="dg-muted">From</span><br />{trip.pickup_address}</li>
          <li><span className="dg-muted">To</span><br />{trip.dropoff_address}</li>
        </ul>
        {!ended && <p className="dg-note" style={{ marginTop: 18, fontSize: '.95rem' }}>Worried about this trip? Call 000 in an emergency. To reach DingoGo, use the contact details on our {renderLink(safetyHref, 'safety page')}.</p>}
        {ended && <p className="dg-muted" style={{ marginTop: 18 }}>The car's live location is no longer shown for this trip.</p>}
      </div>
      <div className="dg-track__map">
        <DgMap markers={markers} track={live ? track : null} padding={50} />
      </div>
    </div>
  );
}
