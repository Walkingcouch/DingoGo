import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, Icon, SERVICE_ICON_NAME, km, mins, money, post, useModal } from '@dingogo/shared';
import { FEE_BASIS, estimateEarnings, needFlags, useDriver } from '../state';
import { usePrefs } from '../lib/prefs';

/** The suburb or first part of an address, for a glance ("Braitling", "Todd Mall"). */
const shortPlace = (a?: string | null) => (a ?? '').split(',').map((x) => x.trim()).filter(Boolean)[0] ?? '';
const spokenKm = (m: number) => (m < 1000 ? `${Math.round(m / 100) * 100} metres` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} kilometres`);

const LABEL: Record<string, string> = { ride: 'Ride', pet: 'Pet-friendly ride', courier_s: 'Small parcel', courier_m: 'Medium parcel', courier_l: 'Large parcel', tour: 'Private tour', hourly: 'Hourly hire' };

export function Offer() {
  const { offer, clearOffer, setTrip, reloadTrip, me, showToast } = useDriver();
  const total = offer.expires_in_s ?? 20;
  const [deadline] = useState(() => (offer.expires_at ? new Date(offer.expires_at).getTime() : Date.now() + total * 1000));
  const [left, setLeft] = useState(Math.max(0, Math.round((deadline - Date.now()) / 1000)));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [prefs] = usePrefs();
  // A multi-drop run is one job: the big number is the pay for every drop.
  const run = offer.run as { stops: number; trip_m: number; pay_cents: number; last_drop: string } | null | undefined;
  const earn = run ? run.pay_cents : estimateEarnings(offer, Number(me?.driver?.commission_pct ?? 25));
  const box = useRef<HTMLDivElement>(null);
  useModal(box); // no Escape: a stray key must not decline a trip

  useEffect(() => {
    const t = setInterval(() => {
      const l = Math.max(0, Math.round((deadline - Date.now()) / 1000));
      setLeft(l);
      if (l <= 0) { clearOffer(); showToast('Request timed out'); }
    }, 250);
    return () => clearInterval(t);
  }, [offer.trip_id]); // eslint-disable-line

  useEffect(() => { try { navigator.vibrate?.([300, 150, 300]); } catch { /* not supported */ } }, [offer.trip_id]);
  // Eyes on the road: read the request out if the driver asked for it (Profile → In the car).
  useEffect(() => {
    if (!prefs.speak || typeof speechSynthesis === 'undefined') return;
    const u = new SpeechSynthesisUtterance(
      `New ${LABEL[offer.service] ?? 'request'}. ${money(earn).replace('$', '')} dollars. Pickup in ${mins(offer.pickup_eta_s)}`
      + `${offer.pickup_m != null ? `, ${spokenKm(offer.pickup_m)} away` : ''}. Trip ${spokenKm(offer.est_distance_m)}.`
      + `${offer.payment_method === 'cash' ? ' Cash fare.' : ''}${offer.assistance_animal ? ' Assistance animal.' : ''}`);
    u.lang = 'en-AU';
    try { speechSynthesis.cancel(); speechSynthesis.speak(u); } catch { /* no voice */ }
    return () => { try { speechSynthesis.cancel(); } catch { /* ignore */ } };
  }, [offer.trip_id]); // eslint-disable-line
  // Screen readers: one warning when time is nearly up (the ring itself isn't read every second).
  useEffect(() => {
    if (left !== 5) return;
    const el = document.getElementById('alert');
    if (el) el.textContent = '5 seconds left to accept';
    return () => { if (el) el.textContent = ''; };
  }, [left === 5]); // eslint-disable-line

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

  const pay = offer.driver_pay;
  const frac = Math.min(1, left / total);
  const C = 2 * Math.PI * 30;
  const isCourier = offer.kind === 'courier';

  const pickupBits = [mins(offer.pickup_eta_s), offer.pickup_m != null && offer.pickup_m >= 100 ? km(offer.pickup_m) : null].filter(Boolean).join(', ');
  return createPortal(
    <div className={`offer${prefs.hand === 'left' ? ' offer--left' : ''}`} role="alertdialog" aria-modal="true" aria-labelledby="offer-h" aria-describedby="offer-glance" ref={box} tabIndex={-1} data-modal-open>
      <div className="offer-head">
        <svg width="72" height="72" viewBox="0 0 72 72" role="img" aria-label={`${left} seconds left`}>
          <circle cx="36" cy="36" r="30" fill="none" stroke="rgba(255,255,255,.15)" strokeWidth="7" />
          <circle cx="36" cy="36" r="30" fill="none" stroke={left <= 5 ? '#F09A88' : 'var(--ochre)'} strokeWidth="7" strokeLinecap="round"
            strokeDasharray={C} strokeDashoffset={C * (1 - frac)} transform="rotate(-90 36 36)" style={{ transition: 'stroke-dashoffset .25s linear' }} />
          <text x="36" y="44" textAnchor="middle" fill="#fff" fontSize="22" fontWeight="800" fontFamily="var(--font-display)">{left}</text>
        </svg>
        <div style={{ minWidth: 0 }}>
          <h1 id="offer-h"><Icon name={SERVICE_ICON_NAME[offer.service] ?? 'car'} size={26} />{LABEL[offer.service] ?? 'New request'}</h1>
          {offer.payment_method === 'cash' && <span className="offer-cash"><Icon name="cash" size={18} />Cash</span>}
        </div>
      </div>

      <div className="offer-body">
        <div id="offer-glance" className="offer-glance">
          <div className="offer-earn">{money(earn)}<span className="sr-only"> {pay ? 'your pay' : 'estimated pay'}.</span></div>
          <dl className="offer-facts">
            <div><dt>Pickup</dt><dd>{pickupBits}</dd><dd className="offer-place">{shortPlace(offer.pickup?.address)}</dd></div>
            {run
              ? <div><dt>Run</dt><dd>{run.stops} drops, {km(run.trip_m)}</dd><dd className="offer-place">Last: {shortPlace(run.last_drop)}</dd></div>
              : <div><dt>{isCourier ? 'Delivery' : 'Trip'}</dt><dd>{km(offer.est_distance_m)}, {mins(offer.est_duration_s)}</dd><dd className="offer-place">{shortPlace(offer.dropoff?.address)}</dd></div>}
          </dl>
        </div>
        <div className="offer-sub">
          {pay ? 'Your pay for this trip' : 'Your estimated earnings'}{offer.pickup_m != null
            ? <>: {km(offer.total_m ?? offer.pickup_m + offer.est_distance_m)} in all, including the drive to the pickup</>
            : null}
        </div>
        {run && <p className="offer-sub"><strong>Multi-drop run:</strong> collect {run.stops} parcels at one pickup, then deliver in order. Pay for every drop: {money(run.pay_cents)}. The breakdown below is the first drop.</p>}
        {offer.pickup_window && <p className="offer-sub"><strong>Pickup window:</strong> collect by {new Date(offer.pickup_window.to).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' })}.</p>}
        {pay && (
          <ul className="offer-pay" aria-label="How your pay adds up">
            <li><span>Fare</span><span>{money(pay.fare_cents)}</span></li>
            <li><span>DingoGo fee {pay.fee_pct}%{pay.fee_basis !== 'driver' ? ` (${FEE_BASIS[pay.fee_basis]})` : ''}</span><span>{money(-pay.fee_cents)}</span></li>
            {pay.pickup_pay_cents > 0 && <li><span>Pickup pay ({pay.pickup_paid_km} km)</span><span>{money(pay.pickup_pay_cents)}</span></li>}
            {pay.fuel_surcharge_cents > 0 && <li><span>Fuel surcharge</span><span>{money(pay.fuel_surcharge_cents)}</span></li>}
          </ul>
        )}

        <div className="leg">
          <span className="dot" style={{ background: 'var(--saltbush)' }} />
          <p>{offer.pickup?.address}<small>{isCourier ? 'Collect parcel' : 'Pick up'}</small></p>
          <span className="line" />
          <span />
          <span className="dot" style={{ background: 'var(--ochre)' }} />
          <p>{offer.dropoff?.address}<small>{isCourier ? 'Deliver' : 'Drop off'}</small></p>
        </div>

        <div className="flags">
          {offer.payment_method === 'cash' && <span className="flag"><Icon name="cash" size={18} />Cash fare: collect {money(offer.quote_cents)}</span>}
          {!isCourier && offer.passengers > 1 && <span className="flag"><Icon name="users" size={18} />{offer.passengers} passengers</span>}
          {offer.has_pet && <span className="flag"><Icon name="paw" size={18} />Pet on board</span>}
          {offer.needs_wheelchair && <span className="flag"><Icon name="access" size={18} />Wheelchair</span>}
          {offer.assistance_animal && <span className="flag legal"><Icon name="shield" size={18} /><span><strong>Assistance animal.</strong> By law (Disability Discrimination Act) you must accept assistance animals. Refusals are reviewed.</span></span>}
          {needFlags(offer.rider_needs).map(([ic, text]) => <span key={text} className="flag flag-need"><Icon name={ic} size={18} />{text}</span>)}
          {offer.notes && <span className="flag flag-note"><Icon name="chat" size={18} />“{offer.notes}”</span>}
        </div>
        {error && <p className="dg-error">{error}</p>}
      </div>

      <div className="offer-actions">
        <button className="dg-btn dg-btn--ghost btn-xl offer-decline" onClick={decline} disabled={busy}>Decline</button>
        <button className="dg-btn btn-xl offer-accept" onClick={accept} disabled={busy} data-autofocus>{busy ? 'Accepting…' : <>Accept<span className="sr-only"> {money(earn)}</span></>}</button>
      </div>
    </div>,
    document.body,
  );
}
