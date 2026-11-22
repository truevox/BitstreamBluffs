import { COMBO_MIN_FORWARD_PX_S, canopyBrakeDescent } from '../../tools/sim/canopy-combo.js';

const air = (extra = {}) => ({ grounded: false, vx: 360, vy: 200, parachuteFuelMs: 800, ...extra });

test('grounded input is unchanged; canopy and airbrake do not activate', () => {
  const hop = { hop: true };
  expect(canopyBrakeDescent({ ...air(), grounded: true }, hop)).toBe(hop);
  expect(canopyBrakeDescent({ ...air(), grounded: true })).toBeNull();
});

test('rising flight preserves the original flip tilt without burning canopy fuel', () => {
  expect(canopyBrakeDescent(air({ vy: -100 }), { tilt: -1 })).toEqual({ tilt: -1 });
  expect(canopyBrakeDescent(air({ vy: -100 }))).toBeNull();
});

test('descending while actively tilting uses airbrake but not steering-locked canopy', () => {
  expect(canopyBrakeDescent(air(), { tilt: -1 })).toEqual({ tilt: -1, airBrake: true });
});

test('after tilt release, descent holds both canopy and airbrake', () => {
  expect(canopyBrakeDescent(air())).toEqual({ airBrake: true, parachute: true });
});

test('depleted canopy cannot be falsely claimed as deployed', () => {
  expect(canopyBrakeDescent(air({ parachuteFuelMs: 0 }))).toEqual({ airBrake: true });
});

test('low forward speed releases brake while still permitting canopy, protecting BSOD progress', () => {
  expect(canopyBrakeDescent(air({ vx: COMBO_MIN_FORWARD_PX_S }))).toEqual({ parachute: true });
  expect(canopyBrakeDescent(air({ vx: 12 }), { tilt: -1 })).toEqual({ tilt: -1 });
});

test('bad or missing kinematics never become automatic input', () => {
  expect(canopyBrakeDescent(air({ vx: Infinity, vy: NaN }))).toBeNull();
  expect(canopyBrakeDescent(null, { tilt: -1 })).toEqual({ tilt: -1 });
});
