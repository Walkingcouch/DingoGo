# DingoGo operations runbook

How to set up a database from nothing, roll the schema forward, check the deploy is healthy, find errors, and back up and restore.
Everything here is safe to run more than once unless it says otherwise.

## 1. Bootstrap a brand-new Supabase database (production)

Use this after losing a database, or for a new environment. It creates the schema, locks the database down and adds what DingoGo needs to take
bookings — **no demo data** (no fictional drivers, cafés, promo codes or demo sign-ins).

1. **Create the project** in Supabase (region `ap-southeast-2` Sydney). Note the database password.
2. **Get two connection strings** (Project Settings → Database → Connection string):
   - *Session pooler* (port 5432, `postgres.<project-ref>` user) — for migrations, bootstrap and backups. Session mode keeps one connection for the
     whole run.
   - *Transaction pooler* (port 6543) — for the API on Vercel (many short connections). The session pooler also works if you prefer one URL.
   Both end in `?sslmode=require` or contain `supabase.co`/`supabase.com` (the API then uses TLS).
3. **Bootstrap** from any computer with Node 22 and this repository:
   ```bash
   npm ci
   MIGRATION_DATABASE_URL='postgres://postgres.<ref>:<password>@aws-0-ap-southeast-2.pooler.supabase.com:5432/postgres' \
   BOOTSTRAP_ADMIN_PHONE='04xx xxx xxx' BOOTSTRAP_ADMIN_NAME='Your name' \
   npm run db:bootstrap
   ```
   It runs every migration, turns on Row Level Security on every table, removes all access for Supabase's `anon`/`authenticated` roles (DingoGo never
   uses Supabase's REST API or client keys, so nobody holding the anon key can read anything), adds the base data (Alice Springs zone and the other
   NT zones switched off, fare rules, NT/SA rules with SA hidden, settings with **roof screens off**, DingoGo Pass plans, public holidays, tours) and
   makes `BOOTSTRAP_ADMIN_PHONE` an admin. Demo numbers (0400 000 0xx) are refused as the admin.
   Check it any time without changing anything: `npm run db:bootstrap -- --check` (exit code 0 = up to date and complete).
4. **Point Vercel at it** (Project → Settings → Environment Variables, Production), then redeploy:
   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL` | the transaction pooler URL (port 6543) |
   | `MIGRATION_DATABASE_URL` | the session pooler URL (optional; only needed with `AUTO_MIGRATE` and a least-privilege `DATABASE_URL`) |
   | `AUTO_MIGRATE` | `true` (recommended: future migrations apply at the next cold start) |
   | `BOOTSTRAP_ADMIN_PHONE` | the admin's mobile (used only if the database is ever found empty) |
   | `HEALTH_TOKEN` | a long random string for your uptime monitor |
   | `JWT_SECRET`, `OTP_DEV_MODE=false`, … | as before (`services/api/.env.example`) |
   | `SENTRY_DSN` | optional, see section 4 |
5. **Sign in** to `/admin` with the admin mobile. Without Twilio the sign-in code goes to the Vercel function log (search for `sms:dev`): since
   Round 29 this works for admin and dispatcher accounts only (the sign-in screen says where the code is); riders and drivers are told sign-in
   isn't switched on yet. Set up Twilio before real riders sign in. Then work through **`docs/GO-LIVE-CHECKLIST.md`** and admin → Reports →
   Go-live checks (the Dashboard says "Not ready for real riders yet" until the must-do items pass).
6. **Re-enter what lived only in the old database**: admin-edited prices or driver pay rates, promo codes, business/NDIS accounts, partner cafés,
   driver applications and uploaded documents (uploads were stored in Postgres, so they went with it — drivers must upload their papers again).

On Vercel the API uses production defaults whatever `NODE_ENV` says (Round 29): no on-screen codes, mock card payments for test accounts
only, and it won't start without a real `JWT_SECRET` (missing or the `.env.example` placeholder). Community routes start **closed** on a new
database (their prices and notes are placeholders): open them in Community trips → Routes after checking them with the community.

**No computer with database access?** Set `DATABASE_URL` to the new database and `AUTO_MIGRATE=true` (plus `BOOTSTRAP_ADMIN_PHONE`) in Vercel and
redeploy. The first request after the deploy finds the database empty and does steps 3's work itself (migrations, RLS, base data, admin). Check with
`/api/health/deep` (section 3).

**Demo database** (for testing or a sales demo, never production): add `DEMO_DATA=true` to the bootstrap command.

### Optional: a least-privilege role for the API

`DB_API_ROLE=dingogo_api DB_API_ROLE_PASSWORD='<long random>' npm run db:bootstrap` creates a role that can read and write rows but not change
or drop tables, with RLS policies for it. Then set `DATABASE_URL` to that role (Supabase pooler user `dingogo_api.<project-ref>`) and
`MIGRATION_DATABASE_URL` to the `postgres` owner URL, so migrations still run. Bootstrap must run again (with the same `DB_API_ROLE`) after migrations
applied from somewhere other than this repo's runners; `AUTO_MIGRATE` re-applies grants itself after each migration.

## 2. Rolling the schema forward

- **Automatic (recommended):** `AUTO_MIGRATE=true`. Each cold start checks for migration files the database hasn't had and applies them one by one,
  each in its own transaction behind an advisory lock, so many instances starting at once apply each file exactly once. A migration that can't get
  its table locks within 5 s, or runs a statement longer than 20 s, is rolled back instead of stalling live requests; the API keeps serving on the old
  schema (new features stay off until the migration is in) and `/health/deep` shows `auto_migrate_failed` with the error. Fix the migration, redeploy.
- **By hand:** `npm run db:status` (what's applied, what's pending) and `npm run db:migrate` with `MIGRATION_DATABASE_URL` (or `DATABASE_URL`) set.
  Safe while the API is running — the same lock is used.
- **Supabase MCP / SQL editor:** paste the file's SQL and then `INSERT INTO schema_migrations (name) VALUES ('0NN_name.sql');` in the same
  transaction, or the runner will try the file again.
  Migrations 011 onwards are re-runnable (`IF NOT EXISTS`, no drops or renames; checked by `test/ops.test.ts`), so pasting one a second time
  is harmless. 001–010 are not: never paste those into a database that already has them.
- Migrations must stay additive and backward compatible (ground rules in `docs/improvement-rounds.md`): code that is ahead of the schema answers 503
  `migration_pending` for the affected feature, not a crash.
- `db:reset` drops everything and **refuses a non-local database** unless `ALLOW_DB_RESET=yes`. Never set that against production.

### After a deploy: browser smoke test
`node scripts/build-vercel.mjs && npm run db:reset -w services/api && npm run smoke` drives the built rider, driver and admin apps in Chromium
against the bundled serverless API on a local demo database: driver goes online, rider books Todd Mall → Hospital, driver accepts, arrives, starts
with the rider's PIN and completes, rider sees "Thanks for riding", admin approves the waiting car. CI runs it on every push (screenshots kept on
failure). It needs a throwaway database (it signs in demo accounts with 000000); never point it at production.
Since Round 25 it also checks the business account (manager), help, the partner portal and every tab of Support, Business, Loyalty, Tours and
Fleet.

### Before go-live: the first day on an empty database (Round 29)
`createdb dingogo_firstday && DATABASE_URL=…/dingogo_firstday node scripts/first-day.mjs` (after `node scripts/build-vercel.mjs`) walks the first
day in a browser against the built apps and the bundled function in production mode: the first request auto-migrates the empty database, the
admin signs in with a texted code (a local Twilio stand-in), enters the ABN (a wrong one is refused), sets a fare, a driver signs up and is
approved (papers, car, driver), a rider adds a card (mock), books and completes a ride, gets a tax invoice with DingoGo's ABN, the driver is
paid out and the trip is in the levy report. It refuses a database that already has tables. `npm run tour` can also run on a freshly
bootstrapped database to see the empty screens: `ADMIN_PHONE=<bootstrap admin> RIDER_PHONE=… DRIVER_PHONE=… SKIP_ROLES=partner`.

### Before a release: screen-by-screen tour and accessibility check
`npm run tour` (Round 25) opens every screen in `scripts/lib/screens.mjs` — every app, every admin tab, the partner sections — at phone and
desktop sizes in light and dark, saves a screenshot of each (`TOUR_SHOTS=dir`) and fails on page or console errors, failed API calls,
sideways scrolling on a phone, unnamed controls, blank screens and loads over 2.5 s. `npm run a11y` runs axe-core (WCAG 2.2 AA) on the same
screens and tabs; CI runs it after the smoke test. Both need the Vercel build and a freshly reset demo database, like the smoke test. When an
app gets a new screen, add it to `scripts/lib/screens.mjs` (a test fails until you do). Look at the screenshots, not just the pass/fail:
contrast on the website's illustrated skies is something axe can't measure.

## 3. Is it healthy?

- `GET /api/health` — the API and database answer (`{ ok: true }`).
- `GET /api/health/deep` — `status` `ok` / `degraded` / `down`, schema version, `problems`. For the details (pending migration names, last
  auto-migrate run, base data counts, tables without RLS, which integrations are configured) send `X-Health-Token: <HEALTH_TOKEN>` or open
  admin → Reports → System health. 503 means the database can't be reached.
- Uptime monitor: poll `/api/health/deep` with the token header every 1–5 min; alert on non-200 or `status != "ok"`.
- When the database is down, every app shows "DingoGo is having a problem on our side" (rider: "In an emergency call 000"), the rider's live trip
  stays on screen, and the driver app keeps arrive/start/complete taps on the phone and sends them when it's back (no double charges: they carry
  idempotency keys).

## 4. Logs and errors

- The API writes one JSON line per request to stdout (Vercel → Project → Logs, or `docker compose logs api`): `request_id`, `method`, `route`
  (pattern only — no tokens, share links or query strings), `status`, `ms`, `user_id`. Errors carry `err` with the stack and `where`
  (`request`, `dispatch tick`, `background`, `auto-migrate`, …). `LOG_LEVEL=debug|info|warn|error` (default `info` in production).
- Every response has `X-Request-Id`; 500s show "(ref 1a2b3c4d)" in the apps. Search the logs for that id.
- **Sentry (optional):** create a Node project, copy its DSN into `SENTRY_DSN`. Unhandled errors, database outages, failed migrations and dispatch
  errors arrive with the release (Git commit), route and request id. No request bodies, phone numbers or names are sent.

## 5. Backups and restore

Supabase's free plan has **no automatic backups**, and deleting a project deletes its backups. Keep your own:

- **Take a backup** (needs `pg_dump` 16+ installed; otherwise it writes a JSON export):
  ```bash
  MIGRATION_DATABASE_URL='<session pooler URL>' npm run db:backup                 # → services/api/backups/dingogo-<time>.dump
  MIGRATION_DATABASE_URL='<session pooler URL>' npm run db:backup -- --json       # → JSON per table (no pg_dump needed)
  npm run db:backup -- --out /secure/place/dingogo.dump
  ```
  Backups contain personal information (phone numbers, addresses, driver licences): store them encrypted (e.g. an encrypted disk or a private,
  encrypted bucket), never in the repo (`backups/` and `*.dump` are git-ignored) or a shared drive. Files are written readable by you only.
- **Schedule:** daily, keep 7 daily + 4 weekly + 12 monthly. On a paid Supabase plan also turn on Point-in-Time Recovery.
- **Restore into a new database:** restore the dump straight into the new, empty project (don't bootstrap it first, or the base data would clash),
  then run bootstrap to apply any newer migrations and re-apply RLS and grants (it inserts nothing that already exists), and check.
  A "schema public already exists" message from `pg_restore` is harmless:
  ```bash
  pg_restore --no-owner --no-privileges --dbname "$NEW_SESSION_POOLER_URL" dingogo-<time>.dump
  MIGRATION_DATABASE_URL="$NEW_SESSION_POOLER_URL" npm run db:bootstrap      # applies any newer migrations, RLS, grants; inserts nothing that exists
  MIGRATION_DATABASE_URL="$NEW_SESSION_POOLER_URL" npm run db:bootstrap -- --check
  ```
  The JSON export is for records and accounting (and a last resort): it holds every row but restoring it means loading each table by hand.
- **Test a restore** every quarter into a scratch project and sign in to admin; a backup that has never been restored is a guess.
- Also export from Supabase now and then (Database → Backups, or the CLI `supabase db dump`).

## 6. Safety checklist before deleting or pausing anything

- Take a backup (section 5) and check the file opens: `pg_restore --list <file> | head`.
- Never delete a Supabase project that `DATABASE_URL` in Vercel still points at; check Vercel's Production variables first.
- Pausing a free Supabase project after a week idle stops the database: `/api/health/deep` returns 503 and the apps show the "problem on our side"
  notice. Un-pause from the Supabase dashboard.

## 7. Rider and driver safety tools (Round 14)

Migration `019_safety.sql` turns them on (AUTO_MIGRATE applies it). Until then SOS, sign-in and going online work as before and the new screens say
"needs migration 019". Rules live in admin → Safety → Policy (`safety_policy`); nothing needs an env var.

- **Every shift:** Safety → Emergency alerts (unanswered "Are you OK?" check-ins arrive here as alerts with the usual runbook), Reports (critical
  first; a critical report puts the other person on hold unless they were on a trip: then hold them from Standing when it ends), Photo checks
  (when switched on), Appeals (admins decide). Since Round 26 the automatic hold only happens when the two people actually met on that trip
  (the driver arrived or it started), it ended in the last 7 days and the reporter hasn't caused a hold in the last 30 days. Other critical
  reports are not held automatically: the trip timeline shows "incident hold skipped" with the reason. Read them first and hold from Standing
  if the report holds up.
- **New API routes** must be added to `services/api/test/helpers/routeAccess.ts` with who may call them (Round 26); the authorisation test
  fails otherwise and checks the roles against the running API.
- **Fatigue limits** are on by default (12 h online then a 6 h rest; a 20 min break after 5 h). Drivers are never set offline mid-trip. Check the
  numbers against current NT and SA point-to-point guidance before launch and change them in Policy.
- **Photo check** is off by default. `photo_review` asks every driver for a selfie each day (DingoGo looks at it; they can drive meanwhile).
  `face_match` needs a provider: `FACE_MATCH_URL` (POST `{ selfie, reference }` base64 → `{ score }` 0–1), `FACE_MATCH_KEY`; without one it falls
  back to review. Consider the provider's privacy terms (biometric information is sensitive information under the Privacy Act) and update the
  privacy policy before switching it on.
- **Emergency card street address:** set `REVERSE_GEOCODE_URL` to a Pelias/openrouteservice-style reverse geocoder (the `ORS_API_KEY` is sent);
  without it the card gives the nearest landmark and GPS.
- **Account standing:** Settings → Users → Standing (or from a report) to suspend (optionally until a date), ban, warn or lift. People who are
  restricted see the reason at sign-in and can appeal; the private note is never shown to them.

## 8. Tax, compliance and record keeping (Round 16)

Migration `020_tax_compliance.sql` (AUTO_MIGRATE applies it). Before it, statements, the BAS worksheet, SERR and levy returns still work (driver
names, birth dates and addresses show as missing); lodgement records and the privacy register say "needs migration 020". Admin → Tax & compliance.

- **First:** enter DingoGo's real ABN and legal name in the `business` setting (it is `TBC` in the base data): fee tax invoices say "draft" and the
  SERR report has no operator ABN until then. Ask drivers to complete Profile → Tax details (Tax → SERR → "Remind them all").
- **Every month (by the 21st, a setting — confirm the real date with the NT Government):** Tax → Levy returns → download last month's PDF/CSV,
  lodge and pay, then "Mark lodged" with the receipt number. SA returns are ready for when SA launches.
- **Every quarter:** Tax → BAS → download the worksheet for the accountant (due the 28th of the month after the quarter; Oct–Dec is due 28 Feb).
  Drivers download their own GST statement and DingoGo's tax invoice for fees in the driver app (Earnings → GST and your BAS).
- **Twice a year (SERR):** January–June by **31 July**, July–December by **31 January**: Tax → SERR → download the CSV (it holds full bank
  details: store it encrypted, delete the local copy after lodging) and lodge it in the ATO's SERR XML format through the accounting software or the
  ATO's online services. Chase drivers listed under Missing details first.
- **NDIS:** set the support item number and GST code (Tax → NDIS invoices) after checking the current NDIS Pricing Arrangements with the
  accountant; add the provider registration number only if DingoGo becomes NDIS-registered (that also enables the NDIA bulk claim file).
- **Record keeping:** tax records (trips, payments, driver pay, invoices, audit log) are kept at least 5 years and never removed by the job. Old
  GPS tracks, chat, comms log, notifications and sign-in logs are removed per the policy (Tax → Record keeping; manual until "automatically" is
  ticked). A deleted driver's tax details are kept apart until 30 June five years after their last payment's financial year, then removed.
- **Privacy requests:** log requests that come by email, phone or letter in Tax → Privacy requests and close them within 30 days with the outcome;
  in-app downloads and deletions appear there automatically.

## 9. Loyalty, cafés and gift vouchers (Round 17)

Migration `021_loyalty.sql` (AUTO_MIGRATE applies it). Before it, points, tiers, rewards, café redeeming and plain promo codes work as before;
points don't expire, there are no birthday/streak bonuses, gift vouchers can't be bought in the app and months can't be marked paid. Admin →
Loyalty & vouchers.

- **Before the first expiry run:** check Loyalty → Programme (12 months, 30-day warning by default) and tell riders in the app or on the website.
  Nobody loses points without a warning sent at least 30 days earlier. The job runs every few hours from the dispatcher; "Run expiry and birthdays
  now" runs it at once.
- **Every month (early in the month):** Loyalty → Redemptions & settlement → pick last month → pay each café by bank transfer, then "Mark paid" with
  the transfer reference. Cafés see the statement (PDF/CSV) and the reference in the partner portal (Statements).
- **Shop voucher cards:** new batches are "for sale" by default: a card works only once the café records the sale (Sell credit), and carries a
  3-year expiry (Australian Consumer Law for gift cards). Untick "for sale" only for cards given away free. Cards printed before Round 17 work as
  before. Gift vouchers bought in the app are paid on the rider's card (mock until Stripe is on), never have GST, and show in Prepaid vouchers with
  batch `online`.
- **Promo codes:** set a budget for every paid campaign (Pricing → Promo codes): the code stops when the budget is used, and a cancelled trip gives
  its discount back. Event codes: set the event's latitude/longitude and a radius. Off-peak: Darwin hours and days.
- **Win-back:** Loyalty → Win-back. Only riders who said yes to offers get it, at most once every 90 days (setting). For a code just for them, make a
  targeted promo code first and put it in the form.

## 9b. Tours, hire and tourism (Round 19)

Migration `023_tours.sql` (AUTO_MIGRATE applies it). Before it, tours still list and book with the built-in itineraries, start times and
heat rules for the four seeded tours, the card deposit and the 48-hour rule work, but there are no advisories, guides, desk bookings or
hire quote links (503 `migration_pending`). Admin → Tours & hire; tour products under Pricing & tours → Tours.

- **Heat days (October to March):** when the forecast is 40 degrees or more, post a heat advisory (Tours & hire → Advisories) for the day
  with "walking tours must start by" (e.g. 07:00). Afternoon starts of walking tours can't be booked, booked guests are told in the app and
  can cancel free. Park closures (fire danger, flooding, Parks and Wildlife notices): a closure advisory for those tours stops bookings; check
  Bookings for guests already booked and call them to move or refund.
- **Aboriginal-guided tours:** add the guide (Guides; their name shows to guests only with consent), set the tour to "Led by an Aboriginal
  guide" with the guide fee (added to the price, paid in full to the guide, never part of the driver's fare). Assign the guide on Bookings
  before the day (they get a text). After the tour the fee is "Owed"; pay by bank transfer and tick it in Guide payments with the reference
  (CSV for the accountant). Late cancellations owe the guide the same share as the guest paid. GST on guide fees depends on the guide's
  registration: confirm with the accountant.
- **Hotels and visitor centres:** Loyalty & vouchers → Partners: type Hotel / Visitor centre / Tour desk, address and location (offered as a
  pickup point), commission %, and the id of a Business account billed for their bookings; then a partner login for the desk (Settings, users).
  Each month, Desk commissions → "Mark paid" for last month with the transfer reference.
- **Hire quotes:** Support & inbox → Hire requests → Send quote (hours a day, days, cars; "Work it out" shows the price). The customer gets a
  private link (texted when they gave a mobile) to accept; the request turns Confirmed with their name. Quotes expire after 14 days.
- **Deposit:** card tour bookings pay 20% at booking (Tours & hire → Deposit & hire; a tour can set its own). A failed deposit refund shows as a
  payment problem and a `deposit_refund_failed` trip event: refund it from the trip.
- **Visitor languages:** tour names, summaries and key screen words in German, French, Italian, Japanese, Korean and Chinese are machine
  translations and say so. To sign one off, a fluent reviewer checks it and an admin sets `status: reviewed` with `reviewed_by` and
  `reviewed_on` (tour text in Pricing → Tours → Visitor-language text; screen words in `packages/shared/src/i18n/visitor.json`).

## 9c. Fleet and EV programme (Round 20)

Migration `024_fleet.sql` (AUTO_MIGRATE applies it; it also gives each car already leased to a driver a weekly-lease agreement at its
current weekly amount, from the day it runs). Admin → Fleet & charging → **Fleet programme**: the switch (off by default) shows the
Agreements, Maintenance, Insurance & claims, Profit per car and Investors tabs. Leave it off until DingoGo-owned cars are on the road.
Before the migration, "Run weekly lease deductions" (Payouts & leases) still works, once per week and never past a driver's balance.

- **Weekly run order (Mondays):** run the agreement deductions first (Agreements → Run week, or switch on "Run every Monday morning"),
  then pay drivers. A deduction never takes a driver below zero (or below the amount the agreement always leaves them): what can't be
  taken is owing and caught up in later weeks, at most the catch-up limit (150% of the weekly amount by default) in one week.
- **Arrears:** owing 2 weeks or more raises a "Car agreement payments behind" compliance flag and a plain note to the driver. Talk to them
  first. Options: pause payments (hardship, Sorry Business, car off the road; paused weeks add nothing), record a bank payment, or write off
  what is owing (audited). Ending an agreement returns the car to the fleet; what is owing stays on the record.
- **Rent-to-own:** set the price to own the car, the deposit already paid and the weekly amount (the form shows the weeks to pay it off).
  The weekly run stops at the price. "Buy-out" pays the rest (from the balance or by bank), closes the agreement and makes the car the
  driver's own car in DingoGo (their own-car fee rate applies, investor shares in it end). Transfer the registration with the driver.
  GST on rent-to-own payments and the buy-out: confirm with the accountant (they are recorded as `lease` like the weekly lease).
- **Maintenance:** each DingoGo car shows what is due from the service plans (scheduled service, tyres, brakes, battery health) by km and
  months; batteries every 3 months from October to March and straight away after a week averaging 40°C (from drivers' battery check-ins).
  Book the job; "Take off road" removes the car from dispatch (refused while on a trip), lends the driver a spare car if you pick one
  (cars marked "Keep free as a spare car" first) and takes other drivers of the car offline; "Done, back on road" records the odometer
  and cost and moves the driver back. Record past services with "Already done" so the schedule starts from them.
- **Charging:** home charging is paid back at the household rate per kWh (30c), public chargers at cost up to 80c per kWh (optionally
  only with a receipt number), depot charging and drivers' own cars are not paid back, at most $250 a month per driver. All editable on
  the Fleet programme tab. Reimburse per driver from Charging & battery (credited to the next payout).
- **Insurance and claims:** record each policy with its premium and excess (the car's insurance expiry follows it). Log incidents
  (kangaroo strikes are "Animal strike") and move the claim through lodged → approved/declined → paid; excess, the driver's contribution
  and payouts are admin only. The driver's contribution is recorded, not deducted: agree it with the driver and take it as a bank payment.
- **Profit per car and investors (admin only):** income (service fees from the car's trips, agreement payments, roof ads, insurance
  payouts) less costs (charging paid, maintenance, insurance spread by day, claims, finance per week from the car record). Investor shares
  are a percentage of a car's profit from a date (never over 100% of a car); the monthly report and CSV are for the accountant. It is a
  management report, not a statement of account: check it before paying anyone.

## 9d. Customer support desk (Round 22)

Migration `026_support.sql` (AUTO_MIGRATE applies it; adds 7 starter canned replies). Before it, messages to support and replies still
work the old way (one message, reply as a notification) and the lost property and fare check buttons don't show.

- **Daily routine:** Support & inbox → Support tickets, view "Open" (sorted by priority, then what is due next) or "Late". Take a
  ticket by giving it an owner (or just reply: an unowned ticket goes to whoever replies). "Send and wait for customer" when you need
  more from them; "Send and resolve" when it is sorted (they are asked to rate it). Internal notes are never shown to the customer.
- **Due times (Policy tab):** first reply 15 min (urgent), 1 h (high), 4 h (normal), 24 h (low); sorted within 4 h, 24 h, 3 days, 7 days.
  Calendar time, so set them to what the team can really do overnight. Safety tickets are always urgent; real emergencies still go to
  000 and the SOS/incident tools (section 7), not a ticket. Waiting on the customer pauses "late" on the resolve clock.
- **Fare checks:** riders tap "My fare was higher than expected" on a trip. A route change charge (the trip was more than 25% longer)
  the car's GPS track doesn't support is refunded at once up to $15, at most 2 times per rider in 30 days; a fare that was the price
  shown is explained. Anything else arrives as a ticket with the working (internal note and "Automatic fare check" line). Automatic
  refunds are in the audit log as `auto_refund` with no person. The driver's share of a refunded charge is not taken back (as with
  staff refunds); raise it with the driver if a pattern shows.
- **Lost property (Lost property tab):** the driver is told at once and answers "I have it" (with where a courier can collect it,
  ideally the depot or a public place) or "not in my car". Rider and driver can message and call each other through the relay for 7
  days while the case is open. The rider books the return courier themselves (normal small-parcel price; delivery PIN as usual) or
  arranges a pickup; the case closes when the courier delivers. Valuables (phone, wallet, keys, medicine): phone the rider, and if the
  driver can't be reached within the day, call the driver. Unclaimed items: hold 30 days, then follow the NT lost property rules
  (hand in to police for items of value). Never give out either person's number.
- **Chargebacks:** Reports → Payment problems → Open disputes → "Evidence pack" (or a trip's drawer → Chargeback evidence). The PDF has a
  plain summary, the PIN or delivery proof, timeline, GPS track, chat, tax invoice and payments; upload it in the Stripe dashboard with
  a short note before the due date. Each download is in the audit log (it holds personal information): keep it to the dispute.
- **Canned replies (admin):** keep them short and plain; `{first_name}`, `{trip_ref}` and `{ticket_ref}` are filled in for you.

## 9e. Business and government accounts (Round 24)

Migration `027_business_billing.sql` (AUTO_MIGRATE applies it). Before it, accounts, account bookings, the monthly limit and the
live statement work as before; the application form, set-up, approvals, invoices and regular trips answer "migration pending".

- **Applications (Business accounts → Applications):** organisations apply at dingogo.com.au/business (ABN checked with the ATO
  check digits; one application per ABN). Check the ABN on the ABR (link in the drawer: active, the right name, GST registered for
  a government or business customer), set payment terms, an optional monthly limit and discount, then Approve. The contact's mobile
  becomes the account manager and is texted; they add staff, approvers, cost centres, trip purposes and booking rules themselves in
  the rider app (Account → Business account). Decline needs a reason (texted).
- **Monthly invoices (Invoices tab):** after the month ends, "Issue invoices for <month>" (or switch on automatic issue in Billing
  settings: the 1st, Darwin time). One invoice per account, or per PO when the account asks; lines are frozen, so a refund after
  issue means Void (with a reason) and issue again (new number). Set "How to pay" in Billing settings before the first run.
- **Accounting:** Xero CSV (Sales → Import, choose "Tax inclusive") or MYOB AccountRight service sales import, per month. Confirm the
  account codes and tax types with the accountant first (defaults: Xero 200 / GST on Income, MYOB 4-1000 / GST).
- **Getting paid:** mark an invoice Paid with the bank reference when the money arrives. Reminders go to the account's managers (app
  and text) 1, 7 and 14 days after the due date by default ("Send due reminders" runs them now; the tick runs them every few hours).
  "Pause new bookings after N days overdue" is off (0) until the owner decides; ops phone bookings are never paused.
- **Approvals:** trips over an account's approval amount booked by someone who isn't an approver wait for an approver; a trip still
  waiting when it is due is not sent and costs nothing. Bookings for now over the amount are refused with a plain message.
- **Regular trips (dialysis, clinics):** booked 14 days ahead, skipping public holidays unless the series says otherwise (keep
  Pricing → Holidays up to date: the same list decides holiday skips). Problems (limit, budget, consent ended) are on the series and
  the person who set it up is told. A client withdrawing consent stops their series.
- **NDIS plan managers:** set the provider registration number, support item and GST code (Tax → NDIS) before the first invoice:
  plan-manager invoices group trips per participant with those details.

## 9f. Owner insights and the weekly summary (Round 27)
- Admin → **Insights** (admins only): Business health (trips, money kept, net contribution, driver pay per online hour after running costs,
  unfilled requests, cancellations, pickup times, repeat riders, mix, green km, against the period before; daily CSV), Supply & demand
  (heatmap by weekday and hour, rider cohorts), Forecast & drivers (next 7–28 days, drivers needed against drivers usually online), Unit
  economics (average trip; each trip's own breakdown is in the Trips drawer), Pricing simulator (nothing changes until fares are edited in
  Pricing), Weekly summary (PDF, email now) and Settings.
- **Check the settings once with the accountant and drivers:** running costs per km by fuel, the card fee (Stripe's rate on the account),
  and the seasonality calendar. School holiday and event dates come with "check the date" marks: confirm them against the NT Department of
  Education calendar and the event organisers, then tick "Date confirmed". The taxi tariff defaults to Gazette S53 (1 July 2026); update
  it when the NT Government gazettes a new one (the website's price check uses it).
- **Weekly email:** needs `RESEND_API_KEY` and `EMAIL_FROM` (a sender on a domain verified in Resend) on the server. Then Insights →
  Settings → Weekly owner email: tick "Send every Monday", add the owners' addresses and the hour (Darwin). Last week's summary goes out
  once, from that hour on Monday (or the first dispatcher tick after it). Without email set up nothing is sent and the PDF can still be
  downloaded. Sends are in the audit log (`owner_weekly_email`).
- Numbers are estimates where they say so (card fees, GST on what DingoGo kept, drivers' running costs); BAS and SERR figures come from
  Tax & compliance, not from here. Test accounts are left out.
- Locally: `DATABASE_URL=…/dingogo_load npm run db:reset -w services/api && DATABASE_URL=… npx tsx services/api/scripts/seed-load.ts`
  gives 120 days of realistic history (demand by hour, weekday and season, part-time driver shifts, unfilled peaks, promos, points,
  cancellations, repeat riders) to look at the Insights pages.

## 9g. Community trips, shuttles and community stores (Round 28)
- **Migration 028** (`drivers.long_trips`, `regional_runs`, `regional_bookings`, `partner_topups`; AUTO_MIGRATE applies it). Until it is in, riders
  see the routes and prices, long-trip and shuttle bookings say "call us", and text bookings get the how-to.
- **Before opening a route** (admin → Community trips → Routes): confirm the road km, minutes, unsealed km and the no-coverage stretches with the
  community and a driver who has done the drive (defaults are approximate), check the permit note with the Central Land Council and the community
  (DingoGo's notes only say where a permit *may* be needed), agree prices and the shuttle driver pay per leg with the owners, then tick "checked".
  Yulara stays closed until the charging and overnight-rest plan is in place.
- **Drivers** say yes to long trips in the driver app (Profile → Trip preferences). Only they get community trips and can be put on a shuttle.
  Electric cars get a community trip only with the range for the drive home (unless the route says they can charge there).
- **Shuttles:** "Add the timetable" (Shuttles tab) adds each route's shuttle days for four weeks; run it weekly. Assign a driver to each, print or
  download the manifest. Cancelling a shuttle gives everyone their credit back and texts them. The driver taps "Leaving now", marks who came, taps
  "Left at store" for each parcel (the collector is texted a code), checks in on the way and taps "Arrived: shuttle done" (their pay goes in the ledger).
- **Safety:** a long trip or shuttle that goes quiet for longer than the check-in time plus its longest no-coverage stretch shows a warning on the
  live map; one well past its expected arrival raises an emergency alert in Safety. Follow the SOS runbook (call the driver, then the community
  clinic or police if there is no answer). Ask drivers to carry water and tell someone their expected arrival.
- **Community stores:** add the store as a partner with kind "Community store" and a partner login, and put its partner id on the route's store
  pickup point (Routes, JSON box). The store adds credit for cash (texted receipt; "Undo" for a mistake within 15 minutes) and hands over parcels
  with the code. The cash is DingoGo's: each month check Store cash, collect it from the store and press "Cash received" with the payment reference.
  Ask the accountant: credit is a liability until spent, and whether shuttle seats make DingoGo the principal (the BAS worksheet shows a
  "Community shuttles" line).
- **Booking by text and the low-data page** need Twilio with a number that takes replies (TWILIO_FROM as a +61 number or a Messaging Service, with the
  Messaging webhook set as in section 9 of API.md). Put the number and the words (`BUS NTARIA FRI 2`, then `YES`) on posters at community stores and
  clinics, with the `/lite` address. Twilio treats a bare CANCEL as an opt-out, so texts say `CANCEL SB-…` with the booking ref.

## 10. Performance and load testing (Round 18)
- **Migration 022** (indexes only, safe any time; AUTO_MIGRATE applies it). Until it is in, `/health/deep` reports it pending and
  the API runs as before, just with slower dispatch queries as trips grow.
- **Connections.** Each Vercel instance opens at most `DB_POOL_MAX` (3) connections to the Supabase **transaction pooler** (port
  6543) and closes idle ones after `DB_IDLE_TIMEOUT_MS` (5 s). No startup parameters are sent, so the pooler never refuses a
  connection. Statements inside a transaction stop after `DB_STATEMENT_TIMEOUT_MS` (15 s, `SET LOCAL`); the API stops waiting
  for any query after `DB_QUERY_TIMEOUT_MS` (25 s). For a cap on single statements too, set it on the API's database role
  (Supabase SQL editor): `ALTER ROLE <api role> SET statement_timeout = '20s';` (not on the role migrations run as).
- **Config cache.** Fare, zone, holiday and hot settings changes made in admin show at once on the instance that saved them and
  within `CONFIG_CACHE_TTL_MS` (15 s) on the others; the website's `/public/config` can be a minute old in a browser. Set
  `CONFIG_CACHE_TTL_MS=0` to turn the cache off while debugging.
- **Dispatcher.** On Vercel one instance per 3 s runs it (claimed on the `_dispatch_tick` settings row). If trips seem slow to
  be offered, check the row's value is recent: `SELECT value FROM settings WHERE key = '_dispatch_tick';`.
- **Load test (local only, never against the live site):**
  ```
  createdb -O dingogo dingogo_load
  export DATABASE_URL=postgres://dingogo:dingogo@localhost:5432/dingogo_load
  npm run db:reset -w services/api
  (cd services/api && npx tsx scripts/seed-load.ts --out /tmp/load-tokens.json)      # 50 drivers, 500 riders, 5,000 trips
  (cd services/api && PORT=4100 DB_LATENCY_MS=5 LOG_LEVEL=warn npx tsx scripts/serve-vercel.ts) &   # one serverless instance
  node scripts/load-test.mjs --tokens /tmp/load-tokens.json --concurrency 10 --seconds 8 [--etag]
  ```
  `DB_LATENCY_MS` adds a round trip to every query, like a database a few milliseconds away; the report shows requests/s,
  p50/p95/p99, 304s, bytes and queries per request. Round 18's numbers are in `docs/improvement-rounds.md`.

## 11. Google Play releases (Round 21)
Store copy, the Data safety draft and iOS notes are in `docs/store/`. Test APKs keep coming from every push (shared test key,
`android-latest` release). Play builds are separate and signed with a private **upload key**.

**Target API:** Google Play has required **target API 36** (Android 16) for new apps and updates since 31 Aug 2026. Since Round 23
the apps are on Capacitor 8 and target and compile against API 36 (minimum Android 7.0, API 24), built with Android Gradle Plugin
8.13.0, Gradle 8.14.3 and Java 21 (`apps/<app>/android/variables.gradle`, `build.gradle`, `gradle/wrapper/`, the workflow).
`services/api/test/toolchain.test.ts` fails if these drift from the installed Capacitor. Before the first Play upload, install a
test APK on an Android 15 or 16 phone and check the status bar area (edge-to-edge), the keyboard over sign-in and chat, and that
Back steps back through screens and on the first screen puts the app in the background.

**Capacitor upgrades:** bump every `@capacitor/*` in `apps/rider` and `apps/driver` to the same major, `npm install`, then follow
the official migration guide (capacitorjs.com/docs/updating) for `variables.gradle`, the AGP/Gradle/Java versions and the
manifest, copy the new Gradle wrapper (`gradlew`, `gradlew.bat`, `gradle/wrapper/*`) from `node_modules/@capacitor/cli/assets/
android-template.tar.gz`, run `npx cap sync android` in both apps and commit the regenerated `capacitor.build.gradle` and
`capacitor.settings.gradle`. The Android workflow checks the wrapper jars (`gradle/actions/wrapper-validation`).

**One-time setup (owner):**
1. Google Play developer account (organisation account, D-U-N-S number) and two apps in Play Console: `au.com.dingogo.rider`
   ("DingoGo: Rides & Parcels") and `au.com.dingogo.driver` ("DingoGo Driver"). New personal accounts must run a closed test
   with 12 testers for 14 days before production; organisation accounts don't.
2. Make the upload key (once, keep two safe copies offline; never commit it):
   `keytool -genkeypair -v -keystore dingogo-upload.jks -alias dingogo-upload -keyalg RSA -keysize 4096 -validity 10000`
3. GitHub > Settings > Secrets and variables > Actions (or the `google-play` environment, which can require an approver):
   `ANDROID_UPLOAD_KEYSTORE_BASE64` (`base64 -w0 dingogo-upload.jks`), `ANDROID_UPLOAD_STORE_PASSWORD`,
   `ANDROID_UPLOAD_KEY_ALIAS` (`dingogo-upload`), `ANDROID_UPLOAD_KEY_PASSWORD` (if different from the store password).
   Optional: `GOOGLE_SERVICES_JSON` (Firebase config with both apps, turns on native push in the bundles) and
   `PLAY_SERVICE_ACCOUNT_JSON` (Play Console > Users and permissions > a service account with "Release to testing tracks").
4. First upload by hand: run the workflow (Actions > Android apps > Run workflow > "Build Google Play bundles"), download the
   `dingogo-<app>-aab` artifacts and upload them in Play Console (this enrols Play App Signing). Later runs can upload to the
   internal track as drafts by choosing `internal`.
5. App Links: Play Console > Test and release > App integrity > App signing: copy the **app signing key** SHA-256 for the rider
   app (and the upload key's, for internal testing) into Vercel `ANDROID_APP_LINK_CERTS` (comma separated), redeploy, and check
   `https://<site>/.well-known/assetlinks.json`. Test APKs (public test key) are never trusted: links open in the browser there.
6. Play Console > App content: privacy policy `https://<site>/legal/privacy`, account deletion `https://<site>/delete-account`,
   Data safety (answers in `docs/store/data-safety.md`), content rating questionnaire, target audience 18+, app access (demo
   accounts), ads: none. Store listing: `docs/store/listing.json`; graphics: `npm run store:screenshots` (below).

**Each release:** bump `version` in `apps/rider/package.json` / `apps/driver/package.json` (the version name), run the workflow
with "Build Google Play bundles" (the version code is the workflow's run number, so it always rises), check the job's
"Check the signature" step printed the upload key's SHA-256, then promote internal > closed > production in Play Console.

**Store graphics:** `node scripts/build-vercel.mjs && npm run db:reset -w services/api && npm run store:screenshots` writes
1080×1920 screenshots of both apps on demo data, the 1024×500 feature graphics and 512×512 icons to `store-shots/` (needs
Playwright; map tiles need internet). Icons' themed (monochrome) layers come from `npm run android:assets` after artwork changes.

**Permission explanations:** the driver app explains location (Google Play's prominent disclosure) and trip-offer
notifications before the phone asks; answers are stored on the phone and recorded (`permission_disclosures`, migration 025,
in each person's data export). Changing the wording in `packages/shared/src/permissions.ts` needs a new `version` (asked again).
