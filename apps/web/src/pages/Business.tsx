import { money } from '@dingogo/shared';
import { PageHead } from '../Layout';
import { Area, Field, formData, Sent, useSubmit } from '../forms';
import { rule, useConfig } from '../config';
import { useMeta } from '../meta';

export default function Business() {
  useMeta('Business & events', 'Business accounts, NDIS plan-manager invoicing, community organisation billing and event transport in Alice Springs.');
  const cfg = useConfig();
  const hourly = rule(cfg, 'hourly');
  const f = useSubmit('/public/hire-requests');
  return (
    <>
      <PageHead tone="night" title="Business accounts and event transport">One monthly invoice for staff and clients, and cars on call for conferences, weddings and festivals.</PageHead>
      <section className="section">
        <div className="wrap why">
          <div>
            <h3>Business accounts</h3>
            <p>Staff ride on the company account and you get one tax invoice a month with every trip listed. Set a monthly limit, choose who can book, and get a discount on regular volume. Same-day courier jobs go on the same account.</p>
          </div>
          <div>
            <h3>NDIS participants and plan managers</h3>
            <p>Participants can use their transport funding with us. We invoice the plan manager directly each month, with the participant's NDIS number and each trip itemised, or the participant can claim from their tax invoice.</p>
          </div>
          <div>
            <h3>Community organisations</h3>
            <p>Aboriginal corporations, health services and community groups can book trips for clients by phone or online and be invoiced. Clients don't need a smartphone or a bank card.</p>
          </div>
          <div>
            <h3>Events, weddings and conferences</h3>
            <p>Airport transfers for delegates, cars between venues, a shuttle home after the reception. Hourly hire is {hourly ? money(hourly.per_min_cents * 60) : '$75'} per car per hour with a one-hour minimum, or ask for a fixed quote.</p>
          </div>
        </div>
      </section>
      <section className="section band" id="enquire">
        <div className="wrap split">
          <div>
            <h2>Ask for a quote or an account</h2>
            <p className="section-intro">We reply within one business day. For an account, include your ABN and billing email.</p>
          </div>
          <div className="panel" style={{ color: 'var(--text)' }}>
            {f.done ? <Sent title="Request sent." onAgain={f.reset}>Thanks. We'll be in touch within one business day.</Sent> : (
              <form className="form-grid" onSubmit={(e) => f.submit(formData(e))}>
                <label className="dg-field full"><span>What do you need?</span>
                  <select className="dg-select" name="kind" defaultValue="corporate">
                    <option value="corporate">Business account</option>
                    <option value="ndis">NDIS plan-manager billing</option>
                    <option value="event">Event transport</option>
                    <option value="wedding">Wedding</option>
                    <option value="conference">Conference transfers</option>
                    <option value="festival">Festival</option>
                    <option value="other">Something else</option>
                  </select>
                </label>
                <Field label="Your name" name="contact_name" required autoComplete="name" />
                <Field label="Organisation" name="organisation" autoComplete="organization" />
                <Field label="Email" name="contact_email" type="email" required autoComplete="email" />
                <Field label="Phone" name="contact_phone" type="tel" autoComplete="tel" />
                <Field label="Date of event" name="event_date" type="date" />
                <Field label="Number of people" name="passengers" type="number" min={1} max={500} />
                <Area label="Details" name="details" placeholder="Times, venues, ABN, billing email…" />
                {f.error && <p className="dg-error full">{f.error}</p>}
                <div className="full"><button className="dg-btn" disabled={f.busy}>{f.busy ? 'Sending…' : 'Send request'}</button></div>
              </form>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
