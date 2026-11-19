import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { SharedTrack } from '@dingogo/shared/track';
import { useMeta } from '../meta';

/** /track/<token>: live tracking of a shared trip or parcel (the component is shared with the rider app since Round 21). */
export default function Track() {
  const { token = '' } = useParams();
  const [ref, setRef] = useState<string | null>(null);
  useMeta(ref ? `Trip ${ref}` : 'Track a trip', 'Live DingoGo trip tracking.', { noindex: true });
  return <SharedTrack token={token} className="dg-track--site" onLoaded={setRef}
    renderLink={(href, label, className) => <Link to={href} className={className}>{label}</Link>} />;
}
