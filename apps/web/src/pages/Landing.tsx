import { Link } from 'react-router-dom';
import { AIRPORT, Estimator, RIDER_URL, TODD_MALL, type Place } from '../Estimator';
import { PageHead } from '../Layout';
import { FaqSection } from '../components/Faq';
import { contact, useConfig } from '../config';
import type { FaqSet } from '../faqs';
import { useMeta } from '../meta';
import type { SceneTone } from '../Scene';

type LandingDef = {
  title: string; lede: string; tone: SceneTone; from: Place; to: Place; faq: FaqSet;
  points: [string, string][]; more: React.ReactNode;
};
const HOSPITAL: Place = { name: 'Alice Springs Hospital', address: 'Gap Rd, Alice Springs NT 0870', lat: -23.7076, lng: 133.877 };
const LARAPINTA: Place = { name: 'Larapinta', address: 'Larapinta, Alice Springs NT 0870', lat: -23.695, lng: 133.835 };

const LANDINGS: Record<'airport' | 'hospital', LandingDef> = {
  airport: {
    title: 'Alice Springs Airport transfers', tone: 'dawn', from: TODD_MALL, to: AIRPORT, faq: 'airport',
    lede: 'A local driver between the airport and town, at a fixed price you see before you book. About 15 minutes each way.',
    points: [
      ['Fixed price, booked ahead', 'Book now or up to 60 days ahead. A slow trip or a wait at the lights costs the same.'],
      ['Early flights covered', 'Book the day before for flights before 7am, so a driver is lined up for you.'],
      ['Find your driver easily', "Your driver's name, car and rego are in the app, and you can watch them arrive."],
      ['Room for your bags', 'Every car takes a couple of suitcases. Groups and lots of bags: tell us in the notes.'],
    ],
    more: <>Coming off The Ghan? The same works from the railway station. Staying at a hotel? Book from the hotel's name in the app.</>,
  },
  hospital: {
    title: 'Rides to hospital and clinics', tone: 'noon', from: LARAPINTA, to: HOSPITAL, faq: 'hospital',
    lede: 'To Alice Springs Hospital, clinics, dialysis and specialist appointments, and home again. Carers welcome, assistance animals always.',
    points: [
      ['Help in and out of the car', 'Tell us about a walker or folding wheelchair and your driver sees it before they arrive.'],
      ['Carers and family ride too', 'Up to four people for one price. Assistance animals ride free on every trip.'],
      ['Accounts for health services', 'Health services, NDIS plan managers and community organisations can pay, and book for clients with consent.'],
      ['No smartphone needed', "Call us and we'll book, and text you when your driver is on the way."],
    ],
    more: <>For regular appointments, a health service or community organisation can <Link to="/business">open an account</Link> and book for you.</>,
  },
};

export default function Landing({ kind }: { kind: 'airport' | 'hospital' }) {
  useMeta();
  const d = LANDINGS[kind];
  const c = contact(useConfig());
  return (
    <>
      <PageHead tone={d.tone} title={d.title}>{d.lede}</PageHead>
      <section className="section">
        <div className="wrap split">
          <div><h3>See your price</h3><Estimator compact initialFrom={d.from} initialTo={d.to} /></div>
          <div>
            <ul className="landing-points">{d.points.map(([b, t]) => <li key={b}><b>{b}</b><span>{t}</span></li>)}</ul>
            <p className="dg-muted" style={{ marginTop: 16 }}>{d.more}</p>
            <p><a className="dg-btn" href={RIDER_URL}>Open the app</a>{' '}<a className="dg-btn dg-btn--ghost" href={`tel:${c.phone.replace(/\s/g, '')}`}>Call {c.phone}</a></p>
          </div>
        </div>
      </section>
      <FaqSection set={d.faq} />
    </>
  );
}
