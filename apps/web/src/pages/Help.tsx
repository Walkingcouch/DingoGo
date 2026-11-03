import { Link } from 'react-router-dom';
import { PageHead } from '../Layout';
import { contact, useConfig } from '../config';
import { useMeta } from '../meta';

export default function Help() {
  useMeta('Help & FAQ', 'Answers to common questions about DingoGo rides, parcels, payments, points and accounts.');
  const c = contact(useConfig());
  const faqs: [string, React.ReactNode][] = [
    ['Where does DingoGo operate?', 'Alice Springs (Mparntwe) and surrounds, including the airport, out to about 25 km from town. Tennant Creek, Yulara and Darwin are planned later.'],
    ['What hours do you run?', `${c.hours}. With a small fleet, it's best to book ahead for early flights and busy Friday and Saturday nights.`],
    ['Can I book without a smartphone?', <>Yes. Call <a href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a> and we'll book for you. You can pay with a prepaid DingoGo card or a community organisation account.</>],
    ['How do I pay?', 'Card through the app (your card is held securely by our payment provider, not by us), DingoGo credit, a prepaid DingoGo card, or a business or NDIS account. Parcels can also be paid in cash. Your card is only charged the final fare when the trip ends.'],
    ['Why is there an NT passenger levy?', 'The Northern Territory Government charges a $1 levy on each rideshare passenger trip. We show it separately and pass it on.'],
    ['Can I bring my dog?', <>Choose <Link to="/rides#pets">Ride with a pet</Link>. Assistance animals are welcome on every trip at no extra cost.</>],
    ['How do I send a parcel to someone without the app?', 'They don\'t need it. We text them a tracking link and their delivery PIN.'],
    ['I left something in the car', 'Open the trip in the app and choose Help, then Lost item, or call us. We\'ll put you in touch with the driver without sharing phone numbers.'],
    ['How do I get a tax invoice?', 'Every completed trip has a tax invoice with GST in the app. Business and NDIS accounts also get a monthly statement.'],
    ['How do I delete my account or get a copy of my data?', <>In the app, go to Account. You can download your data or delete your account. We keep tax records for the time the law requires. See our <Link to="/legal/privacy">privacy policy</Link>.</>],
  ];
  return (
    <>
      <PageHead title="Help and common questions">Can't find your answer? Call {c.phone} or email {c.email}.</PageHead>
      <section className="section">
        <div className="wrap faq prose" style={{ maxWidth: 820 }}>
          {faqs.map(([q, a]) => <details key={q}><summary>{q}</summary><p>{a}</p></details>)}
        </div>
      </section>
    </>
  );
}
