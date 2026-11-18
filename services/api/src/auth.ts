import jwt from 'jsonwebtoken';
import type { FastifyRequest } from 'fastify';
import { config } from './config.js';
import { one } from './db.js';
import { forbidden, unauthorised } from './lib/errors.js';

export type Role = 'rider' | 'driver' | 'admin' | 'dispatcher' | 'partner' | 'corporate_admin';
export interface AuthUser { id: string; role: Role; name: string; phone: string; partner_id: string | null }

export const signToken = (u: { id: string; role: Role }) =>
  jwt.sign({ sub: u.id, role: u.role }, config.jwtSecret, { expiresIn: '30d' });

export function verifyToken(token: string): { sub: string; role: Role } | null {
  // Pin the algorithm: tokens are only ever HS256 (no "none", no key confusion).
  try { return jwt.verify(token, config.jwtSecret, { algorithms: ['HS256'] }) as any; } catch { return null; }
}

/** The current account behind a token, or undefined if it was deleted or blocked. Role comes from the database, not the token. */
export async function activeUser(id: string): Promise<AuthUser | undefined> {
  const u = await one<AuthUser & { blocked: boolean }>(
    'SELECT id, role, name, phone, partner_id, blocked FROM users WHERE id = $1 AND deleted_at IS NULL', [id])
    .catch((e) => { if (e?.code === '22P02') return null; throw e; }); // not a uuid → no such user; real DB errors still surface
  if (!u || u.blocked) return undefined;
  const { blocked, ...rest } = u;
  return rest;
}

declare module 'fastify' {
  interface FastifyRequest { user?: AuthUser }
}

export async function loadUser(req: FastifyRequest): Promise<AuthUser | undefined> {
  if (req.user) return req.user;
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return undefined;
  const p = verifyToken(h.slice(7));
  if (!p) return undefined;
  const u = await activeUser(p.sub);
  if (!u) return undefined;
  req.user = u;
  return u;
}

/** Usage: const me = await requireUser(req, 'admin', 'dispatcher') */
export async function requireUser(req: FastifyRequest, ...roles: Role[]): Promise<AuthUser> {
  const u = await loadUser(req);
  if (!u) throw unauthorised();
  if (roles.length && !roles.includes(u.role)) throw forbidden();
  return u;
}
