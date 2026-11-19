import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { get, tripLinkQuery } from '@dingogo/shared';
import { RIDER_URL } from '../Estimator';
import { PageHead } from '../Layout';
import { track } from '../analytics';
import { useMeta } from '../meta';

/** /invite/CODE — a friend's invite link. Checks the code (nothing about the friend is shown) and takes it into the app's sign-up. */
export default function Invite() {
  const { code = '' } = useParams();
  useMeta('You’re invited to DingoGo', 'A friend invited you to DingoGo. Sign up with their code and you both get Dingo Points after your first trip.', { noindex: true });
  const [r, setR] = useState<{ valid: boolean; code: string | null; bonus_points: number } | null>(null);
  useEffect(() => {
    get<typeof r>(`/public/referrals/${encodeURIComponent(code)}`).then((x) => { setR(x); track('Invite opened', { valid: String(!!x?.valid) }); })
      .catch(() => setR({ valid: false, code: null, bonus_points: 500 }));
  }, [code]);
  const href = RIDER_URL + (r?.valid && r.code ? tripLinkQuery({ ref: r.code }) : '');
  return (
    <>
      <PageHead tone="dawn" title="A friend invited you to DingoGo">Local rides and deliveries in Alice Springs, Aboriginal-owned and going electric.</PageHead>
      <section className="section">
        <div className="wrap prose" style={{ maxWidth: 720 }}>
          {!r ? <p className="dg-muted">Checking the invite…</p> : r.valid ? (
            <>
              <p>Sign up with code <b>{r.code}</b> and once you've taken your first trip, you and your friend both get <b>{r.bonus_points} Dingo Points</b>. That's ${r.bonus_points / 100} off a ride, or over halfway to a free coffee at a partner café.</p>
              <p><a className="dg-btn" href={href}>Sign up with this code</a></p>
              <p className="dg-muted">The code is filled in for you. On the Android app or by phone, type it in when you sign up.</p>
            </>
          ) : (
            <>
              <p>That invite code didn't work. It may have been typed wrong. You can still sign up, and ask your friend for their code from the Rewards tab.</p>
              <p><a className="dg-btn" href={RIDER_URL}>Sign up</a></p>
            </>
          )}
          <p><Link to="/rewards#refer">How rewards work</Link></p>
        </div>
      </section>
    </>
  );
}
