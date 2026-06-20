import { describe, it, expect, beforeEach } from 'vitest';
import { createCampaign } from './campaign';
import { BAKED_LEVEL_COUNT } from '../game/levelLoader';

beforeEach(() => {
  localStorage.clear();
});

describe('createCampaign', () => {
  it('starts a fresh player at level 1 with no records', () => {
    const c = createCampaign();
    expect(c.furthest).toBe(1);
    expect(c.levelStars).toEqual({});
    expect(c.recordFor(1)).toEqual({ best: null, bestStars: null });
  });

  it('reach raises the frontier but never lowers it', () => {
    const c = createCampaign();
    c.reach(5);
    expect(c.furthest).toBe(5);
    c.reach(3); // replaying an earlier level must not demote
    expect(c.furthest).toBe(5);
  });

  it('complete keeps the fewest moves and the most stars', () => {
    const c = createCampaign();
    expect(c.complete(2, 10, 2)).toEqual({ best: 10, bestStars: 2 });
    // A worse attempt does not overwrite the record.
    expect(c.complete(2, 14, 1)).toEqual({ best: 10, bestStars: 2 });
    // A better attempt does.
    expect(c.complete(2, 8, 3)).toEqual({ best: 8, bestStars: 3 });
    expect(c.levelStars).toEqual({ 2: 3 });
  });

  it('persists across instances via localStorage', () => {
    const a = createCampaign();
    a.reach(4);
    a.complete(4, 7, 3);
    const b = createCampaign(); // a new service reads the same storage
    expect(b.furthest).toBe(4);
    expect(b.recordFor(4)).toEqual({ best: 7, bestStars: 3 });
  });

  it('unlockTo clamps to 1..max and only raises the frontier', () => {
    const c = createCampaign();
    c.unlockTo(30, BAKED_LEVEL_COUNT);
    expect(c.furthest).toBe(30);
    c.unlockTo(5000, BAKED_LEVEL_COUNT); // above max -> clamped
    expect(c.furthest).toBe(BAKED_LEVEL_COUNT);
    c.unlockTo(2, BAKED_LEVEL_COUNT); // below current frontier -> no demotion
    expect(c.furthest).toBe(BAKED_LEVEL_COUNT);
  });

  it('furthest never exceeds the baked campaign, even for a legacy save past it', () => {
    const a = createCampaign();
    a.reach(999); // a legacy save that advanced into the old endless tail
    expect(a.furthest).toBe(BAKED_LEVEL_COUNT);
  });

  it('campaignComplete flips once the last baked level is completed', () => {
    const c = createCampaign();
    expect(c.campaignComplete).toBe(false);
    c.complete(BAKED_LEVEL_COUNT, 20, 2);
    expect(c.campaignComplete).toBe(true);
  });

  it('reset wipes progress back to level 1', () => {
    const c = createCampaign();
    c.reach(9);
    c.complete(9, 3, 3);
    c.reset();
    expect(c.furthest).toBe(1);
    expect(c.levelStars).toEqual({});
    expect(c.recordFor(9)).toEqual({ best: null, bestStars: null });
  });
});
