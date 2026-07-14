import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PatternNudge } from './PatternNudge';
import { useSettings } from '../../store/settings';

const TIP = 'Hard to tell colors apart?';

beforeEach(() => {
  localStorage.clear();
  useSettings.setState({ patterns: false, patternsNudged: false });
});

describe('PatternNudge', () => {
  it('shows while the aid is off and the nudge has not been retired', () => {
    render(<PatternNudge />);
    expect(screen.getByText(TIP)).toBeInTheDocument();
  });

  it('is hidden once the aid is on', () => {
    useSettings.setState({ patterns: true });
    render(<PatternNudge />);
    expect(screen.queryByText(TIP)).not.toBeInTheDocument();
  });

  it('is hidden once the nudge has been retired', () => {
    useSettings.setState({ patternsNudged: true });
    render(<PatternNudge />);
    expect(screen.queryByText(TIP)).not.toBeInTheDocument();
  });

  it('Enable turns on the aid and hides the nudge', async () => {
    const user = userEvent.setup();
    render(<PatternNudge />);
    await user.click(screen.getByRole('button', { name: 'Enable' }));
    expect(useSettings.getState().patterns).toBe(true);
    expect(useSettings.getState().patternsNudged).toBe(true);
    expect(screen.queryByText(TIP)).not.toBeInTheDocument();
  });

  it('Dismiss retires the nudge without enabling the aid', async () => {
    const user = userEvent.setup();
    render(<PatternNudge />);
    await user.click(screen.getByRole('button', { name: 'Dismiss tip' }));
    expect(useSettings.getState().patterns).toBe(false);
    expect(useSettings.getState().patternsNudged).toBe(true);
    expect(screen.queryByText(TIP)).not.toBeInTheDocument();
  });
});
