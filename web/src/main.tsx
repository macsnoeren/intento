import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { routeFor } from './routes.tsx';
import './styles.css';

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root-element #root ontbreekt in index.html');
}

// Welke interface je krijgt hangt af van het pad; zie `routes.tsx` voor de drie takken.
createRoot(rootElement).render(<StrictMode>{routeFor(window.location.pathname)}</StrictMode>);
