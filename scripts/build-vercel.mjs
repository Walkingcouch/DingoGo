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
  sh(`npx vite build --base ${a.base} --outDir ${dest} --emptyOutDir`, path.join(root, 'apps', a.dir), appEnv);
}

console.log('\n▶ bundling API');
const fn = path.join(out, 'functions/api.func');
fs.mkdirSync(fn, { recursive: true });
sh(`npx esbuild src/vercel.ts --bundle --platform=node --format=esm --target=node22 --minify-syntax --outfile=${fn}/index.mjs ` +
  `--external:pg-native --external:bufferutil --external:utf-8-validate ` +
  `--banner:js="import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);"`, path.join(root, 'services/api'));
fs.writeFileSync(path.join(fn, '.vc-config.json'), JSON.stringify({ runtime: 'nodejs22.x', handler: 'index.mjs', launcherType: 'Nodejs', maxDuration: 30, shouldAddHelpers: false }, null, 2));
fs.writeFileSync(path.join(fn, 'package.json'), JSON.stringify({ type: 'module' }));

// Security headers for the website and apps (the API sets its own). Referrer-Policy keeps share-trip tokens in /track/…
// URLs from leaking to map-tile servers; Permissions-Policy allows only what the apps use (location, camera for POD photos).
const staticHeaders = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Frame-Options': 'SAMEORIGIN',
  'Permissions-Policy': 'camera=(self), geolocation=(self), microphone=(), payment=(self), usb=(), interest-cohort=()',
};
const spa = (base) => ({ src: `^${base}(.*)$`, dest: `${base}index.html` });
fs.writeFileSync(path.join(out, 'config.json'), JSON.stringify({
  version: 3,
  routes: [
    { src: '^/(?!api(?:/|$)).*$', headers: staticHeaders, continue: true },
    { src: '^/(rider|driver|admin|partner|roof)$', status: 308, headers: { Location: '/$1/' } },
    { src: '^/api/?(.*)$', dest: '/api?__path=$1' },
    { handle: 'filesystem' },
    ...['/rider/', '/driver/', '/admin/', '/partner/', '/roof/'].map(spa),
    { src: '^/(.*)$', dest: '/index.html' },
  ],
}, null, 2));
console.log('\n✓ .vercel/output ready');
