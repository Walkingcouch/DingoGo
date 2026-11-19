import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { ApiError, date, get, money, post } from '@dingogo/shared';
import { PageHead } from '../Layout';
import { contact, useConfig } from '../config';
import { useMeta } from '../meta';

/** /hire/<token> — Round 19: the private link a hire customer gets: the quote, the terms, and "Accept". */
export default function HireQuote() {
  const { token = '' } = useParams();
  useMeta('Your hire quote', 'Your DingoGo hire quote.', { noindex: true });
  const c = contact(useConfig());
  const [q, setQ] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    get(`/public/hire/${encodeURIComponent(token)}`).then((r) => { setQ(r.quote); setName(r.quote.contact_name ?? ''); })
      .catch((e) => setError(e instanceof ApiError && e.status === 404 ? "We couldn't find that quote. Check the link, or call us." : 'Could not load your quote. Check your connection and try again.'));
  }, [token]);
  async function accept(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setError(null);
    try { setQ((await post(`/public/hire/${encodeURIComponent(token)}/accept`, { name, agree: true })).quote); }
    catch (ex) { setError(ex instanceof ApiError ? ex.message : 'Could not accept. Try again or call us.'); }
    finally { setBusy(false); }
  }
  return (
    <>
      <PageHead title={q ? `Hire quote for ${q.organisation ?? q.contact_name}` : 'Your hire quote'}>{q?.start_date ? `Starting ${date(q.start_date)}.` : undefined}</PageHead>
      <section className="section">
        <div className="wrap prose" style={{ maxWidth: 720 }}>
          {error && <p className="dg-error" role="alert">{error}</p>}
          {!q && !error && <p className="dg-muted">Loading…</p>}
          {q && (<>
            <p>{q.vehicles} car{q.vehicles > 1 ? 's' : ''} with {q.vehicles > 1 ? 'drivers' : 'a driver'}, {q.days} day{q.days > 1 ? 's' : ''}, {q.hours_per_day} hours a day{q.passengers ? `, for ${q.passengers} people` : ''}.</p>
            {q.note && <p>{q.note}</p>}
            <table className="dg-table"><tbody>
              {q.lines.map((l: any) => <tr key={l.label}><td>{l.label}</td><td style={{ textAlign: 'right' }}>{l.cents ? money(l.cents) : ''}</td></tr>)}
              <tr><td><strong>Total</strong></td><td style={{ textAlign: 'right' }}><strong>{money(q.total_cents)}</strong></td></tr>
            </tbody></table>
            <p className="dg-muted">Includes GST of {money(q.gst_cents)}. {q.terms.text}</p>
            {q.accepted_at ? (
              <div className="callout callout--green" role="status"><strong>Accepted by {q.accepted_name} on {date(q.accepted_at)}.</strong> We'll be in touch to confirm times and pickups. Questions: {c.phone ?? 'call us'}.</div>
            ) : q.expired ? (
              <p className="dg-error">This quote expired on {date(q.expires_at)}. Reply to us and we'll send a new one.</p>
            ) : (
              <form onSubmit={accept} className="panel">
                <label className="dg-field"><span>Your name</span><input className="dg-input" required minLength={2} maxLength={80} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" /></label>
                <label className="dg-check"><input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} required /> I accept this quote and the cancellation terms.</label>
                <button className="dg-btn" disabled={busy || !agree}>{busy ? 'Sending…' : 'Accept quote'}</button>
                <p className="dg-muted" style={{ fontSize: '.9rem' }}>Valid until {date(q.expires_at)}. We invoice after the hire.</p>
              </form>
            )}
          </>)}
        </div>
      </section>
    </>
  );
}
