import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { get, post, put, money, date, dateTime, useLoad } from '@dingogo/shared';
import { Page } from '../ctx';
import { Chip, CrudSection, ErrorMsg, Section, Table, Tabs, downloadFile, exportCsv, useRun } from '../ui';
import { PARTNER_KIND, REDEMPTION_STATUS, label } from '../labels';

export default function Loyalty() {
  const [tab, setTab] = useState<'programme' | 'partners' | 'rewards' | 'redemptions' | 'vouchers' | 'winback'>('programme');
  const partners = useLoad(() => get('/admin/partners'));
  const opts: [string, string][] = (partners.data?.items ?? []).map((p: any) => [p.id, p.name]);
  return (
    <Page title="Loyalty & vouchers">
      <Tabs tabs={[['programme', 'Programme'], ['partners', 'Partner cafés'], ['rewards', 'Rewards'], ['redemptions', 'Redemptions & settlement'], ['vouchers', 'Prepaid vouchers'], ['winback', 'Win-back']]} value={tab} onChange={setTab}>
      {tab === 'programme' && <Programme />}
      {tab === 'winback' && <WinBack />}
      {tab === 'partners' && <CrudSection title="Partners" path="partners" newLabel="Add partner" fields={[
        { key: 'name', label: 'Business name', required: true }, { key: 'kind', label: 'Type', type: 'select', required: true, options: [['cafe', 'Café'], ['shop', 'Shop'], ['community', 'Community organisation'], ['hotel', 'Hotel (books tours)'], ['visitor_centre', 'Visitor centre (books tours)'], ['tour_desk', 'Tour desk (books tours)'], ['other', 'Other']] },
        { key: 'address', label: 'Address', full: true }, { key: 'lat', label: 'Latitude', type: 'number', step: 0.0001 }, { key: 'lng', label: 'Longitude', type: 'number', step: 0.0001 },
        { key: 'phone', label: 'Phone', type: 'tel' }, { key: 'email', label: 'Email', type: 'email' }, { key: 'logo_url', label: 'Logo URL', full: true },
        { key: 'settlement_cents_per_redemption', label: 'DingoGo pays per redemption', type: 'money', help: 'What we reimburse the partner for each reward served' },
        { key: 'aboriginal_owned', label: 'Aboriginal-owned business', type: 'bool' }, { key: 'active', label: 'Active', type: 'bool' },
        { key: 'tour_commission_pct', label: 'Tour commission (%)', type: 'number', step: 0.5, help: 'Hotels, visitor centres and tour desks: earned on each tour they book, once it is done' },
        { key: 'corporate_account_id', label: 'Business account billed for desk bookings (id)', help: 'From Business accounts. Needed before the desk can book tours for guests' },
      ]} cols={[
        { key: 'name', label: 'Partner', render: (p) => <strong>{p.name}</strong> }, { key: 'kind', label: 'Type', render: (p) => label(PARTNER_KIND, p.kind) }, { key: 'address', label: 'Address', truncate: 240 },
        { key: 'settlement_cents_per_redemption', label: 'Paid per redemption', num: true, render: (p) => money(p.settlement_cents_per_redemption) },
        { key: 'tour_commission_pct', label: 'Tour commission', num: true, render: (p) => (Number(p.tour_commission_pct) ? `${Number(p.tour_commission_pct)}%` : '') },
        { key: 'aboriginal_owned', label: '', render: (p) => p.aboriginal_owned && <Chip tone="ochre">Aboriginal-owned</Chip> },
        { key: 'active', label: 'Status', render: (p) => (p.active ? <Chip tone="green">Active</Chip> : <Chip>Inactive</Chip>) },
      ]} describe={<p className="dg-muted" style={{ marginTop: 0 }}>Partner staff sign in to the partner portal with a user whose role is "partner" and is linked to the business (Settings, users).</p>} />}
      {tab === 'rewards' && <CrudSection title="Rewards" path="rewards" newLabel="Add reward" fields={[
        { key: 'title', label: 'Reward', required: true }, { key: 'points_cost', label: 'Points needed', type: 'number', required: true },
        { key: 'kind', label: 'Type', type: 'select', required: true, options: [['voucher', 'Partner voucher (code shown at counter)'], ['ride_credit', 'DingoGo ride credit']] },
        { key: 'partner_id', label: 'Partner (for vouchers)', type: 'select', options: opts }, { key: 'credit_cents', label: 'Ride credit amount', type: 'money' },
        { key: 'description', label: 'Description', full: true }, { key: 'active', label: 'Available', type: 'bool' },
      ]} cols={[
        { key: 'title', label: 'Reward', render: (r) => <strong>{r.title}</strong> }, { key: 'partner', label: 'Partner', render: (r) => opts.find(([id]) => id === r.partner_id)?.[1] ?? 'DingoGo' },
        { key: 'points_cost', label: 'Points', num: true }, { key: 'value', label: 'Credit', num: true, render: (r) => (r.kind === 'ride_credit' ? money(r.credit_cents) : '—') },
        { key: 'active', label: 'Status', render: (r) => (r.active ? <Chip tone="green">Available</Chip> : <Chip>Off</Chip>) },
      ]} />}
      {tab === 'redemptions' && <Redemptions />}
      {tab === 'vouchers' && <Vouchers partners={opts} />}
      </Tabs>
    </Page>
  );
}

function Redemptions() {
  const [month, setMonth] = useState('');
  const { data, error } = useLoad(() => get('/admin/redemptions'));
  const st = useLoad(() => get(`/admin/partner-settlements${month ? `?month=${month}` : ''}`), [month]);
  const run = useRun();
  const pay = async (p: any) => {
    const ref = window.prompt(`Payment reference for ${p.name}, ${st.data.month} (${money(p.owed_cents)})`, '');
    if (ref === null) return;
    if (await run(() => post('/admin/partner-settlements', { partner_id: p.id, month: st.data.month, paid_ref: ref || null }), 'Marked paid')) void st.reload();
  };
  return (<>
    <ErrorMsg error={error || st.error} />
    <Section title="Owed to partners" right={st.data && (<>
      <label className="dg-field" style={{ margin: 0 }}><span className="sr-only">Month</span>
        <select className="dg-select" value={st.data.month} onChange={(e) => setMonth(e.target.value)}>{st.data.months.map((m: string) => <option key={m} value={m}>{m}</option>)}</select></label>
      <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => exportCsv(`partner-settlement-${st.data.month}.csv`, st.data.partners)}>Export CSV</button>
    </>)} />
    <p className="dg-muted" style={{ marginTop: 0 }}>Darwin month. Each reward is owed at the rate fixed when it was served. A month can be marked paid once it is over; the café sees the reference on its statement.</p>
    <Table rows={st.data?.partners} empty="No rewards redeemed this month." cols={[
      { key: 'name', label: 'Partner' }, { key: 'redeemed', label: 'Redeemed', num: true }, { key: 'owed_cents', label: 'Owed', num: true, render: (r) => <strong>{money(r.owed_cents)}</strong> },
      { key: 'paid', label: 'Paid', render: (r) => (r.paid_at ? <Chip tone="green">{`Paid ${date(r.paid_at)}${r.paid_ref ? `, ${r.paid_ref}` : ''}`}</Chip> : st.data?.open ? <Chip>Month open</Chip> : <Chip tone="ochre">Due</Chip>) },
      { key: 'act', label: '', render: (r) => (<span className="actions">
        <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => run(() => downloadFile(`/admin/partner-settlements/${r.id}/${st.data.month}?format=pdf`), 'Statement downloaded')}>Statement</button>
        {!r.paid_at && !st.data?.open && <button className="dg-btn dg-btn--sm" onClick={() => pay(r)}>Mark paid</button>}</span>) },
    ]} />
    <Section title="All reward codes" />
    <Table rows={data?.items} cols={[
      { key: 'code', label: 'Code', render: (r) => <strong>{r.code}</strong> }, { key: 'title', label: 'Reward' }, { key: 'partner_name', label: 'Partner' },
      { key: 'user_name', label: 'Customer' }, { key: 'issued_at', label: 'Issued', render: (r) => date(r.issued_at) },
      { key: 'status', label: 'Status', render: (r) => <Chip tone={r.status === 'redeemed' ? 'green' : r.status === 'issued' ? 'ochre' : ''}>{label(REDEMPTION_STATUS, r.status)}</Chip> },
      { key: 'redeemed_at', label: 'Redeemed', render: (r) => dateTime(r.redeemed_at) },
      { key: 'settlement_cents', label: 'Rate', num: true, render: (r) => (r.settlement_cents != null ? money(r.settlement_cents) : '') },
    ]} />
  </>);
}

/** Round 17: points expiry, tiers, birthday/streak bonuses, referral rules; what's outstanding; run the scheduled job now. */
function Programme() {
  const { data, error, reload } = useLoad(() => get('/admin/loyalty/settings'));
  const ov = useLoad(() => get('/admin/loyalty/overview'));
  const [f, setF] = useState<any>(null);
  const run = useRun();
  useEffect(() => { if (data) setF(JSON.parse(JSON.stringify(data.settings))); }, [data]);
  if (error) return <ErrorMsg error={error} />;
  if (!f) return null;
  const num = (k: string, lbl: string, help?: string) => (
    <label className="dg-field"><span>{lbl}</span><input className="dg-input" type="number" value={f[k]} onChange={(e) => setF({ ...f, [k]: Number(e.target.value) })} />{help && <small className="dg-muted">{help}</small>}</label>);
  return (<>
    {!data.ready && <p className="dg-note">Database migration 021 is not applied yet: expiry, birthday and streak bonuses, win-back and settlement records are off. Tiers and referral rules work.</p>}
    {ov.data && <div className="kpis">
      <div className="kpi"><b>{ov.data.points_outstanding.toLocaleString()}</b><span>Points held by riders ({money(ov.data.liability_cents)} if all used)</span></div>
      <div className="kpi"><b>{ov.data.earned_30d.toLocaleString()}</b><span>Earned, last 30 days</span></div>
      <div className="kpi"><b>{ov.data.used_30d.toLocaleString()}</b><span>Used, last 30 days</span></div>
      <div className="kpi"><b>{ov.data.expired_30d.toLocaleString()}</b><span>Expired, last 30 days</span></div>
      <div className="kpi"><b>{ov.data.referrals_30d}</b><span>Referrals rewarded, 30 days</span></div>
    </div>}
    {ov.data && <Table rows={ov.data.tiers} rowKey={(t) => t.key} cols={[{ key: 'name', label: 'Tier' }, { key: 'min_trips', label: 'From trips (12 months)', num: true }, { key: 'multiplier', label: 'Points', num: true, render: (t) => `${t.multiplier}x` }, { key: 'riders', label: 'Riders', num: true }]} />}
    <form className="panel" style={{ marginTop: 14 }} onSubmit={async (e) => { e.preventDefault(); if (await run(() => put('/admin/loyalty/settings', f), 'Saved')) { void reload(); void ov.reload(); } }}>
      <h3>Points expiry</h3>
      <div className="form-grid">{num('expiry_months', 'Months with no activity before points expire', '0 = never')}{num('warn_days', 'Warn this many days before')}</div>
      <h3>Tiers</h3>
      <p className="dg-muted" style={{ marginTop: 0 }}>By completed trips in the last 12 months. The points multiplier applies to what the rider earns on each trip.</p>
      {f.tiers.map((t: any, i: number) => (
        <div className="form-grid" key={i}>
          <label className="dg-field"><span>Name</span><input className="dg-input" value={t.name} onChange={(e) => { const tiers = [...f.tiers]; tiers[i] = { ...t, name: e.target.value }; setF({ ...f, tiers }); }} /></label>
          <label className="dg-field"><span>From trips</span><input className="dg-input" type="number" min={0} disabled={i === 0} value={t.min_trips} onChange={(e) => { const tiers = [...f.tiers]; tiers[i] = { ...t, min_trips: Number(e.target.value) }; setF({ ...f, tiers }); }} /></label>
          <label className="dg-field"><span>Points multiplier</span><input className="dg-input" type="number" min={1} max={3} step={0.05} value={t.multiplier} onChange={(e) => { const tiers = [...f.tiers]; tiers[i] = { ...t, multiplier: Number(e.target.value) }; setF({ ...f, tiers }); }} /></label>
        </div>
      ))}
      <h3>Bonuses (riders opt in)</h3>
      <div className="form-grid">{num('birthday_points', 'Birthday points', '0 = off')}{num('streak_weeks', 'Streak: weeks in a row')}{num('streak_points', 'Streak points', '0 = off')}</div>
      <h3>Referrals</h3>
      <div className="form-grid">{num('referral_bonus_points', 'Points each')}
        <label className="dg-field"><span>Friend's first trip at least ($)</span><input className="dg-input" type="number" step={0.5} value={f.referral_min_fare_cents / 100} onChange={(e) => setF({ ...f, referral_min_fare_cents: Math.round(Number(e.target.value) * 100) })} /></label>
        {num('referral_monthly_cap', 'Bonuses per referrer per month')}</div>
      <h3>Win-back</h3>
      <div className="form-grid">{num('winback_days', 'Lapsed after days without a trip')}{num('winback_every_days', 'At most once every (days)')}</div>
      <div className="actions"><button className="dg-btn dg-btn--sm dg-btn--dark">Save</button>
        <button type="button" className="dg-btn dg-btn--sm dg-btn--ghost" onClick={async () => { const r = await run(() => post('/admin/loyalty/run'), undefined); if (r) window.alert(`Warned ${r.warned}, expired ${r.expired} (${r.expired_points} points), birthdays ${r.birthdays}, café codes expired ${r.codes_expired}.`); }}>Run expiry and birthdays now</button></div>
    </form>
  </>);
}

/** Round 17: win-back for riders who said yes to offers and stopped riding (Spam Act wording added by the server). */
function WinBack() {
  const [days, setDays] = useState('');
  const pre = useLoad(() => get(`/admin/loyalty/winback${days ? `?days=${days}` : ''}`), [days]);
  const [f, setF] = useState({ title: 'We miss you', body: '', promo_code: '', channel: 'app' });
  const run = useRun();
  if (pre.error) return <ErrorMsg error={pre.error} />;
  return (<>
    <p className="dg-muted" style={{ maxWidth: 760 }}>Sends an offer to riders who said yes to offers and haven't taken a trip for a while. Each rider gets at most one every {pre.data?.every_days ?? 90} days. A promo code is given only to the riders it's sent to (make the code "targeted" in Pricing so nobody else can use it).</p>
    <form className="panel" onSubmit={async (e) => {
      e.preventDefault();
      if (!window.confirm(`Send to ${pre.data?.count ?? 0} riders?`)) return;
      const r = await run(() => post('/admin/loyalty/winback', { days: days ? Number(days) : undefined, title: f.title, body: f.body, promo_code: f.promo_code || null, channel: f.channel }));
      if (r) { window.alert(`Sent ${r.sent}, skipped ${r.skipped}.`); void pre.reload(); }
    }}>
      <div className="form-grid">
        <label className="dg-field"><span>No trip for (days)</span><input className="dg-input" type="number" min={14} max={365} placeholder={String(pre.data?.days ?? 60)} value={days} onChange={(e) => setDays(e.target.value)} /></label>
        <label className="dg-field"><span>Send as</span><select className="dg-select" value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}><option value="app">App notification</option><option value="sms">Text</option></select></label>
        <label className="dg-field"><span>Title</span><input className="dg-input" maxLength={60} required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="dg-field"><span>Promo code (optional)</span><input className="dg-input" maxLength={30} value={f.promo_code} onChange={(e) => setF({ ...f, promo_code: e.target.value.toUpperCase() })} /></label>
        <label className="dg-field full"><span>Message</span><textarea className="dg-input" maxLength={200} required value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} /></label>
      </div>
      <p className="dg-muted">{pre.data ? `${pre.data.count} riders would get this. ${pre.data.not_consented} riders haven't said yes to offers and won't.` : 'Counting…'}</p>
      <button className="dg-btn dg-btn--sm dg-btn--dark" disabled={!pre.data?.count}>Send</button>
    </form>
  </>);
}

function Vouchers({ partners }: { partners: [string, string][] }) {
  const { data, reload } = useLoad(() => get('/admin/vouchers'));
  const [f, setF] = useState({ count: '20', value: '20', batch: `batch-${new Date().toISOString().slice(0, 10)}`, partner_id: '', for_sale: true });
  const [codes, setCodes] = useState<string[] | null>(null);
  const [made, setMade] = useState<any>(null);
  const run = useRun();
  return (<>
    <p className="dg-muted" style={{ maxWidth: 760 }}>Prepaid voucher cards let customers without a bank card pay for trips. Print a batch, sell them at partner shops or community organisations, and customers add the code in the app (Wallet) or a dispatcher adds it for phone bookings.</p>
    <form className="panel no-print" onSubmit={async (e) => {
      e.preventDefault();
      const r = await run(() => post('/admin/vouchers', { count: Number(f.count), value_cents: Math.round(Number(f.value) * 100), batch: f.batch, partner_id: f.partner_id || undefined, for_sale: f.for_sale }), 'Vouchers created');
      if (r) { setCodes(r.codes); setMade(r); void reload(); }
    }}>
      <h3>Create a batch</h3>
      <div className="form-grid">
        <label className="dg-field"><span>How many</span><input className="dg-input" type="number" min={1} max={500} value={f.count} onChange={(e) => setF({ ...f, count: e.target.value })} /></label>
        <label className="dg-field"><span>Value each ($)</span><input className="dg-input" type="number" min={5} max={200} step={5} value={f.value} onChange={(e) => setF({ ...f, value: e.target.value })} /></label>
        <label className="dg-field"><span>Batch name</span><input className="dg-input" value={f.batch} onChange={(e) => setF({ ...f, batch: e.target.value })} /></label>
        <label className="dg-field"><span>Selling partner (optional)</span><select className="dg-select" value={f.partner_id} onChange={(e) => setF({ ...f, partner_id: e.target.value })}><option value="">Any</option>{partners.map(([id, n]) => <option key={id} value={id}>{n}</option>)}</select></label>
        <label className="dg-check full"><input type="checkbox" checked={f.for_sale} onChange={(e) => setF({ ...f, for_sale: e.target.checked })} />
          <span>For sale at a shop: works only after the shop records the sale, valid for 3 years (Australian Consumer Law). Untick for cards given away free.</span></label>
      </div>
      <button className="dg-btn dg-btn--sm dg-btn--dark">Create vouchers</button>
    </form>
    {codes && (
      <div className="panel" style={{ marginTop: 14 }}>
        <div className="actions no-print"><button className="dg-btn dg-btn--sm" onClick={() => print()}>Print cards</button></div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 10, marginTop: 10 }}>
          {codes.map((c) => <VoucherCard key={c} code={c} value={f.value} expires={made?.expires_at} sale={!!made?.needs_activation} />)}
        </div>
      </div>
    )}
    <Section title="Vouchers" right={data && <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => exportCsv('vouchers.csv', data.items)}>Export CSV</button>} />
    <Table rows={data?.items} rowKey={(v) => v.code} cols={[
      { key: 'code', label: 'Code', render: (v) => <strong>{v.code}</strong> }, { key: 'value_cents', label: 'Value', num: true, render: (v) => money(v.value_cents) },
      { key: 'batch', label: 'Batch' }, { key: 'partner_name', label: 'Sold by' }, { key: 'sold_at', label: 'Sold', render: (v) => date(v.sold_at) },
      { key: 'redeemed_at', label: 'Used', render: (v) => (v.redeemed_at ? date(v.redeemed_at) : <Chip tone="green">Unused</Chip>) },
      { key: 'expires_at', label: 'Expires', render: (v) => date(v.expires_at) },
    ]} />
  </>);
}

function VoucherCard({ code, value, expires, sale }: { code: string; value: string; expires?: string; sale: boolean }) {
  const [qr, setQr] = useState('');
  useEffect(() => { QRCode.toDataURL(code, { margin: 1, width: 160 }).then(setQr).catch(() => setQr('')); }, [code]);
  return (
    <div style={{ border: '2px dashed var(--line)', borderRadius: 10, padding: 12, breakInside: 'avoid', display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center' }}>
      <div>
        <strong style={{ fontFamily: 'var(--font-display)' }}>DingoGo credit ${value}</strong>
        <div style={{ fontSize: '1.3rem', fontWeight: 700, letterSpacing: '.08em', margin: '6px 0' }}>{code}</div>
        <small>Add in the DingoGo app under Wallet, or quote it when you call to book.{expires ? ` Use by ${date(expires)}.` : ''}{sale ? ' Works once sold at the counter.' : ''}</small>
      </div>
      {qr && <img src={qr} alt={`QR code for ${code}`} width={80} height={80} />}
    </div>
  );
}
