# DingoGo Rideshare & Courier — platform

Aboriginal-owned rideshare and courier for Alice Springs (Mparntwe), NT. Local drivers in their own cars; electric and hybrid cars get trips first, and an electric fleet is the goal.
This repository is the whole platform: one API and database, five apps and the public website.

| Part | Folder | Dev port | Who uses it |
| --- | --- | --- | --- |
| API + realtime + dispatch | `services/api` | 4000 | everything |
| Public website | `apps/web` | 5173 | public, share-trip tracking links |
| Rider app (iOS / Android / web) | `apps/rider` | 5174 | customers |
| Driver app (iOS / Android / web) | `apps/driver` | 5175 | drivers |
| Admin & dispatch console | `apps/admin` | 5176 | DingoGo staff |
| Partner portal | `apps/partner` | 5177 | partner cafés (reward redemption, voucher sales, stats, monthly statements) |
| Roof LED display player | `apps/roof-display` | 5178 | screen in each car |
| Shared code, brand, map, icons | `packages/shared` | — | all apps |

## Live

| | URL |
| --- | --- |
| Website | https://dingogo-steel.vercel.app |
| Rider / driver / admin / partner apps | `/rider`, `/driver`, `/admin`, `/partner` on the same domain |
| API | `/api` (Vercel function, region syd1) → Supabase Postgres `dingogo` (ap-southeast-2) |
| Android test builds | GitHub release `android-latest` (built by `.github/workflows/android.yml` on every push); Google Play bundles by hand from the same workflow |

Deploy = `node scripts/build-vercel.mjs` (Vercel runs it). Database changes go in `services/api/migrations/`; with `AUTO_MIGRATE=true` the API applies
them at cold start (advisory-locked), or run `npm run db:migrate`. **New or lost database:** `npm run db:bootstrap` (migrations, RLS, production base
data, first admin from `BOOTSTRAP_ADMIN_PHONE`; no demo data) — see `docs/OPERATIONS.md` for the full runbook, health checks
(`/api/health/deep`), logs, Sentry and backups (`npm run db:backup`).

## Quick start (local)

Needs Node 22 (`.nvmrc`; `nvm use`) and PostgreSQL 14+ (or `docker compose` — see Deploy).

```bash
createdb dingogo                                   # or use any Postgres URL
export DATABASE_URL=postgres://USER:PASS@localhost:5432/dingogo
npm install
npm run db:setup                                   # migrations + demo data (local databases only)
npm run dev:api                                    # http://localhost:4000
npm run dev:web    # and/or dev:rider, dev:driver, dev:admin, dev:partner, dev:roof
npm test                                           # 243 API, money, tax, loyalty, tours, fleet, support, business, website, store-readiness and toolchain tests (needs a throwaway DB: they reset it, and create/drop scratch databases)
node scripts/build-vercel.mjs && npm run db:reset -w services/api && npm run smoke   # browser smoke test: rider books, driver completes, admin approves a car (built apps + serverless API; Playwright)
node scripts/a11y-check.mjs                        # WCAG 2.2 AA check (axe-core + Playwright) of the website and rider app; needs api, web and rider running
```

Demo sign-ins (development only — any SMS code is shown on screen, and `000000` always works):

| Role | Mobile |
| --- | --- |
| Admin | 0400 000 001 |
| Dispatcher | 0400 000 002 |
| Rider (has points, credit, business account) | 0400 000 100 |
| Drivers (approved, each with an electric demo car) | 0400 000 011, 012, 013 |
| Driver applicant (missing documents) | 0400 000 014 |
| Café partner | 0400 000 300 |

Roof display demo: `http://localhost:5178/?key=led_demo_vehicle_one_key&api=http://localhost:4000`
Prepaid voucher codes to try in the rider app: `DGDEMO2026` ($20), `DGDEMO5000` ($50). Promo: `WELCOME`.

All partner businesses, advertisers and people in the demo data are fictional.

## What the platform does

**Riders:** book rides, pet-friendly rides, parcels (S/M/L, weight checked, prohibited-items checklist, safe place with photo, pickup windows, recipient ETA texts, failed deliveries returned to the sender with one-tap re-booking), business deliveries (multi-drop runs for one driver, CSV import, dashboard and CSV export for business accounts), fixed-price tours (itinerary with cultural protocols, start times, heat and closure advisories, outback safety advice, hotel pickup, Aboriginal-guided tours, card deposit, tour pages in German, French, Italian, Japanese, Korean and Chinese as flagged machine translations), hourly hire booked in the app and hire quotes accepted by link; upfront itemised prices with GST and the NT passenger levy; schedule ahead; assistance-animal, women-preferred driver and NDIS options; accessibility profile shared with the driver (Deaf/hard of hearing, low vision, mobility aid), assistance-animal refusal reports; live tracking with spoken status updates, in-trip messages with the driver (quick replies; masked calls through a DingoGo number when set up), notification settings with separate offers consent and STOP by text; a "no signal" mode that keeps the last trip on screen; trip PIN; share-trip link; trusted contacts who get the live trip automatically (every trip or night trips) or on demand; "Are you OK?" check-ins on long stops and route deviations that alert the safety team and contacts when unanswered; SOS (000 + alert to DingoGo and contacts) with an emergency card that says what to tell 000; safety reports with categories and photos; suspensions and bans with appeals; tips, ratings, tax invoices; Dingo Points with tiers (more points after 10 and 30 trips a year), points history and expiry warnings, opt-in birthday and weekly-streak bonuses, café rewards with QR codes, referrals, DingoGo Pass subscription; DingoGo credit, prepaid vouchers and gift vouchers bought in the app (texted or printed as a QR card); data export and account deletion; simple mode (big pictures, short words, spoken status); concession fares (when switched on); Arrernte place names in search; app words in Arrernte and Kriol (community drafts); organisations that book rides for them, which they can stop. Business accounts: cost centres, trip purposes and PO numbers on account trips, booking for a colleague or guest (texted), approvals of trips over an amount, regular trips (dialysis, clinics) that skip public holidays, spend by cost centre, purpose and traveller, and monthly invoices to download. Help centre with searchable answers; "Get help with this trip" (instant fare check against the GPS track, lost property with the driver told at once, messages and masked calls kept open, courier return); support messages with replies and a rating.

**Drivers:** onboarding against NT accreditation requirements with document upload; fatigue limits (12 h then a rest, regular breaks; admin-configurable) and an optional daily photo check before going online; trusted contacts and safety reports; can't go online until licence, H endorsement, ABN, GST, vehicle CVL, rego and insurance are current; offers with countdown, their pay and total km (incl. the drive to the pickup); PIN-verified pickups; courier proof of delivery (recipient PIN, signature or photo); SOS; earnings with fee, pickup pay, tips, car agreement (weekly lease or rent-to-own: this week, owing, left to own), charging, hours on trips and earnings-floor progress; GST-on-fares figure for the BAS; charging and battery logs; leave for Sorry Business, cultural business or family that never counts against them. Help screen, "Get help" on each trip (found items, pay questions), lost property cases to answer, support messages with replies.

**Dispatch:** nearest eligible driver, 20-second offers, automatic re-offer; if a driver pulls out before pickup the trip goes to the next driver (repeat cancellers flagged), and ops are alerted when a driver on a trip goes silent. EV-aware: skips cars whose battery (rated range × charge × 0.7 heat derate) can't cover pickup + trip + 40 km reserve. Scheduled trips released 15 minutes ahead. Route-deviation safety alerts.

**Admin:** live map, dashboard, trips with timeline/refunds, phone bookings for customers without smartphones, drivers & document review, fleet & expiries, charging reimbursement (home at a per-kWh rate, public at cost up to a limit, monthly cap), payouts & weekly lease deductions, fleet programme (off until the fleet launches: weekly-lease and rent-to-own agreements that never take a driver below zero with arrears, pauses and buy-out; maintenance schedule with heat battery checks, downtime and spare cars; insurance and claims; profit per car; investor shares), pricing/zones/promos/plans/holidays/tours, tours & hire (bookings, heat/closure advisories, Aboriginal guides and their payments, hotel and visitor-centre commissions, deposit and hire policy, hire quotes), loyalty programme (expiry, tiers, bonuses, referral rules), win-back offers to lapsed riders, partner settlement with paid statements, vouchers (QR cards, sold-before-use shop cards), roof ad campaigns & billing, business/NDIS/government/community accounts (website applications approved in admin, monthly numbered tax invoices with PDF, paid/void, overdue reminders, Xero and MYOB exports; community, health and NDIS organisations book rides for clients with recorded consent), concession fares and the card queue, SOS & compliance flags, safety reports, check-ins, driver hours, photo checks, account standing and appeals, safety policy, support desk (ticket threads with owners, priorities and due times, internal notes, canned replies, satisfaction scores, lost property cases, automatic fare checks with refunds within set limits, chargeback evidence packs), inbound enquiries, NT levy and GST reports, broadcast (opt-in only), settings, audit log.

## Business rules (all editable in admin → Pricing / Settings)

| Rule | Default | Source |
| --- | --- | --- |
| Ride fare | $3.00 + $1.60/km + $0.25/min + $1 booking + $1 NT levy; min $10; 20% 10pm–5am | set under taxi day tariff ($5.30 + $2.45/km) |
| Platform fee | 25% of trip fare (driver keeps 75%; 100% of tips). Admin → Pricing → Driver pay can set a lower rate for own cars and for electric/hybrid cars (both 25% until changed) | March 2026 business plan |
| Driver pay extras | Off until switched on: pickup pay after the first 2 km (funded by a rider "Long pickup" charge), fuel surcharge (all to the driver), weekly earnings floor ($32 per hour on trips) | Nov 2026 owner direction |
| Cancellation | free within 2 min, then $3; tours free until 48 h before (and 10 min after booking, and on advisory days), then 50%, 20% card deposit counted first; hire 24 h | March 2026 draft rider terms |
| Cash | off for rides, on for parcels | draft terms say rides are in-app only — confirm with NT |
| Points | earn 10 per $1 (1.25x Silver, 1.5x Gold); 100 points = $1 off (max 50% of a fare); expire after 12 months with no activity, after a warning | |
| Car agreements | weekly lease $113.33/wk (EV Direct Finance estimate) or rent-to-own; taken each Monday, never below the driver's balance, catch-up up to 150% a week, flagged after 2 weeks owing | Round 20 |
| Charging paid back | DingoGo cars only: home 30c/kWh, public at cost up to 80c/kWh, depot not paid back, max $250/month | Round 20 |
| Roof screens | on in demo; switch `roof_display.mode` to `off` until NT approval | NT "available for hire" rule |

## Mobile apps (iOS / Android)

Rider and driver apps are React + Vite wrapped with **Capacitor 8** (Android: target and compile API 36, minimum API 24; AGP 8.13, Gradle 8.14.3, Java 21):

```bash
cd apps/rider            # or apps/driver
VITE_API_URL=https://api.dingogo.com.au npm run build
npx cap add android && npx cap sync android && npx cap open android   # needs Android Studio
npx cap add ios && npx cap sync ios && npx cap open ios               # needs a Mac with Xcode
```

They also install from the browser as web apps (PWA) — useful for testing before store approval.

Google Play (Round 21): signed bundles from the Android workflow ("Build Google Play bundles", upload key in GitHub Actions
secrets), store copy, Data safety draft and iOS notes in `docs/store/`, screenshots with `npm run store:screenshots`. Steps and the
owner's checklist: `docs/OPERATIONS.md` section 11.

## Deploy

- **Docker (everything on one server):** `npm run build`, then `cd deploy && docker compose up --build`. Postgres, API on :4000 and the six apps on :8080–8085 behind Caddy.
- **Managed:** Postgres on Supabase (paste its connection string into `DATABASE_URL`), API on any Node host (Render, Fly, Railway, a VPS — it needs WebSockets and a long-running process for dispatch), static apps on Vercel/Netlify/Cloudflare Pages with `VITE_API_URL` set.
- CI: `.github/workflows/ci.yml` runs typecheck, API tests, builds and the browser smoke test (`scripts/smoke-e2e.mjs`: rider books a ride, driver accepts and
  completes it, admin approves a car, against the Vercel build with the bundled serverless API).

## Before going live

1. **Accounts & keys** (`services/api/.env.example`): Stripe (card payments; mock until set), Twilio (SMS codes, parcel PINs, SOS texts, a relay number for masked rider/driver calls and texts, STOP handling — see `docs/API.md` → Notifications), a commercial map tile provider (`VITE_TILE_URL` — OpenStreetMap's servers aren't for production), a self-hosted OSRM routing server (`OSRM_URL`; otherwise distance is estimated), push: `FCM_SERVICE_ACCOUNT` for the Android apps (build them with `google-services.json` and `VITE_FCM_ENABLED=true`) and a VAPID pair for the web apps (`npm run vapid -w services/api`).
2. Set `OTP_DEV_MODE=false` and a long random `JWT_SECRET`.
3. Move uploads (`UPLOAD_DIR`) to Supabase Storage or S3.
4. Stripe: set `STRIPE_SECRET_KEY`, `STRIPE_PUBLISHABLE_KEY` and `STRIPE_WEBHOOK_SECRET`, apply migration 014, and add the webhook endpoint
   `/api/payments/stripe/webhook` in the Stripe dashboard (events listed in `docs/API.md` → Payments). Without Stripe, only demo/test accounts can pay by
   card (test payments); everyone else is shown "card payments coming soon". Register push tokens.
5. Legal review of the website's draft privacy policy, terms, cancellation policy and prohibited items.
6. NT approvals: dispatch network, operator accreditation, CVLs, driver H endorsements; written answers on roof screens, cash and tours (see the gap analysis).
7. Arrernte and Kriol words: the drafts in `packages/shared/src/i18n/strings.json` need review by community speakers (`npm run i18n:review` makes a sheet); app store listings.

## Docs

- `docs/API.md` — every endpoint and realtime event.
- Website SEO and growth: page list, structured data and sitemap in `apps/web/src/seo.ts`, FAQs in `apps/web/src/faqs.ts`; optional
  cookie-free analytics with `VITE_ANALYTICS_DOMAIN` (see `docs/API.md` → Website, SEO and growth).
- `docs/OPERATIONS.md` — bootstrap a new database, migrations, health checks, logs and error reporting, backups and restore.
- `docs/screenshots/` — cross-app run (driver accepts in-app, rider sees it live, admin map, website tracking, roof screen).
- `apps/*/screenshots/` — every screen of every app.
