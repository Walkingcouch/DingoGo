import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ApiError, date, get, post } from '@dingogo/shared';
import { ANDROID_DRIVER_APK } from '../Estimator';
import { PageHead } from '../Layout';
import { contact, useConfig } from '../config';
import { useMeta } from '../meta';

type App = { ref: string; first_name: string; stage: string; stage_label: string; stage_detail: string; note: string | null;
  steps: { key: string; label: string; done: boolean; current: boolean }[]; received_at: string; updated_at: string; can_withdraw: boolean };
export const STATUS_KEY = 'dg_application';

/** /drive/status/<token> — the private link a driver applicant gets: where their application is up to, and a way to withdraw. */
export default function DriveStatus() {
  const { token = '' } = useParams();
  useMeta('Your driver application', 'Where your DingoGo driver application is up to.', { noindex: true });
  const c = contact(useConfig());
  const [a, setA] = useState<App | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get<{ application: App }>(`/public/driver-applications/status/${encodeURIComponent(token)}`)
      .then((r) => { setA(r.application); try { localStorage.setItem(STATUS_KEY, token); } catch { /* ignore */ } })
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? "We couldn't find that application. Check the link in your text message, or call us." : e instanceof ApiError ? e.message : 'Could not load your application. Check your connection and try again.'));
  }, [token]);
  async function withdraw() {
    setBusy(true);
    try { setA((await post<{ application: App }>(`/public/driver-applications/status/${encodeURIComponent(token)}/withdraw`, {})).application); setConfirm(false); }
    catch (e) { setError(e instanceof ApiError ? e.message : 'Could not withdraw. Try again or call us.'); }
    finally { setBusy(false); }
  }
  return (
    <>
      <PageHead title={a ? `Hi ${a.first_name}, here's your application` : 'Your driver application'}>{a ? `Reference ${a.ref}, received ${date(a.received_at)}.` : undefined}</PageHead>
      <section className="section">
        <div className="wrap prose" style={{ maxWidth: 720 }}>
          {error && <p className="dg-error" role="alert">{error}</p>}
          {!a && !error && <p className="dg-muted">Loading…</p>}
          {a && (
            <>
              <h2 style={{ marginTop: 0 }}>{a.stage_label}</h2>
              <p>{a.stage_detail}</p>
              <ol className="status-steps" aria-label="Application steps">
                {a.steps.map((s) => <li key={s.key} className={s.done ? 'done' : s.current ? 'current' : ''} aria-current={s.current ? 'step' : undefined}>{s.label}{s.done ? <span className="sr-only"> (done)</span> : null}</li>)}
              </ol>
              {a.note && <div className="dg-note"><b>From the DingoGo team:</b> {a.note}</div>}
              <p className="dg-muted">Last updated {date(a.updated_at)}. Questions? Call <a href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a>.</p>
              {a.stage === 'approved' && <p><a className="dg-btn" href={ANDROID_DRIVER_APK}>Get the driver app for Android</a></p>}
              {a.stage === 'onboarding' && <p><Link to="/drive">What the NT requires of you and your car</Link></p>}
              {a.can_withdraw && (confirm ? (
                <div className="dg-note" role="group" aria-label="Withdraw application">
                  <p style={{ marginTop: 0 }}>Withdraw your application? You can apply again any time.</p>
                  <button className="dg-btn dg-btn--dark" disabled={busy} onClick={withdraw}>{busy ? 'Withdrawing…' : 'Yes, withdraw'}</button>{' '}
                  <button className="dg-btn dg-btn--ghost" onClick={() => setConfirm(false)}>Keep it</button>
                </div>
              ) : <button className="dg-btn dg-btn--ghost dg-btn--sm" onClick={() => setConfirm(true)}>Withdraw my application</button>)}
              {(a.stage === 'withdrawn' || a.stage === 'declined') && <p><Link className="dg-btn" to="/drive#apply">Apply again</Link></p>}
            </>
          )}
        </div>
      </section>
    </>
  );
}
