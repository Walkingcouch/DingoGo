import { useEffect, useState, type ReactNode } from 'react';
import { useSearchParams } from 'react-router-dom';
import { dayName, get, money, monthName, post, put, useLoad } from '@dingogo/shared';
import { Page } from '../ctx';
import { Bars, Chip, ErrorMsg, Loading, Section, Table, Tabs, downloadFile, useRun, useToast } from '../ui';

/** Round 27: owner insights — business health, supply and demand, forecast and driver plan, unit economics, pricing simulator,
 *  weekly owner summary and the settings behind them. Admin only. */
type Tab = 'health' | 'supply' | 'forecast' | 'economics' | 'simulator' | 'weekly' | 'settings';
const TABS: [Tab, string][] = [['health', 'Business health'], ['supply', 'Supply & demand'], ['forecast', 'Forecast & drivers'], ['economics', 'Unit economics'],
  ['simulator', 'Pricing simulator'], ['weekly', 'Weekly summary'], ['settings', 'Settings']];
const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const hourName = (h: number) => (h === 0 ? '12am' : h < 12 ? `${h}am` : h === 12 ? '12pm' : `${h - 12}pm`);
const pctTxt = (v: number | null | undefined) => (v == null ? '—' : `${v}%`);
const changeTxt = (v: number | null | undefined, unit = '%', what = 'on the period before') => (v == null ? null : v === 0 ? `Same as ${what.replace(/^on /, '')}` : `${v > 0 ? 'Up' : 'Down'} ${Math.abs(v)}${unit} ${what}`);
const KIND_NAME: Record<string, string> = { rides: 'Rides', courier: 'Courier', tours: 'Tours and hire' };

function Kpi({ title, value, note, tone }: { title: string; value: ReactNode; note?: ReactNode; tone?: 'red' | 'green' }) {
  return <div className="kpi"><span className="kpi__title">{title}</span><b className={tone ? `kpi__v--${tone}` : undefined}>{value}</b>{note && <small className="kpi__note">{note}</small>}</div>;
}
const Select = ({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: [string, string][]; label: string }) => (
  <select className="dg-input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} style={{ width: 'auto', minHeight: 38 }}>
    {options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
  </select>
);

export default function Insights() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find(([k]) => k === params.get('tab'))?.[0] ?? 'health') as Tab;
  return (
    <Page title="Insights">
      <p className="dg-muted" style={{ marginTop: 0, maxWidth: 820 }}>How the business is going and what to do next. Darwin time; test accounts left out. Card fees, GST and drivers’ running costs are estimates from the settings tab.</p>
      <Tabs tabs={TABS} value={tab} onChange={(t) => setParams(t === 'health' ? {} : { tab: t }, { replace: true })} label="Insights sections">
        {tab === 'health' && <Health />}
        {tab === 'supply' && <Supply />}
        {tab === 'forecast' && <Forecast />}
        {tab === 'economics' && <Economics />}
        {tab === 'simulator' && <Simulator />}
        {tab === 'weekly' && <Weekly />}
        {tab === 'settings' && <Settings />}
      </Tabs>
    </Page>
  );
}

// ───────────── Business health ─────────────
function Health() {
  const [days, setDays] = useState('28');
  const h = useLoad(() => get(`/admin/insights/health?days=${days}`), [days]);
  const run = useRun();
  const d = h.data;
  return (<>
    <Section title="Business health" right={<span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <Select value={days} onChange={setDays} label="Period" options={[['7', 'Last 7 days'], ['28', 'Last 28 days'], ['90', 'Last 90 days']]} />
      {d && <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadFile(`/admin/insights/health?from=${d.from}&to=${d.to}&format=csv`), 'Daily figures downloaded')}>Daily CSV</button>}
    </span>} />
    <ErrorMsg error={h.error} />
    {!d && !h.error && <Loading />}
    {d && (<>
      <p className="dg-muted" style={{ marginTop: 0 }}>{dayName(d.from)} to {dayName(d.to)}, against {dayName(d.previous.from)} to {dayName(d.previous.to)}.</p>
      <div className="kpis" aria-label="Headline figures">
        <Kpi title="Trips completed" value={d.trips.completed} note={<>{d.trips.per_day} a day. {changeTxt(d.changes.completed_pct)}</>} />
        <Kpi title="Requests not filled" value={pctTxt(d.trips.unfilled_pct)} tone={(d.trips.unfilled_pct ?? 0) >= 5 ? 'red' : undefined}
          note={`${d.trips.no_drivers} found no driver, ${d.trips.rider_gave_up} gave up waiting`} />
        <Kpi title="Riders paid" value={money(d.money.gross_cents)} note={changeTxt(d.changes.gross_pct)} />
        <Kpi title="DingoGo kept" value={money(d.money.kept_cents)} note={`Take rate ${pctTxt(d.money.take_rate_pct)}. ${changeTxt(d.changes.kept_pct) ?? ''}`} />
        <Kpi title="Net contribution" value={money(d.money.net_cents)} tone={d.money.net_cents < 0 ? 'red' : undefined} note="After GST, card fees and refunds" />
        <Kpi title="Driver pay per online hour" value={money(d.drivers.per_online_hour_cents)} note={`After running costs; ${money(d.drivers.per_engaged_hour_cents)} per hour on trips`} />
      </div>
      <div className="kpis" style={{ marginTop: 12 }} aria-label="Service figures">
        <Kpi title="Average pickup" value={d.trips.avg_pickup_min == null ? '—' : `${d.trips.avg_pickup_min} min`} note={d.trips.p90_pickup_min == null ? undefined : `9 in 10 within ${d.trips.p90_pickup_min} min`} />
        <Kpi title="Wait for a driver" value={d.trips.avg_wait_to_accept_min == null ? '—' : `${d.trips.avg_wait_to_accept_min} min`} note="Request to accept" />
        <Kpi title="Cancelled" value={pctTxt(d.trips.cancellations.rate_pct)} note={`Riders ${pctTxt(d.trips.cancellations.rider_pct)}, drivers ${pctTxt(d.trips.cancellations.driver_pct)}`} />
        <Kpi title="Riders who came back" value={pctTxt(d.riders.repeat_pct)} note={`${d.riders.active} riders, ${d.riders.new} new; ${pctTxt(d.riders.returning_pct)} had ridden before`} />
        <Kpi title="Drivers' time on trips" value={pctTxt(d.drivers.utilisation_pct)} note={`${d.drivers.online_hours} hours online by ${d.drivers.online} drivers`} />
        <Kpi title="Km in green cars" value={pctTxt(d.green.green_km_pct)} note={`${d.green.green_km} of ${d.green.km} km electric or hybrid`} />
      </div>

      <h3 style={{ marginTop: 18 }}>Trips completed each day</h3>
      <Bars data={d.daily} value={(x) => x.completed} label={(x) => dayName(x.day).replace(/^\w+, /, '')} unit="Trips completed" empty="No trips in this period" />
      <h3 style={{ marginTop: 14 }}>What DingoGo kept each day</h3>
      <Bars data={d.daily} value={(x) => Math.max(0, x.kept_cents)} label={(x) => dayName(x.day).replace(/^\w+, /, '')} format={(v) => money(v)} unit="Kept" color="var(--saltbush, #5b8c51)" empty="Nothing yet" />

      <div className="grid-2" style={{ marginTop: 16 }}>
        <div>
          <h3>Mix</h3>
          <Table rows={d.mix} rowKey={(r) => r.kind} cols={[
            { key: 'kind', label: 'Type', render: (r) => KIND_NAME[r.kind] ?? r.kind }, { key: 'trips', label: 'Trips', num: true },
            { key: 'share_pct', label: 'Share', num: true, render: (r) => pctTxt(r.share_pct) }, { key: 'gross_cents', label: 'Riders paid', num: true, render: (r) => money(r.gross_cents) },
          ]} />
        </div>
        <div>
          <h3>Cancellations</h3>
          <Table rows={[
            { k: 'Rider, before a driver accepted', n: d.trips.cancellations.rider_before_accept },
            { k: 'Rider, after a driver accepted', n: d.trips.cancellations.rider_after_accept },
            { k: 'Driver', n: d.trips.cancellations.driver }, { k: 'Operations', n: d.trips.cancellations.ops },
            { k: 'No driver found', n: d.trips.no_drivers },
          ]} rowKey={(r) => r.k} cols={[{ key: 'k', label: 'Who' }, { key: 'n', label: 'Requests', num: true }]} />
          <p className="dg-muted">{d.trips.cancellations.fees_charged} cancellation fees charged ({money(d.trips.cancellations.fees_cents)}).</p>
        </div>
      </div>
      <ul className="dg-muted" style={{ fontSize: '.85rem' }}>{d.assumptions.notes.map((n: string) => <li key={n}>{n}</li>)}</ul>
    </>)}
  </>);
}

// ───────────── Supply and demand ─────────────
type Measure = 'requests' | 'online' | 'unfilled' | 'requests_per_driver';
const MEASURES: [Measure, string][] = [['requests', 'Requests an hour'], ['online', 'Drivers online'], ['unfilled', 'Unfilled requests'], ['requests_per_driver', 'Requests per driver online']];

function Heatmap({ cells, measure }: { cells: any[]; measure: Measure }) {
  const max = Math.max(0.0001, ...cells.map((c) => Number(c[measure] ?? 0)));
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const label = MEASURES.find(([k]) => k === measure)![1];
  return (
    <div className="tbl-wrap heat-wrap" tabIndex={0} role="region" aria-label={`${label} by weekday and hour`}>
      <table className="heat">
        <caption className="sr-only">{label}: average per week, by weekday (rows) and hour of the day (columns), Darwin time.</caption>
        <thead><tr><th scope="col"><span className="sr-only">Weekday</span></th>{hours.map((h) => <th key={h} scope="col">{h % 3 === 0 ? hourName(h) : <span className="sr-only">{hourName(h)}</span>}</th>)}</tr></thead>
        <tbody>{DAYS.map((dn, wd) => (
          <tr key={dn}><th scope="row">{dn}</th>{hours.map((h) => {
            const c = cells.find((x) => x.weekday === wd && x.hour === h);
            const v = c?.[measure] == null ? null : Number(c[measure]);
            const a = v == null ? 0 : Math.min(1, v / max);
            const tone = measure === 'unfilled' || measure === 'requests_per_driver' ? 'var(--earth, #b4532a)' : measure === 'online' ? 'var(--saltbush, #5b8c51)' : 'var(--ochre)';
            return <td key={h} style={{ background: v ? `color-mix(in srgb, ${tone} ${Math.round(8 + a * 37)}%, var(--surface))` : undefined, fontWeight: a > 0.6 ? 700 : undefined }}
              title={`${dn} ${hourName(h)}: ${v ?? '—'}`}>{v == null || v === 0 ? '' : v >= 10 ? Math.round(v) : v}</td>;
          })}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

function Supply() {
  const [weeks, setWeeks] = useState('8');
  const [measure, setMeasure] = useState<Measure>('requests');
  const s = useLoad(() => get(`/admin/insights/supply-demand?weeks=${weeks}`), [weeks]);
  const c = useLoad(() => get('/admin/insights/cohorts?months=6'), []);
  const d = s.data;
  const cell = (x: any) => `${DAYS[x.weekday]} ${hourName(x.hour)}`;
  return (<>
    <Section title="Supply and demand by hour" right={<span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      <Select value={measure} onChange={(v) => setMeasure(v as Measure)} label="Show" options={MEASURES} />
      <Select value={weeks} onChange={setWeeks} label="Weeks" options={[['4', 'Last 4 weeks'], ['8', 'Last 8 weeks'], ['13', 'Last 13 weeks']]} />
    </span>} />
    <ErrorMsg error={s.error} />
    {!d && !s.error && <Loading />}
    {d && (<>
      <p className="dg-muted" style={{ marginTop: 0 }}>Average per week, {dayName(d.from)} to {dayName(d.to)}. Darker is more. Drivers online come from the time drivers had the app switched on{d.online_data ? '' : ' (not available on this database)'}.</p>
      <Heatmap cells={d.cells} measure={measure} />
      <div className="grid-2" style={{ marginTop: 16 }}>
        <div><h3>Busiest hours</h3>
          <Table rows={d.busiest} rowKey={cell} cols={[{ key: 'h', label: 'When', render: cell }, { key: 'requests', label: 'Requests', num: true }, { key: 'online', label: 'Drivers online', num: true }]} /></div>
        <div><h3>Most requests not filled</h3>
          <Table rows={d.shortest} rowKey={cell} empty="Every request was filled." cols={[{ key: 'h', label: 'When', render: cell }, { key: 'unfilled', label: 'Unfilled', num: true }, { key: 'requests', label: 'Requests', num: true }, { key: 'online', label: 'Drivers online', num: true }]} /></div>
      </div>
    </>)}
    <Section title="Riders who keep riding" />
    <p className="dg-muted" style={{ marginTop: 0 }}>Riders grouped by the month of their first trip, and the share who rode again in each month after.</p>
    <ErrorMsg error={c.error} />
    {c.data && (
      <Table rows={c.data.cohorts} rowKey={(r) => r.cohort} empty="No riders yet." cols={[
        { key: 'cohort', label: 'First trip', render: (r) => monthName(r.cohort) }, { key: 'riders', label: 'Riders', num: true },
        ...Array.from({ length: c.data.months }, (_, k) => ({ key: `m${k + 1}`, label: `Month ${k + 1}`, num: true, render: (r: any) => (r.retained[k + 1] == null ? '' : `${r.retained[k + 1]}%`) })),
      ]} />
    )}
  </>);
}

// ───────────── Forecast ─────────────
function Forecast() {
  const [days, setDays] = useState('14');
  const f = useLoad(() => get(`/admin/insights/forecast?days=${days}`), [days]);
  const [open, setOpen] = useState<string | null>(null);
  const d = f.data;
  const day = d?.days.find((x: any) => x.date === open) ?? d?.days[0];
  return (<>
    <Section title="Demand forecast and drivers needed" right={<Select value={days} onChange={setDays} label="Days ahead" options={[['7', 'Next 7 days'], ['14', 'Next 14 days'], ['28', 'Next 28 days']]} />} />
    <ErrorMsg error={f.error} />
    {!d && !f.error && <Loading />}
    {d && (<>
      <p className="dg-muted" style={{ marginTop: 0, maxWidth: 820 }}>From {d.history.requests} requests over the last {d.history.weeks} weeks, recent weeks counting more{d.weekly_trend !== 1 ? `, growing about ${Math.round((d.weekly_trend - 1) * 1000) / 10}% a week` : ''}, adjusted for the tourist season, school and public holidays and events.
        Drivers needed keeps them on trips {d.target_utilisation_pct}% of the time at {d.minutes_per_trip} minutes a trip (pickup and ride), and at least {d.min_drivers_online} online from {hourName(d.service_hours.from)} to {hourName(d.service_hours.to % 24)}.</p>
      {d.unconfirmed.length > 0 && <p className="dg-note">Dates to confirm in Settings: {d.unconfirmed.join(', ')}.</p>}
      <Table rows={d.days} rowKey={(r) => r.date} onRow={(r) => setOpen(r.date)} cols={[
        { key: 'date', label: 'Day', render: (r) => <>{dayName(r.date)}{day?.date === r.date && <span className="sr-only"> (showing hours below)</span>}</> },
        { key: 'trips', label: 'Trips expected', num: true }, { key: 'peak_hour', label: 'Busiest', render: (r) => hourName(r.peak_hour) },
        { key: 'peak_drivers', label: 'Most drivers needed', num: true },
        { key: 'short_hours', label: 'Hours short', num: true, render: (r) => (d.online_data ? (r.short_hours ? <Chip tone="red">{r.short_hours}</Chip> : '0') : '—') },
        { key: 'reasons', label: 'Why different', render: (r) => r.reasons.join(', ') || '' },
      ]} />
      {day && (<>
        <h3 style={{ marginTop: 16 }}>{dayName(day.date)}, hour by hour</h3>
        <Table rows={day.hours.filter((x: any) => x.trips > 0 || x.drivers_needed > 0)} rowKey={(r) => String(r.hour)} empty="Nothing expected." cols={[
          { key: 'hour', label: 'Hour', render: (r) => hourName(r.hour) }, { key: 'trips', label: 'Trips expected', num: true },
          { key: 'booked', label: 'Booked', num: true, render: (r) => r.booked ?? '' }, { key: 'drivers_needed', label: 'Drivers needed', num: true },
          { key: 'usual_online', label: 'Usually online', num: true, render: (r) => r.usual_online ?? '—' },
          { key: 'gap', label: 'Short by', num: true, render: (r) => (r.gap != null && r.gap >= 1 ? <Chip tone="red">{r.gap}</Chip> : '') },
        ]} />
      </>)}
    </>)}
  </>);
}

// ───────────── Unit economics ─────────────
function Economics() {
  const h = useLoad(() => get('/admin/insights/health?days=28'), []);
  const d = h.data;
  if (h.error) return <ErrorMsg error={h.error} />;
  if (!d) return <Loading />;
  const t = d.money.per_trip;
  const m = d.money;
  const rows = [
    { k: 'Rider paid (average completed trip)', v: t.rider_paid_cents, strong: true },
    { k: 'NT passenger levy (to the NT Government)', v: -t.levy_cents },
    { k: 'Driver pay (fare less service fee, pickup pay, fuel surcharge)', v: -t.driver_pay_cents },
    { k: 'DingoGo kept', v: t.kept_cents, strong: true },
    { k: '  of which service fee', v: t.service_fee_cents }, { k: '  of which booking fee', v: t.booking_fee_cents }, { k: '  less discounts DingoGo funds', v: -t.discounts_cents },
    { k: 'GST on what DingoGo kept (estimate)', v: -t.gst_cents }, { k: 'Card fees (estimate)', v: -t.card_fees_cents },
    { k: 'Net contribution before refunds and running costs', v: t.kept_cents - t.gst_cents - t.card_fees_cents, strong: true },
  ];
  return (<>
    <Section title="Where a trip’s money goes" />
    <p className="dg-muted" style={{ marginTop: 0, maxWidth: 820 }}>Average over the {d.trips.completed} trips completed {dayName(d.from)} to {dayName(d.to)}. Drivers earn on the full fare: promos, points, Pass and business discounts come out of DingoGo’s share. Open any trip in Trips to see its own breakdown.</p>
    <table className="tbl tbl--kv" style={{ maxWidth: 640, width: '100%' }}><caption className="sr-only">Average trip</caption><tbody>
      {rows.map((r) => <tr key={r.k}><th scope="row" style={{ fontWeight: r.strong ? 700 : 400, paddingLeft: r.k.startsWith('  ') ? 24 : undefined, whiteSpace: 'normal' }}>{r.k.trim()}</th><td className="num" style={{ fontWeight: r.strong ? 700 : 400 }}>{money(r.v)}</td></tr>)}
    </tbody></table>
    <h3 style={{ marginTop: 16 }}>Discounts and rewards in this period</h3>
    <Table rows={Object.entries(m.discounts).map(([k, v]) => ({ k, v }))} rowKey={(r) => r.k} cols={[
      { key: 'k', label: 'Discount', render: (r) => ({ promo: 'Promo codes', points: 'Dingo Points redeemed', pass: 'DingoGo Pass', business: 'Business account discount', concession: 'Concessions' } as any)[r.k] ?? r.k },
      { key: 'v', label: 'Cost to DingoGo', num: true, render: (r) => money(r.v as number) },
    ]} />
    <p className="dg-muted">Dingo Points earned in the period: {m.points_issued.toLocaleString('en-AU')} (worth {money(m.points_issued_cents)} if all are redeemed). Refunds: {money(m.refunds_cents)}. Card fee assumed: {d.assumptions.card_fee.pct}% + {money(d.assumptions.card_fee.fixed_cents)}.</p>
  </>);
}

// ───────────── Pricing simulator ─────────────
const toD = (c: number) => (c / 100).toFixed(2);
function Simulator() {
  const [form, setForm] = useState<Record<string, string>>({});
  const [service, setService] = useState('ride');
  const [elasticity, setElasticity] = useState('0');
  const [out, setOut] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const runSim = async (first = false) => {
    setBusy(true); setErr(null);
    try {
      const proposed: Record<string, number> = {};
      if (!first) {
        for (const k of ['base_cents', 'per_km_cents', 'per_min_cents', 'booking_fee_cents', 'min_fare_cents']) if (form[k] !== '' && form[k] != null) proposed[k] = Math.round(Number(form[k]) * 100);
        if (form.night_pct) proposed.night_pct = Math.round(Number(form.night_pct));
      }
      const r = await post('/admin/insights/simulate', { service, days: 28, elasticity: Number(elasticity), proposed, fee_pct: !first && form.fee_pct ? Number(form.fee_pct) : null });
      setOut(r);
      if (first) setForm({ base_cents: toD(r.rule.base_cents), per_km_cents: toD(r.rule.per_km_cents), per_min_cents: toD(r.rule.per_min_cents), booking_fee_cents: toD(r.rule.booking_fee_cents), min_fare_cents: toD(r.rule.min_fare_cents), night_pct: String(r.rule.night_pct), fee_pct: String(r.fee_pct.now) });
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  useEffect(() => { void runSim(true); }, [service]); // eslint-disable-line
  const field = (k: string, label: string, step = '0.01') => (
    <label className="dg-field" key={k}><span>{label}</span><input className="dg-input" type="number" min="0" step={step} value={form[k] ?? ''} onChange={(e) => setForm({ ...form, [k]: e.target.value })} /></label>
  );
  const o = out;
  return (<>
    <Section title="What if the fares changed?" right={<Select value={service} onChange={setService} label="Service" options={[['ride', 'Ride'], ['pet', 'Pet-friendly ride'], ['courier_s', 'Courier, small'], ['courier_m', 'Courier, medium'], ['courier_l', 'Courier, large']]} />} />
    <p className="dg-muted" style={{ marginTop: 0, maxWidth: 820 }}>Replays the last 28 days of completed trips at today’s rates and at yours (list prices, before promos and Pass). Nothing is changed: set real fares in Pricing.</p>
    <form className="sim-form" onSubmit={(e) => { e.preventDefault(); void runSim(); }}>
      {field('base_cents', 'Base fare ($)')}{field('per_km_cents', 'Per km ($)')}{field('per_min_cents', 'Per minute ($)')}{field('booking_fee_cents', 'Booking fee ($)')}
      {field('min_fare_cents', 'Minimum fare ($)')}{field('night_pct', 'Late-night surcharge (%)', '1')}{field('fee_pct', 'DingoGo service fee (%)', '0.5')}
      <label className="dg-field"><span>Riders’ response to price</span>
        <select className="dg-input" value={elasticity} onChange={(e) => setElasticity(e.target.value)}>
          <option value="0">Ignore (same number of trips)</option><option value="-0.2">A little (10% dearer, 2% fewer trips)</option>
          <option value="-0.4">Some (10% dearer, 4% fewer trips)</option><option value="-0.8">A lot (10% dearer, 8% fewer trips)</option>
        </select></label>
      <div className="actions" style={{ alignSelf: 'end' }}><button className="dg-btn" disabled={busy}>{busy ? 'Working it out…' : 'Work it out'}</button></div>
    </form>
    <ErrorMsg error={err} />
    {o && (<div role="status">
      <div className="kpis" style={{ marginTop: 12 }}>
        <Kpi title="Average fare" value={money(o.proposed.avg_fare_cents)} note={`Now ${money(o.now.avg_fare_cents)}${o.change.avg_fare_pct ? ` (${o.change.avg_fare_pct > 0 ? '+' : ''}${o.change.avg_fare_pct}%)` : ''}`} />
        <Kpi title="Driver pay a trip" value={money(o.proposed.avg_driver_pay_cents)} note={`Now ${money(o.now.avg_driver_pay_cents)}`} />
        <Kpi title="Driver pay an hour on trips" value={money(o.proposed.driver_pay_per_engaged_hour_cents)} note={`Now ${money(o.now.driver_pay_per_engaged_hour_cents)}, before running costs`} />
        <Kpi title="DingoGo take a trip" value={money(o.proposed.avg_take_cents)} note={`Now ${money(o.now.avg_take_cents)}`} />
        <Kpi title="Cheaper than a taxi" value={pctTxt(o.proposed.under_taxi_pct)} tone={(o.proposed.under_taxi_pct ?? 100) < 80 ? 'red' : undefined} note={`Now ${pctTxt(o.now.under_taxi_pct)} of trips`} />
        <Kpi title="28 days at the new fares" value={money(o.estimate.take_cents)} note={`DingoGo take over ${o.estimate.trips} trips (now ${money(o.now.take_cents)} over ${o.now.trips})${o.change.take_pct != null ? `, ${o.change.take_pct > 0 ? '+' : ''}${o.change.take_pct}%` : ''}`} />
      </div>
      <h3 style={{ marginTop: 16 }}>Standard trips</h3>
      <Table rows={o.examples} rowKey={(r) => r.name + r.when} cols={[
        { key: 'name', label: 'Trip' }, { key: 'when', label: 'When' }, { key: 'now_cents', label: 'Fare now', num: true, render: (r) => money(r.now_cents) },
        { key: 'proposed_cents', label: 'New fare', num: true, render: (r) => money(r.proposed_cents) },
        { key: 'taxi_cents', label: 'Taxi', num: true, render: (r) => <>{money(r.taxi_cents)}{r.proposed_cents > r.taxi_cents && <Chip tone="red">dearer</Chip>}</> },
        { key: 'driver_proposed_cents', label: 'Driver gets', num: true, render: (r) => money(r.driver_proposed_cents) },
        { key: 'take_proposed_cents', label: 'DingoGo take', num: true, render: (r) => money(r.take_proposed_cents) },
      ]} />
      <p className="dg-muted">Taxi: {o.taxi_tariff.source}; day {money(o.taxi_tariff.day.flagfall_cents)} + {money(o.taxi_tariff.day.per_km_cents)}/km (weekdays {hourName(o.taxi_tariff.day_from_hour)}–{hourName(o.taxi_tariff.day_to_hour)}), otherwise {money(o.taxi_tariff.night.flagfall_cents)} + {money(o.taxi_tariff.night.per_km_cents)}/km, before waiting time and card surcharge. {o.note}</p>
    </div>)}
  </>);
}

// ───────────── Weekly summary ─────────────
function Weekly() {
  const [week, setWeek] = useState('');
  const w = useLoad(() => get(`/admin/insights/weekly${week ? `?week=${week}` : ''}`), [week]);
  const run = useRun();
  const toast = useToast();
  const d = w.data;
  const send = async () => {
    const r = await post('/admin/insights/weekly/send', { week: d.week });
    toast(r.sent ? `Sent to ${r.recipients} ${r.recipients === 1 ? 'person' : 'people'}` : r.error === 'email_not_configured' ? 'Email isn’t set up yet: nothing was sent' : `Not sent: ${r.error}`);
  };
  return (<>
    <Section title="Weekly owner summary" right={<input className="dg-input" type="date" value={week} onChange={(e) => setWeek(e.target.value)} aria-label="Any day of the week" style={{ width: 'auto', minHeight: 38 }} />} />
    <ErrorMsg error={w.error} />
    {!d && !w.error && <Loading />}
    {d && (<>
      <p className="dg-muted" style={{ marginTop: 0, maxWidth: 820 }}>Week of {dayName(d.week)} to {dayName(d.to)}. {d.email.configured ? 'Email is set up.' : 'Email isn’t set up yet (RESEND_API_KEY and EMAIL_FROM on the server): you can still download the PDF.'} Switch on the Monday email in Settings.</p>
      <div className="actions">
        <button className="dg-btn dg-btn--sm" onClick={() => run(() => downloadFile(`/admin/insights/weekly?week=${d.week}&format=pdf`), 'Summary downloaded')}>Download PDF</button>
        <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(send)}>Email it now</button>
      </div>
      <p><strong>{d.email.subject}</strong></p>
      <div className="kpis">
        <Kpi title="Trips completed" value={d.health.trips.completed} note={changeTxt(d.health.changes.completed_pct, '%', 'on the week before')} />
        <Kpi title="DingoGo kept" value={money(d.health.money.kept_cents)} note={changeTxt(d.health.changes.kept_pct, '%', 'on the week before')} />
        <Kpi title="Net contribution" value={money(d.health.money.net_cents)} />
        <Kpi title="Requests not filled" value={pctTxt(d.health.trips.unfilled_pct)} />
        <Kpi title="Busiest day" value={d.busiest_day ? dayName(d.busiest_day.day) : '—'} note={d.busiest_day ? `${d.busiest_day.completed} trips` : undefined} />
        <Kpi title="Week ahead" value={`${Math.round(d.next_week.trips)} trips`} note={`Up to ${d.next_week.peak_drivers} drivers at once${d.next_week.events.length ? `; ${d.next_week.events.join(', ')}` : ''}`} />
      </div>
      {d.watch.length > 0 && (<><h3 style={{ marginTop: 16 }}>Worth a look</h3><ul>{d.watch.map((x: string) => <li key={x}>{x}</li>)}</ul></>)}
    </>)}
  </>);
}

// ───────────── Settings ─────────────
type Range = { name: string; from: string; to: string; factor?: number; confirmed: boolean; hours?: { from: number; to: number } | null };
function Settings() {
  const p = useLoad(() => get('/admin/insights/policy'), []);
  const [form, setForm] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  useEffect(() => { if (p.data) setForm(structuredClone(p.data.policy)); }, [p.data]);
  if (p.error) return <ErrorMsg error={p.error} />;
  if (!form) return <Loading />;
  const set = (path: string, v: any) => { const f = structuredClone(form); const ks = path.split('.'); let o = f; for (const k of ks.slice(0, -1)) o = o[k]; o[ks[ks.length - 1]] = v; setForm(f); };
  const num = (path: string, label: string, step = '1', scale = 1) => {
    const v = path.split('.').reduce((o: any, k) => o[k], form);
    return <label className="dg-field" key={path}><span>{label}</span><input className="dg-input" type="number" step={step} value={scale === 1 ? v : v / scale} onChange={(e) => set(path, Math.round(Number(e.target.value) * scale * 1000) / 1000)} /></label>;
  };
  const save = async (e: React.FormEvent) => {
    e.preventDefault(); setErr(null);
    try { const r = await put('/admin/insights/policy', form); setForm(r.policy); toast('Insights settings saved'); } catch (x: any) { setErr(x.message); }
  };
  const rangeRows = (key: 'events' | 'school', rows: Range[], withFactor: boolean) => (
    <div className="range-rows">
      {rows.map((r, i) => {
        const upd = (patch: Partial<Range>) => { const next = rows.map((x, j) => (j === i ? { ...x, ...patch } : x)); key === 'events' ? set('seasonality.events', next) : set('seasonality.school_holidays.ranges', next); };
        return (
          <fieldset key={i} className="range-row"><legend className="sr-only">{r.name || `Row ${i + 1}`}</legend>
            <label className="dg-field"><span>Name</span><input className="dg-input" value={r.name} onChange={(e) => upd({ name: e.target.value })} /></label>
            <label className="dg-field"><span>From</span><input className="dg-input" type="date" value={r.from} onChange={(e) => upd({ from: e.target.value })} /></label>
            <label className="dg-field"><span>To</span><input className="dg-input" type="date" value={r.to} onChange={(e) => upd({ to: e.target.value })} /></label>
            {withFactor && <label className="dg-field"><span>Demand ×</span><input className="dg-input" type="number" step="0.05" min="0.2" max="3" value={r.factor} onChange={(e) => upd({ factor: Number(e.target.value) })} /></label>}
            <label className="dg-check"><input type="checkbox" checked={r.confirmed} onChange={(e) => upd({ confirmed: e.target.checked })} /> Date confirmed</label>
            <button type="button" className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => { const next = rows.filter((_, j) => j !== i); key === 'events' ? set('seasonality.events', next) : set('seasonality.school_holidays.ranges', next); }}>Remove</button>
          </fieldset>
        );
      })}
      <button type="button" className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => {
        const blank: Range = { name: '', from: '', to: '', confirmed: false, ...(withFactor ? { factor: 1.2, hours: null } : {}) };
        key === 'events' ? set('seasonality.events', [...rows, blank]) : set('seasonality.school_holidays.ranges', [...rows, blank]);
      }}>Add {key === 'events' ? 'an event' : 'school holidays'}</button>
    </div>
  );
  const fuels: [string, string][] = [['electric', 'Electric'], ['plug_in_hybrid', 'Plug-in hybrid'], ['hybrid', 'Hybrid'], ['petrol', 'Petrol'], ['diesel', 'Diesel'], ['other', 'Other']];
  return (
    <form onSubmit={save}>
      <Section title="Drivers’ running costs (cents per km)" />
      <p className="dg-muted" style={{ marginTop: 0 }}>Fuel or charging, tyres and servicing for a km of driving. Not depreciation, insurance or rego.</p>
      <div className="form-grid">{fuels.map(([k, l]) => num(`running_cost_cents_per_km.${k}`, l))}</div>
      <Section title="Costs and planning" />
      <div className="form-grid">
        {num('card_fee.pct', 'Card fee (%)', '0.05')}{num('card_fee.fixed_cents', 'Card fee per charge (cents)')}
        {num('target_utilisation_pct', 'Target time on trips (%)')}{num('min_drivers_online', 'Fewest drivers online')}
        {num('service_hours.from', 'Service hours from (0–23)')}{num('service_hours.to', 'Service hours to (1–24)')}{num('default_pickup_km', 'Pickup km when not recorded', '0.1')}
      </div>
      <Section title="Seasons, holidays and events" />
      <div className="form-grid">
        <label className="dg-field"><span>Tourist season months (1–12, commas)</span><input className="dg-input" value={form.seasonality.tourist_season.months.join(', ')}
          onChange={(e) => set('seasonality.tourist_season.months', e.target.value.split(/[,\s]+/).filter(Boolean).map(Number))} /></label>
        {num('seasonality.tourist_season.factor', 'Tourist season demand ×', '0.05')}{num('seasonality.school_holidays.factor', 'School holidays demand ×', '0.05')}
        {num('seasonality.public_holiday_factor', 'Public holiday demand ×', '0.05')}
      </div>
      <h3>School holidays</h3>
      <p className="dg-muted" style={{ marginTop: 0 }}>Check the dates against the NT Department of Education calendar.</p>
      {rangeRows('school', form.seasonality.school_holidays.ranges, false)}
      <h3 style={{ marginTop: 14 }}>Events</h3>
      {rangeRows('events', form.seasonality.events, true)}
      <Section title="Taxi tariff for comparisons" />
      <p className="dg-muted" style={{ marginTop: 0 }}>Used by the pricing simulator and the website’s price check. Tariff 1 on weekdays in the day hours; tariff 2 at other times, weekends and public holidays.</p>
      <div className="form-grid">
        <label className="dg-field"><span>Source</span><input className="dg-input" value={form.taxi_tariff.source} onChange={(e) => set('taxi_tariff.source', e.target.value)} /></label>
        {num('taxi_tariff.day.flagfall_cents', 'Day flagfall ($)', '0.01', 100)}{num('taxi_tariff.day.per_km_cents', 'Day per km ($)', '0.01', 100)}
        {num('taxi_tariff.night.flagfall_cents', 'Night/weekend flagfall ($)', '0.01', 100)}{num('taxi_tariff.night.per_km_cents', 'Night/weekend per km ($)', '0.01', 100)}
        {num('taxi_tariff.day_from_hour', 'Day tariff from (hour)')}{num('taxi_tariff.day_to_hour', 'Day tariff to (hour)')}
      </div>
      <Section title="Weekly owner email" />
      <p className="dg-muted" style={{ marginTop: 0 }}>{p.data.email_configured ? 'Email is set up on the server.' : 'Email isn’t set up on the server yet (RESEND_API_KEY and EMAIL_FROM): nothing is sent until it is.'} Last week’s summary goes out on Monday from the hour below, once.</p>
      <div className="form-grid">
        <label className="dg-check"><input type="checkbox" checked={form.weekly_email.enabled} onChange={(e) => set('weekly_email.enabled', e.target.checked)} /> Send every Monday</label>
        <label className="dg-field"><span>Send to (emails, commas)</span><input className="dg-input" value={form.weekly_email.recipients.join(', ')}
          onChange={(e) => set('weekly_email.recipients', e.target.value.split(/[,\s]+/).filter(Boolean))} /></label>
        {num('weekly_email.hour', 'From (hour, Darwin)')}
      </div>
      <ErrorMsg error={err} />
      <div className="actions" style={{ marginTop: 14 }}><button className="dg-btn">Save settings</button>
        <button type="button" className="dg-btn dg-btn--ghost" onClick={() => setForm(structuredClone(p.data.defaults))}>Back to defaults</button></div>
    </form>
  );
}
