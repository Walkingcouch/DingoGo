#!/usr/bin/env node
/**
 * Builds the whole platform as ONE Vercel deployment using the Build Output API (.vercel/output):
 *   /            public website        /rider   rider app       /driver  driver app
 *   /admin       admin console          /partner partner portal  /roof    roof LED player
 *   /api/*       API (one Node function; Postgres via DATABASE_URL)
 * Run locally with `node scripts/build-vercel.mjs`, or let Vercel run it as the project's build command.
 */
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(root, '.vercel/output');
const sh = (cmd, cwd = root, env = {}) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(path.join(out, 'static'), { recursive: true });

const apps = [
  { dir: 'web', base: '/' },
  { dir: 'rider', base: '/rider/' },
  { dir: 'driver', base: '/driver/' },
  { dir: 'admin', base: '/admin/' },
  { dir: 'partner', base: '/partner/' },
  { dir: 'roof-display', base: '/roof/' },
];
const appEnv = { VITE_API_URL: process.env.VITE_API_URL ?? '/api', VITE_REALTIME: 'off', VITE_WEB_URL: process.env.VITE_WEB_URL ?? '' };

for (const a of apps) {
  const dest = path.join(out, 'static', a.base);
  console.log(`\n▶ building ${a.dir} → ${a.base}`);
  // Round 21: the version shown in the apps (Account / Profile), from the app's package.json and the deployed commit.
  const version = `${JSON.parse(fs.readFileSync(path.join(root, 'apps', a.dir, 'package.json'), 'utf8')).version ?? '0.0.0'}${process.env.VERCEL_GIT_COMMIT_SHA ? ` (${process.env.VERCEL_GIT_COMMIT_SHA.slice(0, 7)})` : ''}`;
  sh(`npx vite build --base ${a.base} --outDir ${dest} --emptyOutDir`, path.join(root, 'apps', a.dir), { ...appEnv, VITE_APP_VERSION: process.env.VITE_APP_VERSION ?? version });
}

console.log('\n▶ bundling API');
const fn = path.join(out, 'functions/api.func');
fs.mkdirSync(fn, { recursive: true });
sh(`npx esbuild src/vercel.ts --bundle --platform=node --format=esm --target=node22 --minify-syntax --outfile=${fn}/index.mjs ` +
  `--external:pg-native --external:bufferutil --external:utf-8-validate ` +
  `--banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);"`, path.join(root, 'services/api'));
fs.writeFileSync(path.join(fn, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', maxDuration: 30, shouldAddHelpers: false }, null, 2));
fs.writeFileSync(path.join(fn, 'package.json'), JSON.stringify({ type: 'module' }));
// Migrations ship with the function so AUTO_MIGRATE=true can roll the schema forward at cold start (src/lib/migrator.ts looks next to index.mjs).
fs.cpSync(path.join(root, 'services/api/migrations'), path.join(fn, 'migrations'), { recursive: true, filter: (f) => !/\.(md|txt)$/.test(f) });

// Security headers for the website and apps (the API sets its own). Referrer-Policy keeps share-trip tokens in /track/…
// URLs from leaking to map-tile servers; Permissions-Policy allows only what the apps use (location, camera for POD photos).
const staticHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=(), payment=(self), usb=(), interest-cohort=()',
};
const spa = (base) => ({ src: `^${base}(.*)$`, dest: `${base}index.html` });
// Website pages written with their own <head> (title, canonical, Open Graph, structured data) by apps/web/vite.config.ts.
// Each is served at /path and /path/; anything else (share-trip, status and invite links, unknown paths) gets app.html (noindex).
const prerendered = JSON.parse(fs.readFileSync(path.join(out, 'static', 'prerendered.json'), 'utf8')).pages.filter((p) => p !== '/');
fs.rmSync(path.join(out, 'static', 'prerendered.json'));
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '^/(?!api(?:/|$)).*$', headers: staticHeaders, continue: true },
    { src: '^/(rider|driver|admin|partner|roof)$', status: 308, headers: { Location: '/$1/' } },
    { src: '^/api/?(.*)$', dest: '/api?__path=$1' },
    // Round 21: Android App Links statement (the rider app opens share-trip and booking links), answered by the API from ANDROID_APP_LINK_CERTS.
    { src: '^/\\.well-known/assetlinks\\.json$', dest: '/api?__path=.well-known/assetlinks.json' },
    // Round 28: the low-data community trips page (plain HTML from the API, no app bundle).
    { src: '^/lite/?$', dest: '/api?__path=lite' },
    { src: '^/(sitemap\\.xml|robots\\.txt)$', headers: { 'Cache-Control': 'public, max-age=3600' }, continue: true },
    { src: '^/assets/(.*)$', headers: { 'Cache-Control': 'public, max-age=31536000, immutable' }, continue: true },
    ...prerendered.map((p) => ({ src: `^${escRe(p)}/?$`, dest: `${p}/index.html` })),
    { handle: 'filesystem' },
    ...['/rider/', '/driver/', '/admin/', '/partner/', '/roof/'].map(spa),
    { src: '^/(.*)$', dest: '/app.html' },
  ],
}, null, 2));
console.log('\n✓ .vercel/output ready');
