import { test, expect } from '@playwright/test';

/**
 * The gameplay path — the one flow jsdom can't touch and the P0 smokes only skim: actually PLAYING
 * a board to a win. It drives the real board (GameBoard / Bottle / LiquidSegment pour rendering) and
 * the win overlay in a real browser.
 *
 * Winning deterministically without hard-coding a solution: enable the debug inspector (via the
 * hidden admin hatch) and use its `auto-solve`, which steps the board to a win through real pours —
 * the same code path a player's taps drive, just chosen by the solver.
 */
test('auto-solves a level to a win, driving the real board + win overlay', async ({ page }) => {
  await page.goto('/');

  // Reveal the hidden admin panel: 7 taps on the Settings title within 600ms of each other. Fire
  // them synchronously in one tick (sequential Playwright clicks can drift past that window).
  await page.getByRole('button', { name: 'Settings' }).click();
  await page
    .getByRole('heading', { name: 'Settings' })
    .evaluate((el: HTMLElement) => {
      for (let i = 0; i < 7; i++) el.click();
    });

  // Turn the Level Inspector on (persists to the settings store), then start level 1.
  await page.getByRole('switch', { name: 'Level Inspector' }).click();
  await page.getByRole('button', { name: 'Back' }).click();
  await page.getByRole('button', { name: 'Play' }).click();

  // The board renders (baked level 1 is instant), then open the inspector and auto-solve.
  await expect(page.getByLabel(/bottle with/i).first()).toBeVisible();
  await page.getByRole('button', { name: 'Show level inspector' }).click();
  await page.getByRole('button', { name: 'auto-solve' }).click();

  // Auto-solve pours to a win; a campaign win always offers "Next Level" in the overlay. Generous
  // timeout — the solve steps through ~16 pours with per-move animation.
  const nextLevel = page.getByRole('button', { name: 'Next Level' });
  await expect(nextLevel).toBeVisible({ timeout: 30_000 });
  // The overlay shows the earned rating. Scope to the overlay panel (the button's parent) — an
  // identical live-preview star rating also lives in the header.
  await expect(nextLevel.locator('..').getByRole('img', { name: /of 3 stars/ })).toBeVisible();
});
