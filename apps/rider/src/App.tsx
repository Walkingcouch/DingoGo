import { useCallback, useEffect, useState } from 'react';
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { Login, get, getToken, initAuth, setToken, connectRealtime } from '@dingogo/shared';
import { MeCtx, type Me, ACTIVE } from './ctx';
import { RideScreen } from './screens/Ride';
import { TripScreen } from './screens/Trip';
import { TripsScreen } from './screens/Trips';
import { RewardsScreen } from './screens/Rewards';
import { AccountScreen } from './screens/Account';
import { Toast, toast } from './components/Toast';

initAuth('rider');

const TABS = [
  { to: '/', label: 'Ride', icon: <path d="M5 16h14l-1.5-5.5A2 2 0 0 0 15.6 9H8.4a2 2 0 0 0-1.9 1.5L5 16Zm0 0v3m14-3v3M7.5 13.5h.01M16.5 13.5h.01" /> },
  { to: '/trips', label: 'Trips', icon: <path d="M4 6h16M4 12h16M4 18h10" /> },
  { to: '/rewards', label: 'Rewards', icon: <path d="M6 9h12v11H6zM4 6h16v3H4zM12 6v14M12 6c-2-3-6-3-5 0m5 0c2-3 6-3 5 0" /> },
  { to: '/account', label: 'Account', icon: <path d="M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0" /> },
];

export function App() {
  const [authed, setAuthed] = useState(!!getToken());
  const [me, setMe] = useState<Me | null>(null);
  const nav = useNavigate();
  const loc = useLocation();

  const reload = useCallback(async () => {
    try { setMe(await get<Me>('/me')); } catch { if (!getToken()) setAuthed(false); }
  }, []);
  const signOut = useCallback(() => { setToken(null); setMe(null); setAuthed(false); nav('/'); }, [nav]);

  useEffect(() => {
    if (!authed) return;
    void reload();
    // Resume a live trip if the app was closed mid-ride.
    get<{ trips: any[] }>('/trips?status=active').then(({ trips }) => {
      const live = trips.find((t) => ACTIVE.includes(t.status));
      if (live && loc.pathname === '/') nav(`/trip/${live.id}`);
    }).catch(() => {});
    const rt = connectRealtime((m) => {
      if (m.type === 'notification') toast(m.data.title + (m.data.body ? ` — ${m.data.body}` : ''));
    });
    return () => rt.close();
  }, [authed]); // eslint-disable-line

  if (!authed) {
    return <Login title="Rides and deliveries for Mparntwe" subtitle="Aboriginal-owned and local to Alice Springs. Going electric." askName askReferral
      onDone={() => setAuthed(true)} />;
  }

  const hideTabs = loc.pathname.startsWith('/trip/');
  return (
    <MeCtx.Provider value={{ me, reload, signOut }}>
      <div className={`shell ${hideTabs ? 'shell--full' : ''}`}>
        <div className="shell__main">
          <Routes>
            <Route path="/" element={<RideScreen />} />
            <Route path="/trip/:id" element={<TripScreen />} />
            <Route path="/trips" element={<TripsScreen />} />
            <Route path="/trips/:id" element={<TripScreen />} />
            <Route path="/rewards" element={<RewardsScreen />} />
            <Route path="/account/*" element={<AccountScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </div>
        {!hideTabs && (
          <nav className="tabs" aria-label="Main">
            {TABS.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.to === '/'} className={({ isActive }) => `tabs__item ${isActive ? 'is-active' : ''}`}>
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{t.icon}</svg>
                <span>{t.label}</span>
              </NavLink>
            ))}
          </nav>
        )}
        <Toast />
      </div>
    </MeCtx.Provider>
  );
}
