import { useState } from 'react';
import { ApiError, post } from '@dingogo/shared';

/** Generic form submit helper for the public enquiry endpoints. */
export function useSubmit(path: string) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  async function submit(body: Record<string, unknown>) {
    setBusy(true); setError(null);
    try { await post(path, body); setDone(true); }
    catch (e) { setError(e instanceof ApiError ? e.message.replace(/^\w+: /, '') : 'Could not send. Check your connection and try again.'); }
    finally { setBusy(false); }
  }
  return { busy, error, done, submit, reset: () => setDone(false) };
}

/** Read a <form> into a plain object, coercing number/checkbox inputs and dropping empty strings. */
export function formData(e: React.FormEvent<HTMLFormElement>) {
  e.preventDefault();
  const out: Record<string, unknown> = {};
  for (const el of Array.from(e.currentTarget.elements) as HTMLInputElement[]) {
    if (!el.name) continue;
    if (el.type === 'checkbox') out[el.name] = el.checked;
    else if (el.type === 'number') { if (el.value !== '') out[el.name] = Number(el.value); }
    else if (el.value.trim() !== '') out[el.name] = el.value.trim();
  }
  return out;
}

export function Field({ label, name, type = 'text', required, hint, full, ...rest }: { label: string; name: string; type?: string; required?: boolean; hint?: string; full?: boolean } & React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <label className={`dg-field${full ? ' full' : ''}`}>
      <span>{label}{!required && <span className="dg-muted" style={{ fontWeight: 400 }}> (optional)</span>}</span>
      <input className="dg-input" name={name} type={type} required={required} {...rest} />
      {hint && <small className="dg-muted">{hint}</small>}
    </label>
  );
}
export function Area({ label, name, required, rows = 4, full = true, placeholder }: { label: string; name: string; required?: boolean; rows?: number; full?: boolean; placeholder?: string }) {
  return (
    <label className={`dg-field${full ? ' full' : ''}`}>
      <span>{label}{!required && <span className="dg-muted" style={{ fontWeight: 400 }}> (optional)</span>}</span>
      <textarea className="dg-textarea" name={name} rows={rows} required={required} placeholder={placeholder} />
    </label>
  );
}
export function Sent({ title, children, onAgain }: { title: string; children: React.ReactNode; onAgain?: () => void }) {
  return (
    <div className="ok-msg" role="status">
      <strong>{title}</strong>
      <p style={{ margin: '.3rem 0 0' }}>{children}</p>
      {onAgain && <button className="dg-btn dg-btn--ghost dg-btn--sm" style={{ marginTop: 10 }} onClick={onAgain}>Send another</button>}
    </div>
  );
}
