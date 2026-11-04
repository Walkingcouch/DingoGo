import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ApiError, Icon, get, money, post, Ranges, useLoad } from '@dingogo/shared';
import { DgMap, type MapMarker } from '@dingogo/shared/map';
import { PlaceField, type Place } from '../components/PlaceField';
import { QuoteBox } from '../components/QuoteBox';
import { useMe } from '../ctx';
import { ToursPanel } from './Tours';
import { HirePanel } from './Hire';

type Mode = 'ride' | 'pet' | 'courier' | 'tour' | 'hire';
const MODES: { id: Mode; label: string; icon: string }[] = [
  { id: 'ride', label: 'Ride', icon: 'car' },
  { id: 'pet', label: 'Pet ride', icon: 'paw' },
  { id: 'courier', label: 'Parcel', icon: 'package' },
  { id: 'tour', label: 'Tours', icon: 'compass' },
  { id: 'hire', label: 'Hire', icon: 'calendar' },
];
const SIZES = [
  { id: 'S', service: 'courier_s', label: 'Small', desc: 'Satchel or shoebox, up to 5 kg' },
  { id: 'M', service: 'courier_m', label: 'Medium', desc: 'Box up to 15 kg, fits on the back seat' },
  { id: 'L', service: 'courier_l', label: 'Large', desc: 'Up to 25 kg, fits in the boot' },
] as const;

type Pay = { method: 'card' | 'cash' | 'wallet' | 'corporate'; account?: string };

/** Local datetime-local string → ISO. */
const toIso = (v: string) => (v ? new Date(v).toISOString() : null);
const minSchedule = () => {
  const d = new Date(Date.now() + 25 * 60000);
  d.setSeconds(0, 0);
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

export function RideScreen() {
  const { me, reload } = useMe();
  const nav = useNavigate();
  const [mode, setMode] = useState<Mode>('ride');
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [target, setTarget] = useState<'pickup' | 'dropoff'>('pickup');
  const [locMsg, setLocMsg] = useState<string | null>(null);

  // ride options
  const [passengers, setPassengers] = useState(1);
  const [later, setLater] = useState(false);
  const [when, setWhen] = useState('');
  const [assist, setAssist] = useState(false);
  const [wheelchair, setWheelchair] = useState(false);
  const [femalePref, setFemalePref] = useState(false);
  const [petDetails, setPetDetails] = useState('');
  const [notes, setNotes] = useState('');
  const [promo, setPromo] = useState('');
  const [usePoints, setUsePoints] = useState(false);
  const [ndis, setNdis] = useState(false);
  const [ndisNo, setNdisNo] = useState('');
  const [pay, setPay] = useState<Pay>({ method: 'card' });
  const [cards, setCards] = useState<any[]>([]);
  const [showMore, setShowMore] = useState(false);

  // courier
  const [size, setSize] = useState<'S' | 'M' | 'L'>('S');
  const [parcel, setParcel] = useState({ description: '', declared: '', sender_name: '', sender_phone: '', recipient_name: '', recipient_phone: '', instructions: '', leave_unattended: false, requires_signature: false, prohibited_ack: false });

  const [quote, setQuote] = useState<any | null>(null);
  const [qLoading, setQLoading] = useState(false);
  const [qError, setQError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const qSeq = useRef(0);

  useEffect(() => { get('/payment-methods').then((r) => setCards(r.methods)).catch(() => {}); }, []);
  useEffect(() => {
    if (me && !parcel.sender_name) setParcel((p) => ({ ...p, sender_name: me.user.name, sender_phone: me.user.phone }));
  }, [me]); // eslint-disable-line

  const cashCfg = useLoad(() => get('/public/config').then((c: any) => c.cash_payments ?? { ride: false, courier: true }), []);
  const cashOk = !!cashCfg.data?.[mode === 'courier' ? 'courier' : 'ride'];
  useEffect(() => { if (!cashOk && pay.method === 'cash') setPay({ method: 'card' }); }, [cashOk]); // eslint-disable-line
  const service = mode === 'courier' ? SIZES.find((s) => s.id === size)!.service : mode === 'pet' ? 'pet' : 'ride';
  const quotable = (mode === 'ride' || mode === 'pet' || mode === 'courier') && pickup && dropoff;

  const quoteBody = useMemo(() => ({
    service, pickup, dropoff,
    scheduled_for: later && when ? toIso(when) : null,
    promo_code: promo.trim() || null,
    redeem_points: usePoints ? me?.user.loyalty_points ?? 0 : 0,
    corporate_account_id: pay.method === 'corporate' ? pay.account : null,
  }), [service, pickup, dropoff, later, when, promo, usePoints, pay, me?.user.loyalty_points]);

  useEffect(() => {
    if (!quotable) { setQuote(null); setQError(null); return; }
    const seq = ++qSeq.current;
    setQLoading(true);
    const t = setTimeout(async () => {
      try {
        const r = await post('/quotes', quoteBody);
        if (seq === qSeq.current) { setQuote({ ...r.quote, route: r.route }); setQError(null); }
      } catch (e) {
        if (seq === qSeq.current) { setQuote(null); setQError(e instanceof ApiError ? e.message : 'Could not get a price'); }
      } finally { if (seq === qSeq.current) setQLoading(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [JSON.stringify(quoteBody), quotable]); // eslint-disable-line

  function useMyLocation() {
    setLocMsg(null);
    if (!navigator.geolocation) { setLocMsg('Location isn’t available on this device. Search or tap the map instead.'); return; }
    navigator.geolocation.getCurrentPosition(
      (p) => { setPickup({ lat: p.coords.latitude, lng: p.coords.longitude, address: 'My location' }); setTarget('dropoff'); },
      () => setLocMsg('We couldn’t get your location. Check location permission, or search or tap the map.'),
      { enableHighAccuracy: true, timeout: 10000 });
  }

  function onMapClick(p: { lat: number; lng: number }) {
    const place = { ...p, address: `Pin near ${p.lat.toFixed(4)}, ${p.lng.toFixed(4)}` };
    if (target === 'pickup') { setPickup(place); setTarget('dropoff'); } else setDropoff(place);
  }

  async function request() {
    if (!pickup || !dropoff) return;
    setBusy(true); setError(null);
    try {
      const body: any = {
        ...quoteBody, kind: mode === 'courier' ? 'courier' : 'ride', payment_method: pay.method,
        notes: notes.trim() || undefined,
      };
      if (mode !== 'courier') {
        Object.assign(body, {
          passengers, assistance_animal: assist, needs_wheelchair: wheelchair, women_driver_pref: femalePref,
          has_pet: mode === 'pet', pet_details: mode === 'pet' ? petDetails.trim() || undefined : undefined,
        });
      } else {
        body.parcel = {
          size, description: parcel.description.trim(), declared_value_cents: parcel.declared ? Math.round(Number(parcel.declared) * 100) : undefined,
          sender_name: parcel.sender_name.trim(), sender_phone: parcel.sender_phone.trim(), recipient_name: parcel.recipient_name.trim(),
          recipient_phone: parcel.recipient_phone.trim(), instructions: parcel.instructions.trim() || undefined,
          leave_unattended: parcel.leave_unattended, requires_signature: parcel.requires_signature, prohibited_ack: parcel.prohibited_ack,
        };
      }
      if (ndis && ndisNo) body.ndis_number = ndisNo;
      const r = await post('/trips', body);
      void reload();
      nav(r.trip.status === 'scheduled' ? `/trips/${r.trip.id}` : `/trip/${r.trip.id}`);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Could not book. Try again.');
    } finally { setBusy(false); }
  }

  const markers: MapMarker[] = [
    ...(pickup ? [{ id: 'p', kind: 'pickup' as const, ...pickup, label: pickup.address }] : []),
    ...(dropoff && mode !== 'tour' ? [{ id: 'd', kind: 'dropoff' as const, ...dropoff, label: dropoff.address }] : []),
  ];
  const route = quote?.route?.geometry?.map(([lat, lng]: number[]) => ({ lat, lng })) ?? (pickup && dropoff && mode !== 'tour' ? [pickup, dropoff] : null);

  const courierReady = mode !== 'courier' || (parcel.description.trim().length >= 2 && parcel.sender_name && parcel.sender_phone.length >= 8 && parcel.recipient_name && parcel.recipient_phone.length >= 8 && parcel.prohibited_ack);
  const canRequest = !!quote && !qError && !qLoading && courierReady && (!later || !!when) && (!ndis || /^\d{9}$/.test(ndisNo));
  const corp = me?.corporate_accounts ?? [];
  const firstName = me?.user.name?.split(' ')[0];

  return (
    <div className="ride">
      <div className="ride__map">
        <DgMap markers={markers} route={route} onMapClick={mode === 'hire' ? undefined : onMapClick} padding={50} />
        {mode !== 'hire' && (
          <p className="ride__maphint" aria-live="polite">Tap the map to set {target === 'pickup' ? 'pickup' : mode === 'tour' ? 'pickup' : 'drop-off'}</p>
        )}
      </div>

      <div className="sheet">
        <div className="sheet__grab" aria-hidden="true" />
        <h1 className="sheet__hello">{firstName ? `Where to, ${firstName}?` : 'Where to?'}</h1>

        <div className="modes" role="tablist" aria-label="Service">
          {MODES.map((m) => (
            <button key={m.id} role="tab" aria-selected={mode === m.id} className={`modes__b ${mode === m.id ? 'is-on' : ''}`} onClick={() => setMode(m.id)}>
              <span className="modes__i"><Icon name={m.icon} size={22} /></span><span className="modes__l">{m.label}</span>
            </button>
          ))}
        </div>

        {mode === 'hire' ? <HirePanel /> : mode === 'tour' ? (
          <ToursPanel pickup={pickup} setPickup={setPickup} onFocusPickup={() => setTarget('pickup')} payMethod={pay.method} />
        ) : (
          <>
            <div className="places">
              <PlaceField label="Pickup" dot="A" value={pickup} onChange={setPickup} placeholder={mode === 'courier' ? 'Collect parcel from' : 'Pickup location'}
                active={target === 'pickup'} onFocusField={() => setTarget('pickup')} />
              <PlaceField label="Drop-off" dot="B" value={dropoff} onChange={setDropoff} placeholder={mode === 'courier' ? 'Deliver to' : 'Where are you going?'}
                active={target === 'dropoff'} onFocusField={() => setTarget('dropoff')} />
            </div>
            <button type="button" className="linkbtn" onClick={useMyLocation}>Use my location for pickup</button>
            {locMsg && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>{locMsg}</p>}

            {mode === 'pet' && (
              <div className="callout callout--dusk">
                <strong>Pet rides</strong> use a car with seat covers and a harness point. Keep your pet on a lead or in a crate.
                <label className="dg-field" style={{ marginTop: '.6rem', marginBottom: 0 }}><span>About your pet</span>
                  <input className="dg-input" placeholder="e.g. medium dog, very friendly" value={petDetails} onChange={(e) => setPetDetails(e.target.value)} maxLength={200} /></label>
              </div>
            )}

            {mode === 'courier' && (
              <fieldset className="block">
                <legend>Parcel</legend>
                <div className="sizes" role="radiogroup" aria-label="Parcel size">
                  {SIZES.map((s) => (
                    <button key={s.id} type="button" role="radio" aria-checked={size === s.id} className={`sizes__b ${size === s.id ? 'is-on' : ''}`} onClick={() => setSize(s.id)}>
                      <strong>{s.label}</strong><span>{s.desc}</span>
                    </button>
                  ))}
                </div>
                <label className="dg-field"><span>What are you sending?</span>
                  <input className="dg-input" placeholder="e.g. house keys, documents, phone charger" value={parcel.description} maxLength={200} onChange={(e) => setParcel({ ...parcel, description: e.target.value })} /></label>
                <label className="dg-field"><span>Value in dollars (optional)</span>
                  <input className="dg-input" inputMode="decimal" placeholder="e.g. 80" value={parcel.declared} onChange={(e) => setParcel({ ...parcel, declared: e.target.value.replace(/[^\d.]/g, '') })} /></label>
                <div className="grid2">
                  <label className="dg-field"><span>Sender name</span><input className="dg-input" value={parcel.sender_name} onChange={(e) => setParcel({ ...parcel, sender_name: e.target.value })} /></label>
                  <label className="dg-field"><span>Sender mobile</span><input className="dg-input" type="tel" value={parcel.sender_phone} onChange={(e) => setParcel({ ...parcel, sender_phone: e.target.value })} /></label>
                  <label className="dg-field"><span>Recipient name</span><input className="dg-input" value={parcel.recipient_name} onChange={(e) => setParcel({ ...parcel, recipient_name: e.target.value })} /></label>
                  <label className="dg-field"><span>Recipient mobile</span><input className="dg-input" type="tel" value={parcel.recipient_phone} onChange={(e) => setParcel({ ...parcel, recipient_phone: e.target.value })} /></label>
                </div>
                <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)', marginTop: 0 }}>We text the recipient a tracking link and a 4-digit delivery PIN to give the driver.</p>
                <label className="dg-field"><span>Instructions for the driver</span>
                  <input className="dg-input" placeholder="e.g. side gate, ask at reception" value={parcel.instructions} maxLength={300} onChange={(e) => setParcel({ ...parcel, instructions: e.target.value })} /></label>
                <label className="dg-check"><input type="checkbox" checked={parcel.leave_unattended} onChange={(e) => setParcel({ ...parcel, leave_unattended: e.target.checked, requires_signature: e.target.checked ? false : parcel.requires_signature })} />
                  <span>OK to leave it if nobody's home (driver takes a photo)</span></label>
                <label className="dg-check"><input type="checkbox" checked={parcel.requires_signature} onChange={(e) => setParcel({ ...parcel, requires_signature: e.target.checked, leave_unattended: e.target.checked ? false : parcel.leave_unattended })} />
                  <span>Recipient must sign</span></label>
                <label className={`dg-check prohibited ${parcel.prohibited_ack ? 'is-ok' : ''}`}>
                  <input type="checkbox" checked={parcel.prohibited_ack} onChange={(e) => setParcel({ ...parcel, prohibited_ack: e.target.checked })} required />
                  <span><strong>No alcohol, weapons, drugs, dangerous goods or cash.</strong> I confirm the parcel has none of these. Drivers can check and refuse.</span>
                </label>
              </fieldset>
            )}

            <button type="button" className="disclose" aria-expanded={showMore} onClick={() => setShowMore((s) => !s)}>
              <span>Trip options</span>
              <span className="dg-muted">{[later && 'Scheduled', mode !== 'courier' && passengers > 1 && `${passengers} people`, assist && 'Assistance animal', femalePref && 'Female driver', promo && 'Promo', usePoints && 'Points'].filter(Boolean).join(', ') || 'Schedule, accessibility, promo'}</span>
            </button>
            {showMore && (
              <div className="block">
                <label className="dg-check"><input type="checkbox" checked={later} onChange={(e) => { setLater(e.target.checked); if (e.target.checked && !when) setWhen(minSchedule()); }} />
                  <span>Schedule for later</span></label>
                {later && (
                  <label className="dg-field"><span>Pickup date and time</span>
                    <input className="dg-input" type="datetime-local" min={minSchedule()} value={when} onChange={(e) => setWhen(e.target.value)} /></label>
                )}
                {mode !== 'courier' && (
                  <>
                    <label className="dg-field"><span>Passengers</span>
                      <div className="stepper">
                        <button type="button" aria-label="Fewer passengers" onClick={() => setPassengers((n) => Math.max(1, n - 1))}>−</button>
                        <output aria-live="polite">{passengers}</output>
                        <button type="button" aria-label="More passengers" onClick={() => setPassengers((n) => Math.min(4, n + 1))}>+</button>
                      </div>
                    </label>
                    <label className="dg-check"><input type="checkbox" checked={assist} onChange={(e) => setAssist(e.target.checked)} />
                      <span>I'm travelling with an assistance animal<br /><small className="dg-muted">Every DingoGo driver must take assistance animals. It's the law, and our policy.</small></span></label>
                    <label className="dg-check"><input type="checkbox" checked={wheelchair} onChange={(e) => setWheelchair(e.target.checked)} />
                      <span>I need a wheelchair-accessible car<br /><small className="dg-muted">We don't have a wheelchair-accessible car yet, so this request may not be matched. A folding wheelchair fits in the boot. Call us and we'll help arrange another option.</small></span></label>
                    <label className="dg-check"><input type="checkbox" checked={femalePref} onChange={(e) => setFemalePref(e.target.checked)} />
                      <span>I'd prefer a female driver<br /><small className="dg-muted">Fewer drivers available, so it can take longer.</small></span></label>
                  </>
                )}
                <label className="dg-field"><span>Note for the driver</span>
                  <input className="dg-input" placeholder={mode === 'courier' ? 'e.g. call when outside' : 'e.g. I’m at the blue gate'} value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></label>
                <label className="dg-field"><span>Promo code</span>
                  <input className="dg-input" value={promo} onChange={(e) => setPromo(e.target.value.toUpperCase())} placeholder="e.g. WELCOME" /></label>
                {(me?.user.loyalty_points ?? 0) >= 100 && (
                  <label className="dg-check"><input type="checkbox" checked={usePoints} onChange={(e) => setUsePoints(e.target.checked)} />
                    <span>Use my Dingo Points ({me!.user.loyalty_points.toLocaleString()} points, 100 = $1 off, up to half the fare)</span></label>
                )}
                <label className="dg-check"><input type="checkbox" checked={ndis} onChange={(e) => setNdis(e.target.checked)} />
                  <span>I'm an NDIS participant (your number goes on the tax invoice for your plan manager)</span></label>
                {ndis && (
                  <label className="dg-field"><span>NDIS number</span>
                    <input className="dg-input" inputMode="numeric" maxLength={9} value={ndisNo} onChange={(e) => setNdisNo(e.target.value.replace(/\D/g, ''))} placeholder="9 digits" /></label>
                )}
              </div>
            )}

            <fieldset className="block pay">
              <legend>Pay with</legend>
              <div className="paylist">
                <PayOpt on={pay.method === 'card'} onClick={() => setPay({ method: 'card' })} icon="card" title={cards[0] ? `${cards[0].brand} ending ${cards[0].last4}` : 'Card'}
                  sub={cards[0] ? 'Held when you book, charged at the end' : 'Add a card in Account, or use test mode'} />
                {cashOk && <PayOpt on={pay.method === 'cash'} onClick={() => setPay({ method: 'cash' })} icon="cash" title="Cash" sub="Pay the driver at the end" />}
                <PayOpt on={pay.method === 'wallet'} onClick={() => setPay({ method: 'wallet' })} icon="wallet" title="DingoGo credit" sub={`${money(me?.user.wallet_cents ?? 0)} available`} />
                {corp.map((c) => (
                  <PayOpt key={c.id} on={pay.method === 'corporate' && pay.account === c.id} onClick={() => setPay({ method: 'corporate', account: c.id })} icon="receipt" title={c.name} sub="Business account, invoiced monthly" />
                ))}
              </div>
            </fieldset>

            <QuoteBox quote={quote} loading={qLoading} error={qError} />
            {error && <p className="dg-error" role="alert">{error}</p>}
            <div className="requestbar">
            {!pickup || !dropoff ? <p className="requestbar__hint">Add a pickup and drop-off to see your price</p> : null}
            <button className="dg-btn dg-btn--block dg-btn--dark request" disabled={!canRequest || busy} onClick={request}>
              {busy ? 'Booking…' : mode === 'courier' ? `Send parcel${quote ? ` for ${money(quote.total_cents)}` : ''}` : later ? `Schedule ${mode === 'pet' ? 'pet ride' : 'ride'}` : `Book ${mode === 'pet' ? 'pet ride' : 'ride'}${quote ? ` for ${money(quote.total_cents)}` : ''}`}
            </button>
            {mode === 'courier' && !parcel.prohibited_ack && quote && <p className="requestbar__hint">Confirm the prohibited items check to send</p>}
            </div>
          </>
        )}
        <p className="ride__foot dg-muted">100% electric. Aboriginal-owned. <Link to="/account/safety">How we keep you safe</Link></p>
        <Ranges height={36} fill="var(--ochre-soft)" style={{ margin: '1rem -20px -24px', width: 'calc(100% + 40px)' }} />
      </div>
    </div>
  );
}

function PayOpt({ on, onClick, title, sub, icon }: { on: boolean; onClick: () => void; title: string; sub: string; icon: string }) {
  return (
    <button type="button" role="radio" aria-checked={on} className={`payopt ${on ? 'is-on' : ''}`} onClick={onClick}>
      <span className="payopt__ic"><Icon name={icon} size={20} /></span>
      <span className="payopt__t"><strong>{title}</strong><small>{sub}</small></span>
      <span className="payopt__r" aria-hidden="true" />
    </button>
  );
}
