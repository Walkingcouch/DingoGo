import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  Icon,
  ApiError, ChatThread, REALTIME, COURIER_STATUS_LABEL, useTripChat, STATUS_LABEL, ago, connectRealtime, date, dateTime, get, getIfChanged, km, money, onNetworkChange, post, statusTone, time, useInterval, usePoll, Ranges,
  isTemporary, DELIVERY_FAIL_REASONS, PARCEL_OUTCOME_LABEL, speak, t as tr, EmergencyCard,
} from '@dingogo/shared';
import { DgMap, type MapMarker } from '@dingogo/shared/map';
import { ACTIVE, shareUrl, useMe } from '../ctx';
import { Dialog, Spinner, Stars, shareOrCopy, useCopy } from '../components/ui';
import { announce } from '../components/Announcer';

const RIDE_STEPS = ['requested', 'accepted', 'arrived', 'in_progress', 'completed'];
/** Short, plain step names shown under the progress bar (icons alone aren't enough for everyone). */
const RIDE_STEP = ['Finding', 'Coming', 'Here', 'Riding'];
const COURIER_STEP = ['Finding', 'To pickup', 'Collecting', 'Delivering'];

/** Fuel chip for green cars. Older APIs send no fuel_type/is_ev, so both are optional; petrol and diesel get no chip. */
const FUEL_LABEL: Record<string, string> = { electric: 'Electric', plug_in_hybrid: 'Plug-in hybrid', hybrid: 'Hybrid' };
const isEv = (v: any) => v?.is_ev === true || v?.fuel_type === 'electric';
function FuelChip({ v }: { v: any }) {
  const label = FUEL_LABEL[v?.fuel_type] ?? (v?.is_ev === true ? 'Electric' : null);
  if (!label) return null;
  return <span className="dg-chip dg-chip--green fuel-chip">{isEv(v) && <Icon name="leaf" size={14} />} {label}</span>;
}

export function TripScreen() {
  const { id } = useParams();
  const nav = useNavigate();
  const { reload: reloadMe } = useMe();
  // Poor signal: start from the copy saved on this phone, so the PIN, car and rego show even with no bars.
  const [cached] = useState(() => (id ? readCachedTrip(id) : null));
  const [trip, setTrip] = useState<any | null>(cached?.trip ?? null);
  const [syncedAt, setSyncedAt] = useState<number | null>(cached?.at ?? null);
  const [stale, setStale] = useState<false | 'signal' | 'service'>(false);
  const [err, setErr] = useState<string | null>(null);
  const [carPos, setCarPos] = useState<{ lat: number; lng: number; heading?: number | null } | null>(null);
  const tripRef = useRef(trip); tripRef.current = trip;
  const shown = useRef<string | undefined>(undefined);

  // Returns false when DingoGo answered "no change" (304), so the poll can slow down a little (usePoll).
  const load = useCallback(async (): Promise<boolean | void> => {
    try {
      // The first read on this screen always gets the data (a 304 then reuses the copy kept by the API client).
      const r = shown.current === id ? await getIfChanged(`/trips/${id}`) : await get(`/trips/${id}`);
      setErr(null); setStale(false); setSyncedAt(Date.now());
      if (!r) return false;
      shown.current = id;
      setTrip(r.trip);
      cacheTrip(r.trip);
      if (r.trip.driver?.lat) setCarPos((p) => p ?? { lat: r.trip.driver.lat, lng: r.trip.driver.lng, heading: r.trip.driver.heading });
    } catch (e) {
      // No signal: keep showing what we have and say how old it is. Only a real answer from DingoGo replaces the screen.
      if (e instanceof ApiError && e.code === 'offline' && tripRef.current) setStale('signal');
      // DingoGo's side is down (database): same idea — keep the trip on screen and say why it isn't updating.
      else if (isTemporary(e) && tripRef.current) setStale('service');
      else setErr(e instanceof ApiError ? e.message : 'Could not load trip');
    }
  }, [id]);

  useEffect(() => { void load(); }, [load]);
  const reloadTrip = useCallback(async () => { await load(); }, [load]);
  const live = trip && ACTIVE.includes(trip.status);
  useEffect(() => {
    if (!id) return;
    const rt = connectRealtime((m) => {
      if (m.type === 'driver.location' && m.data.trip_id === id) setCarPos({ lat: m.data.lat, lng: m.data.lng, heading: m.data.heading });
      if (m.type === 'trip.updated' && m.data.id === id) void load();
    }, { subscribe: [`trip:${id}`] });
    return () => rt.close();
  }, [id, load]);
  // Back in signal: refresh straight away rather than waiting for the next poll.
  useEffect(() => onNetworkChange((on) => { if (on) void load(); }), [load]);
  // Round 18: 4 s while the trip is live (10 s with realtime), easing to 8 s while nothing changes (still searching, car parked),
  // every 15 s while the app is in the background (texts and push cover the big moments), and at once when it comes back.
  usePoll(load, live || stale ? (REALTIME && !stale ? 10000 : 4000) : null, { hiddenMs: 15000, maxMs: REALTIME && !stale ? 10000 : 8000 });
  useEffect(() => { if (trip?.status === 'completed') void reloadMe(); }, [trip?.status]); // eslint-disable-line
  useTripAnnouncements(trip);

  if (err && !trip) return <div className="page"><p className="dg-error" role="alert">{err}</p><button className="dg-btn" onClick={() => { setErr(null); void load(); }}>Try again</button> <Link to="/" className="dg-btn dg-btn--ghost">Back to home</Link></div>;
  if (!trip) return <div className="page"><Spinner label="Loading trip" /></div>;

  const net = stale ? <StaleNote at={syncedAt} kind={stale} /> : null;
  if (live) return <LiveTrip trip={trip} carPos={carPos} reload={reloadTrip} onClose={() => nav('/')} net={net} />;
  return <TripDetail trip={trip} reload={reloadTrip} net={net} />;
}

/** "Last updated 3 min ago" while the phone has no signal. */
function StaleNote({ at, kind = 'signal' }: { at: number | null; kind?: 'signal' | 'service' }) {
  const [, tick] = useState(0);
  useInterval(() => tick((n) => n + 1), 30000);
  const asOf = at ? `Showing your trip as it was ${ago(new Date(at)) === 'just now' ? 'a moment ago' : ago(new Date(at))}.` : 'Showing your trip as we last saw it.';
  return (
    <p className="netbar" role="status">
      <Icon name="alert" size={18} />
      {kind === 'service'
        ? <span><strong>DingoGo is having a problem on our side.</strong> {asOf} Your driver can still see your trip. In an emergency call 000.</span>
        : <span><strong>No signal.</strong> {asOf} We'll update it when you're back in range.</span>}
    </p>
  );
}

// ── Last live trip, kept on this phone (cleared when the trip ends or you sign out) ──
const CACHE_KEY = 'dingogo.rider.lastTrip';
export function cacheTrip(t: any) {
  try {
    if (ACTIVE.includes(t.status)) localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), trip: t }));
    else if (readCachedTrip()?.trip.id === t.id) localStorage.removeItem(CACHE_KEY);
  } catch { /* storage unavailable */ }
}
export function readCachedTrip(id?: string): { at: number; trip: any } | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY) ?? 'null');
    if (!c?.trip?.id || (id && c.trip.id !== id)) return null;
    if (Date.now() - c.at > 12 * 3600_000) { localStorage.removeItem(CACHE_KEY); return null; } // a trip doesn't last half a day
    return c;
  } catch { return null; }
}
export function clearCachedTrip() { try { localStorage.removeItem(CACHE_KEY); } catch { /* storage unavailable */ } }

/** Plain-words summary of a trip's state, read out by screen readers when it changes. */
const spell = (s?: string | null) => (s ?? '').split('').join(' ');
export function tripAnnouncement(t: any): { text: string; urgent: boolean } | null {
  const courier = t.kind === 'courier';
  const v = t.vehicle, d = t.driver;
  const car = v ? `${[v.colour, v.make, v.model].filter(Boolean).join(' ')}, rego ${spell(v.rego)}` : '';
  switch (t.status) {
    case 'requested': return { text: t.driver_releases > 0 ? 'Your driver couldn\'t make it. Finding you another driver. Same price.' : courier ? 'Finding a driver for your parcel.' : 'Finding you a driver.', urgent: false };
    case 'accepted': return { text: `${d?.name ? `${d.name} is` : 'Your driver is'} on the way.${car ? ` Car: ${car}.` : ''}${!courier && t.verify_pin ? ` Your trip PIN is ${spell(t.verify_pin)}.` : ''}`, urgent: false };
    case 'arrived': return { text: courier ? 'Your driver is at the pickup.' : `Your driver has arrived.${car ? ` Car: ${car}.` : ''}`, urgent: true };
    case 'in_progress': return { text: courier ? 'Your parcel is on its way.' : `Trip started. On the way to ${t.dropoff_address}.`, urgent: false };
    case 'completed': return { text: courier ? 'Your parcel has been delivered.' : 'You have arrived. Trip complete.', urgent: false };
    case 'cancelled_driver': return { text: 'Your driver cancelled. You have not been charged.', urgent: true };
    case 'no_drivers': return { text: 'No drivers are free right now. You have not been charged.', urgent: true };
    case 'cancelled_rider': case 'cancelled_admin': return { text: 'This trip is cancelled.', urgent: false };
    default: return null;
  }
}

/** Speak each change of trip status once (not on first load, when the screen itself is read), update the page title so the status
 *  shows in the app switcher, and buzz the phone when the driver arrives (helps riders who are Deaf or hard of hearing). */
function useTripAnnouncements(trip: any | null) {
  const { me } = useMe();
  const simple = !!me?.user.accessibility?.simple;
  const key = trip ? `${trip.status}:${trip.driver_releases ?? 0}:${trip.driver_id ?? ''}` : null;
  const last = useRef<string | null>(null);
  useEffect(() => {
    if (!trip || !key) return;
    const labels = trip.kind === 'courier' ? COURIER_STATUS_LABEL : STATUS_LABEL;
    document.title = `${labels[trip.status] ?? 'Trip'} · DingoGo`;
    if (last.current !== null && last.current !== key) {
      const a = tripAnnouncement(trip);
      if (a) announce(a.text, a.urgent);
      // Simple mode: say it out loud too (riders who don't read much, or don't use a screen reader).
      if (a && simple) speak(a.text);
      if (trip.status === 'arrived') { try { navigator.vibrate?.([300, 150, 300]); } catch { /* not supported */ } }
    }
    last.current = key;
  }, [key]); // eslint-disable-line
  useEffect(() => () => { document.title = 'DingoGo'; }, []);
}

/** Simple mode: one big picture and a few words for where the trip is up to, with a button to hear it. */
const BIG: Record<string, { icon: string; key: Parameters<typeof tr>[0] }> = {
  requested: { icon: 'clock', key: 'status_finding' }, accepted: { icon: 'car', key: 'status_coming' }, arrived: { icon: 'pin', key: 'status_here' },
  in_progress: { icon: 'route', key: 'status_riding' }, completed: { icon: 'check', key: 'status_done' },
};
function BigStatus({ trip, lang }: { trip: any; lang?: string | null }) {
  const b = BIG[trip.status] ?? { icon: 'alert', key: 'status_cancelled' as const };
  const a = tripAnnouncement(trip);
  return (
    <div className="bigstatus">
      <span className="bigstatus__i" aria-hidden="true"><Icon name={b.icon} size={36} /></span>
      <span style={{ display: 'grid', gap: 6 }}><strong>{tr(b.key, lang)}</strong>
        {a && <button type="button" className="linkbtn" onClick={() => speak(a.text)}><Icon name="volume" size={18} /> {tr('simple_hear', lang)}</button>}</span>
    </div>
  );
}

function LiveTrip({ trip, carPos, reload, onClose, net }: { trip: any; carPos: any; reload: () => Promise<void>; onClose: () => void; net: ReactNode }) {
  const { me } = useMe();
  const simple = !!me?.user.accessibility?.simple;
  const labels = trip.kind === 'courier' ? COURIER_STATUS_LABEL : STATUS_LABEL;
  const [sosOpen, setSosOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const { copy, copied } = useCopy();
  const step = RIDE_STEPS.indexOf(trip.status);
  const hasDriver = !!trip.driver && ['accepted', 'arrived', 'in_progress'].includes(trip.status);
  const chat = useTripChat(hasDriver ? trip.id : null, chatOpen);
  const contact = useContact(hasDriver ? trip.id : null);
  useEffect(() => {
    if (!hasDriver) return;
    const rt = connectRealtime((m) => { if (m.type === 'message.new' && m.data?.trip_id === trip.id) chat.refresh(); });
    return () => rt.close();
  }, [hasDriver, trip.id]); // eslint-disable-line
  const prevUnread = useRef(0);
  useEffect(() => {
    if (chat.unread > prevUnread.current && !chatOpen) announce('New message from your driver');
    prevUnread.current = chat.unread;
  }, [chat.unread, chatOpen]);

  const markers: MapMarker[] = [
    { id: 'p', kind: 'pickup', lat: trip.pickup_lat, lng: trip.pickup_lng, label: trip.pickup_address },
    ...(trip.service !== 'tour' ? [{ id: 'd', kind: 'dropoff' as const, lat: trip.dropoff_lat, lng: trip.dropoff_lng, label: trip.dropoff_address }] : []),
    ...(carPos ? [{ id: 'car', kind: 'car' as const, ...carPos, label: trip.vehicle?.rego }] : []),
  ];
  const v = trip.vehicle;
  const d = trip.driver;
  const again = trip.status === 'requested' && trip.driver_releases > 0;
  const sub = trip.status === 'requested'
    ? (again ? `Your driver couldn't make it, so we're finding you another one. Same price, no extra charge.`
      : trip.scheduled_for ? `Finding a driver for your ${time(trip.scheduled_for)} booking. We keep looking until your pickup time.`
      : `We're asking the nearest driver. This usually takes under a minute.`)
    : trip.status === 'accepted' ? (trip.kind === 'courier' ? 'Heading to collect your parcel.' : 'Heading to your pickup.')
    : trip.status === 'arrived' ? (trip.kind === 'courier' ? 'Driver is at the pickup.' : `Look for ${v?.colour ?? ''} ${v?.make ?? ''} ${v?.model ?? ''}, rego ${v?.rego ?? ''}.`)
    : trip.kind === 'courier' ? `On its way to ${trip.dropoff_address}.` : `On the way to ${trip.dropoff_address}.`;

  return (
    <div className="live">
      <div className="live__map">
        <DgMap markers={markers} padding={70} />
        <button className="iconbtn iconbtn--float" style={{ left: 12 }} onClick={onClose} aria-label="Back to home">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 5l-7 7 7 7" /></svg>
        </button>
        <button className="sos" onClick={() => setSosOpen(true)} aria-haspopup="dialog">SOS</button>
      </div>
      <div className="sheet sheet--live">
        <div className="sheet__grab" aria-hidden="true" />
        {net}
        <p className="live__ref dg-muted">{trip.ref}</p>
        {simple && <BigStatus trip={trip} lang={me?.user.language} />}
        <h1 className="live__status">{again ? 'Finding you another driver' : labels[trip.status]}</h1>
        <p className="live__sub">{sub}</p>

        <ol className="steps" aria-label="Trip progress">
          {RIDE_STEPS.slice(0, 4).map((s, i) => (
            <li key={s} className={i < step ? 'is-done' : i === step ? 'is-now' : ''} aria-current={i === step ? 'step' : undefined}>
              <span className="steps__bar" aria-hidden="true" />
              <span className="steps__l">{i < step && <Icon name="check" size={14} />}{(trip.kind === 'courier' ? COURIER_STEP : RIDE_STEP)[i]}<span className="sr-only">{i < step ? ', done' : i === step ? ', now' : ''}</span></span>
            </li>
          ))}
        </ol>

        {trip.status === 'requested' && <div className="searching" aria-hidden="true"><span /><span /><span /></div>}

        {trip.kind === 'ride' && trip.verify_pin && ['accepted', 'arrived'].includes(trip.status) && (
          <div className="pin">
            <div>
              <strong>Your trip PIN</strong>
              <p className="dg-muted">Tell the driver this PIN before you get in. If they don't ask, check the rego matches.</p>
            </div>
            <span className="pin__n" aria-label={`PIN ${trip.verify_pin.split('').join(' ')}`}>{trip.verify_pin}</span>
          </div>
        )}

        {d && (
          <div className="driver">
            <div className="driver__av" aria-hidden="true">{d.name?.[0]}</div>
            <div className="driver__info">
              <strong>{d.name}</strong>
              <span className="dg-muted">{d.rating ? <><Icon name="star" size={14} /> {Number(d.rating).toFixed(1)}</> : 'New driver'}{d.languages?.length ? `, speaks ${d.languages.map(langName).join(' and ')}` : ''}</span>
              {v && <span>{v.colour} {v.make} {v.model}</span>}
            </div>
            {v && (
              <div className="driver__car">
                <span className="rego">{v.rego}</span>
                <FuelChip v={v} />
                {v.battery_pct != null && (v.is_ev ?? true) && <span className="dg-chip dg-chip--green"><Icon name="battery" size={14} /> {v.battery_pct}%</span>}
              </div>
            )}
          </div>
        )}

        {trip.kind === 'courier' && trip.parcel && (
          <div className="callout callout--dusk" style={{ marginTop: '.8rem' }}>
            {trip.parcel.outcome === 'returning'
              ? <><strong>Couldn't be delivered.</strong> The driver is bringing {trip.parcel.description} back to you{trip.parcel.failed_reason ? ` (${failLabel(trip.parcel.failed_reason)})` : ''}.</>
              : <><strong>{trip.parcel.description}</strong> for {trip.parcel.recipient_name}. We've texted them a tracking link and a delivery PIN{trip.parcel.eta_at ? `. Arriving about ${time(trip.parcel.eta_at)}` : ''}.</>}
            {trip.batch && <> Drop {trip.batch_seq} of {trip.batch.stops.length} on run {trip.batch.ref}.</>}
          </div>
        )}

        {hasDriver && chat.available && (
          <div className="live__actions">
            <button className="dg-btn dg-btn--dark" onClick={() => setChatOpen(true)} aria-haspopup="dialog">
              <Icon name="chat" size={20} />Message {trip.kind === 'courier' ? 'driver' : d?.name?.split(' ')[0] ?? 'driver'}
              {chat.unread > 0 && <span className="dg-badge" aria-label={`${chat.unread} unread`}>{chat.unread}</span>}
            </button>
            {contact?.call && <a className="dg-btn dg-btn--ghost" href={`tel:${contact.call.number}`}><Icon name="phone" size={20} />Call</a>}
          </div>
        )}
        {hasDriver && trip.kind === 'ride' && <CheckIn trip={trip} simple={simple} onHelp={() => setSosOpen(true)} />}
        <div className="live__actions">
          <button className="dg-btn dg-btn--ghost" onClick={() => shareOrCopy({ title: 'My DingoGo trip', text: `Follow my DingoGo trip ${trip.ref}:`, url: shareUrl(trip.share_token) }, copy)}>
            {copied ? 'Link copied' : 'Share my trip'}
          </button>
          {hasDriver && trip.kind === 'ride' && <ShareContacts tripId={trip.id} />}
          {trip.status !== 'in_progress' && <button className="dg-btn dg-btn--ghost" onClick={() => setCancelOpen(true)}>Cancel</button>}
        </div>
        <dl className="kv">
          <div><dt>From</dt><dd>{trip.pickup_address}</dd></div>
          {trip.service !== 'tour' && <div><dt>To</dt><dd>{trip.dropoff_address}</dd></div>}
          <div><dt>Price</dt><dd className="dg-money">{money(trip.quote_cents)} <span className="dg-muted">({payLabel(trip.payment_method)})</span></dd></div>
        </dl>
      </div>
      <SosDialog open={sosOpen} onClose={() => setSosOpen(false)} trip={trip} />
      <CancelDialog open={cancelOpen} onClose={() => setCancelOpen(false)} trip={trip} onDone={reload} />
      <Dialog open={chatOpen} onClose={() => setChatOpen(false)} title={`Messages with ${d?.name?.split(' ')[0] ?? 'your driver'}`}>
        <ChatThread chat={chat} otherLabel="Driver"
          hint={contact?.call ? `To talk, tap Call. It goes through DingoGo, so neither of you sees the other's number. Call from the phone number on your account.` : undefined} />
        <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 10 }} onClick={() => setChatOpen(false)}>Close</button>
      </Dialog>
    </div>
  );
}

/** "Are you OK?": asked when the car stops for a long time, goes off the route, or by our team. Unanswered, our team checks on you. */
function CheckIn({ trip, simple, onHelp }: { trip: any; simple: boolean; onHelp: () => void }) {
  const [check, setCheck] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const [thanks, setThanks] = useState(false);
  const load = useCallback(() => {
    get(`/safety/checks?trip_id=${trip.id}`).then((r) => setCheck(r.checks?.[0] ?? null)).catch(() => { /* keep what we have */ });
  }, [trip.id]);
  useEffect(() => { load(); }, [load]);
  useInterval(load, 15000);
  useEffect(() => {
    const rt = connectRealtime((m) => { if (m.type === 'safety.check' && m.data?.trip_id === trip.id) setCheck(m.data); });
    return () => rt.close();
  }, [trip.id]);
  useEffect(() => {
    if (!check) return;
    try { navigator.vibrate?.([400, 200, 400]); } catch { /* not supported */ }
    if (simple) speak('Are you OK? Tap I am OK, or Get help.');
  }, [check?.id]); // eslint-disable-line
  if (thanks && !check) return <p className="callout callout--green" role="status">Thanks for letting us know.</p>;
  if (!check) return null;
  async function answer(a: 'ok' | 'help') {
    setBusy(true);
    try { await post(`/safety/checks/${check.id}`, { answer: a }); setCheck(null); if (a === 'ok') setThanks(true); else onHelp(); }
    catch { if (a === 'help') onHelp(); } finally { setBusy(false); }
  }
  const why = check.reason === 'long_stop' ? 'Your car has been stopped for a while.' : check.reason === 'route_deviation' ? 'Your trip has gone off the usual route.' : 'Our team is checking in.';
  return (
    <div className="callout callout--earth" role="alert" style={{ marginTop: '.8rem' }}>
      <strong style={{ fontSize: 'var(--fs-lg)' }}>Are you OK?</strong>
      <p style={{ margin: '.3rem 0 .6rem' }}>{why} If we don't hear back{check.answer_by ? ` by ${time(check.answer_by)}` : ''}, our team will check on you and text your trusted contacts.</p>
      <div className="live__actions" style={{ marginTop: 0 }}>
        <button className="dg-btn dg-btn--green" disabled={busy} onClick={() => answer('ok')}><Icon name="check" size={20} />I'm OK</button>
        <button className="dg-btn dg-btn--danger" disabled={busy} onClick={() => answer('help')}><Icon name="sos" size={20} />Get help</button>
      </div>
    </div>
  );
}

/** Text the live trip link to the rider's trusted contacts. */
function ShareContacts({ tripId }: { tripId: string }) {
  const [msg, setMsg] = useState<ReactNode>(null);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true); setMsg(null);
    try { const r = await post(`/trips/${tripId}/share-contacts`); setMsg(`Texted ${r.sent === 1 ? 'your contact' : `${r.sent} contacts`}`); }
    catch (e) {
      setMsg(e instanceof ApiError && e.code === 'no_contacts' ? <>Add trusted contacts in <Link to="/account/safety">Account, Safety</Link></> : e instanceof ApiError ? e.message : 'Could not send');
    } finally { setBusy(false); }
  }
  return (
    <>
      <button className="dg-btn dg-btn--ghost" disabled={busy} onClick={go}>Text my contacts</button>
      {msg && <span className="dg-muted" role="status" style={{ fontSize: 'var(--fs-sm)', alignSelf: 'center' }}>{msg}</span>}
    </>
  );
}

/** How to reach the driver: masked call through DingoGo's relay number when it's switched on, otherwise messages only. */
function useContact(tripId: string | null) {
  const [c, setC] = useState<{ chat: boolean; call: { number: string } | null } | null>(null);
  useEffect(() => {
    if (!tripId) { setC(null); return; }
    get(`/trips/${tripId}/contact`).then(setC).catch(() => setC(null));
  }, [tripId]);
  return c;
}

const LANGS: Record<string, string> = { en: 'English', arr: 'Arrernte', wbp: 'Warlpiri', pjt: 'Pitjantjatjara', luritja: 'Luritja' };
const langName = (l: string) => LANGS[l.toLowerCase()] ?? l;

export const payLabel = (m: string) => ({ card: 'card', cash: 'cash', wallet: 'DingoGo credit', corporate: 'business account' } as Record<string, string>)[m] ?? m;

function SosDialog({ open, onClose, trip }: { open: boolean; onClose: () => void; trip: any }) {
  const [state, setState] = useState<'confirm' | 'sending' | 'sent' | 'error'>('confirm');
  const [res, setRes] = useState<any>(null);
  useEffect(() => { if (open) setState('confirm'); }, [open]);

  async function send() {
    setState('sending');
    const pos: any = await new Promise((r) => {
      if (!navigator.geolocation) return r({});
      navigator.geolocation.getCurrentPosition((p) => r({ lat: p.coords.latitude, lng: p.coords.longitude }), () => r({}), { timeout: 4000 });
    });
    try { setRes(await post(`/trips/${trip.id}/sos`, pos)); setState('sent'); } catch { setState('error'); }
  }

  return (
    <Dialog open={open} onClose={onClose} title={state === 'sent' ? 'Help is being alerted' : 'Emergency help'}>
      {state === 'confirm' && (
        <>
          <p>If you're in danger, call Triple Zero now. You can also alert the DingoGo safety team, who will see your live location and contact you.</p>
          <a className="dg-btn dg-btn--danger dg-btn--block sos-call" href="tel:000">Call 000</a>
          {open && <EmergencyCard tripId={trip.id} />}
          <button className="dg-btn dg-btn--dark dg-btn--block" style={{ marginTop: 10 }} onClick={send}>Alert DingoGo safety team</button>
          <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 10 }} onClick={onClose}>I'm OK, go back</button>
        </>
      )}
      {state === 'sending' && <Spinner label="Sending alert" />}
      {state === 'sent' && (
        <>
          <p><strong>Our safety team has your trip, driver and location.</strong> {res?.contacts_texted ? `We've texted your live trip link to ${res.contacts_texted === 1 ? 'your contact' : `your ${res.contacts_texted} contacts`} too.` : ''}</p>
          <a className="dg-btn dg-btn--danger dg-btn--block sos-call" href={`tel:${res?.emergency_number ?? '000'}`}>Call {res?.emergency_number ?? '000'}</a>
          <EmergencyCard tripId={trip.id} />
          <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>Stay on the line with 000 if you can. Keep this screen open.</p>
          <button className="dg-btn dg-btn--ghost dg-btn--block" onClick={onClose}>Close</button>
        </>
      )}
      {state === 'error' && (
        <>
          <p className="dg-error">The alert didn't send, probably no signal. Call 000 directly.</p>
          <a className="dg-btn dg-btn--danger dg-btn--block sos-call" href="tel:000">Call 000</a>
          <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 10 }} onClick={send}>Try the alert again</button>
        </>
      )}
    </Dialog>
  );
}

function CancelDialog({ open, onClose, trip, onDone }: { open: boolean; onClose: () => void; trip: any; onDone: () => Promise<void> }) {
  const [fee, setFee] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    if (!open) return;
    get('/public/config').then((c) => setFee(c.services.find((s: any) => s.service === trip.service)?.cancel_fee_cents ?? null)).catch(() => {});
  }, [open, trip.service]);
  // Round 19: tours and hire booked ahead have their own terms (48 / 24 hours, deposit); ask the API what cancelling costs now.
  const booked = (trip.service === 'tour' || trip.service === 'hourly') && !!trip.scheduled_for;
  const [terms, setTerms] = useState<any>(null);
  useEffect(() => { if (open && booked) get(`/trips/${trip.id}/cancel-terms`).then(setTerms).catch(() => setTerms(null)); }, [open, booked, trip.id]);
  const assigned = !!trip.driver_id;
  const sinceAccept = trip.accepted_at ? (Date.now() - new Date(trip.accepted_at).getTime()) / 1000 : 0;
  const likelyFee = !booked && assigned && (trip.status === 'arrived' || sinceAccept > 120);
  const bookedFee = booked ? terms?.terms?.fee_cents ?? null : null;

  async function go() {
    setBusy(true); setErr(null);
    try { await post(`/trips/${trip.id}/cancel`, { reason: 'Rider cancelled in app' }); onClose(); await onDone(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not cancel'); }
    finally { setBusy(false); }
  }
  return (
    <Dialog open={open} onClose={onClose} title="Cancel this trip?">
      {booked && terms?.terms && (bookedFee ? (
        <p className="callout callout--earth">Cancelling now costs <strong>{money(bookedFee)}</strong> because it starts soon (free until {new Date(terms.terms.free_until).toLocaleString('en-AU', { timeZone: 'Australia/Darwin', weekday: 'short', hour: 'numeric', minute: '2-digit' })}).
          {terms.deposit_cents > 0 && <> Your deposit of {money(terms.deposit_cents)} pays for {terms.extra_charge_cents > 0 ? `part of it; ${money(terms.extra_charge_cents)} more goes on your card` : 'it'}{terms.deposit_back_cents > 0 ? `, and ${money(terms.deposit_back_cents)} comes back` : ''}.</>}</p>
      ) : (
        <p>{terms.terms.reason === 'advisory' ? 'An advisory covers that day, so cancelling is free.' : terms.terms.reason === 'change_of_mind' ? 'You booked a few minutes ago, so cancelling is free.' : 'Cancelling is free at this point.'}
          {terms.deposit_cents > 0 && <> Your deposit of {money(terms.deposit_cents)} goes back to your card.</>}</p>
      ))}
      {!booked && !assigned && <p>No driver has been assigned yet, so there's no charge.</p>}
      {assigned && !likelyFee && <p>Your driver is on the way. You can cancel free within 2 minutes of them accepting.</p>}
      {likelyFee && <p className="callout callout--earth">A cancellation fee of <strong>{money(fee ?? 600)}</strong> applies because your driver {trip.status === 'arrived' ? 'is already waiting for you' : 'has been driving to you for more than 2 minutes'}. Most of it goes to the driver.</p>}
      {err && <p className="dg-error">{err}</p>}
      <button className="dg-btn dg-btn--danger dg-btn--block" disabled={busy} onClick={go}>{busy ? 'Cancelling…' : likelyFee ? `Cancel and pay ${money(fee ?? 600)}` : bookedFee ? `Cancel and pay ${money(bookedFee)}` : 'Cancel trip'}</button>
      <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 10 }} onClick={onClose}>Keep my trip</button>
    </Dialog>
  );
}

function TripDetail({ trip, reload, net }: { trip: any; reload: () => Promise<void>; net: ReactNode }) {
  const labels = trip.kind === 'courier' ? COURIER_STATUS_LABEL : STATUS_LABEL;
  const [cancelOpen, setCancelOpen] = useState(false);
  const done = trip.status === 'completed';
  const markers: MapMarker[] = [
    { id: 'p', kind: 'pickup', lat: trip.pickup_lat, lng: trip.pickup_lng },
    ...(trip.service !== 'tour' ? [{ id: 'd', kind: 'dropoff' as const, lat: trip.dropoff_lat, lng: trip.dropoff_lng }] : []),
  ];
  return (
    <div className="page detail">
      <header className="page__head">
        <Link to="/trips" className="iconbtn" aria-label="Back to trips"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 5l-7 7 7 7" /></svg></Link>
        <h1>{done ? (trip.kind === 'courier' ? 'Delivered' : 'Thanks for riding') : labels[trip.status]}</h1>
      </header>
      {net}
      <div className="detail__map"><DgMap markers={markers} route={trip.service !== 'tour' ? [{ lat: trip.pickup_lat, lng: trip.pickup_lng }, { lat: trip.dropoff_lat, lng: trip.dropoff_lng }] : null} padding={30} /></div>
      <p className="dg-muted" style={{ margin: '.8rem 0 0' }}>{trip.ref}, {dateTime(trip.scheduled_for ?? trip.requested_at)} <span className={`dg-chip dg-chip--${statusTone(trip.status)}`}>{labels[trip.status]}</span></p>
      <dl className="kv">
        <div><dt>From</dt><dd>{trip.pickup_address}</dd></div>
        {trip.service !== 'tour' && <div><dt>To</dt><dd>{trip.dropoff_address}</dd></div>}
        {trip.driver && <div><dt>Driver</dt><dd>{trip.driver.name}{trip.vehicle ? `, ${trip.vehicle.rego}` : ''} {trip.vehicle && <FuelChip v={trip.vehicle} />}</dd></div>}
        {trip.parcel?.pod_received_by && <div><dt>{trip.parcel.outcome === 'returned' ? 'Taken back by' : 'Received by'}</dt><dd>{trip.parcel.pod_received_by}, {time(trip.parcel.returned_at ?? trip.parcel.delivered_at)}</dd></div>}
        {trip.parcel?.customer_ref && <div><dt>Your reference</dt><dd>{trip.parcel.customer_ref}</dd></div>}
        {trip.parcel?.safe_place && <div><dt>Safe place</dt><dd>{trip.parcel.safe_place}</dd></div>}
        {trip.parcel?.outcome && <div><dt>Outcome</dt><dd>{PARCEL_OUTCOME_LABEL[trip.parcel.outcome] ?? trip.parcel.outcome}{trip.parcel.failed_reason ? `: ${failLabel(trip.parcel.failed_reason)}` : ''}</dd></div>}
        {trip.batch && <div><dt>Run</dt><dd>{trip.batch.ref}, drop {trip.batch_seq} of {trip.batch.stops.length}</dd></div>}
        <div><dt>{done ? 'Paid' : 'Price'}</dt><dd className="dg-money">{money(trip.final_cents ?? trip.quote_cents)} <span className="dg-muted">({payLabel(trip.payment_method)})</span></dd></div>
        {trip.cancel_fee_cents > 0 && <div><dt>Cancellation fee</dt><dd className="dg-money">{money(trip.cancel_fee_cents)}</dd></div>}
      </dl>

      {trip.status === 'scheduled' && (
        <>
          <div className="callout callout--green">We'll start finding your driver 15 minutes before {time(trip.scheduled_for)} on {date(trip.scheduled_for)}, keep looking until your pickup time, and send you a notification.</div>
          <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 12 }} onClick={() => setCancelOpen(true)}>Cancel booking</button>
          <CancelDialog open={cancelOpen} onClose={() => setCancelOpen(false)} trip={trip} onDone={reload} />
        </>
      )}
      {trip.status === 'no_drivers' && <div className="callout callout--earth">No car was free for this trip, so you haven't been charged. Try again in a few minutes, or call us to book ahead.</div>}
      {trip.status === 'cancelled_driver' && <div className="callout callout--earth">Your driver had to cancel, so you haven't been charged. Book again and we'll find you another car.</div>}
      {done && trip.parcel?.outcome === 'returned' && <Reattempt trip={trip} />}
      {done && trip.parcel?.outcome !== 'returned' && <AfterTrip trip={trip} reload={reload} />}
      {(done || trip.cancel_fee_cents > 0) && <Receipt tripId={trip.id} vehicle={trip.vehicle} />}
      <Link className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 16 }} to={`/account/help?trip=${trip.id}`}>Get help with this trip</Link>
      {trip.driver && <Link className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 8 }} to={`/account/safety/report?trip=${trip.id}`}><Icon name="shield" size={18} /> Report a safety problem</Link>}
      {trip.kind === 'ride' && (trip.assistance_animal || trip.status === 'cancelled_driver') && (
        <Link className="linkbtn" style={{ display: 'inline-flex', alignItems: 'center' }} to={`/account/help?trip=${trip.id}&category=assistance_animal_refused`}>
          A driver refused my assistance animal
        </Link>
      )}
    </div>
  );
}

const failLabel = (k: string) => (DELIVERY_FAIL_REASONS.find(([key]) => key === k)?.[1] ?? 'could not be delivered').toLowerCase();

/** A parcel that came back: book another try (same parcel and addresses, normal fare), optionally allowing a safe place. */
function Reattempt({ trip }: { trip: any }) {
  const nav = useNavigate();
  const [leave, setLeave] = useState(!!trip.parcel.leave_unattended);
  const [place, setPlace] = useState(trip.parcel.safe_place ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function go() {
    setBusy(true); setErr(null);
    try {
      const r = await post(`/trips/${trip.id}/reattempt`, { leave_unattended: leave, safe_place: leave ? place.trim() || undefined : undefined });
      nav(`/trip/${r.trip.id}`);
    } catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not book. Try again.'); } finally { setBusy(false); }
  }
  return (
    <section className="block" aria-labelledby="re-h" style={{ marginTop: 12 }}>
      <h2 id="re-h">Send it again</h2>
      <p className="dg-muted">Same parcel and address. The recipient gets a new PIN. Priced as a normal delivery.</p>
      {!trip.parcel.requires_signature && (
        <label className="dg-check"><input type="checkbox" checked={leave} onChange={(e) => setLeave(e.target.checked)} /><span>OK to leave it if nobody's home</span></label>
      )}
      {leave && <label className="dg-field"><span>Where to leave it</span><input className="dg-input" value={place} maxLength={120} onChange={(e) => setPlace(e.target.value)} /></label>}
      {err && <p className="dg-error" role="alert">{err}</p>}
      <button className="dg-btn dg-btn--block" disabled={busy} onClick={go}>{busy ? 'Booking…' : 'Book another try'}</button>
    </section>
  );
}

function AfterTrip({ trip, reload }: { trip: any; reload: () => Promise<void> }) {
  const [rating, setRating] = useState(trip.rider_rating ?? 0);
  const [feedback, setFeedback] = useState('');
  const [rated, setRated] = useState(!!trip.rider_rating);
  const [tipBusy, setTipBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function rate() {
    setErr(null);
    try { await post(`/trips/${trip.id}/rate`, { rating, feedback: feedback || undefined }); setRated(true); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not save rating'); }
  }
  async function tip(cents: number) {
    setTipBusy(true); setErr(null);
    try { await post(`/trips/${trip.id}/tip`, { cents }); await reload(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Could not add tip'); }
    finally { setTipBusy(false); }
  }
  const first = trip.driver?.name?.split(' ')[0] ?? 'your driver';

  return (
    <section className="after">
      {!rated ? (
        <>
          <h2>How was your trip with {first}?</h2>
          <Stars value={rating} onChange={setRating} />
          {rating > 0 && (
            <>
              <label className="dg-field" style={{ marginTop: '.8rem' }}><span>{rating >= 4 ? 'Anything you liked?' : 'What could be better?'} (optional)</span>
                <textarea className="dg-textarea" value={feedback} onChange={(e) => setFeedback(e.target.value)} maxLength={500} /></label>
              <button className="dg-btn dg-btn--dark" onClick={rate}>Send rating</button>
            </>
          )}
        </>
      ) : <p className="callout callout--green">Thanks for rating {first}.</p>}
      {trip.kind === 'ride' && trip.driver && (
        trip.tip_cents > 0 ? <p className="dg-muted">You tipped {money(trip.tip_cents)}. All of it goes to {first}.</p> : (
          <div className="tips">
            <h3>Add a tip for {first}</h3>
            <p className="dg-muted" style={{ marginTop: 0, fontSize: 'var(--fs-sm)' }}>100% goes to the driver.</p>
            <div className="tips__row">
              {[200, 500, 1000].map((c) => <button key={c} className="dg-btn dg-btn--ghost" disabled={tipBusy} onClick={() => tip(c)}>{money(c)}</button>)}
            </div>
          </div>
        )
      )}
      {err && <p className="dg-error">{err}</p>}
    </section>
  );
}

export function Receipt({ tripId, vehicle }: { tripId: string; vehicle?: any }) {
  const [r, setR] = useState<any | null>(null);
  const load = () => get(`/trips/${tripId}/receipt`).then((x) => setR(x.receipt)).catch(() => {});
  useEffect(() => { void load(); }, [tripId]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!r) return null;
  // Receipt `vehicle` is the rego today; tolerate an object if the API starts sending one.
  const rv = r.vehicle && typeof r.vehicle === 'object' ? r.vehicle : null;
  const car = vehicle ?? rv;
  const rego = rv ? rv.rego : r.vehicle;
  const refunds: any[] = r.refunds ?? [];
  return (
    <>
    {r.payment_status === 'failed' && <PayNow tripId={tripId} cents={r.fare_cents} onPaid={load} />}
    <details className="receipt">
      <summary>{r.title ? r.title.replace('Tax Invoice', 'Tax invoice') : 'Tax invoice'}</summary>
      <div className="receipt__body">
        <p><strong>{r.supplier?.name ?? 'DingoGo'}</strong><br />ABN {r.supplier_abn ?? r.supplier?.abn ?? 'TBC'}<br />{r.supplier?.address}</p>
        {r.supplied_by && <p className="dg-muted">Issued by DingoGo on behalf of your driver {r.supplied_by.name}{r.supplied_by.abn ? `, ABN ${r.supplied_by.abn}` : ''}.</p>}
        <p className="dg-muted">Invoice {r.invoice_number ?? r.trip_ref}, {dateTime(r.date)}<br />{r.from}{r.to && r.to !== r.from ? ` to ${r.to}` : ''}<br />{r.driver ? `Driver ${r.driver}, ${rego ?? ''}` : ''} {r.driver && car && <FuelChip v={car} />}
          {r.customer?.ndis_number && <><br />NDIS participant {r.customer.name ? `${r.customer.name}, ` : ''}number {r.customer.ndis_number}</>}</p>
        <table className="quote__lines">
          <tbody>
            {r.lines.map((l: any, i: number) => <tr key={i}><td>{l.label}</td><td className="dg-money">{money(l.cents)}</td></tr>)}
            {r.tip_cents > 0 && <tr><td>Tip, all to your driver (no GST)</td><td className="dg-money">{money(r.tip_cents)}</td></tr>}
            <tr className="quote__sum"><td>{r.payment_status === 'failed' ? 'Total to pay' : `Total paid (${payLabel(r.payment_method)})`}</td><td className="dg-money">{money(r.total_cents)}</td></tr>
            {refunds.map((x, i) => <tr key={`r${i}`}><td>Refund {date(x.at)}</td><td className="dg-money">−{money(x.cents)}</td></tr>)}
            {refunds.length > 0 && <tr className="quote__sum"><td>Total after refunds</td><td className="dg-money">{money(r.net_total_cents)}</td></tr>}
            <tr><td>Includes GST</td><td className="dg-money">{money(r.net_gst_cents ?? r.gst_cents)}</td></tr>
          </tbody>
        </table>
        {/* CO₂ only for trips actually done in an electric car, and only when the API sent a figure. */}
        {isEv(car) && Number(r.co2_saved_kg) > 0 && (
          <p className="co2"><Icon name="leaf" size={18} style={{ color: 'var(--saltbush)' }} /> {km(r.distance_km * 1000)} in an electric car. About {r.co2_saved_kg} kg of CO₂ not burned compared with a petrol car.</p>
        )}
        <button className="dg-btn dg-btn--ghost dg-btn--sm" onClick={() => window.print()}>Print or save as PDF</button>
      </div>
      <Ranges height={18} fill="var(--line)" />
    </details>
    </>
  );
}

/** A card payment that didn't go through: pay it now with the default card (add or change cards in Account → Payment). */
function PayNow({ tripId, cents, onPaid }: { tripId: string; cents: number; onPaid: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const pay = async () => {
    setBusy(true); setErr(null);
    try { await post(`/trips/${tripId}/pay`, {}); setMsg('Paid. Thank you.'); onPaid(); }
    catch (e) { setErr(e instanceof ApiError ? e.message : 'Something went wrong. Try again.'); }
    finally { setBusy(false); }
  };
  if (msg) return <p className="callout callout--green" role="status">{msg}</p>;
  return (
    <div className="callout callout--earth" role="region" aria-label="Payment needed">
      <p><strong>Your payment of {money(cents)} didn't go through.</strong> Pay now with your default card, or change cards in <Link to="/account/payment">Account → Payment</Link> first.</p>
      {err && <p className="dg-error" role="alert">{err}</p>}
      <button className="dg-btn dg-btn--dark dg-btn--sm" aria-disabled={busy} onClick={() => { if (!busy) void pay(); }}>{busy ? 'Paying…' : `Pay ${money(cents)} now`}</button>
    </div>
  );
}
