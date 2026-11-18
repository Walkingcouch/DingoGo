import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { ApiError, isOnline, onNetworkChange } from './api';

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

/** True while the app can reach DingoGo (see onNetworkChange in api.ts). */
export function useOnline() {
  const [on, setOn] = useState(isOnline());
  useEffect(() => onNetworkChange(setOn), []);
  return on;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal behaviour for a dialog rendered outside #root (in a portal): the app behind is made inert, focus moves into the
 *  dialog (and back in if the button that had it disappears), Tab wraps inside it, Escape calls onClose (if given), and focus
 *  returns to whatever opened it. */
export function useModal(box: RefObject<HTMLElement>, onClose?: () => void) {
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const root = document.getElementById('root');
    root?.setAttribute('inert', ''); root?.setAttribute('aria-hidden', 'true');
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && closeRef.current) { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const els = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!els.length) { e.preventDefault(); box.current.focus(); return; }
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('keydown', k);
      // Another modal may still be open (e.g. a sheet over the offer): only release the app when none is left.
      if (!document.querySelector('[data-modal-open]')) { root?.removeAttribute('inert'); root?.removeAttribute('aria-hidden'); }
      if (opener && document.contains(opener)) opener.focus();
    };
  }, []); // eslint-disable-line
  useEffect(() => {
    if (!box.current || box.current.contains(document.activeElement)) return;
    (box.current.querySelector<HTMLElement>('[autofocus], [data-autofocus]') ?? box.current.querySelector<HTMLElement>(FOCUSABLE) ?? box.current).focus();
  });
}
