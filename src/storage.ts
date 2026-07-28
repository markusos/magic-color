/**
 * The localStorage namespace this app owns, and the one operation that spans all of it.
 *
 * Every key the app writes — campaign progress, settings, the install-banner dismissal — is built
 * from {@link STORAGE_NAMESPACE}, so "what we own" is decidable rather than remembered. That is what
 * lets "Start Over" wipe the lot WITHOUT reaching for `localStorage.clear()`: the app is built with
 * `base: './'` so it can also be served from a shared origin (a GitHub Pages subpath), where clearing
 * the whole origin would erase whatever else lives there alongside it.
 *
 * Every access is wrapped, so disabled / full / private-mode storage degrades to a no-op rather than
 * throwing — the same contract the individual key modules keep.
 */
export const STORAGE_NAMESPACE = 'magic-color:';

/** Build a namespaced key. The namespace is the unit "Start Over" wipes, so nothing may opt out. */
export const storageKey = (name: string): string => `${STORAGE_NAMESPACE}${name}`;

/**
 * Remove every key in the app's namespace — the storage half of "Start Over"'s clean slate. Leaves
 * anything outside the namespace untouched, so a shared origin's other tenants survive.
 */
export function clearOwnedStorage(): void {
  try {
    // Snapshot first: removing while enumerating a live Storage object skips entries.
    const owned = Object.keys(localStorage).filter((key) => key.startsWith(STORAGE_NAMESPACE));
    for (const key of owned) localStorage.removeItem(key);
  } catch {
    // Storage unavailable (private mode) — nothing was persisted, so there is nothing to wipe.
  }
}
