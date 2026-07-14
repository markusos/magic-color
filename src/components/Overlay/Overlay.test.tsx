import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Overlay } from './Overlay';
import { useGameStore } from '../../store/gameStore';

/**
 * The end-of-attempt modal. `score = moves.length + undos`, so these specs drive the rating by
 * setting `moves: []` and using `undos` as the score dial (keeps fixtures free of Move shapes).
 */
function setState(overrides: Partial<Parameters<typeof useGameStore.setState>[0]> = {}) {
  useGameStore.setState({
    status: 'won',
    moves: [],
    undos: 0,
    optimal: 16,
    twoStarMax: 18,
    hintUsed: false,
    mode: 'campaign',
    endlessStreak: 0,
    dailyKey: null,
    dailyStreak: 0,
    nextLevel: vi.fn(),
    restart: vi.fn(),
    ...overrides,
  });
}

beforeEach(() => setState());

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('Overlay visibility', () => {
  it('is hidden while the game is still playing', () => {
    setState({ status: 'playing' });
    render(<Overlay />);
    expect(screen.queryByRole('heading')).not.toBeInTheDocument();
  });

  it('shows on win, deadlock and stuck', () => {
    for (const status of ['won', 'deadlocked', 'stuck'] as const) {
      setState({ status });
      const { unmount } = render(<Overlay />);
      expect(screen.getByRole('heading')).toBeInTheDocument();
      unmount();
    }
  });
});

describe('win — star rating and praise', () => {
  it('a perfect (optimal) solve reads 3 stars / "Perfect!"', () => {
    setState({ undos: 0 }); // score 0 ≤ optimal 16
    render(<Overlay />);
    expect(screen.getByText('Perfect!')).toBeInTheDocument();
  });

  it('a near-optimal solve reads 2 stars / "Nicely done!"', () => {
    setState({ undos: 17 }); // 16 < 17 ≤ 18
    render(<Overlay />);
    expect(screen.getByText('Nicely done!')).toBeInTheDocument();
  });

  it('a loose solve reads 1 star / "Level Complete!"', () => {
    setState({ undos: 25 }); // > twoStarMax 18
    render(<Overlay />);
    expect(screen.getByText('Level Complete!')).toBeInTheDocument();
  });

  it('a hinted solve is capped to 1 star regardless of score', () => {
    setState({ undos: 0, hintUsed: true }); // would be 3★ on score alone
    render(<Overlay />);
    expect(screen.getByText('Level Complete!')).toBeInTheDocument();
  });

  it('"Next Level" advances via the store action', async () => {
    const nextLevel = vi.fn();
    setState({ nextLevel });
    render(<Overlay />);
    await userEvent.click(screen.getByRole('button', { name: 'Next Level' }));
    expect(nextLevel).toHaveBeenCalledOnce();
  });
});

describe('win — endless mode', () => {
  it('shows the streak and a "Next Board" button', () => {
    setState({ mode: 'endless', endlessStreak: 7 });
    render(<Overlay />);
    expect(screen.getByText('Streak 7!')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Next Board' })).toBeInTheDocument();
  });
});

describe('win — daily mode', () => {
  beforeEach(() => {
    if (!navigator.clipboard) {
      Object.defineProperty(navigator, 'clipboard', {
        value: { writeText: () => Promise.resolve() },
        configurable: true,
      });
    }
  });

  it('copies a shareable result and flips the button to "Copied!"', async () => {
    const write = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();
    setState({ mode: 'daily', dailyKey: '2026-07-13', dailyStreak: 3 });
    render(<Overlay />);

    expect(screen.getByText('3 days in a row')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Share Result' }));

    expect(write).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Copied!' })).toBeInTheDocument();
  });

  it('the Home button routes home', async () => {
    setState({ mode: 'daily', dailyKey: '2026-07-13' });
    render(<Overlay />);
    await userEvent.click(screen.getByRole('button', { name: 'Home' }));
    expect(window.location.hash).toBe('#/');
  });
});

describe('game over', () => {
  it('deadlock shows "No moves left" and Restart calls the store', async () => {
    const restart = vi.fn();
    setState({ status: 'deadlocked', restart });
    render(<Overlay />);
    expect(screen.getByText('No moves left')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Restart Level' }));
    expect(restart).toHaveBeenCalledOnce();
  });

  it('a stuck loop shows "No way forward" (and no Undo affordance)', () => {
    setState({ status: 'stuck' });
    render(<Overlay />);
    expect(screen.getByText('No way forward')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /undo/i })).not.toBeInTheDocument();
  });
});
