import { useEffect, useRef } from 'react';
import { Icon, type IconName } from './Icon';
import type { Disclosure } from './permissions';

/**
 * Round 21: the screen shown before the phone asks for a permission (Google Play's prominent disclosure): what is collected,
 * what for, when, and who sees it, with Continue / Not now. Full screen, focus on the heading, Escape = Not now.
 */
export function PermissionPrimer({ d, icon, busy, onAccept, onDecline }: {
  d: Disclosure; icon: IconName; busy?: boolean; onAccept: () => void; onDecline: () => void;
}) {
  const h = useRef<HTMLHeadingElement>(null);
  useEffect(() => { h.current?.focus(); }, [d.kind]);
  return (
    <div className="dg-primer" role="dialog" aria-modal="true" aria-labelledby="dg-primer-h" aria-describedby="dg-primer-lead"
      onKeyDown={(e) => { if (e.key === 'Escape' && !busy) onDecline(); }}>
      <div className="dg-primer__box">
        <span className="dg-primer__icon" aria-hidden="true"><Icon name={icon} size={34} /></span>
        <h1 id="dg-primer-h" ref={h} tabIndex={-1}>{d.title}</h1>
        <p id="dg-primer-lead" className="dg-primer__lead">{d.lead}</p>
        <ul className="dg-primer__points">{d.points.map((p) => <li key={p}><Icon name="check" size={18} />{p}</li>)}</ul>
        {d.notes.map((n) => <p key={n} className="dg-primer__note">{n}</p>)}
        <div className="dg-primer__actions">
          <button type="button" className="dg-btn dg-btn--block" onClick={onAccept} disabled={busy}>{busy ? 'One moment…' : d.accept}</button>
          <button type="button" className="dg-btn dg-btn--ghost dg-btn--block" onClick={onDecline} disabled={busy}>{d.decline}</button>
        </div>
      </div>
    </div>
  );
}
