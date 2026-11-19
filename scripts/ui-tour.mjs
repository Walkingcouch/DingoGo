#!/usr/bin/env node
/**
 * Round 25: screen-by-screen UI tour of every app on demo data — the check a person would do by clicking through, as a script.
 * Opens every screen (and every tab on admin pages) at phone (390 × 844) and desktop (1280 × 900) sizes in light and dark,
 * saves a screenshot of each, and reports per screen: page errors, console errors, failed requests (4xx/5xx), horizontal
 * scrolling at phone width, controls without an accessible name, and slow loads.
 *
 *   node scripts/build-vercel.mjs && DATABASE_URL=… npm run db:reset -w services/api
 *   DATABASE_URL=postgres://… node scripts/ui-tour.mjs                  # everything
 *   DATABASE_URL=postgres://… node scripts/ui-tour.mjs rider admin:/support   # one app, or single screens
 *
 * Env: DATABASE_URL (required), TOUR_SHOTS (screenshots + report.json; default a scratch dir), TOUR_PORT (4319),
 *      RIDER_PHONE / DRIVER_PHONE / ADMIN_PHONE / PARTNER_PHONE and SKIP_ROLES (a fresh database without demo data, Round 29),
 *      TOUR_SIZES (phone,desktop), TOUR_SCHEMES (light,dark), SLOW_MS (2500), PLAYWRIGHT_PATH.
 * Runs against the built apps and the bundled serverless API (scripts/lib/vercel-harness.mjs). Exits 1 if any screen has a problem.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadChromium, startHarness } from './lib/vercel-harness.mjs';
import { SCREENS, PHONES } from './lib/screens.mjs';

const OUT = process.env.TOUR_SHOTS || fs.mkdtempSync(path.join(os.tmpdir(), 'dingogo-tour-'));
fs.mkdirSync(OUT, { recursive: true });
const SIZES = (process.env.TOUR_SIZES ?? 'phone,desktop').split(',');
const SCHEMES = (process.env.TOUR_SCHEMES ?? 'light,dark').split(',');
const SLOW_MS = Number(process.env.SLOW_MS ?? 2500);
const VIEWPORTS = { phone: { width: 390, height: 844 }, desktop: { width: 1280, height: 900 } };
const args = process.argv.slice(2);
// Round 29: RIDER_PHONE, DRIVER_PHONE, ADMIN_PHONE, PARTNER_PHONE override the demo numbers (as in a11y-check.mjs), so the tour can run
// on a freshly bootstrapped database with no demo data (empty screens); SKIP_ROLES=partner leaves out an app nobody can sign in to yet,
// and screens that show one record (`:trip`) are skipped when there is none.
const phones = { rider: process.env.RIDER_PHONE ?? PHONES.rider, driver: process.env.DRIVER_PHONE ?? PHONES.driver, admin: process.env.ADMIN_PHONE ?? PHONES.admin,
  partner: process.env.PARTNER_PHONE ?? PHONES.partner };
const skipRoles = (process.env.SKIP_ROLES ?? '').split(',').filter(Boolean);
const wanted = SCREENS.filter((s) => (!args.length || args.some((a) => a === s.app || a === `${s.app}:${s.path}`))
  && !skipRoles.includes(s.app.replace(/-signed-out$/, '')));

const chromium = loadChromium();
const { BASE, close } = await startHarness({ port: Number(process.env.TOUR_PORT ?? 4319) });
const post = (p, b) => fetch(`${BASE}/api${p}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(b) }).then((r) => r.json());
const tokens = {};
for (const role of new Set(wanted.map((s) => s.app.replace(/-signed-out$/, '')))) {
  if (!phones[role]) continue;
  await post('/auth/otp/request', { phone: phones[role] });
  const v = await post('/auth/otp/verify', { phone: phones[role], code: '000000', app: role });
  if (!v.token) { console.error(`Could not sign in ${role}: ${JSON.stringify(v)}`); process.exit(2); }
  tokens[role] = v.token;
}
// Screens that show one record use the newest one in the demo data (`:trip` = the demo rider's latest trip).
const latestTrip = tokens.rider ? (await fetch(`${BASE}/api/trips`, { headers: { authorization: `Bearer ${tokens.rider}` } }).then((r) => r.json())).trips?.[0]?.id : null;
const resolve = (p) => p.replace(':trip', latestTrip ?? 'none');

const browser = await chromium.launch();
const report = [];
const slug = (s) => s.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '') || 'home';
const PREFIX = { web: '', rider: '/rider', driver: '/driver', admin: '/admin', partner: '/partner' };

/** Things a person would notice: horizontal scrolling, unnamed controls, images without alt. */
const inspect = () => {
  const named = (el) => (el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.getAttribute('title') || el.textContent || '').trim()
    || (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label') || el.getAttribute('placeholder');
  const visible = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'; };
  const unnamed = [...document.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, [role=button], [role=tab]')]
    .filter((el) => visible(el) && !named(el)).map((el) => el.outerHTML.slice(0, 120));
  const doc = document.documentElement;
  const wide = [...document.querySelectorAll('body *')].filter((el) => {
    const r = el.getBoundingClientRect();
    if (r.right <= doc.clientWidth + 1 || r.width === 0) return false;
    for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden') return false; }
    return getComputedStyle(el).position !== 'fixed';
  }).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')} right=${Math.round(el.getBoundingClientRect().right)}`);
  return { overflow: doc.scrollWidth > doc.clientWidth + 1 ? wide.length ? wide : [`page ${doc.scrollWidth}px wide`] : [], unnamed: unnamed.slice(0, 5),
    empty: (document.body.innerText || '').trim().length < 20 };
};

for (const scheme of SCHEMES) for (const size of SIZES) for (const s of wanted) {
  if (s.only && s.only !== size) continue;
  if (s.path.includes(':trip') && !latestTrip) continue;
  const role = s.app.replace(/-signed-out$/, '');
  const ctx = await browser.newContext({ viewport: VIEWPORTS[size], colorScheme: scheme, locale: 'en-AU', timezoneId: 'Australia/Darwin',
    geolocation: { latitude: -23.699, longitude: 133.8815 }, permissions: ['geolocation'] });
  if (tokens[role] && !s.app.endsWith('-signed-out')) await ctx.addInitScript(([k, t]) => localStorage.setItem(k, t), [`dingogo.${role}.token`, tokens[role]]);
  // The driver's location explanation (Round 21) is answered once per device; answer it so the screen underneath shows.
  if (role === 'driver' && !s.app.endsWith('-signed-out')) await ctx.addInitScript(() => {
    const at = new Date().toISOString();
    localStorage.setItem('dingogo.driver.disclosure.location', JSON.stringify({ version: '2026-11-location-1', accepted: true, at }));
    localStorage.setItem('dingogo.driver.disclosure.notifications', JSON.stringify({ version: '2026-11-notify-1', accepted: false, at }));
  });
  const page = await ctx.newPage();
  const problems = [];
  page.on('pageerror', (e) => problems.push(`page error: ${e.message.split('\n')[0]}`));
  page.on('console', (m) => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) problems.push(`console: ${m.text().split('\n')[0].slice(0, 160)}`); });
  page.on('response', (r) => {
    const u = r.url();
    if (r.status() >= 400 && u.includes('/api/') && !(s.allow ?? []).some((a) => u.includes(a))) problems.push(`${r.status()} ${u.replace(BASE, '')}`);
  });
  const t0 = Date.now();
  await page.goto(BASE + PREFIX[role] + resolve(s.path), { waitUntil: 'networkidle', timeout: 30000 }).catch((e) => problems.push(`load: ${e.message.split('\n')[0]}`));
  const ms = Date.now() - t0;
  await page.waitForTimeout(400);
  const name = s.name ?? `${s.app}-${slug(s.path)}`;
  const views = [[name, null]];
  // tabs: true = every role="tab" on the page; a string = a CSS selector for the buttons that switch sections.
  const tabSel = s.tabs === true ? '[role="tab"]' : s.tabs;
  if (tabSel) {
    const tabs = (await page.locator(tabSel).allTextContents()).map((t) => t.trim());
    for (const t of tabs.slice(1)) views.push([`${name}~${slug(t)}`, t]);
  }
  // Nothing to open on an empty database (fresh bootstrap): skip that view rather than fail.
  if (s.open && await page.locator(s.open).count()) views.push([`${name}~open`, { open: s.open }]);
  for (const [file, tab] of views) {
    if (tab) {
      const target = typeof tab === 'string' ? page.locator(tabSel, { hasText: tab }).first() : page.locator(tab.open).first();
      await target.click({ timeout: 5000 }).catch((e) => problems.push(`${typeof tab === 'string' ? `tab ${tab}` : `open ${tab.open}`}: ${e.message.split('\n')[0]}`));
      await page.waitForLoadState('networkidle').catch(() => {});
      await page.waitForTimeout(300);
    }
    const r = await page.evaluate(inspect);
    const p = [...problems.splice(0)];
    if (size === 'phone' && r.overflow.length) p.push(`scrolls sideways: ${r.overflow.join(', ')}`);
    if (r.unnamed.length) p.push(`unnamed controls: ${r.unnamed.join(' | ')}`);
    if (r.empty) p.push('screen is blank');
    if (!tab && ms > SLOW_MS) p.push(`slow: ${ms} ms to settle`);
    const shot = `${file}-${size}-${scheme}.png`;
    // The apps scroll inside their own panes, so a full-page shot stops at the window: grow the window to the tallest pane first.
    const tall = await page.evaluate(() => Math.max(document.documentElement.scrollHeight,
      ...[...document.querySelectorAll('*')].filter((el) => { const o = getComputedStyle(el).overflowY; return (o === 'auto' || o === 'scroll') && el.scrollHeight > el.clientHeight + 4; })
        .map((el) => el.scrollHeight - el.clientHeight + window.innerHeight)));
    const vp = VIEWPORTS[size];
    if (tall > vp.height + 4) await page.setViewportSize({ width: vp.width, height: Math.min(tall, 8000) });
    await page.screenshot({ path: path.join(OUT, shot), fullPage: true }).catch(() => {});
    if (tall > vp.height + 4) await page.setViewportSize(vp);
    report.push({ screen: file, size, scheme, ms: tab ? null : ms, problems: p, shot });
    console.log(`${p.length ? 'FAIL' : 'ok  '} ${scheme.padEnd(5)} ${size.padEnd(7)} ${file}${tab ? '' : ` (${ms} ms)`}`);
    for (const x of p) console.log(`       ${x}`);
  }
  await ctx.close();
}
await browser.close();
close();
fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
const bad = report.filter((r) => r.problems.length);
console.log(`\n${report.length} views of ${wanted.length} screens; ${bad.length} with problems. Screenshots and report.json in ${OUT}`);
setTimeout(() => process.exit(bad.length ? 1 : 0), 100).unref();
