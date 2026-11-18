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
