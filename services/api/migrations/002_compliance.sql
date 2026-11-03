-- Additions driven by the November 2026 gap analysis (NT CPV rules, NDIS, safety, unbanked customers).

-- NT passenger services levy ($1/trip, lodged monthly by the dispatch network). Shown as its own fare line.
ALTER TABLE fare_rules ADD COLUMN levy_cents integer NOT NULL DEFAULT 0;

-- Women-preferred matching (Shebah-style option) — rider can ask for a female driver; drivers opt in.
ALTER TABLE drivers ADD COLUMN female_driver boolean NOT NULL DEFAULT false;
ALTER TABLE trips ADD COLUMN women_driver_pref boolean NOT NULL DEFAULT false;
-- Route deviation alert sent once per trip
ALTER TABLE trips ADD COLUMN deviation_alerted boolean NOT NULL DEFAULT false;
-- Phone/dispatcher bookings for customers without smartphones
ALTER TABLE trips ADD COLUMN booked_by uuid REFERENCES users(id);
ALTER TABLE trips ADD COLUMN channel text NOT NULL DEFAULT 'app';   -- app | phone | web | sms
-- NDIS participants: number printed on tax invoice for plan-manager claims
ALTER TABLE trips ADD COLUMN ndis_number text;

-- Account types: NDIS plan managers, community organisations and government are invoiced like businesses.
ALTER TABLE corporate_accounts ADD COLUMN kind text NOT NULL DEFAULT 'business'; -- business | ndis_plan_manager | community_org | government

-- Vehicle compliance: NT rideshare Commercial Vehicle Licence (CVL) + roadworthy
ALTER TABLE vehicles ADD COLUMN cvl_number text;
ALTER TABLE vehicles ADD COLUMN cvl_expiry date;
ALTER TABLE vehicles ADD COLUMN roadworthy_date date;

-- Driver accreditation (NT): H endorsement + CPV identity card, police check & medical (≤3 months old at application)
ALTER TABLE drivers ADD COLUMN h_endorsement_expiry date;
ALTER TABLE drivers ADD COLUMN police_check_date date;
ALTER TABLE drivers ADD COLUMN medical_date date;
ALTER TABLE drivers ADD COLUMN da_training_date date;     -- disability awareness / assistance animal training

-- Prepaid vouchers sold over the counter (partner shops, community orgs) for customers without cards
CREATE TABLE gift_vouchers (
  code        text PRIMARY KEY,
  value_cents integer NOT NULL CHECK (value_cents > 0),
  batch       text,
  sold_by_partner uuid REFERENCES partners(id),
  sold_at     timestamptz,
  redeemed_by uuid REFERENCES users(id),
  redeemed_at timestamptz,
  expires_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Driver cancellations on assistance-animal trips are reviewed (refusal is unlawful under the DDA)
CREATE TABLE compliance_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind        text NOT NULL,       -- assistance_animal_refusal | doc_expired | route_deviation | levy
  driver_id   uuid REFERENCES drivers(user_id),
  trip_id     uuid REFERENCES trips(id),
  detail      text,
  status      text NOT NULL DEFAULT 'open',
  created_at  timestamptz NOT NULL DEFAULT now()
);
