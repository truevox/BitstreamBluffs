/** Follow-up 1: BEST and DIED HERE labels never overprint, whatever the x gap or slope (pure, systems/MarkerLayout.js). */
import { layoutMarkerLabels, joinedMarkerHeight, NEAR_PX, BEST_LABEL_RISE, DEATH_LABEL_RISE } from '../../src/systems/MarkerLayout.js';

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


describe('#253 visual marker must not prefetch authoritative terrain', () => {
  const joined = new Map([
    [1, {startX: 0, endX: 1600}],
    [2, {startX: 1600, endX: 3200}],
  ]);
  test('defers marker drawing until its terrain joins physics (without calling a mutating heightAt)', () => {
    let calls=0;
    const height = (x) => { calls++; return x/2; };
    for (const x of [4500, 5600, 9000, -200, NaN, Infinity]) {
      expect(joinedMarkerHeight(x, joined, height)).toBeNaN();
    }
    expect(calls).toBe(0); // no TerrainGenerator._chunkAt() read ahead
    // Marker x is far ahead but within the BestMarker's 2600px show radius.
    const markerX=4500, sledX=2000;
    expect(markerX-sledX).toBeLessThan(2600);
    expect(joinedMarkerHeight(markerX, joined, height)).toBeNaN();
    expect(calls).toBe(0);
    joined.set(3, {startX:3200,endX:5600});
    expect(joinedMarkerHeight(markerX, joined, height)).toBe(2250);
    expect(calls).toBe(1); // exact existing ground geometry, no fallback extrapolation
  });
  test('matches the registered terrain height exactly at joined coordinates, including edges', () => {
    const heights=[];
    const height=(x) => {heights.push(x); return Math.sin(x)*80+1000;};
    for(const x of [0,150,1599,1600,2500,3199,3200]) {
      expect(joinedMarkerHeight(x, joined, height)).toBe(height(x));
    }
    expect(heights).toHaveLength(14);
    expect(joinedMarkerHeight(5600.001, joined, height)).toBeNaN();
  });
  test('missing and invalid mesh/height inputs fail closed rather than generating terrain', () => {
    expect(joinedMarkerHeight(1200,null,()=>0)).toBeNaN();
    expect(joinedMarkerHeight(1200,new Map(),()=>0)).toBeNaN();
    expect(joinedMarkerHeight(1200,joined,undefined)).toBeNaN();
    expect(joinedMarkerHeight(1200,new Map([[1,{startX:NaN,endX:Infinity}]]),()=>0)).toBeNaN();
  });
});
