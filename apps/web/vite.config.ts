import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const shared = path.resolve(__dirname, '../../packages/shared');

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: [
      { find: '@dingogo/shared/brand.css', replacement: `${shared}/src/brand.css` },
      { find: '@dingogo/shared/map', replacement: `${shared}/src/Map.tsx` },
      { find: '@dingogo/shared/assets', replacement: `${shared}/assets` },
      { find: /^@dingogo\/shared$/, replacement: `${shared}/src/index.ts` },
    ],
    dedupe: ['react', 'react-dom'],
  },
  server: { port: 5173, fs: { allow: ['../..'] } },
});
