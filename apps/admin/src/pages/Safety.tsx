import { useState } from 'react';
import { get, patch, post, apiBase, date, dateTime, ago, assetUrl, useLoad } from '@dingogo/shared';
import { Page, useOps } from '../ctx';
import { Chip, ErrorMsg, Section, Table, Tabs, useRun } from '../ui';
import { DOC_TYPE, FLAG_KIND, FLAG_STATUS, ROLE, SOS_STATUS, label } from '../labels';


export default function Safety() {
  const [tab, setTab] = useState<'sos' | 'flags' | 'expiring' | 'docs'>('sos');
  const sos = useLoad(() => get('/admin/sos'));
  const comp = useLoad(() => get('/admin/compliance'));
  const { refreshCounts } = useOps();
  const run = useRun();
  const openSos = sos.data?.items.filter((s: any) => s.status !== 'resolved') ?? [];
  const reloadAll = () => { void sos.reload(); void comp.reload(); refreshCounts(); };

  async function sosUpdate(id: string, status: 'acknowledged' | 'resolved') {
    const notes = status === 'resolved' ? prompt('What happened and what was done? (kept in the safety log)') : undefined;
    if (status === 'resolved' && !notes) return;
    await run(() => patch(`/admin/sos/${id}`, { status, notes: notes ?? undefined }), status === 'resolved' ? 'Alert resolved' : 'Alert acknowledged');
    reloadAll();
  }

  return (
    <Page title="Safety & compliance">
      <Tabs tabs={[['sos', `Emergency alerts (${openSos.length} open)`], ['flags', `Compliance flags (${comp.data?.flags.filter((f: any) => f.status === 'open').length ?? 0})`], ['expiring', 'Expiring credentials'], ['docs', `Documents to review (${comp.data?.pending_documents.length ?? 0})`]]} value={tab} onChange={setTab} />
      {tab === 'sos' && (<>
        {openSos.map((s: any) => (
          <div key={s.id} className="panel" style={{ borderColor: 'var(--earth)', borderWidth: 2, marginBottom: 12 }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0, color: 'var(--earth)' }}>{s.user_name} ({label(ROLE, s.role).toLowerCase()}) raised an alert {ago(s.created_at)}</h3>
              <Chip tone={s.status === 'open' ? 'red' : 'ochre'}>{label(SOS_STATUS, s.status)}</Chip>
            </div>
            <p style={{ margin: '6px 0' }}>{s.message ?? 'No message.'} {s.trip_ref && <>Trip {s.trip_ref}.</>} Call them: <a href={`tel:${s.user_phone}`}><strong>{s.user_phone}</strong></a>. If anyone is in danger call 000.</p>
            {s.lat != null && <p className="dg-muted" style={{ margin: '4px 0' }}>Location {s.lat.toFixed(5)}, {s.lng.toFixed(5)}</p>}
            {s.share_token && <p style={{ margin: '4px 0' }}><a href={`${apiBase()}/public/track/${s.share_token}`} target="_blank" rel="noreferrer">Live trip data</a></p>}
            <div className="actions">
              {s.status === 'open' && <button className="dg-btn dg-btn--sm dg-btn--danger" onClick={() => sosUpdate(s.id, 'acknowledged')}>Acknowledge</button>}
              <button className="dg-btn dg-btn--sm dg-btn--dark" onClick={() => sosUpdate(s.id, 'resolved')}>Resolve</button>
            </div>
          </div>
        ))}
        {!openSos.length && <p className="dg-note" style={{ background: 'var(--saltbush-soft)' }}>No open emergency alerts.</p>}
        <Section title="Alert history" />
        <Table rows={sos.data?.items.filter((s: any) => s.status === 'resolved')} empty="No resolved alerts." cols={[
          { key: 'created_at', label: 'When', render: (s) => dateTime(s.created_at) }, { key: 'user_name', label: 'Raised by', render: (s) => <>{s.user_name}<span className="sub">{label(ROLE, s.role)}</span></> },
          { key: 'trip_ref', label: 'Trip' }, { key: 'notes', label: 'Outcome' }, { key: 'resolved_at', label: 'Resolved', render: (s) => dateTime(s.resolved_at) },
        ]} />
      </>)}
      {tab === 'flags' && (<>
        <p className="dg-muted" style={{ marginTop: 0, maxWidth: 780 }}>Refusing an assistance animal is unlawful under the Disability Discrimination Act. Review each flag with the driver; repeated refusals should lead to suspension.</p>
        <ErrorMsg error={comp.error} />
        <Table rows={comp.data?.flags} empty="No flags." cols={[
          { key: 'created_at', label: 'When', nowrap: true, render: (f) => dateTime(f.created_at) },
          { key: 'kind', label: 'Type', render: (f) => <Chip tone={f.kind === 'assistance_animal_refusal' ? 'red' : 'ochre'}>{label(FLAG_KIND, f.kind)}</Chip> },
          { key: 'driver_name', label: 'Driver' }, { key: 'trip_ref', label: 'Trip' }, { key: 'detail', label: 'Detail' },
          { key: 'status', label: 'Status', render: (f) => (
            <select className="dg-select" style={{ minHeight: 34, padding: '2px 6px' }} value={f.status} aria-label="Flag status"
              onChange={async (e) => { await run(() => patch(`/admin/compliance/${f.id}`, { status: e.target.value }), 'Flag updated'); reloadAll(); }}>
              {['open', 'reviewed', 'actioned', 'dismissed'].map((s) => <option key={s} value={s}>{label(FLAG_STATUS, s)}</option>)}
            </select>) },
        ]} />
      </>)}
      {tab === 'expiring' && (<>
        <Section title="Drivers with credentials expiring within 30 days" />
        <Table rows={comp.data?.expiring_drivers} rowKey={(d) => d.user_id} empty="All driver credentials are current for the next 30 days." cols={[
          { key: 'name', label: 'Driver' }, { key: 'licence_expiry', label: 'Licence', render: (d) => date(d.licence_expiry) }, { key: 'h_endorsement_expiry', label: 'H endorsement', render: (d) => (d.h_endorsement_expiry ? date(d.h_endorsement_expiry) : 'Missing') },
        ]} />
        <Section title="Vehicles with registration, CVL or insurance expiring within 30 days" />
        <Table rows={comp.data?.expiring_vehicles} empty="All vehicle papers are current for the next 30 days." cols={[
          { key: 'rego', label: 'Vehicle' }, { key: 'rego_expiry', label: 'Rego', render: (v) => date(v.rego_expiry) }, { key: 'cvl_expiry', label: 'CVL', render: (v) => (v.cvl_expiry ? date(v.cvl_expiry) : 'Missing') },
          { key: 'insurance_expiry', label: 'Insurance', render: (v) => date(v.insurance_expiry) }, { key: 'inspection_expiry', label: 'Inspection', render: (v) => date(v.inspection_expiry) },
        ]} />
      </>)}
      {tab === 'docs' && (
        <Table rows={comp.data?.pending_documents} empty="Nothing waiting for review." cols={[
          { key: 'created_at', label: 'Uploaded', render: (d) => dateTime(d.created_at) }, { key: 'driver_name', label: 'Driver' }, { key: 'type', label: 'Document', render: (d) => label(DOC_TYPE, d.type) },
          { key: 'number', label: 'Number' }, { key: 'expires_at', label: 'Expires', render: (d) => date(d.expires_at) },
          { key: 'file', label: 'File', render: (d) => (d.file_url ? <a href={assetUrl(d.file_url)} target="_blank" rel="noreferrer">View</a> : '—') },
          { key: 'x', label: '', render: (d) => <>
            <button className="dg-btn dg-btn--sm dg-btn--green" onClick={async () => { await run(() => post(`/admin/documents/${d.id}/review`, { status: 'approved' }), 'Approved'); reloadAll(); }}>Approve</button>{' '}
            <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={async () => { const note = prompt('Reason for rejecting (sent to the driver):'); if (note) { await run(() => post(`/admin/documents/${d.id}/review`, { status: 'rejected', note }), 'Rejected'); reloadAll(); } }}>Reject</button>
          </> },
        ]} />
      )}
    </Page>
  );
}
