/** Uploads (proof-of-delivery photos, driver documents, ad images) stored in Postgres so the API can run
 *  serverless. Names are unguessable. Driver documents and POD photos are private (signed, short-lived links —
 *  see lib/uploads.ts). For larger volumes, swap for Supabase Storage / S3 presigned URLs. */
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { loadUser, requireUser, type Role } from '../auth.js';
import { one, q } from '../db.js';
import { ApiError, bad, forbidden, notFound, unauthorised } from '../lib/errors.js';
import { limit } from '../lib/rateLimit.js';
import { checkSignature, contentMatches, isPrivatePurpose, signedUploadPath } from '../lib/uploads.js';
import { parse, z } from '../lib/validate.js';

/** Who may upload what. Ads are made by DingoGo staff; documents and delivery photos come from drivers. */
const MAY_UPLOAD: Record<string, Role[] | null> = {
  ad: ['admin'],
  document: ['driver', 'admin'],
  pod: ['driver', 'admin'],
  avatar: null, // anyone signed in
};
const isOps = (role: string) => role === 'admin' || role === 'dispatcher';

/** Is this user allowed to see this private file? Owner, DingoGo staff, or the rider/driver of the trip whose delivery photo it is. */
async function mayView(user: { id: string; role: string }, name: string, f: { owner_id: string | null; purpose: string }) {
  if (user.id === f.owner_id || isOps(user.role)) return true;
  if (f.purpose !== 'pod') return false;
  const t = await one(
    `SELECT 1 FROM parcels p JOIN trips t ON t.id = p.trip_id WHERE p.pod_photo_url = $1 AND (t.rider_id = $2 OR t.driver_id = $2)`,
    [`/uploads/${name}`, user.id]);
  return !!t;
}

export default async function uploadRoutes(app: FastifyInstance) {
  app.post('/uploads', { bodyLimit: 6 * 1024 * 1024 }, async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({ data_url: z.string().max(5_800_000), purpose: z.enum(['pod', 'document', 'avatar', 'ad']) }), req.body);
    const roles = MAY_UPLOAD[b.purpose];
    if (roles && !roles.includes(me.role)) throw forbidden('You can’t upload that kind of file');
    const m = /^data:(image\/(png|jpeg|webp)|application\/pdf);base64,(.+)$/.exec(b.data_url);
    if (!m) throw bad('bad_file', 'Upload a PNG, JPEG, WebP or PDF');
    const data = Buffer.from(m[3], 'base64');
    if (!data.length || !contentMatches(m[1], data)) throw bad('bad_file', 'That file doesn’t look like a PNG, JPEG, WebP or PDF. Try another photo or file.');
    // Uploads live in the database: stop one account filling it.
    await limit('upload_user', me.id, config.rateLimits.uploadsPerUser, 3600, 'Too many uploads in the last hour. Try again later.');
    const ext = m[1] === 'application/pdf' ? 'pdf' : m[2] === 'jpeg' ? 'jpg' : m[2];
    const name = `${b.purpose}-${me.id.slice(0, 8)}-${crypto.randomBytes(12).toString('hex')}.${ext}`;
    await q('INSERT INTO uploads (name, mime, data, owner_id, purpose) VALUES ($1,$2,$3,$4,$5)', [name, m[1], data, me.id, b.purpose]);
    // `url` is the reference to save on a document / delivery; `view_url` works in an <img> or link (signed if private).
    const url = `/uploads/${name}`;
    return { url, view_url: isPrivatePurpose(b.purpose) ? signedUploadPath(name) : url };
  });

  /** A fresh signed link for a private file (for pages left open longer than the link lasts). */
  app.get('/uploads/:name/link', async (req) => {
    const me = await requireUser(req);
    const name = (req.params as any).name;
    const f = await one('SELECT owner_id, purpose FROM uploads WHERE name = $1', [name]);
    if (!f || !(await mayView(me, name, f))) throw notFound('File');
    return { url: isPrivatePurpose(f.purpose) ? signedUploadPath(name) : `/uploads/${name}` };
  });

  app.get('/uploads/:name', async (req, reply) => {
    const name = (req.params as any).name;
    const f = await one('SELECT mime, data, owner_id, purpose FROM uploads WHERE name = $1', [name]);
    if (!f) throw notFound('File');
    let cache = 'public, max-age=86400';
    if (isPrivatePurpose(f.purpose)) {
      const { exp, sig } = req.query as { exp?: string; sig?: string };
      if (exp || sig) {
        const r = checkSignature(name, exp, sig);
        if (r === 'expired') throw new ApiError(403, 'link_expired', 'This link has expired. Go back and reload the page to get a new one.');
        if (r === 'bad') throw forbidden('This link isn’t valid');
        cache = `private, max-age=${Math.max(0, Math.min(3600, Number(exp) - Math.floor(Date.now() / 1000)))}`;
      } else {
        const me = await loadUser(req);
        if (!me) throw unauthorised('This file needs a signed link');
        if (!(await mayView(me, name, f))) throw notFound('File');
        cache = 'private, no-store';
      }
    }
    reply.header('Content-Type', f.mime).header('Cache-Control', cache)
      .header('X-Content-Type-Options', 'nosniff')      // never reinterpret an upload as HTML/script
      .header('Referrer-Policy', 'no-referrer');
    if (f.mime.startsWith('image/')) reply.header('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    else reply.header('Content-Disposition', `inline; filename="${name}"`);
    return reply.send(f.data);
  });
}
