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
