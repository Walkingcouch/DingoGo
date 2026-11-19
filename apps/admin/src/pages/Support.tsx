import { useState } from 'react';
import { ApiError, get, patch, post, money, date, dateTime, useLoad } from '@dingogo/shared';
import { Page, useOps } from '../ctx';
import { Chip, Drawer, ErrorMsg, Modal, Table, Tabs, useAsk, useRun } from '../ui';
import { TICKET_STATUS, label } from '../labels';

const CAT: Record<string, string> = { lost_item: 'Lost item', fare: 'Fare', safety: 'Safety', driver: 'Driver', parcel: 'Parcel', accessibility: 'Accessibility', assistance_animal_refused: 'Assistance animal refused', app: 'App', other: 'Other' };

export default function Support() {
  const [tab, setTab] = useState<'tickets' | 'hire' | 'enquiries'>('tickets');
  const tickets = useLoad(() => get('/admin/support'));
  const hire = useLoad(() => get('/admin/hire-requests'));
  const enq = useLoad(() => get('/admin/enquiries'));
  const [open, setOpen] = useState<any>(null);
  const [quoting, setQuoting] = useState<any>(null);
  const { refreshCounts } = useOps();
  const run = useRun();
  const ask = useAsk();
  const n = (d: any, s: string) => d.data?.items.filter((x: any) => x.status === s).length ?? 0;
  return (
    <Page title="Support & inbox">
      <Tabs tabs={[['tickets', `Support tickets (${n(tickets, 'open')} open)`], ['hire', `Hire requests (${n(hire, 'new')} new)`], ['enquiries', `Enquiries (${n(enq, 'new')} new)`]]} value={tab} onChange={setTab}>
      {tab === 'tickets' && <Table rows={tickets.data?.items} onRow={setOpen} empty="No tickets." cols={[
        { key: 'created_at', label: 'Received', nowrap: true, render: (t) => dateTime(t.created_at) },
        { key: 'category', label: 'Type', render: (t) => <Chip tone={t.category === 'safety' || t.category === 'assistance_animal_refused' ? 'red' : ''}>{CAT[t.category] ?? t.category}</Chip> },
        { key: 'subject', label: 'Subject', render: (t) => <strong>{t.subject}</strong> }, { key: 'user_name', label: 'From' }, { key: 'trip_ref', label: 'Trip' },
        { key: 'status', label: 'Status', render: (t) => <Chip tone={t.status === 'open' ? 'ochre' : t.status === 'resolved' ? 'green' : ''}>{label(TICKET_STATUS, t.status)}</Chip> },
      ]} />}
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
      {open && <Ticket t={open} onClose={() => { setOpen(null); void tickets.reload(); refreshCounts(); }} />}
      {quoting && <HireQuote h={quoting} onClose={() => { setQuoting(null); void hire.reload(); }} onManual={async () => {
        const q = await ask({ title: 'Quote for hire request', label: 'Quote amount in dollars (incl. GST)', inputMode: 'decimal', initial: quoting.quote_cents ? (quoting.quote_cents / 100).toFixed(2) : '', ok: 'Save quote' });
        if (q && Number(q) > 0) { await run(() => patch(`/admin/hire-requests/${quoting.id}`, { status: 'quoted', quote_cents: Math.round(Number(q) * 100) }), 'Quote saved'); setQuoting(null); void hire.reload(); }
      }} />}
      </Tabs>
    </Page>
  );
}

function Ticket({ t, onClose }: { t: any; onClose: () => void }) {
  const [reply, setReply] = useState(t.resolution ?? '');
  const run = useRun();
  const save = async (status: string) => { if (await run(() => patch(`/admin/support/${t.id}`, { status, resolution: reply || undefined }), status === 'resolved' ? 'Ticket resolved and reply sent' : 'Reply sent')) onClose(); };
  return (
    <Drawer title={t.subject} onClose={onClose}>
      <dl className="kv"><dt>From</dt><dd>{t.user_name} {t.user_phone && <a href={`tel:${t.user_phone}`}>{t.user_phone}</a>}</dd><dt>Type</dt><dd>{CAT[t.category]}</dd>
        <dt>Trip</dt><dd>{t.trip_ref ?? '—'}</dd><dt>Received</dt><dd>{dateTime(t.created_at)}</dd><dt>Status</dt><dd>{label(TICKET_STATUS, t.status)}</dd></dl>
      <p style={{ whiteSpace: 'pre-wrap', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: 14 }}>{t.message}</p>
      <label className="dg-field"><span>Reply (sent to the customer as an app notification)</span><textarea className="dg-textarea" value={reply} onChange={(e) => setReply(e.target.value)} /></label>
      <div className="actions"><button className="dg-btn dg-btn--dark" onClick={() => save('pending')} disabled={!reply}>Send reply</button><button className="dg-btn dg-btn--green" onClick={() => save('resolved')}>Resolve</button></div>
    </Drawer>
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
