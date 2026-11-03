import { useState } from 'react';
import { get, patch, money, date, dateTime, useLoad } from '@dingogo/shared';
import { Page, useOps } from '../ctx';
import { Chip, Drawer, Table, Tabs, useRun } from '../ui';

const CAT: Record<string, string> = { lost_item: 'Lost item', fare: 'Fare', safety: 'Safety', driver: 'Driver', parcel: 'Parcel', accessibility: 'Accessibility', app: 'App', other: 'Other' };

export default function Support() {
  const [tab, setTab] = useState<'tickets' | 'hire' | 'enquiries'>('tickets');
  const tickets = useLoad(() => get('/admin/support'));
  const hire = useLoad(() => get('/admin/hire-requests'));
  const enq = useLoad(() => get('/admin/enquiries'));
  const [open, setOpen] = useState<any>(null);
  const { refreshCounts } = useOps();
  const run = useRun();
  const n = (d: any, s: string) => d.data?.items.filter((x: any) => x.status === s).length ?? 0;
  return (
    <Page title="Support & inbox">
      <Tabs tabs={[['tickets', `Support tickets (${n(tickets, 'open')} open)`], ['hire', `Hire requests (${n(hire, 'new')} new)`], ['enquiries', `Enquiries (${n(enq, 'new')} new)`]]} value={tab} onChange={setTab} />
      {tab === 'tickets' && <Table rows={tickets.data?.items} onRow={setOpen} empty="No tickets." cols={[
        { key: 'created_at', label: 'Received', nowrap: true, render: (t) => dateTime(t.created_at) },
        { key: 'category', label: 'Type', render: (t) => <Chip tone={t.category === 'safety' ? 'red' : ''}>{CAT[t.category] ?? t.category}</Chip> },
        { key: 'subject', label: 'Subject', render: (t) => <strong>{t.subject}</strong> }, { key: 'user_name', label: 'From' }, { key: 'trip_ref', label: 'Trip' },
        { key: 'status', label: 'Status', render: (t) => <Chip tone={t.status === 'open' ? 'ochre' : t.status === 'resolved' ? 'green' : ''}>{t.status}</Chip> },
      ]} />}
      {tab === 'hire' && <Table rows={hire.data?.items} empty="No hire requests." cols={[
        { key: 'created_at', label: 'Received', render: (h) => date(h.created_at) }, { key: 'kind', label: 'Type' },
        { key: 'contact_name', label: 'Contact', render: (h) => <><strong>{h.contact_name}</strong>{h.organisation && `, ${h.organisation}`}<br /><a href={`mailto:${h.contact_email}`}>{h.contact_email}</a> {h.contact_phone}</> },
        { key: 'event_date', label: 'Date', render: (h) => date(h.event_date) }, { key: 'passengers', label: 'People', num: true }, { key: 'vehicles', label: 'Cars', num: true },
        { key: 'details', label: 'Details', render: (h) => <span style={{ fontSize: '.85rem' }}>{h.details}</span> },
        { key: 'quote', label: 'Quote', num: true, render: (h) => (h.quote_cents ? money(h.quote_cents) : '—') },
        { key: 'status', label: 'Status', render: (h) => (
          <span style={{ display: 'flex', gap: 6 }}>
            <select className="dg-select" style={{ minHeight: 34, padding: '2px 6px' }} value={h.status} aria-label="Status"
              onChange={async (e) => { await run(() => patch(`/admin/hire-requests/${h.id}`, { status: e.target.value }), 'Updated'); void hire.reload(); refreshCounts(); }}>
              {['new', 'quoted', 'confirmed', 'declined'].map((s) => <option key={s}>{s}</option>)}
            </select>
            <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={async () => { const q = prompt('Quote amount in dollars (incl. GST):'); if (q) { await run(() => patch(`/admin/hire-requests/${h.id}`, { status: 'quoted', quote_cents: Math.round(Number(q) * 100) }), 'Quote saved'); void hire.reload(); } }}>Quote</button>
          </span>) },
      ]} />}
      {tab === 'enquiries' && <Table rows={enq.data?.items} empty="No enquiries." cols={[
        { key: 'created_at', label: 'Received', render: (e) => date(e.created_at) }, { key: 'kind', label: 'About' },
        { key: 'name', label: 'From', render: (e) => <><strong>{e.name}</strong>{e.organisation && `, ${e.organisation}`}<br /><a href={`mailto:${e.email}`}>{e.email}</a> {e.phone}</> },
        { key: 'message', label: 'Message', render: (e) => <span style={{ fontSize: '.85rem' }}>{e.message}</span> },
        { key: 'status', label: 'Status', render: (e) => (
          <select className="dg-select" style={{ minHeight: 34, padding: '2px 6px' }} value={e.status} aria-label="Status"
            onChange={async (ev) => { await run(() => patch(`/admin/enquiries/${e.id}`, { status: ev.target.value }), 'Updated'); void enq.reload(); }}>
            {['new', 'replied', 'closed'].map((s) => <option key={s}>{s}</option>)}
          </select>) },
      ]} />}
      {open && <Ticket t={open} onClose={() => { setOpen(null); void tickets.reload(); refreshCounts(); }} />}
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
        <dt>Trip</dt><dd>{t.trip_ref ?? '—'}</dd><dt>Received</dt><dd>{dateTime(t.created_at)}</dd><dt>Status</dt><dd>{t.status}</dd></dl>
      <p style={{ whiteSpace: 'pre-wrap', background: 'var(--surface)', border: '1px solid var(--line)', borderRadius: 12, padding: 14 }}>{t.message}</p>
      <label className="dg-field"><span>Reply (sent to the customer as an app notification)</span><textarea className="dg-textarea" value={reply} onChange={(e) => setReply(e.target.value)} /></label>
      <div className="actions"><button className="dg-btn dg-btn--dark" onClick={() => save('pending')} disabled={!reply}>Send reply</button><button className="dg-btn dg-btn--green" onClick={() => save('resolved')}>Resolve</button></div>
    </Drawer>
  );
}
