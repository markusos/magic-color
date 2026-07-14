import { useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Info } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settings';
import { InspectorPanel } from '../Debug/InspectorPanel';
import { MECHANIC_INFO } from '../mechanicInfo';
import styles from './InfoButton.module.css';

/** Spring used by both popovers so the inspector matches the how-to-play feel exactly. */
const POP_SPRING = { type: 'spring', stiffness: 420, damping: 28 } as const;
const POP_VARIANTS = {
  initial: { opacity: 0, scale: 0.92, y: -6 },
  animate: { opacity: 1, scale: 1, y: 0 },
  exit: { opacity: 0, scale: 0.92, y: -6 },
};

/**
 * iOS-style ⓘ button in the top-right. Normally taps open a how-to-play popover. When the debug Level
 * Inspector is enabled (admin hatch), the button instead opens the inspector in the *same* popover —
 * same anchor, shell, and backdrop-to-dismiss behaviour — so the debug readout reads like, and dismisses
 * like, how-to-play (Track E1).
 */
export function InfoButton() {
  const [open, setOpen] = useState(false);
  // The mechanics active on the current board — listed under the base rules so re-opening help
  // always explains what's actually in play (U1), not just the base game.
  const mechanics = useGameStore((s) => s.mechanics);
  const inspectorEnabled = useSettings((s) => s.inspector);
  const inspectorOpen = useSettings((s) => s.inspectorOpen);
  const toggleInspectorOpen = useSettings((s) => s.toggleInspectorOpen);

  // While the inspector is enabled the button drives it; otherwise it's the how-to-play toggle.
  const onClick = () => (inspectorEnabled ? toggleInspectorOpen() : setOpen((o) => !o));
  const showInspector = inspectorEnabled && inspectorOpen;
  const showHowTo = open && !inspectorEnabled;
  const label = inspectorEnabled
    ? inspectorOpen
      ? 'Hide level inspector'
      : 'Show level inspector'
    : 'How to play';

  return (
    <>
      <button
        type="button"
        // Tint while the inspector feature is on, so it reads as the inspector toggle rather than help.
        className={inspectorEnabled ? `${styles.info} ${styles.active}` : styles.info}
        onClick={onClick}
        aria-label={label}
        aria-pressed={inspectorEnabled ? inspectorOpen : undefined}
      >
        <Info size={24} strokeWidth={2} aria-hidden />
      </button>

      <AnimatePresence>
        {showHowTo && (
          <>
            <div className={styles.backdrop} onClick={() => setOpen(false)} />
            <motion.div
              className={styles.popover}
              initial={POP_VARIANTS.initial}
              animate={POP_VARIANTS.animate}
              exit={POP_VARIANTS.exit}
              transition={POP_SPRING}
            >
              <h2 className={styles.title}>How to play</h2>
              <p className={styles.body}>
                Tap a bottle to pick it up, then tap another to pour the top color onto a matching color or an
                empty tube. Sort until every bottle is a single shade.
              </p>
              {mechanics.length > 0 && (
                <ul className={styles.mechanics}>
                  {mechanics.map((m) => {
                    const info = MECHANIC_INFO[m];
                    return (
                      <li key={m} className={styles.mechanic}>
                        <span className={styles.mechanicIcon}>
                          <info.Icon size={16} strokeWidth={2} aria-hidden />
                        </span>
                        <span>
                          <strong className={styles.mechanicName}>{info.title}</strong>
                          <span className={styles.mechanicBlurb}>{info.blurb}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </motion.div>
          </>
        )}
        {showInspector && (
          <>
            {/* Tap anywhere outside the popover to dismiss, exactly like how-to-play. */}
            <div className={styles.backdrop} onClick={toggleInspectorOpen} />
            <motion.div
              className={`${styles.popover} ${styles.inspectorPopover}`}
              initial={POP_VARIANTS.initial}
              animate={POP_VARIANTS.animate}
              exit={POP_VARIANTS.exit}
              transition={POP_SPRING}
            >
              <InspectorPanel />
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
