import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError } from './api';

/** Load data with loading/error state and a reload function. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const fnRef = useRef(fn); fnRef.current = fn;
  const reload = useCallback(async () => {
    setLoading(true);
    try { setData(await fnRef.current()); setError(null); }
    catch (e) { setError(e instanceof ApiError ? e.message : String(e)); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void reload(); }, deps); // eslint-disable-line
  return { data, error, loading, reload, setData };
}

/** Wrap an async action with busy/error state. */
export function useAction<A extends unknown[], R>(fn: (...a: A) => Promise<R>) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = useCallback(async (...a: A): Promise<R | undefined> => {
    setBusy(true); setError(null);
    try { return await fn(...a); }
    catch (e) { setError(e instanceof ApiError ? e.message : String(e)); return undefined; }
    finally { setBusy(false); }
  }, [fn]);
  return { run, busy, error, setError };
}

export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn); ref.current = fn;
  useEffect(() => { if (ms == null) return; const t = setInterval(() => ref.current(), ms); return () => clearInterval(t); }, [ms]);
}

/** Browser/Capacitor geolocation watch. Falls back to null when denied. */
export function useGeolocation(enabled = true) {
  const [pos, setPos] = useState<{ lat: number; lng: number; heading: number | null; speed: number | null } | null>(null);
  const [denied, setDenied] = useState(false);
  useEffect(() => {
    if (!enabled || typeof navigator === 'undefined' || !navigator.geolocation) return;
    const id = navigator.geolocation.watchPosition(
      (p) => setPos({ lat: p.coords.latitude, lng: p.coords.longitude, heading: p.coords.heading, speed: p.coords.speed }),
      () => setDenied(true), { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 });
    return () => navigator.geolocation.clearWatch(id);
  }, [enabled]);
  return { pos, denied };
}
