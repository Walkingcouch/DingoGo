import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'au.com.dingogo.rider',
  appName: 'DingoGo',
  webDir: 'dist',
  backgroundColor: '#FBFAF7',
  plugins: {
    PushNotifications: { presentationOptions: ['badge', 'sound', 'alert'] },
  },
};
export default config;
