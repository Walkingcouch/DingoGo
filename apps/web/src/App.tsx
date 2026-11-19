import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ConfigProvider } from './config';
import { Layout } from './Layout';
import Home from './pages/Home';

// Home is in the main bundle (most visits start there); every other page is its own chunk, loaded when it's opened.
const Rides = lazy(() => import('./pages/Rides'));
const Fares = lazy(() => import('./pages/Fares'));
const Landing = lazy(() => import('./pages/Landing'));
const Parcels = lazy(() => import('./pages/Parcels'));
const Tours = lazy(() => import('./pages/Tours'));
const Business = lazy(() => import('./pages/Business'));
const Drive = lazy(() => import('./pages/Drive'));
const DriveStatus = lazy(() => import('./pages/DriveStatus'));
const Invite = lazy(() => import('./pages/Invite'));
const Advertise = lazy(() => import('./pages/Advertise'));
const Rewards = lazy(() => import('./pages/Rewards'));
const Safety = lazy(() => import('./pages/Safety'));
const About = lazy(() => import('./pages/About'));
const Help = lazy(() => import('./pages/Help'));
const Legal = lazy(() => import('./pages/Legal'));
const NotFound = lazy(() => import('./pages/NotFound'));
const Track = lazy(() => import('./pages/Track'));
const HireQuote = lazy(() => import('./pages/HireQuote'));
const DeleteAccount = lazy(() => import('./pages/DeleteAccount'));

const page = (el: React.ReactNode) => <Suspense fallback={<div className="wrap section dg-muted" role="status">Loading…</div>}>{el}</Suspense>;

export default function App() {
  return (
    <ConfigProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="rides" element={page(<Rides />)} />
            <Route path="fares" element={page(<Fares />)} />
            <Route path="airport" element={page(<Landing kind="airport" />)} />
            <Route path="hospital" element={page(<Landing kind="hospital" />)} />
            <Route path="parcels" element={page(<Parcels />)} />
            <Route path="tours" element={page(<Tours />)} />
            <Route path="business" element={page(<Business />)} />
            <Route path="drive" element={page(<Drive />)} />
            <Route path="drive/status/:token" element={page(<DriveStatus />)} />
            <Route path="invite/:code" element={page(<Invite />)} />
            <Route path="advertise" element={page(<Advertise />)} />
            <Route path="rewards" element={page(<Rewards />)} />
            <Route path="safety" element={page(<Safety />)} />
            <Route path="about" element={page(<About />)} />
            <Route path="help" element={page(<Help />)} />
            <Route path="legal/:doc" element={page(<Legal />)} />
            <Route path="delete-account" element={page(<DeleteAccount />)} />
            <Route path="track/:token" element={page(<Track />)} />
            <Route path="hire/:token" element={page(<HireQuote />)} />
            <Route path="*" element={page(<NotFound />)} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}
