/**
 * Run `fn` (a blocking level generation) only AFTER the browser has painted and composited the
 * current frame (the loading spinner). A bare `setTimeout(0)` does NOT guarantee a paint before the
 * macrotask runs, so the generation can start before the spinner ever appears — it gets committed to
 * the DOM and then starved, which is why the spinner was never seen. Two nested rAFs land us just
 * after the spinner's frame has composited (its rotation runs on the compositor, so it keeps spinning
 * through the blocking work).
 *
 * The `setTimeout` is a safety net, not just a non-DOM fallback: rAF is PAUSED while the tab is
 * hidden/backgrounded, so without it a player who tabs away mid-load would be stuck on the spinner
 * forever. Whichever fires first wins (guarded by `ran`); when foregrounded the double-rAF (~32ms)
 * beats the timeout, so we still get a real paint.
 *
 * This is a pure browser-timing concern, deliberately kept out of the game store: the store decides
 * *what* to defer, this module owns *when* it runs.
 */
export function deferAfterPaint(fn: () => void): void {
  if (typeof requestAnimationFrame !== 'function') {
    setTimeout(fn, 0);
    return;
  }
  let ran = false;
  const run = () => {
    if (ran) return;
    ran = true;
    clearTimeout(timer);
    fn();
  };
  requestAnimationFrame(() => requestAnimationFrame(run));
  const timer = setTimeout(run, 150);
}
