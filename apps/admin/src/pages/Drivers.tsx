import { useEffect, useState } from 'react';
import { get, patch, post, money, date, dateTime, assetUrl, useLoad } from '@dingogo/shared';
import { Page } from '../ctx';
import { Chip, Drawer, ErrorMsg, Table, Tabs, useRun, type Col } from '../ui';

const STATUS_TONE: Record<string, string> = { approved: 'green', suspended: 'red', rejected: 'red', applied: 'ochre', pending_documents: 'ochre' };
const STATUS_TEXT: Record<string, string> = { approved: 'Approved', suspended: 'Suspended', rejected: 'Rejected', applied: 'Applied', pending_documents: 'Documents pending' };

export default function Drivers() {
  const [tab, setTab] = useState<'drivers' | 'applications'>('drivers');
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, reload } = useLoad(() => get('/admin/drivers'));
  const apps = useLoad(() => get('/admin/applications'));
  const run = useRun();

  const cols: Col<any>[] = [
    { key: 'name', label: 'Driver', render: (d) => <><strong>{d.name || 'No name'}</strong><br /><span className="dg-muted" style={{ fontSize: '.82rem' }}>{d.phone}</span></> },
    { key: 'status', label: 'Status', render: (d) => <Chip tone={STATUS_TONE[d.status]}>{STATUS_TEXT[d.status]}</Chip> },
    { key: 'online', label: 'Online', render: (d) => (d.online ? <Chip tone="green">Online</Chip> : <span className="dg-muted">Offline</span>) },
    { key: 'rego', label: 'Vehicle', render: (d) => d.rego ? `${d.rego} (${d.battery_pct ?? '?'}%)` : <span className="dg-muted">None</span> },
    { key: 'trips', label: 'Trips', num: true },
    { key: 'rating_avg', label: 'Rating', num: true, render: (d) => d.rating_avg ?? '—' },
    { key: 'balance_cents', label: 'Balance owed', num: true, render: (d) => money(d.balance_cents) },
    { key: 'compliance', label: 'Can drive?', render: (d) => d.compliance_issues.length ? <span style={{ color: 'var(--earth)', fontSize: '.85rem' }}>{d.compliance_issues[0]}{d.compliance_issues.length > 1 && ` (+${d.compliance_issues.length - 1} more)`}</span> : <Chip tone="green">All current</Chip> },
    { key: 'pending_docs', label: 'Docs to review', num: true, render: (d) => d.pending_docs ? <strong style={{ color: 'var(--ochre-deep)' }}>{d.pending_docs}</strong> : '0' },
  ];

  return (
    <Page title="Drivers">
      <Tabs tabs={[['drivers', `Drivers (${data?.drivers.length ?? '…'})`], ['applications', `Website applications (${apps.data?.items.filter((a: any) => a.status === 'new').length ?? 0} new)`]]} value={tab} onChange={setTab} />
      {tab === 'drivers' && (<><ErrorMsg error={error} /><Table rows={data?.drivers} cols={cols} onRow={(d) => setOpen(d.user_id)} rowKey={(d) => d.user_id} /></>)}
      {tab === 'applications' && (
        <Table rows={apps.data?.items} empty="No applications yet." cols={[
          { key: 'created_at', label: 'Received', nowrap: true, render: (a) => date(a.created_at) },
          { key: 'name', label: 'Name', render: (a) => <><strong>{a.name}</strong><br /><a href={`tel:${a.phone}`}>{a.phone}</a> <a href={`mailto:${a.email}`}>{a.email}</a></> },
          { key: 'suburb', label: 'Suburb' },
          { key: 'has_licence_years', label: 'Licence yrs', num: true },
          { key: 'has_cpv_authority', label: 'Has H endorsement', render: (a) => (a.has_cpv_authority ? 'Yes' : 'No') },
          { key: 'wants_lease', label: 'Wants lease', render: (a) => (a.wants_lease ? 'Yes' : 'No') },
          { key: 'languages', label: 'Languages' },
          { key: 'message', label: 'Message', render: (a) => <span style={{ fontSize: '.85rem' }}>{a.message}</span> },
          { key: 'status', label: 'Status', render: (a) => (
            <select className="dg-select" style={{ minHeight: 34, padding: '2px 6px' }} value={a.status} aria-label="Application status"
              onChange={async (e) => { await run(() => patch(`/admin/applications/${a.id}`, { status: e.target.value }), 'Updated'); void apps.reload(); }}>
              {['new', 'contacted', 'onboarding', 'declined'].map((s) => <option key={s}>{s}</option>)}
            </select>) },
        ]} />
      )}
      {open && <DriverDrawer id={open} onClose={() => { setOpen(null); void reload(); }} />}
    </Page>
  );
}

const DOC_NAME: Record<string, string> = { licence: 'Driver licence', h_endorsement: 'H endorsement', cpvid: 'CPV identity card', police_check: 'Police check', medical: 'Medical certificate', abn: 'ABN', gst: 'GST registration', insurance: 'Insurance', vehicle_cvl: 'Vehicle CVL', roadworthy: 'Roadworthy', first_aid: 'First aid', disability_awareness: 'Disability awareness training', wwcc: 'Working with children (Ochre card)' };

function DriverDrawer({ id, onClose }: { id: string; onClose: () => void }) {
  const { data, error, reload } = useLoad(() => get(`/admin/drivers/${id}`), [id]);
  const vehicles = useLoad(() => get('/admin/vehicles'));
  const run = useRun();
  const [form, setForm] = useState<any>(null);
  const d = data?.driver;
  useEffect(() => { if (d) setForm({
    status: d.status, vehicle_id: d.vehicle_id ?? '', commission_pct: d.commission_pct, licence_expiry: d.licence_expiry ?? '', h_endorsement_expiry: d.h_endorsement_expiry ?? '',
    police_check_date: d.police_check_date ?? '', medical_date: d.medical_date ?? '', da_training_date: d.da_training_date ?? '', gst_registered: d.gst_registered, accepts_pets: d.accepts_pets, female_driver: d.female_driver,
  }); }, [d]);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (form.status === 'suspended' && d.status !== 'suspended' && !confirm(`Suspend ${d.name}? They will be taken offline immediately.`)) return;
    const body: any = { ...form, commission_pct: Number(form.commission_pct), vehicle_id: form.vehicle_id || null };
    for (const k of ['licence_expiry', 'h_endorsement_expiry', 'police_check_date', 'medical_date', 'da_training_date']) if (!body[k]) delete body[k];
    await run(() => patch(`/admin/drivers/${id}`, body), 'Driver updated');
    void reload();
  }
  async function review(docId: string, status: 'approved' | 'rejected') {
    const note = status === 'rejected' ? prompt('Reason for rejecting (sent to the driver):') ?? undefined : undefined;
    if (status === 'rejected' && !note) return;
    await run(() => post(`/admin/documents/${docId}/review`, { status, note }), `Document ${status}`);
    void reload();
  }
  const set = (k: string, v: any) => setForm({ ...form, [k]: v });

  return (
    <Drawer title={d ? d.name || d.phone : 'Driver'} onClose={onClose}>
      <ErrorMsg error={error} />
      {d && (<>
        <dl className="kv">
          <dt>Phone</dt><dd><a href={`tel:${d.phone}`}>{d.phone}</a></dd><dt>Email</dt><dd>{d.email ?? '—'}</dd>
          <dt>Licence no.</dt><dd>{d.licence_no ?? '—'}</dd><dt>H endorsement no.</dt><dd>{d.cpv_authority_no ?? '—'}</dd>
          <dt>ABN</dt><dd>{d.abn ?? '—'}</dd><dt>Bank</dt><dd>{d.bank_bsb ? `${d.bank_bsb} ${d.bank_account}` : '—'}</dd>
          <dt>Languages</dt><dd>{d.languages?.join(', ')}</dd><dt>Rating</dt><dd>{d.rating_avg ?? '—'} ({d.rating_count} ratings)</dd>
        </dl>
        {data.compliance_issues.length > 0 ? (
          <div className="dg-error" style={{ marginTop: 14, fontWeight: 400 }}><strong>Cannot go online:</strong><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{data.compliance_issues.map((i: string) => <li key={i}>{i}</li>)}</ul></div>
        ) : <p className="dg-note" style={{ background: 'var(--saltbush-soft)' }}>All credentials current. This driver can go online.</p>}

        <h3 style={{ marginTop: 18 }}>Documents</h3>
        <table className="tbl"><tbody>
          {!data.documents.length && <tr><td className="empty">No documents uploaded.</td></tr>}
          {data.documents.map((x: any) => (
            <tr key={x.id}>
              <td><strong>{DOC_NAME[x.type] ?? x.type}</strong><br /><span className="dg-muted" style={{ fontSize: '.82rem' }}>{x.number ?? ''} {x.expires_at && `expires ${date(x.expires_at)}`} {x.file_url && <a href={assetUrl(x.file_url)} target="_blank" rel="noreferrer">View file</a>}</span>{x.note && <><br /><small>{x.note}</small></>}</td>
              <td><Chip tone={x.status === 'approved' ? 'green' : x.status === 'pending' ? 'ochre' : 'red'}>{x.status}</Chip></td>
              <td className="num">{x.status === 'pending' && <><button className="dg-btn dg-btn--sm dg-btn--green" onClick={() => review(x.id, 'approved')}>Approve</button> <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => review(x.id, 'rejected')}>Reject</button></>}</td>
            </tr>
          ))}
        </tbody></table>

        {form && (
          <form className="panel" style={{ marginTop: 18 }} onSubmit={save}>
            <h3>Status, vehicle and credentials</h3>
            <div className="form-grid">
              <label className="dg-field"><span>Status</span><select className="dg-select" value={form.status} onChange={(e) => set('status', e.target.value)}>{Object.entries(STATUS_TEXT).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
              <label className="dg-field"><span>Vehicle</span><select className="dg-select" value={form.vehicle_id} onChange={(e) => set('vehicle_id', e.target.value)}><option value="">None</option>{vehicles.data?.items.map((v: any) => <option key={v.id} value={v.id}>{v.rego} {v.colour}</option>)}</select></label>
              <label className="dg-field"><span>DingoGo service fee (%)</span><input className="dg-input" type="number" min={0} max={50} step={0.5} value={form.commission_pct} onChange={(e) => set('commission_pct', e.target.value)} /></label>
              <label className="dg-field"><span>Licence expiry</span><input className="dg-input" type="date" value={form.licence_expiry} onChange={(e) => set('licence_expiry', e.target.value)} /></label>
              <label className="dg-field"><span>H endorsement expiry</span><input className="dg-input" type="date" value={form.h_endorsement_expiry} onChange={(e) => set('h_endorsement_expiry', e.target.value)} /></label>
              <label className="dg-field"><span>Police check date</span><input className="dg-input" type="date" value={form.police_check_date} onChange={(e) => set('police_check_date', e.target.value)} /></label>
              <label className="dg-field"><span>Medical date</span><input className="dg-input" type="date" value={form.medical_date} onChange={(e) => set('medical_date', e.target.value)} /></label>
              <label className="dg-field"><span>Disability awareness training</span><input className="dg-input" type="date" value={form.da_training_date} onChange={(e) => set('da_training_date', e.target.value)} /></label>
              <label className="dg-check"><input type="checkbox" checked={form.gst_registered} onChange={(e) => set('gst_registered', e.target.checked)} /><span>Registered for GST</span></label>
              <label className="dg-check"><input type="checkbox" checked={form.accepts_pets} onChange={(e) => set('accepts_pets', e.target.checked)} /><span>Accepts pet-friendly trips</span></label>
              <label className="dg-check"><input type="checkbox" checked={form.female_driver} onChange={(e) => set('female_driver', e.target.checked)} /><span>Matched for female-driver requests</span></label>
            </div>
            <button className="dg-btn dg-btn--sm dg-btn--dark">Save driver</button>
          </form>
        )}

        {data.flags.length > 0 && (<>
          <h3 style={{ marginTop: 18 }}>Compliance flags</h3>
          <table className="tbl"><tbody>{data.flags.map((f: any) => <tr key={f.id}><td>{f.kind.replace(/_/g, ' ')}<br /><small className="dg-muted">{f.detail}</small></td><td>{f.status}</td><td className="num">{date(f.created_at)}</td></tr>)}</tbody></table>
        </>)}
        <h3 style={{ marginTop: 18 }}>Earnings ledger</h3>
        <table className="tbl"><tbody>
          {data.ledger.map((l: any) => <tr key={l.id}><td className="nowrap">{dateTime(l.created_at)}</td><td>{l.kind.replace(/_/g, ' ')}<br /><small className="dg-muted">{l.note}</small></td><td className="num">{money(l.amount_cents)}</td></tr>)}
        </tbody></table>
      </>)}
    </Drawer>
  );
}
