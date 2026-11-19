/** Docs drift: every route the API registers is listed in docs/API.md, and every env var the config reads is in .env.example. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const API = path.resolve(import.meta.dirname, '..');
const DOC = fs.readFileSync(path.resolve(API, '../../docs/API.md'), 'utf8');
const srcFiles = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true })
  .flatMap((d) => (d.isDirectory() ? srcFiles(path.join(dir, d.name)) : d.name.endsWith('.ts') ? [path.join(dir, d.name)] : []));

test('docs/API.md lists every route the API registers', () => {
  const routes = new Set<string>();
  for (const f of srcFiles(path.join(API, 'src'))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/\bapp\.(get|post|put|patch|delete)\(\s*'([^']+)'/g)) routes.add(`${m[1].toUpperCase()} ${m[2]}`);
  }
  assert.ok(routes.size > 150, `found ${routes.size} routes`);
  // A path counts as documented when it appears in backticks or in prose followed by a space, query, `|`, `)` or a backtick.
  const missing = [...routes].filter((r) => {
    const p = r.split(' ')[1];
    return ![`${p}\``, `${p} `, `${p}?`, `${p}|`, `${p})`].some((s) => DOC.includes(s));
  });
  assert.deepEqual(missing, [], 'add these to docs/API.md');
});

test('.env.example names every environment variable the API reads', () => {
  const example = fs.readFileSync(path.join(API, '.env.example'), 'utf8');
  const used = new Set<string>();
  for (const f of srcFiles(path.join(API, 'src'))) {
    for (const m of fs.readFileSync(f, 'utf8').matchAll(/\benv\.([A-Z][A-Z0-9_]+)\b|process\.env\.([A-Z][A-Z0-9_]+)\b/g)) used.add(m[1] ?? m[2]);
  }
  // Set by the platform, or internal knobs for tests and fakes (provider base URLs, timeouts, bundle paths).
  for (const k of ['NODE_ENV', 'VERCEL', 'VERCEL_ENV', 'VERCEL_GIT_COMMIT_SHA', 'VERCEL_URL', 'VERCEL_REGION', 'PORT', 'HOST', 'HOSTNAME', 'SERVERLESS',
    'STRIPE_API_BASE', 'TWILIO_API_BASE', 'FCM_API_BASE', 'REGCHECK_URL', 'WEB_PUSH_ALLOW_HTTP', 'PUSH_TIMEOUT_MS', 'SENTRY_TIMEOUT_MS', 'MIGRATIONS_DIR', 'LOG_SMS']) used.delete(k);
  const missing = [...used].filter((k) => !new RegExp(`^#?\\s*${k}=`, 'm').test(example));
  assert.deepEqual(missing.sort(), [], 'add these to services/api/.env.example (commented out if optional)');
});
