import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ApiError, connectRealtime, get, onNetworkChange, post, useGeolocation, useOnline, usePoll } from '@dingogo/shared';
import { flushGps, flushTaps, isNoSignal, onOutboxChange, pendingGps, pendingTaps, queueGps, sendTap, tapsFor, type Step } from './lib/outbox';
import { applyTheme, resolvedTheme, usePrefs } from './lib/prefs';
import { hasPlug, minYearFallback } from './vehicle';
import { findJ, jurisdictionList, type Jurisdiction } from './rules';

export const PLACES = [
  { name: 'Todd Mall', lat: -23.6984, lng: 133.8822 },
  { name: 'Alice Springs Hospital', lat: -23.7076, lng: 133.8770 },
  { name: 'Alice Springs Airport', lat: -23.8067, lng: 133.9022 },
  { name: 'Yeperenye Shopping Centre', lat: -23.7008, lng: 133.8818 },
  { name: 'Braitling', lat: -23.6830, lng: 133.8680 },
  { name: 'Larapinta', lat: -23.6950, lng: 133.8350 },
  { name: 'Eastside', lat: -23.6950, lng: 133.8960 },
  { name: 'Gillen', lat: -23.7090, lng: 133.8600 },
];

export type Pos = { lat: number; lng: number; heading: number | null };
/** Straight-line metres between two points (small distances; good enough to tell "the car moved"). */
export function metresBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const k = 111_320, dy = (a.lat - b.lat) * k, dx = (a.lng - b.lng) * k * Math.cos((a.lat * Math.PI) / 180);
  return Math.hypot(dx, dy);
}
/** GET /driver/vehicles: the driver's own cars (plus their fleet car, if any). */
export type Cars = { vehicles: any[]; current_vehicle_id: string | null; min_year: number; max_age_years: number; jurisdictions?: any[]; rules?: any; state?: string };

interface Ctx {
  me: any | null; reloadMe: () => Promise<void>;
  cars: Cars | null;
  /** NT and SA rules (from the API, over built-in defaults) and the driver's own state. */
  states: Jurisdiction[]; myState: Jurisdiction;
  /** Local pick before the API has saved it (or an older API that ignores it). */
  setStatePick: (code: string) => void;
  online: boolean; setOnline: (v: boolean) => void;
  battery: number; setBattery: (v: number) => void;
  pos: Pos | null; simulated: Pos | null; setSimulated: (p: Pos | null) => void; geoDenied: boolean;
  offer: any | null; clearOffer: () => void;
  trip: any | null; reloadTrip: () => Promise<void>; setTrip: (t: any) => void;
  toast: string | null; showToast: (s: string) => void;
  /** Arrived / start / complete: sent now, or kept on the phone with no signal (the screen moves on, marked "waiting to send"). */
  tripAction: (step: Step, body?: Record<string, unknown>) => Promise<{ trip?: any; queued?: boolean }>;
  /** False while DingoGo can't be reached. */
  connected: boolean;
  /** Trip taps and GPS points kept on the phone, waiting for signal. */
  waiting: { taps: number; gps: number };
}
const C = createContext<Ctx>(null as any);
export const useDriver = () => useContext(C);

const DONE = ['completed', 'cancelled_rider', 'cancelled_admin', 'cancelled_driver', 'no_drivers'];
const LS = (k: string) => { try { return localStorage.getItem('dingogo.driver.' + k); } catch { return null; } };
const LSset = (k: string, v: string | null) => { try { v == null ? localStorage.removeItem('dingogo.driver.' + k) : localStorage.setItem('dingogo.driver.' + k, v); } catch { /* ignore */ } };

export function DriverProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<any>(null);
  const [cars, setCars] = useState<Cars | null>(null);
  const [online, setOnlineState] = useState(false);
  const [battery, setBatteryState] = useState<number>(Number(LS('battery') ?? 80));
  const [simulated, setSimState] = useState<Pos | null>(() => { const s = LS('simpos'); return s ? JSON.parse(s) : null; });
  const [offer, setOffer] = useState<any>(null);
  const [trip, setTrip] = useState<any>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [statePick, setStatePick] = useState<string | null>(null);
  const geo = useGeolocation(true);
  const connected = useOnline();
  const [waiting, setWaiting] = useState({ taps: pendingTaps().length, gps: pendingGps() });
  useEffect(() => onOutboxChange(() => setWaiting({ taps: pendingTaps().length, gps: pendingGps() })), []);
  const [prefs] = usePrefs();
  const pos: Pos | null = simulated ?? (geo.pos ? { lat: geo.pos.lat, lng: geo.pos.lng, heading: geo.pos.heading } : null);
  const posRef = useRef(pos); posRef.current = pos;
  const batteryRef = useRef(battery); batteryRef.current = battery;
  const onlineRef = useRef(online); onlineRef.current = online;
  const plugRef = useRef(false); plugRef.current = hasPlug(me?.driver?.vehicle);

  const showToast = useCallback((s: string) => { setToast(s); setTimeout(() => setToast((t) => (t === s ? null : t)), 4000); }, []);
  const setBattery = (v: number) => { setBatteryState(v); LSset('battery', String(v)); };
  const setSimulated = (p: Pos | null) => { setSimState(p); LSset('simpos', p ? JSON.stringify(p) : null); };

  const reloadMe = useCallback(async () => {
    const [r, c] = await Promise.all([get('/driver/me'), get<Cars>('/driver/vehicles').catch(() => null)]);
    setMe(r);
    const v = r.driver?.vehicle;
    // Fall back to the assigned car if the vehicles list is unavailable.
    setCars(c ?? { vehicles: v ? [v] : [], current_vehicle_id: v?.id ?? null, min_year: minYearFallback(), max_age_years: 13 });
    setOnlineState(!!r.driver?.online);
    if (v?.battery_pct != null && LS('battery') == null) setBatteryState(v.battery_pct);
  }, []);
  const tripRef = useRef<any>(null); tripRef.current = trip;
  const reloadTrip = useCallback(async () => {
    try {
      const r = await get('/driver/trips/active');
      if (r.trip && tapsFor(r.trip.id).length) return;
      if (r.trip) return setTrip(r.trip);
      const cur = tripRef.current;
      // Taps for this trip are still waiting to send: the phone's version is ahead of DingoGo's, keep it.
      if (cur && tapsFor(cur.id).length) return;
      // The trip we were on is no longer live: show how it ended instead of silently dropping it.
      if (cur && !cur.released && ['accepted', 'arrived', 'in_progress'].includes(cur.status)) {
        try { const t = await get(`/trips/${cur.id}`); return setTrip(t.trip); }
        catch (e) {
          // No longer ours to view: DingoGo gave it to another driver (e.g. lost signal).
          if (e instanceof ApiError && (e.status === 404 || e.status === 403)) return setTrip({ id: cur.id, ref: cur.ref, kind: cur.kind, status: 'requested', released: true, released_by: 'ops' });
          return; // offline: keep last known
        }
      }
      setTrip((c: any) => (c && (c.released || DONE.includes(c.status)) ? c : null));
    } catch { /* offline — keep last known */ }
  }, []);

  useEffect(() => { void reloadMe(); void reloadTrip(); }, [reloadMe, reloadTrip]);

  // Realtime: offers + trip updates on the personal channel
  useEffect(() => {
    const rt = connectRealtime((m) => {
      if (m.type === 'offer.new') setOffer(m.data);
      if (m.type === 'offer.expired') setOffer((o: any) => (o && o.trip_id === m.data.trip_id ? null : o));
      if (m.type === 'trip.updated') {
        void reloadTrip();
        if (m.data.status === 'cancelled_rider' || m.data.status === 'cancelled_admin') showToast(`Trip ${m.data.ref} was cancelled`);
      }
      if (m.type === 'notification' && m.data?.title) showToast(m.data.title);
    });
    return () => rt.close();
  }, [reloadTrip, showToast]);

  // Fallback polling for offers (weak signal / socket drops). Every 4 s in view (an offer lasts 20 s); every 8 s while the app
  // is behind Google Maps or the screen is off (Round 18: phones throttle background timers anyway).
  usePoll(async () => {
      try {
        const r = await get('/driver/offers');
        if (r.offers?.length) {
          const o = r.offers[0];
          setOffer((cur: any) => cur?.trip_id === o.trip_id ? cur : {
            trip_id: o.trip_id, ref: o.ref, kind: o.kind, service: o.service,
            pickup: { lat: o.pickup_lat, lng: o.pickup_lng, address: o.pickup_address },
            dropoff: { lat: o.dropoff_lat, lng: o.dropoff_lng, address: o.dropoff_address },
            est_distance_m: o.est_distance_m, est_duration_s: o.est_duration_s, quote_cents: o.quote_cents, pickup_eta_s: o.pickup_eta_s,
            trip_cents: o.trip_cents, driver_pay: o.driver_pay, pickup_m: o.pickup_m, total_m: o.total_m,
            expires_at: o.expires_at, has_pet: o.has_pet, assistance_animal: o.assistance_animal, needs_wheelchair: o.needs_wheelchair,
            passengers: o.passengers, payment_method: o.payment_method, notes: o.notes, rider_needs: o.rider_needs ?? null,
          });
        } else setOffer((cur: any) => (cur && cur.expires_at && new Date(cur.expires_at) < new Date() ? null : cur));
      } catch { /* ignore */ }
  }, online && !trip ? 4000 : null, { hiddenMs: 8000 });

  // Location heartbeat: every 5 s on a trip (the rider watches the car); online and waiting, every 15 s and only when the car has
  // moved 30 m or a minute has passed (dispatch needs a fresh position, not a stream of identical ones — Round 18). With no signal
  // the points are kept and sent together later, so the trip's GPS track has no gap.
  const lastSent = useRef<{ lat: number; lng: number; at: number } | null>(null);
  useEffect(() => {
    if (!online && !trip) return;
    const onTrip = !!trip;
    const send = async () => {
      const p = posRef.current;
      if (!p) return;
      const prev = lastSent.current;
      if (!onTrip && prev && Date.now() - prev.at < 60_000 && metresBetween(prev, p) < 30 && !pendingGps()) return;
      const battery_pct = plugRef.current ? batteryRef.current : undefined;
      try {
        if (pendingGps()) await flushGps(battery_pct).catch((e) => { if (isNoSignal(e)) throw e; });
        const r = await post('/driver/location', { lat: p.lat, lng: p.lng, heading: p.heading ?? undefined, battery_pct }, { timeoutMs: 10000 });
        lastSent.current = { lat: p.lat, lng: p.lng, at: Date.now() };
        // DingoGo sets drivers offline after a long time without signal: keep the switch honest.
        if (r?.online === false && onlineRef.current) { setOnlineState(false); showToast('You are offline. Go online again when you are ready.'); }
      }
      catch (e) {
        if (e instanceof ApiError && e.status === 401) location.reload();
        else if (isNoSignal(e) && tripRef.current) queueGps({ lat: p.lat, lng: p.lng, heading: p.heading, at: new Date().toISOString() });
      }
    };
    void send();
    const t = setInterval(send, onTrip ? 5000 : 15000);
    return () => clearInterval(t);
  }, [online, !!trip]);

  // Send kept taps as soon as signal returns (and every 10 s while any are waiting, as phones don't always say).
  const flushAll = useCallback(async () => {
    if (!pendingTaps().length) return;
    const r = await flushTaps();
    const cur = tripRef.current;
    if (r.refused) {
      const e = r.refused.error;
      const what = { arrive: 'arrived', start: 'start the trip', complete: 'trip complete' }[r.refused.tap.step];
      showToast(e.code === 'pin_mismatch' && r.refused.tap.step === 'start' ? 'The PIN you entered didn’t match. Ask the passenger again.' : `Your “${what}” tap couldn’t be saved: ${e.message}`);
      void reloadTrip();
    } else if (r.trip && cur?.id === r.trip.id) { setTrip(r.trip); }
    if (r.sent && !r.refused && !pendingTaps().length) showToast('Back online. Your trip updates are saved.');
  }, [reloadTrip, showToast]);
  useEffect(() => {
    const off = onNetworkChange((on) => { if (on) void flushAll(); });
    const t = setInterval(() => { if (pendingTaps().length) void flushAll(); }, 10000);
    void flushAll();
    return () => { off(); clearInterval(t); };
  }, [flushAll]);

  const tripAction = useCallback(async (step: Step, body: Record<string, unknown> = {}) => {
    const cur = tripRef.current;
    if (!cur) return {};
    const r = await sendTap(cur.id, step, body);
    if (r.trip) setTrip(r.trip);
    else if (r.queued) {
      // Move the screen on now; it says the update is waiting to send.
      const now = new Date().toISOString();
      const next = step === 'arrive' ? { status: 'arrived', arrived_at: now }
        : step === 'start' ? { status: 'in_progress', started_at: now }
        : { status: 'completed', completed_at: now, final_cents: cur.quote_cents };
      setTrip({ ...cur, ...next, pending_sync: true });
    }
    return r;
  }, []);

  // Keep the screen on while online or on a trip (the phone sits in a cradle). Released when offline or set off in Profile.
  useEffect(() => {
    const nav = navigator as any;
    if (!prefs.awake || (!online && !trip) || !nav.wakeLock) return;
    let lock: any = null; let gone = false;
    const take = async () => { try { if (document.visibilityState === 'visible') lock = await nav.wakeLock.request('screen'); } catch { /* battery saver or not allowed */ } };
    const vis = () => { if (!gone && document.visibilityState === 'visible') void take(); };
    void take();
    document.addEventListener('visibilitychange', vis);
    return () => { gone = true; document.removeEventListener('visibilitychange', vis); lock?.release?.().catch?.(() => undefined); };
  }, [prefs.awake, online, !!trip]);

  // Theme: phone setting, day, night, or night from sunset to sunrise where the driver is (checked every minute).
  useEffect(() => {
    const set = () => applyTheme(resolvedTheme(prefs.theme, new Date(), posRef.current));
    set();
    if (prefs.theme !== 'sun') return;
    const t = setInterval(set, 60000);
    return () => clearInterval(t);
  }, [prefs.theme]);

  const setOnline = (v: boolean) => setOnlineState(v);
  const rawStates = cars?.jurisdictions ?? me?.jurisdictions ?? [];
  const states = jurisdictionList(cars?.rules?.code ? [...rawStates.filter((j: any) => j?.code !== cars.rules.code), cars.rules] : rawStates);
  const myState = findJ(states, me?.driver?.state ?? cars?.state ?? statePick ?? 'NT');
  const clearOffer = () => setOffer(null);

  return <C.Provider value={{ me, reloadMe, cars, states, myState, setStatePick, online, setOnline, battery, setBattery, pos, simulated, setSimulated, geoDenied: geo.denied || !geo.pos,
    offer, clearOffer, trip, reloadTrip, setTrip, toast, showToast, tripAction, connected, waiting }}>{children}</C.Provider>;
}

/** What the driver earns from an offer. The API sends `driver_pay` (fare less the DingoGo fee for this car, plus pickup pay and
 *  fuel surcharge); older servers only send the trip fare (excludes booking fee & levy), so fall back to fare less the fee. */
export function estimateEarnings(o: { quote_cents: number; kind: string; trip_cents?: number | null; driver_pay?: { total_cents: number } | null }, commissionPct = 25) {
  if (o.driver_pay?.total_cents != null) return o.driver_pay.total_cents;
  const trip = o.trip_cents ?? (o.kind === 'ride' ? Math.max(0, o.quote_cents - 200) : o.quote_cents);
  return Math.round(trip * (1 - commissionPct / 100));
}

export const FEE_BASIS: Record<string, string> = { green: 'electric/hybrid rate', own_car: 'own-car rate', driver: 'your rate' };

export const rangeKm = (rangeRated: number | undefined, pct: number) => Math.round((rangeRated ?? 427) * (pct / 100) * 0.7);

/** The rider's accessibility needs (from their profile) as [icon, plain words] for the offer and trip screens. */
export function needFlags(n?: { hearing?: boolean; vision?: boolean; mobility?: boolean; notes?: string | null } | null): [string, string][] {
  if (!n) return [];
  const out: [string, string][] = [];
  if (n.hearing) out.push(['chat', 'Deaf or hard of hearing: send a message, don’t call']);
  if (n.vision) out.push(['user', 'Blind or low vision: come to the door and say who you are']);
  if (n.mobility) out.push(['access', 'Uses a mobility aid: may need help and boot space']);
  if (n.notes) out.push(['info', `Rider’s note: “${n.notes}”`]);
  return out;
}
