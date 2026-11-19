/**
 * Round 23: platform and dependency hygiene. Keeps the Android toolchain in step with the installed Capacitor (Google Play's
 * target API), one Node version everywhere, GitHub Actions off retired majors, and every workspace declaring what it imports
 * (and nothing it doesn't). No database, no Android SDK.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { parse as parseYaml } from 'yaml';

const ROOT = path.resolve(import.meta.dirname, '../../..');
const read = (rel: string) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const json = (rel: string) => JSON.parse(read(rel));
const APPS = ['rider', 'driver'] as const;
const major = (v: string) => Number(v.replace(/^[^\d]*/, '').split('.')[0]);
const gradleVars = (src: string) => Object.fromEntries([...src.matchAll(/^\s*(\w+)\s*=\s*'?([\w.-]+)'?\s*$/gm)].map((m) => [m[1], m[2]]));
/** Defaults in Capacitor's own Android library: `x = project.hasProperty('x') ? rootProject.ext.x : '1.2.3'`. */
const capDefaults = (src: string) => Object.fromEntries([...src.matchAll(/(\w+) = project\.hasProperty\('\1'\) \? rootProject\.ext\.\1 : '([^']+)'/g)].map((m) => [m[1], m[2]]));
const workflows = () => ['android', 'ci'].map((w) => ({ name: w, wf: parseYaml(read(`.github/workflows/${w}.yml`)) }));
const allSteps = () => workflows().flatMap(({ name, wf }) => Object.entries<any>(wf.jobs).flatMap(([job, j]) => (j.steps ?? []).map((s: any) => ({ where: `${name}/${job}`, ...s }))));

test('Android: target and compile API 36 (Google Play since 31 Aug 2026), versions match the installed Capacitor', () => {
  const core = json('node_modules/@capacitor/core/package.json').version;
  assert.ok(major(core) >= 8, `Capacitor ${core}: 8 or later is needed for API 36`);
  const lib = read('node_modules/@capacitor/android/capacitor/build.gradle');
  const libAgp = lib.match(/com\.android\.tools\.build:gradle:([\d.]+)/)![1];
  const libJava = lib.match(/sourceCompatibility JavaVersion\.VERSION_(\d+)/)![1];
  const defaults = capDefaults(lib);
  const installed = (n: string) => json(`node_modules/${n}/package.json`).version;
  for (const app of APPS) {
    const dir = `apps/${app}/android`;
    const v = gradleVars(read(`${dir}/variables.gradle`));
    assert.equal(Number(v.targetSdkVersion), 36, `${app} targetSdkVersion`);
    assert.equal(Number(v.compileSdkVersion), 36, `${app} compileSdkVersion`);
    assert.ok(Number(v.minSdkVersion) >= 24, `${app} minSdkVersion (Capacitor 8 needs 24)`);
    for (const [k, want] of Object.entries(defaults)) if (k in v) assert.equal(v[k], want, `${app} variables.gradle ${k} = Capacitor's ${want}`);
    assert.match(read(`${dir}/build.gradle`), new RegExp(`com\\.android\\.tools\\.build:gradle:${libAgp.replace(/\./g, '\\.')}'`), `${app} AGP ${libAgp}`);
    assert.match(read(`${dir}/build.gradle`), /com\.google\.gms:google-services:4\.4\.4'/);
    assert.match(read(`${dir}/gradle/wrapper/gradle-wrapper.properties`), /distributionUrl=https\\:\/\/services\.gradle\.org\/distributions\/gradle-8\.14\.3-all\.zip/);
    assert.match(read(`${dir}/app/capacitor.build.gradle`), new RegExp(`JavaVersion\\.VERSION_${libJava}\\b`), `${app}: run "npx cap sync android" and commit`);
    const g = read(`${dir}/app/build.gradle`);
    assert.match(g, /namespace = "au\.com\.dingogo\./);
    assert.match(g, /compileSdk = rootProject\.ext\.compileSdkVersion/);
    const m = read(`${dir}/app/src/main/AndroidManifest.xml`);
    const changes = m.match(/android:configChanges="([^"]+)"/)![1].split('|');
    for (const c of ['navigation', 'density', 'orientation', 'screenSize', 'smallestScreenSize', 'screenLayout', 'uiMode']) assert.ok(changes.includes(c), `${app} configChanges ${c}`);
    assert.match(m, /android:enableOnBackInvokedCallback="true"/, `${app}: predictive back`);
    assert.ok(!/windowOptOutEdgeToEdgeEnforcement|screenOrientation/.test(m + read(`${dir}/app/src/main/res/values/styles.xml`)), `${app}: no edge-to-edge opt-out or locked orientation (ignored on API 36)`);
    const cfg = json(`apps/${app}/capacitor.config.json`);
    assert.ok(!('adjustMarginsForEdgeToEdge' in (cfg.android ?? {})) && !('bundledWebRuntime' in cfg), `${app}: options removed in Capacitor 7/8`);
    assert.match(read(`apps/${app}/index.html`), /viewport-fit=cover/, `${app}: SystemBars passes safe areas to CSS only with viewport-fit=cover`);
    const pkg = json(`apps/${app}/package.json`);
    for (const [d, range] of Object.entries<string>({ ...pkg.dependencies, ...pkg.devDependencies })) {
      if (!d.startsWith('@capacitor/')) continue;
      assert.equal(major(range), major(core), `${app} ${d} ${range} on Capacitor ${major(core)}`);
      assert.equal(major(installed(d)), major(core), `${d} installed ${installed(d)}`);
    }
  }
  // The workflow builds with the Java version Capacitor compiles with, after checking the Gradle wrapper jars.
  const android = parseYaml(read('.github/workflows/android.yml'));
  for (const job of ['build', 'bundle']) {
    const steps: any[] = android.jobs[job].steps;
    const java = steps.find((s) => String(s.uses).startsWith('actions/setup-java@'));
    assert.equal(String(java.with['java-version']), libJava, `${job} job Java ${libJava}`);
    const validate = steps.findIndex((s) => String(s.uses).startsWith('gradle/actions/wrapper-validation@'));
    const gradle = steps.findIndex((s) => /gradlew/.test(s.run ?? ''));
    assert.ok(validate >= 0 && validate < gradle, `${job}: Gradle wrapper validated before it runs`);
  }
});

test('Android Back: on the first screen the app goes to the background instead of doing nothing', async () => {
  const { onBackButton } = await (import(new URL('../../../packages/shared/src/applinks.ts', import.meta.url).href) as Promise<any>);
  const calls: string[] = [];
  let listener: ((e: { canGoBack?: boolean }) => void) | undefined;
  const g = globalThis as any;
  const had = 'window' in g;
  g.window = { Capacitor: { isNativePlatform: () => true, isPluginAvailable: (n: string) => n === 'App', Plugins: { App: {
    addListener: (ev: string, fn: any) => { calls.push(`listen:${ev}`); listener = fn; return Promise.resolve({ remove: () => calls.push('removed') }); },
    minimizeApp: () => { calls.push('minimize'); return Promise.resolve(); },
  } } } };
  try {
    const stop = onBackButton(() => calls.push('back'));
    listener!({ canGoBack: true });
    listener!({ canGoBack: false });
    stop();
    await new Promise((r) => setTimeout(r, 0));
    assert.deepEqual(calls, ['listen:backButton', 'back', 'minimize', 'removed']);
    g.window = {};
    assert.equal(typeof onBackButton(), 'function', 'browser: no-op');
  } finally {
    if (had) g.window = undefined; else delete g.window;
  }
});

test('Node 22 everywhere: .nvmrc, engines, workflows, Vercel function, Docker image', () => {
  assert.equal(read('.nvmrc').trim(), '22');
  assert.equal(json('package.json').engines.node, '22.x', 'Vercel picks the Node version from engines');
  assert.match(read('scripts/build-vercel.mjs'), /runtime: 'nodejs22\.x'/);
  assert.match(read('services/api/Dockerfile'), /^FROM node:22-/m);
  for (const s of allSteps().filter((s) => String(s.uses).startsWith('actions/setup-node@'))) {
    assert.equal(s.with['node-version-file'], '.nvmrc', `${s.where}: Node from .nvmrc`);
    assert.ok(!('node-version' in s.with), `${s.where}: one source for the Node version`);
  }
  const cli = json('node_modules/@capacitor/cli/package.json');
  assert.match(cli.engines.node, />=\s*22/, 'Capacitor CLI needs Node 22');
});

test('GitHub Actions: first-party actions on current (Node 24) majors, third-party ones pinned', () => {
  const minimum: Record<string, number> = { 'actions/checkout': 6, 'actions/setup-node': 6, 'actions/setup-java': 5, 'actions/upload-artifact': 6, 'gradle/actions/wrapper-validation': 5 };
  const uses = allSteps().filter((s) => s.uses);
  assert.ok(uses.length > 0);
  for (const s of uses) {
    const [name, ref] = String(s.uses).split('@');
    if (name in minimum) assert.ok(major(ref) >= minimum[name], `${s.where}: ${s.uses} (Node 20 actions are retired)`);
    else assert.match(ref, /^v\d+\.\d+\.\d+$/, `${s.where}: third-party ${name} pinned to an exact version`);
  }
});

/** Bare package names a file imports (static, dynamic, require, require.resolve), and whether every import of it is type-only. */
function imports(src: string): Map<string, boolean> {
  const out = new Map<string, boolean>();
  const res = [/^\s*(?:import|export)\b([^'";]*?)\bfrom\s*['"]([^'"]+)['"]/gm, /^\s*import()\s*['"]([^'"]+)['"]/gm, /\bimport\(()\s*['"]([^'"]+)['"]\s*\)/g, /\brequire(?:\.resolve)?\(()\s*['"]([^'"]+)['"]\s*\)/g];
  for (const re of res) for (const m of src.matchAll(re)) {
    const s = m[2];
    if (s.startsWith('.') || s.startsWith('/') || s.startsWith('node:') || s.startsWith('virtual:')) continue;
    const name = s.startsWith('@') ? s.split('/').slice(0, 2).join('/') : s.split('/')[0];
    const typeOnly = /^\s*type\b/.test(m[1]);
    out.set(name, (out.get(name) ?? true) && typeOnly);
  }
  return out;
}
function files(dir: string, out: string[] = []): string[] {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', 'dist', 'android', 'ios', 'public', 'screenshots'].includes(e.name) || e.name.startsWith('.')) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) files(p, out); else if (/\.(m?[jt]sx?)$/.test(e.name) && !e.name.endsWith('.d.ts')) out.push(p);
  }
  return out;
}

test('dependencies: each workspace declares what it imports and nothing unused; one React, router and Vite version', () => {
  const root = json('package.json');
  const builtins = new Set(['fs', 'path', 'url', 'os', 'crypto', 'zlib', 'http', 'https', 'child_process', 'module', 'stream', 'util', 'events', 'net', 'assert', 'buffer', 'readline', 'worker_threads', 'perf_hooks', 'timers', 'dns', 'tls']);
  // Used without an import: native Capacitor packages (cap sync), the CLI and compilers run from package scripts, type packages.
  const noImport = (d: string) => d.startsWith('@types/') || d.startsWith('@capacitor/') || ['typescript', 'tsx'].includes(d);
  const workspaces = ['packages/shared', 'services/api', 'apps/web', 'apps/rider', 'apps/driver', 'apps/admin', 'apps/partner', 'apps/roof-display'];
  const ranges: Record<string, Set<string>> = { react: new Set(), 'react-dom': new Set(), 'react-router-dom': new Set(), vite: new Set(), '@vitejs/plugin-react': new Set() };
  for (const w of workspaces) {
    const pkg = json(`${w}/package.json`);
    const declared = { ...pkg.dependencies, ...pkg.devDependencies } as Record<string, string>;
    for (const [d, r] of Object.entries(declared)) if (d in ranges) ranges[d].add(r);
    const used = new Set<string>();
    const aliased = /@dingogo\/shared/.test(fs.existsSync(path.join(ROOT, w, 'vite.config.ts')) ? read(`${w}/vite.config.ts`) : '');
    for (const f of files(path.join(ROOT, w))) {
      const rel = path.relative(path.join(ROOT, w), f);
      for (const [name, typeOnly] of imports(fs.readFileSync(f, 'utf8'))) {
        if (builtins.has(name) || name === pkg.name) continue;
        used.add(name);
        // Tests and scripts may use the root's tooling (yaml, pngjs, axe-core); type-only imports may come from @types.
        const ok = name in declared || (typeOnly && `@types/${name}` in declared) || ((rel.startsWith('test') || rel.startsWith('scripts')) && name in (root.devDependencies ?? {}));
        assert.ok(ok, `${w}/${rel} imports ${name}, which ${w}/package.json doesn't declare`);
      }
    }
    if (aliased) used.add('@dingogo/shared');
    const unused = Object.keys(declared).filter((d) => !used.has(d) && !noImport(d));
    assert.deepEqual(unused, [], `${w}: unused dependencies`);
    for (const t of Object.keys(declared).filter((d) => d.startsWith('@types/'))) {
      const base = t.slice('@types/'.length).replace(/^(.+)__(.+)$/, '@$1/$2');
      assert.ok(base === 'node' || base in declared || used.has(base) || (base === 'react-dom' && 'react-dom' in declared), `${w}: ${t} without ${base}`);
    }
  }
  for (const [d, set] of Object.entries(ranges)) assert.equal(set.size, 1, `${d} declared as ${[...set].join(', ')}: keep one version`);
  assert.deepEqual([...ranges.react], ['18.3.1'], 'React 18');
  assert.equal(major([...ranges.vite][0]), 6);
});
