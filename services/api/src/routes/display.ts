/**
 * Roof LED display API. Each screen authenticates with its vehicle's display_key.
 * Compliance: NT rules prohibit rideshare vehicles carrying signage that suggests they are "available for hire".
 * The playlist therefore never includes availability messaging, and ops can switch all screens off via the
 * `roof_display` setting until written approval from the NT Passenger Transport Division is held.
 */
import type { FastifyInstance } from 'fastify';
import { one, q } from '../db.js';
import { forbidden } from '../lib/errors.js';
import { haversine } from '../lib/geo.js';
import { localHour } from '../lib/fares.js';
import { parse, z } from '../lib/validate.js';

export default async function displayRoutes(app: FastifyInstance) {
  const vehicleFor = async (req: any) => {
    const key = req.headers['x-display-key'] ?? req.query?.key;
    if (!key) throw forbidden('Display key required');
    const v = await one('SELECT id, rego FROM vehicles WHERE display_key = $1 AND active', [key]);
    if (!v) throw forbidden('Unknown display');
    return v;
  };

  app.get('/display/playlist', async (req) => {
    const v = await vehicleFor(req);
    const setting = (await one(`SELECT value FROM settings WHERE key = 'roof_display'`))?.value ?? { mode: 'ads' };
    if (setting.mode === 'off') return { vehicle: v.rego, mode: 'off', items: [] };
    const { lat, lng } = req.query as { lat?: string; lng?: string };
    const pos = lat && lng ? { lat: Number(lat), lng: Number(lng) } : null;
    // Use the vehicle's live position if the screen doesn't have GPS
    const d = pos ?? await one('SELECT d.lat, d.lng FROM drivers d WHERE d.vehicle_id = $1 AND d.lat IS NOT NULL', [v.id]);
    const hour = localHour(new Date());
    const camps = await q(
      `SELECT c.id, c.headline, c.subline, c.bg_colour, c.fg_colour, c.image_url, c.weight, c.geo_lat, c.geo_lng, c.geo_radius_m, c.budget_cents, c.cpm_cents,
              (SELECT count(*) FROM ad_plays p WHERE p.campaign_id = c.id)::int plays, a.name AS advertiser
       FROM ad_campaigns c JOIN advertisers a ON a.id = c.advertiser_id
       WHERE c.status = 'approved' AND current_date BETWEEN c.starts_on AND c.ends_on AND $1 >= c.hour_from AND $1 < c.hour_to`, [hour]);
    const items = camps
      .filter((c) => !c.geo_radius_m || !d?.lat || haversine({ lat: d.lat, lng: d.lng }, { lat: c.geo_lat, lng: c.geo_lng }) <= c.geo_radius_m)
      .filter((c) => !c.budget_cents || !c.cpm_cents || (c.plays * c.cpm_cents) / 1000 < c.budget_cents)
      .map(({ plays, budget_cents, cpm_cents, geo_lat, geo_lng, geo_radius_m, ...c }) => ({ ...c, seconds: 10 }));
    // House content fills gaps — brand + community messages (never "available for hire" style messaging)
    items.push({ id: 'house-1', headline: 'DingoGo', subline: 'Aboriginal-owned and 100% electric', bg_colour: '#1E1B18', fg_colour: '#F2A541', weight: 1, seconds: 8, advertiser: 'DingoGo' } as any);
    return { vehicle: v.rego, mode: 'ads', refresh_s: 120, items };
  });

  app.post('/display/plays', async (req) => {
    const v = await vehicleFor(req);
    const b = parse(z.object({ plays: z.array(z.object({ campaign_id: z.string(), at: z.string().datetime().optional(), lat: z.number().optional(), lng: z.number().optional(), seconds: z.number().int().min(1).max(120).default(10) })).max(500) }), req.body);
    let n = 0;
    for (const p of b.plays) {
      if (p.campaign_id.startsWith('house')) continue;
      await q('INSERT INTO ad_plays (campaign_id, vehicle_id, at, lat, lng, seconds) VALUES ($1,$2,coalesce($3::timestamptz, now()),$4,$5,$6)',
        [p.campaign_id, v.id, p.at ?? null, p.lat ?? null, p.lng ?? null, p.seconds]);
      n++;
    }
    return { recorded: n };
  });
}
