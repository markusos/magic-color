import '@testing-library/jest-dom/vitest';

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
