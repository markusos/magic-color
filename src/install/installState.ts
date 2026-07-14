/**
 * The "add to home screen" install layer — everything non-React about offering the PWA install.
 *
 * The app is already a fully installable PWA (manifest + service worker); this module only owns the
 * *invitation* to install, which differs sharply by platform:
 *
 *   - Android / Chromium: the browser fires a `beforeinstallprompt` event we can defer and replay
 *     on demand, driving the real native install dialog. We capture it here at module load (a
 *     side-effect import in main.tsx guarantees the listener is attached before the event can fire,
 *     regardless of which route the app booted into).
 *   - iOS Safari: there is NO install API. The user must manually use Share → "Add to Home Screen",
 *     so the most we can do is detect the platform and show instructions.
 *   - Already installed (standalone) or any other browser: nothing to offer.
 *
 * It also owns the small bit of persistence for the home-screen banner's dismissal, kept under its
 * own localStorage key (separate from campaign progress) and degrading to "not dismissed" if
 * storage is unavailable.
 */

/** Which install affordance to surface, or `null` when there's nothing to offer. */
export type InstallPlatform = 'android' | 'ios';

/**
 * Minimal shape of the non-standard `beforeinstallprompt` event (absent from lib.dom). Only the
 * members we use are declared.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

// --- Reactive external store for the deferred prompt -------------------------------------------

let deferred: BeforeInstallPromptEvent | null = null;
let installed = false;
/** Bumped on every state change so `useSyncExternalStore` can detect updates via a stable getter. */
let version = 0;
const listeners = new Set<() => void>();

function emit(): void {
  version++;
  listeners.forEach((listener) => listener());
}

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    // Suppress Chromium's default mini-infobar; we replay the prompt from our own UI instead.
    e.preventDefault();
    deferred = e as BeforeInstallPromptEvent;
    emit();
  });
  window.addEventListener('appinstalled', () => {
    deferred = null;
    installed = true;
    emit();
  });
}

/** Subscribe to install-availability changes (for `useSyncExternalStore`). */
export function subscribeInstall(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Monotonic version snapshot — changes whenever availability changes. */
export function getInstallVersion(): number {
  return version;
}

/**
 * Replay the captured install prompt (Android/Chromium only). Resolves to whether the user
 * accepted. A deferred prompt is single-use, so we drop it afterward either way.
 */
export async function triggerInstall(): Promise<boolean> {
  if (!deferred) return false;
  await deferred.prompt();
  const { outcome } = await deferred.userChoice;
  deferred = null;
  emit();
  return outcome === 'accepted';
}

// --- Platform detection -----------------------------------------------------------------------

/** Whether the app is running as an installed (standalone) PWA. */
export function isStandaloneDisplay(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    (window.navigator as { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  );
}

function isIOS(): boolean {
  const nav = window.navigator;
  return (
    /iphone|ipad|ipod/i.test(nav.userAgent) ||
    // iPadOS 13+ masquerades as desktop Safari; a touch-capable "Mac" is really an iPad.
    (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  );
}

/** Whether this is iOS Safari — the only iOS browser that can "Add to Home Screen". */
function isIOSSafari(): boolean {
  if (typeof window === 'undefined' || !isIOS()) return false;
  // Chrome/Firefox/Edge/Opera on iOS can't install; exclude them by their UA tokens.
  return !/crios|fxios|edgios|opios/i.test(window.navigator.userAgent);
}

/**
 * The install affordance to offer right now, ignoring banner dismissal:
 *   - `'android'` when a native prompt is captured,
 *   - `'ios'` on iOS Safari (manual instructions),
 *   - `null` when already installed or installation isn't possible here.
 */
export function currentInstallPlatform(): InstallPlatform | null {
  if (isStandaloneDisplay() || installed) return null;
  if (deferred) return 'android';
  if (isIOSSafari()) return 'ios';
  return null;
}

// --- Home-banner dismissal persistence --------------------------------------------------------

const DISMISS_KEY = 'magic-color:install-dismissed:v1';
/**
 * After the player dismisses the home banner, re-show it once they've reached this many *more*
 * levels — a gentle second nudge for engaged players who haven't installed yet.
 */
const RESHOW_AFTER_LEVELS = 3;

/** The unlock frontier at which the banner was last dismissed, or null if never. */
function loadDismissedAt(): number | null {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return null;
    const value = Number(raw);
    return Number.isFinite(value) ? value : null;
  } catch {
    return null;
  }
}

/** Record that the player dismissed the banner at the given unlock frontier. */
export function dismissInstallBanner(furthest: number): void {
  try {
    localStorage.setItem(DISMISS_KEY, String(furthest));
  } catch {
    // Storage unavailable (private mode / quota): the banner will simply reappear next visit.
  }
}

/**
 * Forget any past install-banner dismissal, so the banner is offered again from scratch. Called by
 * "Start Over", which wipes every trace of a prior play-through — a reset player should be re-nudged
 * to install exactly like a brand-new one.
 */
export function clearInstallDismissal(): void {
  try {
    localStorage.removeItem(DISMISS_KEY);
  } catch {
    // ignore
  }
}

/**
 * Whether the home banner is currently suppressed by a past dismissal. Suppression lifts once the
 * player has reached {@link RESHOW_AFTER_LEVELS} more levels than when they dismissed it.
 */
export function isInstallBannerDismissed(furthest: number): boolean {
  const dismissedAt = loadDismissedAt();
  if (dismissedAt === null) return false;
  return furthest < dismissedAt + RESHOW_AFTER_LEVELS;
}
