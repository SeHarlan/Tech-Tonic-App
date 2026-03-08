import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.techtonic.app',
  appName: 'Tech-Tonic',
  webDir: 'dist',
  // Live reload: LIVE_RELOAD=1 npx cap sync android
  // Omitted for production builds so the APK loads from bundled dist/.
  ...(process.env.LIVE_RELOAD && {
    server: {
      url: 'http://10.0.2.2:5173',
      cleartext: true,
    },
  }),
};

export default config;
