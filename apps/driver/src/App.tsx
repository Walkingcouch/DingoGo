import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Icon, Login, getToken, initAuth, setToken } from '@dingogo/shared';
import { DriverProvider, useDriver } from './state';
import { Drive } from './screens/Drive';
import { Offer } from './screens/Offer';
import { ActiveTrip } from './screens/ActiveTrip';
import { Onboarding } from './screens/Onboarding';
import { Earnings } from './screens/Earnings';
import { Charging } from './screens/Charging';
import { Trips } from './screens/Trips';
import { Profile } from './screens/Profile';
import { hasPlug } from './vehicle';
import { clearOutbox } from './lib/outbox';

initAuth('driver');

export function App() {
  const [token, setTok] = useState(getToken());
  if (!token) {
    return <Login title="Drive with DingoGo" subtitle="Sign in with the mobile number you applied with." onDone={(r) => setTok(r.token)} askName />;
  }
  return <DriverProvider><Shell onSignOut={() => { clearOutbox(); setToken(null); setTok(null); }} /></DriverProvider>;
}

function Home() {
  const { me, trip } = useDriver();
  if (!me) return <div className="screen"><p className="dg-muted">Loading…</p></div>;
  if (trip) return <ActiveTrip />;
  const needsSetup = me.driver?.status !== 'approved' || me.compliance_issues?.length;
  return needsSetup ? <Onboarding /> : <Drive />;
}

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const { me, offer, toast, connected, waiting, trip, online } = useDriver();
  // Charging only makes sense for a car with a plug (electric or plug-in hybrid).
  const plug = hasPlug(me?.driver?.vehicle);
  const tabs = [
    { to: '/', label: 'Drive', icon: <Icon name="car" size={26} /> },
    { to: '/earnings', label: 'Earnings', icon: <Icon name="wallet" size={26} /> },
    ...(plug ? [{ to: '/charging', label: 'Charging', icon: <Icon name="bolt" size={26} /> }] : []),
    { to: '/trips', label: 'Trips', icon: <Icon name="list" size={26} /> },
    { to: '/profile', label: 'Profile', icon: <Icon name="user" size={26} /> },
  ];
  return (
    <div className="shell">
      <SignalBar connected={connected} taps={waiting.taps} gps={waiting.gps} active={online || !!trip} />
      <div style={{ minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/setup" element={<Onboarding />} />
          <Route path="/earnings" element={<Earnings />} />
          <Route path="/charging" element={plug || !me ? <Charging /> : <Navigate to="/" />} />
          <Route path="/trips" element={<Trips />} />
          <Route path="/profile" element={<Profile onSignOut={onSignOut} />} />
          <Route path="*" element={<Navigate to="/" />} />
        </Routes>
      </div>
      <nav className="tabs" aria-label="Main">
        {tabs.map((t) => <NavLink key={t.to} to={t.to} end className={({ isActive }) => (isActive ? 'active' : '')}>{t.icon}<span>{t.label}</span></NavLink>)}
      </nav>
      {offer && <Offer key={offer.trip_id} />}
      {toast && <div role="status" className="toast"><Icon name="info" size={20} />{toast}</div>}
    </div>
  );
}

/** Poor signal: says plainly that the app is reconnecting and that taps and GPS are kept on the phone until it does. */
function SignalBar({ connected, taps, gps, active }: { connected: boolean; taps: number; gps: number; active: boolean }) {
  const sending = connected && (taps > 0 || gps > 0);
  if (connected && !sending) return <div role="status" />; // stays in the grid (row 1, no height) so the next message is read out
  return (
    <div role="status" className={`signal-bar${sending ? ' sending' : ''}`}>
      <Icon name={sending ? 'route' : 'nosignal'} size={20} />
      <span>
        {sending ? 'Signal back. Sending your trip updates…'
          : <><strong>No signal. Reconnecting…</strong>{taps > 0 ? ` ${taps} trip update${taps > 1 ? 's' : ''} saved on your phone.` : active ? ' Keep driving: updates are saved on your phone.' : ''}</>}
      </span>
    </div>
  );
}
