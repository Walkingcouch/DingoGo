import { useEffect, useState } from 'react';
import { get } from '@dingogo/shared';
import { PageHead } from '../Layout';
import { Area, Field, formData, Sent, useSubmit } from '../forms';
import { useMeta } from '../meta';

type Partner = { id: string; name: string; kind: string; address: string; aboriginal_owned: boolean };

export default function Rewards() {
  useMeta('Rewards & partners', 'Earn Dingo Points on every DingoGo trip and swap them for coffee at partner cafés or money off your next ride.');
  const [partners, setPartners] = useState<Partner[] | null>(null);
  const f = useSubmit('/public/enquiries');
  useEffect(() => { get<{ partners: Partner[] }>('/public/partners').then((r) => setPartners(r.partners)).catch(() => setPartners([])); }, []);
  return (
    <>
      <PageHead title="Rides that end in coffee">Every trip earns Dingo Points. Spend them at local cafés or take money off your next ride.</PageHead>
      <section className="section">
        <div className="wrap split">
          <div><h2>How points work</h2></div>
          <div>
            <ul className="checks">
              <li><div><b>Earn 10 points for every $1</b><span>On rides, deliveries and tours, paid by card, credit, cash or account.</span></div></li>
              <li><div><b>Free coffee from 800 points</b><span>Pick a reward in the app and show the code at the counter. Codes last 30 days.</span></div></li>
              <li><div><b>Or take money off a trip</b><span>100 points is $1 off, up to half the fare.</span></div></li>
              <li><div><b>Bring a friend, get 500 points each</b><span>Share your code. You both get points after their first trip.</span></div></li>
            </ul>
          </div>
        </div>
      </section>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap">
          <h2>Partner cafés</h2>
          <p className="section-intro">Partners shown here are examples while we sign up our first businesses.</p>
          {partners === null ? <p className="dg-muted">Loading…</p> : (
            <ul className="partners">
              {partners.map((p) => (
                <li key={p.id}><b>{p.name}</b><span className="dg-muted">{p.address}</span>{p.aboriginal_owned && <><br /><span className="dg-chip dg-chip--ochre" style={{ marginTop: 6 }}>Aboriginal-owned</span></>}</li>
              ))}
            </ul>
          )}
        </div>
      </section>
      <section className="section band" id="partner">
        <div className="wrap split">
          <div>
            <h2>Become a partner</h2>
            <p className="section-intro">DingoGo customers come to you to claim a reward. We pay you an agreed amount for each one redeemed, monthly. Your staff check codes in a simple web portal; no new hardware.</p>
          </div>
          <div className="panel" style={{ color: 'var(--text)' }}>
            {f.done ? <Sent title="Thanks.">We'll call you to talk through how it works.</Sent> : (
              <form className="form-grid" onSubmit={(e) => f.submit({ kind: 'partner', ...formData(e) })}>
                <Field label="Your name" name="name" required autoComplete="name" />
                <Field label="Business" name="organisation" required autoComplete="organization" />
                <Field label="Email" name="email" type="email" required autoComplete="email" />
                <Field label="Phone" name="phone" type="tel" autoComplete="tel" />
                <Area label="Tell us about your business" name="message" required rows={3} />
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
