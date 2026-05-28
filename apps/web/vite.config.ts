import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  // Load the root .env so a single file fuels both API and web (VITE_* vars only).
  envDir: path.resolve(__dirname, '../..'),
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
  server: {
    port: 5173,
    // Bind to all interfaces so a phone on the same WiFi can reach the web app
    // (e.g. for verify-email / reset-password links that open in the phone browser).
    host: true,
    proxy: {
      '/trpc': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
});
