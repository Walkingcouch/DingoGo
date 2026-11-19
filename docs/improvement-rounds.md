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

### Round 8 — payments readiness (Stripe)
Scan: read `services/payments.ts`, every call site (booking hold, redispatch, cancel fees, settle, tips, top-up, Pass, admin refund), saved-card routes,
the receipt, the GST report and the rider app's Payment/booking screens. Found: the Stripe path could never have worked — holds were created with no
customer or card and never confirmed (status `requires_payment_method`) yet the trip was marked `authorised`; tips, top-ups and Pass did
"authorise then capture" on an unconfirmed PaymentIntent; no idempotency keys (a retried request could hold or charge twice); no webhook, so hold
expiry, dashboard refunds and disputes were invisible; saved cards trusted brand/last4/`pm_…` sent by the client, the SetupIntent had no customer
(card unusable later), removing a card didn't detach it or move the default; scheduled bookings up to 60 days ahead took a hold at booking (card holds
lapse after ~7 days); refunds always went to the fare's PaymentIntent (a tip refund would fail or over-refund the fare) and took GST off the tip part;
cancellation-fee invoices listed the trip fare lines; NDIS numbers promised "on the tax invoice" were not on it; in mock mode any real account on live
got card trips for free.

Suggested:
1. [fix] Stripe client: pinned API version, request timeout, nested form encoding, idempotency keys on every write (hold per trip + attempt, capture per
   PaymentIntent, cancel, refund per refund slot, charges per purpose), plain-English decline messages; `STRIPE_API_BASE` so tests run against a local fake
   Stripe. Mock stays the default when `STRIPE_SECRET_KEY` is unset.
2. [fix] Holds on the rider's own saved card: one Stripe Customer per rider, off-session confirm with the default card, 402 `card_required` with no card,
   holds that need bank authentication cancelled with a clear message, a hold left behind by a failed booking released.
3. [add] Scheduled card bookings: hold placed when the booking is released (15 min before), not at booking; declined at release → booking cancelled,
   points/promo back, rider and ops told. Late tour/hire cancellation fees and captures of a lapsed hold fall back to a fresh off-session charge.
4. [add] Tips, top-ups and DingoGo Pass on their own immediately-captured PaymentIntents (idempotent; `Idempotency-Key` honoured on top-up/Pass).
   Refunds split fare first, then tip, each against its own PaymentIntent; GST only on the fare part.
5. [add] Signed webhook `POST /payments/stripe/webhook`: Stripe-Signature HMAC-SHA256 with 5-min tolerance, constant-time; replay-safe event log; handlers
   for `payment_intent.succeeded/payment_failed/canceled/amount_capturable_updated`, `charge.refunded` (dashboard refunds recorded once),
   `charge.dispute.created/updated/closed` (dispute row, trip event, ops alert).
6. [add] Saved cards: SetupIntent on the rider's Customer (`usage=off_session`); `POST /payment-methods` checks the SetupIntent with Stripe and takes
   brand/last4/expiry from Stripe (client values ignored), same card twice merged; set default; remove detaches and promotes the next card.
7. [add] Rider app card management: Stripe Elements (Payment Element) add-card flow when configured, make default/remove, test card in test mode,
   "Card payments are coming soon" when Stripe isn't set for real accounts (server refuses card payments for them: `MOCK_CARDS`); booking and tip screens
   follow the mode.
8. [fix] Receipts / tax invoices: cancellation-fee invoices show the fee; refunds listed as adjustments with net total and GST; tips outside GST; invoice
   number, ABN and "Total includes GST"; NDIS participant number on the invoice.
9. [add] Admin: failed payments and open disputes list, "Retry charge" on a failed trip payment, rider "Pay now" for a failed payment; integrations show
   whether the webhook secret is set.

Done (all 9). Migration: `services/api/migrations/014_payments_stripe.sql` (new tables `payment_customers` (one Stripe Customer per rider) and
`payment_events` (webhook events applied once), columns `payment_methods.fingerprint/exp_month/exp_year`, indexes on `payments(provider_ref)` and
`trips(payment_ref)`; additive). Mock mode never touches them, so everything works before it is applied; with Stripe on, saving cards/holds and the
webhook return 503 `migration_pending` until it is. Tests: 68 → 73 (a fake Stripe HTTP server on localhost, no network: form encoding + webhook
signatures; saved card only via a checked SetupIntent, duplicate card merged and detached, hold with `hold-<trip>-1` / version header / quote + 20%,
capture key and amount, tip on its own PaymentIntent, refunds fare-then-tip to their own PaymentIntents with GST on the fare part, adjusted invoice,
dashboard refund recorded once and replays ignored; decline and bank-check refused plainly with nothing left behind, booked trip held at release,
declined at release → cancelled and told, lapsed hold (webhook) → fresh charge, failed payment → ops list → rider pays later; webhook secret/signature/
tolerance, disputes open → closed, unknown events; `MOCK_CARDS=test` refuses card payments for real accounts, demo/test accounts keep test cards,
top-up and Pass replays charge once, default/remove cards, cancellation-fee invoice with NDIS number). Browser smoke: Payment screen in test mode (add
test card, remove dialog) and "coming soon" mode (no card option on the booking screen), no page errors.
- API: `services/payments.ts` rewritten (Stripe client, idempotency keys, `holdForTrip`/`charge`/`collect`/`capture`/`refund`, customers, SetupIntent
  check, detach, card modes, `verifyWebhook`/`signWebhook`); new `services/stripeEvents.ts` and `routes/payments.ts` (webhook with raw-body parser);
  `services/trips.ts` (`placeHold`, `collectCard`, `retryTripPayment`, `payError`, `releaseBooking` in the tick, hold released if a booking fails,
  fees without a hold charged, settle via `collectCard`, tip via `charge`); `routes/rider.ts` (cards, default, delete + detach, top-up/Pass with
  `Idempotency-Key`, `POST /trips/:id/pay`, receipt); `routes/admin.ts` (refund split, `retry-payment`, `payments/issues`, integrations); `config.ts`
  (`stripe.*`, `mockCards`), `.env.example`.
- Rider app: Payment screen — Stripe Payment Element add-card (Stripe.js from js.stripe.com, `confirmSetup` with `redirect: 'if_required'`), make
  default, remove with a confirm dialog, expiry shown, test card in test mode, "Card payments are coming soon" when off (top-up hidden), top-up sends an
  Idempotency-Key; booking screen hides the card option when off (starts on credit) and says booked trips are held 15 min before pickup; Tours get a
  DingoGo credit option; receipt shows refunds, net total and GST, invoice number, NDIS number, "issued on behalf of your driver" with the driver's
  ABN, and a "Pay now" box when a card payment failed. Admin: payments table with provider ref and dispute/row statuses, "Retry charge" on failed
  trips, Reports → Payment problems (failed payments, open disputes, Stripe/webhook/card-form status), labels for the new events.
- Behaviour changes to note: **without Stripe, in production (`OTP_DEV_MODE` not true) only seeded demo numbers and admin-made test accounts can pay by
  card** (everyone else gets 402 `cards_not_available` and "coming soon"; set `MOCK_CARDS=all` to keep the old free-for-all mock); booked card trips are no
  longer held at booking (held at release; `payment_status` stays `none` until then); card capture rows have provider `stripe`/`mock` instead of `card`;
  admin refunds may write two rows (fare and tip parts); refunds take GST only off the fare part; receipt title "Tax Invoice (adjusted)" after refunds;
  payment methods list default first.
- Deploy: apply migration 014 before setting `STRIPE_SECRET_KEY`. To go live with Stripe set `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`,
  `STRIPE_WEBHOOK_SECRET`, and in the Stripe dashboard add the endpoint `https://<domain>/api/payments/stripe/webhook` with events
  `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`, `charge.dispute.created`,
  `charge.dispute.updated`, `charge.dispute.closed`. Optional: `MOCK_CARDS` (see above), `STRIPE_API_VERSION`, `STRIPE_TIMEOUT_MS`,
  `STRIPE_WEBHOOK_TOLERANCE_S`. Existing mock saved cards (`pm_test_…`) are ignored once Stripe is on; riders add a real card. No data fix.

Deferred:
- Native PaymentSheet in the Capacitor apps (Stripe's native SDK plugin; Elements in the WebView works for now but Apple/Google Pay need native) and
  Apple Pay / Google Pay in Elements (needs domain verification) — turned off in the Payment Element for now.
- On-session bank checks (3-D Secure) during booking: off-session holds that need a check are refused with "add the card again"; the SetupIntent does
  the bank check when the card is saved, which covers most cases. Full on-session confirm needs a "pending payment" trip state.
- Stripe calls still run inside the trip's database transaction (row lock held during the HTTP call, ≤15 s timeout). Idempotency keys make it safe; a
  two-phase "intent then record" outbox would shorten lock times at scale.
- Driver ledger reversal when a tip is refunded (DingoGo currently funds tip refunds; drivers keep 100% of tips) — needs an owner decision.
- Receipt PDF/email delivery and adjustment notes as separate numbered documents (the invoice shows refunds inline today); ATO wording to be checked by
  the accountant (the invoice is issued on the driver's behalf with both ABNs).
- Stripe Connect payouts to drivers (payouts stay manual bank transfers from the ledger).

Ideas for next rounds:
- Stripe Connect Express for drivers: automatic weekly payouts from the ledger, driver ABN/bank details collected by Stripe (removes bank numbers from
  our database), with the earnings floor and lease deductions as transfers/reversals.
- Rider "payment needed" gate: block new card bookings while a trip's payment has failed (with a clear path to pay), and ops reminders after 3 days.
- Emailed tax invoices (PDF) on completion and on refund, plus a monthly statement for riders with an NDIS number.
- Payments reconciliation report: Stripe balance transactions vs DingoGo `payments` per day (fees, refunds, disputes), CSV for the accountant.
- Run the Stripe fake in CI and add a `stripe listen`-based manual test script for the coordinator with test keys.

### Round 9 — notifications and communications
Scan: read `services/notify.ts`, every `notify`/`sendSms` call site, push token registration, the broadcast, `PATCH /me` marketing flag, the rider/driver
trip screens and the Capacitor configs. Found: push never worked (apps never registered a token; the server only knew Expo's service while Capacitor
gives FCM tokens and the PWA would need Web Push); Twilio calls had no timeout, no error handling, no log and no way to use a sender ID or Messaging
Service; wording was spread over 30 call sites; no notification settings (only one marketing tick box, no consent record, no STOP handling, promo
broadcast only in-app); rider and driver phone numbers are masked (good) but there was **no way at all** for them to reach each other (the driver app
even says "Deaf rider: send a message" with nothing to send it with); phone-booked riders (often no smartphone) got no updates; the broadcast awaited
every rider one by one.

Suggested:
1. [add] One place for wording: `src/lib/messages.ts` holds every SMS, push and inbox message (title, body, SMS text, category, SMS kind essential /
   transactional / marketing); every call site uses it; GSM-7/UCS-2 segment count; test: no emoji, SMS ≤ 2 segments (sign-in code 1), sender named.
2. [fix] SMS production-ready: Twilio client with timeout, Messaging Service SID or sender (number or alphanumeric "DingoGo"), `TWILIO_API_BASE` for
   tests, Twilio errors handled (21610 unsubscribed → opt-out recorded), delivery log `comms_log` (template key and last 3 digits only — never the text,
   so no sign-in codes or PINs), opted-out numbers get no non-essential texts.
3. [add] Push production-ready: FCM HTTP v1 (service account → OAuth, RS256, cached) for Android, Web Push (VAPID ES256 + RFC 8291 aes128gcm) for the PWA,
   Expo only for Expo tokens; dead tokens removed; `DELETE /me/push-token` on sign-out; `/public/config` gives the VAPID key. Apps: shared `enablePush()`
   (native only when the APK has Firebase, `VITE_FCM_ENABLED`; PWA via a push-only service worker).
4. [add] Notification preferences: `GET/PUT /me/notification-prefs` (push per category: trip, chat, account, documents, offers; texts for trip updates;
   safety always on); `notify()` honours them; phone-booked trips get texts for "driver on the way", "driver here" and "no drivers".
5. [add] Marketing consent (Spam Act): kept apart from service messages; consent records (given/withdrawn, the wording shown, source, IP, time) from
   `PATCH /me`, prefs, STOP; SMS broadcast only to opted-in, not-opted-out riders, identifying DingoGo with "Reply STOP to opt out", from a number that
   takes replies; signed Twilio inbound webhook handles STOP / START / HELP (STOP also covers non-users such as parcel recipients).
6. [add] In-app chat during a trip: `GET/POST /trips/:id/messages` (poll with `after`, `peek`, idempotent `client_id`, quick replies per role, while
   live and 30 min after drop-off, 20 per 5 min, ops read and can write as DingoGo); realtime `message.new`; push to the other side, collapsed per trip.
7. [add] Masked calls/texts through a Twilio relay number (`TWILIO_RELAY_NUMBER`): `GET /trips/:id/contact`; signed voice webhook bridges the caller to
   the other party with the relay as caller ID; texts to the relay land in the trip chat and are passed on; chat to a phone-booked rider is texted from
   the relay. Not configured → chat only.
8. [add] Apps: chat sheet on the rider and driver live trip with quick replies and an unread badge (polling-friendly), Call button when the relay is on,
   notification settings (rider Account → Notifications, driver Profile) with "Turn on notifications"; push token removed at sign-out.
9. [add] Admin: trip drawer shows the trip chat and texts sent; broadcast by app or SMS with the Spam Act rules; integrations list SMS replies, relay, FCM,
   web push. `GET /me/export` adds messages, consents and preferences (APP 12). Docs.
10. [fix] Broadcast sends in bounded parallel batches (one-by-one awaits with push network calls could pass the 30 s serverless limit).

Done (all 10). Migration: `services/api/migrations/015_comms.sql` (column `users.notification_prefs`; tables `marketing_consents`, `sms_opt_outs`,
`trip_messages`, `comms_log`; additive, IF NOT EXISTS). Before it is applied: settings use the defaults (saving push/text choices says
`migration_pending`, the offers opt-in itself still saves), chat answers 503 `migration_pending` and the apps hide the Message button, texts and
notifications still go (no log, no opt-out list; STOP is still answered). Tests: 73 → 83 (new `test/messages.test.ts`, no DB/network: every
template renders without emoji, texts GSM-7 and ≤ 2 parts, sign-in code 1 part, segment maths, typographic swaps, STOP/START/HELP keywords,
Twilio signature, TwiML escaping, RFC 8291 Web Push round trip with a browser-side decrypt, VAPID ES256 verified, prefs merge/safety/consent rules;
e2e with a fake Twilio/FCM/Web Push server on localhost: chat quick replies, replay-safe sends, read receipts, `after` cursor, strangers 404, ops
read/write, rate limit, 30-min close, export; Twilio sender ID, log without the code, 21610 → opt-out → transactional skipped but essential sent,
webhook 403/503, STOP/START/HELP with consent records and non-users; relay: phone booking gets PIN and "on the way" texts, masked call both ways,
no-trip call, rider text → chat via SMS, driver reply → text from the relay, ops comms list; push: FCM with a verified service-account JWT, Web
Push decrypted, dead tokens removed, settings honoured, safety always, offers need consent, trip texts by choice, SMS broadcast needs a reply
number and skips STOP numbers, sign-out removes the token, public config/integrations; everything still works with the Round 9 tables renamed away).
Browser smoke (Playwright, phone size): rider opens Message, quick reply and typed message, driver sees the unread badge and toast, replies with a quick
reply, rider sees it and "Read"; notification settings save; axe 0 violations on the rider chat dialog, driver chat sheet, rider settings and driver
Profile; no page errors.
- API: new `src/lib/messages.ts` (all wording, categories, SMS kinds, `smsSegments`, `gsmFriendly`, consent wording), `src/services/sms.ts` (Twilio
  client, opt-outs, `comms_log`, keywords, signatures, TwiML), `src/services/push.ts` (FCM v1, Web Push, Expo, dead tokens, VAPID keys),
  `src/services/prefs.ts` (settings, `pushAllowed`, consent records, `setMarketing`), `src/services/chat.ts` (thread, quick replies, read receipts,
  relay forwarding, `tripForPhone`, `contactFor`), `src/routes/comms.ts` (chat, contact, settings, `DELETE /me/push-token`, Twilio SMS/voice
  webhooks with a scoped form parser); `services/notify.ts` rewritten (`send` by template with settings and trip texts, `sendSmsT`, `notify` options
  `inbox`/`tag`); every call site in `trips.ts`, `admin.ts`, `rider.ts`, `auth.ts`, `docExpiry.ts`, `earningsFloor.ts` moved to templates; `routes/auth.ts`
  (consent on `PATCH /me` and deletion, export additions); `routes/admin.ts` (broadcast by app/SMS in batches, trip drawer `messages`/`comms`,
  integrations); `routes/public.ts` (`push`, `comms`); `config.ts` (`twilio.*`, `push.*`); `scripts/vapid-keys.ts` (`npm run vapid`); `.env.example`.
- Shared: new `Chat.tsx` (`useTripChat` polling hook with client ids and optimistic sends, `ChatThread`), `push.ts` (`enablePush`/`refreshPush`/
  `disablePush`/`pushState`; native only with `VITE_FCM_ENABLED`), `NotifySettings.tsx`; chat and badge styles in `brand.css`.
- Rider app: live trip "Message <driver>" with unread badge and spoken "New message", Call button when the relay is on, chat dialog; Account →
  Notifications → settings (offers consent moved there from Profile); push re-registered quietly on start, removed at sign-out; push-only `sw.js`.
  Driver app: Message/Call row on the live trip (Call hidden for Deaf riders), chat sheet with "pull over before you type", toast + buzz on a new
  message; Profile → Notifications; push refresh/sign-out; `sw.js`. Admin: trip drawer Messages, "Texts and calls" and "Message rider and driver"
  as DingoGo; Broadcast "Send as" app or text with the exact text shown; Reports shows text/push status; labels.
- Behaviour changes to note: the parcel recipient text lost its em dash (was sent as 3 UCS-2 parts, now 1–2 GSM parts); referral bonus and tip notices
  are category `account` (referral was `promo`, so riders without offers consent never saw it); offers (`promo`) are no longer put in the inbox of
  riders who haven't opted in (they weren't sent before either, except the referral); riders who booked by phone now get trip texts; `POST
  /admin/broadcast` returns `{ sent, skipped }`; the rider Profile no longer has the offers tick box (it's in Notification settings); Expo push only for
  Expo tokens.
- Deploy: apply migration 015. **Env vars (all optional, features stay off without them):** Twilio — `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
  `TWILIO_FROM` (or `TWILIO_MESSAGING_SERVICE_SID`), `TWILIO_MARKETING_FROM` (a +61 number for offers by text, if `TWILIO_FROM` is a sender ID),
  `TWILIO_RELAY_NUMBER` + `TWILIO_WEBHOOK_BASE_URL=https://dingogo-steel.vercel.app/api` (needed for webhook signatures; set the relay number's Voice
  webhook to `…/api/comms/twilio/voice` and every DingoGo number's Messaging webhook to `…/api/comms/twilio/sms`, both POST). Push —
  `FCM_SERVICE_ACCOUNT` (Firebase service-account JSON or base64) and, for the Android builds, `google-services.json` in `apps/*/android/app` plus
  `VITE_FCM_ENABLED=true` in the Android workflow (without both the apps never call native push, so the current APKs can't crash);
  `WEB_PUSH_VAPID_PUBLIC_KEY`/`WEB_PUSH_VAPID_PRIVATE_KEY` from `npm run vapid -w services/api` (`WEB_PUSH_SUBJECT` optional). No data fix.

Deferred:
- iOS push: Capacitor on iOS hands out APNs tokens, which FCM can't use; needs Firebase Messaging in the iOS app (or a direct APNs client) and an Apple
  key. Tokens tagged `ios` are tried on FCM and dropped if refused.
- Twilio Proxy: chose a single relay number (simpler, no extra Twilio product, one number for all trips because the caller's own number picks the
  trip). Limit: a rider calling from a number that isn't on their account isn't recognised (the app says so). A pool of numbers per trip would lift it.
- Delivery receipts (Twilio status callbacks into `comms_log`) and an ops "resend PIN" button: the log records "sent to Twilio", not "delivered".
- Chat translation and voice input; moderation/word filter (messages are kept and visible to ops; the 20/5 min limit stops floods).
- Retention job for `trip_messages`/`comms_log` (12 months suggested) — belongs with the Round 2 retention idea; needs the privacy policy updated.
- Quiet hours for non-urgent pushes (documents/account): reminders already run 8 am–8 pm only.

Ideas for next rounds:
- Ops comms console: SMS from the SOS incident drawer (welfare check, logged on the timeline), "resend parcel PIN", delivery status via Twilio callbacks.
- SMS booking for riders without smartphones ("RIDE <pickup> to <drop-off>" to a DingoGo number → quote → YES), building on the inbound webhook and
  phone-booking texts; an Elder can be booked and tracked by a carer.
- Driver "arriving in 2 minutes" automatic message from GPS distance, and a "can't find you" flow that sends the rider's pin photo/landmark.
- Privacy retention job (messages, comms log, GPS tracks, OTP and rate events) with admin-visible schedule and policy text.
- Notification analytics for ops: push reach (devices per user, last success), texts per day and cost, STOP rate per campaign.

### Round 10 — operability and resilience (fresh-database bootstrap, safe migrations, health, logs, errors)
Scan: the live database was lost (Supabase project deleted). Read `scripts/migrate.ts`, `scripts/seed.ts`, `src/db.ts`, `src/vercel.ts`, `src/index.ts`,
every migration, the Vercel build, the Dockerfile, CI, the shared API client and the apps' offline bars. Found: the only way to set up a database was
`db:setup` = migrations + **demo** data (fictional drivers, cafés, promo codes, demo accounts that accept 000000, roof screens on); without the demo seed a
fresh database had no NT zone, no fares and no admin, so nobody could sign in to fix it; `db:reset` drops `public` on whatever `DATABASE_URL` points at
(no guard against a production URL); migrations run only from a machine with direct DB access (the Vercel bundle doesn't even contain the SQL files) and
the runner has no lock (two runners can apply the same file); Supabase exposes `public` tables to the `anon`/`authenticated` roles over its REST API
and no table had RLS; `/health` says only "ok"; logging is off unless `LOG_LEVEL` is set, there are no request ids, raw `console.error` everywhere and
no error reporting; a dropped database gives "Service is starting up" on Vercel and a bare 500 elsewhere, a missing table (migration lag) is a 500; the
apps show the same generic error for "our database is down" as for any other failure, and the driver app drops a queued tap on a 503.

Suggested:
1. [add] `npm run db:bootstrap`: all migrations, database security (RLS on every `public` table, Supabase `anon`/`authenticated` locked out, optional
   least-privilege API role with grants and policies), a prod-safe base seed (zones, fare rules, jurisdictions, settings with roof screens off, plans,
   public holidays, tours) and the first admin from `BOOTSTRAP_ADMIN_PHONE`; demo data only with `DEMO_DATA=true`; idempotent; `--check` reports only.
2. [add] One migrator with a transaction-level advisory lock (safe through the Supabase pooler, safe when several instances start at once), used by
   `db:migrate`, `db:bootstrap` and `AUTO_MIGRATE=true` at cold start (Vercel and the long-running server); statement timeout; a failed migration is
   rolled back and recorded while the API keeps serving; migrations bundled into the Vercel function. A fresh empty database also gets the base seed.
3. [add] `GET /health/deep`: database latency, schema version, pending and unknown migrations, last auto-migrate result, RLS coverage, base data present,
   integrations configured (no secrets); summary for anyone, details for admins or `HEALTH_TOKEN`; 503 when the database is down.
4. [add] Structured logging: JSON (pino) with a request id per request (honours a valid `X-Request-Id`, else Vercel's id, else a UUID; echoed back), one
   line per request with the route pattern (no query strings, tokens or share links), auth headers redacted, `request_id` in 500 bodies; every
   `console.error` moved to the logger.
5. [add] Error reporting hook: `SENTRY_DSN` (Sentry envelope API over fetch, no SDK, no personal data, request id and route as tags) for unhandled 500s,
   dispatch tick and background failures and unhandled rejections; off without the DSN.
6. [fix] Database down / schema lag: connection failures are 503 `db_unavailable` with `Retry-After` (was 500, or "starting up" on Vercel), a missing
   table/column is 503 `migration_pending`; health endpoints still answer on Vercel when the database is unreachable.
7. [add] Apps: shared service status from 503s — rider, driver, admin and partner show "DingoGo is having a problem on our side" (rider: "In an
   emergency call 000"), reads retry on 503, the bar clears when a request gets through; the driver outbox keeps taps on a 503 and replays them.
8. [fix] Guards on destructive scripts: `db:reset` and the demo seed refuse a non-local database unless explicitly allowed.
9. [add] Backups: `npm run db:backup` (pg_dump custom format; JSON export per table when pg_dump isn't installed) and `docs/OPERATIONS.md` (bootstrap a new
   Supabase project, restore, auto-migrate, health checks, logs, Sentry, backup schedule); README, API.md, `.env.example`; CI bootstraps a fresh database.

Done (all 9). No migration this round (no schema changes; the security step is code that runs after migrations). Tests: 83 → 90 (new
`test/ops.test.ts`, on its own scratch databases created and dropped by the test so it runs alongside the e2e file: bootstrap of an empty database —
every migration, base data values (fares, roof screens off, SA hidden), no demo rows, admin by env with audit row, RLS on every table, `anon`/
`authenticated` refused, API role reads/writes but can't create or drop tables, re-run inserts nothing and keeps admin edits, demo-number and
invalid admins refused, an existing rider promoted; migrator — four concurrent runners apply each file once, a held lock → busy, a broken migration
rolled back whole and later files not run, `lock_timeout` 55P03 instead of queueing behind a reader; AUTO_MIGRATE + `/health/deep` — summary vs
details (admin token, `X-Health-Token`, wrong token), pending migration listed, applied once per process with RLS on the new table, failed
migration → degraded + reported + still serving; AUTO_MIGRATE on a brand-new database through `MIGRATION_DATABASE_URL` → schema, RLS, base data and
admin; logging — request id honoured/replaced/echoed, one JSON line per request with the route pattern, no share token/query/bearer in any line,
500 with `request_id`, Sentry envelope with tags and stack and no token, `db_unavailable` 503 with Retry-After, `migration_pending` 503 for a missing
table, errors outside requests reported, DSN parsing; the Vercel entry in a child process with an unreachable database → 503 `db_unavailable` with
request id, `/health/deep` 503 "down"; scripts — `db:reset` and demo seed refuse a Supabase URL, bootstrap CLI with `DEMO_DATA=true` + `--check`,
JSON backup with manifest, pg_dump backup readable by owner only and listable by pg_restore). Also checked by hand: the built Vercel function
(`.vercel/output/functions/api.func`, migrations bundled) pointed at an empty database with `AUTO_MIGRATE=true` migrates, secures and seeds it on
the first request and `/api/health/deep` reports `ok`; shared API client with a fake fetch (reads retried 3 times on `db_unavailable`, writes
not retried, service state false → true, 500 message carries "(ref …)").
- API: new `src/lib/migrator.ts` (advisory-locked runner, `schemaStatus`, `isLocalDatabase`), `src/lib/dbSecurity.ts` (`applyDbSecurity`,
  `securityStatus`), `src/lib/baseSeed.ts` (`seedBase`, `baseDataStatus`), `src/lib/bootstrap.ts` (`bootstrapDatabase`, `autoMigrateOnce`,
  `lastAutoMigrate`), `src/lib/log.ts` (pino logger, `requestId`, `safePath`, `reportError`/`logError`, Sentry envelope client, `setErrorReporter`),
  `src/routes/health.ts` (`/health/deep`, `integrationStatus` now shared with `/admin/integrations`); `src/index.ts` (logger + LogController,
  request ids, per-request line, `isDbDown`/`isSchemaLag` → 503s, 500 with `request_id` + report, auto-migrate and crash handlers in the long-running
  server); `src/vercel.ts` (health answered when the DB is down, clear 503 with request id, auto-migrate at cold start); every `console.error` moved
  to `logError`/`log.warn` (push failures are warnings, not error reports); `config.ts` (`ops.*`); scripts `bootstrap.ts`, `backup.ts`,
  `migrate.ts` (shared runner, `--status`, reset guard), `seed.ts` (base data from `seedBase`, demo extras only, non-local guard, demo detection by
  the demo admin row); `package.json` (`db:bootstrap`, `db:status`, `db:backup`, pino); Dockerfile runs bootstrap before start;
  `scripts/build-vercel.mjs` ships the migrations with the function.
- Shared: `api.ts` (service state, `isTemporary`, read retries on `db_unavailable`, "(ref …)" on 500s), `hooks.ts` (`useServiceUp` with a /health
  check every 20 s while down), new `ServiceNotice.tsx`, `brand.css`. Rider: notice under the offline bar ("In an emergency call 000"), live trip
  keeps showing with "DingoGo is having a problem on our side. Showing your trip as it was …". Driver: signal bar says so and counts saved taps; the
  outbox keeps taps on 503 `db_unavailable`/`migration_pending`. Admin: notice in the console, Reports → System health (status, schema version and
  pending, base data, RLS, auto-migrate, Sentry). Partner: notice.
- Docs: new `docs/OPERATIONS.md` (bootstrap a new Supabase project step by step, the no-DB-access path via AUTO_MIGRATE, optional API role,
  migrations, health, logs, Sentry, backups and restore, checklist before deleting anything); API.md "Operations (Round 10)"; README; `.env.example`.
- Behaviour changes to note: the API now logs JSON at `info` in production/Vercel (one line per request); 500 bodies include `request_id`; database
  connection failures are 503 `db_unavailable` (were 500) and missing tables/columns 503 `migration_pending` (were 500); the Vercel "Service is
  starting up" message is now "DingoGo can’t reach its database right now"; `/admin/integrations` adds `error_reporting`; `db:setup`/`db:seed` and
  `db:reset` refuse non-local databases without `DEMO_DATA=true` / `ALLOW_DB_RESET=yes`; the demo seed counts as "already loaded" only when the demo
  admin exists (a bootstrapped database can take demo data on top); a fresh database's roof screens start `off` (demo turns them on); CLI
  migrations give up on a table lock after 10 s (`MIGRATE_LOCK_TIMEOUT_MS`).
- Deploy: no migration, no required env vars. To rebuild the lost database: `npm ci`, then `MIGRATION_DATABASE_URL=<Supabase session pooler URL>
  BOOTSTRAP_ADMIN_PHONE=<mobile> npm run db:bootstrap` (check with `-- --check`); in Vercel set `DATABASE_URL` (transaction pooler), `AUTO_MIGRATE=true`,
  `BOOTSTRAP_ADMIN_PHONE`, `HEALTH_TOKEN` (and optionally `SENTRY_DSN`), redeploy, check `/api/health/deep` with `X-Health-Token`. Without direct DB
  access: just the Vercel variables — the first request bootstraps the empty database. Uploaded files and admin edits from the old database are gone.

Deferred:
- Restoring from the JSON export (only pg_dump/pg_restore is a real restore path): a loader would need table order, sequences and bytea handling;
  pg_dump is available everywhere Postgres is.
- Scheduled off-site backups (GitHub Action running `db:backup` nightly to an encrypted bucket): needs a bucket, an encryption key and a secret for
  the database URL in GitHub — the coordinator's call; documented the schedule instead.
- Uploads still live in Postgres (`bytea`), so a lost database also loses driver documents; moving them to Supabase Storage/S3 (Round 2 deferral)
  would at least keep them out of the database's blast radius.
- OpenTelemetry tracing / metrics (request latency histograms, pool saturation): logs carry `ms` per request for now.
- Running the e2e suite as the least-privilege API role (it renames tables in a few tests, which only the owner can do); the API's runtime queries
  were checked for DDL (none).

Ideas for next rounds:
- Nightly backup GitHub Action (pg_dump → age/GPG-encrypted → private bucket, 7/4/12 retention) plus a monthly restore drill into a scratch
  database that runs `db:bootstrap -- --check` and a smoke sign-in.
- Uptime and alerting: a `/health/deep` monitor (Better Stack / UptimeRobot) with the token, and an ops push/SMS to the admin when it turns
  `degraded` or `down` (also when auto-migrate fails).
- Uploads to Supabase Storage with presigned URLs (removes bytea from backups and the database, keeps documents if the database is lost).
- Privacy retention job (still open from Rounds 2 and 9): purge OTP/rate events, old GPS tracks, chat and comms logs on a schedule shown in admin.
- Admin "maintenance mode" switch (read-only banner and bookings paused with a clear message) for planned database work.
- Run `scripts/a11y-check.mjs` and the ops tests in CI with a Postgres service (CI already runs `npm test`, which now includes the bootstrap tests).

### Round 11 — courier and delivery business
Scan: read the parcel booking schema and `createTrip`, dispatch/accept/arrive/start/complete for couriers, `settle`, the share-link tracking
endpoint, the driver app's courier screens, the rider booking form, the website prohibited-items page and business accounts. Found: no way to send
several parcels with one driver (a pharmacy round meant N separate bookings, N drivers, N booking fees); scheduled pickups were a single time;
parcel weight never checked against the size (25 kg allowed on a Small) and recipient numbers never checked as mobiles (the PIN text silently
failed for landlines); the prohibited-items "check" was one tick box that didn't match the website list; "leave it" had no place to say where, and
the recipient couldn't see where it was left; recipients got no ETA; **a parcel that couldn't be delivered had no path at all** (in-progress
trips can't be cancelled, so it was stuck until ops intervened); no business dashboard or bulk booking; latent: a card charged afresh at settle
(lapsed hold) left the original hold on the card; `/driver/trips/active` took an arbitrary live trip.

Suggested:
1. [fix] Parcel validation: weight within the size (S 5 / M 15 / L 25 kg), recipient must be an Australian mobile, sender any Australian number
   (stored +61), declared value ≤ $1,000, signature and safe place exclusive; prohibited-items checklist (every line, keys shared by API, rider app
   and website, stored with a version), old single tick still accepted.
2. [add] Safe place and handover location: `safe_place` text, recipient-visible photo of where it was left (signed link on the tracking page),
   `pod_distance_m` recorded and a `delivery_far_from_address` flag for photo-only drops > 400 m away; sender's own reference (`customer_ref`).
3. [add] Scheduled pickup windows (30 min–4 h): released at the window start, searched until it closes, shown on offers, tracking and the
   booking text to the recipient.
4. [add] Recipient ETA text at pickup (`parcel_on_way`, cumulative for runs) and tracking page with ETA, outcome, where it was left, and a form for
   the recipient to add a note or safe place (not for signature parcels, not after the driver has been; per-IP limit).
5. [add] Failed delivery → return to sender: driver "Couldn't deliver" with reasons/note/photo, parcel `returning` with a return fee (courier policy,
   50% of the trip fare, min $5, paid to the driver less the fee), sender and recipient texted, return handover needs name + signature/photo,
   one-tap "Book another try" for the sender (once).
6. [add] Multi-drop runs: one pickup, 2–10 drops, nearest-first order, later drops priced on the leg with no base fare/booking fee ($6 minimum),
   offered once with the whole run's pay, all drops assigned/arrived/collected together, delivered one by one, returns last; releases and pickup
   no-shows apply to the whole run; engaged time not double counted for the earnings floor.
7. [add] Business deliveries: `GET /business/deliveries` (managers see the account, members their own) with summary and CSV export (no phones);
   CSV import with per-row errors (dry run first; nothing booked if any row is wrong) booked as runs of up to 10.
8. [add] Apps: rider booking form (checklist, weight, reference, safe place, pickup window), trip screen (outcome, run, ETA, "Send it again"),
   new Business deliveries screen (list/filters/CSV, run form, CSV import); driver offer (run, window), live trip (run chip, parcels to collect,
   recipient notes, safe place, "Couldn't deliver" sheet, return to sender stage and handover, "Next: …" after each drop); website tracking page;
   admin trip drawer (reference, run, window, safe place/notes, outcome, failure photo, handover distance) and labels.
9. [fix] Settle releases the original card hold when the fare is charged afresh; the driver's active trip is chosen in run order; docs.

Done (all 9). Migration: `services/api/migrations/016_courier_business.sql` (new table `courier_batches`; columns `trips.batch_id/batch_seq/
pickup_window_end`, `parcels.customer_ref/safe_place/recipient_notes/prohibited_checklist/eta_at/outcome/failed_*/returned_at/pod_distance_m`;
indexes; additive). Before it is applied (`lib/courierSchema.ts` checks once a minute): single parcels, tracking, dispatch, ETA texts and earnings
work as before; runs, windows, returns and recipient instructions answer 503 `migration_pending`; `/public/config` `courier.runs: false`.
Tests: 90 → 100 (courier rules unit test — sizes, mobiles, checklist incl. shared list in step, CSV parser and row errors, drop order, pickup-time
text, window search; parcel booking validation and stored fields; pickup window release/search; multi-drop run pricing, single offer, whole-run
accept/arrive/start, ETAs and texts, no batch on share links; failed delivery → return fee → run continues → return handover → driver pay → credit
→ engaged time once → re-attempt once; recipient safe place/notes, signature refusal, photo drop shown signed, far-drop flag; business dashboard
scopes, CSV export without phones, CSV import errors/dry run/booking; run release and pickup no-show; everything with the 016 columns renamed away).
- API: new `src/lib/courier.ts`, `src/lib/courierSchema.ts`, `src/services/courier.ts`, `src/routes/business.ts`; `services/trips.ts`
  (`precheck`/`insertTrip`/`createRun`/`quoteRun`, run-aware dispatch/accept/arrive/start/complete/release/cancel/location, windows in the tick,
  returns at completion, hold release in settle); `routes/driver.ts` (`delivery-failed`, run offers, active ordering), `routes/rider.ts`
  (`parcelSchema`, `reattempt`), `routes/public.ts` (parcel tracking, instructions, `courier` config), `lib/messages.ts` (5 templates; render keeps
  texts GSM-7), `services/earningsFloor.ts` + driver earnings (engaged time).
- Shared: new `courier.ts` (checklist wording, size limits, fail reasons, outcome labels); website prohibited-items page uses it.
- Behaviour changes to note: landline recipient numbers and over-weight parcels are refused (400); rides/existing apps unchanged; recipients now get a
  second text at pickup (ETA); a returned parcel's invoice includes "Return to sender"; card trips charged afresh no longer leave the hold behind.
- Deploy: apply migration 016 (AUTO_MIGRATE does it at cold start). No env vars. Optional setting `courier_policy` (defaults in code). No data fix.

Deferred:
- One card hold per run (each drop holds its own amount today; fine in mock mode and small runs, but ten holds on one card in Stripe mode is noisy).
- Route optimisation beyond nearest-neighbour (OSRM trip/TSP endpoint) and re-ordering drops on the road; drivers deliver in the booked order.
- Admin editor for `courier_policy` (generic settings PUT works; no form yet) and ops "reassign one drop" from a run.
- Geocoding CSV addresses beyond the local place list (needs a geocoder key); rows without a match need lat/lng.
- Pharmacy rules (S4/S8 medicines: signature + ID check, no safe place) — needs pharmacist/AHPRA advice before encoding.
- Partner-portal view for businesses without app logins; driver app offline queue for "Couldn't deliver" (needs signal today).

Ideas for next rounds:
- Business accounts self-service: invite staff, manager/member roles, monthly spend limits enforced, statement PDF with each delivery and proof.
- Recurring deliveries (weekly pharmacy round, community food parcels) from a saved run template, and a scheduled "run" view for ops.
- Proof-of-delivery pack: emailed/SMS link to the sender with photo, signature and time; dispute handling for "not received".
- Return-to-depot option for parcels after hours (DingoGo office holds it) and a second-attempt slot chosen by the recipient from the tracking link.
- Driver app: native photo capture with compression and an offline queue for POD photos and failed-delivery reports.

### Round 12 — community and cultural fit, inclusion
Scan: read the rider booking/trip/account screens, the driver Drive/Profile screens and cancel reasons, `PATCH /me`, place search, business accounts and
phone bookings, the fare engine, the website footer/About page and the seed. Found: the language picker offers "Arrernte" as `arr` (that ISO 639-3 code
is Karo, a Brazilian language; Mparntwe Arrernte is `aer`) and the API accepts any 8-character language; no translation mechanism at all; the
Acknowledgement of Country is only on the website footer; place search knows "Simpsons Gap (Rungutjirba)" as one string and can't find Ntaripe,
Untyeyetweleye or Tjoritja; nothing in the apps for low-literacy riders; community organisations, health services and NDIS providers can only book
parcels on their account — a ride for a client means ops phone bookings with no record of the client's consent and no way for the client to withdraw
it; no concession pricing; a driver called away to Sorry Business who cancels an accepted trip is counted as a repeat canceller and keeps getting paper
reminders; the About page calls an all-electric fleet "our goal" in words the ground rules avoid.

Suggested:
1. [add] Languages: one community-reviewable translation file (`packages/shared/src/i18n/strings.json`) with English as the default and the source,
   Eastern/Central Arrernte (`aer`) and Kriol (`rop`) entries kept minimal and every one marked `draft` ("needs community review") — anything missing
   falls back to English; a `t()` helper; rider language picker with a visible "draft, needs community review" note; `npm run i18n:review` writes a
   CSV for reviewers; test checks English covers every key and no non-English entry is marked reviewed without a reviewer.
2. [fix] `users.language` only takes `en`, `aer`, `rop` (legacy `arr` → `aer`); `/public/config` lists languages with their review status.
3. [add] Simple mode for riders (plain words + icons + audio): Account switch (kept in the profile), Ride screen with two big picture buttons (Ride /
   Parcel), short words, extra options tucked away, a "Hear it" button that reads the booking out (en-AU voice); live trip reads every status change
   aloud and shows a big picture status card.
4. [add] Community/organisation accounts book rides for clients with consent: new account kinds (Aboriginal corporation, health service); client consent
   records (who gave it, how — verbal/written/standing — when, expiry, withdrawn); `POST /business/rides` books for a client only with current consent,
   texts go to the client, the organisation sees only trips it booked (client shown by first name, phone last 3); clients see and withdraw consent in
   the rider app; audited; in the data export.
5. [add] Concession / community pricing, admin-configurable and off by default: rider applies with card type, last 4 digits and expiry (no full numbers);
   admin approves; approved riders get a "Concession" fare line (percent, cap per trip, chosen services), funded by DingoGo (driver pay unchanged).
6. [add] Sorry Business and cultural leave for drivers: "Take leave" (Sorry Business, cultural business, family) pauses the driver without penalty —
   offline, no offers, paper reminders paused, "I'm back" ends it; cancelling an accepted trip for Sorry Business passes it to the next driver and is
   never counted as a cancellation or flagged; ops see "On leave" (kind kept private to ops).
7. [add] Acknowledgement of Country in the rider, driver, admin and partner apps (shared component, wording from the strings file).
8. [add] Dual place names: places carry their Arrernte name (Mparntwe, Ntaripe, Untyeyetweleye, Rungutjirba, Anthwerrke, Atherrke, Alhekulyele,
   Tjoritja…), search finds either name, results show both, sacred sites carry a respect note.
9. [fix] About page wording (electric fleet is the goal, not "all-electric"); README/API.md.

Done (all 9). Migration: `services/api/migrations/017_community.sql` (new table `client_consents`; columns `users.concession`, `drivers.leave`;
additive, IF NOT EXISTS). Before it is applied (`lib/community.ts` `communityReady()` checks once a minute): languages, place names, simple mode,
acknowledgement and the Sorry Business cancel reason all work (the trip is passed on and not counted, just no leave saved); concession fares stay
off, client bookings, concession cards and leave answer 503 `migration_pending`, `/me/consents` is empty. Tests: 100 → 105 (languages: strings file
has English for every key and every Arrernte/Kriol entry is `draft` unless a reviewer and date are named, `/public/config` statuses, `arr` → `aer`,
bad language 400, dual-name search both ways with the sacred-site note; concession fares off by default → admin-only validated settings, audited →
rider sends last 4 only, pending gives nothing → approved gives a capped "Concession (−50%)" line with `trip_cents` and levy unchanged, parcel
services excluded, expired card stops it, engine maths; organisation bookings: plain business account and non-members refused, confirm and mobile
required, client texted and audited, duplicate consent 409, quote and booking as the client with `channel: org`, no PIN or full phone in the response,
client trip texts, client sees the trip and consent, members see only their own bookings and managers the account's, cancel by booker, client
withdraws → `consent_required`, expired consent refused, export lists consents; Sorry Business: leave refused mid-trip, cancel passes the trip on with
the offer `released`, no flags (even with an assistance animal), not counted in `cancelled_7d`, driver offline and on leave, no note stored, ops list,
no paper reminders on leave, going online ends it, app leave and "I'm back"; everything with the 017 table and columns renamed away).
`messages.test.ts` covers the three new templates (GSM-7, ≤ 2 texts).
- API: new `src/lib/community.ts` (languages, concession rules/`concessionFor`, account kinds, consent methods, leave kinds, `NO_FAULT_CANCEL_REASONS`,
  `communityReady`), `src/routes/clients.ts` (client consents and rides), `src/routes/community.ts` (admin community pricing, concession queue, drivers
  on leave, languages); `lib/fares.ts` (`concession` line), `lib/places.ts` (Arrernte names, sacred-site note, accent-free search), `lib/messages.ts`
  (`client_consent_recorded`, `ride_booked_for_you`, `concession_reviewed`); `services/trips.ts` (concession in `buildQuote`, Sorry Business not a
  fault in `releaseTrip`/`cancelTrip`, `channel: org`), `services/notify.ts` + `services/chat.ts` (org bookings get trip texts and relay texts like
  phone bookings), `services/docExpiry.ts` (no reminders on leave); `routes/driver.ts` (`/driver/leave`, `sorry_business` reason, online ends leave),
  `routes/auth.ts` (language enum, `concession`, `/me/concession`, `/me/consents`, export, account `kind` on `/me`), `routes/public.ts` (config),
  `routes/admin.ts` (`community_pricing` setting validated).
- Shared: new `i18n/strings.json` + `i18n.ts` (`t`, `isDraft`, `langIsDraft`, `normaliseLang`), `Acknowledgement.tsx` (`Acknowledgement`,
  `Words`, `DraftNotice`), `speak.ts`; Acknowledgement on the shared sign-in screen (every app); icons `volume`, `heart`.
- Rider: Profile — Simple mode switch, language picker (English, Arrernte draft, Kriol draft) with the draft notice, concession card form/status;
  Account — Organisations (see and stop), Book for clients (community accounts), greeting in the chosen language marked draft, Acknowledgement; Ride —
  simple mode (two big picture buttons, short words, "Hear it" reads the booking); Trip — simple mode big status card and spoken status changes; place
  search shows the sacred-site note; new `screens/Clients.tsx` (clients with consent, add client with confirm, book/price/cancel a ride, rides list).
  Driver: cancel sheet "Sorry Business or family" (never counts, pauses you), Drive "Take leave" sheet and on-leave banner with "I'm back", Profile
  Acknowledgement. Admin: Pricing → Community (concession rules + card queue with approve / not approved), Drivers "On leave" chip, account kinds
  Aboriginal corporation and health service, Acknowledgement in the console. Website: "Our goal is an electric fleet" (was "all-electric").
- Behaviour changes to note: `PATCH /me` language must be `en`/`aer`/`rop` (old `arr` saved as `aer`, other values 400); `/me` returns `language`
  normalised and `concession`; place search labels for Simpsons Gap / Emily Gap now read "Rungutjirba (Simpsons Gap)" / "Anthwerrke (Emily Gap)"
  and more places are listed; `channel: org` trips get trip texts; `corporate_accounts` on `/me` include `kind`.
- Deploy: apply migration 017 (AUTO_MIGRATE does it at cold start). No env vars. Concession fares stay off until admin → Pricing → Community is
  switched on. To let an organisation book for clients, set its account type (admin → Business) to Community organisation, Aboriginal corporation,
  Health service, NDIS plan manager or Government and add its staff as members. No data fix.

Deferred:
- Translating the rest of the app: needs Arrernte and Kriol speakers (paid, credited) and a review session; only the greeting and the town name are
  drafted, everything else falls back to English. Audio recordings by community speakers (instead of the phone's English voice) belong with it.
- Warlpiri, Pitjantjatjara, Luritja and other languages of Central Australian riders: add once a speaker is engaged (the file and picker take more
  languages without code changes in the apps' `t()`).
- Organisation staff tracking a client's live trip (share link to the carer) and booking parcels/runs for clients: consent wording for location
  sharing needs legal review first.
- Concession checks against Centrelink (CCS/PCA online verification needs a Services Australia agreement); the admin check is manual for now.
- Community/elder "free rides" budgets per organisation (monthly cap paid by a grant) — needs an owner decision on funding and reporting.
- Map tiles with dual names: OpenStreetMap tiles show what's mapped; a custom label layer would need a commercial tile provider.

Ideas for next rounds:
- Community review workflow in admin: reviewers sign in, see each draft with English beside it, suggest/approve, and approved words publish to the
  apps without a release (strings from the API with the bundled file as fallback).
- Carer view: an organisation or family member follows a client's or Elder's trip live (time-limited link, consent recorded), with arrival texts.
- SMS booking for riders without smartphones ("RIDE <from> to <to>"), with organisation bookings and simple mode wording (still open from Round 9).
- Cultural safety for drivers: optional cultural awareness module in onboarding, "men's/women's business" trip preference handled like women-driver
  matching, and sacred-site drop-off guidance on tours.
- Community grants reporting: trips, kilometres and spend per community organisation per month (CSV for funders), concession use by card type.

### Round 13 — website, SEO and growth
Scan: read every website page, `index.html`, `meta.ts`, the estimator, the Vercel build and Caddyfile, the public API routes (driver applications,
config), the admin applications tab, the rider sign-in/referral code and share text, and built the site to look at its output. Found: the site is a
single `index.html` for every path, so crawlers and link previews (which don't run JavaScript) see the home page's title and description on every
page, there's no canonical URL, `og:image` is a relative 512 px square (Facebook/LinkedIn/WhatsApp need an absolute ~1200×630 image), no sitemap,
no robots.txt, no structured data, and `/track/<token>` pages are indexable; the 338 KB mascot PNG is downloaded for a 36 px header logo on every
page; every page is in the main bundle (QR code library included); Google Fonts are discovered only after the CSS bundle downloads (`@import`);
the fare estimator can't be shared or linked to and "Book this ride" drops the places chosen; no landing pages for airport or hospital trips;
driver applicants get "we'll call you" and nothing else (no reference, no way to see where they're up to), the admin has four free-text statuses
and no funnel counts or source; referrals exist only as a code typed at sign-up (no invite link, nothing on the website explains it); no analytics.

Suggested:
1. [add] Per-page SEO: one page list (`apps/web/src/seo.ts`) with title, description, canonical path and structured data; the build writes each
   public page as its own HTML file with those tags in the head (canonical, Open Graph with an absolute 1200×630 image, Twitter large card), so
   crawlers and link previews see the right page; `useMeta` keeps them in step in the browser; `noindex` on tracking, status, invite and 404 pages.
2. [add] `sitemap.xml` and `robots.txt` generated from the same list at build time (apps, API and private links disallowed; sitemap linked).
3. [add] Structured data (JSON-LD): `TaxiService` + `LocalBusiness` for DingoGo (Alice Springs area, phone, hours, price range), `FAQPage` from
   one FAQ data file shared by the Help page, home and landing pages (visible text and markup always match), `BreadcrumbList` on inner pages.
4. [fix] Page speed budget: mascot as WebP at the sizes shown (header mark and hero), new 1200×630 social image, every page except Home in its own
   chunk, the QR library loaded on demand, fonts preconnected and requested from the HTML head, image width/height set; a budget check after the
   build (entry JS and per-image limits) that fails the build when exceeded.
5. [add] Fare estimator with shareable links: `/fares?from=…&to=…&service=…` restores the trip, "Share this price" copies/shares the link;
   "Book this ride" hands pickup, drop-off and service to the rider app, which pre-fills them (after sign-in too).
6. [add] Landing pages for airport transfers (`/airport`) and hospital and clinic trips (`/hospital`), each with a preset estimator, what to
   expect, FAQ and structured data; FAQ sections added to parcels, tours and business pages from the shared FAQ file.
7. [add] Driver recruitment funnel: each application gets a reference and a private status link (`/drive/status/<token>`) showing its stage
   (received → we've called → paperwork → approved / not right now / withdrawn) with a note from the team; the applicant can withdraw; admin sets
   stage + note, sees counts by stage and by source; applicant texted on a stage change (when SMS is set up); first-visit source (utm/referrer
   host) recorded. Migration 018; old behaviour without it.
8. [add] Referral programme visibility: `/invite/<code>` landing (code checked by a rate-limited public endpoint that reveals nothing about the
   referrer), rider app takes `?ref=` into the sign-up form, the rider's "Share code" sends the invite link, "Bring a friend" on home and Rewards.
9. [add] Privacy-friendly analytics behind config: Plausible-compatible script only when `VITE_ANALYTICS_DOMAIN` is set, cookie-free, honours Do
   Not Track, tokens and codes stripped from paths, a few named events (Book, Share price, Driver application, Call); privacy policy says so.

Done (all 9). Migration: `services/api/migrations/018_growth.sql` (columns `driver_applications.ref/status_token/public_note/source/drive_state/
updated_at` + unique token/ref indexes and a status index; additive, IF NOT EXISTS). Before it is applied (`lib/growth.ts` `applicationsReady()`
checks once a minute): the Drive form still takes applications (no reference or link), status links answer 503 `migration_pending`, admin stages
still save (no note, no funnel by source). Tests: 105 → 114 (e2e: application gets a `DA-` reference and status link, applicant texted, status page
shows first name/stage/steps only (no phone, email, message or source), admin list hides the token and has funnel counts by stage and source, bad
stage 400, stage + note → texted and audited, withdraw once, declined path, wrong tokens 404 and limited per IP; referral check valid/invalid
without referrer details, misses limited per IP, sign-up with the invite code links the friend; everything with the 018 columns renamed away. New
`test/website.test.ts`: page list unique/sane/no private paths/no "all-electric", head tags with canonical + absolute 1200×630 image + JSON-LD types
(LocalBusiness, WebSite, TaxiService, Service, FAQPage, BreadcrumbList) and filled placeholders, noindex pages without canonical/JSON-LD/token,
HTML escaping, sitemap/robots, analytics path redaction, fare/booking link round trip and validation, FAQ fill). `messages.test.ts` covers the two
new templates. Also checked in a headless browser: `/fares?…` restores the trip and service, prices it and builds the rider hand-off link; `/airport`
has its title and 3 JSON-LD blocks; `/invite/…` is noindex; Help shows 11 FAQs.
- API: new `src/lib/growth.ts` (stages, steps, `publicApplication`, `cleanSource`, `applicationsReady`); `routes/public.ts` (application with
  reference/link/text, status, withdraw, referral check); `routes/admin.ts` (applications list with funnel, validated stage + note + text);
  `lib/ids.ts` (`applicationRef`), `lib/messages.ts` (`driver_application_received`, `driver_application_update`).
- Website: new `src/seo.ts` (page list, head tags, JSON-LD, sitemap, robots, analytics paths), `src/faqs.ts`, `src/analytics.ts`,
  `src/attribution.ts`, `components/Faq.tsx`, pages `Fares`, `Landing` (airport, hospital), `Invite`, `DriveStatus`; `meta.ts` renders the same tags
  at runtime; `vite.config.ts` plugin prerenders 18 pages + `app.html` + sitemap/robots and enforces the budget (entry JS 110 KB gz, CSS 20 KB gz,
  images 120 KB; now 72.6 KB / 8.8 KB); every page except Home lazy-loaded; QR library on demand; mascot PNG (338 KB) → WebP 4 KB mark / 38 KB hero;
  `og-1200.jpg` 71 KB replaces the 512 px `og.png`; fonts preconnected and requested from the HTML; estimator "Share this price" and booking
  hand-off; Drive form reference + status link + "Already applied?"; FAQs on Help/Home/Parcels/Tours/Business from one file; nav "Fares", footer
  links; privacy policy "Our website" paragraph. `scripts/build-vercel.mjs`: routes for prerendered pages, `app.html` fallback, cache headers for
  `/assets/` and sitemap/robots; `deploy/Caddyfile` likewise.
- Shared: new `handoff.ts` (place/trip link format, `saveHandoff`/`takeHandoff`), `Login` `initialReferral`. Rider: `main.tsx` keeps `?from/to/
  service/ref` through sign-in, Ride screen pre-fills them, sign-up pre-fills the friend's code, Rewards "Share code" sends the invite link.
  Admin: application stages (Received … Withdrawn), reference and source, note for the applicant, 90-day funnel line.
- Behaviour changes to note: unknown and private website paths now get `app.html` (noindex) instead of the home page's HTML; `PATCH
  /admin/applications/:id` only takes the six stages (old values `new/contacted/onboarding/declined` are among them); applicants are texted on
  application and stage changes (when Twilio is set up); `og.png` is gone (`og-1200.jpg`); website "Book this ride" links carry the trip.
- Deploy: apply migration 018 (AUTO_MIGRATE does it at cold start). Optional Vercel env vars: `VITE_SITE_URL` (set it when a custom domain such
  as dingogo.com.au goes live, so canonical/sitemap use it), `VITE_ANALYTICS_DOMAIN` (+ `VITE_ANALYTICS_SRC`/`_API` for self-hosted Plausible) to turn
  analytics on. `PUBLIC_WEB_URL` on the API must be the website's address (status links in texts). Submit `/sitemap.xml` in Google Search Console.

Deferred:
- Full server-side rendering of page bodies (only the head is prerendered; Google renders the JavaScript, other crawlers get the right title,
  description and structured data). Needs a hydration-safe render of each page and the config fetched at build time.
- Self-hosting the fonts (would remove two third-party origins and the render-blocking stylesheet): needs the font files and licence check
  (both are OFL) and a change to `brand.css` that every app shares.
- Per-page social images (one image for all pages today) and a `Review`/`AggregateRating` markup — no genuine reviews yet; never fake them.
- Driver application documents upload from the status page (applicants still upload in the driver app after signing in).
- A CSP header for the website (Round 2 deferral) now also needs the analytics origin when it is on.

Ideas for next rounds:
- Server-render or statically render page bodies (Vite SSR at build) for faster first paint and full content without JavaScript.
- Self-host fonts with `font-display: swap` + `<link rel=preload>` for the two used weights; drop the Google Fonts origins from every app.
- Driver application status page: checklist of NT paperwork with links and the ability to upload documents before getting the app.
- Referral leaderboard/rewards for community champions, and partner-café QR posters that open `/invite/CODE` or `/fares` with the café preset.
- Search Console / Bing Webmaster verification via env meta tags, and a weekly SEO check in CI (sitemap reachable, no noindex on public pages).

### Round 14 — safety and trust
Scan: read the SOS routes (rider and driver), the route-deviation check, `watchDrivers`, the go-online checks, the block switch and sign-in, uploads,
the rider trip/SOS screens and Safety page, the driver Drive/ActiveTrip/Profile screens, the admin Safety page and the website safety/privacy pages.
Found: only one emergency contact, texted only on rider SOS; no way to share a trip with family automatically (night trips) or by text; the
route-deviation "Is everything OK?" push had no answer path and nobody followed up if the rider didn't respond; nothing noticed a car stopped for a
long time mid-trip; no record of time online, so no fatigue limits at all; no check that the person driving is the account holder; safety problems
could only be raised as a free-text support ticket with no category, severity, evidence or follow-up; blocking was a bare switch with no reason,
no end date and no appeal, and a blocked person's sign-in *succeeded* and handed back a token that then failed on every request (the app looked
broken); driver SOS wasn't on the trip timeline and texted nobody; the SOS screen didn't help the person tell 000 where they were.

Suggested:
1. [add] Trusted contacts (up to 5) with automatic trip sharing — off / night trips (admin night window, Darwin time) / every trip — when the driver
   accepts; "Text my contacts" during a ride (3 a trip); SOS texts every trusted contact plus the emergency contact.
2. [add] Ride check-ins ("Are you OK?") with "I'm OK" / "Get help": raised by route deviations (replacing the plain push) and by ops; "Get help" or no
   answer within `answer_min` raises an SOS alert into the existing incident view/runbook and texts the rider's contacts; late answers noted.
3. [add] Long-stop detection: a ride in progress stopped (within 150 m) for `long_stop_min` with a fresh signal, away from pickup and drop-off → check-in
   and ops alert (not tours or multi-drop runs; silent phones stay the driver-silent alert's job).
4. [add] Driver fatigue limits, admin-configurable: online sessions recorded; 12 h online then a 6 h rest, a 20-minute break after 5 h (defaults,
   to be checked against NT/SA guidance); warned 30 min before; offline when over a limit but never mid-trip (straight after `complete`); going
   online refused with the time they can return; admin hours list.
5. [add] Driver photo check before going online (off by default): `photo_review` (ops queue next to the last approved photo and licence) or
   `face_match` behind `FACE_MATCH_URL` (falls back to review); fresh selfie only, not reused; not accepted → offline, can't go online.
6. [add] Safety reports with categories and severity, private photo evidence (own uploads only), 10 a day; critical reports (sexual misconduct,
   assault) put the other person on hold at once unless they're mid-trip (ops told); ops list/detail/notes/status/outcome, reporter told.
7. [add] Account standing and appeals: suspend (optionally until a date; lifts itself) / ban / warning / lift with reason codes, a reason shown to the
   person and a private note; the old block switch is recorded; restricted sign-in returns 403 `account_restricted` with the reason and a 1-day
   appeal-only token; one pending appeal; admins uphold or overturn (overturn lifts); texts on each step.
8. [add] Emergency card for 000: street address (reverse geocoder behind `REVERSE_GEOCODE_URL`) or nearest landmark with distance and direction,
   GPS in decimal and DMS, the car and rego spelled out, the trip; "Read it out"; NT Police, 1800RESPECT and Lifeline numbers; in rider and
   driver SOS screens.
9. [fix] Driver SOS on the trip timeline and texting the driver's contacts a map link to the car (never the rider's trip link); women's safety review:
   1800RESPECT offered on critical/harassment reports and in the app, holds on critical reports, women-preferred and reporting explained in the rider
   Safety page and on the website; privacy policy lists trusted contacts, reports, time online and photo checks.

Done (all 9). Migration: `services/api/migrations/019_safety.sql` (columns `users.trusted_contacts`, `users.auto_share`; tables `safety_checks`,
`driver_online_sessions`, `identity_checks`, `incident_reports`, `account_actions`, `appeals`; additive, IF NOT EXISTS). Before it is applied
(`lib/safety.ts` `safetyReady()`, re-checked once a minute): trips, SOS (emergency contact texted), the route-deviation notice, going online, the
block switch and the emergency card work as before; a blocked account gets 403 `account_restricted` without an appeal token; the new endpoints
say `migration_pending` or return empty lists; the safety tick does nothing. Tests: 114 → 123 (pure fatigue maths for breaks, daily limit and
long rest, policy validation, night window, contact de-duplication; trusted contacts validation, night/always auto-share on accept, on-demand
limit, SOS texts every contact, driver SOS timeline + map-link-only text via the fake Twilio; long stop asked once, OK closes it, moving car not
asked, no answer escalates to an SOS + contact texts + incident view, late OK noted, route deviation and "Get help", ops check-in, switched off;
fatigue warning once, offline after the trip with `fatigue_rest` until rested, tick takes an idle driver offline at the daily limit, admin list,
limits off, admin-only validated policy; photo check off by default, needed/own/fresh/not reused, private, review reject → offline and blocked,
approve, daily, face match approve/poor match/provider down; reports validation, own evidence only, private signed evidence, critical hold deferred
mid-trip then immediate, ops status/outcome/notes, reporter told, reporter's view has no subject details, driver general report, daily limit;
restrict/appeal: admin-only, not yourself, end dates only for suspensions, reason shown but not the private note, appeal token not a sign-in
(HTTP and socket), appeal once, overturn lifts, suspension ends by itself at sign-in, ban/lift/warning, block switch recorded, standing history,
export; emergency card landmark/direction/GPS/DMS/car/driver/geocoder/other people's trips; everything with the 019 tables and columns renamed away).
`messages.test.ts` covers the 11 new templates (GSM-7, ≤ 2 texts, no emoji).
- API: new `src/lib/safety.ts` (policy + validation, `fatigueStatus`, night window, contacts, categories, reasons, support numbers, `safetyReady`),
  `src/services/safety.ts` (sharing, check-ins, long stops, sessions + fatigue, photo checks + face match, restrict/lift/auto-lift, emergency card,
  `runSafetyChecks` in the dispatcher tick every `SAFETY_TICK_S`), `src/routes/safety.ts`; `auth.ts` (scoped appeal token, `verifyToken` refuses
  scoped tokens), `routes/auth.ts` (restricted sign-in, export, deletion clears contacts), `routes/driver.ts` (online block, sessions, SOS fix,
  fatigue after complete), `routes/rider.ts` (SOS texts all contacts), `routes/admin.ts` (block switch recorded, `safety_policy` validated),
  `services/trips.ts` (check-in on deviation, auto-share on accept, tick), uploads `selfie`/`evidence` (private), `lib/messages.ts`, `config.ts`.
- Shared: new `Safety.tsx` (`EmergencyCard`, `TrustedContacts`, `SafetyReportForm`, `MyReports`, `Restricted`); `Login` shows the restricted screen
  with the appeal form. Rider: trip "Are you OK?" banner (polls + realtime, buzz, read out in simple mode), "Text my contacts", emergency card in SOS,
  "Report a safety problem" on trips, Account → Safety (contacts, auto-share, reports, women riders). Driver: fatigue line and rest notice on Drive,
  photo-check sheet (front camera) on go-online, emergency card in SOS, Profile → Safety (contacts, report, my reports), "Report" on trips. Admin:
  Safety tabs Reports (drawer), Check-ins and hours, Photo checks, Appeals, Policy; account Standing drawer (from Settings → Users and reports); trip
  drawer "Ask Are you OK?"; event labels. Website: safety page items, privacy policy.
- Behaviour changes to note: a blocked account's sign-in is now 403 `account_restricted` (was 200 with a useless token); scoped JWTs are refused as
  sign-ins; route deviation sends "Are you OK?" with an answer (was "Is everything OK?"); fatigue limits are ON by default (drivers online 5 h
  without a 20-minute break, or 12 h, are set offline after their trip); SOS texts trusted contacts too and the response has `contacts_texted`; SOS
  texts use the first name; uploads accept purposes `selfie` and `evidence`.
- Deploy: apply migration 019 (AUTO_MIGRATE does it). No env vars required; optional `FACE_MATCH_URL`/`FACE_MATCH_KEY`/`FACE_MATCH_TIMEOUT_MS`,
  `REVERSE_GEOCODE_URL`, `SAFETY_TICK_S`. Owner to confirm the fatigue defaults against NT/SA guidance (admin → Safety → Policy) and decide on photo
  checks (off) before switching them on. No data fix.

Deferred:
- A real face-match provider and liveness check: needs a vendor choice, a privacy impact assessment (biometric information is sensitive information
  under the Privacy Act) and consent wording; the API contract and fallback are ready.
- Automatic hold of a reported person who was mid-trip once the trip ends (ops get `incident.hold_deferred` and do it from Standing): wants a small
  "pending hold" state so it can't be forgotten.
- Rider-side "women rider" preference for women drivers (match women drivers with women riders): needs a self-declared, checked rider attribute
  and owner/legal sign-off (Sex Discrimination Act exemptions); not built.
- Check-ins on courier trips and tours (stops are normal there) and a night-time "arrived safely?" check after drop-off.
- Native background GPS (still from Round 3): long-stop detection needs pings while the driver is in Google/Apple Maps; with a paused app it falls
  back to the driver-silent alert.

Ideas for next rounds:
- "Pending hold" for reported people on a live trip, and a safety-lead staff role (Round 7 idea) who can hold, ban and decide appeals.
- Audio recording opt-in during trips (stored encrypted, released only to the safety team on a report), with clear consent wording.
- Safety dashboard: reports per 1,000 trips by category, check-in answer rates, fatigue offlines per week, appeal outcomes; monthly CSV for the
  NT regulator.
- Trusted contacts get a text when the trip ends ("arrived safely") and can reply HELP to raise an alert (Twilio inbound already exists).
- Driver-facing rider verification for night pickups (rider photo or ID check on first night trip) and a "this rider's PIN didn't match" report.
- Run the safety tick on a schedule (Vercel cron hitting a protected endpoint) so check-in escalation doesn't depend on app traffic.

### Round 15 — consolidation: cross-feature money bugs, tech debt, test depth and a browser smoke test in CI
Scan: read the money paths end to end (quote → hold → settle / cancel fee / refund / courier return / redispatch / driver release), business
accounts and statements, concessions, the dead-code and duplicate list (exports nobody imports, VIN decoders, size → service maps), the route list
against `docs/API.md`, env vars against `.env.example`, every migration re-run on a migrated database, and the Vercel bundle in serverless mode.
Found: a business account's **monthly limit was never enforced** (admin form, list and website all promise it; seeded demo account has one); refunds
on business trips weren't on the monthly statement (the account was invoiced in full) and the statement's default month was UTC (the first 9.5 hours
of each month showed last month); account fields went straight into the table (`discount_pct: 150`, any `kind`, any ABN) while `ACCOUNT_KINDS`
sat unused; a DingoGo-credit trip whose route grew took the extra from credit **below zero** (the return fee had been guarded in Round 11, the
route change wasn't); a late-cancel fee could be more than the trip cost (a $1 levy-only trip after a promo, or a free Pass delivery: $3 fee, credit
negative); concession cards expired at 9:30 am Darwin (UTC date); `finalFare()` was dead and described a different rule from what completion did;
settlement matched the route-change line by exact label (a renamed line would silently stop paying the driver); two `S/M/L → service` maps; three
copies of the VIN decoder (API, admin, driver) with different year rules; 3 undocumented routes and 8 env vars missing from `.env.example`;
migrations 001–010 aren't re-runnable (011+ are; nothing checked it); no browser test of any app.

Suggested:
1. [fix] Business account monthly limit enforced at booking (rider, org, phone and run bookings): 402 `account_limit_reached` with what is left;
   used = this Darwin month's completed trips + late-cancel fees + live/booked quotes − refunds; account row locked while checking.
2. [fix] Business statements: refunds shown as credits with net total and GST, limit used/left; default month in Darwin time (statement and
   charging); admin account fields validated (kind from `ACCOUNT_KINDS`, discount 0–50%, ABN 11 digits with spaces allowed, limit, terms).
3. [fix] DingoGo credit: route-change extra taken only from credit that's left (rest waived, driver paid what was charged); late-cancel fee never
   above the trip's price (`fee_waived: 'capped'`).
4. [fix] Concession card expiry on the Darwin date (fare and `PUT /me/concession`).
5. [fix] Money-path tech debt: `TripMoney`/`FareBreakdown` types on hold/collect/release/settle/return fee; pure `routeChangeExtra`,
   `returnFeeCents`, `cancelFeeCharged`, `pointsEarned`, `gstOf` replace inline maths and the dead `finalFare`; shared line-label constants
   (settlement matches by prefix); one size → service map; one VIN decoder for the admin and driver apps in `packages/shared/src/vin.ts`.
6. [add] Unit tests for the pure money logic: fare parts, min fare, night/holiday/demand, discount order and caps, points, Pass, tours, levy and
   fuel after discounts, route change, return and cancel fees, driver pay and fee basis, pickup pay, floor weeks, concessions and local dates.
7. [add] Drift tests: every registered route is in `docs/API.md`, every env var the API reads is in `.env.example`; migrations numbered with no
   gaps and 011+ additive and re-runnable. Fixed what they found.
8. [add] Browser smoke test (`scripts/smoke-e2e.mjs`, `npm run smoke`): Playwright drives the built rider, driver and admin apps against the
   bundled serverless API (dispatch on requests, polling) — driver online, rider books, driver accepts/arrives/starts with the rider's PIN/completes,
   rider sees the finished trip, admin approves the waiting car; fails on page errors or 5xx; added to CI with screenshots on failure.

Done (all 8). No migration this round. Tests: 123 → 138 (`money.test.ts` 10 unit tests, `docs.test.ts` 2, ops: migrations re-runnable, e2e:
business limit/statement/refund/field validation, credit route change + capped cancel fee), plus the 5-step browser smoke run (not part of
`npm test`; needs `node scripts/build-vercel.mjs` and a freshly seeded database).
- API: `lib/fares.ts` (pure helpers, `FareBreakdown`, label constants; `finalFare` removed), new `lib/tripTypes.ts`, `services/trips.ts`
  (`checkAccountLimit`, `accountMonthCents`, `localMonth`, wallet route change, capped cancel fee, typed money functions, `sizeService` from
  `SIZE_SERVICE`), `services/courier.ts`, `routes/admin.ts` (statement, account validation, Darwin months), `lib/community.ts` (`localDate`),
  `routes/auth.ts`, `.env.example`.
- Apps: admin Business statement shows refunds, net total and the limit used/left (Darwin month); admin/driver `rules.ts` re-export the shared
  VIN decoder. Shared: `vin.ts`.
- Docs/CI: `docs/API.md` (Round 15 section; `/health/routing`, `/admin/languages`, `/driver/identity-check` listed), README (test count, smoke),
  OPERATIONS (smoke test, which migrations are safe to paste twice), `.github/workflows/ci.yml` (Vercel build, Playwright 1.63 installed without
  touching the lockfile, fresh seed, smoke, screenshots artifact), `.gitignore`.
- Behaviour changes to note: bookings on a business account over its monthly limit are refused (402) — the demo account has a $3,000 limit; live
  accounts with a limit set start being enforced on deploy; a late-cancel fee is at most the trip's price; credit-paid route changes can be part
  waived; statements net off refunds; the admin account form rejects a discount over 50% or a bad ABN.
- Deploy: no migration and no env vars. Before deploying, check live business accounts' `monthly_limit_cents` (admin → Business accounts) are
  what the customers agreed — they become hard limits. CI needs nothing new (Playwright is installed in the job).

Deferred:
- Shared wording for every label (admin `DOC_TYPE` vs driver `DOC_LABEL`, event labels in admin vs rider): the wording differs on purpose per
  audience in places; needs a copy decision before one table. Only the VIN logic was merged.
- Removing `any` beyond the money paths (`one()` returns `any`; route handlers use `any` rows): wants generated row types from the schema.
- Night loading, holidays and statement months use Darwin time for SA too (Adelaide is 30 min behind, 1 h ahead in summer): SA is hidden; needs a
  time zone per jurisdiction when it launches.
- Dingo Points earned are not taken back on refunds, and the driver ledger isn't reversed (owner decision, as in Round 8).
- `scripts/a11y-check.mjs` in CI: it expects dev servers; it could reuse the smoke server (static build + bundled API) — next round.

Ideas for next rounds:
- Run `scripts/a11y-check.mjs` in CI on the smoke server, and grow the smoke run: courier (PIN delivery, failed delivery → return), business CSV
  import, partner redeem, rider cancel with fee, offline driver tap replay.
- Time zone per jurisdiction (Adelaide) for night loading, holidays, fatigue days, floor weeks and statement months before SA launches.
- Business account managers: spend against the limit in the rider app's Business screen, an 80% warning text/email, and a per-member cap.
- Refund policy as data: reason codes, optional points claw-back and driver-ledger reversal by reason (driver at fault), with the GST report.
- Generated TypeScript row types from the schema (`pg` introspection at build) to replace `any` rows in routes and services.
- Mutation-style checks on the money helpers (property tests: total = sum of lines, never negative, GST ≤ total/11) with fast-check.

### Round 16 — tax, compliance and reporting
Scan: read the GST summary, levy report and CSV exports (`services/reports.ts`, `routes/ops.ts`), the driver ledger and `settle`, the receipt,
`/driver/earnings`, driver profile/onboarding (ABN, GST), account deletion and data export, NDIS numbers on trips and organisation bookings, the
settings and the website privacy policy; checked the ATO's SERR page for the seller fields. Found: nothing a driver could hand to a tax agent
(earnings has a rolling "GST in your trip pay", not quarters) and no tax invoice from DingoGo for the fees it takes; no BAS figures for DingoGo itself
(the GST summary mixes the drivers' fares with DingoGo's own supplies); **no SERR report at all** — and we don't hold what it needs (legal names,
date of birth, address), ABNs are only checked for 11 digits; the levy report has no monthly return, due date or record of lodging, and SA is
CSV-only; no retention rules (GPS tracks, chat, comms log, OTP logs grow forever) although the privacy policy promises them; privacy requests
leave no record and a 30-day clock nobody watches; **account deletion always answered 500** (the audit insert used one parameter as both uuid and
text — the account was anonymised, the app showed an error) and left a deleted driver's bank account, licence number and address on the driver
row; a driver's data export had none of their driver data; NDIS numbers reach the receipt but there's no NDIS invoice or claim format.

Suggested:
1. [add] Driver tax details for SERR (migration 020): seller type (individual / company or trust), given and family name, date of birth, business
   name, address; ATO ABN check digits on every ABN a driver enters; what's missing shown to the driver (Profile → Tax, banner) and to ops.
2. [add] Driver quarterly GST statement (BAS worksheet: G1, 1A, G11, 1B, net GST; tips and other payments outside) as JSON/CSV/PDF, and a
   GST-inclusive tax invoice from DingoGo to the driver for the quarter's service fees and car lease (both ABNs); in the driver app.
3. [add] DingoGo's own BAS worksheet per quarter: own sales (service fees, lease, booking fees, levy, Pass, cancel-fee share) with GST, refunds as
   adjustments, fares collected on behalf of drivers kept apart, unregistered drivers flagged; CSV/PDF, audited.
4. [add] SERR report per half-year (due 31 Jul / 31 Jan): operator, one line per driver per activity (ride-sourcing / delivery) with every seller
   field, gross, GST, commission, activity dates, missing details; full bank details only in the audited CSV; missing-details list with reminders.
5. [add] Passenger levy monthly returns for NT (and SA, ready for later): trips by day, due date setting, PDF/CSV, lodgement recorded with a
   reference, 12-month list with overdue months.
6. [add] Record retention policy (tax records ≥ 5 years, can't be lowered) and a purge job (preview, run, optional daily) for GPS tracks, chat,
   comms log, notifications, sign-in and rate-limit logs, and deleted drivers' tax identities past their 5 years.
7. [add] Privacy (APP) request register: in-app export and deletion recorded automatically; requests by email/phone logged with a 30-day due date,
   overdue shown, outcome required to close, CSV.
8. [fix] Account deletion returns 200 (was 500); a deleted driver's tax identity is kept apart for 5 years (SERR stays complete) and bank,
   address, birth date, licence and authority numbers come off the driver row; the data export includes a driver's profile, papers, pay, trips and
   time online.
9. [add] NDIS invoices: one per participant per month (support item, GST code, bill to plan manager or participant, after refunds) as PDF/CSV, the
   NDIA bulk payment request file once DingoGo is registered, rider download; settings validated.
10. [add] Admin Tax & compliance page (overview with due dates; BAS, SERR, levy, NDIS, record keeping, privacy tabs), a dependency-free PDF writer,
    driver/rider screens, browser smoke steps; docs.

Done (all 10). Migration: `services/api/migrations/020_tax_compliance.sql` (columns `drivers.seller_type/given_name/family_name/date_of_birth/
business_name/address_line/suburb/postcode/address_state/tax_details_updated_at`; tables `levy_lodgements`, `privacy_requests`,
`retained_tax_identities`; additive, IF NOT EXISTS). Before it is applied (`lib/tax.ts` `taxReady()`, re-checked once a minute): statements, fee
invoices, BAS, SERR (every seller "Tax details (database migration 020 pending)"), levy returns, NDIS and retention work; name/birth date/address
saves, lodgements and the privacy register answer 503 `migration_pending`; deletion clears bank details only for drivers never paid and nothing is
retained apart. Tests: 138 → 154 (`tax.test.ts` 7 unit tests — ABN check digits, BAS quarters/due dates/FY labels, SERR halves, levy months, SERR
missing fields for individuals/entities/deleted, retention floor and purge dates in Darwin time, NDIS settings, driver BAS figures, PDF structure/
escaping/page breaks/repeated headers/xref; 9 e2e — tax details validation and missing list, driver statement equals the ledger in CSV/PDF and the fee
invoice, DingoGo BAS lines against the database, SERR totals equal every sales dollar in the period with masked/full bank details and reminders,
driver deletion retained → still reported → purged by retention while the ledger stays, privacy register, levy returns and lodgements incl. SA,
NDIS invoices/PDF/bulk claim/rider download, everything with the 020 columns and tables renamed away). Browser smoke: 2 new steps (driver Earnings
GST panel and Tax details; admin Tax page, every tab) — 7/7 pass.
- API: new `src/lib/tax.ts` (ABN check, periods, SERR fields, retention/NDIS rules, `taxReady`), `src/lib/pdf.ts` (A4 Helvetica writer: headings,
  wrapped text, rows, tables with page breaks), `src/services/tax.ts` (statements, fee invoice, BAS, SERR, missing details, levy returns and
  lodgements, retention + `runRetentionIfDue` in the dispatcher tick, privacy requests, retained identities, NDIS invoices and bulk claim),
  `src/routes/tax.ts`; `routes/auth.ts` (deletion fix + retained identity + privacy record; export with driver data), `routes/driver.ts`
  (`tax_missing`, ABN check digits, earnings GST includes cancel fees), `services/trips.ts` (tick), `scripts/seed.ts` (valid demo ABNs, one complete
  driver).
- Apps: admin `pages/Tax.tsx` (nav "Tax & compliance"), Reports links to it, `downloadFile`; driver `screens/Tax.tsx` (`TaxDetails` in Profile with
  a banner, `TaxStatements` in Earnings); rider Payment → NDIS invoices (last 3 months); shared `downloadFile`. Website privacy policy: retention,
  30-day answers, SERR for drivers. Docs: API.md (Round 16 section), OPERATIONS.md §8 (monthly/quarterly/half-yearly calendar), README count.
- Behaviour changes to note: `DELETE /me` returns 200 (was 500 after doing the work); driver ABNs must pass the ATO check (`PATCH /driver/me`, `PUT
  /driver/tax-details`); `/driver/earnings` `gst_on_fares_cents` includes cancellation fees; deleted drivers' bank/address/licence numbers are cleared;
  every export/deletion in the apps writes a privacy request row; nothing is purged until an admin runs retention or ticks "automatically".
- Deploy: apply migration 020 (AUTO_MIGRATE does it). No env vars. Then set DingoGo's real ABN/legal name in the `business` setting (base data says
  `TBC`), confirm with the accountant the GST model in the BAS worksheet, the NDIS support item/GST code, and the levy due day with the NT Government.

Deferred:
- SERR lodgement in the ATO's XML (SBR) schema: needs the Business Implementation Guide's exact element names and activity codes, and an SBR-enabled
  channel (software provider or machine credential); the CSV holds every field for the accountant's software today.
- ABN Lookup (ABR web service) to confirm a driver's ABN is active, GST-registered and in their name: needs an ABR GUID (free, by application).
- Emailing statements/invoices (and SMS link) on the first of the quarter: needs an email provider (none configured; SMS only).
- Business-account managers downloading NDIS invoices for their participants from the rider Business screen (admin and the participant can now).
- Taxable payments (TPAR) and PAYG: drivers are contractors under SERR, so TPAR doesn't apply to ride-sourcing; leave to the accountant.
- Driver-facing "keep a logbook" (car expenses, km) for income tax: useful but outside GST/BAS; the km are on the earnings screen.

Ideas for next rounds:
- ABR lookup on ABN entry (name match, GST status, cancelled ABNs) and a nightly re-check that flags drivers whose GST registration lapses.
- Quarterly "your BAS figures are ready" notice to drivers with the statement link, and a reminder 2 weeks before each due date to ops.
- SERR XML export per the ATO schema with a validator, plus a lodgement record like the levy one (reference, date, who).
- Business account statements as PDF tax invoices (same writer), including NDIS plan-manager statements across participants.
- Data-retention dashboard: table sizes and oldest rows per category, and an automatic run report emailed/texted to the owner.
- Privacy impact assessment checklist in admin for new features (face match, audio recording) with the policy text they need.

### Round 17 — rider growth and loyalty (points, tiers, promos, gift vouchers, partner cafés, win-back)
Scan: read the loyalty, rewards, referral, Pass, promo and voucher code (`routes/rider.ts`, `routes/partner.ts`, `services/trips.ts` quote/booking/
settle/cancel, `routes/admin.ts` promos/partners/vouchers), the rider Rewards screen, the partner portal and the admin Loyalty/Pricing pages.
Found: points never expire and the history is the last 30 rows with codes like `reward:Free coffee`; one earn rate for everyone; promo codes check
`uses < max_uses` before booking but add the use unconditionally (two riders at once overshoot a capped code), the per-rider limit has the same race,
no spending budget, no time-of-day/day/service/area rules, "first trip" codes work again while the first trip is still booked; **a prepaid voucher
card can be used before the shop has sold it** (a card taken off the counter is free money) and printed cards expire after 1 year (Australian
Consumer Law: gift cards sold to consumers need at least 3 years); no way to buy a voucher online or give one to someone without a phone; café
redemptions can be swapped for at a partner that has been switched off; the café's "this month" and settlement use the UTC month, and a change to
the café's rate reprices redemptions already served; no statements or paid record for cafés; referral points paid for a $0 trip, to blocked or
deleted referrers and without any cap; nothing brings back riders who stopped riding.

Suggested:
1. [add] Points expiry with warning: points stay while the rider is active; after `expiry_months` (12) with no points activity or trip they
   expire, but only once a warning has been sent at least `warn_days` (30) before; ledger row `expired`; balance history with labels, running
   balance, paging and "points safe until" date.
2. [add] Tiers by trips in the last 12 months (Member / Silver after 10 / Gold after 30, admin-configurable) with a points multiplier on what the
   rider earns; progress to the next tier in the app.
3. [add] Opt-in birthday and streak bonuses: birthday (month and day only) bonus once a year on the Darwin date; weekly streak bonus after N weeks
   in a row with a trip; both off until the rider turns them on.
4. [fix] Promo engine: use and budget taken with a conditional update (caps can't be overshot), per-rider limit under a lock, spending budget
   (discount capped at what's left), Darwin hours/days (off-peak), services, event area (pickup or drop-off within a radius), targeted codes only for
   granted riders, first-ride codes refused while another trip is live or booked; promo spend given back on cancel/no drivers.
5. [fix] Prepaid voucher cards: new shop batches must be sold at the counter before use (`needs_activation`); sold cards expire after at least
   3 years; partner rewards from switched-off partners can't be swapped.
6. [add] Gift vouchers bought online with the saved card (Stripe-ready, mock otherwise; idempotent), optional text to the recipient, printable
   card with QR code for people without phones; admin batches print QR cards too.
7. [add] Partner café portal: redemption stats (6 months, by reward, customers, repeat customers), monthly settlement statements (CSV/PDF) with
   the rate fixed when served and the Darwin month; admin marks a month paid with a reference, which the café sees.
8. [fix] Referrals: bonus only after a first trip that cost at least the minimum, not for blocked/deleted/test referrers, monthly cap per referrer;
   ledger rows linked to the trip.
9. [add] Win-back for lapsed riders: admin preview and send (app or text) to riders with marketing consent who haven't ridden in N days, at most
   once per period, optional targeted promo code granted to each; Spam Act footer as for offers.
10. [add] Admin: Loyalty → Programme settings and Win-back, settlements with "Mark paid", promo fields; rider Rewards screen; partner Stats and
    Statements; docs, tests.

Done (all 10). Migration: `services/api/migrations/021_loyalty.sql` (columns `promo_codes.budget_cents/spent_cents/services/hour_from/hour_to/days/
geo_lat/geo_lng/geo_radius_m/targeted`, `reward_redemptions.settlement_cents`, `gift_vouchers.needs_activation/purchased_by/from_name/
recipient_name/message/payment_ref`; tables `promo_grants`, `loyalty_profiles`, `loyalty_notices`, `partner_settlements`; additive, IF NOT EXISTS).
Before it is applied (`lib/loyalty.ts` `loyaltyReady()`, re-checked once a minute): bookings with promo codes (the conditional use update works
without it), tiers, referral rules, rewards, café redeem/stats/statements (current rate) and voucher batches work; promo rule fields, opt-ins, gift
vouchers, win-back, targeted grants and "Mark paid" answer 503 `migration_pending`; the scheduled run does nothing. Tests: 154 → 168
(`loyalty.test.ts` 6 unit tests — settings bounds, tiers and tier points, Darwin weeks/streaks across UTC midnight, birthdays incl. 29 Feb, expiry
dates, promo rules (hours over midnight, days, services, event area), promo spend from fare lines, ledger labels, gift-card expiry; 8 e2e — a capped
code booked by two riders at once is used once and given back on cancel, budget caps the discount and comes back; off-peak hours/days, services,
event area, targeted grants, field validation, first-ride code refused while a booking stands; tier multiplier, history labels and running balance,
warning before expiry and expiry only 30 days after it, birthday once, streak once and only when opted in, export; referral minimum fare, ledger
trip link, monthly cap, blocked referrer void; gift voucher idempotent purchase, text, 3-year expiry, spent by someone else, buyer list, shop cards
refused until sold, free cards usable at once; switched-off partner's reward refused, rate fixed when served, partner stats, statements with
paid month and reference, PDF/CSV, month open/already paid; win-back only to consenting lapsed riders, once per period, targeted code granted and
usable; everything with the 021 columns and tables renamed away). The existing ride test now expects points at the rider's tier.
- API: new `src/lib/loyalty.ts` (settings, tiers, Darwin helpers, promo rules, ledger labels, gift-card rules, `loyaltyReady`), `src/services/
  loyalty.ts` (`onTripCompleted`, `takePromo`/`givePromoBack`, summary/history, `runLoyalty`/`runLoyaltyIfDue`, win-back, partner stats and
  statements with CSV/PDF, settlements, `markPaid`), `src/routes/loyalty.ts`; `services/trips.ts` (`validatePromo` rules + first-ride fix, budget
  cap in `buildQuote`, per-rider lock and conditional use in `insertTrip`, promo given back via `givePromoBack`, redispatch retakes, `settle` →
  `onTripCompleted`, tick runs loyalty), `routes/rider.ts` (`/loyalty` summary, inactive-partner rewards, `voucher_not_sold`), `routes/partner.ts`
  (Darwin month, stored rate, stats, statements), `routes/admin.ts` (validated promo fields, vouchers `for_sale`/3 years, settlement month),
  `routes/auth.ts` (export and deletion), `lib/messages.ts` (`points_expiring`, `birthday_bonus`, `streak_bonus`, `gift_voucher`).
- Apps: rider Rewards — tier card with progress and "points safe until", bonus opt-ins (day/month only), gift vouchers (buy, text, list, printable
  QR card), paged history with balance; partner — stats (6 months, by reward, returning customers, codes waiting) and a Statements tab (PDF/CSV, paid
  reference); admin Loyalty — Programme (overview, settings, run now), Win-back, settlement by month with "Mark paid" and statement download,
  voucher batches "for sale" with QR cards; Pricing → promo budget/hours/days/services/event area/targeted with spend and rules columns. Admin app
  now depends on `qrcode` (already in the lockfile for the rider app).
- Behaviour changes to note: points expire after 12 months with no activity (only after a warning at least 30 days earlier); riders with 10+/30+
  trips in a year earn 1.25x/1.5x points; referral bonus needs a first trip of $5 or more and is capped at 10 a month per referrer (blocked/deleted
  referrers get nothing); new shop voucher batches don't work until sold and expire after 3 years (admin default was 1 year); a first-ride code is
  refused while another trip is booked; capped codes can no longer be overshot; café "this month" is the Darwin month; issued café codes past their
  date are marked expired by the job; deleting an account clears unused points.
- Deploy: apply migration 021 (AUTO_MIGRATE does it). No env vars. Check Loyalty → Programme defaults with the owner (expiry 12 months, tier
  thresholds, bonus sizes, referral minimum/cap) before the first run, and tell riders about expiry. No data fix.

Deferred:
- Gift vouchers bought on the public website without an account (Stripe Checkout + email delivery): needs Stripe on and an email provider; in-app
  purchase with the saved card covers it for now.
- Points claw-back on refunds (still an owner decision, as in Rounds 8 and 15).
- Automatic win-back on a schedule: kept manual so ops choose the timing and the offer; the once-per-period rule is in place for when it's automated.
- Tier perks beyond points (free cancellations, priority dispatch for Gold): need an owner decision on cost and fairness to drivers.
- Phone bookings paying with a voucher code by a dispatcher (the admin can top up credit; a "redeem voucher for this rider" action would be cleaner).

Ideas for next rounds:
- Public `/gift` page on the website with Stripe Checkout and a printable PDF card (the PDF writer would need an image/QR primitive).
- Café partner self-service: offer their own rewards (proposed, approved by DingoGo), opening hours shown in the rider app, and a café QR poster
  that opens `/invite/CODE` with the café's own referral code.
- Promo analytics: uses, discount given, new riders acquired and repeat rate per code; A/B two win-back messages.
- Pass + points: monthly Pass members earn a bonus each month they ride; Pass renewal with the saved card and a "Pass ends soon" notice.
- Community champions: referral leaderboard (opt-in, first names only) with a quarterly prize funded from the referral budget.
- Points as a liability in the BAS/accounts report (outstanding points, expired, used) for the accountant.

### Round 18 — performance and scalability on serverless
Scan: profiled the hot paths with realistic volume (new `scripts/seed-load.ts`: 54 drivers, 5,080 trips, 130k GPS points, 30k
events) through the Vercel entry run as one serverless instance (`scripts/serve-vercel.ts`, pool of 3, dispatch on requests)
with 5 ms added to every query (a database a few ms away). Found: `/public/config` ran 11 sequential queries (62 ms) for an
answer that is the same for everyone; a quote read the fare rule, every zone, the holiday table and 3 settings rows each time
(7 queries, 40 ms); a location ping took 3–4 round trips; polled offers looked each trip up again per offer; the live map ran 4
reads one after the other; the offer-expiry query walked the whole driver/offers index every tick (status is its second column)
and "is this driver on a trip" combined two indexes; every instance ran the dispatcher every 3 s; polls downloaded the full
payload even when nothing had changed (live map 25 KB every 5 s); no statement or query time limits; the driver app pinged
every 5 s while parked; polls ran at full speed in hidden tabs; every admin page, Leaflet and the rider's QR code library were in
each app's single bundle (admin 190 KB gz).

Suggested:
1. [add] Load fixture and tooling: `services/api/scripts/seed-load.ts` (local databases only, tokens file), `scripts/serve-vercel.ts`
   (Vercel entry as one instance, `DB_LATENCY_MS`, `/__stats` with queries and connections), dependency-free
   `scripts/load-test.mjs` (scenarios quote, trip poll, offers poll, active trip, location ping, live map, public config and a
   weighted mix; p50/p95/p99, 304s, bytes, queries per request; refuses live hosts).
2. [add] Migration 022: partial indexes for live trips by driver, searching trips, bookings waiting for release and offers on
   screen; checked with EXPLAIN on the volume database (index scans of a handful of rows instead of index-wide scans).
3. [add] In-memory config cache (`lib/cache.ts`, `CONFIG_CACHE_TTL_MS` 15 s, single flight, a copy per caller): fare rules,
   zones with levy, holidays and hot settings; dropped on the instance that saves any admin/dispatcher write; `/public/config`
   built from parallel reads, cached and `Cache-Control: public, max-age=60`.
4. [fix] N+1s and serial reads: location ping as one statement (`pingLocation`: car, track point on every live trip, live trips
   for the route check), polled offers without per-offer lookups, quote reads in parallel, live map reads in parallel, parcel and
   run in parallel in `getTrip`; route-deviation alert claimed once under concurrent pings.
5. [add] ETag / If-None-Match on every GET JSON answer (bodiless 304), CORS exposes `ETag`; shared API client keeps the last
   signed-in answer per path in memory (cleared on sign-in/out), `getIfChanged` for polls.
6. [fix] Serverless dispatcher claimed across instances (`claimTick`, one conditional write on the `_dispatch_tick` row per
   `DISPATCH_TICK_EVERY_MS`); internal `_` settings hidden from admin.
7. [add] Database limits: `DB_POOL_MAX`, `DB_IDLE_TIMEOUT_MS` (5 s serverless), `DB_QUERY_TIMEOUT_MS` (25 s, client side),
   `DB_STATEMENT_TIMEOUT_MS` (15 s, `SET LOCAL` in the same round trip as `BEGIN`, pooler-safe, no startup parameters);
   `/health/deep` details show pool use, limits and cache hits.
8. [add] Adaptive polling (`usePoll` in shared): rider live trip 4 s easing to 8 s while unchanged, 15 s in the background, at
   once on return; driver offers 4 s / 8 s hidden; driver location every 5 s on a trip, every 15 s when waiting and only after
   moving 30 m or a minute; admin live map 5–10 s and paused while hidden; admin badge counts paused while hidden; chat 4 s/15 s
   with 15 s/60 s in the background; tracking page 30 s hidden.
9. [add] Bundle size: Leaflet behind a lazy `DgMap` (`@dingogo/shared/map` → `LazyMap.tsx`, same-size placeholder, "Map
   unavailable right now" if it can't load); every admin page except the live map code-split; rider Rewards (QR codes),
   Business and Clients code-split; `lazyWithRetry` retries once and reloads once when a release replaced the file.

Done (all 9). Migration: `services/api/migrations/022_hot_path_indexes.sql` (indexes only, additive, re-runnable; the API works
without it). Tests: 168 → 174 (ETag/304/list/strong form/new tag on change/no tag on 404/CORS expose; config cache — warm quote
≤ 3 queries, warm `/public/config` 0 queries and `public, max-age=60`, outside change hidden until TTL, admin PATCH visible at
once, cached copies can't be mutated, TTL 0 off; location ping ≤ 2 queries with the track point and car position, one deviation
alert under two concurrent pings, 403 for riders; tick claim once per window and hidden from admin settings; pool max, 15 s
`SET LOCAL` statement timeout inside transactions (57014 on overrun), session untouched outside, 0 = off, `/health/deep`
performance block; polled offers keep every field with ≤ 3 queries). Browser smoke run (7 steps) passes on the new build. The
existing e2e tests that change settings or rename columns with direct SQL now drop the cache (`invalidateConfig()`), as a
deploy or cold start would.

Before → after (one instance, pool 3, +5 ms per query; p50 with one client / queries per request):
| path | before | after |
|---|---|---|
| `GET /public/config` | 62.5 ms, 11 q, 11.5 KB | 0.9 ms, 0 q (304 with ETag: 4 B) |
| `POST /quotes` | 40.4 ms, 7 q | 12.7 ms, 3 q |
| `POST /driver/location` | 19.1 ms, 3.2 q | 12.9 ms, 2 q |
| `GET /admin/live` | 30.3 ms, 25 KB | 18.0 ms (304: ~300 B) |
| `GET /trips/:id` (poll) | 13.0 ms, 1.6 KB | 13.3 ms (304: 9 B) |
| `GET /driver/offers` with an offer | 5 q | ≤ 3 q |
| mixed traffic, 10 clients | 157 req/s, p95 138 ms, 1.4 KB/resp | 242 req/s, p95 50 ms, 0.7 KB/resp |
Bundles (entry JS, gzip): admin 189.7 → 77.6 KB, rider 166.0 → 100.8 KB, driver 151.4 → 105.3 KB (Leaflet 159 KB raw now its
own file), partner 56.4 KB unchanged. Driver pings while parked: 12/min → 1–4/min. Dispatcher on N instances: N ticks per 3 s
→ 1 (plus one cheap claim per instance).
- API: new `src/lib/cache.ts`, `src/lib/etag.ts`; `db.ts` (pool from `config.perf`, `query_timeout`, `SET LOCAL statement_timeout`
  in `tx`, `poolStats`); `index.ts` (ETag hook, cache drop on staff writes, tick claim, CORS exposed headers); `services/trips.ts`
  (cached `loadRule`/`zoneFor`/`isPublicHoliday`, parallel quote reads, `pingLocation`, `afterLocation`, `claimTick`, parallel
  `getTrip`); `routes/driver.ts` (ping, offers), `routes/public.ts` (`/public/config`, estimate), `routes/admin.ts` (live map,
  settings list, fresh driver pay before merge), `routes/health.ts`; `lib/driverPay.ts`, `lib/community.ts`,
  `services/courier.ts` (settings through the cache); `config.ts` + `.env.example` (6 optional env vars).
- Apps: shared `api.ts` (`getIfChanged`, ETag memory), `hooks.ts` (`usePoll`), `lazy.tsx`, `LazyMap.tsx`, `Chat.tsx`; rider
  `Trip.tsx`, `App.tsx` (lazy screens), `CLIENT_KINDS` moved to `ctx.ts`; driver `state.tsx`; admin `main.tsx`, `Live.tsx`; web
  `Track.tsx`; every app's vite/tsconfig map alias → `LazyMap.tsx`.
- Docs: API.md "Performance on serverless (Round 18)", OPERATIONS.md §10 (limits, cache, dispatcher row, load test how-to),
  README test count.
- Behaviour changes to note: admin edits to fares/zones/holidays/hot settings reach other serverless instances within 15 s
  (at once on the instance that saved them), and the website's public config can be a minute old in a browser; statements in a
  transaction longer than 15 s are cancelled (57014 → 500); a driver waiting online sends its position every 15–60 s instead of
  every 5 s (dispatch still sees it within 3 minutes); polls slow down when nothing changes and in hidden tabs; GET answers carry
  ETags; a new `_dispatch_tick` row appears in `settings` (hidden in admin).
- Deploy: apply migration 022 (AUTO_MIGRATE does it; indexes only). No required env vars (defaults suit Vercel + the Supabase
  transaction pooler). Optional: `ALTER ROLE <api role> SET statement_timeout = '20s'` for single statements outside
  transactions. No data fix.

Deferred:
- Caching the sign-in check (one `users` read per request, the biggest remaining share of a poll): a block or role change must
  still bite at once on every instance; needs a token version or a short cache with a cross-instance signal.
- Server-side `statement_timeout` for single statements via startup parameters: the transaction pooler may refuse them; the
  per-role `ALTER ROLE` above is the safe route and is the coordinator's call on the live database.
- Vercel Fluid compute's `attachDatabasePool` (closes idle connections before an instance is suspended): needs the
  `@vercel/functions` dependency and Fluid switched on; measure live connection counts first.
- Batching location points during a trip (e.g. two points every 10 s): the rider's map would lag; kept 5 s.
- A `since` cursor on `/trips/:id/track` and keyset pagination for admin trip lists: not on a polling path today (ETags cover
  the polls); worth it when tracks get long.
- Pinning the lazy map chunk for offline cold starts of the PWA (service worker precache): today the placeholder shows; the
  Capacitor apps bundle every file locally.

Ideas for next rounds:
- Supabase Realtime (broadcast channels) for trip and offer updates on Vercel, so the apps can drop most polling.
- Token versions on users: instant revocation and a safe per-instance cache of the sign-in check.
- `pg_stat_statements` top queries in admin → System health, and a weekly slow-query note to ops.
- Real-user monitoring (web vitals and API timings by route) through the analytics hook, with a budget alert in CI.
- Uploads to Supabase Storage (still open): removes bytea from the database, its backups and its cache.
- A nightly load run in CI against the volume fixture with a p95 budget per hot path.

### Round 19 — tours, hire and tourism
Scan: read the tour packages table and seed, `buildQuote`/`precheck`/`insertTrip`/`settle`/`cancelTrip` for tours and hourly hire, the
rider Tours and Hire panels and trip cancel dialog, the website Tours and Legal pages, admin Pricing → Tours, hire requests in Support,
the partner portal and the cancellation policy setting. Found: tours bookable at any minute of any day (no start times, season, notice or
weather), guests not checked against the tour's maximum; a tour booked inside 48 hours was charged 50% the moment it was booked, and the
rider's cancel dialog said "no charge" for it; no deposit; `service: 'hourly'` was priced by the drive time between pickup and drop-off
(a 3-hour hire to the airport cost one 15-minute fare); editing a tour's stops in admin failed (a JS array was sent to the jsonb column as
a Postgres array); hire requests only took a manual dollar figure with no way for the customer to accept; no itinerary detail, cultural
protocols per stop, heat or closure handling, outback safety advice, hotel pickups or partner bookings, no Aboriginal guide model, no
visitor languages; the Legal page quoted a $25 tour/hire cancellation fee that contradicts the 48 h / 50% policy and $6 ride fees.

Suggested:
1. [add] Tour products: itinerary (stop, minutes, note, cultural/site protocols from a fixed list), season months, weekdays, Darwin start
   times, minimum notice, heat-sensitive flag, hotel pickup, led by driver or Aboriginal guide with a guide fee, own deposit %, visitor-
   language text; validated admin edits; built-in itineraries for the four seeded tours so it all works before the migration.
2. [add] Availability and booking checks: `/public/tours/:slug/availability` by Darwin date with the reason a time can't be booked;
   bookings refused off-timetable, out of season, too soon, over the guest limit, on a closure day or after a heat advisory's latest start.
3. [add] Card deposit and the 48-hour rule: deposit charged at booking as its own payment, the rest held at release; cancel terms (free
   before 48 h, free 10 min after booking, free on advisory days, else 50%) with the deposit paying the fee first and the rest refunded;
   no-drivers / declined-at-release refunds it; staff refunds go back against each payment; rider "what cancelling costs now" endpoint and
   dialog.
4. [fix] Hourly hire priced by the hours booked (`hire_hours`, 1–10 h, 24 h notice online) instead of the drive; admin tour `stops`/
   `itinerary` written as JSON; Legal page and FAQ wording.
5. [add] Hire quotes: calculator (hourly rule, minimum, day-rate cap, multi-day discount, levy per car per day, 10-hour fatigue cap), admin
   "Send quote" storing the quote with a private link (texted), public quote page with terms and "Accept" (once, expiry).
6. [add] Hotels, visitor centres and tour desks: partner kinds with commission % and a linked business account; partner portal Tours tab
   books for a guest (pickup at the desk, guest texted, billed to the account), commission fixed at booking, earned on completion, void on
   cancel; monthly commission view and CSV; admin "Mark paid" per month; partner hotels offered as pickup points.
7. [add] Aboriginal-guided tours: guides register (community, consent to show name, ABN, payment reference), guide fee line outside
   discounts and outside the driver's fare, guide assigned per booking (texted), owed in full on completion or the late fee's share on a late
   cancel, admin payment runs with a reference and CSV.
8. [add] Heat and safety advisories: heat / closure / fire / flood / road / water advisories by day and tour; heat sets the latest start for
   walking tours, closures stop bookings; booked guests told in the app with free cancellation; outback safety advice per tour (water by
   duration and guests, hat and shoes, coverage, summer heat, permits).
9. [add] Visitor languages (German, French, Italian, Japanese, Korean, Simplified Chinese) for the tour and hire screens: separate
   `visitor.json` with every entry flagged `machine` (reviewer and date needed for `reviewed`), `tv()` helper, seeded tour names/summaries
   translated and flagged, `?lang=` on the catalogue, language picker with a "machine translation, being checked" note on the rider and
   website tour screens; the community-language file stays machine-free.
10. [add] Apps and docs: admin Tours & hire page (bookings with guide assignment, advisories, guides, guide payments, desk commissions,
    deposit and hire policy), tour fields in Pricing, hire quote modal, partner-kind fields; rider tours (itinerary, protocols, start-time
    picker, advisories, safety, hotel pickups, deposit and terms) and "Book a car by the hour"; website tours (language picker, itinerary,
    advisories, safety, terms) and `/hire/:token`; API.md, OPERATIONS.md §9b, README.

Done (all 10). Migration: `services/api/migrations/023_tours.sql` (columns `tour_packages.itinerary/season_months/days/start_times/
min_notice_hours/heat_sensitive/hotel_pickup/guided_by/guide_fee_cents/deposit_pct/translations`, `partners.tour_commission_pct/
corporate_account_id`, `hire_requests.quote/quote_token/quote_sent_at/quote_expires_at/start_date/accepted_at/accepted_name`; tables
`tour_advisories`, `tour_guides`, `tour_guide_jobs`, `tour_commissions`; additive, IF NOT EXISTS). Before it is applied
(`services/tours.ts` `toursReady()`, re-checked once a minute): catalogue, availability, booking checks (built-in timetables), deposit,
cancel terms, hourly hire and the hire calculator work; advisories are empty; new tour fields, advisories, guides, desk bookings,
commissions and hire quote links answer 503 `migration_pending`; admin forms still save the old fields. Tests: 174 → 188
(`tours.test.ts` 7 unit tests — built-in vs own products, availability and every booking check incl. heat/closure/notice/staff, deposit
and cancel terms incl. change of mind and advisory, hire quotes incl. minimum/day cap/multi-day/levy/fatigue, admin field and policy
checks, visitor-language files (all flagged, placeholders kept, none in the community file) and localising, safety advice and the guide
fee line; 6 e2e — catalogue in a visitor language with protocols, safety and terms; booking rules, hourly hire priced by hours, admin tour
edits incl. the JSON list fix and a reviewed translation; deposit charged, refunded on a free cancel, change of mind free, late fee from
the deposit then the card, a guided tour released/held for the rest/completed with two captures, the driver paid on the tour price only,
the guide owed and paid once, a full refund against both payments, the guide's share on a late cancel; heat advisory notifying the booked
guest, blocking walks, free cancel, closures; hotel desk booking for a guest with commission void on cancel, earned, month payment, no full
guest phone, account required; hire quote calculator, send, public view, accept once, expiry; everything with the 023 columns and tables
renamed away). The existing tour cancellation test now books real start times and steps past the change-of-mind minutes; the first ride test reads the tier after the trip (the seed gives the demo rider a random number of past trips, so it could cross into Silver and fail).
- API: new `src/lib/tours.ts` (products, protocols, BUILT_IN and SEED_TRANSLATIONS, `checkStart`, `availability`, `scheduledCancel`,
  `depositCents`, `hireQuote`, policy, safety), `src/services/tours.ts` (`toursReady`, cached products/advisories, `checkTourBooking`,
  `cancelTermsFor`, guide/commission hooks, `assignGuide`, `notifyAdvisory`, commissions, hire quotes), `src/routes/tours.ts`;
  `lib/fares.ts` (`guideFeeCents`, `GUIDE_FEE_LABEL`, `TripDeposit`); `services/trips.ts` (tour/hourly prechecks, guide fee and hours in
  `buildQuote`, deposit in `insertTrip` with undo, `depositLeft`/`applyDeposit` in `placeHold`/`settle`/`cancelTrip`/no drivers/declined
  release, cancel terms, tour hooks); `routes/admin.ts` (tour and partner `prepare`, `tour_policy` setting, refund across deposit and fare
  payments); `lib/messages.ts` (4 templates); old `/public/tours` and `/tours` moved to the new routes.
- Shared: `i18n/visitor.json`, `visitor.ts` (`tv`, `VISITOR_LANGS`, `visitorIsMachine`, saved language).
- Behaviour changes to note: tours must be booked at one of the tour's start times, in season, with at least the notice (12 h town tours,
  24 h West MacDonnells) and within the guest limit (staff phone bookings may be later); card tour bookings take a 20% deposit at booking
  and hold only the rest at release; cancelling a tour in the first 10 minutes after booking is free; heat/closure advisory days make
  cancelling free; hourly hire needs `hire_hours` (priced as hours × $75) and 24 h notice online; `GET /public/tours` returns `{ tours,
  lang, languages, advisories, terms }` (tours carry the new fields); partner kinds can be hotel/visitor_centre/tour_desk.
- Deploy: apply migration 023 (AUTO_MIGRATE does it). No env vars. Check with the owner: the 20% deposit, 10-minute change of mind, the
  hire day-rate cap (8 h) and multi-day discount (10% from 3 days), guide fees and the GST treatment of guide fees, desk commission rates.
  Machine translations need a fluent reviewer before they are marketed. No data fix.

Deferred:
- Paying a hire quote's deposit online (customers are not signed in; needs Stripe Checkout) and turning an accepted multi-day quote into
  scheduled hourly trips per car per day automatically: ops still create those as phone bookings.
- Live weather (BOM forecast feed) to suggest heat advisories automatically: needs a data agreement; ops post them for now.
- Guide self-service (guides see their bookings and payments) and guide availability calendars: a guide login role is a bigger change.
- Desk bookings paid by the guest's own card at the desk (Stripe Terminal / payment link): desks bill to their account for now.
- Translating itineraries, protocols and safety advice per stop into visitor languages: only names, summaries and screen words so far.
- Group tours with several cars and per-seat pricing for coach groups.

Ideas for next rounds:
- Hire deposit and balance by payment link, and automatic scheduled trips from an accepted quote (driver roster per day).
- Guide portal: upcoming tours, owed and paid, with consent-based profile shown to guests.
- BOM heat forecast import that drafts heat advisories for ops to approve, and a "move my tour" flow for guests on advisory days.
- Tour reviews and ratings per tour and per guide, shown with consent on the website.
- Yulara / Uluru long-distance tours when the zone opens (charging plan, overnight driver rest rules).
- Desk statements as PDF and a QR poster for hotel lobbies linking to the tour pages with the desk's referral.

### Round 20 — fleet and EV programme (contracts, maintenance, charging, insurance, profitability, investors)
Scan: read the vehicles schema (`ownership`, `lease_weekly_cents`), `POST /admin/lease/run`, the charging routes (driver log, admin
month view and reimburse), battery logs, the Fleet admin page, payouts, the tax statement's lease line and the seed (3 DingoGo BYD
Dolphins, two "leased"). Found: the lease run could take a driver's balance below zero (it charged the full amount whatever they had
earned), decided "already charged" with a rolling 6-day window (a Tuesday run then a Monday run skipped a week; no lock, so two
clicks at once could both charge), kept no record of weeks or arrears, and there was no contract (start, end, rent-to-own price,
deposit, buy-out); every charging session was reimbursable, including cars drivers own and depot charging, at whatever cost the
driver typed; no maintenance, downtime, spare cars, insurance or claims records; nothing showed whether a car makes money or what an
investor's share is.

Suggested:
1. [fix] Weekly lease run: never below zero (capped at the driver's balance), once per Darwin week with a lock, results recorded;
   before migration 024 the old run keeps working with the cap.
2. [add] Fleet contracts (weekly lease and rent-to-own): terms (weekly amount, start/end, deposit, price and term for rent-to-own,
   catch-up cap, amount always left to the driver), car assigned on start; weekly deduction once per contract per Darwin week, capped
   so the driver never goes negative, arrears carried and caught up later within the cap; hardship pause (no arrears build up);
   manual payments and waivers; arrears flag to compliance and a plain note to the driver after N weeks; buy-out balance, buy-out
   transfers the car to the driver; ending returns the car. Optional automatic Monday run (off by default).
3. [add] Maintenance scheduling: service plans by fuel type (km and months) for servicing, tyre and brake checks, EV battery health
   checks shortened in the hot months and brought forward after a hot week (battery logs); due/overdue list per car; jobs booked →
   off road (car leaves dispatch, downtime counted) → back; spare-car allocation for the car's driver and return afterwards.
4. [fix] Charging cost rules: home charging reimbursed at the policy tariff per kWh, public charging at cost up to a per-kWh cap
   (receipt reference kept), depot charging and cars drivers own never; monthly cap per driver; reimburse pays the rule's amount.
5. [add] Insurance policies and a claims log per car (insurer, policy number, cover, premium, excess, dates; claims with status,
   excess, driver contribution, payout, repair cost); the policy's end date keeps the car's insurance expiry in step.
6. [add] Per-car utilisation and profitability for any date range: trips, km, engaged hours per day, days off road, utilisation, income
   (service fees, lease/rent-to-own collected, roof-screen ads) against costs (charging, maintenance, insurance, claim excess,
   finance), profit and profit per km; CSV.
7. [add] Investor revenue share (admin only): investors, share of a car by percent and dates, monthly report and CSV.
8. [add] Driver: `GET /driver/fleet` (contract, this week, arrears, buy-out balance, history, next service) and a "Your car
   agreement" panel in the driver app shown only to drivers on a contract; the charging screen shows how a session is reimbursed.
9. [add] Fleet programme switch (`fleet_policy`, off by default): the new admin tabs stay behind "Fleet programme" until it is
   switched on; validated policy (charging rules, service plans, arrears weeks, auto run).
10. [add] Docs (API.md, OPERATIONS.md, README) and tests.

Done (all 10). Migration: `services/api/migrations/024_fleet.sql` (columns `vehicles.purchase_price_cents/purchase_date/
finance_weekly_cents/spare`, `charging_sessions.reimburse_cents/rule/receipt_ref`; tables `fleet_contracts` (one live agreement per car
and per driver), `fleet_contract_weeks` (one row per agreement per week), `fleet_contract_payments`, `vehicle_maintenance`,
`fleet_insurance`, `fleet_claims`, `fleet_investors`, `fleet_investor_shares`; backfills a weekly-lease agreement for each car already
leased to a driver; additive, IF NOT EXISTS). Before it (`services/fleet.ts` `fleetReady()`, re-checked once a minute): the old lease run
works (once per Darwin week, locked per driver, capped at the balance), charging logs get the right `reimbursable` and reimburse at cost,
the car form drops the new fields, `/driver/fleet` says not ready, everything else answers 503 `migration_pending`. Tests: 188 → 198
(`fleet.test.ts` 5 unit tests — weekly deduction incl. short weeks, catch-up cap, kept minimum, paid ahead, rent-to-own end; agreement
totals and buy-out; charging rules; maintenance due by km/months, fuels, summer battery interval and hot week; policy checks and
proration/investor share; 5 e2e — weekly lease never below zero, arrears and catch-up, two runs at once charge once, flag and driver note,
waiver/payment limits, pause, driver view, roles; rent-to-own checks, weekly run, bank payment, buy-out from balance transfers the car,
ending returns it; maintenance board with the battery heat rule, off road with a spare and back, odometer and cost, cancel rules, past
jobs; charging rules and monthly cap, insurance expiry sync, claims with admin-only money, profitability JSON/CSV, investor shares never
over 100% and the monthly report; everything with the 024 tables and columns renamed away).
- API: new `src/lib/fleet.ts` (policy, `weekDeduction`, `contractTotals`, `chargeReimbursement`, `dueFor`, proration, `investorShare`),
  `src/services/fleet.ts` (agreements, `runWeek`, `autoWeeklyIfDue` in the dispatcher tick, legacy `leaseRun`, `driverFleet`,
  `maintenanceBoard`/jobs with spares, `reimburseCharging`, insurance sync, `profitability`, `investorReport`), `src/routes/fleet.ts`;
  `routes/admin.ts` (lease run and charging reimburse through the service, charging month view split home/public/depot, vehicle fields);
  `routes/driver.ts` (charging rule on every session, `receipt_ref`, reimbursement rates); `lib/messages.ts` (4 templates); seed (agreements
  for the two leased Dolphins, purchase/finance, a policy and a tyre job per fleet car).
- Apps: admin — Fleet & charging gets a "Fleet programme" tab (switch, rules, service plans) and, when on, Agreements (new agreement form
  with payoff weeks, run week, pause/resume, bank payment, write off, buy-out, end), Maintenance (due list, book/record, take off road with
  a spare, back on road), Insurance & claims, Profit per car (CSV), Investors (shares, monthly report CSV); car form purchase/finance/spare
  fields when on; charging rules note and per-session rule; lease run message; `fleet_arrears` flag label. Driver — "Your car agreement"
  panel on Earnings (only with an agreement), charging screen shows how sessions are paid back, receipt number for public charging.
- Behaviour changes to note: `POST /admin/lease/run` never takes more than a driver's balance and charges each week once (with 024 it runs
  the agreements and returns `{ week, charged, rows, collected_cents, short_cents }`); charging sessions on cars drivers own and at the
  depot are no longer reimbursable; home charging is paid back at 30c/kWh whatever cost was typed; public charging at cost up to 80c/kWh;
  reimbursements are capped at $250 per driver per month; starting a maintenance job takes the car out of dispatch.
- Deploy: apply migration 024 (AUTO_MIGRATE does it). No env vars. Leave the fleet programme switched off until the fleet launches.
  Check with the owner and accountant: the catch-up limit (150%), arrears flag (2 weeks), charging rates and monthly cap, GST on
  rent-to-own payments and buy-outs, whether investor shares are of profit (as built) or of income. No data fix.

Deferred:
- Driver contribution to a claim excess taken through the weekly run (recorded only; taking money for damage needs a signed agreement
  clause and a dispute path).
- Km allowance per week with an excess-km charge (`km_per_week` is stored and shown, not charged): needs trustworthy odometer readings
  (telematics or photo check-ins).
- Telematics / OEM battery health (state of health %) instead of drivers' check-ins and ambient temperatures.
- Investor statements as PDF and payment runs (CSV for the accountant for now), and investor logins.
- A signed agreement document (PDF with terms, e-signature) generated from the agreement record.

Ideas for next rounds:
- Agreement documents: PDF terms generated from the record with the driver's signature in the app, and a hardship request button for drivers.
- Odometer photo at each battery check-in (OCR later) feeding maintenance km and a weekly km allowance.
- Fleet charging plan: depot charger booking slots, off-peak home charging reminders, kWh per km per car to spot battery wear.
- Spare-car calendar and roster for shift drivers sharing one car (two agreements on one car split by hours).
- EV transition offer for own-car drivers: estimate their fuel versus a lease's weekly cost from their own trips, shown in the driver app.
- Fleet dashboard tiles on the admin home (cars off road, overdue checks, arrears total, this month's profit) once the programme is on.
