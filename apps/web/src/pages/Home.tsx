import { Link } from 'react-router-dom';
import { money, Ranges } from '@dingogo/shared';
import mascot from '../assets/mascot-clean.png';
import { Estimator } from '../Estimator';
import { contact, rule, useConfig } from '../config';
import { useMeta } from '../meta';

export default function Home() {
  useMeta('DingoGo', 'Aboriginal-owned, 100% electric rideshare and same-day courier in Alice Springs (Mparntwe). See your fare before you book.');
  const cfg = useConfig();
  const c = contact(cfg);
  const from = (s: string) => { const r = rule(cfg, s); return r ? money(r.min_fare_cents) : null; };

  const services = [
    { to: '/rides', ico: '🚗', title: 'Rides around town', body: 'Quiet electric cars, local drivers, a fixed price before you get in. Airport, shops, hospital, home.', from: from('ride') },
    { to: '/parcels', ico: '📦', title: 'Same-day parcels', body: 'Collected from shops, offices or home and handed over with a delivery PIN or signature.', from: from('courier_s') },
    { to: '/rides#pets', ico: '🐕', title: 'Rides with your pet', body: 'Seat covers and a harness point in selected cars. Assistance animals ride free on every trip.', from: from('pet') },
    { to: '/tours', ico: '🏜️', title: 'Private tours', body: 'Telegraph Station, the West Macs gaps, Desert Park and sunset, with a driver who knows Country.', from: '$220' },
    { to: '/business', ico: '🎉', title: 'Events and business accounts', body: 'Conference transfers, weddings and festivals, monthly invoicing, NDIS plan-manager billing.', from: rule(cfg, 'hourly') ? `${money(rule(cfg, 'hourly')!.per_min_cents * 60)}/hr` : null },
  ];

  return (
    <>
      <section className="hero">
        <div className="hero-stars" aria-hidden="true" />
        <div className="wrap">
          <div>
            <h1>Where are you headed?</h1>
            <p className="hero-lede">Electric rides and same-day deliveries in Alice Springs, from an Aboriginal-owned local business. Check the price first.</p>
            <Estimator />
          </div>
          <div className="hero-figure">
            <img src={mascot} alt="DingoGo's mascot, a dingo in a driver's cap and waistcoat" width={300} height={438} />
          </div>
        </div>
        <Ranges className="hero-ranges-back" height={120} fill="currentColor" />
        <Ranges className="hero-ranges" height={90} fill="currentColor" />
      </section>

      <section className="section">
        <div className="wrap split">
          <div>
            <h2>What we do</h2>
            <p className="section-intro">Everything runs on three BYD Dolphins to start, charged at home in Mparntwe. Prices shown are the minimum fare.</p>
          </div>
          <ul className="svc">
            {services.map((s) => (
              <li key={s.title}>
                <Link to={s.to}>
                  <span className="ico" aria-hidden="true">{s.ico}</span>
                  <span><h3>{s.title}</h3><p>{s.body}</p></span>
                  {s.from && <span className="from">from<b>{s.from}</b></span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <h2 style={{ maxWidth: '18ch' }}>Owned here, driven here, charged here</h2>
          <div className="why" style={{ marginTop: 28 }}>
            <div>
              <h3>Aboriginal-owned</h3>
              <p>DingoGo is owned by Johnathan Ah Chee and Micah Bartlett. Fares stay in Central Australia, and we hire and train local drivers.</p>
            </div>
            <div>
              <h3>Every car is electric</h3>
              <p>No petrol, no exhaust at the school gate. Each receipt shows the CO₂ you saved compared with an average petrol car.</p>
            </div>
            <div>
              <h3>Drivers you'll see again</h3>
              <p>A small team of accredited local drivers, and where we can, drivers who speak Arrernte and other local languages. You'll see their name and car before they arrive.</p>
            </div>
            <div>
              <h3>Coffee on us</h3>
              <p>Every dollar earns 10 Dingo Points. Swap 800 for a coffee at a partner café, or use points to take money off your next ride.</p>
            </div>
          </div>
        </div>
      </section>

      <section className="band" id="app">
        <div className="wrap section split">
          <div>
            <h2>The DingoGo app</h2>
            <p className="section-intro">Book, track your driver on the map, share your trip with family, and pay by card, credit or account. Cash is welcome too.</p>
          </div>
          <div>
            <div className="store-row">
              <span className="store" aria-disabled="true"><small>Coming soon to the</small><b>App Store</b></span>
              <span className="store" aria-disabled="true"><small>Coming soon on</small><b>Google Play</b></span>
            </div>
            <p className="dg-muted">No smartphone? Call <a href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a> and we'll book for you, {c.hours.toLowerCase()}. Prepaid DingoGo cards will be sold at partner shops for people without a bank card.</p>
          </div>
        </div>
      </section>

    </>
  );
}
