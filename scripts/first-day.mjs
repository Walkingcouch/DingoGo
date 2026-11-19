#!/usr/bin/env node
/**
 * Round 29: the first day of a brand-new DingoGo, in a browser, as the owners would live it — against what Vercel serves (the built
 * apps and the bundled serverless API) on an EMPTY database, in production mode:
 *
 *   0. The first request finds the empty database and AUTO_MIGRATE builds it (every migration, RLS, base data, the first admin from
 *      BOOTSTRAP_ADMIN_PHONE); /api/health/deep then says ok and lists the go-live checks.
 *   1. The admin signs in with a real text code (a local stand-in for Twilio records the texts; no demo codes, no 000000).
 *   2. Dashboard says it isn't ready for real riders; Settings: a wrong ABN is refused, the real ABN and legal name are saved.
 *   3. Pricing: the ride fare per km is changed; Alice Springs is the only zone taking bookings; community routes start closed.
 *   4. A driver signs up in the driver app; their papers and car go in through the API the app uses; the admin approves the papers
 *      (Safety → Documents to review), the car (Fleet) and the driver (Drivers).
 *   5. The driver goes online; a rider signs up, adds a card (mock payments) and books Todd Mall → Hospital; the driver accepts,
 *      arrives, starts with the PIN and completes; the rider sees the trip finished and gets a tax invoice with DingoGo's ABN.
 *   6. The admin pays the driver, sees the trip in the levy report and the go-live checks in Reports.
 *
 *   node scripts/build-vercel.mjs
 *   createdb dingogo_firstday            # must be empty: the script refuses a database that already has tables
 *   DATABASE_URL=postgres://…/dingogo_firstday node scripts/first-day.mjs
 *
 * Env: DATABASE_URL (an empty database; required), FIRST_DAY_PORT (4318), FIRST_DAY_SHOTS=dir (screenshot per step), PLAYWRIGHT_PATH.
 * Card payments use the mock provider (MOCK_CARDS=all) because Stripe test keys can't be used offline. Exits 1 on the first failure.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { loadChromium, root, startHarness } from './lib/vercel-harness.mjs';

const require = createRequire(path.join(root, 'services/api/package.json'));
const pg = require('pg');
const SHOTS = process.env.FIRST_DAY_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'dingogo-first-day-'));
fs.mkdirSync(SHOTS, { recursive: true });
if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL to an empty database.'); process.exit(2); }
{
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  const n = (await c.query(`SELECT count(*)::int n FROM information_schema.tables WHERE table_schema = 'public'`)).rows[0].n;
  await c.end();
  if (n) { console.error(`That database already has ${n} tables: the first-day walk needs an empty one (createdb a new database).`); process.exit(2); }
}

// A stand-in for Twilio's Messages API: records every text so the walk can read sign-in codes like a person reads their phone.
const texts = [];
const twilio = http.createServer((req, res) => {
  let b = ''; req.on('data', (c) => { b += c; });
  req.on('end', () => {
    const f = new URLSearchParams(b);
    texts.push({ to: f.get('To'), body: f.get('Body') ?? '' });
    res.writeHead(201, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ sid: `SM${texts.length.toString().padStart(32, '0')}`, status: 'queued' }));
  });
});
await new Promise((r) => twilio.listen(0, '127.0.0.1', r));

const ADMIN = { mobile: '0412 345 678', e164: '+61412345678' };
const DRIVER = { mobile: '0412 000 111', e164: '+61412000111' };
const RIDER = { mobile: '0412 000 222', e164: '+61412000222' };
const chromium = loadChromium();
const { BASE, close: closeServer } = await startHarness({
  port: Number(process.env.FIRST_DAY_PORT ?? 4318),
  env: {
    NODE_ENV: 'production', OTP_DEV_MODE: 'false', AUTO_MIGRATE: 'true', BOOTSTRAP_ADMIN_PHONE: ADMIN.mobile, BOOTSTRAP_ADMIN_NAME: 'First Owner',
    HEALTH_TOKEN: 'first-day-health-token', MOCK_CARDS: 'all', LOG_SMS: 'false', JWT_SECRET: 'first-day-walk-secret-0123456789abcdef',
    TWILIO_ACCOUNT_SID: 'ACfirstday', TWILIO_AUTH_TOKEN: 'first-day-token', TWILIO_FROM: '+61400999999', TWILIO_API_BASE: `http://127.0.0.1:${twilio.address().port}`,
  },
});

const browser = await chromium.launch({ headless: !process.env.HEADED });
const NEAR_TODD = { latitude: -23.6990, longitude: 133.8815 };
const phone = { viewport: { width: 390, height: 844 }, geolocation: NEAR_TODD, permissions: ['geolocation'], locale: 'en-AU', timezoneId: 'Australia/Darwin' };
const desk = { viewport: { width: 1366, height: 900 }, locale: 'en-AU', timezoneId: 'Australia/Darwin' };
const problems = [];
const pages = [];
let step = '';
const api = async (method, p, token, body) => {
  const r = await fetch(`${BASE}/api${p}`, { method, headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}), 'x-health-token': 'first-day-health-token' },
    body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(`${method} ${p} → ${r.status} ${JSON.stringify(j).slice(0, 300)}`);
  return j;
};
async function open(appPath, opts = phone) {
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => problems.push(`${appPath}: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 500) problems.push(`${appPath}: ${r.status()} ${r.url()}`); });
  pages.push(page);
  await page.goto(BASE + appPath);
  return page;
}
async function codeFor(e164) {
  for (let i = 0; i < 100; i++) {
    const t = [...texts].reverse().find((x) => x.to === e164 && /\b\d{6}\b/.test(x.body));
    if (t) return t.body.match(/\b(\d{6})\b/)[1];
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`no sign-in text reached ${e164}`);
}
async function signIn(page, who, name) {
  const before = texts.length;
  await page.getByLabel('Mobile number').fill(who.mobile);
  await page.getByRole('button', { name: 'Text me a code' }).click();
  const box = page.getByLabel(/Code sent to/);
  await box.waitFor({ timeout: 15000 });
  if (await page.getByText(/Demo account: your code is/).count()) throw new Error('a demo code was shown in production mode');
  for (let i = 0; i < 50 && texts.length === before; i++) await new Promise((r) => setTimeout(r, 100));
  await box.fill(await codeFor(who.e164));
  if (name) { const n = page.getByLabel(/Your name/); if (await n.count()) await n.fill(name); }
  await page.getByRole('button', { name: 'Sign in' }).click();
}
const tokenOf = async (page) => (await page.evaluate(() => Object.entries(localStorage).find(([k]) => /token/i.test(k))?.[1] ?? null))?.replace(/^"|"$/g, '');
async function run(name, fn) {
  step = name;
  const t = Date.now();
  await fn();
  console.log(`  ok  ${name} (${((Date.now() - t) / 1000).toFixed(1)} s)`);
  if (process.env.FIRST_DAY_SHOTS) for (const [i, p] of pages.entries()) await p.screenshot({ path: path.join(SHOTS, `${name.replace(/\W+/g, '-')}-${i}.png`), fullPage: true }).catch(() => {});
}
const later = (months) => { const d = new Date(); d.setMonth(d.getMonth() + months); return d.toISOString().slice(0, 10); };
// A 1 × 1 PNG stands in for each photo of a document.
const PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

let exit = 0;
try {
  console.log(`DingoGo first day on ${BASE} (built apps + serverless API, production mode, empty database)`);
  let admin, driver, rider, adminToken, driverToken, tripId;

  await run('the first request builds the empty database (AUTO_MIGRATE)', async () => {
    const h = await api('GET', '/health/deep');
    if (h.status !== 'ok') throw new Error(`health is ${h.status}: ${JSON.stringify(h.problems)}`);
    if (!h.schema || h.schema.pending.length || h.schema.version !== h.schema.expected) throw new Error('schema not up to date');
    if (!h.auto_migrate?.last?.applied?.length) throw new Error('auto-migrate applied nothing');
    if (h.security?.tables_without_rls?.length) throw new Error(`tables without RLS: ${h.security.tables_without_rls.join(', ')}`);
    if (h.base_data?.admins !== 1 || h.base_data?.active_zones !== 1) throw new Error(`base data ${JSON.stringify(h.base_data)}`);
    if (!h.launch || h.launch.ready) throw new Error('go-live checks missing, or "ready" with ABN TBC');
    const p = await fetch(`${BASE}/api/public/config`).then((r) => r.json());
    if ((p.zones ?? []).filter((z) => z.active).map((z) => z.id).join() !== 'alice-springs') throw new Error('only Alice Springs should take bookings');
  });

  await run('admin signs in with a texted code and sees the go-live note', async () => {
    admin = await open('/admin/', desk);
    await signIn(admin, ADMIN);
    await admin.getByRole('link', { name: 'Dashboard' }).first().waitFor({ timeout: 15000 });
    await admin.goto(BASE + '/admin/dashboard');
    await admin.getByText(/Not ready for real riders yet/).waitFor({ timeout: 15000 });
    adminToken = await tokenOf(admin);
  });

  await run('admin enters the business details (a wrong ABN is refused)', async () => {
    await admin.goto(BASE + '/admin/settings');
    const abn = admin.getByLabel('ABN', { exact: true });
    await abn.waitFor({ timeout: 15000 });
    await abn.fill('12 345 678 901');
    await admin.getByRole('button', { name: 'Save settings' }).click();
    await admin.getByText(/fails the ATO check/).first().waitFor({ timeout: 15000 });
    await abn.fill('51 824 753 556');
    await admin.getByLabel('Legal name').fill('DingoGo Pty Ltd');
    await admin.getByRole('button', { name: 'Save settings' }).click();
    await admin.getByText('Settings saved').waitFor({ timeout: 15000 });
    const s = await api('GET', '/admin/settings', adminToken);
    const biz = s.items.find((x) => x.key === 'business').value;
    if (biz.abn !== '51824753556' || biz.legal_name !== 'DingoGo Pty Ltd') throw new Error(`business saved as ${JSON.stringify(biz)}`);
    const roof = s.items.find((x) => x.key === 'roof_display').value;
    if (roof.mode !== 'off') throw new Error('roof screens should stay off');
  });

  await run('admin sets the fares; community routes start closed', async () => {
    await api('PATCH', '/admin/fares/ride', adminToken, { per_km_cents: 165 });
    const f = await api('GET', '/admin/fares', adminToken);
    if (f.items.find((x) => x.service === 'ride').per_km_cents !== 165) throw new Error('fare not saved');
    await admin.goto(BASE + '/admin/regional');
    await admin.getByText(/No route is taking bookings yet/).waitFor({ timeout: 15000 });
  });

  await run('a driver signs up and sends their papers and car', async () => {
    driver = await open('/driver/');
    await signIn(driver, DRIVER, 'Kumanjayi Driver');
    await driver.getByRole('dialog', { name: 'Your location while you drive' }).getByRole('button', { name: 'Continue' }).click();
    await driver.getByRole('heading', { name: 'Get ready to drive' }).waitFor({ timeout: 15000 });
    driverToken = await tokenOf(driver);
    await api('PATCH', '/driver/me', driverToken, { licence_no: 'NT1234567', cpv_authority_no: 'H12345', abn: '53 004 085 616', gst_registered: true, bank_bsb: '085005', bank_account: '12345678' });
    for (const type of ['licence', 'h_endorsement', 'cpvid', 'police_check', 'medical', 'abn', 'gst']) {
      const u = await api('POST', '/uploads', driverToken, { data_url: PNG, purpose: 'document' });
      await api('POST', '/driver/documents', driverToken, { type, file_url: u.url, number: `${type.toUpperCase()}-1`, expires_at: later(24) });
    }
    const car = (await api('POST', '/driver/vehicles', driverToken, { rego: 'CF29KL', make: 'Toyota', model: 'Camry Hybrid', year: 2022, colour: 'White', fuel_type: 'hybrid', vin: 'JTNB11HK403000001' })).vehicle;
    for (const type of ['vehicle_rego', 'insurance', 'vehicle_cvl', 'roadworthy', 'compliance_plate']) {
      const u = await api('POST', '/uploads', driverToken, { data_url: PNG, purpose: 'document' });
      await api('POST', '/driver/documents', driverToken, { type, file_url: u.url, number: `${type.toUpperCase()}-1`, expires_at: later(12), vehicle_id: car.id });
    }
  });

  await run('admin approves the papers, the car and the driver', async () => {
    await admin.goto(BASE + '/admin/safety?tab=docs');
    const all = admin.getByLabel(/^Select all \(\d+\)$/);
    await all.waitFor({ timeout: 15000 });
    await all.check();
    await admin.getByRole('button', { name: 'Approve selected' }).click();
    await admin.getByText('Nothing waiting for review.').waitFor({ timeout: 15000 });
    await admin.goto(BASE + '/admin/fleet');
    const card = admin.locator('article.review', { hasText: 'CF29KL' });
    await card.waitFor({ timeout: 20000 });
    await card.getByLabel('Rego is current (checked on gov site)', { exact: false }).check();
    await card.getByLabel('Verified year').fill('2022');
    await card.getByLabel('How you checked').selectOption('compliance_plate');
    await card.getByLabel('CVL number').fill('CVL-0001');
    await card.getByLabel('CVL expiry').fill(later(12));
    await card.getByLabel('Registration expiry').fill(later(10));
    await card.getByLabel('Insurance expiry').fill(later(11));
    await card.getByRole('button', { name: 'Approve car' }).click();
    await admin.getByText('CF29KL approved').waitFor({ timeout: 15000 });
    await admin.goto(BASE + '/admin/drivers');
    await admin.getByText('Kumanjayi Driver').first().click();
    const status = admin.locator('form.panel').getByRole('combobox', { name: /^Status/ });
    await status.waitFor({ timeout: 15000 });
    await status.selectOption('approved');
    await admin.getByRole('button', { name: 'Save driver' }).click();
    await admin.getByText('All credentials current. This driver can go online.').waitFor({ timeout: 15000 });
  });

  await run('the driver goes online', async () => {
    await driver.goto(BASE + '/driver/');
    await driver.getByRole('button', { name: 'Go online' }).click();
    const confirm = driver.getByRole('dialog').getByRole('button', { name: 'Go online' });
    if (await confirm.isVisible({ timeout: 3000 }).catch(() => false)) await confirm.click();
    await driver.getByRole('button', { name: 'Go offline' }).waitFor({ timeout: 15000 });
  });

  await run('a rider signs up, adds a card and books a ride', async () => {
    rider = await open('/rider/');
    await signIn(rider, RIDER, 'First Rider');
    await rider.getByRole('combobox', { name: 'Pickup' }).waitFor({ timeout: 15000 });
    const riderToken = await tokenOf(rider);
    await api('POST', '/payment-methods', riderToken, { provider_ref: 'pm_card_visa', brand: 'visa', last4: '4242', exp_month: 12, exp_year: 2030 });
    await rider.goto(BASE + '/rider/');
    const pickup = rider.getByRole('combobox', { name: 'Pickup' });
    await pickup.fill('Todd Mall');
    await rider.getByRole('option', { name: /^Todd Mall/ }).first().click();
    await rider.getByRole('combobox', { name: 'Drop-off' }).fill('Hospital');
    await rider.getByRole('option', { name: /Alice Springs Hospital/ }).first().click();
    const book = rider.getByRole('button', { name: /^Book ride for \$\d+\.\d\d$/ });
    await book.waitFor({ timeout: 15000 });
    await book.click();
    await rider.waitForURL(/\/rider\/trips?\/[0-9a-f-]{36}/, { timeout: 15000 });
    tripId = rider.url().match(/([0-9a-f-]{36})/)[1];
  });

  await run('the driver accepts, arrives, starts with the PIN and completes', async () => {
    const accept = driver.getByRole('button', { name: /^Accept/ });
    await accept.waitFor({ timeout: 30000 });
    await accept.click();
    await driver.getByRole('button', { name: 'I’ve arrived' }).click();
    const pinBox = rider.locator('.pin__n');
    await pinBox.waitFor({ timeout: 20000 });
    await driver.getByLabel(/PIN/i).fill((await pinBox.textContent()).trim());
    await driver.getByRole('button', { name: 'Start trip' }).click();
    await driver.getByRole('button', { name: 'Complete trip' }).click();
    await driver.getByRole('button', { name: 'Back to driving' }).waitFor({ timeout: 15000 });
    await rider.getByText(/You've arrived|Trip complete|Thanks for riding|How was your trip/i).first().waitFor({ timeout: 30000 });
  });

  await run('the rider gets a tax invoice with DingoGo’s ABN', async () => {
    const r = (await api('GET', `/trips/${tripId}/receipt`, await tokenOf(rider))).receipt;
    if (r.supplier_abn !== '51824753556') throw new Error(`receipt supplier ABN ${r.supplier_abn}`);
    if (!r.total_cents || !r.gst_cents) throw new Error('receipt has no total or GST');
    if (!texts.some((t) => t.to === RIDER.e164)) throw new Error('the rider was never texted');
  });

  await run('admin pays the driver and sees the levy and go-live checks', async () => {
    const d = (await api('GET', '/admin/payouts', adminToken)).balances.find((b) => b.name === 'Kumanjayi Driver');
    if (!d || d.balance_cents <= 0) throw new Error(`driver balance ${JSON.stringify(d)}`);
    await api('POST', `/admin/payouts/${d.driver_id}`, adminToken, {});
    if ((await api('GET', '/admin/payouts', adminToken)).balances.find((b) => b.driver_id === d.driver_id)?.balance_cents) throw new Error('balance not paid out');
    await admin.goto(BASE + '/admin/reports');
    await admin.getByText('Completed passenger trips').waitFor({ timeout: 15000 });
    const levy = await api('GET', `/admin/reports/levy?month=${new Date(Date.now() + 9.5 * 3600e3).toISOString().slice(0, 7)}`, adminToken);
    if (levy.passenger_trips !== 1 || levy.levy_payable_cents !== 100) throw new Error(`levy ${JSON.stringify(levy)}`);
    await admin.getByRole('heading', { name: 'Go-live checks' }).waitFor({ timeout: 15000 });
    const h = await api('GET', '/health/deep');
    const abn = h.launch.items.find((x) => x.id === 'business_abn');
    if (!abn?.ok) throw new Error('go-live check still says the ABN is missing');
  });

  if (problems.length) throw new Error(`errors while running:\n  ${problems.join('\n  ')}`);
  console.log(`First day done: ${texts.length} texts sent through the Twilio stand-in.`);
} catch (e) {
  exit = 1;
  console.error(`\nFAILED at "${step}": ${e.message}`);
  for (const [i, p] of pages.entries()) {
    const f = path.join(SHOTS, `failed-${i}.png`);
    await p.screenshot({ path: f, fullPage: true }).catch(() => {});
    console.error(`  screenshot: ${f} (${p.url()})`);
  }
  if (problems.length) console.error(`  page errors / 5xx:\n    ${problems.join('\n    ')}`);
} finally {
  await browser.close();
  closeServer();
  twilio.close();
  setTimeout(() => process.exit(exit), 200).unref();
}
