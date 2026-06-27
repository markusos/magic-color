import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { InspectorPanel } from './InspectorPanel';
import { boardFootprint } from './footprint';
import { useGameStore } from '../../store/gameStore';
import { BAKED_LEVEL_COUNT } from '../../game/levelLoader';
import { board } from '../../test/board';

describe('boardFootprint', () => {
  it('formats colors / bottles × capacity', () => {
    const state = board([['r', 'g'], ['g', 'r'], ['b', 'b'], []], 4);
    expect(boardFootprint(state)).toBe('3c/4b×4');
  });
});

const liveProvenance = {
  score: 0.42,
  targetPercentile: 0.7,
  family: 'large',
  metrics: {
    optimal: 40,
    optimalExact: false,
    twoStarMax: 42,
    forcedMoveRatio: 0.1,
    deadEndDensity: 0.25,
    digDepth: 0.3,
    funnelLoad: 0.5,
    iceLoad: 0.6,
    colors: 11,
    empties: 4,
  },
};

describe('InspectorPanel', () => {
  it('renders the live level fields from the store', () => {
    useGameStore.setState({
      level: 1,
      phase: 'easy',
      mode: 'campaign',
      mechanics: ['hidden'],
      optimal: 16,
      twoStarMax: 18,
      current: board([['r', 'g'], ['g', 'r'], []], 4),
      liveProvenance: null,
    });
    render(<InspectorPanel />);
    expect(screen.getByLabelText('Level inspector')).toBeInTheDocument();
    expect(screen.getByText('Inspector · L1')).toBeInTheDocument();
    expect(screen.getByText('16 / 18')).toBeInTheDocument();
    expect(screen.getByText('hidden')).toBeInTheDocument();
    // Level 1 is baked, so the source line reads "baked".
    expect(screen.getByText('baked')).toBeInTheDocument();
  });

  it('shows live-computed metrics (marked approx) for a generated board', () => {
    useGameStore.setState({
      level: 0,
      phase: 'hard',
      mode: 'endless',
      mechanics: ['hidden', 'funnel', 'ice'],
      optimal: 40,
      twoStarMax: 42,
      current: board([['r']], 4),
      liveProvenance,
    });
    render(<InspectorPanel />);
    expect(screen.getByText('Inspector · Random')).toBeInTheDocument();
    expect(screen.getByText('live')).toBeInTheDocument();
    // The metrics block renders, flagged as an approximation.
    expect(screen.getByText('live · approx')).toBeInTheDocument();
    expect(screen.getByText('0.42 / 0.70')).toBeInTheDocument();
    expect(screen.getByText('large')).toBeInTheDocument();
    // Live boards never have the exact optimal.
    expect(screen.getByText('no (proxy)')).toBeInTheDocument();
    expect(screen.getByText('0.60')).toBeInTheDocument(); // ice load
  });

  it('marks an un-baked tail level with no metrics as n/a', () => {
    useGameStore.setState({
      level: BAKED_LEVEL_COUNT + 1,
      phase: 'hard',
      mode: 'campaign',
      mechanics: [],
      optimal: 30,
      twoStarMax: 33,
      current: board([['r']], 4),
      liveProvenance: null,
    });
    render(<InspectorPanel />);
    expect(screen.getByText('live')).toBeInTheDocument();
    // No metrics available (light fallback path) — and no baked provenance section.
    expect(screen.queryByText(/score \/ target/)).not.toBeInTheDocument();
    expect(screen.getByText('— (n/a)')).toBeInTheDocument();
  });
});
