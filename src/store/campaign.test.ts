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

  it('admin unlock to the last level opens Play Random; a partial unlock does not', () => {
    const c = createCampaign();
    c.unlockTo(BAKED_LEVEL_COUNT - 1, BAKED_LEVEL_COUNT); // partial -> random still locked
    expect(c.campaignComplete).toBe(false);
    c.unlockTo(BAKED_LEVEL_COUNT, BAKED_LEVEL_COUNT); // full -> random unlocked
    expect(c.campaignComplete).toBe(true);
  });

  it('admin random unlock survives a reload (persisted)', () => {
    createCampaign().unlockTo(BAKED_LEVEL_COUNT, BAKED_LEVEL_COUNT);
    expect(createCampaign().campaignComplete).toBe(true);
  });

  it('admin random unlock re-arms when a later chapter raises the level count', () => {
    // The admin unlock forges a completion of *its* last level, not a standalone flag. If a future
    // chapter grows BAKED_LEVEL_COUNT past it (simulated here with a smaller `max`), campaignComplete
    // falls back to false — the campaign resumes into the new levels, just as for organic finishers.
    const c = createCampaign();
    c.unlockTo(5, 5); // as if the campaign were only 5 levels long today
    expect(c.campaignComplete).toBe(false); // best[BAKED_LEVEL_COUNT] still absent
  });

  it('a genuine win still overrides the worst-case score the admin unlock recorded', () => {
    const c = createCampaign();
    c.unlockTo(BAKED_LEVEL_COUNT, BAKED_LEVEL_COUNT);
    c.complete(BAKED_LEVEL_COUNT, 12, 3);
    expect(c.recordFor(BAKED_LEVEL_COUNT).best).toBe(12);
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
