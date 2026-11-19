/**
 * Round 29: launch readiness. One list of what still stands between this deploy and real riders: unsafe server settings,
 * missing accounts and keys, and placeholder business settings to confirm. Names and yes/no only, never a key or secret.
 * Shown in /health/deep (details) and admin → Reports → System health; docs/GO-LIVE-CHECKLIST.md is the full list with who to ask.
 */
import { config, PLACEHOLDER_SECRETS } from '../config.js';
import { q } from '../db.js';
import { integrationStatus } from '../routes/health.js';
import { abnValid } from './tax.js';
import { readRegionalPolicy } from './regional.js';

export type ReadinessGroup = 'must' | 'keys' | 'confirm';
export interface ReadinessItem { id: string; group: ReadinessGroup; ok: boolean; title: string; where: string }

const SETTING_KEYS = ['business', 'roof_display', 'regional_policy', 'driver_pay', 'business_billing', 'ndis'];

/** Pure part: everything that only needs the server's config and a few settings rows (tested without a database). */
export function readinessItems(env: {
  jwtSecret: string; otpDevMode: boolean; demoPrefixes: number; mockCards: string; publicWebUrl: string; corsOrigins: string[];
  healthToken: boolean; autoMigrate: boolean; demoAccounts: number; integrations: Record<string, string>;
}, settings: Record<string, any>): ReadinessItem[] {
  const i = env.integrations;
  const has = (k: string) => i[k] === 'configured';
  const biz = settings.business ?? {};
  const roof = settings.roof_display ?? {};
  const regional = readRegionalPolicy(settings.regional_policy);
  const openUnchecked = regional.corridors.filter((c) => c.active && !c.confirmed).map((c) => c.name);
  const fee = settings.driver_pay?.service_fee ?? {};
  const billing = settings.business_billing ?? {};
  const local = /localhost|127\.0\.0\.1/.test(env.publicWebUrl);
  const items: ReadinessItem[] = [
    // Must do before real riders
    { id: 'jwt_secret', group: 'must', ok: env.jwtSecret.length >= 32 && !PLACEHOLDER_SECRETS.includes(env.jwtSecret), title: 'JWT_SECRET is a long random string (32+ characters)', where: 'Vercel → Environment Variables' },
    { id: 'otp_dev_mode', group: 'must', ok: !env.otpDevMode, title: 'OTP_DEV_MODE is off (no on-screen codes, 000000 refused)', where: 'Vercel → Environment Variables' },
    { id: 'demo_sign_in', group: 'must', ok: env.demoPrefixes === 0, title: 'Demo sign-in (OTP_DEMO_PREFIXES) is off', where: 'Vercel → Environment Variables' },
    { id: 'demo_data', group: 'must', ok: env.demoAccounts === 0, title: 'No demo accounts in the database (fictional drivers, cafés, 0400 000 0xx)', where: 'Bootstrap without DEMO_DATA' },
    { id: 'mock_cards', group: 'must', ok: env.mockCards !== 'all', title: 'Mock card payments are not open to everyone (MOCK_CARDS is not "all")', where: 'Vercel → Environment Variables' },
    { id: 'public_web_url', group: 'must', ok: !local && env.publicWebUrl.startsWith('https://'), title: 'PUBLIC_WEB_URL is the website’s https address (links in texts)', where: 'Vercel → Environment Variables' },
    { id: 'cors', group: 'must', ok: !env.corsOrigins.includes('*'), title: 'CORS_ORIGINS lists DingoGo’s own sites and the app shells', where: 'Vercel → Environment Variables' },
    { id: 'health_token', group: 'must', ok: env.healthToken, title: 'HEALTH_TOKEN is set for the uptime monitor', where: 'Vercel → Environment Variables' },
    { id: 'sms', group: 'must', ok: has('sms'), title: 'Text messages (Twilio): riders and drivers can’t sign in without them', where: 'Vercel → TWILIO_* variables' },
    { id: 'business_abn', group: 'must', ok: abnValid(biz.abn), title: 'DingoGo’s ABN is entered (tax invoices say “draft” until it is)', where: 'Admin → Settings → Business details' },
    { id: 'legal_name', group: 'must', ok: !!biz.legal_name && !/TBC/i.test(String(biz.legal_name)), title: 'Legal name is entered', where: 'Admin → Settings → Business details' },
    { id: 'roof_display', group: 'must', ok: (roof.mode ?? 'off') === 'off', title: 'Roof screens are off until NT approval is in writing', where: 'Admin → Settings → Roof screens' },
    // Accounts and keys
    { id: 'payments', group: 'keys', ok: has('payments') && has('payments_webhook') && has('card_elements'), title: 'Stripe: secret key, publishable key and webhook secret', where: 'Vercel → STRIPE_* variables; Stripe dashboard → Webhooks' },
    { id: 'routing', group: 'keys', ok: has('routing'), title: 'Road routing (OSRM_URL or ORS_API_KEY): without it distances are estimated', where: 'Vercel → OSRM_URL / ORS_API_KEY' },
    { id: 'sms_replies', group: 'keys', ok: has('sms_replies'), title: 'A Twilio number that takes replies (STOP, booking by text)', where: 'Vercel → TWILIO_FROM (+61 number) or a Messaging Service' },
    { id: 'push', group: 'keys', ok: has('push_fcm') || has('push_web'), title: 'Push notifications (Firebase and/or web push keys)', where: 'Vercel → FCM_SERVICE_ACCOUNT, WEB_PUSH_VAPID_*' },
    { id: 'error_reporting', group: 'keys', ok: has('error_reporting'), title: 'Error reporting (Sentry)', where: 'Vercel → SENTRY_DSN' },
    { id: 'auto_migrate', group: 'keys', ok: env.autoMigrate, title: 'AUTO_MIGRATE is on, so new migrations apply at the next deploy', where: 'Vercel → AUTO_MIGRATE=true' },
    // Settings to confirm (placeholders)
    { id: 'community_routes', group: 'confirm', ok: openUnchecked.length === 0, title: openUnchecked.length ? `Community routes open but not checked with the community: ${openUnchecked.join(', ')}` : 'Community routes are closed or checked', where: 'Admin → Community trips → Routes' },
    { id: 'driver_pay', group: 'confirm', ok: !(fee.own_car_pct === undefined && fee.green_pct === undefined), title: 'Driver service fees saved by the owners (still the 25% defaults until saved)', where: 'Admin → Pricing → Driver pay' },
    { id: 'billing_pay_to', group: 'confirm', ok: !!String(billing.pay_to ?? '').trim(), title: 'How business customers pay (bank details on invoices)', where: 'Admin → Business accounts → Billing settings' },
  ];
  return items;
}

export async function launchReadiness() {
  const rows = await q<{ key: string; value: any }>(`SELECT key, value FROM settings WHERE key = ANY($1)`, [SETTING_KEYS]).catch(() => []);
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const demo = await q<{ n: number }>(`SELECT count(*)::int n FROM users WHERE phone = ANY($1) AND deleted_at IS NULL`, [config.otpDemoNumbers]).catch(() => [{ n: 0 }]);
  const items = readinessItems({
    jwtSecret: config.jwtSecret, otpDevMode: config.otpDevMode, demoPrefixes: config.otpDemoPrefixes.length, mockCards: config.mockCards,
    publicWebUrl: config.publicWebUrl, corsOrigins: config.corsOrigins, healthToken: !!config.ops.healthToken, autoMigrate: config.ops.autoMigrate,
    demoAccounts: demo[0]?.n ?? 0, integrations: integrationStatus(),
  }, settings);
  const todo = (g: ReadinessGroup) => items.filter((x) => x.group === g && !x.ok).length;
  return { ready: todo('must') === 0, production: config.production, to_do: { must: todo('must'), keys: todo('keys'), confirm: todo('confirm') }, items };
}
