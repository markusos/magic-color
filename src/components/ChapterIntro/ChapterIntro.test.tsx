import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChapterIntro } from './ChapterIntro';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settings';

/** Level 61 is the first Hidden-Colors level (chapter 1) — the first chapter that teaches a mechanic. */
const HIDDEN_LEVEL = 61;

function setState(overrides: Partial<Parameters<typeof useGameStore.setState>[0]> = {}) {
  useGameStore.setState({
    level: HIDDEN_LEVEL,
    mode: 'campaign',
    loading: false,
    status: 'playing',
    ...overrides,
  });
}

beforeEach(() => {
  localStorage.clear();
  useSettings.setState({ seenChapters: [] });
  setState();
});

describe('ChapterIntro visibility', () => {
  it('shows the intro on first entry into a mechanic chapter', () => {
    render(<ChapterIntro />);
    expect(screen.getByText('New mechanic')).toBeInTheDocument();
    expect(screen.getByText('Hidden Colors')).toBeInTheDocument();
  });

  it('does not show for the base game (chapter 0)', () => {
    setState({ level: 1 });
    render(<ChapterIntro />);
    expect(screen.queryByText('New mechanic')).not.toBeInTheDocument();
  });

  it('does not show once the chapter has been seen', () => {
    useSettings.setState({ seenChapters: [1] });
    render(<ChapterIntro />);
    expect(screen.queryByText('New mechanic')).not.toBeInTheDocument();
  });

  it('does not show outside campaign mode', () => {
    setState({ mode: 'daily' });
    render(<ChapterIntro />);
    expect(screen.queryByText('New mechanic')).not.toBeInTheDocument();
  });

  it('does not show while the board is loading', () => {
    setState({ loading: true });
    render(<ChapterIntro />);
    expect(screen.queryByText('New mechanic')).not.toBeInTheDocument();
  });

  // The card blocks the board, so it has to behave like a modal for keyboard players too: named,
  // focused, and closable with Escape the same way tapping the backdrop already closed it.
  it('is a dialog that takes focus and closes on Escape', async () => {
    render(<ChapterIntro />);
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleName('Hidden Colors');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Got it' }));

    await userEvent.keyboard('{Escape}');
    expect(useSettings.getState().seenChapters).toContain(1); // chapter 1 = Hidden Colors
  });

  it('dismissing marks the chapter seen and hides the card', async () => {
    const user = userEvent.setup();
    render(<ChapterIntro />);
    await user.click(screen.getByText('Got it'));
    expect(useSettings.getState().seenChapters).toContain(1);
    // The card animates out (AnimatePresence exit), so poll for its removal.
    await waitFor(() => expect(screen.queryByText('New mechanic')).not.toBeInTheDocument());
  });
});
