import { Shapes, X } from 'lucide-react';
import { useSettings } from '../../store/settings';
import styles from './PatternNudge.module.css';

/**
 * One-time discovery nudge for the Color Patterns colorblind aid (U6). The setting is off by default
 * and lives in Settings, which many players never open — so a calm, dismissible card on Home offers
 * it directly with a one-tap enable. Shown only while the aid is off and the nudge hasn't been retired;
 * enabling it (here or in Settings) or dismissing it retires the nudge for good.
 */
export function PatternNudge() {
  const patterns = useSettings((s) => s.patterns);
  const patternsNudged = useSettings((s) => s.patternsNudged);
  const togglePatterns = useSettings((s) => s.togglePatterns);
  const dismiss = useSettings((s) => s.dismissPatternsNudge);

  if (patterns || patternsNudged) return null;

  return (
    <div className={styles.nudge} role="complementary" aria-label="Color Patterns tip">
      <span className={styles.icon} aria-hidden>
        <Shapes size={20} strokeWidth={2} />
      </span>
      <div className={styles.text}>
        <strong className={styles.title}>Hard to tell colors apart?</strong>
        <span className={styles.body}>Add a distinct pattern to each color.</span>
      </div>
      {/* Enabling from the nudge flips the setting (which also retires the nudge). */}
      <button className={styles.enable} onClick={togglePatterns}>
        Enable
      </button>
      <button className={styles.close} onClick={dismiss} aria-label="Dismiss tip">
        <X size={16} strokeWidth={2.5} aria-hidden />
      </button>
    </div>
  );
}
