-- Own-car driver model (Nov 2026): drivers bring their own cars, any fuel type. Electric fleet stays the goal.
-- Electric + hybrids are "green" and get offered trips first. NT rideshare: car < 13 years old, 4+ doors, CVL, roadworthy.
-- Existing (fleet BYD Dolphin) rows pick up the column defaults: fuel_type 'electric', status 'approved', doors 4.

ALTER TABLE vehicles ADD COLUMN fuel_type text NOT NULL DEFAULT 'electric'
  CHECK (fuel_type IN ('electric','plug_in_hybrid','hybrid','petrol','diesel'));
ALTER TABLE vehicles ADD COLUMN doors integer NOT NULL DEFAULT 4 CHECK (doors >= 2);
ALTER TABLE vehicles ADD COLUMN vin text;
ALTER TABLE vehicles ADD COLUMN status text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected'));
ALTER TABLE vehicles ADD COLUMN owner_driver_id uuid REFERENCES drivers(user_id) ON DELETE SET NULL;
-- Is the driver the registered owner? If false, an `owner_permission` document (owner's written permission) is needed.
ALTER TABLE vehicles ADD COLUMN registered_owner boolean NOT NULL DEFAULT true;
ALTER TABLE vehicles ADD COLUMN review_note text;
ALTER TABLE vehicles ADD COLUMN reviewed_at timestamptz;

-- No more BYD Dolphin assumptions: make/model must be given; battery/range only apply to EVs.
ALTER TABLE vehicles ALTER COLUMN make DROP DEFAULT, ALTER COLUMN model DROP DEFAULT;
ALTER TABLE vehicles ALTER COLUMN battery_kwh DROP NOT NULL, ALTER COLUMN battery_kwh DROP DEFAULT;
ALTER TABLE vehicles ALTER COLUMN range_km DROP NOT NULL, ALTER COLUMN range_km DROP DEFAULT;

-- Vehicle documents (rego papers, insurance, CVL, roadworthy, owner permission) belong to a specific car.
ALTER TABLE driver_documents ADD COLUMN vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE;

CREATE INDEX vehicles_status_idx ON vehicles (status);
CREATE INDEX vehicles_owner_idx ON vehicles (owner_driver_id);
CREATE INDEX driver_documents_vehicle_idx ON driver_documents (vehicle_id);

-- settings.value is jsonb: store the number 13.
INSERT INTO settings (key, value) VALUES ('vehicle_max_age_years', '13'::jsonb) ON CONFLICT (key) DO NOTHING;

-- Customer-facing service descriptions no longer promise a BYD Dolphin (only rewrites the original seeded text).
UPDATE fare_rules SET description = 'Up to 4 passengers. Electric and hybrid cars get your trip first'
  WHERE service = 'ride' AND description = 'Electric BYD Dolphin, up to 4 passengers';
UPDATE fare_rules SET description = 'Up to 25 kg, fits in a standard car boot'
  WHERE service = 'courier_l' AND description = 'Up to 25 kg, fits in a Dolphin boot (345 L)';
