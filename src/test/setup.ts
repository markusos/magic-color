import '@testing-library/jest-dom/vitest';
import { configureLiveGenerator, TEST_LIVE_CONFIG } from '../game/levelLoader';

// Shrink the live-generation budget so specs that hit the live path stay fast. This replaces the old
// `process.env.VITEST` sniff inside levelLoader — the test/prod distinction now lives here, in test
// setup, keeping production code free of any test-runner awareness. Selection logic is identical; only
// the pool breadth differs (tests don't assert on specific tail boards).
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
