-- States (jurisdictions) + free rego/age checks (Nov 2026).
-- NT is live. South Australia (regional towns only) is built but hidden until DingoGo's SA booking-service accreditation is approved.
-- Rules are editable by admins (GET/PATCH /admin/jurisdictions). Copy cites them only as "NT rules" / "SA rules".

CREATE TABLE jurisdictions (
  code                  text PRIMARY KEY CHECK (code ~ '^[A-Z]{2,3}$'),   -- 'NT', 'SA'
  name                  text NOT NULL,
  vehicle_max_age_years integer NOT NULL CHECK (vehicle_max_age_years BETWEEN 1 AND 50),  -- by year of manufacture
  levy_cents            integer NOT NULL DEFAULT 0 CHECK (levy_cents >= 0),  -- per passenger trip starting in this state's zones
  levy_label            text NOT NULL,
  inspection_months     integer CHECK (inspection_months IS NULL OR inspection_months > 0),  -- periodic inspection (SA annual); NULL = none
  rego_check_url        text,
  regulator             text,
  driver_docs           jsonb NOT NULL DEFAULT '[]'::jsonb,   -- array of driver_documents.type required to drive
  vehicle_docs          jsonb NOT NULL DEFAULT '[]'::jsonb,   -- array of vehicle document types (checklist for the car)
  notes                 text,
  active                boolean NOT NULL DEFAULT false,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- NT max age starts from the existing (admin-editable) setting so nothing changes for live NT drivers.
INSERT INTO jurisdictions (code, name, vehicle_max_age_years, levy_cents, levy_label, inspection_months, rego_check_url, regulator, driver_docs, vehicle_docs, notes, active)
VALUES
  ('NT', 'Northern Territory',
   coalesce((SELECT (value #>> '{}')::int FROM settings WHERE key = 'vehicle_max_age_years' AND (value #>> '{}') ~ '^\d+$'), 13),
   100, 'NT passenger levy', NULL,
   'https://nt.gov.au/driving/registration/rego-check',
   'NT Department of Logistics and Infrastructure — Passenger Transport (Commercial Passenger Vehicles)',
   '["licence","h_endorsement","cpvid","police_check","medical","abn","gst"]',
   '["vehicle_rego","insurance","vehicle_cvl","roadworthy","compliance_plate"]',
   'NT rules: car under 13 years old (year of manufacture); rideshare Commercial Vehicle Licence (CVL); roadworthy under 6 weeks old when applying for the CVL; driver H endorsement + CPVID; $1 NT passenger levy per trip.',
   true),
  ('SA', 'South Australia', 8, 0, 'SA passenger levy', 12,
   'https://www.sa.gov.au/topics/driving-and-transport/vehicles-and-registration/vehicle-registration/checking-that-a-vehicle-is-registered',
   'SA Department for Infrastructure and Transport (DIT) — Point-to-Point Transport (DIT.P2PEnquiries@sa.gov.au)',
   '["licence","sa_driver_accreditation","sa_operator_accreditation","wwcc","police_check","medical","abn","gst"]',
   '["vehicle_rego","ctp_spv","insurance","sa_inspection","public_liability","compliance_plate"]',
   'SA rules: driver + operator accreditation, working with children check, commercial driver medical (< 3 months at application), national police certificate, ABN + GST, unrestricted licence held 6+ months. Car max 8 years old, annual inspection (RAA or Rightway), SA-registered, CTP upgraded to small passenger vehicle, third-party property insurance, public liability $5M+. SA passenger levy ($2) only applies to trips starting in metropolitan Adelaide, so $0 in our regional towns. DingoGo needs SA booking-service accreditation before launch.',
   false);

-- Service areas belong to a state. Existing zones are NT.
ALTER TABLE zones ADD COLUMN state text NOT NULL DEFAULT 'NT' REFERENCES jurisdictions(code);
INSERT INTO zones (id, name, centre_lat, centre_lng, radius_km, active, timezone, launch_note, state) VALUES
  ('port-augusta',  'Port Augusta',  -32.4925, 137.7656, 15, false, 'Australia/Adelaide', 'Coming soon — awaiting SA accreditation', 'SA'),
  ('coober-pedy',   'Coober Pedy',   -29.0135, 134.7544, 10, false, 'Australia/Adelaide', 'Coming soon — awaiting SA accreditation', 'SA'),
  ('whyalla',       'Whyalla',       -33.0333, 137.5833, 15, false, 'Australia/Adelaide', 'Coming soon — awaiting SA accreditation', 'SA'),
  ('port-pirie',    'Port Pirie',    -33.1858, 138.0169, 12, false, 'Australia/Adelaide', 'Coming soon — awaiting SA accreditation', 'SA'),
  ('mount-gambier', 'Mount Gambier', -37.8284, 140.7804, 15, false, 'Australia/Adelaide', 'Coming soon — awaiting SA accreditation', 'SA')
ON CONFLICT (id) DO NOTHING;
CREATE INDEX zones_state_idx ON zones (state);

-- Drivers drive in one state (dispatch only matches drivers to pickups in their state).
ALTER TABLE drivers ADD COLUMN state text NOT NULL DEFAULT 'NT' REFERENCES jurisdictions(code);

-- Free rego/age checks. Existing (NT) cars keep vin NULL; a VIN is only required when a driver adds a car.
ALTER TABLE vehicles ADD COLUMN rego_state text NOT NULL DEFAULT 'NT' REFERENCES jurisdictions(code);
ALTER TABLE vehicles ADD COLUMN vin_year integer;                -- model year decoded from VIN position 10 (a hint, not proof)
ALTER TABLE vehicles ADD COLUMN verified_year integer;           -- year of manufacture confirmed by DingoGo; compliance uses verified_year ?? year
ALTER TABLE vehicles ADD COLUMN verified_source text
  CHECK (verified_source IS NULL OR verified_source IN ('vin','compliance_plate','rego_papers','plate_lookup','other'));
ALTER TABLE vehicles ADD COLUMN rego_checked_at timestamptz;     -- admin confirmed rego is current on the state gov site
ALTER TABLE vehicles ADD COLUMN ppsr_checked_at timestamptz;
ALTER TABLE vehicles ADD COLUMN ppsr_clear boolean;              -- PPSR: not stolen / written off (NULL = not checked)
ALTER TABLE vehicles ADD COLUMN lookup jsonb;                    -- last paid plate lookup result
ALTER TABLE vehicles ADD COLUMN lookup_at timestamptz;
-- (inspection_expiry already exists: used for the SA annual inspection.)
