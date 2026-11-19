import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, PARCEL_OUTCOME_LABEL, PROHIBITED_ITEMS, apiBase, dateTime, get, getToken, money, post, time } from '@dingogo/shared';
import { PlaceField, type Place } from '../components/PlaceField';
import { useMe } from '../ctx';

/** Business deliveries: what's been sent (managers see the whole account), a multi-drop run for one driver, and CSV import. */
export function BusinessScreen() {
  const { me } = useMe();
  const accounts: any[] = me?.corporate_accounts ?? [];
  const [account, setAccount] = useState<string>(accounts[0]?.id ?? '');
  const [tab, setTab] = useState<'list' | 'run' | 'csv'>('list');
  useEffect(() => { if (!account && accounts[0]) setAccount(accounts[0].id); }, [accounts.length]); // eslint-disable-line
  return (
    <div className="page">
      <header className="page__head">
        <Link to="/account" className="iconbtn" aria-label="Back to account"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 5l-7 7 7 7" /></svg></Link>
        <h1>Business deliveries</h1>
      </header>
      {accounts.length > 0 && (
        <label className="dg-field"><span>Business account</span>
          <select className="dg-input" value={account} onChange={(e) => setAccount(e.target.value)}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}{a.role === 'manager' ? ' (manager)' : ''}</option>)}
            <option value="">My own deliveries</option>
          </select></label>
      )}
      <div className="seg" role="group" aria-label="Business deliveries">
        {([['list', 'Deliveries'], ['run', 'Send several'], ['csv', 'Import a spreadsheet']] as const).map(([k, l]) =>
          <button key={k} type="button" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'list' && <Deliveries account={account} />}
      {tab === 'run' && <RunForm account={account} onDone={() => setTab('list')} />}
      {tab === 'csv' && <CsvImport account={account} onDone={() => setTab('list')} />}
    </div>
  );
}

function Deliveries({ account }: { account: string }) {
  const [status, setStatus] = useState('all');
  const [qs, setQs] = useState('');
  const [data, setData] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const params = new URLSearchParams({ status, ...(account ? { account_id: account } : {}), ...(qs.trim() ? { q: qs.trim() } : {}) }).toString();
  useEffect(() => {
    let live = true;
    get(`/business/deliveries?${params}`).then((r) => { if (live) { setData(r); setErr(null); } }).catch((e) => live && setErr(e instanceof ApiError ? e.message : 'Could not load deliveries'));
    return () => { live = false; };
  }, [params]);
  async function exportCsv() {
    const res = await fetch(`${apiBase()}/business/deliveries.csv?${params}`, { headers: { authorization: `Bearer ${getToken()}` } });
    if (!res.ok) { setErr('Could not download the file'); return; }
    const url = URL.createObjectURL(await res.blob());
    const a = Object.assign(document.createElement('a'), { href: url, download: `dingogo-deliveries.csv` });
    a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  const s = data?.summary;
  return (
    <section aria-labelledby="dl-h">
      <h2 id="dl-h" className="sr-only">Deliveries</h2>
      <div className="grid2">
        <label className="dg-field"><span>Show</span>
          <select className="dg-input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option><option value="active">On the way or booked</option><option value="done">Finished</option><option value="problem">Not delivered or not sent</option>
          </select></label>
        <label className="dg-field"><span>Search</span><input className="dg-input" placeholder="Ref, name, address or your reference" value={qs} onChange={(e) => setQs(e.target.value)} /></label>
      </div>
      {s && (
        <p className="biz-sum" role="status">
          <span className="dg-chip">{s.total} shown</span><span className="dg-chip">{s.active} on the way</span>
          <span className="dg-chip dg-chip--green">{s.delivered} delivered</span>{s.returned > 0 && <span className="dg-chip dg-chip--ochre">{s.returned} returned</span>}
          <span className="dg-chip">{money(s.spent_cents)} spent</span>
        </p>
      )}
      {data?.manager && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>You manage this account, so you see deliveries booked by everyone on it.</p>}
      {err && <p className="dg-error" role="alert">{err}</p>}
      {data && !data.deliveries.length && <p className="dg-muted">No deliveries yet.</p>}
      {data?.deliveries.length > 0 && (
        <div style={{ overflowX: 'auto' }} tabIndex={0} aria-label="Deliveries table">
          <table className="biz-table">
            <thead><tr><th>Delivery</th><th>To</th><th>Status</th><th>Price</th></tr></thead>
            <tbody>
              {data.deliveries.map((d: any) => (
                <tr key={d.id}>
                  <td><Link to={`/trips/${d.id}`}>{d.ref}</Link>{d.customer_ref && <><br /><span className="dg-muted">{d.customer_ref}</span></>}{d.run_ref && <><br /><span className="dg-muted">{d.run_ref} #{d.batch_seq}</span></>}
                    <br /><span className="dg-muted">{dateTime(d.scheduled_for ?? d.requested_at)}</span></td>
                  <td>{d.recipient_name}<br /><span className="dg-muted">{d.dropoff_address}</span></td>
                  <td>{d.outcome ? PARCEL_OUTCOME_LABEL[d.outcome] ?? d.outcome : d.status.replace(/_/g, ' ')}
                    {d.eta_at && !d.delivered_at && !d.outcome && <><br /><span className="dg-muted">About {time(d.eta_at)}</span></>}
                    {d.failed_reason && <><br /><span className="dg-muted">{d.failed_reason}</span></>}
                    {d.proof && <><br /><span className="dg-muted">Proof: {d.proof}</span></>}</td>
                  <td className="dg-money">{money(d.final_cents ?? d.quote_cents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 12 }} onClick={exportCsv}>Download as a spreadsheet (CSV)</button>
    </section>
  );
}

/** Sender details and the checklist, shared by the run form and the CSV import. */
function useSender(account: string) {
  const { me } = useMe();
  const [pickup, setPickup] = useState<Place | null>(null);
  const [name, setName] = useState(me?.corporate_accounts?.find((a: any) => a.id === account)?.name ?? me?.user.name ?? '');
  const [phone, setPhone] = useState(me?.user.phone ?? '');
  const [when, setWhen] = useState('');
  const [windowH, setWindowH] = useState(2);
  const [ticked, setTicked] = useState<string[]>([]);
  const all = PROHIBITED_ITEMS.every((i) => ticked.includes(i.key));
  const base = () => ({
    pickup, sender_name: name.trim(), sender_phone: phone.trim(), prohibited_items: ticked,
    payment_method: account ? 'corporate' : 'card', corporate_account_id: account || null,
    scheduled_for: when ? new Date(when).toISOString() : null,
    pickup_window_end: when && windowH ? new Date(new Date(when).getTime() + windowH * 3600_000).toISOString() : null,
  });
  const fields = (
    <>
      <PlaceField label="Collect from" dot="A" value={pickup} onChange={setPickup} placeholder="Your shop or office" />
      <div className="grid2">
        <label className="dg-field"><span>Sender name</span><input className="dg-input" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} /></label>
        <label className="dg-field"><span>Sender phone</span><input className="dg-input" inputMode="tel" value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={20} /></label>
        <label className="dg-field"><span>Collect at (leave empty for now)</span><input className="dg-input" type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} /></label>
        {when && <label className="dg-field"><span>Pickup window</span>
          <select className="dg-input" value={windowH} onChange={(e) => setWindowH(Number(e.target.value))}>
            <option value={0}>At that time</option><option value={1}>Within 1 hour</option><option value={2}>Within 2 hours</option><option value={4}>Within 4 hours</option>
          </select></label>}
      </div>
      <fieldset className={`prohibited-list ${all ? 'is-ok' : ''}`}>
        <legend><strong>Prohibited items check</strong> for every parcel. Drivers can check and refuse.</legend>
        {PROHIBITED_ITEMS.map((i) => (
          <label key={i.key} className="dg-check"><input type="checkbox" checked={ticked.includes(i.key)} onChange={(e) => setTicked((t) => e.target.checked ? [...t, i.key] : t.filter((k) => k !== i.key))} />
            <span>No {i.title.charAt(0).toLowerCase() + i.title.slice(1)}</span></label>
        ))}
      </fieldset>
    </>
  );
  const missing = [!pickup && 'where to collect from', !name.trim() && 'the sender name', phone.replace(/\D/g, '').length < 8 && 'the sender phone', !all && 'every line of the prohibited items check'].filter(Boolean) as string[];
  return { base, fields, missing };
}

type Drop = { place: Place | null; name: string; phone: string; size: 'S' | 'M' | 'L'; ref: string; leave: boolean; safe: string };
const emptyDrop = (): Drop => ({ place: null, name: '', phone: '', size: 'S', ref: '', leave: false, safe: '' });

function RunForm({ account, onDone }: { account: string; onDone: () => void }) {
  const sender = useSender(account);
  const [drops, setDrops] = useState<Drop[]>([emptyDrop(), emptyDrop()]);
  const [quote, setQuote] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (i: number, d: Partial<Drop>) => setDrops((x) => x.map((o, k) => (k === i ? { ...o, ...d } : o)));
  const ready = drops.every((d) => d.place && d.name.trim() && d.phone.replace(/\D/g, '').length >= 10);
  const b = sender.base();
  useEffect(() => {
    setQuote(null);
    if (!b.pickup || !drops.every((d) => d.place)) return;
    const t = setTimeout(() => post('/courier/runs/quote', { pickup: b.pickup, scheduled_for: b.scheduled_for, corporate_account_id: b.corporate_account_id,
      drops: drops.map((d) => ({ dropoff: d.place, size: d.size })) }).then(setQuote).catch(() => setQuote(null)), 400);
    return () => clearTimeout(t);
  }, [JSON.stringify(drops.map((d) => [d.place, d.size])), JSON.stringify(b.pickup), b.scheduled_for]); // eslint-disable-line
  async function book() {
    setBusy(true); setErr(null); setMsg(null);
    try {
      const r = await post('/courier/runs', { ...b, drops: drops.map((d) => ({ dropoff: d.place, parcel: {
        size: d.size, description: 'Parcel', recipient_name: d.name.trim(), recipient_phone: d.phone.trim(), customer_ref: d.ref.trim() || undefined,
        leave_unattended: d.leave, safe_place: d.leave ? d.safe.trim() || undefined : undefined } })) });
      setMsg(`Run ${r.batch.ref} booked: ${r.trips.length} drops for one driver.`);
      setTimeout(onDone, 1500);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not book. Try again.'); } finally { setBusy(false); }
  }
  const missing = [...sender.missing, !ready && 'an address, name and mobile for every drop'].filter(Boolean);
  return (
    <section aria-labelledby="run-h">
      <h2 id="run-h">Send several parcels with one driver</h2>
      <p className="dg-muted">One pickup, up to 10 drops. We work out the best order. Extra drops have no base fare or booking fee.</p>
      {sender.fields}
      {drops.map((d, i) => (
        <fieldset key={i} className="biz-drop">
          <legend>Drop {i + 1}</legend>
          <PlaceField label="Deliver to" dot="B" value={d.place} onChange={(p) => set(i, { place: p })} placeholder="Recipient's address" />
          <div className="grid2">
            <label className="dg-field"><span>Recipient name</span><input className="dg-input" value={d.name} maxLength={80} onChange={(e) => set(i, { name: e.target.value })} /></label>
            <label className="dg-field"><span>Recipient mobile</span><input className="dg-input" inputMode="tel" value={d.phone} maxLength={20} onChange={(e) => set(i, { phone: e.target.value })} /></label>
            <label className="dg-field"><span>Size</span><select className="dg-input" value={d.size} onChange={(e) => set(i, { size: e.target.value as Drop['size'] })}>
              <option value="S">Small, up to 5 kg</option><option value="M">Medium, up to 15 kg</option><option value="L">Large, up to 25 kg</option></select></label>
            <label className="dg-field"><span>Your reference</span><input className="dg-input" value={d.ref} maxLength={40} onChange={(e) => set(i, { ref: e.target.value })} /></label>
          </div>
          <label className="dg-check"><input type="checkbox" checked={d.leave} onChange={(e) => set(i, { leave: e.target.checked })} /><span>OK to leave it if nobody's home</span></label>
          {d.leave && <label className="dg-field"><span>Where to leave it</span><input className="dg-input" value={d.safe} maxLength={120} onChange={(e) => set(i, { safe: e.target.value })} /></label>}
          {drops.length > 2 && <button type="button" className="linkbtn" onClick={() => setDrops((x) => x.filter((_, k) => k !== i))}>Remove drop {i + 1}</button>}
        </fieldset>
      ))}
      {drops.length < 10 && <button type="button" className="dg-btn dg-btn--ghost dg-btn--block" onClick={() => setDrops((x) => [...x, emptyDrop()])}>Add another drop</button>}
      {quote && <p role="status" style={{ marginTop: 12 }}><strong>{money(quote.total_cents)}</strong> for {quote.stops.length} drops ({(quote.distance_m / 1000).toFixed(1)} km). Each drop is invoiced separately.</p>}
      {err && <p className="dg-error" role="alert">{err}</p>}
      {msg && <p className="callout callout--green" role="status">{msg}</p>}
      <button className="dg-btn dg-btn--block" style={{ marginTop: 12 }} aria-disabled={busy || missing.length > 0 || undefined} onClick={() => !busy && !missing.length && book()}>{busy ? 'Booking…' : 'Book the run'}</button>
      {missing.length > 0 && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>To book, add {missing.join(', ')}.</p>}
    </section>
  );
}

function CsvImport({ account, onDone }: { account: string; onDone: () => void }) {
  const sender = useSender(account);
  const [csv, setCsv] = useState('');
  const [preview, setPreview] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function send(dry: boolean) {
    setBusy(true); setErr(null);
    try {
      const r = await post('/business/deliveries/import', { ...sender.base(), csv, dry_run: dry });
      setPreview(r);
      if (r.booked) setTimeout(onDone, 1500);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not read the file');
      if (e instanceof ApiError && Array.isArray((e as any).details)) setPreview({ errors: (e as any).details, drops: [], runs: [] });
    } finally { setBusy(false); }
  }
  async function onFile(f?: File) { if (f) { setCsv(await f.text()); setPreview(null); } }
  const missing = [...sender.missing, !csv.trim() && 'a CSV file'].filter(Boolean);
  return (
    <section aria-labelledby="csv-h">
      <h2 id="csv-h">Import deliveries from a spreadsheet</h2>
      <p className="dg-muted">Save your spreadsheet as CSV with a header row. Needed: <code>recipient_name</code>, <code>recipient_phone</code> (a mobile) and <code>address</code>.
        Optional: <code>lat</code>, <code>lng</code>, <code>size</code> (S, M or L), <code>weight_kg</code>, <code>description</code>, <code>instructions</code>, <code>safe_place</code>,
        <code> requires_signature</code>, <code>reference</code>. Up to 50 rows, booked as runs of up to 10 drops.</p>
      {sender.fields}
      <label className="dg-field"><span>CSV file</span><input className="dg-input" type="file" accept=".csv,text/csv" onChange={(e) => onFile(e.target.files?.[0])} /></label>
      <button className="dg-btn dg-btn--ghost dg-btn--block" disabled={busy || !csv.trim() || !sender.base().pickup} onClick={() => send(true)}>{busy ? 'Checking…' : 'Check the file'}</button>
      {err && <p className="dg-error" role="alert">{err}</p>}
      {preview && (
        <div role="status" style={{ marginTop: 12 }}>
          {preview.errors?.length > 0 && (
            <div className="callout callout--earth"><strong>Fix these rows, then check again:</strong>
              <ul>{preview.errors.map((x: any) => <li key={`${x.row}-${x.error}`}>Row {x.row}: {x.error}</li>)}</ul></div>
          )}
          {preview.drops?.length > 0 && !preview.errors?.length && (
            <p>{preview.booked ? 'Booked: ' : ''}<strong>{preview.drops.length} deliveries</strong> in {preview.runs.length} run{preview.runs.length > 1 ? 's' : ''}, {money(preview.total_cents)} in total.</p>
          )}
        </div>
      )}
      {preview && !preview.booked && !preview.errors?.length && preview.drops?.length > 0 && (
        <button className="dg-btn dg-btn--block" disabled={busy || missing.length > 0} onClick={() => send(false)}>{busy ? 'Booking…' : `Book ${preview.drops.length} deliveries`}</button>
      )}
      {missing.length > 0 && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>To import, add {missing.join(', ')}.</p>}
    </section>
  );
}
