import { useEffect, useRef, useState } from 'react';
import { Link, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, Icon, NotifySettings, ago, date, del, get, money, patch, post, useLoad, Ranges } from '@dingogo/shared';
import { Dialog, Page, Spinner } from '../components/ui';
import { useMe } from '../ctx';

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
      <Route path="privacy" element={<Privacy />} />
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
    { to: 'help', icon: 'help', title: 'Help', sub: 'Lost property, fares, report a problem' },
    { to: 'safety', icon: 'shield', title: 'Safety', sub: 'Trip PIN, sharing, SOS, our drivers' },
    { to: 'privacy', icon: 'lock', title: 'Privacy and your data', sub: 'Download or delete your data' },
  ];
  return (
    <Page title="Account">
      <div className="me">
        <div className="me__av" aria-hidden="true">{me?.user.name?.[0] ?? '?'}</div>
        <div><strong>{me?.user.name || 'Add your name'}</strong><span className="dg-muted">{me?.user.phone}</span>
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
    </Page>
  );
}

function Profile() {
  const { me, reload } = useMe();
  const u = me?.user;
  const [f, setF] = useState({ name: '', email: '', ec_name: '', ec_phone: '', language: 'en', marketing: false, wheelchair: false, assistance_animal: false, hearing: false, vision: false, notes: '' });
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!u) return;
    setF({ name: u.name ?? '', email: u.email ?? '', ec_name: u.emergency_contact?.name ?? '', ec_phone: u.emergency_contact?.phone ?? '', language: u.language ?? 'en',
      marketing: u.marketing_opt_in, wheelchair: !!u.accessibility?.wheelchair, assistance_animal: !!u.accessibility?.assistance_animal,
      hearing: !!u.accessibility?.hearing, vision: !!u.accessibility?.vision, notes: u.accessibility?.notes ?? '' });
  }, [u?.id]); // eslint-disable-line

  async function save(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setSaved(false);
    try {
      await patch('/me', {
        name: f.name || undefined, email: f.email, language: f.language,
        emergency_contact: f.ec_name && f.ec_phone ? { name: f.ec_name, phone: f.ec_phone } : null,
        accessibility: { wheelchair: f.wheelchair, assistance_animal: f.assistance_animal, hearing: f.hearing, vision: f.vision, notes: f.notes },
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
        <p className="dg-muted" style={{ marginTop: 0 }}>If you press SOS, we text this person your live trip link.</p>
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
        <h2 className="section__title" style={{ marginTop: 24 }}>Language</h2>
        <label className="dg-field"><span>App language</span>
          <select className="dg-select" value={f.language} onChange={(e) => setF({ ...f, language: e.target.value })}>
            <option value="en">English</option>
            <option value="arr" disabled>Arrernte (coming, being made with community)</option>
            <option value="wbp" disabled>Warlpiri (coming)</option>
          </select></label>
        <h2 className="section__title" style={{ marginTop: 24 }}>Offers and notifications</h2>
        <p><Link to="/account/notifications/settings">Choose what we send you, and whether you'd like offers</Link></p>
        {err && <p className="dg-error" role="alert">{err}</p>}
        {saved && <p className="callout callout--green" role="status">Saved.</p>}
        <button className="dg-btn dg-btn--dark dg-btn--block" style={{ marginTop: 12 }}>Save changes</button>
      </form>
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
      <div className="prose">
        <h2>Check the car and the PIN</h2>
        <p>Before you get in, check the rego plate matches the app. Tell the driver your 4-digit trip PIN. Drivers can't start the trip without it.</p>
        <h2>Share your trip</h2>
        <p>Tap "Share my trip" to send family a live map link. They don't need the app.</p>
        <h2>SOS</h2>
        <p>The red SOS button on the trip screen calls 000 and alerts our safety team with your location. If you've added an emergency contact, they get a text too.</p>
        <h2>Our drivers</h2>
        <p>Every driver holds an NT H endorsement and commercial passenger vehicle ID, and has passed a national police check and medical. They do disability awareness training and must carry assistance animals.</p>
        <h2>If a trip goes off route</h2>
        <p>If the car goes well off the expected route, we'll check in with you and our team is alerted.</p>
        <h2>No alcohol in the car</h2>
        <p>Drinking in DingoGo cars isn't allowed, and we don't deliver alcohol.</p>
      </div>
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
