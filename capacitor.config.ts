import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'org.kofi.collections',
  appName: 'Kofi Collections',
  webDir: 'dist',
  backgroundColor: '#F4F2FA',
  ios: { contentInset: 'automatic', scheme: 'Kofi Collections' },
  android: { allowMixedContent: false },
  plugins: {
    StatusBar: { style: 'LIGHT', backgroundColor: '#F4F2FA', overlaysWebView: false },
  },
};

export default config;
