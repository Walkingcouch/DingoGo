import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import mascot from './assets/mascot-clean.png';
import { contact, useConfig } from './config';
import { RIDER_URL } from './Estimator';
import { Scene, type SceneTone } from './Scene';

const NAV = [
  ['/rides', 'Ride'], ['/parcels', 'Send'], ['/tours', 'Tours'], ['/business', 'Business'], ['/drive', 'Drive'], ['/about', 'About'],
] as const;

export function Layout() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => {
    setOpen(false);
    if (loc.hash) document.getElementById(loc.hash.slice(1))?.scrollIntoView();
    else window.scrollTo(0, 0);
  }, [loc.pathname, loc.hash]);
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="wrap head-row">
          <Link to="/" className="brand" aria-label="DingoGo home">
            <span className="brand-mark"><img src={mascot} alt="" /></span><b>DingoGo</b>
          </Link>
          <nav id="site-nav" className={`nav${open ? ' open' : ''}`} aria-label="Main">
            {NAV.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
            <Link to="/#app" className="nav-app">Get the app</Link>
          </nav>
          <a href={RIDER_URL} className="dg-btn head-book">Book</a>
          <button className="menu-btn" aria-expanded={open} aria-controls="site-nav" onClick={() => setOpen(!open)}>
            <span aria-hidden="true" className={`burger${open ? ' x' : ''}`}><i /><i /><i /></span><span className="sr-only">{open ? 'Close menu' : 'Open menu'}</span>
          </button>
        </div>
      </header>
      <main id="main"><Outlet /></main>
      <Footer />
    </>
  );
}

function Footer() {
  const c = contact(useConfig());
  return (
    <footer className="site-footer">
      <Scene tone="night" height={110} sun={false} stars ground="transparent" className="foot-scene" />
      <div className="wrap">
        <div className="foot-top">
          <p className="foot-ack">
            DingoGo operates on Arrernte Country. We acknowledge the Arrernte people, the Traditional Owners of Mparntwe (Alice Springs), and pay our respects to Elders past and present.
          </p>
          <div className="foot-contact">
            <a className="foot-phone" href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a>
            <a href={`mailto:${c.email}`}>{c.email}</a>
            <span>{c.hours}</span>
          </div>
        </div>
        <div className="foot-cols">
          <div>
            <h2>Get around</h2>
            <ul><li><Link to="/rides">Rides</Link></li><li><Link to="/parcels">Send a parcel</Link></li><li><Link to="/tours">Private tours</Link></li><li><Link to="/rewards">Rewards and partner cafés</Link></li><li><a href={RIDER_URL}>Open the web app</a></li></ul>
          </div>
          <div>
            <h2>Work with us</h2>
            <ul><li><Link to="/business">Business, NDIS and events</Link></li><li><Link to="/drive">Drive with us</Link></li><li><Link to="/advertise">Advertise</Link></li><li><Link to="/rewards#partner">Become a partner café</Link></li></ul>
          </div>
          <div>
            <h2>Help</h2>
            <ul><li><Link to="/help">Help and FAQ</Link></li><li><Link to="/safety">Safety</Link></li><li><Link to="/about">About DingoGo</Link></li></ul>
          </div>
          <div>
            <h2>Policies</h2>
            <ul><li><Link to="/legal/privacy">Privacy</Link></li><li><Link to="/legal/terms">Terms</Link></li><li><Link to="/legal/cancellations">Cancellations and refunds</Link></li><li><Link to="/legal/prohibited-items">Prohibited items</Link></li></ul>
          </div>
        </div>
        <div className="foot-base">
          <span className="brand foot-brand"><span className="brand-mark"><img src={mascot} alt="" /></span><b>DingoGo</b></span>
          <p>Aboriginal-owned, all-electric rides and deliveries. Owned by Johnathan Ah Chee and Micah Bartlett. In an emergency call 000.</p>
          <p>© {new Date().getFullYear()} DingoGo Rideshare &amp; Courier</p>
        </div>
      </div>
    </footer>
  );
}

export function PageHead({ title, children, draft, tone = 'dusk' }: { title: string; children?: React.ReactNode; draft?: boolean; tone?: SceneTone }) {
  return (
    <div className={`page-head page-head--${tone}`}>
      <Scene tone={tone} className="page-head-scene" stars={tone === 'dusk' || tone === 'night'} />
      <div className="wrap page-head-copy">
        {draft && <span className="draft-flag">Draft for legal review</span>}
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
    </div>
  );
}
