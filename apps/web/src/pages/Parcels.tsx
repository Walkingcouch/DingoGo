import { Link } from 'react-router-dom';
import { Estimator } from '../Estimator';
import { PageHead } from '../Layout';
import { rule, useConfig } from '../config';
import { useMeta } from '../meta';
import { FareTable } from './Rides';

export const PROHIBITED = [
  ['Alcohol of any kind', 'Takeaway alcohol in Alice Springs is restricted and needs photo ID at the point of sale, so we don\'t carry it.'],
  ['Illegal drugs, or medicines that aren\'t yours', 'Pharmacy orders in the recipient\'s name are fine.'],
  ['Weapons and ammunition', 'Including replicas, knives sold as weapons and fireworks.'],
  ['Dangerous goods', 'Fuel, gas bottles, batteries over 100 Wh, chemicals, paint and anything flammable or corrosive.'],
  ['Cash, jewellery or items worth more than $1,000', 'We can\'t insure these in transit.'],
  ['Live animals', 'Book a pet-friendly ride with the owner instead.'],
  ['Food deliveries from restaurants', 'We don\'t carry hot food. Packaged groceries are fine.'],
];

export default function Parcels() {
  useMeta('Send a parcel', 'Same-day parcel delivery around Alice Springs in electric cars, with a delivery PIN or signature on every handover.');
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
    </>
  );
}
