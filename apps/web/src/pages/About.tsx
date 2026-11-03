import { PageHead } from '../Layout';
import { contact, useConfig } from '../config';
import { useMeta } from '../meta';

export default function About() {
  useMeta('About', 'DingoGo is an Aboriginal-owned electric rideshare and courier business in Alice Springs, owned by Johnathan Ah Chee and Micah Bartlett.');
  const cfg = useConfig();
  const c = contact(cfg);
  const zones = cfg?.zones ?? [];
  return (
    <>
      <PageHead title="A local business, on local Country">DingoGo is an Aboriginal-owned electric vehicle network for rides and deliveries across the Northern Territory, starting in Mparntwe.</PageHead>
      <section className="section">
        <div className="wrap split">
          <div><h2>Why we started</h2></div>
          <div className="prose">
            <p>Getting around Alice Springs can be hard: a few taxis, long waits at busy times, and few options for people without a car, a smartphone or a bank card. We wanted transport that is affordable and reliable, that keeps money in town, and that doesn't burn fuel trucked in from a thousand kilometres away.</p>
            <p>Our aim is simple: affordable, reliable and clean transport, owned and run by Aboriginal people, that serves everyone in town and creates local jobs as it grows.</p>
          </div>
        </div>
      </section>
      <section className="section" style={{ paddingTop: 0 }}>
        <div className="wrap split">
          <div><h2>Who we are</h2></div>
          <div className="prose">
            <p><b>Johnathan Ah Chee</b> is a founder and co-owner of DingoGo, and the founder of Aperrke Technologies. <b>Micah Bartlett</b> is co-owner.</p>
            <p>Our booking platform, website and apps are being built with <b>Spinifex Valley</b>, a digital studio, and will be supported in-house as we grow. We work with the Northern Territory Government, including its permits team and a Small Business Champion.</p>
          </div>
        </div>
      </section>
      <section className="section band">
        <div className="wrap split">
          <div><h2>Where we're going</h2><p className="section-intro">We'll only open in a new town once we have local drivers and a plan for charging there.</p></div>
          <ol className="steps">
            <li><div><b>Alice Springs</b><span>Launching with three BYD Dolphins: rides, parcels, pet rides, tours and event hire.</span></div></li>
            <li><div><b>Tennant Creek and Yulara</b><span>The next communities, once charging along the Stuart Highway allows. Yulara is about 450 km from Alice, beyond a single charge, so we'll need charging on the way.</span></div></li>
            <li><div><b>Darwin and other regional towns</b><span>Bringing what we've learned to the Top End.</span></div></li>
          </ol>
        </div>
      </section>
      <section className="section">
        <div className="wrap split">
          <div><h2>Contact</h2></div>
          <div className="prose">
            <p>Email <a href={`mailto:${c.email}`}>{c.email}</a><br />Phone <a href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a><br />Alice Springs NT 0870</p>
            <p className="dg-muted">Media and partnership enquiries are welcome.{zones.length ? ` Currently serving ${zones.filter((z) => z.active).map((z) => z.name).join(', ')}.` : ''}</p>
          </div>
        </div>
      </section>
    </>
  );
}
