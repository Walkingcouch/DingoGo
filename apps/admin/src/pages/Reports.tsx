import { useState } from 'react';
import { get, money, useLoad } from '@dingogo/shared';
import { Page } from '../ctx';
import { ErrorMsg, Section, Table, downloadCsv, useRun } from '../ui';

const KIND: Record<string, string> = { capture: 'Card fares', cash: 'Cash fares', invoice: 'Account invoices', subscription: 'DingoGo Pass', refund: 'Refunds', tip: 'Tips (passed to drivers)' };

export default function Reports() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const levy = useLoad(() => get(`/admin/reports/levy?month=${month}`), [month]);
  const today = new Date().toISOString().slice(0, 10);
  const [range, setRange] = useState({ from: new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10), to: today });
  const gst = useLoad(() => get(`/admin/reports/gst?from=${range.from}&to=${range.to}`), [range.from, range.to]);
  const l = levy.data;
  const run = useRun();
  const g = gst.data;
  return (
    <Page title="Reports">
      <Section title="NT passenger services levy" right={<input className="dg-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Levy month" style={{ width: 'auto', minHeight: 38 }} />} />
      <p className="dg-muted" style={{ marginTop: 0, maxWidth: 780 }}>As an approved dispatch network, DingoGo lodges and pays $1 for every completed passenger trip each month. Courier jobs are not passenger trips. Under-reporting is an offence, so lodge from this report.</p>
      <ErrorMsg error={levy.error} />
      {l && (<>
        <div className="kpis">
          <div className="kpi"><b>{l.passenger_trips}</b><span>Completed passenger trips</span></div>
          <div className="kpi"><b>{money(l.levy_rate_cents)}</b><span>Levy per trip</span></div>
          <div className="kpi"><b>{money(l.levy_payable_cents)}</b><span>Levy payable for {l.month}</span></div>
          <div className="kpi"><b>{money(l.levy_collected_cents)}</b><span>Collected from riders</span></div>
        </div>
        <div className="actions" style={{ marginTop: 10 }}><button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadCsv(`/admin/export/levy.csv?month=${l.month}&state=${l.state}`), 'Levy return downloaded')}>Export levy return CSV</button></div>
        <div style={{ marginTop: 12 }}><Table rows={l.per_driver} rowKey={(r) => r.name} empty="No passenger trips this month." cols={[{ key: 'name', label: 'Driver' }, { key: 'trips', label: 'Passenger trips', num: true }]} /></div>
      </>)}

      <Section title="GST summary" right={<span style={{ display: 'flex', gap: 6 }}>
        <input className="dg-input" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="From" style={{ width: 'auto', minHeight: 38 }} />
        <input className="dg-input" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="To" style={{ width: 'auto', minHeight: 38 }} />
      </span>} />
      <p className="dg-muted" style={{ marginTop: 0, maxWidth: 780 }}>Fares are collected on behalf of drivers, who are each registered for GST. DingoGo's own taxable supply is its service fee to drivers, plus Pass subscriptions. Confirm the treatment with your accountant before lodging a BAS.</p>
      <ErrorMsg error={gst.error} />
      {g && (<>
        <Table rows={g.rows} rowKey={(r) => r.kind + r.provider} cols={[
          { key: 'kind', label: 'Type', render: (r) => KIND[r.kind] ?? r.kind }, { key: 'provider', label: 'Via' }, { key: 'n', label: 'Count', num: true },
          { key: 'amount_cents', label: 'Amount incl. GST', num: true, render: (r) => money(r.amount_cents) }, { key: 'gst_cents', label: 'GST', num: true, render: (r) => money(r.gst_cents) },
        ]} />
        <div className="kpis" style={{ marginTop: 12 }}>
          <div className="kpi"><b>{money(g.dingogo_service_fees_cents)}</b><span>DingoGo service fees</span></div>
          <div className="kpi"><b>{money(g.gst_on_service_fees_cents)}</b><span>GST on service fees</span></div>
        </div>
        <div className="actions" style={{ marginTop: 10 }}><button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadCsv(`/admin/export/gst.csv?from=${g.from}&to=${g.to}`), 'GST summary downloaded')}>Export GST CSV</button></div>
      </>)}
    </Page>
  );
}
