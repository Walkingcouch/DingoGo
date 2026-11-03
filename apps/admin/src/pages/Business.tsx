import { useState } from 'react';
import { get, post, money, dateTime, useLoad } from '@dingogo/shared';
import { Page } from '../ctx';
import { Chip, CrudSection, Drawer, ErrorMsg, Table, exportCsv, useRun } from '../ui';

const KIND: Record<string, string> = { business: 'Business', ndis_plan_manager: 'NDIS plan manager', community_org: 'Community organisation', government: 'Government' };

export default function Business() {
  const [open, setOpen] = useState<any>(null);
  return (
    <Page title="Business accounts">
      <p className="dg-muted" style={{ marginTop: 0, maxWidth: 780 }}>Members book on the account and trips are invoiced monthly. NDIS plan managers receive tax invoices showing the participant's NDIS number for transport claims.</p>
      <CrudSection title="Accounts" path="corporate" newLabel="New account" fields={[
        { key: 'name', label: 'Organisation', required: true }, { key: 'kind', label: 'Type', type: 'select', required: true, options: Object.entries(KIND) },
        { key: 'abn', label: 'ABN' }, { key: 'billing_email', label: 'Billing email', type: 'email', required: true },
        { key: 'monthly_limit_cents', label: 'Monthly limit', type: 'money' }, { key: 'invoice_terms_days', label: 'Payment terms (days)', type: 'number' },
        { key: 'discount_pct', label: 'Account discount (%)', type: 'number', min: 0, max: 50 }, { key: 'active', label: 'Active', type: 'bool' },
      ]} cols={[
        { key: 'name', label: 'Organisation', render: (a) => <strong>{a.name}</strong> }, { key: 'kind', label: 'Type', render: (a) => KIND[a.kind] ?? a.kind },
        { key: 'billing_email', label: 'Billing email' }, { key: 'discount_pct', label: 'Discount', num: true, render: (a) => `${a.discount_pct}%` },
        { key: 'monthly_limit_cents', label: 'Limit', num: true, render: (a) => (a.monthly_limit_cents ? money(a.monthly_limit_cents) : 'None') },
        { key: 'active', label: 'Status', render: (a) => (a.active ? <Chip tone="green">Active</Chip> : <Chip>Closed</Chip>) },
        { key: 'x', label: '', render: (a) => <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={(e) => { e.stopPropagation(); setOpen(a); }}>Members & statement</button> },
      ]} />
      {open && <Statement account={open} onClose={() => setOpen(null)} />}
    </Page>
  );
}

function Statement({ account, onClose }: { account: any; onClose: () => void }) {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
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
      <div style={{ display: 'flex', alignItems: 'end', gap: 10, marginTop: 20 }}>
        <h3 style={{ flex: 1, margin: 0 }}>Statement</h3>
        <input className="dg-input no-print" type="month" value={month} onChange={(e) => setMonth(e.target.value)} style={{ width: 'auto' }} aria-label="Month" />
        {data && <button className="dg-btn dg-btn--sm dg-btn--ghost no-print" onClick={() => exportCsv(`${account.name}-${month}.csv`, data.lines)}>CSV</button>}
      </div>
      {data && (<>
        <p className="dg-muted">Tax invoice period {data.month}. Payment due within {data.account.invoice_terms_days} days. {data.account.abn && `Customer ABN ${data.account.abn}.`}</p>
        <Table rows={data.lines} rowKey={(l) => l.ref} empty="No completed trips this month." cols={[
          { key: 'ref', label: 'Trip' }, { key: 'completed_at', label: 'Date', render: (l) => dateTime(l.completed_at) }, { key: 'rider', label: 'Rider' },
          { key: 'route', label: 'Route', render: (l) => <span style={{ fontSize: '.85rem' }}>{l.pickup_address} to {l.dropoff_address}</span> },
          ...(account.kind === 'ndis_plan_manager' ? [{ key: 'ndis_number', label: 'NDIS no.' }] : []),
          { key: 'final_cents', label: 'Amount', num: true, render: (l: any) => money(l.final_cents) },
        ]} />
        <dl className="kv" style={{ marginTop: 12, justifyContent: 'end' }}>
          <dt>Total incl. GST</dt><dd className="dg-money">{money(data.total_cents)}</dd><dt>GST included</dt><dd className="dg-money">{money(data.gst_cents)}</dd>
        </dl>
      </>)}
    </Drawer>
  );
}
