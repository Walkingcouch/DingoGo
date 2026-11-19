-- Round 19: tours, hire and tourism. Tour products (itinerary with cultural protocols, season, start times, notice, heat rule,
-- hotel pickup, Aboriginal guide and fee, deposit, visitor-language text), heat / closure advisories, Aboriginal guides and
-- what they are owed, hotel and visitor-centre commissions, hire quotes customers accept online.
-- Additive and re-runnable; the API keeps the old behaviour until this exists (services/tours.ts `toursReady()`).

ALTER TABLE tour_packages
  ADD COLUMN IF NOT EXISTS itinerary        jsonb    NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS season_months    smallint[] NOT NULL DEFAULT '{1,2,3,4,5,6,7,8,9,10,11,12}',
  ADD COLUMN IF NOT EXISTS days             smallint[] NOT NULL DEFAULT '{0,1,2,3,4,5,6}',
  ADD COLUMN IF NOT EXISTS start_times      text[]   NOT NULL DEFAULT '{08:00}',
  ADD COLUMN IF NOT EXISTS min_notice_hours integer  NOT NULL DEFAULT 12 CHECK (min_notice_hours > 0),
  ADD COLUMN IF NOT EXISTS heat_sensitive   boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS hotel_pickup     boolean  NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS guided_by        text     NOT NULL DEFAULT 'driver' CHECK (guided_by IN ('driver','aboriginal_guide')),
  ADD COLUMN IF NOT EXISTS guide_fee_cents  integer  NOT NULL DEFAULT 0 CHECK (guide_fee_cents >= 0),
  ADD COLUMN IF NOT EXISTS deposit_pct      smallint CHECK (deposit_pct IS NULL OR deposit_pct BETWEEN 0 AND 100),
  ADD COLUMN IF NOT EXISTS translations     jsonb    NOT NULL DEFAULT '{}'::jsonb;

-- Heat, closure, fire, flood, road and water advisories for outback tours (empty tour_ids = every tour).
CREATE TABLE IF NOT EXISTS tour_advisories (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind         text NOT NULL CHECK (kind IN ('heat','closure','fire','flood','road','water')),
  title        text NOT NULL,
  message      text NOT NULL,
  starts_on    date NOT NULL,
  ends_on      date NOT NULL CHECK (ends_on >= starts_on),
  tour_ids     uuid[] NOT NULL DEFAULT '{}',
  latest_start text CHECK (latest_start IS NULL OR latest_start ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  closes       boolean NOT NULL DEFAULT false,
  active       boolean NOT NULL DEFAULT true,
  notified     integer NOT NULL DEFAULT 0,
  created_by   uuid REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tour_advisories_days_idx ON tour_advisories (ends_on) WHERE active;

-- Aboriginal guides DingoGo works with (paid per tour). Name shown to guests only with consent.
CREATE TABLE IF NOT EXISTS tour_guides (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  phone         text,
  email         text,
  community     text,             -- language group / community, as the guide wants it written
  bio           text,
  show_name     boolean NOT NULL DEFAULT false,
  abn           text CHECK (abn IS NULL OR abn ~ '^\d{11}$'),
  bank_ref      text,             -- how they are paid (reference only; no account numbers here)
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- One guide per guided tour booking; owed on completion (or a share of a late-cancellation fee); paid by admin.
CREATE TABLE IF NOT EXISTS tour_guide_jobs (
  trip_id     uuid PRIMARY KEY REFERENCES trips(id),
  guide_id    uuid NOT NULL REFERENCES tour_guides(id),
  fee_cents   integer NOT NULL CHECK (fee_cents >= 0),
  owed_cents  integer NOT NULL DEFAULT 0,
  status      text NOT NULL DEFAULT 'assigned' CHECK (status IN ('assigned','owed','paid','cancelled')),
  assigned_by uuid REFERENCES users(id),
  assigned_at timestamptz NOT NULL DEFAULT now(),
  owed_at     timestamptz,
  paid_at     timestamptz,
  paid_ref    text,
  paid_by     uuid REFERENCES users(id)
);
CREATE INDEX IF NOT EXISTS tour_guide_jobs_guide_idx ON tour_guide_jobs (guide_id, status);

-- Hotels, visitor centres and tour desks that book tours for guests: commission per booking, and the business account billed.
ALTER TABLE partners
  ADD COLUMN IF NOT EXISTS tour_commission_pct  numeric(5,2) NOT NULL DEFAULT 0 CHECK (tour_commission_pct BETWEEN 0 AND 50),
  ADD COLUMN IF NOT EXISTS corporate_account_id uuid REFERENCES corporate_accounts(id);

CREATE TABLE IF NOT EXISTS tour_commissions (
  trip_id     uuid PRIMARY KEY REFERENCES trips(id),
  partner_id  uuid NOT NULL REFERENCES partners(id),
  booked_by   uuid REFERENCES users(id),
  pct         numeric(5,2) NOT NULL,
  base_cents  integer NOT NULL,
  cents       integer NOT NULL,
  status      text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','earned','void','paid')),
  earned_at   timestamptz,
  paid_at     timestamptz,
  paid_ref    text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS tour_commissions_partner_idx ON tour_commissions (partner_id, status, earned_at);

-- Hire quotes sent to the customer with a private link to accept.
ALTER TABLE hire_requests
  ADD COLUMN IF NOT EXISTS quote            jsonb,
  ADD COLUMN IF NOT EXISTS quote_token      text,
  ADD COLUMN IF NOT EXISTS quote_sent_at    timestamptz,
  ADD COLUMN IF NOT EXISTS quote_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS start_date       date,
  ADD COLUMN IF NOT EXISTS accepted_at      timestamptz,
  ADD COLUMN IF NOT EXISTS accepted_name    text;
CREATE UNIQUE INDEX IF NOT EXISTS hire_requests_quote_token_idx ON hire_requests (quote_token) WHERE quote_token IS NOT NULL;
