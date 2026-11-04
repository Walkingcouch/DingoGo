import { Link } from 'react-router-dom';
import { COURIER_STATUS_LABEL, Icon, SERVICE_ICON_NAME, STATUS_LABEL, dayName, get, money, statusTone, time, useLoad } from '@dingogo/shared';
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

/** Drop the trailing suburb/state so addresses fit on one line. */
const short = (a?: string) => (a ?? '').replace(/,?\s*(Alice Springs|NT|0870|Australia)\b.*$/i, '') || a || '';

function TripRow({ t }: { t: any }) {
  const labels = t.kind === 'courier' ? COURIER_STATUS_LABEL : STATUS_LABEL;
  const href = ACTIVE.includes(t.status) ? `/trip/${t.id}` : `/trips/${t.id}`;
  const when = t.scheduled_for ?? t.requested_at;
  return (
    <li>
      <Link to={href} className="row">
        <span className="row__icon"><Icon name={SERVICE_ICON_NAME[t.service] ?? 'car'} size={20} /></span>
        <span className="row__main trip-row">
          <span className="trip-row__when"><span>{dayName(when)}, {time(when)}</span><span className={`dg-chip dg-chip--${statusTone(t.status)}`}>{labels[t.status]}</span></span>
          <span className="trip-row__place"><span className="trip-row__dot" aria-hidden="true" /><span>{short(t.pickup_address)}</span></span>
          {t.dropoff_address && t.dropoff_address !== t.pickup_address && (
            <span className="trip-row__place"><span className="trip-row__dot trip-row__dot--to" aria-hidden="true" /><span><span className="sr-only">to </span>{short(t.dropoff_address)}</span></span>
          )}
        </span>
        <span className="row__end">
          <span className="dg-money">{money(t.final_cents ?? t.quote_cents)}</span>
          <Icon name="chevronRight" size={18} className="row__chev" />
        </span>
      </Link>
    </li>
  );
}
