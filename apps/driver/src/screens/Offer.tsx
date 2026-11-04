import { useEffect, useState } from 'react';
import { ApiError, Icon, SERVICE_ICON_NAME, km, mins, money, post } from '@dingogo/shared';
import { estimateEarnings, useDriver } from '../state';

const LABEL: Record<string, string> = { ride: 'Ride', pet: 'Pet-friendly ride', courier_s: 'Small parcel', courier_m: 'Medium parcel', courier_l: 'Large parcel', tour: 'Private tour', hourly: 'Hourly hire' };

export function Offer() {
  const { offer, clearOffer, setTrip, reloadTrip, me, showToast } = useDriver();
  const total = offer.expires_in_s ?? 20;
  const [deadline] = useState(() => (offer.expires_at ? new Date(offer.expires_at).getTime() : Date.now() + total * 1000));
  const [left, setLeft] = useState(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const t = setInterval(() => {
      const l = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setLeft(l);
      if (l <= 0) { clearOffer(); showToast('Request timed out'); }
    }, 250);
    return () => clearInterval(t);
  }, [offer.trip_id]); // eslint-disable-line

  useEffect(() => { try { navigator.vibrate?.([300, 150, 300]); } catch { /* not supported */ } }, [offer.trip_id]);

  async function accept() {
    setBusy(true); setError(null);
    try { const r = await post(`/driver/offers/${offer.trip_id}/accept`); setTrip(r.trip); clearOffer(); }
    catch (e) {
      const msg = e instanceof ApiError ? e.message : 'Could not accept';
      clearOffer(); showToast(msg); void reloadTrip();
    } finally { setBusy(false); }
  }
  async function decline() {
    setBusy(true);
    try { await post(`/driver/offers/${offer.trip_id}/decline`); } catch { /* already expired */ }
    clearOffer(); setBusy(false);
  }

  const earn = estimateEarnings(offer, Number(me?.driver?.commission_pct ?? 25));
  const frac = Math.min(1, left / total);
  const C = 2 * Math.PI * 30;
  const isCourier = offer.kind === 'courier';

  return (
    <div className="offer" role="alertdialog" aria-modal="true" aria-labelledby="offer-h">
      <div className="offer-head">
        <svg width="72" height="72" viewBox="0 0 72 72" aria-label={`${left} seconds left`}>
          <circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="7" />
          <circle cx="36" cy="36" r="30" fill="none" stroke="var(--ochre)" strokeWidth="7" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(-90 36 36)" style={{ transition: 'stroke-dashoffset .25s linear' }} />
          <text x="36" y="44" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="800" fontFamily="var(--font-display)">{left}</text>
        </svg>
        <div>
          <h1 id="offer-h"><Icon name={SERVICE_ICON_NAME[offer.service] ?? 'car'} size={26} />{LABEL[offer.service] ?? 'New request'}</h1>
          <span className="offer-sub">Pickup in {mins(offer.pickup_eta_s)}</span>
        </div>
      </div>

      <div className="offer-body">
        <div className="offer-earn">{money(earn)}</div>
        <div className="offer-sub">Your estimated earnings for {km(offer.est_distance_m)}, about {mins(offer.est_duration_s)}</div>

        <div className="leg">
          <span className="dot" style={{ background: 'var(--saltbush)' }} />
          <p>{offer.pickup?.address}<small>{isCourier ? 'Collect parcel' : 'Pick up'}</small></p>
          <span className="line" />
          <span />
          <span className="dot" style={{ background: 'var(--ochre)' }} />
          <p>{offer.dropoff?.address}<small>{isCourier ? 'Deliver' : 'Drop off'}</small></p>
        </div>

        <div className="flags">
          {offer.payment_method === 'cash' && <span className="flag"><Icon name="cash" size={18} />Cash fare, collect {money(offer.quote_cents)}</span>}
          {!isCourier && offer.passengers > 1 && <span className="flag"><Icon name="users" size={18} />{offer.passengers} passengers</span>}
          {offer.has_pet && <span className="flag"><Icon name="paw" size={18} />Pet on board</span>}
          {offer.needs_wheelchair && <span className="flag"><Icon name="access" size={18} />Wheelchair</span>}
          {offer.assistance_animal && <span className="flag legal"><Icon name="shield" size={18} /><span><strong>Assistance animal.</strong> By law (Disability Discrimination Act) you must accept assistance animals. Refusals are reviewed.</span></span>}
          {offer.notes && <span className="flag flag-note"><Icon name="chat" size={18} />“{offer.notes}”</span>}
        </div>
        {error && <p className="dg-error">{error}</p>}
      </div>

      <div className="offer-actions">
        <button className="dg-btn dg-btn--ghost btn-xl" onClick={decline} disabled={busy}>Decline</button>
        <button className="dg-btn btn-xl" onClick={accept} disabled={busy} autoFocus>{busy ? 'Accepting…' : 'Accept'}</button>
      </div>
    </div>
  );
}
