/**
 * Readable Chaos, phase 2: the camera pulls out farther at speed. Pure curve (systems/CameraZoom.js) and the shipped
 * RunScene.updateCamera on a prototype stub.
 */
import { jest } from '@jest/globals';

const FakePhaser = {
  Scene: class {},
  Physics: { Matter: { Matter: { Bodies: { rectangle: () => ({}), circle: () => ({}) }, Body: {} } } },
  Renderer: { WebGL: { Pipelines: { PostFXPipeline: class {} } } },
  GameObjects: { Container: class {}, Graphics: class {}, BitmapText: class {}, Zone: class {}, Image: class {}, Rectangle: class {}, Text: class {} },
  BlendModes: { ADD: 1 },
  Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown', DESTROY: 'destroy' } },
  Math: { Between: (a) => a, Clamp: (v, a, b) => Math.min(b, Math.max(a, v)) },
};
jest.unstable_mockModule('phaser', () => ({ default: FakePhaser }));
jest.unstable_mockModule('../../src/shaders/GlitchPipeline.js', () => ({ GlitchPipeline: { install() {} } }));

const { RunScene } = await import('../../src/scenes/RunScene.js');
const { speedZoom, ZOOM_STAGES, ZOOM_FLOOR, aheadPx } = await import('../../src/systems/CameraZoom.js');
const { TUNING } = await import('../../src/systems/PhysicsTuner.js');
const { GAME_WIDTH } = await import('../../src/constants.js');

const smooth01 = (t) => { const c = Math.min(1, Math.max(0, t)); return c * c * (3 - 2 * c); };
/** The v2.6.0 curve (two stages, 0.62 at 1200 px/s), for the before/after comparison. */
const oldZoom = (v) => 1 - (1 - 0.82) * smooth01((v - 150) / 450) - (0.82 - 0.62) * smooth01((v - 600) / 600);

describe('speedZoom', () => {
  test('unchanged where the game is slow: identical to the old curve up to 600 px/s', () => {
    for (let v = 0; v <= 600; v += 10) expect(speedZoom(v)).toBeCloseTo(oldZoom(v), 12);
    expect(speedZoom(0)).toBe(1);
    expect(speedZoom(TUNING.zoomSpeedHi)).toBeCloseTo(TUNING.zoomMin, 12);
  });
  test('anchors: each stage ends at its zoom at its speed, and the last one holds', () => {
    for (const st of ZOOM_STAGES) expect(speedZoom(st.speedHi)).toBeCloseTo(st.zoom, 12);
    const last = ZOOM_STAGES[ZOOM_STAGES.length - 1];
    expect(speedZoom(last.speedHi + 800)).toBeCloseTo(last.zoom, 12);
    expect(speedZoom(NaN)).toBe(1);
  });
  test('monotone and smooth: never zooms back in as speed rises, no step larger than 0.006 per 5 px/s', () => {
    let prev = speedZoom(0);
    for (let v = 5; v <= 2000; v += 5) {
      const z = speedZoom(v);
      expect(z).toBeLessThanOrEqual(prev + 1e-12);
      expect(prev - z).toBeLessThan(0.006);
      prev = z;
    }
  });
  test('noticeably farther out at speed than v2.6.0, and never under the floor', () => {
    expect(speedZoom(850)).toBeLessThan(oldZoom(850) - 0.08);
    expect(speedZoom(1000)).toBeLessThan(oldZoom(1000) - 0.1);
    expect(speedZoom(1200)).toBeLessThan(oldZoom(1200) - 0.1);
    expect(speedZoom(1000)).toBeLessThanOrEqual(0.57);
    expect(speedZoom(1200)).toBeLessThanOrEqual(0.52);
    for (let v = 0; v <= 3000; v += 50) expect(speedZoom(v)).toBeGreaterThanOrEqual(ZOOM_FLOOR);
  });
  test('legibility floor: a 20 px Packet Spike is still at least 9 game px (18 screen px) wide at the floor', () => {
    expect(20 * ZOOM_FLOOR).toBeGreaterThanOrEqual(9);
  });
  test('aheadPx: world px visible ahead of the rider; the visible lead at 850 / 1000 / 1200 px/s grows by 15 % or more', () => {
    expect(aheadPx(1, 100)).toBe(GAME_WIDTH - 100);
    expect(aheadPx(0.5, 100)).toBe((GAME_WIDTH - 100) * 2);
    for (const v of [850, 1000, 1200]) expect(aheadPx(speedZoom(v), 100) / aheadPx(oldZoom(v), 100)).toBeGreaterThanOrEqual(1.15);
  });
});

describe('RunScene.updateCamera uses the curve', () => {
  function makeCam(speed) {
    const s = Object.create(RunScene.prototype);
    const zooms = [];
    Object.assign(s, {
      sled: { x: 50000, y: 3000, vx: speed, vy: 0, speed },
      cameras: { main: { zoom: 1, scrollX: 0, scrollY: 0, setZoom(z) { this.zoom = z; zooms.push(z); } } },
      _camX: 50000 - 182, _camY: 3000 - 90, _zoom: 1, _zoomKick: 0, shakeAmp: 0,
      bg: null, flashRect: null, blindRect: null, zooms,
    });
    return s;
  }
  const settle = (s, frames = 600) => { for (let i = 0; i < frames; i++) { s.sled.x += s.sled.vx * 0.016; s.updateCamera(16); } return s.cameras.main.zoom; };
  test('settles on speedZoom(speed), stepped to 0.005, at cruise and at peak speed', () => {
    for (const v of [300, 650, 850, 1000, 1200, 1400, 1700]) {
      const z = settle(makeCam(v));
      expect(Math.abs(z - speedZoom(v))).toBeLessThanOrEqual(0.0051);
      expect(Math.abs(z * 200 - Math.round(z * 200))).toBeLessThan(1e-9);
    }
  });
  test('the hard clamp allows the new floor (it was 0.6) and a boost kick cannot go under it', () => {
    const s = makeCam(1700);
    settle(s);
    s._zoomKick = 0.2;
    s.updateCamera(16);
    expect(s.cameras.main.zoom).toBeGreaterThanOrEqual(ZOOM_FLOOR - 1e-9);
    expect(s.cameras.main.zoom).toBeLessThan(0.6);
  });
  test('the pull-out is eased: accelerating hard (300 -> 1400 px/s at 400 px/s2), no frame moves the zoom more than two 0.005 steps', () => {
    const s = makeCam(300);
    settle(s);
    s.zooms.length = 0;
    for (let i = 0; i < 400; i++) {
      s.sled.vx = s.sled.speed = Math.min(1400, s.sled.speed + 400 * 0.016);
      s.sled.x += s.sled.vx * 0.016;
      s.updateCamera(16);
    }
    expect(s.zooms.length).toBeGreaterThan(40);
    for (let i = 1; i < s.zooms.length; i++) expect(Math.abs(s.zooms[i] - s.zooms[i - 1])).toBeLessThanOrEqual(0.0101);
    expect(s.cameras.main.zoom).toBeLessThan(0.5);
  });
  test('the rider stays on screen at the floor: screen x between the 36 px pin and the right edge', () => {
    const s = makeCam(1700);
    settle(s);
    const cam = s.cameras.main;
    const left = cam.scrollX + GAME_WIDTH / 2 - GAME_WIDTH / (2 * cam.zoom);
    const sx = (s.sled.x - left) * cam.zoom;
    expect(sx).toBeGreaterThanOrEqual(35);
    expect(sx).toBeLessThan(GAME_WIDTH * 0.6);
  });
});
