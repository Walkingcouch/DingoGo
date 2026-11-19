import { useEffect, useState } from 'react';
import { ApiError, del, get, patch, post, put, money, date, dateTime, useLoad } from '@dingogo/shared';
import { Page, useOps } from '../ctx';
import { Chip, Drawer, ErrorMsg, Modal, Table, Tabs, useAsk, useRun } from '../ui';
import { TICKET_STATUS, label } from '../labels';

const CAT: Record<string, string> = { lost_item: 'Lost item', fare: 'Fare', safety: 'Safety', driver: 'Driver', parcel: 'Parcel', accessibility: 'Accessibility', assistance_animal_refused: 'Assistance animal refused', app: 'App', pay: 'Driver pay', other: 'Other' };
const PRIORITY: Record<string, string> = { urgent: 'Urgent', high: 'High', normal: 'Normal', low: 'Low' };
const PRIORITY_TONE: Record<string, string> = { urgent: 'red', high: 'ochre', normal: '', low: '' };
const LOST: Record<string, string> = { reported: 'Asked the driver', found: 'Driver has it', not_found: 'Not found', collect: 'Pickup arranged', return_booked: 'Courier booked', returned: 'Returned', closed: 'Closed' };
type View = 'open' | 'mine' | 'unassigned' | 'overdue' | 'resolved' | 'all';

/** "in 25 min", "12 min late", "2 h 5 min late". */
function dueText(min: number | null | undefined) {
  if (min == null) return '';
  const a = Math.abs(min);
  const t = a >= 60 ? `${Math.floor(a / 60)} h${a % 60 ? ` ${a % 60} min` : ''}` : `${a} min`;
  return min < 0 ? `${t} late` : `in ${t}`;
}
function SlaChip({ t }: { t: any }) {
  const s = t.sla;
  if (!s || t.status === 'resolved') return s?.resolve === 'missed' ? <Chip tone="red">Missed</Chip> : s?.resolve === 'met' ? <Chip tone="green">In time</Chip> : null;
  if (t.status === 'pending') return <Chip>Waiting on customer</Chip>;
  const what = s.first_response === 'due' || s.first_response === 'overdue' ? 'First reply' : 'Resolve';
  return <Chip tone={s.overdue ? 'red' : (s.minutes_left ?? 999) < 30 ? 'ochre' : ''}>{what} {dueText(s.minutes_left)}</Chip>;
}

export default function Support() {
  const [tab, setTab] = useState<'tickets' | 'lost' | 'canned' | 'policy' | 'hire' | 'enquiries'>('tickets');
  const [view, setView] = useState<View>('open');
  const [search, setSearch] = useState('');
  const [term, setTerm] = useState('');
  const tickets = useLoad(() => get(`/admin/support?view=${view}${term ? `&q=${encodeURIComponent(term)}` : ''}`), [view, term]);
  const hire = useLoad(() => get('/admin/hire-requests'));
  const enq = useLoad(() => get('/admin/enquiries'));
  const [open, setOpen] = useState<any>(null);
  const [quoting, setQuoting] = useState<any>(null);
  const { refreshCounts } = useOps();
  const run = useRun();
  const ask = useAsk();
  const n = (d: any, s: string) => d.data?.items.filter((x: any) => x.status === s).length ?? 0;
  const sum = tickets.data?.summary;
  const ready = tickets.data?.ready !== false;
  return (
    <Page title="Support & inbox">
      <Tabs tabs={[['tickets', `Support tickets${sum ? ` (${sum.open} open${sum.overdue ? `, ${sum.overdue} late` : ''})` : ` (${n(tickets, 'open')} open)`}`], ['lost', 'Lost property'], ['canned', 'Canned replies'], ['policy', 'Policy'],
        ['hire', `Hire requests (${n(hire, 'new')} new)`], ['enquiries', `Enquiries (${n(enq, 'new')} new)`]]} value={tab} onChange={setTab}>
      {tab === 'tickets' && (<>
        {sum && (
          <div className="kpis">
            <div className="kpi"><b>{sum.open}</b><span>Open</span></div>
            <div className="kpi"><b>{sum.overdue}</b><span>Late</span></div>
            <div className="kpi"><b>{sum.unassigned}</b><span>Nobody has it</span></div>
            <div className="kpi"><b>{sum.sla_first_pct_30d == null ? '—' : `${sum.sla_first_pct_30d}%`}</b><span>Replied in time (30 days)</span></div>
            <div className="kpi"><b>{sum.sla_resolved_pct_30d == null ? '—' : `${sum.sla_resolved_pct_30d}%`}</b><span>Sorted in time (30 days)</span></div>
            <div className="kpi"><b>{sum.csat_30d == null ? '—' : `${sum.csat_30d.toFixed(1)} / 5`}</b><span>Satisfaction (30 days) ({sum.csat_count_30d} ratings)</span></div>
          </div>
        )}
        {!ready && <p className="dg-note">Ticket references, owners, due times and replies from customers need database migration 026. Replies still reach the customer as a notification.</p>}
        {ready && (
          <form className="filters" onSubmit={(e) => { e.preventDefault(); setTerm(search.trim()); }} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'end', marginBottom: 10 }}>
            <label className="dg-field" style={{ margin: 0 }}><span>Show</span>
              <select className="dg-select" value={view} onChange={(e) => setView(e.target.value as View)}>
                {([['open', 'Open'], ['mine', 'Mine'], ['unassigned', 'Nobody has it'], ['overdue', 'Late'], ['resolved', 'Resolved'], ['all', 'All']] as [View, string][]).map(([k, l]) => <option key={k} value={k}>{l}{sum && k === 'mine' ? ` (${sum.mine})` : ''}</option>)}
              </select></label>
            <label className="dg-field" style={{ margin: 0 }}><span>Search</span><input className="dg-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="ST-…, DG-…, name, phone" /></label>
            <button className="dg-btn dg-btn--sm">Search</button>
          </form>
        )}
        <Table rows={tickets.data?.items} onRow={setOpen} empty="No tickets here." cols={[
          { key: 'created_at', label: 'Received', nowrap: true, render: (t) => <>{dateTime(t.created_at)}{t.ref && <><br /><small className="dg-muted">{t.ref}</small></>}</> },
          { key: 'category', label: 'Type', render: (t) => <><Chip tone={t.category === 'safety' || t.category === 'assistance_animal_refused' ? 'red' : ''}>{CAT[t.category] ?? t.category}</Chip>{t.priority && t.priority !== 'normal' && <> <Chip tone={PRIORITY_TONE[t.priority]}>{PRIORITY[t.priority]}</Chip></>}</> },
          { key: 'subject', label: 'Subject', render: (t) => <><strong>{t.subject}</strong>{t.preview && <><br /><small className="dg-muted">{t.preview}</small></>}</> },
          { key: 'user_name', label: 'From', render: (t) => <>{t.user_name}{t.role === 'driver' && <small className="dg-muted"> (driver)</small>}</> }, { key: 'trip_ref', label: 'Trip' },
          { key: 'assigned_name', label: 'Owner', render: (t) => t.assigned_name ?? <span className="dg-muted">—</span> },
          { key: 'status', label: 'Status', render: (t) => <span style={{ display: 'grid', gap: 4, justifyItems: 'start' }}><Chip tone={t.status === 'open' ? 'ochre' : t.status === 'resolved' ? 'green' : ''}>{label(TICKET_STATUS, t.status)}</Chip><SlaChip t={t} />{t.csat_score && <small className="dg-muted">Rated {t.csat_score}/5</small>}</span> },
        ]} />
      </>)}
      {tab === 'lost' && <LostProperty />}
      {tab === 'canned' && <CannedReplies />}
      {tab === 'policy' && <SupportPolicy />}
      {tab === 'hire' && <Table rows={hire.data?.items} empty="No hire requests." cols={[
        { key: 'created_at', label: 'Received', render: (h) => date(h.created_at) }, { key: 'kind', label: 'Type' },
        { key: 'contact_name', label: 'Contact', render: (h) => <><strong>{h.contact_name}</strong>{h.organisation && `, ${h.organisation}`}<br /><a href={`mailto:${h.contact_email}`}>{h.contact_email}</a> {h.contact_phone}</> },
        { key: 'event_date', label: 'Date', render: (h) => date(h.event_date) }, { key: 'passengers', label: 'People', num: true }, { key: 'vehicles', label: 'Cars', num: true },
        { key: 'details', label: 'Details', render: (h) => <span style={{ fontSize: '.85rem' }}>{h.details}</span> },
        { key: 'quote', label: 'Quote', num: true, render: (h) => (h.quote_cents ? <>{money(h.quote_cents)}{h.accepted_at && <><br /><small className="dg-muted">accepted by {h.accepted_name}</small></>}</> : '—') },
        { key: 'status', label: 'Status', render: (h) => (
          <span style={{ display: 'flex', gap: 6 }}>
            <select className="dg-select" style={{ minHeight: 34, padding: '2px 6px' }} value={h.status} aria-label="Status"
              onChange={async (e) => { await run(() => patch(`/admin/hire-requests/${h.id}`, { status: e.target.value }), 'Updated'); void hire.reload(); refreshCounts(); }}>
              {['new', 'quoted', 'confirmed', 'declined'].map((s) => <option key={s} value={s}>{label(TICKET_STATUS, s)}</option>)}
            </select>
            <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => setQuoting(h)} disabled={!!h.accepted_at}>{h.accepted_at ? 'Accepted' : h.quote_token ? 'Re-send quote' : 'Send quote'}</button>
          </span>) },
      ]} />}
      {tab === 'enquiries' && <Table rows={enq.data?.items} empty="No enquiries." cols={[
        { key: 'created_at', label: 'Received', render: (e) => date(e.created_at) }, { key: 'kind', label: 'About' },
        { key: 'name', label: 'From', render: (e) => <><strong>{e.name}</strong>{e.organisation && `, ${e.organisation}`}<br /><a href={`mailto:${e.email}`}>{e.email}</a> {e.phone}</> },
        { key: 'message', label: 'Message', render: (e) => <span style={{ fontSize: '.85rem' }}>{e.message}</span> },
        { key: 'status', label: 'Status', render: (e) => (
          <select className="dg-select" style={{ minHeight: 34, padding: '2px 6px' }} value={e.status} aria-label="Status"
            onChange={async (ev) => { await run(() => patch(`/admin/enquiries/${e.id}`, { status: ev.target.value }), 'Updated'); void enq.reload(); }}>
            {['new', 'replied', 'closed'].map((s) => <option key={s} value={s}>{label(TICKET_STATUS, s)}</option>)}
          </select>) },
      ]} />}
      {open && <Ticket id={open.id} onClose={() => { setOpen(null); void tickets.reload(); refreshCounts(); }} />}
      {quoting && <HireQuote h={quoting} onClose={() => { setQuoting(null); void hire.reload(); }} onManual={async () => {
        const q = await ask({ title: 'Quote for hire request', label: 'Quote amount in dollars (incl. GST)', inputMode: 'decimal', initial: quoting.quote_cents ? (quoting.quote_cents / 100).toFixed(2) : '', ok: 'Save quote' });
        if (q && Number(q) > 0) { await run(() => patch(`/admin/hire-requests/${quoting.id}`, { status: 'quoted', quote_cents: Math.round(Number(q) * 100) }), 'Quote saved'); setQuoting(null); void hire.reload(); }
      }} />}
      </Tabs>
    </Page>
  );
}

/** Round 22: one ticket — the thread (with internal notes), reply or note with a canned reply, owner, priority and status. */
function Ticket({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useLoad(() => get(`/admin/support/${id}`), [id]);
  const staff = useLoad(() => get('/admin/support/staff'));
  const [reply, setReply] = useState('');
  const [internal, setInternal] = useState(false);
  const [canned, setCanned] = useState<string>('');
  const run = useRun();
  const t = d.data?.ticket;
  const ready = d.data?.ready;
  const send = async (status?: string) => {
    if (!reply.trim()) return;
    const r = await run(() => post(`/admin/support/${id}/messages`, { body: reply.trim(), internal, status, canned_id: canned || undefined }),
      internal ? 'Note added' : status === 'resolved' ? 'Reply sent and resolved' : 'Reply sent');
    if (r) { setReply(''); setCanned(''); setInternal(false); void d.reload(); }
  };
  const update = async (b: any, ok: string) => { if (await run(() => patch(`/admin/support/${id}`, b), ok)) void d.reload(); };
  return (
    <Drawer title={t ? `${t.ref ? `${t.ref}: ` : ''}${t.subject}` : 'Ticket'} onClose={onClose}>
      <ErrorMsg error={d.error} />
      {t && (<>
        <dl className="kv"><dt>From</dt><dd>{t.user_name} {t.user_phone && <a href={`tel:${t.user_phone}`}>{t.user_phone}</a>}{t.user_role === 'driver' ? ' (driver)' : ''}</dd>
          <dt>Type</dt><dd>{CAT[t.category] ?? t.category}</dd>
          <dt>Trip</dt><dd>{d.data.trip ? <>{d.data.trip.ref}: {money(d.data.trip.final_cents ?? d.data.trip.quote_cents)} ({d.data.trip.payment_method}){d.data.trip.refunded_cents > 0 ? `, ${money(d.data.trip.refunded_cents)} refunded` : ''}{d.data.trip.driver_name ? `, driver ${d.data.trip.driver_name}` : ''}</> : '—'}</dd>
          <dt>Received</dt><dd>{dateTime(t.created_at)}</dd>
          {t.first_response_due_at && <><dt>Due</dt><dd>First reply {t.first_response_at ? `given ${dateTime(t.first_response_at)}` : `by ${dateTime(t.first_response_due_at)}`}; resolve by {dateTime(t.resolve_due_at)} <SlaChip t={t} /></dd></>}
          {t.csat_score && <><dt>Rating</dt><dd>{t.csat_score} / 5{t.csat_comment ? `: "${t.csat_comment}"` : ''}</dd></>}
        </dl>
        {ready && (
          <div className="form-grid">
            <label className="dg-field"><span>Status</span><select className="dg-select" value={t.status} onChange={(e) => update({ status: e.target.value }, 'Status changed')}>
              {['open', 'pending', 'resolved'].map((s) => <option key={s} value={s}>{label(TICKET_STATUS, s)}</option>)}</select></label>
            <label className="dg-field"><span>Priority</span><select className="dg-select" value={t.priority} onChange={(e) => update({ priority: e.target.value }, 'Priority changed')}>
              {Object.entries(PRIORITY).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label className="dg-field"><span>Owner</span><select className="dg-select" value={t.assigned_to ?? ''} onChange={(e) => update({ assigned_to: e.target.value || null }, 'Owner changed')}>
              <option value="">Nobody</option>{(staff.data?.items ?? []).map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          </div>
        )}
        {t.review && <p className="dg-note">Automatic fare check: {t.review.verdict}, charged {money(t.review.charged_cents)} on a {money(t.review.quote_cents)} price, track {t.review.tracked_distance_m != null ? `${(t.review.tracked_distance_m / 1000).toFixed(1)} km` : 'missing'} against {(t.review.est_distance_m / 1000).toFixed(1)} km estimated; difference {money(t.review.overcharge_cents)}{t.review.auto_refund_cents ? `, refunded ${money(t.review.auto_refund_cents)}` : t.review.decision && t.review.decision !== 'refund' ? `, held (${t.review.decision.replace(/_/g, ' ')})` : ''}.</p>}
        {d.data.lost_item && <p className="dg-note">Lost property: {LOST[d.data.lost_item.status] ?? d.data.lost_item.status}. "{d.data.lost_item.description}"{d.data.lost_item.handover ? `. Collect from ${d.data.lost_item.handover.address}` : ''}{d.data.lost_item.return_trip ? `. Courier ${d.data.lost_item.return_trip.ref}` : ''}.</p>}
        <ol className="thread" style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
          {d.data.messages.map((m: any) => (
            <li key={m.id} style={{ whiteSpace: 'pre-wrap', background: m.internal ? 'var(--ochre-soft)' : m.author_role === 'customer' ? 'var(--surface)' : 'var(--saltbush-soft)', border: '1px solid var(--line)', borderRadius: 12, padding: 12 }}>
              <small className="dg-muted">{m.internal ? 'Internal note, ' : ''}{m.author_role === 'customer' ? (m.author_name ?? 'Customer') : m.author_role === 'system' ? 'DingoGo automatic' : (m.author_name ?? 'DingoGo')} · {dateTime(m.created_at)}</small>
              <div>{m.body}</div>
            </li>
          ))}
        </ol>
        {ready && d.data.canned.length > 0 && (
          <label className="dg-field"><span>Canned reply</span>
            <select className="dg-select" value={canned} onChange={(e) => { setCanned(e.target.value); const c = d.data.canned.find((x: any) => x.id === e.target.value); if (c) setReply(c.filled); }}>
              <option value="">Choose one to start from…</option>{d.data.canned.map((c: any) => <option key={c.id} value={c.id}>{c.title}{c.category ? ` (${CAT[c.category] ?? c.category})` : ''}</option>)}
            </select></label>
        )}
        <label className="dg-field"><span>{internal ? 'Internal note (only DingoGo staff see it)' : 'Reply (the customer sees it in the app and gets a notification)'}</span>
          <textarea className="dg-textarea" value={reply} onChange={(e) => setReply(e.target.value)} rows={5} /></label>
        {ready && <label className="dg-check"><input type="checkbox" checked={internal} onChange={(e) => setInternal(e.target.checked)} /><span>Internal note</span></label>}
        <div className="actions">
          <button className="dg-btn dg-btn--dark" onClick={() => send(internal ? undefined : 'pending')} disabled={!reply.trim()}>{internal ? 'Add note' : 'Send and wait for customer'}</button>
          {!internal && <button className="dg-btn dg-btn--green" onClick={() => (reply.trim() ? send('resolved') : update({ status: 'resolved' }, 'Resolved'))}>{reply.trim() ? 'Send and resolve' : 'Resolve'}</button>}
        </div>
      </>)}
    </Drawer>
  );
}

function LostProperty() {
  const [all, setAll] = useState(false);
  const d = useLoad(() => get(`/admin/lost-items?status=${all ? 'all' : 'open'}`), [all]);
  const run = useRun();
  if (d.data && !d.data.ready) return <p className="dg-note">Lost property cases need database migration 026.</p>;
  return (<>
    <label className="dg-check"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /><span>Show closed cases too</span></label>
    <Table rows={d.data?.items} empty="No lost property cases." cols={[
      { key: 'created_at', label: 'Reported', nowrap: true, render: (r) => dateTime(r.created_at) }, { key: 'trip_ref', label: 'Trip' },
      { key: 'description', label: 'Item', render: (r) => <><strong>{r.description}</strong>{r.driver_note && <><br /><small className="dg-muted">Driver: {r.driver_note}</small></>}</> },
      { key: 'rider_name', label: 'Rider' }, { key: 'driver_name', label: 'Driver' },
      { key: 'where', label: 'Handover', render: (r) => r.handover?.address ?? '—' },
      { key: 'return_trip', label: 'Courier', render: (r) => r.return_trip ? `${r.return_trip.ref} (${r.return_trip.status})` : '—' },
      { key: 'status', label: 'Status', render: (r) => (
        <select className="dg-select" style={{ minHeight: 34, padding: '2px 6px' }} value={r.status} aria-label="Status"
          onChange={async (e) => { await run(() => patch(`/admin/lost-items/${r.id}`, { status: e.target.value }), 'Updated'); void d.reload(); }}>
          {Object.entries(LOST).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
        </select>) },
    ]} />
  </>);
}

function CannedReplies() {
  const d = useLoad(() => get('/admin/support/canned'));
  const [edit, setEdit] = useState<any>(null);
  const run = useRun();
  if (d.data && !d.data.ready) return <p className="dg-note">Canned replies need database migration 026.</p>;
  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const b = { title: edit.title, body: edit.body, category: edit.category || null, active: edit.active !== false };
    if (await run(() => (edit.id ? patch(`/admin/support/canned/${edit.id}`, b) : post('/admin/support/canned', b)), 'Saved')) { setEdit(null); void d.reload(); }
  };
  return (<>
    <p className="dg-muted" style={{ maxWidth: 760 }}>Short, plain replies the team starts from. Placeholders: {'{first_name}'}, {'{name}'}, {'{trip_ref}'}, {'{ticket_ref}'}. Only admins can change them.</p>
    <button className="dg-btn dg-btn--sm" onClick={() => setEdit({ title: '', body: '', category: '' })}>New canned reply</button>
    <Table rows={d.data?.items} onRow={setEdit} empty="No canned replies." cols={[
      { key: 'title', label: 'Title', render: (c) => <strong>{c.title}</strong> }, { key: 'category', label: 'For', render: (c) => (c.category ? CAT[c.category] ?? c.category : 'Any') },
      { key: 'body', label: 'Words', render: (c) => <span style={{ fontSize: '.85rem' }}>{c.body}</span> },
      { key: 'active', label: 'In use', render: (c) => (c.active ? <Chip tone="green">Yes</Chip> : <Chip>No</Chip>) },
    ]} />
    {edit && (
      <Modal title={edit.id ? 'Edit canned reply' : 'New canned reply'} onClose={() => setEdit(null)}>
        <form onSubmit={save}>
          <label className="dg-field"><span>Title</span><input className="dg-input" required maxLength={80} value={edit.title} onChange={(e) => setEdit({ ...edit, title: e.target.value })} /></label>
          <label className="dg-field"><span>For tickets about</span><select className="dg-select" value={edit.category ?? ''} onChange={(e) => setEdit({ ...edit, category: e.target.value })}>
            <option value="">Anything</option>{Object.entries(CAT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
          <label className="dg-field"><span>Words</span><textarea className="dg-textarea" required minLength={5} maxLength={2000} rows={6} value={edit.body} onChange={(e) => setEdit({ ...edit, body: e.target.value })} /></label>
          <label className="dg-check"><input type="checkbox" checked={edit.active !== false} onChange={(e) => setEdit({ ...edit, active: e.target.checked })} /><span>In use</span></label>
          <div className="actions">
            {edit.id && <button type="button" className="dg-btn dg-btn--ghost" onClick={async () => { if (await run(() => del(`/admin/support/canned/${edit.id}`), 'Deleted')) { setEdit(null); void d.reload(); } }}>Delete</button>}
            <button className="dg-btn">Save</button>
          </div>
        </form>
      </Modal>
    )}
  </>);
}

function SupportPolicy() {
  const d = useLoad(() => get('/admin/support/policy'));
  const [p, setP] = useState<any>(null);
  const run = useRun();
  useEffect(() => { if (d.data && !p) setP(structuredClone(d.data.policy)); }, [d.data]); // eslint-disable-line
  if (!p) return <ErrorMsg error={d.error} />;
  const fr = p.fare_review;
  const setFr = (k: string, v: unknown) => setP({ ...p, fare_review: { ...fr, [k]: v } });
  const setSla = (pr: string, k: string, v: number) => setP({ ...p, sla: { ...p.sla, [pr]: { ...p.sla[pr], [k]: v } } });
  const num = (v: number, on: (n: number) => void, lbl: string, step = 1) => <label className="dg-field"><span>{lbl}</span><input className="dg-input" type="number" step={step} value={v} onChange={(e) => on(Number(e.target.value))} /></label>;
  return (
    <form onSubmit={async (e) => { e.preventDefault(); const r: any = await run(() => put('/admin/support/policy', p), 'Policy saved'); if (r) setP(r.policy); }}>
      <h3>Reply and resolve times</h3>
      <p className="dg-muted">Calendar time. Safety tickets are always urgent.</p>
      <div className="form-grid">
        {Object.keys(PRIORITY).map((pr) => <div key={pr}>{num(p.sla[pr].first_response_min, (n) => setSla(pr, 'first_response_min', n), `${PRIORITY[pr]}: first reply (minutes)`)}{num(p.sla[pr].resolve_hours, (n) => setSla(pr, 'resolve_hours', n), `${PRIORITY[pr]}: resolve (hours)`)}</div>)}
      </div>
      <h3>Automatic fare check</h3>
      <p className="dg-muted">When a rider asks us to check a fare, a route change charge the car's GPS track doesn't support is refunded at once within these limits. Anything else goes to the team.</p>
      <label className="dg-check"><input type="checkbox" checked={fr.auto_refund} onChange={(e) => setFr('auto_refund', e.target.checked)} /><span>Refund small differences automatically</span></label>
      <div className="form-grid">
        {num(fr.max_cents / 100, (n) => setFr('max_cents', Math.round(n * 100)), 'Largest automatic refund ($)', 0.5)}
        {num(fr.max_per_rider_30d, (n) => setFr('max_per_rider_30d', n), 'Automatic refunds per rider in 30 days')}
        {num(fr.track_allowance_pct, (n) => setFr('track_allowance_pct', n), 'Allowance on the GPS distance (%)')}
        <label className="dg-field"><span>No GPS track</span><select className="dg-select" value={fr.unverified} onChange={(e) => setFr('unverified', e.target.value)}>
          <option value="refund">Refund within the limits</option><option value="ticket">The team decides</option></select></label>
      </div>
      <h3>Lost property</h3>
      <div className="form-grid">
        {num(p.lost_property.report_within_days, (n) => setP({ ...p, lost_property: { ...p.lost_property, report_within_days: n } }), 'Riders can report within (days)')}
        {num(p.lost_property.contact_days, (n) => setP({ ...p, lost_property: { ...p.lost_property, contact_days: n } }), 'Messages and calls stay open (days)')}
        {num(p.reopen_days, (n) => setP({ ...p, reopen_days: n }), 'A reply reopens a resolved ticket within (days)')}
      </div>
      <div className="actions"><button className="dg-btn">Save policy</button></div>
    </form>
  );
}

/** Round 19: quote hire by the hour / day / car from the hourly rate, and send the customer a private link to accept. */
function HireQuote({ h, onClose, onManual }: { h: any; onClose: () => void; onManual: () => void }) {
  const [f, setF] = useState({ hours_per_day: 4, days: 1, vehicles: h.vehicles ?? 1, start_date: h.event_date ? String(h.event_date).slice(0, 10) : '', note: '', total: '' });
  const [preview, setPreview] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<{ url: string; texted: boolean } | null>(null);
  const body = () => ({ hours_per_day: Number(f.hours_per_day), days: Number(f.days), vehicles: Number(f.vehicles) });
  async function calc() {
    setErr(null);
    try { setPreview((await post('/public/hire/quote', body())).quote); } catch (e) { setErr(e instanceof ApiError ? e.message : String(e)); }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      const r = await post(`/admin/hire-requests/${h.id}/quote`, { ...body(), start_date: f.start_date || null, note: f.note || null,
        total_override_cents: f.total ? Math.round(Number(f.total) * 100) : null });
      setSent({ url: r.url, texted: r.texted });
    } catch (ex) {
      if (ex instanceof ApiError && ex.code === 'migration_pending') { onManual(); return; }
      setErr(ex instanceof ApiError ? ex.message : String(ex));
    }
  }
  const num = (k: 'hours_per_day' | 'days' | 'vehicles', label: string, step = 1) => (
    <label className="dg-field"><span>{label}</span><input className="dg-input" type="number" min={step} step={step} value={f[k]} onChange={(e) => { setF({ ...f, [k]: e.target.value as any }); setPreview(null); }} /></label>);
  return (
    <Modal title={`Hire quote for ${h.contact_name}`} onClose={onClose}>
      {sent ? (<>
        <p>Quote sent{sent.texted ? ' by text' : ''}. Share this link if they need it again:</p>
        <p><a href={sent.url} target="_blank" rel="noreferrer">{sent.url}</a></p>
        <div className="actions"><button className="dg-btn" onClick={onClose}>Done</button></div>
      </>) : (
      <form onSubmit={send}>
        <div className="grid2">{num('hours_per_day', 'Hours a day', 0.5)}{num('days', 'Days')}{num('vehicles', 'Cars')}
          <label className="dg-field"><span>First day</span><input className="dg-input" type="date" value={f.start_date} onChange={(e) => setF({ ...f, start_date: e.target.value })} /></label></div>
        <label className="dg-field"><span>Note for the customer</span><textarea className="dg-textarea" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Airport runs on day one, venue shuttles after" /></label>
        <label className="dg-field"><span>Agreed total instead (dollars, optional)</span><input className="dg-input" inputMode="decimal" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value })} /></label>
        {preview && <table className="dg-table" style={{ marginBottom: 10 }}><tbody>
          {preview.lines.map((l: any) => <tr key={l.label}><td>{l.label}</td><td style={{ textAlign: 'right' }}>{l.cents ? money(l.cents) : ''}</td></tr>)}
          <tr><td><strong>Total incl. GST</strong></td><td style={{ textAlign: 'right' }}><strong>{money(preview.total_cents)}</strong></td></tr></tbody></table>}
        <ErrorMsg error={err} />
        <div className="actions"><button type="button" className="dg-btn dg-btn--ghost" onClick={calc}>Work it out</button><button className="dg-btn">Send quote</button></div>
        <p className="dg-muted" style={{ fontSize: '.85rem' }}>The customer gets a private link to see the price and the cancellation terms and accept. {h.contact_phone ? 'It is texted to them.' : 'They have no mobile on the request: copy the link into your email.'}</p>
      </form>)}
    </Modal>
  );
}
