import { money } from '@dingogo/shared';
import { PageHead } from '../Layout';
import { Area, Field, formData, Sent, useSubmit } from '../forms';
import { rule, useConfig } from '../config';
import { useMeta } from '../meta';
import { FaqSection } from '../components/Faq';

export default function Business() {
  useMeta();
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
      <AccountApplication />
      <FaqSection set="business" />
      <section className="section band" id="enquire">
        <div className="wrap split">
          <div>
            <h2>Ask for a quote</h2>
            <p className="section-intro">Events, weddings, conferences and anything else. We reply within one business day.</p>
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

const KINDS: [string, string][] = [['business', 'Business'], ['government', 'Government agency'], ['health_service', 'Health service'],
  ['ndis_plan_manager', 'NDIS plan manager'], ['community_org', 'Community organisation'], ['aboriginal_corporation', 'Aboriginal corporation']];
const NEEDS: [string, string][] = [['cost_centres', 'Cost centres'], ['approvals', 'Approval of trips over an amount'], ['po_numbers', 'Purchase order (PO) numbers'],
  ['ndis', 'NDIS plan-managed invoices'], ['recurring', 'Regular trips (dialysis, clinics, rosters)'], ['parcels', 'Courier deliveries']];

/** Round 24: self-serve business account application. DingoGo checks it (ABN, billing) and texts the contact when it is open. */
function AccountApplication() {
  const f = useSubmit('/public/business-applications');
  function send(e: React.FormEvent<HTMLFormElement>) {
    const d = formData(e);
    const form = e.currentTarget;
    const needs = NEEDS.map(([k]) => k).filter((k) => (form.elements.namedItem(`need_${k}`) as HTMLInputElement | null)?.checked);
    for (const k of NEEDS.map(([n]) => `need_${n}`)) delete d[k];
    const spend = d.expected_monthly ? Math.round(Number(d.expected_monthly) * 100) : undefined;
    delete d.expected_monthly;
    void f.submit({ ...d, needs, ...(spend ? { expected_monthly_cents: spend } : {}) });
  }
  return (
    <section className="section" id="apply" aria-labelledby="apply-h">
      <div className="wrap split">
        <div>
          <h2 id="apply-h">Open a business account</h2>
          <p className="section-intro">For businesses, government agencies, health services, NDIS plan managers and community organisations.</p>
          <ul className="ticks">
            <li>One tax invoice a month, with each trip, traveller, cost centre and PO number</li>
            <li>Staff book for themselves or for visitors and clients, who get a text with the trip</li>
            <li>Cost centres, trip purposes, approval of trips over an amount, monthly budgets</li>
            <li>Regular trips booked for you, skipping public holidays</li>
            <li>Exports for Xero and MYOB</li>
          </ul>
          <p className="dg-muted">We check every application within one business day and text the contact mobile when the account is open. That mobile signs in to the DingoGo app as the account manager.</p>
        </div>
        <div className="panel">
          {f.done ? <Sent title="Application sent.">Thanks. We'll check your ABN and billing details and text you within one business day.</Sent> : (
            <form className="form-grid" onSubmit={send}>
              <Field label="Organisation" name="organisation" required autoComplete="organization" full />
              <label className="dg-field"><span>Type</span>
                <select className="dg-select" name="kind" defaultValue="business">{KINDS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
              </label>
              <Field label="ABN" name="abn" required inputMode="numeric" placeholder="11 digits" />
              <Field label="Billing email" name="billing_email" type="email" required />
              <Field label="Address" name="address" autoComplete="street-address" />
              <Field label="Your name" name="contact_name" required autoComplete="name" />
              <Field label="Your mobile" name="contact_phone" type="tel" required autoComplete="tel" hint="We text this number when the account is open" />
              <Field label="Expected spend a month ($)" name="expected_monthly" type="number" min={0} max={100000} />
              <fieldset className="dg-field full" style={{ border: 0, padding: 0, margin: 0 }}>
                <legend style={{ fontWeight: 600, marginBottom: 6 }}>What do you need? <span className="dg-muted" style={{ fontWeight: 400 }}>(optional)</span></legend>
                {NEEDS.map(([k, l]) => <label key={k} className="check"><input type="checkbox" name={`need_${k}`} /> {l}</label>)}
              </fieldset>
              <Area label="Anything else" name="notes" placeholder="Number of staff, where you travel, how you pay invoices…" />
              <label className="check full"><input type="checkbox" name="agree" required /> I can act for this organisation and agree that invoices are paid within the agreed terms</label>
              {f.error && <p className="dg-error full" role="alert">{f.error}</p>}
              <div className="full"><button className="dg-btn" disabled={f.busy}>{f.busy ? 'Sending…' : 'Apply for an account'}</button></div>
            </form>
          )}
        </div>
      </div>
    </section>
  );
}
