import { useEffect, useState } from 'react';
import { dateTime, get, money, patch, post, put, useLoad } from '@dingogo/shared';
import { Chip, Drawer, Empty, ErrorMsg, Loading, Section, Table, Tabs, downloadCsv, useAsk, useRun } from '../ui';

/** Round 28: community trips. Shuttle runs and manifests, bookings for callers, long trips on the road, store cash, the routes. */
type Tab = 'runs' | 'caller' | 'road' | 'stores' | 'routes';
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const STATUS: Record<string, string> = { open: 'Taking bookings', closed: 'Closed', departed: 'On the road', completed: 'Done', cancelled: 'Cancelled' };

export default function Regional() {
  const [tab, setTab] = useState<Tab>('runs');
  const { data, error, reload } = useLoad(() => get('/admin/regional'));
  return (<>
    <h1>Community trips</h1>
    <p className="dg-muted" style={{ marginTop: 0 }}>Fixed-price trips and shared shuttles between Alice Springs and communities, parcels to community stores, and cash top-ups at stores.
      Permits: many communities are on Aboriginal land. The route notes say where a permit may be needed; check with the Central Land Council.</p>
    <ErrorMsg error={error} />
    {data && !data.ready && <p className="dg-note">Shuttles, long-trip drivers and store top-ups need database migration 028. Prices and notes still show to riders.</p>}
    <Tabs label="Community trips" tabs={[['runs', 'Shuttles'], ['caller', 'Book for a caller'], ['road', 'On the road'], ['stores', 'Store cash'], ['routes', 'Routes']]} value={tab} onChange={setTab}>
      {!data ? <Loading /> : tab === 'runs' ? <Runs data={data} reload={reload} /> : tab === 'caller' ? <Caller data={data} /> : tab === 'road' ? <Road data={data} />
        : tab === 'stores' ? <Stores /> : <Routes data={data} reload={reload} />}
    </Tabs>
  </>);
}

function Runs({ data, reload }: { data: any; reload: () => void }) {
  const run = useRun();
  const ask = useAsk();
  const [open, setOpen] = useState<any>(null);
  const corridors = data.policy.corridors.filter((c: any) => c.active);
  const [form, setForm] = useState({ corridor: corridors[0]?.id ?? '', direction: 'out', departs_at: '' });
  async function schedule() {
    const r = await run(() => post('/admin/regional/runs/schedule', { days: 28 }));
    if (r) { void reload(); }
  }
  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!form.departs_at) return;
    if (await run(() => post('/admin/regional/runs', { ...form, corridor: form.corridor || corridors[0]?.id, departs_at: new Date(form.departs_at + ':00+09:30').toISOString() }), 'Shuttle added')) void reload();
  }
  async function cancel(r: any) {
    const note = await ask({ title: `Cancel shuttle ${r.ref}?`, label: 'Note for the record (optional)', help: 'Everyone booked gets their credit back and a text.', required: false, ok: 'Cancel shuttle', danger: true });
    if (note !== null && await run(() => patch(`/admin/regional/runs/${r.id}`, { status: 'cancelled', ...(note ? { notes: note } : {}) }), 'Shuttle cancelled')) { setOpen(null); void reload(); }
  }
  async function assign(r: any, driver_id: string) {
    if (await run(() => patch(`/admin/regional/runs/${r.id}`, { driver_id: driver_id || null }), 'Driver saved')) void reload();
  }
  return (<>
    <Section title="Shuttles, next four weeks" right={<button className="dg-btn dg-btn--sm" onClick={schedule} disabled={!data.ready || !corridors.length}>Add the timetable</button>} />
    {!corridors.length && <p className="dg-note" role="status">No route is taking bookings yet. New databases start with every route closed: check the distances, coverage, permit notes and prices with the community, then tick "Taking bookings" on the Routes tab.</p>}
    <p className="dg-muted" style={{ marginTop: 0 }}>"Add the timetable" adds each route's shuttle days for four weeks (ones already there are kept). Drivers must say yes to long trips in the driver app.</p>
    <Table rows={data.runs} rowKey={(r: any) => r.id} onRow={setOpen} empty="No shuttles yet." cols={[
      { key: 'when', label: 'Leaves', nowrap: true }, { key: 'label', label: 'Route' },
      { key: 'seats', label: 'Seats', render: (r: any) => `${r.seats_taken} of ${r.seats}`, num: true },
      { key: 'parcels', label: 'Parcels', render: (r: any) => `${r.parcels_taken} of ${r.parcel_capacity}`, num: true },
      { key: 'driver_name', label: 'Driver', render: (r: any) => r.driver_name ?? <Chip tone="amber">None yet</Chip> },
      { key: 'status', label: 'Status', render: (r: any) => STATUS[r.status] ?? r.status },
    ]} />
    {corridors.length > 0 && <form onSubmit={create} className="form-grid" style={{ maxWidth: 820, marginTop: 16 }}>
      <label className="dg-field"><span>Route</span><select className="dg-input" value={form.corridor} onChange={(e) => setForm({ ...form, corridor: e.target.value })}>
        {corridors.map((c: any) => <option key={c.id} value={c.id}>{c.place.name}</option>)}</select></label>
      <label className="dg-field"><span>Direction</span><select className="dg-input" value={form.direction} onChange={(e) => setForm({ ...form, direction: e.target.value })}>
        <option value="out">From Alice Springs</option><option value="back">To Alice Springs</option></select></label>
      <label className="dg-field"><span>Leaves (Alice Springs time)</span><input className="dg-input" type="datetime-local" value={form.departs_at} onChange={(e) => setForm({ ...form, departs_at: e.target.value })} required /></label>
      <div><button className="dg-btn" disabled={!data.ready}>Add a shuttle</button></div>
    </form>}
    {open && <RunDrawer run={open} drivers={data.drivers} onClose={() => setOpen(null)} onCancel={() => cancel(open)} onAssign={(d) => assign(open, d)} />}
  </>);
}

function RunDrawer({ run, drivers, onClose, onCancel, onAssign }: { run: any; drivers: any[]; onClose: () => void; onCancel: () => void; onAssign: (d: string) => void }) {
  const m = useLoad(() => get(`/admin/regional/runs/${run.id}/manifest`), [run.id]);
  const act = useRun();
  const finished = ['completed', 'cancelled'].includes(run.status);
  return (
    <Drawer title={`${run.label}, ${run.when}`} onClose={onClose} actions={<>
      <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => act(() => downloadCsv(`/admin/regional/runs/${run.id}/manifest?format=csv`))}>Manifest CSV</button>
      <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => window.print()}>Print</button>
      {!finished && <button className="dg-btn dg-btn--sm dg-btn--danger" onClick={onCancel}>Cancel shuttle</button>}
    </>}>
      <p>{run.ref} · {STATUS[run.status] ?? run.status}{run.last_checkin_at ? ` · last check-in ${dateTime(run.last_checkin_at)}` : ''}</p>
      {!finished && <label className="dg-field"><span>Driver (said yes to long trips)</span>
        <select className="dg-input" value={run.driver_id ?? ''} onChange={(e) => onAssign(e.target.value)}>
          <option value="">Not assigned</option>{drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select></label>}
      <ErrorMsg error={m.error} />
      {m.data && (<>
        <h3>Passengers ({m.data.totals.seats} seats)</h3>
        <Table rows={m.data.seats} rowKey={(r: any) => r.id} empty="No seats booked." cols={[
          { key: 'name', label: 'Name' }, { key: 'seats', label: 'Seats', num: true }, { key: 'pickup', label: 'From' }, { key: 'dropoff', label: 'To' },
          { key: 'phone', label: 'Phone', nowrap: true }, { key: 'status', label: 'Status' }]} />
        <h3>Parcels ({m.data.totals.parcels})</h3>
        <Table rows={m.data.parcels} rowKey={(r: any) => r.id} empty="No parcels." cols={[
          { key: 'ref', label: 'Ref' }, { key: 'size', label: 'Size' }, { key: 'description', label: 'What' }, { key: 'recipient', label: 'For' },
          { key: 'store', label: 'Store' }, { key: 'status', label: 'Status' }]} />
        <h3>On the road</h3>
        <ul>{m.data.route.coverage_gaps.map((g: any, i: number) => <li key={i}>No coverage about km {g.from_km} to {g.to_km}: {g.note}</li>)}</ul>
        {m.data.route.permit_note && <p className="dg-note">Permits: {m.data.route.permit_note}</p>}
        {m.data.route.fuel_note && <p className="dg-muted">{m.data.route.fuel_note}</p>}
      </>)}
    </Drawer>
  );
}

function Caller({ data }: { data: any }) {
  const [phone, setPhone] = useState('');
  const [found, setFound] = useState<any>(null);
  const [form, setForm] = useState<any>({ kind: 'seat', seats: 1, run_id: '', name: '', size: 'S', description: '', recipient_name: '', recipient_phone: '', prohibited_ok: false });
  const run = useRun();
  const open = data.runs.filter((r: any) => r.status === 'open');
  async function look(e: React.FormEvent) {
    e.preventDefault();
    const r = await run(() => get(`/admin/callers?phone=${encodeURIComponent(phone)}`));
    if (r) { setFound(r); setForm((f: any) => ({ ...f, name: (r as any).user?.name ?? '' })); }
  }
  async function book(e: React.FormEvent) {
    e.preventDefault();
    const body: any = { phone, name: form.name, run_id: form.run_id, kind: form.kind };
    if (form.kind === 'seat') body.seats = Number(form.seats);
    else body.parcel = { size: form.size, description: form.description, recipient_name: form.recipient_name, recipient_phone: form.recipient_phone, prohibited_ok: form.prohibited_ok };
    const r = await run(() => post('/admin/regional/bookings', body), 'Booked and texted');
    if (r) setFound(await get(`/admin/callers?phone=${encodeURIComponent(phone)}`));
  }
  return (<>
    <form onSubmit={look} className="form-grid" style={{ maxWidth: 600 }}>
      <label className="dg-field"><span>Caller's phone</span><input className="dg-input" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} required /></label>
      <div><button className="dg-btn">Look up</button></div>
    </form>
    {found && (<>
      {found.user ? <p><strong>{found.user.name}</strong> · DingoGo credit {money(found.user.wallet_cents)}{found.user.blocked ? ' · ' : ''}{found.user.blocked && <Chip tone="red">Restricted</Chip>}
        {found.consents.length > 0 && <> · Organisations that book for them: {found.consents.map((c: any) => c.org).join(', ')}</>}</p>
        : <p className="dg-muted">New caller: no account yet. Booking makes one. Seats are paid with DingoGo credit (top up at a community store).</p>}
      {found.trips.length > 0 && <Table rows={found.trips} rowKey={(r: any) => r.id} cols={[{ key: 'ref', label: 'Trip' }, { key: 'status', label: 'Status' }, { key: 'dropoff_address', label: 'To' },
        { key: 'scheduled_for', label: 'Booked for', render: (r: any) => (r.scheduled_for ? dateTime(r.scheduled_for) : '') }]} />}
      {found.bookings.length > 0 && <Table rows={found.bookings} rowKey={(r: any) => r.id} cols={[{ key: 'ref', label: 'Booking' }, { key: 'kind', label: 'Seat or parcel' },
        { key: 'run', label: 'Shuttle', render: (r: any) => `${r.run.when} ${r.run.label}` }, { key: 'status', label: 'Status' }]} />}
      <form onSubmit={book} style={{ maxWidth: 820 }}>
        <Section title="Book a shuttle seat or parcel" />
        <div className="form-grid">
          <label className="dg-field"><span>Name</span><input className="dg-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></label>
          <label className="dg-field"><span>Shuttle</span><select className="dg-input" value={form.run_id} onChange={(e) => setForm({ ...form, run_id: e.target.value })} required>
            <option value="">Choose</option>{open.map((r: any) => <option key={r.id} value={r.id}>{r.when} {r.label} ({r.seats_left} seats left)</option>)}</select></label>
          <label className="dg-field"><span>Seat or parcel</span><select className="dg-input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
            <option value="seat">Seat</option><option value="parcel">Parcel to the community store</option></select></label>
          {form.kind === 'seat' ? <label className="dg-field"><span>Seats</span><input className="dg-input" type="number" min={1} max={4} value={form.seats} onChange={(e) => setForm({ ...form, seats: e.target.value })} /></label> : (<>
            <label className="dg-field"><span>Size</span><select className="dg-input" value={form.size} onChange={(e) => setForm({ ...form, size: e.target.value })}><option>S</option><option>M</option><option>L</option></select></label>
            <label className="dg-field"><span>What it is</span><input className="dg-input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} required /></label>
            <label className="dg-field"><span>Who collects it</span><input className="dg-input" value={form.recipient_name} onChange={(e) => setForm({ ...form, recipient_name: e.target.value })} required /></label>
            <label className="dg-field"><span>Their mobile</span><input className="dg-input" type="tel" value={form.recipient_phone} onChange={(e) => setForm({ ...form, recipient_phone: e.target.value })} required /></label>
            <label className="dg-check"><input type="checkbox" checked={form.prohibited_ok} onChange={(e) => setForm({ ...form, prohibited_ok: e.target.checked })} /><span>Caller confirmed: no alcohol, drugs, weapons or dangerous goods</span></label>
          </>)}
        </div>
        <button className="dg-btn" disabled={!data.ready}>Book and text them</button>
      </form>
      <p className="dg-muted">For a private car to a community, use Trips → Phone booking with the community as the drop-off: the route's fixed price applies, and you can book the trip back with it.</p>
    </>)}
  </>);
}

function Road({ data }: { data: any }) {
  const r = data.on_the_road;
  const late = (t: any) => t.expected_at && Date.now() > new Date(t.expected_at).getTime();
  return (<>
    <Section title="Long trips" />
    <Table rows={r.trips} rowKey={(r: any) => r.id} empty="No community trips booked or on the road." cols={[
      { key: 'ref', label: 'Trip' }, { key: 'name', label: 'Route', render: (t: any) => `${t.name ?? ''}${t.return_leg ? ' (trip back)' : ''}` },
      { key: 'status', label: 'Status' }, { key: 'driver_name', label: 'Driver' },
      { key: 'last_seen', label: 'Last check-in or signal', render: (t: any) => (t.last_seen ? dateTime(t.last_seen) : '') },
      { key: 'expected_at', label: 'Expected', render: (t: any) => (t.expected_at ? <>{dateTime(t.expected_at)} {late(t) && <Chip tone="amber">Late</Chip>}</> : t.scheduled_for ? dateTime(t.scheduled_for) : '') },
    ]} />
    <Section title="Shuttles on the road" />
    {r.runs.length ? <Table rows={r.runs} rowKey={(r: any) => r.id} cols={[{ key: 'ref', label: 'Shuttle' }, { key: 'label', label: 'Route' }, { key: 'driver_name', label: 'Driver' },
      { key: 'last_checkin_at', label: 'Last check-in', render: (x: any) => (x.last_checkin_at ? dateTime(x.last_checkin_at) : '') }]} /> : <Empty>No shuttles on the road.</Empty>}
    <p className="dg-muted">A missed check-in longer than the route's no-coverage stretch warns you here and on the live map; a trip well past its expected arrival raises an emergency alert in Safety.</p>
  </>);
}

function Stores() {
  const [month, setMonth] = useState(new Date(Date.now() + 9.5 * 3600e3).toISOString().slice(0, 7));
  const { data, error, reload } = useLoad(() => get(`/admin/regional/topups?month=${month}`), [month]);
  const run = useRun();
  const ask = useAsk();
  async function settle(s: any) {
    const ref = await ask({ title: `Cash received from ${s.name}`, label: 'Payment reference (EFT or receipt number)', required: true });
    if (ref && await run(() => post('/admin/regional/topups/settle', { partner_id: s.partner_id, month, ref }), 'Marked as paid')) void reload();
  }
  return (<>
    <label className="dg-field" style={{ maxWidth: 220 }}><span>Month</span><input className="dg-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
    <ErrorMsg error={error} />
    <p className="dg-muted">Community stores take cash and add DingoGo credit at the counter. The cash is DingoGo's: each store pays it over monthly. Credit is not income until it is spent (check GST treatment with the accountant).</p>
    {data && <Table rows={data.stores} rowKey={(r: any) => r.partner_id} empty="No top-ups this month." cols={[
      { key: 'name', label: 'Store' }, { key: 'n', label: 'Top-ups', num: true }, { key: 'total_cents', label: 'Total', num: true, render: (s: any) => money(s.total_cents) },
      { key: 'owed_cents', label: 'Still to pay over', num: true, render: (s: any) => money(s.owed_cents) },
      { key: 'settle', label: '', render: (s: any) => (s.owed_cents > 0 ? <button className="dg-btn dg-btn--sm" onClick={() => settle(s)}>Cash received</button> : <Chip tone="green">Paid over</Chip>) },
    ]} />}
  </>);
}

function Routes({ data, reload }: { data: any; reload: () => void }) {
  const [p, setP] = useState<any>(null);
  const [adv, setAdv] = useState('');
  const run = useRun();
  useEffect(() => { setP(structuredClone(data.policy)); setAdv(JSON.stringify(data.policy.corridors.map((c: any) => ({ id: c.id, pickup_points: c.pickup_points, coverage_gaps: c.coverage_gaps })), null, 2)); }, [data]);
  if (!p) return null;
  const setC = (i: number, k: string, v: any) => { const n = structuredClone(p); n.corridors[i][k] = v; setP(n); };
  async function save(e: React.FormEvent) {
    e.preventDefault();
    let extra: any[] = [];
    try { extra = JSON.parse(adv); } catch { await run(async () => { throw new Error('Pickup points and coverage gaps: that is not valid JSON'); }); return; }
    const out = structuredClone(p);
    for (const x of extra) { const c = out.corridors.find((y: any) => y.id === x.id); if (c) { c.pickup_points = x.pickup_points; c.coverage_gaps = x.coverage_gaps; } }
    if (await run(() => put('/admin/regional/policy', { policy: out }), 'Routes saved')) void reload();
  }
  const cents = (v: number) => (v / 100).toFixed(2);
  return (
    <form onSubmit={save} style={{ maxWidth: 980 }}>
      <div className="form-grid">
        <label className="dg-field"><span>Metered town fares go up to (km from town)</span><input className="dg-input" type="number" min={25} max={300} value={p.max_metered_km} onChange={(e) => setP({ ...p, max_metered_km: Number(e.target.value) })} /></label>
        <label className="dg-field"><span>Online notice for long trips (hours)</span><input className="dg-input" type="number" min={0} max={72} value={p.min_notice_hours} onChange={(e) => setP({ ...p, min_notice_hours: Number(e.target.value) })} /></label>
        <label className="dg-field"><span>Driver check-in every (min)</span><input className="dg-input" type="number" min={15} max={180} value={p.checkin_every_min} onChange={(e) => setP({ ...p, checkin_every_min: Number(e.target.value) })} /></label>
        <label className="dg-field"><span>Overdue alert after (min late)</span><input className="dg-input" type="number" min={15} max={240} value={p.overdue_after_min} onChange={(e) => setP({ ...p, overdue_after_min: Number(e.target.value) })} /></label>
        <label className="dg-field"><span>Bookings close before leaving (min)</span><input className="dg-input" type="number" min={0} max={1440} value={p.cutoff_min} onChange={(e) => setP({ ...p, cutoff_min: Number(e.target.value) })} /></label>
      </div>
      {p.corridors.map((c: any, i: number) => (
        <fieldset key={c.id} className="block"><legend>{c.name} {c.active ? <Chip tone="green">Open</Chip> : <Chip>Closed</Chip>} {!c.confirmed && <Chip tone="amber">Distances and gaps to confirm</Chip>}</legend>
          <label className="dg-check"><input type="checkbox" checked={c.active} onChange={(e) => setC(i, 'active', e.target.checked)} /><span>Taking bookings</span></label>
          <label className="dg-check"><input type="checkbox" checked={c.confirmed} onChange={(e) => setC(i, 'confirmed', e.target.checked)} /><span>Distances, coverage and notes checked with the community</span></label>
          <div className="form-grid">
            <label className="dg-field"><span>Private car one way ($)</span><input className="dg-input" type="number" step="0.05" value={cents(c.private_cents)} onChange={(e) => setC(i, 'private_cents', Math.round(Number(e.target.value) * 100))} /></label>
            <label className="dg-field"><span>Trip back booked together (% off)</span><input className="dg-input" type="number" min={0} max={60} value={c.return_discount_pct} onChange={(e) => setC(i, 'return_discount_pct', Number(e.target.value))} /></label>
            <label className="dg-field"><span>Shuttle seat ($)</span><input className="dg-input" type="number" step="0.05" value={cents(c.seat_cents)} onChange={(e) => setC(i, 'seat_cents', Math.round(Number(e.target.value) * 100))} /></label>
            {(['S', 'M', 'L'] as const).map((s) => <label key={s} className="dg-field"><span>Parcel {s} ($)</span><input className="dg-input" type="number" step="0.05" value={cents(c.parcel_cents[s])}
              onChange={(e) => setC(i, 'parcel_cents', { ...c.parcel_cents, [s]: Math.round(Number(e.target.value) * 100) })} /></label>)}
            <label className="dg-field"><span>Shuttle driver pay per leg, at least ($)</span><input className="dg-input" type="number" step="0.05" value={cents(c.run_pay_cents)} onChange={(e) => setC(i, 'run_pay_cents', Math.round(Number(e.target.value) * 100))} /></label>
            <label className="dg-field"><span>Road km</span><input className="dg-input" type="number" value={c.road_km} onChange={(e) => setC(i, 'road_km', Number(e.target.value))} /></label>
            <label className="dg-field"><span>Minutes</span><input className="dg-input" type="number" value={c.minutes} onChange={(e) => setC(i, 'minutes', Number(e.target.value))} /></label>
            <label className="dg-field"><span>Leaves Alice</span><input className="dg-input" type="time" value={c.depart_out} onChange={(e) => setC(i, 'depart_out', e.target.value)} /></label>
            <label className="dg-field"><span>Leaves for Alice</span><input className="dg-input" type="time" value={c.depart_back} onChange={(e) => setC(i, 'depart_back', e.target.value)} /></label>
            <label className="dg-field"><span>Shuttle seats</span><input className="dg-input" type="number" min={1} max={12} value={c.shuttle_seats} onChange={(e) => setC(i, 'shuttle_seats', Number(e.target.value))} /></label>
          </div>
          <fieldset className="block"><legend>Shuttle days</legend>{DAYS.map((d, n) => (
            <label key={d} className="dg-check"><input type="checkbox" checked={c.shuttle_days.includes(n)}
              onChange={(e) => setC(i, 'shuttle_days', e.target.checked ? [...c.shuttle_days, n].sort() : c.shuttle_days.filter((x: number) => x !== n))} /><span>{d}</span></label>))}</fieldset>
          <label className="dg-field"><span>Permit note (say "may"; DingoGo doesn't decide permits)</span><textarea className="dg-input" rows={2} value={c.permit_note ?? ''} onChange={(e) => setC(i, 'permit_note', e.target.value || null)} /></label>
          <label className="dg-field"><span>Fuel and road note</span><textarea className="dg-input" rows={2} value={c.fuel_note ?? ''} onChange={(e) => setC(i, 'fuel_note', e.target.value || null)} /></label>
          <label className="dg-check"><input type="checkbox" checked={c.charging_at_destination} onChange={(e) => setC(i, 'charging_at_destination', e.target.checked)} /><span>Electric cars can charge at the community end</span></label>
        </fieldset>
      ))}
      <label className="dg-field"><span>Pickup points (a store's partner id lets it hand over parcels) and no-coverage stretches, as JSON</span>
        <textarea className="dg-input" rows={10} value={adv} onChange={(e) => setAdv(e.target.value)} style={{ fontFamily: 'monospace' }} /></label>
      <button className="dg-btn">Save routes</button>
    </form>
  );
}
