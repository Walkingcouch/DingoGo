/**
 * Live-DB lag: the Round 11 courier columns (migration 016) may not be on the production database yet. Code asks this before
 * using them and keeps the old behaviour until they exist. Once seen, the answer is kept; a "not yet" is checked again after
 * a minute (AUTO_MIGRATE may apply the migration while this instance is running).
 */
import { one } from '../db.js';

let ready = false;
let checkedAt = 0;

export async function courierReady(): Promise<boolean> {
  if (ready) return true;
  if (Date.now() - checkedAt < 60_000 && checkedAt) return false;
  checkedAt = Date.now();
  try {
    const r = await one<{ n: number }>(
      `SELECT count(*)::int n FROM information_schema.columns
       WHERE table_schema = current_schema() AND ((table_name = 'trips' AND column_name IN ('batch_id', 'batch_seq', 'pickup_window_end'))
          OR (table_name = 'parcels' AND column_name IN ('outcome', 'safe_place', 'pod_distance_m')))`);
    ready = r!.n === 6;
  } catch { ready = false; }
  return ready;
}

/** Tests: forget the answer (after renaming the columns away and back). */
export function resetCourierReady() { ready = false; checkedAt = 0; }

export const courierPending = () => 'Multi-drop runs, pickup windows and returns need database migration 016';
