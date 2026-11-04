# DingoGo API reference

Base URL: `http://localhost:4000` in development. Auth: `Authorization: Bearer <JWT>` from `/auth/otp/verify`. Errors: `{ error, message, details? }`. Money in integer cents (AUD, GST-inclusive).


## Public (no sign-in)

| Method | Path |
| --- | --- |
| GET | `/health` |
| GET | `/public/config` |
| GET | `/public/places` |
| POST | `/public/estimate` |
| GET | `/public/tours` |
| GET | `/public/partners` |
| GET | `/public/track/:token` |
| POST | `/public/driver-applications` |
| POST | `/public/hire-requests` |
| POST | `/public/enquiries` |

## Auth & account

| Method | Path |
| --- | --- |
| POST | `/auth/otp/request` |
| POST | `/auth/otp/verify` |
| GET | `/me` |
| PATCH | `/me` |
| DELETE | `/me` |
| GET | `/me/export` |
| POST | `/me/push-token` |
| GET | `/me/notifications` |
| POST | `/me/notifications/read` |

## Rider

| Method | Path |
| --- | --- |
| GET | `/places/search` |
| POST | `/quotes` |
| POST | `/trips` |
| GET | `/trips` |
| GET | `/trips/:id` |
| GET | `/trips/:id/track` |
| POST | `/trips/:id/cancel` |
| POST | `/trips/:id/rate` |
| POST | `/trips/:id/tip` |
| GET | `/trips/:id/receipt` |
| POST | `/trips/:id/sos` |
| GET | `/loyalty` |
| POST | `/loyalty/rewards/:id/redeem` |
| GET | `/plans` |
| POST | `/subscriptions` |
| DELETE | `/subscriptions` |
| GET | `/payment-methods` |
| POST | `/payment-methods/setup` |
| POST | `/payment-methods` |
| DELETE | `/payment-methods/:id` |
| POST | `/wallet/topup` |
| POST | `/wallet/voucher` |
| POST | `/support` |
| GET | `/support` |
| GET | `/tours` |

## Driver

| Method | Path |
| --- | --- |
| GET | `/driver/me` |
| PATCH | `/driver/me` |
| POST | `/driver/documents` |
| GET | `/driver/vehicles` |
| POST | `/driver/vehicles` |
| PATCH | `/driver/vehicles/:id` |
| POST | `/driver/vehicles/:id/use` |
| POST | `/driver/online` |
| POST | `/driver/location` |
| GET | `/driver/offers` |
| POST | `/driver/offers/:tripId/accept` |
| POST | `/driver/offers/:tripId/decline` |
| GET | `/driver/trips/active` |
| GET | `/driver/trips` |
| POST | `/driver/trips/:id/arrive` |
| POST | `/driver/trips/:id/start` |
| POST | `/driver/trips/:id/complete` |
| POST | `/driver/trips/:id/cancel` |
| GET | `/driver/earnings` |
| POST | `/driver/charging` |
| GET | `/driver/charging` |
| POST | `/driver/battery` |
| POST | `/driver/sos` |

## Admin & dispatch (roles: admin, dispatcher)

| Method | Path |
| --- | --- |
| GET | `/admin/${path}` |
| POST | `/admin/${path}` |
| PATCH | `/admin/${path}/:id` |
| GET | `/admin/dashboard` |
| GET | `/admin/live` |
| GET | `/admin/trips` |
| GET | `/admin/trips/:id` |
| POST | `/admin/trips/:id/cancel` |
| POST | `/admin/trips/:id/redispatch` |
| POST | `/admin/trips/:id/refund` |
| POST | `/admin/bookings` |
| GET | `/admin/users` |
| PATCH | `/admin/users/:id` |
| GET | `/admin/drivers` |
| GET | `/admin/drivers/:id` |
| PATCH | `/admin/drivers/:id` |
| POST | `/admin/documents/:id/review` |
| GET | `/admin/vehicles?status=pending\|approved\|rejected\|all` |
| POST | `/admin/vehicles/:id/review` |
| POST | `/admin/vehicles/:id/display-key` |
| POST | `/admin/lease/run` |
| GET | `/admin/redemptions` |
| GET | `/admin/vouchers` |
| POST | `/admin/vouchers` |
| GET | `/admin/campaigns-report` |
| GET | `/admin/charging` |
| POST | `/admin/charging/reimburse` |
| GET | `/admin/payouts` |
| POST | `/admin/payouts/:driverId` |
| GET | `/admin/sos` |
| PATCH | `/admin/sos/:id` |
| GET | `/admin/support` |
| PATCH | `/admin/support/:id` |
| GET | `/admin/compliance` |
| PATCH | `/admin/compliance/:id` |
| GET | `/admin/reports/levy` |
| GET | `/admin/reports/gst` |
| POST | `/admin/corporate/:id/members` |
| GET | `/admin/corporate/:id/statement` |
| GET | `/admin/${path}` |
| PATCH | `/admin/${path}/:id` |
| GET | `/admin/settings` |
| PUT | `/admin/settings/:key` |
| POST | `/admin/broadcast` |
| GET | `/admin/audit` |
| POST | `/admin/vehicles` (table `vehicles`; GET is the custom list above) |
| PATCH | `/admin/vehicles/:id` |
| GET / POST | `/admin/fares` (table `fare_rules`) |
| PATCH | `/admin/fares/:id` |
| GET / POST | `/admin/zones` (table `zones`) |
| PATCH | `/admin/zones/:id` |
| GET / POST | `/admin/promos` (table `promo_codes`) |
| PATCH | `/admin/promos/:id` |
| GET / POST | `/admin/holidays` (table `public_holidays`) |
| PATCH | `/admin/holidays/:id` |
| GET / POST | `/admin/plans` (table `plans`) |
| PATCH | `/admin/plans/:id` |
| GET / POST | `/admin/tours` (table `tour_packages`) |
| PATCH | `/admin/tours/:id` |
| GET / POST | `/admin/partners` (table `partners`) |
| PATCH | `/admin/partners/:id` |
| GET / POST | `/admin/rewards` (table `rewards`) |
| PATCH | `/admin/rewards/:id` |
| GET / POST | `/admin/advertisers` (table `advertisers`) |
| PATCH | `/admin/advertisers/:id` |
| GET / POST | `/admin/campaigns` (table `ad_campaigns`) |
| PATCH | `/admin/campaigns/:id` |
| GET / POST | `/admin/corporate` (table `corporate_accounts`) |
| PATCH | `/admin/corporate/:id` |

## Vehicles: drivers bring their own car (Nov 2026)

Any fuel type: `fuel_type` is `electric | plug_in_hybrid | hybrid | petrol | diesel`. Electric and hybrids are **green** and get offered trips first.
NT rules: car made less than 13 years ago (setting `vehicle_max_age_years`, default 13 → `year >= currentYear - 12`), 4+ doors, 4–7 passenger seats,
rideshare CVL, roadworthy < 6 weeks old, rego + CTP + third-party property insurance.

**Vehicle JSON** (every endpoint that returns a car): `id, rego, make, model, year, colour, seats, doors, fuel_type, vin, status (pending|approved|rejected),
review_note, reviewed_at, ownership (fleet|leased_to_driver|driver_owned), owner_driver_id, registered_owner, pet_friendly, wheelchair_accessible,
battery_pct, range_km, battery_kwh, cvl_number, cvl_expiry, rego_expiry, insurance_expiry, roadworthy_date, active, lease_weekly_cents, …` plus computed
`green` (electric | plug_in_hybrid | hybrid) and `is_ev` (electric). `display_key` is only returned to admins.

### Driver
- `GET /driver/vehicles` → `{ vehicles: Vehicle[] (cars I own + my current car if it's a fleet car; each has documents[]), current_vehicle_id, max_age_years, min_year }`
- `POST /driver/vehicles` → 201 `{ vehicle }`. Body `{ rego, make, model, year, colour, seats=4, doors=4, fuel_type, vin?, pet_friendly?, wheelchair_accessible?,
  range_km? (electric only, else stored null), battery_kwh? (electric only), registered_owner=true }`. New car is `status:'pending', ownership:'driver_owned',
  owner_driver_id: me`. Rego stored uppercase without spaces. If the driver has no current car, it becomes their current car immediately (they can't go online until approved).
  Errors: 400 `vehicle_too_old`, 400 `doors` (< 4), 400 `seats` (not 4–7), 400 `rego` (bad plate), 400 `year` (future), 409 `rego_taken`, 400 `validation_error`.
- `PATCH /driver/vehicles/:id` — same fields, all optional; own cars only (404 otherwise). Any edit sets `status:'pending'` and clears the review note; editing your
  current car also takes you offline. 409 `on_trip` during a trip.
- `POST /driver/vehicles/:id/use` → `{ ok, current_vehicle_id, vehicle }`. Own + approved car only: 404 not yours, 400 `not_approved`, 409 `driver_online`, 409 `on_trip`.
- `POST /driver/documents` — new types `vehicle_rego`, `owner_permission` (plus `insurance`, `vehicle_cvl`, `roadworthy`); optional `vehicle_id` must be your own car
  (400 `invalid_vehicle`). Car document types sent without `vehicle_id` attach to your current car if you own it.
- `GET /driver/me` — `driver.vehicle` is Vehicle JSON (with `green`, `is_ev`); `documents[]` include `vehicle_id`. `compliance_issues` now include
  "Your car {rego} is waiting for DingoGo to check it", "Your car {rego} was not approved: {note}", and "…is too old".
- `POST /driver/online` — the `battery_pct < 15` check (`battery_low`) only applies to electric cars. `POST /driver/charging` → 400 `not_plug_in` for hybrid/petrol/diesel.

### Admin
- `GET /admin/vehicles?status=pending|approved|rejected|all` (default `all`, pending first) → `{ items: (Vehicle & { owner: {id,name,phone} | null,
  assigned_driver: {id,name} | null, documents: [{id,type,number,expires_at,status,note,file_url,driver_id,created_at}] })[] }`.
- `POST /admin/vehicles/:id/review` (admin) body `{ decision: 'approve'|'reject', note?, cvl_number?, cvl_expiry?, rego_expiry?, insurance_expiry?, roadworthy_date? }`
  → `{ vehicle }`. Approve needs `cvl_expiry`, `rego_expiry`, `insurance_expiry` (in the body or already on the car) else 400 `dates_required` (details = missing fields).
  On approve, if the owner has no current car it is assigned. Writes `audit_log` (`vehicle_approve` / `vehicle_reject`) and notifies the owner.
- `POST /admin/vehicles`, `PATCH /admin/vehicles/:id` also accept `fuel_type, doors, vin, status, review_note, registered_owner, owner_driver_id` (make & model are now required on create).
- `GET /admin/dashboard` adds `green_km_pct` (% of completed-trip km in green cars, last 30 days), `ev_km` and `co2_saved_kg` (lifetime, electric cars only),
  `green_30d { total_km, green_km, ev_km, green_km_pct }`, `live.pending_vehicles`; `lifetime { ev_km, co2_avoided_kg }` kept (electric only).
- `GET /admin/drivers` rows add `make, fuel_type, vehicle_status, vehicle_ownership`; `GET /admin/live` drivers add `fuel_type, green, is_ev`.

### Trips, receipts, public
- Trip `vehicle` (rider/driver/admin trip views) adds `fuel_type, green, is_ev`. `/public/track/:token` adds `fuel_type, green, is_ev`.
- `GET /trips/:id/receipt` — `co2_saved_kg` is a number only for trips done in an electric car, otherwise `null`; adds `vehicle_fuel_type`, `vehicle_is_ev`.
- `GET /public/config` adds `vehicle_rules { max_age_years, min_year, current_year, min_doors, seats {min,max}, fuel_types }`.
- `POST /public/driver-applications` ignores unknown fields (they are dropped, not rejected) — send car details inside `message`.
- Dispatch: only approved cars; EV range check only for `fuel_type='electric'`; ranking = road distance to pickup − `DISPATCH_GREEN_BONUS_M` (default 1500 m) for green cars.

## States + rego/age checks (Nov 2026)

States live in table `jurisdictions` (NT live; SA regional towns built but hidden, `active=false`, until DingoGo's SA accreditation).
**Jurisdiction JSON**: `{ code ('NT'|'SA'), name, vehicle_max_age_years (NT 13, SA 8), max_age_years, min_year, current_year, levy_cents (NT 100, SA 0),
levy_label, inspection_months (SA 12, NT null), rego_check_url, regulator, driver_docs: string[], vehicle_docs: string[], notes, active, updated_at,
zones: [{ id, name, active, launch_note }] }`. `min_year = current_year − (max_age − 1)`.
- NT `driver_docs`: licence, h_endorsement, cpvid, police_check, medical, abn, gst · `vehicle_docs`: vehicle_rego, insurance, vehicle_cvl, roadworthy, compliance_plate.
- SA `driver_docs`: licence, sa_driver_accreditation, sa_operator_accreditation, wwcc, police_check, medical, abn, gst · `vehicle_docs`: vehicle_rego, ctp_spv, insurance, sa_inspection, public_liability, compliance_plate.
- SA zones (inactive, "Coming soon — awaiting SA accreditation"): port-augusta, coober-pedy, whyalla, port-pirie, mount-gambier. A zone is bookable only if the zone **and** its state are active.

**Public**: `GET /public/config` adds `jurisdictions: Jurisdiction[]`, `document_types: { [type]: { label, help, vehicle? } }`, and `zones[].state`.
`vehicle_rules` stays (NT). Quotes/estimates: the levy line uses the pickup zone's state (`levy_cents`, `levy_label`) for services whose fare rule has a levy
(passenger services); `fare_rules.levy_cents` is the fallback when there is no zone. SA regional = $0 (no levy line).

**Vehicle JSON** adds `rego_state, vin_year, verified_year, verified_source ('vin'|'compliance_plate'|'rego_papers'|'plate_lookup'|'other'), rego_checked_at,
ppsr_checked_at, ppsr_clear, lookup, lookup_at` and computed `compliance_year` (= `verified_year ?? year`, used for the age rule) and
`checks: { vin_year, vin_year_mismatch }` (mismatch = VIN year and `year` differ by > 1; never blocks).

**Driver**
- `PATCH /driver/me` accepts `state: 'NT'|'SA'` while status is `applied`/`pending_documents` (else 409 `state_locked`).
- `GET /driver/vehicles` → `{ vehicles, current_vehicle_id, state, max_age_years, min_year (for my state), rules: Jurisdiction (my state), jurisdictions: Jurisdiction[] }`.
- `POST /driver/vehicles` body adds **`vin` (required, 17 chars, no I/O/Q; spaces/dashes stripped)** and `rego_state?` (default: my state). Age limit = the car's
  `rego_state`. Response `{ vehicle, checks: { vin_valid, vin_year, vin_note, vin_year_mismatch } }`. Errors add 400 `vin` (message says what is wrong).
- `PATCH /driver/vehicles/:id` accepts `vin`, `rego_state` (changing state re-applies that state's age limit). Changing year/VIN clears `verified_*`;
  changing rego/state clears `rego_checked_at`; changing VIN clears PPSR. Same `{ vehicle, checks }` response. Existing cars without a VIN stay valid.
- `POST /driver/documents` types add `compliance_plate, sa_driver_accreditation, sa_operator_accreditation, sa_inspection, ctp_spv, public_liability`
  (car types: compliance_plate, ctp_spv, sa_inspection, public_liability attach to the car).
- `compliance_issues` (go-online check) now per state: "DingoGo isn't operating in SA yet — South Australia is coming soon"; each `driver_docs` type must have an
  approved, unexpired document ("{Label}: document missing, expired or not yet approved"); H endorsement only where required (NT); car `rego_state` must equal
  driver state; car age by the car's state using `verified_year ?? year`; CVL only where `vehicle_docs` has `vehicle_cvl` (NT); inspection (`inspection_expiry`)
  where `inspection_months` is set (SA).
- Dispatch only offers trips to drivers whose `state` equals the pickup zone's `state`.

**Admin**
- `GET /admin/vehicles` items add `state_rules: { code, name, max_age_years, min_year, inspection_months, rego_check_url, ppsr_url, vehicle_docs, active }`; response adds `ppsr_url`.
- `POST /admin/vehicles/:id/review` body adds `verified_year?, verified_source?, rego_checked?: boolean, ppsr_clear?: boolean, inspection_expiry?`.
  Approve checks, in order: 400 `dates_required` (rego + insurance; CVL for NT; inspection for SA) → 400 `verified_year_required` (unless already verified) →
  400 `vehicle_too_old` (verified year below the car's state limit) → 400 `rego_check_required` (`rego_checked` must be `true` on this request) →
  400 `ppsr_not_clear` (if `ppsr_clear` is false). `rego_checked:true` stamps `rego_checked_at`; `ppsr_clear` stamps `ppsr_checked_at`.
  `verified_source` defaults to `vin` when the verified year equals `vin_year`, else `other`. Response `{ vehicle (with state_rules) }`.
- `POST /admin/vehicles/:id/lookup` (admin; paid, one credit per call) → `{ lookup: { year, make, model, vin, description, expiry, raw }, lookup_at }`;
  501 `{ error: 'lookup_not_configured', code: 'lookup_not_configured', message }` when `REGCHECK_USERNAME` is unset; 502 `lookup_failed` on provider errors. Stored on the car (`lookup`, `lookup_at`).
- `GET /admin/integrations` → `{ plate_lookup, payments, sms, routing }` each `'configured'|'not_configured'`.
- `GET /admin/jurisdictions` → `{ items: Jurisdiction[] }`; `GET /admin/jurisdictions/:code` → `{ item }`; `PATCH /admin/jurisdictions/:code` (admin) body any of
  `{ name, vehicle_max_age_years, levy_cents, levy_label, inspection_months (null = none), rego_check_url, regulator, driver_docs, vehicle_docs, notes, active }`
  → `{ item }`. Deactivating a state takes its drivers offline. NT max age is mirrored to setting `vehicle_max_age_years` (and vice versa).
- `/admin/zones` accepts `state`, `timezone`. `/admin/vehicles` create/edit accept `rego_state, verified_year, verified_source`; `vin` is validated and `vin_year` derived.
  `POST /admin/users` accepts `state` (test drivers get approved docs for that state's `driver_docs`). `PATCH /admin/drivers/:id` accepts `state`.
- `GET /admin/reports/levy?state=NT|SA` (default NT) counts trips by pickup-zone state; adds `state`, `levy_label`.

## Partner portal

| Method | Path |
| --- | --- |
| GET | `/partner/me` |
| POST | `/partner/check` |
| POST | `/partner/redeem` |
| GET | `/partner/redemptions` |
| POST | `/partner/vouchers/sell` |

## Roof LED display (X-Display-Key header)

| Method | Path |
| --- | --- |
| GET | `/display/playlist` |
| POST | `/display/plays` |

## Uploads

| Method | Path |
| --- | --- |
| POST | `/uploads` |

## Realtime

`GET /ws?token=<JWT>` — auto-subscribes `user:<id>` (and `ops` for admin/dispatcher). Send `{"type":"subscribe","channel":"trip:<id>"}` to watch a trip you're part of. `GET /ws?share=<share_token>` gives read-only trip tracking for share links.

Events: `offer.new`, `offer.expired`, `trip.updated`, `driver.location`, `notification`, and on `ops`: `trip.created`, `trip.updated`, `driver.status`, `driver.location`, `sos.new`, `sos.updated`, `support.new`, `compliance.flag`, `safety.deviation`, `application.new`, `hire.new`.
