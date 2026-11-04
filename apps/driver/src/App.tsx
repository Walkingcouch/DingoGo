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

initAuth('driver');

export function App() {
  const [token, setTok] = useState(getToken());
  if (!token) {
    return <Login title="Drive with DingoGo" subtitle="Sign in with the mobile number you applied with." onDone={(r) => setTok(r.token)} askName />;
  }
  return <DriverProvider><Shell onSignOut={() => { setToken(null); setTok(null); }} /></DriverProvider>;
}

function Home() {
  const { me, trip } = useDriver();
  if (!me) return <div className="screen"><p className="dg-muted">Loading…</p></div>;
  if (trip) return <ActiveTrip />;
  const needsSetup = me.driver?.status !== 'approved' || me.compliance_issues?.length;
  return needsSetup ? <Onboarding /> : <Drive />;
}

function Shell({ onSignOut }: { onSignOut: () => void }) {
  const { offer, toast } = useDriver();
  const tabs = [
    { to: '/', label: 'Drive', icon: <Icon name="car" size={26} /> },
    { to: '/earnings', label: 'Earnings', icon: <Icon name="wallet" size={26} /> },
    { to: '/charging', label: 'Charging', icon: <Icon name="bolt" size={26} /> },
    { to: '/trips', label: 'Trips', icon: <Icon name="list" size={26} /> },
    { to: '/profile', label: 'Profile', icon: <Icon name="user" size={26} /> },
  ];
  return (
    <div className="shell">
      <div style={{ minHeight: 0, overflow: 'hidden', position: 'relative' }}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/setup" element={<Onboarding />} />
          <Route path="/earnings" element={<Earnings />} />
          <Route path="/charging" element={<Charging />} />
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
