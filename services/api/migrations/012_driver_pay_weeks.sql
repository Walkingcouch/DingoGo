-- Round 4: weekly earnings floor per engaged hour. One row per driver per week once the week has been settled,
-- so a top-up can never be paid twice (the API refuses to run top-ups until this table exists).
-- Driver pay rates live in settings key 'driver_pay' (defaults in code: nothing changes until an admin switches them on).
CREATE TABLE IF NOT EXISTS driver_pay_weeks (
  driver_id       uuid NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
  week_start      date NOT NULL,                 -- Monday, Australia/Darwin
  trips           integer NOT NULL DEFAULT 0,
  engaged_s       integer NOT NULL DEFAULT 0,    -- accept → end of trip
  earnings_cents  integer NOT NULL DEFAULT 0,    -- fares less fee + pickup pay + fuel surcharge + cancellation fees (no tips)
  rate_cents      integer NOT NULL,              -- floor per engaged hour used
  floor_cents     integer NOT NULL DEFAULT 0,
  topup_cents     integer NOT NULL DEFAULT 0,
  ledger_id       bigint REFERENCES driver_ledger(id),
  run_by          uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, week_start)
);
CREATE INDEX IF NOT EXISTS driver_pay_weeks_week_idx ON driver_pay_weeks (week_start);
CREATE INDEX IF NOT EXISTS driver_ledger_trip_idx ON driver_ledger (trip_id) WHERE trip_id IS NOT NULL;
