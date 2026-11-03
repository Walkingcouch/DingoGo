import fs from 'node:fs';
import path from 'node:path';
import { pool } from '../src/db.js';

const dir = path.resolve(import.meta.dirname, '../migrations');
const reset = process.argv.includes('--reset');
if (reset) {
  console.log('⚠ Dropping schema public');
  await pool.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
}
await pool.query('CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())');
const done = new Set((await pool.query('SELECT name FROM schema_migrations')).rows.map((r) => r.name));
for (const f of fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort()) {
  if (done.has(f)) continue;
  const sql = fs.readFileSync(path.join(dir, f), 'utf8').replace(/CREATE TABLE schema_migrations[^;]+;/, '');
  const c = await pool.connect();
  try {
    await c.query('BEGIN');
    await c.query(sql);
    await c.query('INSERT INTO schema_migrations (name) VALUES ($1)', [f]);
    await c.query('COMMIT');
    console.log('✓ applied', f);
  } catch (e) {
    await c.query('ROLLBACK');
    console.error('✗ failed', f, e);
    process.exit(1);
  } finally { c.release(); }
}
await pool.end();
