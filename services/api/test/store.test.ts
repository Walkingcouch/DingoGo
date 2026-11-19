/**
 * Round 21: app store readiness. Checks the Android projects, the workflow, the store listing and the docs stay in step, so a
 * permission, plugin, icon or signing change can't silently break a Google Play submission. No database, no Android SDK.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { PNG } from 'pngjs';
import { TEST_KEY_SHA256, assetLinks, parseCertList } from '../src/lib/store.js';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const load = (rel: string) => import(new URL(rel, import.meta.url).href) as Promise<any>;
const APPS = ['rider', 'driver'] as const;
const res = (app: string) => `apps/${app}/android/app/src/main/res`;
const manifest = (app: string) => read(`apps/${app}/android/app/src/main/AndroidManifest.xml`);
const perms = (xml: string) => [...xml.matchAll(/<uses-permission android:name="android\.permission\.([A-Z_]+)"/g)].map((m) => m[1]).sort();

test('manifests: only the permissions each app uses; no background location or foreground service; no backups', () => {
  const want: Record<string, string[]> = {
    rider: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'INTERNET', 'POST_NOTIFICATIONS'],
    driver: ['ACCESS_COARSE_LOCATION', 'ACCESS_FINE_LOCATION', 'CAMERA', 'INTERNET', 'POST_NOTIFICATIONS'],
  };
  const safety = read('docs/store/data-safety.md');
  for (const app of APPS) {
    const xml = manifest(app);
    assert.deepEqual(perms(xml), want[app], `${app} permissions (update docs/store/data-safety.md and the in-app explanations too)`);
    for (const p of perms(xml)) assert.ok(safety.includes(`\`${p}\``), `${p} explained in docs/store/data-safety.md`);
    assert.ok(!/ACCESS_BACKGROUND_LOCATION|FOREGROUND_SERVICE|READ_MEDIA_|READ_EXTERNAL_STORAGE|<service/.test(xml.replace(/<!--[\s\S]*?-->/g, '')), `${app}: nothing Play would ask to declare`);
    assert.match(xml, /android:allowBackup="false"/);
    assert.match(xml, /android:dataExtractionRules="@xml\/data_extraction_rules"/);
    assert.match(xml, /android:fullBackupContent="@xml\/backup_rules"/);
    for (const f of ['data_extraction_rules', 'backup_rules']) assert.match(read(`${res(app)}/xml/${f}.xml`), /<exclude domain="sharedpref" path="\." \/>/);
  }
});

test('deep links: the rider app claims the website\'s /track/ and /rider links (verified); the driver app claims none', () => {
  const rider = manifest('rider');
  const filter = rider.match(/<intent-filter android:autoVerify="true">[\s\S]*?<\/intent-filter>/)?.[0] ?? '';
  assert.match(filter, /android\.intent\.action\.VIEW/);
  assert.match(filter, /android\.intent\.category\.BROWSABLE/);
  assert.match(filter, /android:scheme="https" android:host="\$\{appLinkHost\}" android:pathPrefix="\/track\/"/);
  assert.match(filter, /android:pathPrefix="\/rider"/);
  assert.ok(!/android:scheme="http"/.test(filter), 'https only');
  assert.match(read('apps/rider/android/app/build.gradle'), /manifestPlaceholders = \[appLinkHost: envOr\('DINGOGO_APP_LINK_HOST'\) \?: 'dingogo-steel\.vercel\.app'\]/);
  assert.ok(!/action\.VIEW/.test(manifest('driver')));
});

test('Capacitor plugins: each app declares exactly what it uses, and the committed Android settings match', () => {
  const want = ['@capacitor/app', '@capacitor/push-notifications'];
  for (const app of APPS) {
    const pkg = JSON.parse(read(`apps/${app}/package.json`));
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies }).filter((d) => d.startsWith('@capacitor/'));
    for (const d of ['@capacitor/core', '@capacitor/android', '@capacitor/cli', ...want]) assert.ok(deps.includes(d), `${app} lists ${d}`);
    const plugins = deps.filter((d) => !['@capacitor/core', '@capacitor/android', '@capacitor/cli'].includes(d)).sort();
    assert.deepEqual(plugins, want, `${app}: unused plugins add native code and permissions`);
    const settings = read(`apps/${app}/android/capacitor.settings.gradle`);
    const synced = [...settings.matchAll(/include ':capacitor-([a-z-]+)'/g)].map((m) => m[1]).filter((n) => n !== 'android').sort();
    assert.deepEqual(synced, want.map((w) => w.replace('@capacitor/', '')), `${app}: run "npx cap sync android" and commit`);
    assert.match(pkg.version, /^\d+\.\d+\.\d+$/, 'version name comes from package.json');
  }
  const shared = JSON.parse(read('packages/shared/package.json'));
  for (const d of ['@capacitor/camera', '@capacitor/geolocation', '@capacitor/preferences']) assert.ok(!shared.dependencies[d], `${d} unused`);
});

test('icons: legacy, round, adaptive foreground and themed (monochrome) layers at every density, generated layers up to date', async () => {
  const { DENSITIES, plan } = await load('../../../scripts/android-assets.mjs');
  const scale: Record<string, number> = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
  const size = (f: string) => { const p = PNG.sync.read(fs.readFileSync(path.join(ROOT, f))); return [p.width, p.height]; };
  for (const app of APPS) {
    for (const d of Object.keys(DENSITIES)) {
      const px = (dp: number) => [dp * scale[d], dp * scale[d]];
      assert.deepEqual(size(`${res(app)}/mipmap-${d}/ic_launcher.png`), px(48), `${app} ${d} launcher`);
      assert.deepEqual(size(`${res(app)}/mipmap-${d}/ic_launcher_round.png`), px(48), `${app} ${d} round`);
      assert.deepEqual(size(`${res(app)}/mipmap-${d}/ic_launcher_foreground.png`), px(108), `${app} ${d} foreground`);
      assert.deepEqual(size(`${res(app)}/mipmap-${d}/ic_launcher_monochrome.png`), px(108), `${app} ${d} monochrome`);
    }
    for (const f of ['ic_launcher', 'ic_launcher_round']) {
      const xml = read(`${res(app)}/mipmap-anydpi-v26/${f}.xml`);
      assert.match(xml, /<monochrome android:drawable="@mipmap\/ic_launcher_monochrome"\/>/);
      assert.match(xml, /<foreground android:drawable="@mipmap\/ic_launcher_foreground"\/>/);
    }
    assert.deepEqual(size(`apps/${app}/public/icon-512.png`), [512, 512], 'Play hi-res icon');
    const styles = read(`${res(app)}/values/styles.xml`);
    for (const a of ['windowSplashScreenBackground', 'windowSplashScreenAnimatedIcon', 'postSplashScreenTheme']) assert.ok(styles.includes(`name="${a}"`), `${app} splash ${a}`);
    for (const d of ['port-mdpi', 'port-xxxhdpi', 'land-hdpi']) assert.ok(fs.existsSync(path.join(ROOT, res(app), `drawable-${d}/splash.png`)));
  }
  const stale = plan().filter((f: { file: string; bytes: Buffer }) => !fs.existsSync(f.file) || Buffer.compare(fs.readFileSync(f.file), f.bytes) !== 0);
  assert.deepEqual(stale.map((f: { file: string }) => path.relative(ROOT, f.file)), [], 'run node scripts/android-assets.mjs');
});

test('signing and versions: Gradle and the workflow agree; the Play job never uses the test key; workflow YAML is valid', () => {
  const wf = parseYaml(read('.github/workflows/android.yml'));
  assert.deepEqual(Object.keys(wf.jobs).sort(), ['build', 'bundle']);
  assert.ok(wf.on.workflow_dispatch.inputs.bundle && wf.on.workflow_dispatch.inputs.play_track.options.includes('internal'));
  const { build, bundle } = wf.jobs;
  assert.match(bundle.if, /workflow_dispatch/);
  assert.equal(bundle.env.DINGOGO_REQUIRE_UPLOAD_KEY, 'true');
  assert.equal(bundle.env.TEST_KEY_SHA256, TEST_KEY_SHA256);
  assert.equal(bundle.permissions.contents, 'read');
  const steps = (j: any) => JSON.stringify(j.steps);
  assert.ok(!steps(build).includes('secrets.'), 'test APKs never touch the upload key or other secrets');
  assert.match(steps(build), /assembleRelease/);
  assert.match(steps(bundle), /bundleRelease/);
  assert.match(steps(bundle), /jarsigner -verify/);
  assert.match(steps(bundle), /r0adkll\/upload-google-play@v\d+\.\d+\.\d+/, 'third-party action pinned to a version');
  assert.match(wf.env.ANDROID_VERSION_CODE, /github\.run_number/);
  assert.match(build.env.ANDROID_VERSION_SUFFIX, /^-test\./);
  for (const app of APPS) {
    const g = read(`apps/${app}/android/app/build.gradle`);
    for (const k of ['DINGOGO_UPLOAD_STORE_FILE', 'DINGOGO_UPLOAD_STORE_PASSWORD', 'DINGOGO_UPLOAD_KEY_ALIAS', 'DINGOGO_UPLOAD_KEY_PASSWORD']) {
      assert.ok(g.includes(`'${k}'`), `${app} gradle reads ${k}`);
      assert.ok(steps(bundle).includes(k), `workflow sets ${k}`);
    }
    for (const k of ['ANDROID_VERSION_CODE', 'ANDROID_VERSION_SUFFIX', 'DINGOGO_REQUIRE_UPLOAD_KEY']) assert.ok(g.includes(`'${k}'`), `${app} gradle reads ${k}`);
    assert.match(g, /signingConfig uploadStoreFile \? signingConfigs\.upload : signingConfigs\.test/);
    assert.match(g, /new groovy\.json\.JsonSlurper\(\)\.parse\(rootProject\.file\('\.\.\/package\.json'\)\)/);
    assert.ok(!/storePassword '(?!dingogo-test)/.test(g), 'no real passwords in the repo');
  }
  assert.ok(!fs.readdirSync(path.join(ROOT, 'android-signing')).some((f) => /upload|release|play/i.test(f)), 'only the test key is committed');
});

test('store listing: Play limits, wording rules, URLs Play asks for; iOS usage strings cover the features', async () => {
  const l = JSON.parse(read('docs/store/listing.json'));
  const emoji = /\p{Extended_Pictographic}/u;
  assert.match(l.contact.privacy_policy, /^https:\/\/.+\/legal\/privacy$/);
  assert.match(l.contact.account_deletion, /^https:\/\/.+\/delete-account$/);
  for (const [app, a] of Object.entries<any>(l.apps)) {
    assert.ok(a.title.length <= 30, `${app} title ${a.title.length}`);
    assert.ok(a.short.length <= 80, `${app} short ${a.short.length}`);
    assert.ok(a.full.length <= 4000, `${app} full ${a.full.length}`);
    assert.ok(a.release_notes.length <= 500, `${app} release notes`);
    for (const t of [a.title, a.short, a.full, a.release_notes]) {
      assert.ok(!emoji.test(t), `${app}: no emoji`);
      assert.ok(!/100% electric|all-electric|fully electric/i.test(t), `${app}: never claim an all-electric fleet`);
    }
    assert.equal(a.package, `au.com.dingogo.${app}`);
    assert.match(read(`apps/${app}/capacitor.config.json`), new RegExp(`"appId": "${a.package.replace(/\./g, '\\.')}"`));
    assert.ok(a.screenshots.length >= 2 && a.screenshots.length <= 8, 'Play takes 2 to 8 phone screenshots');
    assert.ok(a.screenshots.every((s: any) => s.file.startsWith(`${app}-`) && s.file.endsWith('.png')));
  }
  assert.match(l.apps.rider.full, /75%/);
  // The website pages the listing points at exist.
  const { PAGES } = await load('../../../apps/web/src/seo.ts');
  for (const p of ['/legal/privacy', '/delete-account']) assert.ok(PAGES.some((x: any) => x.path === p), p);
  const ios = read('docs/store/ios-usage-strings.md');
  for (const k of ['NSLocationWhenInUseUsageDescription', 'NSCameraUsageDescription', 'NSPhotoLibraryUsageDescription', 'UIBackgroundModes', 'applinks:']) assert.ok(ios.includes(k), k);
});

test('permission explanations: say what, why, when and who sees it; versioned; plain words', async () => {
  const { DISCLOSURES } = await load('../../../packages/shared/src/permissions.ts');
  const loc = DISCLOSURES.driverLocation;
  assert.equal(loc.kind, 'location');
  assert.match(loc.lead, /collects your location/);
  assert.ok(loc.points.length >= 3);
  assert.ok(loc.notes.some((n: string) => /only while the app is open/i.test(n)), 'says when');
  assert.ok(loc.notes.some((n: string) => /shared with your rider/i.test(n)), 'says who sees it');
  for (const d of Object.values<any>(DISCLOSURES)) {
    assert.match(d.version, /^\d{4}-\d{2}-[a-z]+-\d+$/);
    for (const t of [d.title, d.lead, ...d.points, ...d.notes, d.accept, d.decline]) assert.ok(!/\p{Extended_Pictographic}/u.test(t) && !/!/.test(t), t);
  }
});

test('app links: website links to in-app addresses; Digital Asset Links never trusts the public test key', async () => {
  const { appLinkRoute } = await load('../../../packages/shared/src/applinks.ts');
  assert.equal(appLinkRoute('https://dingogo-steel.vercel.app/track/abcdefghjk23456789mn'), '/track/abcdefghjk23456789mn');
  assert.equal(appLinkRoute('https://dingogo-steel.vercel.app/track/abcdefghjk23456789mn/'), '/track/abcdefghjk23456789mn');
  assert.equal(appLinkRoute('https://dingogo-steel.vercel.app/rider/?from=-23.7,133.88,Todd%20Mall&ref=AMY12'), '/?from=-23.7,133.88,Todd%20Mall&ref=AMY12');
  assert.equal(appLinkRoute('https://dingogo-steel.vercel.app/rider'), '/');
  assert.equal(appLinkRoute('https://dingogo-steel.vercel.app/rider/trips'), '/trips');
  for (const bad of ['https://dingogo-steel.vercel.app/track/x', 'https://dingogo-steel.vercel.app/fares', 'http://dingogo-steel.vercel.app/track/abcdefghjk23456789mn',
    'https://dingogo-steel.vercel.app/ridersomething', 'not a url', 'https://dingogo-steel.vercel.app/rider//evil.example']) assert.equal(appLinkRoute(bad), null, bad);

  const hex = 'ab'.repeat(32);
  const colon = hex.toUpperCase().match(/../g)!.join(':');
  const r = parseCertList(`${hex}, ${colon} ${TEST_KEY_SHA256.toLowerCase()};nonsense`);
  assert.deepEqual(r.certs, [colon], 'deduplicated, normalised');
  assert.equal(r.rejected.length, 2, 'test key and junk refused');
  assert.deepEqual(assetLinks('au.com.dingogo.rider', []), []);
  assert.deepEqual(assetLinks('au.com.dingogo.rider', [colon]), [{ relation: ['delegate_permission/common.handle_all_urls'],
    target: { namespace: 'android_app', package_name: 'au.com.dingogo.rider', sha256_cert_fingerprints: [colon] } }]);
  // The test key the code refuses is the committed test keystore's (also checked by the Play job).
  assert.ok(read('android-signing/README.md').includes('never'));
});
