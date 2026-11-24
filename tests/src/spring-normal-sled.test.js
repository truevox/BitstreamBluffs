/**
 * The slope-normal spring rebound at the Matter boundary: Sled.launchNormal must keep the along-slope velocity and
 * replace only the outward normal component, converting px/s through Matter 0.20's 1000/60 ms base step (the same
 * conversion as the rest of Sled). The pure projection is covered in bounce-felt.test.js; this pins the consumer.
 */
import { jest } from '@jest/globals';

jest.unstable_mockModule('phaser', () => ({
  default: {
    Physics: {
      Matter: {
        Matter: {
          Bodies: {},
          Body: {
            getVelocity: (b) => ({ x: b.velocity.x, y: b.velocity.y }),
            setVelocity: (b, v) => { b.velocity = { x: v.x, y: v.y }; },
          },
        },
      },
    },
  },
}));

const { Sled } = await import('../../src/entities/Sled.js');
const { BASE_STEP_MS, TUNING } = await import('../../src/systems/PhysicsTuner.js');

const toMatter = (pxS) => (pxS * BASE_STEP_MS) / 1000;
const toPxS = (m) => (m * 1000) / BASE_STEP_MS;
const tangent = (v, angleDeg) => {
  const a = (angleDeg * Math.PI) / 180;
  return v.vx * Math.cos(a) + v.vy * Math.sin(a);
};
const outwardNormal = (v, angleDeg) => {
  const a = (angleDeg * Math.PI) / 180;
  return v.vx * Math.sin(a) - v.vy * Math.cos(a);
};

test('Sled.launchNormal preserves the tangent and applies the rebound in Matter base-step units', () => {
  const angle = 30;
  const a = (angle * Math.PI) / 180;
  const vx = 600 * Math.cos(a);
  const vy = 600 * Math.sin(a);
  const s = Object.create(Sled.prototype);
  Object.assign(s, {
    inWorld: true,
    msSinceContact: 0,
    _sinceLaunchMs: 999,
    chuteUsed: true,
    body: { velocity: { x: toMatter(vx), y: toMatter(vy) } },
    _sync() {},
  });

  s.launchNormal(120, angle);

  const got = { vx: toPxS(s.body.velocity.x), vy: toPxS(s.body.velocity.y) };
  expect(tangent(got, angle)).toBeCloseTo(600, 9);
  expect(outwardNormal(got, angle)).toBeCloseTo(120, 9);
  expect(s.msSinceContact).toBe(TUNING.groundedGraceMs + 1);
  expect(s._sinceLaunchMs).toBe(0);
  expect(s.chuteUsed).toBe(false);
});

test.each([
  ['zero', 0],
  ['negative', -120],
  ['NaN', NaN],
  ['Infinity', Infinity],
])('launchNormal(%s up) is a no-op before any body or state mutation', (_name, up) => {
  const s = Object.create(Sled.prototype);
  let syncs = 0;
  const body = { velocity: { x: toMatter(320), y: -toMatter(180) } };
  const vx0 = body.velocity.x;
  const vy0 = body.velocity.y;
  Object.assign(s, {
    inWorld: true,
    msSinceContact: 77,
    _sinceLaunchMs: 321,
    chuteUsed: true,
    body,
    _sync() { syncs += 1; },
  });

  s.launchNormal(up, 25);

  expect(body.velocity).toEqual({ x: vx0, y: vy0 });
  expect(s.msSinceContact).toBe(77);
  expect(s._sinceLaunchMs).toBe(321);
  expect(s.chuteUsed).toBe(true);
  expect(syncs).toBe(0);
});
