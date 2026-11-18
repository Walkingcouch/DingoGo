import { Link } from 'react-router-dom';
import { Icon, date } from '@dingogo/shared';
import { useDriver } from '../state';

export interface Expiring { key: string; label: string; expires_on: string; days_left: number; level: 'expired' | 'urgent' | 'soon' | 'upcoming'; replacement_pending: boolean; vehicle_id?: string }

export const whenText = (e: Expiring) =>
  e.days_left < 0 ? 'expired' : e.days_left === 0 ? 'expires today' : `expires in ${e.days_left} day${e.days_left === 1 ? '' : 's'}`;
/** Driver papers are updated in Setup; car papers from the car in Profile. */
const fixAt = (e: Expiring) => (e.vehicle_id ? '/profile' : '/setup');

/** Drive screen: the paper that runs out soonest (within 30 days), with a way to fix it. */
export function ExpiryBanner() {
  const { me } = useDriver();
  const list: Expiring[] = (me?.expiring ?? []).filter((e: Expiring) => !e.replacement_pending);
  if (!list.length) return null;
  const e = list[0];
  const more = list.length - 1;
  return (
    <div className={`expiry-banner expiry-${e.level}`} role="status">
      <Icon name={e.level === 'upcoming' ? 'calendar' : 'alert'} size={22} />
      <p><strong>{e.label} {whenText(e)}</strong>{more > 0 && <span>{` and ${more} more paper${more > 1 ? 's' : ''} soon`}</span>}</p>
      <Link className="dg-btn dg-btn--sm" to={fixAt(e)}>Update</Link>
    </div>
  );
}

/** Profile: everything that runs out within 30 days. */
export function ExpiryList() {
  const { me } = useDriver();
  const list: Expiring[] = me?.expiring ?? [];
  if (!list.length) return null;
  return (
    <section className="panel" aria-labelledby="exp-h">
      <h2 id="exp-h" style={{ marginTop: 0 }}>Running out soon</h2>
      <p className="dg-muted" style={{ margin: '0 0 4px', fontSize: 'var(--fs-sm)' }}>We remind you 30, 14 and 3 days before. Upload the new one early: DingoGo checks it before the old one runs out.</p>
      <ul className="list">
        {list.map((e) => (
          <li key={e.key}>
            <div>
              <div>{e.label}</div>
              <div className="sub">{e.replacement_pending ? 'New one sent, DingoGo is checking it' : `${whenText(e)[0].toUpperCase()}${whenText(e).slice(1)} (${date(e.expires_on)})`}</div>
            </div>
            {e.replacement_pending
              ? <span className="dg-chip dg-chip--green">Sent</span>
              : <Link className={`dg-btn dg-btn--sm ${e.level === 'upcoming' ? 'dg-btn--ghost' : ''}`} to={fixAt(e)}>Update<span className="sr-only"> {e.label}</span></Link>}
          </li>
        ))}
      </ul>
    </section>
  );
}
