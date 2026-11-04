import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import QRCode from 'qrcode';
import { get, money, post } from '@dingogo/shared';
import mascot from '../assets/mascot-clean.png';
import { AIRPORT, Estimator, RIDER_URL, TODD_MALL, type Place, ANDROID_RIDER_APK } from '../Estimator';
import { contact, rule, useConfig } from '../config';
import { useMeta } from '../meta';
import { Scene, type SceneTone } from '../Scene';

const P = (name: string, lat: number, lng: number): Place => ({ name, address: name, lat, lng });
const ROUTES: { from: Place; to: Place; note: string }[] = [
  { from: TODD_MALL, to: AIRPORT, note: 'Most flights' },
  { from: P('Larapinta', -23.695, 133.835), to: P('Alice Springs Hospital', -23.7076, 133.877), note: 'Appointments' },
  { from: P('Braitling', -23.683, 133.868), to: P('Yeperenye Shopping Centre', -23.7008, 133.8818), note: 'Groceries' },
  { from: P('Eastside', -23.695, 133.896), to: P('Alice Springs Telegraph Station', -23.6676, 133.8853), note: 'Weekend walk' },
  { from: P('Alice Springs Desert Park', -23.7076, 133.8205), to: TODD_MALL, note: 'After a visit' },
  { from: P('Alice Springs Railway Station', -23.7069, 133.8701), to: P('Lasseters Hotel Casino', -23.7178, 133.8869), note: 'Off The Ghan' },
];

type Tour = { id: string; slug: string; name: string; summary: string; duration_min: number; price_cents: number };
type Partner = { id: string; name: string; address: string | null; aboriginal_owned: boolean };
const TOUR_TONES: Record<string, { tone: SceneTone; gap?: boolean }> = {
  'town-heritage': { tone: 'noon' }, 'west-macs-gaps': { tone: 'gap', gap: true }, 'desert-sunset': { tone: 'dusk' }, 'east-macs-gaps': { tone: 'dawn', gap: true },
};
const hrs = (m: number) => (m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} hours`);

export default function Home() {
  useMeta('DingoGo', 'Aboriginal-owned, 100% electric rideshare and same-day courier in Alice Springs (Mparntwe). See your fixed price before you book.');
  const cfg = useConfig();
  const c = contact(cfg);
  const min = (s: string) => { const r = rule(cfg, s); return r ? money(r.min_fare_cents) : '—'; };
  const hourly = rule(cfg, 'hourly');

  return (
    <>
      {/* ── Hero: the booking surface over the ranges at dusk ── */}
      <section className="hero">
        <Scene tone="dusk" stars="right" className="hero-scene" />
        <div className="wrap hero-grid">
          <div className="hero-copy">
            <p className="hero-kicker">Rides and deliveries in Mparntwe, Alice Springs</p>
            <h1>Where are you headed?</h1>
            <p className="hero-lede">Quiet electric cars, local drivers and a fixed price before you book. Owned by Aboriginal people from right here.</p>
            <Estimator />
          </div>
          <div className="hero-mascot" aria-hidden="true">
            <img src={mascot} alt="" width={260} height={380} />
          </div>
        </div>
      </section>

      {/* ── Real trips, today's prices ── */}
      <section className="section section--first">
        <div className="wrap">
          <div className="head-split">
            <h2>Trips people take every day</h2>
            <p className="section-intro">Prices worked out just now from our live fare engine. GST and the $1 NT passenger levy are in the number you see.</p>
          </div>
          <RouteBoard />
        </div>
      </section>

      {/* ── Services: one lead, four supporting ── */}
      <section className="section section--flush">
        <div className="wrap services">
          <Link to="/rides" className="svc-lead">
            <div className="svc-lead-copy">
              <h2>Rides around town</h2>
              <p>Airport runs, the school gate, Friday night out, the trip home from hospital. Book now or up to 60 days ahead, and tell your driver the 4-digit trip PIN before you set off.</p>
              <span className="svc-from">From <b>{min('ride')}</b></span>
            </div>
            <Scene tone="noon" sun={false} className="svc-lead-art" ground="transparent" />
          </Link>
          <ul className="svc-list">
            <li><Link to="/parcels"><h3>Same-day parcels</h3><p>Pharmacy, documents, parts and gifts, handed over with the recipient's PIN or a signature.</p><span className="svc-from">From <b>{min('courier_s')}</b></span></Link></li>
            <li><Link to="/rides#pets"><h3>Rides with your pet</h3><p>Seat covers and a harness point. Assistance animals ride on every trip at no cost.</p><span className="svc-from">From <b>{min('pet')}</b></span></Link></li>
            <li><Link to="/tours"><h3>Private tours</h3><p>Telegraph Station, the West Macs gaps and sunset, one price per car for up to four.</p><span className="svc-from">From <b>$220</b></span></Link></li>
            <li><Link to="/business"><h3>Events and accounts</h3><p>Conferences and weddings by the hour, monthly invoices, NDIS plan-manager billing.</p><span className="svc-from"><b>{hourly ? money(hourly.per_min_cents * 60) : '$75'}</b> an hour</span></Link></li>
          </ul>
        </div>
      </section>

      {/* ── Why DingoGo ── */}
      <section className="section why-band">
        <div className="wrap why-grid">
          <div className="why-lead">
            <h2>Owned here, driven here, charged here</h2>
            <p>DingoGo is a small local company. The fares you pay stay in Central Australia, and the people who drive you live here too.</p>
          </div>
          <ul className="why-list">
            <li><Icon k="hand" /><div><h3>Aboriginal-owned</h3><p>Owned by Johnathan Ah Chee and Micah Bartlett. We hire and train local drivers, including speakers of Arrernte and other local languages.</p></div></li>
            <li><Icon k="bolt" /><div><h3>Every car is electric</h3><p>BYD Dolphins charged at home in town. Your receipt shows the CO₂ you saved against an average petrol car.</p></div></li>
            <li><Icon k="tag" /><div><h3>The price is the price</h3><p>Fixed before you book, GST included, no waiting meter and no card surcharge.</p></div></li>
            <li><Icon k="paw" /><div><h3>Assistance animals always ride</h3><p>On every service, at no cost. Drivers are trained, and refusals are investigated.</p></div></li>
            <li><Icon k="shield" /><div><h3>Safety built in</h3><p>Accredited drivers, a trip PIN, live trip sharing, an SOS button and a women-preferred driver option.</p></div></li>
          </ul>
        </div>
      </section>

      {/* ── The app, shown not described ── */}
      <section className="app-band" id="app">
        <div className="wrap app-grid">
          <div className="app-copy">
            <h2>Book, track and pay in one place</h2>
            <p>See your driver's name, car and rego before they arrive, watch them on the map, and send your trip to family. Earn Dingo Points on every dollar and swap them for a coffee in town.</p>
            <div className="app-actions">
              <a className="dg-btn" href={RIDER_URL}>Open the web app</a>
            </div>
            <div className="app-stores">
              <span className="store" aria-disabled="true"><small>Coming soon to the</small><b>App Store</b></span>
              <a className="store store--live" href={ANDROID_RIDER_APK}><small>Download for</small><b>Android</b></a>
            </div>
            <p className="app-note">No smartphone? Call <a href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a> and we'll book for you. Prepaid DingoGo cards are coming to partner shops for people without a bank card.</p>
          </div>
          <Phones />
        </div>
      </section>

      {/* ── Tours ── */}
      <section className="section">
        <div className="wrap">
          <div className="head-split">
            <h2>Private tours from town</h2>
            <p className="section-intro">Your own car and a local driver, at your pace. Places are named in Arrernte and English, and your driver will tell you where not to climb or photograph.</p>
          </div>
          <ToursStrip />
        </div>
      </section>

      {/* ── Business + Drive ── */}
      <section className="section section--flush">
        <div className="wrap duo">
          <div className="duo-card duo-card--biz">
            <h2>For business, NDIS and community</h2>
            <ul className="ticks">
              <li>One monthly tax invoice with every trip itemised</li>
              <li>NDIS plan managers invoiced directly, participant number on every line</li>
              <li>Clients booked by phone, with no smartphone or bank card needed</li>
              <li>Cars by the hour for conferences, weddings and festivals</li>
            </ul>
            <Link to="/business" className="dg-btn dg-btn--dark">Open an account</Link>
          </div>
          <div className="duo-card duo-card--drive">
            <h2>Drive with DingoGo</h2>
            <p>Drive a fleet car on shifts or lease your own BYD Dolphin through us. We help with the NT accreditation steps, the police check and medical, and getting set up for GST.</p>
            <p className="duo-figure"><b>75%</b> of every trip fare goes to you, plus 100% of tips.</p>
            <Link to="/drive" className="dg-btn dg-btn--dark">Apply to drive</Link>
          </div>
        </div>
      </section>

      {/* ── Partners + FAQ ── */}
      <section className="section">
        <div className="wrap pf-grid">
          <div>
            <h2>Coffee on us</h2>
            <p className="section-intro">Every dollar you spend earns 10 Dingo Points. 800 points is a coffee at a partner café.</p>
            <PartnerList />
            <Link to="/rewards" className="text-link">How rewards work</Link>
          </div>
          <div>
            <h2>Questions people ask</h2>
            <div className="faq">
              <details><summary>How do I pay?</summary><p>Card in the app (held securely by our payment provider, never by us), DingoGo credit, a prepaid DingoGo card, or a business or NDIS account. Parcels can also be paid in cash.</p></details>
              <details><summary>Can I book without a smartphone?</summary><p>Yes. Call {c.phone} and we'll book for you, {c.hours.toLowerCase()}. You can pay with a prepaid DingoGo card or a community organisation account.</p></details>
              <details><summary>What does it cost to cancel?</summary><p>Nothing within 2 minutes of a driver accepting. After that, or once your driver has waited a few minutes, a small fee applies, and most of it goes to the driver. Tours are free to cancel up to 48 hours before.</p></details>
              <details><summary>Can I bring my dog?</summary><p>Choose Ride with a pet and we'll send a car set up for animals. Assistance animals ride on every service, every time, at no cost.</p></details>
              <details><summary>Do you go to Yulara or Tennant Creek?</summary><p>Not yet. We're starting in Alice Springs, then Tennant Creek and Yulara, then Darwin.</p></details>
            </div>
            <Link to="/help" className="text-link">All help topics</Link>
          </div>
        </div>
      </section>
    </>
  );
}

function RouteBoard() {
  const [prices, setPrices] = useState<(number | null)[]>(ROUTES.map(() => null));
  const [km, setKm] = useState<(number | null)[]>(ROUTES.map(() => null));
  useEffect(() => {
    ROUTES.forEach((r, i) => {
      post<{ quote: { total_cents: number; distance_km: number } }>('/public/estimate', { service: 'ride', pickup: r.from, dropoff: r.to })
        .then((q) => {
          setPrices((p) => p.map((v, j) => (j === i ? q.quote.total_cents : v)));
          setKm((p) => p.map((v, j) => (j === i ? q.quote.distance_km : v)));
        }).catch(() => {});
    });
  }, []);
  return (
    <ol className="routes">
      {ROUTES.map((r, i) => (
        <li key={r.to.name + i}>
          <span className="route-ends"><b>{r.from.name}</b><span className="route-line" aria-hidden="true" /><b>{r.to.name}</b></span>
          <span className="route-note">{r.note}{km[i] != null ? `, ${km[i]} km` : ''}</span>
          <span className="route-price">{prices[i] != null ? money(prices[i]) : <span className="dg-muted">…</span>}</span>
        </li>
      ))}
    </ol>
  );
}

function ToursStrip() {
  const [tours, setTours] = useState<Tour[] | null>(null);
  useEffect(() => { get<{ tours: Tour[] }>('/public/tours').then((r) => setTours(r.tours)).catch(() => setTours([])); }, []);
  if (!tours) return <p className="dg-muted">Loading tours…</p>;
  if (!tours.length) return <p className="dg-muted">Tours couldn't load. <Link to="/tours">See all tours</Link>.</p>;
  return (
    <ul className="tour-strip">
      {tours.map((t) => {
        const art = TOUR_TONES[t.slug] ?? { tone: 'dusk' as SceneTone };
        return (
          <li key={t.id}>
            <Link to={`/tours#${t.slug}`}>
              <Scene tone={art.tone} gap={art.gap} stars={art.tone === 'dusk'} className="tour-art" ground="transparent" />
              <div className="tour-tile-copy">
                <h3>{t.name}</h3>
                <p>{t.summary}</p>
                <span className="tour-tile-meta"><b>{money(t.price_cents)}</b> per car, {hrs(t.duration_min)}</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function PartnerList() {
  const [list, setList] = useState<Partner[] | null>(null);
  useEffect(() => { get<{ partners: Partner[] }>('/public/partners').then((r) => setList(r.partners)).catch(() => setList([])); }, []);
  if (!list?.length) return null;
  return (
    <ul className="partner-mini">
      {list.map((p) => (
        <li key={p.id}><b>{p.name.replace(' (demo)', '')}</b><span>{p.address}{p.aboriginal_owned ? ', Aboriginal-owned' : ''}</span></li>
      ))}
    </ul>
  );
}

/** Three phone screens drawn in HTML/CSS, showing real app states. */
function Phones() {
  const [qr, setQr] = useState<string>('');
  useEffect(() => { QRCode.toDataURL('DG7KQX2M', { margin: 0, width: 220, color: { dark: '#14213D', light: '#FFFFFF' } }).then(setQr).catch(() => {}); }, []);
  return (
    <div className="phones" aria-label="Screens from the DingoGo app" role="img">
      <div className="phone phone--a">
        <div className="phone-screen">
          <div className="ph-map"><Scene tone="night" sun={false} ground="transparent" /><span className="ph-car" /><span className="ph-pin" /></div>
          <div className="ph-sheet">
            <small>DG-8ZRCUV</small>
            <b className="ph-title">Driver on the way</b>
            <div className="ph-pin-box"><span>Your trip PIN</span><b>2122</b></div>
            <div className="ph-driver"><span className="ph-av">T</span><span><b>Tjala</b><small>Grey BYD Dolphin</small></span><span className="ph-rego">CA 12 DG</span></div>
          </div>
        </div>
      </div>
      <div className="phone phone--b">
        <div className="phone-screen">
          <div className="ph-head"><small>Parcel DG-4MHT7P</small><b className="ph-title">Delivered</b></div>
          <ol className="ph-steps">
            <li className="done">Collected from Todd Mall Pharmacy<small>2:14 pm</small></li>
            <li className="done">On the way<small>2:16 pm</small></li>
            <li className="done">Handed to Nan with PIN<small>2:27 pm</small></li>
          </ol>
          <div className="ph-receipt"><span>Delivery, small</span><b>$15.60</b><small>incl. GST $1.42</small></div>
        </div>
      </div>
      <div className="phone phone--c">
        <div className="phone-screen">
          <div className="ph-head"><small>Dingo Points</small><b className="ph-title ph-points">1,250</b></div>
          <div className="ph-reward">
            <b>Free regular coffee</b>
            <small>Show this at the counter</small>
            {qr ? <img src={qr} alt="" /> : <span className="ph-qr-blank" />}
            <span className="ph-code">DG7KQX2M</span>
          </div>
        </div>
      </div>
    </div>
  );
}

function Icon({ k }: { k: 'hand' | 'bolt' | 'tag' | 'paw' | 'shield' }) {
  const d: Record<string, string> = {
    hand: 'M7 11V6a1.5 1.5 0 0 1 3 0v4m0-1V4.5a1.5 1.5 0 0 1 3 0V10m0-4a1.5 1.5 0 0 1 3 0v5m0-2a1.5 1.5 0 0 1 3 0v4.5c0 3.6-2.9 6.5-6.5 6.5h-.8a6 6 0 0 1-4.6-2.2L4 15.6a1.6 1.6 0 0 1 2.4-2l.6.7',
    bolt: 'M13 2 4 14h7l-1 8 9-12h-7l1-8Z',
    tag: 'M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8ZM7.5 7.5h.01',
    paw: 'M12 13c-2.8 0-5 2.6-5 4.6 0 1.6 1.4 2.4 3 2.4 .8 0 1.4-.4 2-.4s1.2.4 2 .4c1.6 0 3-.8 3-2.4 0-2-2.2-4.6-5-4.6ZM6 10.5a2 2.5 0 1 0 0 .1M18 10.5a2 2.5 0 1 0 0 .1M9.5 6a2 2.5 0 1 0 0 .1M14.5 6a2 2.5 0 1 0 0 .1',
    shield: 'M12 3 4 6v6c0 4.4 3.4 8.3 8 9 4.6-.7 8-4.6 8-9V6l-8-3Zm-3 9 2 2 4-4',
  };
  return (
    <svg className={`why-ico why-ico--${k}`} viewBox="0 0 24 24" width="28" height="28" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d[k]} />
    </svg>
  );
}
