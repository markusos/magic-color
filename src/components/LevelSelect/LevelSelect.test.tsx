import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LevelSelect } from './LevelSelect';
import { useGameStore } from '../../store/gameStore';
import { CHAPTER_LEN } from '../../game/progression';

function setState(overrides: Partial<Parameters<typeof useGameStore.setState>[0]> = {}) {
  useGameStore.setState({
    furthest: 5,
    level: 3,
    levelStars: {},
    loadLevel: vi.fn(),
    ...overrides,
  });
}

beforeEach(() => {
  // jsdom doesn't implement Element.scrollTo; the page-reset effect calls it.
  if (!Element.prototype.scrollTo) Element.prototype.scrollTo = vi.fn();
  setState();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('level grid', () => {
  it('renders exactly the unlocked levels', () => {
    setState({ furthest: 5 });
    render(<LevelSelect />);
    for (const n of [1, 2, 3, 4, 5]) {
      expect(screen.getByRole('button', { name: new RegExp(`^${n}\\b`) })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: /^6\b/ })).not.toBeInTheDocument();
  });

  it('tapping a level loads it and routes to play', async () => {
    const loadLevel = vi.fn();
    setState({ furthest: 5, loadLevel });
    render(<LevelSelect />);
    await userEvent.click(screen.getByRole('button', { name: /^4\b/ }));
    expect(loadLevel).toHaveBeenCalledWith(4);
    expect(window.location.hash).toBe('#/play');
  });

  it('Back routes home', async () => {
    render(<LevelSelect />);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(window.location.hash).toBe('#/');
  });
});

describe('chapter pager', () => {
  it('is absent within a single chapter', () => {
    setState({ furthest: 5 });
    render(<LevelSelect />);
    expect(screen.queryByRole('button', { name: 'Next chapter' })).not.toBeInTheDocument();
  });

  it('appears and pages once the frontier spans multiple chapters', async () => {
    // Frontier in chapter 2 (0-indexed page 1) so the selector opens there with a Previous enabled.
    setState({ furthest: CHAPTER_LEN + 10 });
    render(<LevelSelect />);

    const prev = screen.getByRole('button', { name: 'Previous chapter' });
    const next = screen.getByRole('button', { name: 'Next chapter' });
    // Opens on the frontier's chapter (page 2 of 2): Next disabled, Previous enabled.
    expect(next).toBeDisabled();
    expect(prev).toBeEnabled();

    await userEvent.click(prev);
    // Now on chapter 1: its first level (1) is shown and Previous is disabled.
    expect(screen.getByRole('button', { name: /^1\b/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous chapter' })).toBeDisabled();
  });
});

describe('best-star display', () => {
  it('reflects the stored rating for a level', () => {
    setState({ furthest: 3, levelStars: { 2: 3 } });
    render(<LevelSelect />);
    const cell = screen.getByRole('button', { name: /^2\b/ });
    expect(within(cell).getByRole('img', { name: '3 of 3 stars' })).toBeInTheDocument();
  });
});
