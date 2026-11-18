/**
 * Trip chat between rider and driver (and DingoGo), shared by both apps. Polling-friendly for the serverless API: every 4 s while
 * the chat is open, every 15 s for the unread badge while it is closed; `refresh()` can be called on a realtime `message.new`.
 * Sends carry a client id, so a send retried after a lost reply is stored once.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ApiError, api, post } from './api';
import { Icon } from './Icon';

export interface ChatMessage { id: number; from: 'rider' | 'driver' | 'dingogo'; mine: boolean; body: string; via: 'app' | 'sms'; created_at: string; read_at: string | null;
  pending?: boolean; failed?: boolean; client_id?: string }
interface ChatState { messages: ChatMessage[]; unread: number; canSend: boolean; quick: { key: string; text: string }[]; available: boolean; closesAt: string | null }

const cid = () => `c${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;

export function useTripChat(tripId: string | null | undefined, open: boolean) {
  const [s, setS] = useState<ChatState>({ messages: [], unread: 0, canSend: false, quick: [], available: true, closesAt: null });
  const last = useRef(0);
  const busy = useRef(false);
  useEffect(() => { last.current = 0; setS({ messages: [], unread: 0, canSend: false, quick: [], available: true, closesAt: null }); }, [tripId]);

  const refresh = useCallback(async (peek = !open) => {
    if (!tripId || busy.current) return;
    busy.current = true;
    try {
      const r = await api<any>('GET', `/trips/${tripId}/messages?after=${last.current}${peek ? '&peek=1' : ''}`, undefined, { timeoutMs: 10000 });
      setS((prev) => {
        let msgs = prev.messages;
        if (r.messages.length) {
          const known = new Set(msgs.filter((m) => !m.pending).map((m) => m.id));
          const fresh = (r.messages as ChatMessage[]).filter((m) => !known.has(m.id));
          // A message we sent shows up from the server: drop its optimistic copy.
          msgs = [...msgs.filter((m) => !(m.pending && fresh.some((f) => f.mine && f.body === m.body))), ...fresh];
          last.current = Math.max(last.current, ...r.messages.map((m: ChatMessage) => m.id));
        }
        // Read receipts change on earlier messages: re-fetch them all when open (cheap: a trip chat is short).
        return { messages: msgs, unread: peek ? r.unread : 0, canSend: r.can_send, quick: r.quick_replies ?? [], available: true, closesAt: r.closes_at ?? null };
      });
    } catch (e) {
      if (e instanceof ApiError && (e.code === 'migration_pending' || e.status === 404)) setS((p) => ({ ...p, available: false }));
    } finally { busy.current = false; }
  }, [tripId, open]);

  // Read receipts: while open, re-read the whole thread now and then (ids don't change, read_at does).
  const full = useCallback(async () => {
    if (!tripId) return;
    try {
      const r = await api<any>('GET', `/trips/${tripId}/messages`, undefined, { timeoutMs: 10000 });
      last.current = Math.max(0, ...r.messages.map((m: ChatMessage) => m.id));
      setS((p) => ({ ...p, messages: [...r.messages, ...p.messages.filter((m) => m.pending || m.failed)], unread: 0, canSend: r.can_send, quick: r.quick_replies ?? [], closesAt: r.closes_at ?? null }));
    } catch { /* keep what we have */ }
  }, [tripId]);

  useEffect(() => {
    if (!tripId) return;
    if (open) void full(); else void refresh(true);
    const t = setInterval(() => void (open ? refresh(false) : refresh(true)), open ? 4000 : 15000);
    const r = open ? setInterval(() => void full(), 20000) : undefined;
    return () => { clearInterval(t); if (r) clearInterval(r); };
  }, [tripId, open, refresh, full]);

  const send = useCallback(async (input: { body?: string; quick?: string; text?: string }, retryId?: string) => {
    if (!tripId) return;
    const client_id = retryId ?? cid();
    const text = input.text ?? input.body ?? '';
    setS((p) => ({ ...p, messages: [...p.messages.filter((m) => m.client_id !== client_id),
      { id: -Date.now(), from: 'rider', mine: true, body: text, via: 'app', created_at: new Date().toISOString(), read_at: null, pending: true, client_id }] }));
    try {
      const r = await post<any>(`/trips/${tripId}/messages`, { ...(input.quick ? { quick: input.quick } : { body: input.body }), client_id });
      setS((p) => ({ ...p, messages: p.messages.some((m) => m.id === r.message.id)
        ? p.messages.filter((m) => m.client_id !== client_id)
        : p.messages.map((m) => (m.client_id === client_id ? r.message : m)) }));
      last.current = Math.max(last.current, r.message.id);
      return true;
    } catch (e) {
      setS((p) => ({ ...p, messages: p.messages.map((m) => (m.client_id === client_id ? { ...m, pending: false, failed: true, body: text, quick: input.quick } as any : m)) }));
      if (e instanceof ApiError && e.code === 'chat_closed') void full();
      return e instanceof ApiError ? e.message : 'Not sent';
    }
  }, [tripId, full]);

  return { ...s, refresh: () => refresh(), send };
}

const time = (iso: string) => new Date(iso).toLocaleTimeString('en-AU', { hour: 'numeric', minute: '2-digit' });

/** The thread, quick replies and the message box. Put it inside the app's own dialog/sheet. */
export function ChatThread({ chat, otherLabel, hint }: { chat: ReturnType<typeof useTripChat>; otherLabel: string; hint?: string }) {
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const list = useRef<HTMLDivElement>(null);
  useEffect(() => { list.current?.scrollTo({ top: list.current.scrollHeight }); }, [chat.messages.length]);
  const lastMineRead = [...chat.messages].reverse().find((m) => m.mine && !m.pending && !m.failed);
  const go = async (input: { body?: string; quick?: string; text?: string }, retry?: string) => {
    setErr(null);
    const r = await chat.send(input, retry);
    if (r !== true && r) setErr(r);
    return r === true;
  };
  if (!chat.available) return <p className="dg-chat-note">Messages aren't available right now. Call DingoGo if you need help.</p>;
  return (
    <div className="dg-chat">
      {hint && <p className="dg-chat-note">{hint}</p>}
      <div className="dg-chat-list" ref={list} role="log" aria-live="polite" aria-label="Messages" tabIndex={0}><ol>
        {!chat.messages.length && <li className="dg-chat-empty">No messages yet. Use a quick reply or type below.</li>}
        {chat.messages.map((m) => (
          <li key={m.client_id ?? m.id} className={`dg-chat-msg ${m.mine ? 'is-mine' : m.from === 'dingogo' ? 'is-dingogo' : 'is-other'}`}>
            <span className="dg-chat-who">{m.mine ? 'You' : m.from === 'dingogo' ? 'DingoGo' : otherLabel}</span>
            <span className="dg-chat-body">{m.body}</span>
            <span className="dg-chat-meta">
              {m.pending ? 'Sending…' : m.failed ? (
                <button type="button" className="dg-chat-retry" onClick={() => void go({ body: (m as any).quick ? undefined : m.body, quick: (m as any).quick, text: m.body }, m.client_id)}>
                  Not sent. Try again
                </button>
              ) : <>{time(m.created_at)}{m.via === 'sms' ? ' · by text' : ''}{m === lastMineRead && m.read_at ? ' · Read' : ''}</>}
            </span>
          </li>
        ))}
      </ol></div>
      {chat.canSend ? (
        <>
          {chat.quick.length > 0 && (
            <div className="dg-chat-quick" role="group" aria-label="Quick replies">
              {chat.quick.map((q) => <button key={q.key} type="button" className="dg-chat-chip" onClick={() => void go({ quick: q.key, text: q.text })}>{q.text}</button>)}
            </div>
          )}
          <form className="dg-chat-form" onSubmit={async (e) => { e.preventDefault(); const t = text.trim(); if (!t) return; if (await go({ body: t })) setText(''); }}>
            <label className="sr-only" htmlFor="dg-chat-input">Message to {otherLabel.toLowerCase()}</label>
            <textarea id="dg-chat-input" className="dg-textarea" rows={2} maxLength={500} value={text} onChange={(e) => setText(e.target.value)}
              placeholder="Type a message" onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }} />
            <button className="dg-btn" type="submit" aria-label="Send"><Icon name="chat" size={20} />Send</button>
          </form>
          {err && <p className="dg-field-error" role="alert"><Icon name="alert" size={16} />{err}</p>}
          {chat.closesAt && <p className="dg-chat-note">Messages close at {time(chat.closesAt)}.</p>}
        </>
      ) : <p className="dg-chat-note">Messages are closed for this trip. For anything else, use Help.</p>}
    </div>
  );
}
