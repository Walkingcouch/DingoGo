/**
 * Payments. Stripe (PaymentIntents) when STRIPE_SECRET_KEY is set, otherwise a mock provider so the whole platform runs locally
 * with no network. Card data never touches DingoGo servers (Stripe Elements / PaymentSheet on the client), which keeps PCI scope
 * at SAQ-A: the API only ever sees Stripe ids (cus_, seti_, pm_, pi_, re_, dp_).
 *
 * Every write to Stripe carries an idempotency key derived from what it is for (trip + attempt, PaymentIntent + amount, refund
 * slot), so a retried request, a double tap or a serverless re-run can never hold, charge or refund twice.
 *  - Trip fares: hold (manual capture) on the rider's default saved card, off-session; captured at the end of the trip.
 *  - Tips, top-ups, DingoGo Pass, fees with no hold, retries: their own PaymentIntent, captured at once.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { one, pool } from '../db.js';
import { ApiError, bad } from '../lib/errors.js';

export const stripeOn = () => !!config.stripe.secretKey;
export type Provider = 'stripe' | 'mock';

export class StripeError extends Error {
  constructor(public status: number, public code: string | undefined, public declineCode: string | undefined, message: string, public raw?: any) {
    super(message);
  }
}

/** Stripe's form encoding: nested objects as a[b]=c, arrays as a[0]=x. */
export function encodeForm(params: Record<string, unknown>, prefix = '', out = new URLSearchParams()) {
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) v.forEach((x, i) => (x !== null && typeof x === 'object' ? encodeForm(x as any, `${key}[${i}]`, out) : out.append(`${key}[${i}]`, String(x))));
    else if (typeof v === 'object') encodeForm(v as any, key, out);
    else out.append(key, String(v));
  }
  return out;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** One Stripe API call. Network errors, 429 and 5xx are retried once (safe: writes carry an idempotency key). */
export async function stripeApi(method: 'GET' | 'POST', path: string, params: Record<string, unknown> = {}, idempotencyKey?: string): Promise<any> {
  const url = new URL(`/v1/${path}`, config.stripe.apiBase);
  const form = encodeForm(params);
  if (method === 'GET') form.forEach((v, k) => url.searchParams.append(k, v));
  const headers: Record<string, string> = { Authorization: `Bearer ${config.stripe.secretKey}`, 'Stripe-Version': config.stripe.apiVersion };
  if (method === 'POST') headers['Content-Type'] = 'application/x-www-form-urlencoded';
  if (method === 'POST' && idempotencyKey) headers['Idempotency-Key'] = idempotencyKey;
  const canRetry = method === 'GET' || !!idempotencyKey;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(url, { method, headers, body: method === 'POST' ? form.toString() : undefined, signal: AbortSignal.timeout(config.stripe.timeoutMs) });
    } catch {
      if (canRetry && attempt === 0) { await wait(300); continue; }
      throw new StripeError(0, 'network_error', undefined, 'We could not reach the card processor. Please try again.');
    }
    const j: any = await res.json().catch(() => ({}));
    if (res.ok) return j;
    if (canRetry && attempt === 0 && (res.status === 429 || res.status >= 500)) { await wait(300); continue; }
    const e = j.error ?? {};
    throw new StripeError(res.status, e.code, e.decline_code, e.message ?? 'Stripe error', e);
  }
}

/** Plain-English message for a card problem (never Stripe's raw text, which can be technical). */
export function cardMessage(code?: string) {
  switch (code) {
    case 'card_required': return 'Add a card in Account → Payment first, or pay another way.';
    case 'insufficient_funds': return 'Your card was declined: not enough money available. Try another card or DingoGo credit.';
    case 'expired_card': return 'Your card has expired. Add your new card in Account → Payment.';
    case 'incorrect_cvc': case 'incorrect_number': case 'invalid_expiry_year': case 'invalid_expiry_month':
      return 'Your card details were not accepted. Add the card again in Account → Payment.';
    case 'authentication_required':
      return 'Your bank wants to confirm this payment. Add the card again in Account → Payment (your bank will check it there), or use another card.';
    case 'network_error': return 'We could not reach the card processor. Please try again.';
    case 'cards_not_available': return 'Card payments are coming soon. Use DingoGo credit or a prepaid voucher for now.';
    default: return 'Your card was declined. Try another card or DingoGo credit.';
  }
}

export interface PayResult { ok: boolean; ref: string; provider: Provider; amount_cents?: number; code?: string; error?: string }

const mockRef = (key?: string) => `mock_pi_${key ? crypto.createHash('sha256').update(key).digest('hex').slice(0, 16) : crypto.randomBytes(8).toString('hex')}`;
const isMock = (ref: string | null | undefined) => !ref || ref.startsWith('mock_') || ref === 'wallet';

/** Postgres "table/column doesn't exist": Stripe mode before migration 014. */
function migrationPending(e: any): never {
  if (e?.code === '42P01' || e?.code === '42703') throw new ApiError(503, 'migration_pending', 'Card payments are being set up. Please try again soon.');
  throw e;
}

// ───────────────────────── Who may pay by card ─────────────────────────

export type CardMode = 'stripe' | 'test' | 'off';

/** stripe: real cards. test: mock provider (development, demo and test accounts). off: card payments not available yet. */
export async function cardModeFor(userId: string): Promise<CardMode> {
  if (stripeOn()) return 'stripe';
  if (config.mockCards === 'all') return 'test';
  if (config.mockCards === 'off') return 'off';
  const u = await one('SELECT phone, test_account FROM users WHERE id = $1', [userId]).catch(() => one('SELECT phone FROM users WHERE id = $1', [userId]));
  return u && (u.test_account || config.otpDemoNumbers.includes(u.phone)) ? 'test' : 'off';
}

export async function requireCards(userId: string) {
  const m = await cardModeFor(userId);
  if (m === 'off') throw new ApiError(402, 'cards_not_available', cardMessage('cards_not_available'));
  return m;
}

/** SQL filter for saved cards usable in the current mode (in Stripe mode, rows made by the mock provider are ignored). */
export const usableCardsSql = () => (stripeOn() ? `provider = 'stripe' AND provider_ref NOT LIKE 'pm\\_test\\_%'` : 'true');

export async function defaultCard(userId: string): Promise<string | null> {
  const r = await one(`SELECT provider_ref FROM payment_methods WHERE user_id = $1 AND ${usableCardsSql()} ORDER BY is_default DESC, created_at DESC LIMIT 1`, [userId]);
  return r?.provider_ref ?? null;
}

/** Stripe mode: the rider must have a saved card before booking with "card". */
export async function requireCardOnFile(userId: string) {
  const mode = await requireCards(userId);
  if (mode === 'stripe' && !(await defaultCard(userId))) throw new ApiError(402, 'card_required', cardMessage('card_required'));
  return mode;
}

// ───────────────────────── Customers & saved cards ─────────────────────────

export async function ensureCustomer(userId: string): Promise<string> {
  const row = await one('SELECT customer_ref FROM payment_customers WHERE user_id = $1', [userId]).catch(migrationPending);
  if (row) return row.customer_ref;
  // Only what a receipt needs: name and email. Phone numbers stay with DingoGo.
  const u = await one('SELECT name, email FROM users WHERE id = $1', [userId]);
  const cus = await stripeApi('POST', 'customers', { name: u?.name || undefined, email: u?.email || undefined, metadata: { user_id: userId } }, `customer-${userId}`);
  await pool.query('INSERT INTO payment_customers (user_id, provider, customer_ref) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING', [userId, 'stripe', cus.id]);
  return (await one('SELECT customer_ref FROM payment_customers WHERE user_id = $1', [userId]))!.customer_ref;
}

/** SetupIntent so the app can save a card (Stripe Elements / PaymentSheet confirm it on the device, incl. any bank check). */
export async function setupIntent(userId: string) {
  if (!stripeOn()) return { provider: 'mock' as const, client_secret: 'mock_seti_secret' };
  const customer = await ensureCustomer(userId);
  const si = await stripeApi('POST', 'setup_intents', { customer, usage: 'off_session', payment_method_types: ['card'], metadata: { user_id: userId } },
    `setup-${userId}-${crypto.randomUUID()}`);
  return { provider: 'stripe' as const, client_secret: si.client_secret as string, setup_intent_id: si.id as string, publishable_key: config.stripe.publishableKey };
}

const BRANDS: Record<string, string> = { visa: 'Visa', mastercard: 'Mastercard', amex: 'American Express', discover: 'Discover', diners: 'Diners Club', jcb: 'JCB', unionpay: 'UnionPay', eftpos_au: 'eftpos' };

export interface SavedCard { ref: string; brand: string; last4: string; exp_month: number | null; exp_year: number | null; fingerprint: string | null }

/** The card from a SetupIntent the app says it confirmed — checked with Stripe (it must be this rider's and have succeeded). */
export async function cardFromSetup(userId: string, setupIntentId: string): Promise<SavedCard> {
  const customer = await ensureCustomer(userId);
  let si: any;
  try { si = await stripeApi('GET', `setup_intents/${encodeURIComponent(setupIntentId)}`, { expand: ['payment_method'] }); }
  catch (e) { if (e instanceof StripeError && e.status === 404) throw bad('setup_not_found', 'That card setup was not found. Try adding the card again.'); throw e; }
  if (si.customer !== customer) throw bad('setup_not_found', 'That card setup was not found. Try adding the card again.');
  if (si.status !== 'succeeded') throw bad('setup_incomplete', 'The card was not confirmed. Try adding it again.');
  const pm = typeof si.payment_method === 'string' ? await stripeApi('GET', `payment_methods/${si.payment_method}`) : si.payment_method;
  const card = pm?.card ?? {};
  return { ref: pm.id, brand: BRANDS[card.brand] ?? (card.brand ? String(card.brand) : 'Card'), last4: String(card.last4 ?? '').slice(-4),
    exp_month: card.exp_month ?? null, exp_year: card.exp_year ?? null, fingerprint: card.fingerprint ?? null };
}

export async function detachCard(ref: string) {
  if (!stripeOn() || isMock(ref) || ref.startsWith('pm_test_')) return;
  await stripeApi('POST', `payment_methods/${encodeURIComponent(ref)}/detach`, {}, `detach-${ref}`).catch((e) => {
    if (!(e instanceof StripeError && (e.status === 404 || e.code === 'payment_method_unexpected_state'))) throw e;
  });
}

// ───────────────────────── Holds, captures, charges, refunds ─────────────────────────

async function confirmOffSession(o: { userId: string; amountCents: number; capture: 'manual' | 'automatic'; description: string; key: string; metadata: Record<string, string> }): Promise<PayResult> {
  const card = await defaultCard(o.userId);
  if (!card) return { ok: false, ref: '', provider: 'stripe', code: 'card_required', error: cardMessage('card_required') };
  const customer = await ensureCustomer(o.userId);
  try {
    const pi = await stripeApi('POST', 'payment_intents', {
      amount: o.amountCents, currency: 'aud', customer, payment_method: card, payment_method_types: ['card'],
      confirm: true, off_session: true, capture_method: o.capture, description: o.description, metadata: o.metadata,
    }, o.key);
    const good = o.capture === 'manual' ? pi.status === 'requires_capture' : pi.status === 'succeeded' || pi.status === 'processing';
    if (good) return { ok: true, ref: pi.id, provider: 'stripe', amount_cents: o.amountCents };
    // Needs the rider in the app (bank authentication): we can't finish it off-session, so let it go.
    await stripeApi('POST', `payment_intents/${pi.id}/cancel`, {}, `cancel-${pi.id}`).catch(() => undefined);
    return { ok: false, ref: pi.id, provider: 'stripe', code: 'authentication_required', error: cardMessage('authentication_required') };
  } catch (e) {
    if (!(e instanceof StripeError)) throw e;
    const code = e.declineCode ?? e.code ?? 'card_declined';
    return { ok: false, ref: e.raw?.payment_intent?.id ?? '', provider: 'stripe', code, error: cardMessage(code) };
  }
}

/** Fare hold for a trip: the quote + 20% (room for a route change), on the rider's default card, captured at the end. */
export async function holdForTrip(o: { userId: string; tripId: string; attempt: number; amountCents: number; description: string }): Promise<PayResult> {
  const hold = Math.round(o.amountCents * 1.2);
  if (!stripeOn()) return { ok: true, ref: mockRef(), provider: 'mock', amount_cents: hold };
  return confirmOffSession({ userId: o.userId, amountCents: hold, capture: 'manual', description: o.description,
    key: `hold-${o.tripId}-${o.attempt}`, metadata: { trip_id: o.tripId, kind: 'trip' } });
}

/** A payment taken at once (tip, top-up, Pass, fee with no hold, retry). `key` names what it is for, so a repeat returns the same payment. */
export async function charge(o: { userId: string; amountCents: number; description: string; key: string; metadata?: Record<string, string> }): Promise<PayResult> {
  if (!stripeOn()) return { ok: true, ref: mockRef(o.key), provider: 'mock', amount_cents: o.amountCents };
  return confirmOffSession({ userId: o.userId, amountCents: o.amountCents, capture: 'automatic', description: o.description, key: o.key, metadata: o.metadata ?? {} });
}

export async function capture(ref: string, amountCents: number): Promise<{ ok: boolean; code?: string; error?: string }> {
  if (!stripeOn() || isMock(ref)) return { ok: true };
  try {
    const pi = await stripeApi('POST', `payment_intents/${encodeURIComponent(ref)}/capture`, { amount_to_capture: amountCents }, `capture-${ref}-${amountCents}`);
    return pi.status === 'succeeded' ? { ok: true } : { ok: false, code: pi.status, error: 'Capture did not complete' };
  } catch (e) {
    if (e instanceof StripeError) return { ok: false, code: e.code, error: e.message };
    throw e;
  }
}

/** Take money held for a trip. If the hold is gone (lapsed after ~7 days, or cancelled), charge the saved card afresh. */
export async function collect(o: { userId: string; tripId: string; ref: string | null; amountCents: number; description: string; purpose: string }): Promise<PayResult> {
  if (!stripeOn() || (o.ref && isMock(o.ref))) return { ok: true, ref: o.ref || mockRef(`${o.purpose}-${o.tripId}`), provider: 'mock', amount_cents: o.amountCents };
  if (o.ref) {
    const cap = await capture(o.ref, o.amountCents);
    if (cap.ok) return { ok: true, ref: o.ref, provider: 'stripe', amount_cents: o.amountCents };
  }
  return charge({ userId: o.userId, amountCents: o.amountCents, description: o.description, key: `${o.purpose}-${o.tripId}-${o.amountCents}`,
    metadata: { trip_id: o.tripId, kind: o.purpose } });
}

export async function cancelHold(ref: string | null) {
  if (!ref || !stripeOn() || isMock(ref)) return;
  await stripeApi('POST', `payment_intents/${encodeURIComponent(ref)}/cancel`, {}, `cancel-${ref}`).catch(() => undefined);
}

/** Refund part of a PaymentIntent. `key` is the refund slot (trip + refunds so far + part), so a retry can't refund twice. */
export async function refund(ref: string, amountCents: number, key: string): Promise<{ ok: boolean; ref?: string; error?: string }> {
  if (!stripeOn() || isMock(ref)) return { ok: true };
  try {
    const r = await stripeApi('POST', 'refunds', { payment_intent: ref, amount: amountCents }, `refund-${key}`);
    return { ok: true, ref: r.id };
  } catch (e) {
    if (e instanceof StripeError) return { ok: false, error: e.message };
    throw e;
  }
}

// ───────────────────────── Webhook signatures ─────────────────────────

/** Stripe-Signature: "t=<unix>,v1=<hex hmac>[,v1=…]" over "<t>.<raw body>" with the endpoint secret. */
export function signWebhook(payload: string, secret: string, t = Math.floor(Date.now() / 1000)) {
  const sig = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  return `t=${t},v1=${sig}`;
}

export function verifyWebhook(raw: Buffer, header: string | undefined, secret: string, toleranceS = config.stripe.webhookToleranceS, nowS = Date.now() / 1000) {
  if (!header) throw bad('bad_signature', 'Missing Stripe-Signature');
  let t = NaN; const v1: string[] = [];
  for (const part of header.split(',')) {
    const [k, v] = part.split('=', 2).map((s) => s.trim());
    if (k === 't') t = Number(v);
    else if (k === 'v1' && v && /^[0-9a-f]{64}$/i.test(v)) v1.push(v.toLowerCase());
  }
  if (!Number.isFinite(t) || !v1.length) throw bad('bad_signature', 'Malformed Stripe-Signature');
  if (Math.abs(nowS - t) > toleranceS) throw bad('signature_expired', 'Webhook signature is too old');
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex'), 'hex');
  if (!v1.some((s) => crypto.timingSafeEqual(Buffer.from(s, 'hex'), expected))) throw bad('bad_signature', 'Webhook signature does not match');
  try { return JSON.parse(raw.toString('utf8')); } catch { throw bad('bad_payload', 'Webhook body is not JSON'); }
}
