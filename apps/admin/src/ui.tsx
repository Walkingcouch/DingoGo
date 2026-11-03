import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, del, get, money, patch, post, date, dateTime, useLoad } from '@dingogo/shared';

// ───────────── Toasts ─────────────
const ToastCtx = createContext<(msg: string, err?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastCtx);
export function ToastProvider({ children }: { children: ReactNode }) {
  const [t, setT] = useState<{ msg: string; err?: boolean } | null>(null);
  useEffect(() => { if (!t) return; const id = setTimeout(() => setT(null), 3200); return () => clearTimeout(id); }, [t]);
  return (
    <ToastCtx.Provider value={(msg, err) => setT({ msg, err })}>
      {children}
      {t && <div className={'toast' + (t.err ? ' err' : '')} role="status">{t.msg}</div>}
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

export function Tabs<T extends string>({ tabs, value, onChange }: { tabs: [T, string][]; value: T; onChange: (t: T) => void }) {
  return (
    <div className="tabs" role="tablist">
      {tabs.map(([k, l]) => <button key={k} role="tab" aria-selected={value === k} className={value === k ? 'on' : ''} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  );
}

export function Drawer({ title, onClose, children, actions }: { title: ReactNode; onClose: () => void; children: ReactNode; actions?: ReactNode }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', h); return () => removeEventListener('keydown', h); }, [onClose]);
  return (<>
    <div className="scrim" onClick={onClose} />
    <aside className="drawer" role="dialog" aria-modal="true">
      <div className="drawer__head"><h2>{title}</h2>{actions}<button className="x" onClick={onClose} aria-label="Close">×</button></div>
      <div className="drawer__body">{children}</div>
    </aside>
  </>);
}

export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const h = (e: KeyboardEvent) => e.key === 'Escape' && onClose(); addEventListener('keydown', h); return () => removeEventListener('keydown', h); }, [onClose]);
  return (<>
    <div className="scrim" onClick={onClose} />
    <div className="modal" role="dialog" aria-modal="true">
      <div style={{ display: 'flex', alignItems: 'center' }}><h2 style={{ flex: 1, margin: 0, fontSize: 'var(--fs-xl)' }}>{title}</h2><button className="x" onClick={onClose} aria-label="Close">×</button></div>
      <div style={{ marginTop: 12 }}>{children}</div>
    </div>
  </>);
}

export const Loading = () => <p className="dg-muted">Loading…</p>;
export const ErrorMsg = ({ error }: { error: string | null }) => (error ? <p className="dg-error" role="alert">{error}</p> : null);

export function Chip({ tone, children }: { tone?: string; children: ReactNode }) {
  return <span className={'dg-chip' + (tone ? ` dg-chip--${tone}` : '')}>{children}</span>;
}

// ───────────── Table ─────────────
export type Col<T> = { key: string; label: string; num?: boolean; render?: (r: T) => ReactNode; csv?: (r: T) => unknown; nowrap?: boolean };

export function Table<T extends Record<string, any>>({ rows, cols, onRow, empty = 'Nothing here yet.', rowKey }: {
  rows: T[] | null | undefined; cols: Col<T>[]; onRow?: (r: T) => void; empty?: string; rowKey?: (r: T) => string;
}) {
  return (
    <div className="tbl-wrap">
      <table className="tbl">
        <thead><tr>{cols.map((c) => <th key={c.key} className={c.num ? 'num' : ''} scope="col">{c.label}</th>)}</tr></thead>
        <tbody>
          {!rows?.length && <tr><td className="empty" colSpan={cols.length}>{rows ? empty : 'Loading…'}</td></tr>}
          {rows?.map((r, i) => (
            <tr key={rowKey ? rowKey(r) : r.id ?? i} className={onRow ? 'click' : ''} onClick={onRow ? () => onRow(r) : undefined}
              tabIndex={onRow ? 0 : undefined} onKeyDown={onRow ? (e) => e.key === 'Enter' && onRow(r) : undefined}>
              {cols.map((c) => <td key={c.key} className={(c.num ? 'num' : '') + (c.nowrap ? ' nowrap' : '')}>{c.render ? c.render(r) : fmt(r[c.key])}</td>)}
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
export function CrudSection<T extends Record<string, any>>({ title, path, cols, fields, pk = 'id', newLabel, preview, filter, right, describe }: {
  title: string; path: string; cols: Col<T>[]; fields: Field[]; pk?: string; newLabel?: string;
  preview?: (form: Record<string, any>) => ReactNode; filter?: (r: T) => boolean; right?: ReactNode; describe?: ReactNode;
}) {
  const { data, error, reload } = useLoad(() => get<{ items: T[] }>(`/admin/${path}`), [path]);
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
      setEditing(null); void reload();
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
export function Bars({ data, value, label, format = (v) => String(v), color = 'var(--ochre)' }: {
  data: any[]; value: (d: any) => number; label: (d: any) => string; format?: (v: number) => string; color?: string;
}) {
  const max = Math.max(1, ...data.map(value));
  const w = 100 / Math.max(1, data.length);
  return (
    <figure style={{ margin: 0 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '.78rem', color: 'var(--muted)' }}><span>Peak {format(max)}</span></div>
      <svg className="bars" viewBox="0 0 100 50" preserveAspectRatio="none" role="img" aria-label={`Bar chart, peak ${format(max)}`}>
        <line x1="0" x2="100" y1="49.8" y2="49.8" stroke="var(--line)" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
        {data.map((d, i) => {
          const h = (value(d) / max) * 48;
          return <rect key={i} x={i * w + w * 0.15} y={50 - h} width={w * 0.7} height={Math.max(h, 0.3)} fill={color}><title>{`${label(d)}: ${format(value(d))}`}</title></rect>;
        })}
      </svg>
      <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.length}, 1fr)`, fontSize: '.72rem', color: 'var(--muted)', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>
        {data.map((d, i) => <span key={i}>{i % 2 === 0 || i === data.length - 1 ? label(d) : ''}</span>)}
      </div>
    </figure>
  );
}

export { money, date, dateTime, del };
export const dollars = (c?: number | null) => money(c);
