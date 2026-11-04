# DingoGo product gap audit (November 2026)

Scope: the `/home/claude/dingogo` monorepo (API, rider, driver, admin, partner, roof display and web apps), compared with the 2025–2026 feature sets of Uber, DiDi, Lyft, Bolt, Grab, Shebah, Via/Liftango, Uber Direct, DoorDash Drive, Zoom2u and Sendle. No repository files were changed.

Verification key: **[V]** means I fetched the source page and confirmed the claim. **[S]** means the claim comes only from search-result titles or third-party pages, so treat it as likely but unconfirmed. **[U]** means unverified (based on general knowledge, no source fetched).

---

## 1. Executive summary

- **Uber is entering Alice Springs.** The NT Government announced on 22 Aug 2026 that Uber rideshare is coming "this year". Uber Eats already runs locally and Uber is recruiting drivers ([National Tribune, NT Govt release](https://www.nationaltribune.com.au/uber-rideshare-on-way-for-alice-springs/) [V]; [Alice Springs News, 31 Aug 2026](https://arr.news/2026/09/01/taxis-get-competition/) [V]). Uber for Teens already covers the NT ([Uber AU, 28 Aug 2025](https://www.uber.com/au/en/newsroom/uber-for-teens-au-expansion/) [V]). DingoGo will face the global benchmark at or near launch, not just local taxis.
- **The platform is broad for an MVP.** It covers upfront pricing, scheduling, PIN pickups, share-trip, SOS, courier proof of delivery, EV-aware dispatch, loyalty, café partners, prepaid vouchers, phone booking, NDIS and business accounts, and roof ads. Several things competitors lack are already built in: the CO₂ figure on receipts, the assistance-animal refusal flags, and prepaid voucher cards for people without bank cards.
- **The main gaps against competitors** are:
  - Rider–driver contact: no masked calling or chat.
  - Address search: 24 hard-coded places, no street geocoding, no town camps, no saved places.
  - Multi-stop and split fare.
  - Family, senior and teen profiles.
  - A low-connectivity and offline mode.
  - Self-serve tools for business and courier customers (dashboard, API, Shopify).
  - Driver demand visibility and instant pay.
- **Some issues must be fixed before launch regardless of competitors:**
  1. Payment capture failures are ignored for top-ups and subscriptions, and tips are recorded without any charge.
  2. No rate limiting on OTP requests or voucher redemption.
  3. Driver documents are served without authentication.
  4. Drivers can edit their own licence expiry dates.
  5. A trip fails as "no drivers" about 10 seconds after booking if no car is free.
  6. The website promises cash for rides, but the API refuses it.

---

## 2. Inventory: what exists today

| Area | What's built (key files) |
|---|---|
| **API** (`services/api`) | Fastify + Postgres with ~45 tables (`migrations/001–005`). Phone OTP and JWT auth (`routes/auth.ts`). Upfront fare engine with NT levy, night, holiday, zone, promo, plan, corporate and points adjustments (`lib/fares.ts`, `services/trips.ts`). Nearest-driver dispatch with 20 s offers and an EV range check (×0.7 heat derate, 40 km reserve). Scheduled release 15 min ahead. Route-deviation alerts. Stripe manual-capture holds, or mock payments. Twilio SMS and Expo push, both no-ops until configured. In-memory WebSocket bus. Uploads stored in Postgres. |
| **Rider app** | Booking modes: ride, pet ride, parcel S/M/L, tours and event hire. Book now or schedule (20 min to 60 days ahead). Options: passengers, assistance animal, wheelchair request, women-driver preference, NDIS number, notes, promo, points, payment choice. Live trip map, PIN, share link, SOS (000 plus alert to ops and emergency contact), cancel with fee warning, rating, tip, tax invoice with CO₂. Rewards with QR codes, referrals, Pass subscription, wallet top-up and vouchers. Profile with accessibility flags. Language field exists, but the Arrernte option is disabled. Data export and account deletion. |
| **Driver app** | Onboarding against NT credentials and document upload. Online gating on credentials and battery. Offer card with countdown and earnings. Navigation hand-off to Google/Apple Maps. PIN start. Courier proof of delivery: PIN, signature pad or photo. SOS. Earnings with lease, charging and GST. Charging and battery logs. |
| **Admin** | Live map, dashboard, trips (timeline, refund, redispatch, cancel), phone bookings, users, drivers and document review, fleet, pricing, zones, promos, holidays, plans, tours, loyalty partners, vouchers, ads, business and NDIS statements, SOS, compliance, support, levy and GST reports, opt-in broadcast, settings, audit log. |
| **Partner portal** | Check and redeem reward codes; record voucher card sales. |
| **Roof display** | Geo- and time-targeted ad playlist with offline play log. A kill switch covers NT regulatory risk. |
| **Website** | Home with fare estimator and taxi comparison, rides, parcels, tours, business, drive, advertise, rewards, safety, about, help/FAQ, draft legal pages, public trip tracking. |
| **Tests** | 16 API end-to-end tests (`services/api/test/e2e.test.ts`). There are **no** front-end, accessibility, load or payment-provider tests. |

---

## 3. Quality issues found in the code

### 3.1 Security and fraud (fix before launch)

| # | Issue | Where | Fix |
|---|---|---|---|
| S1 | No rate limiting anywhere. `/auth/otp/request` can be used for SMS pumping (cost) and to harass any phone number. `/wallet/voucher` codes can be brute-forced. `/public/*` forms can be spammed. | `routes/auth.ts`, `routes/rider.ts`, `routes/public.ts`; no `@fastify/rate-limit` installed | Per-IP and per-phone limits, Twilio Verify fraud guard, a CAPTCHA on public forms, and a voucher attempt lockout. |
| S2 | `OTP_DEMO_PREFIXES` lets any matching number sign in with `000000` **in production**. | `config.ts`, `routes/auth.ts` | Refuse to start when `NODE_ENV=production` and the setting is non-empty, or restrict it to exact numbers. |
| S3 | `JWT_SECRET` silently falls back to `dev-only-change-me`. Tokens last 30 days with no revocation. The WebSocket accepts a token without checking whether the user is blocked or deleted. The token is sent in the WS query string, so it ends up in logs. | `config.ts`, `auth.ts`, `index.ts` | Fail fast without a secret. Use short access tokens with refresh. Run `loadUser` on WS connect. |
| S4 | `GET /uploads/:name` has **no authentication**. Driver licences, police checks and proof-of-delivery photos are public to anyone with the URL. | `routes/uploads.ts` | Check owner, admin or trip party; or use signed, expiring URLs. |
| S5 | Drivers can `PATCH /driver/me` their own `licence_expiry` and `h_endorsement_expiry`. `complianceIssues()` trusts those fields, so after approval a driver could extend expired credentials themselves. | `routes/driver.ts` | Make expiry dates admin-verified fields set only by document review. |
| S6 | Bank BSB and account number are stored as plaintext columns. | `drivers` table | Encrypt at the column level, or tokenise through Stripe Connect. |
| S7 | `CORS_ORIGINS` defaults to `*`. There are no security headers (helmet). The display key is accepted in the query string. | `index.ts`, `routes/display.ts` | Explicit origin list, `@fastify/helmet`, header-only display key. |

### 3.2 Money correctness

| # | Issue | Where |
|---|---|---|
| M1 | **Wallet top-up and Pass subscription ignore the result of `capture()`.** In Stripe mode, `authorise()` is called without a customer or payment method, so the PaymentIntent is never confirmed. Capture then fails, but the wallet is still credited and the plan still activated. The result is free credit. | `routes/rider.ts` (`/wallet/topup`, `/subscriptions`) |
| M2 | **Tips charge nobody.** `addTip` writes a `payments` row with `status 'succeeded'` and credits the driver ledger, but never calls Stripe. | `services/trips.ts` `addTip` |
| M3 | The Stripe authorisation is called inside the database transaction. If the transaction rolls back, the card hold is never released. | `createTrip` |
| M4 | The Pass never renews. There is no recurring billing and no reminder before `period_end`. | `subscriptions` |
| M5 | Payouts are ledger entries only ("ABA batch" text). There is no bank file export, no Stripe Connect and no instant pay. | `routes/admin.ts` payouts |

### 3.3 Dispatch and reliability

- **Trips fail after about 10 seconds when no car is free.** `dispatchTrip` increments `dispatch_attempts` even when there are no candidates, and `dispatchTick` runs every 2 s with `maxAttempts=5`. With three cars, every busy moment produces "No drivers available". Competitors queue the request, offer "next car in ~N min", or convert it to a scheduled booking.
- Matching uses straight-line distance ×1.3 rather than ETA, offers go to one driver at a time, and there is no batching or chaining of trips (for example, a near-finished trip ending close to the pickup).
- The realtime bus is in memory and single-process. In serverless mode WebSockets are off and the apps fall back to polling.
- **No offline support.** The rider and driver apps have `manifest.webmanifest` but no service worker. Driver location pings and the "complete with POD photo" call fail without signal and have no retry queue, which matters on tours to the West MacDonnell Ranges and at the edge of town.

### 3.4 UX, content and accessibility

- **Cash contradiction.** The API default is `cash_payments.ride=false`, but the website says "Cash is welcome too" (`pages/Home.tsx:88`), and Help (`pages/Help.tsx:12–13`), Rides (`pages/Rides.tsx:44`) and Rewards (`pages/Rewards.tsx:22`) promise cash for rides.
- **Address search is a fixed list of 24 POIs** (`lib/places.ts`). There is no street-address geocoding, none of the 17 Tangentyere-governed town camps ([Wikipedia](https://en.wikipedia.org/wiki/Alice_Springs_town_camps) [V]), and no saved Home/Work/favourite places.
- **No rider–driver contact.** `viewFor()` correctly hides phone numbers, but there is no masked-call relay or chat to replace them. That is a real problem where addresses are informal.
- **i18n.** All strings are hard-coded English. The Arrernte option is `disabled`, and there is no translation framework, so adding languages later means touching every screen.
- Emoji are used as service icons (rider mode buttons, website service list). They render inconsistently and are read aloud by screen readers.
- There is no large-text or simple mode, and nothing checks `prefers-reduced-motion` for the pulsing live dot. The good news: the place combobox is accessible, and there is a skip link and `aria-live` on the estimator.
- There are no email receipts or PDF invoices; the receipt exists only in the app.
- The `corporate_admin` role exists, but there is no business self-serve portal. Business customers have to ask DingoGo staff for everything.

---

## 4. Competitor landscape

| Competitor | Notable 2025–26 capabilities relevant to DingoGo |
|---|---|
| **Uber** | **2025 driver features:** Rides Heatmap, Destination Mode with flexible route, Rider Rating Preferences, Delayed Ride Guarantee, redesigned offer card with stop details, multi-order courier flow, tip guarantee ([Uber "Only on Uber 2025"](https://www.uber.com/us/en/newsroom/onlyonuber25/) [V]). **Senior accounts and Simple mode**, rolling out across Australia from Jul 2025 ([Uber AU](https://www.uber.com/en-AU/newsroom/senioraccount_simplemode) [V]). **Teens**: PIN on every trip, parent tracking, three-way chat ([Uber AU](https://www.uber.com/au/en/newsroom/uber-for-teens-au-expansion/) [V]). **Women Rider Preference** for women and non-binary drivers, AU since 2022 ([Uber AU](https://www.uber.com/au/en/newsroom/womenriderpreference/) [V]). **Riders:** up to 5 extra stops ([Uber Help](https://help.uber.com/h/26f09874-91e9-4fe1-9537-ec680a47ecbe) [V]) and Split Fare ([Uber ZA](https://www.uber.com/en-ZA/blog/share-journey-split-cost-ride-sustainably) [V]). **Airports:** Reserve with flight tracking and 60 min included wait ([Uber AU](https://www.uber.com/au/en/newsroom/travelfeatures/) [V]); airport rematch and queue zones ([Uber AU](https://www.uber.com/en-AU/blog/priority-airport-rematches-with-uber-pro) [V]). **Driver planning:** Earnings Trends map ([Uber NZ](https://www.uber.com/en-NZ/blog/introducing-earnings-trends-easily-decide-when-and-where-to-drive/) [V]). **EV:** EV Hub and charging map ([CleanTechnica](https://cleantechnica.com/2022/05/18/uber-announces-new-ev-hub-ev-charging-map-comfort-electric/) [V]); battery-aware matching planned ([TaxiPoint](https://www.taxi-point.co.uk/post/new-battery-aware-feature-will-match-uber-users-based-on-vehicle-charge-levels-and-length-of-ride) [V]). **Uber One** at A$9.99/month with 5% credits ([ShopBack](https://www.shopback.com.au/blog/savings/uber-one-worth-australia) [V, third-party]). **Business:** branded vouchers sent from the dashboard ([Uber AU](https://www.uber.com/en-AU/blog/u4b-anz-expands-vouchers-to-enhance-customer-experiences) [V]). **Assist** drivers trained by the Australian Network on Disability ([Uber AU](https://www.uber.com/en-AU/newsroom/regionalvicassisstlaunch) [V]). **Recording:** encrypted audio recording ([Uber](https://www.uber.com/au/en/safety/audiorecording/) [V]; AU states per the teens page); Record My Ride video ([PYMNTS](https://pymnts.com/news/ridesharing/2024/uber-to-launch-rider-verification-and-record-my-ride-nationwide) [S]). **Phone booking:** 1‑833‑USE‑UBER ([TechCrunch](https://techcrunch.com/2023/05/17/you-can-now-hail-an-uber-by-calling-a-number) [S]). |
| **DiDi (AU)** | SOS, Unmatch Drivers, Private Numbers, Hidden Addresses after the trip, Facial Verification, TripCheck, Trusted Contacts, Driver Fatigue Prevention, **TripChoice** (female drivers matched only with female riders), Preview Driver, audio recording in some states ([DiDi AU](https://web.didiglobal.com/au/safety/rider-safety/) [V]). Driver-side cash-out and heat maps [U]. |
| **Lyft** | **Price Lock**, a fixed price for regular trips, extended to late night in Feb 2025 ([Lyft](https://www.lyft.com/blog/posts/price-lock-around-the-clock) [V]). **Lyft Silver** for older riders: easy-entry vehicle matching, live human phone support, trip sharing ([POLIS](https://www.polisnetwork.eu/news/uber-and-lyft-target-us-senior-riders-with-simpler-more-accessible-apps/) [V]). **Women+ Connect** ([NBC](https://www.nbcnews.com/tech/tech-news/lyft-adds-feature-match-women-nonbinary-riders-drivers-gender-rcna104596) [S]). |
| **Bolt** | Trusted Contacts whom the safety team calls if it can't reach the user, Ride Check, Emergency Assist ([Daily News](https://dailynews.co.za/technology/mobile-apps/2025-02-11-bolts-new-trusted-contacts-feature-enhances-safety-for-riders-and-drivers) [V]). Women-only options in several EU cities ([Brussels Times](https://brusselstimes.com/brussels/2003221/women-for-women-bolt-launches-new-women-only-ride-option-in-brussels/) [S]). |
| **Grab** | **AI Call-A-Ride**: voice booking by phone for seniors, with a "Track My Ride" SMS link after booking (Aug 2026) ([Grab](https://www.grab.com/sg/inside-grab/stories/book-your-grab-ride-with-an-ai-powered-call-service/) [V]). GrabAssist for seniors and people with disability ([Grab press](https://www.grab.com/sg/press/business/grab-expands-vehicle-service-options-with-grabassist-grabcar-plus-and-grabfamily-ages-1-3/) [S]). |
| **Shebah** | Women and children only, child seats at A$11.32, up to 5 preferred drivers, rules for unaccompanied minors with guardian contact links, booking up to 30 days ahead ([Shebah FAQ](https://shebah.com.au/faqs/) [V]). |
| **Via / Liftango** | Microtransit booked by phone, SMS, email, web or kiosk for people without smartphones ([Via](https://ridewithvia.com/resources/microtransit-myth-app-based-transit-means-people-without-smartphones-miss-out) [V]). Liftango runs Australian on-demand public transport with Transdev ([Bus News](https://www.busnews.com.au/industry-news/1910/transdev-and-liftango-partner-for-on-demand-mobility) [S]). |
| **Revel** | All-electric rideshare with employee drivers and its own charging hubs ([Axios](https://axios.com/2021/08/02/revel-electric-vehicle-ride-sharing) [S]). |
| **Ola** | Ola Lite (a lightweight app) and vernacular text booking ([YourStory](https://yourstory.com/2017/08/ola-indusos-vernacular-text-bookings) [S]). |
| **Uber Direct / DoorDash Drive / Zoom2u / Sendle** | **Uber Direct on Shopify:** one-hour, same-day or scheduled options chosen at checkout, with live tracking (Dec 2025) ([Uber](https://www.uber.com/newsroom/uber-direct-brings-same-day-delivery-to-shopify) [V]). **DoorDash Drive tracking page:** timeline, recipient-editable instructions and gate codes, POD photo for 7 days ([DoorDash](https://developer.doordash.com/en-US/docs/drive/how_to/Parcel/tracking_links) [V]), plus configurable SMS ([DoorDash](https://developer.doordash.com/en-US/docs/drive/how_to/configure_sms) [S]). **Zoom2u:** API, Shopify/WooCommerce/BigCommerce, digital POD on every booking ([SoftwareFinder](https://softwarefinder.com/fleet-management-software/zoom2u) [V, third-party]). **Sendle:** Shopify app and dashboard ([Sendle](https://try.sendle.com/en-au/partners/shopify) [S]). |
| **Indigenous and community examples** | **Ikwe Safe Rides** (Winnipeg): an Indigenous women's safe-ride non-profit with about 17,000 members and vetted women volunteer drivers ([CBC](https://amp.cbc.ca/lite/story/1.4571761) [V]). **Winnipeg taxi–Indigenous women's agreement**: an advocate for complaints, Indigenous cultural training for drivers, restorative justice ([CBC](https://amp.cbc.ca/news/canada/manitoba/winnipeg-cab-companies-parnership-indigenous-women-safety-1.6651228) [V]). |

---

## 5. Prioritised gap list

Effort: **S** is under a week, **M** is 1–4 weeks, **L** is more than a month (one or two developers).
Priority: **P0** must ship before or at launch; **P1** in the first 3 months; **P2** later.

### P0: launch blockers and table stakes

| Gap | What competitors do | Why it matters in Alice Springs | Effort |
|---|---|---|---|
| **Fix the money bugs (M1–M3) and security items S1–S5** | n/a: baseline hygiene | Free wallet credit and fake tips are direct losses. Public driver documents are a privacy-law breach. SMS pumping can run up large Twilio bills overnight. | M |
| **Masked calling and in-app chat between rider and driver** | DiDi Private Numbers ([V](https://web.didiglobal.com/au/safety/rider-safety/)); Uber three-way chat for teens and seniors ([V](https://www.uber.com/au/en/newsroom/uber-for-teens-au-expansion/)) | Many pickups have no clean address (town camps, "blue gate", hospital entrances). Without contact, no-shows and cancellation fees rise. Twilio Proxy fits the existing Twilio set-up. Add quick-reply chips such as "I'm here" and "Running 2 min late". | M |
| **Real address search plus saved places, including town camp names and pronunciations** | Uber senior accounts save Home, doctor, store ([V](https://www.uber.com/en-AU/newsroom/senioraccount_simplemode)); every competitor geocodes street addresses [U] | 24 POIs cannot cover a town of about 25,000 people. Town camps are a core rider market and need official and alternative names, built with Tangentyere Council. Saved places cut booking time for repeat health trips. | M |
| **Graceful "no car free" handling** | Uber Reserve and scheduling ([V](https://www.uber.com/au/en/newsroom/travelfeatures/)) | With 3 cars, the current ~10 s failure will be the most common experience. Instead: keep searching for 3–5 minutes, show "next car about N min" based on active trips, offer one-tap "book for when a car is free", and alert dispatch. | S–M |
| **Driver ETA-based matching and trip chaining** | Uber offer card and Destination Mode ([V](https://www.uber.com/us/en/newsroom/onlyonuber25/)) | A small fleet has to chain trips: offer the next pickup to a car about to drop off nearby. That beats "nearest idle car" and matters even more once Uber adds supply. | M |
| **Offline and low-signal resilience** | Ola Lite ([S](https://apkmirror.com/apk/olacabs/ola-lite-lighter-faster-ola-app-book-taxi-cabs)); Grab SMS "Track My Ride" ([V](https://www.grab.com/sg/inside-grab/stories/book-your-grab-ride-with-an-ai-powered-call-service/)) | Tours to Simpsons Gap and Emily Gap and the edges of town have patchy coverage. Needed: a service worker app shell, an IndexedDB queue for driver actions (arrive, start, complete, POD photo), buffered location breadcrumbs, and an SMS fallback for trip status. | M |
| **Make the content match the cash policy** | n/a | Customers told "cash is welcome" who are then refused in-app lose trust, and it may create a consumer-law exposure. Either enable cash for phone bookings or fix the four website pages. | S |
| **SMS booking and status by text** | Via phone/SMS/email/kiosk booking ([V](https://ridewithvia.com/resources/microtransit-myth-app-based-transit-means-people-without-smartphones-miss-out)); Uber 1‑833‑USE‑UBER ([S](https://techcrunch.com/2023/05/17/you-can-now-hail-an-uber-by-calling-a-number)) | The schema already has `channel='sms'` but no handler. Text "RIDE Todd Mall to Hospital" and get a quote reply with "YES". This helps people with prepaid phones and little data, and works outside phone-line hours. | M |
| **Wheelchair-accessible vehicle (WAV) partnership** | Uber WAV/Assist ([V](https://www.uber.com/en-AU/newsroom/regionalvicassisstlaunch)); GrabAssist ([S](https://www.grab.com/sg/press/business/grab-expands-vehicle-service-options-with-grabassist-grabcar-plus-and-grabfamily-ages-1-3/)) | NDIS is a stated market, but there is no WAV in the fleet. At minimum: a referral flow that books a local WAV taxi through admin, plus "Assist"-trained drivers (disability awareness date is already in the schema). | S (referral) / L (own WAV) |
| **Rider facial or ID check and driver selfie at go-online** | DiDi Facial Verification ([V](https://web.didiglobal.com/au/safety/rider-safety/)); Uber rider verification ([S](https://pymnts.com/news/ridesharing/2024/uber-to-launch-rider-verification-and-record-my-ride-nationwide)) | Prevents account sharing by drivers, which is an accreditation risk under NT rules. Riders will expect parity with Uber. | M |

### P1: competitive parity in the first 3 months

| Gap | What competitors do | Why it matters in Alice Springs | Effort |
|---|---|---|---|
| **Family profiles, plus teen and senior accounts with Simple mode** | Uber senior accounts and Simple mode in AU ([V](https://www.uber.com/en-AU/newsroom/senioraccount_simplemode)); Uber for Teens in the NT ([V](https://www.uber.com/au/en/newsroom/uber-for-teens-au-expansion/)); Shebah minors' rules ([V](https://shebah.com.au/faqs/)); Lyft Silver ([V](https://www.polisnetwork.eu/news/uber-and-lyft-target-us-senior-riders-with-simpler-more-accessible-apps/)) | Large kinship networks often book for each other, for example a grandchild booking a clinic trip for an Elder. An organiser books and pays, and the family member gets SMS updates. Teen trips need drivers with a WWCC (already a document type). Uber will arrive with this feature. | M–L |
| **Multi-stop (up to 3) and "wait and return"** | Uber allows 5 extra stops ([V](https://help.uber.com/h/26f09874-91e9-4fe1-9537-ec680a47ecbe)) | Typical trip: shops, then clinic, then home. Also a pharmacy pickup on the way, or dropping kids at school. Wait time is already in `fare_rules`. | M |
| **Split fare** | Uber Split Fare ([V](https://www.uber.com/en-ZA/blog/share-journey-split-cost-ride-sustainably)) | Tourists and groups heading to the airport or Lasseters; tours priced per group. | S–M |
| **Airport mode** | Uber Reserve with flight tracking and included wait ([V](https://www.uber.com/au/en/newsroom/travelfeatures/)); airport queue and rematch ([V](https://www.uber.com/en-AU/blog/priority-airport-rematches-with-uber-pro)) | The airport is about 15 km out, and flights are few and lumpy. Needed: flight-number scheduling that tracks delays, a driver airport queue (first-in, first-out), and a "meet at arrivals" pickup point with a photo. This is a fair, simple way to share a small number of high-value trips. | M |
| **Driver demand view and destination filter** | Uber Rides Heatmap, Destination Mode, Earnings Trends ([V](https://www.uber.com/us/en/newsroom/onlyonuber25/), [V](https://www.uber.com/en-NZ/blog/introducing-earnings-trends-easily-decide-when-and-where-to-drive/)) | Expected demand by hour, built from trip history plus an events calendar (football carnival, Show, Parrtjima, Finke). A "head home or to the charger" filter. Drivers comparing DingoGo with Uber will ask for both. | M |
| **Instant or weekly automated payouts** | Uber/DiDi cash-out [U] | Use Stripe Connect Express to drop plaintext bank storage (S6) and pay drivers daily. This is an important retention lever against Uber recruiting the same drivers. | M |
| **Battery-aware offers and a charging map** | Uber battery-aware matching (planned) ([V](https://www.taxi-point.co.uk/post/new-battery-aware-feature-will-match-uber-users-based-on-vehicle-charge-levels-and-length-of-ride)); EV Hub and charging map ([V](https://cleantechnica.com/2022/05/18/uber-announces-new-ev-hub-ev-charging-map-comfort-electric/)) | DingoGo already does the range check; next is surfacing it. Show remaining range after each trip, and add "end near a charger" offers. Alice Springs had only 2 public charge sites listed on Electromaps ([V](https://www.electromaps.com/en/charging-stations/australia/alice-springs-town-council)), so add a depot and partner charger map with live status. | S–M |
| **Courier recipient tracking page upgrade** | DoorDash Drive: editable instructions and gate codes, POD photo ([V](https://developer.doordash.com/en-US/docs/drive/how_to/Parcel/tracking_links)) | The public `/track` page shows no POD and does not let the recipient add "leave with neighbour at No. 4" or "call on arrival". This is cheap to add and cuts failed drops. | S |
| **Business portal for the `corporate_admin` role** | Uber for Business dashboard and branded vouchers ([V](https://www.uber.com/en-AU/blog/u4b-anz-expands-vouchers-to-enhance-customer-experiences)) | Alice has many NGOs, health services, land councils and NDIS plan managers. They need to book for clients, issue ride vouchers by SMS, set budgets and approval rules, and download monthly CSV and PDF statements. Today every request needs DingoGo staff. | M–L |
| **Courier business tools: bulk upload, multi-drop batching, API and webhooks** | Zoom2u API and integrations ([V](https://softwarefinder.com/fleet-management-software/zoom2u)); Uber Direct multi-order ([V](https://www.uber.com/us/en/newsroom/onlyonuber25/)) | Pharmacies, bottle-free grocers and Aboriginal art centres sending daily batches. Today each parcel is one trip with one driver. | L |
| **Trusted contacts with auto-share (for example after 10pm) and a check-in on long stops** | Bolt Trusted Contacts ([V](https://dailynews.co.za/technology/mobile-apps/2025-02-11-bolts-new-trusted-contacts-feature-enhances-safety-for-riders-and-drivers)); DiDi TripCheck ([V](https://web.didiglobal.com/au/safety/rider-safety/)) | DingoGo has route deviation and an emergency contact. Add several contacts, auto-share rules, and unexpected-stop detection. | S–M |
| **Audio recording (opt-in, encrypted, auto-delete)** | Uber ([V](https://www.uber.com/au/en/safety/audiorecording/)); DiDi in some AU states ([V](https://web.didiglobal.com/au/safety/rider-safety/)) | Confirm the NT surveillance-device law first: the NT is not on Uber's audio-recording list. If allowed, this protects both rider and driver. | M (plus legal) |
| **Email and PDF tax invoices; monthly statements** | Standard for all business products [U] | NDIS and business riders need emailed invoices for reimbursement. | S |
| **Pass auto-renew and price predictability** | Uber One A$9.99 ([V](https://www.shopback.com.au/blog/savings/uber-one-worth-australia)); Lyft Price Lock ([V](https://www.lyft.com/blog/posts/price-lock-around-the-clock)) | A "Price Lock" style plan for regular clinic or dialysis trips (for example a fixed $X Gillen–Hospital fare) fits the market better than a discount percentage. | S–M |
| **Driver fatigue limits and a break timer** | DiDi Driver Fatigue Prevention ([V](https://web.didiglobal.com/au/safety/rider-safety/)) | The schema has no hours-online tracking. Fatigue rules are a reasonable regulator expectation. | S |

### P2: later

| Gap | What competitors do | Why it matters in Alice Springs | Effort |
|---|---|---|---|
| AI or voice phone booking after hours | Grab AI Call-A-Ride ([V](https://www.grab.com/sg/inside-grab/stories/book-your-grab-ride-with-an-ai-powered-call-service/)) | Phone booking is limited to staffed hours. A voice agent could cover late nights. Accuracy for Aboriginal English and place names must be tested with the community first. | L |
| Shopify / WooCommerce app for same-day local delivery | Uber Direct on Shopify ([V](https://www.uber.com/newsroom/uber-direct-brings-same-day-delivery-to-shopify)); Sendle ([S](https://try.sendle.com/en-au/partners/shopify)) | Local galleries and gift shops selling online. | M |
| Unmatch or block a driver | DiDi Unmatch ([V](https://web.didiglobal.com/au/safety/rider-safety/)) | In a small town, riders need to avoid a specific person. Add a "preferred drivers" list too, as Shebah does ([V](https://shebah.com.au/faqs/)). | S |
| Hide exact addresses in history after the trip | DiDi Hidden Addresses ([V](https://web.didiglobal.com/au/safety/rider-safety/)) | In a small town, a driver's history reveals where people live, including refuges. | S |
| Child seats as a bookable extra | Shebah ([V](https://shebah.com.au/faqs/)) | Families going to clinics. | S |
| Rider rating preferences for drivers | Uber ([V](https://www.uber.com/us/en/newsroom/onlyonuber25/)) | Night safety for drivers; handle with care in a small community. | S |
| Driver dashcam / Record My Ride | Uber ([S](https://pymnts.com/news/ridesharing/2024/uber-to-launch-rider-verification-and-record-my-ride-nationwide)) | Evidence for driver disputes. | M |
| Event and festival pooled shuttles (microtransit) | Via / Liftango ([V](https://ridewithvia.com/resources/microtransit-myth-app-based-transit-means-people-without-smartphones-miss-out)) | Parrtjima, the Show and the football carnival, when the town camp population "can nearly double" ([V](https://en.wikipedia.org/wiki/Alice_Springs_town_camps)). | L |

---

## 6. Unique-to-DingoGo value-add ideas

These are things big platforms are unlikely to copy, which makes them the defensible ground once Uber is in town.

1. **Language-first app.** Ship i18n now (for example `react-intl`), then Arrernte, Warlpiri, Pitjantjatjara and Luritja strings co-written and **recorded as audio** with language speakers, for example through IAD and community language centres. Add audio prompts for key steps ("Your car is here", "Tell the driver your PIN"). Match riders with drivers who speak their language; driver languages are already stored.
2. **Kinship booking.** Book and pay for a relative by name and phone, with SMS updates to both. Add an "Elder priority" flag that sets a longer free wait, door-to-door help and no cancellation fee for clinic delays. This goes further than Uber's family profile, which is built for nuclear families.
3. **Town camp and community-aware places.** Official and alternative camp names with pronunciation and landmark photos, built with Tangentyere Council. Add a "where to meet" pin per camp, agreed with residents.
4. **Health-trip mode.** Dialysis, clinic and hospital templates: recurring bookings, a pickup-after-appointment "call me when done" button, and billing to a clinic or Aboriginal Medical Service (AMS) account. Tie in Congress and other AMS partners as corporate accounts.
5. **Sorry business and cultural-event flexibility.** Fee-free cancellation and rescheduling when a rider flags sorry business or ceremony. Add an admin "community notice" switch to pause promos and roof ads during sensitive periods. On the roof screens, rotate community notices (with permission) instead of only ads.
6. **Women's safe-ride network, modelled on Ikwe Safe Rides.** Extend women-driver preference into a booked "women's safe ride" program with partner women's shelters, subsidised by community vouchers ([CBC](https://amp.cbc.ca/lite/story/1.4571761) [V]). Publish a complaints advocate and restorative-justice pathway, as in the Winnipeg agreement ([CBC](https://amp.cbc.ca/news/canada/manitoba/winnipeg-cab-companies-parnership-indigenous-women-safety-1.6651228) [V]).
7. **Country-aware tours.** Traditional Owner-guided add-ons with revenue share, on-trip audio stories by GPS (including offline audio), and sacred-site etiquette prompts. `cultural_note` and `requires_permit` already exist in `tour_packages`.
8. **Community impact ledger.** Show each rider and the website "dollars kept in Mparntwe": driver wages, Aboriginal-owned partner cafés (`aboriginal_owned` flag exists), kg CO₂ avoided, and community rides donated. Add **round-up to a community fund**, for example to youth night patrols or a "safe ride home" voucher pool.
9. **Community voucher pools.** Let organisations (land councils, NGOs, schools) fund pooled vouchers that caseworkers issue by SMS. This extends the existing gift-voucher and partner model.
10. **Local hire and training pathway.** Publish a driver academy in the driver app (H endorsement support, EV driving in heat, disability awareness) and track graduates. This is a recruiting story Uber cannot tell.
11. **Heat-safety features.** Above 40 °C, prioritise the nearest car even at higher cost, show "car is cooled" status, and offer a free short "heat relief" ride program in partnership with council.

---

## 7. Website UX and visual critique (`apps/web/src`)

**What works.** The dark night-sky hero with layered ranges has a strong identity. The fare estimator above the fold, compared against the taxi tariff, is a good conversion hook. Ruled lists are used instead of generic card grids. The acknowledgement of Country, skip link and accessible combobox are all good.

**Improvements, roughly in order of impact:**

1. **Fix dead-end calls to action.** "Get the app" and "Book in the app" scroll to `#app`, where the store badges say "Coming soon" and do nothing (`Home.tsx`, `Estimator.tsx`). Until the apps ship, link to the rider web app (PWA) with the estimator's pickup and drop-off pre-filled.
2. **Fix cash messaging** on the Home, Help, Rides and Rewards pages (see 3.4).
3. **Use real photography.** There are no photos of the cars, drivers, Mparntwe or Country; the site has a single 338 KB PNG mascot. Commission photography of the BYD Dolphins in front of the ranges, the owners and drivers (with consent), and the charging set-up. Convert the mascot to WebP/AVIF with `srcset`, and keep it as a brand accent rather than the hero focal point.
4. **Replace emoji icons** (🚗📦🐕🏜️🎉) with a consistent custom SVG icon set, perhaps line icons drawing on dot-painting motifs commissioned from a local artist with credit and payment. This also improves screen-reader output.
5. **Tighten the hero.** On desktop the mascot circle floats low and leaves dead space on the right (see `docs/screenshots/web-home.png`). Put a car photo or map preview there, or bring the estimator up. Reduce the five-chip service selector to Ride / Parcel, with a size picker only when Parcel is chosen.
6. **Add trust signals.** Accreditation status, "Aboriginal-owned" certification (for example Supply Nation, if registered), named owners with photos, a short founder video, local press, partner logos, and live counts (rides, kg CO₂, dollars kept local).
7. **Add a language toggle in the header** (English, Arrernte "coming with community", Simple English), and a large-text toggle.
8. **SEO and sharing.** It is a pure client-side app, so pages need prerendering (e.g. `vite-plugin-ssr` or a static prerender) for Google and link previews. Add `LocalBusiness` / `TaxiService` JSON-LD, per-page Open Graph images, a sitemap, `robots.txt`, and canonical URLs. `twitter:card` is "summary"; change it to "summary_large_image".
9. **Track page.** Add a proof-of-delivery block for parcels, an ETA countdown, and a "Call DingoGo" button. Add editable recipient instructions and a "Get the app" upsell after delivery.
10. **Navigation.** Seven links plus a button collapse to a menu below 980 px. Group them as Ride, Send, Business, Drive and About; move Safety into the footer and the Ride page.
11. **Motion and performance.** Respect `prefers-reduced-motion` for `.live-dot`, lazy-load Leaflet only on the Track page (it is already lazy, so check the bundle), and add `font-display: swap`. Aim for Lighthouse scores of 95 or more.
12. **Content tone.** Some copy is long. Use a one-line value proposition per section, and collapse detail into "How pricing works" pages.
13. **Draft legal banners.** The "Draft for legal review" flags must not ship. Gate them behind an environment flag.
14. **Accessibility checks to add.** Run axe in CI. Check colour contrast for the `#C9CFDD` text on `--night`, the muted greys and the ochre buttons with dark text. Make visible focus outlines on `.seg` chips and nav links consistent.

---

## 8. Suggested sequencing

- **Weeks 0–3 (before launch):** S1–S7, M1–M3, cash copy, "no car free" handling, masked calling, address search with saved places and town camps, service worker with offline driver-action queue, email receipts.
- **Weeks 4–12:** family, kinship and senior/Simple mode; multi-stop; airport mode; driver demand view and Stripe Connect payouts; business portal; courier tracking page upgrade; i18n framework plus the first Arrernte audio prompts.
- **Quarter 2 and later:** courier API, Shopify and batching; SMS and AI voice booking; audio recording (after NT legal advice); event shuttles; health-trip mode; community voucher pools.

---

## Source notes

- All URLs above were retrieved on 3 Nov 2026. [V] items were fetched and read. [S] items rest on search-result titles or snippets only. [U] items are unverified general knowledge.
- Uber audio recording: Uber's global page does not list Australia. The Uber AU teens page says audio is available in NSW, ACT, SA and TAS only, not the NT.
- DiDi driver-app cash-out and heat-map features, Uber Instant Pay, and Ola/Revel/Liftango specifics were not verified first-hand.
