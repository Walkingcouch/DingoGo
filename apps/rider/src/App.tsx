import { Suspense, useCallback, useEffect, useState } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { Icon, Login, readHandoff, takeHandoff, get, getToken, initAuth, setToken, connectRealtime, useOnline, disablePush, refreshPush, ServiceNotice, lazyWithRetry, onAppLink, onBackButton } from '@dingogo/shared';
import { MeCtx, type Me, ACTIVE, WEB_URL } from './ctx';
import { RideScreen } from './screens/Ride';
import { TripScreen, clearCachedTrip, readCachedTrip } from './screens/Trip';
import { TripsScreen } from './screens/Trips';
import { AccountScreen } from './screens/Account';
// Round 18: rewards (QR codes), business and client screens are fetched when first opened.
const RewardsScreen = lazyWithRetry(() => import('./screens/Rewards').then((m) => ({ default: m.RewardsScreen })));
const BusinessScreen = lazyWithRetry(() => import('./screens/Business').then((m) => ({ default: m.BusinessScreen })));
const ClientsScreen = lazyWithRetry(() => import('./screens/Clients').then((m) => ({ default: m.ClientsScreen })));
// Round 21: a shared trip opened from a text message (Android App Links), no sign-in needed. Map code loads only here.
const SharedTrack = lazyWithRetry(() => import('@dingogo/shared/track').then((m) => ({ default: m.SharedTrack })));
import { Toast, toast } from './components/Toast';
import { Announcer } from './components/Announcer';
import { Spinner } from './components/ui';

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
  const signOut = useCallback(async () => {
    await disablePush('rider');   // stop pushes to this phone before the session ends
    setToken(null); clearCachedTrip(); setMe(null); setAuthed(false); nav('/');
  }, [nav]);

  // Round 21: a website link that opened the app (share-trip or "Book this ride"): go there. Booking links restart the app at
  // that address so the usual hand-off (main.tsx) fills in the trip, as it does in a browser.
  useEffect(() => onAppLink((route) => {
    if (route.startsWith('/track/')) nav(route);
    else window.location.assign(route);
  }), [nav]);

  // Round 23: Android Back goes back a screen, and on the first screen puts the app in the background.
  useEffect(() => onBackButton(), []);

  useEffect(() => {
    if (!authed) return;
    void reload();
    // Push: if this phone already allowed notifications, register again quietly (tokens change). Never prompts here.
    get('/public/config').then((c) => refreshPush('rider', c.push?.web_push_key)).catch(() => undefined);
    // Resume a live trip if the app was closed mid-ride.
    get<{ trips: any[] }>('/trips?status=active').then(({ trips }) => {
      const live = trips.find((t) => ACTIVE.includes(t.status));
      if (live && loc.pathname === '/') nav(`/trip/${live.id}`);
    }).catch(() => {
      // No signal (or DingoGo's side is down): open the live trip saved on this phone (PIN, car and rego still show).
      const c = readCachedTrip();
      if (c && loc.pathname === '/') nav(`/trip/${c.trip.id}`);
    });
    const rt = connectRealtime((m) => {
      if (m.type === 'notification') toast(m.data.title + (m.data.body ? ` — ${m.data.body}` : ''));
    });
    return () => rt.close();
  }, [authed]); // eslint-disable-line

  if (loc.pathname.startsWith('/track/')) {
    return <Suspense fallback={<div className="page"><Spinner /></div>}><Routes><Route path="/track/:token" element={<TrackScreen />} /></Routes></Suspense>;
  }

  if (!authed) {
    return <><OfflineBar /><Login title="Rides and deliveries for Mparntwe" subtitle="Aboriginal-owned and local to Alice Springs. Going electric." askName askReferral
      initialReferral={readHandoff().ref ?? ''} onDone={() => { takeHandoff('ref'); setAuthed(true); }} /></>;
  }

  const hideTabs = loc.pathname.startsWith('/trip/');
  return (
    <MeCtx.Provider value={{ me, reload, signOut }}>
      <div className={`shell ${hideTabs ? 'shell--full' : ''}`}>
        <div className="shell__main">
          {/* The trip screens say "no signal" themselves, next to the trip details. */}
          {!/^\/trips?\/[^/]+/.test(loc.pathname) && <OfflineBar />}
          <Suspense fallback={<div className="page"><Spinner /></div>}>
          <Routes>
            <Route path="/" element={<RideScreen />} />
            <Route path="/trip/:id" element={<TripScreen />} />
            <Route path="/trips" element={<TripsScreen />} />
            <Route path="/trips/:id" element={<TripScreen />} />
            <Route path="/rewards" element={<RewardsScreen />} />
            <Route path="/business" element={<BusinessScreen />} />
            <Route path="/clients" element={<ClientsScreen />} />
            <Route path="/account/*" element={<AccountScreen />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
          </Suspense>
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
        <Announcer />
      </div>
    </MeCtx.Provider>
  );
}

/** A shared trip (someone's share link): the same live view as the website, with a way into the app. */
function TrackScreen() {
  const { token = '' } = useParams();
  return <SharedTrack token={token} homeHref="/" safetyHref={`${WEB_URL}/safety`}
    renderLink={(href, label, className) => (href.startsWith('http')
      ? <a href={href} className={className} target="_blank" rel="noopener noreferrer">{label}</a>
      : <Link to={href} className={className}>{label}</Link>)} />;
}

/** Shown at the top of every screen while there's no signal. Announced once to screen readers. */
function OfflineBar() {
  const online = useOnline();
  return (
    <>
      <div role="status" aria-live="polite">
        {!online && <p className="offline"><Icon name="alert" size={18} /><span>No signal. We'll keep trying. Your trip details stay on screen.</span></p>}
      </div>
      {/* Signal is fine but DingoGo's database isn't answering. */}
      {online && <ServiceNotice extra="In an emergency call 000." />}
    </>
  );
}
