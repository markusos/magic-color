import { useState } from 'react';
import { X } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { useInstall } from '../../install/useInstall';
import { dismissInstallBanner, isInstallBannerDismissed } from '../../install/installState';
import { InstallInstructions } from './InstallInstructions';
import styles from './InstallBanner.module.css';

/**
 * Closable "add to home screen" card pinned to the bottom of the Home screen. Shows only when the
 * app isn't installed and the platform can offer it (Android prompt / iOS Safari instructions).
 *
 * Dismissal is sticky: closing it persists the current unlock frontier, and the banner stays hidden
 * until the player reaches a few more levels (see `isInstallBannerDismissed`). Because Home unmounts
 * and remounts on each visit, the initial dismissal check naturally re-evaluates every time the
 * player returns home — which is exactly when a re-nudge should be considered.
 */
export function InstallBanner() {
  const furthest = useGameStore((s) => s.furthest);
  const { platform, install } = useInstall();
  const [dismissed, setDismissed] = useState(() => isInstallBannerDismissed(furthest));

  if (!platform || dismissed) return null;

  const onClose = () => {
    dismissInstallBanner(furthest);
    setDismissed(true);
  };

  return (
    <div className={styles.banner} role="complementary" aria-label="Install Magic Color">
      <button className={styles.close} onClick={onClose} aria-label="Dismiss">
        <X size={16} strokeWidth={2.5} aria-hidden />
      </button>
      <InstallInstructions platform={platform} install={install} />
    </div>
  );
}
