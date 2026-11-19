/**
 * Round 25: every screen an app routes to is in scripts/lib/screens.mjs, the list the UI tour (screenshots, layout and console checks)
 * and the accessibility check walk through. Several screens from rounds 17–24 shipped without a browser check; this keeps new ones
 * from doing the same.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const files = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : /\.tsx$/.test(d.name) ? [path.join(dir, d.name)] : []));
const routes = (file: string, prefix = '/') => [...fs.readFileSync(path.join(ROOT, file), 'utf8').matchAll(/<Route (?:index )?path="([^"]+)"/g)]
  .map((m) => m[1]).filter((p) => p !== '*' && !p.endsWith('/*')).map((p) => (p.startsWith('/') ? p : prefix + p));

// Routes that need something the demo data can't give a signed-in screen: a share or invite token, or an old alias.
const NOT_TOURED: Record<string, string[]> = {
  web: ['/drive/status/:token', '/invite/:code', '/hire/:token'],
  rider: ['/track/:token', '/trip/:id'],
};

test('every app screen is in scripts/lib/screens.mjs (UI tour and accessibility check)', async () => {
  const { SCREENS } = await import(pathToFileURL(path.join(ROOT, 'scripts/lib/screens.mjs')).href);
  const toured = (app: string) => (SCREENS as { app: string; path: string }[]).filter((s) => s.app === app).map((s) => s.path.split('?')[0]);
  const apps: Record<string, string[]> = {
    web: routes('apps/web/src/App.tsx'),
    rider: [...routes('apps/rider/src/App.tsx'), ...routes('apps/rider/src/screens/Account.tsx', '/account/')],
    driver: routes('apps/driver/src/App.tsx'),
    admin: routes('apps/admin/src/main.tsx'),
  };
  assert.ok(apps.web.length > 15 && apps.rider.length > 15 && apps.driver.length >= 7 && apps.admin.length >= 15, 'found the route lists');
  const missing: string[] = [];
  for (const [app, list] of Object.entries(apps)) {
    const have = toured(app);
    for (const r of list) {
      if (NOT_TOURED[app]?.includes(r)) continue;
      const re = new RegExp(`^${r.replace(/:[a-z]+/gi, '[^/]+')}$`);
      if (!have.some((p) => p === r || re.test(p))) missing.push(`${app}:${r}`);
    }
  }
  assert.deepEqual(missing, [], 'add these screens to scripts/lib/screens.mjs');
  // Signed-out screens of every app with a sign-in, and the files the tour and a11y check use exist.
  for (const app of ['rider', 'driver', 'admin', 'partner']) assert.ok(toured(`${app}-signed-out`).length, `${app} sign-in screen`);
  for (const f of ['scripts/ui-tour.mjs', 'scripts/a11y-check.mjs']) assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /lib\/screens\.mjs/);
  assert.ok(files(path.join(ROOT, 'apps/partner/src')).length > 0);
});
