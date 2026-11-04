import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '@dingogo/shared/brand.css';
import './partner.css';
import { ApiError, Icon, Login, Ranges, get, getToken, initAuth, money, post, setToken, dateTime, time, useLoad } from '@dingogo/shared';
import mascot from '@dingogo/shared/assets/mascot.png';

initAuth('partner');

type Result = { kind: 'check'; r: any } | { kind: 'ok'; title: string; customer?: string } | { kind: 'bad'; msg: string } | null;

function Redeem({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);

  async function check(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setResult(null);
    try {
      const r = await post('/partner/check', { code });
      if (r.valid) setResult({ kind: 'check', r: r.redemption });
      else setResult({ kind: 'bad', msg: r.redemption.status === 'redeemed' ? `Already used on ${dateTime(r.redemption.redeemed_at)}` : r.redemption.status === 'issued' ? 'This code has expired' : `This code is ${r.redemption.status}` });
    } catch (err) { setResult({ kind: 'bad', msg: err instanceof ApiError && err.code === 'not_found' ? 'Code not found for your business. Check the letters and try again.' : err instanceof ApiError ? err.message : 'Could not check the code' }); }
    finally { setBusy(false); }
  }
  async function redeem() {
    if (result?.kind !== 'check') return;
    setBusy(true);
    try {
      const r = await post('/partner/redeem', { code });
      setResult({ kind: 'ok', title: r.redemption.title, customer: result.r.customer });
      setCode(''); onDone();
    } catch (err) { setResult({ kind: 'bad', msg: err instanceof ApiError ? err.message : 'Could not redeem' }); }
    finally { setBusy(false); }
  }

  return (
    <>
      <form onSubmit={check} className="p-card">
        <label className="dg-field"><span>Customer's reward code</span>
          <input className="dg-input p-code" value={code} onChange={(e) => { setCode(e.target.value.toUpperCase().replace(/\s/g, '')); setResult(null); }}
            placeholder="DG······" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={20} required autoFocus />
        </label>
        <button className="dg-btn dg-btn--dark dg-btn--block p-cta" disabled={busy || code.length < 4}>{busy && result === null ? 'Checking…' : 'Check code'}</button>
      </form>
      {result?.kind === 'check' && (
        <div className="p-result p-result--check" aria-live="polite">
          <span className="p-result__tag"><Icon name="check" size={16} /> Valid for {result.r.customer || 'this customer'}</span>
          <h2>{result.r.title}</h2>
          <p className="dg-muted" style={{ marginTop: 0 }}>Expires {dateTime(result.r.expires_at)}</p>
          <button className="dg-btn dg-btn--green dg-btn--block" style={{ minHeight: 64, fontSize: 'var(--fs-lg)' }} onClick={redeem} disabled={busy}>{busy ? 'Redeeming…' : 'Redeem and serve'}</button>
        </div>
      )}
      {result?.kind === 'ok' && (
        <div className="p-result p-result--ok" role="status">
          <div className="p-result__badge"><Icon name="check" size={40} strokeWidth={2.6} /></div>
          <h2>Redeemed</h2>
          <p style={{ margin: 0, fontSize: '1.15rem' }}>Serve {result.customer ? `${result.customer} ` : ''}one {result.title.replace(/^free /i, '').toLowerCase()}.</p>
          <p style={{ margin: '8px 0 0', opacity: .9 }}>Recorded at {time(new Date())}. DingoGo pays you at month end.</p>
        </div>
      )}
      {result?.kind === 'bad' && (
        <div className="p-result p-result--bad" role="alert">
          <div className="p-result__badge"><Icon name="x" size={40} strokeWidth={2.6} /></div>
          <h2>Don't serve</h2>
          <p style={{ margin: 0, fontSize: '1.1rem' }}>{result.msg}</p>
        </div>
      )}
    </>
  );
}

function Vouchers() {
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  async function sell(e: React.FormEvent) {
    e.preventDefault(); setMsg(null);
    try { const r = await post('/partner/vouchers/sell', { code }); setMsg({ ok: true, text: `Sold: ${money(r.voucher.value_cents)} DingoGo credit (${r.voucher.code}). Take ${money(r.voucher.value_cents)} from the customer.` }); setCode(''); }
    catch (err) { setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not record the sale' }); }
  }
  return (
    <form onSubmit={sell} className="p-card">
      <p style={{ marginTop: 0 }}>Selling a DingoGo credit card over the counter? Enter the code printed on the card so it's recorded as sold by your business.</p>
      <label className="dg-field"><span>Voucher card code</span><input className="dg-input p-code" style={{ fontSize: '1.4rem' }} value={code} onChange={(e) => setCode(e.target.value.toUpperCase().trim())} required /></label>
      <button className="dg-btn dg-btn--block">Record sale</button>
      {msg && <p className={msg.ok ? 'dg-note' : 'dg-error'} style={msg.ok ? { background: 'var(--saltbush-soft)', marginTop: 14 } : { marginTop: 14 }} role="status">{msg.text}</p>}
      <p className="dg-muted" style={{ fontSize: '.9rem' }}>Customers add the code in the DingoGo app under Wallet, or quote it when they phone to book.</p>
    </form>
  );
}

function Home({ onSignOut }: { onSignOut: () => void }) {
  const [tab, setTab] = useState<'redeem' | 'history' | 'vouchers'>('redeem');
  const me = useLoad(() => get('/partner/me'));
  const hist = useLoad(() => get('/partner/redemptions'));
  const p = me.data?.partner;
  const refresh = () => { void me.reload(); void hist.reload(); };
  return (
    <div className="p-wrap">
      <header className="p-head">
        <div className="p-head__row">
          <img src={mascot} alt="" />
          <div className="p-head__id"><h1 title={p?.name}>{(p?.name ?? 'Partner').replace(/\s*\(demo\)$/i, '')}</h1>
            <small>Rewards partner{/\(demo\)$/i.test(p?.name ?? '') && <span className="p-demo">Demo</span>}</small></div>
          <button onClick={onSignOut} aria-label="Sign out"><Icon name="logout" size={18} /><span>Sign out</span></button>
        </div>
        <nav className="p-tabs" aria-label="Sections">
          {([['redeem', 'Redeem', 'qr'], ['history', 'This month', 'chart'], ['vouchers', 'Sell credit', 'ticket']] as const).map(([k, l, ic]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}><Icon name={ic} size={18} />{l}</button>
          ))}
        </nav>
      </header>
      <main className="p-main">
        {me.error && <p className="dg-error">{me.error}</p>}
        {tab === 'redeem' && <Redeem onDone={refresh} />}
        {tab === 'history' && me.data && (<>
          <div className="p-stats">
            <div><b>{me.data.stats.this_month}</b><span>Rewards served this month</span></div>
            <div><b>{money(me.data.owed_this_month_cents)}</b><span>DingoGo owes you</span></div>
          </div>
          <p className="dg-muted" style={{ marginTop: 0 }}>We pay {money(p?.settlement_cents_per_redemption)} for each reward served, at the end of each month. {me.data.stats.all_time} served all time.</p>
          <h2 className="p-h2">Recently redeemed</h2>
          <ul className="p-list">
            {!hist.data?.items.length && <li className="dg-muted">Nothing redeemed yet.</li>}
            {hist.data?.items.slice(0, 30).map((r: any) => <li key={r.code}><span>{r.title}<br /><small className="dg-muted">{r.code}</small></span><span className="dg-muted" style={{ textAlign: 'right' }}>{dateTime(r.redeemed_at)}</span></li>)}
          </ul>
          {me.data.rewards.length > 0 && (<>
            <h2 className="p-h2">Your rewards in the app</h2>
            <ul className="p-list">{me.data.rewards.map((r: any) => <li key={r.id}><span>{r.title}</span><span className="dg-muted">{r.points_cost} points</span></li>)}</ul>
          </>)}
        </>)}
        {tab === 'vouchers' && <Vouchers />}
      </main>
      <Ranges height={36} fill="var(--night)" />
    </div>
  );
}

function App() {
  const [ok, setOk] = useState<boolean | null>(null);
  useEffect(() => {
    if (!getToken()) return setOk(false);
    get('/partner/me').then(() => setOk(true)).catch(() => { setToken(null); setOk(false); });
  }, []);
  if (ok === null) return null;
  if (!ok) return <Login title="Partner sign-in" subtitle="For cafés and shops redeeming DingoGo rewards." onDone={() => setOk(true)} />;
  return <Home onSignOut={() => { setToken(null); setOk(false); }} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
