/** Follow-up 1: BEST and DIED HERE labels never overprint, whatever the x gap or slope (pure, systems/MarkerLayout.js). */
import { layoutMarkerLabels, NEAR_PX, BEST_LABEL_RISE, DEATH_LABEL_RISE } from '../../src/systems/MarkerLayout.js';

const W = 170; // wider than any real label at 12px monospace ("DIED HERE 9999m" is ~110px)
const H = 16;  // label height (12px font)
const BX = 5000;

/** Label rectangle: bottom edge at p.y, text hangs left of p.x for originX 1, centred for 0.5. */
function rect(p) {
  const left = p.originX === 1 ? p.x - W : p.x - W / 2;
  return { l: left, r: left + W, t: p.y - H, b: p.y };
}
const hit = (a, b) => a.l < b.r && b.l < a.r && a.t < b.b && b.t < a.b;
const poleHits = (poleX, poleY, height, r) => poleX > r.l && poleX < r.r && r.b > poleY - height && r.t < poleY;

const DX = [0, 1, 5, 40, 79, 150, 219, 220, 400, -3, -40, -150, -219, -300];
const DY = [0, 30, -30, 70, -70]; // terrain y at the death pole relative to the BEST pole (slope)

describe('layoutMarkerLabels', () => {
  const cases = [];
  for (const dx of DX) for (const dy of DY) cases.push([dx, dy]);

  test.each(cases)('death %i px / %i dy from best: the two labels never overprint', (dx, dy) => {
    const L = layoutMarkerLabels({ x: BX, y: 600 }, { x: BX + dx, y: 600 + dy });
    expect(hit(rect(L.best), rect(L.death))).toBe(false);
  });

  test.each(cases)('death %i px / %i dy from best: no pole crosses either label', (dx, dy) => {
    const best = { x: BX, y: 600 };
    const death = { x: BX + dx, y: 600 + dy };
    const L = layoutMarkerLabels(best, death);
    for (const r of [rect(L.best), rect(L.death)]) {
      expect(poleHits(best.x, best.y, 90, r)).toBe(false);
      expect(poleHits(death.x, death.y, 118, r)).toBe(false);
    }
  });

  test('near poles: both labels hang left of the leftmost pole on one anchor, DIED HERE above BEST', () => {
    const L = layoutMarkerLabels({ x: BX, y: 600 }, { x: BX + 4, y: 600 });
    expect(L.best.originX).toBe(1);
    expect(L.death.originX).toBe(1);
    expect(L.best.x).toBe(L.death.x);
    expect(L.best.x).toBeLessThan(BX);
    expect(L.death.y).toBeLessThan(L.best.y);
  });

  test('far poles: each label stays centred over its own pole at the stock height', () => {
    const L = layoutMarkerLabels({ x: BX, y: 600 }, { x: BX + NEAR_PX, y: 640 });
    expect(L.best).toEqual({ x: BX, y: 600 - BEST_LABEL_RISE, originX: 0.5 });
    expect(L.death).toEqual({ x: BX + NEAR_PX, y: 640 - DEATH_LABEL_RISE, originX: 0.5 });
  });

  test('only one marker (or terrain y not known yet): that label keeps its stock placement', () => {
    expect(layoutMarkerLabels({ x: BX, y: 600 }, null)).toEqual({ best: { x: BX, y: 600 - BEST_LABEL_RISE, originX: 0.5 }, death: null });
    expect(layoutMarkerLabels(null, { x: BX, y: 600 })).toEqual({ best: null, death: { x: BX, y: 600 - DEATH_LABEL_RISE, originX: 0.5 } });
    expect(layoutMarkerLabels({ x: BX, y: 600 }, { x: BX, y: NaN }).death).toBe(null);
  });
});
