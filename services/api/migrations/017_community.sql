-- Round 12: community and cultural fit.
-- Client consent for organisations booking rides on behalf of clients, concession cards, and driver leave (Sorry Business).
-- Additive and backward compatible: the API checks for these and keeps the feature off (or answers migration_pending) until they exist.

-- An organisation (community org, Aboriginal corporation, health service, NDIS provider) may book rides for a client only while the
-- client's consent is current. One row per consent; withdrawing sets withdrawn_at (history is kept).
CREATE TABLE IF NOT EXISTS client_consents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id           uuid NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
  client_id            uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  method               text NOT NULL,                 -- verbal | written | standing (e.g. care plan)
  note                 text,
  recorded_by          uuid REFERENCES users(id),
  given_at             timestamptz NOT NULL DEFAULT now(),
  expires_at           timestamptz,
  withdrawn_at         timestamptz,
  withdrawn_by         uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS client_consents_account_idx ON client_consents (account_id, client_id);
CREATE INDEX IF NOT EXISTS client_consents_client_idx ON client_consents (client_id);

-- Concession card: { type, last4, expires, status: pending | approved | rejected, note, applied_at, reviewed_at, reviewed_by }.
-- Never the full card number.
ALTER TABLE users ADD COLUMN IF NOT EXISTS concession jsonb;

-- Driver leave: { kind: sorry_business | cultural | family, from, until } while on leave, NULL otherwise.
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS leave jsonb;
