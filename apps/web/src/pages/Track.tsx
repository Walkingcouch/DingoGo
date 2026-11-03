import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, REALTIME, connectRealtime, COURIER_STATUS_LABEL, get, STATUS_LABEL, time, useInterval } from '@dingogo/shared';
import { DgMap, type MapMarker } from '@dingogo/shared/map';
import { useMeta } from '../meta';

type T = {
  ref: string; kind: 'ride' | 'courier'; status: string; pickup_address: string; pickup_lat: number; pickup_lng: number;
  dropoff_address: string; dropoff_lat: number; dropoff_lng: number; requested_at: string; accepted_at: string | null; started_at: string | null;
  completed_at: string | null; est_duration_s: number; driver_first_name: string | null; rego: string | null; make: string | null; model: string | null;
  colour: string | null; driver_lat?: number; driver_lng?: number; rider_first_name: string;
};

export default function Track() {
  const { token = '' } = useParams();
  const [trip, setTrip] = useState<T | null>(null);
  const [track, setTrack] = useState<{ lat: number; lng: number }[]>([]);
  const [live, setLive] = useState(false);
  const [car, setCar] = useState<{ lat: number; lng: number; heading?: number | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, tick] = useState(0);
  useMeta(trip ? `Trip ${trip.ref}` : 'Track a trip', 'Live DingoGo trip tracking.');

  const load = useCallback(async () => {
    try {
      const r = await get<{ trip: T; track: { lat: number; lng: number }[]; live: boolean }>(`/public/track/${token}`);
      setTrip(r.trip); setTrack(r.track); setLive(r.live); setError(null);
      if (r.trip.driver_lat != null && r.trip.driver_lng != null) setCar({ lat: r.trip.driver_lat, lng: r.trip.driver_lng });
    } catch (e) {
      setError(e instanceof ApiError && e.status === 404 ? 'notfound' : 'offline');
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
  useInterval(() => (live ? void load() : tick((n) => n + 1)), live ? (REALTIME ? 30000 : 6000) : 60000);

  if (error === 'notfound') {
    return (
      <section className="section"><div className="wrap prose">
        <h1>This tracking link isn't valid</h1>
        <p>Check you've copied the whole link from the text message. Links stop showing the car once a trip has finished.</p>
        <Link className="dg-btn" to="/">Go to DingoGo</Link>
      </div></section>
    );
  }
  if (!trip) return <section className="section"><div className="wrap"><p className="dg-muted">{error ? 'No connection. Retrying…' : 'Loading trip…'}</p></div></section>;

  const labels = trip.kind === 'courier' ? COURIER_STATUS_LABEL : STATUS_LABEL;
  const done = trip.status === 'completed';
  const ended = done || trip.status.startsWith('cancelled') || trip.status === 'no_drivers';
  const eta = trip.status === 'in_progress' && trip.started_at ? new Date(new Date(trip.started_at).getTime() + trip.est_duration_s * 1000) : null;

  const markers: MapMarker[] = [
    { id: 'a', kind: 'pickup', lat: trip.pickup_lat, lng: trip.pickup_lng, label: trip.pickup_address },
    { id: 'b', kind: 'dropoff', lat: trip.dropoff_lat, lng: trip.dropoff_lng, label: trip.dropoff_address },
    ...(car && live ? [{ id: 'car', kind: 'car' as const, lat: car.lat, lng: car.lng, heading: car.heading, label: trip.rego ?? 'Driver' }] : []),
  ];

  return (
    <div className="track">
      <div className="track-side">
        <p className="dg-muted" style={{ margin: 0 }}>{trip.kind === 'courier' ? 'Parcel' : `${trip.rider_first_name}'s trip`} {trip.ref}</p>
        <p className="track-status" role="status" aria-live="polite">{live && <span className="live-dot" aria-hidden="true" />}{labels[trip.status] ?? trip.status}</p>
        {eta && !ended && <p style={{ margin: 0 }}>Expected to arrive around <b>{time(eta)}</b></p>}
        {done && <p style={{ margin: 0 }}>{trip.kind === 'courier' ? 'Delivered' : 'Arrived'} at {time(trip.completed_at)}.</p>}
        {trip.status === 'scheduled' && <p style={{ margin: 0 }}>We'll find a driver shortly before pickup.</p>}
        {trip.driver_first_name && !ended && (
          <div className="track-car">
            <span className="rego">{trip.rego}</span>
            <span><b>{trip.driver_first_name}</b><br /><span className="dg-muted">{trip.colour} {trip.make} {trip.model}</span></span>
          </div>
        )}
        <ul className="legs" aria-label="Route">
          <li><span className="dg-muted">From</span><br />{trip.pickup_address}</li>
          <li><span className="dg-muted">To</span><br />{trip.dropoff_address}</li>
        </ul>
        {!ended && <p className="dg-note" style={{ marginTop: 18, fontSize: '.95rem' }}>Worried about this trip? Call 000 in an emergency. To reach DingoGo, use the contact details on our <Link to="/safety">safety page</Link>.</p>}
        {ended && <p className="dg-muted" style={{ marginTop: 18 }}>The car's live location is no longer shown for this trip.</p>}
      </div>
      <div className="track-map">
        <DgMap markers={markers} track={live ? track : null} padding={50} />
      </div>
    </div>
  );
}
