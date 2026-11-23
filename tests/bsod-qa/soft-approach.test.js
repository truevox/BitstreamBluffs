import { softApproachFactor, installSoftApproach } from '../../tools/bsod-qa/soft-approach.mjs';

test('does not soften early approach, smoothly reduces closing velocity near wall', () => {
  expect(softApproachFactor(7000)).toBe(1);
  expect(softApproachFactor(3000)).toBe(1);
  expect(softApproachFactor(1500)).toBeCloseTo(.91, 8);
  expect(softApproachFactor(0)).toBeCloseTo(.82, 8);
  expect(softApproachFactor(-100)).toBeCloseTo(.82, 8);
});

test('actual wall movement and reported speed share the same eased velocity', () => {
  const sled = { body: { bounds: { min: { x: 1000 } } } };
  const chase = { active:true, wallX:-1500, wallSpeedPxS:300, accelerationPxS2:4 };
  installSoftApproach(chase, sled);
  chase.advance(1000);
  expect(chase.wallX).toBeGreaterThan(-1250);
  expect(chase.wallX).toBeLessThan(-1200);
  expect(chase.wallSpeedPxS).toBeGreaterThan(250);
  expect(chase.wallSpeedPxS).toBeLessThan(304);
});

test('malformed time and inactive wall do not advance', () => {
  const chase = {active:true,wallX:0,wallSpeedPxS:300,accelerationPxS2:4};
  installSoftApproach(chase,{x:800});
  chase.advance(NaN);
  expect(chase.wallX).toBe(0);
  chase.active=false;chase.advance(1000);
  expect(chase.wallX).toBe(0);
});
