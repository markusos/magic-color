import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Settings } from './Settings';
import { useGameStore } from '../../store/gameStore';
import { useSettings } from '../../store/settings';

function setGame(overrides: Partial<Parameters<typeof useGameStore.setState>[0]> = {}) {
  useGameStore.setState({
    furthest: 1,
    startOver: vi.fn(),
    unlockUpTo: vi.fn(),
    loadLevel: vi.fn(),
    playRandom: vi.fn(),
    loadRandom: vi.fn(),
    playDaily: vi.fn(),
    reloadBoard: vi.fn(),
    ...overrides,
  });
}

beforeEach(() => {
  // Real settings store (these specs verify toggles actually persist), reset to known defaults.
  useSettings.setState({ soundVolume: 0.4, musicVolume: 0, haptics: true, patterns: false, inspector: false });
  setGame();
});

afterEach(() => {
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('preference toggles persist to the store', () => {
  it('Color Patterns flips the store value and the switch state', async () => {
    render(<Settings />);
    const sw = screen.getByRole('switch', { name: 'Color Patterns' });
    expect(sw).toHaveAttribute('aria-checked', 'false');

    await userEvent.click(sw);
    expect(useSettings.getState().patterns).toBe(true);
    expect(sw).toHaveAttribute('aria-checked', 'true');
  });

  it('the Sound Effects slider writes its value to the store', async () => {
    render(<Settings />);
    fireEvent.change(screen.getByRole('slider', { name: 'Sound Effects' }), { target: { value: '0.5' } });
    expect(useSettings.getState().soundVolume).toBe(0.5);
    // Flush the async core-version effect (initCoreWasm().then) so it settles inside act().
    await act(async () => {});
  });
});

describe('Start Over', () => {
  it('is disabled with nothing to reset (fresh frontier)', () => {
    setGame({ furthest: 1 });
    render(<Settings />);
    expect(screen.getByRole('button', { name: 'Start Over' })).toBeDisabled();
  });

  it('resets and routes to play when confirmed', async () => {
    const startOver = vi.fn();
    setGame({ furthest: 20, startOver });
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    render(<Settings />);

    await userEvent.click(screen.getByRole('button', { name: 'Start Over' }));
    expect(startOver).toHaveBeenCalledOnce();
    expect(window.location.hash).toBe('#/play');
  });

  it('does nothing when the confirm is dismissed', async () => {
    const startOver = vi.fn();
    setGame({ furthest: 20, startOver });
    vi.spyOn(window, 'confirm').mockReturnValue(false);
    render(<Settings />);

    await userEvent.click(screen.getByRole('button', { name: 'Start Over' }));
    expect(startOver).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('');
  });
});

describe('hidden admin hatch', () => {
  it('stays hidden until the title is tapped seven times', async () => {
    render(<Settings />);
    expect(screen.queryByText('Admin · Unlock levels')).not.toBeInTheDocument();

    const title = screen.getByRole('heading', { name: 'Settings' });
    for (let i = 0; i < 7; i++) await userEvent.click(title);

    expect(screen.getByText('Admin · Unlock levels')).toBeInTheDocument();
  });

  it('unlocks up to a valid level via the admin panel', async () => {
    const unlockUpTo = vi.fn();
    setGame({ furthest: 20, unlockUpTo });
    render(<Settings />);

    const title = screen.getByRole('heading', { name: 'Settings' });
    for (let i = 0; i < 7; i++) await userEvent.click(title);

    await userEvent.type(screen.getByLabelText('Level to unlock up to'), '10');
    await userEvent.click(screen.getByRole('button', { name: 'Unlock' }));
    expect(unlockUpTo).toHaveBeenCalledWith(10);
  });
});

describe('navigation', () => {
  it('Back routes home', async () => {
    render(<Settings />);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(window.location.hash).toBe('#/');
  });
});
