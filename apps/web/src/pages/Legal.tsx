import { Link, useParams } from 'react-router-dom';
import { PageHead } from '../Layout';
import { contact, useConfig } from '../config';
import { useMeta } from '../meta';
import { PROHIBITED } from './Parcels';
import NotFound from './NotFound';

export default function Legal() {
  const { doc = '' } = useParams();
  const c = contact(useConfig());
  const docs: Record<string, { title: string; desc: string; body: React.ReactNode }> = {
    privacy: {
      title: 'Privacy policy', desc: 'How DingoGo collects, uses and protects personal information.',
      body: <>
        <p>DingoGo follows the Australian Privacy Principles in the Privacy Act 1988.</p>
        <h2>What we collect</h2>
        <ul>
          <li>Your name, mobile number and, if you give it, email address and emergency contact.</li>
          <li>Trip details: pickup and drop-off places, times, the route the car took and the fare.</li>
          <li>Location while you use the app to book or track a trip. Drivers' location is collected while they're online.</li>
          <li>Payment details are collected and held by our payment provider (Stripe). We only see the card type and last four digits.</li>
          <li>Accessibility needs you choose to tell us, so we can match you with the right car.</li>
          <li>For drivers: licence, accreditation, police check and medical records, ABN and bank details.</li>
        </ul>
        <h2>How we use it</h2>
        <p>To arrange and price trips, show your trip to your driver and anyone you share it with, process payments, give you tax invoices, run rewards, keep people safe, meet legal obligations (including NT passenger transport and tax records) and improve the service.</p>
        <h2>Who we share it with</h2>
        <p>Your driver sees your first name, pickup and drop-off. Parcel recipients see a tracking link. We use service providers for payments, SMS and hosting. We don't sell personal information, and partner cafés only see a reward code and your first name. We may share information with police or emergency services when the law requires or someone's safety is at risk.</p>
        <h2>Marketing</h2>
        <p>We only send offers if you opt in, and every message says how to stop them. You can turn them off in the app at any time.</p>
        <h2>Your choices</h2>
        <p>You can see and download your information, correct it, or delete your account in the app. We keep tax records for 5 years after the transaction, as the law requires, and trip records involving a safety report for longer.</p>
        <h2>Contact and complaints</h2>
        <p>Email <a href={`mailto:${c.email}`}>{c.email}</a>. If you're not happy with our response, you can contact the Office of the Australian Information Commissioner at oaic.gov.au.</p>
      </>,
    },
    terms: {
      title: 'Terms of use', desc: 'The terms for using DingoGo rides, deliveries and the app.',
      body: <>
        <h2>Who provides the service</h2>
        <p>DingoGo operates a booking service approved for rideshare in the Northern Territory. Rides are provided by accredited drivers, who may be independent contractors.</p>
        <h2>Prices</h2>
        <p>We show a fixed price before you book. It's what you pay unless the trip changes, for example an extra stop or a much longer route, in which case it can rise by up to 20%. Prices include GST and the NT passenger levy.</p>
        <h2>Your responsibilities</h2>
        <ul>
          <li>Wear a seatbelt and use a child restraint where the law requires one.</li>
          <li>Don't drink alcohol, smoke or vape in the car.</li>
          <li>Treat drivers and their cars with respect. Cleaning or damage costs may be charged.</li>
          <li>Only send parcels that are allowed under our <Link to="/legal/prohibited-items">prohibited items policy</Link>.</li>
        </ul>
        <h2>Your rights</h2>
        <p>Nothing in these terms limits your rights under the Australian Consumer Law, including the right to a refund or a fix when a service isn't provided with due care and skill.</p>
        <h2>Accounts</h2>
        <p>We may suspend accounts used for fraud, abuse or unsafe behaviour. You can close your account at any time in the app.</p>
      </>,
    },
    cancellations: {
      title: 'Cancellations and refunds', desc: 'When cancellation fees apply and how to ask for a refund.',
      body: <>
        <ul>
          <li>Cancel for free before a driver accepts, and within 2 minutes after.</li>
          <li>After 2 minutes, or once your driver has waited 3 minutes at pickup, a cancellation fee applies ($6 for rides, $5 for parcels, $25 for tours and hourly hire). Most of the fee goes to the driver for their time.</li>
          <li>If your driver cancels, or no driver is available, you are never charged and any hold on your card is released.</li>
          <li>Dingo Points and promo codes used on a cancelled trip are returned.</li>
        </ul>
        <h2>Refunds</h2>
        <p>If something went wrong, such as a much longer route, a fee you didn't expect or a lost parcel, tell us within 30 days using Help in the app or by email. Refunds go back to the card you paid with, or to DingoGo credit for cash trips, usually within 5 business days.</p>
      </>,
    },
    'prohibited-items': {
      title: 'Prohibited items', desc: 'Items DingoGo couriers will not carry.',
      body: <>
        <p>Drivers can refuse a parcel, or stop a delivery, if they believe it contains any of the following. The sender is responsible for what's in the parcel.</p>
        <ul className="nolist">{PROHIBITED.map(([t, d]) => <li key={t}><div><b>{t}</b><br /><span className="dg-muted">{d}</span></div></li>)}</ul>
        <h2>Limits</h2>
        <p>Parcels up to 25 kg that fit in the boot of a small hatchback. Declared value up to $1,000.</p>
      </>,
    },
  };
  const d = docs[doc];
  useMeta(d?.title ?? 'Not found', d?.desc);
  if (!d) return <NotFound />;
  return (
    <>
      <PageHead tone="night" title={d.title} draft>This page is a draft and hasn't yet been reviewed by a lawyer. It will be finalised before DingoGo launches.</PageHead>
      <section className="section"><div className="wrap prose">{d.body}</div></section>
    </>
  );
}
