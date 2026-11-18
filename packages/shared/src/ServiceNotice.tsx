import type { ReactNode } from 'react';
import { Icon } from './Icon';
import { useServiceUp } from './hooks';

/** "Problem on our side" notice while the API can't reach its database. The live region is always there (empty when all is well)
 *  so the change is read out. `extra` adds an app-specific line (rider: emergency number; driver: taps are kept). */
export function ServiceNotice({ extra, className = '' }: { extra?: ReactNode; className?: string }) {
  const up = useServiceUp();
  return (
    <div role="status" className={`service-notice-live ${className}`}>
      {!up && (
        <p className="service-notice">
          <Icon name="alert" size={18} />
          <span><strong>DingoGo is having a problem on our side.</strong> We’re trying again; you don’t need to do anything.{extra ? <> {extra}</> : null}</span>
        </p>
      )}
    </div>
  );
}
