-- Round 24: business and government customers. Self-serve applications on corporate_accounts; cost centres, purpose codes and
-- booking rules; business fields and approvals on trips; issued monthly invoices with payment and reminders; recurring trips.
-- Additive and re-runnable. Until it is applied the API keeps accounts, bookings and the live statement working and the new parts
-- answer 503 migration_pending.

ALTER TABLE corporate_accounts
  ADD COLUMN IF NOT EXISTS status        text NOT NULL DEFAULT 'approved',      -- pending | approved | declined
  ADD COLUMN IF NOT EXISTS application   jsonb,                                  -- what the applicant asked for
  ADD COLUMN IF NOT EXISTS applied_at    timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_at   timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_by   uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_note   text,
  ADD COLUMN IF NOT EXISTS contact_name  text,
  ADD COLUMN IF NOT EXISTS contact_phone text,
  ADD COLUMN IF NOT EXISTS address       text,
  ADD COLUMN IF NOT EXISTS booking_rules jsonb NOT NULL DEFAULT '{}'::jsonb;
CREATE INDEX IF NOT EXISTS corporate_accounts_status_idx ON corporate_accounts (status, applied_at);

CREATE TABLE IF NOT EXISTS account_cost_centres (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id          uuid NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
  code                text NOT NULL,
  name                text NOT NULL,
  approver_id         uuid REFERENCES users(id) ON DELETE SET NULL,
  monthly_budget_cents integer,
  active              boolean NOT NULL DEFAULT true,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, code)
);

CREATE TABLE IF NOT EXISTS account_purposes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id uuid NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
  code       text NOT NULL,
  label      text NOT NULL,
  active     boolean NOT NULL DEFAULT true,
  UNIQUE (account_id, code)
);

CREATE TABLE IF NOT EXISTS account_recurring_trips (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref           text NOT NULL,
  account_id    uuid NOT NULL REFERENCES corporate_accounts(id) ON DELETE CASCADE,
  created_by    uuid REFERENCES users(id) ON DELETE SET NULL,
  rider_id      uuid NOT NULL REFERENCES users(id),
  consent_id    uuid REFERENCES client_consents(id) ON DELETE SET NULL,
  pickup        jsonb NOT NULL,
  dropoff       jsonb NOT NULL,
  weekdays      smallint[] NOT NULL,                  -- 1 = Monday … 7 = Sunday (Darwin)
  pickup_time   text NOT NULL,                        -- HH:MM Darwin
  return_time   text,                                 -- HH:MM: a trip back the same day
  starts_on     date NOT NULL,
  ends_on       date,
  skip_holidays boolean NOT NULL DEFAULT true,
  skip_dates    date[] NOT NULL DEFAULT '{}',
  options       jsonb NOT NULL DEFAULT '{}'::jsonb,   -- cost centre, purpose, PO, NDIS number, notes, wheelchair, animal, passengers
  active        boolean NOT NULL DEFAULT true,
  stopped_reason text,
  booked_through date,
  last_run      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_recurring_account_idx ON account_recurring_trips (account_id, active);

ALTER TABLE trips
  ADD COLUMN IF NOT EXISTS cost_centre_id  uuid REFERENCES account_cost_centres(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS purpose_code    text,
  ADD COLUMN IF NOT EXISTS po_number       text,
  ADD COLUMN IF NOT EXISTS approval_status text,                               -- pending | approved | declined (null: not needed)
  ADD COLUMN IF NOT EXISTS approval_by     uuid REFERENCES users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS approval_at     timestamptz,
  ADD COLUMN IF NOT EXISTS recurring_id    uuid REFERENCES account_recurring_trips(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS trips_approval_idx ON trips (corporate_account_id, approval_status) WHERE approval_status = 'pending';
CREATE UNIQUE INDEX IF NOT EXISTS trips_recurring_once_idx ON trips (recurring_id, scheduled_for) WHERE recurring_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS account_invoices (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  number           text NOT NULL UNIQUE,
  account_id       uuid NOT NULL REFERENCES corporate_accounts(id),
  month            text NOT NULL,                       -- YYYY-MM (Darwin)
  po_number        text NOT NULL DEFAULT '',            -- '' unless the account has one invoice per PO
  issued_on        date NOT NULL,
  due_on           date NOT NULL,
  charges_cents    integer NOT NULL,
  refunds_cents    integer NOT NULL DEFAULT 0,
  total_cents      integer NOT NULL,
  gst_cents        integer NOT NULL,
  bill_to          jsonb NOT NULL,
  lines            jsonb NOT NULL,
  status           text NOT NULL DEFAULT 'issued',      -- issued | paid | void
  paid_on          date,
  paid_ref         text,
  void_reason      text,
  reminders        integer NOT NULL DEFAULT 0,
  last_reminder_on date,
  created_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  updated_by       uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS account_invoices_once_idx ON account_invoices (account_id, month, po_number) WHERE status <> 'void';
CREATE INDEX IF NOT EXISTS account_invoices_open_idx ON account_invoices (status, due_on);
