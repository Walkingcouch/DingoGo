# Own-car driver model — build contract (Nov 2026)

Decision (owner, 4 Nov 2026): DingoGo launches like Uber — drivers bring their own cars. The electric fleet stays the goal.
- Any fuel type accepted: `electric | plug_in_hybrid | hybrid | petrol | diesel`. Electric and hybrids are "green" and get offered trips first.
- Max vehicle age: manufactured less than 13 years ago (NT legal max) → `year >= currentYear - 12`. Setting `vehicle_max_age_years` (default 13).
- 4+ doors, 4–7 passenger seats.
- NT rules (nt.gov.au "Apply to use your vehicle for ridesharing"): vehicle needs a rideshare Commercial Vehicle Licence (CVL, class "Rideshare – SPV"), a roadworthy inspection < 6 weeks old when applying for the CVL, CTP (with registration) plus at least third-party property insurance naming the driver. Driver needs H endorsement + CPVID (class RIDESHARE), ABN, GST. Driver need not own the car; if not registered owner, needs owner's written permission (doc type `owner_permission`).
- Messaging: never claim "100% electric" / "all-electric" / "every car is electric". Use "going electric": e.g. "Local rides, going electric", "Electric and hybrid cars get your trip first", "Our goal: an all-electric fleet". CO₂-saved figures only for trips actually done in an electric car.

## Database — migration `services/api/migrations/009_driver_owned_vehicles.sql`
```sql
ALTER TABLE vehicles ADD COLUMN fuel_type text NOT NULL DEFAULT 'electric'
  CHECK (fuel_type IN ('electric','plug_in_hybrid','hybrid','petrol','diesel'));
ALTER TABLE vehicles ADD COLUMN doors integer NOT NULL DEFAULT 4;
ALTER TABLE vehicles ADD COLUMN vin text;
ALTER TABLE vehicles ADD COLUMN status text NOT NULL DEFAULT 'approved' CHECK (status IN ('pending','approved','rejected'));
ALTER TABLE vehicles ADD COLUMN owner_driver_id uuid REFERENCES drivers(user_id) ON DELETE SET NULL;
ALTER TABLE vehicles ADD COLUMN review_note text;
ALTER TABLE vehicles ADD COLUMN reviewed_at timestamptz;
ALTER TABLE vehicles ALTER COLUMN make DROP DEFAULT, ALTER COLUMN model DROP DEFAULT;
ALTER TABLE vehicles ALTER COLUMN battery_kwh DROP NOT NULL, ALTER COLUMN battery_kwh DROP DEFAULT;
ALTER TABLE vehicles ALTER COLUMN range_km DROP NOT NULL, ALTER COLUMN range_km DROP DEFAULT;
ALTER TABLE driver_documents ADD COLUMN vehicle_id uuid REFERENCES vehicles(id) ON DELETE CASCADE;
CREATE INDEX vehicles_status_idx ON vehicles (status);
INSERT INTO settings (key, value) VALUES ('vehicle_max_age_years', '13') ON CONFLICT DO NOTHING;
```
(Builder A: check the real `settings` table shape and seed conventions and adapt; existing seeded BYDs stay `electric`/`approved`/fleet.)

## API (Builder A owns `services/api/**`)
Vehicle JSON everywhere includes: `id, rego, make, model, year, colour, seats, doors, fuel_type, vin, status, review_note, ownership, owner_driver_id, pet_friendly, wheelchair_accessible, battery_pct, range_km, battery_kwh, cvl_number, cvl_expiry, rego_expiry, insurance_expiry, roadworthy_date, active` and computed `green: boolean` (electric|plug_in_hybrid|hybrid) and `is_ev: boolean` (electric).

Driver:
- `GET /driver/vehicles` → `{ vehicles: Vehicle[] (owned by me, plus my current vehicle if fleet), current_vehicle_id, max_age_years, min_year }`
- `POST /driver/vehicles` body `{ rego, make, model, year, colour, seats (4-7, default 4), doors (>=4, default 4), fuel_type, vin?, pet_friendly?, wheelchair_accessible?, range_km? (EV only), battery_kwh? (EV only), registered_owner: boolean }` → `{ vehicle }` with `status:'pending', ownership:'driver_owned', owner_driver_id: me`. 400 `vehicle_too_old` if year < min_year; 400 `doors` / `seats`; 409 `rego_taken`. Rego normalised uppercase, no spaces.
- `PATCH /driver/vehicles/:id` same fields, only own vehicles; any edit sets `status='pending'` (and if it's the driver's current vehicle, they can't go online until re-approved).
- `POST /driver/vehicles/:id/use` → set `drivers.vehicle_id` (must be own + approved; 409 if online or on a trip).
- `POST /driver/documents` accepts optional `vehicle_id` (must be the driver's own vehicle) and new types `vehicle_rego`, `owner_permission` (existing: `insurance`, `vehicle_cvl`, `roadworthy`).
- `GET /driver/me` → `driver.vehicle` includes the new fields + `green`, `is_ev`; documents include `vehicle_id`.
- `POST /driver/online`: `battery_pct` low check only applies when current vehicle `is_ev`.
- `complianceIssues`: vehicle must be `status='approved'` ("Your car {rego} is waiting for DingoGo to check it" / "was not approved: {note}"), and year >= min_year.

Admin:
- `GET /admin/vehicles?status=pending|approved|rejected|all` → `{ items: Vehicle[] + owner {id,name,phone} + documents for that vehicle }`.
- `POST /admin/vehicles/:id/review` body `{ decision: 'approve'|'reject', note?, cvl_number?, cvl_expiry?, rego_expiry?, insurance_expiry?, roadworthy_date? }` → sets status, review fields, dates; on approve, if owner driver has no `vehicle_id`, assign it. Writes audit_log. Approve requires cvl_expiry, rego_expiry, insurance_expiry (from the request or already on the row).
- Existing admin fleet/vehicle create/edit keeps working; allow `fuel_type`, `doors`, `ownership`, `status`.
- Dashboard: replace EV-only stats with `green_km_pct` (share of completed-trip km in green cars, 30 days), keep `ev_km` and `co2_saved_kg` (electric only).

Dispatch (`services/trips.ts`): range check only when `fuel_type='electric'`. Ranking score = distance to pickup minus `config.dispatch.greenBonusM` (default 1500 m) if green. Trip view `vehicle` adds `fuel_type`, `green`, `is_ev`. CO₂ saved only for `electric` vehicles (0 / null otherwise). Roof display house ad: no "100% electric".

Tests: extend `services/api/test/e2e.test.ts` — driver adds a petrol car (pending) → can't go online → admin approves with dates → can go online → gets an offer; too-old car rejected; EV preferred over a nearer-by-<1.5 km petrol car.

## Driver app (Builder B owns `apps/driver/**`)
- Onboarding gets a "Your car" step: add-car form (fuel type picker with the 5 options, make, model, year with hint "{min_year} or newer", colour, rego, seats, doors, VIN optional, "I'm the registered owner" toggle → if off, ask for `owner_permission` document), then vehicle document uploads (rego papers, insurance certificate, CVL, roadworthy report) using existing upload flow with `vehicle_id`. Show car status pill (Waiting for check / Approved / Not approved + note). Explain NT steps in plain English (CVL from MVR, roadworthy < 6 weeks, under 13 years, 4 doors).
- Profile: "Your car" section: current car, its status and expiries; "Add another car" / "Use this car".
- Charging tab & battery bar/range on Drive home only when `vehicle.is_ev` (plug-in hybrid: charging tab ok, no range bar). Earnings: lease line only if lease > 0.
- Remove copy implying everyone drives a DingoGo BYD.

## Admin (Builder B owns `apps/admin/**`)
- Fleet page: columns Fuel (chip, green for EV/hybrid), Owner (Fleet / driver name), Status. "Cars to check" queue at top (pending): show car, owner, docs (links), form with CVL number + expiry, rego expiry, insurance expiry, roadworthy date → Approve / Reject with note.
- Dashboard: "Electric fleet impact" → "Going electric": green km %, EV km, CO₂ avoided (EVs only), roof plays.
- Drivers page "Can drive?" reasons reflect car status.
- Nav badge for cars to check if easy.

## Website + rider app (Builder C owns `apps/web/**`, `apps/rider/**`)
- Remove every "100% electric", "all-electric", "every car is electric", "electric cars" claims → "going electric" wording. Index.html/meta/manifest too. Mention electric fleet as the goal; EV and hybrid cars get trips first.
- Drive page: rewrite for bring-your-own-car: requirements list (car under 13 years old, 4 doors, NT rideshare CVL, roadworthy < 6 weeks, registration + CTP + third-party property insurance in your name, H endorsement, CPVID, ABN + GST, police check & medical as already listed). "Don't own a car? Ask about borrowing one with the owner's written permission, and our EV lease programme (coming)". Earnings: no lease/charging reimbursement unless EV lease. Application form: replace "interested in leasing" with fields "Your car: make/model/year/fuel" (free text ok, keep server field compat: check `/public/driver-applications` schema in services/api — if the API rejects unknown fields, send them inside `message`).
- Rides/Tours/About/Home: replace BYD Dolphin fleet claims ("Our first cars are BYD Dolphins…") with neutral ("Most cars are standard sedans or SUVs"; wheelchair text stays). About timeline: "Launching with local drivers in their own cars; electric fleet next".
- Rider app: login subtitle, ride footer, tours text, referral share text → no electric claim. Trip/receipt: show fuel chip ("Electric" leaf / "Hybrid"), CO₂ line only when `vehicle.is_ev` and the API returns a co2 value. Car description "{colour} {make} {model}" already generic — check.
