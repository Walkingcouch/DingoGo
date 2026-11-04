import { useState } from 'react';
import { get, money, dayName, useLoad, Ranges, Icon } from '@dingogo/shared';

const KIND: Record<string, string> = {
  fare: 'Fares', commission: 'DingoGo fee', tip: 'Tips', cash_collected: 'Cash you collected', lease: 'Vehicle lease',
  charging_credit: 'Charging reimbursed', bonus: 'Bonuses', payout: 'Paid to your bank', adjustment: 'Adjustments', cancel_fee: 'Cancellation fees',
};

export function Earnings() {
  const [days, setDays] = useState(7);
  const [sel, setSel] = useState<number | null>(null);
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
  const selIdx = sel != null && sel < series.length ? sel : series.length - 1;
  const picked = series[selIdx];
  const pickedLabel = selIdx === series.length - 1 ? 'Today' : new Date(picked.day + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'long', day: 'numeric', month: 'short' });
  const rows = Object.keys(KIND).filter((k) => byKind[k] != null && Number(byKind[k]) !== 0);

  return (
    <div className="screen">
      <h1>Earnings</h1>
      <div className="seg" role="group" aria-label="Period">
        <button aria-pressed={days === 7} onClick={() => { setDays(7); setSel(null); }}>Last 7 days</button>
        <button aria-pressed={days === 30} onClick={() => { setDays(30); setSel(null); }}>Last 30 days</button>
      </div>
      {error && <p className="dg-error">{error}</p>}
      {loading && !data ? <p className="dg-muted">Loading…</p> : data && (
        <>
          <section className="panel">
            <p className="panel-label">Take-home after fees, lease and cash</p>
            <div className="big-num">{money(takeHome)}</div>
            <p className="chart-readout" aria-live="polite"><span>{pickedLabel}</span><strong className="dg-money">{money(picked.cents)}</strong></p>
            <div className={'bars' + (days > 7 ? ' bars--dense' : '')} role="group" aria-label="Earnings per day. Choose a day to see its total.">
              {series.map((s, i) => (
                <button key={s.day} type="button" className={(i === selIdx ? 'sel' : '') + (i === series.length - 1 ? ' today' : '')}
                  aria-pressed={i === selIdx} aria-label={`${dayName(s.day)}: ${money(s.cents)}`} onClick={() => setSel(i)}>
                  <span className="bar-track"><i style={{ height: `${Math.max(0, (s.cents / max) * 100)}%` }} /></span>
                  {days === 7 && <small>{new Date(s.day + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short' }).slice(0, 2)}</small>}
                </button>
              ))}
            </div>
          </section>

          <section className="panel">
            <h2 className="panel-title">Breakdown</h2>
            <ul className="list">
              {rows.map((k) => (
                <li key={k}><span>{KIND[k]}</span><span className="dg-money" style={{ color: byKind[k] < 0 ? 'var(--earth)' : undefined }}>{money(byKind[k])}</span></li>
              ))}
              {!rows.length && <li className="dg-muted">No earnings in this period yet.</li>}
            </ul>
          </section>

          <section className="panel">
            <div className="info-row"><span>Balance to be paid</span><strong className="dg-money">{money(data.balance_cents)}</strong></div>
            {Number(data.gst_on_fares_cents) > 0 && <div className="info-row"><span>GST in your fares</span><strong className="dg-money">{money(data.gst_on_fares_cents)}</strong></div>}
            <p className="fine-print"><Icon name="info" size={16} />Set the GST (1/11 of fares) aside for your BAS. Cash you collect comes off what DingoGo pays you.</p>
          </section>

          {(data.ledger ?? []).length > 0 && <h2>Recent activity</h2>}
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
