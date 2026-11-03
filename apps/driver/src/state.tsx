import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ApiError, connectRealtime, get, post, useGeolocation } from '@dingogo/shared';

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

interface Ctx {
  me: any | null; reloadMe: () => Promise<void>;
  online: boolean; setOnline: (v: boolean) => void;
  battery: number; setBattery: (v: number) => void;
  pos: Pos | null; simulated: Pos | null; setSimulated: (p: Pos | null) => void; geoDenied: boolean;
  offer: any | null; clearOffer: () => void;
  trip: any | null; reloadTrip: () => Promise<void>; setTrip: (t: any) => void;
  toast: string | null; showToast: (s: string) => void;
}
const C = createContext<Ctx>(null as any);
export const useDriver = () => useContext(C);

const LS = (k: string) => { try { return localStorage.getItem('dingogo.driver.' + k); } catch { return null; } };
const LSset = (k: string, v: string | null) => { try { v == null ? localStorage.removeItem('dingogo.driver.' + k) : localStorage.setItem('dingogo.driver.' + k, v); } catch { /* ignore */ } };

export function DriverProvider({ children }: { children: React.ReactNode }) {
  const [me, setMe] = useState<any>(null);
  const [online, setOnlineState] = useState(false);
  const [battery, setBatteryState] = useState<number>(Number(LS('battery') ?? 80));
  const [simulated, setSimState] = useState<Pos | null>(() => { const s = LS('simpos'); return s ? JSON.parse(s) : null; });
  const [offer, setOffer] = useState<any>(null);
  const [trip, setTrip] = useState<any>(null);
  const [toast, setToast] = useState<string | null>(null);
  const geo = useGeolocation(true);
  const pos: Pos | null = simulated ?? (geo.pos ? { lat: geo.pos.lat, lng: geo.pos.lng, heading: geo.pos.heading } : null);
  const posRef = useRef(pos); posRef.current = pos;
  const batteryRef = useRef(battery); batteryRef.current = battery;

  const showToast = useCallback((s: string) => { setToast(s); setTimeout(() => setToast((t) => (t === s ? null : t)), 4000); }, []);
  const setBattery = (v: number) => { setBatteryState(v); LSset('battery', String(v)); };
  const setSimulated = (p: Pos | null) => { setSimState(p); LSset('simpos', p ? JSON.stringify(p) : null); };

  const reloadMe = useCallback(async () => {
    const r = await get('/driver/me');
    setMe(r);
    setOnlineState(!!r.driver?.online);
    if (r.driver?.vehicle?.battery_pct != null && LS('battery') == null) setBatteryState(r.driver.vehicle.battery_pct);
  }, []);
  const reloadTrip = useCallback(async () => {
    try { const r = await get('/driver/trips/active'); setTrip((cur: any) => (r.trip ? r.trip : cur && ['completed', 'cancelled_rider', 'cancelled_admin', 'cancelled_driver'].includes(cur.status) ? cur : null)); }
    catch { /* offline — keep last known */ }
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

  // Fallback polling for offers (weak signal / socket drops)
  useEffect(() => {
    if (!online || trip) return;
    const t = setInterval(async () => {
      try {
        const r = await get('/driver/offers');
        if (r.offers?.length) {
          const o = r.offers[0];
          setOffer((cur: any) => cur?.trip_id === o.trip_id ? cur : {
            trip_id: o.trip_id, ref: o.ref, kind: o.kind, service: o.service,
            pickup: { lat: o.pickup_lat, lng: o.pickup_lng, address: o.pickup_address },
            dropoff: { lat: o.dropoff_lat, lng: o.dropoff_lng, address: o.dropoff_address },
            est_distance_m: o.est_distance_m, est_duration_s: o.est_duration_s, quote_cents: o.quote_cents, pickup_eta_s: o.pickup_eta_s,
            expires_at: o.expires_at, has_pet: o.has_pet, assistance_animal: o.assistance_animal, needs_wheelchair: o.needs_wheelchair,
            passengers: o.passengers, payment_method: o.payment_method, notes: o.notes,
          });
        } else setOffer((cur: any) => (cur && cur.expires_at && new Date(cur.expires_at) < new Date() ? null : cur));
      } catch { /* ignore */ }
    }, 4000);
    return () => clearInterval(t);
  }, [online, trip]);

  // Location heartbeat every 5 s while online or on a trip
  useEffect(() => {
    if (!online && !trip) return;
    const send = async () => {
      const p = posRef.current;
      if (!p) return;
      try { await post('/driver/location', { lat: p.lat, lng: p.lng, heading: p.heading ?? undefined, battery_pct: batteryRef.current }); }
      catch (e) { if (e instanceof ApiError && e.status === 401) location.reload(); }
    };
    void send();
    const t = setInterval(send, 5000);
    return () => clearInterval(t);
  }, [online, !!trip]);

  const setOnline = (v: boolean) => setOnlineState(v);
  const clearOffer = () => setOffer(null);

  return <C.Provider value={{ me, reloadMe, online, setOnline, battery, setBattery, pos, simulated, setSimulated, geoDenied: geo.denied || !geo.pos,
    offer, clearOffer, trip, reloadTrip, setTrip, toast, showToast }}>{children}</C.Provider>;
}

/** What the driver earns from an offer: the trip fare (excludes booking fee & NT levy) less the DingoGo fee (25% by default). */
export function estimateEarnings(o: { quote_cents: number; kind: string; trip_cents?: number | null }, commissionPct = 25) {
  const trip = o.trip_cents ?? (o.kind === 'ride' ? Math.max(0, o.quote_cents - 200) : o.quote_cents);
  return Math.round(trip * (1 - commissionPct / 100));
}

export const rangeKm = (rangeRated: number | undefined, pct: number) => Math.round((rangeRated ?? 427) * (pct / 100) * 0.7);
