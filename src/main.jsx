import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import GivePage from './GivePage';
import './styles.css';

// /give is a public page (no login) for family contributions; everything else is the app
const isGive = /^\/give\/?$/.test(location.pathname);
createRoot(document.getElementById('root')).render(isGive ? <GivePage /> : <App />);

if ('serviceWorker' in navigator && import.meta.env.PROD && !import.meta.env.VITE_DEMO) {
  window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
}
