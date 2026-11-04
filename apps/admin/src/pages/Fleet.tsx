import { useState } from 'react';
import { ApiError, get, post, money, date, dateTime, assetUrl, useLoad, Icon } from '@dingogo/shared';
import { Page, useOps } from '../ctx';
import { Chip, CrudSection, Empty, ErrorMsg, Section, Table, Tabs, exportCsv, useRun, useToast, type Field } from '../ui';
import { DOC_STATUS, DOC_TYPE, FUEL, OWNERSHIP, STATE_NAME, VEHICLE_STATUS, VEHICLE_STATUS_TONE, VERIFIED_SOURCE, docTone, isGreenFuel, label } from '../labels';
import { PPSR_URL, findJ, jurisdictionList, minYearFor, vinYear, type Jurisdiction } from '../rules';

const soon = (d?: string | null) => !d || new Date(d).getTime() < Date.now() + 30 * 864e5;
const Exp = ({ d }: { d?: string | null }) => <span style={soon(d) ? { color: 'var(--earth)', fontWeight: 700 } : undefined}>{d ? date(d) : 'Missing'}</span>;

const PLUG = ['electric', 'plug_in_hybrid'];
const fuelOf = (v: any): string => v?.fuel_type ?? 'electric';

/** Fuel chip: green for electric and hybrids, which get trips first. */
export function FuelChip({ fuel }: { fuel?: string | null }) {
  const f = fuel ?? 'electric';
  return isGreenFuel(f) ? <Chip tone="green"><Icon name={f === 'electric' ? 'bolt' : 'leaf'} size={13} />{label(FUEL, f)}</Chip> : <Chip>{label(FUEL, f)}</Chip>;
}
const ownerName = (v: any) => (v.ownership === 'driver_owned' ? v.owner?.name || v.owner_name || 'Driver' : 'Fleet');

const VEHICLE_FIELDS: Field[] = [
  { key: 'rego', label: 'Registration', required: true }, { key: 'colour', label: 'Colour', required: true },
  { key: 'make', label: 'Make', required: true }, { key: 'model', label: 'Model', required: true }, { key: 'year', label: 'Year', type: 'number', required: true },
  { key: 'fuel_type', label: 'Fuel', type: 'select', required: true, options: Object.entries(FUEL) },
  { key: 'seats', label: 'Passenger seats', type: 'number', min: 4, max: 7 }, { key: 'doors', label: 'Doors', type: 'number', min: 4 },
  { key: 'rego_state', label: 'Registered in', type: 'select', options: Object.entries(STATE_NAME) }, { key: 'vin', label: 'VIN' },
  { key: 'verified_year', label: 'Verified year', type: 'number', help: 'Year staff confirmed from the plate, papers or VIN' },
  { key: 'verified_source', label: 'Year checked from', type: 'select', options: Object.entries(VERIFIED_SOURCE) },
  { key: 'battery_kwh', label: 'Battery (kWh)', type: 'number', step: 0.1, help: 'Electric cars only' },
  { key: 'range_km', label: 'Rated range (km)', type: 'number', help: 'Electric only. Dispatch derates this for heat and A/C' },
  { key: 'battery_pct', label: 'Current battery (%)', type: 'number', min: 0, max: 100 }, { key: 'odometer_km', label: 'Odometer (km)', type: 'number' },
  { key: 'ownership', label: 'Ownership', type: 'select', required: true, options: [['fleet', 'DingoGo fleet'], ['leased_to_driver', 'Leased to driver'], ['driver_owned', 'Driver owned']] },
  { key: 'status', label: 'Check status', type: 'select', required: true, options: Object.entries(VEHICLE_STATUS), help: 'Only approved cars can take trips' },
  { key: 'lease_weekly_cents', label: 'Weekly lease charge', type: 'money', help: 'EV Direct Finance estimate is about $113.33/week' },
  { key: 'cvl_number', label: 'Rideshare CVL number' }, { key: 'cvl_expiry', label: 'CVL expiry', type: 'date' },
  { key: 'rego_expiry', label: 'Registration expiry', type: 'date' }, { key: 'insurance_expiry', label: 'Insurance expiry', type: 'date' },
  { key: 'inspection_expiry', label: 'Inspection due', type: 'date', help: 'SA cars: annual inspection' }, { key: 'roadworthy_date', label: 'Last roadworthy', type: 'date' },
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
  const { refreshCounts } = useOps();
  const [key, setKey] = useState<any>(null);
  const [show, setShow] = useState<'all' | 'approved' | 'pending' | 'rejected'>('all');
  const [refresh, setRefresh] = useState(0);
  const changed = () => { setRefresh((n) => n + 1); refreshCounts(); };
  return (<>
    <ReviewQueue refresh={refresh} onReviewed={changed} />
    <CrudSection title="Vehicles" path="vehicles" query="status=all" refresh={refresh} onSaved={changed} newLabel="Add vehicle" fields={VEHICLE_FIELDS}
      filter={show === 'all' ? undefined : (v) => (v.status ?? 'approved') === show}
      right={<label className="toolbar-inline"><span className="dg-muted">Show</span>
        <select className="dg-select" value={show} onChange={(e) => setShow(e.target.value as any)} aria-label="Show vehicles">
          <option value="all">All cars</option>{Object.entries(VEHICLE_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>}
      cols={[
        { key: 'rego', label: 'Rego', nowrap: true, render: (v) => <><strong>{v.rego}</strong><span className="sub">{v.rego_state ?? 'NT'}</span></> },
        { key: 'model', label: 'Vehicle', render: (v) => <>{v.verified_year ?? v.year} {v.make} {v.model}<span className="sub">{v.colour}{v.verified_year ? '' : v.ownership === 'driver_owned' ? ', year not verified' : ''}</span></> },
        { key: 'fuel_type', label: 'Fuel', render: (v) => <FuelChip fuel={v.fuel_type} /> },
        { key: 'owner', label: 'Owner', render: (v) => v.ownership === 'driver_owned' ? <>{ownerName(v)}{v.owner?.phone && <span className="sub">{v.owner.phone}</span>}</> : <>Fleet<span className="sub">{label(OWNERSHIP, v.ownership)}</span></> },
        { key: 'status', label: 'Status', render: (v) => <Chip tone={VEHICLE_STATUS_TONE[v.status ?? 'approved']}>{label(VEHICLE_STATUS, v.status ?? 'approved')}</Chip> },
        { key: 'battery_pct', label: 'Battery', num: true, render: (v) => (PLUG.includes(fuelOf(v)) && v.battery_pct != null ? `${v.battery_pct}%` : <span className="dg-muted">—</span>) },
        { key: 'lease_weekly_cents', label: 'Lease/wk', num: true, render: (v) => (v.lease_weekly_cents ? money(v.lease_weekly_cents) : '—') },
        { key: 'cvl_expiry', label: 'CVL', render: (v) => <Exp d={v.cvl_expiry} /> },
        { key: 'rego_expiry', label: 'Rego', render: (v) => <Exp d={v.rego_expiry} /> },
        { key: 'insurance_expiry', label: 'Insurance', render: (v) => <Exp d={v.insurance_expiry} /> },
        { key: 'features', label: 'Features', render: (v) => <>{v.pet_friendly && <Chip>Pets</Chip>} {v.wheelchair_accessible && <Chip>Wheelchair</Chip>} {v.has_roof_display && <Chip tone="ochre">Roof screen</Chip>} {!v.active && <Chip tone="red">Off road</Chip>}</> },
        { key: 'key', label: '', render: (v) => v.ownership !== 'driver_owned' || v.has_roof_display ? <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={async (e) => {
          e.stopPropagation();
          if (!confirm(`Issue a new roof display key for ${v.rego}? The old key stops working.`)) return;
          const r = await run(() => post(`/admin/vehicles/${v.id}/display-key`), 'New display key issued');
          if (r) setKey(r.vehicle);
        }}>New screen key</button> : null },
      ]} />
    {key && <p className="dg-note" style={{ marginTop: 12 }}>Display key for {key.rego}: <code>{key.display_key}</code>. Set it on the roof screen as <code>?key={key.display_key}</code>.</p>}
  </>);
}

const SIX_WEEKS = 42 * 864e5;
const docOf = (docs: any[], type: string) => docs.find((d) => d.type === type && d.status !== 'rejected') ?? docs.find((d) => d.type === type);
const day = (d?: string | null) => (d ? String(d).slice(0, 10) : '');

/** Driver-owned cars waiting for a check. Approve records the checks and expiry dates; reject sends the note to the driver. */
function ReviewQueue({ refresh, onReviewed }: { refresh: number; onReviewed: () => void }) {
  const { data, error, reload } = useLoad(() => get('/admin/vehicles?status=pending'), [refresh]);
  const js = useLoad(() => get('/admin/jurisdictions').catch(() => null), []);
  const integ = useLoad(() => get('/admin/integrations').catch(() => null), []);
  const states = jurisdictionList(js.data);
  const lookupStatus: string | undefined = integ.data?.plate_lookup ?? integ.data?.items?.plate_lookup;
  const items: any[] = (data?.items ?? []).filter((v: any) => v.status === 'pending');
  if (!data && !error) return null;
  return (<>
    <Section title={`Cars to check${items.length ? ` (${items.length})` : ''}`} />
    <ErrorMsg error={error} />
    {data && !items.length && <Empty icon="check">No cars waiting. Cars drivers add in the app appear here.</Empty>}
    <div className="review-list">
      {items.map((v) => <ReviewCard key={v.id} v={v} j={withCarRules(findJ(states, v.rego_state), v.state_rules)} lookupStatus={lookupStatus} onDone={() => { void reload(); onReviewed(); }} />)}
    </div>
  </>);
}

/** The API sends each car's state rules with it; prefer those over the list (same source, but newest). */
function withCarRules(j: Jurisdiction, r?: any): Jurisdiction {
  if (!r) return j;
  return { ...j, vehicle_max_age_years: Number(r.max_age_years ?? j.vehicle_max_age_years), inspection_months: r.inspection_months ?? j.inspection_months,
    rego_check_url: r.rego_check_url || j.rego_check_url, vehicle_docs: Array.isArray(r.vehicle_docs) && r.vehicle_docs.length ? r.vehicle_docs : j.vehicle_docs };
}

type Checks = { verified_year: string; verified_source: string; rego_checked: boolean; ppsr_clear: boolean; inspection_expiry: string };

function ReviewCard({ v, j, lookupStatus, onDone }: { v: any; j: Jurisdiction; lookupStatus?: string; onDone: () => void }) {
  const run = useRun();
  const docs: any[] = v.documents ?? [];
  const sa = j.code === 'SA';
  const [f, setF] = useState(() => ({
    cvl_number: v.cvl_number ?? docOf(docs, 'vehicle_cvl')?.number ?? '',
    cvl_expiry: day(v.cvl_expiry ?? docOf(docs, 'vehicle_cvl')?.expires_at),
    rego_expiry: day(v.rego_expiry ?? docOf(docs, 'vehicle_rego')?.expires_at),
    insurance_expiry: day(v.insurance_expiry ?? docOf(docs, 'insurance')?.expires_at),
    roadworthy_date: day(v.roadworthy_date),
  }));
  const [c, setC] = useState<Checks>(() => ({
    verified_year: v.verified_year ? String(v.verified_year) : '',
    verified_source: v.verified_source ?? '',
    rego_checked: !!v.rego_checked_at,
    ppsr_clear: !!v.ppsr_clear,
    inspection_expiry: day(v.inspection_expiry ?? docOf(docs, 'sa_inspection')?.expires_at),
  }));
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const minYear = minYearFor(j);
  const yearNow = Number(c.verified_year) || v.year;
  const oldCar = yearNow < minYear;
  const rwOld = f.roadworthy_date && Date.now() - new Date(f.roadworthy_date).getTime() > SIX_WEEKS;
  const missing = j.vehicle_docs.filter((t) => !docOf(docs, t));
  const canApprove = /^\d{4}$/.test(c.verified_year) && c.rego_checked && !oldCar && (!sa || !!c.inspection_expiry);

  async function review(decision: 'approve' | 'reject') {
    setBusy(true);
    const dates = sa ? { rego_expiry: f.rego_expiry, insurance_expiry: f.insurance_expiry } : f;
    const body = decision === 'approve'
      ? {
          decision, ...Object.fromEntries(Object.entries(dates).filter(([, x]) => x !== '')),
          verified_year: Number(c.verified_year), verified_source: c.verified_source || undefined,
          rego_checked: c.rego_checked, ppsr_clear: c.ppsr_clear || undefined, inspection_expiry: sa && c.inspection_expiry ? c.inspection_expiry : undefined,
        }
      : { decision, note: note.trim() };
    const r = await run(() => post(`/admin/vehicles/${v.id}/review`, body), decision === 'approve' ? `${v.rego} approved` : `${v.rego} not approved. The driver has been told why.`);
    setBusy(false);
    if (r) onDone();
  }

  return (
    <article className="panel review">
      <div className="review__head">
        <div>
          <h3>{v.year} {v.make} {v.model}, {v.colour} <span className="review__rego">{v.rego}</span> <span className="review__state">{j.code}</span></h3>
          <p className="dg-muted">{[`${v.seats ?? 4} seats`, `${v.doors ?? 4} doors`, v.created_at && `added ${date(v.created_at)}`].filter(Boolean).join(', ')}</p>
        </div>
        <span className="spacer" />
        <FuelChip fuel={v.fuel_type} />
      </div>
      <dl className="kv">
        <dt>Driver</dt><dd>{v.owner ? <>{v.owner.name || 'No name'}{v.owner.phone && <>, <a href={`tel:${v.owner.phone}`}>{v.owner.phone}</a></>}</> : '—'}</dd>
        {v.review_note && <><dt>Last note</dt><dd>{v.review_note}</dd></>}
      </dl>

      <h4 className="review__sub">Papers</h4>
      <ul className="review__docs">
        {!docs.length && <li className="dg-muted">No papers uploaded yet.</li>}
        {docs.map((x) => (
          <li key={x.id}>
            <Icon name="document" size={16} />
            <span className="review__doc">{label(DOC_TYPE, x.type)}<span className="sub">{[x.number, x.expires_at && `expires ${date(x.expires_at)}`].filter(Boolean).join(', ')}</span></span>
            {x.file_url ? <a href={assetUrl(x.file_url)} target="_blank" rel="noreferrer">View file</a> : <span className="dg-muted">No file</span>}
            <Chip tone={docTone(x.status)}>{label(DOC_STATUS, x.status)}</Chip>
          </li>
        ))}
      </ul>
      {missing.length > 0 && <p className="empty-note"><Icon name="alert" size={16} /> Still to upload: {missing.map((t) => label(DOC_TYPE, t).toLowerCase()).join(', ')}</p>}

      <CheckPanel v={v} j={j} docs={docs} c={c} setC={setC} lookupStatus={lookupStatus} />

      {!rejecting ? (
        <form onSubmit={(e) => { e.preventDefault(); if (canApprove) void review('approve'); }}>
          <h4 className="review__sub">Dates</h4>
          <div className="form-grid review__form">
            {!sa && <>
              <label className="dg-field"><span>CVL number</span><input className="dg-input" value={f.cvl_number} onChange={set('cvl_number')} required /></label>
              <label className="dg-field"><span>CVL expiry</span><input className="dg-input" type="date" value={f.cvl_expiry} onChange={set('cvl_expiry')} required /></label>
            </>}
            <label className="dg-field"><span>Registration expiry</span><input className="dg-input" type="date" value={f.rego_expiry} onChange={set('rego_expiry')} required /></label>
            <label className="dg-field"><span>Insurance expiry</span><input className="dg-input" type="date" value={f.insurance_expiry} onChange={set('insurance_expiry')} required /></label>
            {!sa && <label className="dg-field"><span>Roadworthy date</span><input className="dg-input" type="date" value={f.roadworthy_date} onChange={set('roadworthy_date')} />
              {rwOld ? <small style={{ color: 'var(--earth)', fontWeight: 700 }}>More than 6 weeks old. Check it was current when the CVL was issued.</small> : <small className="dg-muted">Must be under 6 weeks old when the CVL was applied for</small>}</label>}
          </div>
          {!canApprove && <p className="review__need"><Icon name="info" size={16} />{oldCar ? `Too old to approve: ${j.code} cars must be ${minYear} or newer.` : `To approve: ${[!/^\d{4}$/.test(c.verified_year) && 'enter the verified year', !c.rego_checked && 'tick rego current', sa && !c.inspection_expiry && 'enter the inspection expiry'].filter(Boolean).join(', ')}.`}</p>}
          <div className="actions">
            <button className="dg-btn dg-btn--sm dg-btn--green" disabled={busy || !canApprove}><Icon name="check" size={16} />Approve car</button>
            <button type="button" className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => setRejecting(true)}>Reject</button>
          </div>
        </form>
      ) : (
        <form onSubmit={(e) => { e.preventDefault(); void review('reject'); }}>
          <label className="dg-field"><span>Why not? (sent to the driver)</span>
            <textarea className="dg-textarea" value={note} onChange={(e) => setNote(e.target.value)} required maxLength={300} placeholder={oldCar ? `e.g. Your car was built in ${yearNow}. ${j.code} rideshare cars must be ${minYear} or newer.` : 'e.g. Insurance certificate doesn\'t name you as a driver. Please upload one that does.'} /></label>
          <div className="actions">
            <button className="dg-btn dg-btn--sm dg-btn--danger" disabled={busy || !note.trim()}>Reject car</button>
            <button type="button" className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => setRejecting(false)}>Back</button>
          </div>
        </form>
      )}
    </article>
  );
}

/** Free checks first (VIN year, compliance plate, government and PPSR sites), then the paid plate lookup if it's set up. */
function CheckPanel({ v, j, docs, c, setC, lookupStatus }: { v: any; j: Jurisdiction; docs: any[]; c: Checks; setC: (c: Checks) => void; lookupStatus?: string }) {
  const toast = useToast();
  const [lookup, setLookup] = useState<{ data: any; at?: string } | null>(v.lookup ? { data: v.lookup, at: v.lookup_at } : null);
  const [lookupMsg, setLookupMsg] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);
  const vy: number | null = v.vin_year ?? vinYear(v.vin);
  const mismatch = v.checks?.vin_year_mismatch ?? (vy != null && Math.abs(vy - v.year) > 1);
  const minYear = minYearFor(j);
  const yearNow = Number(c.verified_year) || null;
  const plate = docOf(docs, 'compliance_plate');
  const sa = j.code === 'SA';
  const setYear = (y: number, source: string) => setC({ ...c, verified_year: String(y), verified_source: source });

  async function copyVin() {
    try { await navigator.clipboard.writeText(v.vin); toast('VIN copied'); }
    catch { toast('Couldn’t copy. Select the VIN and copy it by hand.', true); }
  }
  async function doLookup() {
    setLookupMsg(null);
    if (lookupStatus === 'not_configured') { setLookupMsg('Paid plate lookup not set up. Add a provider key to turn it on.'); return; }
    if (lookupStatus === 'configured' && !confirm(`Look up ${v.rego} (${j.code})? Each lookup uses a paid credit.`)) return;
    setLooking(true);
    try {
      const r = await post(`/admin/vehicles/${v.id}/lookup`);
      setLookup({ data: r.lookup, at: r.lookup_at ?? new Date().toISOString() });
    } catch (e) {
      if (e instanceof ApiError && (e.status === 501 || e.code === 'lookup_not_configured')) setLookupMsg('Paid plate lookup not set up. Add a provider key to turn it on.');
      else if (e instanceof ApiError && e.status === 404 && e.code !== 'not_found') setLookupMsg('Plate lookup isn’t available on this server yet.');
      else setLookupMsg(e instanceof ApiError ? e.message : 'Lookup failed. Try again later.');
    } finally { setLooking(false); }
  }

  const L = lookup?.data;
  return (
    <section className="checks" aria-label="Checks">
      <h4 className="review__sub">Checks</h4>
      <dl className="kv checks__kv">
        <dt>Year</dt>
        <dd className="checks__row">
          <span>Driver says <strong>{v.year}</strong></span>
          {vy != null
            ? <Chip tone={mismatch ? 'red' : 'green'}><Icon name={mismatch ? 'alert' : 'check'} size={13} />VIN says {vy}{mismatch ? ', doesn’t match' : ''}</Chip>
            : <Chip>{v.vin ? 'VIN year unreadable' : 'No VIN'}</Chip>}
        </dd>
        <dt>Age limit</dt>
        <dd>{j.code}: under {j.vehicle_max_age_years} years, so {minYear} or newer
          {yearNow != null && <> <Chip tone={yearNow >= minYear ? 'green' : 'red'}>{yearNow >= minYear ? 'Verified year OK' : 'Too old'}</Chip></>}</dd>
        <dt>VIN</dt>
        <dd className="checks__row">{v.vin ? <><code className="checks__vin">{v.vin}</code><button type="button" className="dg-btn dg-btn--sm dg-btn--ghost" onClick={copyVin}>Copy VIN</button></> : <span className="dg-muted">Not given</span>}</dd>
        <dt>Compliance plate</dt>
        <dd>{plate?.file_url ? <a href={assetUrl(plate.file_url)} target="_blank" rel="noreferrer">View photo</a> : <span className="dg-muted">No photo yet</span>}
          <span className="sub">Shows the build date. Usually inside the driver’s door frame or in the engine bay.</span></dd>
      </dl>

      <div className="checks__links">
        <a className="dg-btn dg-btn--sm dg-btn--ghost" href={j.rego_check_url} target="_blank" rel="noreferrer"><Icon name="search" size={16} />Check rego ({j.code} gov)</a>
        <a className="dg-btn dg-btn--sm dg-btn--ghost" href={v.state_rules?.ppsr_url || PPSR_URL} target="_blank" rel="noreferrer"><Icon name="shield" size={16} />Check PPSR (by VIN)</a>
        <button type="button" className="dg-btn dg-btn--sm dg-btn--ghost" onClick={doLookup} disabled={looking}><Icon name="car" size={16} />{looking ? 'Looking up…' : 'Look up plate'}</button>
      </div>
      {lookupMsg && <p className="empty-note"><Icon name="info" size={16} /> {lookupMsg}</p>}
      {L && (
        <div className="checks__lookup">
          <p className="panel-label">Plate lookup{lookup?.at ? `, ${dateTime(lookup.at)}` : ''}</p>
          <dl className="kv">
            {L.description && <><dt>Car</dt><dd>{L.description}</dd></>}
            {!L.description && (L.make || L.model) && <><dt>Car</dt><dd>{[L.make, L.model].filter(Boolean).join(' ')}</dd></>}
            {L.year && <><dt>Year</dt><dd className="checks__row"><strong>{L.year}</strong>{Number(L.year) !== v.year && <Chip tone="red">Driver says {v.year}</Chip>}
              <button type="button" className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => setYear(Number(L.year), 'plate_lookup')}>Use this year</button></dd></>}
            {L.vin && <><dt>VIN</dt><dd className="checks__row"><code className="checks__vin">{L.vin}</code>{v.vin && String(L.vin).toUpperCase() !== String(v.vin).toUpperCase() && <Chip tone="red">Differs from driver’s VIN</Chip>}</dd></>}
            {L.expiry && <><dt>Rego expires</dt><dd>{date(L.expiry)}</dd></>}
          </dl>
        </div>
      )}

      <div className="checks__ticks">
        <label className="dg-check"><input type="checkbox" checked={c.rego_checked} onChange={(e) => setC({ ...c, rego_checked: e.target.checked })} /><span>Rego is current (checked on gov site){v.rego_checked_at && <small className="dg-muted"> Last ticked {date(v.rego_checked_at)}</small>}</span></label>
        <label className="dg-check"><input type="checkbox" checked={c.ppsr_clear} onChange={(e) => setC({ ...c, ppsr_clear: e.target.checked })} /><span>PPSR clear: not stolen or written off{v.ppsr_checked_at && <small className="dg-muted"> Last checked {date(v.ppsr_checked_at)}</small>}</span></label>
      </div>
      <div className="form-grid review__form">
        <label className="dg-field"><span>Verified year</span>
          <input className="dg-input" inputMode="numeric" maxLength={4} placeholder={String(vy ?? v.year)} value={c.verified_year} onChange={(e) => setC({ ...c, verified_year: e.target.value.replace(/\D/g, '').slice(0, 4) })} />
          {vy != null && !c.verified_year ? <small><button type="button" className="linkish" onClick={() => setYear(vy, 'vin')}>Use VIN year ({vy})</button></small> : <small className="dg-muted">From the compliance plate, rego papers or VIN</small>}</label>
        <label className="dg-field"><span>How you checked</span>
          <select className="dg-select" value={c.verified_source} onChange={(e) => setC({ ...c, verified_source: e.target.value })}>
            <option value="">Choose…</option>{Object.entries(VERIFIED_SOURCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        {sa && <label className="dg-field"><span>Annual inspection expiry</span><input className="dg-input" type="date" value={c.inspection_expiry} onChange={(e) => setC({ ...c, inspection_expiry: e.target.value })} />
          <small className="dg-muted">SA cars are inspected every {j.inspection_months ?? 12} months (RAA or Rightway)</small></label>}
      </div>
    </section>
  );
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
    <Section title="Battery and heat" right={<span className="dg-muted">Electric and plug-in hybrid cars</span>} />
    <Table rows={data?.fleet?.filter((r: any) => PLUG.includes(fuelOf(r)))} empty="No electric or plug-in hybrid cars on the road." rowKey={(r) => r.rego} cols={[
      { key: 'rego', label: 'Vehicle' },
      { key: 'battery_pct', label: 'Battery now', num: true, render: (r) => r.battery_pct != null ? <span style={{ color: r.battery_pct < 25 ? 'var(--earth)' : undefined, fontWeight: 700 }}>{r.battery_pct}%</span> : '—' },
      { key: 'range', label: 'Usable range (hot day)', num: true, render: (r) => r.battery_pct != null && r.range_km && fuelOf(r) === 'electric' ? `${Math.round(r.range_km * r.battery_pct / 100 * 0.7)} km` : '—' },
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
