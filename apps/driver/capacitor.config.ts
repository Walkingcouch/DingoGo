import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'au.com.dingogo.driver',
  appName: 'DingoGo Driver',
  webDir: 'dist',
  backgroundColor: '#14213D',
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};
export default config;
