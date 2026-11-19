-- Round 14: safety and trust.
-- Trusted contacts and automatic trip sharing, ride check-ins ("Are you OK?") with escalation, driver online sessions for
-- fatigue limits, driver photo (identity) checks, incident reports with evidence, account restrictions (suspend / ban) and appeals.
-- Additive and backward compatible: the API checks for these (lib/safety.ts safetyReady) and keeps the features off, or answers
-- migration_pending, until they exist.

-- Up to 5 people a rider (or driver) trusts: [{ name, phone }]. They get the live trip link on SOS, on an unanswered check-in and,
-- if the person chooses, automatically for every trip or for night trips. users.emergency_contact stays as the first contact.
ALTER TABLE users ADD COLUMN IF NOT EXISTS trusted_contacts jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE users ADD COLUMN IF NOT EXISTS auto_share text NOT NULL DEFAULT 'off';   -- off | night | always

-- "Are you OK?" during a trip: raised by a long stop, a route deviation or ops. Unanswered → escalated to an SOS alert.
CREATE TABLE IF NOT EXISTS safety_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason       text NOT NULL,                       -- long_stop | route_deviation | ops
  status       text NOT NULL DEFAULT 'pending',     -- pending | ok | help | escalated
  detail       jsonb,
  created_at   timestamptz NOT NULL DEFAULT now(),
  answered_at  timestamptz,
  escalated_at timestamptz,
  sos_id       uuid REFERENCES sos_alerts(id)
);
CREATE INDEX IF NOT EXISTS safety_checks_trip_idx ON safety_checks (trip_id, created_at);
CREATE INDEX IF NOT EXISTS safety_checks_pending_idx ON safety_checks (status, created_at) WHERE status = 'pending';

-- Time online, for fatigue limits (max hours in 24 h, breaks). One open row (ended_at NULL) while the driver is online.
CREATE TABLE IF NOT EXISTS driver_online_sessions (
  id          bigserial PRIMARY KEY,
  driver_id   uuid NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz,
  end_reason  text,                                 -- driver | fatigue | no_signal | blocked | sync
  warned_at   timestamptz
);
CREATE INDEX IF NOT EXISTS driver_online_sessions_idx ON driver_online_sessions (driver_id, started_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS driver_online_sessions_open_idx ON driver_online_sessions (driver_id) WHERE ended_at IS NULL;

-- Photo check before going online (daily by default, when switched on): a selfie reviewed by DingoGo or matched by a provider.
CREATE TABLE IF NOT EXISTS identity_checks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    uuid NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
  photo_url    text NOT NULL,
  method       text NOT NULL,                       -- photo_review | face_match
  status       text NOT NULL DEFAULT 'pending',     -- pending | approved | rejected
  match_score  numeric(4,3),
  note         text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  reviewed_by  uuid REFERENCES users(id),
  reviewed_at  timestamptz
);
CREATE INDEX IF NOT EXISTS identity_checks_driver_idx ON identity_checks (driver_id, created_at DESC);
CREATE INDEX IF NOT EXISTS identity_checks_status_idx ON identity_checks (status, created_at);

-- Safety reports from riders and drivers, with a category, severity and evidence ([{ file_url }], the reporter's own uploads).
CREATE TABLE IF NOT EXISTS incident_reports (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref           text UNIQUE NOT NULL,
  reporter_id   uuid NOT NULL REFERENCES users(id),
  reporter_role text NOT NULL,                      -- rider | driver
  trip_id       uuid REFERENCES trips(id),
  subject_id    uuid REFERENCES users(id),          -- the other person on the trip, when there is one
  category      text NOT NULL,
  severity      text NOT NULL,                      -- critical | high | normal
  description   text NOT NULL,
  evidence      jsonb NOT NULL DEFAULT '[]'::jsonb,
  status        text NOT NULL DEFAULT 'open',       -- open | investigating | actioned | closed
  outcome       text,                               -- shown to the reporter (no details of action taken against anyone)
  handled_by    uuid REFERENCES users(id),
  held          boolean NOT NULL DEFAULT false,     -- the subject's account was put on hold when this was reported
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS incident_reports_status_idx ON incident_reports (status, created_at DESC);
CREATE INDEX IF NOT EXISTS incident_reports_subject_idx ON incident_reports (subject_id);
CREATE INDEX IF NOT EXISTS incident_reports_reporter_idx ON incident_reports (reporter_id, created_at DESC);

-- Account standing: every suspension, ban, warning and lift, with the reason shown to the person and a private note.
CREATE TABLE IF NOT EXISTS account_actions (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action        text NOT NULL,                      -- suspend | ban | warning | lift
  reason_code   text NOT NULL,
  public_reason text NOT NULL,
  note          text,
  until         timestamptz,                        -- suspensions with an end date lift themselves
  incident_id   uuid REFERENCES incident_reports(id),
  by_id         uuid REFERENCES users(id),          -- NULL = automatic (critical report hold, suspension ended)
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_actions_user_idx ON account_actions (user_id, created_at DESC);

-- Asking DingoGo to look again at a suspension or ban. One pending appeal per person.
CREATE TABLE IF NOT EXISTS appeals (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  action_id     uuid REFERENCES account_actions(id),
  message       text NOT NULL,
  status        text NOT NULL DEFAULT 'pending',    -- pending | upheld | overturned
  decision_note text,
  decided_by    uuid REFERENCES users(id),
  decided_at    timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS appeals_one_pending_idx ON appeals (user_id) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS appeals_status_idx ON appeals (status, created_at);
