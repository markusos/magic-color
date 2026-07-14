/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

// https://vite.dev/config/
export default defineConfig({
  // Relative base so the app works at BOTH the default Pages subpath
  // (https://<user>.github.io/magic-color/) AND a root custom domain
  // (https://magic-color.ostberg.dev/) with no reconfiguration. All asset, manifest,
  // and service-worker paths are emitted relative to the document.
  base: './',
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
  // The level loader uses a top-level `await import()` to pull the ~200 kB baked-board blob into its
  // own lazily-fetched chunk (keeping it out of the main bundle). Top-level await needs a slightly
  // newer floor than Vite's default 'modules' target (Safari 14 / Chrome 87), so raise it to the TLA
  // baseline — years old by now and well within any device that can run this PWA.
  build: { target: ['chrome89', 'edge89', 'firefox89', 'safari15'] },
  // Bind to 0.0.0.0 so the dev/preview server is reachable from other devices on the LAN.
  // Honor a PORT env override (used by preview tooling) so an assigned port is actually bound.
  server: { host: true, port: process.env.PORT ? Number(process.env.PORT) : undefined },
  preview: { host: true },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: './src/test/setup.ts',
    css: true,
    // Vitest's default glob also matches `e2e/*.spec.ts` — but those are Playwright specs (run by
    // `npm run test:e2e`), not vitest. Scope discovery to the app's own unit/component suites.
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      // `npm run test:coverage` prints a terminal summary and writes an HTML report under coverage/.
      reporter: ['text-summary', 'html'],
      // A LOOSE floor, set well below the current numbers (~82% lines / ~84% branches) so it catches
      // a real regression — a whole area losing its tests — without flaking on ±1% jitter from an
      // ordinary change. Ratchet these up as coverage climbs; it's deliberately not a tight gate.
      thresholds: {
        lines: 75,
        statements: 75,
        functions: 75,
        branches: 78,
      },
      // Measure the shipped app only. The `report/` dev viewer and `scripts/` build tooling are
      // not part of the product, and the gameplay RULES live in the Rust crate (measured
      // separately by `cargo test`), so this number reflects real, testable app TS.
      include: ['src/**'],
      // Within src/, drop files that carry no logic worth a line count.
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.d.ts',
        'src/test/**',
        'src/main.tsx',
        'src/vite-env.d.ts',
        'src/game/core-pkg/**', // generated wasm-bindgen glue
        'src/game/levels.data.ts', // baked level blob (data, not code)
        'src/game/levels.meta.ts',
        'src/game/levels.provenance.ts',
        'src/**/*.module.css',
      ],
    },
  },
});
