import { BsodPursuit, BSOD_DEFAULTS, bsodSnapshot, compressedTailwind, emptyBsodState } from '../../src/systems/BsodPursuit.js';

describe('physical BSOD pursuit contract', () => {
  test('gap is between the wall front and sled left collision edge, with zero at actual contact', () => {
    const before = bsodSnapshot({ active: true, wallX: 300, wallSpeedPxS: 200, sledLeftEdgeX: 312, sledVelocityXPxS: 80 });
    expect(before.gapPx).toBe(12);
    expect(before.timeToImpactMs).toBeCloseTo(100);
    const impact = bsodSnapshot({ active: true, wallX: 312, wallSpeedPxS: 200, sledLeftEdgeX: 312, sledVelocityXPxS: 80 });
    expect(impact.gapPx).toBe(0);
    expect(impact.timeToImpactMs).toBe(0);
    const crossed = bsodSnapshot({ active: true, wallX: 319, wallSpeedPxS: 200, sledLeftEdgeX: 312, sledVelocityXPxS: 80 });
    expect(crossed.gapPx).toBe(-7);
  });
  test('no countdown when rider is pulling away from wall; none when inactive', () => {
    const s = bsodSnapshot({ active: true, wallX: 0, wallSpeedPxS: 100, sledLeftEdgeX: 500, sledVelocityXPxS: 180 });
    expect(s.timeToImpactMs).toBeNull();
    expect(bsodSnapshot({ active: false }).timeToImpactMs).toBeNull();
    expect(emptyBsodState().active).toBe(false);
  });
  test('tailwind faster than wall, increases as gap compresses, relative flow is signed', () => {
    expect(compressedTailwind(150, 100)).toBeGreaterThan(compressedTailwind(150, 2000));
    expect(compressedTailwind(150, 2000)).toBeGreaterThan(150);
    const s = bsodSnapshot({ active: true, wallX: 0, wallSpeedPxS: 150, sledLeftEdgeX: 100, sledVelocityXPxS: 500 });
    expect(s.relativeAirX).toBeLessThan(0);
    expect(s.relativeAirX).toBeCloseTo(s.worldTailwindPxS - 500);
  });
  test('vacuum eliminates wind regardless of wall proximity and sled velocity', () => {
    const s = bsodSnapshot({ active: true, wallX: 10, wallSpeedPxS: 500, sledLeftEdgeX: 12, sledVelocityXPxS: -200, atmosphereDensity: 0 });
    expect(s.relativeAirX).toBe(0);
    expect(s.worldTailwindPxS).toBe(0);
    expect(s.proximity01).toBeGreaterThan(0.99);
  });
  test('chase advances continuously and indefinitely without artificial max speed', () => {
    const a = new BsodPursuit({ sledLeftEdgeX: 1000, config: { initialGapPx: 800, initialSpeedPxS: 100, accelerationPxS2: 8 } });
    for (let i = 0; i < 300; i++) a.advance(1000);
    expect(a.wallSpeedPxS).toBeGreaterThan(2000);
    expect(a.accelerationPxS2).toBe(8);
  });
  test('level prolongs separation and slows (but never stops) acceleration', () => {
    const a = new BsodPursuit({ sledLeftEdgeX: 1000, level: 1 });
    const b = new BsodPursuit({ sledLeftEdgeX: 1000, level: 30 });
    expect(b.wallX).toBeLessThan(a.wallX);
    expect(b.accelerationPxS2).toBeLessThan(a.accelerationPxS2);
    expect(b.accelerationPxS2).toBeGreaterThan(0);
  });
  test('inactive state resets every field to a safe known value', () => {
    const a = new BsodPursuit({ sledLeftEdgeX: 1000 });
    expect(a.stop()).toEqual(emptyBsodState());
    a.advance(9000);
    expect(a.state(900, 5).active).toBe(false);
  });
});
