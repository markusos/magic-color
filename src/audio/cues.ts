/**
 * The feedback VOCABULARY shared between gameplay (the producer — `session.cueForTap`) and the
 * feedback layer (the consumers — `sound.ts` / `haptics.ts`). It lives in its own tiny module so
 * neither side has to import the other: a `Cue` is just a string union, no runtime coupling.
 *
 * Each cue names a player-perceptible outcome, NOT a specific waveform — the synth and the vibration
 * patterns map a cue to their own rendering, so the two stay independently tunable (see PLAN.md A1).
 */
export type Cue =
  /** A tube was picked up as the pour source. */
  | 'select'
  /** The selected tube was put back down (tapped again). */
  | 'deselect'
  /** A tap that did nothing legal — an attempted illegal pour. */
  | 'invalid'
  /** Liquid poured from one tube into another. */
  | 'pour'
  /** A pour that finished (capped) a color. */
  | 'cap'
  /** The board was solved. */
  | 'win'
  /** A pour that thawed a frozen ice block (its trigger color just capped). */
  | 'thaw';
