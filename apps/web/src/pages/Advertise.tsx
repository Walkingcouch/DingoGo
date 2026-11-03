import { PageHead } from '../Layout';
import { Area, Field, formData, Sent, useSubmit } from '../forms';
import { useMeta } from '../meta';

export default function Advertise() {
  useMeta('Advertise', 'Advertise your Alice Springs business on DingoGo, on roof screens (subject to NT approval) and inside the app.');
  const f = useSubmit('/public/enquiries');
  return (
    <>
      <PageHead title="Put your business on the road">Local ads on DingoGo cars as they move around town, shown at the hours and in the places that suit you.</PageHead>
      <section className="section">
        <div className="wrap split">
          <div><h2>Roof screens</h2></div>
          <div className="prose">
            <p>We plan to fit slim LED screens to the roof of each car. Your message plays in rotation with a handful of others, and you choose:</p>
            <ul>
              <li>the hours it runs, for example breakfast for a café or evenings for a restaurant</li>
              <li>an area, so it only plays when the car is near your shop</li>
              <li>a budget, charged per thousand plays, with a report showing how many times and where it played</li>
            </ul>
            <p className="dg-note"><b>Roof screens are subject to approval.</b> NT rules say rideshare cars can't carry signs that make them look available for hire, like a taxi. We're seeking written confirmation from the NT Passenger Transport Division before switching screens on. Until then we're taking expressions of interest, and nothing is charged.</p>
            <h3>Community messages</h3>
            <p>Health services and community organisations can run public-interest messages, such as heat warnings, health clinics or local events, at a reduced rate or free.</p>
            <h3>In the app</h3>
            <p>Partner cafés and shops can also offer rewards in the DingoGo app. See <a href="/rewards">rewards and partners</a>.</p>
          </div>
        </div>
      </section>
      <section className="section band">
        <div className="wrap split">
          <div><h2>Register your interest</h2><p className="section-intro">Tell us about your business and what you'd like to promote.</p></div>
          <div className="panel" style={{ color: 'var(--text)' }}>
            {f.done ? <Sent title="Thanks, we'll be in touch." onAgain={f.reset}>We'll contact you when roof screens are approved, or sooner about in-app offers.</Sent> : (
              <form className="form-grid" onSubmit={(e) => f.submit({ kind: 'advertise', ...formData(e) })}>
                <Field label="Your name" name="name" required autoComplete="name" />
                <Field label="Business" name="organisation" autoComplete="organization" />
                <Field label="Email" name="email" type="email" required autoComplete="email" />
                <Field label="Phone" name="phone" type="tel" autoComplete="tel" />
                <Area label="What would you like to promote?" name="message" required />
                {f.error && <p className="dg-error full">{f.error}</p>}
                <div className="full"><button className="dg-btn" disabled={f.busy}>{f.busy ? 'Sending…' : 'Send enquiry'}</button></div>
              </form>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
