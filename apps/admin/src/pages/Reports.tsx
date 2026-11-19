import { useState } from 'react';
import { dateTime, get, money, monthName, useLoad } from '@dingogo/shared';
import { Link } from 'react-router-dom';
import { PAYMENT_ROW_STATUS, label } from '../labels';
import { Page } from '../ctx';
import { ErrorMsg, Section, Table, downloadCsv, downloadFile, useRun } from '../ui';

const KIND: Record<string, string> = { topup: 'Credit top-ups', capture: 'Card fares', cash: 'Cash fares', invoice: 'Account invoices', subscription: 'DingoGo Pass', refund: 'Refunds', tip: 'Tips (passed to drivers)' };

export default function Reports() {
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const levy = useLoad(() => get(`/admin/reports/levy?month=${month}`), [month]);
  const today = new Date().toISOString().slice(0, 10);
  const [range, setRange] = useState({ from: new Date(Date.now() - 90 * 864e5).toISOString().slice(0, 10), to: today });
  const gst = useLoad(() => get(`/admin/reports/gst?from=${range.from}&to=${range.to}`), [range.from, range.to]);
  const l = levy.data;
  const run = useRun();
  const g = gst.data;
  const issues = useLoad(() => get('/admin/payments/issues'), []);
  const integ = useLoad(() => get('/admin/integrations').catch(() => null), []);
  const on = (k: string) => integ.data?.[k] === 'configured';
  return (
    <Page title="Reports">
      <Section title="Payment problems" />
      <p className="dg-muted" style={{ marginTop: 0, maxWidth: 780 }}>Card payments that didn't go through (the rider is asked to pay in the app; open the trip to retry) and disputes (chargebacks) still open in Stripe. Reply to disputes in the Stripe dashboard before the due date.</p>
      {integ.data && <p className="dg-muted" role="status">Card payments: {on('payments') ? 'Stripe connected' : 'test payments only (Stripe not set up)'}
        {on('payments') && `, webhook ${on('payments_webhook') ? 'set up' : 'not set up (hold lapses, dashboard refunds and disputes are not seen)'}, card form in the app ${on('card_elements') ? 'on' : 'off (needs the publishable key)'}`}.</p>}
      {integ.data && <p className="dg-muted">Texts: {on('sms') ? 'Twilio connected' : 'off (sign-in codes only in demo mode)'}{on('sms') && `, replies and STOP ${on('sms_replies') ? 'handled' : 'not handled (no reply number)'}, masked calls ${on('sms_relay') ? 'on' : 'off (in-app messages only)'}`}.
        {' '}Push: {[on('push_fcm') && 'Android', on('push_web') && 'web app', on('push_expo') && 'Expo'].filter(Boolean).join(', ') || 'off (in-app inbox only)'}.</p>}
      <ErrorMsg error={issues.error} />
      {issues.data && (<>
        <h3>Failed payments</h3>
        <Table rows={issues.data.failed} rowKey={(r) => r.id} empty="No failed payments." cols={[
          { key: 'ref', label: 'Trip', render: (r) => <Link to={`/trips?open=${r.id}`}>{r.ref}</Link> }, { key: 'rider_name', label: 'Rider' },
          { key: 'at', label: 'When', render: (r) => (r.at ? dateTime(r.at) : '') }, { key: 'reason', label: 'Reason', render: (r) => r.reason ?? '' },
          { key: 'cents', label: 'Amount', num: true, render: (r) => money(r.cents) },
        ]} />
        <h3 style={{ marginTop: 14 }}>Open disputes</h3>
        <Table rows={issues.data.disputes} rowKey={(r) => r.id} empty="No open disputes." cols={[
          { key: 'ref', label: 'Trip', render: (r) => (r.trip_id ? <Link to={`/trips?open=${r.trip_id}`}>{r.ref}</Link> : r.dispute_ref) }, { key: 'rider_name', label: 'Rider' },
          { key: 'status', label: 'Status', render: (r) => label(PAYMENT_ROW_STATUS, r.status) }, { key: 'created_at', label: 'Opened', render: (r) => dateTime(r.created_at) },
          { key: 'cents', label: 'Amount', num: true, render: (r) => money(r.cents) },
          { key: 'evidence', label: 'Evidence', render: (r) => (r.trip_id ? <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadFile(`/admin/trips/${r.trip_id}/evidence-pack?format=pdf`), "Evidence pack downloaded")}>Evidence pack</button> : '—') },
        ]} />
      </>)}

      <Section title="NT passenger services levy" right={<input className="dg-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} aria-label="Levy month" style={{ width: 'auto', minHeight: 38 }} />} />
      <p className="dg-muted" style={{ marginTop: 0, maxWidth: 780 }}>As an approved dispatch network, DingoGo lodges and pays $1 for every completed passenger trip each month. Courier jobs are not passenger trips. Under-reporting is an offence, so lodge from this report.</p>
      <ErrorMsg error={levy.error} />
      {l && (<>
        <div className="kpis">
          <div className="kpi"><b>{l.passenger_trips}</b><span>Completed passenger trips</span></div>
          <div className="kpi"><b>{money(l.levy_rate_cents)}</b><span>Levy per trip</span></div>
          <div className="kpi"><b>{money(l.levy_payable_cents)}</b><span>Levy payable for {monthName(l.month)}</span></div>
          <div className="kpi"><b>{money(l.levy_collected_cents)}</b><span>Collected from riders</span></div>
        </div>
        <div className="actions" style={{ marginTop: 10 }}><button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadCsv(`/admin/export/levy.csv?month=${l.month}&state=${l.state}`), 'Levy return downloaded')}>Export levy return CSV</button></div>
        <div style={{ marginTop: 12 }}><Table rows={l.per_driver} rowKey={(r) => r.name} empty="No passenger trips this month." cols={[{ key: 'name', label: 'Driver' }, { key: 'trips', label: 'Passenger trips', num: true }]} /></div>
      </>)}

      <Section title="GST summary" right={<span style={{ display: 'flex', gap: 6 }}>
        <input className="dg-input" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} aria-label="From" style={{ width: 'auto', minHeight: 38 }} />
        <input className="dg-input" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} aria-label="To" style={{ width: 'auto', minHeight: 38 }} />
      </span>} />
      <p className="dg-muted" style={{ marginTop: 0, maxWidth: 780 }}>Fares are collected on behalf of drivers, who are each registered for GST. DingoGo's own taxable supply is its service fee to drivers, plus Pass subscriptions. Confirm the treatment with your accountant before lodging a BAS. Quarterly BAS worksheets, drivers’ statements, the ATO SERR report and levy returns are in <Link to="/tax">Tax &amp; compliance</Link>.</p>
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

      <SystemHealth />
    </Page>
  );
}

/** Round 10: GET /health/deep for staff — schema version, pending migrations, last auto-migrate, base data, RLS, integrations. */
function SystemHealth() {
  const h = useLoad(() => get('/health/deep'), []);
  const d = h.data;
  const yes = (b: boolean) => (b ? 'yes' : 'no');
  return (<>
    <Section title="System health" right={<button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => void h.reload()}>Check again</button>} />
    <ErrorMsg error={h.error} />
    {d && (<div role="status">
      <p style={{ marginTop: 0 }}><strong>{d.status === 'ok' ? 'All good.' : d.status === 'down' ? 'Database unreachable.' : 'Needs attention:'}</strong>
        {d.problems?.length ? ' ' + d.problems.map((p: string) => p.replace(/_/g, ' ')).join(', ') + '.' : ''} Release {String(d.release).slice(0, 12)}, {d.environment}.</p>
      <div className="kpis">
        <div className="kpi"><b>{d.db?.ok ? `${d.db.ms} ms` : 'down'}</b><span>Database</span></div>
        <div className="kpi"><b>{d.schema?.version?.replace(/\.sql$/, '') ?? '—'}</b><span>Schema version{d.schema?.pending?.length ? ` (${d.schema.pending.length} pending)` : ''}</span></div>
        <div className="kpi"><b>{d.base_data ? `${d.base_data.active_zones} / ${d.base_data.fare_rules} / ${d.base_data.admins}` : '—'}</b><span>Zones / fares / admins</span></div>
        <div className="kpi"><b>{d.security?.tables_without_rls ? d.security.tables_without_rls.length : '—'}</b><span>Tables without RLS</span></div>
      </div>
      {d.schema?.pending?.length > 0 && <p className="dg-muted">Pending migrations: {d.schema.pending.join(', ')}. {d.auto_migrate?.enabled ? 'AUTO_MIGRATE is on: they apply at the next cold start.' : 'Apply with npm run db:migrate (or set AUTO_MIGRATE=true).'}</p>}
      {d.auto_migrate?.last?.error && <p className="dg-error">Last auto-migrate failed at {d.auto_migrate.last.error.migration}: {d.auto_migrate.last.error.message}</p>}
      <p className="dg-muted">Auto-migrate: {d.auto_migrate?.enabled ? 'on' : 'off'}{d.auto_migrate?.last ? `, last run ${dateTime(d.auto_migrate.last.at)} (${d.auto_migrate.last.applied.length} applied)` : ''}. Error reporting: {d.integrations?.error_reporting === 'configured' ? 'Sentry' : 'off (logs only)'}. Supabase client roles locked out: {yes(!d.security?.client_role_grants?.length)}.</p>
    </div>)}
  </>);
}
