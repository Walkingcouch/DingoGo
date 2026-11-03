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

export async function api<T = any>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response;
  try {
    res = await fetch(BASE + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  } catch {
    throw new ApiError(0, 'offline', 'No connection. Check your signal and try again.');
  }
  const text = await res.text();
  const json = text ? JSON.parse(text) : {};
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new ApiError(res.status, json.error ?? 'error', json.message ?? 'Something went wrong', json.details);
  }
  return json as T;
}
export const get = <T = any>(p: string) => api<T>('GET', p);
export const post = <T = any>(p: string, b?: unknown) => api<T>('POST', p, b ?? {});
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
    ws.onclose = () => { clearInterval(ping); if (!closed) setTimeout(open, (retry = Math.min(retry * 2, 15000))); };
  };
  open();
  return {
    subscribe: (c: string) => ws?.readyState === 1 && ws.send(JSON.stringify({ type: 'subscribe', channel: c })),
    close: () => { closed = true; clearInterval(ping); ws?.close(); },
  };
}

/** Read a File into a data URL and upload it. Returns the stored URL. */
export async function uploadFile(file: File | Blob, purpose: 'pod' | 'document' | 'avatar' | 'ad') {
  const data_url: string = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.onerror = rej; r.readAsDataURL(file); });
  return post<{ url: string }>('/uploads', { data_url, purpose });
}
