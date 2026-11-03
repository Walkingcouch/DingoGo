import { useState } from 'react';
import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { Login, getToken, initAuth, setToken } from '@dingogo/shared';
import { DriverProvider, useDriver } from './state';
import { IcBolt, IcDrive, IcList, IcMoney, IcUser } from './icons';
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
    { to: '/', label: 'Drive', icon: <IcDrive /> },
    { to: '/earnings', label: 'Earnings', icon: <IcMoney /> },
    { to: '/charging', label: 'Charging', icon: <IcBolt /> },
    { to: '/trips', label: 'Trips', icon: <IcList /> },
    { to: '/profile', label: 'Profile', icon: <IcUser /> },
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
        {tabs.map((t) => <NavLink key={t.to} to={t.to} end className={({ isActive }) => (isActive ? 'active' : '')}>{t.icon}{t.label}</NavLink>)}
      </nav>
      {offer && <Offer key={offer.trip_id} />}
      {toast && <div role="status" style={{ position: 'fixed', left: 16, right: 16, top: 'max(16px, env(safe-area-inset-top))', zIndex: 4000, background: 'var(--night)', color: 'var(--gum)', padding: '14px 16px', borderRadius: 'var(--r-md)', fontWeight: 700, boxShadow: 'var(--shadow-pop)' }}>{toast}</div>}
    </div>
  );
}
