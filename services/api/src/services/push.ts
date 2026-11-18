/**
 * Push notifications, behind config:
 *  - FCM HTTP v1 (Android app via Capacitor push; iOS too once the iOS app uses Firebase Messaging) — FCM_SERVICE_ACCOUNT.
 *  - Web Push (installed web app / PWA): VAPID (RFC 8292) with aes128gcm payload encryption (RFC 8291) — WEB_PUSH_VAPID_*.
 *  - Expo push only for Expo tokens (legacy) — EXPO_PUSH_ENABLED.
 * Tokens the provider says are dead are removed. Nothing here throws: push is best-effort on top of the in-app inbox.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { q } from '../db.js';

export interface PushMessage { title: string; body: string; data?: Record<string, unknown>; tag?: string; category?: string }

const b64url = (b: Buffer | string) => Buffer.from(b).toString('base64url');
const fromB64url = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64');

// ── FCM HTTP v1 ──
interface ServiceAccount { project_id: string; client_email: string; private_key: string; token_uri: string }
let saCache: { raw: string; sa: ServiceAccount | null } | null = null;
export function fcmAccount(): ServiceAccount | null {
  const raw = config.push.fcmServiceAccount;
  if (!raw) return null;
  if (saCache?.raw === raw) return saCache.sa;
  let sa: ServiceAccount | null = null;
  try {
    const j = JSON.parse(raw.trim().startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8'));
    if (j.project_id && j.client_email && j.private_key) sa = { ...j, token_uri: j.token_uri || 'https://oauth2.googleapis.com/token' };
  } catch { console.error('FCM_SERVICE_ACCOUNT is not valid JSON (or base64 JSON); FCM push is off'); }
  saCache = { raw, sa };
  return sa;
}
let accessToken: { token: string; exp: number; key: string } | null = null;
async function fcmAccessToken(sa: ServiceAccount) {
  if (accessToken && accessToken.key === sa.client_email && accessToken.exp > Date.now() + 60_000) return accessToken.token;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify({
    iss: sa.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: sa.token_uri, iat: now, exp: now + 3600 }))}`;
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key);
  const res = await fetch(sa.token_uri, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
    signal: AbortSignal.timeout(config.push.timeoutMs),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok || !j.access_token) throw new Error(`FCM auth failed: ${res.status} ${j.error ?? ''}`);
  accessToken = { token: j.access_token, exp: Date.now() + (Number(j.expires_in) || 3600) * 1000, key: sa.client_email };
  return j.access_token as string;
}

/** 'sent' | 'dead' (remove the token) | 'failed'. */
async function sendFcm(token: string, m: PushMessage): Promise<'sent' | 'dead' | 'failed'> {
  const sa = fcmAccount();
  if (!sa) return 'failed';
  const data: Record<string, string> = {};
  for (const [k, v] of Object.entries(m.data ?? {})) if (v != null) data[k] = typeof v === 'string' ? v : JSON.stringify(v);
  if (m.category) data.category = m.category;
  const res = await fetch(`${config.push.fcmApiBase}/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await fcmAccessToken(sa)}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: {
      token, notification: { title: m.title, body: m.body }, data,
      android: { priority: 'high', notification: { tag: m.tag, channel_id: m.category === 'promo' ? 'offers' : 'default' } },
      apns: { headers: m.tag ? { 'apns-collapse-id': m.tag.slice(0, 64) } : {} },
    } }),
    signal: AbortSignal.timeout(config.push.timeoutMs),
  });
  if (res.ok) return 'sent';
  const j: any = await res.json().catch(() => ({}));
  const code = j?.error?.details?.find?.((d: any) => d.errorCode)?.errorCode ?? j?.error?.status;
  if (res.status === 404 || code === 'UNREGISTERED' || (res.status === 400 && code === 'INVALID_ARGUMENT' && /token/i.test(j?.error?.message ?? ''))) return 'dead';
  return 'failed';
}

// ── Web Push ──
export const webPushConfigured = () => !!(config.push.vapidPublicKey && config.push.vapidPrivateKey);
let vapidKey: { pub: string; key: crypto.KeyObject } | null = null;
function vapidPrivateKey() {
  const pub = config.push.vapidPublicKey;
  if (vapidKey?.pub === pub) return vapidKey.key;
  const p = fromB64url(pub);
  const key = crypto.createPrivateKey({ format: 'jwk', key: {
    kty: 'EC', crv: 'P-256', d: config.push.vapidPrivateKey, x: b64url(p.subarray(1, 33)), y: b64url(p.subarray(33, 65)) } as any });
  vapidKey = { pub, key };
  return key;
}
export function vapidAuthHeader(endpoint: string, now = Math.floor(Date.now() / 1000)) {
  const unsigned = `${b64url(JSON.stringify({ typ: 'JWT', alg: 'ES256' }))}.${b64url(JSON.stringify({
    aud: new URL(endpoint).origin, exp: now + 12 * 3600, sub: config.push.vapidSubject }))}`;
  const sig = crypto.sign('sha256', Buffer.from(unsigned), { key: vapidPrivateKey(), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${unsigned}.${b64url(sig)}, k=${config.push.vapidPublicKey}`;
}
/** RFC 8291 message encryption (aes128gcm content coding, one record). */
export function encryptWebPush(payload: Buffer, p256dh: string, auth: string) {
  const ua = fromB64url(p256dh); const secret = fromB64url(auth);
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const as = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(ua);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, secret, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32));
  const salt = crypto.randomBytes(16);
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ct = Buffer.concat([cipher.update(Buffer.concat([payload, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const header = Buffer.alloc(21); salt.copy(header, 0); header.writeUInt32BE(4096, 16); header[20] = as.length;
  return Buffer.concat([header, as, ct]);
}
async function sendWebPush(subJson: string, m: PushMessage): Promise<'sent' | 'dead' | 'failed'> {
  let sub: any;
  try { sub = JSON.parse(subJson); } catch { return 'dead'; }
  if (!sub?.endpoint || !sub?.keys?.p256dh || !sub?.keys?.auth || (!/^https:\/\//.test(sub.endpoint) && !process.env.WEB_PUSH_ALLOW_HTTP)) return 'dead';
  const payload = Buffer.from(JSON.stringify({ title: m.title, body: m.body.slice(0, 1000), tag: m.tag, data: m.data ?? {}, category: m.category }));
  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidAuthHeader(sub.endpoint), 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream',
      TTL: m.category === 'promo' ? '86400' : '3600', Urgency: m.category === 'promo' ? 'low' : 'high',
      ...(m.tag ? { Topic: m.tag.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) } : {}),
    },
    body: encryptWebPush(payload, sub.keys.p256dh, sub.keys.auth),
    signal: AbortSignal.timeout(config.push.timeoutMs),
  });
  if (res.ok) return 'sent';
  return res.status === 404 || res.status === 410 ? 'dead' : 'failed';
}

// ── Expo (legacy) ──
async function sendExpo(token: string, m: PushMessage): Promise<'sent' | 'dead' | 'failed'> {
  const res = await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ to: token, title: m.title, body: m.body, data: m.data, sound: 'default' }),
    signal: AbortSignal.timeout(config.push.timeoutMs),
  });
  const j: any = await res.json().catch(() => ({}));
  return j?.data?.details?.error === 'DeviceNotRegistered' ? 'dead' : res.ok ? 'sent' : 'failed';
}

export function pushProviders() {
  return { fcm: !!fcmAccount(), web: webPushConfigured(), expo: config.expoPushEnabled };
}

function providerFor(token: string, platform: string): 'fcm' | 'web' | 'expo' | null {
  if (token.startsWith('ExponentPushToken')) return config.expoPushEnabled ? 'expo' : null;
  if (platform === 'web') return webPushConfigured() ? 'web' : null;
  return fcmAccount() ? 'fcm' : null;
}

/** Send to every device of a user. Returns how many devices accepted it. */
export async function sendPush(userId: string, m: PushMessage): Promise<number> {
  const tokens = await q<{ token: string; platform: string }>('SELECT token, platform FROM push_tokens WHERE user_id = $1', [userId]);
  let sent = 0;
  await Promise.all(tokens.map(async (t) => {
    const p = providerFor(t.token, t.platform);
    if (!p) return;
    const r = await (p === 'fcm' ? sendFcm(t.token, m) : p === 'web' ? sendWebPush(t.token, m) : sendExpo(t.token, m))
      .catch((e) => { console.error('push', p, e?.message ?? e); return 'failed' as const; });
    if (r === 'sent') sent++;
    if (r === 'dead') await q('DELETE FROM push_tokens WHERE user_id = $1 AND token = $2', [userId, t.token]).catch(() => undefined);
  }));
  return sent;
}

/** New VAPID key pair (base64url raw keys) for WEB_PUSH_VAPID_PUBLIC_KEY / WEB_PUSH_VAPID_PRIVATE_KEY. */
export function generateVapidKeys() {
  const ecdh = crypto.createECDH('prime256v1'); ecdh.generateKeys();
  const d = ecdh.getPrivateKey();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(Buffer.concat([Buffer.alloc(32 - d.length), d])) };
}
