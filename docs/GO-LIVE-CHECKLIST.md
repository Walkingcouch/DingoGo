# DingoGo go-live checklist

One list of everything that has to happen, be set up or be confirmed before real riders and drivers use DingoGo. Collected in Round 29
from every "decision needed", "check with the owner/accountant" and "placeholder" note in rounds 1–28 (`docs/improvement-rounds.md`).

The running system checks part of this itself: **admin → Reports → Go-live checks** (and `launch` in `/api/health/deep` with
`X-Health-Token`) lists the server settings, keys and placeholders it can see, and the Dashboard says "Not ready for real riders yet"
until the must-do items pass. Everything the system can't see (legal review, NT approvals, community agreement) is only here.

Legend: **Where** = where the setting lives. "Vercel" = Project → Settings → Environment Variables (Production), then redeploy.

---

## 1. Must do before launch

### 1a. Deploy day (the coordinator)

| # | Step | Where |
|---|------|-------|
| 1 | New Supabase project in Sydney (`ap-southeast-2`); note the session pooler (5432) and transaction pooler (6543) URLs. | Supabase |
| 2 | Vercel variables: `DATABASE_URL` (transaction pooler), `AUTO_MIGRATE=true`, `BOOTSTRAP_ADMIN_PHONE` (an owner's real mobile, not 0400 000 0xx), `BOOTSTRAP_ADMIN_NAME`, `HEALTH_TOKEN` (long random), `JWT_SECRET` (32+ random characters; **the API refuses to start on Vercel without one, or with the `.env.example` placeholder**), `PUBLIC_WEB_URL` (https address of the website), `CORS_ORIGINS` (the site, `capacitor://localhost`, `http://localhost`). Leave `OTP_DEV_MODE`, `OTP_DEMO_PREFIXES`, `MOCK_CARDS` and `DEMO_DATA` **unset**. | Vercel |
| 3 | Deploy. The first request builds the empty database: every migration (001–028), Row Level Security on every table, Supabase `anon`/`authenticated` locked out, base data (Alice Springs zone, fares, NT rules, holidays, tours, roof screens **off**, community routes **closed**) and the admin. Or run `npm run db:bootstrap` with `MIGRATION_DATABASE_URL` from a computer first (OPERATIONS.md 1). | Vercel / OPERATIONS.md 1 |
| 4 | Check `GET /api/health/deep` with `X-Health-Token`: `status: "ok"`, schema `028_regional.sql`, no tables without RLS, `base_data.admins: 1`. | Uptime monitor |
| 5 | The owner signs in at `/admin`. Before Twilio is connected, admin and dispatcher accounts can still sign in: the code is written to the Vercel function log (search `sms:dev`); nobody else can sign in until Twilio is set up. | `/admin` |
| 6 | Set up a backup schedule before real data arrives (Supabase's free plan has no backups; OPERATIONS.md 5) and an uptime monitor on `/api/health/deep`. | OPERATIONS.md 3, 5 |
| 7 | Rehearse locally first if anything in the build changed: `createdb x && DATABASE_URL=…/x node scripts/first-day.mjs` walks this whole first day on an empty database in a browser. | Repo |

Environment changes made in Round 29 that matter at deploy: on Vercel the API now uses production defaults whatever `NODE_ENV` says
(no on-screen sign-in codes, mock card payments only for test accounts) and refuses a missing or placeholder `JWT_SECRET`. A preview
deployment pointed at the production database is now safe in the same way. Set `OTP_DEV_MODE=true` only on a throwaway database.

### 1b. Before the first real rider (the owners)

| # | Item | Where |
|---|------|-------|
| 1 | DingoGo's ABN and legal name (base data says `TBC`; tax invoices say "draft" and the SERR report has no operator ABN until then). The ABN is checked with the ATO check digits. | Admin → Settings → Business details |
| 2 | Support phone, email and hours shown to riders (base data has 0432 101 175, contact@aperrke.com.au, 6am – midnight: confirm). | Admin → Settings → Customer support |
| 3 | Twilio connected (sign-in codes, parcel PINs, SOS texts, receipts by text). Without it riders and drivers can't sign in. | Section 2 |
| 4 | Card payments: Stripe live keys and webhook. Without Stripe only test accounts can pay by card; riders can still use DingoGo credit and parcels can be cash. | Section 2 |
| 5 | NT approvals in writing: dispatch network / booking service, operator accreditation, each car's CVL, each driver's H endorsement. Written answers on roof screens, cash for rides and tours. | NT Department of Logistics and Infrastructure |
| 6 | Legal review of the draft privacy policy, terms, cancellation policy and prohibited items on the website. | Website `/legal/*` (`apps/web`) |
| 7 | Roof screens stay **off** until the NT approval is in writing. | Admin → Settings → Roof screens |
| 8 | First drivers onboarded: papers approved (Safety & compliance → Documents to review), car approved (Fleet & charging → Cars to check), then the driver's Status set to Approved (Drivers → open the driver). A driver stays "Documents pending" until that last step. | Admin |
| 9 | Re-enter what lived only in the lost database: promo codes, partner cafés and their logins, business accounts, edited prices. Drivers upload their papers again (uploads were in the database). | Admin |
| 10 | Tell the ops team about the Round 26 change: critical safety reports only hold the other person automatically when they met on a real, recent trip (OPERATIONS.md 7). | Ops briefing |

---

## 2. Accounts and keys

All optional for the API to run; each feature stays off (and says so in admin) until its keys are set. Names only: never commit a key.

| Service | What it turns on | Variables / steps |
|---------|------------------|-------------------|
| **Twilio** (must) | Sign-in codes, PINs, SOS and trip texts, STOP handling | `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` (+61 number, takes replies) or `TWILIO_MESSAGING_SERVICE_SID`; every DingoGo number's Messaging webhook → `https://<site>/api/comms/twilio/sms` (POST); `TWILIO_WEBHOOK_BASE_URL=https://<site>/api` |
| Twilio relay (optional) | Masked calls/texts between rider and driver | `TWILIO_RELAY_NUMBER`; its Voice webhook → `/api/comms/twilio/voice` |
| Twilio marketing | Offers by text (needs a number for STOP) | `TWILIO_MARKETING_FROM` if `TWILIO_FROM` is a sender ID |
| **Stripe** | Real card payments, refunds, disputes | `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY`, `STRIPE_WEBHOOK_SECRET`; Stripe dashboard webhook `https://<site>/api/payments/stripe/webhook` with `payment_intent.succeeded`, `payment_intent.payment_failed`, `payment_intent.canceled`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.closed` |
| Routing | Road distances and times (otherwise estimated) | Self-hosted `OSRM_URL` (recommended) or `ORS_API_KEY` |
| Map tiles | Maps in every app (OpenStreetMap's servers aren't for production) | `VITE_TILE_URL` at build time (commercial tile provider) |
| Push | Notifications when the app is closed | `FCM_SERVICE_ACCOUNT` + `google-services.json` and `VITE_FCM_ENABLED=true` in the Android build; `WEB_PUSH_VAPID_PUBLIC_KEY`/`_PRIVATE_KEY` (`npm run vapid -w services/api`) |
| Sentry | Error reports (no personal data) | `SENTRY_DSN` |
| Resend | Weekly owner summary email | `RESEND_API_KEY`, `EMAIL_FROM` (verified domain); then Insights → Settings → Weekly owner email |
| Uptime monitor | Alerts when the database or a migration fails | Poll `/api/health/deep` with `X-Health-Token: $HEALTH_TOKEN` |
| Analytics (optional) | Cookie-free website analytics | `VITE_ANALYTICS_DOMAIN` (+ `_SRC`/`_API` for self-hosted Plausible) |
| Custom domain | Canonical URLs, sitemap, links in texts | `VITE_SITE_URL`, `PUBLIC_WEB_URL`; submit `/sitemap.xml` to Google Search Console |
| Face match (optional) | Driver photo checks by a provider | `FACE_MATCH_URL`, `FACE_MATCH_KEY` (privacy policy update first: biometrics are sensitive information) |
| Reverse geocoder (optional) | Street address on the SOS emergency card | `REVERSE_GEOCODE_URL` |
| Plate lookup (optional, paid) | Rego lookup in Fleet | `REGCHECK_USERNAME` |
| Google Play | Store releases | OPERATIONS.md 11: developer account, upload key and four GitHub secrets, `ANDROID_APP_LINK_CERTS` after Play App Signing, App content forms |
| Least-privilege DB role (optional) | API can't change the schema | `DB_API_ROLE` + `DB_API_ROLE_PASSWORD` at bootstrap; OPERATIONS.md 1 |

---

## 3. Settings to confirm

Defaults are written into the code and marked as placeholders where they are. Everything below is editable in admin unless it says
otherwise. Placeholders that would cost money or put people at risk start **off** (or closed).

### With the accountant

| Setting | Default | Where |
|---------|---------|-------|
| GST model in the BAS worksheet (DingoGo's supply is its service fee; fares on behalf of GST-registered drivers) | as built | Tax & compliance → BAS |
| NDIS support item number, GST code, provider registration (only if registered) | empty | Tax & compliance → NDIS invoices |
| How business customers pay (bank details on invoices) | empty | Business accounts → Billing settings |
| Xero and MYOB account codes and tax types (do a test import first) | Xero 200 / GST on Income; MYOB 4-1000 / GST | Business accounts → Billing settings |
| Running costs per km by fuel, card fee estimate | estimates | Insights → Settings |
| Points as a liability (outstanding, breakage) | shown, not netted | Insights / Loyalty |
| GST on tour guide fees (depends on the guide's registration) | none | Tours & hire → Guides |
| GST on rent-to-own payments and buy-outs; investor shares of profit or income | recorded as `lease`; share of profit | Fleet & charging → Fleet programme (off) |
| Community store credit (a liability until spent) and whether DingoGo is principal for shuttle seats; GST on shuttle driver pay | "Community shuttles" BAS line | Tax & compliance → BAS |
| Driver tax statement and SERR fields (SERR is due 31 July and 31 January) | as built | Tax & compliance → SERR |

### With the NT Government (and a lawyer where it says)

| Setting | Default | Where |
|---------|---------|-------|
| Passenger levy amount and the monthly due day | $1 a trip; due the 21st | Pricing & tours → States; Tax & compliance → Levy returns |
| Cash for rides (draft terms say in-app only) | off for rides, on for parcels | Settings → Cash and cancellations (Round 30) |
| Roof screens | off | Settings → Roof screens |
| Fatigue limits against NT/SA point-to-point guidance | 12 h online then 6 h rest; 20 min break after 5 h | Safety & compliance → Policy |
| Oldest car allowed | NT 13 years, SA 8 | Pricing & tours → States |
| Women-driver matching (lawyer: Sex Discrimination Act exemption) | DingoGo sets it per driver after an ID check | Drivers → driver → "Matched for female-driver requests" |
| Lost property: unclaimed valuables after 30 days | hand in to police | OPERATIONS.md 9d |
| Concession fares | off | Pricing & tours → Community |

### With the owners (money and policy)

| Setting | Default | Where |
|---------|---------|-------|
| Fares | $3 + $1.60/km + $0.25/min + $1 booking, min $10, 20% 10pm–5am, 15% holidays | Pricing & tours → Fares |
| Service fee by car (owner direction: own car 20%, electric/hybrid 15%) | 25% / 25% until saved | Pricing & tours → Driver pay |
| Pickup pay, fuel surcharge, weekly earnings floor ($32/h on trips) | off | Pricing & tours → Driver pay |
| Cancellation fee and free window | free 2 min, then $3; tours free to 48 h, hire to 24 h, then 50% | Settings → Cash and cancellations (window, tour/hire hours and %); the $3 fee per service under Pricing & tours → Fares |
| Rider no-show fee and driver waiting pay | not built (decision needed) | — |
| Who funds pickup pay on late-cancelled trips | not built (decision needed) | — |
| Driver ledger on refunds (driver at fault) and on refunded tips; points claw-back on refunds | not reversed; DingoGo funds tip refunds | — (decision needed) |
| Automatic fare-check refunds | up to $15, twice per rider in 30 days | Support & inbox → Policy |
| Support reply and resolve times (calendar time: set what the team can cover overnight) | 15 min / 1 h / 4 h / 24 h | Support & inbox → Policy |
| Loyalty: expiry (12 months, 30-day warning), tiers (10 / 30 trips), bonus sizes, referral minimum and cap | as built | Loyalty & vouchers → Programme |
| Win-back offers (opted-in riders, once every 90 days) | manual | Loyalty & vouchers → Win-back |
| Promo codes: a budget on every paid campaign | none in production | Pricing & tours → Promo codes |
| DingoGo Pass prices and perks | $9.99 / $29.99 | Pricing & tours → DingoGo Pass |
| Tours: prices, 20% deposit, 10-minute change of mind, hire day-rate cap (8 h), multi-day discount (10% from 3 days), guide fees, desk commission rates | as seeded | Tours & hire → Deposit & hire; Pricing & tours → Tours |
| Visitor-language tour text (machine translations, flagged) | not reviewed | Pricing & tours → Tours → Visitor-language text |
| Business accounts: monthly limits are hard limits; overdue booking hold | hold off | Business accounts |
| Fleet programme (catch-up limit 150%, arrears flag 2 weeks, charging 30c/kWh home, public up to 80c, $250 a month cap) | off | Fleet & charging → Fleet programme |
| Dispatchers seeing money reports (payouts, GST/levy, settlements, invoices) | yes (decision needed) | — |
| Silent-driver auto-reassign | off (`DRIVER_SILENT_REASSIGN_MIN=0`) | Vercel (needs native background location first) |

### With the communities and the Central Land Council

| Setting | Default | Where |
|---------|---------|-------|
| Community routes (Ntaria, Ltyentye Apurte): **closed on a new database**. Confirm road km, minutes, unsealed km and no-coverage stretches with the community and a driver who has done the drive; check the permit notes with the Central Land Council; agree prices (private $260 / $190, trip back 30% off, seats $40 / $30, parcels) and shuttle driver pay per leg; then tick "checked" and "Taking bookings". Yulara stays off until there's a charging and overnight-rest plan. | closed, unchecked | Community trips → Routes |
| Community stores as partners (kind "Community store") with a login, and the store's id on the route's store pickup point | none | Loyalty & vouchers → Partners; Community trips → Routes |
| Arrernte and Kriol app words (community drafts) reviewed by speakers (`npm run i18n:review`) | drafts | `packages/shared/src/i18n/strings.json` |
| School holiday and event dates (marked "check the date") | unconfirmed | Insights → Settings |
| Public holidays for 2027 onwards (they also decide regular-trip skips) | to Aug 2027 | Pricing & tours → Public holidays |

---

## 4. Nice to have (not blocking launch)

- Uploads to Supabase Storage (they live in Postgres today, so a lost database loses drivers' papers).
- Nightly off-site backup job and a quarterly restore drill.
- Content-Security-Policy in report-only mode for the apps.
- Shorter sessions with refresh tokens and "sign out everywhere" (tokens last 30 days today).
- Australian date pickers (phones already show dd/mm/yyyy; desktop browsers follow their language).
- Native background location in the driver app, then silent-driver auto-reassign.
- Card and business-account payment for shuttle seats and parcels.
- Apple Pay / Google Pay (domain verification) once Stripe is live.

---

## Re-checking

- `node scripts/first-day.mjs` (empty database), `npm run smoke`, `npm run a11y` and `npm run tour` on a demo database: see OPERATIONS.md 2.
- `npm run tour` also runs on a freshly bootstrapped database: `ADMIN_PHONE=<bootstrap admin> RIDER_PHONE=… DRIVER_PHONE=… SKIP_ROLES=partner`.
- Admin → Reports → Go-live checks after every change of keys or settings.
