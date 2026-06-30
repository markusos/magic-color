/// <reference types="vite/client" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Standalone Vite app for the interactive bake report (Track E2/E6) — a separate root (`report/`) so it
 * is fully decoupled from the shipped game: the dev-only difficulty provenance it imports never lands in
 * the production app bundle, and the report can grow arbitrarily complex (more React, more charts)
 * without touching the game build. Reuses the game's typed, unit-tested analysis (`src/game/levelReport`).
 *
 *   npm run report:dev     # HMR while building the report (http://localhost:5174)
 *   npm run report:build   # standalone static output in dist-report/ (open or share)
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), 'report');

export default defineConfig({
  root,
  base: './',
  plugins: [react()],
  server: { port: 5174, strictPort: false, host: true },
  build: { outDir: resolve(root, '../dist-report'), emptyOutDir: true },
});
