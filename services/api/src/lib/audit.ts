import { pool, type Q } from '../db.js';

/** Record a staff action in `audit_log` (who did what to which record). */
export async function audit(actorId: string | null, action: string, entity: string, entityId: string, data?: unknown, c: Q = pool) {
  await c.query('INSERT INTO audit_log (actor_id, action, entity, entity_id, data) VALUES ($1,$2,$3,$4,$5)',
    [actorId, action, entity, entityId, data == null ? null : JSON.stringify(data)]);
}
