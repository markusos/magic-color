import { test, expect } from '@playwright/test';

/**
 * P0 critical-path smokes — the flows where a break means "the game won't start / won't navigate".
 * These run against the real production build in Chromium, so they exercise the wasm boot and the
 * History-backed hash router that jsdom can't. The full play-to-win path lives in play.spec.ts;
 * remaining follow-ups (PWA offline, layout-fit, visual regression) layer on top of this scaffold.
 */

test('boots to the start screen', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Magic Color' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Play' })).toBeVisible();
});

test('navigates home ↔ settings and honors the Back button', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings' }).click();

  await expect(page).toHaveURL(/#\/settings$/);
  await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

  // The router is History-backed, so the browser Back gesture must return to the start screen.
  await page.goBack();
  await expect(page).toHaveURL(/\/(#\/?)?$/);
  await expect(page.getByRole('heading', { name: 'Magic Color' })).toBeVisible();
});

test('starts a level and renders a playable board', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Play' }).click();

  await expect(page).toHaveURL(/#\/play$/);
  // The board loads (baked levels are instant; the live tail shows a spinner first) — either way a
  // bottle becomes visible. Bottles expose an accessible label, so no test ids are needed.
  await expect(page.getByLabel(/bottle with/i).first()).toBeVisible();

  // The in-game Home control returns to the start screen.
  await page.getByRole('button', { name: 'Home' }).click();
  await expect(page.getByRole('heading', { name: 'Magic Color' })).toBeVisible();
});
