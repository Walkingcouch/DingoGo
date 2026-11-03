import { useState } from 'react';
import { get, post, money, date, dateTime, useLoad } from '@dingogo/shared';
import { Page } from '../ctx';
import { Chip, CrudSection, ErrorMsg, Section, Table, Tabs, exportCsv, useRun } from '../ui';

export default function Loyalty() {
  const [tab, setTab] = useState<'partners' | 'rewards' | 'redemptions' | 'vouchers'>('partners');
  const partners = useLoad(() => get('/admin/partners'));
  const opts: [string, string][] = (partners.data?.items ?? []).map((p: any) => [p.id, p.name]);
  return (
    <Page title="Loyalty & vouchers">
      <Tabs tabs={[['partners', 'Partner cafés'], ['rewards', 'Rewards'], ['redemptions', 'Redemptions & settlement'], ['vouchers', 'Prepaid vouchers']]} value={tab} onChange={setTab} />
      {tab === 'partners' && <CrudSection title="Partners" path="partners" newLabel="Add partner" fields={[
        { key: 'name', label: 'Business name', required: true }, { key: 'kind', label: 'Type', type: 'select', required: true, options: [['cafe', 'Café'], ['shop', 'Shop'], ['community', 'Community organisation'], ['other', 'Other']] },
        { key: 'address', label: 'Address', full: true }, { key: 'lat', label: 'Latitude', type: 'number', step: 0.0001 }, { key: 'lng', label: 'Longitude', type: 'number', step: 0.0001 },
        { key: 'phone', label: 'Phone', type: 'tel' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'logo_url', label: 'Logo URL', full: true },
        { key: 'settlement_cents_per_redemption', label: 'DingoGo pays per redemption', type: 'money', help: 'What we reimburse the partner for each reward served' },
        { key: 'aboriginal_owned', label: 'Aboriginal-owned business', type: 'bool' }, { key: 'active', label: 'Active', type: 'bool' },
      ]} cols={[
        { key: 'name', label: 'Partner', render: (p) => <strong>{p.name}</strong> }, { key: 'kind', label: 'Type' }, { key: 'address', label: 'Address' },
        { key: 'settlement_cents_per_redemption', label: 'Paid per redemption', num: true, render: (p) => money(p.settlement_cents_per_redemption) },
        { key: 'aboriginal_owned', label: '', render: (p) => p.aboriginal_owned && <Chip tone="ochre">Aboriginal-owned</Chip> },
        { key: 'active', label: 'Status', render: (p) => (p.active ? <Chip tone="green">Active</Chip> : <Chip>Inactive</Chip>) },
      ]} describe={<p className="dg-muted" style={{ marginTop: 0 }}>Partner staff sign in to the partner portal with a user whose role is "partner" and is linked to the business (Settings, users).</p>} />}
      {tab === 'rewards' && <CrudSection title="Rewards" path="rewards" newLabel="Add reward" fields={[
        { key: 'title', label: 'Reward', required: true }, { key: 'points_cost', label: 'Points needed', type: 'number', required: true },
        { key: 'kind', label: 'Type', type: 'select', required: true, options: [['voucher', 'Partner voucher (code shown at counter)'], ['ride_credit', 'DingoGo ride credit']] },
        { key: 'partner_id', label: 'Partner (for vouchers)', type: 'select', options: opts }, { key: 'credit_cents', label: 'Ride credit amount', type: 'money' },
        { key: 'description', label: 'Description', full: true }, { key: 'active', label: 'Available', type: 'bool' },
      ]} cols={[
        { key: 'title', label: 'Reward', render: (r) => <strong>{r.title}</strong> }, { key: 'partner', label: 'Partner', render: (r) => opts.find(([id]) => id === r.partner_id)?.[1] ?? 'DingoGo' },
        { key: 'points_cost', label: 'Points', num: true }, { key: 'value', label: 'Credit', num: true, render: (r) => (r.kind === 'ride_credit' ? money(r.credit_cents) : '—') },
        { key: 'active', label: 'Status', render: (r) => (r.active ? <Chip tone="green">Available</Chip> : <Chip>Off</Chip>) },
      ]} />}
      {tab === 'redemptions' && <Redemptions />}
      {tab === 'vouchers' && <Vouchers partners={opts} />}
    </Page>
  );
}

function Redemptions() {
  const { data, error } = useLoad(() => get('/admin/redemptions'));
  return (<>
    <ErrorMsg error={error} />
    <Section title="Owed to partners this month" right={data && <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => exportCsv('partner-settlement.csv', data.settlement)}>Export CSV</button>} />
    <Table rows={data?.settlement} empty="No rewards redeemed this month yet." cols={[
      { key: 'name', label: 'Partner' }, { key: 'redeemed', label: 'Redeemed', num: true }, { key: 'owed_cents', label: 'Owed', num: true, render: (r) => <strong>{money(r.owed_cents)}</strong> },
    ]} />
    <Section title="All reward codes" />
    <Table rows={data?.items} cols={[
      { key: 'code', label: 'Code', render: (r) => <strong>{r.code}</strong> }, { key: 'title', label: 'Reward' }, { key: 'partner_name', label: 'Partner' },
      { key: 'user_name', label: 'Customer' }, { key: 'issued_at', label: 'Issued', render: (r) => date(r.issued_at) },
      { key: 'status', label: 'Status', render: (r) => <Chip tone={r.status === 'redeemed' ? 'green' : r.status === 'issued' ? 'ochre' : ''}>{r.status}</Chip> },
      { key: 'redeemed_at', label: 'Redeemed', render: (r) => dateTime(r.redeemed_at) },
    ]} />
  </>);
}

function Vouchers({ partners }: { partners: [string, string][] }) {
  const { data, reload } = useLoad(() => get('/admin/vouchers'));
  const [f, setF] = useState({ count: '20', value: '20', batch: `batch-${new Date().toISOString().slice(0, 10)}`, partner_id: '' });
  const [codes, setCodes] = useState<string[] | null>(null);
  const run = useRun();
  return (<>
    <p className="dg-muted" style={{ maxWidth: 760 }}>Prepaid voucher cards let customers without a bank card pay for trips. Print a batch, sell them at partner shops or community organisations, and customers add the code in the app (Wallet) or a dispatcher adds it for phone bookings.</p>
    <form className="panel no-print" onSubmit={async (e) => {
      e.preventDefault();
      const r = await run(() => post('/admin/vouchers', { count: Number(f.count), value_cents: Math.round(Number(f.value) * 100), batch: f.batch, partner_id: f.partner_id || undefined }), 'Vouchers created');
      if (r) { setCodes(r.codes); void reload(); }
    }}>
      <h3>Create a batch</h3>
      <div className="form-grid">
        <label className="dg-field"><span>How many</span><input className="dg-input" type="number" min={1} max={500} value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} /></label>
        <label className="dg-field"><span>Value each ($)</span><input className="dg-input" type="number" min={5} max={200} step={5} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></label>
        <label className="dg-field"><span>Batch name</span><input className="dg-input" value={f.batch} onChange={(e) => setF({ ...f, batch: e.target.value })} /></label>
        <label className="dg-field"><span>Selling partner (optional)</span><select className="dg-select" value={f.partner_id} onChange={(e) => setF({ ...f, partner_id: e.target.value })}><option value="">Any</option>{partners.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
      </div>
      <button className="dg-btn dg-btn--sm dg-btn--dark">Create vouchers</button>
    </form>
    {codes && (
      <div className="panel" style={{ marginTop: 14 }}>
        <div className="actions no-print"><button className="dg-btn dg-btn--sm" onClick={() => print()}>Print cards</button></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, marginTop: 10 }}>
          {codes.map((c) => (
            <div key={c} style={{ border: '2px dashed var(--line)', borderRadius: 10, padding: 12, breakInside: 'avoid' }}>
              <strong style={{ fontFamily: 'var(--font-display)' }}>DingoGo credit ${f.value}</strong>
              <div style={{ fontSize: '1.3rem', fontWeight: 700, letterSpacing: '.08em', margin: '6px 0' }}>{c}</div>
              <small>Add in the DingoGo app under Wallet, or quote it when you call to book.</small>
            </div>
          ))}
        </div>
      </div>
    )}
    <Section title="Vouchers" right={data && <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => exportCsv('vouchers.csv', data.items)}>Export CSV</button>} />
    <Table rows={data?.items} rowKey={(v) => v.code} cols={[
      { key: 'code', label: 'Code', render: (v) => <strong>{v.code}</strong> }, { key: 'value_cents', label: 'Value', num: true, render: (v) => money(v.value_cents) },
      { key: 'batch', label: 'Batch' }, { key: 'partner_name', label: 'Sold by' }, { key: 'sold_at', label: 'Sold', render: (v) => date(v.sold_at) },
      { key: 'redeemed_at', label: 'Used', render: (v) => (v.redeemed_at ? date(v.redeemed_at) : <Chip tone="green">Unused</Chip>) },
      { key: 'expires_at', label: 'Expires', render: (v) => date(v.expires_at) },
    ]} />
  </>);
}
