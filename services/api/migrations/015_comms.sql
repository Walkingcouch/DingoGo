-- Round 9: notifications and communications. Additive only; the API works without it (preferences fall back to defaults,
-- chat answers 503 migration_pending, consent/opt-out/log writes are skipped).

-- Per-user notification settings: { push: { trip, chat, account, documents, promo }, sms: { trip } } (missing keys = defaults in code).
ALTER TABLE users ADD COLUMN IF NOT EXISTS notification_prefs jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Spam Act 2003: a record of every marketing consent given or withdrawn, with the wording the person saw.
CREATE TABLE IF NOT EXISTS marketing_consents (
  id          bigserial PRIMARY KEY,
  user_id     uuid REFERENCES users(id) ON DELETE SET NULL,
  phone       text,
  granted     boolean NOT NULL,
  channel     text NOT NULL DEFAULT 'all',      -- all | sms | push
  source      text NOT NULL,                    -- app | sms_stop | carrier | admin
  wording     text,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS marketing_consents_user_idx ON marketing_consents (user_id, created_at DESC);

-- Numbers that replied STOP (or that Twilio reports as unsubscribed). Not tied to an account: parcel recipients aren't users.
CREATE TABLE IF NOT EXISTS sms_opt_outs (
  phone         text PRIMARY KEY,
  source        text NOT NULL,                  -- sms_stop | carrier | admin
  opted_out_at  timestamptz NOT NULL DEFAULT now()
);

-- In-trip chat between rider and driver (and DingoGo staff). Kept as a safety record with the trip.
CREATE TABLE IF NOT EXISTS trip_messages (
  id          bigserial PRIMARY KEY,
  trip_id     uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  sender_id   uuid REFERENCES users(id) ON DELETE SET NULL,
  sender_role text NOT NULL,                    -- rider | driver | dingogo
  body        text NOT NULL,
  quick       text,                             -- quick-reply key, when one was used
  via         text NOT NULL DEFAULT 'app',      -- app | sms (texted to the relay number)
  client_id   text,
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS trip_messages_trip_idx ON trip_messages (trip_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS trip_messages_client_idx ON trip_messages (trip_id, sender_id, client_id) WHERE client_id IS NOT NULL;

-- What was sent by SMS / push / relayed call, for ops ("did the recipient get the PIN?"). Never the text itself (codes, PINs).
CREATE TABLE IF NOT EXISTS comms_log (
  id            bigserial PRIMARY KEY,
  at            timestamptz NOT NULL DEFAULT now(),
  channel       text NOT NULL,                  -- sms | push | call
  template      text,
  to_tail       text,                           -- last 3 digits of the number
  user_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  trip_id       uuid REFERENCES trips(id) ON DELETE SET NULL,
  status        text NOT NULL,                  -- sent | failed | skipped_opt_out | dev_log | …
  provider      text,
  provider_ref  text,
  error         text
);
CREATE INDEX IF NOT EXISTS comms_log_trip_idx ON comms_log (trip_id, at) WHERE trip_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS comms_log_at_idx ON comms_log (at);
