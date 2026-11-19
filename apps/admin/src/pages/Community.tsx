import { useEffect, useState } from 'react';
import { date, get, post, put, useLoad, money } from '@dingogo/shared';
import { Chip, Empty, ErrorMsg, Section, Table, useAsk, useRun } from '../ui';

/** Pricing → Community: concession fares (off by default, DingoGo-funded) and the concession card queue. */
export default function Community() {
  return (<>
    <Rules />
    <Queue />
  </>);
}

function Rules() {
  const { data, error, reload } = useLoad(() => get('/admin/community-pricing'));
  const [v, setV] = useState<any>(null);
  const run = useRun();
  useEffect(() => { if (data) setV(structuredClone(data.settings)); }, [data]);
  if (!v) return <ErrorMsg error={error} />;
  const types: [string, string][] = Object.entries(data!.types);
  const toggle = (list: string[], x: string, on: boolean) => (on ? [...new Set([...list, x])] : list.filter((y) => y !== x));
  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (await run(() => put('/admin/community-pricing', v), 'Community pricing saved')) void reload();
  }
  return (
    <form onSubmit={save} style={{ maxWidth: 900 }}>
      <Section title="Concession fares" right={v.enabled ? <Chip tone="green">On</Chip> : <Chip>Off</Chip>} />
      <p className="dg-muted" style={{ marginTop: 0 }}>Riders with a checked concession card get a percentage off the fare and booking fee (not the levy or fuel surcharge). DingoGo pays the difference: drivers are paid on the full fare. Riders send the card type, last 4 digits and expiry; you check them below.</p>
      {!data!.ready && <p className="dg-note">Needs database migration 017 before riders can send cards.</p>}
      <label className="dg-check"><input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} /><span>Offer concession fares</span></label>
      <div className="form-grid">
        <label className="dg-field"><span>Percent off</span><input className="dg-input" type="number" min={0} max={75} value={v.concession_pct} onChange={(e) => setV({ ...v, concession_pct: Math.round(Number(e.target.value)) })} /></label>
        <label className="dg-field"><span>Most off one trip ($, 0 = no cap)</span><input className="dg-input" type="number" min={0} max={100} step="0.5" value={(v.concession_max_cents / 100).toFixed(2)}
          onChange={(e) => setV({ ...v, concession_max_cents: Math.round(Number(e.target.value) * 100) })} /></label>
      </div>
      <fieldset className="block"><legend>Services</legend>
        {[['ride', 'Rides'], ['pet', 'Pet rides'], ['courier_s', 'Small parcels'], ['courier_m', 'Medium parcels'], ['courier_l', 'Large parcels']].map(([k, l]) => (
          <label key={k} className="dg-check"><input type="checkbox" checked={v.services.includes(k)} onChange={(e) => setV({ ...v, services: toggle(v.services, k, e.target.checked) })} /><span>{l}</span></label>
        ))}
      </fieldset>
      <fieldset className="block"><legend>Cards accepted</legend>
        {types.map(([k, l]) => (
          <label key={k} className="dg-check"><input type="checkbox" checked={v.types.includes(k)} onChange={(e) => setV({ ...v, types: toggle(v.types, k, e.target.checked) })} /><span>{l}</span></label>
        ))}
      </fieldset>
      <button className="dg-btn">Save</button>
    </form>
  );
}

function Queue() {
  const [status, setStatus] = useState('pending');
  const { data, error, reload } = useLoad(() => get(`/admin/concessions?status=${status}`), [status]);
  const types = useLoad(() => get('/admin/community-pricing'));
  const run = useRun();
  const ask = useAsk();
  async function review(id: string, s: 'approved' | 'rejected') {
    let note: string | undefined;
    if (s === 'rejected') { note = (await ask({ title: 'Why not approved?', label: 'Reason the rider will see', required: true })) ?? undefined; if (!note) return; }
    if (await run(() => post(`/admin/concessions/${id}/review`, { status: s, note }), s === 'approved' ? 'Approved' : 'Not approved')) void reload();
  }
  return (<>
    <Section title="Concession cards" right={
      <select className="dg-select" aria-label="Show" value={status} onChange={(e) => setStatus(e.target.value)}>
        <option value="pending">Waiting for a check</option><option value="approved">Approved</option><option value="rejected">Not approved</option><option value="all">All</option>
      </select>} />
    <ErrorMsg error={error} />
    {data && !data.ready && <Empty>Needs database migration 017.</Empty>}
    {data?.ready && !data.items.length ? <Empty>Nothing here.</Empty> : data?.ready && (
      <Table rows={data.items} cols={[
        { key: 'name', label: 'Rider', render: (u: any) => <><strong>{u.name}</strong><div className="dg-muted">{u.phone}</div></> },
        { key: 'card', label: 'Card', render: (u: any) => `${types.data?.types?.[u.concession.type] ?? u.concession.type} ending ${u.concession.last4}` },
        { key: 'exp', label: 'Expires', render: (u: any) => date(u.concession.expires) },
        { key: 'st', label: 'Status', render: (u: any) => <Chip tone={u.concession.status === 'approved' ? 'green' : u.concession.status === 'rejected' ? 'red' : undefined}>{u.concession.status}</Chip> },
        { key: 'x', label: '', render: (u: any) => u.concession.status === 'pending' && (<span style={{ display: 'flex', gap: 6 }}>
          <button className="dg-btn dg-btn--sm" onClick={() => review(u.id, 'approved')}>Approve</button>
          <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => review(u.id, 'rejected')}>Not approved</button></span>) },
      ]} />
    )}
    <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>Ask to see the card if you need to. Never write down the whole card number. Example saving: 50% off a {money(2000)} ride is {money(1000)}.</p>
  </>);
}
