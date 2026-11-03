import { useState } from 'react';
import { ApiError, requestOtp, verifyOtp } from './api';
import { Ranges } from './Ranges';
import mascot from '../assets/mascot.png';

/** Phone + SMS code sign-in, shared by every app. */
export function Login({ title, subtitle, onDone, askName = false, askReferral = false }: {
  title: string; subtitle?: string; onDone: (r: { token: string; user: any; is_new: boolean }) => void; askName?: boolean; askReferral?: boolean;
}) {
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [referral, setReferral] = useState('');
  const [devCode, setDevCode] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { const r: any = await requestOtp(phone); setDevCode(r.dev_code ?? (r.demo ? '000000' : undefined)); setStep('code'); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not send code'); }
    finally { setBusy(false); }
  }
  async function verify(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { onDone(await verifyOtp(phone, code, { name: name || undefined, referral_code: referral || undefined })); }
    catch (err) { setError(err instanceof ApiError ? err.message : 'Could not sign in'); }
    finally { setBusy(false); }
  }

  return (
    <div style={{ minHeight: '100dvh', display: 'grid', gridTemplateRows: '1fr auto', background: 'var(--bg)' }}>
      <main style={{ width: '100%', maxWidth: 420, margin: '0 auto', padding: '40px 20px 24px', alignSelf: 'center' }}>
        <img src={mascot} alt="" width={96} height={140} style={{ objectFit: 'contain', display: 'block', marginBottom: 12 }} />
        <h1 style={{ fontSize: 'var(--fs-3xl)' }}>{title}</h1>
        {subtitle && <p className="dg-muted" style={{ marginTop: 0 }}>{subtitle}</p>}
        {step === 'phone' ? (
          <form onSubmit={send} style={{ marginTop: 24 }}>
            <label className="dg-field"><span>Mobile number</span>
              <input className="dg-input" type="tel" inputMode="tel" autoComplete="tel" placeholder="04xx xxx xxx" value={phone} onChange={(e) => setPhone(e.target.value)} required />
            </label>
            {error && <p className="dg-error" role="alert">{error}</p>}
            <button className="dg-btn dg-btn--block" disabled={busy || phone.replace(/\D/g, '').length < 8}>{busy ? 'Sending…' : 'Text me a code'}</button>
            <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>We'll send a 6-digit code by SMS. Standard message rates may apply.</p>
          </form>
        ) : (
          <form onSubmit={verify} style={{ marginTop: 24 }}>
            <label className="dg-field"><span>Code sent to {phone}</span>
              <input className="dg-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))} required autoFocus
                style={{ fontSize: 'var(--fs-xl)', letterSpacing: '.3em' }} />
            </label>
            {devCode && <p className="dg-note" style={{ fontSize: 'var(--fs-sm)' }}>Demo account: your code is <strong>{devCode}</strong></p>}
            {askName && <label className="dg-field"><span>Your name (if you're new)</span><input className="dg-input" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} /></label>}
            {askReferral && <label className="dg-field"><span>Friend's referral code (optional)</span><input className="dg-input" value={referral} onChange={(e) => setReferral(e.target.value.toUpperCase())} /></label>}
            {error && <p className="dg-error" role="alert">{error}</p>}
            <button className="dg-btn dg-btn--block" disabled={busy || code.length !== 6}>{busy ? 'Checking…' : 'Sign in'}</button>
            <button type="button" className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 8 }} onClick={() => { setStep('phone'); setCode(''); }}>Use a different number</button>
          </form>
        )}
      </main>
      <Ranges height={56} fill="var(--ochre)" />
    </div>
  );
}
