# Google Play Data safety: draft answers (Round 21)

Draft for the owner to check before filling in Play Console > App content > Data safety, once per app. Based on what the code
collects as of Round 21. If a feature changes what is collected, update this file (the store readiness test checks that every
permission in the Android manifests is explained here).

## Overview questions (both apps)

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | Yes |
| Is all of the user data collected by your app encrypted in transit? | Yes (HTTPS only; `allowMixedContent` off, HSTS on the API) |
| Do you provide a way for users to request that their data is deleted? | Yes: in the app (rider Account > Privacy; driver Profile > Privacy and your data) and on the web at `/delete-account` |
| Account deletion URL | https://dingogo-steel.vercel.app/delete-account (change to the production domain when it moves) |
| Privacy policy URL | https://dingogo-steel.vercel.app/legal/privacy |
| Data shared with third parties | None, in Play's sense. Riders and drivers seeing each other's first name and trip details is a transfer the user starts and expects; service providers (Stripe payments, Twilio texts, Firebase push, Supabase/Vercel hosting) process data for DingoGo; reports to the ATO (Sharing Economy Reporting Regime) and to police are legal obligations. All three are exempt from "sharing" in Play's definitions. |
| Independent security review | No |
| Family policy / children | Not for children. Target audience 18+. |

## Permissions and why (Android manifests)

| Permission | Rider | Driver | Why | When asked |
|---|---|---|---|---|
| `INTERNET` | yes | yes | Talk to DingoGo | Not a runtime permission |
| `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION` | yes | yes | Rider: pickup from "Use my location", location sent with the emergency button. Driver: trip offers near you, rider sees the car, route for fare and pay | Rider: when they tap "Use my location" or the emergency button. Driver: after the prominent disclosure screen ("Your location while you drive") |
| `ACCESS_BACKGROUND_LOCATION` | no | no | Not requested. Location stops when the app is in the background | Never |
| `CAMERA` | no | yes | Driver photo check (selfie) and delivery photos | When the driver takes the photo (explained on the screen first) |
| `POST_NOTIFICATIONS` | yes | yes | Trip updates, messages; drivers: trip offers | Rider: "Turn on notifications" in settings. Driver: after the "Trip offers when the app is in the background" screen |
| Foreground service | no | no | None declared (no Play foreground-service declaration needed) | Never |

Backups are off (`allowBackup=false`, data extraction rules exclude everything), so the sign-in session never leaves the phone.

## Data types: rider app (au.com.dingogo.rider)

All "collected" (sent to DingoGo). None "shared". Processed ephemerally: no. Required unless marked optional.

| Category > type | Collected | Optional? | Purposes |
|---|---|---|---|
| Personal info > Name | yes | required (first name shown to the driver) | App functionality, Account management |
| Personal info > Phone number | yes | required (sign-in by text code) | App functionality, Account management, Fraud prevention and security |
| Personal info > Email address | yes | optional (receipts) | App functionality, Account management |
| Personal info > Other info | yes | optional: emergency and trusted contacts, NDIS number, concession card last 4 digits, birthday (day/month) for the bonus | App functionality |
| Financial info > Payment info | yes, by Stripe (card details entered in Stripe's form; DingoGo keeps card brand and last 4 only) | required for card payments | App functionality |
| Financial info > Purchase history | yes (trips, fares, vouchers, points) | required | App functionality, Account management |
| Health and fitness > Health info | yes | optional: accessibility needs the rider chooses to tell us (wheelchair, assistance animal, hearing) | App functionality |
| Location > Approximate and Precise location | yes | optional (search or tap the map instead) | App functionality, Fraud prevention and security (emergency button) |
| Messages > Other in-app messages | yes (trip chat with the driver) | optional | App functionality |
| Photos and videos > Photos | yes | optional (photos attached to a safety report) | App functionality, Fraud prevention and security |
| Files and docs | yes | optional (business CSV import, safety report PDFs) | App functionality |
| App activity > Other user-generated content | yes (ratings, comments, safety reports) | optional | App functionality, Fraud prevention and security |
| App info and performance > Crash logs, Diagnostics | no (errors are logged on DingoGo's server only, not from the phone) | | |
| Device or other IDs | yes (push notification token) | optional | App functionality |

Not collected: contacts list, calendar, audio, web history, installed apps, advertising ID. No ads, no analytics SDK in the app.

## Data types: driver app (au.com.dingogo.driver)

Everything in the rider table that applies (name, phone, email, location, messages, purchase history as trips and pay, device ID),
plus:

| Category > type | Optional? | Purposes |
|---|---|---|
| Personal info > Address | required (driver application, ATO reporting) | App functionality, Account management |
| Personal info > Other info: date of birth, licence and accreditation numbers, ABN, GST status | required to drive | App functionality, Account management, Fraud prevention and security |
| Financial info > Other financial info: bank BSB and account (payouts), earnings, GST figures | required to be paid | App functionality |
| Health and fitness > Health info: medical fitness records needed for passenger-transport accreditation | required to drive | App functionality, Fraud prevention and security |
| Location > Precise location | required while online (after the disclosure screen) | App functionality, Fraud prevention and security |
| Photos and videos > Photos: photo check selfie, delivery photos, car and document photos | required when switched on / for deliveries | App functionality, Fraud prevention and security |
| Files and docs: licence, accreditation, police check, insurance and registration papers | required to drive | App functionality, Fraud prevention and security |
| App activity > Other actions: time online (fatigue limits), acceptance and cancellations | required | App functionality, Fraud prevention and security |

## Other Play Console declarations

- **Location permissions**: no background location, so no background-location declaration. Prominent disclosure: driver app,
  screen "Your location while you drive" (wording in `packages/shared/src/permissions.ts`, version recorded with the answer).
- **Foreground service**: none.
- **Photo and video permissions**: the apps use the system camera/file picker; no `READ_MEDIA_*` permissions.
- **Health apps declaration**: not a health app (accessibility and medical-fitness records support the transport service).
- **Financial features**: none of the listed ones (no loans, no crypto); payments are for the service.
- **Government apps**: no. **News**: no. **Ads**: contains no ads.
- **App access** (for Google's review): give the demo accounts (rider `0400 000 100`, driver `0400 000 011`, code `000000`) in
  App content > App access. Demo codes only work for demo/test accounts.
