-- Round 8: Stripe readiness. Additive only. Mock payments (no STRIPE_SECRET_KEY) never touch these tables, so the API keeps
-- working before this is applied; with Stripe switched on, saving cards and the webhook answer 503 migration_pending until it is.

-- One Stripe Customer per rider (saved cards live on it; holds and charges are made off-session against it).
CREATE TABLE IF NOT EXISTS payment_customers (
  user_id      uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  provider     text NOT NULL DEFAULT 'stripe',
  customer_ref text NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Webhook events already handled (Stripe retries and replays: each event id is applied once).
CREATE TABLE IF NOT EXISTS payment_events (
  id          text PRIMARY KEY,
  provider    text NOT NULL DEFAULT 'stripe',
  type        text NOT NULL,
  object_ref  text,
  received_at timestamptz NOT NULL DEFAULT now(),
  data        jsonb
);
CREATE INDEX IF NOT EXISTS payment_events_received_idx ON payment_events (received_at);

-- Saved card details as Stripe reports them (never from the client).
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS fingerprint text;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS exp_month integer;
ALTER TABLE payment_methods ADD COLUMN IF NOT EXISTS exp_year integer;

-- Webhooks find the payment by its PaymentIntent / dispute id.
CREATE INDEX IF NOT EXISTS payments_provider_ref_idx ON payments (provider_ref);
CREATE INDEX IF NOT EXISTS trips_payment_ref_idx ON trips (payment_ref);
