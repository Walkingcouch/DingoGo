import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { Ranges } from '@dingogo/shared';
import mascot from './assets/mascot-clean.png';
import { contact, useConfig } from './config';

const NAV = [
  ['/rides', 'Rides'], ['/parcels', 'Parcels'], ['/tours', 'Tours'], ['/business', 'Business & events'],
  ['/drive', 'Drive with us'], ['/safety', 'Safety'], ['/about', 'About'],
] as const;

export function Layout() {
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [loc.pathname]);
  return (
    <>
      <a className="skip" href="#main">Skip to content</a>
      <header className="site-header">
        <div className="wrap">
          <Link to="/" className="brand" aria-label="DingoGo home"><img src={mascot} alt="" /><b>DingoGo</b></Link>
          <button className="menu-btn" aria-expanded={open} aria-controls="site-nav" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Menu'}</button>
          <nav id="site-nav" className={`nav${open ? ' open' : ''}`} aria-label="Main">
            {NAV.map(([to, label]) => <NavLink key={to} to={to}>{label}</NavLink>)}
            <Link to="/#app" className="dg-btn">Get the app</Link>
          </nav>
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
      <div className="ranges"><Ranges height={40} /></div>
      <div className="wrap">
        <p className="foot-ack">DingoGo operates on Arrernte Country. We acknowledge the Arrernte people, the Traditional Owners of Mparntwe (Alice Springs), and pay our respects to Elders past and present.</p>
        <div className="foot-cols">
          <div>
            <h2>DingoGo Rideshare &amp; Courier</h2>
            <p style={{ margin: 0 }}>Aboriginal-owned, all-electric rides and deliveries in Alice Springs.</p>
            <p>Phone <a href={`tel:${c.phone.replace(/\s/g, '')}`}>{c.phone}</a><br />Email <a href={`mailto:${c.email}`}>{c.email}</a><br />{c.hours}</p>
          </div>
          <div>
            <h2>Get around</h2>
            <ul><li><Link to="/rides">Rides</Link></li><li><Link to="/parcels">Send a parcel</Link></li><li><Link to="/tours">Private tours</Link></li><li><Link to="/business">Business &amp; events</Link></li><li><Link to="/rewards">Rewards &amp; partners</Link></li></ul>
          </div>
          <div>
            <h2>Work with us</h2>
            <ul><li><Link to="/drive">Drive with us</Link></li><li><Link to="/advertise">Advertise</Link></li><li><Link to="/rewards#partner">Become a partner café</Link></li><li><Link to="/about">About</Link></li></ul>
          </div>
          <div>
            <h2>Help</h2>
            <ul><li><Link to="/help">Help &amp; FAQ</Link></li><li><Link to="/safety">Safety</Link></li><li><Link to="/legal/privacy">Privacy</Link></li><li><Link to="/legal/terms">Terms</Link></li><li><Link to="/legal/cancellations">Cancellations &amp; refunds</Link></li><li><Link to="/legal/prohibited-items">Prohibited items</Link></li></ul>
          </div>
        </div>
        <p className="foot-small">In an emergency call 000. © {new Date().getFullYear()} DingoGo Rideshare &amp; Courier. Owned by Johnathan Ah Chee and Micah Bartlett.</p>
      </div>
    </footer>
  );
}

export function PageHead({ title, children, draft }: { title: string; children?: React.ReactNode; draft?: boolean }) {
  return (
    <div className="page-head">
      <div className="wrap">
        {draft && <span className="draft-flag">Draft for legal review</span>}
        <h1>{title}</h1>
        {children && <p>{children}</p>}
      </div>
      <div className="ranges"><Ranges height={48} /></div>
    </div>
  );
}
