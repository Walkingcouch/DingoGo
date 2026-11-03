import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';

export function Page({ title, back, children, actions }: { title: string; back?: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="page">
      <header className="page__head">
        {back && <Link to={back} className="iconbtn" aria-label="Back"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round"><path d="M15 5l-7 7 7 7" /></svg></Link>}
        <h1>{title}</h1>
        <div style={{ marginLeft: 'auto' }}>{actions}</div>
      </header>
      {children}
    </div>
  );
}

export function Section({ title, children, hint }: { title?: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <section className="section">
      {title && <h2 className="section__title">{title}</h2>}
      {hint && <p className="dg-muted section__hint">{hint}</p>}
      {children}
    </section>
  );
}

export function Stars({ value, onChange, size = 40 }: { value: number; onChange?: (n: number) => void; size?: number }) {
  return (
    <div className="stars" role={onChange ? 'radiogroup' : undefined} aria-label="Rating">
      {[1, 2, 3, 4, 5].map((n) => (
        <button key={n} type="button" disabled={!onChange} role={onChange ? 'radio' : undefined} aria-checked={value === n} aria-label={`${n} star${n > 1 ? 's' : ''}`}
          onClick={() => onChange?.(n)} className={`stars__s ${n <= value ? 'is-on' : ''}`} style={{ width: size, height: size }}>
          <svg viewBox="0 0 24 24" width={size * 0.8} height={size * 0.8}><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z" /></svg>
        </button>
      ))}
    </div>
  );
}

export function Spinner({ label = 'Loading' }: { label?: string }) {
  return <div className="spinner" role="status"><span className="spinner__dot" /><span>{label}…</span></div>;
}

/** Simple modal dialog with focus on open. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="dialog" role="dialog" aria-modal="true" aria-label={title} onClick={onClose}>
      <div className="dialog__box" onClick={(e) => e.stopPropagation()}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

export function useCopy() {
  const [copied, setCopied] = useState(false);
  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ }
    setCopied(true); setTimeout(() => setCopied(false), 2000);
  };
  return { copy, copied };
}

/** Use the native share sheet where available, else copy. */
export async function shareOrCopy(data: { title: string; text: string; url?: string }, copy: (s: string) => Promise<void>) {
  if (navigator.share) { try { await navigator.share(data); return 'shared'; } catch { /* cancelled */ } }
  await copy(data.url ? `${data.text} ${data.url}` : data.text);
  return 'copied';
}
