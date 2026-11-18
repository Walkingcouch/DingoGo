/** Poor-signal resilience for the driver app. Trip taps (arrived, start, complete) and GPS points that can't be sent are kept
 *  on the phone and sent, in order, when signal returns. Each tap carries an Idempotency-Key so a tap that did get through
 *  (but whose reply was lost) is not applied twice, and `client_at` so the trip records when the driver actually tapped. */
import { ApiError, isTemporary, post } from '@dingogo/shared';

export type Step = 'arrive' | 'start' | 'complete';
export interface QueuedTap { key: string; trip_id: string; step: Step; body: Record<string, unknown>; client_at: string }
export interface GpsPoint { lat: number; lng: number; heading?: number | null; at: string }

const TAPS = 'dingogo.driver.outbox';
const GPS = 'dingogo.driver.gps';
/** One point every 5 s: an hour of driving without signal. Oldest points are dropped first. */
export const GPS_MAX = 720;

const read = <T,>(k: string): T[] => { try { const v = JSON.parse(localStorage.getItem(k) ?? '[]'); return Array.isArray(v) ? v : []; } catch { return []; } };
const write = (k: string, v: unknown[]) => { try { v.length ? localStorage.setItem(k, JSON.stringify(v)) : localStorage.removeItem(k); } catch { /* storage full or blocked */ } };

let taps: QueuedTap[] = read<QueuedTap>(TAPS);
let gps: GpsPoint[] = read<GpsPoint>(GPS);
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((f) => f());
export const onOutboxChange = (f: () => void) => { listeners.add(f); return () => { listeners.delete(f); }; };
export const pendingTaps = () => taps;
export const pendingGps = () => gps.length;
export const tapsFor = (tripId: string) => taps.filter((t) => t.trip_id === tripId);

export const newKey = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`);

/** No signal (or the connection dropped mid-request), or DingoGo's database briefly down (503: nothing was saved): worth keeping and
 *  sending again with the same Idempotency-Key. Anything else is a real answer. */
export const isNoSignal = (e: unknown) => !(e instanceof ApiError) || e.code === 'offline' || e.status === 0 || isTemporary(e);

const send = (t: QueuedTap) => post(`/driver/trips/${t.trip_id}/${t.step}`, { ...t.body, client_at: t.client_at }, { headers: { 'Idempotency-Key': t.key }, timeoutMs: 15000 });

/** Send a trip tap now. With no signal it is queued and `{ queued: true }` comes back; a refusal (wrong PIN, trip cancelled)
 *  is thrown as usual. */
export async function sendTap(trip_id: string, step: Step, body: Record<string, unknown> = {}): Promise<{ trip?: any; queued?: boolean }> {
  const tap: QueuedTap = { key: newKey(), trip_id, step, body, client_at: new Date().toISOString() };
  // Taps must reach DingoGo in order: if earlier ones are waiting, this one waits behind them.
  if (taps.length) { taps = [...taps, tap]; write(TAPS, taps); changed(); void flushTaps(); return { queued: true }; }
  try { return await send(tap); }
  catch (e) {
    if (!isNoSignal(e)) throw e;
    taps = [...taps, tap]; write(TAPS, taps); changed();
    return { queued: true };
  }
}

export interface FlushResult { sent: number; trip?: any; refused?: { tap: QueuedTap; error: ApiError } }
let flushing: Promise<FlushResult> | null = null;
/** Send waiting taps in order. Stops at the first no-signal failure (try later). A refused tap is dropped together with the
 *  later taps for the same trip (they depended on it), and reported so the app can tell the driver and reload the trip. */
export function flushTaps(): Promise<FlushResult> {
  if (flushing) return flushing;
  flushing = (async () => {
    const out: FlushResult = { sent: 0 };
    while (taps.length) {
      const t = taps[0];
      try { const r = await send(t); out.trip = r.trip; out.sent++; taps = taps.slice(1); }
      catch (e) {
        if (isNoSignal(e)) break;
        out.refused = { tap: t, error: e as ApiError };
        taps = taps.filter((x) => x.trip_id !== t.trip_id);
      }
      write(TAPS, taps); changed();
    }
    return out;
  })().finally(() => { flushing = null; });
  return flushing;
}

export function queueGps(p: GpsPoint) {
  gps = [...gps, p].slice(-GPS_MAX); write(GPS, gps); changed();
}
/** Send saved GPS points in one go (the API takes up to 720). Kept if there's still no signal. */
export async function flushGps(battery_pct?: number) {
  if (!gps.length) return null;
  const batch = gps.slice(0, GPS_MAX);
  try {
    const r = await post('/driver/location/batch', { points: batch, battery_pct }, { timeoutMs: 20000 });
    gps = gps.slice(batch.length); write(GPS, gps); changed();
    return r;
  } catch (e) {
    if (!isNoSignal(e)) { gps = gps.slice(batch.length); write(GPS, gps); changed(); } // bad data: don't retry forever
    throw e;
  }
}

/** Sign-out: nothing of this driver's stays on the phone. */
export function clearOutbox() { taps = []; gps = []; write(TAPS, []); write(GPS, []); changed(); }
