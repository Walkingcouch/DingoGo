#!/usr/bin/env node
/**
 * Accessibility check (WCAG 2.2 A/AA rules from axe-core) of every screen in scripts/lib/screens.mjs — website, rider, driver, admin and
 * partner apps, in light and dark mode (phone size; the admin console at desktop size), including every tab of tabbed pages (Round 25).
 *
 * Two ways to run it:
 *   1. Against the built apps and the bundled serverless API (what CI does; no dev servers needed):
 *        node scripts/build-vercel.mjs && DATABASE_URL=… npm run db:reset -w services/api
 *        DATABASE_URL=postgres://… node scripts/a11y-check.mjs --built         (or: npm run a11y)
 *   2. Against dev servers (npm run dev:api / dev:web / dev:rider / … with OTP_DEV_MODE=true):
 *        node scripts/a11y-check.mjs                      # every screen
 *        node scripts/a11y-check.mjs web:/drive rider:/trips
 *
 * Needs Playwright with Chromium (`npm i -g playwright && npx playwright install chromium`, or set PLAYWRIGHT_PATH).
 * Env (dev servers): WEB_URL (http://localhost:5173), RIDER_URL (:5174), DRIVER_URL (:5175), ADMIN_URL (:5176), PARTNER_URL (:5177),
 *      API_URL (http://localhost:4000); RIDER_PHONE, DRIVER_PHONE, ADMIN_PHONE, PARTNER_PHONE override the demo numbers.
 * Env (--built): DATABASE_URL (required), A11Y_PORT (4320).
 * Exits 1 if any page has a violation.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { PHONES, SCREENS } from './lib/screens.mjs';

const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const built = argv.includes('--built');
const only = argv.filter((a) => a !== '--built');

let chromium;
let BASES;
let API;
let closeHarness = () => {};
if (built) {
  const h = await import('./lib/vercel-harness.mjs');
  chromium = h.loadChromium();
  const { BASE, close } = await h.startHarness({ port: Number(process.env.A11Y_PORT ?? 4320) });
  closeHarness = close;
  API = `${BASE}/api`;
  BASES = { web: BASE, rider: `${BASE}/rider`, driver: `${BASE}/driver`, admin: `${BASE}/admin`, partner: `${BASE}/partner` };
} else {
  for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/npm-tools/node_modules/playwright'].filter(Boolean)) {
    try { ({ chromium } = require(p)); break; } catch { /* try the next */ }
  }
  if (!chromium) { console.error('Playwright not found. Install it (npm i -g playwright) or set PLAYWRIGHT_PATH.'); process.exit(2); }
  API = process.env.API_URL ?? 'http://localhost:4000';
  BASES = { web: process.env.WEB_URL ?? 'http://localhost:5173', rider: process.env.RIDER_URL ?? 'http://localhost:5174', driver: process.env.DRIVER_URL ?? 'http://localhost:5175',
    admin: process.env.ADMIN_URL ?? 'http://localhost:5176', partner: process.env.PARTNER_URL ?? 'http://localhost:5177' };
}
const phones = { rider: process.env.RIDER_PHONE ?? PHONES.rider, driver: process.env.DRIVER_PHONE ?? PHONES.driver, admin: process.env.ADMIN_PHONE ?? PHONES.admin,
  partner: process.env.PARTNER_PHONE ?? PHONES.partner };
const axeSrc = readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');

// Screens to check: from the command line (app:path), or every screen in the shared list.
const screens = only.length
  ? only.map((spec) => { const [app, path] = spec.split(/:(.*)/); return SCREENS.find((s) => s.app === app && s.path === path) ?? { app, path }; })
  : SCREENS;

const post = (p, b) => fetch(API + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const tokens = {};
for (const role of new Set(screens.map((s) => s.app).filter((a) => !a.endsWith('-signed-out')))) {
  if (!phones[role]) continue;
  await post('/auth/otp/request', { phone: phones[role] });
  const v = await post('/auth/otp/verify', { phone: phones[role], code: '000000', app: role });
  if (!v.token) throw new Error(`Could not sign in ${phones[role]}: ${JSON.stringify(v)}`);
  tokens[role] = v.token;
}
const latestTrip = tokens.rider ? (await fetch(`${API}/trips`, { headers: { authorization: `Bearer ${tokens.rider}` } }).then((r) => r.json())).trips?.[0]?.id : null;

const browser = await chromium.launch();
const RULES = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
let total = 0;
async function check(page, label) {
  await page.addScriptTag({ content: axeSrc });
  const res = await page.evaluate((tags) => window.axe.run(document, { runOnly: { type: 'tag', values: tags } }), RULES);
  total += res.violations.length;
  console.log(`${res.violations.length ? 'FAIL' : 'ok  '} ${label}`);
  for (const v of res.violations) {
    console.log(`     ${v.id} (${v.impact}): ${v.help}`);
    for (const n of v.nodes.slice(0, 3)) console.log(`       ${n.target.join(' ')}  ${(n.failureSummary ?? '').split('\n')[1]?.trim() ?? ''}`);
  }
}
for (const scheme of ['light', 'dark']) {
  for (const s of screens) {
    const role = s.app.replace(/-signed-out$/, '');
    const desktop = role === 'admin';
    const ctx = await browser.newContext({ viewport: desktop ? { width: 1280, height: 900 } : { width: 390, height: 844 }, colorScheme: scheme });
    if (!s.app.endsWith('-signed-out') && tokens[role]) await ctx.addInitScript(([k, t]) => localStorage.setItem(k, t), [`dingogo.${role}.token`, tokens[role]]);
    if (role === 'driver' && !s.app.endsWith('-signed-out')) await ctx.addInitScript(() => {
      const at = new Date().toISOString();
      localStorage.setItem('dingogo.driver.disclosure.location', JSON.stringify({ version: '2026-11-location-1', accepted: true, at }));
      localStorage.setItem('dingogo.driver.disclosure.notifications', JSON.stringify({ version: '2026-11-notify-1', accepted: false, at }));
    });
    const page = await ctx.newPage();
    await page.goto(BASES[role] + s.path.replace(':trip', latestTrip ?? 'none'), { waitUntil: 'networkidle' }).catch(() => {});
    await page.waitForTimeout(600);
    const label = `${scheme.padEnd(5)} ${s.app}:${s.path}`;
    await check(page, label);
    const tabSel = s.tabs === true ? '[role="tab"]' : s.tabs;
    if (tabSel) {
      const names = (await page.locator(tabSel).allTextContents()).map((t) => t.trim());
      for (const t of names.slice(1)) {
        await page.locator(tabSel, { hasText: t }).first().click({ timeout: 5000 }).catch(() => {});
        await page.waitForLoadState('networkidle').catch(() => {});
        await page.waitForTimeout(300);
        await check(page, `${label} › ${t}`);
      }
    }
    await ctx.close();
  }
}
await browser.close();
closeHarness();
console.log(total ? `\n${total} violation type(s) found.` : '\nNo violations.');
setTimeout(() => process.exit(total ? 1 : 0), 100).unref();
