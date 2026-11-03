-- DingoGo Rideshare & Courier — core schema (PostgreSQL 14+ / Supabase compatible)
-- Money is stored in integer cents (AUD, GST-inclusive). Distances in metres, durations in seconds.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ───────────────────────── Enums ─────────────────────────
CREATE TYPE user_role AS ENUM ('rider', 'driver', 'admin', 'dispatcher', 'partner', 'corporate_admin');
CREATE TYPE trip_kind AS ENUM ('ride', 'courier');
CREATE TYPE trip_status AS ENUM (
  'scheduled', 'requested', 'accepted', 'arrived', 'in_progress',
  'completed', 'cancelled_rider', 'cancelled_driver', 'cancelled_admin', 'no_drivers'
);
CREATE TYPE payment_method AS ENUM ('card', 'cash', 'corporate', 'wallet');
CREATE TYPE payment_status AS ENUM ('none', 'authorised', 'captured', 'failed', 'refunded', 'invoiced', 'cash_collected');
CREATE TYPE driver_status AS ENUM ('applied', 'pending_documents', 'approved', 'suspended', 'rejected');
CREATE TYPE doc_status AS ENUM ('pending', 'approved', 'rejected', 'expired');

-- ───────────────────────── Service areas ─────────────────────────
CREATE TABLE zones (
  id            text PRIMARY KEY,               -- 'alice-springs'
  name          text NOT NULL,
  centre_lat    double precision NOT NULL,
  centre_lng    double precision NOT NULL,
  radius_km     double precision NOT NULL,
  active        boolean NOT NULL DEFAULT false,
  timezone      text NOT NULL DEFAULT 'Australia/Darwin',
  demand_multiplier numeric(4,2) NOT NULL DEFAULT 1.00,  -- manual, capped; no algorithmic surge by default
  launch_note   text
);

-- ───────────────────────── People ─────────────────────────
CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  phone           text UNIQUE NOT NULL,
  email           text,
  name            text NOT NULL DEFAULT '',
  role            user_role NOT NULL DEFAULT 'rider',
  partner_id      uuid,                          -- set for cafe/partner staff
  language        text NOT NULL DEFAULT 'en',    -- 'en', 'arr' (Arrernte) …
  accessibility   jsonb NOT NULL DEFAULT '{}'::jsonb, -- {wheelchair, assistance_animal, hearing, vision, notes}
  emergency_contact jsonb,                       -- {name, phone}
  referral_code   text UNIQUE NOT NULL,
  referred_by     uuid REFERENCES users(id),
  loyalty_points  integer NOT NULL DEFAULT 0 CHECK (loyalty_points >= 0),
  wallet_cents    integer NOT NULL DEFAULT 0,
  marketing_opt_in boolean NOT NULL DEFAULT false,  -- Spam Act: explicit consent only
  rating_avg      numeric(3,2),
  rating_count    integer NOT NULL DEFAULT 0,
  blocked         boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now(),
  deleted_at      timestamptz                    -- soft delete for privacy requests
);

CREATE TABLE otp_codes (
  phone       text PRIMARY KEY,
  code_hash   text NOT NULL,
  expires_at  timestamptz NOT NULL,
  attempts    integer NOT NULL DEFAULT 0
);

CREATE TABLE push_tokens (
  user_id   uuid REFERENCES users(id) ON DELETE CASCADE,
  token     text NOT NULL,
  platform  text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, token)
);

CREATE TABLE vehicles (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rego             text UNIQUE NOT NULL,
  make             text NOT NULL DEFAULT 'BYD',
  model            text NOT NULL DEFAULT 'Dolphin',
  year             integer NOT NULL,
  colour           text NOT NULL,
  seats            integer NOT NULL DEFAULT 4,
  battery_kwh      numeric(5,1) NOT NULL DEFAULT 60.5,
  range_km         integer NOT NULL DEFAULT 427,       -- rated range; dispatch derates for heat
  pet_friendly     boolean NOT NULL DEFAULT false,
  wheelchair_accessible boolean NOT NULL DEFAULT false,
  has_roof_display boolean NOT NULL DEFAULT false,
  display_key      text UNIQUE,                         -- secret used by roof LED player
  ownership        text NOT NULL DEFAULT 'fleet',       -- fleet | leased_to_driver | driver_owned
  lease_weekly_cents integer NOT NULL DEFAULT 0,
  rego_expiry      date,
  inspection_expiry date,
  insurance_expiry date,
  battery_pct      integer,
  odometer_km      integer,
  active           boolean NOT NULL DEFAULT true,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE drivers (
  user_id          uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status           driver_status NOT NULL DEFAULT 'applied',
  zone_id          text REFERENCES zones(id) DEFAULT 'alice-springs',
  vehicle_id       uuid REFERENCES vehicles(id),
  licence_no       text,
  licence_expiry   date,
  cpv_authority_no text,                -- NT commercial passenger vehicle driver authority
  cpv_expiry       date,
  abn              text,
  gst_registered   boolean NOT NULL DEFAULT false,  -- ATO: rideshare drivers must register from $1
  bank_bsb         text,
  bank_account     text,
  languages        text[] NOT NULL DEFAULT ARRAY['en'],
  bio              text,
  online           boolean NOT NULL DEFAULT false,
  accepts_courier  boolean NOT NULL DEFAULT true,
  accepts_pets     boolean NOT NULL DEFAULT false,
  lat              double precision,
  lng              double precision,
  heading          double precision,
  last_seen_at     timestamptz,
  commission_pct   numeric(4,1) NOT NULL DEFAULT 20.0,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX drivers_online_idx ON drivers (online, status);

CREATE TABLE driver_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid NOT NULL REFERENCES drivers(user_id) ON DELETE CASCADE,
  type        text NOT NULL,   -- licence | cpv_authority | police_check | medical | wwcc | abn | insurance | vehicle_inspection | first_aid
  file_url    text,
  number      text,
  expires_at  date,
  status      doc_status NOT NULL DEFAULT 'pending',
  reviewer_id uuid REFERENCES users(id),
  reviewed_at timestamptz,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Pricing ─────────────────────────
CREATE TABLE fare_rules (
  service        text PRIMARY KEY,   -- ride | pet | courier_s | courier_m | courier_l | tour | hourly
  label          text NOT NULL,
  base_cents     integer NOT NULL,
  per_km_cents   integer NOT NULL,
  per_min_cents  integer NOT NULL,
  booking_fee_cents integer NOT NULL DEFAULT 0,
  min_fare_cents integer NOT NULL,
  cancel_fee_cents integer NOT NULL DEFAULT 0,
  free_wait_min  integer NOT NULL DEFAULT 3,
  wait_per_min_cents integer NOT NULL DEFAULT 0,
  night_pct      integer NOT NULL DEFAULT 0,      -- 10pm–5am surcharge %
  holiday_pct    integer NOT NULL DEFAULT 0,      -- NT public holidays
  active         boolean NOT NULL DEFAULT true,
  description    text
);

CREATE TABLE public_holidays (day date PRIMARY KEY, name text NOT NULL);

CREATE TABLE promo_codes (
  code          text PRIMARY KEY,
  kind          text NOT NULL CHECK (kind IN ('percent', 'fixed')),
  value         integer NOT NULL,         -- percent (0-100) or cents
  max_discount_cents integer,
  max_uses      integer,
  uses          integer NOT NULL DEFAULT 0,
  per_user_limit integer NOT NULL DEFAULT 1,
  first_trip_only boolean NOT NULL DEFAULT false,
  valid_from    timestamptz,
  valid_to      timestamptz,
  active        boolean NOT NULL DEFAULT true,
  description   text
);

-- ───────────────────────── Corporate / B2B ─────────────────────────
CREATE TABLE corporate_accounts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  abn           text,
  billing_email text NOT NULL,
  monthly_limit_cents integer,
  invoice_terms_days integer NOT NULL DEFAULT 14,
  discount_pct  integer NOT NULL DEFAULT 0,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE corporate_members (
  account_id uuid REFERENCES corporate_accounts(id) ON DELETE CASCADE,
  user_id    uuid REFERENCES users(id) ON DELETE CASCADE,
  role       text NOT NULL DEFAULT 'member',  -- member | manager
  PRIMARY KEY (account_id, user_id)
);

-- ───────────────────────── Tours & hire ─────────────────────────
CREATE TABLE tour_packages (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug          text UNIQUE NOT NULL,
  name          text NOT NULL,
  summary       text NOT NULL,
  description   text NOT NULL,
  duration_min  integer NOT NULL,
  price_cents   integer NOT NULL,       -- per vehicle (up to max_passengers)
  max_passengers integer NOT NULL DEFAULT 4,
  stops         jsonb NOT NULL DEFAULT '[]'::jsonb,
  cultural_note text,
  requires_permit boolean NOT NULL DEFAULT false,
  image_url     text,
  active        boolean NOT NULL DEFAULT true
);

CREATE TABLE hire_requests (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid REFERENCES users(id),
  kind         text NOT NULL,     -- event | corporate | wedding | conference | festival | other
  contact_name text NOT NULL,
  contact_email text NOT NULL,
  contact_phone text,
  organisation text,
  event_date   date,
  passengers   integer,
  vehicles     integer,
  details      text,
  status       text NOT NULL DEFAULT 'new',  -- new | quoted | confirmed | declined
  quote_cents  integer,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Trips ─────────────────────────
CREATE TABLE trips (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ref              text UNIQUE NOT NULL,        -- human-friendly e.g. DG-7KX2Q
  kind             trip_kind NOT NULL,
  service          text NOT NULL REFERENCES fare_rules(service),
  status           trip_status NOT NULL,
  zone_id          text REFERENCES zones(id),
  rider_id         uuid NOT NULL REFERENCES users(id),
  driver_id        uuid REFERENCES drivers(user_id),
  vehicle_id       uuid REFERENCES vehicles(id),
  corporate_account_id uuid REFERENCES corporate_accounts(id),
  tour_package_id  uuid REFERENCES tour_packages(id),
  pickup_lat       double precision NOT NULL,
  pickup_lng       double precision NOT NULL,
  pickup_address   text NOT NULL,
  dropoff_lat      double precision NOT NULL,
  dropoff_lng      double precision NOT NULL,
  dropoff_address  text NOT NULL,
  passengers       integer NOT NULL DEFAULT 1,
  has_pet          boolean NOT NULL DEFAULT false,
  pet_details      text,
  needs_wheelchair boolean NOT NULL DEFAULT false,
  assistance_animal boolean NOT NULL DEFAULT false,
  notes            text,
  scheduled_for    timestamptz,
  est_distance_m   integer NOT NULL,
  est_duration_s   integer NOT NULL,
  actual_distance_m integer,
  quote_cents      integer NOT NULL,
  fare_breakdown   jsonb NOT NULL,
  final_cents      integer,
  discount_cents   integer NOT NULL DEFAULT 0,
  points_redeemed  integer NOT NULL DEFAULT 0,
  promo_code       text REFERENCES promo_codes(code),
  tip_cents        integer NOT NULL DEFAULT 0,
  cancel_fee_cents integer NOT NULL DEFAULT 0,
  payment_method   payment_method NOT NULL DEFAULT 'card',
  payment_status   payment_status NOT NULL DEFAULT 'none',
  payment_ref      text,
  verify_pin       text NOT NULL,                 -- rider tells driver the PIN before starting
  share_token      text UNIQUE NOT NULL,          -- public live-tracking link
  rider_rating     integer CHECK (rider_rating BETWEEN 1 AND 5),   -- rating given BY rider TO driver
  rider_feedback   text,
  driver_rating    integer CHECK (driver_rating BETWEEN 1 AND 5),  -- rating given BY driver TO rider
  cancel_reason    text,
  requested_at     timestamptz NOT NULL DEFAULT now(),
  accepted_at      timestamptz,
  arrived_at       timestamptz,
  started_at       timestamptz,
  completed_at     timestamptz,
  cancelled_at     timestamptz,
  dispatch_attempts integer NOT NULL DEFAULT 0
);
CREATE INDEX trips_rider_idx ON trips (rider_id, requested_at DESC);
CREATE INDEX trips_driver_idx ON trips (driver_id, requested_at DESC);
CREATE INDEX trips_status_idx ON trips (status);

CREATE TABLE parcels (
  trip_id          uuid PRIMARY KEY REFERENCES trips(id) ON DELETE CASCADE,
  size             text NOT NULL CHECK (size IN ('S', 'M', 'L')),
  weight_kg        numeric(5,1),
  description      text NOT NULL,
  declared_value_cents integer,
  sender_name      text NOT NULL,
  sender_phone     text NOT NULL,
  recipient_name   text NOT NULL,
  recipient_phone  text NOT NULL,
  instructions     text,
  leave_unattended boolean NOT NULL DEFAULT false,
  requires_signature boolean NOT NULL DEFAULT false,
  delivery_pin     text NOT NULL,           -- given to recipient by SMS; entered by driver at handover
  prohibited_ack   boolean NOT NULL DEFAULT false,  -- sender confirmed no alcohol / dangerous goods
  picked_up_at     timestamptz,
  delivered_at     timestamptz,
  pod_photo_url    text,
  pod_signature    text,                     -- SVG path / data URL
  pod_received_by  text,
  pod_lat          double precision,
  pod_lng          double precision
);

CREATE TABLE trip_offers (
  trip_id     uuid REFERENCES trips(id) ON DELETE CASCADE,
  driver_id   uuid REFERENCES drivers(user_id) ON DELETE CASCADE,
  status      text NOT NULL DEFAULT 'offered',  -- offered | accepted | declined | expired
  offered_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  pickup_eta_s integer,
  PRIMARY KEY (trip_id, driver_id)
);

CREATE TABLE trip_events (
  id        bigserial PRIMARY KEY,
  trip_id   uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  at        timestamptz NOT NULL DEFAULT now(),
  type      text NOT NULL,
  actor_id  uuid,
  data      jsonb
);
CREATE INDEX trip_events_trip_idx ON trip_events (trip_id, at);

CREATE TABLE trip_track (
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  at      timestamptz NOT NULL DEFAULT now(),
  lat     double precision NOT NULL,
  lng     double precision NOT NULL
);
CREATE INDEX trip_track_idx ON trip_track (trip_id, at);

-- ───────────────────────── Money ─────────────────────────
CREATE TABLE payments (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id      uuid REFERENCES trips(id),
  user_id      uuid REFERENCES users(id),
  provider     text NOT NULL,             -- stripe | mock | cash | corporate | wallet
  provider_ref text,
  kind         text NOT NULL,             -- authorise | capture | refund | cash | invoice | subscription | topup
  amount_cents integer NOT NULL,
  gst_cents    integer NOT NULL DEFAULT 0,
  status       text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE payment_methods (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider     text NOT NULL,
  provider_ref text NOT NULL,
  brand        text,
  last4        text,
  is_default   boolean NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now()
);

-- Driver earnings ledger (positive = owed to driver, negative = owed by driver)
CREATE TABLE driver_ledger (
  id          bigserial PRIMARY KEY,
  driver_id   uuid NOT NULL REFERENCES drivers(user_id),
  trip_id     uuid REFERENCES trips(id),
  kind        text NOT NULL,   -- fare | tip | commission | cash_collected | lease | charging_credit | bonus | payout | adjustment | cancel_fee
  amount_cents integer NOT NULL,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX driver_ledger_idx ON driver_ledger (driver_id, created_at DESC);

-- ───────────────────────── Loyalty, referrals, subscriptions ─────────────────────────
CREATE TABLE partners (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  kind        text NOT NULL DEFAULT 'cafe',
  address     text,
  lat         double precision,
  lng         double precision,
  phone       text,
  email       text,
  logo_url    text,
  aboriginal_owned boolean NOT NULL DEFAULT false,
  settlement_cents_per_redemption integer NOT NULL DEFAULT 0, -- what DingoGo pays the cafe per redemption
  active      boolean NOT NULL DEFAULT true
);
ALTER TABLE users ADD CONSTRAINT users_partner_fk FOREIGN KEY (partner_id) REFERENCES partners(id);

CREATE TABLE rewards (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  partner_id  uuid REFERENCES partners(id),
  title       text NOT NULL,
  description text,
  points_cost integer NOT NULL,
  kind        text NOT NULL DEFAULT 'voucher',  -- voucher | ride_credit
  credit_cents integer,                          -- for ride_credit
  active      boolean NOT NULL DEFAULT true
);

CREATE TABLE reward_redemptions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reward_id   uuid NOT NULL REFERENCES rewards(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  code        text UNIQUE NOT NULL,
  status      text NOT NULL DEFAULT 'issued',   -- issued | redeemed | expired | cancelled
  issued_at   timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  redeemed_at timestamptz,
  redeemed_by uuid REFERENCES users(id)
);

CREATE TABLE loyalty_ledger (
  id        bigserial PRIMARY KEY,
  user_id   uuid NOT NULL REFERENCES users(id),
  points    integer NOT NULL,
  reason    text NOT NULL,
  trip_id   uuid REFERENCES trips(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE referrals (
  referee_id  uuid PRIMARY KEY REFERENCES users(id),
  referrer_id uuid NOT NULL REFERENCES users(id),
  status      text NOT NULL DEFAULT 'pending',  -- pending | rewarded
  created_at  timestamptz NOT NULL DEFAULT now(),
  rewarded_at timestamptz
);

CREATE TABLE plans (
  code        text PRIMARY KEY,
  name        text NOT NULL,
  price_cents integer NOT NULL,     -- per month
  ride_discount_pct integer NOT NULL DEFAULT 0,
  free_deliveries integer NOT NULL DEFAULT 0,
  waive_booking_fee boolean NOT NULL DEFAULT false,
  perks       text[] NOT NULL DEFAULT '{}',
  active      boolean NOT NULL DEFAULT true
);
CREATE TABLE subscriptions (
  user_id     uuid PRIMARY KEY REFERENCES users(id),
  plan_code   text NOT NULL REFERENCES plans(code),
  status      text NOT NULL DEFAULT 'active',   -- active | cancelled | past_due
  period_start timestamptz NOT NULL DEFAULT now(),
  period_end  timestamptz NOT NULL,
  deliveries_used integer NOT NULL DEFAULT 0,
  provider_ref text
);

-- ───────────────────────── Roof LED advertising ─────────────────────────
CREATE TABLE advertisers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  contact_name text,
  email       text NOT NULL,
  phone       text,
  abn         text,
  community   boolean NOT NULL DEFAULT false,  -- free/discounted community-service slots
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ad_campaigns (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  advertiser_id uuid NOT NULL REFERENCES advertisers(id),
  name        text NOT NULL,
  headline    text NOT NULL,
  subline     text,
  bg_colour   text NOT NULL DEFAULT '#E07A1F',
  fg_colour   text NOT NULL DEFAULT '#FFFFFF',
  image_url   text,
  starts_on   date NOT NULL,
  ends_on     date NOT NULL,
  hour_from   integer NOT NULL DEFAULT 0 CHECK (hour_from BETWEEN 0 AND 23),
  hour_to     integer NOT NULL DEFAULT 24 CHECK (hour_to BETWEEN 1 AND 24),
  geo_lat     double precision,
  geo_lng     double precision,
  geo_radius_m integer,
  weight      integer NOT NULL DEFAULT 1,
  cpm_cents   integer NOT NULL DEFAULT 0,      -- price per 1,000 plays
  budget_cents integer,
  status      text NOT NULL DEFAULT 'pending',  -- pending | approved | paused | ended | rejected
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ad_plays (
  id          bigserial PRIMARY KEY,
  campaign_id uuid NOT NULL REFERENCES ad_campaigns(id),
  vehicle_id  uuid NOT NULL REFERENCES vehicles(id),
  at          timestamptz NOT NULL DEFAULT now(),
  lat         double precision,
  lng         double precision,
  seconds     integer NOT NULL DEFAULT 10
);
CREATE INDEX ad_plays_campaign_idx ON ad_plays (campaign_id, at);

-- ───────────────────────── EV operations ─────────────────────────
CREATE TABLE charging_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid REFERENCES drivers(user_id),
  vehicle_id  uuid NOT NULL REFERENCES vehicles(id),
  location    text NOT NULL DEFAULT 'home',      -- home | depot | public
  site_name   text,
  started_at  timestamptz NOT NULL,
  ended_at    timestamptz,
  kwh         numeric(6,2),
  tariff_cents_per_kwh integer,
  cost_cents  integer,
  start_pct   integer,
  end_pct     integer,
  meter_ref   text,          -- smart-charger session id
  reimbursable boolean NOT NULL DEFAULT true,
  reimbursed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE battery_logs (
  id          bigserial PRIMARY KEY,
  vehicle_id  uuid NOT NULL REFERENCES vehicles(id),
  driver_id   uuid REFERENCES drivers(user_id),
  at          timestamptz NOT NULL DEFAULT now(),
  pct         integer NOT NULL CHECK (pct BETWEEN 0 AND 100),
  odometer_km integer,
  ambient_c   numeric(4,1)
);

-- ───────────────────────── Safety & support ─────────────────────────
CREATE TABLE sos_alerts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trip_id     uuid REFERENCES trips(id),
  user_id     uuid NOT NULL REFERENCES users(id),
  role        text NOT NULL,
  lat         double precision,
  lng         double precision,
  message     text,
  status      text NOT NULL DEFAULT 'open',   -- open | acknowledged | resolved
  handled_by  uuid REFERENCES users(id),
  notes       text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE TABLE support_tickets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES users(id),
  trip_id     uuid REFERENCES trips(id),
  category    text NOT NULL,   -- lost_item | fare | safety | driver | parcel | accessibility | app | other
  subject     text NOT NULL,
  message     text NOT NULL,
  contact_email text,
  status      text NOT NULL DEFAULT 'open',
  resolution  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications (
  id        bigserial PRIMARY KEY,
  user_id   uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title     text NOT NULL,
  body      text NOT NULL,
  data      jsonb,
  category  text NOT NULL DEFAULT 'trip',   -- trip | promo | account | safety
  read_at   timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);

CREATE TABLE driver_applications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name        text NOT NULL,
  phone       text NOT NULL,
  email       text NOT NULL,
  suburb      text,
  has_licence_years integer,
  has_cpv_authority boolean NOT NULL DEFAULT false,
  wants_lease boolean NOT NULL DEFAULT false,
  languages   text,
  message     text,
  status      text NOT NULL DEFAULT 'new',
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE enquiries (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind       text NOT NULL,   -- advertise | partner | general | media
  name       text NOT NULL,
  email      text NOT NULL,
  phone      text,
  organisation text,
  message    text NOT NULL,
  status     text NOT NULL DEFAULT 'new',
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE settings (
  key   text PRIMARY KEY,
  value jsonb NOT NULL
);

CREATE TABLE audit_log (
  id        bigserial PRIMARY KEY,
  actor_id  uuid,
  action    text NOT NULL,
  entity    text,
  entity_id text,
  data      jsonb,
  at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
