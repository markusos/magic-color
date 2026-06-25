import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { shareOrCopy } from './share';

const data = { title: 'Magic Color', text: 'Sort the colors.', url: 'https://example.test/' };

beforeEach(() => {
  // jsdom doesn't provide navigator.clipboard — install a stub so specs can spy on writeText.
  if (!navigator.clipboard) {
    Object.defineProperty(navigator, 'clipboard', {
      value: { writeText: () => Promise.resolve() },
      configurable: true,
    });
  }
});

afterEach(() => {
  vi.restoreAllMocks();
  // Remove any navigator.share we attached so specs don't leak into each other.
  delete (navigator as { share?: unknown }).share;
});

describe('shareOrCopy', () => {
  it('uses the native share sheet when available', async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    (navigator as { share?: unknown }).share = share;
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();

    expect(await shareOrCopy(data)).toBe('shared');
    expect(share).toHaveBeenCalledWith(data);
    expect(copy).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard (text + url) when native share is absent', async () => {
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();

    expect(await shareOrCopy(data)).toBe('copied');
    expect(copy).toHaveBeenCalledWith('Sort the colors.\nhttps://example.test/');
  });

  it('does NOT copy when the user cancels the native share (AbortError)', async () => {
    (navigator as { share?: unknown }).share = vi
      .fn()
      .mockRejectedValue(new DOMException('cancelled', 'AbortError'));
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();

    expect(await shareOrCopy(data)).toBe('failed');
    expect(copy).not.toHaveBeenCalled();
  });

  it('falls back to the clipboard when native share fails for a non-abort reason', async () => {
    (navigator as { share?: unknown }).share = vi.fn().mockRejectedValue(new Error('boom'));
    const copy = vi.spyOn(navigator.clipboard, 'writeText').mockResolvedValue();

    expect(await shareOrCopy(data)).toBe('copied');
    expect(copy).toHaveBeenCalledWith('Sort the colors.\nhttps://example.test/');
  });

  it('reports failure when neither path works', async () => {
    vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('no clipboard'));
    expect(await shareOrCopy(data)).toBe('failed');
  });
});
