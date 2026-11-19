import type { ReactNode } from 'react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { get, money, useLoad, Icon, SERVICE_ICON_NAME } from '@dingogo/shared';
import { Page, useOps } from '../ctx';
import { Bars, ErrorMsg, Loading, Section, exportCsv } from '../ui';
import { SERVICE_NAME, label } from '../labels';

const dayLabel = (day: string) => new Date(day + 'T00:00:00').toLocaleDateString('en-AU', { day: 'numeric', month: 'short' });

/** Compare today with yesterday in words, on its own line. */
function vsYesterday(today: number, yesterday: number | undefined, fmt: (n: number) => string = String) {
  if (yesterday == null) return null;
  if (today === 0 && yesterday === 0) return 'None yesterday either';
  if (today === yesterday) return 'Same as yesterday';
  return `Yesterday: ${fmt(yesterday)}`;
}

function Kpi({ value, title, note, tone, to }: { value: ReactNode; title: string; note?: ReactNode; tone?: 'red' | 'green'; to?: string }) {
  const body = (<>
    <span className="kpi__title">{title}</span>
    <b className={tone ? `kpi__v--${tone}` : undefined}>{value}</b>
    {note && <small className="kpi__note">{note}</small>}
  </>);
  return to ? <Link to={to} className="kpi kpi--link">{body}</Link> : <div className="kpi">{body}</div>;
}

export default function Dashboard() {
  const { data: d, error } = useLoad(() => get('/admin/dashboard'));
  const { counts } = useOps();
  // Round 29: until the launch checks pass, say so at the top (details in Reports → Go-live checks).
  const health = useLoad(() => get('/health/deep').catch(() => null), []);
  const launch = health.data?.launch;
  if (error) return <Page title="Dashboard"><ErrorMsg error={error} /></Page>;
  if (!d) return <Page title="Dashboard"><Loading /></Page>;
  const mixTotal = d.mix.reduce((s: number, m: any) => s + m.n, 0);
  const fortnight = d.daily.reduce((s: number, x: any) => s + x.revenue_cents, 0);
  const fortnightTrips = d.daily.reduce((s: number, x: any) => s + x.trips, 0);
  const y = d.daily.length > 1 ? d.daily[d.daily.length - 2] : undefined;
  const open: { label: string; n: number; to: string; icon: string; urgent?: boolean }[] = [
    { label: 'Emergency alerts', n: d.live.open_sos, to: '/safety', icon: 'sos', urgent: true },
    { label: 'Compliance flags', n: d.live.open_flags, to: '/safety?tab=flags', icon: 'flag', urgent: true },
    { label: 'Drivers awaiting approval', n: d.live.pending_drivers, to: '/drivers', icon: 'user' },
    { label: 'Documents to review', n: d.live.pending_docs, to: '/safety?tab=docs', icon: 'document' },
    { label: 'Cars to check', n: d.live.pending_vehicles ?? counts.cars ?? 0, to: '/fleet', icon: 'car' },
    { label: 'Driver applications', n: d.live.new_applications, to: '/drivers', icon: 'users' },
    { label: 'Support tickets', n: d.live.open_tickets, to: '/support', icon: 'chat' },
    { label: 'Hire requests', n: d.live.new_hire_requests, to: '/support', icon: 'calendar' },
    { label: 'Scheduled bookings', n: d.live.scheduled, to: '/trips?status=scheduled', icon: 'clock' },
  ];
  // Green-fleet stats: the API may send them at the top level or under lifetime.
  const greenPct: number | null = d.green_km_pct ?? d.lifetime?.green_km_pct ?? null;
  const evKm: number = Number(d.ev_km ?? d.lifetime?.ev_km ?? 0);
  const co2: number = Number(d.co2_saved_kg ?? d.lifetime?.co2_saved_kg ?? d.lifetime?.co2_avoided_kg ?? 0);
  const outstanding = open.filter((o) => o.n > 0 && o.label !== 'Scheduled bookings').length;

  return (
    <Page title="Dashboard">
      {launch && launch.ready === false && <p className="dg-note" role="status">Not ready for real riders yet: {launch.to_do.must} must-do {launch.to_do.must === 1 ? 'item' : 'items'} left. <Link to="/reports#go-live">See the go-live checks</Link>.</p>}
      <h2 className="sr-only">Today</h2>
      <div className="kpis" aria-label="Today">
        <Kpi title="Taken today" value={money(d.today.revenue_cents)} note={vsYesterday(d.today.revenue_cents, y?.revenue_cents, (n) => money(n))} />
        <Kpi title="Trips completed" value={d.today.completed} note={vsYesterday(d.today.completed, y?.trips)} />
        <Kpi title="Requests today" value={d.today.requested} note={d.today.requested ? `${d.today.courier} of them courier` : 'No bookings yet today'} />
        <Kpi title="Missed, no driver free" value={d.today.unfulfilled} tone={d.today.unfulfilled ? 'red' : undefined} note={d.today.unfulfilled ? 'Check driver cover' : 'Every request was covered'} />
        <Kpi title="Drivers online" value={d.live.online_drivers} tone={d.live.online_drivers ? 'green' : undefined} note={d.live.online_drivers ? 'Available for offers' : 'Nobody is online right now'} to="/live" />
        <Kpi title="Trips in progress" value={d.live.active_trips} note={d.live.active_trips ? 'See them on the live map' : 'No trips on the road'} to="/live" />
      </div>

      <div className="grid3" style={{ marginTop: 'var(--sp-5)' }}>
        <div className="panel">
          <div className="panel__head"><h3>Revenue, last 14 days</h3><span className="dg-muted">{money(fortnight)} total</span></div>
          <Bars data={d.daily} value={(x) => x.revenue_cents} label={(x) => dayLabel(x.day)} format={(v) => money(v)} unit="Revenue"
            empty="No revenue in the last 14 days. Takings appear here once trips are completed." />
          <div className="panel__head" style={{ marginTop: 'var(--sp-5)' }}><h3>Completed trips per day</h3><span className="dg-muted">{fortnightTrips} in 14 days</span></div>
          <Bars data={d.daily} value={(x) => x.trips} label={(x) => dayLabel(x.day)} color="var(--night-2)" unit="Trips"
            empty="No completed trips in the last 14 days." />
        </div>
        <div style={{ display: 'grid', gap: 'var(--sp-5)', alignContent: 'start' }}>
          <div className="panel">
            <div className="panel__head"><h3>Needs attention</h3><span className="dg-muted">{outstanding ? `${outstanding} ${outstanding === 1 ? 'area' : 'areas'}` : 'All clear'}</span></div>
            <ul className="attn">
              {open.map((o) => (
                <li key={o.label}>
                  <Link to={o.to} className={o.n ? '' : 'is-zero'}>
                    <Icon name={o.icon} size={18} />
                    <span className="attn__label">{o.label}</span>
                    <span className={'count' + (o.n && o.urgent ? ' count--red' : o.n ? ' count--ochre' : '')}>{o.n}</span>
                    <Icon name="chevronRight" size={16} className="attn__go" />
                  </Link>
                </li>
              ))}
            </ul>
          </div>
          <div className="panel">
            <div className="panel__head"><h3>Service mix, 30 days</h3><span className="dg-muted">{mixTotal} trips</span></div>
            {!d.mix.length && <p className="empty-note">No trips in the last 30 days.</p>}
            {d.mix.map((m: any) => (
              <div key={m.service} className="mix">
                <div className="mix__row">
                  <span><Icon name={SERVICE_ICON_NAME[m.service] ?? 'car'} size={18} /> {label(SERVICE_NAME, m.service)}</span>
                  <span className="dg-money">{m.n} <span className="dg-muted">({Math.round((m.n / (mixTotal || 1)) * 100)}%)</span></span>
                </div>
                <div className="mix__bar"><div style={{ width: `${(m.n / (mixTotal || 1)) * 100}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Section title="Going electric" />
      <div className="kpis">
        <Kpi title="Trip km in green cars" value={greenPct != null ? `${Math.round(greenPct)}%` : '—'} tone={greenPct ? 'green' : undefined} note="Electric and hybrid, last 30 days" />
        <Kpi title="Driven on electricity" value={`${evKm.toLocaleString('en-AU')} km`} note="Fully electric cars only" />
        <Kpi title="CO₂ avoided" value={`${co2.toLocaleString('en-AU')} kg`} tone={co2 ? 'green' : undefined} note="Trips in electric cars, against an average petrol car" />
        <Kpi title="Average rider rating" value={d.avg_rating_30d ?? '—'} note={d.avg_rating_30d ? 'Last 30 days, out of 5' : 'No ratings in the last 30 days'} />
        <Kpi title="Roof screen plays" value={d.ad_plays_today} note="Today" to="/ads" />
      </div>

      <DailySummary />
    </Page>
  );
}

const darwinToday = () => new Date(Date.now() + 9.5 * 3600e3).toISOString().slice(0, 10);
const CANCEL_REASON: Record<string, string> = { rider_no_show: 'Rider did not show', rider_asked: 'Rider asked to cancel', unsafe: 'Unsafe', prohibited_item: 'Prohibited parcel' };

/** Daily ops summary for the handover: one Darwin day, plus what still needs attention now. Print or CSV. */
function DailySummary() {
  const [date, setDate] = useState(darwinToday);
  const { data: s, error } = useLoad(() => get(`/admin/summary/daily?date=${date}`), [date]);
  const rows: [string, string, ReactNode][] = s ? [
    ['Trips', 'Requested', `${s.trips.requested} (${s.trips.rides} rides, ${s.trips.courier} courier; ${s.trips.phone_or_staff} by phone or staff)`],
    ['Trips', 'Completed', String(s.completed.completed)],
    ['Trips', 'Cancelled', `${s.trips.cancelled_rider} by riders, ${s.trips.cancelled_driver} by drivers, ${s.trips.cancelled_admin} by DingoGo`],
    ['Trips', 'No driver free', String(s.trips.no_drivers)],
    ['Trips', 'Still open or booked ahead', String(s.trips.still_open)],
    ['Trips', 'Average wait for the car', s.completed.avg_pickup_min != null ? `${s.completed.avg_pickup_min} min (accept to arrival)` : 'No data'],
    ['Trips', 'Distance', `${s.completed.distance_km} km`],
    ['Trips', 'Average rider rating', s.completed.avg_rating != null ? `${s.completed.avg_rating} of 5` : 'No ratings'],
    ['Money', 'Fares', money(s.completed.fares_cents)], ['Money', 'Tips (to drivers)', money(s.completed.tips_cents)],
    ['Money', 'DingoGo service fees', money(s.money.service_fees_cents)], ['Money', 'Refunds', money(s.money.refunds_cents)],
    ['Money', 'Payouts to drivers', `${money(s.money.payouts_cents)} (${s.money.payouts})`],
    ['Money', 'Passenger trips for the levy', String(s.completed.passenger_trips)],
    ['Safety', 'Emergency alerts', `${s.safety.raised} raised, ${s.safety.resolved} resolved`],
    ['Safety', 'Compliance flags', s.safety.flags.length ? s.safety.flags.map((f: any) => `${f.n} ${f.kind.replace(/_/g, ' ')}`).join(', ') : 'None'],
    ['Support', 'Tickets', `${s.support.opened} opened, ${s.support.resolved} resolved`],
    ['Drivers', 'Drove', String(s.drivers.drove)], ['Drivers', 'Approved', String(s.drivers.approved)], ['Drivers', 'Applications', String(s.drivers.applications)],
    ['Drivers', 'Documents reviewed', `${s.documents.approved} approved, ${s.documents.rejected} rejected`],
  ] : [];
  const att = s?.attention;
  const attention: [string, number, string][] = att ? ([
    ['Open emergency alerts', att.open_sos, '/safety'], ['Open compliance flags', att.open_flags, '/safety?tab=flags'], ['Open support tickets', att.open_tickets, '/support'],
    ['Documents to review', att.pending_docs, '/safety?tab=docs'], ['Cars to check', att.pending_vehicles, '/fleet'], ['New driver applications', att.new_applications, '/drivers'],
    ['Searching over 5 minutes', att.searching_over_5_min, '/trips?status=requested'], ['Booked in the next 2 hours', att.booked_next_2_hours, '/trips?status=scheduled'],
  ] as [string, number, string][]).filter(([, n]) => n > 0) : [];
  return (
    <section className="daily" aria-labelledby="daily-h">
      <div className="section"><h2 id="daily-h">Daily summary</h2><span className="spacer" />
        <label className="inline-field"><span>Day</span><input className="dg-input" type="date" value={date} max={darwinToday()} onChange={(e) => e.target.value && setDate(e.target.value)} /></label>
        <button className="dg-btn dg-btn--sm dg-btn--ghost no-print" onClick={() => window.print()}>Print</button>
        <button className="dg-btn dg-btn--sm dg-btn--ghost no-print" disabled={!s} onClick={() => s && exportCsv(`dingogo-daily-${s.date}.csv`,
          [...rows.map(([g, k, v]) => ({ section: g, item: k, value: String(v) })), ...attention.map(([k, n]) => ({ section: 'Needs attention now', item: k, value: String(n) }))])}>Export CSV</button>
      </div>
      <ErrorMsg error={error} />
      {!s ? <Loading /> : (
        <div className="grid2">
          <div className="panel">
            <table className="tbl tbl--kv"><caption className="sr-only">What happened on {s.date} (Darwin time)</caption>
              <tbody>{rows.map(([g, k, v], i) => <tr key={i}><th scope="row"><span className="sub">{g}</span>{k}</th><td>{v}</td></tr>)}</tbody></table>
          </div>
          <div style={{ display: 'grid', gap: 'var(--sp-4)', alignContent: 'start' }}>
            <div className="panel">
              <div className="panel__head"><h3>Needs attention now</h3></div>
              {attention.length ? <ul className="attn">{attention.map(([k, n, to]) => <li key={k}><Link to={to}><span className="attn__label">{k}</span><span className="count count--ochre">{n}</span></Link></li>)}</ul>
                : <p className="empty-note">Nothing waiting.</p>}
            </div>
            <div className="panel">
              <div className="panel__head"><h3>Why trips were cancelled</h3></div>
              {s.cancellations.length ? <ul className="plain">{s.cancellations.map((c: any) => <li key={c.reason}>{CANCEL_REASON[c.reason] ?? c.reason}: <strong>{c.n}</strong></li>)}</ul>
                : <p className="empty-note">No cancellations.</p>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
