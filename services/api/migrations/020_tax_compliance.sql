-- Round 16: tax, compliance and reporting.
-- Driver tax identity for the ATO Sharing Economy Reporting Regime (SERR), levy return lodgements, a register of privacy (APP)
-- requests, and tax identities kept for 5 years after a driver deletes their account.
-- Additive and backward compatible: the API checks for these (lib/tax.ts taxReady) and the SERR report shows the details as
-- missing, privacy requests are not recorded and lodgements say migration_pending until they exist.

-- What the ATO needs about each seller (driver) under SERR. Individuals: given/family name, date of birth, address; entities
-- (a driver trading through a company or trust): business name and ABN. Email, phone and bank details are already on users/drivers.
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS seller_type text NOT NULL DEFAULT 'individual';   -- individual | entity
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS given_name text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS family_name text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS date_of_birth date;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS business_name text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS address_line text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS suburb text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS postcode text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS address_state text;
ALTER TABLE drivers ADD COLUMN IF NOT EXISTS tax_details_updated_at timestamptz;

-- Monthly passenger levy returns (NT now, SA later): what was lodged, when and the government's reference.
CREATE TABLE IF NOT EXISTS levy_lodgements (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state       text NOT NULL,
  month       text NOT NULL,                       -- YYYY-MM
  trips       integer NOT NULL,
  amount_cents integer NOT NULL,
  reference   text,
  lodged_at   timestamptz NOT NULL DEFAULT now(),
  lodged_by   uuid REFERENCES users(id),
  UNIQUE (state, month)
);

-- Australian Privacy Principles: every access, correction and deletion request (self-service ones are recorded automatically),
-- with the 30-day response time (APP 12.4 / 13.5).
CREATE TABLE IF NOT EXISTS privacy_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref          text UNIQUE,
  user_id      uuid REFERENCES users(id) ON DELETE SET NULL,
  kind         text NOT NULL,                      -- access | correction | deletion | complaint
  channel      text NOT NULL DEFAULT 'app',        -- app | email | phone | letter | in_person
  status       text NOT NULL DEFAULT 'open',       -- open | completed | refused
  requester    text,                               -- who asked, when not the signed-in person (e.g. "J. Smith by email")
  details      text,
  outcome      text,
  received_at  timestamptz NOT NULL DEFAULT now(),
  due_at       timestamptz NOT NULL DEFAULT now() + interval '30 days',
  completed_at timestamptz,
  handled_by   uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS privacy_requests_status_idx ON privacy_requests (status, due_at);

-- A deleted driver's tax identity, kept only as long as the ATO requires (5 years) for SERR and tax records, then purged.
CREATE TABLE IF NOT EXISTS retained_tax_identities (
  driver_id    uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  identity     jsonb NOT NULL,
  deleted_at   timestamptz NOT NULL DEFAULT now(),
  purge_after  date NOT NULL
);
