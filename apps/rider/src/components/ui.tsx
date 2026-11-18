import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
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

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Modal dialog: rendered over the app with the rest of the page made inert, focus moved inside (and kept there while the content
 *  changes, e.g. SOS "sending" → "sent"), Tab wraps within it, Escape closes, and focus goes back to whatever opened it. */
export function Dialog({ open, onClose, title, children }: { open: boolean; onClose: () => void; title: string; children: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const opener = document.activeElement as HTMLElement | null;
    const root = document.getElementById('root');
    root?.setAttribute('inert', ''); root?.setAttribute('aria-hidden', 'true');
    const k = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); closeRef.current(); return; }
      if (e.key !== 'Tab' || !box.current) return;
      const els = Array.from(box.current.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (!els.length) { e.preventDefault(); box.current.focus(); return; }
      const first = els[0], last = els[els.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === box.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    window.addEventListener('keydown', k);
    return () => {
      window.removeEventListener('keydown', k);
      root?.removeAttribute('inert'); root?.removeAttribute('aria-hidden');
      if (opener && document.contains(opener)) opener.focus();
    };
  }, [open]);
  // After every render: if focus has fallen out of the dialog (first open, or the button that had it was replaced), bring it back.
  useEffect(() => {
    if (!open || !box.current || box.current.contains(document.activeElement)) return;
    (box.current.querySelector<HTMLElement>(FOCUSABLE) ?? box.current).focus();
  });
  if (!open) return null;
  return createPortal(
    <div className="dialog" onClick={onClose}>
      <div className="dialog__box" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} ref={box} onClick={(e) => e.stopPropagation()}>
        <h2 id={titleId}>{title}</h2>
        {children}
      </div>
    </div>,
    document.body,
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
