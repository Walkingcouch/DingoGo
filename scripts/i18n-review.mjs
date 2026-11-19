#!/usr/bin/env node
/**
 * Translation review sheet for Arrernte and Kriol speakers: one row per app word, English beside each draft, with columns for the
 * reviewer to fill in. `npm run i18n:review` writes i18n-review.csv (open it in Excel or Google Sheets). Copy approved words back
 * into packages/shared/src/i18n/strings.json with status "reviewed", reviewed_by and reviewed_on.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const src = new URL('../packages/shared/src/i18n/strings.json', import.meta.url);
const data = JSON.parse(readFileSync(src, 'utf8'));
const langs = Object.keys(data.languages).filter((l) => l !== 'en');
const cell = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
const head = ['key', 'english', ...langs.flatMap((l) => [`${l}_draft`, `${l}_status`, `${l}_note`, `${l}_your_suggestion`, `${l}_reviewed_by`])];
const rows = Object.entries(data.strings).map(([k, e]) => [k, e.en, ...langs.flatMap((l) => [e[l]?.text ?? '', e[l]?.status ?? 'missing', e[l]?.note ?? '', '', e[l]?.reviewed_by ?? ''])]);
const out = process.argv[2] ?? 'i18n-review.csv';
writeFileSync(out, '﻿' + [head, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n');
const drafts = rows.length * langs.length - rows.reduce((n, r) => n + langs.filter((_, i) => r[2 + i * 5 + 1] === 'missing').length, 0);
console.log(`Wrote ${out}: ${rows.length} words, ${drafts} draft entries across ${langs.join(', ')} (everything else falls back to English).`);
