import { PageHead } from '../Layout';
import { contact, useConfig } from '../config';
import { useMeta } from '../meta';

export default function Safety() {
  useMeta('Safety', 'How DingoGo keeps riders, recipients and drivers safe: vetted drivers, trip PINs, live trip sharing, an emergency button and route checks.');
  const c = contact(useConfig());
  const items = [
    ['Accredited, vetted drivers', 'Every driver holds an NT H endorsement and CPV identity card, has a current police check and medical, and is trained by us. Their licence and accreditation dates are checked by the system; a driver with anything expired can\'t go online.'],
    ['A PIN for every trip', 'You get a 4-digit PIN. The driver can\'t start the trip until you tell them, so you know you\'re in the right car. Parcels use a separate PIN that only the recipient has.'],
    ['Share your trip', 'Send a live link to family or friends. They can see the car, the driver\'s first name and rego, and where you are, without downloading anything.'],
    ['Emergency button', 'Tap it in the app to call 000. It also alerts the DingoGo team with your location and texts your emergency contact a live tracking link.'],
    ['Route checks', 'If a car goes well off the expected route, we check in with you in the app and our team is alerted.'],
    ['Women-preferred option', 'Ask for a woman driver when you book. If none is free, we\'ll tell you rather than send someone else.'],
    ['Phone numbers stay private', 'Riders and drivers don\'t see each other\'s numbers.'],
    ['Assistance animals, always', 'Every driver must carry assistance animals. Refusals are logged and investigated.'],
  ];
  return (
    <>
      <PageHead tone="night" title="Safety on every trip">What we do before you get in, while you're on the way and after you arrive. In an emergency, always call 000 first.</PageHead>
      <section className="section">
        <div className="wrap">
          <div className="why">
            {items.map(([t, d]) => <div key={t}><h3>{t}</h3><p>{d}</p></div>)}
          </div>
        </div>
      </section>
      <section className="section band">
        <div className="wrap split">
          <div><h2>For everyone in the car</h2></div>
          <div className="prose">
            <p>No drinking alcohol in the car. Public drinking is banned in Alice Springs, and our cars count. Drivers can end a trip if they feel unsafe, and riders can too. We'd rather you got out somewhere safe and called us.</p>
            <p>To report something after a trip, use Help in the app, call <a href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a> or email <a href={`mailto:${c.email}`}>{c.email}</a>. Safety reports go to the top of the queue.</p>
          </div>
        </div>
      </section>
    </>
  );
}
