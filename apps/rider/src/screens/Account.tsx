import { useEffect, useState } from 'react';
import { Link, Route, Routes, useNavigate, useSearchParams } from 'react-router-dom';
import { ApiError, Icon, ago, date, del, get, money, patch, post, useLoad, Ranges } from '@dingogo/shared';
import { Dialog, Page, Spinner } from '../components/ui';
import { useMe } from '../ctx';

export function AccountScreen() {
  return (
    <Routes>
      <Route index element={<Menu />} />
      <Route path="profile" element={<Profile />} />
      <Route path="payment" element={<Payment />} />
      <Route path="notifications" element={<Inbox />} />
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
    { to: 'notifications', icon: 'bell', title: 'Notifications', sub: n ? `${n} unread` : 'All caught up' },
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
        name: f.name || undefined, email: f.email, language: f.language, marketing_opt_in: f.marketing,
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
        <h2 className="section__title" style={{ marginTop: 24 }}>Offers</h2>
        {chk('marketing', <>Send me DingoGo offers and café deals<br /><small className="dg-muted">Optional. Trip updates and receipts always come through. You can turn offers off here any time.</small></>)}
        {err && <p className="dg-error" role="alert">{err}</p>}
        {saved && <p className="callout callout--green" role="status">Saved.</p>}
        <button className="dg-btn dg-btn--dark dg-btn--block" style={{ marginTop: 12 }}>Save changes</button>
      </form>
    </Page>
  );
}

function Payment() {
  const { me, reload } = useMe();
  const pm = useLoad(() => get('/payment-methods'));
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true); setErr(null); setMsg(null);
    try { await fn(); await Promise.all([pm.reload(), reload()]); setMsg(ok); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Something went wrong'); }
    finally { setBusy(false); }
  };
  return (
    <Page title="Payment" back="/account">
      <div className="points points--green">
        <div><span className="points__n">{money(me?.user.wallet_cents ?? 0)}</span><span className="points__l">DingoGo credit</span></div>
        <p>Use it like cash on any trip. Top up with a card, or buy a prepaid card at a partner shop.</p>
      </div>
      {err && <p className="dg-error" role="alert">{err}</p>}
      {msg && <p className="callout callout--green" role="status">{msg}</p>}
      <section className="section">
        <h2 className="section__title">Cards</h2>
        {pm.loading ? <Spinner /> : (
          <ul className="list">
            {pm.data?.methods.map((c: any) => (
              <li key={c.id} className="row">
                <span className="row__icon"><Icon name="card" size={20} /></span>
                <span className="row__main"><strong>{c.brand} ending {c.last4}</strong>{c.is_default && <span className="dg-muted">Default</span>}</span>
                <button className="dg-btn dg-btn--ghost dg-btn--sm" disabled={busy} onClick={() => act(() => del(`/payment-methods/${c.id}`), 'Card removed.')}>Remove</button>
              </li>
            ))}
            {!pm.data?.methods.length && <li className="dg-muted">No cards saved yet.</li>}
          </ul>
        )}
        <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 10 }} disabled={busy}
          onClick={() => act(async () => { await post('/payment-methods/setup'); await post('/payment-methods', { provider_ref: `pm_test_${Date.now()}`, brand: 'Visa', last4: '4242' }); }, 'Test card added.')}>
          Add a card
        </button>
        <p className="dg-muted" style={{ fontSize: 'var(--fs-xs)' }}>Test mode: adds a Visa 4242 test card. In the live app your card details go straight to Stripe and never touch DingoGo's servers.</p>
      </section>
      <section className="section">
        <h2 className="section__title">Top up credit</h2>
        <div className="tips__row">
          {[2000, 5000, 10000].map((c) => <button key={c} className="dg-btn dg-btn--ghost" disabled={busy} onClick={() => act(() => post('/wallet/topup', { cents: c }), `${money(c)} added.`)}>{money(c)}</button>)}
        </div>
      </section>
      <section className="section">
        <h2 className="section__title">Prepaid card or voucher</h2>
        <form onSubmit={(e) => { e.preventDefault(); void act(async () => { const r = await post('/wallet/voucher', { code }); setCode(''); return r; }, 'Voucher added to your credit.'); }}>
          <label className="dg-field"><span>Code on the card</span><input className="dg-input" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="e.g. DGDEMO5000" /></label>
          <button className="dg-btn dg-btn--dark" disabled={busy || code.length < 6}>Add to credit</button>
        </form>
      </section>
    </Page>
  );
}

function Inbox() {
  const { data, loading } = useLoad(() => get<{ notifications: any[] }>('/me/notifications'));
  useEffect(() => { void post('/me/notifications/read'); }, []);
  return (
    <Page title="Notifications" back="/account">
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
  ['parcel', 'A parcel problem'], ['accessibility', 'Accessibility'], ['app', 'The app isn’t working'], ['other', 'Something else'],
] as const;

function Help() {
  const [sp] = useSearchParams();
  const tripId = sp.get('trip') ?? undefined;
  const tickets = useLoad(() => get<{ tickets: any[] }>('/support'));
  const cfg = useLoad(() => get('/public/config'));
  const [f, setF] = useState({ category: 'lost_item', subject: '', message: '' });
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  async function send(e: React.FormEvent) {
    e.preventDefault(); setErr(null);
    try {
      await post('/support', { ...f, subject: f.subject || CATS.find((c) => c[0] === f.category)![1], trip_id: tripId });
      setSent(true); setF({ ...f, subject: '', message: '' }); await tickets.reload();
    } catch (e2) { setErr(e2 instanceof ApiError ? e2.message : 'Could not send'); }
  }
  const phone = cfg.data?.support?.phone;
  return (
    <Page title="Help" back="/account">
      <div className="callout callout--earth"><strong>In danger?</strong> Call <a href="tel:000">000</a>. During a trip, use the SOS button on the trip screen.</div>
      {phone && <p>Talk to a person: <a href={`tel:${phone.replace(/\s/g, '')}`}>{phone}</a>, {cfg.data?.support?.hours}.</p>}
      <form onSubmit={send} className="block">
        <h2 className="section__title">Send us a message{tripId ? ' about this trip' : ''}</h2>
        <label className="dg-field"><span>What's it about?</span>
          <select className="dg-select" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{CATS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <label className="dg-field"><span>Subject (optional)</span><input className="dg-input" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></label>
        <label className="dg-field"><span>Tell us what happened</span><textarea className="dg-textarea" required minLength={5} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></label>
        {err && <p className="dg-error" role="alert">{err}</p>}
        {sent && <p className="callout callout--green" role="status">Message sent. We'll reply in the app and by SMS.</p>}
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
