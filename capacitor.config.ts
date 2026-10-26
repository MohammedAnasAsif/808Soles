import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.soles808.player',
  appName: '808Soles',
  webDir: 'dist',
  android: {
    backgroundColor: '#000000',
    // Explicit secure defaults: no remote debugging in release builds, no
    // http content inside the https app, no navigation to other sites.
    webContentsDebuggingEnabled: false,
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
    allowNavigation: [],
  },
  plugins: {
    // YouTube requests go through our own native plugin instead.
    CapacitorHttp: { enabled: false },
    SystemBars: {
      insetsHandling: 'css',
      initialViewportFitValueHint: 'cover',
    },
  },
};

export default config;
