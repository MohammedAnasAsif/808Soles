import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './index.css';
import { usePlayer } from './store/player';
import { useLibrary } from './store/library';
import { warmUp } from './yt/api';
import { platform } from './platform';
import { applyRuntimeCsp } from './lib/csp';
import { useDownloads } from './store/downloads';

// Android: lock the page down before the app renders (Windows gets this as a header).
if (platform === 'android' && !import.meta.env.DEV) applyRuntimeCsp();

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
