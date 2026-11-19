import { useState } from 'react';
import { get, money, dayName, useLoad, Ranges, Icon } from '@dingogo/shared';
import { FEE_BASIS } from '../state';
import { TaxStatements } from './Tax';

const KIND: Record<string, string> = {
  fare: 'Fares', commission: 'DingoGo fee', pickup_pay: 'Pickup pay', fuel_surcharge: 'Fuel surcharge', cancel_fee: 'Cancellation fees', shuttle_run: 'Community shuttles',
  tip: 'Tips', earnings_floor: 'Earnings floor top-ups', bonus: 'Bonuses', charging_credit: 'Charging reimbursed', adjustment: 'Adjustments',
  lease: 'Car agreement', cash_collected: 'Cash you collected', payout: 'Paid to your bank',
};
/** Breakdown groups: what trips paid, what came on top, what came off. */
const GROUPS: { title: string; kinds: string[]; total?: string }[] = [
  { title: 'Trip pay', kinds: ['fare', 'commission', 'pickup_pay', 'fuel_surcharge', 'cancel_fee', 'shuttle_run'], total: 'trip_pay_cents' },
  { title: 'On top', kinds: ['tip', 'earnings_floor', 'bonus', 'charging_credit', 'adjustment'], total: 'extras_cents' },
  { title: 'Costs', kinds: ['lease', 'cash_collected'], total: 'costs_cents' },
];
const hours = (s: number) => (s / 3600).toFixed(1);

export function Earnings() {
  const [days, setDays] = useState(7);
  const [sel, setSel] = useState<number | null>(null);
  const { data, error, loading } = useLoad(() => get(`/driver/earnings?days=${days}`), [days]);
  const byKind: Record<string, number> = data?.by_kind ?? {};
  const sum = data?.summary;
  const takeHome = sum?.take_home_cents ?? Object.entries(byKind).filter(([k]) => k !== 'payout').reduce((s, [, v]) => s + v, 0);
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
  const act = data?.activity;
  const floor = data?.floor;
  const rules = data?.pay_rules;
  const has = (k: string) => byKind[k] != null && Number(byKind[k]) !== 0;

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
            <p className="panel-label">Take-home after the DingoGo fee{has('lease') ? ', lease' : ''}{has('cash_collected') ? ' and cash you kept' : ''}</p>
            <div className="big-num">{money(takeHome)}</div>
            {act && (
              <p className="earn-stats">
                <span><strong>{act.trips}</strong> trips</span>
                <span><strong>{hours(act.engaged_s)} h</strong> on trips</span>
                {act.per_engaged_hour_cents != null && <span><strong>{money(act.per_engaged_hour_cents)}</strong> per hour on trips</span>}
                <span><strong>{act.total_km} km</strong> driven{act.pickup_km > 0 ? `, ${act.pickup_km} km to pickups` : ''}</span>
              </p>
            )}
            <p className="chart-readout" aria-live="polite"><span>{pickedLabel}</span><strong className="dg-money">{money(picked.cents)}</strong></p>
            <div className={'bars' + (days > 7 ? ' bars--dense' : '')} role="group" aria-label="Earnings per day. Choose a day to see its total.">
              {series.map((s, i) => (
                <button key={s.day} type="button" className={(i === selIdx ? 'sel' : '') + (i === series.length - 1 ? ' today' : '')}
                  aria-pressed={i === selIdx} aria-label={`${dayName(s.day)}: ${money(s.cents)}`} onClick={() => setSel(i)}>
                  <span className="bar-track"><i style={{ height: `${Math.max(0, (s.cents / max) * 100)}%` }} /></span>
                  {days === 7 && <small>{new Date(s.day + 'T12:00:00').toLocaleDateString('en-AU', { weekday: 'short' })}</small>}
                </button>
              ))}
            </div>
          </section>

          {floor?.enabled && (
            <section className="panel">
              <h2 className="panel-title">Earnings floor this week</h2>
              <p className="dg-muted" style={{ marginTop: 0 }}>You earn at least {money(floor.cents_per_engaged_hour)} for every hour on trips (from accepting to drop-off). Tips don't count towards it, so they are always extra.</p>
              <div className="info-row"><span>Hours on trips</span><strong>{hours(floor.engaged_s)} h</strong></div>
              <div className="info-row"><span>Trip pay so far</span><strong className="dg-money">{money(floor.earnings_cents)}</strong></div>
              <div className="info-row"><span>Floor for those hours</span><strong className="dg-money">{money(floor.floor_cents)}</strong></div>
              <div className="info-row"><span>Top-up if the week ended now</span><strong className="dg-money">{money(floor.projected_topup_cents)}</strong></div>
              <p className="fine-print"><Icon name="info" size={16} />Worked out after Sunday midnight and added to your balance.</p>
            </section>
          )}

          <section className="panel">
            <h2 className="panel-title">Breakdown</h2>
            {GROUPS.map((g) => {
              const ks = g.kinds.filter(has);
              if (!ks.length) return null;
              return (
                <div key={g.title} className="earn-group">
                  <h3>{g.title}</h3>
                  <ul className="list">
                    {ks.map((k) => <li key={k}><span>{KIND[k]}</span><span className="dg-money" style={{ color: byKind[k] < 0 ? 'var(--earth-ink)' : undefined }}>{money(byKind[k])}</span></li>)}
                    {sum && g.total && ks.length > 1 && <li className="earn-total"><span>{g.title} total</span><strong className="dg-money">{money(sum[g.total])}</strong></li>}
                  </ul>
                </div>
              );
            })}
            {!Object.keys(byKind).some((k) => k !== 'payout' && has(k)) && <p className="dg-muted">No earnings in this period yet.</p>}
            {has('payout') && <div className="info-row"><span>{KIND.payout}</span><strong className="dg-money">{money(-byKind.payout)}</strong></div>}
          </section>

          {rules && (
            <section className="panel">
              <h2 className="panel-title">How you are paid</h2>
              <div className="info-row"><span>DingoGo fee for your car</span><strong>{rules.fee_pct}%{rules.fee_basis !== 'driver' ? ` (${FEE_BASIS[rules.fee_basis]})` : ''}</strong></div>
              <div className="info-row"><span>Tips</span><strong>100% yours</strong></div>
              {rules.pickup && <div className="info-row"><span>Pickup pay</span><strong>{money(rules.pickup.cents_per_km)}/km after the first {rules.pickup.free_km} km</strong></div>}
              {rules.fuel_surcharge_cents != null && <div className="info-row"><span>Fuel surcharge</span><strong>{money(rules.fuel_surcharge_cents)} a trip, 100% yours</strong></div>}
              <p className="fine-print"><Icon name="info" size={16} />Each offer shows your pay before you accept, and that is the rate you get for the trip.</p>
            </section>
          )}

          <section className="panel">
            <div className="info-row"><span>Balance to be paid</span><strong className="dg-money">{money(data.balance_cents)}</strong></div>
            {Number(data.gst_on_fares_cents) > 0 && <div className="info-row"><span>GST in your trip pay</span><strong className="dg-money">{money(data.gst_on_fares_cents)}</strong></div>}
            <p className="fine-print"><Icon name="info" size={16} />Set the GST (1/11 of fares, pickup pay, fuel surcharge and cancellation fees) aside for your BAS. Cash you collect comes off what DingoGo pays you.</p>
          </section>

          <CarAgreement />

          <TaxStatements />

          {(data.ledger ?? []).length > 0 && <h2>Recent activity</h2>}
          <ul className="list">
            {(data.ledger ?? []).map((l: any) => (
              <li key={l.id}>
                <div><div>{KIND[l.kind] ?? l.kind}</div><div className="sub">{l.note ? `${l.note}, ` : ''}{dayName(l.created_at)}</div></div>
                <span className="dg-money" style={{ color: l.amount_cents < 0 ? 'var(--earth-ink)' : 'var(--saltbush-ink)' }}>{money(l.amount_cents)}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <Ranges height={36} fill="var(--line)" style={{ marginTop: 24 }} />
    </div>
  );
}

/** Round 20: shown only to drivers on a DingoGo car agreement (weekly lease or rent-to-own). */
function CarAgreement() {
  const { data } = useLoad(() => get('/driver/fleet').catch(() => null), []);
  const k = data?.contract;
  if (!k) return null;
  const t = k.totals;
  const rto = k.kind === 'rent_to_own';
  const live = k.status === 'active' || k.status === 'paused';
  const svc = (data.next_service ?? []).find((d: any) => d.status !== 'ok');
  return (
    <section className="panel">
      <h2 className="panel-title">Your car agreement</h2>
      <div className="info-row"><span>{k.rego}, {rto ? 'rent-to-own' : 'weekly lease'}</span><strong>{k.status === 'paused' ? 'Paused' : k.status === 'bought_out' ? 'Yours now' : k.status === 'ended' ? 'Ended' : `${money(k.weekly_cents)} a week`}</strong></div>
      {live && k.this_week && <div className="info-row"><span>This week</span><strong className="dg-money">{money(k.this_week.collected_cents)} of {money(k.this_week.due_cents)}</strong></div>}
      {t.owing_cents > 0 && <div className="info-row"><span>Still owing</span><strong className="dg-money" style={{ color: 'var(--earth-ink)' }}>{money(t.owing_cents)}</strong></div>}
      {t.owing_cents < 0 && <div className="info-row"><span>Paid ahead</span><strong className="dg-money">{money(-t.owing_cents)}</strong></div>}
      {rto && t.buy_out_cents != null && <div className="info-row"><span>Left to own the car</span><strong className="dg-money">{money(t.buy_out_cents)}</strong></div>}
      {data.off_road && <div className="info-row"><span>Car in for maintenance</span><strong>{data.off_road.spare_rego ? `Use ${data.off_road.spare_rego}` : 'Back soon'}</strong></div>}
      {svc && <div className="info-row"><span>{svc.label}</span><strong>{svc.status === 'overdue' ? 'Overdue' : 'Due soon'}</strong></div>}
      <p className="fine-print"><Icon name="info" size={16} />Taken from your earnings each Monday. We never take more than your balance{k.keep_min_cents ? ` and always leave you ${money(k.keep_min_cents)}` : ''}. Anything we can’t take is carried over. Call DingoGo if you need a pause.</p>
    </section>
  );
}
