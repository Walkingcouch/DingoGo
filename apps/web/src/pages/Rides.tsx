import { money } from '@dingogo/shared';
import { Estimator } from '../Estimator';
import { PageHead } from '../Layout';
import { rule, useConfig, type FareRule } from '../config';
import { useMeta } from '../meta';

export function FareTable({ services }: { services: (FareRule | undefined)[] }) {
  const rows = services.filter(Boolean) as FareRule[];
  if (!rows.length) return <p className="dg-muted">Loading prices…</p>;
  return (
    <div className="table-scroll">
      <table className="price-table">
        <thead><tr><th scope="col">Service</th><th scope="col">Base</th><th scope="col">Per km</th><th scope="col">Per minute</th><th scope="col">Booking fee</th><th scope="col">NT levy</th><th scope="col">Minimum</th></tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.service}>
              <th scope="row" style={{ color: 'var(--text)' }}>{r.label}<br /><small className="dg-muted" style={{ fontWeight: 400 }}>{r.description}</small></th>
              <td className="n">{money(r.base_cents)}</td><td className="n">{money(r.per_km_cents)}</td><td className="n">{money(r.per_min_cents)}</td>
              <td className="n">{money(r.booking_fee_cents)}</td><td className="n">{money(r.levy_cents)}</td><td className="n">{money(r.min_fare_cents)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function Rides() {
  useMeta('Rides', 'Fixed-price electric rides around Alice Springs: airport, town, hospital and home. Pet-friendly cars and assistance animals always welcome.');
  const cfg = useConfig();
  const ride = rule(cfg, 'ride');
  const plan = cfg?.plans.find((p) => p.code === 'pass');
  return (
    <>
      <PageHead tone="noon" title="Rides around Alice Springs">You see the full price before you book, and that's the price you pay unless you change the trip on the way.</PageHead>
      <section className="section">
        <div className="wrap split">
          <div className="prose">
            <h2 style={{ marginTop: 0 }}>How a ride works</h2>
            <ol className="steps">
              <li><div><b>Choose where you're going</b><span>Pick a place from the list or drop a pin. Book now or up to 60 days ahead.</span></div></li>
              <li><div><b>Check the fixed price</b><span>Every fee is listed, including GST and the $1 NT passenger levy.</span></div></li>
              <li><div><b>Meet your driver</b><span>You'll see their name, photo, car and rego. Tell them your 4-digit trip PIN before you set off, so you both know it's the right car.</span></div></li>
              <li><div><b>Pay and rate</b><span>Card, DingoGo credit, a prepaid DingoGo card or a business account. A tax invoice lands in the app straight away.</span></div></li>
            </ol>
          </div>
          <div>
            <h3>Try a trip</h3>
            <Estimator compact initialService="ride" />
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <h2>Prices</h2>
          <p className="section-intro">Below the Alice Springs taxi day tariff ($5.30 flagfall plus $2.45 a km) for most trips, and fixed before you book, with no waiting-time meter and no card surcharge. All prices include GST.</p>
          <FareTable services={[rule(cfg, 'ride'), rule(cfg, 'pet')]} />
          <div className="prose" style={{ marginTop: 24 }}>
            <ul>
              <li>Late-night trips between 10pm and 5am cost {ride?.night_pct ?? 20}% more. Public holidays cost 15% more.</li>
              <li>Cancelling is free within 2 minutes of a driver accepting. After that, or once your driver has waited {ride?.free_wait_min ?? 3} minutes, a {money(ride?.cancel_fee_cents ?? 300)} fee applies, and most of it goes to the driver.</li>
              <li>If you add a stop or the route grows by more than a quarter, the price is adjusted, but never by more than 20%.</li>
              <li>Prices are rounded to the nearest 5 cents.</li>
            </ul>
          </div>
        </div>
      </section>

      <section className="section band" id="pets">
        <div className="wrap split">
          <div>
            <h2>Pets and assistance animals</h2>
          </div>
          <div className="prose">
            <p><b>Assistance animals ride on every trip, on every service, at no extra cost.</b> Refusing an assistance animal is against the law, and our drivers are trained on this. If a driver turns you away, tell us and we'll act on it.</p>
            <p>For pets, choose <b>Ride with a pet</b>. Those cars have seat covers and a harness point, and the driver has said yes to pets. Dogs need a lead or harness; cats and small animals travel in a carrier. A cleaning fee may apply if the car needs a full clean afterwards.</p>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="wrap split">
          <div><h2>Getting to the airport</h2></div>
          <div className="prose">
            <p>Alice Springs Airport is about 15 km from Todd Mall, around 15 minutes. Book ahead for early flights; we'll start looking for your driver 15 minutes before pickup. The boot of a Dolphin holds two large suitcases and a carry-on.</p>
            <h3>Wheelchair users</h3>
            <p>Our first cars are BYD Dolphins, which aren't wheelchair-accessible vehicles. If you travel in your wheelchair, call us and we'll help you book a wheelchair-accessible taxi. If you can transfer to a seat, we can carry a folding chair in the boot.</p>
            {plan && (
              <>
                <h3>Ride often? {plan.name}</h3>
                <p>{money(plan.price_cents)} a month: {plan.perks.join(', ').toLowerCase()}. Cancel any time in the app.</p>
              </>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
