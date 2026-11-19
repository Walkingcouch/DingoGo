# iOS: Info.plist usage strings (prepared in Round 21, iOS app not built yet)

The iOS apps are still a placeholder (`npm run cap:ios -w apps/rider` creates the project). When they are added, put these keys in
`apps/<app>/ios/App/App/Info.plist`. Apple rejects apps whose purpose strings are vague, so each says what is used and why, in the
same words as the Android explanations (`packages/shared/src/permissions.ts`). The store readiness test checks this file covers
every feature below.

## Rider app (au.com.dingogo.rider)

| Key | Value |
|---|---|
| `NSLocationWhenInUseUsageDescription` | DingoGo uses your location to set your pickup when you tap "Use my location", and to send it to the safety team if you press the emergency button. |
| `NSCameraUsageDescription` | Not needed (the rider app attaches photos from your library). Add only if a camera feature is added. |
| `NSPhotoLibraryUsageDescription` | DingoGo opens your photos only when you choose one to attach to a safety report. |
| `CFBundleURLTypes` / Associated Domains | `applinks:dingogo-steel.vercel.app` (Associated Domains capability) so share-trip `/track/…` and `/rider/…` links open the app. Needs `/.well-known/apple-app-site-association` on the website (not built yet). |
| `UIBackgroundModes` | `remote-notification` only (push). No background location. |

Push (APNs): needs an Apple Developer account, an APNs key in Firebase (FCM sends to iOS through APNs) and Firebase Messaging in
the iOS app, because Capacitor hands out APNs tokens that FCM can't use directly (Round 9, deferred).

## Driver app (au.com.dingogo.driver)

| Key | Value |
|---|---|
| `NSLocationWhenInUseUsageDescription` | DingoGo Driver uses your location while you're online or on a trip, to offer you trips near you, show your rider where your car is, and record the route for the fare, your pay and safety. |
| `NSLocationAlwaysAndWhenInUseUsageDescription` | Not requested now (no background location). If background location is added: "So trip offers and your rider's map keep working while you use Google Maps or Waze. Only while you're online or on a trip." |
| `NSCameraUsageDescription` | DingoGo Driver uses the camera for your photo check before driving and for photos of delivered parcels. |
| `NSPhotoLibraryUsageDescription` | DingoGo Driver opens your photos only when you choose a picture of your licence or car papers to upload. |
| `UIBackgroundModes` | `remote-notification` (trip offers by push). Add `location` only with background location. |

## Both apps

- `ITSAppUsesNonExemptEncryption` = `NO` (HTTPS only, no custom encryption).
- Privacy manifest (`PrivacyInfo.xcprivacy`): declare the "required reason" APIs Capacitor uses (UserDefaults: `CA92.1`) and the
  data types from `docs/store/data-safety.md` (no tracking, no tracking domains).
- App Store "Account deletion": already in the apps (rider Account > Privacy; driver Profile > Privacy and your data).
