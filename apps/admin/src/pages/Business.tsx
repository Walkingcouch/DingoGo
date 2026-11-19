import { useState } from 'react';
import { get, post, put, money, dateTime, useLoad } from '@dingogo/shared';
import { Page } from '../ctx';
import { Chip, CrudSection, Drawer, ErrorMsg, Section, Table, Tabs, downloadFile, exportCsv, useAsk, useRun, useToast } from '../ui';

const KIND: Record<string, string> = { business: 'Business', ndis_plan_manager: 'NDIS plan manager', community_org: 'Community organisation', aboriginal_corporation: 'Aboriginal corporation', health_service: 'Health service', government: 'Government' };

type Tab = 'accounts' | 'applications' | 'invoices' | 'billing';
export default function Business() {
  const [open, setOpen] = useState<any>(null);
  const [tab, setTab] = useState<Tab>('accounts');
  return (
    <Page title="Business accounts">
      <p className="dg-muted" style={{ marginTop: 0, maxWidth: 780 }}>Members book on the account and trips are invoiced monthly. NDIS plan managers receive tax invoices showing the participant's NDIS number for transport claims.</p>
      <Tabs label="Business accounts" value={tab} onChange={setTab} tabs={[['accounts', 'Accounts'], ['applications', 'Applications'], ['invoices', 'Invoices'], ['billing', 'Billing settings']]}>
        {tab === 'accounts' && <Accounts onOpen={setOpen} />}
        {tab === 'applications' && <Applications />}
        {tab === 'invoices' && <Invoices />}
        {tab === 'billing' && <Billing />}
      </Tabs>
      {open && <Statement account={open} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function Accounts({ onOpen: setOpen }: { onOpen: (a: any) => void }) {
  return (
      <CrudSection title="Accounts" path="corporate" newLabel="New account" fields={[
        { key: 'name', label: 'Organisation', required: true }, { key: 'kind', label: 'Type', type: 'select', required: true, options: Object.entries(KIND) },
        { key: 'abn', label: 'ABN' }, { key: 'billing_email', label: 'Billing email', type: 'email', required: true },
        { key: 'monthly_limit_cents', label: 'Monthly limit', type: 'money' }, { key: 'invoice_terms_days', label: 'Payment terms (days)', type: 'number' },
        { key: 'discount_pct', label: 'Account discount (%)', type: 'number', min: 0, max: 50 }, { key: 'active', label: 'Active', type: 'bool' },
      ]} cols={[
        { key: 'name', label: 'Organisation', render: (a) => <strong>{a.name}</strong> }, { key: 'kind', label: 'Type', render: (a) => KIND[a.kind] ?? a.kind },
        { key: 'billing_email', label: 'Billing email' }, { key: 'discount_pct', label: 'Discount', num: true, render: (a) => `${a.discount_pct}%` },
        { key: 'monthly_limit_cents', label: 'Limit', num: true, render: (a) => (a.monthly_limit_cents ? money(a.monthly_limit_cents) : 'None') },
        { key: 'active', label: 'Status', render: (a) => (a.status === 'pending' ? <Chip tone="ochre">Application</Chip> : a.status === 'declined' ? <Chip>Declined</Chip> : a.active ? <Chip tone="green">Active</Chip> : <Chip>Closed</Chip>) },
        { key: 'x', label: '', render: (a) => <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={(e) => { e.stopPropagation(); setOpen(a); }}>Members & statement</button> },
      ]} />
  );
}

const NEEDS: Record<string, string> = { cost_centres: 'Cost centres', approvals: 'Approvals', po_numbers: 'PO numbers', ndis: 'NDIS invoices', recurring: 'Regular trips', parcels: 'Parcels' };
function Applications() {
  const [status, setStatus] = useState('pending');
  const { data, error, reload } = useLoad(() => get<any>(`/admin/business/applications?status=${status}`), [status]);
  const run = useRun(); const ask = useAsk();
  const [open, setOpen] = useState<any>(null);
  const [terms, setTerms] = useState({ invoice_terms_days: 14, monthly_limit: '', discount_pct: 0 });
  return (
    <Section title="Applications from the website" right={<select className="dg-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Show" style={{ width: 'auto' }}>
      <option value="pending">Waiting</option><option value="approved">Approved</option><option value="declined">Declined</option></select>}>
      <ErrorMsg error={error} />
      {data && !data.ready && <p className="dg-muted">Needs database migration 027.</p>}
      <Table rows={data?.applications} empty="No applications." onRow={(a) => setOpen(a)} cols={[
        { key: 'applied_at', label: 'Applied', render: (a) => dateTime(a.applied_at) }, { key: 'name', label: 'Organisation', render: (a) => <strong>{a.name}</strong> },
        { key: 'kind', label: 'Type', render: (a) => KIND[a.kind] ?? a.kind }, { key: 'abn', label: 'ABN' },
        { key: 'contact_name', label: 'Contact', render: (a) => `${a.contact_name ?? ''} ${a.contact_phone ?? ''}` },
        { key: 'spend', label: 'Expected a month', num: true, render: (a) => (a.application?.expected_monthly_cents ? money(a.application.expected_monthly_cents) : '') },
        { key: 'needs', label: 'Needs', render: (a) => (a.application?.needs ?? []).map((n: string) => NEEDS[n] ?? n).join(', ') },
      ]} />
      {open && (
        <Drawer title={open.name} onClose={() => setOpen(null)}>
          <dl className="kv">
            <dt>Reference</dt><dd>{open.application?.ref}</dd><dt>Type</dt><dd>{KIND[open.kind] ?? open.kind}</dd><dt>ABN</dt><dd>{open.abn} <a href={`https://abr.business.gov.au/ABN/View?abn=${open.abn}`} target="_blank" rel="noreferrer">Check on the ABR</a></dd>
            <dt>Billing email</dt><dd>{open.billing_email}</dd><dt>Address</dt><dd>{open.address ?? ''}</dd><dt>Contact</dt><dd>{open.contact_name}, {open.contact_phone}</dd>
            <dt>Notes</dt><dd>{open.application?.notes ?? ''}</dd>{open.review_note && <><dt>Review note</dt><dd>{open.review_note}</dd></>}
          </dl>
          {open.status === 'pending' && (<>
            <div className="grid2" style={{ marginTop: 12 }}>
              <label className="dg-field"><span>Payment terms (days)</span><input className="dg-input" type="number" min={0} max={120} value={terms.invoice_terms_days} onChange={(e) => setTerms({ ...terms, invoice_terms_days: Number(e.target.value) })} /></label>
              <label className="dg-field"><span>Monthly limit $ (optional)</span><input className="dg-input" type="number" min={0} value={terms.monthly_limit} onChange={(e) => setTerms({ ...terms, monthly_limit: e.target.value })} /></label>
              <label className="dg-field"><span>Discount %</span><input className="dg-input" type="number" min={0} max={50} value={terms.discount_pct} onChange={(e) => setTerms({ ...terms, discount_pct: Number(e.target.value) })} /></label>
            </div>
            <div className="toolbar">
              <button className="dg-btn dg-btn--sm dg-btn--dark" onClick={async () => {
                if (await run(() => post(`/admin/business/applications/${open.id}/review`, { approve: true, invoice_terms_days: terms.invoice_terms_days, discount_pct: terms.discount_pct,
                  monthly_limit_cents: terms.monthly_limit ? Math.round(Number(terms.monthly_limit) * 100) : null }), 'Approved. The contact is the manager and has been texted.')) { setOpen(null); void reload(); }
              }}>Approve</button>
              <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={async () => {
                const note = await ask({ title: 'Decline application', label: 'Reason (texted to the applicant)' });
                if (note && await run(() => post(`/admin/business/applications/${open.id}/review`, { approve: false, note }), 'Declined')) { setOpen(null); void reload(); }
              }}>Decline</button>
            </div>
          </>)}
        </Drawer>
      )}
    </Section>
  );
}

const lastMonth = () => { const d = darwinMonth(); const y = +d.slice(0, 4), m = +d.slice(5, 7); return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, '0')}`; };
function Invoices() {
  const [month, setMonth] = useState(lastMonth());
  const [status, setStatus] = useState('all');
  const { data, error, reload } = useLoad(() => get<any>(`/admin/business/invoices?month=${month}&status=${status}`), [month, status]);
  const run = useRun(); const ask = useAsk(); const toast = useToast();
  const s = data?.summary;
  return (
    <Section title="Monthly invoices" right={<div className="toolbar" style={{ margin: 0 }}>
      <input className="dg-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Month" style={{ width: 'auto' }} />
      <select className="dg-input" value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status" style={{ width: 'auto' }}>
        <option value="all">All</option><option value="issued">Unpaid</option><option value="overdue">Overdue</option><option value="paid">Paid</option><option value="void">Void</option></select>
    </div>}>
      <ErrorMsg error={error} />
      {data && !data.ready && <p className="dg-muted">Needs database migration 027.</p>}
      {s && <p className="dg-muted">{s.open} unpaid ({money(s.open_cents)}), {s.overdue} overdue ({money(s.overdue_cents)}).</p>}
      <div className="toolbar">
        <button className="dg-btn dg-btn--sm dg-btn--dark" onClick={async () => {
          const r = await run(() => post<any>('/admin/business/invoices/run', { month }));
          if (r) { void reload(); toast(`${r.issued.length} invoice${r.issued.length === 1 ? '' : 's'} issued${r.skipped.length ? `, ${r.skipped.length} skipped` : ''}`); }
        }}>Issue invoices for {month}</button>
        <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadFile(`/admin/business/invoices/export?month=${month}&format=xero`), 'Xero file downloaded')}>Xero CSV</button>
        <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadFile(`/admin/business/invoices/export?month=${month}&format=myob`), 'MYOB file downloaded')}>MYOB CSV</button>
        <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={async () => { const r = await run(() => post<any>('/admin/business/reminders/run', {})); if (r) { void reload(); toast(`${r.sent.length} reminder${r.sent.length === 1 ? '' : 's'} sent`); } }}>Send due reminders</button>
      </div>
      <Table rows={data?.invoices} empty="No invoices for this month." cols={[
        { key: 'number', label: 'Invoice', render: (i) => <strong>{i.number}</strong> }, { key: 'account', label: 'Account' }, { key: 'po_number', label: 'PO' },
        { key: 'issued_on', label: 'Issued' }, { key: 'due_on', label: 'Due' },
        { key: 'total_cents', label: 'Total', num: true, render: (i) => money(i.total_cents) },
        { key: 'status', label: 'Status', render: (i) => (i.status === 'paid' ? <Chip tone="green">Paid {i.paid_on}</Chip> : i.status === 'void' ? <Chip>Void</Chip>
          : i.overdue_days > 0 ? <Chip tone="red">{i.overdue_days} days overdue{i.reminders ? `, ${i.reminders} reminder${i.reminders === 1 ? '' : 's'}` : ''}</Chip> : <Chip tone="ochre">Unpaid</Chip>) },
        { key: 'x', label: '', render: (i) => (
          <span className="toolbar" style={{ margin: 0 }}>
            <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadFile(`/admin/business/invoices/${i.id}?format=pdf`))}>PDF</button>
            {i.status === 'issued' && <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={async () => {
              const ref = await ask({ title: `Mark ${i.number} paid`, label: 'Payment reference (e.g. EFT number)' });
              if (ref !== null && await run(() => post(`/admin/business/invoices/${i.id}/paid`, { paid_ref: ref || null }), 'Marked paid')) void reload();
            }}>Paid</button>}
            {i.status === 'issued' && <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={async () => {
              const reason = await ask({ title: `Void ${i.number}`, label: 'Reason (then issue it again for the month)' });
              if (reason && await run(() => post(`/admin/business/invoices/${i.id}/void`, { reason }), 'Voided')) void reload();
            }}>Void</button>}
          </span>) },
      ]} />
      <p className="dg-muted" style={{ fontSize: '.85rem' }}>Xero: Sales, Import, choose "Tax inclusive". MYOB AccountRight: File, Import data, Sales, Service sales. Check the account codes in Billing settings first.</p>
    </Section>
  );
}

function Billing() {
  const { data, error, reload } = useLoad(() => get<any>('/admin/business/billing'), []);
  const [f, setF] = useState<any>(null);
  const run = useRun();
  const v = f ?? data?.settings;
  if (!v) return <ErrorMsg error={error} />;
  const set = (k: string, val: unknown) => setF({ ...v, [k]: val });
  return (
    <Section title="Billing settings">
      {data && !data.ready && <p className="dg-muted">Needs database migration 027.</p>}
      <label className="dg-check"><input type="checkbox" checked={v.auto_issue} onChange={(e) => set('auto_issue', e.target.checked)} /><span>Issue last month's invoices automatically on the 1st (Darwin time)</span></label>
      <div className="grid2">
        <label className="dg-field"><span>Reminder days overdue (comma separated)</span><input className="dg-input" value={(v.reminder_days ?? []).join(', ')}
          onChange={(e) => set('reminder_days', e.target.value.split(',').map((x) => Number(x.trim())).filter((x) => x > 0))} /></label>
        <label className="dg-field"><span>Pause new bookings after this many days overdue (0 = never)</span><input className="dg-input" type="number" min={0} max={180} value={v.hold_after_days} onChange={(e) => set('hold_after_days', Number(e.target.value))} /></label>
        <label className="dg-field"><span>Xero account code</span><input className="dg-input" value={v.xero_account_code} onChange={(e) => set('xero_account_code', e.target.value)} /></label>
        <label className="dg-field"><span>Xero tax type</span><input className="dg-input" value={v.xero_tax_type} onChange={(e) => set('xero_tax_type', e.target.value)} /></label>
        <label className="dg-field"><span>MYOB income account</span><input className="dg-input" value={v.myob_income_account} onChange={(e) => set('myob_income_account', e.target.value)} /></label>
        <label className="dg-field"><span>MYOB tax code</span><input className="dg-input" value={v.myob_tax_code} onChange={(e) => set('myob_tax_code', e.target.value)} /></label>
      </div>
      <label className="dg-field"><span>How to pay (printed on every invoice)</span><textarea className="dg-input" rows={3} value={v.pay_to} maxLength={400} onChange={(e) => set('pay_to', e.target.value)} placeholder="EFT to DingoGo Pty Ltd, BSB 000-000, account 00000000, reference: the invoice number" /></label>
      <button className="dg-btn dg-btn--sm dg-btn--dark" disabled={!f} onClick={async () => { if (await run(() => put('/admin/business/billing', f), 'Saved')) { setF(null); void reload(); } }}>Save</button>
    </Section>
  );
}

function AccountSetup({ accountId }: { accountId: string }) {
  const { data, error } = useLoad(() => get<any>(`/admin/business/accounts/${accountId}`).catch((e) => { if (e?.status === 503) return null; throw e; }), [accountId]);
  if (error) return <ErrorMsg error={error} />;
  if (!data) return null;
  const r = data.rules;
  const rules = [r.require_cost_centre && 'cost centre required', r.require_purpose && 'purpose required', r.require_po && 'PO required', r.default_po && `standing PO ${r.default_po}`,
    r.approval_over_cents > 0 && `approval over ${money(r.approval_over_cents)}`, r.invoice_per_po && 'one invoice per PO', r.require_ndis_number && 'NDIS number required',
    `book for others: ${r.book_for_others}`, r.guests ? 'guests allowed' : 'no guests'].filter(Boolean).join(', ');
  return (<>
    <h3>Set-up</h3>
    <p className="dg-muted">Rules: {rules}. The account's managers change these in the rider app (Account, Business account).</p>
    <Table rows={data.cost_centres} empty="No cost centres." cols={[{ key: 'code', label: 'Cost centre' }, { key: 'name', label: 'Name' }, { key: 'approver_name', label: 'Approver' },
      { key: 'monthly_budget_cents', label: 'Budget', num: true, render: (c: any) => (c.monthly_budget_cents ? money(c.monthly_budget_cents) : '') }]} />
    {data.recurring.length > 0 && (<>
      <h3>Regular trips</h3>
      <Table rows={data.recurring} cols={[{ key: 'ref', label: 'Series' }, { key: 'traveller', label: 'Traveller' }, { key: 'days', label: 'Days', render: (s: any) => `${s.days} ${s.pickup_time}${s.return_time ? ` / ${s.return_time}` : ''}` },
        { key: 'upcoming', label: 'Booked', num: true }, { key: 'active', label: 'Status', render: (s: any) => (s.active ? <Chip tone="green">On</Chip> : <Chip>{s.stopped_reason ?? 'Stopped'}</Chip>) }]} />
    </>)}
  </>);
}

/** This month in Darwin time (statements are by local month). */
const darwinMonth = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Australia/Darwin', year: 'numeric', month: '2-digit' }).format(new Date()).slice(0, 7);

function Statement({ account, onClose }: { account: any; onClose: () => void }) {
  const [month, setMonth] = useState(darwinMonth());
  const { data, error, reload } = useLoad(() => get(`/admin/corporate/${account.id}/statement?month=${month}`), [month]);
  const [phone, setPhone] = useState('');
  const run = useRun();
  return (
    <Drawer title={account.name} onClose={onClose} actions={<button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => print()}>Print</button>}>
      <ErrorMsg error={error} />
      <h3>Members</h3>
      <Table rows={data?.members} empty="No members yet." cols={[{ key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'role', label: 'Role' }]} />
      <form className="toolbar no-print" style={{ marginTop: 10 }} onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => post(`/admin/corporate/${account.id}/members`, { phone, role: 'member' }), 'Member added')) { setPhone(''); void reload(); }
      }}>
        <input className="dg-input" type="tel" placeholder="Member's mobile (must have signed up)" value={phone} onChange={(e) => setPhone(e.target.value)} required aria-label="Member mobile" />
        <button className="dg-btn dg-btn--sm dg-btn--dark">Add member</button>
      </form>
      <AccountSetup accountId={account.id} />
      <div style={{ display: 'flex', alignItems: 'end', gap: 10, marginTop: 20 }}>
        <h3 style={{ flex: 1, margin: 0 }}>Statement</h3>
        <input className="dg-input no-print" type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }} aria-label="Month" />
        {data && <button className="dg-btn dg-btn--sm dg-btn--ghost no-print" onClick={() => exportCsv(`${account.name}-${month}.csv`, data.lines)}>CSV</button>}
      </div>
      {data && (<>
        {data.limit && <p className={data.limit.left_cents > 0 ? 'dg-muted' : 'dg-error'}>Monthly limit {money(data.limit.limit_cents)}: {money(data.limit.used_cents)} used (booked trips count at their price), {money(data.limit.left_cents)} left. Bookings over the limit are refused.</p>}
        <p className="dg-muted">Tax invoice period {data.month}. Payment due within {data.account.invoice_terms_days} days. {data.account.abn && `Customer ABN ${data.account.abn}.`}</p>
        <Table rows={data.lines} rowKey={(l) => l.ref} empty="No completed trips this month." cols={[
          { key: 'ref', label: 'Trip' }, { key: 'completed_at', label: 'Date', render: (l) => dateTime(l.completed_at) }, { key: 'rider', label: 'Rider' },
          { key: 'route', label: 'Route', render: (l) => <span style={{ fontSize: '.85rem' }}>{l.pickup_address} to {l.dropoff_address}</span> },
          ...(account.kind === 'ndis_plan_manager' ? [{ key: 'ndis_number', label: 'NDIS no.' }] : []),
          { key: 'final_cents', label: 'Amount', num: true, render: (l: any) => money(l.final_cents) },
          ...(data.refunds_cents > 0 ? [{ key: 'refunded_cents', label: 'Refunded', num: true, render: (l: any) => (l.refunded_cents ? `−${money(l.refunded_cents)}` : '') }] : []),
        ]} />
        <dl className="kv" style={{ marginTop: 12, justifyContent: 'end' }}>
          {data.refunds_cents > 0 && <><dt>Trips and fees</dt><dd className="dg-money">{money(data.charges_cents)}</dd><dt>Refunds</dt><dd className="dg-money">−{money(data.refunds_cents)}</dd></>}
          <dt>Total incl. GST</dt><dd className="dg-money">{money(data.total_cents)}</dd><dt>GST included</dt><dd className="dg-money">{money(data.gst_cents)}</dd>
        </dl>
      </>)}
    </Drawer>
  );
}
