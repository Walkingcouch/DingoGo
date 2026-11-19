import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import '@dingogo/shared/brand.css';
import './partner.css';
import { ApiError, Icon, Login, Ranges, ServiceNotice, date, downloadFile, get, getToken, initAuth, money, post, setToken, dateTime, time, useLoad } from '@dingogo/shared';
import mascot from '@dingogo/shared/assets/mascot.png';

initAuth('partner');

type Result = { kind: 'check'; r: any } | { kind: 'ok'; title: string; customer?: string } | { kind: 'bad'; msg: string } | null;

function Redeem({ onDone }: { onDone: () => void }) {
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result>(null);
  const [short, setShort] = useState(false);
  const redeemBtn = useRef<HTMLButtonElement>(null);
  const outcome = useRef<HTMLDivElement>(null);
  // Move focus to the outcome so a keyboard or screen-reader user lands on "Redeem and serve" or the verdict.
  useEffect(() => { if (result?.kind === 'check') redeemBtn.current?.focus(); else if (result) outcome.current?.focus(); }, [result]);

  async function check(e: React.FormEvent) {
    e.preventDefault();
    if (code.length < 4) { setShort(true); return; }
    setShort(false); setBusy(true); setResult(null);
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
            placeholder="DG······" autoCapitalize="characters" autoComplete="off" spellCheck={false} maxLength={20} required autoFocus
            aria-invalid={short || undefined} aria-describedby="code-hint" />
        </label>
        <p id="code-hint" className={short ? 'dg-error' : 'dg-muted'} style={{ margin: '0 0 10px', fontSize: '.9rem' }}>{short ? 'Enter the whole code. It has at least 4 letters or numbers.' : 'The code is on the customer’s phone, under Rewards.'}</p>
        <button className="dg-btn dg-btn--dark dg-btn--block p-cta" disabled={busy}>{busy && result === null ? 'Checking…' : 'Check code'}</button>
      </form>
      <div className="sr-only" role="status" aria-live="polite">{result?.kind === 'check' ? `Valid: ${result.r.title}. Press Redeem and serve.` : result?.kind === 'ok' ? 'Redeemed.' : ''}</div>
      {result?.kind === 'check' && (
        <div className="p-result p-result--check">
          <span className="p-result__tag"><Icon name="check" size={16} /> Valid for {result.r.customer || 'this customer'}</span>
          <h2>{result.r.title}</h2>
          <p className="dg-muted" style={{ marginTop: 0 }}>Expires {dateTime(result.r.expires_at)}</p>
          <button className="dg-btn dg-btn--green dg-btn--block" style={{ minHeight: 64, fontSize: 'var(--fs-lg)' }} onClick={redeem} disabled={busy} ref={redeemBtn}>{busy ? 'Redeeming…' : 'Redeem and serve'}</button>
        </div>
      )}
      {result?.kind === 'ok' && (
        <div className="p-result p-result--ok" tabIndex={-1} ref={outcome}>
          <div className="p-result__badge"><Icon name="check" size={40} strokeWidth={2.6} /></div>
          <h2>Redeemed</h2>
          <p style={{ margin: 0, fontSize: '1.15rem' }}>Serve {result.customer ? `${result.customer} ` : ''}one {result.title.replace(/^free /i, '').toLowerCase()}.</p>
          <p style={{ margin: '8px 0 0', opacity: .9 }}>Recorded at {time(new Date())}. DingoGo pays you at month end.</p>
        </div>
      )}
      {result?.kind === 'bad' && (
        <div className="p-result p-result--bad" role="alert" tabIndex={-1} ref={outcome}>
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
      <div role="status" aria-live="polite">{msg && <p className={msg.ok ? 'dg-note' : 'dg-error'} style={msg.ok ? { background: 'var(--saltbush-soft)', marginTop: 14 } : { marginTop: 14 }}>{msg.text}</p>}</div>
      <p className="dg-muted" style={{ fontSize: '.9rem' }}>Customers add the code in the DingoGo app under Wallet, or quote it when they phone to book.</p>
    </form>
  );
}

const monthName = (m: string) => new Date(`${m}-15T00:00:00Z`).toLocaleDateString('en-AU', { month: 'long', year: 'numeric', timeZone: 'UTC' });

/** Round 17: redemption stats for the last 6 months. */
function Stats() {
  const { data, error } = useLoad(() => get('/partner/stats'));
  if (error) return <p className="dg-error">{error}</p>;
  if (!data) return null;
  const max = Math.max(1, ...data.months.map((m: any) => m.redeemed));
  return (<>
    <h2 className="p-h2">Last 6 months</h2>
    <ul className="p-list p-bars">
      {data.months.map((m: any) => (
        <li key={m.month}><span>{monthName(m.month)}<br /><small className="dg-muted">{m.customers} {m.customers === 1 ? 'customer' : 'customers'}, {money(m.owed_cents)}</small></span>
          <span className="p-bar" aria-label={`${m.redeemed} served`}><span style={{ width: `${Math.round((m.redeemed / max) * 100)}%` }} /><b>{m.redeemed}</b></span></li>
      ))}
    </ul>
    <div className="p-stats">
      <div><b>{data.repeat_customers_6m}</b><span>Customers who came back (6 months)</span></div>
      <div><b>{data.codes_waiting}</b><span>Codes issued, not yet used</span></div>
    </div>
    {data.by_reward.length > 0 && (<>
      <h2 className="p-h2">This month by reward</h2>
      <ul className="p-list">{data.by_reward.map((r: any) => <li key={r.title}><span>{r.title}</span><span className="dg-muted">{r.redeemed}</span></li>)}</ul>
    </>)}
  </>);
}

/** Round 17: monthly settlement statements (served, owed, paid with the reference), CSV and PDF. */
function Statements() {
  const { data, error } = useLoad(() => get('/partner/statements'));
  if (error) return <p className="dg-error">{error}</p>;
  if (!data) return null;
  const rows = data.statements.filter((s: any) => s.redeemed > 0 || s.open);
  return (<>
    <p className="dg-muted" style={{ marginTop: 0 }}>Each reward is paid at the rate agreed when you served it. We pay after the end of each month.</p>
    <ul className="p-list">
      {rows.map((s: any) => (
        <li key={s.month} className="p-statement">
          <span><strong>{monthName(s.month)}</strong><br /><small className="dg-muted">{s.redeemed} served, {money(s.total_cents)}</small><br />
            <small className={s.status === 'paid' ? 'p-paid' : 'dg-muted'}>{s.status === 'paid' ? `Paid ${date(s.paid.paid_at)}${s.paid.paid_ref ? `, ref ${s.paid.paid_ref}` : ''}` : s.open ? 'Month still open' : 'To be paid'}</small></span>
          {s.redeemed > 0 && <span className="p-dl">
            <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => downloadFile(`/partner/statements/${s.month}?format=pdf`, `statement-${s.month}.pdf`)}>PDF</button>
            <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => downloadFile(`/partner/statements/${s.month}?format=csv`, `statement-${s.month}.csv`)}>CSV</button>
          </span>}
        </li>
      ))}
    </ul>
  </>);
}


/** Round 19: hotels, visitor centres and tour desks book tours for guests (billed to the desk's account) and see commission. */
const TOUR_KINDS = ['hotel', 'visitor_centre', 'tour_desk'];
const dayLabel = (d: string) => new Intl.DateTimeFormat('en-AU', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'UTC' }).format(new Date(`${d}T00:00:00Z`));
function Tours() {
  const { data, error, reload } = useLoad(() => get('/partner/tours'));
  const comm = useLoad(() => get('/partner/tours/commissions'));
  const [tourId, setTourId] = useState('');
  const tour = data?.tours.find((t: any) => t.id === tourId) ?? data?.tours[0];
  const avail = useLoad(() => (tour ? get(`/public/tours/${tour.slug}/availability?days=21`) : Promise.resolve(null)), [tour?.slug]);
  const [day, setDay] = useState('');
  const [time, setTime] = useState('');
  const [f, setF] = useState({ guests: 2, guest_name: '', guest_phone: '' });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (error) return <p className="dg-error">{error}</p>;
  if (!data) return null;
  const days = (avail.data?.days ?? []).filter((d: any) => d.times.some((t: any) => t.ok));
  const today = days.find((d: any) => d.date === day) ?? days[0];
  async function book(e: React.FormEvent) {
    e.preventDefault();
    if (!tour || !today || !time) return;
    setBusy(true); setMsg(null);
    try {
      const r = await post('/partner/tours/bookings', { tour_id: tour.id, scheduled_for: new Date(`${today.date}T${time}:00+09:30`).toISOString(), guests: Number(f.guests), guest_name: f.guest_name, guest_phone: f.guest_phone });
      setMsg({ ok: true, text: `Booked ${r.booking.ref}. The guest has been texted. Your commission: ${money(r.booking.commission_cents)}.` });
      setF({ guests: 2, guest_name: '', guest_phone: '' }); setTime(''); void reload(); void comm.reload();
    } catch (err) { setMsg({ ok: false, text: err instanceof ApiError ? err.message : 'Could not book' }); }
    finally { setBusy(false); }
  }
  async function cancel(id: string) {
    if (!window.confirm('Cancel this tour booking? Late cancellations are charged to your account.')) return;
    try { await post(`/partner/tours/bookings/${id}/cancel`, {}); void reload(); void comm.reload(); } catch (err) { window.alert(err instanceof ApiError ? err.message : 'Could not cancel'); }
  }
  return (<>
    <p className="dg-muted" style={{ marginTop: 0 }}>Book a private tour for a guest. We pick them up here, text them the details, and bill your DingoGo account. You earn {data.partner.commission_pct}% of the tour price once the tour is done. Free to cancel until {data.terms.free_cancel_hours} hours before.</p>
    {!data.partner.account_linked && <p className="dg-error">Your desk has no DingoGo business account linked yet. Call DingoGo to set it up.</p>}
    <form className="p-card" onSubmit={book}>
      <label className="dg-field"><span>Tour</span><select className="dg-select" value={tour?.id ?? ''} onChange={(e) => { setTourId(e.target.value); setDay(''); setTime(''); }}>
        {data.tours.map((t: any) => <option key={t.id} value={t.id}>{t.name}, {money(t.price_cents + t.guide_fee_cents + 100)}</option>)}</select></label>
      <label className="dg-field"><span>Date</span><select className="dg-select" value={today?.date ?? ''} onChange={(e) => { setDay(e.target.value); setTime(''); }}>
        {days.map((d: any) => <option key={d.date} value={d.date}>{dayLabel(d.date)}</option>)}</select></label>
      {today && <fieldset className="dg-field"><legend>Start time</legend><div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {today.times.map((t: any) => <button type="button" key={t.time} disabled={!t.ok} aria-pressed={time === t.time} className={`dg-btn dg-btn--sm ${time === t.time ? 'dg-btn--dark' : 'dg-btn--ghost'}`} onClick={() => setTime(t.time)}>{t.time}</button>)}
      </div></fieldset>}
      <label className="dg-field"><span>Guests</span><select className="dg-select" value={f.guests} onChange={(e) => setF({ ...f, guests: Number(e.target.value) })}>
        {Array.from({ length: tour?.max_passengers ?? 4 }, (_, i) => i + 1).map((n) => <option key={n}>{n}</option>)}</select></label>
      <label className="dg-field"><span>Guest name</span><input className="dg-input" required maxLength={80} value={f.guest_name} onChange={(e) => setF({ ...f, guest_name: e.target.value })} /></label>
      <label className="dg-field"><span>Guest mobile (for the booking text)</span><input className="dg-input" type="tel" required value={f.guest_phone} onChange={(e) => setF({ ...f, guest_phone: e.target.value })} /></label>
      {msg && <p className={msg.ok ? 'p-paid' : 'dg-error'} role="status">{msg.text}</p>}
      <button className="dg-btn dg-btn--dark dg-btn--block p-cta" disabled={busy || !time || !data.partner.account_linked}>{busy ? 'Booking…' : 'Book tour'}</button>
    </form>
    <h2 className="p-h2">Bookings</h2>
    <ul className="p-list">
      {!data.bookings.length && <li className="dg-muted">No bookings yet.</li>}
      {data.bookings.map((b: any) => (
        <li key={b.id}><span><strong>{b.tour_name}</strong> for {b.guest} (...{b.guest_phone_last3})<br /><small className="dg-muted">{b.ref}, {dateTime(b.scheduled_for)}, {b.status === 'scheduled' ? 'booked' : b.status.replace('_', ' ')}</small></span>
          <span style={{ textAlign: 'right' }}>{money(b.commission_cents)}<br /><small className="dg-muted">{b.commission_status}</small>
            {b.status === 'scheduled' && <><br /><button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => cancel(b.id)}>Cancel</button></>}</span></li>
      ))}
    </ul>
    <h2 className="p-h2">Commission by month</h2>
    <ul className="p-list">
      {!comm.data?.months.length && <li className="dg-muted">Nothing yet.</li>}
      {comm.data?.months.map((m: any) => <li key={m.month}><span><strong>{monthName(m.month)}</strong><br /><small className="dg-muted">{m.bookings} bookings</small></span>
        <span style={{ textAlign: 'right' }}>{money(m.earned_cents + m.paid_cents)}<br /><small className={m.paid_cents ? 'p-paid' : 'dg-muted'}>{m.paid_cents ? `${money(m.paid_cents)} paid` : 'to be paid'}</small></span></li>)}
    </ul>
    <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => downloadFile('/partner/tours/commissions?format=csv', 'tour-commissions.csv')}>Download CSV</button>
  </>);
}

function Home({ onSignOut }: { onSignOut: () => void }) {
  const [tab, setTab] = useState<'redeem' | 'history' | 'statements' | 'vouchers' | 'tours'>('redeem');
  const me = useLoad(() => get('/partner/me'));
  const hist = useLoad(() => get('/partner/redemptions'));
  const p = me.data?.partner;
  const tourDesk = TOUR_KINDS.includes(p?.kind);
  useEffect(() => { if (tourDesk) setTab((t) => (t === 'redeem' ? 'tours' : t)); }, [tourDesk]);
  const refresh = () => { void me.reload(); void hist.reload(); };
  return (
    <div className="p-wrap">
      <header className="p-head">
        <div className="p-head__row">
          <img src={mascot} alt="" />
          <div className="p-head__id"><h1 title={p?.name}>{(p?.name ?? 'Partner').replace(/\s*\(demo\)$/i, '')}</h1>
            <small>{tourDesk ? 'Tour desk' : 'Rewards partner'}{/\(demo\)$/i.test(p?.name ?? '') && <span className="p-demo">Demo</span>}</small></div>
          <button onClick={onSignOut} aria-label="Sign out"><Icon name="logout" size={18} /><span>Sign out</span></button>
        </div>
        <nav className="p-tabs" aria-label="Sections">
          {(([['tours', 'Tours', 'compass'], ['redeem', 'Redeem', 'qr'], ['history', 'This month', 'chart'], ['statements', 'Statements', 'receipt'], ['vouchers', 'Sell credit', 'ticket']] as const)
            .filter(([k]) => k !== 'tours' || tourDesk)).map(([k, l, ic]) => (
            <button key={k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)} aria-current={tab === k ? 'page' : undefined}><Icon name={ic} size={18} />{l}</button>
          ))}
        </nav>
      </header>
      <main className="p-main">
        <ServiceNotice extra="Codes can't be checked until it's back: ask the customer to keep their code." />
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
          <Stats />
          {me.data.rewards.length > 0 && (<>
            <h2 className="p-h2">Your rewards in the app</h2>
            <ul className="p-list">{me.data.rewards.map((r: any) => <li key={r.id}><span>{r.title}</span><span className="dg-muted">{r.points_cost} points</span></li>)}</ul>
          </>)}
        </>)}
        {tab === 'statements' && <Statements />}
        {tab === 'vouchers' && <Vouchers />}
        {tab === 'tours' && <Tours />}
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
  if (!ok) return <Login title="Partner sign-in" subtitle="For cafés, shops, hotels and visitor centres working with DingoGo." onDone={() => setOk(true)} />;
  return <Home onSignOut={() => { setToken(null); setOk(false); }} />;
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
