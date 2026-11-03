/**
 * Realtime bus over WebSockets.
 * Channels: `user:<id>` (personal), `trip:<id>` (anyone allowed to watch a trip), `ops` (admins/dispatch).
 * Single-process in-memory fan-out. For multiple API instances, swap `publish` for Postgres LISTEN/NOTIFY or Redis.
 */
import type { WebSocket } from 'ws';

const channels = new Map<string, Set<WebSocket>>();

export function subscribe(ws: WebSocket, channel: string) {
  let s = channels.get(channel);
  if (!s) channels.set(channel, (s = new Set()));
  s.add(ws);
  ws.once('close', () => { s!.delete(ws); if (!s!.size) channels.delete(channel); });
}

export function unsubscribe(ws: WebSocket, channel: string) {
  channels.get(channel)?.delete(ws);
}

export function publish(channel: string, type: string, data: unknown) {
  const s = channels.get(channel);
  if (!s) return;
  const msg = JSON.stringify({ channel, type, data, at: new Date().toISOString() });
  for (const ws of s) if (ws.readyState === 1) ws.send(msg);
}

export const toUser = (id: string, type: string, data: unknown) => publish(`user:${id}`, type, data);
export const toTrip = (id: string, type: string, data: unknown) => publish(`trip:${id}`, type, data);
export const toOps = (type: string, data: unknown) => publish('ops', type, data);
export const stats = () => ({ channels: channels.size, sockets: [...channels.values()].reduce((n, s) => n + s.size, 0) });
