import { useEffect, useState } from 'react';
import { date, dateTime, get, money, patch, post, put, useLoad } from '@dingogo/shared';
import { Page } from '../ctx';
import { Chip, ErrorMsg, Loading, Section, Table, Tabs, downloadFile, useAsk, useRun, useToast } from '../ui';

/** Round 16: tax, compliance and reporting — BAS worksheets, SERR, levy returns, NDIS invoices, record retention and privacy requests. */
type Tab = 'bas' | 'serr' | 'levy' | 'ndis' | 'retention' | 'privacy';
const darwin = () => new Date(Date.now() + 9.5 * 3600e3);
const thisQuarter = () => { const d = darwin(); return `${d.getUTCFullYear()}-Q${Math.floor(d.getUTCMonth() / 3) + 1}`; };
const thisHalf = () => { const d = darwin(); return `${d.getUTCFullYear()}-H${d.getUTCMonth() < 6 ? 1 : 2}`; };
const recent = (kind: 'Q' | 'H', n: number) => {
  const out: string[] = []; const d = darwin(); let y = d.getUTCFullYear();
  let k = kind === 'Q' ? Math.floor(d.getUTCMonth() / 3) + 1 : d.getUTCMonth() < 6 ? 1 : 2;
  for (let i = 0; i < n; i++) { out.push(`${y}-${kind}${k}`); k--; if (!k) { k = kind === 'Q' ? 4 : 2; y--; } }
  return out;
};
const Select = ({ value, onChange, options, label }: { value: string; onChange: (v: string) => void; options: string[]; label: string }) => (
  <select className="dg-input" value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} style={{ width: 'auto', minHeight: 38 }}>
    {options.map((o) => <option key={o} value={o}>{o}</option>)}
  </select>
);

export default function Tax() {
  const [tab, setTab] = useState<Tab>('bas');
  const ov = useLoad(() => get('/admin/tax/overview'), []);
  const o = ov.data;
  return (
    <Page title="Tax & compliance">
      <ErrorMsg error={ov.error} />
      {o && (<>
        <div className="kpis">
          <div className="kpi"><b>{o.business.abn_ok ? 'Set' : 'Not set'}</b><span>DingoGo ABN{o.business.abn_ok ? '' : ' (Settings → business)'}</span></div>
          <div className="kpi"><b>{date(o.next.bas.due)}</b><span>BAS due ({o.next.bas.key})</span></div>
          <div className="kpi"><b>{date(o.next.serr.due)}</b><span>SERR report due ({o.next.serr.key})</span></div>
          <div className="kpi"><b>{o.missing_details}</b><span>Drivers with tax details missing</span></div>
          <div className="kpi"><b>{o.levy_overdue}</b><span>NT levy returns overdue</span></div>
          <div className="kpi"><b>{o.privacy ? `${o.privacy.open}${o.privacy.overdue ? ` (${o.privacy.overdue} late)` : ''}` : '—'}</b><span>Privacy requests open</span></div>
        </div>
        {!o.ready && <p className="dg-note">Needs database migration 020 for driver tax details, levy lodgements and the privacy register. Reports still work.</p>}
      </>)}
      <p className="dg-muted" style={{ maxWidth: 820 }}>Worksheets for the BAS, the ATO’s Sharing Economy Reporting Regime and the passenger levy, made from DingoGo’s records on Darwin dates. Check them with the accountant before lodging.</p>
      <Tabs label="Tax and compliance" value={tab} onChange={setTab} tabs={[['bas', 'BAS'], ['serr', 'SERR (ATO)'], ['levy', 'Levy returns'], ['ndis', 'NDIS invoices'], ['retention', 'Record keeping'], ['privacy', 'Privacy requests']]}>
        {tab === 'bas' && <Bas />}
        {tab === 'serr' && <Serr />}
        {tab === 'levy' && <Levy />}
        {tab === 'ndis' && <Ndis />}
        {tab === 'retention' && <Retention onSaved={() => void ov.reload()} />}
        {tab === 'privacy' && <Privacy />}
      </Tabs>
    </Page>
  );
}

function Bas() {
  const [quarter, setQuarter] = useState(thisQuarter());
  const { data: b, error } = useLoad(() => get(`/admin/tax/bas?quarter=${quarter}`), [quarter]);
  const run = useRun();
  return (<>
    <Section title="DingoGo BAS worksheet" right={<Select label="Quarter" value={quarter} onChange={setQuarter} options={recent('Q', 8)} />} />
    <ErrorMsg error={error} />
    {!b ? <Loading /> : (<>
      <p className="dg-muted" style={{ marginTop: 0 }}>{b.period.label}. Due {date(b.period.due)}.</p>
      {b.warnings.map((w: string) => <p key={w} className="dg-note">{w}</p>)}
      <Table rows={[...b.lines, { key: 'total', label: 'G1 total / 1A GST on sales', cents: b.g1_cents, gst_cents: b.gst_on_sales_cents }]} rowKey={(r) => r.key} cols={[
        { key: 'label', label: 'DingoGo sales' }, { key: 'cents', label: 'Incl. GST', num: true, render: (r) => money(r.cents) }, { key: 'gst_cents', label: 'GST', num: true, render: (r) => money(r.gst_cents) },
      ]} />
      <div className="kpis" style={{ marginTop: 12 }}>
        <div className="kpi"><b>{money(b.refunds_cents)}</b><span>Refunds to riders (GST {money(b.gst_on_refunds_cents)})</span></div>
        <div className="kpi"><b>{money(b.gst_after_refunds_cents)}</b><span>1A after refunds</span></div>
        <div className="kpi"><b>{money(b.on_behalf.driver_sales_cents)}</b><span>Fares collected for drivers (their sales)</span></div>
        <div className="kpi"><b>{money(b.on_behalf.discounts_funded_cents)}</b><span>Rider discounts DingoGo funded</span></div>
      </div>
      {b.unregistered_drivers.length > 0 && <p className="dg-error">Not marked as GST-registered: {b.unregistered_drivers.map((d: any) => d.name).join(', ')}.</p>}
      <div className="actions" style={{ marginTop: 10 }}>
        <button className="dg-btn dg-btn--sm" onClick={() => run(() => downloadFile(`/admin/tax/bas?quarter=${quarter}&format=pdf`), 'BAS worksheet downloaded')}>Download PDF</button>
        <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadFile(`/admin/tax/bas?quarter=${quarter}&format=csv`), 'BAS worksheet downloaded')}>CSV</button>
      </div>
      <ul className="dg-muted">{b.notes.map((n: string) => <li key={n}>{n}</li>)}</ul>
      <DriverStatements quarter={quarter} />
    </>)}
  </>);
}

function DriverStatements({ quarter }: { quarter: string }) {
  const drivers = useLoad(() => get('/admin/drivers'), []);
  const [id, setId] = useState('');
  const run = useRun();
  const list: any[] = drivers.data?.items ?? drivers.data?.drivers ?? [];
  return (<>
    <h3>A driver’s statement or fee invoice</h3>
    <p className="dg-muted" style={{ marginTop: 0 }}>Drivers download these in their app (Earnings → Tax). Use this when a driver or their tax agent asks.</p>
    <div className="actions">
      <select className="dg-input" value={id} onChange={(e) => setId(e.target.value)} aria-label="Driver" style={{ width: 'auto', minHeight: 38 }}>
        <option value="">Choose a driver…</option>
        {list.map((d) => <option key={d.user_id ?? d.id} value={d.user_id ?? d.id}>{d.name}</option>)}
      </select>
      <button className="dg-btn dg-btn--sm dg-btn--ghost" disabled={!id} onClick={() => run(() => downloadFile(`/admin/tax/driver-statement?driver_id=${id}&quarter=${quarter}&format=pdf`), 'Statement downloaded')}>GST statement PDF</button>
      <button className="dg-btn dg-btn--sm dg-btn--ghost" disabled={!id} onClick={() => run(() => downloadFile(`/admin/tax/driver-statement?driver_id=${id}&quarter=${quarter}&doc=invoice&format=pdf`), 'Invoice downloaded')}>Fee tax invoice PDF</button>
    </div>
  </>);
}

function Serr() {
  const [period, setPeriod] = useState(thisHalf());
  const { data: r, error } = useLoad(() => get(`/admin/tax/serr?period=${period}`), [period]);
  const miss = useLoad(() => get('/admin/tax/missing-details'), []);
  const run = useRun();
  const toast = useToast();
  return (<>
    <Section title="Sharing Economy Reporting Regime" right={<Select label="Reporting period" value={period} onChange={setPeriod} options={recent('H', 6)} />} />
    <p className="dg-muted" style={{ marginTop: 0, maxWidth: 820 }}>DingoGo reports every driver’s payments to the ATO twice a year: January–June by 31 July, July–December by 31 January. The CSV has everything the report needs, including full bank details, so keep it safe; lodge it in the ATO’s format through the accounting software or the ATO portal.</p>
    <ErrorMsg error={error} />
    {!r ? <Loading /> : (<>
      <div className="kpis">
        <div className="kpi"><b>{r.totals.sellers}</b><span>Drivers paid</span></div>
        <div className="kpi"><b>{money(r.totals.gross_cents)}</b><span>Gross payments</span></div>
        <div className="kpi"><b>{money(r.totals.gst_cents)}</b><span>GST</span></div>
        <div className="kpi"><b>{money(r.totals.commission_cents)}</b><span>Commission</span></div>
        <div className="kpi"><b>{r.totals.incomplete}</b><span>With details missing</span></div>
      </div>
      <p className="dg-muted">{r.period.label}. Due {date(r.period.due)}{r.overdue ? ' (past due)' : ''}.{!r.operator.abn_ok && ' DingoGo’s ABN is not set yet.'}</p>
      <Table rows={r.sellers} rowKey={(s) => s.driver_id + s.activity} empty="No driver payments in this period." cols={[
        { key: 'name', label: 'Driver', render: (s) => <>{s.name}{s.deleted && <> <Chip>Deleted</Chip></>}</> }, { key: 'activity', label: 'Activity' },
        { key: 'transactions', label: 'Trips', num: true }, { key: 'gross_cents', label: 'Gross', num: true, render: (s) => money(s.gross_cents) },
        { key: 'gst_cents', label: 'GST', num: true, render: (s) => money(s.gst_cents) }, { key: 'commission_cents', label: 'Commission', num: true, render: (s) => money(s.commission_cents) },
        { key: 'missing', label: 'Missing', render: (s) => (s.missing.length ? <span className="dg-error">{s.missing.join(', ')}</span> : <Chip tone="green">Complete</Chip>) },
      ]} />
      <div className="actions" style={{ marginTop: 10 }}>
        <button className="dg-btn dg-btn--sm" onClick={() => run(() => downloadFile(`/admin/tax/serr?period=${period}&format=csv`), 'SERR file downloaded')}>Download SERR CSV</button>
      </div>
    </>)}
    <Section title="Missing details" right={<span style={{ display: 'flex', gap: 6 }}>
      <button className="dg-btn dg-btn--sm" disabled={!miss.data?.items?.some((i: any) => !i.deleted)} onClick={async () => { const x: any = await run(() => post('/admin/tax/missing-details/remind', {})); if (x) toast(`Reminded ${x.reminded} driver${x.reminded === 1 ? '' : 's'}`); }}>Remind them all</button>
      <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadFile('/admin/tax/missing-details?format=csv'), 'List downloaded')}>CSV</button>
    </span>} />
    <ErrorMsg error={miss.error} />
    {miss.data && <Table rows={miss.data.items} rowKey={(i) => i.driver_id} empty="Every driver’s tax details are complete." cols={[
      { key: 'name', label: 'Driver' }, { key: 'status', label: 'Status' }, { key: 'missing', label: 'Missing', render: (i) => i.missing.join(', ') },
      { key: 'remind', label: '', render: (i) => (i.deleted ? <Chip>Deleted</Chip> : <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => post('/admin/tax/missing-details/remind', { driver_ids: [i.driver_id] }), `Reminded ${i.name}`)}>Remind</button>) },
    ]} />}
  </>);
}

function Levy() {
  const [state, setState] = useState('NT');
  const list = useLoad(() => get(`/admin/tax/levy-returns?state=${state}`), [state]);
  const run = useRun();
  const ask = useAsk();
  async function lodge(m: any) {
    const ref = await ask({ title: `Lodged ${m.label}`, label: 'Lodgement or receipt reference (optional)', required: false, ok: 'Record' });
    if (ref === null) return;
    if (await run(() => post('/admin/tax/levy-returns', { state, month: m.month, reference: ref || undefined }), 'Lodgement recorded')) void list.reload();
  }
  return (<>
    <Section title="Passenger levy returns" right={<Select label="State" value={state} onChange={setState} options={['NT', 'SA']} />} />
    <p className="dg-muted" style={{ marginTop: 0, maxWidth: 820 }}>One return a month for completed passenger trips (not courier jobs). Download the return, lodge and pay it, then record it here. {state === 'SA' && 'SA is not operating yet: the return is ready for when it does.'}</p>
    <ErrorMsg error={list.error} />
    {list.data && <Table rows={list.data.months} rowKey={(m) => m.month} cols={[
      { key: 'label', label: 'Month' }, { key: 'trips', label: 'Passenger trips', num: true }, { key: 'payable_cents', label: 'Levy', num: true, render: (m) => money(m.payable_cents) },
      { key: 'due', label: 'Due', render: (m) => date(m.due) },
      { key: 'lodged_at', label: 'Lodged', render: (m) => (m.lodged_at ? `${date(m.lodged_at)}${m.reference ? ` (${m.reference})` : ''}` : m.current ? <Chip>This month</Chip> : m.overdue ? <Chip tone="red">Overdue</Chip> : m.trips ? 'Not yet' : 'Nothing to lodge') },
      { key: 'act', label: '', render: (m) => (<span style={{ display: 'flex', gap: 6 }}>
        <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadFile(`/admin/tax/levy-return?state=${state}&month=${m.month}&format=pdf`), 'Return downloaded')}>PDF</button>
        <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadFile(`/admin/tax/levy-return?state=${state}&month=${m.month}&format=csv`), 'Return downloaded')}>CSV</button>
        {!m.current && <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => void lodge(m)}>{m.lodged_at ? 'Correct' : 'Mark lodged'}</button>}
      </span>) },
    ]} />}
  </>);
}

function Ndis() {
  const [month, setMonth] = useState(darwin().toISOString().slice(0, 7));
  const set = useLoad(() => get(`/admin/tax/ndis?month=${month}`), [month]);
  const [s, setS] = useState<any>(null);
  const run = useRun();
  useEffect(() => { if (set.data) setS((x: any) => x ?? structuredClone(set.data.settings)); }, [set.data]);
  return (<>
    <Section title="NDIS invoices" right={<input className="dg-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" style={{ width: 'auto', minHeight: 38 }} />} />
    <p className="dg-muted" style={{ marginTop: 0, maxWidth: 820 }}>One invoice per participant per month for trips booked with an NDIS number, for plan managers and self-managed participants. Participants can also download theirs in the rider app.</p>
    <ErrorMsg error={set.error} />
    {set.data && (<>
      <Table rows={set.data.invoices} rowKey={(i) => i.number} empty="No NDIS trips this month." cols={[
        { key: 'number', label: 'Invoice' }, { key: 'participant', label: 'Participant' }, { key: 'ndis_number', label: 'NDIS number' }, { key: 'bill_to', label: 'Bill to' },
        { key: 'lines', label: 'Trips', num: true, render: (i) => i.lines.length }, { key: 'total_cents', label: 'Total', num: true, render: (i) => money(i.total_cents) },
        { key: 'pdf', label: '', render: (i) => <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadFile(`/admin/tax/ndis?month=${month}&ndis=${i.ndis_number}&format=pdf`), 'Invoice downloaded')}>PDF</button> },
      ]} />
      <div className="actions" style={{ marginTop: 10 }}>
        <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadFile(`/admin/tax/ndis?month=${month}&format=csv`), 'Invoices downloaded')}>All lines CSV</button>
        <button className="dg-btn dg-btn--sm dg-btn--ghost" disabled={!set.data.settings.registration_number} onClick={() => run(() => downloadFile(`/admin/tax/ndis?month=${month}&format=csv&claim=bulk`), 'Bulk claim file downloaded')}>NDIA bulk claim file</button>
      </div>
    </>)}
    {s && (
      <form style={{ maxWidth: 820 }} onSubmit={async (e) => { e.preventDefault(); const r: any = await run(() => put('/admin/tax/ndis-settings', s), 'NDIS settings saved'); if (r) { setS(r.settings); void set.reload(); } }}>
        <h3>Invoice settings</h3>
        <p className="dg-muted" style={{ marginTop: 0 }}>Check the support item and GST code against the current NDIS Pricing Arrangements and with the accountant. Leave the registration number empty unless DingoGo is an NDIS-registered provider.</p>
        <div className="form-grid">
          <label className="dg-field"><span>NDIS provider registration number</span><input className="dg-input" inputMode="numeric" value={s.registration_number} onChange={(e) => setS({ ...s, registration_number: e.target.value })} /></label>
          <label className="dg-field"><span>Support item number</span><input className="dg-input" placeholder="02_051_0108_1_1" value={s.support_item} onChange={(e) => setS({ ...s, support_item: e.target.value })} /></label>
          <label className="dg-field"><span>Support name on the invoice</span><input className="dg-input" value={s.support_name} onChange={(e) => setS({ ...s, support_name: e.target.value })} /></label>
          <label className="dg-field"><span>GST code</span><select className="dg-input" value={s.gst_code} onChange={(e) => setS({ ...s, gst_code: e.target.value })}>
            <option value="P1">P1 Taxable (GST included)</option><option value="P2">P2 GST free</option><option value="P5">P5 Out of scope</option></select></label>
          <label className="dg-field"><span>Payment terms (days)</span><input className="dg-input" type="number" min={0} max={60} value={s.payment_terms_days} onChange={(e) => setS({ ...s, payment_terms_days: Number(e.target.value) })} /></label>
        </div>
        <button className="dg-btn">Save NDIS settings</button>
      </form>
    )}
  </>);
}

const RET_FIELDS: [string, string, string][] = [
  ['tax_years', 'Tax records (years, at least 5)', 'Trips, payments, driver pay, invoices and the audit log. ATO record keeping.'],
  ['gps_track_months', 'Trip GPS tracks (months)', ''], ['chat_months', 'Trip chat messages (months)', ''], ['comms_log_months', 'Text and push delivery log (months)', ''],
  ['notifications_months', 'In-app notifications (months)', ''], ['security_log_days', 'Sign-in code requests (days)', ''],
];
function Retention({ onSaved }: { onSaved: () => void }) {
  const prev = useLoad(() => get('/admin/tax/retention'), []);
  const [p, setP] = useState<any>(null);
  const run = useRun();
  const ask = useAsk();
  useEffect(() => { if (prev.data) setP((x: any) => x ?? structuredClone(prev.data.policy)); }, [prev.data]);
  async function purge() {
    const ok = await ask({ title: 'Remove old records now?', label: 'Type REMOVE to confirm. This cannot be undone.', ok: 'Remove', danger: true });
    if (ok?.toUpperCase() !== 'REMOVE') return;
    if (await run(() => post('/admin/tax/retention/run', { dry_run: false }), 'Old records removed')) { void prev.reload(); onSaved(); }
  }
  if (!p) return <ErrorMsg error={prev.error} />;
  return (<>
    <Section title="Record keeping" right={p.auto ? <Chip tone="green">Runs daily</Chip> : <Chip>Manual</Chip>} />
    <p className="dg-muted" style={{ marginTop: 0, maxWidth: 820 }}>How long DingoGo keeps records. Tax records are kept at least 5 years; other personal information is removed once it is no longer needed (Australian Privacy Principle 11). A deleted driver’s tax details are kept apart for the 5 years, then removed.</p>
    <form style={{ maxWidth: 820 }} onSubmit={async (e) => { e.preventDefault(); if (await run(() => put('/admin/tax/retention', p), 'Record keeping saved')) { void prev.reload(); onSaved(); } }}>
      <div className="form-grid">
        {RET_FIELDS.map(([k, l, help]) => (
          <label key={k} className="dg-field"><span>{l}</span><input className="dg-input" type="number" min={k === 'tax_years' ? 5 : 1} value={p[k]} onChange={(e) => setP({ ...p, [k]: Number(e.target.value) })} />{help && <small className="dg-muted">{help}</small>}</label>
        ))}
      </div>
      <label className="dg-check"><input type="checkbox" checked={p.auto} onChange={(e) => setP({ ...p, auto: e.target.checked })} /><span>Remove old records automatically once a day</span></label>
      <button className="dg-btn">Save</button>
    </form>
    {prev.data && (<>
      <h3>What would be removed now</h3>
      <Table rows={prev.data.removed} rowKey={(r) => r.key} cols={[{ key: 'label', label: 'Records' }, { key: 'rows', label: 'Rows', num: true }]} />
      <ul className="dg-muted">{prev.data.kept.map((k: string) => <li key={k}>{k}</li>)}</ul>
      <div className="actions"><button className="dg-btn dg-btn--sm dg-btn--danger" disabled={!prev.data.removed.some((r: any) => r.rows > 0)} onClick={() => void purge()}>Remove them now</button></div>
    </>)}
  </>);
}

const KINDS: Record<string, string> = { access: 'Access (copy of their data)', correction: 'Correction', deletion: 'Deletion', complaint: 'Complaint' };
function Privacy() {
  const [status, setStatus] = useState('open');
  const list = useLoad(() => get(`/admin/privacy/requests?status=${status}`), [status]);
  const [form, setForm] = useState({ kind: 'access', channel: 'email', requester: '', details: '' });
  const run = useRun();
  const ask = useAsk();
  async function close(r: any, s: 'completed' | 'refused') {
    const outcome = await ask({ title: s === 'completed' ? 'What was done?' : 'Why was it refused?', label: 'Outcome (kept on the record)', multiline: true });
    if (!outcome) return;
    if (await run(() => patch(`/admin/privacy/requests/${r.id}`, { status: s, outcome }), 'Request closed')) void list.reload();
  }
  return (<>
    <Section title="Privacy requests" right={<span style={{ display: 'flex', gap: 6 }}>
      <Select label="Status" value={status} onChange={setStatus} options={['open', 'completed', 'refused']} />
      <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadFile('/admin/privacy/requests?format=csv'), 'Register downloaded')}>CSV</button>
    </span>} />
    <p className="dg-muted" style={{ marginTop: 0, maxWidth: 820 }}>Every request to see, correct or delete personal information, and privacy complaints. Answer within 30 days. Downloads and deletions in the apps are recorded here automatically.</p>
    {list.error ? <ErrorMsg error={list.error} /> : list.data && <Table rows={list.data.items} rowKey={(r) => r.id} empty="No requests." cols={[
      { key: 'ref', label: 'Ref' }, { key: 'kind', label: 'Request', render: (r) => KINDS[r.kind] ?? r.kind }, { key: 'who', label: 'Person', render: (r) => r.user_name ?? r.requester ?? '' },
      { key: 'channel', label: 'How' }, { key: 'received_at', label: 'Received', render: (r) => dateTime(r.received_at) },
      { key: 'due_at', label: 'Due', render: (r) => (r.status !== 'open' ? date(r.completed_at) : r.overdue ? <Chip tone="red">{date(r.due_at)} late</Chip> : date(r.due_at)) },
      { key: 'outcome', label: 'Outcome', render: (r) => r.outcome ?? '' },
      { key: 'act', label: '', render: (r) => (r.status === 'open' ? <span style={{ display: 'flex', gap: 6 }}>
        <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => void close(r, 'completed')}>Done</button>
        <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => void close(r, 'refused')}>Refuse</button></span> : null) },
    ]} />}
    <form style={{ maxWidth: 820 }} onSubmit={async (e) => { e.preventDefault(); if (await run(() => post('/admin/privacy/requests', { ...form, details: form.details || undefined }), 'Request logged')) { setForm({ ...form, requester: '', details: '' }); void list.reload(); } }}>
      <h3>Log a request received by email, phone or letter</h3>
      <div className="form-grid">
        <label className="dg-field"><span>Request</span><select className="dg-input" value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>{Object.entries(KINDS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="dg-field"><span>How it came in</span><select className="dg-input" value={form.channel} onChange={(e) => setForm({ ...form, channel: e.target.value })}>
          {[['email', 'Email'], ['phone', 'Phone'], ['letter', 'Letter'], ['in_person', 'In person']].map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
        <label className="dg-field"><span>Who asked</span><input className="dg-input" required minLength={2} value={form.requester} onChange={(e) => setForm({ ...form, requester: e.target.value })} /></label>
        <label className="dg-field"><span>Details</span><input className="dg-input" value={form.details} onChange={(e) => setForm({ ...form, details: e.target.value })} /></label>
      </div>
      <button className="dg-btn">Log request</button>
    </form>
  </>);
}
