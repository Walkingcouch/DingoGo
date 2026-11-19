-- Round 20: fleet and EV programme. Car agreements (weekly lease, rent-to-own) with weekly deductions and arrears, maintenance
-- jobs with downtime and spare cars, charging reimbursement amounts, insurance policies and claims, investor shares per car.
-- Additive and re-runnable. Until it is applied the API keeps the old lease run (capped at the driver's balance) and the new
-- admin parts answer 503 migration_pending.

ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS purchase_price_cents integer CHECK (purchase_price_cents IS NULL OR purchase_price_cents >= 0);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS purchase_date date;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS finance_weekly_cents integer NOT NULL DEFAULT 0 CHECK (finance_weekly_cents >= 0);
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS spare boolean NOT NULL DEFAULT false;     -- kept free as a spare car

ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS reimburse_cents integer;          -- what the rules pay (null = not reimbursed)
ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS rule text;                        -- home_tariff | public_at_cost | public_capped | depot | driver_owned | ...
ALTER TABLE charging_sessions ADD COLUMN IF NOT EXISTS receipt_ref text;

CREATE TABLE IF NOT EXISTS fleet_contracts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  driver_id       uuid NOT NULL REFERENCES drivers(user_id),
  kind            text NOT NULL CHECK (kind IN ('weekly_lease','rent_to_own')),
  status          text NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','ended','bought_out')),
  weekly_cents    integer NOT NULL CHECK (weekly_cents BETWEEN 0 AND 200000),
  starts_on       date NOT NULL,
  ends_on         date,
  term_weeks      integer CHECK (term_weeks IS NULL OR term_weeks BETWEEN 1 AND 520),
  price_cents     integer CHECK (price_cents IS NULL OR price_cents >= 0),        -- rent-to-own: total to own the car
  deposit_cents   integer NOT NULL DEFAULT 0 CHECK (deposit_cents >= 0),
  catch_up_pct    integer NOT NULL DEFAULT 150 CHECK (catch_up_pct BETWEEN 100 AND 300),  -- most taken in one week, % of the weekly amount
  keep_min_cents  integer NOT NULL DEFAULT 0 CHECK (keep_min_cents >= 0),        -- always left in the driver's balance
  km_per_week     integer CHECK (km_per_week IS NULL OR km_per_week > 0),
  notes           text,
  paused_reason   text,
  end_reason      text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz
);
CREATE UNIQUE INDEX IF NOT EXISTS fleet_contracts_live_vehicle ON fleet_contracts (vehicle_id) WHERE status IN ('active','paused');
CREATE UNIQUE INDEX IF NOT EXISTS fleet_contracts_live_driver ON fleet_contracts (driver_id) WHERE status IN ('active','paused');

-- One row per contract per Darwin week: what was due and what the deduction took.
CREATE TABLE IF NOT EXISTS fleet_contract_weeks (
  contract_id     uuid NOT NULL REFERENCES fleet_contracts(id) ON DELETE CASCADE,
  week_start      date NOT NULL,
  due_cents       integer NOT NULL,
  collected_cents integer NOT NULL,
  balance_before_cents integer,
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contract_id, week_start)
);

-- Money outside the weekly run: deposit, payments by bank, buy-out, waived arrears.
CREATE TABLE IF NOT EXISTS fleet_contract_payments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES fleet_contracts(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('deposit','payment','buy_out','waiver')),
  cents       integer NOT NULL CHECK (cents >= 0),
  method      text,              -- bank | balance
  reference   text,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fleet_contract_payments_idx ON fleet_contract_payments (contract_id, created_at);

CREATE TABLE IF NOT EXISTS vehicle_maintenance (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id      uuid NOT NULL REFERENCES vehicles(id),
  kind            text NOT NULL CHECK (kind IN ('service','tyres','brakes','battery_check','repair','inspection','other')),
  status          text NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','off_road','done','cancelled')),
  booked_for      date,
  started_at      timestamptz,     -- off road from
  finished_at     timestamptz,     -- back on the road / done
  odometer_km     integer,
  cost_cents      integer NOT NULL DEFAULT 0 CHECK (cost_cents >= 0),
  provider        text,
  notes           text,
  driver_id       uuid REFERENCES drivers(user_id),      -- the car's driver when it went off road
  spare_vehicle_id uuid REFERENCES vehicles(id),
  claim_id        uuid,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS vehicle_maintenance_vehicle_idx ON vehicle_maintenance (vehicle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vehicle_maintenance_open_idx ON vehicle_maintenance (status) WHERE status IN ('booked','off_road');

CREATE TABLE IF NOT EXISTS fleet_insurance (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id    uuid NOT NULL REFERENCES vehicles(id),
  insurer       text NOT NULL,
  policy_no     text NOT NULL,
  cover         text NOT NULL DEFAULT 'comprehensive' CHECK (cover IN ('comprehensive','third_party_property','ctp','public_liability','other')),
  starts_on     date NOT NULL,
  ends_on       date NOT NULL,
  premium_cents integer NOT NULL DEFAULT 0 CHECK (premium_cents >= 0),   -- for the whole period
  excess_cents  integer NOT NULL DEFAULT 0 CHECK (excess_cents >= 0),
  notes         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_on >= starts_on)
);
CREATE INDEX IF NOT EXISTS fleet_insurance_vehicle_idx ON fleet_insurance (vehicle_id, ends_on DESC);

CREATE TABLE IF NOT EXISTS fleet_claims (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id           uuid NOT NULL REFERENCES vehicles(id),
  policy_id            uuid REFERENCES fleet_insurance(id),
  driver_id            uuid REFERENCES drivers(user_id),
  trip_id              uuid REFERENCES trips(id),
  incident_at          timestamptz NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('collision','animal','windscreen','hail','theft','vandalism','other')),
  description          text NOT NULL,
  status               text NOT NULL DEFAULT 'open' CHECK (status IN ('open','lodged','approved','declined','paid','closed')),
  claim_no             text,
  at_fault             boolean,
  excess_cents         integer NOT NULL DEFAULT 0 CHECK (excess_cents >= 0),
  driver_contribution_cents integer NOT NULL DEFAULT 0 CHECK (driver_contribution_cents >= 0),
  repair_cost_cents    integer NOT NULL DEFAULT 0 CHECK (repair_cost_cents >= 0),
  payout_cents         integer NOT NULL DEFAULT 0 CHECK (payout_cents >= 0),
  notes                text,
  created_by           uuid REFERENCES users(id),
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fleet_claims_vehicle_idx ON fleet_claims (vehicle_id, incident_at DESC);

CREATE TABLE IF NOT EXISTS fleet_investors (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  email       text,
  abn         text,
  payment_ref text,
  notes       text,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fleet_investor_shares (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  investor_id uuid NOT NULL REFERENCES fleet_investors(id) ON DELETE CASCADE,
  vehicle_id  uuid NOT NULL REFERENCES vehicles(id),
  share_pct   numeric(5,2) NOT NULL CHECK (share_pct > 0 AND share_pct <= 100),
  starts_on   date NOT NULL,
  ends_on     date,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS fleet_investor_shares_vehicle_idx ON fleet_investor_shares (vehicle_id);

-- Cars already leased to a driver get a weekly-lease agreement with the same weekly amount, from today.
INSERT INTO fleet_contracts (vehicle_id, driver_id, kind, weekly_cents, starts_on, notes)
SELECT DISTINCT ON (v.id) v.id, d.user_id, 'weekly_lease', v.lease_weekly_cents, (now() AT TIME ZONE 'Australia/Darwin')::date,
       'Set up from the car''s weekly lease (migration 024)'
FROM vehicles v JOIN drivers d ON d.vehicle_id = v.id
WHERE v.ownership = 'leased_to_driver' AND v.lease_weekly_cents > 0
  AND NOT EXISTS (SELECT 1 FROM fleet_contracts c WHERE (c.vehicle_id = v.id OR c.driver_id = d.user_id) AND c.status IN ('active','paused'))
ORDER BY v.id, d.user_id;
