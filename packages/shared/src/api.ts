/** Typed-ish client for the DingoGo API, shared by every app. */
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: unknown) { super(message); }
}

const env = (import.meta as any).env ?? {};
let BASE: string = env.VITE_API_URL ?? (typeof location !== 'undefined' ? `${location.protocol}//${location.hostname}:4000` : 'http://localhost:4000');
export const setApiBase = (url: string) => { BASE = url.replace(/\/$/, ''); };
export const apiBase = () => BASE;
export const assetUrl = (path?: string | null) => (!path ? '' : path.startsWith('http') || path.startsWith('data:') ? path : BASE + path);

const TOKEN_KEY = (app: string) => `dingogo.${app}.token`;
let appName = 'rider';
let token: string | null = null;
export function initAuth(app: string) {
  appName = app;
  try { token = localStorage.getItem(TOKEN_KEY(app)); } catch { token = null; }
  return token;
}
export function setToken(t: string | null) {
  token = t;
  try { t ? localStorage.setItem(TOKEN_KEY(appName), t) : localStorage.removeItem(TOKEN_KEY(appName)); } catch { /* storage unavailable */ }
}
export const getToken = () => token;

/** Connection state shared by every screen: false after a request fails for lack of signal (or the browser says it's offline),
 *  true again after the next request gets through. Apps show an "offline" banner from it (useOnline in hooks.ts). */
let online = typeof navigator === 'undefined' ? true : navigator.onLine !== false;
const netListeners = new Set<(on: boolean) => void>();
function setOnline(on: boolean) { if (on !== online) { online = on; netListeners.forEach((f) => f(on)); } }
export const isOnline = () => online;
export function onNetworkChange(f: (on: boolean) => void) { netListeners.add(f); return () => { netListeners.delete(f); }; }
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => setOnline(true));
  window.addEventListener('offline', () => setOnline(false));
}

/** Reads (GET) give up after this long so a weak signal doesn't leave a spinner forever, then retry. Writes are never
 *  retried or timed out here: a booking or payment that may have gone through must not be sent twice. */
const READ_TIMEOUT_MS = 15000;
const READ_RETRIES = [800, 2500];
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function send(method: string, path: string, body: unknown, timeoutMs: number | null, extra?: Record<string, string>): Promise<Response> {
  const ctl = timeoutMs && typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctl ? setTimeout(() => ctl.abort(), timeoutMs!) : null;
  try {
    return await fetch(BASE + path, {
      method, signal: ctl?.signal,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...extra },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } finally { if (timer) clearTimeout(timer); }
}

export interface ApiOpts {
  /** Extra request headers, e.g. Idempotency-Key for a write the app may send again. */
  headers?: Record<string, string>;
  /** Give up after this long (writes default to no timeout). */
  timeoutMs?: number;
}
export async function api<T = any>(method: string, path: string, body?: unknown, opts: ApiOpts = {}): Promise<T> {
  const read = method === 'GET';
  let res: Response | null = null;
  for (let attempt = 0; ; attempt++) {
    try { res = await send(method, path, body, opts.timeoutMs ?? (read ? READ_TIMEOUT_MS : null), opts.headers); break; }
    catch {
      if (read && attempt < READ_RETRIES.length) { await sleep(READ_RETRIES[attempt]); continue; }
      setOnline(false);
      throw new ApiError(0, 'offline', 'No signal. Check your connection and try again.');
    }
  }
  setOnline(true);
  const text = await res.text();
  let json: any = {};
  try { json = text ? JSON.parse(text) : {}; } catch { json = {}; }
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    // Gateways in front of the API answer 502-504 when the connection drops mid-request: treat like no signal.
    if (!json.error && res.status >= 502 && res.status <= 504) throw new ApiError(res.status, 'offline', 'The connection dropped. Try again in a moment.');
    throw new ApiError(res.status, json.error ?? 'error', json.message ?? 'Something went wrong', json.details);
  }
  return json as T;
}
export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: unknown, o?: ApiOpts) => api<T>('POST', p, b ?? {}, o);
export const patch = <T = any>(p: string, b?: unknown) => api<T>('PATCH', p, b ?? {});
export const put = <T = any>(p: string, b?: unknown) => api<T>('PUT', p, b ?? {});
export const del = <T = any>(p: string) => api<T>('DELETE', p);

/** Phone OTP sign-in. In dev the API returns dev_code and "000000" always works. */
export async function requestOtp(phone: string) { return post<{ ok: boolean; phone: string; dev_code?: string }>('/auth/otp/request', { phone }); }
export async function verifyOtp(phone: string, code: string, extra: { name?: string; referral_code?: string; app?: string } = {}) {
  const r = await post<{ token: string; user: any; is_new: boolean }>('/auth/otp/verify', { phone, code, app: appName, ...extra });
  setToken(r.token);
  return r;
}

export type Msg = { channel?: string; type: string; data: any; at?: string };
/** Set VITE_REALTIME=off when the API runs serverless (no WebSockets); apps then rely on polling. */
export const REALTIME: boolean = env.VITE_REALTIME !== 'off';
/** Realtime socket with auto-reconnect. Returns a disposer. */
export function connectRealtime(onMessage: (m: Msg) => void, opts: { share?: string; subscribe?: string[] } = {}) {
  if (!REALTIME) return { subscribe: (_c: string) => false, close: () => {} };
  let ws: WebSocket | null = null; let closed = false; let retry = 1000; let ping: any;
  const open = () => {
    const q = opts.share ? `share=${opts.share}` : `token=${token ?? ''}`;
    ws = new WebSocket(BASE.replace(/^http/, 'ws') + `/ws?${q}`);
    ws.onopen = () => {
      retry = 1000;
      opts.subscribe?.forEach((c) => ws!.send(JSON.stringify({ type: 'subscribe', channel: c })));
      ping = setInterval(() => ws?.readyState === 1 && ws.send(JSON.stringify({ type: 'ping' })), 25000);
    };
    ws.onmessage = (e) => { try { onMessage(JSON.parse(e.data)); } catch { /* ignore */ } };
    // 4001 signed out / blocked, 4004 no such trip, 4010 share link expired: retrying won't help.
    ws.onclose = (e) => { clearInterval(ping); if (!closed && ![4001, 4004, 4010].includes(e.code)) setTimeout(open, (retry = Math.min(retry * 2, 15000))); };
  };
  open();
  return {
    subscribe: (c: string) => ws?.readyState === 1 && ws.send(JSON.stringify({ type: 'subscribe', channel: c })),
    close: () => { closed = true; clearInterval(ping); ws?.close(); },
  };
}

/** Read a File into a data URL and upload it. `url` is the reference to save; `view_url` can be shown (signed and short-lived
 *  for private files: driver documents and delivery photos). */
export async function uploadFile(file: File | Blob, purpose: 'pod' | 'document' | 'avatar' | 'ad') {
  const data_url: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
  return post<{ url: string; view_url?: string }>('/uploads', { data_url, purpose });
}
