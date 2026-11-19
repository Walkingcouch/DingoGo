# Android test signing key

`dingogo-test.keystore` signs the **test** APKs built by `.github/workflows/android.yml`
(password and alias: `dingogo-test`). It is committed on purpose: every build is signed with the
same key, so a new test APK installs over the old one without uninstalling.

It is **not** secret and must **never** be used for Google Play. For the store, create a private
upload key, keep it out of this repo (GitHub Actions secret), and enrol in Play App Signing.

Since Round 21 the Gradle files sign release builds with the upload key when `DINGOGO_UPLOAD_STORE_FILE` (and the password and
alias variables) are set, and the workflow's "Build Google Play bundles" run sets them from GitHub Actions secrets and refuses a
bundle signed with this key. See docs/OPERATIONS.md, section 11. This key's certificate SHA-256 is
`C5:C8:FE:E0:A1:7C:DF:1D:4B:00:53:CF:0F:0C:33:B4:20:BF:6F:7F:34:85:99:C3:BB:E9:CA:64:6A:1C:E7:20`; the API never lists it in
`/.well-known/assetlinks.json`.
