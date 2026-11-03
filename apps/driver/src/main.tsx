import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import '@dingogo/shared/brand.css';
import './app.css';
import { App } from './App';

try { const t = localStorage.getItem('dingogo.driver.theme'); if (t && t !== 'auto') document.documentElement.dataset.theme = t; } catch { /* storage unavailable */ }

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode><BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, "")}><App /></BrowserRouter></React.StrictMode>,
);
