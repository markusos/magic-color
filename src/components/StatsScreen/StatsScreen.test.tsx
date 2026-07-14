import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StatsScreen } from './StatsScreen';
import { useGameStore } from '../../store/gameStore';

const STATS = {
  levelsCompleted: 18,
  campaignLength: 60,
  totalStars: 40,
  maxStars: 180,
  threeStarCount: 7,
  current: 19,
  hintsUsed: 3,
  randomHardBestStreak: 0,
  chapters: [{ chapter: 0, name: 'Beginnings', completed: 18, total: 60, stars: 40, maxStars: 180 }],
};

function setState(stats: object = STATS, dailyStreak = 0) {
  useGameStore.setState({
    campaignStats: () => stats as never,
    dailyStreak,
  });
}

beforeEach(() => setState());

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('summary cards', () => {
  it('renders the aggregate roll-up from the store', () => {
    render(<StatsScreen />);
    // Card label and value sit in sibling divs, so walk up from the label to the enclosing card.
    const card = (label: string) => screen.getByText(label).parentElement!.parentElement!;
    expect(card('Levels cleared')).toHaveTextContent('18');
    expect(card('Stars earned')).toHaveTextContent('40');
    expect(card('3-star clears')).toHaveTextContent('7');
    expect(card('Current level')).toHaveTextContent('19');
    expect(screen.getByText('Hints used').closest('div')).toHaveTextContent('3');
  });
});

describe('conditional rows', () => {
  it('hides the daily-streak row when there is no streak', () => {
    setState(STATS, 0);
    render(<StatsScreen />);
    expect(screen.queryByText('Daily streak')).not.toBeInTheDocument();
  });

  it('shows the daily-streak row when a streak is running', () => {
    setState(STATS, 5);
    render(<StatsScreen />);
    expect(screen.getByText('Daily streak').closest('div')).toHaveTextContent('5');
  });

  it('shows the best-random-streak row only when set', () => {
    setState({ ...STATS, randomHardBestStreak: 9 });
    render(<StatsScreen />);
    expect(screen.getByText('Best random streak').closest('div')).toHaveTextContent('9');
  });
});

describe('chapter breakdown', () => {
  it('lists each chapter with its completion count', () => {
    render(<StatsScreen />);
    const item = screen.getByText('Beginnings').closest('li')!;
    expect(within(item).getByText('18/60')).toBeInTheDocument();
  });
});

describe('navigation', () => {
  it('Back routes home', async () => {
    render(<StatsScreen />);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(window.location.hash).toBe('#/');
  });
});
