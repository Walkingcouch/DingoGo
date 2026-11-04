# DingoGo Rideshare & Courier — platform

Aboriginal-owned, 100% electric rideshare and courier for Alice Springs (Mparntwe), NT.
This repository is the whole platform: one API and database, five apps and the public website.

| Part | Folder | Dev port | Who uses it |
| --- | --- | --- | --- |
| API + realtime + dispatch | `services/api` | 4000 | everything |
| Public website | `apps/web` | 5173 | public, share-trip tracking links |
| Rider app (iOS / Android / web) | `apps/rider` | 5174 | customers |
| Driver app (iOS / Android / web) | `apps/driver` | 5175 | drivers |
| Admin & dispatch console | `apps/admin` | 5176 | DingoGo staff |
| Partner portal | `apps/partner` | 5177 | partner cafés (reward redemption, voucher sales) |
| Roof LED display player | `apps/roof-display` | 5178 | screen in each car |
| Shared code, brand, map, icons | `packages/shared` | — | all apps |

## Live

| | URL |
| --- | --- |
| Website | https://dingogo-steel.vercel.app |
| Rider / driver / admin / partner apps | `/rider`, `/driver`, `/admin`, `/partner` on the same domain |
| API | `/api` (Vercel function, region syd1) → Supabase Postgres `dingogo` (ap-southeast-2) |
| Android test builds | GitHub release `android-latest` (built by `.github/workflows/android.yml` on every push) |

Deploy = `node scripts/build-vercel.mjs` (Vercel runs it). Database changes go in `services/api/migrations/` and are applied to Supabase.

## Quick start (local)

Needs Node 22+ and PostgreSQL 14+ (or `docker compose` — see Deploy).

```bash
createdb dingogo                                   # or use any Postgres URL
export DATABASE_URL=postgres://USER:PASS@localhost:5432/dingogo
npm install
npm run db:setup                                   # migrations + demo data
npm run dev:api                                    # http://localhost:4000
npm run dev:web    # and/or dev:rider, dev:driver, dev:admin, dev:partner, dev:roof
npm test                                           # 16 end-to-end API tests (needs a throwaway DB: they reset it)
```

Demo sign-ins (development only — any SMS code is shown on screen, and `000000` always works):

| Role | Mobile |
| --- | --- |
| Admin | 0400 000 001 |
| Dispatcher | 0400 000 002 |
| Rider (has points, credit, business account) | 0400 000 100 |
| Drivers (approved, each with a BYD Dolphin) | 0400 000 011, 012, 013 |
| Driver applicant (missing documents) | 0400 000 014 |
| Café partner | 0400 000 300 |

Roof display demo: `http://localhost:5178/?key=led_demo_vehicle_one_key&api=http://localhost:4000`
Prepaid voucher codes to try in the rider app: `DGDEMO2026` ($20), `DGDEMO5000` ($50). Promo: `WELCOME`.

All partner businesses, advertisers and people in the demo data are fictional.

## What the platform does

**Riders:** book rides, pet-friendly rides, parcels (S/M/L), fixed-price tours and event hire; upfront itemised prices with GST and the NT passenger levy; schedule ahead; assistance-animal, women-preferred driver and NDIS options; live tracking; trip PIN; share-trip link; SOS (000 + alert to DingoGo and emergency contact); tips, ratings, tax invoices; Dingo Points, café rewards with QR codes, referrals, DingoGo Pass subscription; DingoGo credit and prepaid vouchers; data export and account deletion.

**Drivers:** onboarding against NT accreditation requirements with document upload; can't go online until licence, H endorsement, ABN, GST, vehicle CVL, rego and insurance are current; offers with countdown and earnings; PIN-verified pickups; courier proof of delivery (recipient PIN, signature or photo); SOS; earnings with fee, tips, lease and charging; GST-on-fares figure for the BAS; charging and battery logs.

**Dispatch:** nearest eligible driver, 20-second offers, automatic re-offer. EV-aware: skips cars whose battery (rated range × charge × 0.7 heat derate) can't cover pickup + trip + 40 km reserve. Scheduled trips released 15 minutes ahead. Route-deviation safety alerts.

**Admin:** live map, dashboard, trips with timeline/refunds, phone bookings for customers without smartphones, drivers & document review, fleet & expiries, charging reimbursement, payouts & weekly lease deductions, pricing/zones/promos/plans/holidays/tours, loyalty partners & settlement, vouchers, roof ad campaigns & billing, business/NDIS accounts with monthly statements, SOS & compliance flags, support, inbound enquiries, NT levy and GST reports, broadcast (opt-in only), settings, audit log.

## Business rules (all editable in admin → Pricing / Settings)

| Rule | Default | Source |
| --- | --- | --- |
| Ride fare | $3.00 + $1.60/km + $0.25/min + $1 booking + $1 NT levy; min $10; 20% 10pm–5am | set under taxi day tariff ($5.30 + $2.45/km) |
| Platform fee | 25% of trip fare (driver keeps 75%; 100% of tips) | March 2026 business plan |
| Cancellation | free within 2 min, then $3; tours free until 48 h before, then 50%; hire 24 h | March 2026 draft rider terms |
| Cash | off for rides, on for parcels | draft terms say rides are in-app only — confirm with NT |
| Points | earn 10 per $1; 100 points = $1 off (max 50% of a fare) | |
| Roof screens | on in demo; switch `roof_display.mode` to `off` until NT approval | NT "available for hire" rule |

## Mobile apps (iOS / Android)

Rider and driver apps are React + Vite wrapped with **Capacitor 6**:

```bash
cd apps/rider            # or apps/driver
VITE_API_URL=https://api.dingogo.com.au npm run build
npx cap add android && npx cap sync android && npx cap open android   # needs Android Studio
npx cap add ios && npx cap sync ios && npx cap open ios               # needs a Mac with Xcode
```

They also install from the browser as web apps (PWA) — useful for testing before store approval.

## Deploy

- **Docker (everything on one server):** `npm run build`, then `cd deploy && docker compose up --build`. Postgres, API on :4000 and the six apps on :8080–8085 behind Caddy.
- **Managed:** Postgres on Supabase (paste its connection string into `DATABASE_URL`), API on any Node host (Render, Fly, Railway, a VPS — it needs WebSockets and a long-running process for dispatch), static apps on Vercel/Netlify/Cloudflare Pages with `VITE_API_URL` set.
- CI: `.github/workflows/ci.yml` runs typecheck, API tests and builds.

## Before going live

1. **Accounts & keys** (`services/api/.env.example`): Stripe (card payments; mock until set), Twilio (SMS codes, parcel PINs, SOS texts), a commercial map tile provider (`VITE_TILE_URL` — OpenStreetMap's servers aren't for production), a self-hosted OSRM routing server (`OSRM_URL`; otherwise distance is estimated), Expo/FCM push.
2. Set `OTP_DEV_MODE=false` and a long random `JWT_SECRET`.
3. Move uploads (`UPLOAD_DIR`) to Supabase Storage or S3.
4. Wire Stripe PaymentSheet in the rider app (card capture is mocked today) and register push tokens.
5. Legal review of the website's draft privacy policy, terms, cancellation policy and prohibited items.
6. NT approvals: dispatch network, operator accreditation, CVLs, driver H endorsements; written answers on roof screens, cash and tours (see the gap analysis).
7. Arrernte translations with community input; app store listings.

## Docs

- `docs/API.md` — every endpoint and realtime event.
- `docs/screenshots/` — cross-app run (driver accepts in-app, rider sees it live, admin map, website tracking, roof screen).
- `apps/*/screenshots/` — every screen of every app.
