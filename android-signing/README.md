# Android test signing key

`dingogo-test.keystore` signs the **test** APKs built by `.github/workflows/android.yml`
(password and alias: `dingogo-test`). It is committed on purpose: every build is signed with the
same key, so a new test APK installs over the old one without uninstalling.

It is **not** secret and must **never** be used for Google Play. For the store, create a private
upload key, keep it out of this repo (GitHub Actions secret), and enrol in Play App Signing.
