import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.tsx';
import { TabletApp } from './TabletApp.tsx';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root-element #root ontbreekt in index.html');
}

/**
 * Twee losse interfaces achter één bundel: de **gebruikersapp op de tablet** draait op `/tablet`
 * (device-auth, eigen gebruiker), de **beheeromgeving** op de overige paden (account-auth). De
 * tablet wordt op de `/tablet`-URL geopend en start daarna direct in de gespreksflow (T4.2).
 */
const isTablet = window.location.pathname.replace(/\/+$/, '').endsWith('/tablet');

createRoot(rootElement).render(<StrictMode>{isTablet ? <TabletApp /> : <App />}</StrictMode>);
