# DingoGo API reference

Base URL: `http://localhost:4000` in development. Auth: `Authorization: Bearer <JWT>` from `/auth/otp/verify`. Errors: `{ error, message, details?, request_id? }`; every response has an `X-Request-Id` header. Money in integer cents (AUD, GST-inclusive).


## Public (no sign-in)

| Method | Path |
| --- | --- |
| GET | `/health` |
| GET | `/health/deep` (Round 10: database, schema version, pending migrations, integrations; details for admins / `X-Health-Token`) |
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
| DELETE | `/me/push-token` (Round 9) |
| GET / PUT | `/me/notification-prefs` (Round 9) |
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
| POST | `/trips/:id/pay` |
| POST | `/trips/:id/sos` |
| GET / POST | `/trips/:id/messages` (Round 9; also driver and ops) |
| GET | `/trips/:id/contact` (Round 9) |
| GET | `/loyalty` |
| POST | `/loyalty/rewards/:id/redeem` |
| GET | `/plans` |
| POST | `/subscriptions` |
| DELETE | `/subscriptions` |
| GET | `/payment-methods` |
| POST | `/payment-methods/setup` |
| POST | `/payment-methods` |
| POST | `/payment-methods/:id/default` |
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
| POST | `/driver/location/batch` |
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
| POST | `/admin/trips/:id/reassign` |
| POST | `/admin/trips/:id/refund` |
| POST | `/admin/trips/:id/retry-payment` |
| GET | `/admin/payments/issues` |
| POST | `/admin/bookings` |
| GET | `/admin/users` |
| PATCH | `/admin/users/:id` |
| GET | `/admin/drivers` |
| GET | `/admin/drivers/:id` |
| PATCH | `/admin/drivers/:id` |
| POST | `/admin/documents/:id/review` |
| POST | `/admin/documents/review` (bulk, Round 7) |
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
| GET | `/admin/sos/:id` (incident view, Round 7) |
| PATCH | `/admin/sos/:id` |
| POST | `/admin/sos/:id/notes` (Round 7) |
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
| GET | `/admin/audit` (filters, Round 7) |
| GET | `/admin/search?q=` (Round 7) |
| GET | `/admin/export/:name` (`trips.csv`, `payouts.csv`, `levy.csv`, `gst.csv`; Round 7) |
| GET | `/admin/summary/daily?date=` (Round 7) |
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

Events: `offer.new`, `offer.expired`, `trip.updated`, `driver.location`, `notification`, `message.new` (trip chat), and on `ops`: `trip.created`, `trip.updated`, `driver.status`, `driver.location`, `sos.new`, `sos.updated`, `support.new`, `compliance.flag`, `safety.deviation`, `dispatch.driver_silent`, `application.new`, `hire.new`. A driver whose trip is taken off them gets `trip.updated` with `released: true`.

## Money and safety rules (Round 1, Nov 2026)

- `POST /admin/trips/:id/refund` (admin) `{ cents, reason }` → `{ ok, refundable_cents }`. The running total of refunds on a trip can't exceed what was paid (fare or cancellation fee + tip): 400 `refund_too_large` (`details.refundable_cents`). Refunds on one trip are serialised. A full refund sets `payment_status = 'refunded'`. Wallet and cash trips are refunded as DingoGo credit.
- `POST /admin/trips/:id/redispatch` (ops) → `{ result: 'offered'|'waiting'|'no_drivers' }`. Works on `requested` trips (restarts the search window) and `no_drivers` trips: the card hold, wallet credit, Dingo Points and promo use are taken again first (409 `wallet_insufficient` / `points_spent`, 402 `payment_failed`). Other states: 409 `bad_state`.
- "No drivers" gives the promo code use back (as cancellation does).
- Cancellation fees: the driver's share is `100 − commission_pct` % (75% by default). Cash trips are never charged a fee (event data `fee_waived: 'cash'`). Business-account fees are recorded as a pending invoice and appear on `GET /admin/corporate/:id/statement` (lines carry `cancellation_fee: true`). The statement only lists trips billed to the account (`payment_method = 'corporate'`).
- `POST /trips/:id/tip` — on a trip paid with DingoGo credit the tip comes from credit (402 `wallet_insufficient`); otherwise the card.
- `POST /trips/:id/rate` — a second rating (even sent at the same time) → 409 `already_rated`.
- `POST /driver/trips/:id/complete` (courier) — a wrong `delivery_pin` → 400 `pin_mismatch`; after 5 wrong PINs → 429 `pin_locked` (use signature + receiver's name, or photo if allowed).
- `POST /admin/payouts/:driverId` — serialised per driver; a second click → 400 `nothing_to_pay`.
- `PATCH /driver/me` — `female_driver` can't be changed by the driver (403); admins set it in `PATCH /admin/drivers/:id`.
- `POST /wallet/voucher` — wrong codes are counted (5 per hour, then 429 `too_many_attempts`).
- `GET /uploads/:name` sends `X-Content-Type-Options: nosniff`.

## Privacy and security (Round 2, Nov 2026)

**Private uploads.** Uploads with purpose `document` or `pod` are private. The database stores `/uploads/<name>`; every API response signs these
references in `*_url` fields to `/uploads/<name>?exp=<unix>&sig=<hmac>` (about 1 h, `UPLOAD_LINK_TTL_S`; expiry rounded up to 10 minutes so polled pages get a stable URL).
- `GET /uploads/:name` (private): valid `exp`+`sig` → file; expired → 403 `link_expired`; bad sig → 403; no sig → needs a bearer token of the owner, admin/dispatcher,
  or (POD photo) the trip's rider/driver (401 without a token, 404 otherwise). `ad`/`avatar` uploads stay public. Responses: `nosniff`, `Referrer-Policy: no-referrer`,
  images `CSP: default-src 'none'; sandbox`, PDFs `Content-Disposition: inline`.
- `GET /uploads/:name/link` (signed in; same viewers) → `{ url }` fresh signed link. Shared `FileLink` component uses it when a link is about to lapse.
- `POST /uploads` → `{ url, view_url }` (`view_url` signed for private kinds). Purposes by role: `ad` admin only; `document`, `pod` drivers and admins (403 otherwise).
  The bytes must match the type (PNG/JPEG/WebP/PDF signature) → 400 `bad_file`. 30 uploads per hour per account → 429 `rate_limited`.
- `POST /driver/documents` `file_url` and `POST /driver/trips/:id/complete` `pod_photo_url` must be the caller's own upload of that purpose (plain or signed form accepted,
  stored plain) → 400 `invalid_file`.

**Rate limits** (table `rate_events`, migration 011; client IP from `X-Forwarded-For` when `TRUST_PROXY`/Vercel). All 429:
- `POST /auth/otp/request`: 30 per hour per IP (`rate_limited`), on top of 1 per 30 s and 5 per hour per number.
- `POST /auth/otp/verify`: 30 wrong codes per hour per IP → `too_many_attempts`. Per code: the 6th try → `otp_locked` (counted atomically, so parallel guesses can't exceed 5).
  A code is single-use even if sent twice at once (second → 400 `otp_expired`). Hashes compared in constant time.
- `POST /public/driver-applications`, `/public/hire-requests`, `/public/enquiries`: 10 per hour per IP combined (`rate_limited`).
- `POST /public/estimate`: 60 per 10 minutes per IP (`rate_limited`).
- Partner `POST /partner/check`, `/partner/redeem`, `/partner/vouchers/sell`: 20 wrong codes per hour per login → `too_many_attempts`.
  `POST /partner/redeem` is conditional on the code still being issued: a second (or simultaneous) redeem → 400 `already_redeemed`.

**Share links.** `GET /public/track/:token` → 410 `link_expired` once the trip ended (completed, cancelled, no drivers) more than `SHARE_LINK_HOURS` (24) ago.
`/ws?share=` closes with 4010 in that case.

**Realtime.** `/ws?token=` checks the account in the database: deleted/blocked → close 4001; the `ops` channel follows the database role, not the token's claim.
Re-checked every minute (role change → 4003). `PATCH /admin/users/:id` with `blocked: true` or a `role`, and `DELETE /me`, close the user's sockets at once (4003).
Trip subscribe ids must be UUIDs; messages over 2 KB are ignored. Apps stop reconnecting after 4001/4004/4010.

**Headers** on every API response: `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, HSTS (production/Vercel);
JSON adds `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` and `Cache-Control: no-store` when signed in or on `/public/track`.
Website and apps (Vercel and Caddy): nosniff, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: SAMEORIGIN`, Permissions-Policy (camera, location self only).

**Other.** JWTs verified as HS256 only. Blocked or deleted drivers get no offers; blocking or deleting takes them offline. `POST /driver/offers/:tripId/decline` for a trip
you were not offered is a no-op. New length caps: `delivery_pin`/`pin` ≤ 10, `pod_photo_url` ≤ 500, push token ≤ 4096, card `provider_ref` ≤ 255, `plan_code` ≤ 40,
quote `service` ≤ 40, voucher-sell code 4–30, place search ≤ 100 chars, `accessibility` ≤ 2,000 chars of JSON; `PATCH /admin/drivers/:id` `abn` must be 11 digits.

## Trip lifecycle & dispatch (Round 3)

**Driver cancels after accepting.** `POST /driver/trips/:id/cancel` `{ reason, note? }`:
- `rider_no_show`, `rider_requested`, `unsafe`, `parcel_prohibited` (about the rider or load) end the trip as before (`cancelled_driver`).
- `vehicle_issue`, `other` (the driver's side) put the trip back to `requested` with no driver: card hold, wallet, points and promo stay; the search
  window and offer count restart; the driver who pulled out is never offered it again. Response: `{ trip: { id, ref, kind, service, status: 'requested', released: true, released_by: 'driver' } }`
  (the driver can no longer view the trip). Rider is notified "Finding you another driver". Event `driver_released` (`data: { driver_id, by, reason }`).
- At most `DISPATCH_MAX_REOFFERS` (2) re-offers per trip; after that the trip ends as `cancelled_driver` (rider not charged).
- Counted on the driver's offer (`trip_offers.status = 'cancelled'`). `DRIVER_CANCEL_FLAG_COUNT` (3) in 7 days → compliance flag `repeat_cancellation`
  (one open at a time). `GET /driver/me` `acceptance` adds `cancelled` (30 days), `cancelled_7d`, `cancel_review_at`.
- `GET /trips/:id` adds `driver_releases` (times the trip went back to the search).

**Ops reassign.** `POST /admin/trips/:id/reassign` (ops) `{ reason? }` → `{ trip }`: an `accepted`/`arrived` trip goes back to the search and is offered to the next
driver; not counted against the driver (offer status `released`), who is notified. Other states: 409 `bad_state`. Audited.

**Silent drivers.** No location for `DRIVER_SILENT_ALERT_MIN` (4) on a live trip → event `driver_silent` + ops `dispatch.driver_silent`, once per silence.
`DRIVER_SILENT_REASSIGN_MIN` (0 = off) reassigns accepted trips automatically. `GET /admin/live` trips add `driver_last_seen_at`, `driver_releases`, `scheduled_for`.
Online drivers with no signal for `DRIVER_STALE_OFFLINE_MIN` (30) and no live trip are set offline (notified); `POST /driver/location` now returns `{ ok, online }`.

**Offers.** Accept checks expiry on the DB clock with `OFFER_GRACE_S` (3) grace while the offer is still the latest (no one else is offered the trip during the
grace); refuses with 409 `driver_offline` / `on_trip`. Going offline, being blocked/suspended/deleted, or changing the current car withdraws an open offer
(event `offer_withdrawn`) and offers the trip to the next driver at once.

**Booked trips.** Released `SCHEDULED_LEAD_MIN` (15) ahead; the search runs until the booked time + `DISPATCH_SEARCH_WINDOW_MIN` with 2 × `DISPATCH_MAX_ATTEMPTS` offers.
A booking not released until more than `SCHEDULED_MISSED_MIN` (30) after its time is ended as `no_drivers` (holds released, rider told) instead of dispatched.

**Serverless.** Notifications, push and SMS started by a request are awaited (≤ 3 s) before the response is sent on Vercel, so a frozen function can't drop them.

## Driver pay (Round 4)

Rules live in setting `driver_pay` (defaults in code; nothing changes until an admin switches something on):
`{ service_fee: { own_car_pct: 25, green_pct: 25 }, pickup: { enabled: false, free_km: 2, driver_cents_per_km: 60, rider_cents_per_km: 60, max_km: 10 },
fuel_surcharge: { enabled: false, cents: 50 }, earnings_floor: { enabled: false, cents_per_engaged_hour: 3200, auto_weekly: false } }`.

- **Service fee by car.** Electric/plug-in hybrid/hybrid → `green_pct`; driver-owned petrol/diesel → `own_car_pct`; DingoGo fleet petrol → the driver's own
  `commission_pct`. The driver's own rate is a ceiling (the lower applies). Used for fares and the driver's share of late-cancellation fees.
- **Pickup pay / long pickup.** Quotes (`POST /quotes`, `/public/estimate`, `POST /trips`, phone bookings) for on-demand non-tour trips add a line
  `Long pickup (nearest car X km away)` = `round5(min(max(km − free_km, 0), max_km) × rider_cents_per_km)`, km = straight line × 1.3 from the nearest free car
  (none free → no charge). Discountable like the booking fee. The driver gets `pickup_pay` = paid km × `driver_cents_per_km` from their own distance to the
  pickup when offered (no service fee).
- **Fuel surcharge.** Line `Fuel surcharge (all to your driver)` on rides and parcels (not tours), added after discounts (5c multiple), all to the driver.
- Quote/`fare_breakdown` adds `long_pickup_cents`, `long_pickup_km`, `fuel_surcharge_cents`. `trip_cents` (what the fee applies to) excludes both.
- **Fixed at accept.** The `offered` event records `pickup_m`; the `accepted` event records `pickup_m` and `pay` (DriverPay). Completion pays what was accepted
  (fare re-metered on a route change). Ledger kinds added: `pickup_pay`, `fuel_surcharge`, `earnings_floor`. Commission note names the rate basis.

**DriverPay JSON** `{ fare_cents, fee_pct, fee_basis ('green'|'own_car'|'driver'), fee_cents, pickup_m, pickup_km, pickup_paid_km, pickup_pay_cents, fuel_surcharge_cents, total_cents }`.

**Driver**
- Offers (`offer.new` and `GET /driver/offers`) add `pickup_m`, `total_m` (pickup + trip) and `driver_pay`. The driver app keeps `trip_cents` and `driver_pay` from polled offers (it used to drop `trip_cents`).
- `GET /driver/trips` rows add `distance_m`, `driver_pay_cents` (fare − fee + pickup pay + fuel surcharge + cancellation share; no tips).
- `GET /driver/earnings` adds `summary { fares_cents, service_fee_cents, pickup_pay_cents, fuel_surcharge_cents, cancel_fees_cents, trip_pay_cents, tips_cents,
  bonus_cents, earnings_floor_cents, charging_cents, adjustments_cents, extras_cents, lease_cents, cash_collected_cents, costs_cents, take_home_cents, paid_out_cents }`,
  `activity { trips, engaged_s, trip_km, pickup_km, total_km, per_engaged_hour_cents }`, `floor { enabled, cents_per_engaged_hour, week_start, week_end, engaged_s, trips,
  earnings_cents, floor_cents, projected_topup_cents, per_engaged_hour_cents }`, `pay_rules { fee_pct, fee_basis, own_pct, fuel_type, pickup|null, fuel_surcharge_cents|null,
  earnings_floor_cents_per_hour|null }`. `daily` no longer subtracts payouts. `gst_on_fares_cents` = (fare + pickup pay + fuel surcharge) / 11. `net_cents` unchanged.

**Earnings floor.** Weeks run Monday–Sunday, Darwin time. Engaged time per trip = accept → completed/cancelled (rider, DingoGo, or driver for a rider-side reason),
capped at 2 × estimated duration + 45 min. Counted earnings = ledger `fare, commission, pickup_pay, fuel_surcharge, cancel_fee` in the week (tips never).
Top-up = max(0, rate × engaged hours − counted earnings). Table `driver_pay_weeks` (migration 012), one row per driver per week.

**Admin**
- `GET /admin/driver-pay` (ops) → `{ settings, defaults }`; `PUT /admin/driver-pay` (admin) partial body (strict; bounds: fees 0–50 %, per-km 0–300c, free km 0–20,
  max km 0–50, surcharge 0–500c, floor 0–10000c/h) → `{ settings }`; audited (`driver_pay`, before/after). `PUT /admin/settings/driver_pay` goes through the same validation.
- `GET /admin/driver-pay/floor?week=YYYY-MM-DD` (ops; Monday, default last full week; 400 `week` otherwise) → `{ week_start, week_end, enabled, auto_weekly,
  cents_per_engaged_hour, week_over, settled, migration_pending, rows: [{ driver_id, name, trips, engaged_s, earnings_cents, floor_cents, topup_cents,
  per_engaged_hour_cents, paid_cents?, paid_at? }], totals }`.
- `POST /admin/driver-pay/floor/run` (admin) `{ week? }` → `{ week_start, recorded, drivers_topped_up, topup_cents }`. 409 `floor_off`, 409 `week_not_over`,
  503 `migration_pending` (table missing). Safe to run twice / at once (advisory lock + primary key). Drivers are notified. With `auto_weekly`, the dispatch tick
  settles last week (checked hourly per instance).
- `GET /admin/trips/:id` adds `driver_ledger` (what the driver was paid for the trip).

## Accessibility (Round 5)

- **Rider needs reach the driver.** The rider's profile `accessibility` (`PATCH /me`: `hearing`, `vision`, `wheelchair`, `notes`) is sent as
  `rider_needs { hearing, vision, mobility, notes|null } | null` on offers (`offer.new` and `GET /driver/offers`), and as `trip.rider.needs` (same shape) on trips
  seen by the assigned driver and ops (`GET /trips/:id`, `/driver/trips/active`, accept/arrive/start responses, `/admin/trips/:id`). Null when nothing is set and
  for parcels. Riders, share links and other viewers don't get it. The raw profile JSON is never sent to drivers.
- **Assistance-animal refusal reports.** `POST /support` accepts `category: 'assistance_animal_refused'`. With a `trip_id` of the rider's own trip, the driver on the
  trip (or the last driver offered it who declined, cancelled, passed it on or let it lapse) gets an `assistance_animal_refusal` compliance flag (one open flag per
  trip and driver; ops get `compliance.flag` with `reported_by: 'rider'`); the ticket comes back with `flagged: true`. Without a trip, or with no driver to name,
  it's a normal ticket.
- **Clients (shared `api()`).** GET requests time out after 15 s and retry twice (0.8 s, 2.5 s) on network failure; writes are never retried. Network failures and
  bare 502–504 gateway answers throw `ApiError` code `offline`. `isOnline()` / `onNetworkChange()` / `useOnline()` expose the connection state for "no signal" UI.

## Driver app: poor signal and papers (Round 6)

- **Replaying trip taps.** `POST /driver/trips/:id/arrive|start|complete` accept an optional `Idempotency-Key` header (8–80 of `A–Z a–z 0–9 - _`; anything
  else is 400 `bad_idempotency_key`) and body `client_at` (ISO time of the tap). With a key: a repeat of a tap already applied (same key on the trip event, or the
  trip already at or past that step) returns `200 { trip }` as it is now, with no second event, notification, capture or ledger entry. Without a key the old strict
  behaviour stays (409 `bad_state`). A replay still fails for a real reason (wrong PIN 400 `pin_mismatch`, trip cancelled 409 `bad_state`, given to another
  driver 403). With a key and `client_at`, `arrived_at` / `started_at` / `completed_at` use the tap time, clamped to: not before the previous step, not more than
  15 minutes ago, not in the future. Keys and tap times are kept in `trip_events.data` (`idem`, `client_at`).
- **`POST /driver/location/batch`** `{ points: [{ lat, lng, heading?, at }] (1–720), battery_pct? }` → `{ ok, stored, online }`. GPS points the phone kept with
  no signal. Points older than 2 h or more than 1 min in the future are dropped; the rest go on the live trip's `trip_track` at their own time (only those after
  the trip was accepted). The driver's live position, the route-deviation check and the ops map use the newest point.
- **`GET /driver/me`** adds `expiring: [{ key, label, expires_on, days_left, level: 'expired'|'urgent'|'soon'|'upcoming', replacement_pending, vehicle_id? }]`,
  soonest first: the driver licence, H endorsement (NT), other approved driver documents with an expiry, and the current car's CVL (NT), inspection (SA),
  registration, insurance and other car documents, that expire within 30 days (Darwin dates). `urgent` ≤ 3 days, `soon` ≤ 14, `upcoming` ≤ 30.
  `replacement_pending`: a newer copy is waiting for DingoGo to check it.
- **Expiry reminders.** The dispatch tick (at most every 30 min per instance, 8 am–8 pm Darwin time) sends approved drivers one in-app/push notification per
  credential per reminder point (30, 14 and 3 days before), category `documents`, `data { reminder: '<key>:<date>:<point>', key, expires_on, days_left }`.
  None while a replacement is waiting. No new table: de-duplicated against the driver's notifications.
- **Clients.** Shared `api()`/`post()` take `{ headers, timeoutMs }`. Shared `useModal(ref, onClose?)` gives a portal dialog modal behaviour (inert app, focus in
  and back, Tab wraps, Escape).

## Admin and operations tooling (Round 7)

- **Search everything.** `GET /admin/search?q=` (admin, dispatcher; 2–100 chars) → `{ q, trips, drivers, people, vehicles }`, up to 8 each. Trips by ref
  (exact ref first) or rider/driver phone; drivers by name, phone or rego; riders and staff (not drivers) by name, email or phone; cars by rego or VIN
  (with `driver_id` of the driver using it or its owner). Phones match in any format (`0400 000 100`, `+61 400…`, the last digits); regos ignore case and spaces.
- **Trip list filters.** `GET /admin/trips` adds `from`/`to` (Darwin dates on `requested_at`), `status=cancelled` (any cancel), `rider_id`, `driver_id`; `q` also
  matches driver name and phone (any format) and rego; an unknown `status` is 400 `invalid_status`. Rows add `rego`.
- **SOS incident view.** `GET /admin/sos/:id` → `{ alert (with user_name, user_phone, handled_by_name), trip (rider, driver, car, share_token, driver's last
  position) | null, track (from 30 min before the alert), timeline: [{ at, kind: raised|acknowledged|step|note|resolved|trip, text, by }], runbook: [{ key, label,
  done_at, done_by }], runbook_steps }`. `POST /admin/sos/:id/notes` `{ text? (≤1000), step? (runbook key) }` (one needed) adds a note or ticks a step (each
  step once) and returns the incident; the first action on an open alert acknowledges it. `PATCH /admin/sos/:id` now **adds** `notes` to what is recorded
  (never overwrites) and refuses to change a resolved alert (409 `already_resolved`). Notes, steps, acknowledge and resolve are kept in `audit_log`
  (`entity = 'sos'`), so no new table.
- **Bulk document review.** `POST /admin/documents/review` (admin) `{ ids: uuid[1..50], status: approved|rejected, note? }` → `{ reviewed: [id], skipped: [{ id,
  reason: not_pending|not_found }] }`. Only documents still `pending` change; rejecting needs a `note` (400 `note_required`); one notification per driver.
- **CSV exports.** `GET /admin/export/trips.csv?from&to&status&kind&q` (admin, dispatcher; default last 30 days, at most a year → else 400 `bad_range`; up to
  50,000 rows; names, places and money but **no phone numbers or PINs**), `payouts.csv?from&to`, `levy.csv?month&state`, `gst.csv?from&to` (admin). UTF-8 with
  BOM, CRLF, Darwin times; text that a spreadsheet would run as a formula gets a leading apostrophe. `Content-Disposition: attachment`, `Cache-Control:
  no-store`. Every export is audited (`action = 'export'`, `entity_id` = the file name, the filters and row count).
- **Daily ops summary.** `GET /admin/summary/daily?date=YYYY-MM-DD` (admin, dispatcher; Darwin day, default today) → `{ date, trips (requested by type/channel
  and outcome), completed (count, passenger trips, fares, tips, average accept-to-arrival minutes, rating, km), cancellations [{ reason, n }], safety (alerts raised
  and resolved, flags by kind), support, documents (approved/rejected), drivers (drove, approved, applications), money (payouts, refunds, service fees),
  attention (now: open SOS/flags/tickets, documents and cars to check, new applications, trips searching > 5 min, bookings in the next 2 h) }`.
- **Audit log.** `GET /admin/audit` (admin) filters `actor` (uuid), `action`, `entity`, `entity_id`, `from`/`to` (Darwin dates), `q` (text in details or ids),
  `limit` (≤200, default 100), `before` (id cursor) → `{ items (with actor_name, actor_role), next_before, actions, entities, actors }` (menus on the first page
  only). Newly audited: document review (`document_review`), SOS (`sos_*`), compliance flag status (`flag_<status>`), support tickets (`ticket_<status>`),
  hire requests / applications / enquiries (`status`), ops trip cancel (`cancel`), exports.
- **Admin app.** Search box on every page (`/`), `g` then `l d t s i r f` to change page, `?` for the list; trip filters in the URL plus quick and saved filters
  (kept in the browser); incident drawer with runbook, map, notes and timeline; bulk approve/reject; daily summary on the Dashboard (print, CSV); audit log
  filters; drawers and dialogs are real modals; tabs use arrow keys. Migration `013_ops_indexes.sql` only adds indexes.

## Payments (Round 8)
Stripe when `STRIPE_SECRET_KEY` is set, otherwise the built-in mock provider (no network). Card data never reaches the API (Stripe Elements on the
client); the API only sees Stripe ids. Every Stripe write carries an idempotency key named after what it is for: `hold-<trip>-<attempt>`,
`capture-<pi>-<cents>`, `cancel-<pi>`, `fare|fee-<trip>-<cents>` (charge when there is no usable hold), `tip-<trip>-<cents>`, `retry-<trip>-<n>-<cents>`,
`refund-<trip>-<refunded so far>-<fare|tip>-<cents>`, `topup|pass-<user>-…-<Idempotency-Key>`, `customer-<user>`. API version pinned (`STRIPE_API_VERSION`, 2024-06-20).
- **Card mode** — `GET /payment-methods` adds `cards { mode: 'stripe'|'test'|'off', publishable_key }`; methods list default first and, with Stripe, only
  real Stripe cards (with `exp_month`/`exp_year`). `off` (mock provider, `MOCK_CARDS=test` and the account is not a seeded demo number or admin-made test
  account; the default in production without Stripe): every card payment (booking with `card`, tip by card, top-up, Pass, saving a card) is 402
  `cards_not_available`. `MOCK_CARDS=all` (default in dev mode) keeps the old behaviour for everyone.
- **Saving a card** — `POST /payment-methods/setup` → `{ provider: 'stripe', client_secret, setup_intent_id, publishable_key }` (SetupIntent on the
  rider's own Stripe Customer, `usage=off_session`). After `stripe.confirmSetup` on the device: `POST /payment-methods { setup_intent_id }`. The API
  fetches the SetupIntent: it must be this rider's (400 `setup_not_found`) and `succeeded` (400 `setup_incomplete`); brand, last4, expiry and
  fingerprint come from Stripe. The same card again (fingerprint) → `{ method, already_saved: true }` and the copy is detached. Max 10 cards
  (`too_many_cards`). Test mode keeps `{ provider_ref, brand, last4 }`. `POST /payment-methods/:id/default`. `DELETE` detaches at Stripe and makes the
  newest remaining card the default.
- **Fares** — booking with `card` needs a saved card with Stripe (402 `card_required`). The hold (quote + 20%, manual capture) is placed off-session on the
  default card at booking; **booked (scheduled) trips get it when released to drivers** (15 min before), not at booking. Declined: 402 `payment_failed`
  with a plain message and `details.reason` (e.g. `insufficient_funds`); a card that needs a bank check off-session: `details.reason =
  'authentication_required'` (the half-done hold is cancelled). A booking that fails after its hold was placed releases the hold. Declined at release:
  the booking is cancelled (`cancelled_admin`, reason "Card declined when the booking was due"), points/promo back, event `payment_failed`
  `{ stage: 'release' }`, rider notified, ops `payment.failed`.
- **Capture** — at the end of the trip (and for cancellation fees) the hold is captured; if it lapsed or was cancelled the saved card is charged afresh
  (`fare-…`/`fee-…`), and the trip's `payment_ref` moves to the new PaymentIntent. Late tour/hire fees on bookings that were never held are charged the
  same way. If that fails too the trip's `payment_status` is `failed` (event `payment_failed`, rider notified "Payment didn't go through", ops
  `payment.failed`); the driver's pay is unaffected.
- `POST /trips/:id/pay` (rider) and `POST /admin/trips/:id/retry-payment` (admin, audited) → `{ ok: true, payment_status: 'captured' }`; the rider
  route returns 402 `payment_failed` on a decline, the admin route `{ ok: false, error, code }`. 409 `nothing_to_pay` unless the trip's card payment failed.
- **Tips, top-ups, Pass** — each its own PaymentIntent, captured at once. `POST /wallet/topup` and `POST /subscriptions` honour an `Idempotency-Key`
  header: a replay returns the same result with `replayed: true` and credits/extends once.
- **Refunds** (`POST /admin/trips/:id/refund`) — fare first, then tip, each back where it was paid (the fare's and the tip's own PaymentIntent; DingoGo
  credit for wallet and cash). One `payments` refund row per part: GST on the fare part only (`round(cents / 11)`), none on the tip part. Event data adds
  `fare_cents`, `tip_cents`. Payment-failed trips have nothing to refund on the fare.
- **Webhook** `POST /payments/stripe/webhook` (no auth; raw body; `Stripe-Signature` checked with `STRIPE_WEBHOOK_SECRET`, HMAC-SHA256, any `v1`,
  5-minute tolerance, constant-time). 503 `webhook_not_configured` without the secret, 400 `bad_signature`/`signature_expired`. Each event id is applied
  once (`payment_events`; a replay → `{ received: true, duplicate: true }`), in one transaction with its effect (an error rolls both back so Stripe
  retries; 503 `migration_pending` before migration 014). Handled: `payment_intent.succeeded` (pending rows marked done), `payment_intent.payment_failed`
  (trip event + ops), `payment_intent.canceled` (a live trip's hold lapsed → `payment_status 'none'`, event `hold_lapsed`, ops `payment.hold_lapsed`; the
  fare is charged afresh at the end), `charge.refunded` (dashboard refunds: the difference between Stripe's `amount_refunded` and what DingoGo recorded
  for that PaymentIntent is recorded once, GST as above; top-up refunds take the credit back), `charge.dispute.*` (one `payments` row
  `kind: 'dispute'` per dispute with Stripe's status, trip event `dispute_opened|dispute_updated|dispute_closed`, audit, ops `payment.dispute`). Other
  types → `handled: 'ignored'`. Subscribe the endpoint to: `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`,
  `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed`.
- `GET /admin/payments/issues` (admin) → `{ failed: [{ id, ref, status, cents, at, rider_name, reason }], disputes: [{ id, dispute_ref, status, cents,
  created_at, trip_id, ref, rider_name }] }` (open disputes: not won/lost/warning_closed). `GET /admin/integrations` adds `payments_webhook`, `card_elements`.
- **Tax invoice** (`GET /trips/:id/receipt`) adds `invoice_number` (trip ref), `supplier_abn`, `supplied_by { name, abn, gst_registered }` (the driver:
  DingoGo issues the invoice on the driver's behalf, matching the GST report), `customer { name, ndis_number }`, `cancellation_fee`, `refunds [{ at,
  cents, gst_cents }]`, `refunded_cents`, `net_total_cents`, `net_gst_cents`, `gst_note`, `tip_note`, `payment_status`. Title "Tax Invoice (adjusted)" once
  refunded. Cancellation-fee invoices list one "Cancellation fee" line (they listed the trip's fare lines) and no CO₂ figure.
- Payments rows: card captures are recorded with `provider` `stripe` or `mock` (were `card`); failed holds are recorded (`kind: 'authorise'`,
  `status: 'failed'`).

## Notifications and communications (Round 9)
Wording for every inbox message, push and text lives in `services/api/src/lib/messages.ts` (texts in plain GSM-7, at most 2 parts, naming DingoGo).
Migration `015_comms.sql` adds `users.notification_prefs`, `marketing_consents`, `sms_opt_outs`, `trip_messages`, `comms_log`. Before it is applied:
settings fall back to the defaults, chat answers 503 `migration_pending`, nothing is logged, STOP is still answered.

- **Trip chat.** `GET /trips/:id/messages?after=<id>&peek=1` (rider, current driver, ops) → `{ messages: [{ id, from: rider|driver|dingogo, mine, body,
  quick, via: app|sms, created_at, read_at }], unread (with peek), can_send, closes_at, quick_replies: [{ key, text }], role }`. Without `peek` the other
  side's messages are marked read (staff reading marks nothing). `POST /trips/:id/messages { body? (≤500 after cleaning) | quick? (key), client_id? }` →
  201 `{ message }`, or 200 `{ message, replayed: true }` for a `client_id` already stored. Open while the trip has a driver (accepted, arrived, in
  progress) and 30 minutes after drop-off (409 `chat_closed`); staff can always write (`from: 'dingogo'`). 20 messages per 5 minutes per person per trip
  (429). 400 `bad_quick_reply` / `empty_message`; 404 for anyone else (another driver, a driver the trip was taken from). Realtime `message.new` on
  `trip:<id>` and `user:<id>`; push (category `chat`, collapsed per trip, not in the inbox). Messages from a phone-booked rider's driver/DingoGo are
  also texted to the rider from the relay number. `GET /admin/trips/:id` adds `messages` and `comms` (texts/calls: template, last 3 digits, status).
- **Contact.** `GET /trips/:id/contact` (rider or driver) → `{ chat, call: { number, note } | null, text: { number } | null, reason: null|not_live|relay_off }`.
- **Relay number (masked calls/texts).** `TWILIO_RELAY_NUMBER`. `POST /comms/twilio/voice` (Twilio Voice webhook): the caller's number finds their live
  trip (rider or driver) and gets `<Dial callerId="relay">other party</Dial>` (15 min limit); otherwise a spoken "no live trip" message. Trip event
  `relay_call`. `POST /comms/twilio/sms` (Messaging webhook, every DingoGo number): `STOP`/`STOPALL`/`UNSUBSCRIBE`/`CANCEL`/`END`/`QUIT`/`OPT OUT` →
  number added to `sms_opt_outs`, marketing withdrawn for that account (consent record `sms_stop`), reply; `START`/`UNSTOP` → texts back on (offers stay
  off); `HELP`/`INFO` → reply with support number. Anything else sent to the relay number goes into the sender's live trip chat (or one that ended < 30
  min ago) as `via: 'sms'`. Both webhooks need `X-Twilio-Signature` (HMAC-SHA1 with `TWILIO_AUTH_TOKEN` over `TWILIO_WEBHOOK_BASE_URL` + path + sorted
  params) → 403 `bad_signature`; 503 `sms_not_configured` without the token. Replies are TwiML (`text/xml`).
- **Texts.** Twilio with `TWILIO_FROM` (number or sender ID) or `TWILIO_MESSAGING_SERVICE_SID`, 8 s timeout, typographic quotes/dashes swapped for
  GSM ones. Kinds: essential (sign-in code, SOS to emergency contact: sent even after STOP), transactional (skipped for numbers in `sms_opt_outs`),
  marketing (needs consent and a sender that takes replies). Twilio error 21610 adds the number to `sms_opt_outs`. Each text is logged in `comms_log`
  (template, last 3 digits, status, Twilio SID, error) — never the text. Trip updates (`driver_on_way`, `driver_here`, `no_drivers`,
  `finding_another_driver`, `driver_cancelled`, `booking_card_declined`) are texted for phone/SMS bookings and to riders who turned on trip texts.
- **Push.** `FCM_SERVICE_ACCOUNT` → FCM HTTP v1 (service-account JWT → OAuth token, cached) for `android`/`ios` tokens; `WEB_PUSH_VAPID_*` → Web Push
  (VAPID ES256, aes128gcm) for `web` tokens (the JSON `PushSubscription`); Expo only for `ExponentPushToken[…]` with `EXPO_PUSH_ENABLED`. Tokens
  reported dead (FCM `UNREGISTERED`/404, Web Push 404/410, Expo `DeviceNotRegistered`) are deleted. `DELETE /me/push-token { token }` → `{ ok, removed }`
  (sign-out). `GET /public/config` adds `push { web_push_key, fcm }`, `comms { relay, chat }`. `GET /admin/integrations` adds `sms_replies`, `sms_relay`,
  `push_fcm`, `push_web`, `push_expo`.
- **Settings.** `GET /me/notification-prefs` → `{ prefs: { push: { trip, chat, account, documents, promo }, sms: { trip } }, marketing: { opted_in,
  wording, last_change: { granted, source, at } | null }, sms_opted_out, categories: [{ key, label, help, locked? }], channels: { push: { fcm, web,
  expo }, web_push_key, sms } }`. `PUT` the same shape partially (`{ push?: {...}, sms?: { trip }, marketing?: boolean }`, strict; 503
  `migration_pending` for push/sms before 015). The inbox always gets service messages; `safety` is always pushed; offers (`promo`) go nowhere —
  not even the inbox — without `marketing_opt_in`. Defaults: all push on, trip texts off.
- **Marketing consent (Spam Act).** Every change of `marketing_opt_in` (`PUT /me/notification-prefs`, `PATCH /me`, STOP, account deletion) adds a
  `marketing_consents` row with the wording shown (`MARKETING_CONSENT_WORDING`), source and IP. `POST /admin/broadcast` adds `channel: 'app'|'sms'`
  (default app) → `{ sent, skipped }`; SMS only to `riders_opted_in` (400 `sms_riders_only`), needs Twilio (409 `sms_not_configured`) and a reply-capable
  sender (409 `sms_marketing_unavailable`), at most 2 text parts (400 `sms_too_long`), text `DingoGo: <message> Reply STOP to opt out.`, skips opted-out
  numbers. Sent 10 at a time. `GET /me/export` adds `messages`, `marketing_consents`, `notification_prefs`.
- **Category changes.** `referral_bonus` is now `account` (was `promo`, so it was hidden from riders who hadn't opted in to offers); tips are `account`.

## Operations (Round 10)

- **`GET /health/deep`** → `{ ok, status: 'ok'|'degraded'|'down', release, time, db: { ok, ms }, schema: { version, up_to_date }, problems[] }`.
  `problems`: `database_unreachable`, `migrations_pending`, `schema_unreadable`, `base_data_missing`, `base_data_unreadable`, `auto_migrate_failed`.
  Admins/dispatchers (bearer token) and callers sending `X-Health-Token: <HEALTH_TOKEN>` also get `environment`, `serverless`, `db.error/code`,
  `schema: { version, expected, applied, pending[], unknown[] }` (`unknown` = applied in the database but not in this code: an older deploy),
  `auto_migrate: { enabled, last: { at, ms, applied[], pending[], busy, fresh, error, security?, seeded? } }`,
  `base_data: { active_zones, fare_rules, active_jurisdictions, admins, ok }`, `security: { tables_without_rls[], client_role_grants[] }` and
  `integrations` (same as `GET /admin/integrations`, plus `error_reporting`). 200 unless the database is down (503). `Cache-Control: no-store`.
  On Vercel `/health*` is answered even when the database can't be reached (everything else gets the 503 below).
- **Request ids.** `X-Request-Id` on every response: the caller's own id if it matches `[A-Za-z0-9._:-]{8,64}`, else a new UUID. 500/503 bodies carry
  `request_id`; the apps show the first 8 characters as "(ref …)" on 500s so support can find the log line.
- **Errors on our side.** Database unreachable (connection refused/reset/timeout, admin shutdown, too many connections) → **503 `db_unavailable`**
  with `Retry-After: 30` (was a 500, or "Service is starting up" on Vercel). A missing table or column (code ahead of the schema) → **503
  `migration_pending`** with `Retry-After: 60` (was a 500). Neither changed anything, so a write with an `Idempotency-Key` can be sent again; the
  driver app's outbox keeps taps on these 503s. Shared client: reads retry on `db_unavailable` (0.8 s, 2.5 s), then the app shows "DingoGo is having
  a problem on our side" until a request gets through (`isServiceUp`/`onServiceChange`/`useServiceUp`, `ServiceNotice`, `isTemporary(e)`).
- **Logs.** JSON lines (pino) on stdout: `level`, `time`, `service`, `release`, `request_id`, and one `request` line per request with `method`, `route`
  (the route pattern, e.g. `/public/track/:token` — never the raw URL or query string), `status`, `ms`, `user_id`/`role` when signed in and
  `vercel_id` on Vercel. Authorization headers, cookies and any `token`/`code`/`password` fields are redacted. `LOG_LEVEL` (default `info` in production
  and on Vercel, `warn` elsewhere). Errors outside requests (dispatch tick, background sends, auto-migrate, unhandled rejections) are logged with `where`.
- **Error reporting.** `SENTRY_DSN` (optional; `SENTRY_ENVIRONMENT`, `SENTRY_TIMEOUT_MS`): unhandled 500s, `db_unavailable`/`migration_pending`,
  failed auto-migrations and errors outside requests are sent to Sentry's envelope endpoint (no SDK). Events carry the error, stack, `release`
  (`GIT_SHA` or `VERCEL_GIT_COMMIT_SHA`), tags `where`/`route`/`method`/`request_id`/`pg_code` and the account id only — no request bodies, headers,
  phone numbers or names. Off without the DSN.
- **Migrations.** `npm run db:migrate` (`--status` to list), `npm run db:bootstrap` (`--check`), `AUTO_MIGRATE=true` at cold start: one runner
  (`src/lib/migrator.ts`), each file in its own transaction behind `pg_try_advisory_xact_lock(0x44474d47)` and a re-read of `schema_migrations`, so
  concurrent runners apply each file once; `lock_timeout` (`MIGRATE_LOCK_TIMEOUT_MS`, 5 s at cold start / 10 s from the CLI) so a migration never
  queues live traffic behind it; at cold start also `statement_timeout` (`AUTO_MIGRATE_STATEMENT_TIMEOUT_MS`, 20 s) and at most
  `AUTO_MIGRATE_WAIT_MS` (10 s) waiting for another instance. A failed migration is rolled back, logged, reported and shown in `/health/deep`; the API
  keeps serving. After applying anything, RLS/grants are re-applied (new tables). On a brand-new empty database AUTO_MIGRATE also adds the base data
  and `BOOTSTRAP_ADMIN_PHONE`. Migrations use `MIGRATION_DATABASE_URL` when set (owner), else `DATABASE_URL`. The Vercel function ships the SQL files.
- **Scripts.** `db:reset` refuses a non-local database unless `ALLOW_DB_RESET=yes`; the demo seed refuses one unless `DEMO_DATA=true`.
  `npm run db:backup` (`--json`, `--out`). See `docs/OPERATIONS.md`.

## Courier and delivery business (Round 11)

Needs migration `016_courier_business.sql`. Until it is applied: single parcels, tracking, dispatch and earnings work as before;
runs, pickup windows, failed-delivery returns and recipient instructions answer 503 `migration_pending`; `/public/config` → `courier.runs: false`.

**Parcel checks** (`POST /trips` with `kind: courier`, runs, CSV): weight within the size (S 5 kg, M 15 kg, L 25 kg) → 400 `parcel_too_heavy`;
recipient must be an Australian mobile → `recipient_mobile` (phones stored as +61…); sender any Australian number → `sender_phone`; declared value
≤ $1,000. Prohibited items: `parcel.prohibited_items` must list every key in `/public/config` → `courier.prohibited.keys` (stored with the version
in `parcels.prohibited_checklist`); older apps may still send `prohibited_ack: true`. New optional parcel fields: `safe_place` (with
`leave_unattended`), `customer_ref` (the sender's order/script number). Signature-required parcels can't have a safe place.

**Pickup windows:** `pickup_window_end` with `scheduled_for` (parcels only, 30 min to 4 h). Released at the start of the window (not 15 min early),
searched until the window closes, offer and tracking show the window, recipient texted `parcel_recipient_booked` ("collected Thu 2:00-4:00 pm").

**Multi-drop runs:** `POST /courier/runs/quote` `{ pickup, drops: [{ dropoff, size }], keep_order? }` → stops in delivery order (nearest first)
with `index` into the request; `POST /courier/runs` `{ pickup, sender_name, sender_phone, payment_method, corporate_account_id?, scheduled_for?,
pickup_window_end?, prohibited_items, drops: [{ dropoff, parcel }] (2–10) }` → `{ batch, trips }`, all-or-nothing. Each drop is its own trip
(`batch_id`, `batch_seq`, own price, PIN, hold, invoice line and tracking link). Later drops are priced on the leg from the previous drop with no
base fare, booking fee or long-pickup charge, minimum `courier_policy.extra_stop_min_cents` ($6). Only the first drop is dispatched; the offer
carries `run: { stops, trip_m, pay_cents, last_drop }`; accepting assigns every drop; arrive/start apply to the whole run; each drop is delivered on
its own. `/driver/trips/active` returns the next drop (returns last); trips carry `batch` (ref and every stop) for the sender, driver and ops, never
on share links. A driver pulling out (own reason) or ops reassigning releases the whole run; a driver no-show/rider-asked/unsafe cancel at the
pickup ends every drop; a prohibited parcel ends only its drop. No route-deviation alert on runs. Engaged time (earnings floor) counts each drop from
the previous drop's finish, so minutes aren't counted twice.

**On its way:** at pickup each recipient gets `parcel_on_way` with an ETA (cumulative leg times + `handover_s` per earlier drop), stored as
`parcels.eta_at`.

**Failed delivery:** `POST /driver/trips/:id/delivery-failed` `{ reason: no_one_home|no_safe_place|refused|wrong_address|no_access|unsafe|other,
note?, photo_url? (own pod upload), lat?, lng? }` (in-progress parcels; `other` needs a note; `no_one_home` refused with `use_safe_place` when a safe
place is allowed). The parcel becomes `outcome: returning`, a "Return to sender" line is added (`courier_policy.return_fee_pct` 50% of the trip
fare, min $5; 0 turns it off), the recipient and sender are texted and the sender notified. Completing a returning parcel needs `pod_received_by`
plus a signature or photo (`return_pod_required`); the trip completes with `final_cents = quote + fee`, outcome `returned`, and the driver is paid
the fee like the fare (less the service fee). Credit-paid returns take only the credit left. Card trips over the hold are charged afresh and the old
hold is released. `POST /trips/:id/reattempt` (sender, returned parcels, once → `already_rebooked`) books the same parcel again at a normal fare with
a new PIN; optional `scheduled_for`, `pickup_window_end`, `leave_unattended`, `safe_place`, `instructions`, `payment_method`.

**Delivered:** `parcels.outcome = delivered`, `pod_distance_m` from the drop-off; a photo-only drop more than 400 m away raises a
`delivery_far_from_address` compliance flag.

**Recipient tracking:** `GET /public/track/:token` adds `trip.parcel` (outcome, `eta_at`, window, safe place, notes, `left_photo_url` signed when
left with a photo, failed reason, `can_add_instructions`). `POST /public/track/:token/instructions` `{ notes?, safe_place? }` before the driver has
been (10 per hour per IP); a safe place switches on `leave_unattended` (refused for signature parcels: `signature_required`).

**Business dashboard:** `GET /business/deliveries?account_id&status=all|active|done|problem&from&to&q&limit` — managers of a business account see
every courier trip on it, members their own, no account → own; with `summary`. `GET /business/deliveries.csv` (same filters, no phone numbers).
`POST /business/deliveries/import` `{ csv, dry_run (default true), pickup, sender_name, sender_phone, payment_method, corporate_account_id?,
scheduled_for?, pickup_window_end?, prohibited_items }`: header row with `recipient_name`, `recipient_phone`, `address` (+ optional `lat`, `lng`,
`size`, `weight_kg`, `description`, `instructions`, `safe_place`, `leave_unattended`, `requires_signature`, `reference`, `declared_value`; common
aliases accepted), up to 50 rows; addresses without lat/lng are matched against known Alice Springs places. Every row is checked first; any error →
400 `csv_errors` with `details: [{ row, error }]` and nothing booked; otherwise booked as runs of up to 10 drops.

**Settings:** `courier_policy` `{ return_fee_pct, return_fee_min_cents, extra_stop_min_cents, handover_s }` (admin → Settings, clamped; defaults in code).

## Community and cultural fit (Round 12)

Needs migration `017_community.sql` (`client_consents`, `users.concession`, `drivers.leave`). Before it: `/public/config` says
`client_bookings: false` and `community_pricing.concession: false`; client bookings, concession cards and leave answer 503 `migration_pending`;
`GET /me/consents` is empty; everything else (quotes, Sorry Business cancels, reminders) works.

**Languages:** `PATCH /me { language: en | aer | rop }` (`arr` from older apps is stored as `aer`; anything else 400). `/public/config.languages`
gives each language's status (`source` / `draft`). Words live in `packages/shared/src/i18n/strings.json` (English source; Arrernte and Kriol entries
are drafts until a named community reviewer approves them; missing words fall back to English). `npm run i18n:review` writes a CSV for reviewers.

**Place names:** `GET /places/search` and `/public/places` match English or Arrernte names; results have `name` ("Rungutjirba (Simpsons Gap)"),
`english_name`, `arrernte_name`, and for sacred sites `sacred: true` with a respect `note`.

**Simple mode:** `accessibility.simple: true` on the profile (rider app: big pictures, short words, status read aloud). Not sent to drivers.

**Concession fares** (setting `community_pricing`, off by default): `GET/PUT /admin/community-pricing` (PUT admin only) `{ enabled, concession_pct
(0–75), concession_max_cents (0–$100, 0 = no cap), services[], types[] (pensioner, health_care, seniors, dva, student) }`; `PUT
/admin/settings/community_pricing` goes through the same checks. Rider: `PUT /me/concession { type, last4, expires }` (400 `concession_off`,
`concession_type`, `concession_expired`; never the full number) → `pending`; `DELETE /me/concession`. Ops: `GET /admin/concessions?status=pending|
approved|rejected|all`, `POST /admin/concessions/:userId/review { status, note }` (note required to reject; rider notified). An approved, unexpired
card gives a `Concession (−N%)` fare line on the discountable amount (fare + booking fee, not the levy or fuel surcharge), capped per trip;
`trip_cents` (what the driver earns on) is unchanged.

**Organisations booking rides for clients:** account kinds `community_org`, `aboriginal_corporation`, `health_service`, `ndis_plan_manager`,
`government` (not `business`). Members only:
- `GET /business/clients?account_id` — consents (current first): `client` ("Mary K."), `client_full_name`, `phone_tail` ("…934"), `method`, dates.
- `POST /business/clients { account_id, name, phone (Australian mobile), method: verbal|written|standing, note?, expires_at?, confirm: true }` →
  201; the client is texted (`client_consent_recorded`); 409 `consent_exists`; staff/driver numbers refused.
- `POST /business/clients/:id/withdraw`.
- `POST /business/rides/quote` and `POST /business/rides { account_id, consent_id, pickup, dropoff, scheduled_for?, passengers?, assistance_animal?,
  needs_wheelchair?, women_driver_pref?, notes?, ndis_number? }` — 403 `consent_required` without current consent. The trip's rider is the client
  (`channel: org`, `booked_by` the staff member, paid on the account); the client gets `ride_booked_for_you` and the usual trip texts. The response
  has no PIN, share link or full phone.
- `GET /business/rides?account_id` — managers see the account's client rides, members the ones they booked. `POST /business/rides/:id/cancel`
  (booker or manager; same rules and fees as the client cancelling).
- Client side: `GET /me/consents`, `POST /me/consents/:id/withdraw`; `GET /me/export` includes `booking_consents`. All audited.

**Driver leave (Sorry Business):** `POST /driver/leave { kind: sorry_business|cultural|family, until? }` (409 `on_trip` while on a trip) → offline,
offers withdrawn, no paper reminders; `DELETE /driver/leave` or going online ends it; `GET /driver/me` has `driver.leave`. Driver cancel reason
`sorry_business`: the trip goes to the next driver, the offer is marked `released` (not a cancellation, no repeat-cancel or assistance-animal flag),
no note is stored, and the driver is put on leave (`leave` in the response). Ops: `GET /admin/drivers/on-leave`; drivers list has `leave`.
