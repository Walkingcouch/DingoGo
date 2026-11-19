import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ApiError, api, post } from '@dingogo/shared';
import { PageHead } from '../Layout';
import { contact, useConfig } from '../config';
import { useMeta } from '../meta';
import { Area, Field, formData, useSubmit } from '../forms';

/**
 * Round 21: /delete-account — delete a DingoGo account without the app (Google Play asks for this link). Sign in with the
 * mobile number and a text code (existing accounts only), then delete with the same rules as the app. Lost the number? The form
 * goes to DingoGo's privacy request register and is answered within 30 days. The sign-in is kept in this page only (memory).
 */
export default function DeleteAccount() {
  useMeta();
  const c = contact(useConfig());
  return (
    <>
      <PageHead title="Delete your DingoGo account">You can delete your account in the app (Account, Privacy), or here.</PageHead>
      <section className="section">
        <div className="wrap prose" style={{ maxWidth: 760 }}>
          <h2>What happens</h2>
          <ul>
            <li>Your name, mobile number, email, emergency and trusted contacts, accessibility needs and saved settings are removed straight away.</li>
            <li>Your points and DingoGo credit are lost. Notifications to your phone stop.</li>
            <li>Trip records stay without your name, because the tax office requires them for 5 years. Records about a safety report are kept for longer.</li>
            <li>Drivers: what we paid you, with your ABN, is kept for the 5 years the tax office requires, then removed.</li>
          </ul>
          <p>Finish or cancel any trip in progress first. See the <Link to="/legal/privacy">privacy policy</Link> for more.</p>
          <SignInAndDelete />
          <h2 id="cant-sign-in">Can't sign in?</h2>
          <p>If you no longer have the mobile number on your account, ask us here and we'll check it's you and delete it within 30 days. You can also call {c.phone} or email <a href={`mailto:${c.email}`}>{c.email}</a>.</p>
          <RequestForm />
        </div>
      </section>
    </>
  );
}

function SignInAndDelete() {
  const [step, setStep] = useState<'phone' | 'code' | 'confirm' | 'done'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [who, setWho] = useState<{ token: string; name: string; phone: string } | null>(null);
  const [sure, setSure] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const errRef = useRef<HTMLParagraphElement>(null);
  const fail = (e: unknown, fallback: string) => {
    setErr(e instanceof ApiError && e.status !== 0 ? e.message : e instanceof ApiError ? e.message : fallback);
    setTimeout(() => errRef.current?.focus(), 0);
  };

  async function sendCode(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await post('/auth/otp/request', { phone }); setStep('code'); }
    catch (x) { fail(x, 'Could not send a code. Try again.'); } finally { setBusy(false); }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const r = await post<{ token: string; user: { name: string; phone: string } }>('/auth/otp/verify', { phone, code, app: 'account' });
      setWho({ token: r.token, name: r.user.name, phone: r.user.phone }); setStep('confirm');
    } catch (x) { fail(x, 'Could not check the code. Try again.'); } finally { setBusy(false); }
  }
  async function remove() {
    if (!who) return;
    setBusy(true); setErr(null);
    try { await api('DELETE', '/me', undefined, { headers: { Authorization: `Bearer ${who.token}` } }); setWho(null); setStep('done'); }
    catch (x) { fail(x, 'Could not delete the account. Try again.'); } finally { setBusy(false); }
  }

  return (
    <div className="panel" style={{ margin: '20px 0 8px' }} role="region" aria-labelledby="del-h">
      <h2 id="del-h" style={{ marginTop: 0 }}>Delete it now</h2>
      {err && <p className="dg-error" role="alert" tabIndex={-1} ref={errRef}>{err}</p>}
      {step === 'phone' && (
        <form onSubmit={sendCode}>
          <label className="dg-field"><span>Mobile number on your account</span>
            <input className="dg-input" type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="04xx xxx xxx" /></label>
          <button className="dg-btn" disabled={busy}>{busy ? 'Sending…' : 'Text me a code'}</button>
        </form>
      )}
      {step === 'code' && (
        <form onSubmit={verify}>
          <p>We texted a 6-digit code to {phone}.</p>
          <label className="dg-field"><span>Code</span>
            <input className="dg-input" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} /></label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="dg-btn" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Continue'}</button>
            <button type="button" className="dg-btn dg-btn--ghost" onClick={() => { setStep('phone'); setCode(''); }}>Use another number</button>
          </div>
        </form>
      )}
      {step === 'confirm' && who && (
        <div>
          <p>Signed in as <b>{who.name || 'DingoGo user'}</b> ({who.phone}).</p>
          <label style={{ display: 'flex', gap: 10, alignItems: 'flex-start', margin: '10px 0 14px' }}>
            <input type="checkbox" checked={sure} onChange={(e) => setSure(e.target.checked)} style={{ marginTop: 5 }} />
            <span>I understand my account, points and credit are gone for good. This can't be undone.</span>
          </label>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button className="dg-btn dg-btn--danger" onClick={remove} disabled={busy || !sure}>{busy ? 'Deleting…' : 'Delete my account'}</button>
            <button className="dg-btn dg-btn--ghost" onClick={() => { setWho(null); setStep('phone'); setCode(''); setSure(false); }} disabled={busy}>Keep my account</button>
          </div>
        </div>
      )}
      {step === 'done' && <p role="status"><b>Your account has been deleted.</b> You can uninstall the DingoGo app. Thank you for riding with us.</p>}
    </div>
  );
}

function RequestForm() {
  const s = useSubmit('/public/deletion-requests');
  if (s.done) return <p role="status" className="panel">Thanks. We've got your request and will contact you within 30 days to check it's you before deleting the account.</p>;
  return (
    <form className="form-grid" onSubmit={(e) => void s.submit(formData(e))} aria-label="Ask DingoGo to delete my account">
      <Field label="Your name" name="name" required autoComplete="name" />
      <Field label="Mobile number on the account" name="phone" type="tel" required autoComplete="tel" />
      <Field label="Email to reach you" name="email" type="email" autoComplete="email" />
      <label className="dg-field"><span>Account type</span>
        <select className="dg-input" name="role" defaultValue="rider"><option value="rider">Rider</option><option value="driver">Driver</option><option value="both">Both</option></select></label>
      <Area label="Anything that helps us find the account" name="details" rows={3} />
      {s.error && <p className="dg-error full" role="alert">{s.error}</p>}
      <button className="dg-btn full" disabled={s.busy}>{s.busy ? 'Sending…' : 'Ask DingoGo to delete my account'}</button>
    </form>
  );
}
