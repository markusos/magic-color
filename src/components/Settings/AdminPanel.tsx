/**
 * The hidden admin console — level unlocking, direct navigation and build diagnostics.
 *
 * Split out of the settings screen (which owns the secret reveal gesture and renders this only once
 * it fires): the two have nothing in common but a container. All the state below — the unlock
 * target, the jump/seed fields, the resolved core version — exists solely for this panel, and kept
 * it interleaved with the player's actual preferences in one 330-line file.
 *
 * There is no visible affordance anywhere; see `Settings` for how it is revealed.
 */
import { useEffect, useState } from 'react';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settings';
import { coreWasmVersion, initCoreWasm } from '../../game/coreWasm';
import { BAKED_LEVEL_COUNT, loadDiagnostics } from '../../game/levelLoader';
import { navigate } from '../../useHashRoute';
import { ToggleRow } from './ToggleRow';
import styles from './AdminPanel.module.css';

/** Admin unlock tops out at the full baked campaign — there are no numbered levels past it. */
const MAX_LEVEL = BAKED_LEVEL_COUNT;

export function AdminPanel() {
  const furthest = useGameStore((s) => s.furthest);
  const unlockUpTo = useGameStore((s) => s.unlockUpTo);
  const loadLevel = useGameStore((s) => s.loadLevel);
  const playRandom = useGameStore((s) => s.playRandom);
  const loadRandom = useGameStore((s) => s.loadRandom);
  const playDaily = useGameStore((s) => s.playDaily);
  const reloadBoard = useGameStore((s) => s.reloadBoard);
  const inspector = useSettings((s) => s.inspector);
  const toggleInspector = useSettings((s) => s.toggleInspector);

  const [target, setTarget] = useState('');
  const [unlockedTo, setUnlockedTo] = useState<number | null>(null);
  const [jump, setJump] = useState('');
  const [seed, setSeed] = useState('');

  // E9 diagnostics: the core version, resolved once the module finishes loading.
  const [coreVersion, setCoreVersion] = useState<string | null>(coreWasmVersion());
  useEffect(() => {
    let cancelled = false;
    void initCoreWasm().then(() => {
      if (!cancelled) setCoreVersion(coreWasmVersion());
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const parsed = Number(target);
  const valid = Number.isInteger(parsed) && parsed >= 1 && parsed <= MAX_LEVEL;

  const onUnlock = () => {
    if (!valid) return;
    unlockUpTo(parsed);
    setUnlockedTo(parsed);
  };

  // Admin navigation: load a board and jump straight to play. Level may exceed the baked range (the tail
  // generates live); the seed reproduces an exact random board.
  // `Number('')` is 0, so guard against the empty string explicitly (else "Play seed" enables on a blank field).
  const jumpN = Number(jump);
  const jumpValid = jump.trim() !== '' && Number.isInteger(jumpN) && jumpN >= 1;
  const seedN = Number(seed);
  const seedValid = seed.trim() !== '' && Number.isInteger(seedN) && seedN >= 0;
  const enter = (action: () => void) => {
    action();
    navigate('play');
  };
  const onJump = () => {
    if (jumpValid) enter(() => loadLevel(jumpN));
  };
  const onSeed = () => {
    if (seedValid) enter(() => loadRandom(seedN));
  };

  return (
    <section className={styles.admin}>
      <h2 className={styles.adminTitle}>Admin · Unlock levels</h2>
      <div className={styles.adminRow}>
        <input
          className={styles.adminInput}
          type="number"
          min={1}
          max={MAX_LEVEL}
          inputMode="numeric"
          placeholder={`1–${MAX_LEVEL}`}
          value={target}
          onChange={(e) => setTarget(e.target.value)}
          aria-label="Level to unlock up to"
        />
        <button className={styles.adminBtn} onClick={onUnlock} disabled={!valid}>
          Unlock
        </button>
      </div>
      <p className={styles.hint}>
        {unlockedTo !== null
          ? `Unlocked levels 1–${unlockedTo}. Frontier is now ${furthest}.${
              unlockedTo >= MAX_LEVEL ? ' Play Random is unlocked.' : ''
            }`
          : `Unlock every level up to and including this number (frontier is currently ${furthest}). Unlock to ${MAX_LEVEL} to open Play Random.`}
      </p>
      <ToggleRow label="Level Inspector" checked={inspector} onToggle={toggleInspector} />
      <p className={styles.hint}>
        Overlay the active board's difficulty metrics while playing (plus baked provenance in dev builds).
      </p>
      <p className={styles.hint}>
        Core: {coreVersion ? `wasm ${coreVersion}` : 'wasm (loading…)'}
        {(() => {
          // E9 diagnostics: what the last board load did + the live generator's state.
          const d = loadDiagnostics();
          const last = d.last ? ` · last load ${d.last.label} (${d.last.source}, ${d.last.ms}ms)` : '';
          return `${last} · live cache ${d.liveCacheSize} · pool ${d.config.poolSize}/${d.config.finalists}`;
        })()}
      </p>

      <h2 className={styles.adminTitle}>Admin · Navigate</h2>
      <div className={styles.adminRow}>
        <input
          className={styles.adminInput}
          type="number"
          min={1}
          inputMode="numeric"
          placeholder="Level #"
          value={jump}
          onChange={(e) => setJump(e.target.value)}
          aria-label="Level to jump to"
        />
        <button className={styles.adminBtn} onClick={onJump} disabled={!jumpValid}>
          Go
        </button>
      </div>
      <div className={styles.adminRow}>
        <input
          className={styles.adminInput}
          type="number"
          min={0}
          inputMode="numeric"
          placeholder="Random seed"
          value={seed}
          onChange={(e) => setSeed(e.target.value)}
          aria-label="Random board seed"
        />
        <button className={styles.adminBtn} onClick={onSeed} disabled={!seedValid}>
          Play seed
        </button>
      </div>
      <div className={styles.adminRow}>
        <button className={`${styles.adminBtn} ${styles.adminBtnFlex}`} onClick={() => enter(playRandom)}>
          Endless
        </button>
        <button className={`${styles.adminBtn} ${styles.adminBtnFlex}`} onClick={() => enter(playDaily)}>
          Daily
        </button>
        <button className={`${styles.adminBtn} ${styles.adminBtnFlex}`} onClick={() => enter(reloadBoard)}>
          Reload
        </button>
      </div>
      <p className={styles.hint}>
        Jump to any level (past {BAKED_LEVEL_COUNT} generates live), reproduce a random board by seed, enter
        Endless/Daily directly, or reload the current board.
      </p>
    </section>
  );
}
