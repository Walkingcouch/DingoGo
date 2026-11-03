import { useState } from 'react';
import { get, post, money, date, dateTime, useLoad } from '@dingogo/shared';
import { Page } from '../ctx';
import { Chip, CrudSection, ErrorMsg, Section, Table, Tabs, exportCsv, useRun, type Field } from '../ui';

const soon = (d?: string | null) => !d || new Date(d).getTime() < Date.now() + 30 * 864e5;
const Exp = ({ d }: { d?: string | null }) => <span style={soon(d) ? { color: 'var(--earth)', fontWeight: 700 } : undefined}>{d ? date(d) : 'Missing'}</span>;

const VEHICLE_FIELDS: Field[] = [
  { key: 'rego', label: 'Registration', required: true }, { key: 'colour', label: 'Colour', required: true },
  { key: 'make', label: 'Make' }, { key: 'model', label: 'Model' }, { key: 'year', label: 'Year', type: 'number', required: true },
  { key: 'seats', label: 'Passenger seats', type: 'number' }, { key: 'battery_kwh', label: 'Battery (kWh)', type: 'number', step: 0.1 },
  { key: 'range_km', label: 'Rated range (km)', type: 'number', help: 'Dispatch derates this for heat and A/C' },
  { key: 'battery_pct', label: 'Current battery (%)', type: 'number', min: 0, max: 100 }, { key: 'odometer_km', label: 'Odometer (km)', type: 'number' },
  { key: 'ownership', label: 'Ownership', type: 'select', required: true, options: [['fleet', 'DingoGo fleet'], ['leased_to_driver', 'Leased to driver'], ['driver_owned', 'Driver owned']] },
  { key: 'lease_weekly_cents', label: 'Weekly lease charge', type: 'money', help: 'EV Direct Finance estimate is about $113.33/week' },
  { key: 'cvl_number', label: 'Rideshare CVL number' }, { key: 'cvl_expiry', label: 'CVL expiry', type: 'date' },
  { key: 'rego_expiry', label: 'Registration expiry', type: 'date' }, { key: 'insurance_expiry', label: 'Insurance expiry', type: 'date' },
  { key: 'inspection_expiry', label: 'Inspection due', type: 'date' }, { key: 'roadworthy_date', label: 'Last roadworthy', type: 'date' },
  { key: 'pet_friendly', label: 'Pet-friendly (seat covers, harness point)', type: 'bool' },
  { key: 'wheelchair_accessible', label: 'Wheelchair accessible', type: 'bool' },
  { key: 'has_roof_display', label: 'Has roof display', type: 'bool' }, { key: 'active', label: 'In service', type: 'bool' },
];

export default function Fleet() {
  const [tab, setTab] = useState<'vehicles' | 'charging' | 'payouts'>('vehicles');
  return (
    <Page title="Fleet & charging">
      <Tabs tabs={[['vehicles', 'Vehicles'], ['charging', 'Charging & battery'], ['payouts', 'Payouts & leases']]} value={tab} onChange={setTab} />
      {tab === 'vehicles' && <Vehicles />}
      {tab === 'charging' && <Charging />}
      {tab === 'payouts' && <Payouts />}
    </Page>
  );
}

function Vehicles() {
  const run = useRun();
  const [key, setKey] = useState<any>(null);
  return (<>
    <CrudSection title="Vehicles" path="vehicles" newLabel="Add vehicle" fields={VEHICLE_FIELDS} cols={[
      { key: 'rego', label: 'Rego', nowrap: true, render: (v) => <strong>{v.rego}</strong> },
      { key: 'model', label: 'Vehicle', render: (v) => `${v.year} ${v.make} ${v.model}, ${v.colour}` },
      { key: 'battery_pct', label: 'Battery', num: true, render: (v) => (v.battery_pct != null ? `${v.battery_pct}%` : '—') },
      { key: 'ownership', label: 'Ownership', render: (v) => v.ownership.replace(/_/g, ' ') },
      { key: 'lease_weekly_cents', label: 'Lease/wk', num: true, render: (v) => (v.lease_weekly_cents ? money(v.lease_weekly_cents) : '—') },
      { key: 'cvl_expiry', label: 'CVL', render: (v) => <Exp d={v.cvl_expiry} /> },
      { key: 'rego_expiry', label: 'Rego', render: (v) => <Exp d={v.rego_expiry} /> },
      { key: 'insurance_expiry', label: 'Insurance', render: (v) => <Exp d={v.insurance_expiry} /> },
      { key: 'features', label: 'Features', render: (v) => <>{v.pet_friendly && <Chip>Pets</Chip>} {v.has_roof_display && <Chip tone="ochre">Roof screen</Chip>} {!v.active && <Chip tone="red">Off road</Chip>}</> },
      { key: 'key', label: '', render: (v) => <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={async (e) => {
        e.stopPropagation();
        if (!confirm(`Issue a new roof display key for ${v.rego}? The old key stops working.`)) return;
        const r = await run(() => post(`/admin/vehicles/${v.id}/display-key`), 'New display key issued');
        if (r) setKey(r.vehicle);
      }}>New screen key</button> },
    ]} />
    {key && <p className="dg-note" style={{ marginTop: 12 }}>Display key for {key.rego}: <code>{key.display_key}</code>. Set it on the roof screen as <code>?key={key.display_key}</code>.</p>}
  </>);
}

function Charging() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const { data, error, reload } = useLoad(() => get(`/admin/charging?month=${month}`), [month]);
  const run = useRun();
  return (<>
    <div className="toolbar"><label className="dg-field" style={{ margin: 0 }}><span>Month</span><input className="dg-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label></div>
    <ErrorMsg error={error} />
    <Section title="Charging by vehicle" right={data && <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => exportCsv(`charging-${month}.csv`, data.by_vehicle)}>Export CSV</button>} />
    <Table rows={data?.by_vehicle} empty="No charging logged this month." rowKey={(r) => r.rego + r.driver_id} cols={[
      { key: 'rego', label: 'Vehicle' }, { key: 'driver_name', label: 'Driver' }, { key: 'sessions', label: 'Sessions', num: true },
      { key: 'home_sessions', label: 'At home', num: true }, { key: 'kwh', label: 'kWh', num: true },
      { key: 'cost_cents', label: 'Electricity cost', num: true, render: (r) => money(r.cost_cents) },
      { key: 'unreimbursed_cents', label: 'Owed to driver', num: true, render: (r) => money(r.unreimbursed_cents ?? 0) },
      { key: 'x', label: '', render: (r) => r.unreimbursed_cents > 0 && r.driver_id && (
        <button className="dg-btn dg-btn--sm dg-btn--green" onClick={async () => { const x = await run(() => post('/admin/charging/reimburse', { driver_id: r.driver_id })); if (x) { alert(`Credited ${money(x.total_cents)} for ${x.sessions} sessions to the driver's next payout.`); void reload(); } }}>Reimburse</button>) },
    ]} />
    <Section title="Fleet battery and heat" />
    <Table rows={data?.fleet} rowKey={(r) => r.rego} cols={[
      { key: 'rego', label: 'Vehicle' },
      { key: 'battery_pct', label: 'Battery now', num: true, render: (r) => r.battery_pct != null ? <span style={{ color: r.battery_pct < 25 ? 'var(--earth)' : undefined, fontWeight: 700 }}>{r.battery_pct}%</span> : '—' },
      { key: 'range', label: 'Usable range (hot day)', num: true, render: (r) => r.battery_pct != null ? `${Math.round(r.range_km * r.battery_pct / 100 * 0.7)} km` : '—' },
      { key: 'avg_temp_c', label: 'Avg temp, 7 days', num: true, render: (r) => (r.avg_temp_c != null ? `${r.avg_temp_c}°C` : '—') },
      { key: 'odometer_km', label: 'Odometer', num: true, render: (r) => (r.odometer_km != null ? `${r.odometer_km.toLocaleString('en-AU')} km` : '—') },
      { key: 'last_log', label: 'Last battery log', render: (r) => dateTime(r.last_log) },
    ]} />
    <Section title="Recent sessions" />
    <Table rows={data?.sessions} cols={[
      { key: 'started_at', label: 'Started', nowrap: true, render: (s) => dateTime(s.started_at) }, { key: 'rego', label: 'Vehicle' },
      { key: 'location', label: 'Where', render: (s) => s.site_name ? `${s.location}, ${s.site_name}` : s.location },
      { key: 'kwh', label: 'kWh', num: true }, { key: 'pct', label: 'Battery', num: true, render: (s) => s.start_pct != null ? `${s.start_pct}% to ${s.end_pct}%` : '—' },
      { key: 'cost_cents', label: 'Cost', num: true, render: (s) => money(s.cost_cents) },
      { key: 'reimbursed_at', label: 'Reimbursed', render: (s) => (s.reimbursed_at ? date(s.reimbursed_at) : s.reimbursable ? 'Pending' : 'Not reimbursable') },
    ]} />
  </>);
}

function Payouts() {
  const { data, error, reload } = useLoad(() => get('/admin/payouts'));
  const run = useRun();
  return (<>
    <p className="dg-muted" style={{ maxWidth: 760 }}>Balances include fares less the DingoGo service fee, tips (100% to drivers), charging credits, cash already held by drivers, and weekly lease deductions. Pay positive balances by bank transfer, then record the payout here.</p>
    <div className="actions" style={{ marginBottom: 12 }}>
      <button className="dg-btn dg-btn--sm dg-btn--dark" onClick={async () => {
        if (!confirm('Charge this week\'s lease to every driver on a leased vehicle? Drivers already charged in the last 6 days are skipped.')) return;
        const r = await run(() => post('/admin/lease/run'));
        if (r) { alert(`Lease charged to ${r.charged} driver(s).`); void reload(); }
      }}>Run weekly lease deductions</button>
      {data && <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => exportCsv('driver-balances.csv', data.balances)}>Export CSV</button>}
    </div>
    <ErrorMsg error={error} />
    <Table rows={data?.balances} rowKey={(r) => r.driver_id} cols={[
      { key: 'name', label: 'Driver' },
      { key: 'has_bank', label: 'Bank details', render: (r) => (r.has_bank ? 'On file' : <span style={{ color: 'var(--earth)' }}>Missing</span>) },
      { key: 'last_payout', label: 'Last payout', render: (r) => (r.last_payout ? date(r.last_payout) : 'Never') },
      { key: 'balance_cents', label: 'Balance', num: true, render: (r) => <strong style={{ color: r.balance_cents < 0 ? 'var(--earth)' : undefined }}>{money(r.balance_cents)}</strong> },
      { key: 'x', label: '', render: (r) => r.balance_cents > 0 && (
        <button className="dg-btn dg-btn--sm" onClick={async () => { if (confirm(`Record a payout of ${money(r.balance_cents)} to ${r.name}?`)) { await run(() => post(`/admin/payouts/${r.driver_id}`), 'Payout recorded'); void reload(); } }}>Record payout</button>) },
    ]} />
  </>);
}
