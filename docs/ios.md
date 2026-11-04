# iPhone apps (placeholder)

The rider and driver apps are ready for iOS through Capacitor, but the iOS projects are not set up yet.
The website shows "Coming soon to the App Store" until then.

When you're ready (needs a Mac with Xcode and an Apple Developer account, US$99/year):

```bash
cd apps/rider            # then the same for apps/driver
VITE_API_URL=https://dingogo-steel.vercel.app/api VITE_REALTIME=off npx vite build
npx cap add ios && npx cap sync ios && npx cap open ios
```

In Xcode: set the team, bundle IDs `au.com.dingogo.rider` / `au.com.dingogo.driver`, location and camera
usage descriptions, then Product → Archive → upload to TestFlight. Update the App Store badge in
`apps/web/src/pages/Home.tsx` once the listing is live.
