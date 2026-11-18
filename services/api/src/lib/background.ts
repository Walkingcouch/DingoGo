/**
 * Work started after a state change that the response doesn't wait for (notifications, SMS, push).
 * On a long-running server it just runs. On serverless (Vercel) the function can be frozen as soon as the
 * response is sent, which silently drops that work — so the API waits for it (bounded) before responding.
 */
import { logError } from './log.js';
const pending = new Set<Promise<unknown>>();

/** Track a fire-and-forget promise. Errors are logged, never thrown. */
export function bg<T>(p: Promise<T>): Promise<T | undefined> {
  const w: Promise<T | undefined> = p.catch((e) => { logError('background', e); return undefined; })
    .finally(() => { pending.delete(w); });
  pending.add(w);
  return w;
}

export const pendingBackground = () => pending.size;

/** Wait until tracked work has finished (including work it starts), or `maxMs` has passed. */
export async function flushBackground(maxMs = 3000) {
  const deadline = Date.now() + maxMs;
  // Work scheduled with setImmediate after a commit registers on the next turn: give it one.
  await new Promise((r) => setImmediate(r));
  while (pending.size && Date.now() < deadline) {
    let timer: NodeJS.Timeout | undefined;
    await Promise.race([
      Promise.allSettled([...pending]),
      new Promise((r) => { timer = setTimeout(r, Math.max(0, deadline - Date.now())); }),
    ]);
    clearTimeout(timer);
    await new Promise((r) => setImmediate(r));
  }
}
