/**
 * Notification settings (rider Account › Notifications, driver Profile): push per category, texts for trip updates, and the
 * separate offers consent (Spam Act). Changes save straight away. "Turn on notifications" registers this phone for push.
 */
import { useEffect, useState } from 'react';
import { ApiError, get, put } from './api';
import { Icon } from './Icon';
import { enablePush, pushState, type PushState } from './push';

interface View {
  prefs: { push: Record<string, boolean>; sms: { trip: boolean } };
  marketing: { opted_in: boolean; wording: string; last_change: { granted: boolean; source: string; at: string } | null };
  sms_opted_out: boolean;
  categories: { key: string; label: string; help: string; locked?: boolean }[];
  channels: { push: { fcm: boolean; web: boolean }; web_push_key: string | null; sms: boolean };
}

export function NotifySettings({ app, showMarketing = true }: { app: 'rider' | 'driver'; showMarketing?: boolean }) {
  const [v, setV] = useState<View | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [push, setPush] = useState<PushState>('unsupported');
  useEffect(() => {
    get<View>('/me/notification-prefs').then((r) => { setV(r); void pushState(app, r.channels.web_push_key).then(setPush); })
      .catch((e) => setErr(e instanceof ApiError ? e.message : 'Could not load your settings'));
  }, [app]);

  async function save(body: { push?: Record<string, boolean>; sms?: { trip: boolean }; marketing?: boolean }, said: string) {
    setErr(null); setStatus(null);
    const before = v;
    // Show the change straight away; put it back if it doesn't save.
    setV((p) => p && ({ ...p, prefs: { push: { ...p.prefs.push, ...body.push }, sms: { ...p.prefs.sms, ...body.sms } },
      marketing: body.marketing === undefined ? p.marketing : { ...p.marketing, opted_in: body.marketing } }));
    try { setV(await put<View>('/me/notification-prefs', body)); setStatus(said); }
    catch (e) { setV(before); setErr(e instanceof ApiError ? e.message : 'Could not save'); }
  }
  async function turnOn() {
    setErr(null);
    try {
      const s = await enablePush(app, v?.channels.web_push_key);
      setPush(s);
      setStatus(s === 'on' ? 'Notifications are on for this phone.' : null);
      if (s === 'denied') setErr('Notifications are blocked for DingoGo. Allow them in your phone or browser settings, then try again.');
    } catch { setErr('Could not turn on notifications on this phone.'); }
  }

  if (!v) return err ? <p className="dg-error" role="alert">{err}</p> : <p className="dg-muted">Loading…</p>;
  const cats = v.categories.filter((c) => c.key !== 'promo');
  return (
    <div className="notify-settings">
      <section aria-labelledby="ns-phone">
        <h2 id="ns-phone" className="section__title">This phone</h2>
        {push === 'on' && <p className="callout callout--green"><Icon name="check" size={18} /> Notifications are on for this phone.</p>}
        {push === 'off' && <button type="button" className="dg-btn dg-btn--dark dg-btn--block" onClick={turnOn}><Icon name="bell" size={20} />Turn on notifications</button>}
        {push === 'denied' && <p className="dg-muted">Notifications are blocked for DingoGo on this phone. Allow them in your phone or browser settings.</p>}
        {push === 'unsupported' && <p className="dg-muted">Pop-up notifications aren't available on this phone yet. Updates still show in the app{v.channels.sms ? ', and you can get texts below' : ''}.</p>}
      </section>

      <section aria-labelledby="ns-push">
        <h2 id="ns-push" className="section__title">Notify me about</h2>
        {cats.map((c) => (
          <label key={c.key} className="dg-check">
            <input type="checkbox" checked={c.locked ? true : v.prefs.push[c.key] !== false} disabled={c.locked}
              onChange={(e) => save({ push: { [c.key]: e.target.checked } }, `${c.label} ${e.target.checked ? 'on' : 'off'}.`)} />
            <span>{c.label}<br /><small className="dg-muted">{c.help}</small></span>
          </label>
        ))}
        <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>Everything also stays in your inbox in the app.</p>
      </section>

      {app === 'rider' && v.channels.sms && (
        <section aria-labelledby="ns-sms">
          <h2 id="ns-sms" className="section__title">Texts</h2>
          <label className="dg-check">
            <input type="checkbox" checked={v.prefs.sms.trip} onChange={(e) => save({ sms: { trip: e.target.checked } }, `Trip texts ${e.target.checked ? 'on' : 'off'}.`)} />
            <span>Text me when my driver is on the way and has arrived<br /><small className="dg-muted">Handy when your data is patchy. Phone bookings always get these texts.</small></span>
          </label>
          {v.sms_opted_out && <p className="callout">You replied STOP, so we don't send you texts. Reply START to any DingoGo text to get them again. Sign-in codes still come.</p>}
        </section>
      )}

      {showMarketing && (
        <section aria-labelledby="ns-offers">
          <h2 id="ns-offers" className="section__title">Offers</h2>
          <label className="dg-check">
            <input type="checkbox" checked={v.marketing.opted_in}
              onChange={(e) => save({ marketing: e.target.checked }, e.target.checked ? 'You will get DingoGo offers.' : 'Offers are off.')} />
            <span>{v.marketing.wording}</span>
          </label>
          {v.marketing.last_change && (
            <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>
              {v.marketing.last_change.granted ? 'You said yes' : 'You said no'} on {new Date(v.marketing.last_change.at).toLocaleDateString('en-AU', { day: 'numeric', month: 'short', year: 'numeric' })}
              {v.marketing.last_change.source === 'sms_stop' ? ' (replied STOP)' : ''}.
            </p>
          )}
        </section>
      )}
      <p className="sr-only" role="status" aria-live="polite">{status}</p>
      {err && <p className="dg-error" role="alert">{err}</p>}
    </div>
  );
}
