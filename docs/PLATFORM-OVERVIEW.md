# DingoGo platform overview (for the owners)

Plain-English guide to what has been built, how the main business rules work, where to change them, what is built but switched off, and
what needs an account or a key before it works. Written in Round 30 (November 2026). The technical detail is in `docs/API.md` and
`docs/OPERATIONS.md`; the list of everything to do before launch is `docs/GO-LIVE-CHECKLIST.md`.

---

## 1. The pieces

DingoGo is one system: one database, one server program (the "API") and six screens that talk to it. Everything runs on one web address;
the rider and driver apps can also be installed on phones.

| App | Address | Who | What it does |
|-----|---------|-----|--------------|
| **Website** | `/` | The public | Explains DingoGo (rides, parcels, tours, business, drive with us, community trips, safety, fares with a price estimate and the taxi comparison), takes driver applications, business account applications and enquiries, shows a shared trip on a map, and the legal pages. |
| **Low-data page** | `/lite` | People on 2G or old phones | Community trip routes, prices and seats, with a form that holds a seat and texts the number to confirm. No pictures, no maps, under 12 KB. |
| **Rider app** | `/rider` (and Android/iPhone) | Customers | Book rides, pet-friendly rides, parcels, tours, hourly hire and community trips; pay by card, DingoGo credit, voucher, business account or (parcels) cash; track the driver live; message the driver; safety tools (trip PIN, share trip, trusted contacts, SOS, "Are you OK?" check-ins); receipts and tax invoices; Dingo Points, rewards and DingoGo Pass; help and support. Simple mode with big pictures and spoken status; app words in Arrernte and Kriol (drafts). |
| **Driver app** | `/driver` (and Android/iPhone) | Drivers | Sign up and upload papers, add their own car, go online, take offers (shows their pay before accepting), navigate, PIN-checked pickups, proof of delivery for parcels, SOS, earnings (pay, fees, tips, hours, GST figure for their BAS), charging logs, leave for Sorry Business, opt in to long community trips and run the community shuttle. Keeps working through poor signal. |
| **Admin console** | `/admin` | DingoGo staff | Run the business day to day: live map, trips, phone bookings, drivers and their papers, cars, safety, support, prices, tours, community trips, loyalty, business accounts, reports, tax, insights and settings. Two staff roles: **admin** (everything) and **dispatcher** (the day-to-day desk). |
| **Partner portal** | `/partner` | Partner cafés, tour desks, community stores | Cafés check and redeem reward codes and sell prepaid credit; tour desks (hotels, visitor centre) book tours for guests and see commissions; community stores take cash top-ups of DingoGo credit and hand over parcels with a code. |
| **Roof display** | separate player in each car | The roof screen | Plays approved ad campaigns near where the car is. **Off** until the NT says yes in writing. |

Booking by text also works without any app: `BUS NTARIA FRI 2`, then `YES` (needs Twilio, section 4).

---

## 2. Key business rules and where to change them

Every money and policy rule below can be changed in the admin console without a developer. Changes are recorded in Settings → Audit log.

| Rule | Today's default | Where in admin |
|------|-----------------|----------------|
| **Fares** | $3.00 start + $1.60 a km + $0.25 a minute + $1 booking fee, minimum $10, 20% more 10pm–5am, 15% on public holidays. Set to stay under the Alice Springs taxi day tariff. | Pricing & tours → Fares |
| **NT passenger levy** | $1 a trip, passed on to the NT each month (due the 21st) | Pricing & tours → States; the report is in Tax & compliance → Levy returns |
| **DingoGo's service fee** | 25% of the fare (the driver keeps 75%, and 100% of tips). Can be lower for drivers' own cars and for electric/hybrid cars (your direction: 20% and 15%, not yet saved). | Pricing & tours → Driver pay |
| **Driver pay extras** | Off: pickup pay after the first 2 km (paid for by a "Long pickup" charge to the rider), a fuel surcharge, a weekly earnings floor ($32 an hour on trips). | Pricing & tours → Driver pay |
| **Electric and hybrid cars first** | Dispatch offers trips to EV/hybrid cars first and skips any EV whose battery can't cover the trip plus a reserve. | Built in |
| **Cancellations** | Free for 2 minutes after a driver accepts, then $3 (part goes to the driver). Tours free until 48 hours before, hire until 24 hours before, then 50%. | Settings → Cash and cancellations; the $3 per service under Pricing & tours → Fares |
| **Cash** | Off for rides (draft terms say rides are paid in the app), on for parcels. | Settings → Cash and cancellations |
| **Oldest car allowed** | NT 13 years, SA 8 years | Pricing & tours → States |
| **Driver fatigue** | 12 hours online then a 6-hour rest; a 20-minute break after 5 hours | Safety & compliance → Policy |
| **Points** | 10 points per $1; 100 points = $1 off (up to half a fare); tiers after 10 and 30 trips a year; expire after 12 months without activity | Loyalty & vouchers → Programme |
| **Promo codes, DingoGo Pass, public holidays** | `WELCOME` in the demo only; Pass $9.99 / $29.99 | Pricing & tours → Promo codes / DingoGo Pass / Public holidays |
| **Tours and hire** | Prices per tour, 20% card deposit, 10-minute change of mind, guide fees, hotel/visitor-centre commissions | Pricing & tours → Tours; Tours & hire → Deposit & hire, Guides, Desk commissions |
| **Community trips** | Ntaria $260 and Ltyentye Apurte $190 one way by private car, trip back 30% off, shuttle seats $40 / $30, parcels from $15 / $12; town fares only to 60 km from town. **Closed** on a new database. | Community trips → Routes |
| **Support** | Automatic fare-check refunds up to $15 (twice per rider in 30 days); reply and resolve targets | Support & inbox → Policy |
| **Business accounts** | Approved from website applications; monthly invoices; approvals over an amount; limits | Business accounts |
| **Business details and support contact** | ABN and legal name "TBC" (invoices say "draft" until set) | Settings → Business details / Customer support |
| **Roof screens** | Off | Settings → Roof screens |

**Safety rules built in (not settings):** women-preferred matching only for drivers DingoGo has checked; a critical safety report holds the
other person automatically only if they met on a real, recent trip; drivers can't go online with expired papers; trip PINs; SOS goes to 000
guidance, DingoGo and trusted contacts.

---

## 3. Built but switched off (or hidden)

These work and are tested, but stay off until you decide, get approval, or have the accounts they need.

| Feature | Why it is off | How to turn it on |
|---------|---------------|-------------------|
| Roof screen advertising | Needs written NT approval | Settings → Roof screens → "Show approved campaigns" |
| Community routes (Ntaria, Ltyentye Apurte) | Distances, road and coverage notes, prices and permit notes are placeholders until checked with the communities and the Central Land Council | Community trips → Routes: confirm, tick "checked" and "Taking bookings" |
| Yulara long trips | No charging and overnight-rest plan yet | Community trips → Routes |
| South Australian towns | Built but hidden until DingoGo is accredited in SA | Pricing & tours → States (asks to confirm) |
| Fleet programme (DingoGo-owned cars: weekly lease, rent-to-own, maintenance, insurance, investor shares) | Waiting for the fleet to launch | Fleet & charging → Fleet programme |
| Driver pay extras and lower service fees | Owner decision | Pricing & tours → Driver pay |
| Concession fares | NT decision | Pricing & tours → Community |
| Cash for rides | NT decision | Settings → Cash and cancellations |
| Weekly owner summary email | Needs Resend (section 4) | Insights → Settings → Weekly owner email |
| Automatic reassignment of silent drivers | Phones pause the app during navigation; needs background location in the driver app first | `DRIVER_SILENT_REASSIGN_MIN` on Vercel (ask the developer) |
| Visitor-language tour pages (German, French, Italian, Japanese, Korean, Chinese) | Machine translations, flagged as such | Review them in Pricing & tours → Tours |
| Arrernte and Kriol app words | Community drafts | Review with speakers (`npm run i18n:review` makes a sheet) |

Not built yet (decisions needed first): rider no-show fee and driver waiting pay; who pays pickup pay on late cancellations; reversing
driver pay or points on refunds; whether dispatchers should see money reports (they can today).

---

## 4. What needs an account or a key

Until each is set up the feature says it is off and everything else keeps working. Keys go into Vercel (Project → Settings → Environment
Variables), never into the code. Full list with variable names: `docs/GO-LIVE-CHECKLIST.md` section 2.

| Service | What it is for | Without it |
|---------|----------------|------------|
| **Twilio** (must have) | Sign-in codes, parcel PINs, SOS and trip texts, booking by text, masked calls between rider and driver | Only staff can sign in (code in the server log); riders and drivers can't sign in |
| **Stripe** | Real card payments, refunds and disputes | Riders pay with DingoGo credit or vouchers (parcels can be cash); "card payments coming soon" |
| Map tiles provider | Maps in every app at production volume | OpenStreetMap's free servers (not allowed for production traffic) |
| Routing server (OSRM or OpenRouteService) | Road distances and times for fares | Straight-line estimate |
| Firebase (Android) and web push keys | Notifications when the app is closed | Notifications only while the app is open, plus texts |
| Resend | Weekly owner summary by email | Summary still in Insights (PDF download) |
| Sentry | Error reports to the developer | Errors only in the Vercel log |
| Google Play developer account | Publishing the Android apps | Test builds from GitHub, or install as a web app |
| Apple developer account | Publishing the iPhone apps | Web app on iPhone |
| Supabase paid plan or own backups | Database backups | **No automatic backups on the free plan** |
| Plate lookup, face match, reverse geocoder | Optional extras (rego lookup, photo checks, street address on SOS) | Manual checks |

---

## 5. Where to look each day

- **Admin → Dashboard:** today's trips and money, what needs attention, and "Not ready for real riders yet" until the launch checks pass.
- **Admin → Reports → Go-live checks:** what the system can see is still to do. **Reports → System health:** database and integrations.
- **Admin → Insights:** business health (what DingoGo keeps per trip after GST, card fees and refunds), driver pay per hour, busy hours,
  a demand forecast, a pricing simulator and the weekly summary.
- **Admin → Safety & compliance** and **Support & inbox** have badges when something is waiting.

Demo data (fictional people and businesses) is only for testing: a real database starts empty, with the first admin set from
`BOOTSTRAP_ADMIN_PHONE`.
