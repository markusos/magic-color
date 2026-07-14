import { AnimatePresence, motion } from 'framer-motion';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settings';
import { chapterForLevel, signatureMechanic } from '../../game/progression';
import { chapterName } from '../../game/chapters';
import { MECHANIC_INFO } from '../mechanicInfo';
import styles from './ChapterIntro.module.css';

/**
 * One-time chapter-intro card (U1). The moment the player first enters a campaign chapter that
 * introduces a new mechanic (Hidden Colors, Color Locks, Deep Freeze), a card explains it — so a
 * frozen tube or a locked funnel never appears unannounced. Dismissing it records the chapter as
 * seen (persisted in settings, independent of campaign progress), so it shows exactly once.
 *
 * Only campaign play teaches chapters; the daily and post-campaign random modes are reached after
 * onboarding, so they never trigger it. Sits above the board like the win overlay and blurs it, so
 * the new mechanic is visible behind the explanation.
 */
export function ChapterIntro() {
  const level = useGameStore((s) => s.level);
  const mode = useGameStore((s) => s.mode);
  const loading = useGameStore((s) => s.loading);
  const status = useGameStore((s) => s.status);
  const seenChapters = useSettings((s) => s.seenChapters);
  const markChapterSeen = useSettings((s) => s.markChapterSeen);

  const chapter = chapterForLevel(level);
  const mechanic = signatureMechanic(chapter);

  // Show only for a fresh, loaded campaign board whose chapter introduces a still-unseen mechanic.
  const visible =
    mode === 'campaign' &&
    !loading &&
    status === 'playing' &&
    mechanic !== null &&
    !seenChapters.includes(chapter);

  const info = mechanic ? MECHANIC_INFO[mechanic] : null;

  return (
    <AnimatePresence>
      {visible && info && (
        <motion.div
          className={styles.backdrop}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => markChapterSeen(chapter)}
        >
          <motion.div
            className={styles.panel}
            // Stop a tap on the card itself from dismissing (only the backdrop / button do).
            onClick={(e) => e.stopPropagation()}
            initial={{ scale: 0.85, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.85, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 24 }}
          >
            <motion.div
              className={styles.badge}
              initial={{ scale: 0.5, rotate: -12, opacity: 0 }}
              animate={{ scale: 1, rotate: 0, opacity: 1 }}
              transition={{ type: 'spring', stiffness: 340, damping: 16, delay: 0.1 }}
            >
              <info.Icon size={34} strokeWidth={2} aria-hidden />
            </motion.div>
            <p className={styles.eyebrow}>New mechanic</p>
            <h2 className={styles.title}>{chapterName(chapter)}</h2>
            <p className={styles.blurb}>{info.blurb}</p>
            <button className={styles.primary} onClick={() => markChapterSeen(chapter)}>
              Got it
            </button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
