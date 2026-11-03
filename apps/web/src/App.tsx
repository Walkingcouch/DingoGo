import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { ConfigProvider } from './config';
import { Layout } from './Layout';
import Home from './pages/Home';
import Rides from './pages/Rides';
import Parcels from './pages/Parcels';
import Tours from './pages/Tours';
import Business from './pages/Business';
import Drive from './pages/Drive';
import Advertise from './pages/Advertise';
import Rewards from './pages/Rewards';
import Safety from './pages/Safety';
import About from './pages/About';
import Help from './pages/Help';
import Legal from './pages/Legal';
import NotFound from './pages/NotFound';

const Track = lazy(() => import('./pages/Track'));

export default function App() {
  return (
    <ConfigProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Routes>
          <Route element={<Layout />}>
            <Route index element={<Home />} />
            <Route path="rides" element={<Rides />} />
            <Route path="parcels" element={<Parcels />} />
            <Route path="tours" element={<Tours />} />
            <Route path="business" element={<Business />} />
            <Route path="drive" element={<Drive />} />
            <Route path="advertise" element={<Advertise />} />
            <Route path="rewards" element={<Rewards />} />
            <Route path="safety" element={<Safety />} />
            <Route path="about" element={<About />} />
            <Route path="help" element={<Help />} />
            <Route path="legal/:doc" element={<Legal />} />
            <Route path="track/:token" element={<Suspense fallback={<div className="wrap section dg-muted">Loading…</div>}><Track /></Suspense>} />
            <Route path="*" element={<NotFound />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConfigProvider>
  );
}
