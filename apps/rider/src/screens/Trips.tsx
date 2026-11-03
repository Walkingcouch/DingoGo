import { Link } from 'react-router-dom';
import { COURIER_STATUS_LABEL, SERVICE_ICON, STATUS_LABEL, dayName, get, money, statusTone, time, useLoad } from '@dingogo/shared';
import { Page, Spinner } from '../components/ui';
import { ACTIVE } from '../ctx';

export function TripsScreen() {
  const { data, error, loading } = useLoad(() => get<{ trips: any[] }>('/trips'));
  const trips = data?.trips ?? [];
  const upcoming = trips.filter((t) => t.status === 'scheduled' || ACTIVE.includes(t.status));
  const past = trips.filter((t) => !upcoming.includes(t));
  return (
    <Page title="Your trips">
      {loading && <Spinner />}
      {error && <p className="dg-error">{error}</p>}
      {!loading && !trips.length && (
        <div className="empty">
          <p>No trips yet. Book a ride, send a parcel or try a tour.</p>
          <Link className="dg-btn" to="/">Book a ride</Link>
        </div>
      )}
      {upcoming.length > 0 && (
        <section className="section">
          <h2 className="section__title">Coming up</h2>
          <ul className="list">{upcoming.map((t) => <TripRow key={t.id} t={t} />)}</ul>
        </section>
      )}
      {past.length > 0 && (
        <section className="section">
          <h2 className="section__title">Past trips</h2>
          <ul className="list">{past.map((t) => <TripRow key={t.id} t={t} />)}</ul>
        </section>
      )}
    </Page>
  );
}

function TripRow({ t }: { t: any }) {
  const labels = t.kind === 'courier' ? COURIER_STATUS_LABEL : STATUS_LABEL;
  const href = ACTIVE.includes(t.status) ? `/trip/${t.id}` : `/trips/${t.id}`;
  const when = t.scheduled_for ?? t.requested_at;
  return (
    <li>
      <Link to={href} className="row">
        <span className="row__icon" aria-hidden="true">{SERVICE_ICON[t.service] ?? '🚗'}</span>
        <span className="row__main">
          <strong>{t.dropoff_address === t.pickup_address ? t.pickup_address : t.dropoff_address}</strong>
          <span className="dg-muted">{dayName(when)}, {time(when)}</span>
        </span>
        <span className="row__end">
          <span className="dg-money">{money(t.final_cents ?? t.quote_cents)}</span>
          <span className={`dg-chip dg-chip--${statusTone(t.status)}`}>{labels[t.status]}</span>
        </span>
      </Link>
    </li>
  );
}
