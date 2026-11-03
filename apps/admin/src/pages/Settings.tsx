import { useEffect, useState } from 'react';
import { get, patch, post, put, dateTime, useLoad } from '@dingogo/shared';
import { Page } from '../ctx';
import { Chip, ErrorMsg, Section, Table, Tabs, useRun } from '../ui';

export default function Settings() {
  const [tab, setTab] = useState<'settings' | 'broadcast' | 'users' | 'audit'>('settings');
  return (
    <Page title="Settings & broadcast">
      <Tabs tabs={[['settings', 'Settings'], ['broadcast', 'Broadcast'], ['users', 'Users & roles'], ['audit', 'Audit log']]} value={tab} onChange={setTab} />
      {tab === 'settings' && <SettingsForm />}
      {tab === 'broadcast' && <Broadcast />}
      {tab === 'users' && <Users />}
      {tab === 'audit' && <Audit />}
    </Page>
  );
}

function SettingsForm() {
  const { data, error, reload } = useLoad(() => get('/admin/settings'));
  const [v, setV] = useState<any>(null);
  const run = useRun();
  useEffect(() => {
    if (!data) return;
    const m = Object.fromEntries(data.items.map((s: any) => [s.key, s.value]));
    setV({ business: m.business ?? {}, support: m.support ?? {}, nt_levy_cents: m.nt_levy_cents ?? 100, home_tariff_cents_per_kwh: m.home_tariff_cents_per_kwh ?? 30, roof_display: m.roof_display ?? { mode: 'ads' } });
  }, [data]);
  if (!v) return <ErrorMsg error={error} />;
  const setIn = (k: string, f: string, x: any) => setV({ ...v, [k]: { ...v[k], [f]: x } });
  async function save(e: React.FormEvent) {
    e.preventDefault();
    for (const k of ['business', 'support', 'nt_levy_cents', 'home_tariff_cents_per_kwh', 'roof_display']) {
      const r = await run(() => put(`/admin/settings/${k}`, { value: v[k] }));
      if (!r) return;
    }
    run(async () => 1, 'Settings saved'); void reload();
  }
  const txt = (k: string, f: string, label: string) => <label className="dg-field"><span>{label}</span><input className="dg-input" value={v[k][f] ?? ''} onChange={(e) => setIn(k, f, e.target.value)} /></label>;
  return (
    <form onSubmit={save} style={{ maxWidth: 860 }}>
      <Section title="Business details (printed on tax invoices)" />
      <div className="form-grid">{txt('business', 'name', 'Trading name')}{txt('business', 'legal_name', 'Legal name')}{txt('business', 'abn', 'ABN')}{txt('business', 'address', 'Address')}{txt('business', 'email', 'Email')}{txt('business', 'owners', 'Owners')}</div>
      <Section title="Customer support" />
      <div className="form-grid">{txt('support', 'phone', 'Phone')}{txt('support', 'email', 'Email')}{txt('support', 'hours', 'Hours')}</div>
      <Section title="Rates" />
      <div className="form-grid">
        <label className="dg-field"><span>NT passenger levy per trip ($)</span><input className="dg-input" type="number" step="0.01" value={(Number(v.nt_levy_cents) / 100).toFixed(2)} onChange={(e) => setV({ ...v, nt_levy_cents: Math.round(Number(e.target.value) * 100) })} /></label>
        <label className="dg-field"><span>Home charging tariff (cents per kWh)</span><input className="dg-input" type="number" value={v.home_tariff_cents_per_kwh} onChange={(e) => setV({ ...v, home_tariff_cents_per_kwh: Number(e.target.value) })} /><small className="dg-muted">Used to reimburse drivers for charging at home.</small></label>
      </div>
      <Section title="Roof screens" />
      <div className="form-grid">
        <label className="dg-field"><span>Mode</span><select className="dg-select" value={v.roof_display.mode} onChange={(e) => setIn('roof_display', 'mode', e.target.value)}><option value="ads">Show approved campaigns</option><option value="off">Off (screens dark)</option></select></label>
        <label className="dg-field full"><span>Compliance note shown to staff</span><textarea className="dg-textarea" value={v.roof_display.note ?? ''} onChange={(e) => setIn('roof_display', 'note', e.target.value)} /></label>
      </div>
      <button className="dg-btn">Save settings</button>
    </form>
  );
}

function Broadcast() {
  const [f, setF] = useState({ audience: 'riders_opted_in', title: '', body: '' });
  const run = useRun();
  return (
    <form className="panel" style={{ maxWidth: 640 }} onSubmit={async (e) => {
      e.preventDefault();
      if (!confirm(`Send "${f.title}" to ${f.audience === 'drivers' ? 'all approved drivers' : 'riders who opted in to offers'}?`)) return;
      const r = await run(() => post('/admin/broadcast', f));
      if (r) { alert(`Sent to ${r.sent} people.`); setF({ ...f, title: '', body: '' }); }
    }}>
      <p className="dg-muted" style={{ marginTop: 0 }}>Offers only go to riders who opted in, and every message says it is from DingoGo and how to turn offers off (Spam Act 2003).</p>
      <label className="dg-field"><span>Send to</span><select className="dg-select" value={f.audience} onChange={(e) => setF({ ...f, audience: e.target.value })}><option value="riders_opted_in">Riders who opted in to offers</option><option value="drivers">All approved drivers</option></select></label>
      <label className="dg-field"><span>Title</span><input className="dg-input" maxLength={60} required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
      <label className="dg-field"><span>Message</span><textarea className="dg-textarea" maxLength={240} required value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /><small className="dg-muted">{240 - f.body.length} characters left</small></label>
      <button className="dg-btn">Send message</button>
    </form>
  );
}

function Users() {
  const [q, setQ] = useState('');
  const [search, setSearch] = useState('');
  const { data, reload } = useLoad(() => get(`/admin/users?q=${encodeURIComponent(search)}`), [search]);
  const partners = useLoad(() => get('/admin/partners'));
  const run = useRun();
  const roles = ['rider', 'driver', 'admin', 'dispatcher', 'partner', 'corporate_admin'];
  return (<>
    <form className="toolbar" onSubmit={(e) => { e.preventDefault(); setSearch(q); }}>
      <input className="dg-input" placeholder="Name, phone or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" style={{ minWidth: 260 }} />
      <button className="dg-btn dg-btn--sm dg-btn--dark">Search</button>
    </form>
    <Table rows={data?.users} cols={[
      { key: 'name', label: 'Name', render: (u) => <><strong>{u.name || 'No name'}</strong>{u.blocked && <> <Chip tone="red">Blocked</Chip></>}</> },
      { key: 'phone', label: 'Phone' }, { key: 'trips', label: 'Trips', num: true }, { key: 'loyalty_points', label: 'Points', num: true },
      { key: 'role', label: 'Role', render: (u) => (
        <select className="dg-select" style={{ minHeight: 34, padding: '2px 6px' }} value={u.role} aria-label="Role"
          onChange={async (e) => { if (confirm(`Change ${u.name}'s role to ${e.target.value}?`)) { await run(() => patch(`/admin/users/${u.id}`, { role: e.target.value }), 'Role updated'); void reload(); } }}>
          {roles.map((r) => <option key={r}>{r}</option>)}
        </select>) },
      { key: 'partner', label: 'Partner business', render: (u) => u.role === 'partner' ? (
        <select className="dg-select" style={{ minHeight: 34, padding: '2px 6px' }} value={u.partner_id ?? ''} aria-label="Partner"
          onChange={async (e) => { await run(() => patch(`/admin/users/${u.id}`, { partner_id: e.target.value || null }), 'Partner linked'); void reload(); }}>
          <option value="">None</option>{partners.data?.items.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>) : null },
      { key: 'x', label: '', render: (u) => <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={async () => {
        const pts = prompt(`Add (or subtract with -) Dingo Points for ${u.name}:`); if (pts && Number(pts)) { await run(() => patch(`/admin/users/${u.id}`, { add_points: Number(pts) }), 'Points adjusted'); void reload(); }
      }}>Adjust points</button> },
    ]} />
  </>);
}

function Audit() {
  const { data } = useLoad(() => get('/admin/audit'));
  return <Table rows={data?.items} empty="No admin actions recorded yet." cols={[
    { key: 'at', label: 'When', nowrap: true, render: (a) => dateTime(a.at) }, { key: 'actor_name', label: 'Who' }, { key: 'action', label: 'Action' },
    { key: 'entity', label: 'What', render: (a) => `${a.entity ?? ''} ${a.entity_id ? String(a.entity_id).slice(0, 12) : ''}` },
    { key: 'data', label: 'Details', render: (a) => <code style={{ fontSize: '.78rem', wordBreak: 'break-all' }}>{a.data ? JSON.stringify(a.data).slice(0, 160) : ''}</code> },
  ]} />;
}
