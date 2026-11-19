import { useEffect, useRef, useState } from 'react';
import { Link, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { Acknowledgement, ApiError, DraftNotice, Icon, MyReports, NotifySettings, SafetyReportForm, TrustedContacts, ago, date, del, get, langInfo, money, normaliseLang, patch, post, put, t, useLoad, Ranges } from '@dingogo/shared';
import { Dialog, Page, Spinner } from '../components/ui';
import { useMe } from '../ctx';
import { CLIENT_KINDS } from './Clients';

export function AccountScreen() {
  return (
    <Routes>
      <Route index element={<Menu />} />
      <Route path="profile" element={<Profile />} />
      <Route path="payment" element={<Payment />} />
      <Route path="notifications" element={<Inbox />} />
      <Route path="notifications/settings" element={<Page title="Notification settings" back="/account/notifications"><NotifySettings app="rider" /></Page>} />
      <Route path="help" element={<Help />} />
      <Route path="safety" element={<Safety />} />
      <Route path="safety/report" element={<SafetyReport />} />
      <Route path="privacy" element={<Privacy />} />
      <Route path="organisations" element={<Organisations />} />
    </Routes>
  );
}

function Menu() {
  const { me, signOut } = useMe();
  const unread = useLoad(() => get<{ notifications: any[] }>('/me/notifications'));
  const n = unread.data?.notifications.filter((x) => !x.read_at).length ?? 0;
  const items = [
    { to: 'profile', icon: 'user', title: 'Profile and preferences', sub: 'Name, emergency contact, accessibility, language' },
    { to: 'payment', icon: 'wallet', title: 'Payment and credit', sub: `${money(me?.user.wallet_cents ?? 0)} DingoGo credit` },
    { to: 'notifications', icon: 'bell', title: 'Notifications', sub: `${n ? `${n} unread` : 'All caught up'}. Settings and offers` },
    ...((me?.corporate_accounts?.length ?? 0) > 0 ? [{ to: '/business', icon: 'package', title: 'Business deliveries', sub: 'Parcels sent, runs of several drops, spreadsheet import' }] : []),
    ...((me?.corporate_accounts ?? []).some((a) => CLIENT_KINDS.includes(a.kind ?? '')) ? [{ to: '/clients', icon: 'users', title: 'Book for clients', sub: 'Rides for your clients, with their consent' }] : []),
    { to: 'help', icon: 'help', title: 'Help', sub: 'Lost property, fares, report a problem' },
    { to: 'safety', icon: 'shield', title: 'Safety', sub: 'Trusted contacts, trip sharing, reports, SOS' },
    { to: 'organisations', icon: 'users', title: 'Organisations', sub: 'Who can book rides for you' },
    { to: 'privacy', icon: 'lock', title: 'Privacy and your data', sub: 'Download or delete your data' },
  ];
  const lang = normaliseLang(me?.user.language);
  return (
    <Page title="Account">
      <div className="me">
        <div className="me__av" aria-hidden="true">{me?.user.name?.[0] ?? '?'}</div>
        <div>{lang !== 'en' && <span className="dg-muted">{t('greeting', lang)} <span className="dg-draft">(draft)</span></span>}<strong>{me?.user.name || 'Add your name'}</strong><span className="dg-muted">{me?.user.phone}</span>
          {me?.user.rating_avg && <span className="dg-muted"><Icon name="star" size={14} /> {Number(me.user.rating_avg).toFixed(1)} rider rating</span>}</div>
      </div>
      <ul className="list">
        {items.map((i) => (
          <li key={i.to}><Link to={i.to} className="row"><span className="row__icon"><Icon name={i.icon} size={20} /></span><span className="row__main"><strong>{i.title}</strong><span className="dg-muted">{i.sub}</span></span>
            <Icon name="chevronRight" size={18} className="row__chev" /></Link></li>
        ))}
      </ul>
      <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 20 }} onClick={signOut}>Sign out</button>
      <Ranges height={40} fill="var(--ochre-soft)" style={{ marginTop: 28 }} />
      <p className="dg-muted" style={{ fontSize: 'var(--fs-xs)', textAlign: 'center' }}>DingoGo Rideshare & Courier. Aboriginal-owned, Mparntwe (Alice Springs).</p>
      <Acknowledgement style={{ textAlign: 'center', fontSize: 'var(--fs-xs)' }} />
    </Page>
  );
}

function Profile() {
  const { me, reload } = useMe();
  const u = me?.user;
  const [f, setF] = useState({ name: '', email: '', ec_name: '', ec_phone: '', language: 'en', simple: false, marketing: false, wheelchair: false, assistance_animal: false, hearing: false, vision: false, notes: '' });
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!u) return;
    setF({ name: u.name ?? '', email: u.email ?? '', ec_name: u.emergency_contact?.name ?? '', ec_phone: u.emergency_contact?.phone ?? '', language: normaliseLang(u.language),
      simple: !!u.accessibility?.simple, marketing: u.marketing_opt_in, wheelchair: !!u.accessibility?.wheelchair, assistance_animal: !!u.accessibility?.assistance_animal,
      hearing: !!u.accessibility?.hearing, vision: !!u.accessibility?.vision, notes: u.accessibility?.notes ?? '' });
  }, [u?.id]); // eslint-disable-line

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setSaved(false);
    try {
      await patch('/me', {
        name: f.name || undefined, email: f.email, language: f.language,
        emergency_contact: f.ec_name && f.ec_phone ? { name: f.ec_name, phone: f.ec_phone } : null,
        accessibility: { ...(u?.accessibility ?? {}), wheelchair: f.wheelchair, assistance_animal: f.assistance_animal, hearing: f.hearing, vision: f.vision, notes: f.notes, simple: f.simple },
      });
      await reload(); setSaved(true);
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Could not save'); }
  }
  const chk = (k: keyof typeof f, label: React.ReactNode) => (
    <label className="dg-check"><input type="checkbox" checked={!!f[k]} onChange={(e) => setF({ ...f, [k]: e.target.checked })} /><span>{label}</span></label>
  );
  if (!u) return <Page title="Profile" back="/account"><Spinner /></Page>;
  return (
    <Page title="Profile" back="/account">
      <form onSubmit={save}>
        <label className="dg-field"><span>Name</span><input className="dg-input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></label>
        <label className="dg-field"><span>Email for receipts</span><input className="dg-input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} autoComplete="email" /></label>
        <h2 className="section__title" style={{ marginTop: 24 }}>Emergency contact</h2>
        <p className="dg-muted" style={{ marginTop: 0 }}>If you press SOS, we text this person your live trip link. Add more people in Account, Safety.</p>
        <div className="grid2">
          <label className="dg-field"><span>Their name</span><input className="dg-input" value={f.ec_name} onChange={(e) => setF({ ...f, ec_name: e.target.value })} /></label>
          <label className="dg-field"><span>Their mobile</span><input className="dg-input" type="tel" value={f.ec_phone} onChange={(e) => setF({ ...f, ec_phone: e.target.value })} /></label>
        </div>
        <h2 className="section__title" style={{ marginTop: 24 }}>Accessibility</h2>
        <p className="dg-muted" style={{ marginTop: 0 }}>We share these with your driver so they can help.</p>
        {chk('assistance_animal', 'I travel with an assistance animal')}
        {chk('wheelchair', 'I use a wheelchair or mobility aid')}
        {chk('hearing', 'I am Deaf or hard of hearing (driver will message, not call)')}
        {chk('vision', 'I am blind or have low vision (driver will come to the door)')}
        <label className="dg-field"><span>Anything else drivers should know</span><input className="dg-input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></label>
        <h2 className="section__title" style={{ marginTop: 24 }}>Easy to use</h2>
        {chk('simple', <>Simple mode<br /><small className="dg-muted">Big pictures, fewer words, fewer choices. The app reads your trip out loud.</small></>)}
        <h2 className="section__title" style={{ marginTop: 24 }}>Language</h2>
        <label className="dg-field"><span>App language</span>
          <select className="dg-select" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
            {(['en', 'aer', 'rop'] as const).map((l) => <option key={l} value={l}>{langInfo(l).english_name}{l !== 'en' ? ' (draft, a few words only)' : ''}</option>)}
          </select></label>
        <DraftNotice lang={f.language} />
        {f.language !== 'en' && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>We're making these words with Arrernte and Kriol speakers. Tell us in Help if a word is wrong.</p>}
        <h2 className="section__title" style={{ marginTop: 24 }}>Offers and notifications</h2>
        <p><Link to="/account/notifications/settings">Choose what we send you, and whether you'd like offers</Link></p>
        {err && <p className="dg-error" role="alert">{err}</p>}
        {saved && <p className="callout callout--green" role="status">Saved.</p>}
        <button className="dg-btn dg-btn--dark dg-btn--block" style={{ marginTop: 12 }}>Save changes</button>
      </form>
      <Concession />
    </Page>
  );
}

// Stripe.js must be loaded from js.stripe.com (PCI): card numbers go from Stripe's own fields straight to Stripe, never to DingoGo.
let stripeJs: Promise<any> | null = null;
function loadStripe(publishableKey: string) {
  stripeJs ??= new Promise((resolve, reject) => {
    const w = window as any;
    if (w.Stripe) return resolve(w.Stripe(publishableKey));
    const el = document.createElement('script');
    el.src = 'https://js.stripe.com/v3/';
    el.async = true;
    el.onload = () => (w.Stripe ? resolve(w.Stripe(publishableKey)) : reject(new Error('no Stripe')));
    el.onerror = () => { stripeJs = null; el.remove(); reject(new Error('load failed')); };
    document.head.appendChild(el);
  });
  return stripeJs;
}

/** Stripe Payment Element for one card: SetupIntent from the API, confirmed on the device (bank check if the bank asks),
 *  then the API reads the card from Stripe. */
function AddCard({ publishableKey, onDone, onCancel }: { publishableKey: string; onDone: (msg: string) => void; onCancel: () => void }) {
  const host = useRef<HTMLDivElement>(null);
  const st = useRef<{ stripe: any; elements: any } | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let gone = false;
    (async () => {
      try {
        const [stripe, setup] = await Promise.all([loadStripe(publishableKey), post('/payment-methods/setup')]);
        if (gone || !host.current) return;
        const dark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
        const elements = stripe.elements({ clientSecret: setup.client_secret, appearance: { theme: dark ? 'night' : 'stripe', variables: { borderRadius: '10px' } } });
        const pe = elements.create('payment', { layout: 'tabs', wallets: { applePay: 'never', googlePay: 'never' } });
        pe.on('ready', () => { if (!gone) setReady(true); });
        pe.mount(host.current);
        st.current = { stripe, elements };
      } catch (e) {
        if (!gone) setErr(e instanceof ApiError ? e.message : 'We could not load the card form. Check your signal and try again.');
      }
    })();
    return () => { gone = true; try { st.current?.elements.getElement('payment')?.destroy(); } catch { /* already gone */ } };
  }, [publishableKey]);
  const save = async () => {
    if (!st.current || busy) return;
    setBusy(true); setErr(null);
    try {
      const { error, setupIntent } = await st.current.stripe.confirmSetup({ elements: st.current.elements, redirect: 'if_required',
        confirmParams: { return_url: `${location.origin}${location.pathname}` } });
      if (error) { setErr(error.message ?? 'Your card was not accepted. Check the details and try again.'); return; }
      const r = await post('/payment-methods', { setup_intent_id: setupIntent.id });
      onDone(r.already_saved ? 'That card is already saved.' : `${r.method.brand} ending ${r.method.last4} saved.`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Something went wrong. Try again.');
    } finally { setBusy(false); }
  };
  return (
    <div className="addcard">
      <h3 className="section__title">Add a card</h3>
      <div ref={host} className="addcard__element" aria-busy={!ready} />
      {!ready && !err && <Spinner />}
      {err && <p className="dg-error" role="alert">{err}</p>}
      <p className="dg-muted" style={{ fontSize: 'var(--fs-xs)' }}>Your card details go straight to Stripe, our payment processor. DingoGo never sees or stores your card number. Your bank may ask you to confirm.</p>
      <div className="tips__row">
        <button className="dg-btn dg-btn--dark" aria-disabled={!ready || busy} onClick={() => void save()}>{busy ? 'Saving…' : 'Save card'}</button>
        <button className="dg-btn dg-btn--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function Payment() {
  const { me, reload } = useMe();
  const pm = useLoad(() => get('/payment-methods'));
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<any | null>(null);
  const mode: 'stripe' | 'test' | 'off' = pm.data?.cards?.mode ?? 'test';
  const pk: string | null = pm.data?.cards?.publishable_key ?? null;
  const methods: any[] = pm.data?.methods ?? [];
  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); await Promise.all([pm.reload(), reload()]); setMsg(ok); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Something went wrong'); }
    finally { setBusy(false); }
  };
  const expiry = (c: any) => (c.exp_month && c.exp_year ? `expires ${String(c.exp_month).padStart(2, '0')}/${String(c.exp_year).slice(-2)}` : null);
  return (
    <Page title="Payment" back="/account">
      <div className="points points--green">
        <div><span className="points__n">{money(me?.user.wallet_cents ?? 0)}</span><span className="points__l">DingoGo credit</span></div>
        <p>Use it like cash on any trip. {mode === 'off' ? 'Buy a prepaid card at a partner shop.' : 'Top up with a card, or buy a prepaid card at a partner shop.'}</p>
      </div>
      {err && <p className="dg-error" role="alert">{err}</p>}
      {msg && <p className="callout callout--green" role="status">{msg}</p>}
      <section className="section">
        <h2 className="section__title">Cards</h2>
        {pm.loading ? <Spinner /> : mode === 'off' ? (
          <p className="callout callout--dusk"><strong>Card payments are coming soon.</strong> For now, pay with DingoGo credit (prepaid cards from partner shops work too){' '}
            or a business account. Parcels can also be paid in cash.</p>
        ) : (
          <>
            <ul className="list">
              {methods.map((c) => (
                <li key={c.id} className="row">
                  <span className="row__icon"><Icon name="card" size={20} /></span>
                  <span className="row__main"><strong>{c.brand} ending {c.last4}</strong>
                    <span className="dg-muted">{[c.is_default ? 'Default' : null, expiry(c)].filter(Boolean).join(', ')}</span></span>
                  {!c.is_default && <button className="dg-btn dg-btn--ghost dg-btn--sm" disabled={busy} aria-label={`Make ${c.brand} ending ${c.last4} your default card`}
                    onClick={() => act(() => post(`/payment-methods/${c.id}/default`), `${c.brand} ending ${c.last4} is now your default card.`)}>Make default</button>}
                  <button className="dg-btn dg-btn--ghost dg-btn--sm" disabled={busy} aria-label={`Remove ${c.brand} ending ${c.last4}`} onClick={() => setRemoving(c)}>Remove</button>
                </li>
              ))}
              {!methods.length && <li className="dg-muted">No cards saved yet.</li>}
            </ul>
            {mode === 'stripe' && !pk && <p className="dg-note" role="status">Adding cards in the app is coming soon. Call us if you need help.</p>}
            {mode === 'stripe' && pk && (adding
              ? <AddCard publishableKey={pk} onCancel={() => setAdding(false)} onDone={(m) => { setAdding(false); void act(async () => undefined, m); }} />
              : <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 10 }} disabled={busy} onClick={() => { setMsg(null); setErr(null); setAdding(true); }}>Add a card</button>)}
            {mode === 'test' && (<>
              <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 10 }} disabled={busy}
                onClick={() => act(async () => { await post('/payment-methods/setup'); await post('/payment-methods', { provider_ref: `pm_test_${Date.now()}`, brand: 'Visa', last4: '4242' }); }, 'Test card added.')}>
                Add a test card
              </button>
              <p className="dg-muted" style={{ fontSize: 'var(--fs-xs)' }}>Test mode: adds a Visa 4242 test card and no money moves. In the live app your card details go straight to Stripe and never touch DingoGo's servers.</p>
            </>)}
            <p className="dg-muted" style={{ fontSize: 'var(--fs-xs)' }}>When you book with a card we hold the fare plus 20% and take only the final price at the end. Booked trips are held 15 minutes before pickup.</p>
          </>
        )}
      </section>
      {mode !== 'off' && (
        <section className="section">
          <h2 className="section__title">Top up credit</h2>
          {mode === 'stripe' && !methods.length ? <p className="dg-muted">Add a card first to top up.</p> : (
            <div className="tips__row">
              {[2000, 5000, 10000].map((c) => <button key={c} className="dg-btn dg-btn--ghost" disabled={busy}
                onClick={() => { const key = `topup-${c}-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`; void act(() => post('/wallet/topup', { cents: c }, { headers: { 'Idempotency-Key': key } }), `${money(c)} added.`); }}>{money(c)}</button>)}
            </div>
          )}
        </section>
      )}
      <section className="section">
        <h2 className="section__title">Prepaid card or voucher</h2>
        <form onSubmit={(e) => { e.preventDefault(); void act(async () => { const r = await post('/wallet/voucher', { code }); setCode(''); return r; }, 'Voucher added to your credit.'); }}>
          <label className="dg-field"><span>Code on the card</span><input className="dg-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. DGDEMO5000" /></label>
          <button className="dg-btn dg-btn--dark" disabled={busy || code.length < 6}>Add to credit</button>
        </form>
      </section>
      <Dialog open={!!removing} onClose={() => setRemoving(null)} title="Remove this card?">
        <p>{removing ? `${removing.brand} ending ${removing.last4}` : ''} will be removed from DingoGo.{removing?.is_default && methods.length > 1 ? ' Your newest other card becomes the default.' : ''}</p>
        <div className="tips__row">
          <button className="dg-btn dg-btn--dark" onClick={() => { const c = removing; setRemoving(null); void act(() => del(`/payment-methods/${c.id}`), 'Card removed.'); }}>Remove card</button>
          <button className="dg-btn dg-btn--ghost" onClick={() => setRemoving(null)}>Keep it</button>
        </div>
      </Dialog>
    </Page>
  );
}

function Inbox() {
  const { data, loading } = useLoad(() => get<{ notifications: any[] }>('/me/notifications'));
  useEffect(() => { void post('/me/notifications/read'); }, []);
  return (
    <Page title="Notifications" back="/account">
      <p><Link to="/account/notifications/settings" className="dg-btn dg-btn--ghost dg-btn--sm"><Icon name="settings" size={18} />Notification settings</Link></p>
      {loading && <Spinner />}
      {!loading && !data?.notifications.length && <p className="empty">Nothing here yet. Trip updates and offers will show up here.</p>}
      <ul className="inbox">
        {data?.notifications.map((n) => (
          <li key={n.id} className={n.read_at ? '' : 'is-new'}>
            <strong>{n.title}</strong><p>{n.body}</p><span className="dg-muted">{ago(n.created_at)}</span>
          </li>
        ))}
      </ul>
    </Page>
  );
}

const CATS = [
  ['lost_item', 'I left something in the car'], ['fare', 'A question about my fare'], ['safety', 'A safety concern'], ['driver', 'Feedback about my driver'],
  ['parcel', 'A parcel problem'], ['accessibility', 'Accessibility'], ['assistance_animal_refused', 'A driver refused my assistance animal'],
  ['app', 'The app isn’t working'], ['other', 'Something else'],
] as const;

function Help() {
  const [sp] = useSearchParams();
  const tripId = sp.get('trip') ?? undefined;
  const tickets = useLoad(() => get<{ tickets: any[] }>('/support'));
  const cfg = useLoad(() => get('/public/config'));
  const startCat = sp.get('category');
  const [f, setF] = useState({ category: CATS.some((c) => c[0] === startCat) ? startCat! : 'lost_item', subject: '', message: '' });
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const sentRef = useRef<HTMLParagraphElement>(null);
  async function send(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      await post('/support', { ...f, subject: f.subject || CATS.find((c) => c[0] === f.category)![1], trip_id: tripId });
      setSent(true); setF({ ...f, subject: '', message: '' }); await tickets.reload();
      sentRef.current?.focus();
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Could not send'); }
  }
  const phone = cfg.data?.support?.phone;
  return (
    <Page title="Help" back="/account">
      <div className="callout callout--earth"><strong>In danger?</strong> Call <a href="tel:000">000</a>. During a trip, use the SOS button on the trip screen.</div>
      {phone && <p>Talk to a person: <a href={`tel:${phone.replace(/\s/g, '')}`}>{phone}</a>, {cfg.data?.support?.hours}.</p>}
      <form onSubmit={send} className="block">
        <h2 className="section__title">Send us a message{tripId ? ' about this trip' : ''}</h2>
        {f.category === 'assistance_animal_refused' && (
          <p className="callout callout--dusk">Refusing an assistance animal is against the law and DingoGo policy. Tell us what happened. We review every report and follow it up with the driver.</p>
        )}
        <label className="dg-field"><span>What's it about?</span>
          <select className="dg-select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="dg-field"><span>Subject (optional)</span><input className="dg-input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></label>
        <label className="dg-field"><span>Tell us what happened</span><textarea className="dg-textarea" required minLength={5} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></label>
        {err && <p className="dg-error" role="alert">{err}</p>}
        {sent && <p className="callout callout--green" role="status" tabIndex={-1} ref={sentRef}>Message sent. We'll reply in the app and by SMS.</p>}
        <button className="dg-btn dg-btn--dark">Send message</button>
      </form>
      {tickets.data && tickets.data.tickets.length > 0 && (
        <section className="section">
          <h2 className="section__title">Your messages</h2>
          <ul className="inbox">{tickets.data.tickets.map((t) => (
            <li key={t.id}><strong>{t.subject}</strong><p>{t.resolution ?? t.message}</p><span className="dg-muted">{t.status === 'resolved' ? 'Resolved' : 'Open'}, {date(t.created_at)}</span></li>
          ))}</ul>
        </section>
      )}
    </Page>
  );
}

function Safety() {
  return (
    <Page title="Safety" back="/account">
      <section className="section" aria-labelledby="tc-h">
        <h2 className="section__title" id="tc-h">Trusted contacts</h2>
        <TrustedContacts role="rider" />
      </section>
      <section className="section" aria-labelledby="rep-h">
        <h2 className="section__title" id="rep-h">Report a safety problem</h2>
        <p className="dg-muted" style={{ marginTop: 0 }}>Something happened on a trip, or after it? Tell our safety team. To report a trip, open it from Trips and choose "Report a safety problem".</p>
        <Link className="dg-btn dg-btn--ghost" to="/account/safety/report">Report a safety problem</Link>
        <h3 style={{ marginTop: 16 }}>Your reports</h3>
        <MyReports />
      </section>
      <div className="prose">
        <h2>Check the car and the PIN</h2>
        <p>Before you get in, check the rego plate matches the app. Tell the driver your 4-digit trip PIN. Drivers can't start the trip without it. If the driver or car doesn't match, don't get in: report it.</p>
        <h2>Share your trip</h2>
        <p>Tap "Share my trip" to send family a live map link, or "Text my contacts". They don't need the app. You can also share every trip, or night trips, automatically.</p>
        <h2>SOS</h2>
        <p>The red SOS button on the trip screen calls 000 and alerts our safety team with your location. It also shows what to tell 000: where you are and the car. Your trusted contacts get a text too.</p>
        <h2>Are you OK?</h2>
        <p>If the car stops for a long time or goes well off the expected route, we ask "Are you OK?". If you don't answer within a few minutes, our team checks on you and texts your trusted contacts.</p>
        <h2>Our drivers</h2>
        <p>Every driver holds an NT H endorsement and commercial passenger vehicle ID, and has passed a national police check and medical. They do disability awareness training and must carry assistance animals. Drivers have limits on how long they can drive without a rest.</p>
        <h2>Women riders</h2>
        <p>You can ask for a woman driver when you book. DingoGo checks each woman driver's ID before turning this on. Reports of sexual harassment or assault put the other person's account on hold while we look into it. For support any time, call 1800RESPECT on <a href="tel:1800737732">1800 737 732</a>.</p>
        <h2>No alcohol in the car</h2>
        <p>Drinking in DingoGo cars isn't allowed, and we don't deliver alcohol.</p>
      </div>
    </Page>
  );
}

function SafetyReport() {
  const [params] = useSearchParams();
  const tripId = params.get('trip') ?? undefined;
  return (
    <Page title="Report a safety problem" back={tripId ? `/trips/${tripId}` : '/account/safety'}>
      <SafetyReportForm tripId={tripId} />
    </Page>
  );
}

function Privacy() {
  const nav = useNavigate();
  const { signOut } = useMe();
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function download() {
    const data = await get('/me/export');
    const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'dingogo-my-data.json'; a.click(); URL.revokeObjectURL(url);
  }
  async function remove() {
    setErr(null);
    try { await del('/me'); signOut(); nav('/'); } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not delete'); setOpen(false); }
  }
  return (
    <Page title="Privacy" back="/account">
      <div className="prose">
        <p>We use your location only to arrange and track trips, and keep trip records for 7 years because the tax office requires it. We don't sell your data or share it with café partners. They only see a voucher code.</p>
      </div>
      <button className="dg-btn dg-btn--ghost dg-btn--block" onClick={download}>Download my data</button>
      <button className="dg-btn dg-btn--danger dg-btn--block" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>Delete my account</button>
      {err && <p className="dg-error" role="alert" style={{ marginTop: 12 }}>{err}</p>}
      <Dialog open={open} onClose={() => setOpen(false)} title="Delete your account?">
        <p>This removes your name, contacts and preferences, and you'll lose your points and credit. Trip records stay, without your details, for tax purposes. This can't be undone.</p>
        <button className="dg-btn dg-btn--danger dg-btn--block" onClick={remove}>Delete my account</button>
        <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 10 }} onClick={() => setOpen(false)}>Keep my account</button>
      </Dialog>
    </Page>
  );
}

/** Concession card for concession fares (only when DingoGo has switched them on). Only the last 4 digits are sent. */
function Concession() {
  const { me, reload } = useMe();
  const cfg = useLoad(() => get('/public/config'), []);
  const cp = cfg.data?.community_pricing;
  const card = me?.user.concession as any;
  const [f, setF] = useState({ type: '', last4: '', expires: '' });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  if (!cp?.concession) return null;
  const types = Object.entries<string>(cp.types ?? {});
  async function send(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try { await put('/me/concession', { type: f.type || types[0]?.[0], last4: f.last4, expires: f.expires }); await reload(); }
    catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Could not send'); } finally { setBusy(false); }
  }
  return (
    <section style={{ marginTop: 28 }} aria-labelledby="conc-h">
      <h2 id="conc-h" className="section__title">Concession fares</h2>
      <p className="dg-muted" style={{ marginTop: 0 }}>With a concession card, rides are {cp.pct}% off{cp.max_cents ? ` (up to ${money(cp.max_cents)} a trip)` : ''}. DingoGo pays the difference, not your driver.</p>
      {card && card.status !== 'rejected' ? (
        <p className={`callout ${card.status === 'approved' ? 'callout--green' : ''}`} role="status">
          {card.status === 'approved' ? 'Concession fares are on' : 'We are checking your card'}: {cp.types?.[card.type] ?? card.type} ending {card.last4}, expires {date(card.expires)}.{' '}
          <button type="button" className="linkbtn" onClick={async () => { await del('/me/concession'); await reload(); }}>Remove</button>
        </p>
      ) : (
        <form onSubmit={send}>
          {card?.status === 'rejected' && <p className="dg-error" role="alert">Not approved: {card.note}</p>}
          <label className="dg-field"><span>Card</span>
            <select className="dg-select" value={f.type || types[0]?.[0]} onChange={(e) => setF({ ...f, type: e.target.value })}>
              {types.map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select></label>
          <div className="grid2">
            <label className="dg-field"><span>Last 4 digits of the card</span>
              <input className="dg-input" inputMode="numeric" maxLength={4} value={f.last4} onChange={(e) => setF({ ...f, last4: e.target.value.replace(/\D/g, '') })} /></label>
            <label className="dg-field"><span>Expiry date</span>
              <input className="dg-input" type="date" value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} /></label>
          </div>
          <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>Don't type the whole card number. We may ask to see the card.</p>
          {err && <p className="dg-error" role="alert">{err}</p>}
          <button className="dg-btn dg-btn--block" disabled={busy || f.last4.length !== 4 || !f.expires}>{busy ? 'Sending…' : 'Send for checking'}</button>
        </form>
      )}
    </section>
  );
}

/** Organisations (health services, community organisations, NDIS providers) the rider has let book rides for them. */
function Organisations() {
  const list = useLoad(() => get<{ consents: any[] }>('/me/consents'), []);
  const [msg, setMsg] = useState<string | null>(null);
  const current = list.data?.consents.filter((c) => c.current) ?? [];
  const past = list.data?.consents.filter((c) => !c.current) ?? [];
  return (
    <Page title="Organisations" back="/account">
      <p className="dg-muted" style={{ marginTop: 0 }}>These organisations can book DingoGo rides for you. They see only the rides they book, not your other trips. You get a text for each ride.</p>
      {list.loading ? <Spinner /> : current.length === 0 ? <p>No organisation can book rides for you.</p> : (
        <ul className="list">
          {current.map((c) => (
            <li key={c.id} className="row"><span className="row__main"><strong>{c.organisation}</strong>
              <span className="dg-muted">Since {date(c.given_at)}{c.expires_at ? `, until ${date(c.expires_at)}` : ''}</span></span>
              <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={async () => {
                await post(`/me/consents/${c.id}/withdraw`, {}); setMsg(`${c.organisation} can no longer book rides for you.`); await list.reload();
              }}>Stop</button></li>
          ))}
        </ul>
      )}
      {msg && <p className="callout callout--green" role="status">{msg}</p>}
      {past.length > 0 && <><h2 className="section__title" style={{ marginTop: 24 }}>Before</h2>
        <ul className="list">{past.map((c) => <li key={c.id} className="row"><span className="row__main"><strong>{c.organisation}</strong>
          <span className="dg-muted">{c.withdrawn_at ? `Stopped ${date(c.withdrawn_at)}` : `Ended ${date(c.expires_at)}`}</span></span></li>)}</ul></>}
    </Page>
  );
}
