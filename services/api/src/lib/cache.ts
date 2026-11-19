/**
 * Short-lived in-memory cache for configuration that every quote, booking and poll reads but that only changes when the team
 * edits it in admin: fare rules, zones with their state levy, public holidays and a few settings (Round 18).
 *
 * - TTL `CONFIG_CACHE_TTL_MS` (default 15 s; 0 turns caching off). On serverless each instance has its own copy, so an admin
 *   change reaches every instance within the TTL; the instance that made the change drops its copy at once (see index.ts).
 * - One load at a time per key (concurrent callers share the same promise); a failed load is not cached.
 * - Each caller gets its own copy (structuredClone), so code that adjusts a rule or setting can't change it for the next request.
 */
import { config } from '../config.js';
import { one } from '../db.js';

type Entry = { at: number; p: Promise<unknown> };
const store = new Map<string, Entry>();
let hits = 0, misses = 0;

export async function cached<T>(key: string, load: () => Promise<T>, ttlMs = config.perf.cacheTtlMs): Promise<T> {
  if (ttlMs <= 0) return load();
  const now = Date.now();
  const e = store.get(key);
  if (e && now - e.at < ttlMs) { hits++; return structuredClone(await (e.p as Promise<T>)); }
  misses++;
  const p = load();
  store.set(key, { at: now, p });
  p.catch(() => { if (store.get(key)?.p === p) store.delete(key); });
  return structuredClone(await p);
}

/** Drop cached config (all of it, or keys starting with `prefix`). Called after any change made by the team. */
export function invalidateConfig(prefix?: string) {
  if (!prefix) return store.clear();
  for (const k of store.keys()) if (k.startsWith(prefix)) store.delete(k);
}

export const cacheStats = () => ({ keys: store.size, hits, misses, ttl_ms: config.perf.cacheTtlMs });

/** A row of `settings` (its JSON value, or null when not set), through the cache. Only for settings read on hot paths. */
export async function settingValue<T = any>(key: string): Promise<T | null> {
  return cached(`setting:${key}`, async () => (await one(`SELECT value FROM settings WHERE key = $1`, [key]))?.value ?? null);
}
