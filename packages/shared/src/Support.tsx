/**
 * Round 22: help and support pieces shared by the rider and driver apps — the help centre (articles from helpArticles.ts with
 * search), "send us a message", your messages with replies and a rating, "Get help with this trip" (fare check, lost property,
 * feedback, safety) and a driver's lost property cases. Before migration 026 the API says `ready: false` and these fall back to
 * the plain message form.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { ApiError, get, post } from './api';
import { date, dateTime, money } from './format';
import { useLoad } from './hooks';
import { Icon } from './Icon';
import { ChatThread, useTripChat } from './Chat';
import { HELP_TOPICS, articlesFor, searchHelp, type HelpAction, type HelpArticle, type HelpAudience } from './helpArticles';

const errText = (e: unknown, fallback = 'Something went wrong. Please try again.') => (e instanceof ApiError ? e.message : fallback);

export const SUPPORT_CATEGORIES: Record<HelpAudience, [string, string][]> = {
  rider: [
    ['lost_item', 'I left something in the car'], ['fare', 'A question about my fare'], ['driver', 'Feedback about my driver'], ['parcel', 'A parcel problem'],
    ['accessibility', 'Accessibility'], ['assistance_animal_refused', 'A driver refused my assistance animal'], ['safety', 'A safety concern'],
    ['app', 'The app isn’t working'], ['other', 'Something else'],
  ],
  driver: [['pay', 'My pay or a payout'], ['lost_item', 'Lost property'], ['safety', 'A safety concern'], ['app', 'The app isn’t working'], ['other', 'Something else']],
};
const catLabel = (aud: HelpAudience, c: string) => SUPPORT_CATEGORIES[aud].find(([k]) => k === c)?.[1] ?? SUPPORT_CATEGORIES.rider.find(([k]) => k === c)?.[1] ?? c;
const STATUS_TEXT: Record<string, string> = { open: 'With our team', pending: 'Waiting for you', resolved: 'Sorted' };

// ───────────── Help centre ─────────────
export function HelpCentre({ audience, onAction }: { audience: HelpAudience; onAction?: (a: HelpAction, article: HelpArticle) => void }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<HelpArticle | null>(null);
  const results = useMemo(() => (query.trim() ? searchHelp(query, audience) : null), [query, audience]);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => { if (open) heading.current?.focus(); }, [open]);
  if (open) {
    return (
      <article className="dg-help-article" aria-labelledby="help-art-h">
        <button type="button" className="dg-btn dg-btn--ghost dg-btn--sm" onClick={() => setOpen(null)}><Icon name="chevronLeft" size={16} /> All help</button>
        <h2 id="help-art-h" ref={heading} tabIndex={-1}>{open.title}</h2>
        {open.body.map((p, i) => <p key={i}>{p}</p>)}
        {open.action && onAction && <button type="button" className="dg-btn dg-btn--dark" onClick={() => onAction(open.action!, open)}>{ACTION_LABEL[open.action]}</button>}
      </article>
    );
  }
  const all = articlesFor(audience);
  return (
    <section className="dg-help" aria-labelledby="help-h">
      <h2 id="help-h" className="dg-help__h">Find an answer</h2>
      <label className="dg-field"><span>Search help</span>
        <input className="dg-input" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder={audience === 'rider' ? 'For example: left my phone, fare too high' : 'For example: found a phone, pay wrong'} />
      </label>
      {results ? (
        <div role="status" aria-live="polite">
          <p className="dg-muted">{results.length ? `${results.length} answer${results.length === 1 ? '' : 's'}` : 'No answers for that. Try other words, or send us a message below.'}</p>
          <ArticleList items={results.slice(0, 8)} onOpen={setOpen} />
        </div>
      ) : HELP_TOPICS[audience].map((topic) => {
        const items = all.filter((a) => a.topic === topic);
        return items.length ? (
          <div key={topic} className="dg-help__topic"><h3>{topic}</h3><ArticleList items={items} onOpen={setOpen} /></div>
        ) : null;
      })}
    </section>
  );
}
const ACTION_LABEL: Record<HelpAction, string> = {
  trip_help: 'Choose the trip', message: 'Send us a message', safety: 'Report a safety problem', call: 'Emergency help', payment: 'Payment settings',
  profile: 'Open my profile', earnings: 'Open earnings',
};
function ArticleList({ items, onOpen }: { items: HelpArticle[]; onOpen: (a: HelpArticle) => void }) {
  return (
    <ul className="dg-list">
      {items.map((a) => (
        <li key={a.id}><button type="button" className="dg-list__row" onClick={() => onOpen(a)}><span>{a.title}</span><Icon name="chevronRight" size={18} /></button></li>
      ))}
    </ul>
  );
}

// ───────────── Send us a message ─────────────
export function NewTicket({ audience, tripId, initial, onSent, title }: { audience: HelpAudience; tripId?: string; initial?: string; onSent?: (t: any) => void; title?: string }) {
  const cats = SUPPORT_CATEGORIES[audience];
  const [f, setF] = useState({ category: cats.some(([k]) => k === initial) ? initial! : cats[0][0], subject: '', message: '' });
  const [err, setErr] = useState<string | null>(null);
  const [sent, setSent] = useState<any>(null);
  const [busy, setBusy] = useState(false);
  const done = useRef<HTMLParagraphElement>(null);
  async function send(e: React.FormEvent) {
    e.preventDefault(); setErr(null); setBusy(true);
    try {
      const r = await post('/support', { ...f, subject: f.subject.trim() || catLabel(audience, f.category), trip_id: tripId });
      setSent(r.ticket); setF({ ...f, subject: '', message: '' }); onSent?.(r.ticket);
      setTimeout(() => done.current?.focus(), 0);
    } catch (e2) { setErr(errText(e2, 'Could not send. Check your signal and try again.')); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={send} className="dg-help-form" aria-labelledby="nt-h">
      <h2 id="nt-h" className="dg-help__h">{title ?? `Send us a message${tripId ? ' about this trip' : ''}`}</h2>
      {f.category === 'assistance_animal_refused' && (
        <p className="dg-callout">Refusing an assistance animal is against the law and DingoGo policy. Tell us what happened. We review every report and follow it up with the driver.</p>
      )}
      <label className="dg-field"><span>What's it about?</span>
        <select className="dg-input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })}>{cats.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
      <label className="dg-field"><span>Subject (optional)</span><input className="dg-input" maxLength={120} value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} /></label>
      <label className="dg-field"><span>Tell us what happened</span><textarea className="dg-textarea" required minLength={5} maxLength={2000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} /></label>
      {err && <p className="dg-error" role="alert">{err}</p>}
      {sent && <p className="dg-callout dg-callout--green" role="status" tabIndex={-1} ref={done}>Message sent{sent.ref ? ` (${sent.ref})` : ''}. {sent.first_response_due_at ? `We aim to reply by ${dateTime(sent.first_response_due_at)}.` : 'We\'ll reply soon.'} You'll see our reply under Your messages.</p>}
      <button className="dg-btn dg-btn--dark" disabled={busy}>{busy ? 'Sending…' : 'Send message'}</button>
    </form>
  );
}

// ───────────── Your messages ─────────────
export function MyTickets({ audience, reloadKey }: { audience: HelpAudience; reloadKey?: unknown }) {
  const list = useLoad(() => get('/support'), [reloadKey]);
  const [open, setOpen] = useState<string | null>(null);
  if (open) return <TicketThread id={open} audience={audience} onBack={() => { setOpen(null); void list.reload(); }} />;
  const items = list.data?.tickets ?? [];
  if (!items.length) return null;
  return (
    <section className="dg-help" aria-labelledby="mt-h">
      <h2 id="mt-h" className="dg-help__h">Your messages</h2>
      <ul className="dg-list">
        {items.map((t: any) => (
          <li key={t.id}>
            <button type="button" className="dg-list__row" onClick={() => setOpen(t.id)}>
              <span><strong>{t.subject}</strong><br />
                <span className="dg-muted">{t.ref ? `${t.ref}, ` : ''}{STATUS_TEXT[t.status] ?? t.status}, {date(t.updated_at ?? t.created_at)}{t.can_rate ? '. Tell us how we went' : ''}</span></span>
              <span className={`dg-chip ${t.awaiting === 'you' ? 'dg-chip--ochre' : t.status === 'resolved' ? 'dg-chip--green' : ''}`}>{t.awaiting === 'you' ? 'Reply' : STATUS_TEXT[t.status] ?? t.status}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function TicketThread({ id, audience, onBack }: { id: string; audience: HelpAudience; onBack: () => void }) {
  const th = useLoad(() => get(`/support/${id}`), [id]);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rated, setRated] = useState<number | null>(null);
  const [comment, setComment] = useState('');
  const t = th.data?.ticket;
  async function reply(e: React.FormEvent) {
    e.preventDefault(); if (!text.trim()) return;
    setBusy(true); setErr(null);
    try { await post(`/support/${id}/messages`, { body: text.trim() }); setText(''); await th.reload(); } catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
  }
  async function rate(score: number) {
    setErr(null);
    try { await post(`/support/${id}/rating`, { score, comment: comment.trim() || undefined }); setRated(score); } catch (e2) { setErr(errText(e2)); }
  }
  return (
    <section className="dg-help" aria-labelledby="th-h">
      <button type="button" className="dg-btn dg-btn--ghost dg-btn--sm" onClick={onBack}><Icon name="chevronLeft" size={16} /> Your messages</button>
      {!t ? <p className="dg-muted">{th.error ?? 'Loading…'}</p> : (<>
        <h2 id="th-h" className="dg-help__h">{t.subject}</h2>
        <p className="dg-muted">{t.ref ? `${t.ref}. ` : ''}{catLabel(audience, t.category)}. {STATUS_TEXT[t.status] ?? t.status}{t.reply_by ? `. We aim to reply by ${dateTime(t.reply_by)}` : ''}.</p>
        <ol className="dg-thread" aria-label="Messages">
          {th.data.messages.map((m: any) => (
            <li key={m.id} className={`dg-thread__msg ${m.from === 'you' ? 'is-mine' : 'is-dingogo'}`}>
              <span className="dg-chat-who">{m.from === 'you' ? 'You' : m.automatic ? 'DingoGo (automatic check)' : 'DingoGo'}</span>
              <span className="dg-chat-body">{m.body}</span>
              <span className="dg-chat-meta">{dateTime(m.created_at)}</span>
            </li>
          ))}
        </ol>
        {t.can_rate && !rated && (
          <div className="dg-help-rate" role="group" aria-labelledby="rate-h">
            <h3 id="rate-h">How did we go?</h3>
            <label className="dg-field"><span>Anything to add? (optional)</span><input className="dg-input" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} /></label>
            <div className="dg-help-rate__btns">
              {[1, 2, 3, 4, 5].map((n) => (
                <button key={n} type="button" className="dg-btn dg-btn--ghost" onClick={() => rate(n)} aria-label={`${n} out of 5${n === 1 ? ', poor' : n === 5 ? ', great' : ''}`}>
                  <Icon name="star" size={18} /> {n}
                </button>
              ))}
            </div>
          </div>
        )}
        {rated && <p className="dg-callout dg-callout--green" role="status">Thanks for telling us ({rated} out of 5).</p>}
        {t.can_reply && th.data.ready ? (
          <form onSubmit={reply} className="dg-help-form">
            <label className="dg-field"><span>{t.status === 'resolved' ? 'Not sorted? Reply and we\'ll look again' : 'Add a reply'}</span>
              <textarea className="dg-textarea" maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} /></label>
            <button className="dg-btn dg-btn--dark" disabled={busy || !text.trim()}>{busy ? 'Sending…' : 'Send reply'}</button>
          </form>
        ) : t.status === 'resolved' && !t.can_reply ? <p className="dg-muted">This was sorted a while ago. Send us a new message if you need more help.</p> : null}
        {err && <p className="dg-error" role="alert">{err}</p>}
      </>)}
    </section>
  );
}

// ───────────── Get help with this trip ─────────────
const TICKET_FOR: Record<string, { category: string; title: string }> = {
  driver_feedback: { category: 'driver', title: 'Feedback about my driver' }, cancel_fee: { category: 'fare', title: 'About the cancellation fee' },
  parcel: { category: 'parcel', title: 'A problem with the parcel' }, pay: { category: 'pay', title: 'A question about my pay' },
  assistance_animal: { category: 'assistance_animal_refused', title: 'A driver refused my assistance animal' }, other: { category: 'other', title: 'Something else about this trip' },
};

export function TripHelp({ tripId, onSafety, onOpenTrip }: { tripId: string; onSafety: () => void; onOpenTrip?: (id: string) => void }) {
  const help = useLoad(() => get(`/trips/${tripId}/help`), [tripId]);
  const [pick, setPick] = useState<string | null>(null);
  const h = help.data;
  if (!h) return <p className="dg-muted">{help.error ?? 'Loading…'}</p>;
  const audience: HelpAudience = h.role === 'driver' ? 'driver' : 'rider';
  const back = <button type="button" className="dg-btn dg-btn--ghost dg-btn--sm" onClick={() => { setPick(null); void help.reload(); }}><Icon name="chevronLeft" size={16} /> Other help</button>;
  if (pick === 'fare_review') return <>{back}<FareReview tripId={tripId} trip={h.trip} /></>;
  if (pick === 'lost_item' || pick === 'found_item') return <>{back}<ReportLost tripId={tripId} found={pick === 'found_item'} onDone={() => { setPick(null); void help.reload(); }} /></>;
  if (pick && TICKET_FOR[pick]) {
    const c = TICKET_FOR[pick];
    const cat = SUPPORT_CATEGORIES[audience].some(([k]) => k === c.category) ? c.category : 'other';
    return <>{back}<NewTicket audience={audience} tripId={tripId} initial={cat} title={c.title} /></>;
  }
  return (
    <section className="dg-help" aria-labelledby="th-help-h">
      <h2 id="th-help-h" className="dg-help__h">Get help with trip {h.trip.ref}</h2>
      {h.lost_item && <LostCase item={h.lost_item} trip={h.trip} role={h.role} onChange={() => void help.reload()} onOpenTrip={onOpenTrip} />}
      <ul className="dg-list">
        {h.options.map((o: any) => (
          <li key={o.key}><button type="button" className="dg-list__row" onClick={() => (o.key === 'safety' ? onSafety() : setPick(o.key))}>
            <span><strong>{o.title}</strong><br /><span className="dg-muted">{o.sub}</span></span><Icon name="chevronRight" size={18} /></button></li>
        ))}
      </ul>
      {h.tickets?.length > 0 && <p className="dg-muted">You've contacted us about this trip before: {h.tickets.map((t: any) => `${t.ref ?? t.subject} (${STATUS_TEXT[t.status] ?? t.status})`).join(', ')}. See Your messages in Help.</p>}
    </section>
  );
}

function FareReview({ tripId, trip }: { tripId: string; trip: any }) {
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const out = useRef<HTMLDivElement>(null);
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { setRes(await post(`/trips/${tripId}/help/fare-review`, { message: msg.trim() || undefined })); setTimeout(() => out.current?.focus(), 0); }
    catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
  }
  if (res) {
    return (
      <div ref={out} tabIndex={-1} role="status" className={`dg-callout ${res.outcome === 'refunded' ? 'dg-callout--green' : ''}`}>
        <h2 className="dg-help__h">{res.outcome === 'refunded' ? `We've refunded ${money(res.refund_cents)}` : res.outcome === 'explained' ? 'We checked your fare' : 'A person will look at it'}</h2>
        <p>{res.explanation}</p>
        <p>{res.outcome === 'refunded' ? 'It goes back the way you paid. Card refunds usually take 3 to 5 business days.'
          : res.outcome === 'explained' ? 'If something else went wrong, reply under Your messages and a person will look at it.'
          : `We'll reply under Your messages${res.ticket?.reply_by ? ` by ${dateTime(res.ticket.reply_by)}` : ''}.`} Reference {res.ticket?.ref}.</p>
      </div>
    );
  }
  return (
    <form onSubmit={go} className="dg-help-form" aria-labelledby="fr-h">
      <h2 id="fr-h" className="dg-help__h">Check my fare</h2>
      <p>You were shown {money(trip.quote_cents)} and paid {money(trip.final_cents ?? trip.quote_cents)}. We check the charge against your price and the route the car's GPS recorded. If you paid too much and it's a small amount, we refund it straight away.</p>
      <label className="dg-field"><span>Anything we should know? (optional)</span><textarea className="dg-textarea" maxLength={2000} value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="For example: the driver took a long way" /></label>
      {err && <p className="dg-error" role="alert">{err}</p>}
      <button className="dg-btn dg-btn--dark" disabled={busy}>{busy ? 'Checking…' : 'Check my fare'}</button>
    </form>
  );
}

/** Where a courier can collect a found item: the phone's position now, with a short description people can find. */
function useHandover() {
  const [pos, setPos] = useState<{ lat: number; lng: number } | null>(null);
  const [place, setPlace] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const locate = () => {
    setMsg('Finding where you are…');
    if (!navigator.geolocation) { setMsg('This phone can’t share its location. Arrange a pickup with the rider through Messages instead.'); return; }
    navigator.geolocation.getCurrentPosition((p) => { setPos({ lat: p.coords.latitude, lng: p.coords.longitude }); setMsg('Location added.'); },
      () => setMsg('Couldn’t get your location. Try again, or arrange a pickup through Messages.'), { enableHighAccuracy: true, timeout: 15000 });
  };
  const value = pos ? { ...pos, address: place.trim() || 'Driver handover point' } : undefined;
  const ui = (
    <fieldset className="dg-help-fieldset">
      <legend>Where can a courier collect it? (optional)</legend>
      <p className="dg-muted">Pick a public place or the depot. The rider sees this description.</p>
      <label className="dg-field"><span>Description</span><input className="dg-input" maxLength={200} value={place} onChange={(e) => setPlace(e.target.value)} placeholder="For example: DingoGo depot, Gap Road" /></label>
      <button type="button" className="dg-btn dg-btn--ghost dg-btn--sm" onClick={locate}><Icon name="locate" size={16} /> Use where I am now</button>
      {msg && <p className="dg-muted" role="status">{msg}</p>}
    </fieldset>
  );
  return { value, ui };
}

function ReportLost({ tripId, found, onDone }: { tripId: string; found: boolean; onDone: () => void }) {
  const [desc, setDesc] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const handover = useHandover();
  async function go(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      await post(`/trips/${tripId}/help/${found ? 'found-item' : 'lost-item'}`, found ? { description: desc.trim(), handover: handover.value } : { description: desc.trim() });
      onDone();
    } catch (e2) { setErr(errText(e2)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={go} className="dg-help-form" aria-labelledby="lost-h">
      <h2 id="lost-h" className="dg-help__h">{found ? 'The rider left something in my car' : 'I left something in the car'}</h2>
      <p className="dg-muted">{found ? 'We tell the rider. Keep it somewhere safe and don’t open bags or wallets.' : 'We tell your driver straight away. You can message or call them from here while we sort it out. Your number stays hidden.'}</p>
      <label className="dg-field"><span>What is it?</span><input className="dg-input" required minLength={3} maxLength={500} value={desc} onChange={(e) => setDesc(e.target.value)} placeholder={found ? 'For example: black phone in a red case' : 'For example: blue backpack with books'} /></label>
      {found && handover.ui}
      {err && <p className="dg-error" role="alert">{err}</p>}
      <button className="dg-btn dg-btn--dark" disabled={busy || desc.trim().length < 3}>{busy ? 'Sending…' : found ? 'Tell the rider' : 'Tell my driver'}</button>
    </form>
  );
}

/** One lost property case: what's happening, messages with the other person, and the next step for this person. */
export function LostCase({ item, trip, role, onChange, onOpenTrip }: { item: any; trip?: any; role: 'rider' | 'driver'; onChange: () => void; onOpenTrip?: (id: string) => void }) {
  const open = ['reported', 'found', 'collect', 'return_booked'].includes(item.status);
  const chat = useTripChat(open ? item.trip_id : null, open);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [to, setTo] = useState<'dropoff' | 'pickup'>('dropoff');
  const [payBy, setPayBy] = useState<'card' | 'wallet'>('card');
  const handover = useHandover();
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setErr(null); try { await fn(); onChange(); } catch (e) { setErr(errText(e)); } finally { setBusy(false); } };
  return (
    <div className="dg-callout" aria-live="polite">
      <h3 style={{ marginTop: 0 }}>Lost property: {item.label}</h3>
      <p>"{item.description}"{item.driver_note ? `. Driver: "${item.driver_note}"` : ''}</p>
      {item.handover && <p className="dg-muted">Collect from: {item.handover.address}</p>}
      {item.return_trip && <p>Courier {item.return_trip.ref}{onOpenTrip ? <> (<button type="button" className="dg-link" onClick={() => onOpenTrip(item.return_trip.id)}>track it</button>)</> : ''}.</p>}
      {role === 'rider' && item.can_return && (
        <div className="dg-help-form">
          <h4>Get it back</h4>
          {item.handover ? (<>
            <label className="dg-field"><span>Send it to</span>
              <select className="dg-input" value={to} onChange={(e) => setTo(e.target.value as any)}>
                {trip?.dropoff && <option value="dropoff">{trip.dropoff.address}</option>}
                {trip?.pickup && <option value="pickup">{trip.pickup.address}</option>}
              </select></label>
            <label className="dg-field"><span>Pay with</span>
              <select className="dg-input" value={payBy} onChange={(e) => setPayBy(e.target.value as any)}><option value="card">Saved card</option><option value="wallet">DingoGo credit</option></select></label>
            <p className="dg-muted">A courier collects it from your driver. Priced as a small parcel.</p>
            <button type="button" className="dg-btn dg-btn--dark" disabled={busy || !trip?.[to]} onClick={() => act(() => post(`/lost-items/${item.id}/return`, { method: 'courier', dropoff: trip[to], payment_method: payBy }))}>Send it to me</button>
          </>) : <p className="dg-muted">Your driver hasn't said where a courier can collect it yet. Ask them below, or collect it yourself.</p>}
          <button type="button" className="dg-btn dg-btn--ghost" disabled={busy} onClick={() => act(() => post(`/lost-items/${item.id}/return`, { method: 'collect' }))}>I'll collect it</button>
        </div>
      )}
      {role === 'driver' && item.can_answer && (
        <div className="dg-help-form">
          <label className="dg-field"><span>Note for the rider (optional)</span><input className="dg-input" maxLength={300} value={note} onChange={(e) => setNote(e.target.value)} /></label>
          {item.status !== 'collect' && handover.ui}
          <button type="button" className="dg-btn dg-btn--dark" disabled={busy} onClick={() => act(() => post(`/lost-items/${item.id}/respond`, { found: true, note: note.trim() || undefined, handover: handover.value }))}>
            {item.status === 'reported' ? 'I have it' : 'Update'}</button>
          {item.status === 'reported' && <button type="button" className="dg-btn dg-btn--ghost" disabled={busy} onClick={() => act(() => post(`/lost-items/${item.id}/respond`, { found: false, note: note.trim() || undefined }))}>It's not in my car</button>}
        </div>
      )}
      {err && <p className="dg-error" role="alert">{err}</p>}
      {open && chat.canSend && <ChatThread chat={chat} otherLabel={role === 'rider' ? 'Driver' : 'Rider'} hint="Agree a time and a public place. Your number stays hidden." />}
    </div>
  );
}

/** Driver: lost property cases on their trips. */
export function DriverLostItems() {
  const r = useLoad(() => get('/driver/lost-items'));
  const items = r.data?.items ?? [];
  if (!r.data?.ready || !items.length) return null;
  return (
    <section className="dg-help" aria-labelledby="dli-h">
      <h2 id="dli-h" className="dg-help__h">Lost property</h2>
      {items.map((i: any) => (
        <div key={i.id}>
          <p className="dg-muted" style={{ marginBottom: 0 }}>Trip {i.trip_ref}{i.rider_first_name ? ` with ${i.rider_first_name}` : ''}, {date(i.trip_completed_at)}</p>
          <LostCase item={i} role="driver" onChange={() => void r.reload()} />
        </div>
      ))}
    </section>
  );
}
