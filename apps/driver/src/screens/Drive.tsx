import { useState } from 'react';
import { ApiError, Icon, money, post } from '@dingogo/shared';
import { DgMap, type MapMarker } from '@dingogo/shared/map';
import { PLACES, rangeKm, useDriver } from '../state';
import { FuelChip, isEv } from '../vehicle';

export function Drive() {
  const { me, online, setOnline, battery, setBattery, pos, simulated, setSimulated, geoDenied, reloadMe } = useDriver();
  const [askBattery, setAskBattery] = useState(false);
  const [pickPlace, setPickPlace] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
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
        {online
          ? <button className="online-toggle stop" onClick={goOffline} disabled={busy}><Icon name="power" size={24} />Go offline</button>
          : <button className="online-toggle go" onClick={() => { setErrors(null); if (ev) setAskBattery(true); else void goOnline(); }} disabled={busy}><Icon name="power" size={24} />{busy ? 'Going online…' : 'Go online'}</button>}

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
        {(v || acc != null) && (
          <div className="vehicle-line">
            {v && <span><Icon name="car" size={18} />{v.colour} {v.make} {v.model}, <strong>{v.rego}</strong>{!ev && <FuelChip v={v} />}</span>}
            {acc != null && <span className="dg-muted">{acc}% accepted (30 days)</span>}
          </div>
        )}
      </section>

      {askBattery && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setAskBattery(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="bat-h">
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
          </div>
        </div>
      )}

      {pickPlace && (
        <div className="overlay" onClick={(e) => e.target === e.currentTarget && setPickPlace(false)}>
          <div className="sheet" role="dialog" aria-modal="true" aria-labelledby="loc-h">
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
          </div>
        </div>
      )}
    </div>
  );
}
