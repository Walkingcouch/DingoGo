/** In-car settings kept on the phone: navigation app, theme, screen awake, read-out requests, which hand the Accept button suits. */
import { useEffect, useState } from 'react';

export type NavApp = 'google' | 'waze' | 'apple';
export type Theme = 'auto' | 'sun' | 'light' | 'dark';
export interface Prefs { nav: NavApp; theme: Theme; awake: boolean; speak: boolean; hand: 'right' | 'left' }

const KEY = 'dingogo.driver.prefs';
const isApple = () => typeof navigator !== 'undefined' && /iPhone|iPad|iPod/.test(navigator.userAgent);
export const DEFAULTS: Prefs = { nav: isApple() ? 'apple' : 'google', theme: 'auto', awake: true, speak: false, hand: 'right' };

function load(): Prefs {
  let p: Partial<Prefs> = {};
  try { p = JSON.parse(localStorage.getItem(KEY) ?? '{}') ?? {}; } catch { /* storage unavailable */ }
  // Older app versions kept the theme on its own.
  try { const t = localStorage.getItem('dingogo.driver.theme'); if (t && !p.theme) p.theme = t as Theme; } catch { /* ignore */ }
  return { ...DEFAULTS, ...p };
}

let current = load();
const listeners = new Set<(p: Prefs) => void>();
export const getPrefs = () => current;
export function setPrefs(patch: Partial<Prefs>) {
  current = { ...current, ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(current)); localStorage.removeItem('dingogo.driver.theme'); } catch { /* ignore */ }
  listeners.forEach((f) => f(current));
}
export function usePrefs(): [Prefs, (p: Partial<Prefs>) => void] {
  const [p, set] = useState(current);
  useEffect(() => { listeners.add(set); return () => { listeners.delete(set); }; }, []);
  return [p, setPrefs];
}

/** Sunrise and sunset (local Date objects) for a day and place. NOAA's simple formula: within a few minutes, which is plenty
 *  for switching the screen to the night theme. */
export function sunTimes(when: Date, lat: number, lng: number) {
  const rad = Math.PI / 180;
  // The calendar day at this longitude (solar time), so a morning in Australia isn't read as yesterday in UTC.
  const day = new Date(when.getTime() + (lng / 15) * 3600000);
  const start = Date.UTC(day.getUTCFullYear(), 0, 0);
  const n = Math.floor((Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) - start) / 86400000);
  const g = (2 * Math.PI / 365) * (n - 1);
  const eqt = 229.18 * (0.000075 + 0.001868 * Math.cos(g) - 0.032077 * Math.sin(g) - 0.014615 * Math.cos(2 * g) - 0.040849 * Math.sin(2 * g));
  const decl = 0.006918 - 0.399912 * Math.cos(g) + 0.070257 * Math.sin(g) - 0.006758 * Math.cos(2 * g) + 0.000907 * Math.sin(2 * g) - 0.002697 * Math.cos(3 * g) + 0.00148 * Math.sin(3 * g);
  const cosH = (Math.cos(90.833 * rad) / (Math.cos(lat * rad) * Math.cos(decl))) - Math.tan(lat * rad) * Math.tan(decl);
  const ha = Math.acos(Math.max(-1, Math.min(1, cosH))) / rad;
  const at = (mins: number) => new Date(Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate()) + mins * 60000);
  return { sunrise: at(720 - 4 * (lng + ha) - eqt), sunset: at(720 - 4 * (lng - ha) - eqt) };
}

/** Mparntwe (Alice Springs) when the phone has no location yet. */
const HOME = { lat: -23.698, lng: 133.880 };
export function isDark(now: Date, at?: { lat: number; lng: number } | null) {
  const p = at ?? HOME;
  const { sunrise, sunset } = sunTimes(now, p.lat, p.lng);
  return now < sunrise || now > sunset;
}

/** The theme to put on <html>: 'light', 'dark', or null to follow the phone. */
export function resolvedTheme(theme: Theme, now: Date, at?: { lat: number; lng: number } | null): 'light' | 'dark' | null {
  if (theme === 'light' || theme === 'dark') return theme;
  if (theme === 'sun') return isDark(now, at) ? 'dark' : 'light';
  return null;
}
export function applyTheme(t: 'light' | 'dark' | null) {
  if (t) document.documentElement.dataset.theme = t; else delete document.documentElement.dataset.theme;
}
