#!/usr/bin/env node
/**
 * Accessibility check (WCAG 2.2 A/AA rules from axe-core) for the website, rider, driver, admin and partner apps, in light and dark mode
 * (phone size; the admin console at desktop size).
 *
 * Needs the API and the apps being checked running (npm run dev:api / dev:web / dev:rider / dev:driver / dev:admin / dev:partner, API with OTP_DEV_MODE=true so the demo
 * code works) and Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`, or set PLAYWRIGHT_PATH).
 *
 *   node scripts/a11y-check.mjs                      # default pages
 *   node scripts/a11y-check.mjs web:/drive rider:/trips
 *
 * Env: WEB_URL (http://localhost:5173), RIDER_URL (http://localhost:5174), DRIVER_URL (http://localhost:5175), API_URL (http://localhost:4000),
 *      ADMIN_URL (http://localhost:5176), PARTNER_URL (http://localhost:5177),
 *      RIDER_PHONE (0400000100), DRIVER_PHONE (+61400000011, an approved demo driver), ADMIN_PHONE (+61400000001), PARTNER_PHONE (+61400000300).
 * Exits 1 if any page has a violation.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const RIDER = process.env.RIDER_URL ?? 'http://localhost:5174';
const API = process.env.API_URL ?? 'http://localhost:4000';
const PHONE = process.env.RIDER_PHONE ?? '0400000100';
const DRIVER = process.env.DRIVER_URL ?? 'http://localhost:5175';
const DRIVER_PHONE = process.env.DRIVER_PHONE ?? '+61400000011';
const ADMIN = process.env.ADMIN_URL ?? 'http://localhost:5176';
const PARTNER = process.env.PARTNER_URL ?? 'http://localhost:5177';
const ADMIN_PHONE = process.env.ADMIN_PHONE ?? '+61400000001';
const PARTNER_PHONE = process.env.PARTNER_PHONE ?? '+61400000300';

let chromium;
for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/npm-tools/node_modules/playwright'].filter(Boolean)) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.error('Playwright not found. Install it (npm i -g playwright) or set PLAYWRIGHT_PATH.'); process.exit(2); }
const axeSrc = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const DEFAULT = ['web:/', 'web:/rides', 'web:/parcels', 'web:/tours', 'web:/business', 'web:/drive', 'web:/rewards', 'web:/help', 'web:/safety', 'web:/about',
  'rider-signed-out:/', 'rider:/', 'rider:/trips', 'rider:/rewards', 'rider:/account', 'rider:/account/profile', 'rider:/account/help',
  'rider:/account/payment', 'rider:/account/safety', 'rider:/account/privacy',
  'driver-signed-out:/', 'driver:/', 'driver:/earnings', 'driver:/trips', 'driver:/profile', 'driver:/charging',
  'admin-signed-out:/', 'admin:/live', 'admin:/dashboard', 'admin:/trips', 'admin:/safety', 'admin:/safety?tab=docs', 'admin:/support', 'admin:/drivers',
  'admin:/fleet', 'admin:/pricing', 'admin:/loyalty', 'admin:/ads', 'admin:/business', 'admin:/reports', 'admin:/settings',
  'partner-signed-out:/', 'partner:/'];
const pages = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;

async function signIn(phone, app) {
  const post = (p, b) => fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  await post('/auth/otp/request', { phone });
  const v = await post('/auth/otp/verify', { phone, code: '000000', app });
  if (!v.token) throw new Error(`Could not sign in ${phone}: ${JSON.stringify(v)}`);
  return v.token;
}

const browser = await chromium.launch();
const token = pages.some((p) => p.startsWith('rider:')) ? await signIn(PHONE, 'rider') : null;
const driverToken = pages.some((p) => p.startsWith('driver:')) ? await signIn(DRIVER_PHONE, 'driver') : null;
const adminToken = pages.some((p) => p.startsWith('admin:')) ? await signIn(ADMIN_PHONE, 'admin') : null;
const partnerToken = pages.some((p) => p.startsWith('partner:')) ? await signIn(PARTNER_PHONE, 'partner') : null;
const BASES = { web: WEB, rider: RIDER, 'rider-signed-out': RIDER, driver: DRIVER, 'driver-signed-out': DRIVER, admin: ADMIN, 'admin-signed-out': ADMIN, partner: PARTNER, 'partner-signed-out': PARTNER };
let total = 0;
for (const scheme of ['light', 'dark']) {
  for (const spec of pages) {
    const [app, path] = spec.split(/:(.*)/);
    const desktop = app.startsWith('admin');
    const ctx = await browser.newContext({ viewport: desktop ? { width: 1280, height: 900 } : { width: 390, height: 844 }, colorScheme: scheme });
    if (app === 'rider') await ctx.addInitScript((t) => localStorage.setItem('dingogo.rider.token', t), token);
    if (app === 'driver') await ctx.addInitScript((t) => localStorage.setItem('dingogo.driver.token', t), driverToken);
    if (app === 'admin') await ctx.addInitScript((t) => localStorage.setItem('dingogo.admin.token', t), adminToken);
    if (app === 'partner') await ctx.addInitScript((t) => localStorage.setItem('dingogo.partner.token', t), partnerToken);
    const page = await ctx.newPage();
    await page.goto(BASES[app] + path, { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(600);
    await page.addScriptTag({ content: axeSrc });
    const res = await page.evaluate(() => window.axe.run(document, { runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } }));
    total += res.violations.length;
    console.log(`${res.violations.length ? 'FAIL' : 'ok  '} ${scheme.padEnd(5)} ${spec}`);
    for (const v of res.violations) {
      console.log(`     ${v.id} (${v.impact}): ${v.help}`);
      for (const n of v.nodes.slice(0, 3)) console.log(`       ${n.target.join(' ')}  ${(n.failureSummary ?? '').split('\n')[1]?.trim() ?? ''}`);
    }
    await ctx.close();
  }
}
await browser.close();
console.log(total ? `\n${total} violation type(s) found.` : '\nNo violations.');
process.exit(total ? 1 : 0);
