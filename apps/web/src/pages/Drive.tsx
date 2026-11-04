import { ANDROID_DRIVER_APK } from '../Estimator';
import { PageHead } from '../Layout';
import { Area, Field, formData, Sent, useSubmit } from '../forms';
import { useMeta } from '../meta';

export default function Drive() {
  useMeta('Drive with us', 'Drive an electric car for DingoGo in Alice Springs. What the NT requires, how we help you get accredited, and how earnings work.');
  const f = useSubmit('/public/driver-applications');
  return (
    <>
      <PageHead title="Drive with DingoGo">Drive a new electric car around your own town, with a local team behind you. Here's exactly what it takes.</PageHead>
      <section className="section">
        <div className="wrap split">
          <div>
            <h2>What the NT requires</h2>
            <p className="section-intro">These are Northern Territory Government rules for every rideshare driver, not ours. We'll help you through each one.</p>
          </div>
          <ul className="checks">
            <li><div><b>A full NT driver licence, held for at least 12 months in the last 3 years</b><span>Open licence, no alcohol interlock condition. You must be at least 18½.</span></div></li>
            <li><div><b>An H endorsement and commercial passenger vehicle (CPV) identity card</b><span>Issued by the NT Motor Vehicle Registry after a short online knowledge test. The endorsement costs about $117.</span></div></li>
            <li><div><b>A national police check and a medical, both less than 3 months old</b><span>We'll point you to local providers. Ask us about help with the cost.</span></div></li>
            <li><div><b>An ABN, and GST registration before your first trip</b><span>The ATO says rideshare drivers must register for GST from the first dollar. We'll walk you through it and give you the reports you need for your BAS.</span></div></li>
            <li><div><b>Disability awareness training</b><span>Our own requirement, run by us. It covers assistance animals, which every driver must carry.</span></div></li>
          </ul>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap split">
          <div><h2>The car</h2></div>
          <div className="prose">
            <p>You can drive a DingoGo fleet car on shifts, or lease your own BYD Dolphin through us so you can use it after hours too. As a guide, finance through EV Direct Finance works out to around <b>$113 a week over 7 years</b> for a car with a drive-away price of about $30,650. That figure is indicative only; your actual repayment depends on your credit assessment and the lender's terms.</p>
            <p>Already approved? <a href={ANDROID_DRIVER_APK}>Download the DingoGo Driver app for Android</a>. The iPhone app is coming soon.</p>
            <p>The car is charged at home overnight. We log each charging session and pay you back for the electricity, so you're not out of pocket.</p>
          </div>
        </div>
      </section>

      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap split">
          <div><h2>How earnings work</h2></div>
          <div className="prose">
            <ul>
              <li>You keep 80% of each fare. DingoGo's 20% service fee covers the app, insurance arrangements, support and marketing.</li>
              <li>Booking fees and the $1 NT passenger levy aren't counted in the fare; we pass the levy on to the NT Government.</li>
              <li>Tips go 100% to you. So do most late-cancellation fees.</li>
              <li>Promo codes and Dingo Points are paid for by DingoGo. You earn on the full fare.</li>
              <li>The driver app shows every dollar: fares, our fee, tips, cash you've collected, lease repayments and charging credits, and the GST you'll owe on your BAS.</li>
              <li>Payouts go straight to your bank account weekly.</li>
            </ul>
            <p className="dg-muted">How much you make depends on the hours you drive and how busy town is. We'll talk through realistic numbers with you before you commit to a lease.</p>
          </div>
        </div>
      </section>

      <section className="section band" id="apply">
        <div className="wrap split">
          <div><h2>Register your interest</h2><p className="section-intro">We'll call you for a yarn about shifts, the car and the paperwork. It's fine if you haven't started on the accreditation yet.</p></div>
          <div className="panel" style={{ color: 'var(--text)' }}>
            {f.done ? <Sent title="Thanks for applying.">We'll call you within a few days to talk about next steps.</Sent> : (
              <form className="form-grid" onSubmit={(e) => f.submit(formData(e))}>
                <Field label="Full name" name="name" required autoComplete="name" />
                <Field label="Mobile" name="phone" type="tel" required autoComplete="tel" />
                <Field label="Email" name="email" type="email" required autoComplete="email" />
                <Field label="Suburb" name="suburb" autoComplete="address-level2" />
                <Field label="Years holding a full licence" name="has_licence_years" type="number" min={0} max={70} />
                <Field label="Languages you speak" name="languages" placeholder="English, Arrernte…" />
                <label className="dg-check full"><input type="checkbox" name="has_cpv_authority" /><span>I already have an NT H endorsement</span></label>
                <label className="dg-check full"><input type="checkbox" name="wants_lease" /><span>I'm interested in leasing my own car</span></label>
                <Area label="Anything else" name="message" placeholder="When you'd like to drive, questions about the car…" />
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
