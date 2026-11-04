import { Icon, STATUS_LABEL, SERVICE_ICON_NAME, dayName, get, money, statusTone, time, useLoad } from '@dingogo/shared';

export function Trips() {
  const { data, error, loading } = useLoad(() => get('/driver/trips'));
  return (
    <div className="screen">
      <h1>Trips</h1>
      {error && <p className="dg-error">{error}</p>}
      {loading && !data && <p className="dg-muted">Loading…</p>}
      <ul className="list">
        {(data?.trips ?? []).map((t: any) => (
          <li key={t.id}>
            <span className="session-ic" aria-hidden><Icon name={SERVICE_ICON_NAME[t.service] ?? 'car'} size={20} /></span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{t.pickup_address} to {t.dropoff_address}</div>
              <div className="sub">{dayName(t.completed_at ?? t.requested_at)}, {time(t.completed_at ?? t.requested_at)}{t.rider_rating ? `, rated ${t.rider_rating} of 5` : ''}{t.payment_method === 'cash' ? ', cash' : ''}</div>
            </div>
            <div style={{ textAlign: 'right', flex: 'none' }}>
              {t.final_cents != null && <div className="dg-money">{money(t.final_cents)}</div>}
              {t.tip_cents > 0 && <div className="sub">+{money(t.tip_cents)} tip</div>}
              {t.status !== 'completed' && <span className={`dg-chip dg-chip--${statusTone(t.status)}`}>{STATUS_LABEL[t.status]}</span>}
            </div>
          </li>
        ))}
        {data && !data.trips?.length && <li className="dg-muted">No trips yet. Go online to start receiving requests.</li>}
      </ul>
    </div>
  );
}
