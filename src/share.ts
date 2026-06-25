/**
 * Share helper — prefer the native Web Share API (the system share sheet, available on most phones
 * and some desktops) and fall back to copying to the clipboard everywhere else. Kept UI-agnostic and
 * returns an outcome so callers can show the right confirmation ("shared" needs none — the OS handled
 * it; "copied" should surface a "Copied!" hint; "failed"/cancelled does nothing).
 */
export type ShareOutcome = 'shared' | 'copied' | 'failed';

export interface ShareData {
  title: string;
  text: string;
  /** Optional link; appended to the text on the clipboard fallback so the copy is self-contained. */
  url?: string;
}

/**
 * Open the native share sheet if available, otherwise copy `text` (+ `url`) to the clipboard.
 * A user-cancelled native share (AbortError) returns 'failed' WITHOUT falling back to a copy — the
 * user deliberately dismissed it. Any other native-share error does fall through to the clipboard.
 */
export async function shareOrCopy(data: ShareData): Promise<ShareOutcome> {
  const { title, text, url } = data;

  if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
    try {
      await navigator.share({ title, text, url });
      return 'shared';
    } catch (err) {
      // The user dismissed the share sheet — respect that, don't silently copy instead.
      if (err instanceof DOMException && err.name === 'AbortError') return 'failed';
      // Anything else (unsupported payload, transient failure) → fall through to the clipboard copy.
    }
  }

  const clip = url ? `${text}\n${url}` : text;
  try {
    await navigator.clipboard.writeText(clip);
    return 'copied';
  } catch {
    return 'failed';
  }
}
