import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import fs from 'node:fs';
import path from 'node:path';

const shared = path.resolve(__dirname, '../../packages/shared');
// If React/Leaflet aren't hoisted to the repo root (e.g. a partial install), fall back to DEPS_DIR/node_modules.
const rootHasReact = fs.existsSync(path.resolve(__dirname, '../../node_modules/react'));
const fallback = process.env.DEPS_DIR ? path.resolve(process.env.DEPS_DIR, 'node_modules') : null;
const dedupe = ['react', 'react-dom', 'react-router-dom', 'react-router', 'leaflet', 'react-leaflet', '@react-leaflet/core', 'qrcode'];
const fallbackAliases = !rootHasReact && fallback ? dedupe.map((m) => ({ find: new RegExp(`^${m.replace('/', '\\/')}(/.*)?$`), replacement: `${fallback}/${m}$1` })) : [];

export default defineConfig({
  plugins: [react()],
  resolve: {
    dedupe,
    alias: [
      { find: '@dingogo/shared/brand.css', replacement: shared + '/src/brand.css' },
      { find: '@dingogo/shared/map', replacement: shared + '/src/Map.tsx' },
      { find: '@dingogo/shared', replacement: shared + '/src/index.ts' },
      ...fallbackAliases,
    ],
  },
  server: { port: 5175, host: true, fs: { allow: ['../..', ...(fallback ? [fallback] : [])] } },
});
