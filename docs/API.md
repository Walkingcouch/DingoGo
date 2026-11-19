# DingoGo API reference

Base URL: `http://localhost:4000` in development. Auth: `Authorization: Bearer <JWT>` from `/auth/otp/verify`. Errors: `{ error, message, details?, request_id? }`; every response has an `X-Request-Id` header. Money in integer cents (AUD, GST-inclusive).


## Public (no sign-in)

| Method | Path |
| --- | --- |
| GET | `/health` |
| GET | `/health/deep` (Round 10: database, schema version, pending migrations, integrations; details for admins / `X-Health-Token`) |
| GET | `/health/routing` (which routing provider answered a fixed Alice Springs route: `osrm`, `ors` or `estimate` with the last error) |
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
| GET | `/support/:id` (thread, Round 22) |
| POST | `/support/:id/messages` (Round 22) |
| POST | `/support/:id/rating` (Round 22) |
| GET | `/trips/:id/help` (Round 22) |
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
| GET | `/admin/support` (queue, Round 22) |
| GET | `/admin/support/:id` (Round 22) |
| PATCH | `/admin/support/:id` |
| POST | `/admin/support/:id/messages` (Round 22) |
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

`GET /admin/languages` (ops): the app languages with their review state (Arrernte and Kriol drafts).

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

## Website, SEO and growth (Round 13)

Driver recruitment funnel (migration 018; before it is applied the form still works without a reference or status link, status links answer
503 `migration_pending`, admin stages save without `updated_at`):
- `POST /public/driver-applications` also takes `source` (≤ 80 chars; normalised to lower-case `utm_source / utm_campaign` or a referrer host) and
  `drive_state` (`NT`|`SA`). Returns `{ ok, id, ref: "DA-XXXXXX", status_token, status_url }` and texts the applicant the status link
  (template `driver_application_received`, when SMS is set up).
- `GET /public/driver-applications/status/:token` → `{ application: { ref, first_name, stage, stage_label, stage_detail, steps[{key,label,done,current}],
  note, drive_state, received_at, updated_at, can_withdraw } }` — no phone, email, message or source. `Cache-Control: no-store`. Wrong tokens are
  404 and counted per IP (`application_token_ip`, 60/hour); over the limit → 429.
- `POST /public/driver-applications/status/:token/withdraw` → stage `withdrawn` (409 `application_closed` once approved/declined/withdrawn).
- Stages: `new` (Received) → `contacted` (We've called) → `onboarding` (Paperwork) → `approved`; or `declined` (Not right now) / `withdrawn`.
- `GET /admin/applications` → `{ items (no status_token), stages, funnel: { days: 90, stages: {status: n}, sources: [{source, n, approved}] }, status_links }`.
- `PATCH /admin/applications/:id` `{ status?: stage, public_note?: string ≤ 300 | null, notify?: true }` — a stage change texts the applicant the new
  stage and link (`driver_application_update`) unless `notify: false`; returns `{ item, texted }`; audited. Other statuses are now 400.

Referrals:
- `GET /public/referrals/:code` → `{ valid, code (upper-case, or null), bonus_points }`. Nothing about the referrer. Misses counted per IP
  (`referral_check_ip`, 60/hour) → 429 over the limit.

Website (no API changes): every public page is prerendered with its own head (title, description, canonical, Open Graph with
`/og-1200.jpg`, Twitter large card, JSON-LD) from `apps/web/src/seo.ts`; `sitemap.xml`, `robots.txt`; `app.html` (noindex) serves private and
unknown paths. Links: `/fares?from=lat,lng,Name&to=…&service=ride|pet|courier_s|courier_m|courier_l` (shareable estimate), `/rider/?from=…&to=…&service=…`
(pre-fills booking, survives sign-in) and `/rider/?ref=CODE` (pre-fills the sign-up code), `/invite/CODE`, `/drive/status/TOKEN`, `/airport`,
`/hospital`. Build env (website): `VITE_SITE_URL` (canonical host; else `VERCEL_PROJECT_PRODUCTION_URL`, else the live URL), and analytics
`VITE_ANALYTICS_DOMAIN` (off when unset), `VITE_ANALYTICS_SRC`, `VITE_ANALYTICS_API` (Plausible-compatible, cookie-free, Do Not Track honoured).

## Safety and trust (Round 14)

Needs migration `019_safety.sql` (`users.trusted_contacts`, `users.auto_share`, `safety_checks`, `driver_online_sessions`, `identity_checks`,
`incident_reports`, `account_actions`, `appeals`). Before it (`lib/safety.ts` `safetyReady()`, re-checked once a minute): SOS (emergency contact
texted), route-deviation notice, going online, sign-in and the emergency card all work; `GET /me/safety` says `ready: false`; the other endpoints
below answer 503 `migration_pending` (lists are empty).

**Policy** (setting `safety_policy`, defaults in code): `GET /admin/safety/policy`, `PUT /admin/safety/policy` (admin; also via
`PUT /admin/settings/safety_policy`, same checks; audited) `{ identity_check: { mode: off|photo_review|face_match, every_hours: 24,
match_threshold: 0.9 }, fatigue: { enabled: true, max_online_min_24h: 720, rest_min: 360, break_after_min: 300, break_min: 20, warn_before_min: 30 },
check_ins: { enabled: true, long_stop_min: 5, answer_min: 3, text_contacts_on_escalation: true }, night: { from_hour: 21, to_hour: 6 },
incidents: { auto_hold_critical: true } }`. The fatigue defaults follow common point-to-point guidance (12 h then a 6 h rest); check them against
current NT and SA guidance. `GET /admin/safety/overview` → counts (check-ins, photo checks, open/critical reports, appeals).

**Trusted contacts and sharing:** `GET /me/safety` → `{ ready, trusted_contacts, auto_share, night, numbers }`; `PUT /me/safety { trusted_contacts?:
[{ name, phone }] (≤ 5, not your own number, no duplicates), auto_share?: off|night|always }` (any signed-in user; drivers use contacts for SOS only).
`/me` returns both fields. When a driver accepts a ride, a rider with `always` (or `night` inside the night window, Darwin time) has each trusted
contact texted `trip_shared` (driver first name, car, rego, live link); the trip timeline gets `shared_with_contacts { count, auto }` (no numbers).
`POST /trips/:id/share-contacts` (rider, live trip) does it on demand: `{ sent }`, 400 `no_contacts`, 429 `share_limit` after 3.
SOS (`POST /trips/:id/sos`) texts every trusted contact plus the emergency contact (`contacts_texted` in the response). Driver SOS (`POST /driver/sos`)
is now on the trip timeline (`sos`, role driver) and texts the driver's contacts a map link to the car (never the rider's trip link).

**Check-ins ("Are you OK?"):** raised for a ride in progress that has been stopped (all points within 150 m) for `long_stop_min` with a fresh signal,
at least 300 m from the pickup and drop-off (not tours or multi-drop runs; at most one per 3 × `long_stop_min`), for a route deviation (was a plain
notice), or by ops (`POST /admin/trips/:id/check-in`, 409 `check_pending`). The rider gets a `safety_check` push/inbox message and a realtime
`safety.check`; ops get `safety.check_in` / `safety.long_stop`. Rider: `GET /safety/checks?trip_id=` → pending `{ id, reason, answer_by }`;
`POST /safety/checks/:id { answer: ok|help }` → `ok` closes it; `help` raises an SOS alert at once (`{ status: 'help', sos_id, emergency_number }`).
Unanswered after `answer_min`: the dispatcher tick raises an SOS alert (`sos_alerts`, role rider, message "No answer to a safety check (…)"), which
uses the usual incident view and runbook, and texts the rider's contacts `check_in_escalated_contact`. A late "I'm OK" is noted on the incident.
`GET /admin/safety/checks` (7 days). Trip events: `check_in`, `check_in_ok`, `check_in_help`, `check_in_escalated`, `check_in_late_answer`.

**Fatigue:** online time is recorded in `driver_online_sessions` (opened/closed by `/driver/online`, leave, blocks, photo-check rejection, and
synced with the online flag on every safety tick). Daily limit: `max_online_min_24h` online since the last rest of `rest_min` → rest `rest_min`.
Break: `break_after_min` online with no gap of `break_min` → off for `break_min`. Over a limit: offline as soon as the driver has no live trip (tick, or
straight after `complete`), offers withdrawn, `fatigue_offline` with the time they can return; `fatigue_warning` once per session
`warn_before_min` before. `POST /driver/online` → 409 `fatigue_rest` with `details.fatigue { reason, rest_until, online_min_24h, continuous_min }`.
`GET /driver/safety` → `{ fatigue: { enabled, online_min_24h, continuous_min, minutes_left, rest_until, reason }, identity }`. `GET
/admin/safety/fatigue` → online and resting drivers.

**Driver photo check** (off by default): with `photo_review` or `face_match`, `POST /driver/online` → 409 `identity_check_needed` (no photo in
`every_hours`) or `identity_check_rejected`. Upload purpose `selfie` (drivers only, private like documents), then
`POST /driver/identity-check { photo_url }` → 201 `{ check: { status, method, match_score } }` (image only; taken in the last 10 minutes, 400 `photo_too_old`; 409 `photo_used`).
`face_match` with `FACE_MATCH_URL` set: the provider gets `{ selfie, reference }` (base64; reference = last approved photo) and answers
`{ score }`; ≥ `match_threshold` → approved at once, else pending; provider down or no reference yet → pending (`photo_review`). Drivers can drive
while a photo is pending. Ops: `GET /admin/identity-checks?status=pending|approved|rejected|all` (signed photo, last approved photo, licence),
`PATCH /admin/identity-checks/:id { status: approved|rejected, note }` (note needed to reject; rejected → offline unless on a trip, driver told; audited).

**Safety reports:** `GET /safety/report-categories` → categories with severity (`critical`: sexual_misconduct, physical_assault; `high`:
impaired_driving, dangerous_driving, threats_abuse, discrimination, wrong_driver_or_car, contact_after_trip; `normal`: unsafe_vehicle,
rude_behaviour, other) and support numbers. `POST /safety/reports { trip_id?, category, description (10–2000), evidence?: [upload refs ≤ 4] }`
(rider or driver of that trip; evidence must be the reporter's own uploads with purpose `evidence`, private; 10 a day) → 201 `{ report: { ref:
"IR-XXXXXX", severity, … }, numbers }` (1800RESPECT and Lifeline for sexual, assault, threats and after-trip contact). The other person on the
trip is the subject. A critical report with `auto_hold_critical` suspends the subject (`under_review`) at once, unless they are on a live trip
(ops get `incident.hold_deferred`). `GET /safety/reports` → mine (ref, label, status, outcome; nothing about the subject). Ops: `GET
/admin/incidents?status=active|open|investigating|actioned|closed|all&severity=` (critical first), `GET /admin/incidents/:id` (signed evidence,
notes, other reports about the subject), `PATCH /admin/incidents/:id { status?, outcome?, note? }` (audited; marking `actioned`/`closed` sends
the reporter `incident_update` with the outcome). In `/me/export`: `safety_reports`, `check_ins`, `account_actions`.

**Account standing, suspensions and appeals:** `POST /admin/users/:id/restrict { action: suspend|ban|warning, reason_code, public_reason?, note?,
until? (suspend only, future), incident_id? }` (admin; not yourself; 409 `already_restricted`) — suspend/ban block the account, take a driver
offline, withdraw offers, close sockets and text `account_restricted` with the reason; a warning is an inbox note only. `POST
/admin/users/:id/lift { note? }` (409 `not_restricted`; pending appeals marked overturned). `GET /admin/users/:id/standing`. The old
`PATCH /admin/users/:id { blocked }` switch records a `ban` / `lift` too. Suspensions with `until` lift themselves (tick, or at sign-in).
Reason codes: under_review, safety_incident, abuse, fraud, document_fraud, repeated_cancellations, identity_check, other.
Sign-in (`POST /auth/otp/verify`) for a suspended or banned account → 403 `account_restricted` with `details { kind, reason, until, appeal_token }`
(was: a token that then failed). The appeal token (1 day, `scope: appeal`) is not a sign-in (refused by every other route and the socket):
`GET /appeal` → `{ restriction, appeal }`, `POST /appeal { message (20–1500) }` → 201 (409 `appeal_pending`, `appeal_decided`). Ops: `GET
/admin/appeals?status=`, `PATCH /admin/appeals/:id { decision: upheld|overturned, note? }` (admin; overturned lifts; texted `appeal_decided`).

**Emergency card:** `GET /safety/emergency-card?lat=&lng=&trip_id=` (any signed-in user) → `{ emergency_number, say, address, landmark { name,
distance_m, direction }, lat, lng, dms, trip { ref, pickup, dropoff, car }, numbers }`. `say` is what to tell 000 ("I'm about 300 metres north of
Todd Mall, Alice Springs. GPS: latitude minus 23.69840, longitude 133.88220. I'm in a DingoGo car: White Toyota Camry, rego C D 1 2 A B …").
Without lat/lng it uses the car's last position on the caller's live trip. A street address comes from `REVERSE_GEOCODE_URL` when set (1.5 s
timeout), otherwise the nearest known landmark.

Uploads: purposes `selfie` (drivers) and `evidence` (anyone signed in) are private (signed links, owner and staff only).

## Consolidation (Round 15)

- **Business account monthly limit** (`corporate_accounts.monthly_limit_cents`; empty or 0 = no limit), checked on every booking billed to the account
  (`payment_method: 'corporate'`, rider app, organisation and phone bookings, each drop of a run): 402 `account_limit_reached`
  `{ details: { limit_cents, used_cents, left_cents, month } }`. Used = this Darwin-time month's completed trips (final price), late-cancel fees and
  trips booked or on the road (their quote), less refunds; a booking counts in the month of its pickup. The account row is locked while checking, so two
  bookings at once can't both squeeze under the limit. Paying another way still works.
- `GET /admin/corporate/:id/statement?month=YYYY-MM` (default: this month in Darwin time, was UTC) adds per line `refunded_cents`, and
  `charges_cents`, `refunds_cents`, `total_cents` (= charges − refunds; GST on the net) and `limit { limit_cents, used_cents, left_cents } | null`.
  A refund on a business trip moves no money: it is a credit on the statement.
- `POST/PATCH /admin/corporate` fields are validated: `kind` one of `business, ndis_plan_manager, community_org, aboriginal_corporation,
  health_service, government`; `discount_pct` 0–50; `abn` 11 digits (spaces ignored); `monthly_limit_cents` ≥ 0 or null; `invoice_terms_days`
  0–120; a cleared required field is left as it was (400 `validation_error` / `empty`).
- **Late-cancellation fee is never more than the trip's price** (a $1 trip whose fare a promo or Pass covered costs $1 to cancel late, not $3):
  event data `fee_waived: 'capped'`. Cash trips stay `fee_waived: 'cash'`.
- **DingoGo credit trips and route changes:** the route-change adjustment (distance > 125% of the estimate, capped at +20%) is taken from the credit
  that is left and never below zero; the rest is waived (line "Route change adjustment (part waived: not enough DingoGo credit)"), as the return fee
  already was. The driver is paid what was charged.
- Concession cards are valid until midnight Darwin time on their expiry date (was 9:30 am, UTC midnight); `PUT /me/concession` uses the same date.
- Docs drift is a test: every route the API registers must appear in this file, and every environment variable it reads in `services/api/.env.example`
  (`test/docs.test.ts`).

## Tax, compliance and reporting (Round 16)

GST model (unchanged, now written down): each driver is registered for GST and supplies the ride or delivery; DingoGo collects the fare on the
driver's behalf. DingoGo's own sales are the service fee and car lease charged to drivers, and the booking fee, passenger levy, DingoGo Pass and its
share of cancellation fees charged to riders. Periods are Darwin dates: quarter `2026-Q4` (calendar quarter; BAS due the 28th of the next month,
Oct–Dec 28 Feb), SERR half `2026-H1` (Jan–Jun, due 31 Jul) / `2026-H2` (Jul–Dec, due 31 Jan), month `2026-11`. Bad keys → 400 `bad_period`.
Reports answer JSON by default and a download with `format=csv|pdf` (400 `bad_format`); admin downloads are audited (`export`).

**Driver tax details (SERR):** `GET /driver/tax-details` → `{ details { seller_type, given_name, family_name, date_of_birth, business_name,
address_line, suburb, postcode, address_state, abn, abn_ok, gst_registered, has_bank, email, phone }, missing [..], ready, why }` (bank numbers are
never sent back). `PUT /driver/tax-details` takes any of those fields (`seller_type individual|entity`, postcode 4 digits, state code, date of birth
18–99 years, `abn` with spaces allowed and checked with the ATO check digits → 400 `invalid_abn`; `email` updates the account). Name, birth date
and address fields need migration 020 (503 `migration_pending` before it; ABN/GST still save). `GET /driver/me` adds `tax_missing [..]`. `PATCH
/driver/me { abn }` is checked the same way.

**Driver GST statement:** `GET /driver/tax/statement?quarter=&format=json|csv|pdf` → `{ period, business, driver { name, abn, abn_ok,
gst_registered }, totals, months [..], warnings, notes }`, totals/months: `sales_cents` (G1: fares + pickup pay + fuel surcharge + the driver's share
of cancellation fees, incl. GST), `gst_on_sales_cents` (1A), `fees_cents` (G11: service fees + car lease), `gst_credits_cents` (1B), `net_gst_cents`,
`tips_cents` (no GST), `other_payments_cents` (bonuses, earnings floor, charging, adjustments), `cash_held_cents`, `paid_out_cents`, `trips`. GST
figures are 0 if the driver isn't marked GST-registered (warning). `GET /driver/tax/fee-invoice?quarter=&format=json|pdf` → DingoGo's tax invoice to
the driver for the quarter's service fees and lease (`DGF-2026Q4-XXXXXXXX`, both ABNs, GST included); 409 `no_fees` when there were none.
`/driver/earnings` `gst_on_fares_cents` now includes the driver's share of cancellation fees (same G1 as the statement).

**Rider NDIS invoice:** `GET /me/ndis-invoice?month=&format=json|csv|pdf` — the rider's trips booked with an NDIS number that month (404 for a PDF
when there are none).

**Admin (admin role only):**
- `GET /admin/tax/overview` → readiness (`ready`, DingoGo ABN set and valid), next BAS/SERR/levy periods and due dates, `missing_details` count,
  `levy_overdue`, privacy requests open/overdue, retention policy and last run, NDIS settings.
- `GET /admin/tax/bas?quarter=&format=` → DingoGo's BAS worksheet: `lines` (service_fees, lease, booking_fees, levy, pass, cancel_share with GST),
  `g1_cents`, `gst_on_sales_cents`, `refunds_cents`/`gst_on_refunds_cents`/`gst_after_refunds_cents`, `on_behalf { driver_sales_cents, driver_gst_cents,
  tips_cents, discounts_funded_cents, other_driver_payments_cents }`, `unregistered_drivers`, `warnings`.
- `GET /admin/tax/driver-statement?driver_id=&quarter=&doc=statement|invoice&format=` — any driver's statement or fee invoice.
- `GET /admin/tax/serr?period=&format=json|csv` — Sharing Economy Reporting Regime data: operator, one seller line per driver per activity
  (Ride-sourcing / Delivery services) with seller type, names, date of birth, business name, ABN, address, email, phone, bank details (masked in JSON,
  full in the CSV), activity start/end, transactions, gross payments (incl. GST), GST, commission, `missing [..]`, `deleted`; totals incl.
  `incomplete`. Deleted drivers are reported from their retained tax identity. Lodge in the ATO's XML format from this data.
- `GET /admin/tax/missing-details?format=json|csv` (approved drivers and anyone paid in the last 18 months with something missing);
  `POST /admin/tax/missing-details/remind { driver_ids? }` → `{ reminded }` (inbox notice "Tax details needed" listing what's missing).
- `GET /admin/tax/levy-return?month=&state=NT|SA&format=` → monthly return: trips by day, rate, payable, collected, due date (setting
  `levy_returns.due_day`, default 21), `lodged`, `overdue` (400 `unknown_state`). `GET /admin/tax/levy-returns?state=` → last 12 months with
  trips, payable, lodged/reference, overdue. `POST /admin/tax/levy-returns { state, month, reference? }` records a lodgement (400 `month_not_over`
  for the current month; again = corrected).
- `GET /admin/tax/ndis?month=&ndis=&format=json|csv|pdf&claim=bulk` → one invoice per participant per month (`NDIS-YYYYMM-<number>`, bill to the
  plan manager's account or the participant, lines with date, trip, support item, quantity, amount after refunds, GST code and GST). PDF needs
  `ndis=` (400 `choose_participant`). `claim=bulk` with `format=csv` → NDIA bulk payment request file (409 `ndis_not_set_up` without a
  registration number and support item). `PUT /admin/tax/ndis-settings { registration_number (9 digits), support_item (02_051_0108_1_1 form),
  support_name, gst_code P1|P2|P5, payment_terms_days 0–60 }` (400 `invalid_ndis`).
- Record retention: `GET /admin/tax/retention` → dry run (what the policy would remove now); `PUT /admin/tax/retention { tax_years ≥ 5,
  gps_track_months, chat_months, comms_log_months, notifications_months, security_log_days, auto }` (400 `invalid_policy`);
  `POST /admin/tax/retention/run { dry_run (default true) }`. Removes old GPS tracks, chat, comms log, notifications, sign-in code requests,
  rate-limit counters and deleted drivers' tax identities past their 5 years; never trips, payments, the pay ledger or the audit log. With
  `auto: true` it runs once a day from the dispatcher tick (off by default). Audited (`retention_run`).
- Privacy (APP) requests: `GET /admin/privacy/requests?status=open|completed|refused&format=json|csv` (with `overdue`),
  `POST /admin/privacy/requests { kind access|correction|deletion|complaint, channel email|phone|letter|in_person|app, requester, user_id?,
  details? }` → 201 with `ref` `PR-…` and `due_at` 30 days on; `PATCH /admin/privacy/requests/:id { status, outcome }` (outcome needed to close).
  `GET /me/export` and `DELETE /me` are recorded automatically as completed requests.

**Account deletion (fixed):** `DELETE /me` answered 500 after anonymising the account (the audit insert used one parameter as both uuid and text);
it now returns 200. For a driver who was ever paid, the tax identity (names, date of birth, address, ABN, email, phone, bank) is kept in
`retained_tax_identities` until 30 June five years after the financial year of their last payment, and bank, address, birth date, licence and
authority numbers are cleared from the driver record. `GET /me/export` adds `driver { profile (bank as last 3 digits), documents, pay, trips,
online_sessions }` for drivers.

## Rider growth and loyalty (Round 17)

Needs migration 021 (`lib/loyalty.ts` `loyaltyReady()`, re-checked once a minute). Before it: promo codes, rewards, café redeem/stats/statements,
vouchers and tiers work as before (no budgets/rules/targeted codes, settlement at the café's current rate, nothing marked paid); opt-ins, gift
vouchers bought online, win-back and marking months paid answer 503 `migration_pending`; the scheduled run does nothing.

**Programme settings** (`settings.loyalty`, admin): `expiry_months` (12; 0 = never), `warn_days` (30), `tiers [{ key, name, min_trips, multiplier }]`
(Member 0 / Silver 10 / Gold 30 trips in the last 12 months; 1, 1.25, 1.5x points), `birthday_points` (200), `streak_weeks` (4), `streak_points` (300),
`referral_bonus_points` (500), `referral_min_fare_cents` (500), `referral_monthly_cap` (10), `winback_days` (60), `winback_every_days` (90). Every
number is bounded on save.

**Rider:**
- `GET /loyalty` adds `tier { key, name, multiplier, trips_last_year, next { name, min_trips, multiplier, trips_to_go } }`, `tiers`, `expiry
  { months, expires_at, rule }`, `bonuses { birthday_points, streak_weeks, streak_points, ready }`, `profile`, `streak_weeks_now`, `referral`,
  `referral_min_fare_cents`; `ledger[].label`; `earn_rate` shows the tier rate. Rewards from switched-off partners → 404 on redeem.
- `GET /loyalty/history?before=<id>` → `{ points, items [{ id, points, reason, label, created_at, trip_ref, balance }], next }` (50 a page, newest
  first, `balance` after each line).
- `PUT /loyalty/profile { birthday_md "MM-DD", birthday_opt_in, streak_opt_in }` → `{ profile }`. Opting in to the birthday bonus without a date →
  400 `birthday_required`. Only the day and month are kept.
- `GET /gift-vouchers` → `{ vouchers [{ code, value_cents, from_name, recipient_name, message, created_at, expires_at, used }], values_cents, ready,
  valid_years }`. `POST /gift-vouchers { value_cents (1000|2000|2500|5000|10000), from_name?, recipient_name?, message? (140), send_to? (AU mobile) }`
  with `Idempotency-Key` → 201 `{ voucher, replayed: false, texted }` (200 `replayed: true` for the same key). Charged on the saved card like a top-up
  (`card_required`/`cards_not_available`/`payment_failed` as there), payments row `kind 'gift_voucher'` with no GST (GST is in the fares it pays
  for), 3-year expiry, at most 5 a day (429). The optional text is transactional (`gift_voucher` template, skipped for numbers that replied STOP).
- `POST /wallet/voucher`: a shop card that hasn't been sold yet → 400 `voucher_not_sold`.

**Points rules:** points on completion are `pointsPerDollar × tier multiplier` on what the rider paid. Weekly streak (opt-in): a trip in each of
`streak_weeks` Darwin weeks in a row earns `streak_points` (once per week reached, again every further `streak_weeks`). Birthday (opt-in): once a
year on the Darwin date (29 Feb on 28 Feb in other years). Expiry: after `expiry_months` with no points activity and no completed trip, a
`points_expiring` notice is sent; the points expire (ledger `expired`) once that time has passed **and** the warning is at least `warn_days` old.
Referral: both get the bonus after the friend's first trip that cost at least `referral_min_fare_cents` (cheaper trips leave it pending); a blocked,
deleted or test/real-mismatched referrer → referral `void`; the referrer's bonuses are capped per Darwin month (the friend still gets theirs). Bonus
ledger rows carry the trip. Café reward codes past their use-by date are marked `expired`. The run (`runLoyaltyIfDue`, every 3 h from the
dispatcher tick) does expiry, birthdays and stale codes.

**Promo codes** (`/admin/promos`, validated): new fields `budget_cents` (total discount; the discount is capped at what's left, `spent_cents` kept),
`services []`, `hour_from`/`hour_to` (Darwin, `hour_to` exclusive, 22→6 runs over midnight), `days []` (0 = Sunday), `geo_lat`/`geo_lng`/`geo_radius_m`
(pickup or drop-off within the radius), `targeted` (only riders in `promo_grants`). Errors: `promo_time`, `promo_service`, `promo_area`,
`promo_invalid` (targeted, not granted), `promo_exhausted` (uses or budget, including "has just run out" when another booking took the last one).
Bad fields: `invalid_value` (percent over 100), `invalid_hours` (only one of the two), `invalid_area` (radius without a centre). The use and the
discount are taken with a conditional update at booking (a capped code can't be overshot) under a per-rider lock, and given back on cancel / no
drivers / card declined at release. First-ride codes are refused while the rider has another trip booked or under way. Before migration 021, rule
fields → 503 `migration_pending`.
- `GET /admin/promos/:code/grants`, `POST /admin/promos/:code/grants { phones [] }` → `{ granted, not_found [] }`.

**Partner portal:** `GET /partner/me` uses the Darwin month and the stored rate. `GET /partner/stats` → `{ month, months [6 × { month, redeemed,
owed_cents, customers }], by_reward, repeat_customers_6m, codes_waiting, codes_expired_6m }`. `GET /partner/statements` → `{ statements [12 ×
{ partner, month, redeemed, total_cents, open, status open|due|paid, paid { redeemed, amount_cents, paid_at, paid_ref } }] }`.
`GET /partner/statements/:month?format=json|csv|pdf` adds `lines [{ redeemed_at, code, title, cents }]` (400 `bad_month`). Each redemption keeps the
café's rate when it was served (`reward_redemptions.settlement_cents`).

**Admin:**
- `GET /admin/loyalty/settings` → `{ settings, ready }`; `PUT /admin/loyalty/settings` (admin, audited) → `{ settings }`.
- `GET /admin/loyalty/overview` → points outstanding (and `liability_cents` at 100 points = $1), earned/used/expired in 30 days, referrals rewarded,
  riders per tier.
- `POST /admin/loyalty/run` → `{ warned, expired, expired_points, birthdays, codes_expired, ready }` (audited).
- `GET /admin/loyalty/winback?days=` → `{ days, every_days, count, not_consented, sample }`; `POST /admin/loyalty/winback { days?, title, body,
  promo_code?, channel app|sms }` → `{ sent, skipped, promo_code }`. Only riders with marketing consent, a completed trip, none for `days`, no live or
  booked trip and no win-back in `winback_every_days`; the `promo` template adds the opt-out wording; texts follow the broadcast rules (STOP numbers
  skipped, a sender that takes replies). A promo code is granted to each rider sent to.
- `GET /admin/partner-settlements?month=` → `{ month, open, partners [{ id, name, redeemed, owed_cents, paid_at, paid_ref, paid_cents }], months }`;
  `POST /admin/partner-settlements { partner_id, month, paid_ref? }` → `{ settlement }` (409 `month_open` for the current month, `already_paid`;
  400 `nothing_owed`); `GET /admin/partner-settlements/:partner/:month?format=json|csv|pdf` → the café's statement. `GET /admin/redemptions`
  `settlement` is the Darwin month at stored rates.
- `POST /admin/vouchers` adds `for_sale` (default true: card works only once a shop records the sale, expiry at least 3 years) and `valid_days`
  (30–3650; default 3 years) → `{ codes, expires_at, needs_activation, valid_days }`.

Data export adds `loyalty_profile` and `gift_vouchers_bought`; deleting an account removes the loyalty profile and the unused points.

## Performance on serverless (Round 18)
- **ETags on every GET.** A `200` JSON answer carries a weak `ETag` (`W/"…"`); a GET with a matching `If-None-Match` (one tag,
  a list or `*`) answers `304` with no body. Signed-in answers stay `Cache-Control: no-store`: the apps keep the last copy in
  memory and send `If-None-Match` themselves (`getIfChanged` in `packages/shared/src/api.ts`). CORS exposes `ETag`,
  `X-Request-Id` and `Retry-After`.
- **`GET /public/config`** is the same for everyone: built from parallel reads, kept in memory for `CONFIG_CACHE_TTL_MS` and sent
  with `Cache-Control: public, max-age=60`.
- **Config cache.** Fare rules, zones (with the state levy), public holidays and the settings `driver_pay`, `community_pricing`,
  `courier_policy`, `cash_payments`, `cancellation_policy`, `business` and `support` are read from memory (default 15 s per
  instance). Any write by an admin or dispatcher drops the cache on the instance that made it, so the change shows at once
  there and within the TTL everywhere else.
- **`POST /driver/location`** is one database statement (car position, a point on every live trip's track, the live trips for the
  route check). Concurrent pings raise at most one route-deviation alert.
- **`GET /driver/offers`** reads run and pickup-window fields in the same query (no per-offer lookups). Response unchanged.
- **Dispatcher on serverless** runs on requests at most once per `DISPATCH_TICK_EVERY_MS` (3 s) across all instances: the
  instance that claims the `_dispatch_tick` settings row runs it, the rest skip. `_`-prefixed settings are internal and not
  listed by `GET /admin/settings`.
- **Database limits.** `DB_POOL_MAX` (3 on serverless), `DB_IDLE_TIMEOUT_MS`, `DB_QUERY_TIMEOUT_MS` (25 s, measured by the API)
  and `DB_STATEMENT_TIMEOUT_MS` (15 s, `SET LOCAL` inside every transaction, so it works through the transaction pooler; no
  startup parameters are sent). `/health/deep` details add `performance` (pool use, limits, cache hits).
- Migration `022_hot_path_indexes.sql`: partial indexes for live trips by driver, searching trips, bookings waiting for release
  and offers on screen.

## Tours, hire and tourism (Round 19)
Migration `023_tours.sql`. Before it is applied, tours keep working: the seeded tours take their itinerary, start times,
notice and heat rule from `BUILT_IN` in `services/api/src/lib/tours.ts`, visitor-language text from `SEED_TRANSLATIONS`,
there are no advisories, and the new admin and partner parts answer 503 `migration_pending`.

**Catalogue (public and rider)**
- `GET /public/tours?lang=` and `GET /tours?lang=` (signed in) → `{ tours, lang, languages, advisories, terms }`. Each tour has
  `itinerary [{ name, minutes, note, protocols }]`, `protocols` (code → wording), `season_months`, `days` (0 = Sunday),
  `start_times` (Darwin, `HH:MM`), `min_notice_hours`, `heat_sensitive`, `hotel_pickup`, `guided_by` (`driver` |
  `aboriginal_guide`), `guide_fee_cents`, `deposit_pct`. `lang` is `de`, `fr`, `it`, `ja`, `ko` or `zh` (anything else is
  English): translated fields replace English where there are some (`translated_fields`), `machine_translated` is true until
  a reviewer is named. `terms` = `{ deposit_pct, change_of_mind_min, free_cancel_hours, hire_free_cancel_hours, late_pct, hire }`.
- `GET /public/tours/:slug?lang=&guests=` → `{ tour, safety [text], pickups, terms }` (safety: water a litre per person per
  hour, hat and shoes, phone coverage, summer heat, permits). 404 for unknown or hidden tours.
- `GET /public/tours/:slug/availability?from=YYYY-MM-DD&days=` (1–62, default 14) → `{ days [{ date, times [{ time, ok,
  reason? }], advisories }] }`. Reasons: `tour_too_soon`, `tour_out_of_season`, `tour_not_that_day`, `tour_closed`,
  `heat_advisory`.
- `GET /public/tour-advisories` → `{ advisories }`; `GET /public/tour-pickups` → partner hotels and visitor centres with a
  location (`{ pickups [{ id, name, kind, address, lat, lng }] }`).

**Booking a tour** (`POST /trips` with `service: 'tour'`): needs `scheduled_for` at one of the tour's start times, in season, on
a day it runs, at least `min_notice_hours` ahead (staff phone bookings may be later) and `passengers` ≤ `max_passengers`; 400
`tour_needs_date`, `tour_start_time`, `too_many_guests`, `tour_too_soon`, `tour_out_of_season`, `tour_not_that_day`,
`tour_closed`, `heat_advisory`. A tour led by an Aboriginal guide adds the line "Aboriginal guide (paid in full to your guide)"
(`guide_fee_cents`, after discounts, outside the driver's fare). Paid by card: a deposit (`deposit_pct` of the tour, else
`tour_policy.deposit_pct`, 20%) is charged at booking as its own payment (`payments.kind = 'deposit'`, `fare_breakdown.deposit
{ cents, ref, provider, status }`); the rest is held when the booking is released and captured at the end (two capture rows).
Credit is taken in full at booking as before; accounts are invoiced.

**Cancelling a tour or hire**: free until `cancellation_policy.scheduled_free_hours` (tour 48, hourly 24) before the start;
inside that, `scheduled_late_pct` (50%) of the price, except within `tour_policy.change_of_mind_min` (10) minutes of booking
and when a closure, or heat on a heat-sensitive tour, covers the day. The deposit pays the fee first and the rest of it is
refunded (`payments.kind = 'deposit_refund'`); a no-drivers outcome, a card declined at release or a free cancel refunds it in
full. `GET /trips/:id/cancel-terms` (rider) → `{ terms { fee_cents, reason free_before|change_of_mind|advisory|late,
free_until }, deposit_cents, deposit_back_cents, extra_charge_cents }`. Staff refunds of a deposit-paid tour go back against
each card payment in turn.

**Hourly hire** (`POST /quotes` / `POST /trips` with `service: 'hourly'`): `hire_hours` (`tour_policy.hire.min_hours` to
`max_hours_per_day`, 1–10) prices it as hours × the hourly rate (was priced by the drive); needs `scheduled_for` at least
`hire.notice_hours` (24) ahead online; 400 `hire_hours`, `hire_needs_date`, `hire_too_soon`.

**Hire quotes**
- `POST /public/hire/quote { hours_per_day, days (1–30), vehicles (1–20) }` → `{ quote { lines, hourly_cents,
  charged_hours_per_day, subtotal_cents, discount_cents, levy_cents, total_cents, gst_cents } }`: a minimum per day, a long day
  charged at `day_cap_hours` (8), `multi_day_pct` (10%) off from `multi_day_min_days` (3), the levy per car per day; at most 10
  hours a day per driver (fatigue rules).
- `POST /admin/hire-requests/:id/quote { hours_per_day, days, vehicles, start_date?, note?, total_override_cents? }` (ops,
  audited) → `{ item, url, texted }`: stores the quote, a private link valid `quote_valid_days` (14), texts the contact; 400
  `already_accepted`.
- `GET /public/hire/:token` → `{ quote { …, expires_at, expired, accepted_at, accepted_name, status, terms } }`;
  `POST /public/hire/:token/accept { name, agree: true }` → the quote with `status: 'confirmed'` (once; later taps return it);
  400 `quote_expired`, `quote_withdrawn`. Rate-limited per IP.

**Partners: hotels, visitor centres and tour desks** (partner `kind` `hotel` | `visitor_centre` | `tour_desk`, with
`tour_commission_pct` and a linked `corporate_account_id`):
- `GET /partner/tours` → `{ partner { commission_pct, account_linked, … }, tours, bookings, terms }` (guests by first name and
  the last 3 digits of the phone).
- `POST /partner/tours/bookings { tour_id, scheduled_for, guests, guest_name, guest_phone, pickup? }` → 201 `{ booking { id, ref,
  status, scheduled_for, quote_cents, commission_cents } }`: booked for the guest (`channel: 'partner'`), billed to the desk's
  account, picked up at the desk unless another pickup is given, the guest texted; commission (tour price × rate) fixed at
  booking, earned on completion, void on cancel. 409 `partner_account_required`; 403 for cafés and shops.
- `POST /partner/tours/bookings/:id/cancel` → the same 48-hour terms; `GET /partner/tours/commissions?format=json|csv` →
  `{ commission_pct, months [{ month, earned_cents, paid_cents, pending_cents, bookings }], items }`.

**Admin**
- `GET /admin/tour-policy`, `PUT /admin/tour-policy { policy }` (admin; also `PUT /admin/settings/tour_policy`) → `{ policy }`
  checked whole (`deposit_pct`, `change_of_mind_min`, `hire { min_hours, max_hours_per_day, day_cap_hours, multi_day_min_days,
  multi_day_pct, quote_valid_days, notice_hours }`).
- `POST /admin/tours`, `PATCH /admin/tours/:id` take the new fields, checked: itinerary within the duration, protocols from the
  list, `HH:MM` start times, guide fee only for guided tours, translations only in visitor languages and `reviewed` only with
  `reviewed_by` and `reviewed_on`. `stops`/`itinerary` are written as JSON (a list used to fail). 503 `migration_pending` for the
  new fields before 023.
- `GET /admin/tour-advisories` → `{ items, ready }`; `POST /admin/tour-advisories { kind heat|closure|fire|flood|road|water,
  title, message, starts_on, ends_on, tour_ids?, latest_start?, closes?, active?, notify? }` (ops) → 201 `{ item, notified }`:
  riders with a booked tour on those days are told (and that cancelling is free when it closes their tour or limits a walk);
  a heat advisory needs `latest_start` or `closes`. `PATCH /admin/tour-advisories/:id`.
- `GET /admin/tour-guides`, `POST /admin/tour-guides`, `PATCH /admin/tour-guides/:id` (name, phone, email, community, bio,
  `show_name`, ABN, payment reference, active). `POST /admin/trips/:id/guide { guide_id | null }` (ops) assigns a guide to a
  guided tour booking and texts them; 400 `not_guided`, `already_settled`.
- `GET /admin/tour-guide-jobs?format=json|csv` → jobs (`assigned` → `owed` on completion, or the late fee's share of the guide
  fee on a late cancel, `cancelled` on a free one → `paid`); `POST /admin/tour-guide-jobs/pay { trip_ids, paid_ref }` (admin) →
  `{ paid, cents }` (only what is owed, once).
- `GET /admin/tour-commissions` → per partner and Darwin month; `POST /admin/tour-commissions/pay { partner_id, month, paid_ref }`
  (admin) → `{ paid, cents }`; 400 `month_open`.
- `GET /admin/tour-bookings` → upcoming and last-7-day tour and hire bookings with guide, partner, commission and deposit.
- Partners take `kind` (`cafe`, `shop`, `community`, `hotel`, `visitor_centre`, `tour_desk`, `other`), `tour_commission_pct`
  (0–50) and `corporate_account_id` (400 `invalid_account`).

Messages: `tour_booked_for_you` (guest text), `tour_advisory` (in-app, safety), `guide_assigned` (guide text), `hire_quote`
(contact text). Visitor-language words for the tour and hire screens are in `packages/shared/src/i18n/visitor.json` (machine
translations, flagged until reviewed; `tv()`), kept apart from the community languages, which are never machine-translated.

## Fleet and EV programme (Round 20)
Migration `024_fleet.sql`. Admin → Fleet keeps the new tabs behind the programme switch (`fleet_policy.enabled`, off by default)
until the fleet launches. Before the migration (`services/api/src/services/fleet.ts` `fleetReady()`, re-checked once a minute)
the old weekly lease run and charging logs keep working, the car form drops the new car fields, `GET /driver/fleet` answers
`{ ready: false, contract: null }` and the other routes below answer 503 `migration_pending`.

**Programme and policy**
- `GET /admin/fleet` (admin, dispatcher) → `{ ready, policy, defaults, counts { cars, agreements, off_road, open_claims } }`.
- `PUT /admin/fleet/policy` (admin) `{ policy }` → checked and saved (`settings.fleet_policy`); 400 `invalid_fleet_policy` with
  `details.field`. Policy: `enabled`, `auto_weekly` (run agreements on Monday from 6 am Darwin time), `arrears_flag_weeks` (2),
  `target_hours_per_day` (10, for utilisation), `charging { home_cents_per_kwh 30, public_max_cents_per_kwh 80,
  public_needs_receipt, depot_reimbursed, monthly_cap_cents 25000 }`, `service_plans [{ key, kind, label, every_km, every_months,
  fuels }]`, `heat { hot_months [10..3], battery_every_months_hot 3, hot_week_c 40, recheck_days 30 }`.

**Car agreements** (`fleet_contracts`; one live agreement per car and per driver)
- `GET /admin/fleet/contracts?status=` (admin, dispatcher) → items with `totals { due_cents, collected_cents, paid_cents,
  waived_cents, deposit_cents, owing_cents (negative = paid ahead), buy_out_cents (rent-to-own), weeks_behind }`.
  `GET /admin/fleet/contracts/:id` adds `weeks`, `payments`, `payoff_weeks`.
- `POST /admin/fleet/contracts` (admin) `{ vehicle_id, driver_id, kind: weekly_lease | rent_to_own, weekly_cents, starts_on,
  ends_on?, term_weeks?, price_cents (rent-to-own), deposit_cents?, deposit_ref?, catch_up_pct? (100–300, default 150),
  keep_min_cents?, km_per_week?, notes?, assign? }` → 201 `{ contract, assigned }`. The car becomes `leased_to_driver` at this
  weekly amount and the driver's car (unless `assign: false` or they are on a trip). 400 `not_fleet_car`, `car_not_approved`,
  `price_required`, `deposit_too_high`, `weekly_required`, `dates`; 409 `car_has_agreement`, `driver_has_agreement`, `car_in_use`.
- `PATCH /admin/fleet/contracts/:id` (admin) `{ status: active | paused, paused_reason, weekly_cents, ends_on, catch_up_pct,
  keep_min_cents, km_per_week, notes }`; pausing needs a reason (400 `reason_required`); paused weeks are not charged.
- `POST /admin/fleet/contracts/:id/payments` (admin) `{ kind: payment | waiver, cents, method: bank | balance, reference }`:
  a payment lowers what is owing (and the buy-out); a waiver writes off what is owing (400 `waiver_too_big`), not the buy-out;
  `method: balance` takes it from the driver's balance (400 `balance_too_low`); 400 `payment_too_big` past the buy-out.
- `POST /admin/fleet/contracts/:id/buy-out` (admin, rent-to-own) `{ method, reference }`: pays the rest, closes the agreement
  (`bought_out`), the car becomes `driver_owned` by the driver and investor shares in it end. 400 `not_rent_to_own`.
- `POST /admin/fleet/contracts/:id/end` (admin) `{ reason }`: the car goes back to the fleet and the driver stops using it
  (`car_returned`; not while they are on a trip, `driver_on_trip`). What is owing stays on the record. 409 `agreement_closed`.
- `POST /admin/fleet/run-week` (admin) `{ week? }` (a Monday, default this week) and `POST /admin/lease/run` (this week) →
  `{ week, charged, rows [{ contract_id, due_cents, collected_cents, owing_after_cents, short_cents, buy_out_after_cents,
  flagged }], collected_cents, short_cents }`. Each live agreement once per Darwin week (`fleet_contract_weeks` key, same
  per-driver lock as payouts). Deduction = this week + what is owing, at most `catch_up_pct` of the weekly amount and never more
  than the driver's balance above `keep_min_cents`, so nobody goes below zero; rent-to-own never past the price. Ledger kind
  `lease`. Owing `arrears_flag_weeks` or more raises one open `fleet_arrears` compliance flag and the `fleet_arrears` note.
  Before migration 024 `POST /admin/lease/run` is the old run (`legacy: true`), now once per week and capped at the balance.
- `GET /driver/fleet` (driver) → `{ ready, contract (no staff notes) with totals, weeks (12), payments, this_week,
  next_service [due items], off_road }`; `contract: null` without an agreement.

**Maintenance** (`vehicle_maintenance`; DingoGo cars only, 400 `not_fleet_car`)
- `GET /admin/fleet/maintenance` (admin, dispatcher) → `{ today, cars [{ rego, driver, odometer_km, week_c, hot_week, due [{ key,
  kind, label, due_date, due_km, days_left, km_left, status: ok | due_soon | overdue, reason: time | km | hot_week, last_done }],
  open_jobs, recent_jobs }], spares, summary { overdue, due_soon, off_road } }`. Due from the last job of that kind (else the
  purchase date and 0 km); due soon within 30 days or 1,000 km; batteries every 3 months in the hot months and straight away after
  a week averaging `hot_week_c` (battery logs) once `recheck_days` have passed.
- `POST /admin/fleet/maintenance` (admin, dispatcher) `{ vehicle_id, kind: service | tyres | brakes | battery_check | repair |
  inspection | other, booked_for?, provider?, notes?, cost_cents?, odometer_km?, done_on? (records a past job), claim_id? }` → 201.
- `POST /admin/fleet/maintenance/:id/start` `{ spare_vehicle_id? }`: the car goes off the road (`vehicles.active = false`, out of
  dispatch); its driver (the agreement driver first) gets the spare car if one is given, other drivers of the car are taken
  offline. 409 `car_on_trip`, `spare_not_free`, `job_not_booked`; 400 `no_driver`. Spares: approved DingoGo cars nobody drives,
  not off road and not on an agreement (`vehicles.spare` first).
- `POST /admin/fleet/maintenance/:id/finish` `{ odometer_km?, cost_cents?, notes?, provider? }`: back on the road, odometer and
  cost recorded, the driver moved back from the spare (`driver_in_spare: true` if they are on a trip in it). Downtime = started
  to finished. `POST /admin/fleet/maintenance/:id/cancel`: booked jobs only (409 `job_not_booked`).

**Charging** (Round 20 rules; `charging_sessions.reimburse_cents`, `rule`, `receipt_ref`)
- `POST /driver/charging` also takes `receipt_ref`; the session gets `reimbursable`, `reimburse_cents`, `rule`
  (`home_tariff`, `public_at_cost`, `public_capped`, `public_no_receipt`, `depot`, `depot_at_cost`, `driver_owned`) and
  `rule_text`. Home: kWh × `home_cents_per_kwh` (whatever was typed as the cost); public: the cost up to kWh ×
  `public_max_cents_per_kwh`; depot and cars drivers own: not paid back (before 024 `reimbursable` follows the same rules).
  `GET /driver/charging` adds `reimbursement` (the rates, or null for own cars) and `rule_text` per session.
- `POST /admin/charging/reimburse` → `{ sessions, total_cents, over_cap_cents }`: each session's rule amount, at most
  `monthly_cap_cents` per driver per Darwin month (0 = no cap), credited as `charging_credit`. `GET /admin/charging` adds
  `home_cents`, `public_cents`, `depot_cents` per car, `rule_text` per session and `rules`.

**Insurance and claims**
- `GET /admin/fleet/insurance` (admin, dispatcher) → `{ policies (current, days_left), claims }`.
- `POST /admin/fleet/insurance` / `PATCH /admin/fleet/insurance/:id` (admin) `{ vehicle_id, insurer, policy_no, cover:
  comprehensive | third_party_property | ctp | public_liability | other, starts_on, ends_on, premium_cents, excess_cents, notes }`;
  the latest comprehensive / property policy end becomes `vehicles.insurance_expiry`. 400 `dates`.
- `POST /admin/fleet/claims` / `PATCH /admin/fleet/claims/:id` (admin, dispatcher; money fields admin only) `{ vehicle_id,
  policy_id (that car's), driver_id, trip_id, incident_at, kind: collision | animal | windscreen | hail | theft | vandalism | other,
  description, status: open | lodged | approved | declined | paid | closed, claim_no, at_fault, excess_cents,
  driver_contribution_cents, repair_cost_cents, payout_cents, notes }`. 400 `policy`.

**Profitability and investors** (admin only)
- `GET /admin/fleet/profitability?from=&to=&format=csv` (default this month, up to 400 days) → `{ cars [{ rego, days,
  off_road_days, trips, km, engaged_hours, engaged_hours_per_day, utilisation_pct (engaged ÷ (days on the road ×
  target_hours_per_day)), income { service_fees_cents, agreement_cents, ads_cents, insurance_payouts_cents, total_cents }, costs
  { charging_cents, maintenance_cents, insurance_cents (premium spread by day), claims_cents (excess, or the repair if declined,
  less the driver's part), finance_cents (`vehicles.finance_weekly_cents`), total_cents }, profit_cents, profit_per_km_cents }],
  totals }`. 400 `range`.
- `GET /admin/fleet/investors`, `POST /admin/fleet/investors`, `PATCH /admin/fleet/investors/:id` `{ name, email, abn,
  payment_ref, notes, active }`; `POST /admin/fleet/investor-shares` `{ investor_id, vehicle_id, share_pct, starts_on, ends_on? }`
  and `PATCH /admin/fleet/investor-shares/:id`: DingoGo cars only, a car's shares never over 100% on any day (400
  `shares_over_100`).
- `GET /admin/fleet/investor-report?month=YYYY-MM&format=csv` → `{ rows [{ investor, rego, share_pct, days, car_income_cents,
  car_costs_cents, car_profit_cents, share_cents }], investors [{ investor, cars, share_cents }] }`: the car's profit × share ×
  days the share ran ÷ days in the month (losses are shared too).

Vehicles (`PATCH /admin/vehicles/:id`, `POST /admin/vehicles`) also take `purchase_price_cents`, `purchase_date`,
`finance_weekly_cents` and `spare`. Messages: `fleet_arrears`, `fleet_bought_out`, `fleet_car_off_road`, `fleet_car_back`.

## App store readiness (Round 21)

**Android App Links.** `GET /.well-known/assetlinks.json` (also at `/api/.well-known/assetlinks.json`; Vercel routes the root path to the
API) → the Digital Asset Links statement for the rider app (`ANDROID_RIDER_PACKAGE`, default `au.com.dingogo.rider`) with the SHA-256
certificate fingerprints in `ANDROID_APP_LINK_CERTS` (comma separated, colons optional, any case). Unset → `[]` (links open in the
browser). The public test key's fingerprint and anything that isn't a SHA-256 fingerprint are dropped (logged once). `Cache-Control:
public, max-age=3600`, never a redirect. The rider app claims `https://<site>/track/*` (shared trips open in the app without signing in)
and `/rider*` (website "Book this ride", fare and invite links, handed off as in a browser).

**Permission explanations (Google Play prominent disclosure).** `POST /me/disclosures { app: rider|driver, kind: location|
background_location|notifications|camera, version, accepted, platform?: android|ios|web (default web), app_version? }` → `{ ok,
recorded: true, disclosure }`; 60 per day per account. `GET /me/disclosures` → `{ ready, items }` (newest first, own answers only).
Included in `GET /me/export` as `permission_disclosures`. Before migration 025: `POST` answers `{ ok: true, recorded: false }` (the
answer stays on the phone), `GET` → `{ ready: false, items: [] }`, export `[]`.

**Account deletion without the app.** Website page `/delete-account`:
- Sign in with `POST /auth/otp/verify { phone, code, app: 'account' }`: existing accounts only (no account → 404 `no_account`, nothing
  created), no role change (a rider stays a rider), then `DELETE /me` with that token (same rules and records as the app).
- `POST /public/deletion-requests { name, phone, email?, role?: rider|driver|both, details? }` for people who can't sign in → `{ ok, ref,
  due_days: 30 }`. Recorded in the privacy request register (kind `deletion`, channel `website`, status `open`, 30-day due date),
  linked to the account when the number matches one; the answer is the same either way. Shares the website forms' per-IP limit
  (`RATE_PUBLIC_FORM_PER_IP`). Privacy request channels now include `website`.

## Customer support and dispute resolution (Round 22)

Needs migration `026_support.sql` (ticket columns `ref, role, priority, assigned_to, first_response_due_at, resolve_due_at,
first_response_at, resolved_at, last_customer_at, csat_score, csat_comment, csat_at, review`; tables `support_messages`,
`support_canned_replies` (7 starter replies), `lost_items`). Before it (`services/support.ts` `supportReady()`, re-checked once a
minute): `POST /support`, `GET /support`, `GET /support/:id` (the message and the last reply), the desk list and replies (stored as the
old `resolution` and sent as a notification) and evidence packs work; replies from customers, ratings, internal notes, priority and
owner, canned replies, fare reviews and lost property answer 503 `migration_pending`; `GET /trips/:id/help` says `ready: false` and
offers no fare review.

**Policy** (setting `support_policy`; defaults in `lib/support.ts`): `GET /admin/support/policy` (ops) → `{ policy, defaults }`,
`PUT /admin/support/policy` (admin, audited; 400 `invalid_policy`) `{ sla: { urgent|high|normal|low: { first_response_min,
resolve_hours } }, priority_by_category: { <category>: priority } (safety always urgent), fare_review: { auto_refund, max_cents (1500),
max_per_rider_30d (2), tolerance_cents (50), min_track_points (5), track_allowance_pct (10), unverified: refund|ticket },
lost_property: { report_within_days (30), contact_days (7) }, reopen_days (14) }`. Defaults: urgent 15 min / 4 h, high 1 h / 24 h,
normal 4 h / 72 h, low 24 h / 7 days, calendar time. Categories: lost_item, fare, safety, driver, parcel, accessibility,
assistance_animal_refused, app, pay (drivers), other.

**Customers (riders and drivers).** `POST /support` as before (category `pay` added; 20 a day) → 201 `{ ticket }` with `ref`
(`ST-XXXXXX`), `priority`, due times; the inbox note gives the reference and when we aim to reply. `GET /support` → `{ ready, tickets:
[{ id, ref, category, subject, message, status, trip_id, trip_ref, created_at, updated_at, resolution, reply_by, awaiting: dingogo|you|null,
can_reply, can_rate, csat_score, last_reply_at }] }`. `GET /support/:id` (own only, else 404) → `{ ready, ticket, messages: [{ id, from:
you|dingogo, automatic, body, created_at }] }` (internal notes never shown). `POST /support/:id/messages { body (1–2000) }` → 201 the
thread: a pending ticket goes back to the desk, a resolved one reopens (new resolve due time) within `reopen_days`, later 409
`ticket_closed`; 20 an hour. `POST /support/:id/rating { score 1–5, comment? }` → `{ ok, csat_score }`; 409 `not_resolved`,
`already_rated`.

**Trip help.** `GET /trips/:id/help` (the trip's rider or driver, else 404) → `{ ready, role, trip { id, ref, kind, service, status,
quote_cents, final_cents, cancel_fee_cents, payment_status, completed_at }, options: [{ key, title, sub }], lost_item | null, tickets }`.
Rider keys: `fare_review` (finished, not reviewed yet, not a returned parcel, payment not failed), `cancel_fee`, `lost_item` (finished
ride within `report_within_days`, no open case), `driver_feedback`, `safety`, `parcel`, `assistance_animal`, `other`. Driver keys:
`found_item`, `safety`, `pay`, `other`. The apps send `driver_feedback`, `cancel_fee`, `parcel`, `pay` and `other` as `POST /support`
with the trip; `safety` opens the safety report (Round 14).

**Fare review.** `POST /trips/:id/help/fare-review { message? }` (the rider; finished trips; 10 a day) → `{ outcome: refunded|explained|
with_team, refund_cents, explanation, review { verdict, quote_cents, charged_cents, overcharge_cents }, ticket }`. The charge is compared
with the upfront price and, for a route-change charge, the trip's GPS track since the start (plus `track_allowance_pct`, at most the
reported distance) through the same route-change rule (`routeChangeExtra`). Verdicts: `as_quoted` (paid the price shown),
`supported` (track shows the longer route), `overcharged`, `unverified` (fewer than `min_track_points`), `refunded_already`,
`not_charged`. An overcharge (or an unverified charge with `unverified: refund`) up to `max_cents`, with fewer than
`max_per_rider_30d` automatic refunds in 30 days, is refunded at once through the normal refund rules (`services/refunds.ts`; event
`refund` with `by: system`, audit `auto_refund` with no actor, rider told `refund_issued`) and the ticket is resolved; `as_quoted`/
`supported` are explained and resolved (the rider can reply to reopen); otherwise the ticket stays open for a person (priority high when
over the limit or too many) with the working in an internal note and `ticket.review.decision` = `over_limit|too_many|unverified_to_person|
policy_off`. Once per trip, also for two taps at once (409 `already_reviewed` with `details.ticket_id`); 409 `not_completed`,
`not_reviewable`. Trip event `fare_review`.

**Lost property.** `POST /trips/:id/help/lost-item { description (3–500) }` (rider of a finished ride, within `report_within_days`:
409 `too_late`, `not_reportable`, `lost_item_open`) → 201 `{ lost_item, ticket }`; the driver gets `lost_item_driver`. `POST
/trips/:id/help/found-item { description, note?, handover?: { lat, lng, address } }` (the trip's driver) → 201; the rider gets
`lost_item_found`. While a case is open (`reported`, `found`, `collect`, `return_booked`) and for `contact_days` after it was opened,
trip chat stays open for the rider and driver (`closes_at` moves) and the relay number connects calls and texts as for a live trip.
`GET /driver/lost-items` → `{ ready, items }` (open, or changed in the last 7 days). `POST /lost-items/:id/respond { found, note?,
handover? }` (the driver; `found: false` only from `reported` → `not_found`, rider told `lost_item_not_found`, ticket pending).
`POST /lost-items/:id/return { method: courier|collect, dropoff?, payment_method?: card|wallet, instructions? }` (the rider, case `found`):
`collect` → `collect` and the driver gets `lost_item_collect`; `courier` books a normal small courier job for the rider from the
driver's handover place (409 `no_handover` until the driver gives one) to `dropoff`, the driver as sender and the rider as recipient
(delivery PIN as usual) → `return_booked`, driver told `lost_item_courier`; the case becomes `returned` when that job is delivered (back
to `found` if it is cancelled). `lost_item` view: `{ id, trip_id, status, label, description, reported_by, driver_note, handover,
return_trip, can_return, can_answer }`. Trip events `lost_item_reported|found|not_found|collect|courier`.

**Desk** (admin, dispatcher). `GET /admin/support?view=open|mine|unassigned|overdue|resolved|all&q=&category=` → `{ ready, items: [{ …,
assigned_name, preview, sla: { first_response, resolve: met|missed|due|overdue|null, minutes_left, overdue } }], summary: { open, overdue,
unassigned, mine, csat_30d, csat_count_30d, resolved_30d, sla_resolved_pct_30d, sla_first_pct_30d } }` (open first, then priority and
the next due time; `q` matches reference, subject, name, phone, trip). `GET /admin/support/:id` → `{ ready, ticket, messages (with
internal notes and author names), trip (money and refunded), related, lost_item, canned: [{ id, title, category, body, filled }] }`.
`PATCH /admin/support/:id { status?, priority? (due times worked out again from when it came in), assigned_to? (staff only: 400
`not_staff`; null to unassign), resolution? (old apps: a public reply) }`. `POST /admin/support/:id/messages { body, internal?, status?,
canned_id? }` → 201: a public reply notifies the customer (`ticket_reply`), stops the first-response clock and gives the ticket to the
replier if nobody has it; `status: resolved` sends `ticket_resolved` (asks for a rating). `GET /admin/support/staff`. Canned replies:
`GET /admin/support/canned` → `{ ready, items }`, `POST /admin/support/canned`, `PATCH /admin/support/canned/:id`, `DELETE
/admin/support/canned/:id` (admin) `{ title, body, category?, active? }`; placeholders `{first_name}`, `{name}`, `{trip_ref}`,
`{ticket_ref}`. `GET /admin/lost-items?status=open|all`, `PATCH /admin/lost-items/:id { status, note? }`. Everything audited
(`ticket_*`, `canned_*`, `lost_item_*`). Realtime on `ops`: `support.new`, `support.updated`, `support.reply`, `support.rated`,
`lost_item.updated`.

**Chargeback evidence pack.** `GET /admin/trips/:id/evidence-pack?format=json|pdf` (admin; audited `evidence_pack`) → `{ pack: { summary
(plain sentences for the bank), trip, customer { name, phone (last 3 digits), member_since, completed_trips, disputes }, driver, vehicle,
proof (PIN start for rides; signature, photo, receiver and distance for deliveries), timeline, track { points, distance_m, path },
chat, receipt, payments, refunded_cents, ratings, support } }`, or a PDF (`dingogo-evidence-<ref>.pdf`) with the same sections (track
thinned to about 60 rows).

Refactor: the refund rules moved from the admin route to `services/refunds.ts` (`refundTrip`, `refundIn`); the receipt to
`services/receipts.ts` (`buildReceipt`). Messages: `ticket_received` (now with the reference and reply-by time), `ticket_resolved`,
`lost_item_driver`, `lost_item_found`, `lost_item_not_found`, `lost_item_collect`, `lost_item_courier`.

## Business and government customers (Round 24)

Needs migration 027 (`services/businessRules.ts` `businessReady()`, re-checked once a minute). Before it: account bookings, the monthly
limit and `GET /admin/corporate/:id/statement` work as before; bookings that send `cost_centre_id`, `purpose_code` or `po_number`, and
every route below except the admin lists (`ready: false`), answer 503 `migration_pending`. Business routes accept the account's members by
role and DingoGo staff (admin, dispatcher) acting as a manager. Member roles: `member`, `approver`, `manager`.

**Applications.** `POST /public/business-applications { organisation, kind (account kind), abn (ATO check digits: 400 `invalid_abn`),
billing_email, contact_name, contact_phone (Australian mobile: 400 `contact_phone`), address?, expected_monthly_cents?, needs?:
[cost_centres|approvals|po_numbers|ndis|recurring|parcels], notes?, agree: true }` (per-IP form limit) → 201 `{ ok, ref (BA-XXXXXX),
application_status: pending }`; 409 `account_exists` when the ABN already has an account or a pending application; texted
`business_application_received`. Creates a `corporate_accounts` row with `status: pending, active: false`. `GET
/admin/business/applications?status=pending|approved|declined` (staff) → `{ ready, applications }`. `POST
/admin/business/applications/:id/review { approve, note? (required to decline), monthly_limit_cents?, invoice_terms_days?, discount_pct? }`
(admin; 409 `already_reviewed`) → `{ account }`: approving makes the account active and the contact's mobile (an account is made if
needed) its manager, texted `business_account_approved`; declining texts `business_account_declined` with the note.

**Set-up.** `GET /business/accounts/:id/setup` → `{ account, role, rules, cost_centres, purposes, members }` (members see active cost
centres and purposes and no member list). Managers only: `PUT /business/accounts/:id/rules { require_cost_centre, require_purpose,
require_po, default_po, approval_over_cents (0 = never), invoice_per_po, require_ndis_number, book_for_others: everyone|approvers|nobody,
guests }` (merged with the current rules; 400 `invalid_rules`); `POST /business/accounts/:id/cost-centres { code, name, approver_id?
(a member), monthly_budget_cents? }` → 201, `PATCH /business/accounts/:id/cost-centres/:cc` (also `active`); `POST
/business/accounts/:id/purposes { code, label }` → 201, `PATCH /business/accounts/:id/purposes/:pid { label?, active? }` (409
`code_taken`, 400 `invalid_code`); `POST /business/accounts/:id/members { phone, name, role }` → 201 (texted and notified
`business_member_added` when new to the account); `DELETE /business/accounts/:id/members/:userId` (409 `last_manager`).

**Account bookings.** `POST /trips`, `POST /business/rides` (clients), `POST /courier/runs` and the CSV import take `cost_centre_id`,
`purpose_code`, `po_number` with `payment_method: corporate` (with another payment method: 400 `corporate_required`). Checked against the
account's rules: 400 `cost_centre_required|invalid_cost_centre|purpose_required|invalid_purpose|po_required|invalid_po|ndis_required`; the
account's `default_po` fills a blank PO; a cost centre's monthly budget counts like the account limit (402 `cost_centre_budget_reached`
with `budget_cents, used_cents, left_cents`). Over `approval_over_cents`, a booking by a member who isn't the cost centre's approver is
refused when it is for now (403 `approval_required`) or held when booked ahead (`approval_status: pending`, approvers notified
`business_approval_needed`); approvers', managers' and the cost-centre approver's own bookings are `approved` at once. A held booking
still pending when it is released is cancelled with no fee (`Not approved in time`, `business_trip_unapproved`, trip event
`approval_expired`). Ops phone bookings (`POST /admin/bookings`) are never required to give the fields or held. With the billing setting
`hold_after_days` > 0, new bookings on an account with an invoice more than that many days overdue are refused (402 `account_overdue`).

**Approvals.** `GET /business/approvals?account_id=` → `{ approvals }` (managers and approvers all; a member who approves a cost centre
sees those). `POST /business/approvals/:tripId { approve, note? }` → `{ trip }` (409 `not_pending`; two approvers at once decide once):
approve → `business_trip_approved` to the traveller and booker; decline → cancelled with no fee, `business_trip_declined`. Audited.

**Booking for someone.** `POST /business/trips/quote` and `POST /business/trips { account_id, traveller: { self: true } | { member_id } |
{ consent_id } | { name, phone }, pickup, dropoff, scheduled_for?, passengers?, needs_wheelchair?, assistance_animal?, women_driver_pref?,
notes?, ndis_number?, cost_centre_id?, purpose_code?, po_number? }` → 201 `{ trip: { id, ref, status, scheduled_for, quote_cents,
approval_status, traveller ("First L."), pickup_address, dropoff_address } }` (quote: `{ quote, route, needs_approval }`). The trip is
the traveller's (channel `org`, `booked_by` the booker) and they are texted `ride_booked_for_you` as "<booker> at <organisation>".
Guests get a DingoGo account by mobile (400 `traveller` for landlines, staff/driver numbers or someone not on the account); 403 when
`book_for_others`/`guests` don't allow it; community kinds (health, NDIS, government, community, Aboriginal corporation) need a client
consent for anyone not on the account (403 `consent_required`). `GET /business/trips?account_id=&month=` → `{ trips }` (approvers and
managers see the account's; members what they took or booked).

**Usage.** `GET /business/usage?account_id=&month=` (approvers and managers) → `{ account, month, totals { trips, cancellation_fees,
charges_cents, refunds_cents, spend_cents, gst_cents, average_cents }, limit, by_cost_centre, by_purpose, by_traveller (top 20), by_day
[{ key, trips, spend_cents }], approvals_waiting, booked { trips, quote_cents }, recurring_series, invoices { open, open_cents, overdue,
overdue_cents, list } }`.

**Invoices.** `POST /admin/business/invoices/run { month? (default last month), account_id? }` (admin) → `{ month, issued, skipped }`:
one invoice per account (or per PO with `invoice_per_po`) for a closed Darwin month (400 `month_not_closed`), never twice (a void one
can be reissued), numbered `INV-YYYYMM-NNNN`, due after the account's `invoice_terms_days`; lines are frozen (`date, trip_ref, traveller,
booked_by, description, amount_cents, refunded_cents, cost_centre, purpose, po_number, ndis_number, cancellation`) and managers are
notified `invoice_issued`. `GET /admin/business/invoices?month=&status=all|issued|paid|void|overdue&account_id=` → `{ ready, invoices
(with overdue_days), summary }`; `GET /admin/business/invoices/:id?format=pdf` (PDF tax invoice: NDIS lines grouped per participant
with the NDIS number, support item and GST code, provider ABN and registration; PO; how to pay); `POST /admin/business/invoices/:id/paid { paid_on?,
paid_ref? }`, `POST /admin/business/invoices/:id/void { reason }` (only unpaid ones: 409 `not_open`); `GET
/admin/business/invoices/export?month=&format=xero|myob` (admin, audited): Xero sales invoice import (tax inclusive, dd/mm/yyyy, account
code, tax type, cost centre as tracking) or MYOB AccountRight service sales (ex-GST and inc-GST amounts, tax code, a blank line between
invoices). Managers and approvers: `GET /business/invoices?account_id=` and `GET /business/invoices/:id?format=pdf`.

**Billing settings and reminders.** `GET /admin/business/billing` → `{ ready, settings }`, `PUT /admin/business/billing { auto_issue,
reminder_days (up to 6, 1–120), hold_after_days (0–180, 0 = never), pay_to, xero_account_code, xero_tax_type, myob_income_account,
myob_tax_code }` (admin; 400 `invalid_billing`). The dispatcher tick (every 3 hours at most) issues last month's invoices once when
`auto_issue` is on and sends overdue reminders: on each reminder day (default 1, 7 and 14 days overdue; a missed day sends the latest
one once; one a day at most) the managers get `invoice_overdue` (app and text), counted on the invoice and audited. `POST
/admin/business/reminders/run` runs it now (admin).

**Recurring trips.** `POST /business/recurring { account_id, traveller (as above), pickup, dropoff, weekdays [1 = Mon … 7 = Sun],
pickup_time (HH:MM Darwin), return_time?, starts_on, ends_on? (up to a year), skip_holidays (default true), skip_dates?, options?: {
cost_centre_id, purpose_code, po_number, ndis_number, notes, needs_wheelchair, assistance_animal, passengers, women_driver_pref },
dry_run? }` → dry run `{ preview: { trips, skipped }, traveller }`, else 201 `{ series, booked, problems, skipped }`: trips are booked 14
days ahead as ordinary account bookings (rules, limits and approvals apply; at most one per series and time — unique index), one
`regular_rides_booked` text to the traveller; the tick tops series up hourly and records problems on the series (`last_run`, the booker
is notified `recurring_problem`); a series stops when the account closes or the client's consent ends. `GET
/business/recurring?account_id=` → `{ series: [{ …, traveller, days, upcoming, next_at, skip_dates, last_run }] }`. `POST
/business/recurring/:id/skip { date }` (adds the date, cancels that day's trips free) and `POST /business/recurring/:id/stop {
cancel_booked? }` (who set it up, approvers, managers). `GET /admin/business/accounts/:id` (staff) → set-up, recurring series and the
application.

Messages: `business_application_received`, `business_account_approved`, `business_account_declined`, `business_member_added`,
`business_approval_needed`, `business_trip_approved`, `business_trip_declined`, `business_trip_unapproved`, `regular_rides_booked`,
`recurring_problem`, `invoice_issued`, `invoice_overdue`.
