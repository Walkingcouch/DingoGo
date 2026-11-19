-- Round 21: app store readiness. What each person was told before the phone asked for a permission (Google Play's prominent
-- disclosure for location, plus the notification and camera explanations), and what they chose. One row per answer; the app
-- also keeps the answer on the phone. Additive and re-runnable. Until it is applied, POST /me/disclosures answers
-- { recorded: false } and the apps carry on (the answer stays on the phone).

CREATE TABLE IF NOT EXISTS permission_disclosures (
  id          bigserial PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  app         text NOT NULL CHECK (app IN ('rider', 'driver')),
  kind        text NOT NULL CHECK (kind IN ('location', 'background_location', 'notifications', 'camera')),
  version     text NOT NULL,                       -- wording version shown (e.g. "2026-11-location-1")
  accepted    boolean NOT NULL,
  platform    text NOT NULL DEFAULT 'web' CHECK (platform IN ('android', 'ios', 'web')),
  app_version text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS permission_disclosures_user_idx ON permission_disclosures (user_id, created_at DESC);
