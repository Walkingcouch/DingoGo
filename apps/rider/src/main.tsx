import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@dingogo/shared/brand.css';
import './app.css';
import { App } from './App';
import { parseTripLink, saveHandoff } from '@dingogo/shared';

// A link from the website ("Book this ride", a shared fare or a friend's invite) carries the trip and/or a referral code. Keep it
// through sign-in, then tidy the address bar so a reload doesn't apply it twice.
if (location.search) {
  const link = parseTripLink(location.search);
  if (link.from || link.to || link.service || link.ref) {
    saveHandoff(link);
    const p = new URLSearchParams(location.search);
    for (const k of ['from', 'to', 'service', 'ref']) p.delete(k);
    history.replaceState(history.state, '', location.pathname + (p.toString() ? `?${p}` : '') + location.hash);
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}>
      <App />
    </BrowserRouter>
  </React.StrictMode>,
);
