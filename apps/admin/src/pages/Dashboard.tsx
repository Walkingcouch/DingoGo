import { Link } from 'react-router-dom';
import { get, money, useLoad, SERVICE_ICON } from '@dingogo/shared';
import { Page } from '../ctx';
import { Bars, ErrorMsg, Loading, Section } from '../ui';

const SERVICE_NAME: Record<string, string> = { ride: 'Ride', pet: 'Pet-friendly', courier_s: 'Courier small', courier_m: 'Courier medium', courier_l: 'Courier large', tour: 'Tour', hourly: 'Hourly hire' };

export default function Dashboard() {
  const { data: d, error } = useLoad(() => get('/admin/dashboard'));
  if (error) return <Page title="Dashboard"><ErrorMsg error={error} /></Page>;
  if (!d) return <Page title="Dashboard"><Loading /></Page>;
  const mixTotal = d.mix.reduce((s: number, m: any) => s + m.n, 0) || 1;
  const fortnight = d.daily.reduce((s: number, x: any) => s + x.revenue_cents, 0);
  const open: [string, number, string][] = [
    ['Emergency alerts', d.live.open_sos, '/safety'], ['Compliance flags', d.live.open_flags, '/safety'],
    ['Drivers awaiting approval', d.live.pending_drivers, '/drivers'], ['Documents to review', d.live.pending_docs, '/drivers'],
    ['Support tickets', d.live.open_tickets, '/support'], ['Hire requests', d.live.new_hire_requests, '/support'],
    ['Driver applications', d.live.new_applications, '/drivers'], ['Scheduled bookings', d.live.scheduled, '/trips'],
  ];
  return (
    <Page title="Dashboard">
      <div className="kpis" aria-label="Today">
        <div className="kpi"><b>{money(d.today.revenue_cents)}</b><span>Taken today</span></div>
        <div className="kpi"><b>{d.today.completed}</b><span>Trips completed today</span></div>
        <div className="kpi"><b>{d.today.requested}</b><span>Requests today ({d.today.courier} courier)</span></div>
        <div className="kpi"><b style={{ color: d.today.unfulfilled ? 'var(--earth)' : undefined }}>{d.today.unfulfilled}</b><span>Missed: no driver free</span></div>
        <div className="kpi"><b>{d.live.online_drivers}</b><span>Drivers online now</span></div>
        <div className="kpi"><b>{d.live.active_trips}</b><span>Trips in progress</span></div>
      </div>

      <div className="grid3" style={{ marginTop: 20 }}>
        <div className="panel">
          <h3>Revenue, last 14 days <span className="dg-muted" style={{ fontWeight: 400, fontSize: '.9rem' }}>{money(fortnight)} total</span></h3>
          <Bars data={d.daily} value={(x) => x.revenue_cents} label={(x) => x.day.slice(8) + '/' + x.day.slice(5, 7)} format={(v) => money(v)} />
          <h3 style={{ marginTop: 12 }}>Completed trips per day</h3>
          <Bars data={d.daily} value={(x) => x.trips} label={(x) => x.day.slice(8) + '/' + x.day.slice(5, 7)} color="var(--night-2)" />
        </div>
        <div style={{ display: 'grid', gap: 20, alignContent: 'start' }}>
          <div className="panel">
            <h3>Needs attention</h3>
            <table className="tbl"><tbody>
              {open.map(([l, n, to]) => (
                <tr key={l}><td><Link to={to} style={{ color: 'inherit' }}>{l}</Link></td>
                  <td className="num"><strong style={{ color: n && (l.startsWith('Emergency') || l.startsWith('Compliance')) ? 'var(--earth)' : undefined }}>{n}</strong></td></tr>
              ))}
            </tbody></table>
          </div>
          <div className="panel">
            <h3>Service mix, 30 days</h3>
            {d.mix.map((m: any) => (
              <div key={m.service} style={{ margin: '6px 0' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.9rem' }}><span>{SERVICE_ICON[m.service]} {SERVICE_NAME[m.service] ?? m.service}</span><span className="dg-money">{m.n}</span></div>
                <div style={{ height: 6, background: 'var(--line)', borderRadius: 3 }}><div style={{ width: `${(m.n / mixTotal) * 100}%`, height: '100%', background: 'var(--ochre)', borderRadius: 3 }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <Section title="Electric fleet impact" />
      <div className="kpis">
        <div className="kpi"><b>{d.lifetime.ev_km.toLocaleString('en-AU')} km</b><span>Driven on electricity, all time</span></div>
        <div className="kpi"><b style={{ color: 'var(--saltbush)' }}>{d.lifetime.co2_avoided_kg.toLocaleString('en-AU')} kg</b><span>CO₂ avoided vs. average petrol car</span></div>
        <div className="kpi"><b>{d.avg_rating_30d ?? '—'}</b><span>Average rider rating, 30 days</span></div>
        <div className="kpi"><b>{d.ad_plays_today}</b><span>Roof screen plays today</span></div>
      </div>
    </Page>
  );
}
