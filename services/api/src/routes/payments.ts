import type { FastifyInstance } from 'fastify';
import { config } from '../config.js';
import { ApiError, bad } from '../lib/errors.js';
import { verifyWebhook } from '../services/payments.js';
import { handleStripeEvent } from '../services/stripeEvents.js';

/** Stripe webhook. Registered in its own scope so JSON arrives as the raw bytes Stripe signed (the signature is over them). */
export default async function paymentRoutes(app: FastifyInstance) {
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: 512 * 1024 }, (_req, body, done) => done(null, body));

  app.post('/payments/stripe/webhook', async (req) => {
    const secret = config.stripe.webhookSecret;
    if (!secret) throw new ApiError(503, 'webhook_not_configured', 'Set STRIPE_WEBHOOK_SECRET to receive Stripe events');
    if (!Buffer.isBuffer(req.body)) throw bad('bad_payload', 'Expected a JSON body');
    const evt = verifyWebhook(req.body, req.headers['stripe-signature'] as string | undefined, secret);
    const r = await handleStripeEvent(evt);
    return { received: true, ...r };
  });
}
