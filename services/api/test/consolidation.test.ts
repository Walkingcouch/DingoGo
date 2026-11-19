/**
 * Round 30: final consolidation. Impossible dates and months are a 400 (or the default period), never a 500; every plain setting
 * the Settings page writes is checked (cash and cancellation policy included, partial saves merged); texts logged before Twilio is
 * set up don't show codes in production except staff sign-in codes. Runs with the seeded test database; settings it touches are put
 * back as they were (other test files run at the same time).
 */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildServer } from '../src/index.js';
import { one, pool, q } from '../src/db.js';
import { signToken } from '../src/auth.js';
import { isIsoDay, isIsoMonth } from '../src/lib/validate.js';
import { checkPlainSetting, CANCELLATION_DEFAULTS } from '../src/routes/admin.js';
import { devLogBody } from '../src/services/sms.js';

process.env.LOG_SMS = 'false';
let app: Awaited<ReturnType<typeof buildServer>>;
const tok: Record<string, string> = {};
let ip = 0;
async function call(method: string, url: string, who?: string, body?: unknown) {
  const res = await app.inject({ method: method as any, url, payload: body as any, remoteAddress: `10.230.${(++ip >> 8) & 255}.${ip & 255}`,
    headers: who ? { authorization: `Bearer ${tok[who]}` } : {} });
  return { status: res.statusCode, body: res.headers['content-type']?.toString().includes('json') ? JSON.parse(res.body) : res.body } as any;
}

before(async () => {
  app = await buildServer();
  await app.ready();
  for (const [r, phone] of Object.entries({ admin: '+61400000001', partner: '+61400000300' })) {
    const u = await one<{ id: string; role: any }>('SELECT id, role FROM users WHERE phone = $1', [phone]);
    tok[r] = signToken(u!);
  }
});
after(async () => { await app.close(); await pool.end(); });

test('dates and months: only real calendar days and months 01–12', () => {
  for (const d of ['2026-02-28', '2028-02-29', '2026-12-31', '2026-01-01']) assert.ok(isIsoDay(d), d);
  for (const d of ['2026-02-31', '2026-02-29', '2026-13-01', '2026-04-31', '2026-1-01', '2026-01-01T00:00', '', null, 20260101]) assert.ok(!isIsoDay(d), String(d));
  for (const m of ['2026-01', '2026-12']) assert.ok(isIsoMonth(m), m);
  for (const m of ['2026-00', '2026-13', '2026-1', '26-01', undefined]) assert.ok(!isIsoMonth(m), String(m));
});

test('impossible dates in report and list filters: never a 500', async () => {
  const bad = '2026-02-31';
  for (const url of [`/admin/trips?from=${bad}&to=${bad}`, '/admin/trips?limit=-5', `/admin/reports/gst?from=${bad}&to=${bad}`,
    `/admin/summary/daily?date=${bad}`, `/admin/audit?from=${bad}&to=${bad}`, `/admin/insights/health?from=${bad}&to=${bad}`,
    '/admin/trips?rider_id=------------------------------------']) {
    const r = await call('GET', url, 'admin');
    assert.equal(r.status, 200, `${url} falls back to the default period: ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  const daily = await call('GET', `/admin/summary/daily?date=${bad}`, 'admin');
  assert.notEqual(daily.body.date, bad, 'the default day, not the impossible one');
  for (const [url, who] of [[`/admin/fleet/profitability?from=${bad}&to=2026-03-31`, 'admin'], ['/admin/regional/topups?month=2026-13', 'admin'],
    ['/partner/topups?month=2026-13', 'partner']] as const) {
    const r = await call('GET', url, who);
    assert.ok([400, 403, 503].includes(r.status), `${url}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
  }
  assert.equal((await call('GET', '/admin/regional/topups?month=2026-13', 'admin')).status, 400);
});

test('plain settings are checked before they are saved; cash and cancellation policy merge partial saves', async () => {
  const fail = (k: string, v: unknown) => assert.throws(() => checkPlainSetting(k, v), (e: any) => e.code === 'invalid_setting', `${k} ${JSON.stringify(v)}`);
  fail('nt_levy_cents', 'abc'); fail('nt_levy_cents', -1); fail('nt_levy_cents', 1.5); fail('nt_levy_cents', 5000);
  fail('home_tariff_cents_per_kwh', 900); fail('vehicle_max_age_years', 0);
  fail('roof_display', { mode: 'on' }); fail('roof_display', null);
  fail('support', { email: 'nope' }); fail('support', { phone: 'call us' });
  fail('cash_payments', { ride: 'yes' }); fail('cash_payments', 'on');
  fail('cancellation_policy', { free_window_s: -5 }); fail('cancellation_policy', { scheduled_late_pct: 150 });
  fail('cancellation_policy', { scheduled_free_hours: { tour: 'two days' } });
  assert.equal(checkPlainSetting('nt_levy_cents', '120'), 120);
  assert.deepEqual(checkPlainSetting('roof_display', { mode: 'off', note: ' NT approval pending ' }), { mode: 'off', note: 'NT approval pending' });
  assert.deepEqual(checkPlainSetting('cash_payments', { courier: false }, { ride: false, courier: true, note: 'n' }), { ride: false, courier: false, note: 'n' });
  assert.deepEqual(checkPlainSetting('cancellation_policy', { scheduled_free_hours: { tour: 72 } }),
    { ...CANCELLATION_DEFAULTS, scheduled_free_hours: { tour: 72, hourly: 24 } });
  assert.equal((checkPlainSetting('some_other_key', 'as given') as string), 'as given');

  // Through the API: refused with the reason, nothing saved; a good partial save keeps the rest.
  const cur = async (k: string) => (await one(`SELECT value FROM settings WHERE key = $1`, [k]))?.value;
  const before = { levy: await cur('nt_levy_cents'), cash: await cur('cash_payments'), cancel: await cur('cancellation_policy') };
  try {
    const r = await call('PUT', '/admin/settings/nt_levy_cents', 'admin', { value: 'abc' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_setting');
    assert.deepEqual(await cur('nt_levy_cents'), before.levy);
    assert.equal((await call('PUT', '/admin/settings/cancellation_policy', 'admin', { value: { free_window_s: -5 } })).status, 400);
    const c = await call('PUT', '/admin/settings/cancellation_policy', 'admin', { value: { scheduled_late_pct: before.cancel?.scheduled_late_pct ?? 50 } });
    assert.equal(c.status, 200);
    assert.equal((await cur('cancellation_policy')).free_window_s, before.cancel?.free_window_s ?? 120, 'the rest kept');
    const k = await call('PUT', '/admin/settings/cash_payments', 'admin', { value: { note: 'Round 30 test' } });
    assert.equal(k.status, 200);
    const saved = await cur('cash_payments');
    assert.deepEqual([saved.ride, saved.courier, saved.note], [before.cash?.ride ?? false, before.cash?.courier ?? true, 'Round 30 test']);
    const pub = await call('GET', '/public/config');
    if (pub.status === 200 && pub.body.cash_payments) assert.equal(pub.body.cash_payments.ride, saved.ride);
  } finally {
    for (const [k, v] of [['nt_levy_cents', before.levy], ['cash_payments', before.cash], ['cancellation_policy', before.cancel]] as const) {
      if (v === undefined) await q(`DELETE FROM settings WHERE key = $1`, [k]);
      else await q(`UPDATE settings SET value = $2 WHERE key = $1`, [k, JSON.stringify(v)]);
    }
  }
});

test('texts logged before Twilio: codes masked in production, staff sign-in codes kept', () => {
  const body = 'Your DingoGo code is 482913. Delivery PIN 4821, ref DG-7K2Q, $25.40 on 19 Nov';
  assert.equal(devLogBody(body, {}, false), body, 'development: as sent');
  const masked = devLogBody(body, {}, true);
  assert.doesNotMatch(masked, /482913|4821\b/);
  assert.match(masked, /code is ••••••\. Delivery PIN ••••, ref DG-7K2Q, \$25\.40 on 19 Nov/);
  assert.equal(devLogBody(body, { logCodes: true }, true), body, 'staff sign-in: the code stays readable');
});
