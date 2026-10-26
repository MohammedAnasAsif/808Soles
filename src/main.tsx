import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { usePlayer } from './store/player';
import { useLibrary } from './store/library';
import { warmUp } from './yt/api';
import { useDownloads } from './store/downloads';

warmUp();

if (import.meta.env.DEV) {
  // Handy in development tools.
  (window as unknown as Record<string, unknown>).__cadence = { usePlayer, useLibrary, useDownloads };
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
