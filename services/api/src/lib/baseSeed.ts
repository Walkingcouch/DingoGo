/**
 * Production-safe base data: what a brand-new DingoGo database needs to take bookings and be run from the admin console.
 * Zones, fare rules, jurisdictions (also set by migration 010), settings, plans, public holidays, tours — and the first admin.
 *
 * Every insert is "only if missing" (ON CONFLICT DO NOTHING): re-running never overwrites what admins have edited since.
 * No demo people, drivers, cars, cafés, promo codes or trips — those live in scripts/seed.ts (DEMO_DATA=true).
 * Roof screens start OFF (they need written NT approval); community routes start closed (placeholder prices and notes, Round 29).
 * Fares are set just under the NT-regulated Alice Springs taxi tariff ($5.50 flagfall + $2.45/km day, gazette S53 from 1 July 2026).
 */
import type pg from 'pg';
import { phone as phoneSchema } from './validate.js';
import { referralCode } from './ids.js';
import { DEFAULT_REGIONAL_POLICY } from './regional.js';

type Queryable = Pick<pg.PoolClient, 'query'>;

export const BUSINESS = { name: 'DingoGo Rideshare & Courier', legal_name: 'DingoGo Pty Ltd (TBC)', abn: 'TBC', address: 'Alice Springs NT 0870', email: 'contact@aperrke.com.au', owners: 'Johnathan Ah Chee & Micah Bartlett', aboriginal_owned: true };
export const SUPPORT = { phone: '0432 101 175', email: 'contact@aperrke.com.au', hours: '6am – midnight, 7 days', emergency: '000' };
/** Round 29: community routes start closed in production. Prices, distances, coverage gaps and permit notes are placeholders until the
 *  owners and the communities confirm them (admin → Community trips → Routes, then tick "Open for bookings"). Demo data opens them. */
export const REGIONAL_POLICY_CLOSED = { ...DEFAULT_REGIONAL_POLICY, corridors: DEFAULT_REGIONAL_POLICY.corridors.map((c) => ({ ...c, active: false })) };
export const ROOF_DISPLAY_OFF = { mode: 'off', note: 'Confirm in writing with NT Passenger Transport Division that roof screens are permitted before switching on in service.' };

export interface BaseSeedOptions {
  adminPhone?: string;
  adminName?: string;
  adminEmail?: string;
  /** Phone numbers that accept the demo code (must never become an admin). */
  demoNumbers?: string[];
}
export interface BaseSeedResult {
  inserted: Record<string, number>;
  admin: { status: 'created' | 'promoted' | 'exists' | 'not_set'; phone?: string };
}

export async function seedBase(c: Queryable, opts: BaseSeedOptions = {}): Promise<BaseSeedResult> {
  const inserted: Record<string, number> = {};
  const run = async (key: string, sql: string, params: unknown[] = []) => { inserted[key] = (inserted[key] ?? 0) + ((await c.query(sql, params as any[])).rowCount ?? 0); };

  // Jurisdictions come with migration 010; re-add NT if it was removed so zones below can reference it.
  await run('jurisdictions', `INSERT INTO jurisdictions (code, name, vehicle_max_age_years, levy_cents, levy_label, regulator, driver_docs, vehicle_docs, active)
    VALUES ('NT', 'Northern Territory', 13, 100, 'NT passenger levy', 'NT Department of Logistics and Infrastructure — Passenger Transport (Commercial Passenger Vehicles)',
      '["licence","h_endorsement","cpvid","police_check","medical","abn","gst"]', '["vehicle_rego","insurance","vehicle_cvl","roadworthy","compliance_plate"]', true)
    ON CONFLICT (code) DO NOTHING`);

  await run('zones', `INSERT INTO zones (id, name, centre_lat, centre_lng, radius_km, active, launch_note) VALUES
    ('alice-springs', 'Alice Springs (Mparntwe)', -23.6980, 133.8807, 25, true, 'Phase 1 — launch'),
    ('tennant-creek', 'Tennant Creek', -19.6497, 134.1912, 15, false, 'Phase 2'),
    ('yulara', 'Yulara / Ayers Rock Resort', -25.2406, 130.9889, 20, false, 'Phase 2 — needs charging plan (450 km from Alice)'),
    ('darwin', 'Darwin', -12.4634, 130.8456, 35, false, 'Phase 3')
    ON CONFLICT (id) DO NOTHING`);

  await run('fare_rules', `INSERT INTO fare_rules (service, label, base_cents, per_km_cents, per_min_cents, booking_fee_cents, min_fare_cents, cancel_fee_cents, free_wait_min, wait_per_min_cents, night_pct, holiday_pct, levy_cents, description) VALUES
    ('ride',      'DingoGo Ride',        300, 160, 25, 100, 1000, 300, 3, 50, 20, 15, 100, 'Up to 4 passengers. Electric and hybrid cars get your trip first'),
    ('pet',       'Pet-friendly Ride',   500, 160, 25, 100, 1400, 300, 3, 50, 20, 15, 100, 'Seat covers & harness point. Pets must be leashed or crated'),
    ('courier_s', 'Courier — Small',     600, 120, 15,   0, 1200, 300, 5,  0,  0,  0,   0, 'Satchel or small box, up to 5 kg'),
    ('courier_m', 'Courier — Medium',    900, 140, 20,   0, 1600, 300, 5,  0,  0,  0,   0, 'Box up to 15 kg (fits on back seat)'),
    ('courier_l', 'Courier — Large',    1400, 160, 25,   0, 2400, 300, 5,  0,  0,  0,   0, 'Up to 25 kg, fits in a standard car boot'),
    ('tour',      'Private Tour',          0,   0,  0,   0,    0, 2500, 10, 0,  0,  0, 100, 'Fixed-price private tours, up to 4 guests'),
    ('hourly',    'Hourly Hire',           0,   0, 125, 0, 7500, 2500, 10, 0,  0,  0, 100, 'Events & corporate — $75/hr, 1 hour minimum')
    ON CONFLICT (service) DO NOTHING`);

  await run('public_holidays', `INSERT INTO public_holidays (day, name) VALUES
    ('2026-12-25','Christmas Day'), ('2026-12-26','Boxing Day'), ('2026-12-28','Boxing Day (additional)'),
    ('2027-01-01','New Year''s Day'), ('2027-01-26','Australia Day'), ('2027-03-26','Good Friday'), ('2027-03-27','Easter Saturday'),
    ('2027-03-29','Easter Monday'), ('2027-04-26','Anzac Day (observed)'), ('2027-05-03','May Day'), ('2027-06-14','King''s Birthday'),
    ('2027-07-02','Alice Springs Show Day'), ('2027-08-02','Picnic Day')
    ON CONFLICT (day) DO NOTHING`);

  await run('plans', `INSERT INTO plans (code, name, price_cents, ride_discount_pct, free_deliveries, waive_booking_fee, perks) VALUES
    ('pass', 'DingoGo Pass', 999, 10, 2, true, ARRAY['10% off every ride','No booking fees','2 free small deliveries / month','Double points at partner cafés']),
    ('pass_biz', 'DingoGo Pass Business', 2999, 15, 8, true, ARRAY['15% off every ride','No booking fees','8 free deliveries / month','Priority dispatch'])
    ON CONFLICT (code) DO NOTHING`);

  // Migrations 003 and 009 add cash_payments, cancellation_policy and vehicle_max_age_years.
  await run('settings', `INSERT INTO settings (key, value) VALUES
    ('business', $1), ('support', $2), ('nt_levy_cents', '100'), ('home_tariff_cents_per_kwh', '30'), ('roof_display', $3), ('regional_policy', $4)
    ON CONFLICT (key) DO NOTHING`, [JSON.stringify(BUSINESS), JSON.stringify(SUPPORT), JSON.stringify(ROOF_DISPLAY_OFF), JSON.stringify(REGIONAL_POLICY_CLOSED)]);

  await run('tour_packages', `INSERT INTO tour_packages (slug, name, summary, description, duration_min, price_cents, stops, cultural_note, requires_permit) VALUES
    ('town-heritage', 'Mparntwe Town & Telegraph Station', 'Two hours around town: Anzac Hill, the Telegraph Station and the Royal Flying Doctor base.',
     'An easy introduction to Alice Springs. Your driver takes you to Anzac Hill for the view over the MacDonnell Ranges, the historic Telegraph Station where the town began, and the RFDS Tourist Facility. Plenty of time for photos.',
     120, 22000, '["Anzac Hill","Alice Springs Telegraph Station","RFDS Tourist Facility"]', 'Alice Springs is Mparntwe, Arrernte Country. Some places around town are sacred sites — your driver will tell you where not to climb or photograph.', false),
    ('west-macs-gaps', 'West MacDonnell Gaps', 'Half day to Simpsons Gap (Rungutjirba) and Standley Chasm (Angkerle Atwatye).',
     'Head west along Larapinta Drive into Tjoritja / West MacDonnell National Park. Walk into Simpsons Gap to look for black-footed rock-wallabies, then continue to Standley Chasm (entry fee payable at the kiosk). Includes cold water.',
     270, 42000, '["Simpsons Gap (Rungutjirba)","Standley Chasm (Angkerle Atwatye)"]', 'Standley Chasm is owned and run by the Iwupataka Land Trust. Please follow signage and the requests of Traditional Owners.', true),
    ('desert-sunset', 'Desert Park & Sunset', 'Alice Springs Desert Park then sunset at Anzac Hill.',
     'Drop-off at Alice Springs Desert Park with a pick-up time that suits you (park entry not included), then on to Anzac Hill for sunset over the ranges.',
     210, 29000, '["Alice Springs Desert Park","Anzac Hill"]', NULL, false),
    ('east-macs-gaps', 'Emily & Jessie Gaps', 'Short trip east to Anthwerrke and Atherrke.',
     'Visit the rock art and waterholes at Emily Gap (Anthwerrke) and Jessie Gap (Atherrke) in the East MacDonnell Ranges, both important Arrernte sites connected to the caterpillar Dreaming.',
     150, 26000, '["Emily Gap (Anthwerrke)","Jessie Gap (Atherrke)"]', 'Anthwerrke is a registered sacred site. Swimming and climbing are not permitted; please photograph the rock art only from the viewing area.', false)
    ON CONFLICT (slug) DO NOTHING`);

  // First admin (BOOTSTRAP_ADMIN_PHONE). Signs in with an SMS code like everyone else.
  if (!opts.adminPhone) return { inserted, admin: { status: 'not_set' } };
  const parsed = phoneSchema.safeParse(opts.adminPhone);
  if (!parsed.success) throw new Error(`BOOTSTRAP_ADMIN_PHONE "${opts.adminPhone}" is not a valid phone number`);
  const p = parsed.data;
  if ((opts.demoNumbers ?? []).includes(p)) throw new Error(`BOOTSTRAP_ADMIN_PHONE ${p} is a demo number (accepts the demo code): use a real mobile`);
  const name = (opts.adminName || 'DingoGo Admin').slice(0, 100);
  const existing = (await c.query('SELECT id, role, deleted_at FROM users WHERE phone = $1', [p])).rows[0];
  let status: BaseSeedResult['admin']['status'];
  if (!existing) {
    const u = (await c.query(`INSERT INTO users (phone, name, role, email, referral_code) VALUES ($1, $2, 'admin', $3, $4) RETURNING id`,
      [p, name, opts.adminEmail || null, referralCode(name)])).rows[0];
    await c.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES (NULL, 'bootstrap.admin_created', 'user', $1, $2)`, [u.id, JSON.stringify({ phone_tail: p.slice(-3) })]);
    status = 'created';
  } else if (existing.role !== 'admin' || existing.deleted_at) {
    await c.query(`UPDATE users SET role = 'admin', deleted_at = NULL, blocked = false WHERE id = $1`, [existing.id]);
    await c.query(`INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES (NULL, 'bootstrap.admin_promoted', 'user', $1, $2)`, [existing.id, JSON.stringify({ from: existing.role, phone_tail: p.slice(-3) })]);
    status = 'promoted';
  } else status = 'exists';
  return { inserted, admin: { status, phone: p } };
}

/** For health checks: is the minimum present to take bookings and sign in to admin? */
export async function baseDataStatus(c: Queryable) {
  const r = (await c.query(`SELECT
      (SELECT count(*)::int FROM zones WHERE active) AS active_zones,
      (SELECT count(*)::int FROM fare_rules WHERE active) AS fare_rules,
      (SELECT count(*)::int FROM jurisdictions WHERE active) AS active_jurisdictions,
      (SELECT count(*)::int FROM users WHERE role = 'admin' AND deleted_at IS NULL) AS admins`)).rows[0];
  return { ...r, ok: r.active_zones > 0 && r.fare_rules > 0 && r.active_jurisdictions > 0 && r.admins > 0 };
}
