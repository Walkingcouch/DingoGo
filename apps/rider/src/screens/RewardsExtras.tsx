/** Round 17: tier and expiry, birthday/streak opt-ins, gift vouchers (buy, text, print a QR card) and the full points history. */
import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ApiError, Icon, date, get, money, post, put, useLoad } from '@dingogo/shared';
import { Dialog } from '../components/ui';

export function TierCard({ data }: { data: any }) {
  const t = data.tier;
  if (!t) return null;
  const next = t.next;
  const pct = next ? Math.min(100, Math.round((t.trips_last_year / next.min_trips) * 100)) : 100;
  return (
    <section className="section tier" aria-label="Your level">
      <div className="tier__head">
        <strong>{t.name}</strong>
        <span className="dg-muted">{t.trips_last_year} {t.trips_last_year === 1 ? 'trip' : 'trips'} in the last 12 months{t.multiplier > 1 ? `, ${t.multiplier}x points` : ''}</span>
      </div>
      {next && (<>
        <div className="tier__bar" role="progressbar" aria-valuemin={0} aria-valuemax={next.min_trips} aria-valuenow={t.trips_last_year} aria-label={`Trips towards ${next.name}`}>
          <span style={{ width: `${pct}%` }} />
        </div>
        <p className="dg-muted tier__next">{next.trips_to_go} more {next.trips_to_go === 1 ? 'trip' : 'trips'} to {next.name} ({next.multiplier}x points).</p>
      </>)}
      {data.expiry && <p className="dg-muted tier__next">{data.expiry.expires_at ? `Your points are safe until ${date(data.expiry.expires_at)}. ` : ''}{data.expiry.rule}</p>}
    </section>
  );
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function Bonuses({ data, onSaved }: { data: any; onSaved: () => void }) {
  const p = data.profile;
  const [m, setM] = useState(p?.birthday_md?.slice(0, 2) ?? '');
  const [d, setD] = useState(p?.birthday_md?.slice(3, 5) ?? '');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data.bonuses?.ready || !p) return null;
  const b = data.bonuses;
  async function save(change: any, ok: string) {
    setBusy(true); setMsg(null);
    try { await put('/loyalty/profile', change); setMsg({ ok: true, text: ok }); onSaved(); }
    catch (e) { setMsg({ ok: false, text: e instanceof ApiError ? e.message : 'Could not save' }); }
    finally { setBusy(false); }
  }
  const md = m && d ? `${m}-${d}` : null;
  return (
    <section className="section">
      <h2 className="section__title">Bonus points</h2>
      <p className="dg-muted" style={{ marginTop: 0 }}>Both are optional. We only keep the day and month of your birthday, never the year.</p>
      {b.birthday_points > 0 && (
        <div className="bonus">
          <label className="bonus__row"><input type="checkbox" checked={p.birthday_opt_in} disabled={busy}
            onChange={(e) => save({ birthday_opt_in: e.target.checked, ...(e.target.checked ? { birthday_md: md } : {}) }, e.target.checked ? 'Birthday bonus on.' : 'Birthday bonus off.')} />
            <span><strong>Birthday bonus</strong><br /><span className="dg-muted">{b.birthday_points} points on your birthday.</span></span></label>
          <div className="bonus__date">
            <label className="dg-field"><span>Day</span><select className="dg-select" value={d} onChange={(e) => setD(e.target.value)}><option value="">-</option>
              {Array.from({ length: 31 }, (_, i) => String(i + 1).padStart(2, '0')).map((x) => <option key={x} value={x}>{Number(x)}</option>)}</select></label>
            <label className="dg-field"><span>Month</span><select className="dg-select" value={m} onChange={(e) => setM(e.target.value)}><option value="">-</option>
              {MONTHS.map((x, i) => <option key={x} value={String(i + 1).padStart(2, '0')}>{x}</option>)}</select></label>
            <button className="dg-btn dg-btn--sm" disabled={busy || !md || md === p.birthday_md} onClick={() => save({ birthday_md: md }, 'Birthday saved.')}>Save</button>
          </div>
        </div>
      )}
      {b.streak_points > 0 && (
        <label className="bonus bonus__row"><input type="checkbox" checked={p.streak_opt_in} disabled={busy}
          onChange={(e) => save({ streak_opt_in: e.target.checked }, e.target.checked ? 'Streak bonus on.' : 'Streak bonus off.')} />
          <span><strong>Weekly streak</strong><br /><span className="dg-muted">{b.streak_points} points when you ride {b.streak_weeks} weeks in a row.{p.streak_opt_in && data.streak_weeks_now > 0 ? ` You're on ${data.streak_weeks_now} ${data.streak_weeks_now === 1 ? 'week' : 'weeks'}.` : ''}</span></span></label>
      )}
      <div role="status" aria-live="polite">{msg && <p className={msg.ok ? 'dg-muted' : 'dg-error'}>{msg.text}</p>}</div>
    </section>
  );
}

export function GiftVouchers() {
  const { data, reload } = useLoad(() => get('/gift-vouchers'));
  const [f, setF] = useState({ value: 2000, from: '', to: '', message: '', phone: '' });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [card, setCard] = useState<any | null>(null);
  if (!data?.ready) return null;
  async function buy(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    const key = `gift-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    try {
      const r = await post('/gift-vouchers', { value_cents: f.value, from_name: f.from || undefined, recipient_name: f.to || undefined, message: f.message || undefined, send_to: f.phone || undefined },
        { headers: { 'Idempotency-Key': key } });
      setCard({ ...r.voucher, texted: r.texted }); setF({ ...f, to: '', message: '', phone: '' }); await reload();
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Could not buy the voucher'); }
    finally { setBusy(false); }
  }
  return (
    <section className="section">
      <h2 className="section__title">Give DingoGo credit</h2>
      <p className="dg-muted" style={{ marginTop: 0 }}>Buy credit for someone. We can text them the code, or print a card with a QR code for someone without a phone. Valid for {data.valid_years} years.</p>
      <form className="gift" onSubmit={buy}>
        <div className="gift__values" role="radiogroup" aria-label="Amount">
          {data.values_cents.map((c: number) => <button type="button" key={c} role="radio" aria-checked={f.value === c} className={`dg-btn dg-btn--sm ${f.value === c ? 'dg-btn--dark' : 'dg-btn--ghost'}`} onClick={() => setF({ ...f, value: c })}>{money(c)}</button>)}
        </div>
        <label className="dg-field"><span>From (optional)</span><input className="dg-input" maxLength={60} value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /></label>
        <label className="dg-field"><span>To (optional)</span><input className="dg-input" maxLength={60} value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></label>
        <label className="dg-field"><span>Message (optional)</span><input className="dg-input" maxLength={140} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></label>
        <label className="dg-field"><span>Text the code to (optional)</span><input className="dg-input" type="tel" inputMode="tel" placeholder="04xx xxx xxx" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></label>
        {err && <p className="dg-error" role="alert">{err}</p>}
        <button className="dg-btn dg-btn--block" disabled={busy}>{busy ? 'Buying…' : `Buy ${money(f.value)} with your card`}</button>
      </form>
      {data.vouchers.length > 0 && (
        <ul className="list" style={{ marginTop: 12 }}>
          {data.vouchers.map((v: any) => (
            <li key={v.code}>
              <button className="row" onClick={() => setCard(v)}>
                <span className="row__icon"><Icon name="gift" size={20} /></span>
                <span className="row__main"><strong>{money(v.value_cents)}{v.recipient_name ? ` for ${v.recipient_name}` : ''}</strong><span className="dg-muted">Bought {date(v.created_at)}{v.used ? ', used' : `, use by ${date(v.expires_at)}`}</span></span>
                <span className="row__end"><span className="dg-chip">{v.used ? 'Used' : 'Show card'}</span></span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <GiftCardDialog v={card} onClose={() => setCard(null)} />
    </section>
  );
}

function GiftCardDialog({ v, onClose }: { v: any | null; onClose: () => void }) {
  const [qr, setQr] = useState('');
  useEffect(() => { if (v?.code) QRCode.toDataURL(v.code, { margin: 1, width: 240, color: { dark: '#14213D', light: '#FFFFFF' } }).then(setQr); }, [v?.code]);
  if (!v) return null;
  const print = () => { document.body.classList.add('print-card'); window.print(); setTimeout(() => document.body.classList.remove('print-card'), 500); };
  return (
    <Dialog open onClose={onClose} title="Gift card">
      {v.texted && <p className="dg-muted">We texted the code to them.</p>}
      <div className="giftcard">
        <strong className="giftcard__title">DingoGo credit {money(v.value_cents)}</strong>
        {v.recipient_name && <span>For {v.recipient_name}{v.from_name ? `, from ${v.from_name}` : ''}</span>}
        {v.message && <em>{v.message}</em>}
        {qr && <img src={qr} alt={`QR code for gift code ${v.code}`} width={160} height={160} />}
        <span className="voucher__code">{v.code}</span>
        <small>Add it in the DingoGo app under Wallet, or quote the code when you call DingoGo to book. Use by {date(v.expires_at)}.</small>
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="dg-btn dg-btn--ghost dg-btn--block" onClick={print}><Icon name="document" size={18} /> Print card</button>
        <button className="dg-btn dg-btn--block" onClick={onClose}>Done</button>
      </div>
    </Dialog>
  );
}

export function History() {
  const [items, setItems] = useState<any[]>([]);
  const [next, setNext] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  async function load(before?: number | null) {
    setBusy(true);
    try {
      const r = await get(`/loyalty/history${before ? `?before=${before}` : ''}`);
      setItems((x) => (before ? [...x, ...r.items] : r.items)); setNext(r.next);
    } finally { setBusy(false); }
  }
  useEffect(() => { void load(); }, []);
  return (
    <section className="section">
      <h2 className="section__title">Points history</h2>
      {!items.length && !busy && <p className="dg-muted">No points yet. You earn them on every trip.</p>}
      <ul className="ledger">
        {items.map((l) => (
          <li key={l.id}><span>{l.label}{l.trip_ref ? ` (${l.trip_ref})` : ''}<small className="dg-muted"> {date(l.created_at)}</small></span>
            <span className="ledger__end"><span className={`dg-money ${l.points > 0 ? 'is-plus' : ''}`}>{l.points > 0 ? '+' : ''}{l.points}</span>
              <small className="dg-muted">Balance {Number(l.balance).toLocaleString()}</small></span></li>
        ))}
      </ul>
      {next && <button className="dg-btn dg-btn--ghost dg-btn--sm" disabled={busy} onClick={() => load(next)} style={{ marginTop: 8 }}>{busy ? 'Loading…' : 'Show more'}</button>}
    </section>
  );
}
