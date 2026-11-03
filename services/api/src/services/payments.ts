/**
 * Payments. Uses Stripe (PaymentIntents, manual capture) when STRIPE_SECRET_KEY is set, otherwise a mock
 * provider so the whole platform runs locally. Card data never touches DingoGo servers (Stripe Elements /
 * PaymentSheet on the client) which keeps PCI scope at SAQ-A.
 */
import { config } from '../config.js';

const stripeOn = () => !!config.stripeSecretKey;

async function stripe(path: string, params: Record<string, string>) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${config.stripeSecretKey}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  const j: any = await res.json();
  if (!res.ok) throw new Error(j.error?.message ?? 'Stripe error');
  return j;
}

export interface AuthResult { ok: boolean; ref: string; provider: 'stripe' | 'mock'; client_secret?: string; error?: string }

/** Place a hold for the quote + 20% buffer at request time. */
export async function authorise(amountCents: number, opts: { customerRef?: string; paymentMethodRef?: string; description: string }): Promise<AuthResult> {
  const hold = Math.round(amountCents * 1.2);
  if (!stripeOn()) return { ok: true, ref: `mock_pi_${Date.now().toString(36)}`, provider: 'mock' };
  try {
    const params: Record<string, string> = {
      amount: String(hold), currency: 'aud', capture_method: 'manual', description: opts.description,
      'automatic_payment_methods[enabled]': 'true',
    };
    if (opts.customerRef) params.customer = opts.customerRef;
    if (opts.paymentMethodRef) { params.payment_method = opts.paymentMethodRef; params.confirm = 'true'; params.off_session = 'true'; }
    const pi = await stripe('payment_intents', params);
    return { ok: true, ref: pi.id, provider: 'stripe', client_secret: pi.client_secret };
  } catch (e: any) {
    return { ok: false, ref: '', provider: 'stripe', error: e.message };
  }
}

export async function capture(ref: string, amountCents: number): Promise<{ ok: boolean; error?: string }> {
  if (!stripeOn() || ref.startsWith('mock_')) return { ok: true };
  try { await stripe(`payment_intents/${ref}/capture`, { amount_to_capture: String(amountCents) }); return { ok: true }; }
  catch (e: any) { return { ok: false, error: e.message }; }
}

export async function cancelHold(ref: string) {
  if (!stripeOn() || ref.startsWith('mock_')) return;
  await stripe(`payment_intents/${ref}/cancel`, {}).catch(() => undefined);
}

export async function refund(ref: string, amountCents: number) {
  if (!stripeOn() || ref.startsWith('mock_')) return { ok: true };
  try { await stripe('refunds', { payment_intent: ref, amount: String(amountCents) }); return { ok: true }; }
  catch (e: any) { return { ok: false, error: e.message }; }
}

/** SetupIntent so the app can save a card with Stripe PaymentSheet. */
export async function setupIntent(customerRef?: string) {
  if (!stripeOn()) return { provider: 'mock', client_secret: 'mock_seti_secret' };
  const si = await stripe('setup_intents', customerRef ? { customer: customerRef } : {});
  return { provider: 'stripe', client_secret: si.client_secret };
}
