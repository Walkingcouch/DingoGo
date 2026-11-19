/**
 * What Vercel serves, on localhost, for browser scripts (smoke test, store screenshots): the built apps in .vercel/output/static
 * and the bundled serverless API (.vercel/output/functions/api.func) in serverless mode, with the same fallbacks as
 * .vercel/output/config.json. Needs `node scripts/build-vercel.mjs` and DATABASE_URL (a demo-seeded database).
 * Moved out of scripts/smoke-e2e.mjs in Round 21.
 */
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const require = createRequire(import.meta.url);
export const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const out = path.join(root, '.vercel/output');

/** Playwright's chromium (installed globally, next to the project, or at PLAYWRIGHT_PATH). Exits with a hint when missing. */
export function loadChromium() {
  for (const p of [process.env.PLAYWRIGHT_PATH, 'playwright', '/opt/npm-tools/node_modules/playwright'].filter(Boolean)) {
    try { return require(p).chromium; } catch { /* try the next */ }
  }
  console.error('Playwright not found. Install it (npm i -g playwright) or set PLAYWRIGHT_PATH.');
  process.exit(2);
}

export async function startHarness({ port = 4317, env = {} } = {}) {
  const BASE = `http://127.0.0.1:${port}`;
  if (!process.env.DATABASE_URL) { console.error('Set DATABASE_URL to a demo-seeded database (npm run db:reset -w services/api).'); process.exit(2); }
  if (!fs.existsSync(path.join(out, 'functions/api.func/index.mjs'))) { console.error('Build first: node scripts/build-vercel.mjs'); process.exit(2); }
  // The API exactly as bundled for Vercel, in serverless mode (dispatch on requests).
  Object.assign(process.env, {
    SERVERLESS: 'true', OTP_DEV_MODE: 'true', NODE_ENV: 'development', LOG_LEVEL: process.env.LOG_LEVEL ?? 'warn', LOG_SMS: 'false',
    AUTO_MIGRATE: 'false', JWT_SECRET: process.env.JWT_SECRET ?? 'smoke-test-secret-not-for-production', PUBLIC_WEB_URL: BASE, ...env,
  });
  const { default: api } = await import(pathToFileURL(path.join(out, 'functions/api.func/index.mjs')).href);

  const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png',
    '.webp': 'image/webp', '.jpg': 'image/jpeg', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon',
    '.woff2': 'font/woff2', '.txt': 'text/plain', '.xml': 'application/xml' };
  const staticDir = path.join(out, 'static');
  const fileAt = (p) => { const f = path.join(staticDir, p); return f.startsWith(staticDir) && fs.existsSync(f) && fs.statSync(f).isFile() ? f : null; };
  const server = http.createServer((req, res) => {
    const u = new URL(req.url ?? '/', BASE);
    if (u.pathname === '/api' || u.pathname.startsWith('/api/')) return void api(req, res);
    if (u.pathname === '/.well-known/assetlinks.json') { req.url = '/api/.well-known/assetlinks.json'; return void api(req, res); }
    const app = u.pathname.match(/^\/(rider|driver|admin|partner|roof)(\/|$)/);
    if (app && !app[2]) { res.writeHead(308, { location: `/${app[1]}/` }); return res.end(); }
    const f = fileAt(decodeURIComponent(u.pathname)) ?? fileAt(path.join(decodeURIComponent(u.pathname), 'index.html'))
      ?? (app ? fileAt(`/${app[1]}/index.html`) : fileAt('/app.html'));
    if (!f) { res.writeHead(404); return res.end(); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream' });
    fs.createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(port, '127.0.0.1', r));
  return { BASE, close: () => server.close() };
}
