import { describe, expect, it, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { InfoButton } from './InfoButton';
import { useSettings } from '../../store/settings';
import { useGameStore } from '../../store/gameStore';
import { board } from '../../test/board';

describe('InfoButton', () => {
  beforeEach(() => {
    useSettings.setState({ inspector: false, inspectorOpen: false });
    useGameStore.setState({
      level: 1,
      phase: 'easy',
      mode: 'campaign',
      mechanics: [],
      optimal: 16,
      twoStarMax: 18,
      current: board([['r', 'g'], []], 4),
    });
  });

  it('opens the how-to-play popover when the inspector is disabled', async () => {
    render(<InfoButton />);
    expect(screen.getByLabelText('How to play')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('How to play'));
    expect(screen.getByText('How to play', { selector: 'h2' })).toBeInTheDocument();
  });

  it('opens the inspector popover (not how-to) when the inspector is enabled', async () => {
    useSettings.setState({ inspector: true, inspectorOpen: false });
    render(<InfoButton />);
    // Starts closed, like how-to-play.
    expect(screen.getByLabelText('Show level inspector')).toBeInTheDocument();
    expect(screen.queryByLabelText('Level inspector')).not.toBeInTheDocument();

    await userEvent.click(screen.getByLabelText('Show level inspector'));
    expect(useSettings.getState().inspectorOpen).toBe(true);
    // The inspector readout shows, and no how-to-play popover appears.
    expect(screen.getByLabelText('Level inspector')).toBeInTheDocument();
    expect(screen.getByText('Inspector · L1')).toBeInTheDocument();
    expect(screen.queryByText('How to play', { selector: 'h2' })).not.toBeInTheDocument();
    // The button now offers to hide it.
    expect(screen.getByLabelText('Hide level inspector')).toBeInTheDocument();
  });

  it('closes the inspector popover when the button is tapped again', async () => {
    useSettings.setState({ inspector: true, inspectorOpen: true });
    render(<InfoButton />);
    expect(screen.getByLabelText('Level inspector')).toBeInTheDocument();
    await userEvent.click(screen.getByLabelText('Hide level inspector'));
    expect(useSettings.getState().inspectorOpen).toBe(false);
  });
});
