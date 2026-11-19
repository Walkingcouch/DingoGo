import { createContext, useContext, useEffect, useId, useMemo, useRef, useState, type ReactNode, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { ApiError, apiBase, del, get, getToken, money, patch, post, date, dateTime, useLoad, useModal, Icon } from '@dingogo/shared';

// ───────────── Toasts ─────────────
const ToastCtx = createContext<(msg: string, err?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; err?: boolean } | null>(null);
  useEffect(() => { if (!t) return; const id = setTimeout(() => setT(null), 3200); return () => clearTimeout(id); }, [t]);
  return (
    <ToastCtx.Provider value={(msg, err) => setT({ msg, err })}>
      {children}
      {/* Outside #root so it is still read out while a drawer or dialog makes the page inert. The region always exists. */}
      {createPortal(<div className="toast-region" aria-live={t?.err ? 'assertive' : 'polite'} aria-atomic="true">
        {t && <div className={'toast' + (t.err ? ' err' : '')}>{t.msg}</div>}
      </div>, document.body)}
    </ToastCtx.Provider>
  );
}

/** Run an API call, toast the result. Returns the response or undefined. */
export function useRun() {
  const toast = useToast();
  return async <T,>(fn: () => Promise<T>, ok?: string): Promise<T | undefined> => {
    try { const r = await fn(); if (ok) toast(ok); return r; }
    catch (e) { toast(e instanceof ApiError ? e.message : String(e), true); return undefined; }
  };
}

// ───────────── Layout bits ─────────────
export function Section({ title, children, right }: { title: string; children?: ReactNode; right?: ReactNode }) {
  return (<><div className="section"><h2>{title}</h2><span className="spacer" />{right}</div>{children}</>);
}

/** Tabs with the content of the chosen tab as children (rendered in its tab panel). Arrow keys, Home and End move between tabs. */
export function Tabs<T extends string>({ tabs, value, onChange, children, label }: { tabs: [T, string][]; value: T; onChange: (t: T) => void; children?: ReactNode; label?: string }) {
  const id = useId();
  const list = useRef<HTMLDivElement>(null);
  const key = (e: ReactKeyboardEvent) => {
    const i = tabs.findIndex(([k]) => k === value);
    const n = e.key === 'ArrowRight' ? i + 1 : e.key === 'ArrowLeft' ? i - 1 : e.key === 'Home' ? 0 : e.key === 'End' ? tabs.length - 1 : null;
    if (n == null) return;
    e.preventDefault();
    const next = tabs[(n + tabs.length) % tabs.length][0];
    onChange(next);
    requestAnimationFrame(() => list.current?.querySelector<HTMLElement>(`[data-tab="${next}"]`)?.focus());
  };
  return (<>
    <div className="tabs" role="tablist" aria-label={label} ref={list} onKeyDown={key}>
      {tabs.map(([k, l]) => <button key={k} type="button" role="tab" id={`${id}-tab-${k}`} data-tab={k} aria-selected={value === k} aria-controls={`${id}-panel`}
        tabIndex={value === k ? 0 : -1} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}
    </div>
    <div role="tabpanel" id={`${id}-panel`} aria-labelledby={`${id}-tab-${value}`}>{children}</div>
  </>);
}

/** Side drawer: a real modal (page behind inert, focus in and back, Tab wraps, Escape closes). */
export function Drawer({ title, onClose, children, actions }: { title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  const box = useRef<HTMLElement>(null);
  const id = useId();
  useModal(box, onClose);
  return createPortal(<div data-modal-open>
    <div className="scrim" onClick={onClose} />
    <aside className="drawer" role="dialog" aria-modal="true" aria-labelledby={id} tabIndex={-1} ref={box}>
      <div className="drawer__head"><h2 id={id}>{title}</h2>{actions}<button className="x" onClick={onClose} aria-label="Close"><Icon name="x" size={22} /></button></div>
      <div className="drawer__body">{children}</div>
    </aside>
  </div>, document.body);
}

export function Modal({ title, onClose, children, role = 'dialog' }: { title: string; onClose: () => void; children: ReactNode; role?: 'dialog' | 'alertdialog' }) {
  const box = useRef<HTMLDivElement>(null);
  const id = useId();
  useModal(box, onClose);
  return createPortal(<div data-modal-open>
    <div className="scrim" onClick={onClose} />
    <div className="modal" role={role} aria-modal="true" aria-labelledby={id} tabIndex={-1} ref={box}>
      <div style={{ display: 'flex', alignItems: 'center' }}><h2 id={id} style={{ flex: 1, margin: 0, fontSize: 'var(--fs-xl)' }}>{title}</h2><button className="x" onClick={onClose} aria-label="Close"><Icon name="x" size={22} /></button></div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  </div>, document.body);
}

type AskOpts = { title: string; label: string; help?: string; initial?: string; required?: boolean; multiline?: boolean; inputMode?: 'text' | 'decimal' | 'numeric'; ok?: string; danger?: boolean };
const AskCtx = createContext<(o: AskOpts) => Promise<string | null>>(async () => null);
/** `const ask = useAsk(); const reason = await ask({ title, label })` — an accessible replacement for window.prompt(). Null when cancelled. */
export const useAsk = () => useContext(AskCtx);
export function AskProvider({ children }: { children: ReactNode }) {
  const [req, setReq] = useState<(AskOpts & { resolve: (v: string | null) => void }) | null>(null);
  const [v, setV] = useState('');
  const [err, setErr] = useState(false);
  const fieldId = useId();
  const close = (out: string | null) => { req?.resolve(out); setReq(null); };
  return (
    <AskCtx.Provider value={(o) => new Promise((resolve) => { setV(o.initial ?? ''); setErr(false); setReq({ ...o, resolve }); })}>
      {children}
      {req && (
        <Modal title={req.title} onClose={() => close(null)}>
          <form onSubmit={(e) => { e.preventDefault(); if (req.required !== false && !v.trim()) { setErr(true); return; } close(v.trim()); }}>
            <label className="dg-field" htmlFor={fieldId}><span>{req.label}</span></label>
            {req.multiline
              ? <textarea id={fieldId} className="dg-textarea" value={v} onChange={(e) => setV(e.target.value)} data-autofocus aria-invalid={err || undefined} aria-describedby={err ? `${fieldId}-err` : req.help ? `${fieldId}-help` : undefined} />
              : <input id={fieldId} className="dg-input" value={v} onChange={(e) => setV(e.target.value)} inputMode={req.inputMode} data-autofocus aria-invalid={err || undefined} aria-describedby={err ? `${fieldId}-err` : req.help ? `${fieldId}-help` : undefined} />}
            {req.help && <small id={`${fieldId}-help`} className="dg-muted">{req.help}</small>}
            {err && <p id={`${fieldId}-err`} className="dg-error" role="alert">Fill this in to continue.</p>}
            <div className="actions"><button className={'dg-btn' + (req.danger ? ' dg-btn--danger' : '')}>{req.ok ?? 'Save'}</button>
              <button type="button" className="dg-btn dg-btn--ghost" onClick={() => close(null)}>Cancel</button></div>
          </form>
        </Modal>
      )}
    </AskCtx.Provider>
  );
}

/** Download a server-made CSV or PDF (signed-in request, so not a plain link); the file name comes from the server. */
export async function downloadCsv(path: string) {
  const r = await fetch(apiBase() + path, { headers: { authorization: `Bearer ${getToken()}` } });
  if (!r.ok) {
    const j = await r.json().catch(() => null);
    throw new ApiError(r.status, j?.error ?? 'export_failed', j?.message ?? 'Could not make the export');
  }
  const name = /filename="([^"]+)"/.exec(r.headers.get('content-disposition') ?? '')?.[1] ?? 'dingogo-export.csv';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(await r.blob());
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const downloadFile = downloadCsv;

export const Loading = () => <p className="dg-muted">Loading…</p>;
export const ErrorMsg = ({ error }: { error: string | null }) => (error ? <p className="dg-error" role="alert">{error}</p> : null);

export function Chip({ tone, children }: { tone?: string; children: ReactNode }) {
  return <span className={'dg-chip' + (tone ? ` dg-chip--${tone}` : '')}>{children}</span>;
}

/** Empty state for panels and lists: a sentence, not a blank. */
export function Empty({ children, icon = 'info' }: { children: ReactNode; icon?: string }) {
  return <p className="empty-note"><Icon name={icon} size={18} /> {children}</p>;
}

// ───────────── Table ─────────────
export type Col<T> = { key: string; label: string; num?: boolean; render?: (r: T) => ReactNode; csv?: (r: T) => unknown; nowrap?: boolean; truncate?: number; width?: number | string };

export function Table<T extends Record<string, any>>({ rows, cols, onRow, empty = 'Nothing here yet.', rowKey }: {
  rows: T[] | null | undefined; cols: Col<T>[]; onRow?: (r: T) => void; empty?: string; rowKey?: (r: T) => string;
}) {
  return (
    // Round 25: the wrapper scrolls (long lists, wide tables on a phone), so keyboard users can focus it to scroll when no row is focusable.
    <div className="tbl-wrap" tabIndex={onRow ? undefined : 0}>
      <table className="tbl">
        <thead><tr>{cols.map((c) => <th key={c.key} className={c.num ? 'num' : ''} scope="col" style={c.width ? { width: c.width } : undefined}>{c.label}</th>)}</tr></thead>
        <tbody>
          {!rows?.length && <tr><td className="empty" colSpan={cols.length}>{rows ? empty : 'Loading…'}</td></tr>}
          {rows?.map((r, i) => (
            <tr key={rowKey ? rowKey(r) : r.id ?? i} className={onRow ? 'click' : ''} onClick={onRow ? () => onRow(r) : undefined}
              tabIndex={onRow ? 0 : undefined} onKeyDown={onRow ? (e) => e.key === 'Enter' && onRow(r) : undefined}>
              {cols.map((c) => {
                const v = c.render ? c.render(r) : fmt(r[c.key]);
                const plain = typeof r[c.key] === 'string' ? r[c.key] : undefined;
                return <td key={c.key} className={(c.num ? 'num' : '') + (c.nowrap ? ' nowrap' : '')}>
                  {c.truncate ? <span className="trunc" style={{ maxWidth: c.truncate }} title={plain}>{v}</span> : v}</td>;
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function fmt(v: unknown): ReactNode {
  if (v == null || v === '') return <span className="dg-muted">—</span>;
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  if (Array.isArray(v)) return v.join(', ');
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

/** Download rows as CSV (client-side). */
export function exportCsv(filename: string, rows: Record<string, any>[], cols?: { key: string; label: string; csv?: (r: any) => unknown }[]) {
  const c: { key: string; label: string; csv?: (r: any) => unknown }[] = cols ?? Object.keys(rows[0] ?? {}).map((k) => ({ key: k, label: k }));
  const esc = (v: unknown) => { const s = v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  const csv = [c.map((x) => esc(x.label)).join(','), ...rows.map((r) => c.map((x) => esc(x.csv ? x.csv(r) : r[x.key])).join(','))].join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ───────────── Forms ─────────────
export type Field = {
  key: string; label: string;
  type?: 'text' | 'number' | 'money' | 'date' | 'datetime' | 'bool' | 'select' | 'textarea' | 'json' | 'array' | 'color' | 'email' | 'tel';
  options?: [string, string][]; full?: boolean; required?: boolean; help?: string; min?: number; max?: number; step?: number; readOnlyOnEdit?: boolean;
};

export function toForm(fields: Field[], row: Record<string, any> = {}) {
  const out: Record<string, any> = {};
  for (const f of fields) {
    const v = row[f.key];
    if (f.type === 'money') out[f.key] = v == null ? '' : (v / 100).toFixed(2);
    else if (f.type === 'bool') out[f.key] = !!v;
    else if (f.type === 'json') out[f.key] = v == null ? '' : JSON.stringify(v, null, 2);
    else if (f.type === 'array') out[f.key] = Array.isArray(v) ? v.join(', ') : '';
    else if (f.type === 'datetime') out[f.key] = v ? new Date(v).toISOString().slice(0, 16) : '';
    else if (f.type === 'date') out[f.key] = v ? String(v).slice(0, 10) : '';
    else out[f.key] = v ?? '';
  }
  return out;
}

export function fromForm(fields: Field[], form: Record<string, any>, editing = false) {
  const out: Record<string, any> = {};
  for (const f of fields) {
    if (editing && f.readOnlyOnEdit) continue;
    const v = form[f.key];
    if (f.type === 'bool') { out[f.key] = !!v; continue; }
    if (v === '' || v == null) { if (editing) out[f.key] = null; continue; }
    if (f.type === 'money') out[f.key] = Math.round(Number(v) * 100);
    else if (f.type === 'number') out[f.key] = Number(v);
    else if (f.type === 'json') out[f.key] = JSON.parse(v);
    else if (f.type === 'array') out[f.key] = String(v).split(',').map((s) => s.trim()).filter(Boolean);
    else if (f.type === 'datetime') out[f.key] = new Date(v).toISOString();
    else out[f.key] = v;
  }
  return out;
}

export function FormFields({ fields, form, setForm, editing }: { fields: Field[]; form: Record<string, any>; setForm: (f: Record<string, any>) => void; editing?: boolean }) {
  const set = (k: string, v: unknown) => setForm({ ...form, [k]: v });
  return (
    <div className="form-grid">
      {fields.map((f) => {
        const ro = editing && f.readOnlyOnEdit;
        const cls = f.full || f.type === 'textarea' || f.type === 'json' ? 'full' : '';
        if (f.type === 'bool') return (
          <label key={f.key} className={'dg-check ' + cls}><input type="checkbox" checked={!!form[f.key]} onChange={(e) => set(f.key, e.target.checked)} disabled={ro} /><span>{f.label}{f.help && <><br /><small className="dg-muted">{f.help}</small></>}</span></label>
        );
        return (
          <label key={f.key} className={'dg-field ' + cls}>
            <span>{f.label}{f.type === 'money' ? ' ($)' : ''}</span>
            {f.type === 'select' ? (
              <select className="dg-select" value={form[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} required={f.required} disabled={ro}>
                {!f.required && <option value="">—</option>}
                {f.options?.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            ) : f.type === 'textarea' || f.type === 'json' ? (
              <textarea className="dg-textarea" value={form[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} required={f.required} readOnly={ro}
                style={f.type === 'json' ? { fontFamily: 'ui-monospace, monospace', fontSize: '.85rem' } : undefined} />
            ) : (
              <input className="dg-input" value={form[f.key] ?? ''} onChange={(e) => set(f.key, e.target.value)} required={f.required} readOnly={ro}
                type={f.type === 'money' || f.type === 'number' ? 'number' : f.type === 'datetime' ? 'datetime-local' : f.type === 'array' ? 'text' : f.type ?? 'text'}
                step={f.type === 'money' ? '0.01' : f.step} min={f.min} max={f.max} />
            )}
            {f.help && <small className="dg-muted">{f.help}</small>}
          </label>
        );
      })}
    </div>
  );
}

/** List + create + edit for a /admin/<path> CRUD resource. */
export function CrudSection<T extends Record<string, any>>({ title, path, query, refresh, onSaved, cols, fields, pk = 'id', newLabel, preview, filter, right, describe }: {
  title: string; path: string; cols: Col<T>[]; fields: Field[]; pk?: string; newLabel?: string;
  /** Extra query string for the list request, e.g. "status=all". */ query?: string;
  /** Bump to reload the list after a change made elsewhere on the page. */ refresh?: number; onSaved?: () => void;
  preview?: (form: Record<string, any>) => ReactNode; filter?: (r: T) => boolean; right?: ReactNode; describe?: ReactNode;
}) {
  const { data, error, reload } = useLoad(() => get<{ items: T[] }>(`/admin/${path}${query ? `?${query}` : ''}`), [path, query, refresh]);
  const [editing, setEditing] = useState<T | 'new' | null>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const rows = useMemo(() => (filter ? data?.items.filter(filter) : data?.items), [data, filter]);

  const open = (r: T | 'new') => { setEditing(r); setForm(toForm(fields, r === 'new' ? {} : r)); setErr(null); };
  async function save(e: React.FormEvent) {
    e.preventDefault(); setBusy(true); setErr(null);
    try {
      const isNew = editing === 'new';
      const body = fromForm(fields, form, !isNew);
      if (isNew) await post(`/admin/${path}`, body);
      else await patch(`/admin/${path}/${encodeURIComponent((editing as T)[pk])}`, body);
      toast(isNew ? `${title.replace(/s$/, '')} created` : 'Changes saved');
      setEditing(null); void reload(); onSaved?.();
    } catch (ex) { setErr(ex instanceof ApiError ? ex.message : ex instanceof SyntaxError ? 'Check the JSON field' : String(ex)); }
    finally { setBusy(false); }
  }

  return (
    <>
      <Section title={title} right={<>{right}<button className="dg-btn dg-btn--sm dg-btn--dark" onClick={() => open('new')}>{newLabel ?? 'Add'}</button></>} />
      {describe}
      <ErrorMsg error={error} />
      <Table rows={rows} cols={cols} onRow={(r) => open(r)} rowKey={(r) => String(r[pk])} />
      {editing && (
        <Modal title={editing === 'new' ? (newLabel ?? `Add ${title.toLowerCase()}`) : `Edit ${title.replace(/s$/, '').toLowerCase()}`} onClose={() => setEditing(null)}>
          <form onSubmit={save}>
            {preview?.(form)}
            <FormFields fields={fields} form={form} setForm={setForm} editing={editing !== 'new'} />
            <ErrorMsg error={err} />
            <div className="actions"><button className="dg-btn" disabled={busy}>{busy ? 'Saving…' : editing === 'new' ? 'Create' : 'Save changes'}</button>
              <button type="button" className="dg-btn dg-btn--ghost" onClick={() => setEditing(null)}>Cancel</button></div>
          </form>
        </Modal>
      )}
    </>
  );
}

// ───────────── Charts ─────────────
/** Bar chart with a labelled value axis (0, half, peak) and dated x axis. */
export function Bars({ data, value, label, format = (v) => String(v), color = 'var(--ochre)', unit, empty }: {
  data: any[]; value: (d: any) => number; label: (d: any) => string; format?: (v: number) => string; color?: string; unit?: string; empty?: string;
}) {
  const raw = Math.max(0, ...data.map(value));
  const max = raw > 0 ? niceMax(raw) : 1;
  const w = 100 / Math.max(1, data.length);
  const ticks = [max, max / 2, 0];
  const step = data.length > 10 ? Math.max(3, Math.ceil(data.length / 7)) : 1;
  return (
    <figure className="chart">
      <div className="chart__plot">
        <div className="chart__y" aria-hidden="true">{ticks.map((t, i) => <span key={i}>{raw > 0 || t === 0 ? format(t) : ''}</span>)}</div>
        <div className="chart__area">
          <svg className="bars" viewBox="0 0 100 50" preserveAspectRatio="none" role="img"
            aria-label={`${unit ?? 'Value'} by day. ${raw > 0 ? `Highest ${format(raw)}.` : 'All zero.'}`}>
            {[0, 25].map((y) => <line key={y} x1="0" x2="100" y1={y + 0.2} y2={y + 0.2} stroke="var(--line)" strokeWidth="1" strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />)}
            <line x1="0" x2="100" y1="49.8" y2="49.8" stroke="var(--muted)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
            {data.map((d, i) => {
              const h = (value(d) / max) * 49.5;
              return value(d) > 0 ? <rect key={i} x={i * w + w * 0.18} y={49.8 - h} width={w * 0.64} height={h} fill={color} rx="0.6"><title>{`${label(d)}: ${format(value(d))}`}</title></rect> : null;
            })}
          </svg>
          {raw === 0 && empty && <p className="chart__empty"><span className="chart__empty-msg">{empty}</span></p>}
        </div>
      </div>
      <div className="chart__x" style={{ gridTemplateColumns: `repeat(${data.length}, 1fr)` }} aria-hidden="true">
        {data.map((d, i) => <span key={i}>{(data.length - 1 - i) % step === 0 ? label(d) : ''}</span>)}
      </div>
    </figure>
  );
}

function niceMax(v: number) {
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p;
}

export { money, date, dateTime, del };
export const dollars = (c?: number | null) => money(c);
