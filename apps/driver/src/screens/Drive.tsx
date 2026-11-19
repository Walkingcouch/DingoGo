import { useEffect, useState } from 'react';
import { ApiError, Icon, del, get, money, post, time, uploadFile, useInterval } from '@dingogo/shared';
import { DgMap, type MapMarker } from '@dingogo/shared/map';
import { PLACES, rangeKm, useDriver } from '../state';
import { FuelChip, isEv } from '../vehicle';
import { Sheet } from '../Sheet';
import { ExpiryBanner } from './Expiry';

export function Drive() {
  const { me, online, setOnline, battery, setBattery, pos, simulated, setSimulated, geoDenied, reloadMe } = useDriver();
  const [askBattery, setAskBattery] = useState(false);
  const [pickPlace, setPickPlace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [leaveOpen, setLeaveOpen] = useState(false);
  // Round 14: fatigue limits and the photo check before going online.
  const [safety, setSafety] = useState<any>(null);
  const [photoOpen, setPhotoOpen] = useState<null | 'needed' | 'rejected'>(null);
  const loadSafety = () => { get('/driver/safety').then(setSafety).catch(() => { /* keep */ }); };
  useEffect(loadSafety, [online]);
  useInterval(loadSafety, 5 * 60_000);
  const fatigue = safety?.fatigue;
  const leave = me?.driver?.leave as { kind: string; until: string | null } | null | undefined;
  async function back() { setBusy(true); try { await del('/driver/leave'); await reloadMe(); } finally { setBusy(false); } }
  const v = me?.driver?.vehicle;
  const ev = isEv(v);
  const range = rangeKm(v?.range_km, battery);
  const acc = me?.acceptance?.offered ? Math.round((me.acceptance.accepted / me.acceptance.offered) * 100) : null;

  async function goOnline() {
    setBusy(true); setErrors(null);
    try {
      await post('/driver/online', { online: true, battery_pct: ev ? battery : undefined, lat: pos?.lat, lng: pos?.lng });
      setOnline(true); setAskBattery(false); void reloadMe();
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'identity_check_needed' || e.code === 'identity_check_rejected')) {
        setAskBattery(false); setPhotoOpen(e.code === 'identity_check_rejected' ? 'rejected' : 'needed'); return;
      }
      if (e instanceof ApiError && e.code === 'fatigue_rest') loadSafety();
      if (e instanceof ApiError) setErrors(Array.isArray(e.details) ? (e.details as string[]) : [e.message]);
      else setErrors(['Could not go online']);
      setAskBattery(true); // the sheet shows why
    } finally { setBusy(false); }
  }
  async function goOffline() {
    setBusy(true);
    try { await post('/driver/online', { online: false }); setOnline(false); } catch { /* keep state */ } finally { setBusy(false); }
  }

  const markers: MapMarker[] = pos ? [{ id: 'me', kind: online ? 'car' : 'car-off', lat: pos.lat, lng: pos.lng, heading: pos.heading }] : [];

  return (
    <div className="drive">
      <div className="drive-top">
        <span className="status-pill" role="status"><span className={'status-dot' + (online ? ' on' : '')} aria-hidden />{online ? 'Online, waiting for trips' : 'Offline'}</span>
        <span style={{ flex: 1 }} />
        <button className="round-btn" aria-label="Set my location" onClick={() => setPickPlace(true)}><Icon name="locate" size={22} /></button>
      </div>
      <div className="drive-map">
        <DgMap markers={markers} padding={80} zoom={14} />
      </div>
      <section className="drive-sheet" aria-label="Driving status">
        {!pos && (
          <div className="inline-notice">
            <Icon name="pin" size={20} />
            <span>Location is off</span>
            <button className="link-btn" onClick={() => setPickPlace(true)}>Set location</button>
          </div>
        )}
        {leave ? (
          <div className="inline-notice" role="status">
            <Icon name="heart" size={20} />
            <span>You're on leave ({LEAVE_LABEL[leave.kind] ?? 'leave'}){leave.until ? ` until ${new Date(leave.until).toLocaleDateString('en-AU', { day: 'numeric', month: 'short' })}` : ''}. No trips, no reminders, nothing counts against you.</span>
            <button className="link-btn" onClick={back} disabled={busy}>I'm back</button>
          </div>
        ) : <ExpiryBanner />}
        {online
          ? <button className="online-toggle stop" onClick={goOffline} disabled={busy}><Icon name="power" size={24} />Go offline</button>
          : <button className="online-toggle go" onClick={() => { setErrors(null); if (ev) setAskBattery(true); else void goOnline(); }} disabled={busy}><Icon name="power" size={24} />{busy ? 'Going online…' : 'Go online'}</button>}

        {fatigue?.enabled && (fatigue.rest_until
          ? <div className="inline-notice" role="status"><Icon name="moon" size={20} /><span>{fatigue.reason === 'break' ? 'Break time' : 'Rest time'}: you can go online again from {time(fatigue.rest_until)}.</span></div>
          : online && fatigue.minutes_left != null && (
            <p className="dg-muted" style={{ margin: '8px 0 0' }}>
              Online {hrs(fatigue.online_min_24h)} today. {fatigue.minutes_left <= 30 ? <strong>Break in {hrs(fatigue.minutes_left)}.</strong> : `Next break in ${hrs(fatigue.minutes_left)}.`}
            </p>))}

        {ev && (
          <div className="battery" aria-label={`Battery ${battery} percent, about ${range} kilometres`}>
            <Icon name="battery" size={26} style={{ color: battery < 20 ? 'var(--earth)' : 'var(--saltbush)' }} />
            <div className="battery-bar" aria-hidden><i className={battery < 20 ? 'low' : ''} style={{ width: `${battery}%` }} /></div>
            <strong className="dg-money">{battery}%</strong>
            <span className="dg-muted">{range} km</span>
          </div>
        )}

        <div className="stats">
          <div className="stat"><b>{me?.today?.trips ?? 0}</b><span>Trips today</span></div>
          <div className="stat"><b>{money(me?.today?.gross_cents ?? 0)}</b><span>Fares today</span></div>
          <div className="stat"><b>{me?.driver?.rating_avg ? Number(me.driver.rating_avg).toFixed(2) : 'New'}</b><span>Rating</span></div>
        </div>
        {!online && !leave && <button className="link-btn" style={{ marginTop: 8 }} onClick={() => setLeaveOpen(true)}>Take leave (Sorry Business, cultural business, family)</button>}
        {(v || acc != null) && (
          <div className="vehicle-line">
            {v && <span><Icon name="car" size={18} />{v.colour} {v.make} {v.model}, <strong>{v.rego}</strong>{!ev && <FuelChip v={v} />}</span>}
            {acc != null && <span className="dg-muted">{acc}% accepted (30 days){me?.acceptance?.cancelled_7d ? `, ${me.acceptance.cancelled_7d} cancelled after accepting this week` : ''}</span>}
          </div>
        )}
      </section>

      {askBattery && (
        <Sheet onClose={() => setAskBattery(false)} labelledBy="bat-h">
            {ev ? (<>
              <h2 id="bat-h">How much charge?</h2>
              <p className="dg-muted" style={{ marginTop: 0 }}>Check the dash. We use it so you're never sent on a trip you can't finish.</p>
              <div className="dial-num">{battery}%</div>
              <input type="range" min={0} max={100} step={1} value={battery} onChange={(e) => setBattery(Number(e.target.value))}
                aria-label="Battery percent" className="range-input" />
              <p className="dg-muted" style={{ textAlign: 'center' }}>About {range} km of range in this heat</p>
              {battery < 15 && <p className="dg-error">Charge above 15% before going online.</p>}
            </>) : <h2 id="bat-h">Not online yet</h2>}
            {errors && (
              <div className="dg-error" role="alert">
                <p style={{ margin: '0 0 6px' }}>You can't go online yet:</p>
                <ul style={{ margin: 0, paddingLeft: 18, fontWeight: 400 }}>{errors.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            )}
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button className="dg-btn dg-btn--ghost btn-xl" onClick={() => setAskBattery(false)}>Not now</button>
              <button className="dg-btn btn-xl" onClick={goOnline} disabled={busy || (ev && battery < 15)}>{busy ? 'Going online…' : errors && !ev ? 'Try again' : 'Go online'}</button>
            </div>
        </Sheet>
      )}

      {photoOpen && <PhotoCheckSheet rejected={photoOpen === 'rejected'} onClose={() => setPhotoOpen(null)}
        onDone={async () => { setPhotoOpen(null); loadSafety(); if (ev) setAskBattery(true); else await goOnline(); }} />}

      {leaveOpen && <LeaveSheet onClose={() => setLeaveOpen(false)} onDone={async () => { setLeaveOpen(false); setOnline(false); await reloadMe(); }} />}

      {pickPlace && (
        <Sheet onClose={() => setPickPlace(false)} labelledBy="loc-h">
            <h2 id="loc-h">Where are you?</h2>
            <p className="dg-muted" style={{ marginTop: 0 }}>{geoDenied ? 'GPS is unavailable, so pick the nearest place.' : 'Using GPS. You can override it for testing.'}</p>
            <ul className="place-list">
              {simulated && <li><button className="dg-btn dg-btn--ghost dg-btn--block place-btn" onClick={() => { setSimulated(null); setPickPlace(false); }}><Icon name="locate" size={18} />Use my GPS</button></li>}
              {PLACES.map((p) => (
                <li key={p.name}>
                  <button className="dg-btn dg-btn--ghost dg-btn--block place-btn"
                    onClick={() => { setSimulated({ lat: p.lat, lng: p.lng, heading: null }); setPickPlace(false); }}><Icon name="pin" size={18} />{p.name}</button>
                </li>
              ))}
            </ul>
        </Sheet>
      )}
    </div>
  );
}

const hrs = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

/** Daily photo check (when DingoGo has switched it on): a selfie taken now, matched or looked at by DingoGo. */
function PhotoCheckSheet({ rejected, onClose, onDone }: { rejected: boolean; onClose: () => void; onDone: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function take(f: File | undefined) {
    if (!f) return;
    setBusy(true); setErr(null);
    try { const u = await uploadFile(f, 'selfie'); await post('/driver/identity-check', { photo_url: u.url }); await onDone(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not send the photo. Try again.'); } finally { setBusy(false); }
  }
  return (
    <Sheet onClose={onClose} labelledBy="photo-h">
      <h2 id="photo-h">Quick photo check</h2>
      <p className="dg-muted" style={{ marginTop: 0 }}>
        {rejected ? 'Your last photo wasn\'t accepted. ' : ''}Take a photo of your face so riders know it's you driving today. Good light, no hat or sunglasses.
      </p>
      <label className="dg-btn btn-xl dg-btn--block" style={{ cursor: 'pointer' }} aria-disabled={busy}>
        <Icon name="camera" size={22} />{busy ? 'Sending…' : 'Take photo'}
        <input type="file" accept="image/*" capture="user" style={{ position: 'absolute', width: 1, height: 1, opacity: 0 }} disabled={busy}
          onChange={(e) => { void take(e.target.files?.[0]); e.target.value = ''; }} />
      </label>
      {err && <p className="dg-error" role="alert">{err}</p>}
      <button className="dg-btn dg-btn--ghost btn-xl dg-btn--block" style={{ marginTop: 10 }} onClick={onClose}>Not now</button>
    </Sheet>
  );
}

const LEAVE_LABEL: Record<string, string> = { sorry_business: 'Sorry Business', cultural: 'cultural business', family: 'family' };

/** Leave without penalty: offline, no offers, paper reminders paused. Nothing more is asked. */
function LeaveSheet({ onClose, onDone }: { onClose: () => void; onDone: () => Promise<void> }) {
  const [kind, setKind] = useState('sorry_business');
  const [until, setUntil] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setErr(null);
    try { await post('/driver/leave', { kind, until: until || null }); await onDone(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not save. Go offline for now.'); } finally { setBusy(false); }
  }
  return (
    <Sheet onClose={onClose} labelledBy="leave-h">
      <h2 id="leave-h">Take leave</h2>
      <p className="dg-muted" style={{ marginTop: 0 }}>Take the time you need. You won't get trips or reminders, and nothing counts against you. Come back any time.</p>
      <div role="radiogroup" aria-label="Kind of leave" style={{ display: 'grid', gap: 8 }}>
        {Object.entries({ sorry_business: 'Sorry Business', cultural: 'Cultural business', family: 'Family' }).map(([k, l]) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className="dg-btn dg-btn--ghost dg-btn--block"
            style={{ justifyContent: 'flex-start', minHeight: 52, ...(kind === k ? { outline: '3px solid var(--ochre)' } : {}) }} onClick={() => setKind(k)}>{l}</button>
        ))}
      </div>
      <label className="dg-field" style={{ marginTop: 12 }}><span>Back on (optional)</span><input className="dg-input" type="date" value={until} onChange={(e) => setUntil(e.target.value)} /></label>
      {err && <p className="dg-error" role="alert">{err}</p>}
      <div className="btn-row" style={{ marginTop: 14 }}>
        <button className="dg-btn dg-btn--ghost btn-xl" onClick={onClose}>Not now</button>
        <button className="dg-btn btn-xl" onClick={go} disabled={busy}>{busy ? 'Saving…' : 'Start leave'}</button>
      </div>
    </Sheet>
  );
}
