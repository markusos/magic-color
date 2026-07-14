import { describe, it, expect } from 'vitest';
import { render, waitFor } from '@testing-library/react';
import { LiquidSegment } from './LiquidSegment';

const cover = (c: HTMLElement) => c.querySelector('[class*="revealCover"]');

describe('LiquidSegment reveal (U5)', () => {
  it('lays no reveal cover on a normal (never-concealed) band', () => {
    const { container } = render(<LiquidSegment color="ruby" isBottom isTop={false} hidden={false} />);
    expect(cover(container)).toBeNull();
  });

  it('lays no cover while a band stays concealed', () => {
    const { container } = render(<LiquidSegment color="ruby" isBottom isTop={false} hidden />);
    expect(cover(container)).toBeNull();
  });

  it('fades a reveal cover in when a concealed band becomes revealed', async () => {
    const { container, rerender } = render(<LiquidSegment color="ruby" isBottom isTop={false} hidden />);
    expect(cover(container)).toBeNull();
    // A pour exposes the cell: hidden flips false, so the cover melts the color into view.
    rerender(<LiquidSegment color="ruby" isBottom isTop={false} hidden={false} />);
    await waitFor(() => expect(cover(container)).not.toBeNull());
  });
});
