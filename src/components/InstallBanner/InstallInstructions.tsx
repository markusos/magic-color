import { Download, Share, SquarePlus } from 'lucide-react';
import type { InstallPlatform } from '../../install/installState';
import styles from './InstallBanner.module.css';

// The app icon (served from public/), referenced the same way as in index.html so it resolves
// under any base path. Doubles as the card's iOS-style app glyph.
const APP_ICON = `${import.meta.env.BASE_URL}icon.svg`;

/**
 * The platform-appropriate install content, shared by the home banner and the Settings section.
 * Laid out as an iOS-style promo card — app icon, title + subtitle, then the action — so it reads
 * the same as the rest of the app's UI. Android/Chromium gets a full-width button that fires the
 * real native prompt; iOS Safari gets the manual Share → "Add to Home Screen" steps (no install
 * API exists there).
 */
export function InstallInstructions({
  platform,
  install,
}: {
  platform: InstallPlatform;
  install: () => Promise<boolean>;
}) {
  const isAndroid = platform === 'android';

  return (
    <div className={styles.content}>
      <div className={styles.head}>
        <img className={styles.appIcon} src={APP_ICON} alt="" width={48} height={48} />
        <div className={styles.copy}>
          <p className={styles.title}>
            {isAndroid ? 'Install Magic Color' : 'Add to Home Screen'}
          </p>
          {isAndroid ? (
            <p className={styles.text}>Play full-screen, even offline.</p>
          ) : (
            <p className={styles.text}>
              Tap the Share button
              <Share size={15} strokeWidth={2} aria-hidden className={styles.inlineIcon} />
              in Safari, then choose “Add to Home Screen”
              <SquarePlus size={15} strokeWidth={2} aria-hidden className={styles.inlineIcon} />.
            </p>
          )}
        </div>
      </div>

      {isAndroid && (
        <button className={styles.installBtn} onClick={() => void install()}>
          <Download size={18} strokeWidth={2} aria-hidden />
          Install app
        </button>
      )}
    </div>
  );
}
