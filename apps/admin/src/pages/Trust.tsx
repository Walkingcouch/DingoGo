/**
 * Round 14: safety and trust in the console — safety reports, driver photo checks, check-ins, fatigue, account standing
 * (suspend / ban / warn / lift) and appeals, and the safety policy. Shown as tabs on the Safety page.
 */
import { useState } from 'react';
import { get, patch, post, put, dateTime, date, ago, time, FileLink, useLoad, Icon } from '@dingogo/shared';
import { Chip, Drawer, ErrorMsg, Section, Table, useAsk, useRun } from '../ui';
import { ROLE, label } from '../labels';

const SEV_TONE: Record<string, 'red' | 'ochre' | 'green'> = { critical: 'red', high: 'ochre', normal: 'green' };
const REPORT_STATUS: Record<string, string> = { open: 'Open', investigating: 'Investigating', actioned: 'Actioned', closed: 'Closed' };
const CHECK_REASON: Record<string, string> = { long_stop: 'Long stop', route_deviation: 'Off route', ops: 'Asked by ops' };
const CHECK_STATUS: Record<string, string> = { pending: 'Waiting for answer', ok: 'Rider is OK', help: 'Asked for help', escalated: 'No answer: SOS raised' };
const ACTION: Record<string, string> = { suspend: 'Suspended', ban: 'Banned', warning: 'Warning', lift: 'Lifted' };
const mins = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);
const notReady = <p className="dg-note">These safety tools need database migration 019.</p>;

export function Reports({ onStanding }: { onStanding: (userId: string) => void }) {
  const [status, setStatus] = useState('active');
  const { data, error, reload } = useLoad<any>(() => get(`/admin/incidents?status=${status}`), [status]);
  const [open, setOpen] = useState<string | null>(null);
  if (data && !data.ready) return notReady;
  return (<>
    <p className="dg-muted" style={{ marginTop: 0, maxWidth: 800 }}>Reports from riders and drivers. Critical reports (sexual misconduct, assault) put the other person's account on hold straight away, unless they were on a trip: then hold them from their standing once it ends.</p>
    <div className="toolbar">
      <label className="dg-field" style={{ margin: 0 }}><span>Show</span>
        <select className="dg-select" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="active">Open and investigating</option>{Object.entries(REPORT_STATUS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}<option value="all">All</option>
        </select></label>
    </div>
    <ErrorMsg error={error} />
    <Table rows={data?.items} onRow={(r) => setOpen(r.id)} empty="No reports." cols={[
      { key: 'created_at', label: 'When', nowrap: true, render: (r) => dateTime(r.created_at) },
      { key: 'ref', label: 'Ref' },
      { key: 'severity', label: 'Severity', render: (r) => <Chip tone={SEV_TONE[r.severity]}>{r.severity}</Chip> },
      { key: 'label', label: 'What' },
      { key: 'reporter_name', label: 'From', render: (r) => <>{r.reporter_name}<span className="sub">{label(ROLE, r.reporter_role)}</span></> },
      { key: 'subject_name', label: 'About', render: (r) => <>{r.subject_name ?? '—'}{r.held && <> <Chip tone="red">On hold</Chip></>}</> },
      { key: 'trip_ref', label: 'Trip' },
      { key: 'status', label: 'Status', render: (r) => REPORT_STATUS[r.status] ?? r.status },
    ]} />
    {open && <ReportDrawer id={open} onClose={() => { setOpen(null); void reload(); }} onStanding={onStanding} />}
  </>);
}

function ReportDrawer({ id, onClose, onStanding }: { id: string; onClose: () => void; onStanding: (userId: string) => void }) {
  const { data, error, reload } = useLoad<any>(() => get(`/admin/incidents/${id}`), [id]);
  const run = useRun();
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState('');
  const r = data?.report;
  async function save(body: any, ok: string) { if (await run(() => patch(`/admin/incidents/${id}`, body), ok)) void reload(); }
  return (
    <Drawer title={r ? <>Report {r.ref} <Chip tone={SEV_TONE[r.severity]}>{r.severity}</Chip></> : 'Report'} onClose={onClose}>
      <ErrorMsg error={error} />
      {r && (<>
        {r.severity === 'critical' && <p className="dg-note" role="note" style={{ marginTop: 0 }}><strong>If anyone is in danger, call 000.</strong> Offer 1800RESPECT (1800 737 732). Ask if they want to report to NT Police (131 444).</p>}
        <dl className="kv">
          <dt>What</dt><dd>{r.label}</dd>
          <dt>From</dt><dd>{r.reporter_name} ({label(ROLE, r.reporter_role).toLowerCase()}) <a href={`tel:${r.reporter_phone}`}>{r.reporter_phone}</a></dd>
          <dt>About</dt><dd>{r.subject_name ? <>{r.subject_name} ({label(ROLE, r.subject_role).toLowerCase()}){r.subject_blocked && <> <Chip tone="red">On hold or banned</Chip></>}{' '}
            <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => onStanding(r.subject_id)}>Account standing</button></> : 'No other person'}</dd>
          {r.trip_ref && <><dt>Trip</dt><dd>{r.trip_ref}: {r.pickup_address} to {r.dropoff_address}</dd></>}
          <dt>Sent</dt><dd>{dateTime(r.created_at)} ({ago(r.created_at)})</dd>
        </dl>
        <h3 className="drawer-h3">What they said</h3>
        <p style={{ whiteSpace: 'pre-wrap' }}>{r.description}</p>
        {r.evidence?.length > 0 && <p>{r.evidence.map((e: any, i: number) => <FileLink key={i} href={e.file_url}>Evidence {i + 1} </FileLink>)}</p>}
        {data.other_reports_about_subject.length > 0 && (<>
          <h3 className="drawer-h3">Other reports about {r.subject_name}</h3>
          <ul>{data.other_reports_about_subject.map((o: any) => <li key={o.id}>{o.ref}, {date(o.created_at)}: {o.category.replace(/_/g, ' ')} ({REPORT_STATUS[o.status] ?? o.status})</li>)}</ul>
        </>)}
        <h3 className="drawer-h3">Status</h3>
        <div className="actions">
          {Object.entries(REPORT_STATUS).map(([k, l]) => (
            <button key={k} className={`dg-btn dg-btn--sm ${r.status === k ? 'dg-btn--dark' : 'dg-btn--ghost'}`} aria-pressed={r.status === k}
              onClick={() => save({ status: k, ...(outcome.trim() ? { outcome: outcome.trim() } : {}) }, `Marked ${l.toLowerCase()}`)}>{l}</button>
          ))}
        </div>
        <label className="dg-field"><span>Outcome for the reporter (sent when you mark it actioned or closed; no details about action on anyone's account)</span>
          <textarea className="dg-textarea" maxLength={500} value={outcome || r.outcome || ''} onChange={(e) => setOutcome(e.target.value)} /></label>
        <form onSubmit={async (e) => { e.preventDefault(); if (!note.trim()) return; await save({ note: note.trim() }, 'Note added'); setNote(''); }}>
          <label className="dg-field"><span>Private note</span><textarea className="dg-textarea" maxLength={2000} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          <div className="actions"><button className="dg-btn dg-btn--sm" disabled={!note.trim()}>Add note</button></div>
        </form>
        {data.notes.length > 0 && <ol className="timeline">{data.notes.map((n: any, i: number) => (
          <li key={i} className="tl"><time dateTime={n.at}>{dateTime(n.at)}</time><span>{n.action === 'incident_note' ? n.data?.text : `Status ${n.data?.from} to ${n.data?.to}`}{n.actor_name && <span className="dg-muted"> · {n.actor_name}</span>}</span></li>
        ))}</ol>}
      </>)}
    </Drawer>
  );
}

export function PhotoChecks() {
  const { data, error, reload } = useLoad<any>(() => get('/admin/identity-checks?status=pending'));
  const run = useRun();
  const ask = useAsk();
  if (data && !data.ready) return notReady;
  async function decide(c: any, status: 'approved' | 'rejected') {
    let note: string | undefined;
    if (status === 'rejected') { const n = await ask({ title: 'Photo not accepted', label: `Reason (sent to ${c.driver_name})`, ok: 'Not accepted', danger: true }); if (!n) return; note = n; }
    await run(() => patch(`/admin/identity-checks/${c.id}`, { status, note }), status === 'approved' ? 'Approved' : 'Not accepted: driver taken offline');
    void reload();
  }
  return (<>
    <p className="dg-muted" style={{ marginTop: 0, maxWidth: 800 }}>Drivers take a photo before going online when the photo check is on (Policy tab). Compare it with their last approved photo and licence. Drivers can drive while a photo waits; not accepting it takes them offline.</p>
    <ErrorMsg error={error} />
    <Table rows={data?.items} empty="No photos waiting." cols={[
      { key: 'created_at', label: 'Taken', nowrap: true, render: (c) => dateTime(c.created_at) },
      { key: 'driver_name', label: 'Driver' },
      { key: 'photo', label: 'Photo', render: (c) => <FileLink href={c.photo_url}>Today's photo<span className="sr-only"> of {c.driver_name}</span></FileLink> },
      { key: 'ref', label: 'Compare with', render: (c) => <>{c.reference_url ? <FileLink href={c.reference_url}>Last approved</FileLink> : 'First photo'}{c.licence_url && <> · <FileLink href={c.licence_url}>Licence</FileLink></>}</> },
      { key: 'match_score', label: 'Match', render: (c) => (c.match_score != null ? `${Math.round(Number(c.match_score) * 100)}%` : '—') },
      { key: 'x', label: 'Decision', render: (c) => <>
        <button className="dg-btn dg-btn--sm dg-btn--green" onClick={() => decide(c, 'approved')}>Approve<span className="sr-only"> photo of {c.driver_name}</span></button>{' '}
        <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => decide(c, 'rejected')}>Not accepted<span className="sr-only"> photo of {c.driver_name}</span></button></> },
    ]} />
  </>);
}

export function CheckIns() {
  const checks = useLoad<any>(() => get('/admin/safety/checks'));
  const fatigue = useLoad<any>(() => get('/admin/safety/fatigue'));
  if (checks.data && !checks.data.ready) return notReady;
  return (<>
    <Section title="Are you OK? check-ins (last 7 days)" />
    <p className="dg-muted" style={{ marginTop: 0, maxWidth: 800 }}>Riders are asked when the car stops for a long time away from the pickup and drop-off, or goes off the route. No answer in time raises an emergency alert and texts their trusted contacts. To ask a rider yourself, open the trip.</p>
    <Table rows={checks.data?.items} empty="No check-ins." cols={[
      { key: 'created_at', label: 'When', nowrap: true, render: (c) => dateTime(c.created_at) },
      { key: 'trip_ref', label: 'Trip' }, { key: 'rider_name', label: 'Rider' },
      { key: 'reason', label: 'Why', render: (c) => CHECK_REASON[c.reason] ?? c.reason },
      { key: 'status', label: 'Answer', render: (c) => <Chip tone={c.status === 'ok' ? 'green' : c.status === 'pending' ? 'ochre' : 'red'}>{CHECK_STATUS[c.status] ?? c.status}</Chip> },
      { key: 'answered_at', label: 'Answered', render: (c) => (c.answered_at ? time(c.answered_at) : '—') },
    ]} />
    <Section title="Driver hours (fatigue)" />
    {fatigue.data?.policy && <p className="dg-muted" style={{ marginTop: 0 }}>
      Limits: {mins(fatigue.data.policy.max_online_min_24h)} online then a {mins(fatigue.data.policy.rest_min)} rest; a {fatigue.data.policy.break_min} min break after {mins(fatigue.data.policy.break_after_min)}. {fatigue.data.policy.enabled ? '' : 'Switched off.'}</p>}
    <Table rows={fatigue.data?.items} rowKey={(d) => d.driver_id} empty="No drivers online." cols={[
      { key: 'name', label: 'Driver' },
      { key: 'online', label: 'Now', render: (d) => (d.online ? 'Online' : 'Resting') },
      { key: 'online_min_24h', label: 'Online (since last rest)', render: (d) => mins(d.online_min_24h) },
      { key: 'continuous_min', label: 'Without a break', render: (d) => mins(d.continuous_min) },
      { key: 'left', label: 'Next limit', render: (d) => (d.rest_until ? `Rest until ${time(d.rest_until)}` : d.minutes_left != null ? `In ${mins(d.minutes_left)}` : '—') },
    ]} />
  </>);
}

export function Appeals({ onStanding }: { onStanding: (userId: string) => void }) {
  const { data, error, reload } = useLoad<any>(() => get('/admin/appeals?status=pending'));
  const run = useRun();
  const ask = useAsk();
  if (data && !data.ready) return notReady;
  async function decide(a: any, decision: 'upheld' | 'overturned') {
    const note = await ask({ title: decision === 'overturned' ? 'Restore the account' : 'Keep the decision', label: 'Note (texted to them if you keep the decision)', multiline: true, required: false, ok: decision === 'overturned' ? 'Restore account' : 'Keep decision' });
    if (note === null) return;
    await run(() => patch(`/admin/appeals/${a.id}`, { decision, note: note || undefined }), decision === 'overturned' ? 'Account restored' : 'Decision kept');
    void reload();
  }
  return (<>
    <p className="dg-muted" style={{ marginTop: 0, maxWidth: 800 }}>People whose account is suspended or banned can ask us to look again from the sign-in screen. Admins decide.</p>
    <ErrorMsg error={error} />
    <Table rows={data?.items} empty="No appeals waiting." cols={[
      { key: 'created_at', label: 'Sent', nowrap: true, render: (a) => dateTime(a.created_at) },
      { key: 'user_name', label: 'Who', render: (a) => <>{a.user_name}<span className="sub">{label(ROLE, a.user_role)}</span></> },
      { key: 'restriction', label: 'Decision', render: (a) => <>{ACTION[a.restriction] ?? a.restriction} {date(a.restricted_at)}<span className="sub">{a.public_reason}{a.incident_ref ? ` (${a.incident_ref})` : ''}</span></> },
      { key: 'message', label: 'What they said', truncate: 400 },
      { key: 'x', label: '', render: (a) => <>
        <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => onStanding(a.user_id)}>Standing</button>{' '}
        <button className="dg-btn dg-btn--sm dg-btn--green" onClick={() => decide(a, 'overturned')}>Restore</button>{' '}
        <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => decide(a, 'upheld')}>Keep decision</button></> },
    ]} />
  </>);
}

/** Account standing: history of suspensions, bans, warnings and lifts; restrict or lift. */
export function StandingDrawer({ userId, onClose }: { userId: string; onClose: () => void }) {
  const { data, error, reload } = useLoad<any>(() => get(`/admin/users/${userId}/standing`), [userId]);
  const run = useRun();
  const blank = { action: 'suspend', reason_code: 'under_review', public_reason: '', note: '', until: '' };
  const [f, setF] = useState(blank);
  const u = data?.user;
  async function restrict(e: React.FormEvent) {
    e.preventDefault();
    const body: any = { action: f.action, reason_code: f.reason_code, public_reason: f.public_reason || undefined, note: f.note || undefined };
    if (f.action === 'suspend' && f.until) body.until = new Date(f.until + 'T23:59:00+09:30').toISOString();
    if (await run(() => post(`/admin/users/${userId}/restrict`, body), `${ACTION[f.action]}`)) { setF(blank); void reload(); }
  }
  async function lift() { if (await run(() => post(`/admin/users/${userId}/lift`, {}), 'Account restored')) void reload(); }
  return (
    <Drawer title={u ? <>Standing: {u.name || 'No name'} {u.blocked && <Chip tone="red">Restricted</Chip>}</> : 'Account standing'} onClose={onClose}>
      <ErrorMsg error={error} />
      {data && !data.ready && notReady}
      {data?.ready && (<>
        {data.restriction && <p className="dg-note" style={{ marginTop: 0 }}>{ACTION[data.restriction.action]} {date(data.restriction.created_at)}: {data.restriction.public_reason}{data.restriction.until ? ` Until ${date(data.restriction.until)}.` : ''}</p>}
        {u.blocked
          ? <button className="dg-btn dg-btn--sm dg-btn--green" onClick={lift}><Icon name="check" size={16} /> Lift and restore the account</button>
          : (
            <form onSubmit={restrict}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                <label className="dg-field"><span>Action</span><select className="dg-select" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value })}>
                  <option value="suspend">Suspend</option><option value="ban">Ban</option><option value="warning">Warning only</option></select></label>
                <label className="dg-field"><span>Reason</span><select className="dg-select" value={f.reason_code} onChange={(e) => setF({ ...f, reason_code: e.target.value })}>
                  {Object.keys(data.reasons).map((k) => <option key={k} value={k}>{k.replace(/_/g, ' ')}</option>)}</select></label>
              </div>
              <label className="dg-field"><span>What they're told (blank: "{data.reasons[f.reason_code]}")</span><input className="dg-input" maxLength={300} value={f.public_reason} onChange={(e) => setF({ ...f, public_reason: e.target.value })} /></label>
              {f.action === 'suspend' && <label className="dg-field"><span>Until (optional; lifts itself)</span><input className="dg-input" type="date" value={f.until} onChange={(e) => setF({ ...f, until: e.target.value })} /></label>}
              <label className="dg-field"><span>Private note</span><textarea className="dg-textarea" maxLength={1000} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></label>
              <div className="actions"><button className={`dg-btn dg-btn--sm ${f.action === 'warning' ? 'dg-btn--dark' : 'dg-btn--danger'}`}>{f.action === 'warning' ? 'Send warning' : f.action === 'ban' ? 'Ban account' : 'Suspend account'}</button></div>
            </form>)}
        <h3 className="drawer-h3">History</h3>
        {data.actions.length ? <ol className="timeline">{data.actions.map((a: any) => (
          <li key={a.id} className="tl"><time dateTime={a.created_at}>{date(a.created_at)}</time>
            <span><strong>{ACTION[a.action] ?? a.action}</strong> {a.public_reason}{a.until ? ` (until ${date(a.until)})` : ''}{a.incident_ref ? ` · ${a.incident_ref}` : ''}{a.note ? <span className="dg-muted"> · {a.note}</span> : null}<span className="dg-muted"> · {a.by_name ?? 'automatic'}</span></span></li>
        ))}</ol> : <p className="dg-muted">Nothing on record.</p>}
        {data.appeals.length > 0 && (<><h3 className="drawer-h3">Appeals</h3>
          <ul>{data.appeals.map((a: any) => <li key={a.id}>{date(a.created_at)}: {a.status}{a.decision_note ? `, ${a.decision_note}` : ''}</li>)}</ul></>)}
        {data.reports_about.length > 0 && (<><h3 className="drawer-h3">Safety reports about them</h3>
          <ul>{data.reports_about.map((r: any) => <li key={r.id}>{r.ref}, {date(r.created_at)}: {r.category.replace(/_/g, ' ')} ({r.severity}, {REPORT_STATUS[r.status] ?? r.status})</li>)}</ul></>)}
      </>)}
    </Drawer>
  );
}

/** Safety policy: photo check, fatigue limits, check-ins, night window, holds on critical reports. */
export function Policy() {
  const { data, error, reload } = useLoad<any>(() => get('/admin/safety/policy'));
  const run = useRun();
  const [p, setP] = useState<any>(null);
  const cur = p ?? data?.policy;
  if (!cur) return <ErrorMsg error={error} />;
  const set = (g: string, k: string, v: any) => setP({ ...cur, [g]: { ...cur[g], [k]: v } });
  const num = (g: string, k: string, lbl: string, help?: string) => (
    <label className="dg-field"><span>{lbl}</span><input className="dg-input" type="number" inputMode="numeric" value={cur[g][k]} onChange={(e) => set(g, k, Number(e.target.value))} />{help && <small className="dg-muted">{help}</small>}</label>
  );
  const bool = (g: string, k: string, lbl: string) => (
    <label className="dg-check"><input type="checkbox" checked={!!cur[g][k]} onChange={(e) => set(g, k, e.target.checked)} /><span>{lbl}</span></label>
  );
  async function save(e: React.FormEvent) { e.preventDefault(); if (await run(() => put('/admin/safety/policy', cur), 'Safety policy saved')) { setP(null); void reload(); } }
  return (
    <form onSubmit={save} style={{ maxWidth: 760 }}>
      {!data.ready && notReady}
      <Section title="Driver photo check" />
      <label className="dg-field"><span>Before going online</span><select className="dg-select" value={cur.identity_check.mode} onChange={(e) => set('identity_check', 'mode', e.target.value)}>
        <option value="off">Off</option><option value="photo_review">Photo, looked at by DingoGo</option><option value="face_match">Photo, matched automatically (falls back to DingoGo)</option></select>
        <small className="dg-muted">Automatic matching needs FACE_MATCH_URL on the API.</small></label>
      {num('identity_check', 'every_hours', 'A new photo every (hours)')}
      <Section title="Fatigue limits" />
      <p className="dg-muted" style={{ marginTop: 0 }}>Drivers aren't set offline mid-trip: it happens when the trip ends. Check these against current NT and SA point-to-point guidance.</p>
      {bool('fatigue', 'enabled', 'Fatigue limits on')}
      {num('fatigue', 'max_online_min_24h', 'Most minutes online before a long rest (in 24 hours)', '720 = 12 hours')}
      {num('fatigue', 'rest_min', 'Long rest (minutes)', '360 = 6 hours')}
      {num('fatigue', 'break_after_min', 'Break after this many minutes online')}
      {num('fatigue', 'break_min', 'Break length (minutes)')}
      {num('fatigue', 'warn_before_min', 'Warn this many minutes before')}
      <Section title="Are you OK? check-ins" />
      {bool('check_ins', 'enabled', 'Check in on long stops')}
      {num('check_ins', 'long_stop_min', 'Long stop (minutes stopped)')}
      {num('check_ins', 'answer_min', 'Minutes to answer before an emergency alert')}
      {bool('check_ins', 'text_contacts_on_escalation', 'Text the rider\'s trusted contacts when there\'s no answer')}
      <Section title="Night trips (for automatic sharing)" />
      {num('night', 'from_hour', 'Night starts (hour, 0 to 23)')}
      {num('night', 'to_hour', 'Night ends (hour, 0 to 23)')}
      <Section title="Safety reports" />
      {bool('incidents', 'auto_hold_critical', 'Put the other person on hold when a critical report comes in (sexual misconduct, assault)')}
      <div className="actions" style={{ marginTop: 14 }}><button className="dg-btn" disabled={!p}>Save policy</button>{p && <button type="button" className="dg-btn dg-btn--ghost" onClick={() => setP(null)}>Undo changes</button>}</div>
    </form>
  );
}
