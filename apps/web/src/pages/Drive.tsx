import { ANDROID_DRIVER_APK } from '../Estimator';
import { PageHead } from '../Layout';
import { Area, Field, formData, Sent, useSubmit } from '../forms';
import { useMeta } from '../meta';

const FUELS = ['Electric', 'Plug-in hybrid', 'Hybrid', 'Petrol', 'Diesel'];
const SA_TOWNS = 'Port Augusta, Coober Pedy, Whyalla, Port Pirie and Mount Gambier';

/** The API's driver-application schema has no car fields (unknown keys are dropped), so car details go at the top of `message`. */
function withCar(raw: Record<string, unknown>) {
  const { car_make_model, car_year, car_fuel, car_owner, drive_state, message, ...rest } = raw;
  const car = [car_make_model, car_year, car_fuel].filter(Boolean).join(', ');
  const lines = [
    drive_state === 'SA' ? `Wants to drive in: South Australia (${SA_TOWNS})` : '',
    car ? `Car: ${car}. Registered owner: ${car_owner ? 'yes' : 'no'}` : 'Car: not given',
    typeof message === 'string' ? message : '',
  ].filter(Boolean);
  return { ...rest, message: lines.join('\n').slice(0, 1000) };
}

export default function Drive() {
  useMeta('Drive with us', 'Drive your own car for DingoGo in Alice Springs, and soon in regional South Australia. What the NT requires of you and your car, how we help you get accredited, and how earnings work.');
  const f = useSubmit('/public/driver-applications');
  return (
    <>
      <PageHead title="Drive with DingoGo">Drive your own car around your own town, with a local team behind you. Here's exactly what it takes.</PageHead>
      <section className="section">
        <div className="wrap split">
          <div><h2>Where we operate</h2></div>
          <div>
            <ul className="checks">
              <li><div><b>Northern Territory, now</b><span>Starting in Alice Springs (Mparntwe). The rules below are for the NT.</span></div></li>
              <li className="soon"><div><b>South Australia, coming soon</b><span>Regional towns only: {SA_TOWNS}. Sign up now and we'll be in touch once DingoGo is accredited in SA.</span></div></li>
            </ul>
            <details className="more">
              <summary>What SA rules ask of drivers and cars</summary>
              <div className="more__cols">
                <div>
                  <b>You</b>
                  <ul>
                    <li>SA driver accreditation (every 3 years, paid yearly) and operator accreditation (every 5 years)</li>
                    <li>Working with children check and a national police certificate</li>
                    <li>Commercial vehicle driver medical, less than 3 months old</li>
                    <li>Unrestricted licence held for at least 6 months</li>
                    <li>An ABN, and GST registration</li>
                  </ul>
                </div>
                <div>
                  <b>Your car</b>
                  <ul>
                    <li>Under 8 years old, with 4 doors and seats for 4 passengers</li>
                    <li>Inspected every year at an approved station (RAA or Rightway)</li>
                    <li>SA registration, with CTP upgraded to “small passenger vehicle”</li>
                    <li>Third-party property insurance, plus $5 million public liability</li>
                  </ul>
                </div>
              </div>
              <p className="dg-muted">We'll help you through each step when we launch. There's no SA passenger levy on trips in these towns.</p>
            </details>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap split">
          <div>
            <h2>What the NT requires of you</h2>
            <p className="section-intro">These are Northern Territory Government rules for every rideshare driver, not ours. We'll help you through each one.</p>
          </div>
          <ul className="checks">
            <li><div><b>A full NT driver licence, held for at least 12 months in the last 3 years</b><span>Open licence, no alcohol interlock condition. You must be at least 18½.</span></div></li>
            <li><div><b>An H endorsement and commercial passenger vehicle (CPV) identity card</b><span>Issued by the NT Motor Vehicle Registry after a short online knowledge test. The endorsement costs about $117, and your CPV ID card is for the rideshare class.</span></div></li>
            <li><div><b>A national police check and a medical, both less than 3 months old</b><span>We'll point you to local providers. Ask us about help with the cost.</span></div></li>
            <li><div><b>An ABN, and GST registration before your first trip</b><span>The ATO says rideshare drivers must register for GST from the first dollar. We'll walk you through it and give you the reports you need for your BAS.</span></div></li>
            <li><div><b>Disability awareness training</b><span>Our own requirement, run by us. It covers assistance animals, which every driver must carry.</span></div></li>
          </ul>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap split">
          <div>
            <h2>What the NT requires of your car</h2>
            <p className="section-intro">Any fuel type is fine. Electric and hybrid cars get offered trips first.</p>
          </div>
          <ul className="checks">
            <li><div><b>Under 13 years old, with 4 or more doors</b><span>Seats for 4 to 7 passengers, clean and in good condition.</span></div></li>
            <li><div><b>A rideshare Commercial Vehicle Licence (CVL)</b><span>From the NT Motor Vehicle Registry, in the Rideshare class. We'll help you apply.</span></div></li>
            <li><div><b>A roadworthy inspection less than 6 weeks old</b><span>You'll need it when you apply for the CVL.</span></div></li>
            <li><div><b>NT registration with CTP, plus at least third-party property insurance</b><span>The insurance policy must name you as a driver.</span></div></li>
            <li><div><b>Don't own a car?</b><span>You can drive someone else's car with the owner's written permission. Ask us about it.</span></div></li>
          </ul>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap split">
          <div><h2>Going electric</h2></div>
          <div className="prose">
            <p>Our goal is an all-electric fleet. We're starting with local drivers in their own cars, and electric and hybrid cars get trips first.</p>
            <p className="dg-note"><b>EV lease programme coming.</b> We're setting up a way for drivers to lease an electric car through us. Tick the box below and we'll let you know when it opens.</p>
            <p>Already approved? <a href={ANDROID_DRIVER_APK}>Download the DingoGo Driver app for Android</a>. The iPhone app is coming soon.</p>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap split">
          <div><h2>How earnings work</h2></div>
          <div className="prose">
            <ul>
              <li>You keep 75% of each fare. DingoGo's 25% service fee covers the app, insurance arrangements, support and marketing.</li>
              <li>Booking fees and the $1 NT passenger levy aren't counted in the fare; we pass the levy on to the NT Government.</li>
              <li>Tips go 100% to you. So do most late-cancellation fees.</li>
              <li>Promo codes and Dingo Points are paid for by DingoGo. You earn on the full fare.</li>
              <li>Fuel, servicing and running costs for your car are yours, and you can claim them as business expenses.</li>
              <li>The driver app shows every dollar: fares, our fee, tips, cash you've collected, and the GST you'll owe on your BAS.</li>
              <li>Payouts go straight to your bank account weekly.</li>
            </ul>
            <p className="dg-muted">How much you make depends on the hours you drive and how busy town is. We'll talk through realistic numbers with you before you start.</p>
          </div>
        </div>
      </section>

      <section className="section band" id="apply">
        <div className="wrap split">
          <div><h2>Register your interest</h2><p className="section-intro">We'll call you for a yarn about your car, the paperwork and when you'd like to drive. It's fine if you haven't started on the accreditation yet.</p></div>
          <div className="panel" style={{ color: 'var(--text)' }}>
            {f.done ? <Sent title="Thanks for applying.">We'll call you within a few days to talk about next steps.</Sent> : (
              <form className="form-grid" onSubmit={(e) => f.submit(withCar(formData(e)))}>
                <Field label="Full name" name="name" required autoComplete="name" />
                <Field label="Mobile" name="phone" type="tel" required autoComplete="tel" />
                <Field label="Email" name="email" type="email" required autoComplete="email" />
                <Field label="Suburb or town" name="suburb" autoComplete="address-level2" />
                <label className="dg-field full"><span>Where will you drive?</span>
                  <select className="dg-select" name="drive_state" defaultValue="NT">
                    <option value="NT">Northern Territory (Alice Springs)</option>
                    <option value="SA">South Australia, regional towns (coming soon)</option>
                  </select>
                </label>
                <Field label="Years holding a full licence" name="has_licence_years" type="number" min={0} max={70} />
                <Field label="Languages you speak" name="languages" placeholder="English, Arrernte…" />
                <Field label="Your car: make and model" name="car_make_model" placeholder="Toyota Camry" maxLength={80} />
                <Field label="Year" name="car_year" placeholder="2019" inputMode="numeric" maxLength={4} />
                <label className="dg-field full"><span>Fuel type <span className="dg-muted" style={{ fontWeight: 400 }}>(optional)</span></span>
                  <select className="dg-select" name="car_fuel" defaultValue="">
                    <option value="">Choose…</option>
                    {FUELS.map((x) => <option key={x} value={x}>{x}</option>)}
                  </select>
                </label>
                <label className="dg-check full"><input type="checkbox" name="car_owner" defaultChecked /><span>I'm the registered owner of this car</span></label>
                <label className="dg-check full"><input type="checkbox" name="has_cpv_authority" /><span>I already have an NT H endorsement</span></label>
                <label className="dg-check full"><input type="checkbox" name="wants_lease" /><span>Tell me when the EV lease programme opens</span></label>
                <Area label="Anything else" name="message" placeholder="When you'd like to drive, questions about your car…" />
                {f.error && <p className="dg-error full">{f.error}</p>}
                <div className="full"><button className="dg-btn" disabled={f.busy}>{f.busy ? 'Sending…' : 'Send my details'}</button></div>
              </form>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
