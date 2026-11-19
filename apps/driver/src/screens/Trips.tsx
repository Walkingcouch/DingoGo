import { useState } from 'react';
import { Link } from 'react-router-dom';
import { DriverLostItems, Icon, STATUS_LABEL, SERVICE_ICON_NAME, SafetyReportForm, TripHelp, dayName, get, money, statusTone, time, useLoad } from '@dingogo/shared';
import { Sheet } from '../Sheet';

export function Trips() {
  const { data, error, loading } = useLoad(() => get('/driver/trips'));
  const [report, setReport] = useState<any>(null);
  const [help, setHelp] = useState<any>(null);
  return (
    <div className="screen" tabIndex={0} aria-label="Your trips">
      <h1>Trips</h1>
      <p className="dg-muted" style={{ marginTop: 0 }}>Questions about a trip? Tap Get help. Everything else is in <Link to="/help">Help</Link>.</p>
      <DriverLostItems />
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
              {t.driver_pay_cents != null
                ? <><div className="dg-money" aria-label={`You earned ${money(t.driver_pay_cents)}`}>{money(t.driver_pay_cents)}</div>{t.final_cents != null && <div className="sub">Rider paid {money(t.final_cents)}</div>}</>
                : t.final_cents != null && <div className="dg-money">{money(t.final_cents)}</div>}
              {t.tip_cents > 0 && <div className="sub">+{money(t.tip_cents)} tip</div>}
              {t.status !== 'completed' && <span className={`dg-chip dg-chip--${statusTone(t.status)}`}>{STATUS_LABEL[t.status]}</span>}
              <div><button className="link-btn" onClick={() => setHelp(t)} aria-label={`Get help with trip ${t.ref ?? ''}`}>Get help</button>
                <button className="link-btn" onClick={() => setReport(t)} aria-label={`Report a safety problem on trip ${t.ref ?? ''}`}>Report</button></div>
            </div>
          </li>
        ))}
        {data && !data.trips?.length && <li className="dg-muted">No trips yet. Go online to start receiving requests.</li>}
      </ul>
      {help && (
        <Sheet onClose={() => setHelp(null)} labelledBy="th-help-h">
          <TripHelp tripId={help.id} onSafety={() => { setReport(help); setHelp(null); }} />
          <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 10 }} onClick={() => setHelp(null)}>Close</button>
        </Sheet>
      )}
      {report && (
        <Sheet onClose={() => setReport(null)} labelledBy="rep-h">
          <h2 id="rep-h">Report a safety problem</h2>
          <p className="dg-muted" style={{ marginTop: 0 }}>{report.pickup_address} to {report.dropoff_address}</p>
          <SafetyReportForm tripId={report.id} />
          <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 10 }} onClick={() => setReport(null)}>Close</button>
        </Sheet>
      )}
    </div>
  );
}
