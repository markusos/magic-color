/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves project sites from a subpath: https://<user>.github.io/magic-color/
  // The base makes all asset, manifest, and service-worker paths resolve under it.
  base: '/magic-color/',
  plugins: [
    react(),
    // Installable PWA + offline support (Workbox service worker precaches the build).
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png', 'icon.svg'],
      // scope/start_url default to Vite's base, so the installed app is scoped to /magic-color/.
      manifest: {
        name: 'Magic Color',
        short_name: 'Magic Color',
        description: 'A magical color-sorting puzzle.',
        theme_color: '#2a1a4a',
        background_color: '#14102b',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'maskable-512x512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
      },
      workbox: {
        // Precache every built asset (incl. the solver Web Worker chunk) for offline play.
        globPatterns: ['**/*.{js,css,html,svg,png,woff,woff2}'],
      },
    }),
  ],
  // Bind to 0.0.0.0 so the dev/preview server is reachable from other devices on the LAN.
  server: { host: true },
  preview: { host: true },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
  },
});
