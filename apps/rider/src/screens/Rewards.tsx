import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { ApiError, date, del, get, money, post, useLoad } from '@dingogo/shared';
import { Dialog, Page, Spinner, shareOrCopy, useCopy } from '../components/ui';
import { useMe } from '../ctx';

const REASON: Record<string, string> = { trip_earned: 'Trip', redeemed_on_trip: 'Used on a trip', referral_bonus: 'Friend referral', refund_cancelled_trip: 'Cancelled trip refund', admin_adjustment: 'Adjustment' };

export function RewardsScreen() {
  const { data, error, loading, reload } = useLoad(() => get('/loyalty'));
  const plans = useLoad(() => get<{ plans: any[] }>('/plans'));
  const { me, reload: reloadMe } = useMe();
  const [voucher, setVoucher] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { copy, copied } = useCopy();

  async function redeem(r: any) {
    setBusy(r.id); setErr(null);
    try {
      const res = await post(`/loyalty/rewards/${r.id}/redeem`);
      if (res.redemption.kind === 'ride_credit') setVoucher({ credit: res.redemption.credit_cents });
      else setVoucher({ ...res.redemption, partner_name: r.partner_name });
      await Promise.all([reload(), reloadMe()]);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not redeem'); }
    finally { setBusy(null); }
  }
  async function subscribe(code: string) {
    setBusy(code); setErr(null);
    try { await post('/subscriptions', { plan_code: code }); await reloadMe(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not subscribe'); }
    finally { setBusy(null); }
  }
  async function cancelPass() {
    setBusy('cancel');
    try { await del('/subscriptions'); await reloadMe(); } finally { setBusy(null); }
  }

  if (loading) return <Page title="Rewards"><Spinner /></Page>;
  if (error) return <Page title="Rewards"><p className="dg-error">{error}</p></Page>;
  const pts = data.points as number;
  const vouchers = (data.redemptions as any[]).filter((v) => v.status === 'issued' && new Date(v.expires_at) > new Date());
  const sub = me?.subscription;

  return (
    <Page title="Rewards">
      <div className="points">
        <div>
          <span className="points__n">{pts.toLocaleString()}</span>
          <span className="points__l">Dingo Points</span>
        </div>
        <p>{data.earn_rate}. {data.burn_rate}, or swap them for a free coffee at a partner café.</p>
      </div>
      {err && <p className="dg-error" role="alert">{err}</p>}

      {vouchers.length > 0 && (
        <section className="section">
          <h2 className="section__title">Ready to use</h2>
          <ul className="list">
            {vouchers.map((v) => (
              <li key={v.id}>
                <button className="row" onClick={() => setVoucher(v)}>
                  <span className="row__icon" aria-hidden="true">☕</span>
                  <span className="row__main"><strong>{v.title}</strong><span className="dg-muted">{v.partner_name}, use by {date(v.expires_at)}</span></span>
                  <span className="row__end"><span className="dg-chip dg-chip--ochre">Show code</span></span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="section">
        <h2 className="section__title">Swap your points</h2>
        <ul className="rewards">
          {(data.rewards as any[]).map((r) => {
            const short = r.points_cost - pts;
            return (
              <li key={r.id} className="reward">
                <div className="reward__main">
                  <strong>{r.title}</strong>
                  <span className="dg-muted">{r.partner_name ?? 'DingoGo'}{r.partner_address ? `, ${r.partner_address}` : ''}</span>
                  {r.aboriginal_owned && <span className="dg-chip dg-chip--green" style={{ marginTop: 4, width: 'fit-content' }}>Aboriginal-owned</span>}
                </div>
                <div className="reward__end">
                  <span className="dg-money">{r.points_cost.toLocaleString()} pts</span>
                  <button className="dg-btn dg-btn--sm" disabled={short > 0 || busy === r.id} onClick={() => redeem(r)}>
                    {short > 0 ? `${short} more pts` : busy === r.id ? 'Swapping…' : 'Swap'}
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="section refer">
        <h2 className="section__title">Bring a friend</h2>
        <p>When a friend signs up with your code and takes their first trip, you both get {data.referral_bonus} points.</p>
        <div className="refer__code"><span>{data.referral_code}</span>
          <button className="dg-btn dg-btn--sm" onClick={() => shareOrCopy({ title: 'DingoGo', text: `Try DingoGo, Alice Springs' electric rideshare. Use my code ${data.referral_code} when you sign up and we both get ${data.referral_bonus} points.` }, copy)}>
            {copied ? 'Copied' : 'Share code'}
          </button>
        </div>
        <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>{data.referrals.total} friends joined, {data.referrals.rewarded} have taken a trip.</p>
      </section>

      <section className="section">
        <h2 className="section__title">DingoGo Pass</h2>
        {sub ? (
          <div className="callout callout--green">
            <strong>You have {sub.plan_name}</strong> until {date(sub.period_end)}. {sub.status === 'cancelled' ? 'It won’t renew.' : ''}
            {sub.free_deliveries > 0 && <> {Math.max(0, sub.free_deliveries - sub.deliveries_used)} free deliveries left this month.</>}
            {sub.status !== 'cancelled' && <div><button className="dg-btn dg-btn--ghost dg-btn--sm" style={{ marginTop: 8 }} disabled={busy === 'cancel'} onClick={cancelPass}>Stop renewing</button></div>}
          </div>
        ) : (
          <ul className="plans">
            {plans.data?.plans.map((p) => (
              <li key={p.code} className="plan">
                <div className="plan__head"><strong>{p.name}</strong><span className="dg-money">{money(p.price_cents)}<small> a month</small></span></div>
                <ul>{p.perks.map((x: string) => <li key={x}>{x}</li>)}</ul>
                <button className="dg-btn dg-btn--dark dg-btn--sm" disabled={busy === p.code} onClick={() => subscribe(p.code)}>{busy === p.code ? 'Joining…' : `Join for ${money(p.price_cents)}`}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="section">
        <h2 className="section__title">Points history</h2>
        <ul className="ledger">
          {(data.ledger as any[]).map((l, i) => (
            <li key={i}><span>{REASON[l.reason] ?? l.reason.replace(/^reward:/, '')}<small className="dg-muted"> {date(l.created_at)}</small></span>
              <span className={`dg-money ${l.points > 0 ? 'is-plus' : ''}`}>{l.points > 0 ? '+' : ''}{l.points}</span></li>
          ))}
        </ul>
      </section>
      <VoucherDialog v={voucher} onClose={() => setVoucher(null)} />
    </Page>
  );
}

function VoucherDialog({ v, onClose }: { v: any | null; onClose: () => void }) {
  const [qr, setQr] = useState<string>('');
  useEffect(() => { if (v?.code) QRCode.toDataURL(v.code, { margin: 1, width: 240, color: { dark: '#14213D', light: '#FFFFFF' } }).then(setQr); }, [v?.code]);
  if (!v) return null;
  if (v.credit) return (
    <Dialog open onClose={onClose} title="Credit added">
      <p>{money(v.credit)} is now in your DingoGo credit. Choose "DingoGo credit" when you pay for a trip.</p>
      <button className="dg-btn dg-btn--block" onClick={onClose}>Done</button>
    </Dialog>
  );
  return (
    <Dialog open onClose={onClose} title={v.title}>
      <p>Show this at {v.partner_name}. The staff scan or type the code.</p>
      <div className="voucher">
        {qr && <img src={qr} alt={`QR code for voucher ${v.code}`} width={200} height={200} />}
        <span className="voucher__code">{v.code}</span>
        <span className="dg-muted">Use by {date(v.expires_at)}. One use only.</span>
      </div>
      <button className="dg-btn dg-btn--block" onClick={onClose}>Done</button>
    </Dialog>
  );
}
