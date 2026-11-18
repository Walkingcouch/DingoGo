# Improvement rounds (owner request, 18 Nov 2026)

"Scan and suggest more fixes and additions, then implement all, then suggest more — repeat 30 times."

Each round: **scan → suggest (5–10 concrete items) → implement all → verify → commit**. Log every round below (suggestions, what was done, what was deferred and why). The next round starts by reading this log so it doesn't repeat work and can pick up deferred items.

## Ground rules for every round
- Repo: /home/claude/dingogo (npm workspaces). API `services/api` (Fastify 5, pg, zod, TS ESM); apps `apps/{web,rider,driver,admin,partner,roof-display}` (React 18 + Vite 5); shared `packages/shared`.
- Live: https://dingogo-steel.vercel.app (Vercel, Build Output API via `scripts/build-vercel.mjs`; API is one serverless function, `VITE_REALTIME=off`, dispatch runs on requests). DB: Supabase Postgres. Android test APKs built by `.github/workflows/android.yml` on push.
- **Business decisions to respect:** Aboriginal-owned, Alice Springs (Mparntwe) first; Uber-style own-car drivers (any fuel, NT max 13 yrs, SA max 8 yrs); electric fleet is the *goal* — never claim "100% electric"/"all-electric"; EV/hybrid get trips first; platform fee 25% (driver keeps 75%, 100% of tips); NT $1 levy; SA regional towns built but hidden until accredited; cash off for rides, on for courier; cancellation 2-min free then $3; fares $3 + $1.60/km + $0.25/min + $1 booking; demo sign-in code 000000 only for demo/test accounts; plain Australian English, no emoji in UI (use packages/shared Icon), concise copy.
- **Live DB lag:** the coordinator may not be able to apply migrations to the live database straight away. New code must keep working (degrade gracefully, e.g. feature off) if its new tables/columns don't exist yet in production.
- **Safety:** never break live. New DB changes go in a new numbered migration `services/api/migrations/0NN_*.sql` (next free number), additive and backward compatible. Features needing paid keys (Stripe, Twilio, plate lookup, push) must be built behind config and degrade gracefully when unset. No secrets in the repo.
- **Verify before committing:** `npx tsc --noEmit -p` for every changed workspace; `DATABASE_URL=postgres://dingogo:dingogo@localhost:5432/dingogo_test npm run db:reset -w services/api && DATABASE_URL=... npm test -w services/api` (all tests pass; add tests for new API behaviour); `node scripts/build-vercel.mjs` succeeds. Local Postgres 16: if down, `su postgres -c "/usr/lib/postgresql/16/bin/pg_ctl -D /home/claude/pgdata -l /tmp/pg.log start"`. Never `pkill -f` with patterns that could match your own shell.
- **Commit** at the end of the round on `main` with message `Round N: <summary>` and the trailer:
  ```
  Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>
  Claude-Session: https://claude.ai/code/session_01E1dP492U7pgY7CFknut1u2
  ```
  Do **not** push and do **not** deploy (the coordinator pushes, applies migrations to Supabase and deploys).
- Keep scope realistic for one round (a few hours of careful work). Prefer depth and correctness over breadth. Spread rounds across: security/privacy, correctness bugs, money/payments, safety, accessibility, performance, rider UX, driver UX, admin/ops tooling, partner portal, website/SEO, compliance (NT/SA, ATO, privacy), tests, docs, observability, offline/poor-signal resilience, Aboriginal community/cultural fit, commercial features.

## Round log

### Round 1 — correctness, security, money flows
Suggested:
1. [fix] Voucher wrong-code limit never triggered: the failure was logged inside the transaction that then rolled back. Log failures outside it.
2. [fix] Refunds: cap the running total of refunds at what was actually paid, lock the trip so a double-click can't refund twice, mark the trip `refunded` when fully refunded.
3. [fix] Admin re-dispatch of a "no drivers" trip: restart the search window (it failed again instantly) and take payment again (card hold / wallet / points were released at no-drivers, so the trip would have been free).
4. [fix] "No drivers" outcome gives the promo code use back (cancel already did).
5. [fix] Cancellation fees: driver share uses their service fee (75%, not a hard-coded 80%); cash trips can't be charged a fee DingoGo can't collect; account trips invoice the fee; wallet/card fee captures are recorded with the right provider and checked.
6. [fix] Ratings can't be double-counted by concurrent requests (conditional update); tips on wallet-paid trips come from DingoGo credit.
7. [fix] Driver payouts serialised per driver (transaction + advisory lock) so two clicks can't pay twice.
8. [fix] Safety: drivers can't switch on "woman driver" matching themselves; DingoGo sets it after checking (driver app shows it read-only).
9. [fix] Courier delivery PIN: wrong PINs get a clear `pin_mismatch`, and after 5 wrong tries the PIN is locked (signature/photo or support) to stop guessing.
10. [fix] README still said "100% electric"; test count stale; API.md notes for the changed behaviour. `nosniff` on uploads.

Done (all 10). No migration this round (no schema changes). Tests: 30 → 38 (8 new e2e tests: voucher limit, refund cap + concurrent refunds, concurrent ratings, no-drivers → search again with wallet/promo + wallet tip, cancellation-fee splits incl. cash and business account, courier PIN lock, concurrent payouts, women-driver flag).
- API: `services/api/src/services/trips.ts` (new `redispatchTrip`, `DELIVERY_PIN_MAX_TRIES`), `routes/admin.ts` (refund, redispatch, payout, corporate statement), `routes/rider.ts` (voucher), `routes/driver.ts` (female_driver), `routes/uploads.ts`.
- Admin app: trip drawer shows "Search again" for no-driver trips and how much is left to refund; new timeline labels. Driver app: women-driver matching shown read-only.
- Behaviour changes to note: corporate statement now lists only trips billed to the account (card-paid trips that used the account discount are no longer on the invoice) plus late-cancel fees; cash late-cancel fees are waived; driver share of cancel fees 80% → 75%.

Deferred:
- Driver cancels after accepting → put the trip back to "requested" and offer it to the next driver (instead of cancelling on the rider). Behaviour change for riders/drivers/ops; worth its own round with app copy.
- Upload privacy: `/uploads/:name` is unauthenticated (unguessable names). Driver licences and POD photos should need a signed, expiring URL. Needs app changes (img tags can't send a bearer token).
- Stripe: card holds expire after ~7 days, so scheduled card trips booked further ahead need the hold placed when the trip is released (not at booking). Refunds of tips should use the tip's own PaymentIntent. Not urgent while payments are mocked.

Ideas for next rounds:
- Re-offer the trip to another driver when a driver cancels (above), with a limit per driver and a compliance flag for repeat cancels.
- Signed, short-lived URLs for driver documents and POD photos; admin-only access to `document` uploads.
- Per-IP rate limits on `/auth/otp/request` and `/public/*` forms (spam), plus OTP code compare with `timingSafeEqual`.
- Stripe readiness: idempotency keys on authorise/capture/refund, webhook endpoint for async failures, hold placed at release for scheduled trips.
- Driver ledger reversal on refunds where the driver was at fault (admin choice), and a payouts CSV/ABA export.
- WebSocket auth should re-check blocked/deleted users (currently only the JWT is checked).

### Round 2 — privacy & security hardening
Suggested:
1. [add] Private uploads: driver documents and POD photos served only with signed, short-lived links (HMAC, ~1 h, `UPLOAD_LINK_TTL_S`) or to the owner / staff with a bearer token; API responses sign stored `/uploads/…` references on the way out; `GET /uploads/:name/link` for a fresh link; admin "View file" links refresh a stale link; driver app previews the POD photo through its signed link.
2. [fix] Upload references and uploads: `file_url` (driver documents) and `pod_photo_url` must be the caller's own upload of the right kind (no outside links, no other people's files); upload kinds by role (ads = admin; documents/POD = drivers); file bytes must match the declared type; 30 uploads/hour per account (uploads live in Postgres).
3. [add] Per-IP rate limits shared through Postgres (serverless-safe; client IP via `trustProxy`, on by default on Vercel): OTP requests, wrong OTP codes, public forms (driver applications, hire requests, enquiries), public fare estimates (routing quota).
4. [fix] OTP verify: constant-time hash compare; the try is counted atomically before comparing (parallel guesses can't beat the 5-try limit); a code is single-use even when sent twice at once. JWT verify pinned to HS256.
5. [fix] Realtime: sockets check the account in the database (blocked/deleted refused, role from the DB not the token, so a demoted admin loses `ops`); re-checked every minute; blocking a user, changing their role or deleting the account drops their sockets at once; trip subscribe ids validated; clients stop reconnecting on 4001/4004/4010.
6. [fix] Share-trip links (`/public/track/:token` and `/ws?share=`) stop working 24 h after the trip ends (`SHARE_LINK_HOURS`): they expose pickup/drop-off addresses (often home). Website shows a clear "trip has finished" page.
7. [add] Security headers: API — nosniff, `Referrer-Policy: no-referrer`, `X-Frame-Options: DENY`, CSP `default-src 'none'` on JSON, `Cache-Control: no-store` on signed-in and tracking responses, HSTS in production; uploads get a sandbox CSP (images) and inline disposition (PDF). Website/apps (Vercel + Caddy) — nosniff, `Referrer-Policy: strict-origin-when-cross-origin` (tracking tokens don't leak to tile servers), `X-Frame-Options: SAMEORIGIN`, Permissions-Policy.
8. [fix] Partner portal: redeeming is conditional on the code still being issued (two taps can't settle twice); wrong codes on check/redeem/sell are limited (20/hour per login) so customer reward codes and unsold voucher codes can't be guessed.
9. [fix] Authorisation gaps: blocked or deleted drivers are no longer offered trips (and are taken offline when blocked/deleted); declining a trip you were never offered no longer logs events, raises an assistance-animal flag or re-dispatches someone else's trip.
10. [fix] Input limits on remaining unbounded fields (POD photo ref, delivery/trip PIN, push token, card provider ref, plan code, quote service, voucher-sell code, place search, admin user search, accessibility JSON, display play ids, admin ABN format).

Done (all 10). Migration: `services/api/migrations/011_rate_limits.sql` (new table `rate_events` + indexes on `rate_events` and `uploads(owner_id, created_at)`; additive. The API fails open on rate limits if the table is missing, so deploy order doesn't matter). Tests: 38 → 48 (10 new e2e tests: private uploads + signed links + upload kinds/file types, upload limit, POD photo ownership + rider signed view, OTP per-IP/parallel-guess/single-use/wrong-code limits, public form limit, share-link expiry (HTTP + WS), realtime DB role + block disconnect, partner double-redeem + code-guess limit, decline no-op + blocked drivers get no offers, headers + input caps).
- API: new `src/lib/uploads.ts` (signing, ownership, magic bytes), `src/lib/rateLimit.ts`; `routes/uploads.ts`, `routes/auth.ts` (OTP), `index.ts` (headers hook, response signing, WS auth), `realtime.ts` (`trackUser`/`disconnectUser`), `routes/public.ts`, `routes/partner.ts`, `routes/driver.ts`, `routes/admin.ts`, `services/trips.ts` (`shareLinkExpired`, dispatch excludes blocked, decline guard), `config.ts` (new env vars, all optional), `.env.example`.
- Apps: shared `FileLink` (refreshes stale signed links) used for every admin "View file" link and a new "Delivery photo" link in the admin trip drawer; driver app previews the POD photo via `view_url`; website tracking page shows "This trip has finished" for expired links; shared realtime client stops reconnecting on 4001/4004/4010. Static security headers in `scripts/build-vercel.mjs` and `deploy/Caddyfile`. Removed two emoji from driver notifications.
- Behaviour changes to note: old raw `/uploads/document-…`/`/uploads/pod-…` URLs no longer open without a signature or token (admin pages get signed links automatically); share links for trips that ended > 24 h ago return 410; driver documents/POD can no longer reference outside URLs; riders can't upload `document`/`ad` files; admin `abn` must be 11 digits.
- Deploy: no new env vars required. Vercel's edge sets `X-Forwarded-For`, so per-IP limits work there with the default `TRUST_PROXY` (auto on). Behind another proxy set `TRUST_PROXY=true`. Existing uploaded files need no data fix.

Deferred:
- Migrating uploads to Supabase Storage with presigned URLs (bytea in Postgres is fine at pilot scale; signed-link API shape is ready for it).
- Content-Security-Policy for the static apps: needs an inventory of tile/routing/font origins per app and testing in the Capacitor shells; risk of breaking maps on live. Do it with a report-only header first.
- JWT revocation / shorter sessions (30-day tokens; blocked/deleted are caught on every request, but a stolen token stays valid). Needs refresh tokens and app changes.
- Rate limit on signed-in `POST /quotes` (routing quota) — riders are authenticated and lower risk; watch usage first.

Ideas for next rounds:
- CSP in report-only mode for website and apps, with a `/csp-report` endpoint, then enforce.
- Sessions: 7-day access tokens with refresh, "sign out of all devices", token version on users (instant revocation).
- Privacy retention job: purge OTP/rate events/old trip GPS tracks (e.g. 12 months) and POD photos after the claims window; document in the privacy policy.
- Admin access hardening: audit-log reads of driver documents and personal data exports; dispatcher vs admin view of rider phone numbers.
- Driver cancels after accepting → re-offer to next driver (still deferred from Round 1).
- Move uploads to Supabase Storage (private bucket, presigned URLs) and stream instead of base64 JSON.

### Round 3 — trip lifecycle & dispatch reliability
Suggested:
1. [add] Driver cancels after accepting (before the trip starts) for a driver-side reason (car problem, something else) → the trip goes back into the search and is offered to the next driver; the rider keeps their booking, price and payment hold and is told "finding you another driver". Rider-side reasons (no-show, rider asked, unsafe, prohibited parcel) still end the trip. At most `DISPATCH_MAX_REOFFERS` (2) re-offers per trip, then the trip ends as cancelled by driver (rider not charged).
2. [add] Repeat cancellers: cancellations after accepting are recorded on the driver's offer (`cancelled`); 3 in 7 days (`DRIVER_CANCEL_FLAG_COUNT`) raises a `repeat_cancellation` compliance flag (one open flag at a time). Driver app shows cancellations next to the acceptance rate and warns in the cancel sheet.
3. [add] Silent drivers: an accepted/arrived trip whose driver has sent nothing for `DRIVER_SILENT_ALERT_MIN` (4) gets a `driver_silent` event + ops alert; ops can "Give to another driver" (`POST /admin/trips/:id/reassign`, not counted against the driver). Optional auto-reassign of accepted trips after `DRIVER_SILENT_REASSIGN_MIN` (off by default: phones pause the app while the driver uses Google Maps).
4. [fix] Offer races: accept locks the trip before the offer (same order as cancel and dispatch, so no deadlock), checks expiry on the database clock with a 3 s grace (`OFFER_GRACE_S`) for last-second taps while the offer is still the latest, and refuses if the driver is offline or already on a trip.
5. [fix] Driver goes offline, is blocked or suspended with an offer on screen → the offer is withdrawn and the trip goes straight to the next driver (was: rider waited for the 20 s timeout). Drivers with no signal for `DRIVER_STALE_OFFLINE_MIN` (30) and no live trip are set offline (live map and counts stay true); the driver app re-syncs its online switch from `/driver/location`.
6. [fix] Scheduled trips: the search keeps going until the booked time + the search window (was: gave up ~10 min before the pickup time) with double the offer attempts; a booking released more than 30 min late (serverless with nobody using the apps) is ended as "no drivers" and the rider told, instead of sending a driver to a pickup that was long ago.
7. [fix] Serverless: notifications started after a state change (`void notify(...)`, SMS) could be lost when Vercel freezes the function after responding; they are now tracked and awaited (up to 3 s) before the response goes out on serverless.
8. [add] Rider app copy for each transition: "Your driver had to cancel — finding you another, no extra charge" while searching again; clear cancelled-by-driver and scheduled-search copy.
9. [add] Driver app: "passed to another driver" end screen, detects a trip taken away (ops reassign) with a clear message instead of silently dropping it.
10. [add] Admin: live map shows last signal on active trips and drivers ("No signal 6 min"), "Give to another driver" action, scheduled time on searching trips; labels for the new events, flags and offer states. API.md + README.

Done (all 10). No migration this round (new states/kinds — offer `cancelled`/`released`, flag `repeat_cancellation`, events `driver_released`/`driver_silent`/`offer_withdrawn` — live in existing text columns). Tests: 48 → 55 (7 new: driver pull-out → re-offer / rider-side reasons end it / re-offer limit; repeat-canceller flag + driver counts; offer grace, late/busy accepts, concurrent accept vs cancel; offline withdraws the offer at once; silent-driver alert + ops reassign + stale drivers set offline; booked-trip search window + missed bookings; background flush).
- API: `services/trips.ts` (`releaseTrip`/`reassignTrip`/`recordDriverCancel`, `RIDER_SIDE_CANCEL_REASONS`, `searchOver`, `withdrawOffers`, `watchDrivers` in the tick, accept rewritten), new `lib/background.ts` (`bg`, `flushBackground`) used by `notify`/`sendSms` and an `onSend` hook on serverless, `routes/driver.ts` (cancel reason codes, `/driver/location` returns `online`, acceptance counts, withdraw on offline/car edit), `routes/admin.ts` (`POST /admin/trips/:id/reassign`, live fields, withdraw on block/suspend/state off), `routes/auth.ts` (withdraw on delete), `config.ts` + `.env.example` (7 optional env vars).
- Apps: driver — cancel sheet split into "the trip ends" vs "we offer it to another driver" with the 7-day count, "Passed to another driver" end screen (own cancel vs ops reassign), detects a trip taken away, online switch re-synced from location pings, cancellations shown next to acceptance rate. Rider — "Finding you another driver" while re-searching, booked-trip search copy, cancelled-by-driver callout. Admin — live map "No signal N min" on trips and drivers, "Driver pulled out" chip, "Give to another driver" button, booked time; labels for new events, flags and offer states.
- Behaviour changes to note: a driver cancelling for "Problem with the car"/"Something else" no longer cancels the rider's trip (re-offered up to 2 times); `requested_at` restarts when a trip goes back to the search; accept can now return 409 `driver_offline`/`on_trip`; booked trips search until their pickup time; bookings found > 30 min late are ended as no drivers; online drivers silent for 30 min are set offline.
- Deploy: no migration and no required env vars (defaults are in code; auto-reassign stays off unless `DRIVER_SILENT_REASSIGN_MIN` is set). No data fix.

Deferred:
- Automatic reassign of silent drivers on by default: phones pause the web/Capacitor app while the driver navigates in Google/Apple Maps, so silence isn't proof they've gone. Needs a native background-location plugin (Capacitor) first; then turn on `DRIVER_SILENT_REASSIGN_MIN`.
- Rider no-show fee when the driver cancels with `rider_no_show` after the free wait (money behaviour change; needs owner sign-off on the amount and driver share).
- A separate "search started" timestamp (the original `requested_at` is overwritten on re-offer/redispatch; history is in `trip_events`). Would need a migration.
- Cross-instance tick lock on serverless (each step is already safe to run twice; a lock would only save DB work).

Ideas for next rounds:
- Rider no-show fee + driver waiting-time pay after the free wait (arrived → no-show), with clear rider copy before booking.
- Native background location in the driver app (Capacitor) so pings continue during navigation; then enable auto-reassign and show "last signal" to the rider.
- Ops "dispatch board": trips searching > 2 min, booked trips with no driver 10 min before pickup, manual "offer to this driver" from the live map.
- Driver reliability page in admin: acceptance, cancellations, silent episodes per driver over 30 days, with flag review actions.
- Offline/poor-signal resilience for the driver app: queue arrive/start/complete taps and replay them with idempotency keys when signal returns.
- Rider "a driver is still on the way" reassurance: show the new driver's ETA after a re-offer and let the rider cancel free during the search.

### Round 4 — driver pay fairness & driver earnings
Suggested (owner-agreed direction: every rate admin-editable, defaults off or equal to today's behaviour):
1. [add] Service fee by car: one rate for own cars (petrol/diesel) and one for electric/hybrid cars, in admin. Both default to 25% (no change until the owner switches, e.g. to 20%/15%). A driver's own rate is a ceiling, so this never raises anyone's fee. Applies to fares and to the driver's share of late-cancellation fees; the rate is fixed when the driver accepts.
2. [add] Pickup pay funded by a rider long-pickup charge (off by default): the first 2 km of the drive to the pickup are unpaid; beyond that the driver gets a per-km amount (no service fee) and the quote shows a "Long pickup" line based on the nearest free car. Per-km rates, free km and cap are editable.
3. [add] Fuel surcharge switch (off by default): a flat amount per ride or parcel (not tours), outside discounts, 100% to the driver.
4. [add] Weekly earnings floor per engaged hour (off by default, $32/h): engaged time = accept to end of trip; counted earnings = fares less fee + pickup pay + fuel surcharge + cancellation fees (tips never count). Top-ups go into the driver ledger once per driver per week (new table), from an admin report with "Pay top-ups", or automatically each Monday if switched on.
5. [add] Offers show the driver's pay (fare less fee, pickup pay, fuel surcharge) and total km including the drive to the pickup.
6. [fix] Polled offers (the live site runs with realtime off) dropped `trip_cents`, so the driver app estimated pay from the rider's total (after discounts, incl. levy) and showed the wrong amount.
7. [add] Driver earnings screen: grouped breakdown (trip pay, extras, costs, paid to bank), engaged hours and pay per engaged hour, earnings-floor progress this week, the fee rate for the current car; trips list shows the driver's pay per trip.
8. [add] Admin: Pricing → Driver pay tab (edit every rate, validated and audited) and the weekly earnings-floor report (CSV, pay top-ups); labels for the new ledger kinds.
9. [fix] Emoji removed from rider/driver notifications (tip, parcel delivered, referral bonus).
10. [add] Docs: API.md and README business rules for driver pay.

Done (all 10). Migration: `services/api/migrations/012_driver_pay_weeks.sql` (new table `driver_pay_weeks`, one row per driver per week, plus an index on `driver_ledger(trip_id)`; additive). Rates need no migration (setting `driver_pay`, defaults in code). Without 012 everything works except paying floor top-ups: the report shows a preview with "migration pending" and the run returns 503 `migration_pending`. Tests: 55 → 60 (5 new: pay-rule unit tests incl. fee ceiling and Darwin weeks; fare engine long-pickup/fuel surcharge/tours; defaults unchanged + polled offers carry pay and pickup km; everything switched on — EV rate, long-pickup charge and pickup pay, fuel surcharge, rate fixed at accept, cancel-fee share, admin validation/roles/audit, earnings summary; earnings floor report/run once under a double click/off/unfinished week/bad week).
- API: new `src/lib/driverPay.ts` (rules, defaults, `serviceFeeFor`, pickup pay, `driverPay`, `weekStartOf`), new `src/services/earningsFloor.ts` (report, run, auto weekly, driver's week); `lib/fares.ts` (`longPickup`, `fuelSurchargeCents`); `services/trips.ts` (`nearestFreeCarM`, `offerPay`, pickup distance on offer events, pay fixed on the accepted event, settle writes `pickup_pay`/`fuel_surcharge`, cancel-fee share at the accepted rate, tick runs the auto floor, emoji removed); `routes/driver.ts` (offers, trips, earnings); `routes/admin.ts` (`/admin/driver-pay`, floor report/run, `driver_ledger` on trip detail, `PUT /admin/settings/driver_pay` validated).
- Apps: driver — offer shows pay breakdown (fare, fee and its basis, pickup pay, fuel surcharge) and total km incl. the pickup; polled offers keep `trip_cents`/`driver_pay`; earnings grouped (trip pay, on top, costs, paid to bank), hours on trips, pay per hour on trips, km incl. pickups, floor progress, "How you are paid"; trips list shows your pay and what the rider paid. Admin — Pricing → Driver pay tab (rules form + weekly floor report with CSV and "Pay top-ups"), trip drawer "Driver pay", ledger labels fixed (`commission`, `charging_credit`, `cash_collected`, `cancel_fee` were unlabelled) and new kinds, payouts note.
- Behaviour changes to note (with defaults): none for money. Offers carry extra fields; `GET /driver/earnings` `daily` no longer subtracts payouts; GST figure on the earnings screen also includes pickup pay and fuel surcharge (both zero until switched on); notification titles lost their emoji.
- Deploy: apply migration 012 before switching the earnings floor on. No env vars. No data fix. To go live with the owner's direction, set in admin → Pricing → Driver pay: own car 20%, electric/hybrid 15%, switch on pickup pay and (if wanted) fuel surcharge and the floor.

Deferred:
- Pickup pay on late-cancelled trips (driver drove to a pickup, rider cancelled): the cancellation fee covers it today; adding pickup pay there needs the owner to decide who funds it.
- Long-pickup charge on scheduled bookings: no car is known at booking time; would need a charge set at release and rider consent.
- Road-distance pickup pay (routing call per offer) instead of straight line × 1.3: costs routing quota; straight line × 1.3 is what dispatch already uses.
- Engaged time for trips taken off a driver by ops (lost signal) — the trip row no longer points at them; would need the offer/event history in the floor query.
- Per-driver opt-out or hours cap for the floor (gaming: slow trips). Capped per trip at 2 × estimate + 45 min for now; watch the report.

Ideas for next rounds:
- Driver weekly statement (PDF/CSV) with trip-by-trip pay, fee, GST and floor top-ups, for their BAS; ABA payout file export.
- Rider no-show fee + driver waiting-time pay after the free wait (still open from Round 3).
- Heat-map / "where to wait" for drivers from recent demand, so fewer long pickups happen in the first place.
- Earnings-floor fairness review in admin: pay per hour on trips by driver, car type and time of day, to set the floor and fee rates with evidence.
- Native background location in the driver app (Capacitor) so pickup distance and engaged time are measured from real GPS, then road-distance pickup pay.

### Round 5 — accessibility & rider experience
Scan: axe-core (WCAG 2.2 A/AA) with Playwright over 10 website pages, the signed-out and signed-in rider app (9 screens) and a live trip, light and dark, at phone size; keyboard walk-through of dialogs; screenshots at 200% text. Found: 18 contrast failures (ochre link text 3.9:1, green chips 4.0:1 and 2.8:1 in dark, red errors 2.4:1 in dark, light-grey form hints on white cards, About roadmap text 2.7:1, map attribution), map markers exposed as unnamed buttons, a scrollable gallery with no keyboard access, modal dialogs that didn't move or keep focus, trip status only "announced" via a changing `h1`, the profile's accessibility answers ("we share these with your driver") never reaching the driver, a dead disabled Book button with no reason given, and layouts that clipped at 200% text.

Suggested:
1. [fix] Colour contrast to AA everywhere (shared tokens: darker `--ochre-deep` and `--saltbush`, new `--saltbush-ink`/`--earth-ink`/`--dusk-ink` for text on tints in dark mode; website form hints on dark bands, About roadmap, map attribution) and a stronger two-tone focus ring that also shows in Windows high contrast.
2. [fix] Rider dialogs (SOS, cancel, delete account) are real modals: rendered over an inert page, focus moves in and stays in (also when SOS goes "sending" → "sent"), Tab wraps, Escape closes, focus returns to the button that opened it. Map markers are only buttons when they do something (and then named); website phone gallery is keyboard-scrollable.
3. [add] Trip status for screen readers and everyone else: polite/assertive live regions announce each change once in plain words (driver name, car, rego and PIN spelt out; "Your driver has arrived" interrupts), the page title shows the status (app switcher), the phone buzzes on arrival (Deaf/hard-of-hearing riders), and the progress bar gets visible word labels with ticks (Finding, Coming, Here, Riding / parcel steps).
4. [fix] The rider's accessibility profile actually reaches the driver: Deaf/hard of hearing ("send a message, don't call"), blind/low vision ("come to the door and say who you are"), mobility aid and the free-text note go with offers (realtime and polled) and the trip for the assigned driver and ops only (not parcels, not share links); driver offer/trip screens and the admin trip drawer show them. Booking pre-ticks "assistance animal" from the profile.
5. [add] Assistance-animal refusal reports: "A driver refused my assistance animal" on trip details (animal trips or driver-cancelled rides) and in Help; with a trip, the driver on it (or the last one offered it) gets the same `assistance_animal_refusal` compliance flag as a declined/cancelled animal trip (once per trip and driver), even if the rider hadn't ticked the box. Admin labels.
6. [add] Poor signal: shared client times out reads after 15 s and retries them twice (writes never retried), tracks online/offline; rider app shows a "No signal" bar; the trip screen keeps the last known trip with "No signal. Showing your trip as it was 3 min ago" instead of an error page and refreshes the moment signal returns; the live trip is kept on the phone (cleared at trip end and sign-out, 12 h max) so reopening the app with no bars goes straight to the PIN, car and rego.
7. [fix] Booking form errors: the Book button stays focusable and says what's missing in plain words ("To book, add a drop-off, the recipient's mobile and the prohibited items check"), read out when pressed early; bad mobiles and NDIS numbers are marked `aria-invalid` with a linked message; a failed booking's error takes focus. Sign-in errors are linked to their field. Help "message sent" takes focus.
8. [fix] Large text (200%) and reduced motion: mode buttons wrap instead of clipping, tab labels fit, SOS button grows, trip-list prices don't clip, map hint moved to the top and wraps, clear buttons 44 px; the map stops gliding/fading when the phone asks for less motion.
9. [add] `scripts/a11y-check.mjs`: repeatable axe-core + Playwright WCAG 2.2 AA check of the website and rider app in light and dark (axe-core added as a root devDependency).

Done (all 9). No migration (support category and flag kinds are text; needs come from the existing `users.accessibility`). Tests: 60 → 62 (rider needs on offers/trip for driver and ops only, not parcels/rider/share link; rider refusal report flags the right driver once, own trips only, no driver → ticket only). axe: 0 violations on all 20 pages × light/dark, plus the live trip and tracking page, and with the SOS dialog open. Playwright checks: focus trap/return, arrival announcement + title, offline bar/stale note, reopen offline → cached live trip, Book-button reasons.
- API: `services/trips.ts` (`riderNeeds`, needs on `getTrip` and realtime offers, `flagRiderReportedRefusal`), `routes/driver.ts` (polled offers), `routes/rider.ts` (`assistance_animal_refused`).
- Shared: `brand.css` (tokens, focus ring, invalid fields, attribution), `api.ts` (read timeout/retry, `isOnline`/`onNetworkChange`, non-JSON gateway errors no longer crash), `hooks.ts` (`useOnline`), `Map.tsx` (markers, reduced motion), `Login.tsx`.
- Rider: `components/ui.tsx` (Dialog), new `components/Announcer.tsx`, `screens/Trip.tsx` (announcements, step labels, stale/cached trip, refusal link), `screens/Ride.tsx` (reasons, field errors, profile pre-tick), `screens/Account.tsx` (Help category), `App.tsx` (offline bar, cached-trip resume, clear on sign-out), `app.css`. Driver: `needFlags` on offer and trip. Admin: support category, needs in trip drawer. Website: `styles.css`, `Home.tsx`.
- Behaviour changes to note: brand colours `--ochre-deep` #B86A12 → #935309 and `--saltbush` #4E7D5B → #3D6B4A (all apps; slightly darker links, green buttons and chips); focus ring is now solid; drivers see riders' accessibility needs from their profile; the Book button no longer uses `disabled` (it's `aria-disabled` and explains); rider app GETs retry on network failure.
- Deploy: no migration, no env vars, no data fix. `npm install` picks up the axe-core devDependency (not bundled).

Deferred:
- Driver, admin and partner apps: no axe/keyboard pass yet (they pick up the shared contrast and focus fixes). Driver app is used while driving, so it needs its own review (big targets, glanceable, voice).
- Offline write queue for the rider (rating, tip, help message sent later) — needs idempotency keys on the API first (same as the driver-side idea from Round 3).
- Map alternative for screen-reader users (text distance/ETA of the car: "about 3 minutes away") — needs a routing ETA per location update; car distance is cheap but misleading in town grids.
- Translated UI (Arrernte, Warlpiri) and audio prompts — must be made with community, not machine-translated.

Ideas for next rounds:
- Driver app accessibility and glanceability pass (axe, large buttons, read-out offers, one-tap accept with haptics), plus the admin console keyboard pass.
- "Car is about N minutes away" ETA text on the rider live trip and share page (screen readers and anyone not reading a map), from routing every ~30 s.
- Offline/poor-signal write queue with idempotency keys for driver arrive/start/complete taps and rider rating/tip/help.
- Easy-read mode (larger type, fewer options, pictures for pickup/drop-off) and "book for someone else" (carer/family books and tracks for an Elder), with SMS-only updates for riders without smartphones.
- Run `scripts/a11y-check.mjs` in CI (GitHub Actions with API + Postgres service) so contrast and labelling regressions fail the build.

### Round 6 — driver app in the car: accessibility, glanceable offers, navigation, poor signal, papers
Scan: read every driver screen and the trip-action API; axe-core (WCAG 2.2 AA) over the signed-out and signed-in driver app (7 screens) in light and dark, plus a
Playwright drive-through (offer → accept → arrive/start/complete with the network cut). Found: sheets and the offer takeover weren't modal (no focus move/trap,
no Escape, app behind still reachable); the whole trip sheet was `aria-live` (re-read on every change); the earnings day bars' names didn't match their visible
text; negative amounts in dark mode 2.4:1; two scrolling screens with no keyboard access; arrive/start/complete failed outright with no signal ("No connection,
try again") and a lost reply made the retry a 409; GPS pings were dropped while out of range (track gaps); only Google/Apple Maps links, small and equal weight;
the offer's pay, pickup time and distance were in one sentence of small grey text; the theme switch was day/night only; nothing told drivers papers were about
to run out until they were blocked from going online.

Suggested:
1. [fix] Driver app accessibility pass: every sheet (go online, set location, cancel, SOS, add car, car papers, log charge, battery check-in) and the offer are
   real modals via a shared `useModal` (portal, inert app, focus in and back, Tab wraps, Escape except on the offer); trip steps announced once through a polite
   region and shown in the page title; 5-second warning on the offer read out; rating stars are a radio group; earnings bar names match their labels; AA colours
   for amounts in dark mode; scrolling screens keyboard-reachable; axe 0 violations on all driver screens, the offer, the live trip and the done screen.
2. [add] Glanceable, one-handed offer: pay in very large type, two tiles "Pickup: 4 min, 1.2 km, suburb" and "Trip: 12 km, 18 min, suburb", Cash badge,
   80 px Accept (twice the width of Decline) on the thumb side, with a left-handed option; timer ring turns red at 5 s.
3. [add] Read-out offers (optional): pay, pickup time and distance, trip length, cash and assistance animal spoken in en-AU when a request arrives.
4. [add] Navigation hand-off: one big "Navigate to pickup / drop-off / delivery" button opening the driver's chosen app (Google Maps, Waze or Apple Maps,
   default Apple on iPhone) plus small links to the other two.
5. [add] Night mode and glare: Screen setting Phone / After dark / Day / Night, where "After dark" switches to the night theme from sunset to sunrise where the
   car is (NOAA formula, Mparntwe until GPS); keep the screen on while online or on a trip (Wake Lock, can be turned off); bigger map buttons and status pill.
6. [add] Poor signal, API: arrive/start/complete take an `Idempotency-Key` and `client_at`: a replayed tap returns the trip (no second event, capture,
   ledger entry or notification); tap times are kept, clamped (after the previous step, at most 15 min old, never future). New `POST /driver/location/batch` puts
   GPS kept on the phone onto the trip track at the time each point was taken.
7. [add] Poor signal, app: an outbox keeps arrive/start/complete taps (in order) and up to an hour of GPS points on the phone; the screen moves on with "No
   signal. Saved on your phone"; everything is sent when signal returns (and every 10 s), a refused replay (wrong PIN, trip cancelled) puts the driver back
   with a plain message; a "No signal. Reconnecting…" bar with the number of waiting updates, then "Sending…"; sign-out blocked while taps wait; cancelling
   still needs signal and says so.
8. [add] Document expiry: `GET /driver/me` lists papers (licence, H endorsement, other driver documents, the car's CVL/inspection, rego, insurance, car
   documents) that run out within 30 days; Drive screen banner for the soonest (red at 3 days or expired) with "Update"; Profile "Running out soon" list;
   in-app/push reminders at 30, 14 and 3 days, once each, none while a new copy waits for checking, 8 am–8 pm Darwin.
9. [add] `scripts/a11y-check.mjs` covers the driver app (signed out, Drive, Earnings, Trips, Profile, Charging); docs (API.md, README test count).

Done (all 9). No migration (idempotency keys and tap times live in `trip_events.data`; reminders de-duplicate against `notifications.data`; GPS uses the
existing `trip_track.at`). Tests: 62 → 64 (replayed arrive/start/complete with keys and tap-time clamps, wrong-PIN replay refused, single settle/capture,
location batch drops old/future points and sets the live position, bad key; expiring papers listed with levels and pending replacements, reminders once per
point, none at night or while a new copy waits, new date → new reminder; reminder-point unit test). axe: 0 violations on the 7 driver pages × light/dark and
with the offer open, the live trip, the offline done screen and Profile with papers running out. Playwright (light and dark): focus on Accept and app inert under
the offer; navigate link; network cut → arrive kept, signal bar, GPS kept, server untouched; wrong PIN while offline refused on reconnect with message and PIN
screen back; complete offline → replayed once, fare updated; Waze + Night saved.
- API: new `src/services/docExpiry.ts` (`expiringDocs`, `reminderPoint`, `sendDocExpiryReminders`, run from the dispatch tick); `services/trips.ts`
  (`Replay`, `alreadyDone`, tap-time clamp on arrive/start/complete, `storeTrack`, `onDriverLocation` `{ track: false }`); `routes/driver.ts`
  (`Idempotency-Key`/`client_at`, `POST /driver/location/batch`, `expiring` on `/driver/me`).
- Shared: `api.ts` (`ApiOpts { headers, timeoutMs }` on `api`/`post`), `hooks.ts` (`useModal`), `Icon.tsx` (`nosignal`).
- Driver app: new `lib/outbox.ts`, `lib/prefs.ts` (prefs store, sun times, theme), `lib/nav.ts`, `Sheet.tsx`, `screens/Expiry.tsx`; `state.tsx`
  (`tripAction`, flush on reconnect, GPS kept offline, wake lock, theme), `App.tsx` (signal bar, outbox cleared on sign-out), `Offer.tsx`, `ActiveTrip.tsx`,
  `Drive.tsx`, `Profile.tsx` ("In the car" settings, papers list), `Charging.tsx`, `Earnings.tsx`, `Trips.tsx`, `Onboarding.tsx`, `index.html` (live regions
  outside the app root), `app.css`.
- Behaviour changes to note: arrive/start/complete with an Idempotency-Key return 200 for a repeat instead of 409 (without a key nothing changes); with no
  signal the driver app moves the trip screen on and sends later (the rider sees the change when it arrives); the old `dingogo.driver.theme` setting is moved
  into the new prefs; drivers get document reminder notifications (category `documents`); the screen stays on while online (Profile switch).
- Deploy: no migration, no env vars, no data fix. Old app versions keep working against the new API and the new app degrades on an old API (no batch endpoint
  → kept GPS is dropped after one failed send; no `expiring` → no banner).

Deferred:
- Native background location (Capacitor plugin) so pings and the outbox keep going while the driver is in Google Maps/Waze: the web app is paused in the
  background, so the outbox only sends when the driver comes back to DingoGo. Needs a native plugin and store review.
- Offline queue for cancel, SOS and POD photo uploads: cancel may pass the trip to another driver (must be live); SOS must never be "saved for later" (the
  sheet already says call 000); photos need storage and a resumable upload. Signature and PIN deliveries do queue.
- Admin/partner keyboard and axe pass (the shared `useModal` is ready for them); rider app `Dialog` could move onto it.
- Voice commands ("accept") — hands-free accept needs care (accidental accepts) and testing in a moving car.

Ideas for next rounds:
- Native Capacitor shell work: background location + local notifications for offers when the app is behind the nav app, then turn on auto-reassign.
- Admin "papers running out" board (next 30 days, by driver and car, with reminder history) and an SMS reminder at 3 days for drivers without push.
- Rider side of poor signal: rating/tip/help queued with idempotency keys (the API pattern from this round), and "driver has poor signal" shown to the rider.
- Driver heat map / "where to wait" from recent demand, and offer de-duplication when the same rider re-requests within a minute.
- Run `scripts/a11y-check.mjs` (now web, rider and driver) in CI with the API and Postgres as services.

### Round 7 — admin and operations tooling
Scan: read every admin page, the admin API and the partner app. Found: several ops actions left no audit trail (document review, SOS acknowledge/resolve,
compliance flag and support ticket status, inbound request status, ops trip cancel); resolving an SOS overwrote its notes (no incident history); the audit
log was the last 300 rows with no filters; no way to find a trip, rider, driver or car from one box (trip search missed driver, driver phone and rego);
CSV exports were client-side copies of the first 100–500 rows (trips) or odd mixed rows (levy), none for payouts; documents had to be approved one at a time
with `prompt()`; no daily summary for the morning handover; admin drawers and modals didn't trap or return focus and the app behind stayed reachable; tabs
had no arrow keys or panels; the partner app had no axe pass.

Suggested:
1. [fix] Audit trail gaps: document review, SOS acknowledge/resolve/notes, compliance flag status, support ticket status/replies, hire request /
   application / enquiry status, ops trip cancel, CSV exports — all written to `audit_log`.
2. [add] Audit log viewer: `GET /admin/audit` filters (who, action, entity, entity id, from/to, text) with keyset paging and the list of actions; admin
   page with filters, expandable details, "load more" and CSV.
3. [add] Search everything: `GET /admin/search?q=` finds trips (ref, rider/driver phone), riders and staff (name, phone in any format), drivers (name,
   phone, rego) and cars (rego, VIN); a search box in the top of the console ("/" to focus) with keyboard-navigable results that open the right drawer.
   Trip list search also matches driver name/phone and rego, and takes a date range.
4. [add] Incident view for SOS: `GET /admin/sos/:id` gives the alert, who raised it, the trip (rider, driver, car, last position) and a timeline
   (raised, acknowledged, notes, runbook steps, resolved, nearby trip events); `POST /admin/sos/:id/notes` adds a timestamped note or a runbook step;
   resolve keeps earlier notes. Admin drawer with the runbook checklist (danger → 000, call them, check location, contact the other party, record outcome).
5. [add] Server-side CSV exports (admin): trips (date range, status, kind; no phone numbers), payouts (ledger payouts in range), levy return (month/state,
   one line per driver plus totals), GST (rows plus service fees). Audited. Buttons on Trips, Fleet → Payouts and Reports.
6. [add] Bulk document review: `POST /admin/documents/review` `{ ids (≤50), status, note? }` with the same rules as one-by-one, one notification per driver;
   checkboxes and "Approve selected" / "Reject selected" (reason dialog instead of `prompt()`).
7. [add] Daily ops summary: `GET /admin/summary/daily?date=` (Darwin day) — trips by outcome and type, revenue, cancellations by reason, no-driver
   trips, average pickup wait, SOS raised/resolved, flags, tickets, documents reviewed, drivers approved, payouts, passenger trips for the levy, and what
   still needs attention. Dashboard section with a date picker and print/CSV.
8. [add] Ops efficiency: keyboard shortcuts (`/` search, `g` then `l d t s i r` to go to a page, `?` for the list); saved trip filters (named, kept on this
   computer) and filters kept in the URL so a link opens the same view.
9. [fix] Admin + partner accessibility: Drawer/Modal become real modals (shared `useModal`: inert app, focus in/out, Tab wraps, Escape); tabs get arrow
   keys and panels; toasts in a live region that always exists; skip link; SOS resolve / document reject / ticket quote use a dialog instead of
   `prompt()`; partner app result announcements and button reasons; admin and partner pages added to `scripts/a11y-check.mjs` and fixed to 0 violations.

Done (all 9). Migration: `services/api/migrations/013_ops_indexes.sql` (indexes only: `audit_log (entity, entity_id, at)` and `(action, id)`, `trips
(requested_at)`, `trips (completed_at)`, `driver_ledger (kind, created_at)`, `driver_documents (reviewed_at)`; additive, IF NOT EXISTS). Everything works
without it (incident notes and runbook steps live in the existing `audit_log`), just slower on big tables. Tests: 64 → 68 (search by ref/phone/rego in any
format + trip filters incl. date range, cancelled group, bad status and audited ops cancel; SOS incident timeline, runbook step once, first action
acknowledges, resolve appends notes, no reopen; bulk document review only touches pending docs, one notification per driver, reject needs a reason,
audited, admin-only; CSV exports — headers, no phone numbers, formula defusing, year cap, admin-only money exports, levy/GST/payout totals, audited — daily
summary for today/an old day/bad date, audit filters and keyset paging). axe: 0 violations on 15 admin pages and the partner app (signed out and in) in
light and dark, plus the search popup, trip drawer, ask dialog, shortcuts list, incident drawer and audit log. Playwright: `/` focuses search, arrow +
Enter opens the result's drawer, focus moves in and the app is inert, Escape closes it; `g t`; quick filter in the URL; saved filter via dialog; `?`
list; runbook tick recorded; Escape on the resolve dialog closes only it and focus returns to the drawer; arrow keys move tabs; audit details expand.
- API: new `src/routes/ops.ts` (search, `sosIncident` + notes, exports, daily summary, audit with filters), `src/services/reports.ts` (`levyReport`,
  `gstReport`, `tripFilters`, `phoneTail`, Darwin dates), `src/lib/csv.ts`, `src/lib/audit.ts`; `routes/admin.ts` (audit gaps, `reviewDocument` + bulk
  endpoint, SOS notes appended / no reopen, trip list filters, levy/GST via the service, old audit route removed).
- Shared: `useModal` keeps a stack so only the top dialog handles Escape/Tab and focus (a dialog over a drawer; also the driver app's sheet over the offer).
- Admin app: `ui.tsx` (portal Drawer/Modal on `useModal` with labelled titles, Tabs with arrow keys and a tab panel, toasts in an always-present live region
  outside `#root`, `AskProvider`/`useAsk` replacing `prompt()`, `downloadCsv`), new `Search.tsx` (combobox), `main.tsx` (skip link, `<main>`, search bar,
  shortcuts and their list), `Trips.tsx` (URL filters, dates, quick and saved filters, server CSV, rego column), `Safety.tsx` (incident drawer with runbook,
  map, notes, timeline; bulk review; URL tab and incident), `Settings.tsx` (audit viewer), `Dashboard.tsx` (daily summary, deep links), `Reports.tsx` and
  `Fleet.tsx` (server CSVs, payouts export), `Drivers.tsx` (`?open=`), `Ads.tsx` (roof preview as an image with a contrast warning), AA ink colours for red
  and green text in dark mode. Partner app: hint instead of a silently disabled button, outcome announced and focused, sale message in a live region.
- Behaviour changes to note: `PATCH /admin/sos/:id` appends notes and returns 409 on a resolved alert; `GET /admin/audit` returns 100 by default (was 300)
  with `next_before`; levy/GST defaults use the Darwin date; `GET /admin/trips?status=<unknown>` is 400 (was a 500); client-side trips/levy/GST CSVs replaced by
  server ones (trip CSV has more columns and no 500-row cap); hire request / application / enquiry / ticket / flag updates 404 when the id doesn't exist.
- Deploy: apply migration 013 when convenient (indexes only, safe any time). No env vars. No data fix.

Deferred:
- Bulk actions beyond documents (flags, tickets, applications): wait to see which queues actually get long.
- ABA bank file for payouts: needs full BSB/account in the export (the API masks bank details everywhere today) and a decision on who may download it.
- Server-stored saved filters shared across staff: browser storage is enough for a two-person desk; shared views need a table.
- Partner app has a single short flow; no further keyboard work needed. Admin Live map markers are still mouse-first (the side lists carry the same
  actions by keyboard).

Ideas for next rounds:
- Ops "dispatch board" from Round 3 (searching > 2 min, bookings with no driver 10 min out, manual "offer to this driver"), now that search and the daily
  summary exist.
- Driver reliability page (acceptance, cancellations, silent episodes, flags, papers running out over 30 days) linked from search and the driver drawer.
- Staff roles finer than admin/dispatcher (e.g. "safety lead" who can block and resolve SOS; "finance" for exports and payouts), with the audit log per role.
- SMS from the incident drawer (welfare check text to the rider/driver, logged on the timeline) behind the Twilio config.
- Scheduled daily summary emailed/pushed to the owner at 7 am Darwin, and a weekly levy/GST reminder before lodging dates.
- Run `scripts/a11y-check.mjs` (now web, rider, driver, admin, partner) in CI with the API and Postgres as services.
