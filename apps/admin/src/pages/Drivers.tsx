import { useEffect, useState } from 'react';
import { get, patch, post, money, date, dateTime, assetUrl, useLoad } from '@dingogo/shared';
import { Page } from '../ctx';
import { Chip, Drawer, ErrorMsg, Table, Tabs, useRun, type Col } from '../ui';
import { APPLICATION_STATUS, DOC_STATUS, DOC_TYPE, DRIVER_STATUS, DRIVER_STATUS_TONE, FLAG_KIND, FLAG_STATUS, LEDGER_KIND, complianceText, docTone, label } from '../labels';


export default function Drivers() {
  const [tab, setTab] = useState<'drivers' | 'applications'>('drivers');
  const [open, setOpen] = useState<string | null>(null);
  const { data, error, reload } = useLoad(() => get('/admin/drivers'));
  const apps = useLoad(() => get('/admin/applications'));
  const run = useRun();

  const cols: Col<any>[] = [
    { key: 'name', label: 'Driver', nowrap: true, render: (d) => <><strong>{d.name || 'No name'}</strong><span className="sub">{d.phone}</span></> },
    { key: 'status', label: 'Status', render: (d) => <Chip tone={DRIVER_STATUS_TONE[d.status]}>{label(DRIVER_STATUS, d.status)}</Chip> },
    { key: 'compliance', label: 'Can drive?', render: (d) => d.compliance_issues.length
      ? <span className="issue" title={d.compliance_issues.map(complianceText).join('\n')}><Chip tone="red">Not yet</Chip><span className="sub">{complianceText(d.compliance_issues[0])}{d.compliance_issues.length > 1 && `, and ${d.compliance_issues.length - 1} more`}</span></span>
      : <Chip tone="green">Yes, all current</Chip> },
    { key: 'online', label: 'Online', render: (d) => (d.online ? <Chip tone="green">Online</Chip> : <span className="dg-muted">Offline</span>) },
    { key: 'rego', label: 'Vehicle', nowrap: true, render: (d) => d.rego ? <>{d.rego}<span className="sub">{d.battery_pct != null ? `${d.battery_pct}% charge` : 'Charge unknown'}</span></> : <span className="dg-muted">None assigned</span> },
    { key: 'trips', label: 'Trips', num: true },
    { key: 'rating_avg', label: 'Rating', num: true, render: (d) => d.rating_avg != null ? Number(d.rating_avg).toFixed(1) : <span className="dg-muted">—</span> },
    { key: 'balance_cents', label: 'Balance', num: true, render: (d) => money(d.balance_cents) },
    { key: 'pending_docs', label: 'To review', num: true, render: (d) => d.pending_docs ? <span className="count count--ochre">{d.pending_docs}</span> : <span className="dg-muted">0</span> },
  ];

  return (
    <Page title="Drivers">
      <Tabs tabs={[['drivers', `Drivers (${data?.drivers.length ?? '…'})`], ['applications', `Website applications (${apps.data?.items.filter((a: any) => a.status === 'new').length ?? 0} new)`]]} value={tab} onChange={setTab} />
      {tab === 'drivers' && (<><ErrorMsg error={error} /><Table rows={data?.drivers} cols={cols} empty="No drivers yet. Applicants appear here when they sign in to the driver app." onRow={(d) => setOpen(d.user_id)} rowKey={(d) => d.user_id} /></>)}
      {tab === 'applications' && (
        <Table rows={apps.data?.items} empty="No applications yet. They arrive from the Drive with us form on the website." cols={[
          { key: 'created_at', label: 'Received', nowrap: true, render: (a) => date(a.created_at) },
          { key: 'name', label: 'Name', render: (a) => <><strong>{a.name}</strong><span className="sub"><a href={`tel:${a.phone}`}>{a.phone}</a>{a.email && <>, <a href={`mailto:${a.email}`}>{a.email}</a></>}</span></> },
          { key: 'suburb', label: 'Suburb' },
          { key: 'has_licence_years', label: 'Licence yrs', num: true },
          { key: 'has_cpv_authority', label: 'Has H endorsement', render: (a) => (a.has_cpv_authority ? 'Yes' : 'No') },
          { key: 'wants_lease', label: 'Wants lease', render: (a) => (a.wants_lease ? 'Yes' : 'No') },
          { key: 'languages', label: 'Languages' },
          { key: 'message', label: 'Message', truncate: 260 },
          { key: 'status', label: 'Status', render: (a) => (
            <select className="dg-select" style={{ minHeight: 34, padding: '2px 6px' }} value={a.status} aria-label="Application status"
              onChange={async (e) => { await run(() => patch(`/admin/applications/${a.id}`, { status: e.target.value }), 'Updated'); void apps.reload(); }}>
              {Object.entries(APPLICATION_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>) },
        ]} />
      )}
      {open && <DriverDrawer id={open} onClose={() => { setOpen(null); void reload(); }} />}
    </Page>
  );
}


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
          <dt>Languages</dt><dd>{d.languages?.length ? d.languages.map((l: string) => label({ en: 'English' }, l)).join(', ') : '—'}</dd><dt>Rating</dt><dd>{d.rating_count ? `${Number(d.rating_avg).toFixed(1)} from ${d.rating_count} ${d.rating_count === 1 ? 'rating' : 'ratings'}` : 'No ratings yet'}</dd>
        </dl>
        {data.compliance_issues.length > 0 ? (
          <div className="dg-error" style={{ marginTop: 14, fontWeight: 400 }}><strong>Cannot go online:</strong><ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>{data.compliance_issues.map((i: string) => <li key={i}>{complianceText(i)}</li>)}</ul></div>
        ) : <p className="dg-note" style={{ background: 'var(--saltbush-soft)' }}>All credentials current. This driver can go online.</p>}

        <h3 style={{ marginTop: 18 }}>Documents</h3>
        <table className="tbl"><tbody>
          {!data.documents.length && <tr><td className="empty">No documents uploaded.</td></tr>}
          {data.documents.map((x: any) => (
            <tr key={x.id}>
              <td><strong>{label(DOC_TYPE, x.type)}</strong><span className="sub">{[x.number, x.expires_at && `expires ${date(x.expires_at)}`].filter(Boolean).join(', ')}{x.file_url && <> <a href={assetUrl(x.file_url)} target="_blank" rel="noreferrer">View file</a></>}</span>{x.note && <span className="sub">{x.note}</span>}</td>
              <td><Chip tone={docTone(x.status)}>{label(DOC_STATUS, x.status)}</Chip></td>
              <td className="num">{x.status === 'pending' && <><button className="dg-btn dg-btn--sm dg-btn--green" onClick={() => review(x.id, 'approved')}>Approve</button> <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => review(x.id, 'rejected')}>Reject</button></>}</td>
            </tr>
          ))}
        </tbody></table>

        {form && (
          <form className="panel" style={{ marginTop: 18 }} onSubmit={save}>
            <h3>Status, vehicle and credentials</h3>
            <div className="form-grid">
              <label className="dg-field"><span>Status</span><select className="dg-select" value={form.status} onChange={(e) => set('status', e.target.value)}>{Object.entries(DRIVER_STATUS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
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
          <table className="tbl"><tbody>{data.flags.map((f: any) => <tr key={f.id}><td>{label(FLAG_KIND, f.kind)}<span className="sub">{f.detail}</span></td><td>{label(FLAG_STATUS, f.status)}</td><td className="num">{date(f.created_at)}</td></tr>)}</tbody></table>
        </>)}
        <h3 style={{ marginTop: 18 }}>Earnings ledger</h3>
        <table className="tbl"><tbody>
          {!data.ledger.length && <tr><td className="empty">No earnings yet.</td></tr>}
          {data.ledger.map((l: any) => <tr key={l.id}><td className="nowrap">{dateTime(l.created_at)}</td><td>{label(LEDGER_KIND, l.kind)}{l.note && <span className="sub">{l.note}</span>}</td><td className="num">{money(l.amount_cents)}</td></tr>)}
        </tbody></table>
      </>)}
    </Drawer>
  );
}
