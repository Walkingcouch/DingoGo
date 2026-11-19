/**
 * Round 27: owner insights (admin only — money and the whole business's numbers). See services/insights.ts.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { requireUser } from '../auth.js';
import { pool } from '../db.js';
import { audit } from '../lib/audit.js';
import { invalidateConfig } from '../lib/cache.js';
import { toCsv, dollars } from '../lib/csv.js';
import { bad } from '../lib/errors.js';
import { checkPolicy, INSIGHTS_DEFAULTS } from '../lib/insights.js';
import { emailConfigured } from '../lib/email.js';
import { isoDay, parse, z } from '../lib/validate.js';
import {
  cohorts, demandForecast, healthReport, loadPolicy, sendWeekly, simulatePricing, supplyDemand, tripEconomics, weekOf, weeklyEmail, weeklyPdf, weeklySummary,
} from '../services/insights.js';

const admin = (req: FastifyRequest) => requireUser(req, 'admin');
const cents = z.number().int().min(0).max(100000);

export default async function insightsRoutes(app: FastifyInstance) {
  app.get('/admin/insights/health', async (req, reply) => {
    const me = await admin(req);
    const p = req.query as Record<string, string | undefined>;
    const h = await healthReport(p);
    if (p.format !== 'csv') return h;
    await audit(me.id, 'export', 'report', 'insights-daily.csv', { from: h.from, to: h.to });
    reply.header('content-type', 'text/csv; charset=utf-8');
    reply.header('content-disposition', `attachment; filename="dingogo-insights-${h.from}-to-${h.to}.csv"`);
    return toCsv<any>([
      ['Day', (r) => r.day], ['Requests', (r) => r.requests], ['Unfilled', (r) => r.unfilled], ['Completed', (r) => r.completed], ['Rides', (r) => r.rides],
      ['Courier', (r) => r.courier], ['Tours and hire', (r) => r.tours], ['Riders paid ($)', (r) => dollars(r.gross_cents)], ['DingoGo kept ($)', (r) => dollars(r.kept_cents)],
    ], h.daily);
  });

  app.get('/admin/insights/supply-demand', async (req) => { await admin(req); return supplyDemand(req.query as any); });
  app.get('/admin/insights/cohorts', async (req) => { await admin(req); return cohorts(req.query as any); });
  app.get('/admin/insights/forecast', async (req) => { await admin(req); return demandForecast(req.query as any); });
  app.get('/admin/trips/:id/economics', async (req) => { await admin(req); return tripEconomics((req.params as any).id); });

  app.post('/admin/insights/simulate', async (req) => {
    await admin(req);
    const b = parse(z.object({
      service: z.string().max(40).default('ride'),
      days: z.number().int().min(7).max(180).default(28),
      elasticity: z.number().min(-2).max(0).default(0),
      fee_pct: z.number().min(0).max(50).nullable().optional(),
      proposed: z.object({
        base_cents: cents.optional(), per_km_cents: cents.optional(), per_min_cents: cents.optional(), booking_fee_cents: cents.optional(),
        min_fare_cents: cents.optional(), night_pct: z.number().int().min(0).max(100).optional(),
      }).strict().default({}),
      include_test: z.boolean().optional(),
    }), req.body ?? {});
    return simulatePricing(b);
  });

  /** A finished week's owner summary: JSON (default), a PDF or the email's HTML. `week` is any day of it (default last week). */
  app.get('/admin/insights/weekly', async (req, reply) => {
    const me = await admin(req);
    const p = req.query as Record<string, string | undefined>;
    const s = await weeklySummary(weekOf(p));
    if (p.format === 'pdf') {
      await audit(me.id, 'export', 'report', 'owner-weekly.pdf', { week: s.week });
      reply.header('content-type', 'application/pdf');
      reply.header('content-disposition', `attachment; filename="dingogo-week-${s.week}.pdf"`);
      return reply.send(weeklyPdf(s));
    }
    if (p.format === 'html') {
      reply.header('content-type', 'text/html; charset=utf-8');
      reply.header('content-security-policy', "default-src 'none'; style-src 'unsafe-inline'; img-src data:");
      return reply.send(weeklyEmail(s).html);
    }
    return { ...s, email: { configured: emailConfigured(), subject: weeklyEmail(s).subject } };
  });

  app.post('/admin/insights/weekly/send', async (req) => {
    const me = await admin(req);
    const b = parse(z.object({ week: isoDay().optional(), to: z.array(z.string().trim().email().max(120)).max(10).optional() }), req.body ?? {});
    return sendWeekly(weekOf(b), { actorId: me.id, to: b.to });
  });

  app.get('/admin/insights/policy', async (req) => {
    await admin(req);
    return { policy: await loadPolicy(), defaults: INSIGHTS_DEFAULTS, email_configured: emailConfigured() };
  });

  app.put('/admin/insights/policy', async (req) => {
    const me = await admin(req);
    if (!req.body || typeof req.body !== 'object') throw bad('invalid_insights_policy', 'Send the policy');
    // Saved even when email isn't set up yet (the owner may be setting up Resend); the answer says whether it can send.
    const policy = checkPolicy(req.body);
    await pool.query(`INSERT INTO settings (key, value) VALUES ('insights_policy', $1) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [JSON.stringify(policy)]);
    invalidateConfig('setting:insights_policy');
    await audit(me.id, 'update', 'setting', 'insights_policy', { weekly_email: policy.weekly_email.enabled, recipients: policy.weekly_email.recipients.length });
    return { policy, email_configured: emailConfigured() };
  });
}
