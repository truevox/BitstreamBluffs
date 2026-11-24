import { bsodWindVisualStrength } from '../../src/systems/BsodWindVisual.js';
import { bsodSnapshot, compressedTailwind, BSOD_DEFAULTS } from '../../src/systems/BsodPursuit.js';

const snap = (gapPx, relativeAirX=1000, atmosphereDensity=1) => ({
  active:true,relativeAirX,atmosphereDensity,
  proximity01:Math.max(0,Math.min(1,1-gapPx/BSOD_DEFAULTS.dangerRangePx)),
});

test('real dangerous wind cannot look maxed out when the wall is still far away',()=>{
  const gaps=[7600,3400,2000,1000,500,200,0];
  const strengths=gaps.map(x=>bsodWindVisualStrength(snap(x)));
  expect(strengths[0]).toBeCloseTo(0.16,5);
  expect(strengths[1]).toBeCloseTo(0.16,5);
  expect(strengths[2]).toBeLessThan(0.33);
  expect(strengths[3]).toBeGreaterThan(0.53);
  expect(strengths[4]).toBeLessThan(0.79);
  expect(strengths[5]).toBeGreaterThan(0.89);
  expect(strengths[6]).toBe(1);
  for(let i=1;i<strengths.length;i++)expect(strengths[i]).toBeGreaterThanOrEqual(strengths[i-1]);
});

test('negative relative airflow still points backward and builds near danger, with no fake wind',()=>{
  expect(bsodWindVisualStrength(snap(500,800))).toBeCloseTo(
    bsodWindVisualStrength(snap(500,-800)));
  expect(bsodWindVisualStrength(snap(0,0))).toBe(0);
  expect(bsodWindVisualStrength(snap(0,1000,0))).toBe(0);
  expect(bsodWindVisualStrength({...snap(0),active:false})).toBe(0);
  expect(bsodWindVisualStrength(null)).toBe(0);
  expect(bsodWindVisualStrength({...snap(0),relativeAirX:NaN})).toBe(0);
  expect(bsodWindVisualStrength({...snap(0),proximity01:Infinity})).toBeLessThan(0.2);
  expect(bsodWindVisualStrength(snap(0,100,0.5))).toBeLessThan(0.15);
});

test('pure decorative ramp does not alter physical compressed tailwind or chase states',()=>{
  const gap=2000,wallSpeed=230,vx=20;
  const real=bsodSnapshot({active:true,wallX:100,sledLeftEdgeX:2100,
    wallSpeedPxS:wallSpeed,sledVelocityXPxS:vx});
  const physics=compressedTailwind(wallSpeed,gap);
  expect(real.worldTailwindPxS).toBeCloseTo(physics);
  const visual=bsodWindVisualStrength(real);
  expect(visual).toBeGreaterThan(0.1);
  expect(visual).toBeLessThan(0.35);
  expect(real.worldTailwindPxS).toBeCloseTo(physics);
  expect(real.relativeAirX).toBeCloseTo(physics-vx);
});
