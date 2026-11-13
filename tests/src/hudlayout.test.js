import { rectsHit, stackY, placeX } from '../../src/ui/HudLayout.js';
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
