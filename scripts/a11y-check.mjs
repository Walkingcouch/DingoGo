#!/usr/bin/env node
/**
 * Accessibility check (WCAG 2.2 A/AA rules from axe-core) for the website and the rider app, in light and dark mode at phone size.
 *
 * Needs the API, website and rider app running (npm run dev:api / dev:web / dev:rider, API with OTP_DEV_MODE=true so the demo
 * code works) and Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`, or set PLAYWRIGHT_PATH).
 *
 *   node scripts/a11y-check.mjs                      # default pages
 *   node scripts/a11y-check.mjs web:/drive rider:/trips
 *
 * Env: WEB_URL (http://localhost:5173), RIDER_URL (http://localhost:5174), API_URL (http://localhost:4000), RIDER_PHONE (0400000100).
 * Exits 1 if any page has a violation.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const WEB = process.env.WEB_URL ?? 'http://localhost:5173';
const RIDER = process.env.RIDER_URL ?? 'http://localhost:5174';
const API = process.env.API_URL ?? 'http://localhost:4000';
const PHONE = process.env.RIDER_PHONE ?? '0400000100';

let chromium;
for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/npm-tools/node_modules/playwright'].filter(Boolean)) {
  try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
}
if (!chromium) { console.error('Playwright not found. Install it (npm i -g playwright) or set PLAYWRIGHT_PATH.'); process.exit(2); }
const axeSrc = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

const DEFAULT = ['web:/', 'web:/rides', 'web:/parcels', 'web:/tours', 'web:/business', 'web:/drive', 'web:/rewards', 'web:/help', 'web:/safety', 'web:/about',
  'rider-signed-out:/', 'rider:/', 'rider:/trips', 'rider:/rewards', 'rider:/account', 'rider:/account/profile', 'rider:/account/help',
  'rider:/account/payment', 'rider:/account/safety', 'rider:/account/privacy'];
const pages = process.argv.slice(2).length ? process.argv.slice(2) : DEFAULT;

async function riderToken() {
  const post = (p, b) => fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
  await post('/auth/otp/request', { phone: PHONE });
  const v = await post('/auth/otp/verify', { phone: PHONE, code: '000000', app: 'rider' });
  if (!v.token) throw new Error(`Could not sign in ${PHONE}: ${JSON.stringify(v)}`);
  return v.token;
}

const browser = await chromium.launch();
const token = pages.some((p) => p.startsWith('rider:')) ? await riderToken() : null;
let total = 0;
for (const scheme of ['light', 'dark']) {
  for (const spec of pages) {
    const [app, path] = spec.split(/:(.*)/);
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: scheme });
    if (app === 'rider') await ctx.addInitScript((t) => localStorage.setItem('dingogo.rider.token', t), token);
    const page = await ctx.newPage();
    await page.goto((app === 'web' ? WEB : RIDER) + path, { waitUntil: 'networkidle' }).catch(() => {});
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
