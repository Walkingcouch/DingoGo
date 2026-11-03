import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, Link } from 'react-router-dom';
import '@dingogo/shared/brand.css';
import './admin.css';
import { Login, connectRealtime, get, getToken, initAuth, setToken, type Msg } from '@dingogo/shared';
import mascot from '@dingogo/shared/assets/mascot.png';
import { ToastProvider } from './ui';
import { Ops } from './ctx';
import Live from './pages/Live';
import Dashboard from './pages/Dashboard';
import Trips from './pages/Trips';
import Drivers from './pages/Drivers';
import Fleet from './pages/Fleet';
import Pricing from './pages/Pricing';
import Loyalty from './pages/Loyalty';
import Ads from './pages/Ads';
import Business from './pages/Business';
import Safety from './pages/Safety';
import Support from './pages/Support';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

initAuth('admin');


const NAV: { group: string; items: [string, string, string?][] }[] = [
  { group: 'Operations', items: [['/live', 'Live map'], ['/dashboard', 'Dashboard'], ['/trips', 'Trips'], ['/safety', 'Safety & compliance', 'safety'], ['/support', 'Support & inbox', 'inbox']] },
  { group: 'People & fleet', items: [['/drivers', 'Drivers', 'drivers'], ['/fleet', 'Fleet & charging'], ['/business', 'Business accounts']] },
  { group: 'Commercial', items: [['/pricing', 'Pricing & tours'], ['/loyalty', 'Loyalty & vouchers'], ['/ads', 'Roof advertising']] },
  { group: 'Admin', items: [['/reports', 'Reports'], ['/settings', 'Settings & broadcast']] },
];

function Shell({ me, onSignOut }: { me: any; onSignOut: () => void }) {
  const [events, setEvents] = useState<Msg[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [openSos, setOpenSos] = useState<any[]>([]);
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  const refreshRef = useRef<() => void>(() => {});

  const refreshCounts = async () => {
    try {
      const d = await get('/admin/dashboard');
      const l = d.live;
      setCounts({ safety: l.open_sos + l.open_flags, inbox: l.open_tickets + l.new_hire_requests + l.new_applications, drivers: l.pending_drivers + l.pending_docs, sos: l.open_sos });
      if (l.open_sos) setOpenSos((await get('/admin/sos')).items.filter((s: any) => s.status !== 'resolved'));
      else setOpenSos([]);
    } catch { /* ignore */ }
  };
  refreshRef.current = refreshCounts;

  useEffect(() => {
    void refreshCounts();
    const rt = connectRealtime((m) => {
      if (m.channel !== 'ops') return;
      setEvents((e) => [m, ...e].slice(0, 200));
      if (/^(sos|support|compliance|application|hire|driver\.document)/.test(m.type)) void refreshRef.current();
    });
    const t = setInterval(() => void refreshRef.current(), 30000);
    return () => { rt.close(); clearInterval(t); };
  }, []);
  useEffect(() => setMenu(false), [loc.pathname]);

  return (
    <Ops.Provider value={{ events, counts, refreshCounts, openSos }}>
      <div className="shell">
        <aside className={'rail' + (menu ? ' open' : '')} aria-label="Main navigation">
          <Link to="/live" className="rail__brand"><img src={mascot} alt="" /><span><strong>DingoGo</strong><small>Operations</small></span></Link>
          <nav>
            {NAV.map((g) => (
              <React.Fragment key={g.group}>
                <div className="rail__group">{g.group}</div>
                {g.items.map(([to, label, badge]) => (
                  <NavLink key={to} to={to} className={({ isActive }) => 'nav' + (isActive ? ' active' : '')}>
                    <span>{label}</span>
                    {badge && counts[badge] > 0 && <span className={'badge' + (badge === 'safety' && counts.sos ? ' badge--red' : '')}>{counts[badge]}</span>}
                  </NavLink>
                ))}
              </React.Fragment>
            ))}
          </nav>
          <div className="rail__foot">Signed in as {me?.name || me?.phone}<br /><button onClick={onSignOut}>Sign out</button></div>
        </aside>
        {menu && <div className="scrim" style={{ zIndex: 1100 }} onClick={() => setMenu(false)} />}
        <div className="main">
          {openSos.length > 0 && (
            <div className="sos-banner" role="alert">
              <span className="pulse" aria-hidden="true" />
              <span>{openSos.length === 1 ? 'Emergency alert' : `${openSos.length} emergency alerts`}: {openSos.map((s) => `${s.user_name} (${s.role}${s.trip_ref ? `, ${s.trip_ref}` : ''})`).join('; ')}</span>
              <Link to="/safety">Respond now</Link>
            </div>
          )}
          <button className="dg-btn dg-btn--ghost dg-btn--sm menu-btn" style={{ margin: '12px 16px 0' }} onClick={() => setMenu(true)} aria-label="Open menu">Menu</button>
          <Routes>
            <Route path="/live" element={<Live />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/trips" element={<Trips />} />
            <Route path="/drivers" element={<Drivers />} />
            <Route path="/fleet" element={<Fleet />} />
            <Route path="/pricing" element={<Pricing />} />
            <Route path="/loyalty" element={<Loyalty />} />
            <Route path="/ads" element={<Ads />} />
            <Route path="/business" element={<Business />} />
            <Route path="/safety" element={<Safety />} />
            <Route path="/support" element={<Support />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/live" replace />} />
          </Routes>
        </div>
      </div>
    </Ops.Provider>
  );
}

function App() {
  const [me, setMe] = useState<any>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!getToken()) { setReady(true); return; }
    get('/me').then((r) => setMe(r.user)).catch(() => setToken(null)).finally(() => setReady(true));
  }, []);
  if (!ready) return null;
  if (!me) return <Login title="DingoGo operations" subtitle="Staff sign-in for dispatch and administration." onDone={(r) => setMe(r.user)} />;
  return (
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <ToastProvider>
        <Shell me={me} onSignOut={() => { setToken(null); setMe(null); }} />
      </ToastProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
