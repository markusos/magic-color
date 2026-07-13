import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toolbar } from './Toolbar';
import { useGameStore } from '../../store/gameStore';

function setState(overrides: Partial<Parameters<typeof useGameStore.setState>[0]> = {}) {
  useGameStore.setState({
    undo: vi.fn(),
    restart: vi.fn(),
    requestHint: vi.fn(),
    dismissHintUnavailable: vi.fn(),
    moves: [],
    status: 'playing',
    hintLoading: false,
    hintUnavailable: false,
    ...overrides,
  });
}

beforeEach(() => setState());
afterEach(() => vi.restoreAllMocks());

describe('Toolbar controls', () => {
  it('Undo is disabled with no moves and enabled once a move exists', () => {
    const { rerender } = render(<Toolbar />);
    expect(screen.getByRole('button', { name: /undo/i })).toBeDisabled();

    act(() => setState({ moves: [{ from: 0, to: 1 }] as never }));
    rerender(<Toolbar />);
    expect(screen.getByRole('button', { name: /undo/i })).toBeEnabled();
  });

  it('Undo / Restart / Hint dispatch their store actions', async () => {
    const undo = vi.fn();
    const restart = vi.fn();
    const requestHint = vi.fn();
    setState({ undo, restart, requestHint, moves: [{ from: 0, to: 1 }] as never });
    render(<Toolbar />);

    await userEvent.click(screen.getByRole('button', { name: /undo/i }));
    await userEvent.click(screen.getByRole('button', { name: /restart/i }));
    await userEvent.click(screen.getByRole('button', { name: /hint/i }));

    expect(undo).toHaveBeenCalledOnce();
    expect(restart).toHaveBeenCalledOnce();
    expect(requestHint).toHaveBeenCalledOnce();
  });

  it('Hint is disabled while a hint is loading or the game is not in play', () => {
    setState({ hintLoading: true });
    const { rerender } = render(<Toolbar />);
    expect(screen.getByRole('button', { name: /hint/i })).toBeDisabled();

    act(() => setState({ hintLoading: false, status: 'won' }));
    rerender(<Toolbar />);
    expect(screen.getByRole('button', { name: /hint/i })).toBeDisabled();
  });
});

describe('"No hint available" popover', () => {
  it('renders when hintUnavailable and auto-dismisses after 2s', () => {
    vi.useFakeTimers();
    try {
      const dismissHintUnavailable = vi.fn();
      setState({ hintUnavailable: true, dismissHintUnavailable });
      render(<Toolbar />);
      expect(screen.getByText('No hint available')).toBeInTheDocument();

      act(() => {
        vi.advanceTimersByTime(2000);
      });
      expect(dismissHintUnavailable).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });

  it('is absent when a hint is available', () => {
    render(<Toolbar />);
    expect(screen.queryByText('No hint available')).not.toBeInTheDocument();
  });
});
