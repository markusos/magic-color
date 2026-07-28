import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Bottle } from './Bottle';
import { color, tube } from '../../test/board';

/**
 * The reject shake (U7) is driven by a change signal rather than a boolean, so these specs assert on
 * the animation the component schedules. `animate` is spied through to the real implementation; the
 * shake is the only call that passes a KEYFRAME ARRAY (the tube tilt passes a single number), which
 * is what separates the two here.
 */
vi.mock('framer-motion', async () => {
  const actual = await vi.importActual<typeof import('framer-motion')>('framer-motion');
  return { ...actual, animate: vi.fn(actual.animate) };
});
const { animate } = await import('framer-motion');
const shakes = () => vi.mocked(animate).mock.calls.filter((args) => Array.isArray(args[1])).length;

afterEach(() => vi.mocked(animate).mockClear());

const props = {
  bottle: tube(['r', 'g']),
  capacity: 4,
  index: 1,
  capped: false,
  selected: false,
  lift: 20,
  onTap: () => {},
};

/**
 * A sighted player reads a tube's state off the glass; the label is the only channel a screen-reader
 * player has, so it must carry everything that changes what a pour can do.
 */
describe('accessible label', () => {
  const labelOf = () => screen.getByRole('button').getAttribute('aria-label');

  it('names the tube, its fill and the pourable top color', () => {
    render(<Bottle {...props} index={3} />);
    expect(labelOf()).toBe('bottle 3, 2 of 4 filled, top emerald');
  });

  it('reads an empty tube as empty rather than "0 of 4"', () => {
    render(<Bottle {...props} bottle={tube([])} />);
    expect(labelOf()).toBe('bottle 1, empty');
  });

  // The label must not leak what the hidden-colors mechanic exists to withhold.
  it('withholds a concealed top color', () => {
    render(<Bottle {...props} hidden={[false, true]} />);
    expect(labelOf()).toBe('bottle 1, 2 of 4 filled, top hidden');
  });

  it('reports the funnel lock, the ice block and target eligibility', () => {
    render(
      <Bottle
        {...props}
        funnel={color('r')}
        frozen={[color('b'), null]}
        isTarget
        bottle={tube(['r', 'g'])}
      />,
    );
    expect(labelOf()).toBe(
      'bottle 1, 2 of 4 filled, top emerald, only accepts ruby, 1 frozen, thaws when sapphire is complete, valid target',
    );
  });

  it('reads a finished tube as complete', () => {
    render(<Bottle {...props} bottle={tube(['r', 'r', 'r', 'r'])} capped />);
    expect(labelOf()).toBe('bottle 1, complete, ruby');
  });

  it('exposes selection as a pressed state', () => {
    const { rerender } = render(<Bottle {...props} />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'false');
    rerender(<Bottle {...props} selected />);
    expect(screen.getByRole('button')).toHaveAttribute('aria-pressed', 'true');
  });
});

describe('reject shake', () => {
  it('plays when the token changes to a new rejection', () => {
    const { rerender } = render(<Bottle {...props} shakeToken={0} />);
    expect(shakes()).toBe(0);

    rerender(<Bottle {...props} shakeToken={1} />);
    expect(shakes()).toBe(1);

    // The SAME tube rejected twice must shake again — that's why the signal is a nonce, not a flag.
    rerender(<Bottle {...props} shakeToken={2} />);
    expect(shakes()).toBe(2);
  });

  it('does not play on a re-render that leaves the token unchanged', () => {
    const { rerender } = render(<Bottle {...props} shakeToken={1} />);
    vi.mocked(animate).mockClear();
    rerender(<Bottle {...props} shakeToken={1} selected />);
    expect(shakes()).toBe(0);
  });

  // Leaving the board mid-rejection (Home → Continue) unmounts and remounts every tube. A tube that
  // mounts already holding a non-zero token must not twitch on sight.
  it('does not play when a tube MOUNTS already holding a token', () => {
    render(<Bottle {...props} shakeToken={4} />);
    expect(shakes()).toBe(0);
  });
});
