import { defineConfig, devices } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';

/**
 * E2E harness — the thin browser-only top of the test pyramid (see PLAN / the test-coverage memo).
 * The unit + component suites (vitest/jsdom) cover logic and rendering; these specs cover what only
 * a real browser can: layout, the History-backed hash router, the wasm boot, and the PWA. Keep the
 * set SMALL — critical-path smokes, not a re-test of component logic.
 *
 * Runs against a PRODUCTION build served by `vite preview`, so the service worker, wasm chunking,
 * and relative `base` all match what ships.
 */

// Use the environment's pre-installed Chromium — never download one. Prefer an explicit override,
// then the versioned browser under PLAYWRIGHT_BROWSERS_PATH; fall back to Playwright's own lookup.
function chromiumExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_PATH) return process.env.PLAYWRIGHT_CHROMIUM_PATH;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH ?? '/opt/pw-browsers';
  if (!existsSync(root)) return undefined;
  // Numeric revision sort (see scripts/gate.ts): lexicographic order mis-ranks "chromium-999" above
  // "chromium-1005" once revisions differ in digit count, picking an older browser.
  const revs = readdirSync(root)
    .filter((name) => /^chromium-\d+$/.test(name))
    .sort((a, b) => Number(a.slice('chromium-'.length)) - Number(b.slice('chromium-'.length)))
    .reverse();
  for (const rev of revs) {
    const bin = `${root}/${rev}/chrome-linux/chrome`;
    if (existsSync(bin)) return bin;
  }
  return undefined;
}

const executablePath = chromiumExecutable();
const PORT = Number(process.env.E2E_PORT ?? 4173);

export default defineConfig({
  testDir: './e2e',
  // Fail fast in CI (a leftover `test.only` should error), and retry once to absorb the odd flake.
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: `http://localhost:${PORT}`,
    // Deterministic rendering: kill the framer-motion animations that would otherwise race asserts.
    reducedMotion: 'reduce',
    trace: 'on-first-retry',
  },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Pixel 7'], // a phone viewport — this is a portrait-locked PWA
        launchOptions: executablePath && existsSync(executablePath) ? { executablePath } : {},
      },
    },
  ],
  // Build once, then serve the built app. Reuse an already-running preview locally for a fast loop.
  webServer: {
    command: `npm run build && npm run preview -- --port ${PORT} --strictPort`,
    port: PORT,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
});
