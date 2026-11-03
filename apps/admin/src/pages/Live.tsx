import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { get, post, time, ago, STATUS_LABEL, statusTone, useInterval, useLoad } from '@dingogo/shared';
import { DgMap, type MapMarker } from '@dingogo/shared/map';
import { Page, useOps } from '../ctx';
import { Chip, useRun } from '../ui';

const EVENT_TEXT: Record<string, (d: any) => string> = {
  'trip.created': (d) => `New ${d.status === 'scheduled' ? 'scheduled booking' : 'request'} ${d.ref ?? ''}`,
  'trip.updated': (d) => `${d.ref ?? 'Trip'}: ${STATUS_LABEL[d.status] ?? d.status}`,
  'sos.new': (d) => `EMERGENCY from ${d.user_name ?? 'user'}${d.trip_ref ? ` on ${d.trip_ref}` : ''}`,
  'sos.updated': (d) => `SOS ${d.status}`,
  'driver.status': (d) => `Driver went ${d.online ? 'online' : 'offline'}`,
  'compliance.flag': () => 'Compliance flag: assistance animal refusal',
  'safety.deviation': (d) => `Route deviation on ${d.ref} (${d.off_m} m off route)`,
  'support.new': (d) => `Support ticket: ${d.subject}`,
  'application.new': () => 'New driver application',
  'hire.new': () => 'New hire request',
  'driver.document': (d) => `Driver uploaded ${String(d.type).replace(/_/g, ' ')}`,
};

export default function Live() {
  const { data, reload } = useLoad(() => get('/admin/live'));
  const { events } = useOps();
  const run = useRun();
  useInterval(() => void reload(), 5000);

  // Apply driver.location events on top of the last poll for smooth movement.
  const drivers = useMemo(() => {
    const list = (data?.drivers ?? []).map((d: any) => ({ ...d }));
    for (const e of [...events].reverse()) {
      if (e.type !== 'driver.location' && e.type !== 'driver.status') continue;
      const d = list.find((x: any) => x.id === e.data.driver_id);
      if (!d) continue;
      if (e.data.lat != null) { d.lat = e.data.lat; d.lng = e.data.lng; }
      if (e.data.heading != null) d.heading = e.data.heading;
      if (e.data.battery_pct != null) d.battery_pct = e.data.battery_pct;
      if (e.data.online != null) d.online = e.data.online;
    }
    return list;
  }, [data, events]);

  const markers: MapMarker[] = useMemo(() => {
    const m: MapMarker[] = [];
    for (const d of drivers) if (d.lat != null) m.push({ id: 'd' + d.id, lat: d.lat, lng: d.lng, heading: d.heading,
      kind: !d.online ? 'car-off' : d.trip_status ? 'car-busy' : 'car', label: `${d.name} ${d.rego ?? ''} ${d.battery_pct != null ? d.battery_pct + '%' : ''}` });
    for (const t of data?.trips ?? []) {
      m.push({ id: 'p' + t.id, lat: t.pickup_lat, lng: t.pickup_lng, kind: 'pickup', label: `${t.ref} pickup` });
      m.push({ id: 'x' + t.id, lat: t.dropoff_lat, lng: t.dropoff_lng, kind: 'dropoff', label: `${t.ref} drop-off` });
    }
    for (const s of data?.sos ?? []) if (s.lat != null) m.push({ id: 's' + s.id, lat: s.lat, lng: s.lng, kind: 'sos', label: `SOS ${s.user_name}` });
    return m;
  }, [drivers, data]);

  const online = drivers.filter((d: any) => d.online);
  const feed = events.filter((e) => e.type !== 'driver.location' && EVENT_TEXT[e.type]).slice(0, 40);

  return (
    <Page title="Live map" right={<span className="dg-muted">{online.length} of {drivers.length} drivers online, {data?.trips.length ?? 0} active trips</span>}>
      <div className="livegrid">
        <div className="mapbox">
          <DgMap markers={markers} fit={false} zoom={13} zones={data?.zones.map((z: any) => ({ lat: z.centre_lat, lng: z.centre_lng, radius_km: z.radius_km, active: z.active, name: z.name }))} />
        </div>
        <div className="side">
          <div className="panel">
            <h3>Active trips</h3>
            {!data?.trips.length && <p className="dg-muted" style={{ margin: 0 }}>No trips in progress.</p>}
            {data?.trips.map((t: any) => (
              <div key={t.id} style={{ borderTop: '1px solid var(--line)', padding: '8px 0' }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                  <strong>{t.ref}</strong><Chip tone={statusTone(t.status)}>{STATUS_LABEL[t.status]}</Chip>
                  {t.channel === 'phone' && <Chip>Phone booking</Chip>}
                  <span className="dg-muted" style={{ marginLeft: 'auto', fontSize: '.85rem' }}>{time(t.requested_at)}</span>
                </div>
                <div style={{ fontSize: '.88rem' }}>{t.pickup_address} to {t.dropoff_address}</div>
                <div className="dg-muted" style={{ fontSize: '.85rem' }}>{t.rider_name}{t.driver_name ? ` with ${t.driver_name}` : `, dispatch attempt ${t.dispatch_attempts}`}</div>
                <div className="actions">
                  {t.status === 'requested' && <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={async () => { await run(() => post(`/admin/trips/${t.id}/redispatch`), 'Re-dispatching'); void reload(); }}>Re-dispatch</button>}
                  <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={async () => { if (confirm(`Cancel ${t.ref}? The rider is not charged.`)) { await run(() => post(`/admin/trips/${t.id}/cancel`, { reason: 'Cancelled by dispatch' }), 'Trip cancelled'); void reload(); } }}>Cancel</button>
                </div>
              </div>
            ))}
          </div>
          <div className="panel">
            <h3>Drivers</h3>
            <table className="tbl"><tbody>
              {drivers.map((d: any) => (
                <tr key={d.id}><td>{d.name}<br /><span className="dg-muted" style={{ fontSize: '.82rem' }}>{d.rego ?? 'No vehicle'}</span></td>
                  <td><Chip tone={!d.online ? '' : d.trip_status ? 'ochre' : 'green'}>{!d.online ? 'Offline' : d.trip_status ? 'On trip' : 'Available'}</Chip></td>
                  <td className="num" title="Battery">{d.battery_pct != null ? <span style={{ color: d.battery_pct < 25 ? 'var(--earth)' : undefined }}>{d.battery_pct}%</span> : '—'}</td></tr>
              ))}
            </tbody></table>
          </div>
          <div className="panel">
            <h3>Live feed</h3>
            {!feed.length && <p className="dg-muted" style={{ margin: 0 }}>Events appear here as they happen.</p>}
            <ul className="feed">
              {feed.map((e, i) => (
                <li key={i} style={e.type === 'sos.new' ? { color: 'var(--earth)', fontWeight: 700 } : undefined}>
                  <time>{time(e.at)}</time><span>{EVENT_TEXT[e.type](e.data)}</span>
                </li>
              ))}
            </ul>
          </div>
          {data?.sos.length > 0 && (
            <div className="panel" style={{ borderColor: 'var(--earth)' }}>
              <h3 style={{ color: 'var(--earth)' }}>Open emergency alerts</h3>
              {data.sos.map((s: any) => <p key={s.id} style={{ margin: '4px 0' }}>{s.user_name} ({s.role}) {ago(s.created_at)} {s.trip_ref && `on ${s.trip_ref}`}</p>)}
              <Link to="/safety" className="dg-btn dg-btn--danger dg-btn--sm">Respond</Link>
            </div>
          )}
        </div>
      </div>
    </Page>
  );
}
