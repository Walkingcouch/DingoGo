import { useState } from 'react';
import { ApiError, STATUS_LABEL, dateTime, dayName, del, monthName, downloadFile, get, money, patch, post, put, useLoad } from '@dingogo/shared';
import { Page, Spinner } from '../components/ui';
import { PlaceField, type Place } from '../components/PlaceField';
import { AccountFields, EMPTY_ACCOUNT_VALUES, accountBody, accountMissing, useAccountSetup, type AccountValues } from '../components/AccountFields';
import { CLIENT_KINDS, useMe } from '../ctx';

type Tab = 'overview' | 'book' | 'regular' | 'approvals' | 'invoices' | 'setup';
const ROLE: Record<string, string> = { member: 'Member', approver: 'Approver', manager: 'Manager' };
/** What the signed-in person can do on the account, in a sentence. */
const ROLE_LINE: Record<string, string> = { member: 'You can book trips on this account.', approver: 'You approve trips and see spend and invoices.',
  manager: 'You manage this account: people, rules, approvals and invoices.' };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const darwinToday = () => new Date(Date.now() + 9.5 * 3600e3).toISOString().slice(0, 10);
const errText = (e: unknown, fallback: string) => (e instanceof ApiError ? e.message : fallback);

/** Round 24: a business, government or health account — spend, booking for others, regular trips, approvals, invoices and set-up. */
export function BusinessAccountScreen() {
  const { me } = useMe();
  const accounts: any[] = me?.corporate_accounts ?? [];
  const [accountId, setAccountId] = useState('');
  const acct = accounts.find((a) => a.id === accountId) ?? accounts[0];
  const [tab, setTab] = useState<Tab | ''>('');   // '' = the first section this person can see (Spend for approvers)
  if (!me) return <Page title="Business account" back="/account"><Spinner /></Page>;
  if (!acct) return <Page title="Business account" back="/account"><p>You're not on a business account. Your organisation can apply at dingogo.com.au/business.</p></Page>;
  const approver = acct.role === 'manager' || acct.role === 'approver';
  const tabs: [Tab, string][] = [
    ...(approver ? [['overview', 'Spend'] as [Tab, string]] : []), ['book', 'Book for someone'], ['regular', 'Regular trips'],
    ...(approver ? [['approvals', 'Approvals'], ['invoices', 'Invoices']] as [Tab, string][] : []),
    ...(acct.role === 'manager' ? [['setup', 'Set-up'] as [Tab, string]] : []),
  ];
  const shown = tabs.some(([k]) => k === tab) ? tab : tabs[0][0];
  return (
    <Page title="Business account" back="/account">
      {accounts.length > 1 && (
        <label className="dg-field"><span>Account</span>
          <select className="dg-select" value={acct.id} onChange={(e) => setAccountId(e.target.value)}>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
      )}
      <p className="dg-muted" style={{ marginTop: 0 }}><strong>{acct.name}</strong>. {ROLE_LINE[acct.role] ?? ROLE_LINE.member}</p>
      <div className="seg" role="group" aria-label="Business account">
        {tabs.map(([k, l]) => <button key={k} type="button" aria-pressed={shown === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      <div key={`${acct.id}-${shown}`}>
        {shown === 'overview' && <Overview accountId={acct.id} />}
        {shown === 'book' && <BookFor account={acct} />}
        {shown === 'regular' && <Regular account={acct} />}
        {shown === 'approvals' && <Approvals accountId={acct.id} />}
        {shown === 'invoices' && <Invoices accountId={acct.id} />}
        {shown === 'setup' && <Setup accountId={acct.id} />}
      </div>
    </Page>
  );
}

function Bars({ rows }: { rows: { key: string; trips: number; spend_cents: number }[] }) {
  const max = Math.max(1, ...rows.map((r) => r.spend_cents));
  if (!rows.length) return <p className="dg-muted">Nothing yet.</p>;
  return (
    <ul className="acct-bars">
      {rows.map((r) => (
        <li key={r.key}><span>{r.key}</span><span className="dg-money">{money(r.spend_cents)} · {r.trips} trip{r.trips === 1 ? '' : 's'}</span>
          <span className="bar" style={{ width: `${Math.max(2, (r.spend_cents / max) * 100)}%` }} aria-hidden="true" /></li>
      ))}
    </ul>
  );
}

function Overview({ accountId }: { accountId: string }) {
  const [month, setMonth] = useState(darwinToday().slice(0, 7));
  const u = useLoad(() => get<any>(`/business/usage?account_id=${accountId}&month=${month}`), [accountId, month]);
  const d = u.data;
  return (
    <section aria-label="Spend">
      <label className="dg-field" style={{ maxWidth: 220 }}><span>Month</span><input className="dg-input" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></label>
      {u.error && <p className="dg-error" role="alert">{u.error}</p>}
      {u.loading && !d ? <Spinner /> : d && (<>
        <div className="acct-kpis">
          <div className="acct-kpi"><span className="dg-muted">Spent</span><strong>{money(d.totals.spend_cents)}</strong><span className="dg-muted">incl. {money(d.totals.gst_cents)} GST</span></div>
          <div className="acct-kpi"><span className="dg-muted">Trips</span><strong>{d.totals.trips}</strong><span className="dg-muted">average {money(d.totals.average_cents)}</span></div>
          {d.limit && <div className="acct-kpi"><span className="dg-muted">Monthly limit</span><strong>{money(d.limit.left_cents)} left</strong><span className="dg-muted">of {money(d.limit.limit_cents)}</span></div>}
          <div className="acct-kpi"><span className="dg-muted">Booked ahead</span><strong>{d.booked.trips}</strong><span className="dg-muted">{money(d.booked.quote_cents)}</span></div>
          {d.approvals_waiting > 0 && <div className="acct-kpi"><span className="dg-muted">Waiting for approval</span><strong>{d.approvals_waiting}</strong></div>}
          <div className="acct-kpi"><span className="dg-muted">Unpaid invoices</span><strong>{money(d.invoices.open_cents)}</strong>
            <span className={d.invoices.overdue ? 'dg-error' : 'dg-muted'}>{d.invoices.overdue ? `${d.invoices.overdue} overdue` : `${d.invoices.open} open`}</span></div>
        </div>
        {d.totals.refunds_cents > 0 && <p className="dg-muted">Includes {money(d.totals.refunds_cents)} of refunds.</p>}
        <h2 className="section__title">By cost centre</h2><Bars rows={d.by_cost_centre} />
        <h2 className="section__title">By purpose</h2><Bars rows={d.by_purpose} />
        <h2 className="section__title">By traveller</h2><Bars rows={d.by_traveller} />
      </>)}
    </section>
  );
}

/** Who the trip is for: me, someone on the account, a client with consent (community accounts) or a guest. */
function TravellerPicker({ account, value, onChange }: { account: any; value: any; onChange: (v: any) => void }) {
  const setup = useLoad(() => get<any>(`/business/accounts/${account.id}/setup`), [account.id]);
  const clients = useLoad(() => (CLIENT_KINDS.includes(account.kind) ? get<any>(`/business/clients?account_id=${account.id}`) : Promise.resolve({ clients: [] })), [account.id]);
  const members = (setup.data?.members ?? []) as any[];
  const consents = ((clients.data?.clients ?? []) as any[]).filter((c) => c.current);
  const kind = value.kind as string;
  return (
    <fieldset className="block">
      <legend>Who is travelling?</legend>
      <div className="seg" role="group" aria-label="Traveller">
        {([['self', 'Me'], ...(members.length ? [['member', 'Someone on the account']] : [['member', 'A colleague']]),
          ...(consents.length ? [['client', 'A client']] : []), ...(!CLIENT_KINDS.includes(account.kind) ? [['guest', 'A guest']] : [])] as [string, string][])
          .map(([k, l]) => <button key={k} type="button" aria-pressed={kind === k} onClick={() => onChange({ kind: k })}>{l}</button>)}
      </div>
      {kind === 'member' && (members.length ? (
        <label className="dg-field"><span>Person</span>
          <select className="dg-select" value={value.member_id ?? ''} onChange={(e) => onChange({ kind, member_id: e.target.value })}>
            <option value="">Choose…</option>{members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select></label>
      ) : <p className="dg-muted">Ask your account manager to book for colleagues, or add them to the account.</p>)}
      {kind === 'client' && (
        <label className="dg-field"><span>Client</span>
          <select className="dg-select" value={value.consent_id ?? ''} onChange={(e) => onChange({ kind, consent_id: e.target.value })}>
            <option value="">Choose…</option>{consents.map((c) => <option key={c.id} value={c.id}>{c.client_full_name}</option>)}
          </select></label>
      )}
      {kind === 'guest' && (
        <div className="grid2">
          <label className="dg-field"><span>Guest's name</span><input className="dg-input" value={value.name ?? ''} maxLength={80} onChange={(e) => onChange({ ...value, name: e.target.value })} /></label>
          <label className="dg-field"><span>Guest's mobile</span><input className="dg-input" type="tel" value={value.phone ?? ''} onChange={(e) => onChange({ ...value, phone: e.target.value })} /></label>
        </div>
      )}
      {kind !== 'self' && <p className="dg-muted" style={{ fontSize: 'var(--fs-sm)' }}>We text them the booking and when the driver is on the way.</p>}
    </fieldset>
  );
}
function travellerBody(v: any) {
  if (v.kind === 'member') return v.member_id ? { member_id: v.member_id } : null;
  if (v.kind === 'client') return v.consent_id ? { consent_id: v.consent_id } : null;
  if (v.kind === 'guest') return v.name?.trim() && v.phone?.trim() ? { name: v.name.trim(), phone: v.phone.trim() } : null;
  return { self: true };
}

function BookFor({ account }: { account: any }) {
  const [who, setWho] = useState<any>({ kind: 'self' });
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [when, setWhen] = useState('');
  const [notes, setNotes] = useState('');
  const [vals, setVals] = useState<AccountValues>(EMPTY_ACCOUNT_VALUES);
  const setup = useAccountSetup(account.id);
  const [quote, setQuote] = useState<any | null>(null);
  const [done, setDone] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const trips = useLoad(() => get<any>(`/business/trips?account_id=${account.id}&limit=20`), [account.id, done?.id]);
  const traveller = travellerBody(who);
  const body = () => ({ account_id: account.id, traveller, pickup, dropoff, scheduled_for: when ? new Date(when).toISOString() : null, notes: notes.trim() || undefined, ...accountBody(vals) });
  const missing = !traveller ? 'who is travelling' : !pickup ? 'a pickup' : !dropoff ? 'a drop-off' : accountMissing(setup, vals);
  async function price() {
    setErr(null);
    try { setQuote(await post('/business/trips/quote', body())); } catch (e) { setErr(errText(e, 'Could not price it')); }
  }
  async function book(e: React.FormEvent) {
    e.preventDefault(); if (missing) { setErr(`To book, add ${missing}.`); return; }
    setErr(null); setBusy(true);
    try { const r = await post('/business/trips', body()); setDone(r.trip); setQuote(null); setPickup(null); setDropoff(null); setWhen(''); setNotes(''); }
    catch (e2) { setErr(errText(e2, 'Could not book')); } finally { setBusy(false); }
  }
  return (
    <section aria-label="Book for someone">
      <form onSubmit={book}>
        <TravellerPicker account={account} value={who} onChange={(v) => { setWho(v); setQuote(null); }} />
        <div className="places">
          <PlaceField label="Pickup" dot="A" value={pickup} onChange={(p) => { setPickup(p); setQuote(null); }} placeholder="Pickup" />
          <PlaceField label="Drop-off" dot="B" value={dropoff} onChange={(p) => { setDropoff(p); setQuote(null); }} placeholder="Drop-off" />
        </div>
        <label className="dg-field"><span>When (leave empty for now)</span><input className="dg-input" type="datetime-local" value={when} onChange={(e) => { setWhen(e.target.value); setQuote(null); }} /></label>
        <label className="dg-field"><span>Note for the driver (optional)</span><input className="dg-input" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></label>
        <AccountFields setup={setup} value={vals} onChange={setVals} totalCents={quote?.quote?.total_cents} later={!!when} />
        {quote && <p className="dg-note" role="status">Price {money(quote.quote.total_cents)} incl. GST, on the account's monthly invoice.</p>}
        {done && <p className="dg-note" role="status">Booked {done.ref} for {done.traveller}.{done.approval_status === 'pending' ? ' It is waiting for an approver.' : ''}</p>}
        {err && <p className="dg-error" role="alert">{err}</p>}
        <div className="grid2">
          <button type="button" className="dg-btn dg-btn--ghost" disabled={!pickup || !dropoff} onClick={price}>Check price</button>
          <button className="dg-btn" disabled={busy}>{busy ? 'Booking…' : when ? 'Book for later' : 'Book now'}</button>
        </div>
      </form>
      <h2 className="section__title" style={{ marginTop: 24 }}>Recent trips on the account</h2>
      {trips.loading && !trips.data ? <Spinner /> : !trips.data?.trips.length ? <p className="dg-muted">None yet.</p> : (
        <ul className="list">
          {trips.data.trips.map((t: any) => (
            <li key={t.id} className="row"><span className="row__main"><strong>{t.traveller}: {t.pickup_address} to {t.dropoff_address}</strong>
              <span className="dg-muted">{t.ref}, {dateTime(t.scheduled_for ?? t.requested_at)}, {STATUS_LABEL[t.status] ?? t.status}
                {t.approval_status === 'pending' ? ', waiting for approval' : ''}{t.cost_centre_code ? `, ${t.cost_centre_code}` : ''}, {money(t.final_cents ?? t.quote_cents)}</span></span></li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Regular({ account }: { account: any }) {
  const list = useLoad(() => get<any>(`/business/recurring?account_id=${account.id}`), [account.id]);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  async function act(fn: () => Promise<unknown>) { setErr(null); try { await fn(); await list.reload(); } catch (e) { setErr(errText(e, 'Could not change it')); } }
  return (
    <section aria-label="Regular trips">
      <p className="dg-muted" style={{ marginTop: 0 }}>For dialysis, clinics and work rosters: we book each trip two weeks ahead, skip public holidays if you want, and text the traveller once.</p>
      {err && <p className="dg-error" role="alert">{err}</p>}
      {list.loading && !list.data ? <Spinner /> : !list.data?.series.length ? <p className="dg-muted">No regular trips yet.</p> : (
        <ul className="list">
          {list.data.series.map((s: any) => (
            <li key={s.id} className="row"><span className="row__main"><strong>{s.traveller}: {s.days} at {s.pickup_time}{s.return_time ? `, back at ${s.return_time}` : ''}</strong>
              <span className="dg-muted">{s.ref}. {s.pickup.address ?? 'Pickup'} to {s.dropoff.address ?? 'drop-off'}. {s.active ? `${s.upcoming} booked${s.next_at ? `, next ${dateTime(s.next_at)}` : ''}` : `Stopped${s.stopped_reason ? `: ${s.stopped_reason}` : ''}`}
                {s.last_run?.problems?.length ? `. Not booked: ${dayName(s.last_run.problems[0].date)} (${s.last_run.problems[0].reason})` : ''}</span></span>
              {s.active && <SeriesActions onSkip={(d) => act(() => post(`/business/recurring/${s.id}/skip`, { date: d }))} onStop={(c) => act(() => post(`/business/recurring/${s.id}/stop`, { cancel_booked: c }))} />}</li>
          ))}
        </ul>
      )}
      {open ? <NewSeries account={account} onDone={async () => { setOpen(false); await list.reload(); }} onCancel={() => setOpen(false)} />
        : <button className="dg-btn dg-btn--ghost dg-btn--block" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>Set up regular trips</button>}
    </section>
  );
}
function SeriesActions({ onSkip, onStop }: { onSkip: (date: string) => void; onStop: (cancel: boolean) => void }) {
  const [day, setDay] = useState('');
  return (
    <span style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
      <span style={{ display: 'flex', gap: 6 }}>
        <input className="dg-input" type="date" aria-label="Date to skip" value={day} min={darwinToday()} onChange={(e) => setDay(e.target.value)} style={{ width: 'auto' }} />
        <button className="dg-btn dg-btn--sm dg-btn--ghost" disabled={!day} onClick={() => onSkip(day)}>Skip day</button>
      </span>
      <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => { if (confirm('Stop these regular trips and cancel the ones already booked?')) onStop(true); }}>Stop</button>
    </span>
  );
}
function NewSeries({ account, onDone, onCancel }: { account: any; onDone: () => Promise<void>; onCancel: () => void }) {
  const [who, setWho] = useState<any>({ kind: 'self' });
  const [pickup, setPickup] = useState<Place | null>(null);
  const [dropoff, setDropoff] = useState<Place | null>(null);
  const [days, setDays] = useState<number[]>([]);
  const [time, setTime] = useState('07:30');
  const [back, setBack] = useState('');
  const [start, setStart] = useState(darwinToday());
  const [end, setEnd] = useState('');
  const [holidays, setHolidays] = useState(true);
  const [notes, setNotes] = useState('');
  const [vals, setVals] = useState<AccountValues>(EMPTY_ACCOUNT_VALUES);
  const setup = useAccountSetup(account.id);
  const [preview, setPreview] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const traveller = travellerBody(who);
  const body = (dry: boolean) => ({ account_id: account.id, traveller, pickup, dropoff, weekdays: days, pickup_time: time, return_time: back || null, starts_on: start,
    ends_on: end || null, skip_holidays: holidays, skip_dates: [], dry_run: dry, options: { ...accountBody(vals), notes: notes.trim() || undefined } });
  const missing = !traveller ? 'who is travelling' : !pickup ? 'a pickup' : !dropoff ? 'a drop-off' : !days.length ? 'the days' : accountMissing(setup, vals);
  async function go(dry: boolean) {
    if (missing) { setErr(`Add ${missing}.`); return; }
    setErr(null); setBusy(true);
    try { const r = await post('/business/recurring', body(dry)); if (dry) setPreview(r.preview); else await onDone(); }
    catch (e) { setErr(errText(e, 'Could not set it up')); } finally { setBusy(false); }
  }
  return (
    <form className="block" style={{ marginTop: 12 }} onSubmit={(e) => { e.preventDefault(); void go(false); }} aria-label="Set up regular trips">
      <TravellerPicker account={account} value={who} onChange={setWho} />
      <div className="places">
        <PlaceField label="Pickup" dot="A" value={pickup} onChange={setPickup} placeholder="Pickup (e.g. home)" />
        <PlaceField label="Drop-off" dot="B" value={dropoff} onChange={setDropoff} placeholder="Drop-off (e.g. the clinic)" />
      </div>
      <fieldset className="block"><legend>Days</legend>
        <div className="seg seg--days" role="group" aria-label="Days of the week">
          {WEEKDAYS.map((d, i) => <button key={d} type="button" aria-pressed={days.includes(i + 1)} onClick={() => setDays(days.includes(i + 1) ? days.filter((x) => x !== i + 1) : [...days, i + 1])}>{d}</button>)}
        </div>
      </fieldset>
      <div className="grid2">
        <label className="dg-field"><span>Pickup time</span><input className="dg-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} /></label>
        <label className="dg-field"><span>Trip back at (optional)</span><input className="dg-input" type="time" value={back} onChange={(e) => setBack(e.target.value)} /></label>
        <label className="dg-field"><span>Starts</span><input className="dg-input" type="date" value={start} min={darwinToday()} onChange={(e) => setStart(e.target.value)} /></label>
        <label className="dg-field"><span>Ends (optional)</span><input className="dg-input" type="date" value={end} min={start} onChange={(e) => setEnd(e.target.value)} /></label>
      </div>
      <label className="dg-check"><input type="checkbox" checked={holidays} onChange={(e) => setHolidays(e.target.checked)} /><span>No trips on public holidays</span></label>
      <label className="dg-field"><span>Note for the driver (optional)</span><input className="dg-input" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} placeholder="e.g. renal unit, door 3" /></label>
      <AccountFields setup={setup} value={vals} onChange={setVals} later />
      {preview && <p className="dg-note" role="status">The next two weeks: {preview.trips.length} trip{preview.trips.length === 1 ? '' : 's'}{preview.skipped.length ? `, ${preview.skipped.length} day${preview.skipped.length === 1 ? '' : 's'} skipped (${preview.skipped.map((s: any) => `${dayName(s.date)}${s.reason === 'holiday' ? ', public holiday' : ''}`).join('; ')})` : ''}.</p>}
      {err && <p className="dg-error" role="alert">{err}</p>}
      <div className="grid2">
        <button type="button" className="dg-btn dg-btn--ghost" onClick={preview ? onCancel : () => void go(true)}>{preview ? 'Cancel' : 'Preview'}</button>
        <button className="dg-btn" disabled={busy}>{busy ? 'Booking…' : 'Book them'}</button>
      </div>
    </form>
  );
}

function Approvals({ accountId }: { accountId: string }) {
  const list = useLoad(() => get<any>(`/business/approvals?account_id=${accountId}`), [accountId]);
  const [err, setErr] = useState<string | null>(null);
  async function decide(id: string, approve: boolean) {
    setErr(null);
    const note = approve ? null : prompt('Reason (optional, the traveller sees it)') ?? null;
    try { await post(`/business/approvals/${id}`, { approve, note }); await list.reload(); } catch (e) { setErr(errText(e, 'Could not save')); }
  }
  return (
    <section aria-label="Approvals">
      <p className="dg-muted" style={{ marginTop: 0 }}>Trips over the account's approval amount wait here. A trip still waiting when it is due is not sent, and there is no charge.</p>
      {err && <p className="dg-error" role="alert">{err}</p>}
      {list.loading && !list.data ? <Spinner /> : !list.data?.approvals.length ? <p className="dg-muted">Nothing waiting.</p> : (
        <ul className="list">
          {list.data.approvals.map((t: any) => (
            <li key={t.id} className="row"><span className="row__main"><strong>{t.traveller}: {t.pickup_address} to {t.dropoff_address}</strong>
              <span className="dg-muted">{t.ref}, {dateTime(t.scheduled_for)}, {money(t.quote_cents)}{t.cost_centre_code ? `, ${t.cost_centre_code}` : ''}{t.purpose_code ? `, ${t.purpose_code}` : ''}{t.booked_by_name ? `. Booked by ${t.booked_by_name}` : ''}</span></span>
              <span style={{ display: 'flex', gap: 6 }}>
                <button className="dg-btn dg-btn--sm" onClick={() => decide(t.id, true)}>Approve</button>
                <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => decide(t.id, false)}>Decline</button>
              </span></li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Invoices({ accountId }: { accountId: string }) {
  const list = useLoad(() => get<any>(`/business/invoices?account_id=${accountId}`), [accountId]);
  const [err, setErr] = useState<string | null>(null);
  return (
    <section aria-label="Invoices">
      <p className="dg-muted" style={{ marginTop: 0 }}>One tax invoice a month, issued after the month ends. Each trip shows the traveller, cost centre, purpose and PO.</p>
      {err && <p className="dg-error" role="alert">{err}</p>}
      {list.loading && !list.data ? <Spinner /> : !list.data?.invoices.length ? <p className="dg-muted">No invoices yet.</p> : (
        <ul className="list">
          {list.data.invoices.map((i: any) => (
            <li key={i.id} className="row"><span className="row__main"><strong>{i.number}{i.po_number ? ` (PO ${i.po_number})` : ''}: {money(i.total_cents)}</strong>
              <span className={i.overdue_days > 0 ? 'dg-error' : 'dg-muted'}>{monthName(i.month)}. {i.status === 'paid' ? `Paid${i.paid_on ? ` ${dayName(i.paid_on)}` : ''}` : i.status === 'void' ? 'Void' : i.overdue_days > 0 ? `${i.overdue_days} days overdue` : `Due ${dayName(i.due_on)}`}</span></span>
              <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => downloadFile(`/business/invoices/${i.id}?format=pdf`, `${i.number}.pdf`).catch((e) => setErr(errText(e, 'Could not download')))}>PDF</button></li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Setup({ accountId }: { accountId: string }) {
  const s = useLoad(() => get<any>(`/business/accounts/${accountId}/setup`), [accountId]);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  async function run(fn: () => Promise<unknown>, done: string) {
    setErr(null); setOk(null);
    try { await fn(); setOk(done); await s.reload(); return true; } catch (e) { setErr(errText(e, 'Could not save')); return false; }
  }
  const [m, setM] = useState({ name: '', phone: '', role: 'member' });
  const [cc, setCc] = useState({ code: '', name: '', approver_id: '', budget: '' });
  const [p, setP] = useState({ code: '', label: '' });
  if (s.loading && !s.data) return <Spinner />;
  if (!s.data) return <p className="dg-error" role="alert">{s.error}</p>;
  const d = s.data; const r = d.rules;
  const rule = (k: string, v: unknown) => run(() => put(`/business/accounts/${accountId}/rules`, { [k]: v }), 'Saved');
  return (
    <section aria-label="Set-up">
      {err && <p className="dg-error" role="alert">{err}</p>}
      {ok && <p className="dg-note" role="status">{ok}</p>}
      <h2 className="section__title">Booking rules</h2>
      {([['require_cost_centre', 'Every trip needs a cost centre'], ['require_purpose', 'Every trip needs a purpose'], ['require_po', 'Every trip needs a PO number'],
        ['require_ndis_number', "Every trip needs the participant's NDIS number"], ['invoice_per_po', 'One invoice for each PO number'], ['guests', 'Staff can book for guests (visitors, candidates)']] as [string, string][])
        .map(([k, l]) => <label key={k} className="dg-check"><input type="checkbox" checked={!!r[k]} onChange={(e) => void rule(k, e.target.checked)} /><span>{l}</span></label>)}
      <div className="grid2">
        <label className="dg-field"><span>Approval needed over ($, 0 = never)</span>
          <input className="dg-input" type="number" min={0} step={1} defaultValue={r.approval_over_cents / 100} onBlur={(e) => void rule('approval_over_cents', Math.round(Number(e.target.value || 0) * 100))} /></label>
        <label className="dg-field"><span>Standing PO number (optional)</span>
          <input className="dg-input" defaultValue={r.default_po ?? ''} maxLength={40} onBlur={(e) => void rule('default_po', e.target.value.trim() || null)} /></label>
        <label className="dg-field" style={{ gridColumn: '1 / -1' }}><span>Who can book for others</span>
          <select className="dg-select" value={r.book_for_others} onChange={(e) => void rule('book_for_others', e.target.value)}>
            <option value="everyone">Everyone on the account</option><option value="approvers">Approvers and managers</option><option value="nobody">Managers only</option>
          </select></label>
      </div>

      <h2 className="section__title">People</h2>
      <ul className="list">
        {d.members.map((x: any) => (
          <li key={x.id} className="row"><span className="row__main"><strong>{x.name}</strong><span className="dg-muted">{ROLE[x.role] ?? x.role}, mobile …{String(x.phone).slice(-3)}</span></span>
            <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => { if (confirm(`Take ${x.name} off the account?`)) void run(() => del(`/business/accounts/${accountId}/members/${x.id}`), 'Removed'); }}>Remove</button></li>
        ))}
      </ul>
      <form className="block" onSubmit={async (e) => { e.preventDefault(); if (await run(() => post(`/business/accounts/${accountId}/members`, m), 'Added. We texted them.')) setM({ name: '', phone: '', role: 'member' }); }}>
        <div className="grid2">
          <label className="dg-field"><span>Name</span><input className="dg-input" value={m.name} maxLength={80} onChange={(e) => setM({ ...m, name: e.target.value })} required /></label>
          <label className="dg-field"><span>Mobile</span><input className="dg-input" type="tel" value={m.phone} onChange={(e) => setM({ ...m, phone: e.target.value })} required /></label>
        </div>
        <label className="dg-field"><span>Role</span>
          <select className="dg-select" value={m.role} onChange={(e) => setM({ ...m, role: e.target.value })}>
            <option value="member">Member: books trips</option><option value="approver">Approver: also approves trips and sees spend and invoices</option><option value="manager">Manager: also changes set-up</option>
          </select></label>
        <button className="dg-btn dg-btn--block">Add person</button>
      </form>

      <h2 className="section__title">Cost centres</h2>
      <ul className="list">
        {d.cost_centres.map((c: any) => (
          <li key={c.id} className="row"><span className="row__main"><strong>{c.code} {c.name}</strong>
            <span className="dg-muted">{c.approver_name ? `Approver ${c.approver_name}` : 'Account approvers'}{c.monthly_budget_cents ? `, budget ${money(c.monthly_budget_cents)} a month` : ''}{c.active ? '' : ', not in use'}</span></span>
            <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => void run(() => patch(`/business/accounts/${accountId}/cost-centres/${c.id}`, { active: !c.active }), 'Saved')}>{c.active ? 'Stop using' : 'Use again'}</button></li>
        ))}
      </ul>
      <form className="block" onSubmit={async (e) => {
        e.preventDefault();
        if (await run(() => post(`/business/accounts/${accountId}/cost-centres`, { code: cc.code.trim(), name: cc.name.trim(), approver_id: cc.approver_id || null,
          monthly_budget_cents: cc.budget ? Math.round(Number(cc.budget) * 100) : null }), 'Cost centre added')) setCc({ code: '', name: '', approver_id: '', budget: '' });
      }}>
        <div className="grid2">
          <label className="dg-field"><span>Code</span><input className="dg-input" value={cc.code} maxLength={20} onChange={(e) => setCc({ ...cc, code: e.target.value })} required placeholder="e.g. RENAL" /></label>
          <label className="dg-field"><span>Name</span><input className="dg-input" value={cc.name} maxLength={80} onChange={(e) => setCc({ ...cc, name: e.target.value })} required /></label>
          <label className="dg-field"><span>Approver (optional)</span>
            <select className="dg-select" value={cc.approver_id} onChange={(e) => setCc({ ...cc, approver_id: e.target.value })}>
              <option value="">Account approvers</option>{d.members.map((x: any) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select></label>
          <label className="dg-field"><span>Monthly budget $ (optional)</span><input className="dg-input" type="number" min={0} value={cc.budget} onChange={(e) => setCc({ ...cc, budget: e.target.value })} /></label>
        </div>
        <button className="dg-btn dg-btn--block">Add cost centre</button>
      </form>

      <h2 className="section__title">Trip purposes</h2>
      <ul className="list">
        {d.purposes.map((x: any) => (
          <li key={x.id} className="row"><span className="row__main"><strong>{x.label}</strong><span className="dg-muted">{x.code}{x.active ? '' : ', not in use'}</span></span>
            <button className="dg-btn dg-btn--sm dg-btn--ghost" onClick={() => void run(() => patch(`/business/accounts/${accountId}/purposes/${x.id}`, { active: !x.active }), 'Saved')}>{x.active ? 'Stop using' : 'Use again'}</button></li>
        ))}
      </ul>
      <form className="block" onSubmit={async (e) => { e.preventDefault(); if (await run(() => post(`/business/accounts/${accountId}/purposes`, { code: p.code.trim(), label: p.label.trim() }), 'Purpose added')) setP({ code: '', label: '' }); }}>
        <div className="grid2">
          <label className="dg-field"><span>Code</span><input className="dg-input" value={p.code} maxLength={20} onChange={(e) => setP({ ...p, code: e.target.value })} required placeholder="e.g. DIAL" /></label>
          <label className="dg-field"><span>Label</span><input className="dg-input" value={p.label} maxLength={80} onChange={(e) => setP({ ...p, label: e.target.value })} required placeholder="e.g. Dialysis" /></label>
        </div>
        <button className="dg-btn dg-btn--block">Add purpose</button>
      </form>
    </section>
  );
}
