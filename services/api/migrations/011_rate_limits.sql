-- Round 2: per-IP / per-user rate limits that work serverless (every instance shares the database).
-- One row per counted event; rows older than a day are pruned by the API as it goes.
CREATE TABLE IF NOT EXISTS rate_events (
  id     bigserial PRIMARY KEY,
  bucket text NOT NULL,          -- e.g. 'otp_request_ip', 'public_form_ip', 'upload_user'
  key    text NOT NULL,          -- IP address or user id
  at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rate_events_lookup_idx ON rate_events (bucket, key, at DESC);
CREATE INDEX IF NOT EXISTS rate_events_at_idx ON rate_events (at);

-- Uploads: find a user's recent uploads quickly (upload limit) and check ownership of references.
CREATE INDEX IF NOT EXISTS uploads_owner_idx ON uploads (owner_id, created_at DESC);
