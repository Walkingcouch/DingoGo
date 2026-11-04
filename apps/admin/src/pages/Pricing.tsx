import { useEffect, useState } from 'react';
import { get, patch, money, date, useLoad, Icon, SERVICE_ICON_NAME } from '@dingogo/shared';
import { Page } from '../ctx';
import { Chip, CrudSection, Empty, ErrorMsg, Section, Tabs, useRun, type Field } from '../ui';
import { DOC_TYPE, STATE_NAME, label } from '../labels';
import { jurisdictionList, minYearFor, type Jurisdiction } from '../rules';

const FARE_FIELDS: Field[] = [
  { key: 'service', label: 'Service code', required: true, readOnlyOnEdit: true }, { key: 'label', label: 'Name shown to riders', required: true },
  { key: 'base_cents', label: 'Base fare', type: 'money', required: true }, { key: 'per_km_cents', label: 'Per km', type: 'money', required: true },
  { key: 'per_min_cents', label: 'Per minute', type: 'money', required: true }, { key: 'booking_fee_cents', label: 'Booking fee', type: 'money' },
  { key: 'min_fare_cents', label: 'Minimum fare', type: 'money', required: true }, { key: 'cancel_fee_cents', label: 'Late cancellation fee', type: 'money' },
  { key: 'free_wait_min', label: 'Free waiting (minutes)', type: 'number' }, { key: 'wait_per_min_cents', label: 'Waiting per minute', type: 'money' },
  { key: 'night_pct', label: 'Late-night surcharge (%), 10pm to 5am', type: 'number' }, { key: 'holiday_pct', label: 'Public holiday surcharge (%)', type: 'number' },
  { key: 'levy_cents', label: 'NT passenger levy', type: 'money', help: 'Used only when a pickup isn’t in a service area. Each state’s levy is set under States.' },
  { key: 'description', label: 'Description', full: true }, { key: 'active', label: 'Available to book', type: 'bool' },
];

export default function Pricing() {
  const [tab, setTab] = useState<'fares' | 'zones' | 'states' | 'promos' | 'plans' | 'holidays' | 'tours'>('fares');
  return (
    <Page title="Pricing & tours">
      <Tabs tabs={[['fares', 'Fares'], ['zones', 'Service areas'], ['states', 'States'], ['promos', 'Promo codes'], ['plans', 'DingoGo Pass'], ['holidays', 'Public holidays'], ['tours', 'Tours']]} value={tab} onChange={setTab} />
      {tab === 'fares' && <CrudSection title="Fare rules" path="fares" pk="service" newLabel="Add service" fields={FARE_FIELDS}
        describe={<p className="dg-muted" style={{ marginTop: 0, maxWidth: 780 }}>Benchmark: the Alice Springs taxi maximum tariff from 1 July 2026 is $5.50 flagfall plus $2.45/km on weekdays by day, and $6.80 plus $2.89/km at night and on weekends (NT Government Gazette S53). Taxis add a card surcharge. All DingoGo fares include GST.</p>}
        cols={[
          { key: 'label', label: 'Service', nowrap: true, render: (r) => <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}><Icon name={SERVICE_ICON_NAME[r.service] ?? 'car'} size={18} /><strong>{r.label}</strong></span> },
          { key: 'base_cents', label: 'Base', num: true, render: (r) => money(r.base_cents) }, { key: 'per_km_cents', label: 'Per km', num: true, render: (r) => money(r.per_km_cents) },
          { key: 'per_min_cents', label: 'Per min', num: true, render: (r) => money(r.per_min_cents) }, { key: 'booking_fee_cents', label: 'Booking', num: true, render: (r) => money(r.booking_fee_cents) },
          { key: 'min_fare_cents', label: 'Minimum', num: true, render: (r) => money(r.min_fare_cents) }, { key: 'cancel_fee_cents', label: 'Cancel fee', num: true, render: (r) => money(r.cancel_fee_cents) },
          { key: 'night_pct', label: 'Night', num: true, render: (r) => `${r.night_pct}%` }, { key: 'levy_cents', label: 'Levy', num: true, render: (r) => money(r.levy_cents) },
          { key: 'active', label: 'Status', render: (r) => (r.active ? <Chip tone="green">Active</Chip> : <Chip>Off</Chip>) },
        ]} />}
      {tab === 'zones' && <CrudSection title="Service areas" path="zones" newLabel="Add area" fields={[
        { key: 'id', label: 'Code', required: true, readOnlyOnEdit: true }, { key: 'name', label: 'Name', required: true },
        { key: 'state', label: 'State', type: 'select', options: Object.entries(STATE_NAME), help: 'Drivers only get trips in their own state' },
        { key: 'centre_lat', label: 'Centre latitude', type: 'number', step: 0.0001, required: true }, { key: 'centre_lng', label: 'Centre longitude', type: 'number', step: 0.0001, required: true },
        { key: 'radius_km', label: 'Radius (km)', type: 'number', required: true },
        { key: 'demand_multiplier', label: 'Demand multiplier', type: 'number', step: 0.05, min: 1, max: 1.5, help: 'Manual only, capped at 1.5. Leave at 1.00 normally.' },
        { key: 'launch_note', label: 'Launch note', full: true }, { key: 'active', label: 'Taking bookings', type: 'bool' },
      ]} cols={[
        { key: 'name', label: 'Area', render: (z) => <strong>{z.name}</strong> }, { key: 'state', label: 'State', render: (z) => z.state ?? 'NT' }, { key: 'radius_km', label: 'Radius', num: true, render: (z) => `${z.radius_km} km` },
        { key: 'demand_multiplier', label: 'Multiplier', num: true, render: (z) => `×${Number(z.demand_multiplier).toFixed(2)}` },
        { key: 'launch_note', label: 'Note' }, { key: 'active', label: 'Status', render: (z) => (z.active ? <Chip tone="green">Live</Chip> : <Chip>Planned</Chip>) },
      ]} />}
      {tab === 'states' && <States onZones={() => setTab('zones')} />}
      {tab === 'promos' && <CrudSection title="Promo codes" path="promos" pk="code" newLabel="New promo code" fields={[
        { key: 'code', label: 'Code', required: true, readOnlyOnEdit: true }, { key: 'kind', label: 'Type', type: 'select', required: true, options: [['percent', 'Percent off'], ['fixed', 'Fixed amount off (cents)']] },
        { key: 'value', label: 'Value (percent, or cents)', type: 'number', required: true }, { key: 'max_discount_cents', label: 'Maximum discount', type: 'money' },
        { key: 'max_uses', label: 'Total uses allowed', type: 'number' }, { key: 'per_user_limit', label: 'Uses per person', type: 'number' },
        { key: 'valid_from', label: 'Valid from', type: 'datetime' }, { key: 'valid_to', label: 'Valid until', type: 'datetime' },
        { key: 'description', label: 'Description', full: true }, { key: 'first_trip_only', label: 'First trip only', type: 'bool' }, { key: 'active', label: 'Active', type: 'bool' },
      ]} cols={[
        { key: 'code', label: 'Code', render: (p) => <strong>{p.code}</strong> },
        { key: 'value', label: 'Discount', render: (p) => (p.kind === 'percent' ? `${p.value}%${p.max_discount_cents ? ` up to ${money(p.max_discount_cents)}` : ''}` : money(p.value)) },
        { key: 'uses', label: 'Used', num: true, render: (p) => `${p.uses}${p.max_uses ? ` of ${p.max_uses}` : ''}` },
        { key: 'valid_to', label: 'Ends', render: (p) => (p.valid_to ? date(p.valid_to) : 'No end') }, { key: 'description', label: 'Description' },
        { key: 'active', label: 'Status', render: (p) => (p.active ? <Chip tone="green">Active</Chip> : <Chip>Off</Chip>) },
      ]} />}
      {tab === 'plans' && <CrudSection title="Pass plans" path="plans" pk="code" newLabel="New plan" fields={[
        { key: 'code', label: 'Code', required: true, readOnlyOnEdit: true }, { key: 'name', label: 'Name', required: true },
        { key: 'price_cents', label: 'Price per month', type: 'money', required: true }, { key: 'ride_discount_pct', label: 'Ride discount (%)', type: 'number' },
        { key: 'free_deliveries', label: 'Free small deliveries per month', type: 'number' }, { key: 'perks', label: 'Perks (comma separated)', type: 'array', full: true },
        { key: 'waive_booking_fee', label: 'No booking fees', type: 'bool' }, { key: 'active', label: 'On sale', type: 'bool' },
      ]} cols={[
        { key: 'name', label: 'Plan', render: (p) => <strong>{p.name}</strong> }, { key: 'price_cents', label: 'Monthly', num: true, render: (p) => money(p.price_cents) },
        { key: 'ride_discount_pct', label: 'Ride discount', num: true, render: (p) => `${p.ride_discount_pct}%` }, { key: 'free_deliveries', label: 'Free deliveries', num: true },
        { key: 'perks', label: 'Perks' }, { key: 'active', label: 'Status', render: (p) => (p.active ? <Chip tone="green">On sale</Chip> : <Chip>Off</Chip>) },
      ]} />}
      {tab === 'holidays' && <CrudSection title="Public holidays" path="holidays" pk="day" newLabel="Add holiday"
        describe={<p className="dg-muted" style={{ marginTop: 0 }}>Holiday surcharges apply on these days (Darwin time). Check the NT Government list each year, including Alice Springs Show Day.</p>}
        fields={[{ key: 'day', label: 'Date', type: 'date', required: true, readOnlyOnEdit: true }, { key: 'name', label: 'Name', required: true }]}
        cols={[{ key: 'day', label: 'Date', render: (h) => date(h.day) }, { key: 'name', label: 'Holiday' }]} />}
      {tab === 'tours' && <CrudSection title="Tours" path="tours" newLabel="New tour" fields={[
        { key: 'name', label: 'Tour name', required: true }, { key: 'slug', label: 'Web address slug', required: true },
        { key: 'price_cents', label: 'Price per vehicle', type: 'money', required: true }, { key: 'duration_min', label: 'Duration (minutes)', type: 'number', required: true },
        { key: 'max_passengers', label: 'Maximum guests', type: 'number' }, { key: 'image_url', label: 'Image URL' },
        { key: 'summary', label: 'Summary', type: 'textarea', required: true }, { key: 'description', label: 'Description', type: 'textarea', required: true },
        { key: 'cultural_note', label: 'Cultural note (shown before booking)', type: 'textarea' }, { key: 'stops', label: 'Stops (JSON list)', type: 'json' },
        { key: 'requires_permit', label: 'Needs a park or land permit', type: 'bool' }, { key: 'active', label: 'Bookable', type: 'bool' },
      ]} cols={[
        { key: 'name', label: 'Tour', render: (t) => <strong>{t.name}</strong> }, { key: 'duration_min', label: 'Duration', num: true, render: (t) => `${(t.duration_min / 60).toFixed(1)} h` },
        { key: 'price_cents', label: 'Price', num: true, render: (t) => money(t.price_cents) }, { key: 'stops', label: 'Stops', render: (t) => (t.stops ?? []).join(', ') },
        { key: 'requires_permit', label: 'Permit', render: (t) => (t.requires_permit ? <Chip tone="ochre">Required</Chip> : 'No') },
        { key: 'active', label: 'Status', render: (t) => (t.active ? <Chip tone="green">Bookable</Chip> : <Chip>Hidden</Chip>) },
      ]} />}
    </Page>
  );
}

/** Per-state rules: car age, levy, inspections, and whether DingoGo is live there. SA is built but stays off until accreditation. */
function States({ onZones }: { onZones: () => void }) {
  const js = useLoad(() => get('/admin/jurisdictions').then((r) => ({ ok: true, r })).catch((e) => ({ ok: false, r: null, e })), []);
  const zones = useLoad(() => get('/admin/zones'), []);
  const supported = js.data?.ok;
  const list = jurisdictionList(js.data?.r);
  return (<>
    <Section title="States" />
    <p className="dg-muted" style={{ marginTop: 0, maxWidth: 780 }}>Each state has its own rideshare rules. Drivers sign up for one state and only get trips that start there. Riders can only book in a live state’s live service areas.</p>
    {js.data && !supported && <p className="dg-note" style={{ maxWidth: 780 }}>This server doesn’t support states yet. Showing the default rules; changes can’t be saved until the API is updated.</p>}
    {!js.data && <p className="dg-muted">Loading…</p>}
    {js.data && <div className="state-list">{list.map((j) => <StateCard key={j.code} j={j} canSave={!!supported} zones={(j as any).zones ?? (zones.data?.items ?? []).filter((z: any) => (z.state ?? 'NT') === j.code)} onSaved={() => void js.reload()} onZones={onZones} />)}</div>}
    <ErrorMsg error={zones.error} />
  </>);
}

function StateCard({ j, canSave, zones, onSaved, onZones }: { j: Jurisdiction; canSave: boolean; zones: any[]; onSaved: () => void; onZones: () => void }) {
  const run = useRun();
  const init = () => ({ vehicle_max_age_years: String(j.vehicle_max_age_years), levy: (Number(j.levy_cents ?? 0) / 100).toFixed(2), levy_label: j.levy_label ?? '',
    inspection_months: j.inspection_months == null ? '' : String(j.inspection_months), notes: j.notes ?? '', active: !!j.active });
  const [f, setF] = useState(init);
  const [busy, setBusy] = useState(false);
  const key = JSON.stringify(j);
  useEffect(() => setF(init()), [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const minYear = minYearFor({ vehicle_max_age_years: Number(f.vehicle_max_age_years) || j.vehicle_max_age_years });
  const dirty = JSON.stringify(f) !== JSON.stringify(init());

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (f.active && !j.active && !confirm(`Make ${j.name} live? Drivers there can go online and riders can book in its live service areas. Only do this once DingoGo is accredited in ${j.code}.`)) return;
    if (!f.active && j.active && !confirm(`Take ${j.name} offline? Drivers there can’t go online and riders can’t book.`)) return;
    setBusy(true);
    const r = await run(() => patch(`/admin/jurisdictions/${j.code}`, {
      vehicle_max_age_years: Number(f.vehicle_max_age_years), levy_cents: Math.round(Number(f.levy) * 100), levy_label: f.levy_label.trim(),
      inspection_months: f.inspection_months === '' ? null : Number(f.inspection_months), notes: f.notes.trim() || null, active: f.active,
    }), `${j.name} saved`);
    setBusy(false);
    if (r) onSaved();
  }

  return (
    <form className="panel state-card" onSubmit={save}>
      <div className="state-card__head">
        <h3>{j.name}</h3>
        {j.active ? <Chip tone="green">Live</Chip> : <Chip tone="ochre">Coming soon</Chip>}
      </div>
      {j.regulator && <p className="dg-muted" style={{ margin: 0, fontSize: '.88rem' }}>Regulator: {j.regulator}</p>}
      <div className="form-grid">
        <label className="dg-field"><span>Oldest car allowed (years)</span><input className="dg-input" type="number" min={1} max={25} required value={f.vehicle_max_age_years} onChange={(e) => setF({ ...f, vehicle_max_age_years: e.target.value })} />
          <small className="dg-muted">Under {f.vehicle_max_age_years || j.vehicle_max_age_years} years: built in {minYear} or later</small></label>
        <label className="dg-field"><span>Annual inspection (months)</span><input className="dg-input" type="number" min={1} max={36} placeholder="None" value={f.inspection_months} onChange={(e) => setF({ ...f, inspection_months: e.target.value })} />
          <small className="dg-muted">Leave blank if the state doesn’t require one</small></label>
        <label className="dg-field"><span>Passenger levy per trip ($)</span><input className="dg-input" type="number" step="0.01" min={0} value={f.levy} onChange={(e) => setF({ ...f, levy: e.target.value })} />
          <small className="dg-muted">{j.code === 'SA' ? 'SA charges its levy only on trips starting in metro Adelaide, so $0 in regional towns.' : 'Added to trips that start in this state.'}</small></label>
        <label className="dg-field"><span>Levy name on receipts</span><input className="dg-input" value={f.levy_label} onChange={(e) => setF({ ...f, levy_label: e.target.value })} /></label>
        <label className="dg-field full"><span>Notes for staff</span><textarea className="dg-textarea" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        <label className="dg-check full"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} /><span>Live: drivers can go online and riders can book<br /><small className="dg-muted">{j.active ? 'On now.' : `Off until DingoGo is accredited in ${j.code}. Drivers can still sign up.`}</small></span></label>
      </div>
      <p className="state-card__docs"><strong>Driver papers:</strong> {j.driver_docs.map((t) => label(DOC_TYPE, t)).join(', ')}</p>
      <p className="state-card__docs"><strong>Car papers:</strong> {j.vehicle_docs.map((t) => label(DOC_TYPE, t)).join(', ')}</p>

      <h4 className="review__sub">Service areas</h4>
      {zones.length ? (
        <ul className="review__docs">
          {zones.map((z) => (
            <li key={z.id}><Icon name="pin" size={16} /><span className="review__doc">{z.name}{z.launch_note && <span className="sub">{z.launch_note}</span>}</span>
              {z.active ? (j.active ? <Chip tone="green">Live</Chip> : <Chip tone="ochre">On, but state is off</Chip>) : <Chip>Coming soon</Chip>}</li>
          ))}
        </ul>
      ) : <Empty>No service areas in {j.code} yet.</Empty>}
      <div className="actions">
        <button className="dg-btn dg-btn--sm" disabled={busy || !canSave || !dirty}>{busy ? 'Saving…' : 'Save'}</button>
        <button type="button" className="dg-btn dg-btn--sm dg-btn--ghost" onClick={onZones}>Edit service areas</button>
      </div>
    </form>
  );
}
