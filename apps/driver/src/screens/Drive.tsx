import { useState } from 'react';
import { ApiError, money, post } from '@dingogo/shared';
import { DgMap, type MapMarker } from '@dingogo/shared/map';
import { PLACES, rangeKm, useDriver } from '../state';

export function Drive() {
  const { me, online, setOnline, battery, setBattery, pos, simulated, setSimulated, geoDenied, reloadMe } = useDriver();
  const [askBattery, setAskBattery] = useState(false);
  const [pickPlace, setPickPlace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const v = me?.driver?.vehicle;
  const range = rangeKm(v?.range_km, battery);
  const acc = me?.acceptance?.offered ? Math.round((me.acceptance.accepted / me.acceptance.offered) * 100) : null;

  async function goOnline() {
    setBusy(true); setErrors(null);
    try {
      await post('/driver/online', { online: true, battery_pct: battery, lat: pos?.lat, lng: pos?.lng });
      setOnline(true); setAskBattery(false); void reloadMe();
    } catch (e) {
      if (e instanceof ApiError) setErrors(Array.isArray(e.details) ? (e.details as string[]) : [e.message]);
      else setErrors(['Could not go online']);
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
        <span className="status-pill"><span className={'status-dot' + (online ? ' on' : '')} />{online ? 'Online — waiting for trips' : 'Offline'}</span>
        <span style={{ flex: 1 }} />
        <button className="round-btn" aria-label="Set my location" onClick={() => setPickPlace(true)}>📍</button>
      </div>
      <div className="drive-map">
        <DgMap markers={markers} padding={80} zoom={14} />
      </div>
      <section className="drive-sheet" aria-label="Driving status">
        {!pos && (
          <p className="dg-note" style={{ marginTop: 0 }}>
            Location is off. <button className="dg-btn dg-btn--sm dg-btn--dark" onClick={() => setPickPlace(true)}>Set location</button>
          </p>
        )}
        {online
          ? <button className="online-toggle stop" onClick={goOffline} disabled={busy}>Go offline</button>
          : <button className="online-toggle go" onClick={() => { setErrors(null); setAskBattery(true); }} disabled={busy}>Go online</button>}

        <div className="battery" style={{ marginTop: 14 }} aria-label={`Battery ${battery} percent, about ${range} kilometres`}>
          <span aria-hidden style={{ fontSize: 20 }}>🔋</span>
          <div className="battery-bar"><i className={battery < 20 ? 'low' : ''} style={{ width: `${battery}%` }} /></div>
          <strong className="dg-money">{battery}%</strong>
          <span className="dg-muted">≈{range} km</span>
        </div>

        <div className="stats" style={{ marginTop: 14 }}>
          <div className="stat"><b>{me?.today?.trips ?? 0}</b><span>Trips today</span></div>
          <div className="stat"><b>{money(me?.today?.gross_cents ?? 0)}</b><span>Fares today</span></div>
          <div className="stat"><b>{me?.driver?.rating_avg ? Number(me.driver.rating_avg).toFixed(2) : '—'}</b><span>Rating</span></div>
        </div>
        <p className="dg-muted" style={{ margin: '12px 0 0', fontSize: 'var(--fs-sm)' }}>
          {v ? `${v.colour} ${v.make} ${v.model}, ${v.rego}.` : ''}{acc != null ? ` You accepted ${acc}% of requests in the last 30 days.` : ''}
        </p>
      </section>

      {askBattery && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setAskBattery(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="bat-h">
            <h2 id="bat-h">How much charge?</h2>
            <p className="dg-muted" style={{ marginTop: 0 }}>Check the dash. We use it so you're never sent on a trip you can't finish.</p>
            <div style={{ textAlign: 'center', fontFamily: 'var(--font-display)', fontSize: 'var(--fs-4xl)', fontWeight: 800 }}>{battery}%</div>
            <input type="range" min={0} max={100} step={1} value={battery} onChange={(e) => setBattery(Number(e.target.value))}
              aria-label="Battery percent" style={{ width: '100%', height: 40, accentColor: 'var(--ochre)' }} />
            <p className="dg-muted" style={{ textAlign: 'center' }}>About {range} km of range in this heat</p>
            {battery < 15 && <p className="dg-error">Charge above 15% before going online.</p>}
            {errors && (
              <div className="dg-error" role="alert">
                <p style={{ margin: '0 0 6px' }}>You can't go online yet:</p>
                <ul style={{ margin: 0, paddingLeft: 18, fontWeight: 400 }}>{errors.map((x) => <li key={x}>{x}</li>)}</ul>
              </div>
            )}
            <div className="btn-row" style={{ marginTop: 14 }}>
              <button className="dg-btn dg-btn--ghost btn-xl" onClick={() => setAskBattery(false)}>Not now</button>
              <button className="dg-btn btn-xl" onClick={goOnline} disabled={busy || battery < 15}>{busy ? 'Going online…' : 'Go online'}</button>
            </div>
          </div>
        </div>
      )}

      {pickPlace && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setPickPlace(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="loc-h">
            <h2 id="loc-h">Where are you?</h2>
            <p className="dg-muted" style={{ marginTop: 0 }}>{geoDenied ? 'GPS is unavailable, so pick the nearest place.' : 'Using GPS. You can override it for testing.'}</p>
            <ul className="list">
              {simulated && <li><button className="dg-btn dg-btn--ghost dg-btn--block" onClick={() => { setSimulated(null); setPickPlace(false); }}>Use my GPS</button></li>}
              {PLACES.map((p) => (
                <li key={p.name}>
                  <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ justifyContent: 'flex-start' }}
                    onClick={() => { setSimulated({ lat: p.lat, lng: p.lng, heading: null }); setPickPlace(false); }}>{p.name}</button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
