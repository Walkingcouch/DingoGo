-- Round 28: remote and regional reach. Drivers opt in to long trips; scheduled shared shuttles to communities with seat bookings
-- and parcels for community store pickup points; community store top-ups of DingoGo credit for cash.
-- Additive and re-runnable. Until it is applied: community routes, prices and the low-data page's notes still show, long trips
-- and shuttles answer 503 migration_pending, and booking texts get "call us".

ALTER TABLE drivers ADD COLUMN IF NOT EXISTS long_trips boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS regional_runs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref             text UNIQUE NOT NULL,                       -- SR-XXXXXX
  corridor        text NOT NULL,                              -- regional_policy corridor id
  direction       text NOT NULL CHECK (direction IN ('out','back')),
  departs_at      timestamptz NOT NULL,
  seats           integer NOT NULL CHECK (seats BETWEEN 1 AND 12),
  parcel_capacity integer NOT NULL DEFAULT 0 CHECK (parcel_capacity BETWEEN 0 AND 40),
  status          text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed','departed','completed','cancelled')),
  driver_id       uuid REFERENCES users(id) ON DELETE SET NULL,
  notes           text,
  last_checkin_at timestamptz,
  alerts          jsonb NOT NULL DEFAULT '{}'::jsonb,         -- which safety alerts were raised (once each)
  created_by      uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  departed_at     timestamptz,
  completed_at    timestamptz,
  cancelled_at    timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS regional_runs_slot_idx ON regional_runs (corridor, direction, departs_at) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS regional_runs_due_idx ON regional_runs (status, departs_at);
CREATE INDEX IF NOT EXISTS regional_runs_driver_idx ON regional_runs (driver_id, departs_at);

CREATE TABLE IF NOT EXISTS regional_bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref             text UNIQUE NOT NULL,                       -- SB-XXXXXX
  run_id          uuid NOT NULL REFERENCES regional_runs(id),
  kind            text NOT NULL CHECK (kind IN ('seat','parcel')),
  user_id         uuid NOT NULL REFERENCES users(id),
  seats           integer NOT NULL DEFAULT 0 CHECK (seats BETWEEN 0 AND 8),
  pickup_point    text,
  dropoff_point   text,
  parcel          jsonb,                                      -- size, description, recipient name and phone
  collect_code_hash text,                                     -- sha256 of the store collection code (parcels)
  price_cents     integer NOT NULL DEFAULT 0,
  payment_method  text NOT NULL CHECK (payment_method IN ('wallet','corporate')),
  corporate_account_id uuid REFERENCES corporate_accounts(id),
  paid_cents      integer NOT NULL DEFAULT 0,
  refunded_cents  integer NOT NULL DEFAULT 0,
  status          text NOT NULL CHECK (status IN ('pending','booked','boarded','no_show','cancelled','expired','at_store','collected','delivered')),
  channel         text NOT NULL DEFAULT 'app' CHECK (channel IN ('app','sms','web','phone')),
  booked_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  hold_until      timestamptz,                                -- pending: held for the YES until then
  created_at      timestamptz NOT NULL DEFAULT now(),
  confirmed_at    timestamptz,
  cancelled_at    timestamptz,
  boarded_at      timestamptz,
  at_store_at     timestamptz,
  collected_at    timestamptz,
  collected_by_partner uuid REFERENCES partners(id)
);
CREATE INDEX IF NOT EXISTS regional_bookings_run_idx ON regional_bookings (run_id, status);
CREATE INDEX IF NOT EXISTS regional_bookings_user_idx ON regional_bookings (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS regional_bookings_pending_idx ON regional_bookings (user_id, hold_until) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS partner_topups (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref         text UNIQUE NOT NULL,                           -- TU-XXXXXX
  partner_id  uuid NOT NULL REFERENCES partners(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  cents       integer NOT NULL CHECK (cents > 0),
  created_by  uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  voided_at   timestamptz,
  voided_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  settled_at  timestamptz,                                    -- the store paid the cash over to DingoGo
  settled_ref text
);
CREATE INDEX IF NOT EXISTS partner_topups_partner_idx ON partner_topups (partner_id, created_at);
CREATE INDEX IF NOT EXISTS partner_topups_user_idx ON partner_topups (user_id, created_at);
