#!/usr/bin/env node
/**
 * Round 21: Android launcher icon layers that are derived from the artwork, so they stay in step when the mascot changes.
 *
 *   node scripts/android-assets.mjs           write the files
 *   node scripts/android-assets.mjs --check   exit 1 if any file is missing or out of date (used by the store readiness test)
 *
 * For each app and density it reads mipmap-<density>/ic_launcher_foreground.png and writes ic_launcher_monochrome.png: the
 * themed-icon layer Android 13+ tints with the wallpaper colours. Android uses only its alpha, so it is the mascot's shape
 * (opaque where the foreground is), with the soft ground shadow left out and the inside lines (eyes, vest, hat band) cut out so
 * the dingo still reads at 48 dp. Deterministic: the same input always gives the same bytes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
export const APPS = ['rider', 'driver'];
export const DENSITIES = { mdpi: 108, hdpi: 162, xhdpi: 216, xxhdpi: 324, xxxhdpi: 432 };   // adaptive icon layers: 108 dp
const resDir = (app) => path.join(root, 'apps', app, 'android/app/src/main/res');

/** Alpha of the themed layer for one foreground pixel. */
export function inkAlpha(r, g, b, a) {
  if (a < 96) return 0;                                    // soft edges and the ground shadow's fade
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const sat = Math.max(r, g, b) - Math.min(r, g, b);
  if (lum > 0.62 && lum < 0.9 && sat < 18) return 0;       // the grey ground shadow under the feet
  if (lum < 0.16) return 0;                                // inside lines: outline, eyes, vest, hat band (cut out)
  return 255;
}

export function monochrome(fg) {
  const out = new PNG({ width: fg.width, height: fg.height });
  for (let i = 0; i < fg.data.length; i += 4) {
    out.data[i] = out.data[i + 1] = out.data[i + 2] = 255;
    out.data[i + 3] = inkAlpha(fg.data[i], fg.data[i + 1], fg.data[i + 2], fg.data[i + 3]);
  }
  return PNG.sync.write(out, { colorType: 6 });
}

export function plan() {
  const files = [];
  for (const app of APPS) {
    for (const [d, px] of Object.entries(DENSITIES)) {
      const src = path.join(resDir(app), `mipmap-${d}`, 'ic_launcher_foreground.png');
      const fg = PNG.sync.read(fs.readFileSync(src));
      if (fg.width !== px || fg.height !== px) throw new Error(`${src} is ${fg.width}x${fg.height}, expected ${px}x${px}`);
      files.push({ file: path.join(resDir(app), `mipmap-${d}`, 'ic_launcher_monochrome.png'), bytes: monochrome(fg) });
    }
  }
  return files;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const check = process.argv.includes('--check');
  const stale = [];
  for (const f of plan()) {
    const same = fs.existsSync(f.file) && Buffer.compare(fs.readFileSync(f.file), f.bytes) === 0;
    if (same) continue;
    if (check) stale.push(path.relative(root, f.file));
    else { fs.writeFileSync(f.file, f.bytes); console.log('wrote', path.relative(root, f.file)); }
  }
  if (check && stale.length) { console.error('Out of date (run node scripts/android-assets.mjs):\n' + stale.join('\n')); process.exit(1); }
  if (check) console.log('Android icon layers up to date');
}
