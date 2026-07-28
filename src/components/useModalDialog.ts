/**
 * Turns a rendered overlay into a real modal dialog for keyboard and screen-reader players.
 *
 * The app's overlays (the end-of-attempt panel, the chapter intro, the how-to/inspector popovers)
 * were plain `<div>`s over a backdrop: visually modal, but focus stayed on whatever was behind them,
 * Tab walked straight out into the board, and Escape did nothing. `aria-modal` on the markup asserts
 * that focus is contained — this hook is what makes that assertion true:
 *
 *   - moves focus INTO the panel on open (the first control, i.e. the action the player is meant to
 *     take — falling back to the panel itself, which is why callers set `tabIndex={-1}` on it);
 *   - keeps Tab / Shift+Tab cycling inside it;
 *   - closes on Escape when the dialog is dismissable at all (`onDismiss`); a terminal panel that
 *     demands a choice simply omits it;
 *   - hands focus back to whatever opened it on close, so the keyboard doesn't lose its place.
 */
import { useEffect, useRef } from 'react';

/** Everything focusable we render inside a panel. */
const FOCUSABLE = 'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function useModalDialog<T extends HTMLElement = HTMLDivElement>({
  open,
  onDismiss,
}: {
  open: boolean;
  /** Dismiss action, or omitted when the dialog must be answered rather than escaped. */
  onDismiss?: () => void;
}) {
  const panelRef = useRef<T>(null);
  // Read through a ref so a caller's inline arrow doesn't re-run (and so re-steal focus) every render.
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  useEffect(() => {
    if (!open) return;
    const panel = panelRef.current;
    if (!panel) return;

    const restoreTo = document.activeElement as HTMLElement | null;
    const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
    (focusable()[0] ?? panel).focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissRef.current) {
        event.preventDefault();
        dismissRef.current();
        return;
      }
      if (event.key !== 'Tab') return;
      // Contain Tab within the panel — wrap at both ends rather than leaking into the board behind.
      const items = focusable();
      if (items.length === 0) {
        event.preventDefault();
        return;
      }
      const first = items[0]!;
      const last = items[items.length - 1]!;
      const active = document.activeElement;
      if (!event.shiftKey && (active === last || !panel.contains(active))) {
        event.preventDefault();
        first.focus();
      } else if (event.shiftKey && (active === first || !panel.contains(active))) {
        event.preventDefault();
        last.focus();
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      // Only take focus back if the dialog still holds it — otherwise something else has moved on.
      if (panel.contains(document.activeElement)) restoreTo?.focus?.();
    };
  }, [open]);

  return panelRef;
}
