import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readFileSync } from 'node:fs';
import { devRelayPlugin } from './scripts/dev-relay.ts';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// `base: './'` so the built files load from file:// (Electron) and from
// Capacitor's local server alike.
export default defineConfig(({ mode }) => ({
  base: './',
  plugins: [react(), tailwindcss(), devRelayPlugin({ fixtures: mode === 'fixtures' })],
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  build: {
    target: 'es2022',
    chunkSizeWarningLimit: 4000,
  },
  test: {
    environment: 'node',
    testTimeout: 30000,
  },
}));
