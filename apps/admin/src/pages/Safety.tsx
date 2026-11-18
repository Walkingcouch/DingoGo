import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { get, patch, post, apiBase, date, dateTime, time, ago, FileLink, useLoad, Icon, STATUS_LABEL } from '@dingogo/shared';
import { DgMap, type MapMarker } from '@dingogo/shared/map';
import { Page, useOps } from '../ctx';
import { Chip, Drawer, ErrorMsg, Section, Table, Tabs, useAsk, useRun, useToast } from '../ui';
import { DOC_TYPE, FLAG_KIND, FLAG_STATUS, ROLE, SOS_STATUS, label } from '../labels';

const TL_KIND: Record<string, string> = { raised: 'Alert', acknowledged: 'Acknowledged', step: 'Runbook', note: 'Note', resolved: 'Resolved', trip: 'Trip' };

export default function Safety() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as 'sos' | 'flags' | 'expiring' | 'docs') || 'sos';
  const incident = params.get('sos');
  const setParam = (k: string, v: string | null) => setParams((p) => { const n = new URLSearchParams(p); if (v) n.set(k, v); else n.delete(k); return n; });
  const sos = useLoad(() => get('/admin/sos'));
  const comp = useLoad(() => get('/admin/compliance'));
  const { refreshCounts } = useOps();
  const run = useRun();
  const ask = useAsk();
  const toast = useToast();
  const openSos = sos.data?.items.filter((s: any) => s.status !== 'resolved') ?? [];
  const reloadAll = () => { void sos.reload(); void comp.reload(); refreshCounts(); };
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const pending: any[] = comp.data?.pending_documents ?? [];
  const toggle = (id: string) => setPicked((p) => { const n = new Set(p); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function sosUpdate(id: string, status: 'acknowledged' | 'resolved') {
    let notes: string | null | undefined;
    if (status === 'resolved') {
      notes = await ask({ title: 'Resolve emergency alert', label: 'What happened and what was done?', help: 'Kept in the safety log with the incident timeline.', multiline: true, ok: 'Resolve alert' });
      if (!notes) return;
    }
    await run(() => patch(`/admin/sos/${id}`, { status, notes: notes ?? undefined }), status === 'resolved' ? 'Alert resolved' : 'Alert acknowledged');
    reloadAll();
  }

  async function reviewMany(ids: string[], status: 'approved' | 'rejected') {
    if (!ids.length) return;
    let note: string | undefined;
    if (status === 'rejected') {
      const r = await ask({ title: ids.length === 1 ? 'Reject document' : `Reject ${ids.length} documents`, label: 'Reason (sent to the driver)', multiline: true, ok: 'Reject', danger: true });
      if (!r) return;
      note = r;
    }
    const r = await run(() => post('/admin/documents/review', { ids, status, note }));
    if (r) {
      const n = r.reviewed.length; const skipped = r.skipped.length;
      toast(`${n} ${n === 1 ? 'document' : 'documents'} ${status}${skipped ? `. ${skipped} already reviewed by someone else` : ''}`);
    }
    setPicked(new Set());
    reloadAll();
  }

  return (
    <Page title="Safety & compliance">
      <Tabs label="Safety sections" tabs={[['sos', `Emergency alerts (${openSos.length} open)`], ['flags', `Compliance flags (${comp.data?.flags.filter((f: any) => f.status === 'open').length ?? 0})`], ['expiring', 'Expiring credentials'], ['docs', `Documents to review (${pending.length})`]]}
        value={tab} onChange={(t) => setParam('tab', t === 'sos' ? null : t)}>
      {tab === 'sos' && (<>
        {openSos.map((s: any) => (
          <section key={s.id} className="panel sos-card" aria-labelledby={`sos-${s.id}`}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <h3 id={`sos-${s.id}`} style={{ margin: 0, color: 'var(--earth-ink)' }}>{s.user_name} ({label(ROLE, s.role).toLowerCase()}) raised an alert {ago(s.created_at)}</h3>
              <Chip tone={s.status === 'open' ? 'red' : 'ochre'}>{label(SOS_STATUS, s.status)}</Chip>
            </div>
            <p style={{ margin: '6px 0' }}>{s.message ?? 'No message.'} {s.trip_ref && <>Trip {s.trip_ref}.</>} Call them: <a href={`tel:${s.user_phone}`}><strong>{s.user_phone}</strong></a>. If anyone is in danger call 000.</p>
            {s.lat != null && <p className="dg-muted" style={{ margin: '4px 0' }}>Location {s.lat.toFixed(5)}, {s.lng.toFixed(5)}</p>}
            <div className="actions">
              <button className="dg-btn dg-btn--sm dg-btn--danger" onClick={() => setParam('sos', s.id)}><Icon name="list" size={16} /> Open incident and runbook</button>
              {s.status === 'open' && <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => sosUpdate(s.id, 'acknowledged')}>Acknowledge</button>}
              <button className="dg-btn dg-btn--sm dg-btn--dark" onClick={() => sosUpdate(s.id, 'resolved')}>Resolve</button>
            </div>
          </section>
        ))}
        {!openSos.length && <p className="dg-note" style={{ background: 'var(--saltbush-soft)' }}>No open emergency alerts.</p>}
        <Section title="Alert history" />
        <Table rows={sos.data?.items.filter((s: any) => s.status === 'resolved')} onRow={(s) => setParam('sos', s.id)} empty="No resolved alerts." cols={[
          { key: 'created_at', label: 'When', render: (s) => dateTime(s.created_at) }, { key: 'user_name', label: 'Raised by', render: (s) => <>{s.user_name}<span className="sub">{label(ROLE, s.role)}</span></> },
          { key: 'trip_ref', label: 'Trip' }, { key: 'notes', label: 'Outcome', truncate: 320 }, { key: 'resolved_at', label: 'Resolved', render: (s) => dateTime(s.resolved_at) },
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
            <select className="dg-select" style={{ minHeight: 34, padding: '2px 6px' }} value={f.status} aria-label={`Status of ${label(FLAG_KIND, f.kind).toLowerCase()} flag${f.driver_name ? ` for ${f.driver_name}` : ''}`}
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
      {tab === 'docs' && (<>
        <div className="bulkbar" role="group" aria-label="Review selected documents">
          <label className="dg-check"><input type="checkbox" checked={pending.length > 0 && picked.size === pending.length} disabled={!pending.length}
            onChange={(e) => setPicked(e.target.checked ? new Set(pending.map((d) => d.id)) : new Set())} /><span>Select all ({pending.length})</span></label>
          <span className="dg-muted" aria-live="polite">{picked.size} selected</span>
          <button className="dg-btn dg-btn--sm dg-btn--green" disabled={!picked.size} onClick={() => reviewMany([...picked], 'approved')}>Approve selected</button>
          <button className="dg-btn dg-btn--sm dg-btn--ghost" disabled={!picked.size} onClick={() => reviewMany([...picked], 'rejected')}>Reject selected</button>
        </div>
        <Table rows={pending} empty="Nothing waiting for review." cols={[
          { key: 'pick', label: 'Select', render: (d) => <input type="checkbox" className="pick" checked={picked.has(d.id)} onChange={() => toggle(d.id)}
            aria-label={`Select ${label(DOC_TYPE, d.type)} for ${d.driver_name}`} /> },
          { key: 'created_at', label: 'Uploaded', render: (d) => dateTime(d.created_at) }, { key: 'driver_name', label: 'Driver' }, { key: 'type', label: 'Document', render: (d) => label(DOC_TYPE, d.type) },
          { key: 'number', label: 'Number' }, { key: 'expires_at', label: 'Expires', render: (d) => date(d.expires_at) },
          { key: 'file', label: 'File', render: (d) => (d.file_url ? <FileLink href={d.file_url}>View<span className="sr-only"> {label(DOC_TYPE, d.type)} for {d.driver_name}</span></FileLink> : '—') },
          { key: 'x', label: 'Decision', render: (d) => <>
            <button className="dg-btn dg-btn--sm dg-btn--green" onClick={() => reviewMany([d.id], 'approved')}>Approve<span className="sr-only"> {label(DOC_TYPE, d.type)} for {d.driver_name}</span></button>{' '}
            <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => reviewMany([d.id], 'rejected')}>Reject<span className="sr-only"> {label(DOC_TYPE, d.type)} for {d.driver_name}</span></button>
          </> },
        ]} />
      </>)}
      </Tabs>
      {incident && <Incident id={incident} onClose={() => { setParam('sos', null); reloadAll(); }} onResolve={(id) => sosUpdate(id, 'resolved')} />}
    </Page>
  );
}

/** Incident view: runbook checklist, people and trip, map, timeline, notes. */
function Incident({ id, onClose, onResolve }: { id: string; onClose: () => void; onResolve: (id: string) => Promise<void> }) {
  const { data, error, reload, setData } = useLoad<any>(() => get(`/admin/sos/${id}`), [id]);
  const run = useRun();
  const [note, setNote] = useState('');
  const a = data?.alert; const t = data?.trip;
  async function add(body: { text?: string; step?: string }, ok: string) {
    const r = await run(() => post(`/admin/sos/${id}/notes`, body), ok);
    if (r) setData(r);
  }
  const markers: MapMarker[] = [];
  if (a?.lat != null) markers.push({ id: 'sos', kind: 'sos', lat: a.lat, lng: a.lng, label: 'Where the alert was raised' });
  if (t?.driver_lat != null) markers.push({ id: 'car', kind: 'car', lat: t.driver_lat, lng: t.driver_lng, label: `Driver's last position${t.driver_last_seen_at ? `, ${ago(t.driver_last_seen_at)}` : ''}` });
  const done = data?.runbook.filter((s: any) => s.done_at).length ?? 0;
  return (
    <Drawer title={a ? <>Incident: {a.user_name} <Chip tone={a.status === 'open' ? 'red' : a.status === 'resolved' ? 'green' : 'ochre'}>{label(SOS_STATUS, a.status)}</Chip></> : 'Incident'} onClose={onClose}
      actions={a && a.status !== 'resolved' ? <button className="dg-btn dg-btn--sm dg-btn--dark" onClick={async () => { await onResolve(id); void reload(); }}>Resolve</button> : undefined}>
      <ErrorMsg error={error} />
      {a && (<>
        <p className="dg-note" role="note" style={{ marginTop: 0 }}><strong>If anyone is in danger, call 000 now.</strong> Raised {dateTime(a.created_at)} ({ago(a.created_at)}){a.message ? `: “${a.message}”` : '.'}</p>
        <dl className="kv">
          <dt>Raised by</dt><dd>{a.user_name} ({label(ROLE, a.role).toLowerCase()}) <a href={`tel:${a.user_phone}`}>{a.user_phone}</a></dd>
          {t && <>
            <dt>Trip</dt><dd>{t.ref}, {STATUS_LABEL[t.status] ?? t.status}{t.share_token && <> · <a href={`${apiBase()}/public/track/${t.share_token}`} target="_blank" rel="noreferrer">Live trip data</a></>}</dd>
            <dt>Route</dt><dd>{t.pickup_address} to {t.dropoff_address}</dd>
            <dt>Rider</dt><dd>{t.rider_name} {t.rider_phone && <a href={`tel:${t.rider_phone}`}>{t.rider_phone}</a>}</dd>
            <dt>Driver</dt><dd>{t.driver_name ?? '—'} {t.driver_phone && <a href={`tel:${t.driver_phone}`}>{t.driver_phone}</a>}</dd>
            {t.rego && <><dt>Car</dt><dd>{[t.colour, t.make, t.model].filter(Boolean).join(' ')}, {t.rego}</dd></>}
          </>}
          {a.handled_by_name && <><dt>Handled by</dt><dd>{a.handled_by_name}</dd></>}
        </dl>
        {markers.length > 0 && <div style={{ height: 200, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--line)', margin: '12px 0' }}>
          <DgMap markers={markers} track={data.track} padding={30} /></div>}

        <h3 className="drawer-h3">Runbook <span className="dg-muted" style={{ fontWeight: 400 }}>({done} of {data.runbook.length} done)</span></h3>
        <ol className="runbook">
          {data.runbook.map((s: any) => (
            <li key={s.key} className={s.done_at ? 'done' : ''}>
              <label className="dg-check">
                <input type="checkbox" checked={!!s.done_at} disabled={!!s.done_at} onChange={() => add({ step: s.key }, 'Step recorded')} />
                <span>{s.label}{s.done_at && <small className="dg-muted"> Done {time(s.done_at)}{s.done_by ? ` by ${s.done_by}` : ''}</small>}</span>
              </label>
            </li>
          ))}
        </ol>

        <form onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; await add({ text: note.trim() }, 'Note added'); setNote(''); }}>
          <label className="dg-field"><span>Add a note to the timeline</span>
            <textarea className="dg-textarea" value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} placeholder="Who you spoke to, what they said, what happens next" /></label>
          <div className="actions"><button className="dg-btn dg-btn--sm" disabled={!note.trim()}>Add note</button></div>
        </form>

        <h3 className="drawer-h3">Timeline</h3>
        <ol className="timeline">
          {data.timeline.map((e: any, i: number) => (
            <li key={i} className={`tl tl--${e.kind}`}>
              <time dateTime={e.at}>{time(e.at)}</time>
              <span><strong>{TL_KIND[e.kind] ?? e.kind}</strong> {e.text}{e.by && <span className="dg-muted"> · {e.by}</span>}</span>
            </li>
          ))}
        </ol>
      </>)}
    </Drawer>
  );
}
