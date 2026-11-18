import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@dingogo/shared/brand.css';
import './app.css';
import { App } from './App';
import { applyTheme, getPrefs, resolvedTheme } from './lib/prefs';

// Theme before the first paint (no flash of the day theme at night).
applyTheme(resolvedTheme(getPrefs().theme, new Date()));

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}><App /></BrowserRouter></React.StrictMode>,
);
