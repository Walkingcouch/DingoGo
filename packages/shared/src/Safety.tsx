/**
 * Round 14: safety and trust pieces shared by the rider and driver apps (and the sign-in screen of every app):
 * the emergency card (what to tell 000, read out loud), trusted contacts with automatic trip sharing, the safety report form,
 * "my reports", and the restricted-account screen with an appeal.
 */
import { useEffect, useState } from 'react';
import { ApiError, apiBase, get, post, put, uploadFile } from './api';
import { canSpeak, speak } from './speak';
import { Icon } from './Icon';

type Num = { label: string; number: string };
const tel = (n: string) => `tel:${n.replace(/\s/g, '')}`;

/** What to say to 000, from the phone's position (or the car's) — address or nearest landmark, GPS, the car and trip. */
export function EmergencyCard({ tripId, pos }: { tripId?: string; pos?: { lat: number; lng: number } | null }) {
  const [card, setCard] = useState<any>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let off = false;
    const qs = new URLSearchParams();
    if (pos) { qs.set('lat', pos.lat.toFixed(6)); qs.set('lng', pos.lng.toFixed(6)); }
    if (tripId) qs.set('trip_id', tripId);
    get(`/safety/emergency-card?${qs}`).then((c) => { if (!off) setCard(c); }).catch(() => { if (!off) setFailed(true); });
    return () => { off = true; };
  }, [tripId, pos?.lat?.toFixed(4), pos?.lng?.toFixed(4)]);
  if (failed) return <p className="dg-muted">Tell 000 the nearest street or building you can see, and the car's rego.</p>;
  if (!card) return <p className="dg-muted" aria-live="polite">Finding your location…</p>;
  return (
    <section aria-labelledby="ec-h" style={{ border: '2px solid var(--line, #ccc)', borderRadius: 'var(--r-md)', padding: '.8rem 1rem', margin: '.8rem 0' }}>
      <h3 id="ec-h" style={{ margin: '0 0 .4rem', fontSize: 'var(--fs-lg)' }}>Tell 000</h3>
      <p style={{ fontSize: 'var(--fs-lg)', lineHeight: 1.45, margin: '0 0 .6rem' }}>{card.say || 'Tell them the nearest street or building you can see.'}</p>
      {card.dms && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)', margin: '0 0 .6rem' }}>GPS {card.dms}</p>}
      {canSpeak() && (
        <button type="button" className="dg-btn dg-btn--ghost dg-btn--sm" onClick={() => speak(card.say)}>
          <Icon name="volume" size={18} /> Read it out
        </button>
      )}
      <ul style={{ listStyle: 'none', padding: 0, margin: '.8rem 0 0', display: 'grid', gap: 6 }}>
        {(card.numbers as Num[]).filter((n) => n.number !== '000').map((n) => (
          <li key={n.number}><a href={tel(n.number)}><strong>{n.number}</strong></a> <span className="dg-muted">{n.label}</span></li>
        ))}
      </ul>
    </section>
  );
}

/** Up to 5 trusted contacts and "share my trips automatically". Works for riders and drivers. */
export function TrustedContacts({ role = 'rider' }: { role?: 'rider' | 'driver' }) {
  const [s, setS] = useState<any>(null);
  const [rows, setRows] = useState<{ name: string; phone: string }[]>([]);
  const [auto, setAuto] = useState('off');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { get('/me/safety').then((r) => { setS(r); setRows(r.trusted_contacts ?? []); setAuto(r.auto_share ?? 'off'); }).catch(() => setS({ ready: false })); }, []);
  if (!s) return <p className="dg-muted">Loading…</p>;
  if (!s.ready) return <p className="dg-muted">Trusted contacts are coming soon. Your emergency contact still gets a text if you press SOS.</p>;
  const night = s.night ? `${s.night.from_hour % 12 || 12}${s.night.from_hour < 12 ? 'am' : 'pm'} to ${s.night.to_hour % 12 || 12}${s.night.to_hour < 12 ? 'am' : 'pm'}` : 'night';
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null); setMsg(null);
    try {
      const r: any = await put('/me/safety', { trusted_contacts: rows.filter((x) => x.name || x.phone), ...(role === 'rider' ? { auto_share: auto } : {}) });
      setRows(r.trusted_contacts); setMsg(r.warning ?? 'Saved');
    } catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not save'); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={save}>
      <p className="dg-muted" style={{ marginTop: 0 }}>
        {role === 'rider'
          ? 'If you press SOS, or don\'t answer a safety check, we text these people your live trip. You can also share each trip with them.'
          : 'If you press SOS, we text these people where your car is.'}
      </p>
      {rows.map((r, i) => (
        <fieldset key={i} style={{ border: 0, padding: 0, margin: '0 0 .6rem', display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 8, alignItems: 'end' }}>
          <legend className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>Contact {i + 1}</legend>
          <label className="dg-field" style={{ margin: 0 }}><span>Name</span><input className="dg-input" value={r.name} maxLength={60} autoComplete="off"
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} /></label>
          <label className="dg-field" style={{ margin: 0 }}><span>Mobile</span><input className="dg-input" type="tel" inputMode="tel" value={r.phone} maxLength={20} autoComplete="off"
            onChange={(e) => setRows(rows.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)))} /></label>
          <button type="button" className="dg-btn dg-btn--ghost dg-btn--sm" aria-label={`Remove contact ${i + 1}`} onClick={() => setRows(rows.filter((_, j) => j !== i))}><Icon name="x" size={18} /></button>
        </fieldset>
      ))}
      {rows.length < 5 && <button type="button" className="dg-btn dg-btn--ghost dg-btn--sm" onClick={() => setRows([...rows, { name: '', phone: '' }])}><Icon name="plus" size={18} /> Add a contact</button>}
      {role === 'rider' && (
        <fieldset style={{ border: 0, padding: 0, margin: '1rem 0 0' }}>
          <legend style={{ fontWeight: 700 }}>Share my trips automatically</legend>
          {[['off', 'Only when I choose'], ['night', `Night trips (${night})`], ['always', 'Every trip']].map(([v, l]) => (
            <label key={v} className="dg-check"><input type="radio" name="auto_share" value={v} checked={auto === v} onChange={() => setAuto(v)} /> <span>{l}</span></label>
          ))}
          <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>They get a text with your driver, car and a live map link when your driver is on the way.</p>
        </fieldset>
      )}
      {err && <p className="dg-error" role="alert">{err}</p>}
      <p aria-live="polite" className="dg-muted">{msg}</p>
      <button className="dg-btn" disabled={busy}>{busy ? 'Saving…' : 'Save contacts'}</button>
    </form>
  );
}

/** Report a safety problem (with a trip or without), with up to 4 photos. */
export function SafetyReportForm({ tripId, onDone }: { tripId?: string; onDone?: (r: any) => void }) {
  const [cats, setCats] = useState<{ key: string; label: string; severity: string }[]>([]);
  const [category, setCategory] = useState('');
  const [text, setText] = useState('');
  const [files, setFiles] = useState<{ url: string; name: string }[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState<any>(null);
  useEffect(() => { get('/safety/report-categories').then((r) => setCats(r.categories)).catch(() => setErr('Could not load the form. Call DingoGo or 000 in an emergency.')); }, []);
  async function add(f: FileList | null) {
    if (!f?.length) return;
    setErr(null);
    try { for (const x of Array.from(f).slice(0, 4 - files.length)) { const u = await uploadFile(x, 'evidence'); setFiles((p) => [...p, { url: u.url, name: x.name }]); } }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not add that file'); }
  }
  async function send(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { const r = await post('/safety/reports', { trip_id: tripId, category, description: text, evidence: files.map((f) => f.url) }); setDone(r); onDone?.(r); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not send your report'); } finally { setBusy(false); }
  }
  if (done) return (
    <div role="status">
      <p><strong>Thanks. We got your report {done.report.ref}.</strong> {done.report.severity === 'critical' ? 'Our safety team will look at it today and may call you.' : 'Our safety team will look at it and get back to you.'}</p>
      <p>In danger now? Call <a href="tel:000">000</a>.</p>
      <ul style={{ paddingLeft: '1.1rem' }}>{(done.numbers as Num[]).filter((n) => n.number !== '000').map((n) => <li key={n.number}><a href={tel(n.number)}>{n.number}</a> {n.label}</li>)}</ul>
    </div>
  );
  return (
    <form onSubmit={send}>
      <p className="dg-muted" style={{ marginTop: 0 }}>In danger now? Call <a href="tel:000">000</a> first. Only our safety team sees this report.</p>
      <label className="dg-field"><span>What happened?</span>
        <select className="dg-input" value={category} onChange={(e) => setCategory(e.target.value)} required>
          <option value="">Choose one</option>
          {cats.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
        </select>
      </label>
      <label className="dg-field"><span>Tell us more</span>
        <textarea className="dg-textarea dg-input" rows={5} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} required minLength={10} />
      </label>
      <label className="dg-field"><span>Photos or screenshots (optional, up to 4)</span>
        <input type="file" accept="image/png,image/jpeg,image/webp,application/pdf" multiple disabled={files.length >= 4} onChange={(e) => { void add(e.target.files); e.target.value = ''; }} />
      </label>
      {files.length > 0 && <ul className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>{files.map((f) => <li key={f.url}>{f.name}</li>)}</ul>}
      {err && <p className="dg-error" role="alert">{err}</p>}
      <button className="dg-btn dg-btn--block" disabled={busy || !category || text.trim().length < 10}>{busy ? 'Sending…' : 'Send report'}</button>
    </form>
  );
}

const REPORT_STATUS: Record<string, string> = { open: 'Received', investigating: 'Being looked at', actioned: 'Finished', closed: 'Finished' };
export function MyReports() {
  const [items, setItems] = useState<any[] | null>(null);
  useEffect(() => { get('/safety/reports').then((r) => setItems(r.reports)).catch(() => setItems([])); }, []);
  if (!items) return null;
  if (!items.length) return <p className="dg-muted">You haven't sent any safety reports.</p>;
  return (
    <ul style={{ listStyle: 'none', padding: 0, display: 'grid', gap: 8 }}>
      {items.map((r) => (
        <li key={r.id}><strong>{r.ref}</strong> {r.label}{r.trip_ref ? ` (trip ${r.trip_ref})` : ''} — {REPORT_STATUS[r.status] ?? r.status}
          {r.outcome && <div className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>{r.outcome}</div>}</li>
      ))}
    </ul>
  );
}

/** Shown instead of signing in when the account is suspended or banned: why, until when, and "ask us to look again". */
export function Restricted({ details, message, onBack }: { details: any; message: string; onBack: () => void }) {
  const token: string | null = details?.appeal_token ?? null;
  const [view, setView] = useState<any>(null);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(apiBase() + path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new ApiError(res.status, j.error ?? 'error', j.message ?? 'Something went wrong');
    return j;
  };
  useEffect(() => { if (token) call('GET', '/appeal').then(setView).catch(() => setView(null)); }, [token]);
  const until = details?.until ? new Date(details.until).toLocaleDateString('en-AU', { day: 'numeric', month: 'long', year: 'numeric' }) : null;
  const appeal = view?.appeal;
  async function send(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try { await call('POST', '/appeal', { message: text }); setView(await call('GET', '/appeal')); }
    catch (x) { setErr(x instanceof ApiError ? x.message : 'Could not send'); } finally { setBusy(false); }
  }
  return (
    <div style={{ marginTop: 24 }}>
      <h2 style={{ fontSize: 'var(--fs-xl)' }}>{details?.kind === 'suspend' ? 'Your account is on hold' : 'Your account is closed'}</h2>
      <p role="alert">{message}{until ? ` Until ${until}.` : ''}</p>
      {!token ? <p className="dg-muted">Call DingoGo if you think this is a mistake.</p>
        : appeal?.status === 'pending' ? <p className="dg-note">We have your request to look again (sent {new Date(appeal.created_at).toLocaleDateString('en-AU')}). We'll text you.</p>
        : appeal?.status === 'upheld' ? <p className="dg-note">We looked again and the decision stays.{appeal.decision_note ? ` ${appeal.decision_note}` : ''}</p>
        : (
          <form onSubmit={send}>
            <label className="dg-field"><span>Ask us to look again: tell us what happened</span>
              <textarea className="dg-textarea dg-input" rows={5} minLength={20} maxLength={1500} value={text} onChange={(e) => setText(e.target.value)} required />
            </label>
            {err && <p className="dg-error" role="alert">{err}</p>}
            <button className="dg-btn dg-btn--block" disabled={busy || text.trim().length < 20}>{busy ? 'Sending…' : 'Send'}</button>
          </form>
        )}
      <button type="button" className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 8 }} onClick={onBack}>Back</button>
    </div>
  );
}
