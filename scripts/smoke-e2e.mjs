#!/usr/bin/env node
/**
 * Browser smoke test of the critical flows, against what Vercel actually serves: the built apps in .vercel/output/static and
 * the bundled serverless API function (.vercel/output/functions/api.func), so dispatch runs on requests exactly as in
 * production (no timer, no WebSockets, VITE_REALTIME=off polling).
 *
 *   1. Driver signs in and goes online near Todd Mall.
 *   2. Rider signs in, books a ride Todd Mall → Alice Springs Hospital and sees the trip PIN.
 *   3. Driver gets the offer, accepts, arrives, starts with the rider's PIN and completes; the rider sees it finished.
 *   4. Admin signs in and approves the waiting car (CB47JP) in Fleet → Cars to check.
 *   5. Driver sees the quarter's GST figures (Earnings) and tax details (Profile); admin opens every Tax & compliance tab.
 *   6. (Round 25) Rider, as the demo business account's manager, sees Spend and adds a cost centre in Set-up, and searches Help;
 *      driver opens Help; admin opens every tab of Support, Business, Loyalty, Tours and Fleet; partner opens every section.
 *
 * Needs: `node scripts/build-vercel.mjs`, a demo-seeded database (`DATABASE_URL=… npm run db:reset -w services/api`; sign-in
 * codes can be asked for once per 30 s per number, so reset before running again) and Playwright with Chromium
 * (`npm i -g playwright && npx playwright install chromium`, or PLAYWRIGHT_PATH).
 *
 *   DATABASE_URL=postgres://… node scripts/smoke-e2e.mjs
 *
 * Env: DATABASE_URL (required), SMOKE_PORT (4317), PLAYWRIGHT_PATH, HEADED=1, SMOKE_SHOTS=dir (screenshot per step).
 * Exits 1 on the first failed step (with a screenshot in SMOKE_SHOTS or the scratch dir).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadChromium, startHarness } from './lib/vercel-harness.mjs';

const PORT = Number(process.env.SMOKE_PORT ?? 4317);
const SHOTS = process.env.SMOKE_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'dingogo-smoke-'));
const chromium = loadChromium();
const { BASE, close: closeServer } = await startHarness({ port: PORT });

const browser = await chromium.launch({ headless: !process.env.HEADED });
const NEAR_TODD = { latitude: -23.6990, longitude: 133.8815 };
const phone = { viewport: { width: 390, height: 844 }, geolocation: NEAR_TODD, permissions: ['geolocation'], locale: 'en-AU', timezoneId: 'Australia/Darwin' };
const problems = [];
let step = '';
const pages = [];

async function open(appPath, opts = phone) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${appPath}: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 500) problems.push(`${appPath}: ${r.status()} ${r.url()}`); });
  pages.push(page);
  await page.goto(BASE + appPath);
  return page;
}
async function signIn(page, mobile) {
  await page.getByLabel('Mobile number').fill(mobile);
  await page.getByRole('button', { name: 'Text me a code' }).click();
  await page.getByLabel(/Code sent to/).fill('000000');
  await page.getByRole('button', { name: 'Sign in' }).click();
}
async function run(name, fn) {
  step = name;
  const t = Date.now();
  await fn();
  console.log(`  ok  ${name} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  if (process.env.SMOKE_SHOTS) for (const [i, p] of pages.entries()) await p.screenshot({ path: path.join(SHOTS, `${name.replace(/\W+/g, '-')}-${i}.png`) }).catch(() => {});
}
const apiJson = async (p, token) => (await fetch(BASE + '/api' + p, { headers: token ? { authorization: `Bearer ${token}` } : {} })).json();

let exit = 0;
try {
  console.log(`DingoGo smoke test on ${BASE} (built apps + serverless API)`);
  const driver = await open('/driver/');
  const rider = await open('/rider/');

  await run('driver signs in and goes online', async () => {
    await signIn(driver, '0400 000 011');
    // Round 21: the location explanation (Google Play prominent disclosure) comes before the phone asks.
    await driver.getByRole('dialog', { name: 'Your location while you drive' }).getByRole('button', { name: 'Continue' }).click();
    await driver.getByRole('button', { name: 'Go online' }).click();
    // Electric car: the battery check comes first.
    const confirm = driver.getByRole('dialog').getByRole('button', { name: 'Go online' });
    if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) await confirm.click();
    await driver.getByRole('button', { name: 'Go offline' }).waitFor({ timeout: 15000 });
  });

  let pin = '';
  await run('rider signs in and books a ride', async () => {
    await signIn(rider, '0400 000 100');
    const pickup = rider.getByRole('combobox', { name: 'Pickup' });
    await pickup.fill('Todd Mall');
    await rider.getByRole('option', { name: /^Todd Mall/ }).first().click();
    const drop = rider.getByRole('combobox', { name: 'Drop-off' });
    await drop.fill('Hospital');
    await rider.getByRole('option', { name: /Alice Springs Hospital/ }).first().click();
    const book = rider.getByRole('button', { name: /^Book ride for \$\d+\.\d\d$/ });
    await book.waitFor({ timeout: 15000 });
    await book.click();
    await rider.waitForURL(/\/rider\/trips?\/[0-9a-f-]{36}/, { timeout: 15000 });
  });

  await run('driver accepts, arrives, starts with the PIN and completes', async () => {
    const accept = driver.getByRole('button', { name: /^Accept/ });
    await accept.waitFor({ timeout: 30000 });
    await accept.click();
    await driver.getByRole('button', { name: 'I’ve arrived' }).click();
    const pinBox = rider.locator('.pin__n');
    await pinBox.waitFor({ timeout: 20000 });
    pin = (await pinBox.textContent())?.trim() ?? '';
    if (!/^\d{4}$/.test(pin)) throw new Error(`rider PIN not shown (got "${pin}")`);
    await driver.getByLabel(/PIN/i).fill(pin);
    await driver.getByRole('button', { name: 'Start trip' }).click();
    await driver.getByRole('button', { name: 'Complete trip' }).click();
    await driver.getByRole('button', { name: 'Back to driving' }).waitFor({ timeout: 15000 });
  });

  await run('rider sees the finished trip', async () => {
    await rider.getByText(/You've arrived|Trip complete|Thanks for riding|How was your trip/i).first().waitFor({ timeout: 30000 });
  });

  await run('admin approves a waiting car', async () => {
    const admin = await open('/admin/fleet', { viewport: { width: 1366, height: 900 }, locale: 'en-AU', timezoneId: 'Australia/Darwin' });
    await signIn(admin, '0400 000 001');
    const card = admin.locator('article.review', { hasText: 'CB47JP' });
    await card.waitFor({ timeout: 20000 });
    await card.getByLabel('Rego is current (checked on gov site)', { exact: false }).check();
    await card.getByLabel('Verified year').fill('2019');
    await card.getByLabel('How you checked').selectOption('compliance_plate');
    const later = (months) => { const d = new Date(); d.setMonth(d.getMonth() + months); return d.toISOString().slice(0, 10); };
    await card.getByLabel('CVL number').fill('CVL-SMOKE-1');
    await card.getByLabel('CVL expiry').fill(later(12));
    await card.getByLabel('Registration expiry').fill(later(10));
    await card.getByLabel('Insurance expiry').fill(later(11));
    await card.getByRole('button', { name: 'Approve car' }).click();
    await admin.getByText('CB47JP approved').waitFor({ timeout: 15000 });
    const token = await admin.evaluate(() => Object.entries(localStorage).find(([k]) => /token/i.test(k))?.[1] ?? null);
    const cars = token ? await apiJson('/admin/vehicles', token.replace(/^"|"$/g, '')) : null;
    const car = cars?.items?.find?.((v) => v.rego === 'CB47JP');
    if (car && car.status !== 'approved') throw new Error(`CB47JP is ${car.status}, expected approved`);
  });

  await run('driver sees the quarter’s GST figures and tax details', async () => {
    await driver.goto(BASE + '/driver/earnings');
    await driver.getByRole('heading', { name: 'GST and your BAS' }).waitFor({ timeout: 15000 });
    await driver.getByText('G1 Total sales (incl. GST)').waitFor({ timeout: 15000 });
    await driver.getByRole('button', { name: 'DingoGo tax invoice for fees' }).waitFor({ timeout: 15000 });
    await driver.goto(BASE + '/driver/profile');
    await driver.getByRole('heading', { name: 'Tax details' }).waitFor({ timeout: 15000 });
  });

  await run('admin opens Tax & compliance (BAS, SERR, levy, NDIS, records, privacy)', async () => {
    const admin = pages[pages.length - 1];
    await admin.goto(BASE + '/admin/tax');
    await admin.getByRole('heading', { name: 'DingoGo BAS worksheet' }).waitFor({ timeout: 15000 });
    for (const [tab, heading] of [['SERR (ATO)', 'Sharing Economy Reporting Regime'], ['Levy returns', 'Passenger levy returns'], ['NDIS invoices', 'NDIS invoices'],
      ['Record keeping', 'Record keeping'], ['Privacy requests', 'Privacy requests']]) {
      await admin.getByRole('tab', { name: tab }).click();
      await admin.getByRole('heading', { name: heading, exact: true }).first().waitFor({ timeout: 15000 });
    }
  });

  // Round 25: the screens added in rounds 17–24 (loyalty, tours, fleet, support, business) had no browser check.
  await run('rider manages the business account and searches help', async () => {
    await rider.goto(BASE + '/rider/business-account');
    const sections = rider.getByRole('group', { name: 'Business account' });
    await sections.getByRole('button', { name: 'Spend', pressed: true }).waitFor({ timeout: 15000 });
    await rider.getByText('By cost centre').waitFor({ timeout: 15000 });
    await sections.getByRole('button', { name: 'Set-up' }).click();
    await rider.getByLabel('Code').first().fill('SMOKE');
    await rider.getByLabel('Name').nth(1).fill('Smoke test team');
    await rider.getByRole('button', { name: 'Add cost centre' }).click();
    await rider.getByText('Cost centre added').waitFor({ timeout: 15000 });
    await rider.getByText('SMOKE Smoke test team').waitFor({ timeout: 15000 });
    await rider.goto(BASE + '/rider/account/help');
    await rider.getByLabel('Search help').fill('refund');
    await rider.getByText(/Refunds: when will I see my money/).first().waitFor({ timeout: 15000 });
    await driver.goto(BASE + '/driver/help');
    await driver.getByRole('heading', { name: 'Help', exact: true }).waitFor({ timeout: 15000 });
  });

  await run('admin opens every tab of Support, Business, Loyalty, Tours and Fleet', async () => {
    const admin = pages[pages.length - 1];
    for (const page of ['support', 'business', 'loyalty', 'tours', 'fleet']) {
      await admin.goto(`${BASE}/admin/${page}`);
      const tabs = admin.getByRole('tab');
      await tabs.first().waitFor({ timeout: 15000 });
      for (const name of await tabs.allTextContents()) {
        await admin.getByRole('tab', { name, exact: true }).click();
        await admin.waitForLoadState('networkidle');
        if (await admin.locator('[role="tabpanel"] .dg-error[role="alert"]').count()) throw new Error(`${page} › ${name} shows an error`);
      }
    }
  });

  await run('partner signs in and opens every section', async () => {
    const partner = await open('/partner/');
    await signIn(partner, '0400 000 300');
    await partner.getByLabel("Customer's reward code").waitFor({ timeout: 15000 });
    await partner.getByRole('button', { name: 'This month' }).click();
    await partner.getByRole('heading', { name: 'Last 6 months' }).waitFor({ timeout: 15000 });
    await partner.getByRole('button', { name: 'Statements' }).click();
    await partner.getByRole('button', { name: 'Sell credit' }).click();
    await partner.getByLabel('Voucher card code').waitFor({ timeout: 15000 });
  });

  if (problems.length) throw new Error(`errors while running:\n  ${problems.join('\n  ')}`);
  console.log('All smoke steps passed.');
} catch (e) {
  exit = 1;
  console.error(`\nFAILED at "${step}": ${e.message}`);
  if (/Code sent to/.test(e.message)) console.error('  (sign-in codes are limited to one per 30 s per number: reset the database, or wait, and run again)');
  for (const [i, p] of pages.entries()) {
    const f = path.join(SHOTS, `failed-${i}.png`);
    await p.screenshot({ path: f, fullPage: true }).catch(() => {});
    console.error(`  screenshot: ${f} (${p.url()})`);
  }
  if (problems.length) console.error(`  page errors / 5xx:\n    ${problems.join('\n    ')}`);
} finally {
  await browser.close();
  closeServer();
  setTimeout(() => process.exit(exit), 200).unref();
}
