import '@testing-library/jest-dom/vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { initCoreWasmSync } from '../game/coreWasm';

// The runtime solves/generates through the Rust core (Track F5) and jsdom can't fetch the
// .wasm, so load the real committed artifact from bytes FIRST — every store/loader test then
// exercises the shipping core. The level loader is imported dynamically below because its
// module init awaits core readiness (a static import would hoist above this line).
initCoreWasmSync(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../game/core-pkg/magic_color_core_bg.wasm')),
);

// Shrink the live-generation budget so specs that hit the live path stay fast. This replaces the old
// `process.env.VITEST` sniff inside levelLoader — the test/prod distinction now lives here, in test
// setup, keeping production code free of any test-runner awareness. Selection logic is identical; only
// the pool breadth differs (tests don't assert on specific tail boards).
const { configureLiveGenerator, TEST_LIVE_CONFIG } = await import('../game/levelLoader');
configureLiveGenerator(TEST_LIVE_CONFIG);

// Node's experimental built-in localStorage shadows jsdom's and resolves to `undefined` unless
// `--localstorage-file` is passed, which breaks persistence tests. Provide a simple in-memory
// Storage when none is available so tests run deterministically. (Real browsers are unaffected.)
if (typeof globalThis.localStorage === 'undefined') {
  const store = new Map<string, string>();
  const memoryStorage: Storage = {
    getItem: (key) => (store.has(key) ? store.get(key)! : null),
    setItem: (key, value) => {
      store.set(key, String(value));
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    },
    key: (index) => Array.from(store.keys())[index] ?? null,
    get length() {
      return store.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', {
    value: memoryStorage,
    configurable: true,
    writable: true,
  });
}

// jsdom implements no media queries, but component tests render framer-motion (which probes
// prefers-reduced-motion) and the install banner (which probes display-mode). Provide a minimal,
// always-"no-match" matchMedia so those components mount. (Real browsers are unaffected.)
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  Object.defineProperty(window, 'matchMedia', {
    configurable: true,
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}
