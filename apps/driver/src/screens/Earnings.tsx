import { useState } from 'react';
import { get, money, dayName, useLoad, Ranges } from '@dingogo/shared';

const KIND: Record<string, string> = {
  fare: 'Fares', commission: 'DingoGo fee', tip: 'Tips', cash_collected: 'Cash you collected', lease: 'Vehicle lease',
  charging_credit: 'Charging reimbursed', bonus: 'Bonuses', payout: 'Paid to your bank', adjustment: 'Adjustments', cancel_fee: 'Cancellation fees',
};

export function Earnings() {
  const [days, setDays] = useState(7);
  const { data, error, loading } = useLoad(() => get(`/driver/earnings?days=${days}`), [days]);
  const byKind: Record<string, number> = data?.by_kind ?? {};
  const takeHome = Object.entries(byKind).filter(([k]) => k !== 'payout').reduce((s, [, v]) => s + v, 0);
  const daily: { day: string; cents: number }[] = data?.daily ?? [];
  // Fill gaps so the chart shows every day in range
  const series = Array.from({ length: days }, (_, i) => {
    const d = new Date(Date.now() - (days - 1 - i) * 864e5).toLocaleDateString('en-CA', { timeZone: 'Australia/Darwin' });
    return { day: d, cents: daily.find((x) => x.day === d)?.cents ?? 0 };
  });
  const max = Math.max(1, ...series.map((s) => s.cents));

  return (
    <div className="screen">
      <h1>Earnings</h1>
      <div className="seg" role="group" aria-label="Period">
        <button aria-pressed={days === 7} onClick={() => setDays(7)}>Last 7 days</button>
        <button aria-pressed={days === 30} onClick={() => setDays(30)}>Last 30 days</button>
      </div>
      {error && <p className="dg-error">{error}</p>}
      {loading && !data ? <p className="dg-muted">Loading…</p> : data && (
        <>
          <section className="panel">
            <span className="dg-muted" style={{ fontWeight: 700 }}>Take-home after fees, lease and cash</span>
            <div className="big-num">{money(takeHome)}</div>
            <div className="bars" aria-label="Earnings per day">
              {series.map((s) => (
                <div key={s.day} title={`${dayName(s.day)}: ${money(s.cents)}`}>
                  <i style={{ height: `${Math.max(0, (s.cents / max) * 100)}%`, opacity: s.cents < 0 ? 0.3 : 1 }} />
                  {days === 7 && <small>{new Date(s.day).toLocaleDateString('en-AU', { weekday: 'narrow' })}</small>}
                </div>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2 style={{ marginTop: 0 }}>Breakdown</h2>
            <ul className="list">
              {Object.keys(KIND).filter((k) => byKind[k] != null).map((k) => (
                <li key={k}><span>{KIND[k]}</span><span className="dg-money" style={{ color: byKind[k] < 0 ? 'var(--earth)' : undefined }}>{money(byKind[k])}</span></li>
              ))}
              {!Object.keys(byKind).length && <li className="dg-muted">No earnings in this period yet.</li>}
            </ul>
          </section>

          <section className="panel">
            <div className="info-row"><span>Balance to be paid</span><strong className="dg-money">{money(data.balance_cents)}</strong></div>
            <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)', marginBottom: 0 }}>
              GST: {money(data.gst_on_fares_cents)} of your fares this period is GST (1/11). Set it aside for your BAS. Cash you collect is subtracted from what DingoGo pays you.
            </p>
          </section>

          <h2>Recent activity</h2>
          <ul className="list">
            {(data.ledger ?? []).map((l: any) => (
              <li key={l.id}>
                <div><div>{KIND[l.kind] ?? l.kind}</div><div className="sub">{l.note ? `${l.note}, ` : ''}{dayName(l.created_at)}</div></div>
                <span className="dg-money" style={{ color: l.amount_cents < 0 ? 'var(--earth)' : 'var(--saltbush)' }}>{money(l.amount_cents)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Ranges height={36} fill="var(--line)" style={{ marginTop: 24 }} />
    </div>
  );
}
