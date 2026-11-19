import { Link } from 'react-router-dom';
import { Estimator } from '../Estimator';
import { PageHead } from '../Layout';
import { rule, useConfig } from '../config';
import { useMeta } from '../meta';
import { FaqSection } from '../components/Faq';
import { FareTable } from './Rides';
import { PROHIBITED_ITEMS } from '@dingogo/shared';

/** Wording lives in packages/shared (the rider app shows the same list as a checklist; the API checks the same keys). */
export const PROHIBITED: [string, string][] = PROHIBITED_ITEMS.map((i) => [i.title, i.detail]);

export default function Parcels() {
  useMeta();
  const cfg = useConfig();
  return (
    <>
      <PageHead tone="dawn" title="Send a parcel across town today">From a pharmacy bag to a 25 kg box. Collected by a local driver and handed over in person, usually within the hour.</PageHead>
      <section className="section">
        <div className="wrap split">
          <div className="prose">
            <h2 style={{ marginTop: 0 }}>How it works</h2>
            <ol className="steps">
              <li><div><b>Book the pickup</b><span>Choose a size, add the recipient's name and mobile, and tick that the parcel has nothing on the prohibited list.</span></div></li>
              <li><div><b>We text the recipient</b><span>They get a tracking link and a 4-digit delivery PIN. Only they know it.</span></div></li>
              <li><div><b>The driver collects</b><span>From a shop counter, office or front door. You can follow the car on the map.</span></div></li>
              <li><div><b>Handover with proof</b><span>The recipient gives the PIN or signs on the driver's phone. If you allowed it, the driver can leave it in a safe spot and take a photo. You get a text when it's done.</span></div></li>
            </ol>
          </div>
          <div><h3>Price a delivery</h3><Estimator compact initialService="courier_s" /></div>
        </div>
      </section>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <h2>Sizes and prices</h2>
          <p className="section-intro">All sizes must fit in a small hatchback. Prices include GST.</p>
          <FareTable services={[rule(cfg, 'courier_s'), rule(cfg, 'courier_m'), rule(cfg, 'courier_l')]} />
          <p className="dg-muted" style={{ marginTop: 16 }}>Sending regularly? A <Link to="/business">business account</Link> gets monthly invoicing, and the DingoGo Pass includes free small deliveries each month.</p>
        </div>
      </section>
      <section className="section band">
        <div className="wrap split">
          <div><h2>What we can't carry</h2><p className="section-intro">Drivers can refuse any parcel they believe breaks these rules. The full list is in our <Link to="/legal/prohibited-items">prohibited items policy</Link>.</p></div>
          <ul className="nolist">
            {PROHIBITED.map(([t, d]) => <li key={t}><div><b>{t}</b><br /><span className="dg-muted">{d}</span></div></li>)}
          </ul>
        </div>
      </section>
      <FaqSection set="parcels" />
    </>
  );
}
