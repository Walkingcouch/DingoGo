import { useEffect, useState } from 'react';
import { get, put, post, money, dateTime, useLoad } from '@dingogo/shared';
import { Chip, ErrorMsg, Section, Table, exportCsv, useRun } from '../ui';

/** Monday (YYYY-MM-DD) of the Darwin-time week `weeksAgo` weeks back. */
function monday(weeksAgo = 1) {
  const local = new Date(new Date(Date.now() - weeksAgo * 7 * 864e5).toLocaleDateString('en-CA', { timeZone: 'Australia/Darwin' }) + 'T00:00:00Z');
  return new Date(local.getTime() - ((local.getUTCDay() + 6) % 7) * 864e5).toISOString().slice(0, 10);
}
const hours = (s: number) => (s / 3600).toFixed(1);
const dollars = (c: number) => (c / 100).toFixed(2);
const cents = (v: string) => Math.round(Number(v || 0) * 100);

/** Pricing → Driver pay: service fee by car, pickup pay + long-pickup charge, fuel surcharge, weekly earnings floor. */
export default function DriverPay() {
  return (<>
    <Rules />
    <Floor />
  </>);
}

function Rules() {
  const { data, error, reload } = useLoad(() => get('/admin/driver-pay'));
  const [v, setV] = useState<any>(null);
  const run = useRun();
  useEffect(() => { if (data) setV(structuredClone(data.settings)); }, [data]);
  if (!v) return <ErrorMsg error={error} />;
  const set = (g: string, k: string, x: any) => setV({ ...v, [g]: { ...v[g], [k]: x } });
  const num = (g: string, k: string, label: string, help?: string, step = 1) => (
    <label className="dg-field"><span>{label}</span><input className="dg-input" type="number" step={step} min={0} value={v[g][k]} onChange={(e) => set(g, k, Number(e.target.value))} />{help && <small className="dg-muted">{help}</small>}</label>);
  const money$ = (g: string, k: string, label: string, help?: string) => (
    <label className="dg-field"><span>{label}</span><input className="dg-input" type="number" step="0.05" min={0} value={dollars(v[g][k])} onChange={(e) => set(g, k, cents(e.target.value))} />{help && <small className="dg-muted">{help}</small>}</label>);
  const onOff = (g: string, label: string) => (
    <label className="dg-check"><input type="checkbox" checked={!!v[g].enabled} onChange={(e) => set(g, 'enabled', e.target.checked)} /><span>{label}</span></label>);
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!confirm('Save driver pay rules? New rates apply to offers from now on; trips already accepted keep their rate.')) return;
    if (await run(() => put('/admin/driver-pay', v), 'Driver pay saved')) void reload();
  }
  return (
    <form onSubmit={save} style={{ maxWidth: 900 }}>
      <p className="dg-muted" style={{ marginTop: 0 }}>Drivers see their pay on every offer, and that is what they get for the trip. Changes apply to new offers; trips already accepted keep the rate shown when the driver accepted.</p>

      <Section title="DingoGo service fee by car" />
      <p className="dg-muted" style={{ marginTop: 0 }}>A driver’s own rate (Drivers, service fee) is the most they pay: these rates only ever lower it. Both start at 25%, the current fee.</p>
      <div className="form-grid">
        {num('service_fee', 'own_car_pct', 'Own car, petrol or diesel (%)', 'Driver-owned cars. Suggested: 20%.', 0.5)}
        {num('service_fee', 'green_pct', 'Electric or hybrid (%)', 'Any electric, plug-in hybrid or hybrid car. Suggested: 15%.', 0.5)}
      </div>

      <Section title="Pickup pay and long-pickup charge" right={v.pickup.enabled ? <Chip tone="green">On</Chip> : <Chip>Off</Chip>} />
      <p className="dg-muted" style={{ marginTop: 0 }}>The first kilometres to a pickup are unpaid. Beyond that the driver gets pickup pay (no service fee). The rider sees a “Long pickup” line in the price when the nearest free car is further away than that (not on booked trips or tours).</p>
      {onOff('pickup', 'Pay for long pickups and charge riders for them')}
      <div className="form-grid">
        {num('pickup', 'free_km', 'Free km before pay starts', undefined, 0.5)}
        {money$('pickup', 'driver_cents_per_km', 'Driver gets per km ($)')}
        {money$('pickup', 'rider_cents_per_km', 'Rider pays per km ($)')}
        {num('pickup', 'max_km', 'Most km paid or charged', undefined, 0.5)}
      </div>

      <Section title="Fuel surcharge" right={v.fuel_surcharge.enabled ? <Chip tone="green">On</Chip> : <Chip>Off</Chip>} />
      <p className="dg-muted" style={{ marginTop: 0 }}>A flat amount on each ride or parcel (not tours). Promo codes and points don’t cover it, and all of it goes to the driver.</p>
      {onOff('fuel_surcharge', 'Add a fuel surcharge')}
      <div className="form-grid">{money$('fuel_surcharge', 'cents', 'Amount per trip ($)')}</div>

      <Section title="Weekly earnings floor" right={v.earnings_floor.enabled ? <Chip tone="green">On</Chip> : <Chip>Off</Chip>} />
      <p className="dg-muted" style={{ marginTop: 0 }}>Each week (Monday to Sunday, Darwin time), drivers earn at least this much per hour on trips, from accepting to drop-off. Trip pay (fares less the fee, pickup pay, fuel surcharge, cancellation fees) counts; tips never do. DingoGo pays the difference into the driver’s balance.</p>
      {onOff('earnings_floor', 'Top drivers up to the floor')}
      <div className="form-grid">
        {money$('earnings_floor', 'cents_per_engaged_hour', 'Floor per hour on trips ($)')}
        <label className="dg-check" style={{ alignSelf: 'end' }}><input type="checkbox" checked={!!v.earnings_floor.auto_weekly} onChange={(e) => set('earnings_floor', 'auto_weekly', e.target.checked)} /><span>Pay top-ups automatically each Monday</span></label>
      </div>
      <button className="dg-btn">Save driver pay</button>
    </form>
  );
}

function Floor() {
  const [week, setWeek] = useState(monday(1));
  const { data, error, reload } = useLoad(() => get(`/admin/driver-pay/floor?week=${week}`), [week]);
  const run = useRun();
  const weeks = Array.from({ length: 8 }, (_, i) => monday(i));
  return (<>
    <Section title="Earnings floor report" right={
      <select className="dg-select" value={week} onChange={(e) => setWeek(e.target.value)} aria-label="Week" style={{ width: 'auto', minHeight: 38 }}>
        {weeks.map((w, i) => <option key={w} value={w}>Week of {new Date(w + 'T12:00:00Z').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}{i === 0 ? ' (this week)' : ''}</option>)}
      </select>} />
    <ErrorMsg error={error} />
    {data && (<>
      {data.migration_pending && <p className="dg-error" role="alert">The database update for the earnings floor (migration 012) hasn’t been applied yet, so top-ups can’t be paid. The report below is a preview.</p>}
      {!data.enabled && <p className="dg-muted">The floor is off. The report shows what top-ups would have been at {money(data.cents_per_engaged_hour)} per hour.</p>}
      <div className="kpis">
        <div className="kpi"><b>{data.totals.drivers}</b><span>Drivers with trips</span></div>
        <div className="kpi"><b>{hours(data.totals.engaged_s)} h</b><span>Hours on trips</span></div>
        <div className="kpi"><b>{money(data.totals.earnings_cents)}</b><span>Trip pay</span></div>
        <div className="kpi"><b>{money(data.totals.topup_cents)}</b><span>{data.settled ? 'Top-ups paid' : 'Top-ups due'} ({data.totals.drivers_topped_up} drivers)</span></div>
      </div>
      <div className="actions" style={{ margin: '10px 0' }}>
        {data.enabled && data.week_over && !data.migration_pending && (
          <button className="dg-btn dg-btn--sm dg-btn--dark" onClick={async () => {
            if (!confirm(`Pay earnings-floor top-ups for the week of ${data.week_start}? Drivers already settled for this week are skipped.`)) return;
            const r = await run(() => post('/admin/driver-pay/floor/run', { week: data.week_start }));
            if (r) { alert(`${money(r.topup_cents)} added for ${r.drivers_topped_up} driver(s).`); void reload(); }
          }}>Pay top-ups for this week</button>)}
        {!data.week_over && <span className="dg-muted">This week isn’t over yet: figures so far.</span>}
        <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => exportCsv(`earnings-floor-${data.week_start}.csv`, data.rows.map((r: any) => ({
          week_start: data.week_start, driver: r.name, trips: r.trips, engaged_hours: hours(r.engaged_s), trip_pay: dollars(r.earnings_cents),
          per_hour: r.per_engaged_hour_cents != null ? dollars(r.per_engaged_hour_cents) : '', floor: dollars(r.floor_cents), topup: dollars(r.paid_cents ?? r.topup_cents), paid: r.paid_at ? 'yes' : 'no',
        })))}>Export CSV</button>
      </div>
      <Table rows={data.rows} rowKey={(r) => r.driver_id} empty="No trips that week." cols={[
        { key: 'name', label: 'Driver' }, { key: 'trips', label: 'Trips', num: true },
        { key: 'engaged_s', label: 'Hours on trips', num: true, render: (r) => hours(r.engaged_s) },
        { key: 'earnings_cents', label: 'Trip pay', num: true, render: (r) => money(r.earnings_cents) },
        { key: 'per_engaged_hour_cents', label: 'Per hour', num: true, render: (r) => money(r.per_engaged_hour_cents) },
        { key: 'floor_cents', label: 'Floor', num: true, render: (r) => money(r.floor_cents) },
        { key: 'topup_cents', label: 'Top-up', num: true, render: (r) => <strong>{money(r.paid_cents ?? r.topup_cents)}</strong> },
        { key: 'paid_at', label: 'Paid', render: (r) => (r.paid_at ? dateTime(r.paid_at) : '') },
      ]} />
    </>)}
  </>);
}
