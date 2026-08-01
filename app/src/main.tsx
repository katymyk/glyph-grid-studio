import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './ui/tokens.css';
import { App } from './App';
import { initPersistence } from './state/persist';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

// Deliberately after the render and deliberately not awaited: the default scene paints
// immediately and a restored one replaces it a moment later. Blocking first paint on a
// disk read would trade a flicker for a blank window.
void initPersistence();
