/**
 * Round 21: what the app stores need from the API.
 *  - GET  /.well-known/assetlinks.json   Android App Links: lets the rider app open the website's share-trip and booking links.
 *  - POST /me/disclosures                what a person was shown before the phone asked for location, notifications or the camera,
 *    GET  /me/disclosures                and what they chose (Google Play's prominent disclosure). Migration 025; before it the
 *                                        answer stays on the phone ({ recorded: false }).
 *  - POST /public/deletion-requests      the account deletion page's "I can't sign in" form (Google Play requires a web link to ask
 *                                        for deletion without the app): goes to the privacy request register (30-day due date).
 */
import type { FastifyInstance } from 'fastify';
import { one, q } from '../db.js';
import { requireUser } from '../auth.js';
import { ApiError } from '../lib/errors.js';
import { config } from '../config.js';
import { limit } from '../lib/rateLimit.js';
import { parse, phone, z } from '../lib/validate.js';
import { log } from '../lib/log.js';
import { DISCLOSURE_APPS, DISCLOSURE_KINDS, DISCLOSURE_PLATFORMS, assetLinks, parseCertList } from '../lib/store.js';
import { recordPrivacyRequest } from '../services/tax.js';

const missing = (e: any) => e?.code === '42P01' || e?.code === '42703';
let warned = '';

export default async function storeRoutes(app: FastifyInstance) {
  app.get('/.well-known/assetlinks.json', async (_req, reply) => {
    const { certs, rejected } = parseCertList(config.android.appLinkCerts);
    if (rejected.length && warned !== config.android.appLinkCerts) {
      warned = config.android.appLinkCerts;
      log.warn({ rejected: rejected.length }, 'ANDROID_APP_LINK_CERTS: ignored entries that are not SHA-256 fingerprints, or are the public test key');
    }
    reply.header('Cache-Control', 'public, max-age=3600');
    reply.type('application/json');
    return assetLinks(config.android.riderPackage, certs);
  });

  app.post('/me/disclosures', async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({
      app: z.enum(DISCLOSURE_APPS), kind: z.enum(DISCLOSURE_KINDS), version: z.string().trim().min(1).max(40), accepted: z.boolean(),
      platform: z.enum(DISCLOSURE_PLATFORMS).default('web'), app_version: z.string().trim().max(40).optional(),
    }), req.body);
    await limit('disclosure_user', me.id, 60, 86400, 'Too many answers saved today.');
    try {
      const row = await one(`INSERT INTO permission_disclosures (user_id, app, kind, version, accepted, platform, app_version)
                             VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING kind, version, accepted, platform, created_at`,
      [me.id, b.app, b.kind, b.version, b.accepted, b.platform, b.app_version ?? null]);
      return { ok: true, recorded: true, disclosure: row };
    } catch (e) {
      if (missing(e)) return { ok: true, recorded: false };
      throw e;
    }
  });

  app.get('/me/disclosures', async (req) => {
    const me = await requireUser(req);
    try {
      const items = await q(`SELECT app, kind, version, accepted, platform, app_version, created_at FROM permission_disclosures
                             WHERE user_id = $1 ORDER BY created_at DESC, id DESC LIMIT 200`, [me.id]);
      return { ready: true, items };
    } catch (e) {
      if (missing(e)) return { ready: false, items: [] };
      throw e;
    }
  });

  app.post('/public/deletion-requests', async (req) => {
    const b = parse(z.object({
      name: z.string().trim().min(2).max(80), phone, email: z.string().trim().email().max(120).optional().or(z.literal('').transform(() => undefined)),
      role: z.enum(['rider', 'driver', 'both']).default('rider'), details: z.string().trim().max(1000).optional(),
    }), req.body);
    await limit('public_form_ip', req.ip, config.rateLimits.publicFormPerIp, 3600,
      'Thanks — we’ve had a lot of messages from this connection. Please try again in an hour, or call us.');
    // Linked to the account when the number matches one, but the answer is the same either way (no account lookup by number).
    const local = b.phone.startsWith('0') ? '+61' + b.phone.slice(1) : b.phone.startsWith('61') ? '+' + b.phone : b.phone;
    const user = await one<{ id: string }>('SELECT id FROM users WHERE phone = ANY($1) AND deleted_at IS NULL', [[b.phone, local]]);
    const r = await recordPrivacyRequest({
      user_id: user?.id ?? null, kind: 'deletion', channel: 'website', status: 'open',
      requester: `${b.name}, ${local}${b.email ? `, ${b.email}` : ''} (website form)`,
      details: [`Can't sign in to delete it themselves. Account type: ${b.role}.`, b.details].filter(Boolean).join(' '),
    });
    if (!r) throw new ApiError(503, 'migration_pending', 'We can’t take this request online right now. Please call or email us.');
    return { ok: true, ref: r.ref, due_days: 30 };
  });
}
