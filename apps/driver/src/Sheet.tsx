import { useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useModal } from '@dingogo/shared';

/** Bottom sheet dialog: over an inert app, focus inside, Tab wraps, Escape and a tap outside close it, focus goes back after. */
export function Sheet({ onClose, labelledBy, children, role = 'dialog' }: { onClose: () => void; labelledBy: string; children: ReactNode; role?: 'dialog' | 'alertdialog' }) {
  const box = useRef<HTMLDivElement>(null);
  useModal(box, onClose);
  return createPortal(
    <div className="overlay" data-modal-open onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" role={role} aria-modal="true" aria-labelledby={labelledBy} tabIndex={-1} ref={box}>{children}</div>
    </div>,
    document.body,
  );
}
