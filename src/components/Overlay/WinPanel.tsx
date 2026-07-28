/**
 * The win panel's contents: the rating, the praise line, the "new best" flourish, the score readout
 * and whichever action the mode offers — Next Level, Next Board, or the daily's Share / Home pair.
 *
 * Split from {@link Overlay}, which now owns only what BOTH end states share (the backdrop, the
 * dialog shell, visibility). Nearly all of the former file's weight — the three confetti tiers, the
 * praise ladder, the clipboard round-trip and its "Copied!" countdown — was win-specific and had
 * nothing to do with the dead-end alert it sat next to.
 */
import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, Home, Share, Trophy } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { dailyShareText } from '../../game/daily';
import { navigate } from '../../useHashRoute';
import type { Stars as StarCount } from '../../game/stars';
import { Stars } from '../Stars/Stars';
import { Confetti } from '../Confetti/Confetti';
import styles from './Overlay.module.css';

export function WinPanel({ stars, score, titleId }: { stars: StarCount; score: number; titleId: string }) {
  const optimal = useGameStore((s) => s.optimal);
  const newBest = useGameStore((s) => s.newBest);
  const nextLevel = useGameStore((s) => s.nextLevel);
  const mode = useGameStore((s) => s.mode);
  const endlessStreak = useGameStore((s) => s.endlessStreak);
  const dailyKey = useGameStore((s) => s.dailyKey);
  const dailyStreak = useGameStore((s) => s.dailyStreak);
  const [copied, setCopied] = useState(false);

  const endless = mode === 'endless';
  const daily = mode === 'daily';
  const praise = daily
    ? 'Daily Complete!'
    : endless
      ? `Streak ${endlessStreak}!`
      : stars === 3
        ? 'Perfect!'
        : stars === 2
          ? 'Nicely done!'
          : 'Level Complete!';

  // Revert the "Copied" confirmation after a moment so a second share reads clearly. An effect
  // rather than a bare timeout in the handler: the panel can be dismissed (Home, Next Level) inside
  // those two seconds, and the cleanup cancels the pending reset instead of leaving it to fire
  // against an unmounted component.
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  // Copy the shareable daily result to the clipboard (backendless sharing — see PLAN.md B2).
  const onShare = async () => {
    if (!dailyKey) return;
    try {
      await navigator.clipboard.writeText(dailyShareText(dailyKey, { stars, moves: score }));
      setCopied(true);
    } catch {
      // Clipboard unavailable (insecure context / denied) — leave the button in its default state.
    }
  };

  return (
    <>
      {/* A grand confetti burst crowns a flawless (3★) clear; a 2★ clear gets a small handful; a 1★
          scrape gets a sad little puff. Suppressed under reduced-motion inside the component itself. */}
      {stars === 3 && <Confetti variant="grand" />}
      {stars === 2 && <Confetti variant="subtle" />}
      {stars === 1 && <Confetti variant="meager" />}
      <motion.div
        className={styles.starsRow}
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 360, damping: 18, delay: 0.1 }}
      >
        <Stars value={stars} size={48} />
      </motion.div>
      <h2 className={styles.win} id={titleId}>
        {praise}
      </h2>
      {/* Beating a prior best is the "beat my score" moment — campaign only (live boards keep no
          per-level record). */}
      {newBest && (
        <motion.p
          className={styles.newBest}
          initial={{ scale: 0.7, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ type: 'spring', stiffness: 360, damping: 16, delay: 0.25 }}
        >
          <Trophy size={16} strokeWidth={2.5} aria-hidden />
          New best!
        </motion.p>
      )}
      {/* Score feedback: what you spent vs. the near-optimal target. */}
      <p className={styles.score}>
        {score} {score === 1 ? 'move' : 'moves'} · optimal {optimal}
      </p>
      {daily ? (
        <div className={styles.actions}>
          {dailyStreak > 0 && (
            <p className={styles.sub}>
              {dailyStreak} day{dailyStreak === 1 ? '' : 's'} in a row
            </p>
          )}
          <button className={styles.primary} onClick={() => void onShare()}>
            {copied ? (
              <>
                <Check size={18} strokeWidth={2} aria-hidden />
                Copied!
              </>
            ) : (
              <>
                <Share size={18} strokeWidth={2} aria-hidden />
                Share Result
              </>
            )}
          </button>
          <button className={styles.secondary} onClick={() => navigate('home')}>
            <Home size={18} strokeWidth={2} aria-hidden />
            Home
          </button>
        </div>
      ) : (
        <button className={styles.primary} onClick={nextLevel}>
          {endless ? 'Next Board' : 'Next Level'}
        </button>
      )}
    </>
  );
}
