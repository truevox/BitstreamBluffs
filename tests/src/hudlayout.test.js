import { rectsHit, stackY, placeX, bandHits, placeBand } from '../../src/ui/HudLayout.js';
import { measureText } from '../../src/ui/PixelFont.js';
import { fmtInt } from '../../src/ui/Format.js';

describe('HudLayout.stackY', () => {
  test('keeps classic positions when nothing collides', () => {
    const ys = stackY([{ w: 100, h: 24, pref: 24 }, { w: 100, h: 16, pref: 80 }], { cx: 240, gap: 3 });
    expect(ys).toEqual([24, 80]);
  });
  test('pushes simultaneous banners into separate slots (no overlap, order kept)', () => {
    const items = [{ w: 216, h: 24, pref: 24 }, { w: 228, h: 16, pref: 46 }, { w: 300, h: 16, pref: 80 }, { w: 120, h: 8, pref: 100 }];
    const ys = stackY(items, { cx: 240, gap: 3 });
    for (let i = 1; i < ys.length; i++) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1] + items[i - 1].h + 3);
  });
  test('moves a wide item below keep-out rectangles it would hit, but not a narrow one', () => {
    const keep = [{ x: 8, y: 0, w: 120, h: 60 }, { x: 352, y: 0, w: 120, h: 76 }];
    const [wide, narrow] = stackY([{ w: 440, h: 16, pref: 24 }, { w: 100, h: 16, pref: 24 }], { cx: 240, gap: 3, keepOuts: keep });
    expect(wide).toBeGreaterThanOrEqual(79);
    expect(narrow).toBeGreaterThanOrEqual(wide + 16 + 3);
    const [only] = stackY([{ w: 100, h: 16, pref: 24 }], { cx: 240, gap: 3, keepOuts: keep });
    expect(only).toBe(24);
  });
  test('widest realistic banners never intersect fixed HUD rows or each other', () => {
    const scoreW = measureText(fmtInt(9999999)) * 2;
    const left = [{ x: 8, y: 13, w: scoreW, h: 16 }, { x: 8, y: 31, w: measureText('99,999 M'), h: 8 }, { x: 8, y: 41, w: measureText('432 KM/H'), h: 8 }];
    const pendW = measureText(`+${fmtInt(2999970)}`) * 2;
    const right = [{ x: 472 - pendW, y: 43, w: pendW, h: 16 }, { x: 472 - measureText('FLOW x3.00'), y: 62, w: measureText('FLOW x3.00'), h: 8 }];
    const keep = [...left, ...right];
    const items = [
      { w: measureText('BOOST +1,234') * 3, h: 24, pref: 24 }, { w: measureText('PERFECT LANDING +20') * 2, h: 16, pref: 46 },
      { w: 17 * 12, h: 16, pref: 59 }, { w: 440, h: 16, pref: 80 }, { w: measureText('NEW BACKFLIP X2 +150'), h: 8, pref: 100 },
    ];
    const ys = stackY(items, { cx: 240, gap: 3, keepOuts: keep });
    items.forEach((it, i) => {
      const box = { x: 240 - it.w / 2, y: ys[i], w: it.w, h: it.h };
      for (const k of keep) expect(rectsHit(box, k)).toBe(false);
      if (i) expect(ys[i]).toBeGreaterThanOrEqual(ys[i - 1] + items[i - 1].h);
    });
  });
});

describe('HudLayout.placeX', () => {
  test('returns the preferred left when free and the nearest free spot otherwise', () => {
    expect(placeX(100, 240, 20, 8, [], { min: 8, max: 472 })).toBe(8);
    const touch = [{ x: 4, y: 170, w: 108, h: 94 }];
    expect(placeX(100, 242, 20, 8, touch, { min: 8, max: 472 })).toBe(115);
  });
  test('returns null when the row is blocked', () => {
    expect(placeX(100, 240, 20, 8, [{ x: 0, y: 230, w: 480, h: 40 }], { min: 0, max: 480 })).toBeNull();
  });
});

describe('HudLayout.placeBand — a full-width band must not paint through the HUD rows', () => {
  // The W2 defect: the mission toast strip is a full-width band, so its measured text missing the
  // fixed rows is not enough - its background fill crossed them and drew over "FLOW x1.25".
  const FLOW = { x: 380, y: 62, w: 92, h: 8 }; // flowText at FLOW_Y = 62, right-anchored
  const SCORE = { x: 4, y: 4, w: 120, h: 8 };

  test('a band that clears every row stays at its preferred y', () => {
    expect(placeBand(17, 100, [FLOW, SCORE])).toBe(100);
  });

  test('a band crossing a fixed row is pushed below it', () => {
    // 59 is the classic strip position and it crosses FLOW (62..70).
    const y = placeBand(17, 59, [FLOW]);
    expect(y).toBeGreaterThanOrEqual(FLOW.y + FLOW.h);
    expect(bandHits({ y, h: 17 }, [FLOW])).toBe(false);
  });

  test('bandHits is true for a band overlapping a row even if its own text would fit', () => {
    // The whole point: a narrow measured text does not save a full-width band.
    expect(bandHits({ y: 59, h: 17 }, [FLOW])).toBe(true);
    expect(bandHits({ y: 40, h: 17 }, [FLOW])).toBe(false);
  });

  test('it stacks below several rows in turn, not just the first', () => {
    const rows = [{ x: 0, y: 50, w: 480, h: 10 }, { x: 0, y: 63, w: 480, h: 10 }];
    const y = placeBand(16, 40, rows);
    expect(bandHits({ y, h: 16 }, rows)).toBe(false);
    expect(y).toBeGreaterThanOrEqual(73);
  });

  test('it never runs off the bottom of the screen', () => {
    // A pathological keep-out must clamp rather than place the band at y=400 on a 270 px screen.
    const tall = { x: 0, y: 0, w: 480, h: 260 };
    expect(placeBand(17, 59, [tall], { maxY: 270 })).toBeLessThanOrEqual(270);
  });

  test('no keep-outs means no movement', () => {
    expect(placeBand(17, 59, [])).toBe(59);
  });
});
