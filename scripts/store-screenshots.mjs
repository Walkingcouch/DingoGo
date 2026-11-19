#!/usr/bin/env node
/**
 * Round 21: Google Play store graphics from the real apps on demo data.
 *
 *   node scripts/build-vercel.mjs && npm run db:reset -w services/api
 *   DATABASE_URL=postgres://… node scripts/store-screenshots.mjs        (or: npm run store:screenshots)
 *
 * Writes to STORE_SHOTS (default ./store-shots, not committed):
 *   rider-1-book.png … rider-5-account.png, driver-1-online.png … driver-5-profile.png
 *       phone screenshots, 1080 × 1920 (9:16, Play's phone size), named as in docs/store/listing.json
 *   rider-feature-graphic.png, driver-feature-graphic.png   1024 × 500 feature graphics
 *   rider-icon-512.png, driver-icon-512.png                 512 × 512 hi-res icons (from apps/<app>/public/icon-512.png)
 *
 * A rider books a ride, the demo driver accepts, arrives, starts with the PIN and completes, so every screen has real content.
 * Map tiles need internet access; without it the map area is blank (run it on a laptop for the final pictures).
 * Env: DATABASE_URL (required), STORE_SHOTS, SHOTS_PORT (4318), PLAYWRIGHT_PATH, HEADED=1.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadChromium, root, startHarness } from './lib/vercel-harness.mjs';

const OUT = path.resolve(process.env.STORE_SHOTS || path.join(root, 'store-shots'));
fs.mkdirSync(OUT, { recursive: true });
const listing = JSON.parse(fs.readFileSync(path.join(root, 'docs/store/listing.json'), 'utf8'));
const chromium = loadChromium();
const { BASE, close } = await startHarness({ port: Number(process.env.SHOTS_PORT ?? 4318) });
const browser = await chromium.launch({ headless: !process.env.HEADED });

// 360 × 640 CSS pixels at 3× = 1080 × 1920.
const PHONE = { viewport: { width: 360, height: 640 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, locale: 'en-AU',
  timezoneId: 'Australia/Darwin', geolocation: { latitude: -23.6990, longitude: 133.8815 }, permissions: ['geolocation'], colorScheme: 'light' };
const written = [];
async function open(appPath) {
  const ctx = await browser.newContext(PHONE);
  const page = await ctx.newPage();
  await page.goto(BASE + appPath);
  return page;
}
async function signIn(page, mobile) {
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('button', { name: 'Text me a code' }).click();
  await page.getByLabel(/Code sent to/).fill('000000');
  await page.getByRole('button', { name: 'Sign in' }).click();
}
async function shot(page, file) {
  await page.waitForTimeout(800);   // let maps and transitions settle
  await page.screenshot({ path: path.join(OUT, file) });
  written.push(file);
  console.log('  wrote', file);
}

let exit = 0;
try {
  console.log(`Store screenshots from ${BASE} into ${OUT}`);
  const driver = await open('/driver/');
  await signIn(driver, '0400 000 011');
  await driver.getByRole('dialog', { name: 'Your location while you drive' }).getByRole('button', { name: 'Continue' }).click();
  await driver.getByRole('button', { name: 'Go online' }).click();
  const confirm = driver.getByRole('dialog').getByRole('button', { name: 'Go online' });
  if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) await confirm.click();
  await driver.getByRole('button', { name: 'Go offline' }).waitFor({ timeout: 15000 });
  await shot(driver, 'driver-1-online.png');

  const rider = await open('/rider/');
  await signIn(rider, '0400 000 100');
  await rider.getByRole('combobox', { name: 'Pickup' }).waitFor({ timeout: 15000 });
  await shot(rider, 'rider-1-book.png');
  await rider.getByRole('combobox', { name: 'Pickup' }).fill('Todd Mall');
  await rider.getByRole('option', { name: /^Todd Mall/ }).first().click();
  await rider.getByRole('combobox', { name: 'Drop-off' }).fill('Hospital');
  await rider.getByRole('option', { name: /Alice Springs Hospital/ }).first().click();
  const book = rider.getByRole('button', { name: /^Book ride for \$\d+\.\d\d$/ });
  await book.waitFor({ timeout: 15000 });
  await shot(rider, 'rider-2-quote.png');
  await book.click();
  await rider.waitForURL(/\/rider\/trips?\/[0-9a-f-]{36}/, { timeout: 15000 });

  const accept = driver.getByRole('button', { name: /^Accept/ });
  await accept.waitFor({ timeout: 30000 });
  await shot(driver, 'driver-2-offer.png');
  await accept.click();
  await driver.getByRole('button', { name: 'I’ve arrived' }).waitFor({ timeout: 15000 });
  await shot(driver, 'driver-3-trip.png');
  const pinBox = rider.locator('.pin__n');   // the rider's screen polls for the driver, then shows the trip PIN
  await pinBox.waitFor({ timeout: 20000 });
  const pin = (await pinBox.textContent())?.trim() ?? '';
  await shot(rider, 'rider-3-trip.png');

  await driver.getByRole('button', { name: 'I’ve arrived' }).click();
  await driver.getByLabel(/PIN/i).fill(pin);
  await driver.getByRole('button', { name: 'Start trip' }).click();
  await driver.getByRole('button', { name: 'Complete trip' }).click();
  await driver.getByRole('button', { name: 'Back to driving' }).click({ timeout: 15000 });
  await driver.goto(BASE + '/driver/earnings');
  await driver.getByRole('heading', { name: 'GST and your BAS' }).waitFor({ timeout: 15000 });
  await shot(driver, 'driver-4-earnings.png');
  await driver.goto(BASE + '/driver/profile');
  await driver.getByRole('heading', { name: 'Tax details' }).waitFor({ timeout: 15000 });
  await shot(driver, 'driver-5-profile.png');

  await rider.goto(BASE + '/rider/rewards');
  await rider.waitForLoadState('networkidle');
  await shot(rider, 'rider-4-rewards.png');
  await rider.goto(BASE + '/rider/account');
  await rider.getByRole('button', { name: 'Sign out' }).waitFor({ timeout: 15000 });
  await shot(rider, 'rider-5-account.png');

  // Feature graphics (1024 × 500) and hi-res icons (512 × 512).
  const mascot = `data:image/webp;base64,${fs.readFileSync(path.join(root, 'apps/web/src/assets/mascot-hero.webp')).toString('base64')}`;
  const ctx = await browser.newContext({ viewport: { width: 1024, height: 500 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  for (const [app, a] of Object.entries(listing.apps)) {
    const dark = app === 'driver';
    await page.setContent(`<!doctype html><html><head><style>
      body { margin: 0; width: 1024px; height: 500px; overflow: hidden; font-family: 'Atkinson Hyperlegible', system-ui, sans-serif;
        background: ${dark ? '#14213D' : '#E8912D'}; color: ${dark ? '#FBFAF7' : '#14213D'}; display: grid; grid-template-columns: 1fr 380px; align-items: center; }
      .copy { padding: 0 0 0 72px; } h1 { font-size: 64px; line-height: 1.02; margin: 0 0 18px; letter-spacing: -0.02em; }
      p { font-size: 28px; line-height: 1.3; margin: 0; max-width: 520px; } img { height: 460px; justify-self: center; }
      .tag { display: inline-block; margin-top: 26px; font-size: 20px; font-weight: 700; padding: 8px 16px; border-radius: 999px;
        background: ${dark ? '#E8912D' : '#14213D'}; color: ${dark ? '#14213D' : '#FBFAF7'}; }
    </style></head><body><div class="copy"><h1>${a.title.replace(/:.*/, '')}</h1><p>${a.short}</p>
      <span class="tag">Aboriginal-owned. Mparntwe (Alice Springs)</span></div><img alt="" src="${mascot}"></body></html>`);
    await page.waitForTimeout(300);
    await page.screenshot({ path: path.join(OUT, `${app}-feature-graphic.png`) });
    written.push(`${app}-feature-graphic.png`);
    fs.copyFileSync(path.join(root, 'apps', app, 'public/icon-512.png'), path.join(OUT, `${app}-icon-512.png`));
    written.push(`${app}-icon-512.png`);
    console.log(`  wrote ${app}-feature-graphic.png, ${app}-icon-512.png`);
  }
  const want = Object.values(listing.apps).flatMap((a) => a.screenshots.map((s) => s.file));
  const missing = want.filter((f) => !written.includes(f));
  if (missing.length) throw new Error(`listing.json names screenshots that weren't taken: ${missing.join(', ')}`);
  console.log(`Done: ${written.length} files.`);
} catch (e) {
  exit = 1;
  console.error(`Failed: ${e.message}`);
} finally {
  await browser.close();
  close();
  setTimeout(() => process.exit(exit), 200).unref();
}
