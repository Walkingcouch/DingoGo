/**
 * Push notifications for the rider and driver apps.
 *  - Android app (Capacitor): only when the APK was built with Firebase (google-services.json) and VITE_FCM_ENABLED=true —
 *    registering without Firebase crashes the app, so it stays off otherwise.
 *  - Installed web app / browser: Web Push through a push-only service worker (sw.js, no caching), when the API has a VAPID key.
 * Asking for permission only happens when the person taps "Turn on notifications".
 */
import { api, post } from './api';

const env = (import.meta as any).env ?? {};
const KEY = (app: string) => `dingogo.${app}.push`;
const cap = () => (typeof window !== 'undefined' ? (window as any).Capacitor : undefined);

export type PushKind = 'native' | 'web' | null;
export type PushState = 'unsupported' | 'off' | 'denied' | 'on';

export function pushKind(webKey: string | null | undefined): PushKind {
  const c = cap();
  if (c?.isNativePlatform?.()) {
    return env.VITE_FCM_ENABLED === 'true' && c.isPluginAvailable?.('PushNotifications') ? 'native' : null;
  }
  if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator && typeof window !== 'undefined' && 'PushManager' in window && webKey) return 'web';
  return null;
}

const saved = (app: string) => { try { return localStorage.getItem(KEY(app)); } catch { return null; } };
const save = (app: string, token: string | null) => { try { token ? localStorage.setItem(KEY(app), token) : localStorage.removeItem(KEY(app)); } catch { /* storage off */ } };

export async function pushState(app: string, webKey: string | null | undefined): Promise<PushState> {
  const kind = pushKind(webKey);
  if (!kind) return 'unsupported';
  if (kind === 'web') {
    if (Notification.permission === 'denied') return 'denied';
    return Notification.permission === 'granted' && saved(app) ? 'on' : 'off';
  }
  const p = await cap().Plugins.PushNotifications.checkPermissions().catch(() => ({ receive: 'prompt' }));
  if (p.receive === 'denied') return 'denied';
  return p.receive === 'granted' && saved(app) ? 'on' : 'off';
}

function keyBytes(b64url: string) {
  const s = atob(b64url.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((b64url.length + 3) % 4));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

async function register(app: string, webKey: string | null | undefined, prompt: boolean): Promise<PushState> {
  const kind = pushKind(webKey);
  if (!kind) return 'unsupported';
  let token: string; let platform: string;
  if (kind === 'web') {
    const perm = prompt ? await Notification.requestPermission() : Notification.permission;
    if (perm !== 'granted') return perm === 'denied' ? 'denied' : 'off';
    const reg = await navigator.serviceWorker.register(`${env.BASE_URL ?? '/'}sw.js`);
    await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription())
      ?? await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(webKey!) });
    token = JSON.stringify(sub); platform = 'web';
  } else {
    const P = cap().Plugins.PushNotifications;
    const perm = prompt ? await P.requestPermissions() : await P.checkPermissions();
    if (perm.receive !== 'granted') return perm.receive === 'denied' ? 'denied' : 'off';
    token = await new Promise<string>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('no token')), 15000);
      void P.addListener('registration', (r: { value: string }) => { clearTimeout(t); resolve(r.value); });
      void P.addListener('registrationError', (e: any) => { clearTimeout(t); reject(e); });
      void P.register();
    });
    platform = cap().getPlatform?.() === 'ios' ? 'ios' : 'android';
  }
  await post('/me/push-token', { token, platform });
  save(app, token);
  return 'on';
}

/** "Turn on notifications": asks for permission and registers this phone. */
export const enablePush = (app: string, webKey: string | null | undefined) => register(app, webKey, true);
/** On app start: if permission was given before, register again quietly (tokens change). Never prompts. */
export function refreshPush(app: string, webKey: string | null | undefined) {
  return register(app, webKey, false).catch(() => 'off' as PushState);
}

/** Sign-out: stop pushes to this phone (call while still signed in). */
export async function disablePush(app: string) {
  const token = saved(app);
  save(app, null);
  if (!token) return;
  await api('DELETE', '/me/push-token', { token }, { timeoutMs: 5000 }).catch(() => undefined);
  if (pushKind('x') === 'web') {
    const reg = await navigator.serviceWorker.getRegistration().catch(() => undefined);
    await (await reg?.pushManager.getSubscription())?.unsubscribe().catch(() => undefined);
  }
}
