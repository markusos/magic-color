import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Home } from './Home';
import { useGameStore } from '../../store/gameStore';
import { shareOrCopy } from '../../share';

// The share helper hits navigator APIs; stub it so specs assert Home's reaction, not the platform.
vi.mock('../../share', () => ({ shareOrCopy: vi.fn().mockResolvedValue('copied') }));

function setState(overrides: Partial<Parameters<typeof useGameStore.setState>[0]> = {}) {
  useGameStore.setState({
    level: 1,
    mode: 'campaign',
    furthest: 1,
    dailyStreak: 0,
    dailyResult: null,
    campaignComplete: false,
    loadLevel: vi.fn(),
    playRandom: vi.fn(),
    playDaily: vi.fn(),
    ...overrides,
  });
}

beforeEach(() => setState());

afterEach(() => {
  vi.clearAllMocks();
  window.location.hash = '';
});

describe('primary action', () => {
  it('a fresh player sees "Play" and no Levels/Stats shortcuts', () => {
    setState({ furthest: 1 });
    render(<Home />);
    expect(screen.getByRole('button', { name: 'Play' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Levels' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Stats' })).not.toBeInTheDocument();
  });

  it('a returning player sees "Continue · Level N" plus Levels/Stats', () => {
    setState({ furthest: 12 });
    render(<Home />);
    expect(screen.getByRole('button', { name: 'Continue · Level 12' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Levels' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Stats' })).toBeInTheDocument();
  });

  it('a cleared campaign swaps the primary action for "Play Random"', async () => {
    const playRandom = vi.fn();
    setState({ furthest: 60, campaignComplete: true, playRandom });
    render(<Home />);
    await userEvent.click(screen.getByRole('button', { name: 'Play Random' }));
    expect(playRandom).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe('#/play');
  });
});

describe('continue reloads only when needed', () => {
  it('reloads the frontier board when arriving from another mode', async () => {
    const loadLevel = vi.fn();
    setState({ mode: 'daily', level: 3, furthest: 12, loadLevel });
    render(<Home />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue · Level 12' }));
    expect(loadLevel).toHaveBeenCalledWith(12);
    expect(window.location.hash).toBe('#/play');
  });

  it('keeps the in-progress board when already on the frontier level', async () => {
    const loadLevel = vi.fn();
    setState({ mode: 'campaign', level: 12, furthest: 12, loadLevel });
    render(<Home />);
    await userEvent.click(screen.getByRole('button', { name: 'Continue · Level 12' }));
    expect(loadLevel).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/play');
  });
});

describe('daily challenge', () => {
  it('starts the daily and routes to play', async () => {
    const playDaily = vi.fn();
    setState({ playDaily });
    render(<Home />);
    await userEvent.click(screen.getByRole('button', { name: /Daily Challenge/ }));
    expect(playDaily).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe('#/play');
  });

  it('marks today solved once the daily result is recorded', () => {
    setState({ dailyResult: { stars: 3 } as never });
    render(<Home />);
    expect(screen.getByLabelText('Solved today')).toBeInTheDocument();
  });

  it('shows the streak flame when a streak is running and not yet solved today', () => {
    setState({ dailyStreak: 4, dailyResult: null });
    render(<Home />);
    expect(screen.getByLabelText('4 day streak')).toBeInTheDocument();
  });
});

describe('secondary navigation', () => {
  it('Settings routes to the settings screen', async () => {
    render(<Home />);
    await userEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(window.location.hash).toBe('#/settings');
  });

  it('Share invokes the share helper and confirms on copy', async () => {
    render(<Home />);
    await userEvent.click(screen.getByRole('button', { name: 'Share Magic Color' }));
    expect(shareOrCopy).toHaveBeenCalledOnce();
    // A clipboard copy flips the button to its "Link copied" confirmation.
    expect(await screen.findByRole('button', { name: 'Link copied' })).toBeInTheDocument();
  });
});
