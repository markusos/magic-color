import { useState } from 'react';
import { CalendarDays, Check, Flame, Settings as SettingsIcon, Share } from 'lucide-react';
import { useGameStore } from '../../store/gameStore';
import { navigate } from '../../useHashRoute';
import { GAME_URL } from '../../game/daily';
import { shareOrCopy } from '../../share';
import { InstallBanner } from '../InstallBanner/InstallBanner';
import styles from './Home.module.css';

/**
 * Start screen: resume the campaign (Continue / Play) — or, once the campaign is cleared, jump
 * straight into the post-campaign "Play Random" mode — plus the level selector and a Settings cog.
 * Difficulty is driven by the level number now (no tier selector).
 */
export function Home() {
  const level = useGameStore((s) => s.level);
  const mode = useGameStore((s) => s.mode);
  const furthest = useGameStore((s) => s.furthest);
  const loadLevel = useGameStore((s) => s.loadLevel);
  const playRandom = useGameStore((s) => s.playRandom);
  const playDaily = useGameStore((s) => s.playDaily);
  const dailyStreak = useGameStore((s) => s.dailyStreak);
  const dailyDone = useGameStore((s) => s.dailyResult !== null);
  const campaignComplete = useGameStore((s) => s.campaignComplete);
  const fresh = furthest <= 1;
  const [copied, setCopied] = useState(false);

  // Share the game: the native share sheet on phones, a clipboard copy of the link elsewhere.
  const onShare = async () => {
    const outcome = await shareOrCopy({
      title: 'Magic Color',
      text: 'Sort the colors. One tube at a time.',
      url: GAME_URL,
    });
    if (outcome === 'copied') {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  // Resume the campaign frontier. Only preserve the in-progress board when we're already in
  // campaign mode on the furthest level; otherwise (e.g. after playing the daily or a random
  // board) the mounted board belongs to a different mode and must be reloaded.
  const onPlay = () => {
    if (mode !== 'campaign' || level !== furthest) loadLevel(furthest);
    navigate('play');
  };

  const onPlayRandom = () => {
    playRandom();
    navigate('play');
  };

  const onPlayDaily = () => {
    playDaily();
    navigate('play');
  };

  return (
    <div className={styles.home}>
      <button
        className={styles.shareLink}
        onClick={() => void onShare()}
        aria-label={copied ? 'Link copied' : 'Share Magic Color'}
      >
        {copied ? (
          <Check size={24} strokeWidth={2} aria-hidden />
        ) : (
          <Share size={24} strokeWidth={2} aria-hidden />
        )}
      </button>

      <button
        className={styles.settingsLink}
        onClick={() => navigate('settings')}
        aria-label="Settings"
      >
        <SettingsIcon size={24} strokeWidth={2} aria-hidden />
      </button>

      <h1 className={styles.title}>Magic Color</h1>
      <p className={styles.tagline}>Sort the colors. One tube at a time.</p>

      <div className={styles.actions}>
        {/* Once the campaign is cleared, the primary action becomes "Play Random" — the campaign
            no longer continues past the baked levels. */}
        {campaignComplete ? (
          <button className={styles.primary} onClick={onPlayRandom}>
            Play Random
          </button>
        ) : (
          <button className={styles.primary} onClick={onPlay}>
            {fresh ? 'Play' : `Continue · Level ${furthest}`}
          </button>
        )}
        {/* The daily challenge is independent of campaign progress — always available. */}
        <button className={styles.daily} onClick={onPlayDaily}>
          <CalendarDays size={18} strokeWidth={2} aria-hidden />
          <span className={styles.dailyLabel}>Daily Challenge</span>
          {dailyDone ? (
            <span className={styles.dailyMeta} aria-label="Solved today">
              <Check size={14} strokeWidth={2.5} aria-hidden />
            </span>
          ) : (
            dailyStreak > 0 && (
              <span className={styles.dailyMeta} aria-label={`${dailyStreak} day streak`}>
                <Flame size={14} strokeWidth={2.5} aria-hidden />
                {dailyStreak}
              </span>
            )
          )}
        </button>
        {/* Only meaningful once more than one level is unlocked. */}
        {!fresh && (
          <button className={styles.secondary} onClick={() => navigate('levels')}>
            Levels
          </button>
        )}
        {!fresh && (
          <button className={styles.secondary} onClick={() => navigate('stats')}>
            Stats
          </button>
        )}
      </div>

      <InstallBanner />
    </div>
  );
}
