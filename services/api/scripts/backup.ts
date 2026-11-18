/**
 * Back up the database to a file on this computer.
 *   npm run db:backup                         → backups/dingogo-<date>.dump (pg_dump custom format: schema + data, restorable)
 *   npm run db:backup -- --json               → backups/dingogo-<date>-json/<table>.json (data export, no pg_dump needed)
 *   npm run db:backup -- --out /path/file.dump
 * Uses MIGRATION_DATABASE_URL if set, else DATABASE_URL. Uses pg_dump when it is installed (falls back to the JSON export).
 * Backups contain personal information (phones, addresses, driver documents): keep them encrypted and off shared drives.
 * Restore: see docs/OPERATIONS.md → "Restore".
 */
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { config } from '../src/config.js';
import { sslFor } from '../src/lib/bootstrap.js';

const url = config.ops.migrationDatabaseUrl || config.databaseUrl;
const arg = (k: string) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : undefined; };
const stamp = new Date().toISOString().replace(/[:]/g, '').replace(/\..+/, '');
const outDir = path.resolve(process.cwd(), 'backups');
const hasPgDump = spawnSync('pg_dump', ['--version'], { stdio: 'ignore' }).status === 0;
const json = process.argv.includes('--json') || !hasPgDump;

if (!json) {
  const out = path.resolve(arg('--out') ?? path.join(outDir, `dingogo-${stamp}.dump`));
  fs.mkdirSync(path.dirname(out), { recursive: true });
  console.log(`pg_dump → ${out}`);
  // --no-owner/--no-privileges: restores cleanly into a new project whose roles differ (db:bootstrap re-applies RLS and grants).
  execFileSync('pg_dump', ['--format=custom', '--no-owner', '--no-privileges', '--schema=public', `--file=${out}`, url], { stdio: 'inherit' });
  fs.chmodSync(out, 0o600);
  console.log(`✓ ${(fs.statSync(out).size / 1e6).toFixed(1)} MB. Restore with: pg_restore --no-owner --no-privileges --dbname "$NEW_DATABASE_URL" ${path.basename(out)}`);
} else {
  if (!hasPgDump) console.log('pg_dump not found: writing a JSON export of every table instead (data only; schema comes from the migrations).');
  const dir = path.resolve(arg('--out') ?? path.join(outDir, `dingogo-${stamp}-json`));
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const pool = new pg.Pool({ connectionString: url, max: 1, ssl: sslFor(url) });
  const c = await pool.connect();
  try {
    // One consistent snapshot for every table.
    await c.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const tables = (await c.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename`)).rows.map((r) => r.tablename as string);
    const manifest: Record<string, number> = {};
    for (const t of tables) {
      const file = path.join(dir, `${t}.json`);
      const fd = fs.openSync(file, 'w', 0o600);
      let n = 0;
      fs.writeSync(fd, '[\n');
      // Page by ctid so big tables (uploads are bytea) don't need to fit in memory at once.
      const cur = `cur_${t.replace(/\W/g, '_')}`;
      await c.query(`DECLARE ${cur} NO SCROLL CURSOR FOR SELECT * FROM public."${t.replace(/"/g, '""')}"`);
      for (;;) {
        const rows = (await c.query(`FETCH 500 FROM ${cur}`)).rows;
        if (!rows.length) break;
        for (const r of rows) {
          for (const k of Object.keys(r)) if (Buffer.isBuffer(r[k])) r[k] = { base64: r[k].toString('base64') };
          fs.writeSync(fd, (n++ ? ',\n' : '') + JSON.stringify(r));
        }
      }
      await c.query(`CLOSE ${cur}`);
      fs.writeSync(fd, '\n]\n');
      fs.closeSync(fd);
      manifest[t] = n;
    }
    const version = (await c.query(`SELECT max(name) v FROM schema_migrations`).catch(() => ({ rows: [{ v: null }] }))).rows[0].v;
    await c.query('COMMIT');
    fs.writeFileSync(path.join(dir, '_manifest.json'), JSON.stringify({ at: new Date().toISOString(), schema_version: version, rows: manifest }, null, 2), { mode: 0o600 });
    console.log(`✓ ${tables.length} tables, ${Object.values(manifest).reduce((a, b) => a + b, 0)} rows → ${dir}`);
  } finally { c.release(); await pool.end(); }
}
