import { BsodPursuit, softApproachFactor, BSOD_DEFAULTS } from '../../src/systems/BsodPursuit.js';

test('softens only final 3000px with smoothly decreasing physical wall speed', () => {
  expect(softApproachFactor(7000)).toBe(1);
  expect(softApproachFactor(3000)).toBe(1);
  expect(softApproachFactor(1500)).toBeCloseTo(.91, 8);
  expect(softApproachFactor(0)).toBeCloseTo(.82, 8);
  expect(softApproachFactor(-100)).toBeCloseTo(.82, 8);
});

test('actual wall motion softens and snapshot reports effective speed while nominal stays causal', () => {
  const p = new BsodPursuit({ sledLeftEdgeX: 1000 });
  p.wallX = -1500; // 2500px gap; test within easing range
  const initialNominal = p.wallSpeedPxS;
  const before = p.state(1000, 0).wallSpeedPxS;
  expect(before).toBeLessThan(initialNominal);
  p.advance(1000, 1000);
  expect(p.wallX).toBeGreaterThan(-1250);
  expect(p.wallX).toBeLessThan(-1200);
  expect(p.wallSpeedPxS).toBe(304);
  expect(p.state(1000, 0).wallSpeedPxS).toBeLessThan(p.wallSpeedPxS);
});

test('no slowdown without rider edge, disabled config, or outside the range', () => {
  const p = new BsodPursuit({ sledLeftEdgeX: 1000, config:{ ...BSOD_DEFAULTS, softFinishMaxReduction:0 } });
  p.wallX = 990;
  expect(p.state(1000, 0).wallSpeedPxS).toBe(300);
  p.advance(1000);
  expect(p.wallX).toBe(1292);
  p.stop();p.advance(1000,1000);
  expect(p.wallX).toBe(1292);
});
