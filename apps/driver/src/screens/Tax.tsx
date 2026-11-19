import { useEffect, useState } from 'react';
import { ApiError, Icon, downloadFile, get, money, put, useLoad } from '@dingogo/shared';

/** Round 16: tax details for the ATO's Sharing Economy Reporting Regime, and the quarterly GST statement + fee tax invoice. */
const STATES = ['NT', 'SA', 'WA', 'QLD', 'NSW', 'ACT', 'VIC', 'TAS'];
const darwin = () => new Date(Date.now() + 9.5 * 3600e3);
function quarters(n: number) {
  const out: string[] = []; const d = darwin(); let y = d.getUTCFullYear(); let q = Math.floor(d.getUTCMonth() / 3) + 1;
  for (let i = 0; i < n; i++) { out.push(`${y}-Q${q}`); q--; if (!q) { q = 4; y--; } }
  return out;
}
const QLABEL: Record<string, string> = { 1: 'Jan–Mar', 2: 'Apr–Jun', 3: 'Jul–Sep', 4: 'Oct–Dec' };
const qLabel = (k: string) => `${QLABEL[k.slice(-1)]} ${k.slice(0, 4)}`;

export function TaxDetails({ onSaved }: { onSaved?: () => void }) {
  const { data, error, reload } = useLoad(() => get('/driver/tax-details'), []);
  const [f, setF] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);
  useEffect(() => { if (data) setF((x: any) => x ?? { ...data.details, abn: data.details.abn ?? '' }); }, [data]);
  if (!f) return error ? <p className="dg-error">{error}</p> : null;
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  const entity = f.seller_type === 'entity';
  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setOk(false);
    const body: any = { seller_type: f.seller_type || 'individual', address_line: f.address_line || null, suburb: f.suburb || null,
      postcode: f.postcode || null, address_state: f.address_state || null, gst_registered: !!f.gst_registered };
    if (f.abn) body.abn = f.abn;
    if (f.email) body.email = f.email;
    if (entity) body.business_name = f.business_name || null;
    else Object.assign(body, { given_name: f.given_name || null, family_name: f.family_name || null, date_of_birth: f.date_of_birth || null });
    if (!data!.ready) for (const k of ['seller_type', 'address_line', 'suburb', 'postcode', 'address_state', 'business_name', 'given_name', 'family_name', 'date_of_birth']) delete body[k];
    try { await put('/driver/tax-details', body); setOk(true); await reload(); onSaved?.(); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not save'); }
  }
  const missing: string[] = data!.missing ?? [];
  return (
    <form onSubmit={save} aria-labelledby="taxd-h">
      <h3 id="taxd-h">Tax details</h3>
      <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>{data!.why}</p>
      {missing.length > 0 && <p className="dg-note" role="status">Still needed: {missing.join(', ')}.</p>}
      {data!.ready && (
        <fieldset className="choice-set"><legend>You drive as</legend>
          <div className="seg">
            <button type="button" aria-pressed={!entity} onClick={() => setF({ ...f, seller_type: 'individual' })}>Myself (sole trader)</button>
            <button type="button" aria-pressed={entity} onClick={() => setF({ ...f, seller_type: 'entity' })}>A company or trust</button>
          </div>
        </fieldset>
      )}
      {data!.ready && (entity
        ? <label className="dg-field"><span>Business name</span><input className="dg-input" value={f.business_name ?? ''} onChange={set('business_name')} autoComplete="organization" /></label>
        : (<>
          <label className="dg-field"><span>Given name (as on your ID)</span><input className="dg-input" value={f.given_name ?? ''} onChange={set('given_name')} autoComplete="given-name" /></label>
          <label className="dg-field"><span>Family name</span><input className="dg-input" value={f.family_name ?? ''} onChange={set('family_name')} autoComplete="family-name" /></label>
          <label className="dg-field"><span>Date of birth</span><input className="dg-input" type="date" value={f.date_of_birth ?? ''} onChange={set('date_of_birth')} autoComplete="bday" /></label>
        </>))}
      <label className="dg-field"><span>ABN</span><input className="dg-input" inputMode="numeric" value={f.abn ?? ''} onChange={set('abn')} placeholder="11 digits" />
        {f.abn && data!.details.abn === f.abn.replace(/\s/g, '') && !data!.details.abn_ok && <small className="dg-error">This ABN doesn’t pass the ATO check.</small>}</label>
      <label className="dg-check"><input type="checkbox" checked={!!f.gst_registered} onChange={(e) => setF({ ...f, gst_registered: e.target.checked })} /><span>I’m registered for GST (rideshare drivers must be, from the first trip)</span></label>
      <label className="dg-field"><span>Email</span><input className="dg-input" type="email" value={f.email ?? ''} onChange={set('email')} autoComplete="email" /></label>
      {data!.ready && (<>
        <label className="dg-field"><span>Street address</span><input className="dg-input" value={f.address_line ?? ''} onChange={set('address_line')} autoComplete="address-line1" /></label>
        <label className="dg-field"><span>Suburb or town</span><input className="dg-input" value={f.suburb ?? ''} onChange={set('suburb')} autoComplete="address-level2" /></label>
        <div style={{ display: 'flex', gap: 8 }}>
          <label className="dg-field" style={{ flex: 1 }}><span>State</span><select className="dg-input" value={f.address_state ?? ''} onChange={set('address_state')}><option value="">Choose</option>{STATES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className="dg-field" style={{ flex: 1 }}><span>Postcode</span><input className="dg-input" inputMode="numeric" maxLength={4} value={f.postcode ?? ''} onChange={set('postcode')} autoComplete="postal-code" /></label>
        </div>
      </>)}
      {!data!.details.has_bank && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>Add your bank account in Setup so DingoGo can pay you; the ATO report needs it too.</p>}
      {err && <p className="dg-error" role="alert">{err}</p>}
      {ok && <p className="dg-muted" role="status">Saved.</p>}
      <button className="dg-btn dg-btn--ghost">Save tax details</button>
    </form>
  );
}

/** Earnings → Tax: this quarter's GST figures and downloads. */
export function TaxStatements() {
  const opts = quarters(6);
  const [q, setQ] = useState(opts[0]);
  const { data: s, error } = useLoad(() => get(`/driver/tax/statement?quarter=${q}`), [q]);
  const [msg, setMsg] = useState<string | null>(null);
  const dl = async (path: string) => {
    setMsg(null);
    try { await downloadFile(path); } catch (e) { setMsg(e instanceof ApiError ? e.message : 'Could not download'); }
  };
  const t = s?.totals;
  return (
    <section className="panel" aria-labelledby="tax-h">
      <h2 id="tax-h" className="panel-title">GST and your BAS</h2>
      <label className="dg-field"><span>Quarter</span>
        <select className="dg-input" value={q} onChange={(e) => setQ(e.target.value)}>{opts.map((o) => <option key={o} value={o}>{qLabel(o)}</option>)}</select></label>
      {error && <p className="dg-error">{error}</p>}
      {t && (<>
        {s.warnings.map((w: string) => <p key={w} className="dg-note">{w}</p>)}
        <div className="info-row"><span>G1 Total sales (incl. GST)</span><strong className="dg-money">{money(t.sales_cents)}</strong></div>
        <div className="info-row"><span>1A GST on sales</span><strong className="dg-money">{money(t.gst_on_sales_cents)}</strong></div>
        <div className="info-row"><span>G11 DingoGo fees (incl. GST)</span><strong className="dg-money">{money(t.fees_cents)}</strong></div>
        <div className="info-row"><span>1B GST credits</span><strong className="dg-money">{money(t.gst_credits_cents)}</strong></div>
        <div className="info-row"><span>GST to pay</span><strong className="dg-money">{money(t.net_gst_cents)}</strong></div>
        <p className="fine-print"><Icon name="info" size={16} />Due {new Date(s.period.due).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' })} if you lodge quarterly. Tips ({money(t.tips_cents)}) have no GST. Check with your tax agent.</p>
        <div style={{ display: 'grid', gap: 8 }}>
          <button className="dg-btn dg-btn--ghost dg-btn--block" onClick={() => void dl(`/driver/tax/statement?quarter=${q}&format=pdf`)}><Icon name="document" size={18} />Statement (PDF)</button>
          <button className="dg-btn dg-btn--ghost dg-btn--block" onClick={() => void dl(`/driver/tax/statement?quarter=${q}&format=csv`)}><Icon name="list" size={18} />Statement (spreadsheet)</button>
          {t.fees_cents > 0 && <button className="dg-btn dg-btn--ghost dg-btn--block" onClick={() => void dl(`/driver/tax/fee-invoice?quarter=${q}&format=pdf`)}><Icon name="receipt" size={18} />DingoGo tax invoice for fees</button>}
        </div>
        {msg && <p className="dg-error" role="alert">{msg}</p>}
      </>)}
    </section>
  );
}
