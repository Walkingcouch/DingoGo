import React, { useEffect, useRef, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter, NavLink, Navigate, Route, Routes, useLocation, useNavigate, Link } from 'react-router-dom';
import '@dingogo/shared/brand.css';
import './admin.css';
import { Login, connectRealtime, get, getToken, initAuth, setToken, Icon, ServiceNotice, Acknowledgement, type Msg } from '@dingogo/shared';
import { ROLE, label } from './labels';
import mascot from '@dingogo/shared/assets/mascot.png';
import { AskProvider, Modal, ToastProvider } from './ui';
import { GlobalSearch } from './Search';
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


const NAV: { group: string; items: { to: string; label: string; icon: string; badge?: string }[] }[] = [
  { group: 'Operations', items: [
    { to: '/live', label: 'Live map', icon: 'map' }, { to: '/dashboard', label: 'Dashboard', icon: 'chart' }, { to: '/trips', label: 'Trips', icon: 'route' },
    { to: '/safety', label: 'Safety & compliance', icon: 'shield', badge: 'safety' }, { to: '/support', label: 'Support & inbox', icon: 'chat', badge: 'inbox' }] },
  { group: 'People & fleet', items: [
    { to: '/drivers', label: 'Drivers', icon: 'users', badge: 'drivers' }, { to: '/fleet', label: 'Fleet & charging', icon: 'car', badge: 'cars' }, { to: '/business', label: 'Business accounts', icon: 'receipt' }] },
  { group: 'Commercial', items: [
    { to: '/pricing', label: 'Pricing & tours', icon: 'cash' }, { to: '/loyalty', label: 'Loyalty & vouchers', icon: 'gift' }, { to: '/ads', label: 'Roof advertising', icon: 'bolt' }] },
  { group: 'Admin', items: [{ to: '/reports', label: 'Reports', icon: 'document' }, { to: '/settings', label: 'Settings & broadcast', icon: 'settings' }] },
];

const GO: Record<string, string> = { l: '/live', d: '/dashboard', t: '/trips', s: '/safety', i: '/support', r: '/drivers', f: '/fleet' };
const GO_LABEL: Record<string, string> = { '/live': 'Live map', '/dashboard': 'Dashboard', '/trips': 'Trips', '/safety': 'Safety & compliance', '/support': 'Support & inbox', '/drivers': 'Drivers', '/fleet': 'Fleet & charging' };

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
      // Cars to check: use the dashboard count if the API sends one, otherwise count the pending queue.
      const cars = l.pending_vehicles ?? await get('/admin/vehicles?status=pending').then((r) => r.items.filter((v: any) => v.status === 'pending').length).catch(() => 0);
      setCounts({ safety: l.open_sos + l.open_flags, inbox: l.open_tickets + l.new_hire_requests + l.new_applications, drivers: l.pending_drivers + l.pending_docs, sos: l.open_sos, cars });
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
      if (/^(sos|support|compliance|application|hire|driver\.document|vehicle)/.test(m.type)) void refreshRef.current();
    });
    const t = setInterval(() => void refreshRef.current(), 30000);
    return () => { rt.close(); clearInterval(t); };
  }, []);
  useEffect(() => setMenu(false), [loc.pathname]);

  // Keyboard shortcuts: "/" search, "g" then a letter to go to a page, "?" for the list. Off while typing or in a dialog.
  const searchRef = useRef<HTMLInputElement>(null);
  const [help, setHelp] = useState(false);
  const nav = useNavigate();
  useEffect(() => {
    let g = 0;
    const h = (e: KeyboardEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey || e.defaultPrevented) return;
      const el = e.target as HTMLElement;
      if (el.closest('input, textarea, select, [contenteditable="true"]') || document.querySelector('[data-modal-open]')) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); searchRef.current?.select(); return; }
      if (e.key === '?') { e.preventDefault(); setHelp(true); return; }
      if (e.key === 'g') { g = Date.now(); return; }
      if (Date.now() - g < 1500) {
        const to = GO[e.key];
        g = 0;
        if (to) { e.preventDefault(); nav(to); requestAnimationFrame(() => document.getElementById('main')?.focus()); }
      }
    };
    addEventListener('keydown', h);
    return () => removeEventListener('keydown', h);
  }, [nav]);

  return (
    <Ops.Provider value={{ events, counts, refreshCounts, openSos }}>
      <a href="#main" className="skip-link" onClick={(e) => { e.preventDefault(); document.getElementById('main')?.focus(); }}>Skip to content</a>
      <div className="shell">
        <aside className={'rail' + (menu ? ' open' : '')} aria-label="Main navigation">
          <Link to="/live" className="rail__brand"><img src={mascot} alt="" /><span><strong>DingoGo</strong><small>Operations</small></span></Link>
          <nav>
            {NAV.map((g) => (
              <React.Fragment key={g.group}>
                <div className="rail__group">{g.group}</div>
                {g.items.map(({ to, label, icon, badge }) => (
                  <NavLink key={to} to={to} className={({ isActive }) => 'nav' + (isActive ? ' active' : '')}>
                    <Icon name={icon} size={18} className="nav__icon" />
                    <span className="nav__label">{label}</span>
                    {badge && counts[badge] > 0 && <span className={'badge' + (badge === 'safety' && counts.sos ? ' badge--red' : '')}>{counts[badge]}</span>}
                  </NavLink>
                ))}
              </React.Fragment>
            ))}
          </nav>
          <div className="rail__foot"><span className="rail__who">Signed in as<br /><strong>{me?.name || me?.phone}</strong></span><button onClick={onSignOut}><Icon name="logout" size={16} /> Sign out</button></div>
        </aside>
        {menu && <div className="scrim" style={{ zIndex: 1100 }} onClick={() => setMenu(false)} />}
        <main className="main" id="main" tabIndex={-1}>
          <ServiceNotice extra="Check /api/health/deep and docs/OPERATIONS.md. Drivers keep their trip taps on their phones until it is back." />
          <div className="opsbar">
            <button className="dg-btn dg-btn--ghost dg-btn--sm menu-btn" onClick={() => setMenu(true)} aria-label="Open menu"><Icon name="list" size={18} /> Menu</button>
            <GlobalSearch ref={searchRef} />
            <button type="button" className="dg-btn dg-btn--ghost dg-btn--sm keys-btn" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts"><kbd>?</kbd></button>
          </div>
          {openSos.length > 0 && (
            <div className="sos-banner" role="alert">
              <span className="pulse" aria-hidden="true" /><Icon name="sos" size={20} />
              <span>{openSos.length === 1 ? 'Emergency alert' : `${openSos.length} emergency alerts`}: {openSos.map((s) => `${s.user_name} (${label(ROLE, s.role).toLowerCase()}${s.trip_ref ? `, ${s.trip_ref}` : ''})`).join('; ')}</span>
              <Link to="/safety">Respond now</Link>
            </div>
          )}
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
          <Acknowledgement short style={{ margin: '32px 0 8px' }} />
        </main>
      </div>
      {help && (
        <Modal title="Keyboard shortcuts" onClose={() => setHelp(false)}>
          <table className="tbl tbl--kv keys"><caption className="sr-only">Shortcuts (not while typing in a box)</caption><tbody>
            <tr><th scope="row"><kbd>/</kbd></th><td>Search trips, drivers, riders and cars</td></tr>
            <tr><th scope="row"><kbd>?</kbd></th><td>Show this list</td></tr>
            {Object.entries(GO).map(([k, to]) => <tr key={k}><th scope="row"><kbd>g</kbd> then <kbd>{k}</kbd></th><td>Go to {GO_LABEL[to]}</td></tr>)}
            <tr><th scope="row"><kbd>Esc</kbd></th><td>Close a drawer or dialog</td></tr>
            <tr><th scope="row"><kbd>←</kbd> <kbd>→</kbd></th><td>Move between tabs</td></tr>
          </tbody></table>
          <div className="actions"><button className="dg-btn" onClick={() => setHelp(false)}>Close</button></div>
        </Modal>
      )}
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
        <AskProvider>
          <Shell me={me} onSignOut={() => { setToken(null); setMe(null); }} />
        </AskProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><App /></React.StrictMode>);
