import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.soles808.player',
  appName: '808Soles',
  webDir: 'dist',
  android: {
    backgroundColor: '#000000',
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
