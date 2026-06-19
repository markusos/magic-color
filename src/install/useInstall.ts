/**
 * React access to the install layer. Subscribes to the install-availability store and returns the
 * affordance to show right now plus a function to trigger the native prompt. Platform detection is
 * static for a session, but availability is reactive: on Android the `beforeinstallprompt` event
 * can arrive after first paint, flipping `platform` from `null` to `'android'`.
 */
import { useSyncExternalStore } from 'react';
import {
  currentInstallPlatform,
  getInstallVersion,
  subscribeInstall,
  triggerInstall,
  type InstallPlatform,
} from './installState';

export interface Install {
  /** Which affordance to surface, or `null` when there's nothing to offer. */
  platform: InstallPlatform | null;
  /** Replay the native install prompt (Android/Chromium). No-op elsewhere. */
  install: () => Promise<boolean>;
}

export function useInstall(): Install {
  // Re-render whenever availability changes; the version is a stable, primitive snapshot.
  useSyncExternalStore(subscribeInstall, getInstallVersion, getInstallVersion);
  return { platform: currentInstallPlatform(), install: triggerInstall };
}
