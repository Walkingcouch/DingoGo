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
  try { return jwt.verify(token, config.jwtSecret) as any; } catch { return null; }
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
  const u = await one<AuthUser & { blocked: boolean }>(
    'SELECT id, role, name, phone, partner_id, blocked FROM users WHERE id = $1 AND deleted_at IS NULL', [p.sub]);
  if (!u || u.blocked) return undefined;
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
