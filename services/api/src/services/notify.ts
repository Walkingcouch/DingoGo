/** Notifications: in-app inbox + realtime + push (Expo) + SMS (Twilio). Providers are no-ops until configured. */
import { config } from '../config.js';
import { q } from '../db.js';
import { toUser } from '../realtime.js';
import { bg } from '../lib/background.js';

/** Send a text. Tracked as background work, so callers may fire and forget (it still completes on serverless). */
export function sendSms(to: string, body: string): Promise<{ sent: boolean; provider: string }> {
  return bg(sendSmsNow(to, body)).then((r) => r ?? { sent: false, provider: 'error' });
}

async function sendSmsNow(to: string, body: string): Promise<{ sent: boolean; provider: string }> {
  const { sid, token, from } = config.twilio;
  if (!sid || !token || !from) {
    if (process.env.LOG_SMS !== 'false') console.log(`[sms:dev] → ${to}: ${body}`);
    return { sent: false, provider: 'dev-log' };
  }
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: {
      Authorization: 'Basic ' + Buffer.from(`${sid}:${token}`).toString('base64'),
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({ To: to, From: from, Body: body }),
  });
  return { sent: res.ok, provider: 'twilio' };
}

async function sendPush(userId: string, title: string, body: string, data?: unknown) {
  if (!config.expoPushEnabled) return;
  const tokens = await q<{ token: string }>('SELECT token FROM push_tokens WHERE user_id = $1', [userId]);
  if (!tokens.length) return;
  await fetch('https://exp.host/--/api/v2/push/send', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(tokens.map((t) => ({ to: t.token, title, body, data, sound: 'default' }))),
  }).catch(() => undefined);
}

/** In-app inbox + realtime + push. Tracked as background work, so `void notify(...)` still completes on serverless. */
export function notify(userId: string, title: string, body: string, data?: Record<string, unknown>, category = 'trip') {
  return bg(notifyNow(userId, title, body, data, category));
}

async function notifyNow(userId: string, title: string, body: string, data: Record<string, unknown> | undefined, category: string) {
  const [row] = await q(
    'INSERT INTO notifications (user_id, title, body, data, category) VALUES ($1,$2,$3,$4,$5) RETURNING *',
    [userId, title, body, data ?? null, category]);
  toUser(userId, 'notification', row);
  await sendPush(userId, title, body, data);
  return row;
}
