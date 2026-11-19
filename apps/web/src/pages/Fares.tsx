import { useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { parseTripLink } from '@dingogo/shared';
import { Estimator, linkPlace } from '../Estimator';
import { PageHead } from '../Layout';
import { rule, useConfig } from '../config';
import { useMeta } from '../meta';
import { FareTable } from './Rides';

/** /fares?from=lat,lng,Name&to=…&service=… — the estimator as a page you can share; the address bar follows the trip. */
export default function Fares() {
  useMeta();
  const loc = useLocation();
  const cfg = useConfig();
  const link = useMemo(() => parseTripLink(loc.search), []); // eslint-disable-line
  return (
    <>
      <PageHead title="Check a fare">Pick where you're going and see the fixed price, GST and the $1 NT levy included. Share the link with whoever is paying.</PageHead>
      <section className="section">
        <div className="wrap split">
          <div>
            <Estimator initialService={link.service ?? 'ride'}
              initialFrom={link.from ? linkPlace(link.from) : undefined} initialTo={link.to ? linkPlace(link.to) : undefined}
              onChange={(q) => history.replaceState(history.state, '', `${loc.pathname}${q}`)} />
          </div>
          <div className="prose">
            <h2 style={{ marginTop: 0 }}>How prices work</h2>
            <p>The price is worked out from the distance and time of the best route, and fixed when you book. There's no waiting meter and no card surcharge. Late at night (10pm to 5am) a 20% surcharge applies.</p>
            <p>Going to the airport or an appointment? See <Link to="/airport">airport transfers</Link> and <Link to="/hospital">hospital and clinic trips</Link>.</p>
          </div>
        </div>
      </section>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <h2>Our fares</h2>
          <FareTable services={['ride', 'pet', 'courier_s', 'courier_m', 'courier_l'].map((s) => rule(cfg, s))} />
        </div>
      </section>
    </>
  );
}
