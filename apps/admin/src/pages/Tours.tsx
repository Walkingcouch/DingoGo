/** Round 19: tours and hire for ops — upcoming bookings (guide, desk, deposit), heat and closure advisories, Aboriginal guides
 *  and what they're owed, hotel and visitor-centre commissions, and the deposit / hire policy. Tour products are edited under
 *  Pricing & tours. */
import { useState } from 'react';
import { ApiError, get, money, patch, post, put, date, dateTime, useLoad } from '@dingogo/shared';
import { Page } from '../ctx';
import { Chip, CrudSection, ErrorMsg, Modal, Section, Table, Tabs, downloadCsv, useRun } from '../ui';

const KIND: Record<string, string> = { heat: 'Heat', closure: 'Closure', fire: 'Fire danger', flood: 'Flood', road: 'Road', water: 'Water' };
const JOB: Record<string, [string, string]> = { assigned: ['Booked', ''], owed: ['Owed', 'ochre'], paid: ['Paid', 'green'], cancelled: ['Cancelled', ''] };

export default function Tours() {
  const [tab, setTab] = useState<'bookings' | 'advisories' | 'guides' | 'payments' | 'commissions' | 'policy'>('bookings');
  return (
    <Page title="Tours & hire">
      <Tabs tabs={[['bookings', 'Bookings'], ['advisories', 'Advisories'], ['guides', 'Guides'], ['payments', 'Guide payments'], ['commissions', 'Desk commissions'], ['policy', 'Deposit & hire']]} value={tab} onChange={setTab}>
        {tab === 'bookings' && <Bookings />}
        {tab === 'advisories' && <Advisories />}
        {tab === 'guides' && <Guides />}
        {tab === 'payments' && <GuidePayments />}
        {tab === 'commissions' && <Commissions />}
        {tab === 'policy' && <Policy />}
      </Tabs>
    </Page>
  );
}

function Bookings() {
  const b = useLoad(() => get('/admin/tour-bookings'));
  const guides = useLoad(() => get('/admin/tour-guides'));
  const run = useRun();
  const active = (guides.data?.items ?? []).filter((g: any) => g.active);
  return (<>
    <p className="dg-muted" style={{ marginTop: 0 }}>Booked tours and hourly hire, plus the last week. Tours led by an Aboriginal guide need a guide before the day.</p>
    {b.data && !b.data.ready && <p className="dg-muted">Guides and desk bookings appear once database migration 023 is applied.</p>}
    <Table rows={b.data?.items} empty="No tour or hire bookings." rowKey={(r) => r.id} cols={[
      { key: 'scheduled_for', label: 'Starts', nowrap: true, render: (r) => dateTime(r.scheduled_for) },
      { key: 'tour_name', label: 'Tour / hire', render: (r) => <><strong>{r.service === 'hourly' ? `Hourly hire, ${Math.round(r.est_duration_s / 3600)} h` : r.tour_name}</strong><br /><small className="dg-muted">{r.ref}</small></> },
      { key: 'rider_name', label: 'Guest', render: (r) => <>{r.rider_name}{r.partner_name && <><br /><small className="dg-muted">via {r.partner_name}</small></>}</> },
      { key: 'passengers', label: 'Guests', num: true },
      { key: 'quote_cents', label: 'Price', num: true, render: (r) => <>{money(r.quote_cents)}{r.deposit && <><br /><small className="dg-muted">deposit {money(r.deposit.cents)} {r.deposit.status}</small></>}</> },
      { key: 'status', label: 'Status', render: (r) => <Chip tone={r.status === 'scheduled' ? 'ochre' : r.status === 'completed' ? 'green' : ''}>{r.status}</Chip> },
      { key: 'guide', label: 'Guide', render: (r) => (!r.guided ? '—' : r.guide_status && r.guide_status !== 'assigned' ? `${r.guide_name} (${JOB[r.guide_status]?.[0] ?? r.guide_status})` : (
        <select className="dg-select" style={{ minHeight: 34, padding: '2px 6px' }} aria-label="Guide" value={r.guide_id ?? ''} disabled={r.status !== 'scheduled' && r.status !== 'requested'}
          onChange={async (e) => { await run(() => post(`/admin/trips/${r.id}/guide`, { guide_id: e.target.value || null }), 'Guide saved'); void b.reload(); }}>
          <option value="">Needs a guide</option>{active.map((g: any) => <option key={g.id} value={g.id}>{g.name}</option>)}
        </select>)) },
    ]} />
  </>);
}

function Advisories() {
  const a = useLoad(() => get('/admin/tour-advisories'));
  const tours = useLoad(() => get('/admin/tours'));
  const [open, setOpen] = useState(false);
  const run = useRun();
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Darwin' }).format(new Date());
  const [f, setF] = useState<any>({ kind: 'heat', title: 'Extreme heat', message: '', starts_on: today, ends_on: today, latest_start: '07:00', closes: false, tour_ids: [] as string[], notify: true });
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<number | null>(null);
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      const r = await post('/admin/tour-advisories', { ...f, latest_start: f.kind === 'heat' && !f.closes ? f.latest_start : null });
      setOpen(false); void a.reload(); setSent(r.notified);
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : String(ex)); }
  }
  return (<>
    <Section title="Heat, closures and other advisories" right={<button className="dg-btn dg-btn--sm dg-btn--dark" onClick={() => setOpen(true)} disabled={a.data && !a.data.ready}>New advisory</button>} />
    <p className="dg-muted" style={{ marginTop: 0 }}>Shown on the tour pages and in the apps. A closure stops bookings for those days; a heat advisory sets the latest start for walking tours. Guests already booked are told, and can cancel free when it affects their tour.</p>
    {a.data && !a.data.ready && <p className="dg-muted">Needs database migration 023.</p>}
    {sent != null && <p className="dg-muted" role="status">Posted. {sent} booked guest{sent === 1 ? '' : 's'} told.</p>}
    <Table rows={a.data?.items} empty="No advisories." cols={[
      { key: 'kind', label: 'Type', render: (x) => <Chip tone={x.closes || x.kind === 'fire' ? 'red' : 'ochre'}>{KIND[x.kind] ?? x.kind}</Chip> },
      { key: 'title', label: 'Advisory', render: (x) => <><strong>{x.title}</strong><br /><small>{x.message}</small></> },
      { key: 'starts_on', label: 'Days', render: (x) => (x.starts_on === x.ends_on ? date(x.starts_on) : `${date(x.starts_on)} to ${date(x.ends_on)}`) },
      { key: 'tour_ids', label: 'Tours', render: (x) => (x.tour_ids?.length ? x.tour_ids.map((id: string) => tours.data?.items.find((t: any) => t.id === id)?.name ?? 'Tour').join(', ') : 'All tours') },
      { key: 'rule', label: 'Effect', render: (x) => (x.closes ? 'No bookings' : x.latest_start ? `Walks start by ${x.latest_start}` : 'Notice only') },
      { key: 'notified', label: 'Told', num: true },
      { key: 'active', label: 'Status', render: (x) => (
        <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={async () => { await run(() => patch(`/admin/tour-advisories/${x.id}`, { active: !x.active }), x.active ? 'Turned off' : 'Turned on'); void a.reload(); }}>
          {x.active ? 'Turn off' : 'Turn on'}</button>) },
    ]} />
    {open && (
      <Modal title="New advisory" onClose={() => setOpen(false)}>
        <form onSubmit={save}>
          <div className="grid2">
            <label className="dg-field"><span>Type</span><select className="dg-select" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value, closes: e.target.value === 'closure' })}>
              {Object.entries(KIND).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="dg-field"><span>Title</span><input className="dg-input" required maxLength={80} value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
            <label className="dg-field"><span>From</span><input className="dg-input" type="date" required value={f.starts_on} onChange={(e) => setF({ ...f, starts_on: e.target.value })} /></label>
            <label className="dg-field"><span>To</span><input className="dg-input" type="date" required value={f.ends_on} onChange={(e) => setF({ ...f, ends_on: e.target.value })} /></label>
          </div>
          <label className="dg-field"><span>Message for guests</span><textarea className="dg-textarea" required maxLength={400} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="Forecast 44 degrees. Walking tours start by 7 am. Bring extra water." /></label>
          <label className="dg-check"><input type="checkbox" checked={f.closes} onChange={(e) => setF({ ...f, closes: e.target.checked })} /> Stop bookings on these days</label>
          {f.kind === 'heat' && !f.closes && <label className="dg-field"><span>Walking tours must start by</span><input className="dg-input" type="time" required value={f.latest_start} onChange={(e) => setF({ ...f, latest_start: e.target.value })} /></label>}
          <fieldset className="dg-field"><legend>Tours (none ticked = all tours)</legend>
            {tours.data?.items.map((t: any) => <label key={t.id} className="dg-check"><input type="checkbox" checked={f.tour_ids.includes(t.id)}
              onChange={(e) => setF({ ...f, tour_ids: e.target.checked ? [...f.tour_ids, t.id] : f.tour_ids.filter((x: string) => x !== t.id) })} /> {t.name}</label>)}
          </fieldset>
          <label className="dg-check"><input type="checkbox" checked={f.notify} onChange={(e) => setF({ ...f, notify: e.target.checked })} /> Tell guests already booked</label>
          <ErrorMsg error={err} />
          <div className="actions"><button className="dg-btn">Post advisory</button></div>
        </form>
      </Modal>
    )}
  </>);
}

function Guides() {
  return <CrudSection title="Guides" path="tour-guides" newLabel="Add guide"
    describe={<p className="dg-muted" style={{ marginTop: 0 }}>Aboriginal guides DingoGo books and pays per tour. A guide's name is shown to guests only if they agree. Keep bank details in the accounts system; put the payment reference here.</p>}
    fields={[
      { key: 'name', label: 'Name', required: true }, { key: 'phone', label: 'Mobile (for booking texts)', type: 'tel' }, { key: 'email', label: 'Email', type: 'email' },
      { key: 'community', label: 'Language group or community (as they want it written)' }, { key: 'bio', label: 'About (shown to guests with consent)', type: 'textarea' },
      { key: 'show_name', label: 'Agrees to their name being shown', type: 'bool' }, { key: 'abn', label: 'ABN (if they have one)' }, { key: 'bank_ref', label: 'Payment reference' },
      { key: 'active', label: 'Active', type: 'bool' },
    ]}
    cols={[
      { key: 'name', label: 'Guide', render: (g: any) => <><strong>{g.name}</strong>{g.community && <><br /><small className="dg-muted">{g.community}</small></>}</> },
      { key: 'upcoming', label: 'Booked tours', num: true }, { key: 'owed_cents', label: 'Owed', num: true, render: (g: any) => money(g.owed_cents) },
      { key: 'show_name', label: 'Name shown', render: (g: any) => (g.show_name ? 'Yes' : 'No') },
      { key: 'active', label: 'Status', render: (g: any) => (g.active ? <Chip tone="green">Active</Chip> : <Chip>Off</Chip>) },
    ]} />;
}

function GuidePayments() {
  const j = useLoad(() => get('/admin/tour-guide-jobs'));
  const [sel, setSel] = useState<string[]>([]);
  const [ref, setRef] = useState('');
  const run = useRun();
  const owed = (j.data?.items ?? []).filter((x: any) => x.status === 'owed');
  const total = owed.filter((x: any) => sel.includes(x.trip_id)).reduce((n: number, x: any) => n + x.owed_cents, 0);
  return (<>
    <Section title="Guide payments" right={<button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => downloadCsv('/admin/tour-guide-jobs?format=csv')}>CSV</button>} />
    <p className="dg-muted" style={{ marginTop: 0 }}>A guide is owed their whole fee when the tour is done, and the same share of it as the guest paid when a tour is cancelled late. Tick what you've paid and add the payment reference.</p>
    <Table rows={j.data?.items} empty="No guide jobs yet." rowKey={(x) => x.trip_id} cols={[
      { key: 'pick', label: '', render: (x) => (x.status === 'owed' ? <input type="checkbox" aria-label={`Pay ${x.guide_name} for ${x.ref}`} checked={sel.includes(x.trip_id)} onChange={(e) => setSel(e.target.checked ? [...sel, x.trip_id] : sel.filter((s) => s !== x.trip_id))} /> : null) },
      { key: 'guide_name', label: 'Guide' }, { key: 'tour_name', label: 'Tour', render: (x) => <>{x.tour_name}<br /><small className="dg-muted">{x.ref}, {date(x.scheduled_for)}</small></> },
      { key: 'fee_cents', label: 'Fee', num: true, render: (x) => money(x.fee_cents) }, { key: 'owed_cents', label: 'Owed', num: true, render: (x) => money(x.owed_cents) },
      { key: 'status', label: 'Status', render: (x) => <Chip tone={JOB[x.status]?.[1]}>{JOB[x.status]?.[0] ?? x.status}</Chip> },
      { key: 'paid_ref', label: 'Paid', render: (x) => (x.paid_at ? `${date(x.paid_at)} ${x.paid_ref ?? ''}` : '') },
    ]} />
    {owed.length > 0 && (
      <form style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12, alignItems: 'flex-end' }} onSubmit={async (e) => { e.preventDefault(); await run(() => post('/admin/tour-guide-jobs/pay', { trip_ids: sel, paid_ref: ref }), 'Marked paid'); setSel([]); setRef(''); void j.reload(); }}>
        <label className="dg-field" style={{ margin: 0 }}><span>Payment reference</span><input className="dg-input" required minLength={2} value={ref} onChange={(e) => setRef(e.target.value)} /></label>
        <button className="dg-btn" disabled={!sel.length}>Mark {sel.length} paid ({money(total)})</button>
      </form>
    )}
  </>);
}

function Commissions() {
  const c = useLoad(() => get('/admin/tour-commissions'));
  const run = useRun();
  const thisMonth = new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Darwin' }).format(new Date()).slice(0, 7);
  return (<>
    <p className="dg-muted" style={{ marginTop: 0 }}>Hotels, visitor centres and tour desks earn their rate on each tour they book once it's done. Set a desk's rate and business account under Loyalty & vouchers, Partners (type Hotel, Visitor centre or Tour desk).</p>
    {c.data && !c.data.ready && <p className="dg-muted">Needs database migration 023.</p>}
    <Table rows={c.data?.partners} empty="No tour desks yet." rowKey={(r) => `${r.partner_id}-${r.month}`} cols={[
      { key: 'name', label: 'Desk', render: (r) => <><strong>{r.name}</strong><br /><small className="dg-muted">{r.tour_commission_pct}%{r.corporate_account_id ? '' : ', no account linked'}</small></> },
      { key: 'month', label: 'Month', render: (r) => r.month ?? '—' },
      { key: 'earned_cents', label: 'Earned, unpaid', num: true, render: (r) => money(r.earned_cents) },
      { key: 'paid_cents', label: 'Paid', num: true, render: (r) => money(r.paid_cents) },
      { key: 'pending_cents', label: 'Tours still to run', num: true, render: (r) => money(r.pending_cents) },
      { key: 'pay', label: '', render: (r) => (r.month && r.earned_cents > 0 && r.month < thisMonth ? (
        <button className="dg-btn dg-btn--sm" onClick={async () => { const ref = window.prompt('Payment reference'); if (ref) { await run(() => post('/admin/tour-commissions/pay', { partner_id: r.partner_id, month: r.month, paid_ref: ref }), 'Marked paid'); void c.reload(); } }}>Mark paid</button>) : null) },
    ]} />
  </>);
}

function Policy() {
  const p = useLoad(() => get('/admin/tour-policy'));
  const [v, setV] = useState<any>(null);
  const run = useRun();
  const cur = v ?? p.data?.policy;
  if (!cur) return null;
  const num = (path: string[], label: string, help?: string, step = 1) => {
    const val = path.reduce((o, k) => o?.[k], cur);
    return <label className="dg-field"><span>{label}</span><input className="dg-input" type="number" step={step} value={val} onChange={(e) => {
      const n = structuredClone(cur); let o = n; for (const k of path.slice(0, -1)) o = o[k]; o[path[path.length - 1]] = Number(e.target.value); setV(n);
    }} />{help && <small className="dg-muted">{help}</small>}</label>;
  };
  return (
    <form onSubmit={async (e) => { e.preventDefault(); await run(() => put('/admin/tour-policy', { policy: cur }), 'Saved'); setV(null); void p.reload(); }}>
      <Section title="Tour deposit" />
      <div className="grid2">
        {num(['deposit_pct'], 'Deposit at booking (%)', 'Card bookings only. A tour can set its own.')}
        {num(['change_of_mind_min'], 'Free change of mind (minutes after booking)', 'For bookings made inside the free cancellation window.')}
      </div>
      <p className="dg-muted">Free cancellation hours and the late percentage are under Settings, Cancellation policy ({p.data.terms.free_cancel_hours} h for tours, {p.data.terms.hire_free_cancel_hours} h for hire, then {p.data.terms.late_pct}%).</p>
      <Section title="Hire" />
      <div className="grid2">
        {num(['hire', 'min_hours'], 'Minimum hours a day', undefined, 0.5)}
        {num(['hire', 'max_hours_per_day'], 'Most hours a day per driver', 'Fatigue rules: 12 at most.')}
        {num(['hire', 'day_cap_hours'], 'Day rate: a long day is charged as (hours)', undefined, 0.5)}
        {num(['hire', 'multi_day_min_days'], 'Multi-day discount from (days)')}
        {num(['hire', 'multi_day_pct'], 'Multi-day discount (%)')}
        {num(['hire', 'quote_valid_days'], 'Quotes valid for (days)')}
        {num(['hire', 'notice_hours'], 'Book hourly hire online at least (hours ahead)')}
      </div>
      <div className="actions"><button className="dg-btn" disabled={!v}>Save</button></div>
    </form>
  );
}
