import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { GameScreen } from './GameScreen';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settings';
import { board } from '../../test/board';

/**
 * These specs keep the board in its `loading` state so the header, the loader/auto-solve chips and
 * navigation are exercised WITHOUT mounting GameBoard (which needs real layout geometry — that path
 * belongs to the E2E layer). The header still renders InfoButton + Stats, so their state is set too.
 */
function setState(overrides: Partial<Parameters<typeof useGameStore.setState>[0]> = {}) {
  useSettings.setState({ inspector: false, inspectorOpen: false });
  useGameStore.setState({
    level: 5,
    phase: 'easy',
    loading: true,
    mode: 'campaign',
    endlessStreak: 0,
    dailyKey: null,
    mechanics: [],
    optimal: 16,
    twoStarMax: 18,
    moves: [],
    undos: 0,
    hintUsed: false,
    current: board([['r', 'g'], []], 4),
    autoSolving: false,
    autoSolveNotice: null,
    cancelAutoSolve: vi.fn(),
    ...overrides,
  });
}

beforeEach(() => setState());

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('header by mode', () => {
  it('campaign shows the level number and phase', () => {
    render(<GameScreen />);
    expect(screen.getByText('Level 5')).toBeInTheDocument();
    expect(screen.getByText('Easy')).toBeInTheDocument();
  });

  it('daily shows "Daily" and the daily key', () => {
    setState({ mode: 'daily', dailyKey: '2026-07-13' });
    render(<GameScreen />);
    expect(screen.getByText('Daily')).toBeInTheDocument();
    expect(screen.getByText('2026-07-13')).toBeInTheDocument();
  });

  it('endless shows "Random" and the current streak', () => {
    setState({ mode: 'endless', endlessStreak: 3 });
    render(<GameScreen />);
    expect(screen.getByText('Random')).toBeInTheDocument();
    expect(screen.getByText('Streak 3')).toBeInTheDocument();
  });
});

describe('board area', () => {
  it('shows the loader while a level is generating', () => {
    render(<GameScreen />);
    expect(screen.getByText('Generating level…')).toBeInTheDocument();
  });
});

describe('auto-solve (debug)', () => {
  it('shows the "Solving…" chip and Stop cancels it', async () => {
    const cancelAutoSolve = vi.fn();
    setState({ autoSolving: true, cancelAutoSolve });
    render(<GameScreen />);
    expect(screen.getByText('Solving…')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(cancelAutoSolve).toHaveBeenCalledOnce();
  });

  it('shows a transient notice when solving has stopped', () => {
    setState({ autoSolving: false, autoSolveNotice: 'No solution found' });
    render(<GameScreen />);
    expect(screen.getByText('No solution found')).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('the Home button routes back home', async () => {
    render(<GameScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(window.location.hash).toBe('#/');
  });
});
