/** Uploads (proof-of-delivery photos, driver documents, ad images) stored in Postgres so the API can run
 *  serverless. Names are unguessable. For larger volumes, swap for Supabase Storage / S3 presigned URLs. */
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';
import { requireUser } from '../auth.js';
import { one, q } from '../db.js';
import { bad, notFound } from '../lib/errors.js';
import { parse, z } from '../lib/validate.js';

export default async function uploadRoutes(app: FastifyInstance) {
  app.post('/uploads', { bodyLimit: 6 * 1024 * 1024 }, async (req) => {
    const me = await requireUser(req);
    const b = parse(z.object({ data_url: z.string().max(5_800_000), purpose: z.enum(['pod', 'document', 'avatar', 'ad']) }), req.body);
    const m = /^data:(image\/(png|jpeg|webp)|application\/pdf);base64,(.+)$/.exec(b.data_url);
    if (!m) throw bad('bad_file', 'Upload a PNG, JPEG, WebP or PDF');
    const ext = m[1] === 'application/pdf' ? 'pdf' : m[2] === 'jpeg' ? 'jpg' : m[2];
    const name = `${b.purpose}-${me.id.slice(0, 8)}-${crypto.randomBytes(12).toString('hex')}.${ext}`;
    await q('INSERT INTO uploads (name, mime, data, owner_id, purpose) VALUES ($1,$2,$3,$4,$5)', [name, m[1], Buffer.from(m[3], 'base64'), me.id, b.purpose]);
    return { url: `/uploads/${name}` };
  });

  app.get('/uploads/:name', async (req, reply) => {
    const f = await one('SELECT mime, data FROM uploads WHERE name = $1', [(req.params as any).name]);
    if (!f) throw notFound('File');
    reply.header('Content-Type', f.mime).header('Cache-Control', 'private, max-age=86400');
    return reply.send(f.data);
  });
}
