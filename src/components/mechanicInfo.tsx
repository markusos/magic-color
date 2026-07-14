import { EyeOff, Funnel, Snowflake, type LucideIcon } from 'lucide-react';
import type { Mechanic } from '../game/types';

/**
 * Player-facing copy for each board mechanic — the single source used by both the one-time
 * chapter-intro card (U1) and the chapter-aware how-to-play help. Keep this parallel to
 * `MECHANIC_SETS` in `game/progression.ts` and the chapter names in `game/chapters.ts`; the `title`
 * here matches the chapter name that introduces the mechanic.
 */
export interface MechanicInfo {
  title: string;
  blurb: string;
  Icon: LucideIcon;
}

export const MECHANIC_INFO: Record<Mechanic, MechanicInfo> = {
  hidden: {
    title: 'Hidden Colors',
    blurb: "Dark cells hide a color. Pour on top to reveal what's underneath, then plan around it.",
    Icon: EyeOff,
  },
  funnel: {
    title: 'Color Locks',
    blurb:
      "A colored collar locks a tube to that one color — it won't accept any other. Route the rest around it.",
    Icon: Funnel,
  },
  ice: {
    title: 'Deep Freeze',
    blurb:
      'Frozen tubes are locked. Finish the color on the ice badge to thaw the tube and free what it holds.',
    Icon: Snowflake,
  },
};
