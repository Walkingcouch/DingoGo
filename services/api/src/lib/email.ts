/**
 * Round 27: email through Resend's HTTP API (one POST, no SDK). Behind config: without RESEND_API_KEY and EMAIL_FROM the message is
 * written to the log (subject and recipient count only, no body) and reported as not sent, so nothing breaks before it is set up.
 */
import { config } from '../config.js';
import { log } from './log.js';

export interface EmailAttachment { filename: string; content: Buffer }
export interface EmailMessage { to: string[]; subject: string; html: string; text: string; attachments?: EmailAttachment[]; key?: string }
export interface EmailResult { sent: boolean; provider: 'resend' | 'log'; id?: string; error?: string }

export const emailConfigured = () => !!(config.email.resendApiKey && config.email.from);

export async function sendEmail(m: EmailMessage): Promise<EmailResult> {
  if (!m.to.length) return { sent: false, provider: 'log', error: 'no_recipients' };
  if (!emailConfigured()) {
    log.info({ email: { subject: m.subject, recipients: m.to.length } }, 'email not configured: not sent');
    return { sent: false, provider: 'log', error: 'email_not_configured' };
  }
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), config.email.timeoutMs);
  try {
    const res = await fetch(`${config.email.apiBase.replace(/\/$/, '')}/emails`, {
      method: 'POST', signal: ctl.signal,
      headers: {
        authorization: `Bearer ${config.email.resendApiKey}`, 'content-type': 'application/json',
        ...(m.key ? { 'idempotency-key': m.key.slice(0, 256) } : {}),
      },
      body: JSON.stringify({
        from: config.email.from, to: m.to, subject: m.subject, html: m.html, text: m.text,
        attachments: m.attachments?.map((a) => ({ filename: a.filename, content: a.content.toString('base64') })),
      }),
    });
    const body: any = await res.json().catch(() => ({}));
    if (!res.ok) return { sent: false, provider: 'resend', error: String(body?.message ?? body?.name ?? `HTTP ${res.status}`).slice(0, 200) };
    return { sent: true, provider: 'resend', id: body?.id };
  } catch (e: any) {
    return { sent: false, provider: 'resend', error: e?.name === 'AbortError' ? 'timeout' : String(e?.message ?? e).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const escapeHtml = (s: string) => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
