import { describe, it, expect, beforeEach } from 'vitest';
import { dismissInstallBanner, isInstallBannerDismissed } from './installState';

describe('install banner dismissal persistence', () => {
  beforeEach(() => localStorage.clear());

  it('suppresses the banner after dismissal, then re-shows it a few levels later', () => {
    expect(isInstallBannerDismissed(5)).toBe(false); // never dismissed → shown
    dismissInstallBanner(5);
    expect(isInstallBannerDismissed(5)).toBe(true); // just dismissed → hidden
    expect(isInstallBannerDismissed(7)).toBe(true); // still within the re-show window
    expect(isInstallBannerDismissed(8)).toBe(false); // 3 levels on → gentle re-nudge
  });

  it('a full storage wipe (the Start Over clean slate) forgets the dismissal', () => {
    dismissInstallBanner(20);
    expect(isInstallBannerDismissed(20)).toBe(true);
    // "Start Over" clears ALL site storage — the dismissal key goes with it, so a reset player is
    // re-offered the install banner exactly like a brand-new one.
    localStorage.clear();
    expect(isInstallBannerDismissed(1)).toBe(false);
  });

  it('degrades to "not dismissed" when the stored value is malformed', () => {
    localStorage.setItem('magic-color:install-dismissed:v1', 'not-a-number');
    expect(isInstallBannerDismissed(5)).toBe(false);
  });
});
