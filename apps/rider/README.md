# DingoGo Rider app

React + Vite, packaged for iOS and Android with Capacitor (also installable as a PWA).

```bash
npm run dev            # http://localhost:5174 (needs the API on VITE_API_URL, default :4000)
npm run build          # typecheck + production build to dist/
npm run cap:android    # generate the Android project (needs Android Studio)
npm run cap:ios        # generate the iOS project (needs Xcode)
```

Env (see `.env.example`): `VITE_API_URL`, `VITE_WEB_URL` (website that hosts `/track/<token>` share links), `VITE_TILE_URL` (production map tiles).

Screens: book a ride / pet ride / parcel / tour / event hire with live upfront quotes; live trip with PIN, driver card, realtime position, share link, SOS and cancellation-fee warning; rating, tip and tax invoice; trip history; Dingo Points rewards with QR vouchers, referrals and DingoGo Pass; account (profile, emergency contact, accessibility, payment and credit, prepaid vouchers, notifications, help tickets, safety, privacy export and deletion).

Dev logins: rider `+61400000100`, OTP `000000`. Screenshots of every screen are in `screenshots/`.
