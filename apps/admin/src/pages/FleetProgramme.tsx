/**
 * Round 20: the fleet and EV programme in admin → Fleet. Hidden behind the programme switch until the fleet launches:
 * car agreements (weekly lease, rent-to-own) and the weekly run, maintenance with spare cars, insurance and claims,
 * per-car profitability and investor shares.
 */
import { useState } from 'react';
import { ApiError, Icon, date, dateTime, get, money, patch, post, put, useLoad } from '@dingogo/shared';
import { Chip, Empty, ErrorMsg, Modal, Section, Table, downloadCsv, useRun } from '../ui';

const KIND: Record<string, string> = { weekly_lease: 'Weekly lease', rent_to_own: 'Rent-to-own' };
const STATUS_TONE: Record<string, string | undefined> = { active: 'green', paused: 'ochre', ended: undefined, bought_out: 'green' };
const STATUS: Record<string, string> = { active: 'Active', paused: 'Paused', ended: 'Ended', bought_out: 'Bought out' };
const MAINT: Record<string, string> = { service: 'Service', tyres: 'Tyres', brakes: 'Brakes', battery_check: 'Battery check', repair: 'Repair', inspection: 'Inspection', other: 'Other' };
const DUE_TONE: Record<string, string | undefined> = { overdue: 'red', due_soon: 'ochre', ok: undefined };
const CLAIM_KIND: Record<string, string> = { collision: 'Collision', animal: 'Animal strike', windscreen: 'Windscreen', hail: 'Hail', theft: 'Theft', vandalism: 'Vandalism', other: 'Other' };
const CLAIM_STATUS = ['open', 'lodged', 'approved', 'declined', 'paid', 'closed'];
const today = () => new Date(Date.now() + 9.5 * 3600e3).toISOString().slice(0, 10);
const cents = (v: string) => Math.round(Number(v || 0) * 100);
const errText = (e: unknown) => (e instanceof ApiError ? e.message : String(e));

export type FleetInfo = { ready: boolean; policy: any; defaults: any; counts: any };
export const useFleet = () => useLoad<FleetInfo | null>(() => get('/admin/fleet').catch(() => null), []);

/** Switch and policy. Shown even while the programme is off. */
export function Programme({ info, onChanged }: { info: FleetInfo | null; onChanged: () => void }) {
  const run = useRun();
  const p = info?.policy;
  const [f, setF] = useState<any>(null);
  if (!info) return <p className="dg-muted">Loading…</p>;
  if (!info.ready) return <Empty icon="info">The fleet programme needs database migration 024. Weekly lease deductions still run from Payouts & leases.</Empty>;
  const form = f ?? {
    home: (p.charging.home_cents_per_kwh / 1).toString(), pub: String(p.charging.public_max_cents_per_kwh), cap: (p.charging.monthly_cap_cents / 100).toFixed(2),
    receipt: p.charging.public_needs_receipt, depot: p.charging.depot_reimbursed, weeks: String(p.arrears_flag_weeks), hours: String(p.target_hours_per_day), auto: p.auto_weekly,
  };
  const set = (k: string, v: unknown) => setF({ ...form, [k]: v });
  const save = (extra: any = {}) => run(async () => {
    await put('/admin/fleet/policy', { policy: { ...p, auto_weekly: form.auto, arrears_flag_weeks: Number(form.weeks), target_hours_per_day: Number(form.hours),
      charging: { home_cents_per_kwh: Number(form.home), public_max_cents_per_kwh: Number(form.pub), monthly_cap_cents: cents(form.cap), public_needs_receipt: form.receipt, depot_reimbursed: form.depot }, ...extra } });
    setF(null); onChanged();
  }, 'Fleet programme saved');
  return (<>
    <section className="panel" style={{ marginBottom: 16 }}>
      <h3 style={{ marginTop: 0 }}>Fleet programme {p.enabled ? <Chip tone="green">On</Chip> : <Chip>Off</Chip>}</h3>
      <p className="dg-muted" style={{ maxWidth: 720 }}>Car agreements (weekly lease and rent-to-own), maintenance and spare cars, insurance and claims, profit per car and investor shares for DingoGo-owned cars. Leave it off until the fleet launches: drivers with their own cars see nothing of it.</p>
      <button className={'dg-btn dg-btn--sm ' + (p.enabled ? 'dg-btn--ghost' : 'dg-btn--green')} onClick={() => save({ enabled: !p.enabled })}>{p.enabled ? 'Switch off' : 'Switch on'}</button>
    </section>
    <form onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <Section title="Rules" />
      <div className="form-grid">
        <label className="dg-field"><span>Home charging paid back (cents per kWh)</span><input className="dg-input" type="number" min={0} max={200} value={form.home} onChange={(e) => set('home', e.target.value)} /></label>
        <label className="dg-field"><span>Public charging limit (cents per kWh)</span><input className="dg-input" type="number" min={0} max={300} value={form.pub} onChange={(e) => set('pub', e.target.value)} /></label>
        <label className="dg-field"><span>Most paid back a month per driver ($, 0 = no limit)</span><input className="dg-input" type="number" step="0.01" min={0} value={form.cap} onChange={(e) => set('cap', e.target.value)} /></label>
        <label className="dg-field"><span>Flag arrears after (weeks owing)</span><input className="dg-input" type="number" min={1} max={12} value={form.weeks} onChange={(e) => set('weeks', e.target.value)} /></label>
        <label className="dg-field"><span>Working hours a day (utilisation)</span><input className="dg-input" type="number" min={1} max={24} value={form.hours} onChange={(e) => set('hours', e.target.value)} /></label>
        <label className="dg-check"><input type="checkbox" checked={form.receipt} onChange={(e) => set('receipt', e.target.checked)} /><span>Public charging needs a receipt</span></label>
        <label className="dg-check"><input type="checkbox" checked={form.depot} onChange={(e) => set('depot', e.target.checked)} /><span>Pay back depot charging</span></label>
        <label className="dg-check"><input type="checkbox" checked={form.auto} onChange={(e) => set('auto', e.target.checked)} /><span>Run agreement deductions every Monday morning</span></label>
      </div>
      <div className="actions"><button className="dg-btn dg-btn--sm">Save rules</button></div>
    </form>
    <Section title="Service plans" right={<span className="dg-muted">Batteries: every {p.heat.battery_every_months_hot} months in the hot months, and after a week averaging {p.heat.hot_week_c}°C</span>} />
    <Table rows={p.service_plans} rowKey={(r: any) => r.key} cols={[
      { key: 'label', label: 'Check' }, { key: 'every_km', label: 'Every (km)', num: true, render: (r: any) => (r.every_km ? r.every_km.toLocaleString('en-AU') : '—') },
      { key: 'every_months', label: 'Every (months)', num: true }, { key: 'fuels', label: 'Cars', render: (r: any) => r.fuels.join(', ').replace(/_/g, ' ') },
    ]} />
  </>);
}

// ───────────── Agreements ─────────────
export function Agreements() {
  const run = useRun();
  const { data, error, reload } = useLoad(() => get('/admin/fleet/contracts'), []);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [week, setWeek] = useState('');
  return (<>
    <Section title="Car agreements" right={<>
      <form className="toolbar-inline" onSubmit={async (e) => {
        e.preventDefault();
        if (!confirm(`Run the agreement deductions for the week ${week ? `of ${week}` : 'starting this Monday'}? Each agreement is charged once a week and never below the driver's balance.`)) return;
        const r = await run(() => post('/admin/fleet/run-week', week ? { week } : {}));
        if (r) { alert(`Week of ${r.week}: ${money(r.collected_cents)} taken from ${r.charged} driver(s). ${r.short_cents ? `${money(r.short_cents)} carried as owing.` : ''}`); void reload(); }
      }}>
        <input className="dg-input" type="date" value={week} onChange={(e) => setWeek(e.target.value)} aria-label="Week starting (Monday)" />
        <button className="dg-btn dg-btn--sm dg-btn--ghost">Run week</button>
      </form>
      <button className="dg-btn dg-btn--sm dg-btn--dark" onClick={() => setAdding(true)}>New agreement</button></>} />
    <p className="dg-muted" style={{ maxWidth: 760 }}>Each week takes the weekly amount plus anything owing, up to the catch-up limit, and never more than the driver has earned, so nobody goes below zero. What can't be taken is carried as owing.</p>
    <ErrorMsg error={error} />
    <Table rows={data?.items} rowKey={(r: any) => r.id} onRow={(r: any) => setOpen(r.id)} empty="No agreements yet." cols={[
      { key: 'rego', label: 'Car', render: (r: any) => <><strong>{r.rego}</strong><span className="sub">{r.make} {r.model}</span></> },
      { key: 'driver_name', label: 'Driver' }, { key: 'kind', label: 'Kind', render: (r: any) => KIND[r.kind] },
      { key: 'status', label: 'Status', render: (r: any) => <Chip tone={STATUS_TONE[r.status]}>{STATUS[r.status]}</Chip> },
      { key: 'weekly_cents', label: 'Weekly', num: true, render: (r: any) => money(r.weekly_cents) },
      { key: 'owing', label: 'Owing', num: true, render: (r: any) => <strong style={{ color: r.totals.owing_cents > 0 ? 'var(--earth-ink)' : undefined }}>{money(Math.max(0, r.totals.owing_cents))}</strong> },
      { key: 'buy_out', label: 'Left to own', num: true, render: (r: any) => (r.totals.buy_out_cents != null ? money(r.totals.buy_out_cents) : '—') },
      { key: 'starts_on', label: 'From', render: (r: any) => date(r.starts_on) },
    ]} />
    {adding && <NewAgreement onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void reload(); }} />}
    {open && <AgreementModal id={open} onClose={() => setOpen(null)} onChanged={() => void reload()} />}
  </>);
}

function NewAgreement({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const cars = useLoad(() => get('/admin/vehicles?status=approved'), []);
  const drivers = useLoad(() => get('/admin/drivers').catch(() => ({ items: [] })), []);
  const [f, setF] = useState<any>({ kind: 'weekly_lease', weekly: '113.33', starts_on: today(), price: '', deposit: '', catch_up: '150', keep: '0', vehicle_id: '', driver_id: '', notes: '' });
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });
  const rto = f.kind === 'rent_to_own';
  const weeks = rto && Number(f.weekly) > 0 ? Math.ceil(Math.max(0, Number(f.price) - Number(f.deposit || 0)) / Number(f.weekly)) : null;
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      await post('/admin/fleet/contracts', { vehicle_id: f.vehicle_id, driver_id: f.driver_id, kind: f.kind, weekly_cents: cents(f.weekly), starts_on: f.starts_on,
        price_cents: rto ? cents(f.price) : undefined, deposit_cents: cents(f.deposit), catch_up_pct: Number(f.catch_up), keep_min_cents: cents(f.keep), notes: f.notes || undefined });
      onSaved();
    } catch (ex) { setErr(errText(ex)); }
  }
  const fleetCars = (cars.data?.items ?? []).filter((v: any) => v.ownership !== 'driver_owned');
  return (
    <Modal title="New car agreement" onClose={onClose}>
      <form onSubmit={save}>
        <div className="form-grid">
          <label className="dg-field"><span>Car</span><select className="dg-select" value={f.vehicle_id} onChange={set('vehicle_id')} required>
            <option value="">Choose…</option>{fleetCars.map((v: any) => <option key={v.id} value={v.id}>{v.rego}, {v.make} {v.model}</option>)}</select></label>
          <label className="dg-field"><span>Driver</span><select className="dg-select" value={f.driver_id} onChange={set('driver_id')} required>
            <option value="">Choose…</option>{(drivers.data?.items ?? []).map((d: any) => <option key={d.user_id ?? d.id} value={d.user_id ?? d.id}>{d.name || d.phone}</option>)}</select></label>
          <label className="dg-field"><span>Kind</span><select className="dg-select" value={f.kind} onChange={set('kind')}><option value="weekly_lease">Weekly lease</option><option value="rent_to_own">Rent-to-own</option></select></label>
          <label className="dg-field"><span>Weekly amount ($)</span><input className="dg-input" type="number" step="0.01" min={0} value={f.weekly} onChange={set('weekly')} required /></label>
          <label className="dg-field"><span>Starts</span><input className="dg-input" type="date" value={f.starts_on} onChange={set('starts_on')} required /></label>
          {rto && <label className="dg-field"><span>Price to own ($)</span><input className="dg-input" type="number" step="0.01" min={0} value={f.price} onChange={set('price')} required /></label>}
          <label className="dg-field"><span>Deposit paid ($)</span><input className="dg-input" type="number" step="0.01" min={0} value={f.deposit} onChange={set('deposit')} /></label>
          <label className="dg-field"><span>Catch-up limit (% of weekly)</span><input className="dg-input" type="number" min={100} max={300} value={f.catch_up} onChange={set('catch_up')} /><small className="dg-muted">Most taken in one week when payments are behind</small></label>
          <label className="dg-field"><span>Always leave the driver ($)</span><input className="dg-input" type="number" step="0.01" min={0} value={f.keep} onChange={set('keep')} /></label>
          <label className="dg-field full"><span>Notes (staff only)</span><textarea className="dg-textarea" value={f.notes} onChange={set('notes')} maxLength={1000} /></label>
        </div>
        {weeks != null && <p className="dg-note">Paid off in about {weeks} weeks at {money(cents(f.weekly))} a week.</p>}
        <ErrorMsg error={err} />
        <div className="actions"><button className="dg-btn">Create agreement</button><button type="button" className="dg-btn dg-btn--ghost" onClick={onClose}>Cancel</button></div>
      </form>
    </Modal>
  );
}

function AgreementModal({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const run = useRun();
  const { data, error, reload } = useLoad(() => get(`/admin/fleet/contracts/${id}`), [id]);
  const k = data?.contract;
  const live = k && ['active', 'paused'].includes(k.status);
  const act = async (fn: () => Promise<unknown>, ok: string) => { if (await run(fn, ok)) { void reload(); onChanged(); } };
  const pay = (kind: 'payment' | 'waiver') => {
    const v = prompt(kind === 'waiver' ? 'Amount owing to write off ($)' : 'Amount paid by bank ($)');
    if (!v) return;
    const ref = prompt('Reference (optional)') ?? undefined;
    void act(() => post(`/admin/fleet/contracts/${id}/payments`, { kind, cents: cents(v), method: 'bank', reference: ref || undefined }), kind === 'waiver' ? 'Written off' : 'Payment recorded');
  };
  return (
    <Modal title={k ? `${k.rego}: ${KIND[k.kind]} with ${k.driver_name ?? 'driver'}` : 'Agreement'} onClose={onClose}>
      <ErrorMsg error={error} />
      {k && (<>
        <dl className="kv">
          <dt>Status</dt><dd><Chip tone={STATUS_TONE[k.status]}>{STATUS[k.status]}</Chip>{k.paused_reason && <span className="sub">{k.paused_reason}</span>}</dd>
          <dt>Weekly</dt><dd>{money(k.weekly_cents)} from {date(k.starts_on)}{k.ends_on ? ` to ${date(k.ends_on)}` : ''}</dd>
          <dt>Taken so far</dt><dd>{money(k.totals.collected_cents)} of {money(k.totals.due_cents)} due{k.totals.paid_cents ? `, plus ${money(k.totals.paid_cents)} paid by bank` : ''}</dd>
          <dt>Owing</dt><dd><strong>{money(Math.max(0, k.totals.owing_cents))}</strong>{k.totals.weeks_behind ? ` (${k.totals.weeks_behind} weeks)` : ''}{k.totals.owing_cents < 0 ? `, ${money(-k.totals.owing_cents)} paid ahead` : ''}</dd>
          {k.kind === 'rent_to_own' && <><dt>Left to own</dt><dd><strong>{money(k.totals.buy_out_cents)}</strong> of {money(k.price_cents)} (deposit {money(k.totals.deposit_cents)})</dd></>}
          <dt>Limits</dt><dd>Up to {k.catch_up_pct}% of weekly in one week{k.keep_min_cents ? `, always leaves ${money(k.keep_min_cents)}` : ''}</dd>
          {k.notes && <><dt>Notes</dt><dd>{k.notes}</dd></>}
        </dl>
        {live && <div className="actions">
          {k.status === 'active'
            ? <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => { const r = prompt('Why pause payments? (for example hardship, Sorry Business, car off the road)'); if (r) void act(() => patch(`/admin/fleet/contracts/${id}`, { status: 'paused', paused_reason: r }), 'Payments paused'); }}>Pause payments</button>
            : <button className="dg-btn dg-btn--sm" onClick={() => act(() => patch(`/admin/fleet/contracts/${id}`, { status: 'active' }), 'Payments resumed')}>Resume payments</button>}
          <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => pay('payment')}>Record bank payment</button>
          {k.totals.owing_cents > 0 && <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => pay('waiver')}>Write off owing</button>}
          {k.kind === 'rent_to_own' && <button className="dg-btn dg-btn--sm dg-btn--green" onClick={() => {
            const fromBalance = confirm(`Buy-out of ${money(k.totals.buy_out_cents)}. OK to take it from the driver's balance, Cancel if it was paid by bank.`);
            if (!confirm(`Close the agreement and give ${k.rego} to ${k.driver_name}?`)) return;
            void act(() => post(`/admin/fleet/contracts/${id}/buy-out`, { method: fromBalance ? 'balance' : 'bank' }), 'Bought out. The car is the driver’s now.');
          }}>Buy-out</button>}
          <button className="dg-btn dg-btn--sm dg-btn--danger" onClick={() => { const r = prompt('Why is the agreement ending? The car goes back to the fleet.'); if (r) void act(() => post(`/admin/fleet/contracts/${id}/end`, { reason: r }), 'Agreement ended'); }}>End agreement</button>
        </div>}
        <Section title="Weeks" />
        <Table rows={k.weeks} rowKey={(w: any) => w.week_start} empty="No weeks charged yet." cols={[
          { key: 'week_start', label: 'Week of', render: (w: any) => date(w.week_start) }, { key: 'due_cents', label: 'Due', num: true, render: (w: any) => money(w.due_cents) },
          { key: 'collected_cents', label: 'Taken', num: true, render: (w: any) => money(w.collected_cents) },
          { key: 'balance_before_cents', label: 'Driver balance', num: true, render: (w: any) => money(w.balance_before_cents) },
        ]} />
        {k.payments.length > 0 && <><Section title="Payments" /><Table rows={k.payments} rowKey={(p: any) => p.id} cols={[
          { key: 'created_at', label: 'When', render: (p: any) => dateTime(p.created_at) }, { key: 'kind', label: 'Kind' },
          { key: 'cents', label: 'Amount', num: true, render: (p: any) => money(p.cents) }, { key: 'reference', label: 'Reference' },
        ]} /></>}
      </>)}
    </Modal>
  );
}

// ───────────── Maintenance ─────────────
export function Maintenance() {
  const run = useRun();
  const { data, error, reload } = useLoad(() => get('/admin/fleet/maintenance'), []);
  const [book, setBook] = useState<any>(null);
  const act = async (fn: () => Promise<unknown>, ok: string) => { if (await run(fn, ok)) void reload(); };
  const start = (j: any) => {
    const spares = data?.spares ?? [];
    let spare: string | null = null;
    if (spares.length) {
      const pick = prompt(`Lend a spare car to the driver? Type its rego (${spares.map((s: any) => s.rego).join(', ')}) or leave empty to take them offline.`);
      if (pick === null) return;
      spare = spares.find((s: any) => s.rego.replace(/\s/g, '').toUpperCase() === pick.replace(/\s/g, '').toUpperCase())?.id ?? null;
      if (pick.trim() && !spare) { alert('That car is not free to lend.'); return; }
    }
    void act(() => post(`/admin/fleet/maintenance/${j.id}/start`, { spare_vehicle_id: spare }), 'Car is off the road');
  };
  const finish = (j: any) => {
    const odo = prompt('Odometer now (km, optional)');
    if (odo === null) return;
    const cost = prompt('Cost ($, optional)') ?? '';
    void act(() => post(`/admin/fleet/maintenance/${j.id}/finish`, { odometer_km: odo ? Number(odo) : undefined, cost_cents: cost ? cents(cost) : undefined }), 'Car is back on the road');
  };
  return (<>
    <ErrorMsg error={error} />
    {data && <p className="dg-muted">{data.summary.overdue} car(s) overdue, {data.summary.due_soon} due soon, {data.summary.off_road} off the road. Spare cars free: {data.spares.map((s: any) => s.rego).join(', ') || 'none'}.</p>}
    {(data?.cars ?? []).map((c: any) => (
      <section key={c.id} className="panel" style={{ marginBottom: 12 }}>
        <div className="section" style={{ marginTop: 0 }}>
          <h3 style={{ margin: 0 }}>{c.rego} <span className="dg-muted" style={{ fontWeight: 400 }}>{c.make} {c.model}{c.odometer_km != null ? `, ${c.odometer_km.toLocaleString('en-AU')} km` : ''}{c.driver ? `, ${c.driver.name}` : ''}</span></h3>
          <span className="spacer" />
          {c.hot_week && <Chip tone="ochre"><Icon name="sun" size={13} />Hot week ({c.week_c}°C)</Chip>}
          {!c.active && <Chip tone="red">Off road</Chip>}
          <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => setBook({ vehicle_id: c.id, rego: c.rego, kind: c.due.find((d: any) => d.status !== 'ok')?.kind ?? 'service', booked_for: today(), provider: '', notes: '', done: false, odometer: '', cost: '' })}>Book</button>
        </div>
        <ul className="review__docs">
          {c.due.map((d: any) => <li key={d.key}><Chip tone={DUE_TONE[d.status]}>{d.status === 'overdue' ? 'Overdue' : d.status === 'due_soon' ? 'Due soon' : 'OK'}</Chip>
            <span className="review__doc">{d.label}<span className="sub">{d.reason === 'hot_week' ? 'After a hot week. ' : ''}Due {date(d.due_date)}{d.due_km ? ` or ${d.due_km.toLocaleString('en-AU')} km` : ''}{d.last_done ? `, last done ${date(d.last_done)}` : ', no record yet'}</span></span></li>)}
        </ul>
        {c.open_jobs.map((j: any) => <div key={j.id} className="actions" style={{ alignItems: 'center' }}>
          <span><strong>{MAINT[j.kind]}</strong> {j.status === 'off_road' ? `off road since ${dateTime(j.started_at)}${j.spare_rego ? `, ${j.driver_name ?? 'driver'} in ${j.spare_rego}` : ''}` : `booked ${j.booked_for ? date(j.booked_for) : ''}`}{j.provider ? `, ${j.provider}` : ''}</span>
          {j.status === 'booked' && <><button className="dg-btn dg-btn--sm" onClick={() => start(j)}>Take off road</button><button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => act(() => post(`/admin/fleet/maintenance/${j.id}/cancel`), 'Cancelled')}>Cancel</button></>}
          <button className="dg-btn dg-btn--sm dg-btn--green" onClick={() => finish(j)}>Done, back on road</button>
        </div>)}
      </section>
    ))}
    {data && !data.cars.length && <Empty>No DingoGo cars yet.</Empty>}
    {book && <Modal title={`Book maintenance: ${book.rego}`} onClose={() => setBook(null)}>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => post('/admin/fleet/maintenance', { vehicle_id: book.vehicle_id, kind: book.kind, provider: book.provider || undefined, notes: book.notes || undefined,
          ...(book.done ? { done_on: book.booked_for, odometer_km: book.odometer ? Number(book.odometer) : undefined, cost_cents: book.cost ? cents(book.cost) : undefined } : { booked_for: book.booked_for }) }), book.done ? 'Recorded' : 'Booked');
        if (r) { setBook(null); void reload(); }
      }}>
        <div className="form-grid">
          <label className="dg-field"><span>Kind</span><select className="dg-select" value={book.kind} onChange={(e) => setBook({ ...book, kind: e.target.value })}>{Object.entries(MAINT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="dg-field"><span>{book.done ? 'Done on' : 'Booked for'}</span><input className="dg-input" type="date" value={book.booked_for} onChange={(e) => setBook({ ...book, booked_for: e.target.value })} /></label>
          <label className="dg-field"><span>Workshop</span><input className="dg-input" value={book.provider} maxLength={80} onChange={(e) => setBook({ ...book, provider: e.target.value })} /></label>
          <label className="dg-check"><input type="checkbox" checked={book.done} onChange={(e) => setBook({ ...book, done: e.target.checked })} /><span>Already done (for the record)</span></label>
          {book.done && <><label className="dg-field"><span>Odometer (km)</span><input className="dg-input" type="number" min={0} value={book.odometer} onChange={(e) => setBook({ ...book, odometer: e.target.value })} /></label>
            <label className="dg-field"><span>Cost ($)</span><input className="dg-input" type="number" step="0.01" min={0} value={book.cost} onChange={(e) => setBook({ ...book, cost: e.target.value })} /></label></>}
          <label className="dg-field full"><span>Notes</span><textarea className="dg-textarea" value={book.notes} maxLength={1000} onChange={(e) => setBook({ ...book, notes: e.target.value })} /></label>
        </div>
        <div className="actions"><button className="dg-btn">{book.done ? 'Record' : 'Book'}</button><button type="button" className="dg-btn dg-btn--ghost" onClick={() => setBook(null)}>Cancel</button></div>
      </form>
    </Modal>}
  </>);
}

// ───────────── Insurance and claims ─────────────
export function Insurance() {
  const run = useRun();
  const { data, error, reload } = useLoad(() => get('/admin/fleet/insurance'), []);
  const cars = useLoad(() => get('/admin/vehicles?status=all'), []);
  const fleetCars = (cars.data?.items ?? []).filter((v: any) => v.ownership !== 'driver_owned');
  const [pol, setPol] = useState<any>(null);
  const [claim, setClaim] = useState<any>(null);
  return (<>
    <ErrorMsg error={error} />
    <Section title="Policies" right={<button className="dg-btn dg-btn--sm dg-btn--dark" onClick={() => setPol({ vehicle_id: '', insurer: '', policy_no: '', cover: 'comprehensive', starts_on: today(), ends_on: '', premium: '', excess: '' })}>Add policy</button>} />
    <Table rows={data?.policies} rowKey={(p: any) => p.id} empty="No policies recorded." cols={[
      { key: 'rego', label: 'Car' }, { key: 'insurer', label: 'Insurer', render: (p: any) => <>{p.insurer}<span className="sub">{p.policy_no}</span></> },
      { key: 'cover', label: 'Cover', render: (p: any) => p.cover.replace(/_/g, ' ') },
      { key: 'ends_on', label: 'Ends', render: (p: any) => <>{date(p.ends_on)} {p.current ? (p.days_left <= 30 ? <Chip tone="ochre">{p.days_left} days</Chip> : <Chip tone="green">Current</Chip>) : <Chip>Not current</Chip>}</> },
      { key: 'premium_cents', label: 'Premium', num: true, render: (p: any) => money(p.premium_cents) }, { key: 'excess_cents', label: 'Excess', num: true, render: (p: any) => money(p.excess_cents) },
    ]} />
    <Section title="Claims and incidents" right={<button className="dg-btn dg-btn--sm dg-btn--dark" onClick={() => setClaim({ vehicle_id: '', kind: 'animal', incident_at: new Date().toISOString().slice(0, 16), description: '', excess: '' })}>Log incident</button>} />
    <Table rows={data?.claims} rowKey={(c: any) => c.id} empty="No claims." cols={[
      { key: 'incident_at', label: 'When', nowrap: true, render: (c: any) => dateTime(c.incident_at) }, { key: 'rego', label: 'Car' },
      { key: 'kind', label: 'What', render: (c: any) => <>{CLAIM_KIND[c.kind]}<span className="sub">{c.description}</span></> },
      { key: 'driver_name', label: 'Driver' },
      { key: 'status', label: 'Status', render: (c: any) => <select className="dg-select" value={c.status} aria-label="Claim status" onChange={async (e) => { if (await run(() => patch(`/admin/fleet/claims/${c.id}`, { status: e.target.value }), 'Claim updated')) void reload(); }}>
        {CLAIM_STATUS.map((s) => <option key={s} value={s}>{s}</option>)}</select> },
      { key: 'excess_cents', label: 'Excess', num: true, render: (c: any) => money(c.excess_cents) }, { key: 'payout_cents', label: 'Paid out', num: true, render: (c: any) => money(c.payout_cents) },
    ]} />
    {pol && <Modal title="Add insurance policy" onClose={() => setPol(null)}>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => post('/admin/fleet/insurance', { vehicle_id: pol.vehicle_id, insurer: pol.insurer, policy_no: pol.policy_no, cover: pol.cover, starts_on: pol.starts_on, ends_on: pol.ends_on, premium_cents: cents(pol.premium), excess_cents: cents(pol.excess) }), 'Policy added');
        if (r) { setPol(null); void reload(); }
      }}>
        <div className="form-grid">
          <label className="dg-field"><span>Car</span><select className="dg-select" required value={pol.vehicle_id} onChange={(e) => setPol({ ...pol, vehicle_id: e.target.value })}><option value="">Choose…</option>{fleetCars.map((v: any) => <option key={v.id} value={v.id}>{v.rego}</option>)}</select></label>
          <label className="dg-field"><span>Insurer</span><input className="dg-input" required value={pol.insurer} onChange={(e) => setPol({ ...pol, insurer: e.target.value })} /></label>
          <label className="dg-field"><span>Policy number</span><input className="dg-input" required value={pol.policy_no} onChange={(e) => setPol({ ...pol, policy_no: e.target.value })} /></label>
          <label className="dg-field"><span>Cover</span><select className="dg-select" value={pol.cover} onChange={(e) => setPol({ ...pol, cover: e.target.value })}>{['comprehensive', 'third_party_property', 'ctp', 'public_liability', 'other'].map((c) => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}</select></label>
          <label className="dg-field"><span>Starts</span><input className="dg-input" type="date" required value={pol.starts_on} onChange={(e) => setPol({ ...pol, starts_on: e.target.value })} /></label>
          <label className="dg-field"><span>Ends</span><input className="dg-input" type="date" required value={pol.ends_on} onChange={(e) => setPol({ ...pol, ends_on: e.target.value })} /></label>
          <label className="dg-field"><span>Premium for the period ($)</span><input className="dg-input" type="number" step="0.01" min={0} value={pol.premium} onChange={(e) => setPol({ ...pol, premium: e.target.value })} /></label>
          <label className="dg-field"><span>Excess ($)</span><input className="dg-input" type="number" step="0.01" min={0} value={pol.excess} onChange={(e) => setPol({ ...pol, excess: e.target.value })} /></label>
        </div>
        <p className="dg-muted">The car’s insurance expiry follows the latest comprehensive or property policy.</p>
        <div className="actions"><button className="dg-btn">Add policy</button><button type="button" className="dg-btn dg-btn--ghost" onClick={() => setPol(null)}>Cancel</button></div>
      </form>
    </Modal>}
    {claim && <Modal title="Log an incident or claim" onClose={() => setClaim(null)}>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => post('/admin/fleet/claims', { vehicle_id: claim.vehicle_id, kind: claim.kind, incident_at: new Date(claim.incident_at).toISOString(), description: claim.description, excess_cents: claim.excess ? cents(claim.excess) : undefined }), 'Incident logged');
        if (r) { setClaim(null); void reload(); }
      }}>
        <div className="form-grid">
          <label className="dg-field"><span>Car</span><select className="dg-select" required value={claim.vehicle_id} onChange={(e) => setClaim({ ...claim, vehicle_id: e.target.value })}><option value="">Choose…</option>{fleetCars.map((v: any) => <option key={v.id} value={v.id}>{v.rego}</option>)}</select></label>
          <label className="dg-field"><span>What happened</span><select className="dg-select" value={claim.kind} onChange={(e) => setClaim({ ...claim, kind: e.target.value })}>{Object.entries(CLAIM_KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="dg-field"><span>When</span><input className="dg-input" type="datetime-local" required value={claim.incident_at} onChange={(e) => setClaim({ ...claim, incident_at: e.target.value })} /></label>
          <label className="dg-field"><span>Excess ($)</span><input className="dg-input" type="number" step="0.01" min={0} value={claim.excess} onChange={(e) => setClaim({ ...claim, excess: e.target.value })} /></label>
          <label className="dg-field full"><span>Description</span><textarea className="dg-textarea" required minLength={3} maxLength={2000} value={claim.description} onChange={(e) => setClaim({ ...claim, description: e.target.value })} /></label>
        </div>
        <div className="actions"><button className="dg-btn">Log it</button><button type="button" className="dg-btn dg-btn--ghost" onClick={() => setClaim(null)}>Cancel</button></div>
      </form>
    </Modal>}
  </>);
}

// ───────────── Profitability and investors ─────────────
export function Profitability() {
  const run = useRun();
  const t = today();
  const [range, setRange] = useState({ from: t.slice(0, 8) + '01', to: t });
  const { data, error } = useLoad(() => get(`/admin/fleet/profitability?from=${range.from}&to=${range.to}`), [range.from, range.to]);
  return (<>
    <form className="toolbar" onSubmit={(e) => { e.preventDefault(); void run(() => downloadCsv(`/admin/fleet/profitability?from=${range.from}&to=${range.to}&format=csv`), 'Downloaded'); }}>
      <label className="inline-field"><span>From</span><input className="dg-input" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} /></label>
      <label className="inline-field"><span>To</span><input className="dg-input" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} /></label>
      <button className="dg-btn dg-btn--sm dg-btn--ghost">Export CSV</button>
    </form>
    <ErrorMsg error={error} />
    {data && <p className="dg-muted">{data.totals.cars} cars, {data.totals.trips} trips, {data.totals.km.toLocaleString('en-AU')} km. Income {money(data.totals.income_cents)}, costs {money(data.totals.costs_cents)}, <strong>profit {money(data.totals.profit_cents)}</strong>.</p>}
    <Table rows={data?.cars} rowKey={(c: any) => c.vehicle_id} empty="No DingoGo cars." cols={[
      { key: 'rego', label: 'Car', render: (c: any) => <><strong>{c.rego}</strong><span className="sub">{c.make} {c.model}</span></> },
      { key: 'trips', label: 'Trips', num: true }, { key: 'km', label: 'Km', num: true },
      { key: 'util', label: 'Utilisation', num: true, render: (c: any) => <>{c.utilisation_pct != null ? `${c.utilisation_pct}%` : '—'}<span className="sub">{c.engaged_hours_per_day} h a day</span></> },
      { key: 'off', label: 'Off road', num: true, render: (c: any) => `${c.off_road_days} d` },
      { key: 'income', label: 'Income', num: true, render: (c: any) => <span title={`Service fees ${money(c.income.service_fees_cents)}, agreements ${money(c.income.agreement_cents)}, roof ads ${money(c.income.ads_cents)}, insurance ${money(c.income.insurance_payouts_cents)}`}>{money(c.income.total_cents)}</span> },
      { key: 'costs', label: 'Costs', num: true, render: (c: any) => <span title={`Charging ${money(c.costs.charging_cents)}, maintenance ${money(c.costs.maintenance_cents)}, insurance ${money(c.costs.insurance_cents)}, claims ${money(c.costs.claims_cents)}, finance ${money(c.costs.finance_cents)}`}>{money(c.costs.total_cents)}</span> },
      { key: 'profit', label: 'Profit', num: true, render: (c: any) => <strong style={{ color: c.profit_cents < 0 ? 'var(--earth-ink)' : undefined }}>{money(c.profit_cents)}</strong> },
      { key: 'per_km', label: 'Per km', num: true, render: (c: any) => (c.profit_per_km_cents != null ? money(c.profit_per_km_cents) : '—') },
    ]} />
  </>);
}

export function Investors() {
  const run = useRun();
  const { data, error, reload } = useLoad(() => get('/admin/fleet/investors'), []);
  const cars = useLoad(() => get('/admin/vehicles?status=all'), []);
  const [month, setMonth] = useState(new Date(Date.now() - 20 * 864e5).toISOString().slice(0, 7));
  const rep = useLoad(() => get(`/admin/fleet/investor-report?month=${month}`), [month, data]);
  const [share, setShare] = useState<any>(null);
  const fleetCars = (cars.data?.items ?? []).filter((v: any) => v.ownership !== 'driver_owned');
  return (<>
    <ErrorMsg error={error} />
    <Section title="Investors" right={<button className="dg-btn dg-btn--sm dg-btn--dark" onClick={async () => {
      const name = prompt('Investor name');
      if (name && await run(() => post('/admin/fleet/investors', { name }), 'Investor added')) void reload();
    }}>Add investor</button>} />
    <Table rows={data?.items} rowKey={(i: any) => i.id} empty="No investors yet." cols={[
      { key: 'name', label: 'Investor', render: (i: any) => <>{i.name}{!i.active && <Chip>Inactive</Chip>}<span className="sub">{i.payment_ref ?? ''}</span></> },
      { key: 'shares', label: 'Cars', render: (i: any) => i.shares.map((s: any) => `${s.rego} ${Number(s.share_pct)}%${s.ends_on ? ` to ${date(s.ends_on)}` : ''}`).join(', ') || '—' },
      { key: 'x', label: '', render: (i: any) => <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => setShare({ investor_id: i.id, name: i.name, vehicle_id: '', share_pct: '', starts_on: today() })}>Add car share</button> },
    ]} />
    <Section title="Monthly shares" right={<>
      <input className="dg-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
      <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadCsv(`/admin/fleet/investor-report?month=${month}&format=csv`), 'Downloaded')}>Export CSV</button></>} />
    <ErrorMsg error={rep.error} />
    <Table rows={rep.data?.rows} rowKey={(r: any) => r.investor_id + r.vehicle_id} empty="No shares running this month." cols={[
      { key: 'investor', label: 'Investor' }, { key: 'rego', label: 'Car' }, { key: 'share_pct', label: 'Share', num: true, render: (r: any) => `${r.share_pct}%` },
      { key: 'days', label: 'Days', num: true }, { key: 'car_profit_cents', label: 'Car profit', num: true, render: (r: any) => money(r.car_profit_cents) },
      { key: 'share_cents', label: 'Their share', num: true, render: (r: any) => <strong>{money(r.share_cents)}</strong> },
    ]} />
    <p className="dg-muted">Profit is the car’s income less its costs for the month (see Profit per car). Losses are shared the same way.</p>
    {share && <Modal title={`Car share for ${share.name}`} onClose={() => setShare(null)}>
      <form onSubmit={async (e) => {
        e.preventDefault();
        const r = await run(() => post('/admin/fleet/investor-shares', { investor_id: share.investor_id, vehicle_id: share.vehicle_id, share_pct: Number(share.share_pct), starts_on: share.starts_on }), 'Share added');
        if (r) { setShare(null); void reload(); }
      }}>
        <div className="form-grid">
          <label className="dg-field"><span>Car</span><select className="dg-select" required value={share.vehicle_id} onChange={(e) => setShare({ ...share, vehicle_id: e.target.value })}><option value="">Choose…</option>{fleetCars.map((v: any) => <option key={v.id} value={v.id}>{v.rego}</option>)}</select></label>
          <label className="dg-field"><span>Share (%)</span><input className="dg-input" type="number" min={0.01} max={100} step="0.01" required value={share.share_pct} onChange={(e) => setShare({ ...share, share_pct: e.target.value })} /></label>
          <label className="dg-field"><span>From</span><input className="dg-input" type="date" required value={share.starts_on} onChange={(e) => setShare({ ...share, starts_on: e.target.value })} /></label>
        </div>
        <div className="actions"><button className="dg-btn">Add share</button><button type="button" className="dg-btn dg-btn--ghost" onClick={() => setShare(null)}>Cancel</button></div>
      </form>
    </Modal>}
  </>);
}
