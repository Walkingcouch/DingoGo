/** Child process for test/ops.test.ts: the Vercel entry with a database that can't be reached. Prints what the API answered. */
import http from 'node:http';
import type { AddressInfo } from 'node:net';

const { default: handler } = await import('../../src/vercel.js');
const server = http.createServer((req, res) => void handler(req, res));
await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
const grab = async (p: string) => {
  const r = await fetch(base + p);
  return { status: r.status, retry_after: r.headers.get('retry-after'), request_id: r.headers.get('x-request-id'), body: await r.json() };
};
const out = { trips: await grab('/api/trips?status=active'), deep: await grab('/api/health/deep') };
console.log('RESULT ' + JSON.stringify(out));
server.close();
process.exit(0);
