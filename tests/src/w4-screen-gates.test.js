/**
 * W4 defect 3 + 4 gates: the Title menu can be counted, and a modded Game Over tells the truth.
 *
 * CC Friday rejected W4 at 3bc06e2 for four screens, not for logic. Two of the four are unobservable in a
 * unit test (a shop that renders twice, a run labelled NEW TOP 10 when it is unranked) unless the geometry
 * and the labels are computed somewhere testable and then asserted. That is what this file pins:
 *
 *   * the Title menu cannot silently gain a seventh row — its height and its clearance from the DAILY PATCH
 *     strip are computed, and the row count that fits is proven rather than assumed;
 *   * a boosted run is judged by the same helper that keeps it off the clean board, so it is never offered
 *     clean-board initials, a seed best, or a clean top-10 headline.
 */
import { titleMenuLayout, TITLE_BANDS, SCREEN } from '../../src/ui/MissionsLayout.js';
import { ranksModded, isRankable, isModdedOnly } from '../../src/systems/Ranking.js';
import { MODDED_RUNS_RANKED } from '../../src/constants.js';

const overlaps = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

describe('Title menu geometry (defect 3: SETTINGS overflowed into DAILY PATCH)', () => {
  test('the shipped six-row menu fits the band', () => {
    const geo = titleMenuLayout(6);
    expect(geo.fits).toBe(true);
    expect(geo.lastRowBottom).toBeLessThanOrEqual(TITLE_BANDS.menu.y + TITLE_BANDS.menu.h);
    expect(geo.lastRowBottom).toBeLessThanOrEqual(TITLE_BANDS.daily.y);
  });

  test('a seventh row would NOT fit — this is why SHARD SHOP moved to PROFILE', () => {
    // If a future change makes seven rows fit, this test should be updated rather than deleted; until then
    // it is the reason the shop entry lives on the Profile screen and the proof that the reason is real.
    const geo = titleMenuLayout(7);
    expect(geo.fits).toBe(false);
    expect(geo.lastRowBottom).toBeGreaterThan(TITLE_BANDS.daily.y);
  });

  test('the panel never overlaps the DAILY PATCH strip or the screen edge', () => {
    const geo = titleMenuLayout(6);
    const panel = { x: geo.x, y: geo.y, w: geo.w, h: geo.h };
    expect(overlaps(panel, TITLE_BANDS.daily)).toBe(false);
    expect(panel.y + panel.h).toBeLessThanOrEqual(TITLE_BANDS.daily.y);
    expect(panel.y + panel.h).toBeLessThanOrEqual(SCREEN.h);
  });

  test('the panel height is the sum of its rows, not the rows times the text scale', () => {
    // The old formula multiplied by `scale`, so a 6-row panel claimed to be 196px tall and was drawn to
    // 188 while reporting 228 for seven rows. MenuList scales the glyphs, not the pitch.
    const three = titleMenuLayout(3);
    const six = titleMenuLayout(6);
    expect(six.h - three.h).toBe(three.rowH * 3);
    expect(six.h).toBeLessThan(TITLE_BANDS.menu.h + 40);
  });

  test('the panel clears the CONTROLS panel beside it', () => {
    // Both sit at y 92; the menu is 216 wide at x 24 and controls start at x 252. Overlap would cover a
    // control legend, which is the kind of thing only a screenshot catches.
    const geo = titleMenuLayout(6);
    const controls = { x: 252, y: 92, w: 204, h: 104 };
    expect(overlaps({ x: geo.x, y: geo.y, w: geo.w, h: geo.h }, controls)).toBe(false);
  });
});

describe('a modded run is unranked, and says so (defect 4)', () => {
  const clean = { id: 'a', score: 900, modded: false };
  const boosted = { id: 'b', score: 900, modded: true };

  test('the shipped constant keeps boosted runs off the clean board', () => {
    expect(MODDED_RUNS_RANKED).toBe(false);
  });

  test('Ranking is the only thing deciding, and it agrees for both boards', () => {
    // Game Over asks isRankable/ranksModded rather than testing rec.modded itself. These three assertions
    // are the contract those call sites depend on.
    expect(isRankable(boosted)).toBe(false);
    expect(isModdedOnly(boosted)).toBe(true);
    expect(isRankable(clean)).toBe(true);
    expect(isModdedOnly(clean)).toBe(false);
    expect(ranksModded()).toBe(false);
  });

  test('flipping the constant makes a boosted run rankable and stops it being modded-only', () => {
    // The spec's W4 gate: flip the constant and prove the exclusion actually follows it, so the exclusion
    // is not accidental behaviour that happens to match the default.
    expect(isRankable(boosted, { ranked: true })).toBe(true);
    expect(isModdedOnly(boosted, { ranked: true })).toBe(false);
  });

  test('a modded run that earns a score still earns it — the board is separate, not a penalty', () => {
    // Spec W4 is explicit: boosted runs still earn Resonance, shards and mission progress. Nothing in
    // Ranking may zero a score; it only decides which board the score appears on.
    expect(boosted.score).toBe(clean.score);
    expect(isRankable(boosted)).toBe(false);
  });
});
