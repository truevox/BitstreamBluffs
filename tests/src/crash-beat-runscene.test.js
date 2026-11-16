/**
 * Readable Chaos, phase 3: the crash beat in the shipped RunScene (FX at 0.25x for 400 ms after the hit-stop, an eased
 * camera zoom-in that holds; visual only) and the banner naming the killer in the shipped UIScene.onCrash.
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
const { UIScene } = await import('../../src/scenes/UIScene.js');
const { CRASH_BEAT } = await import('../../src/systems/CrashReport.js');
const { TUNING } = await import('../../src/systems/PhysicsTuner.js');
const { speedZoom } = await import('../../src/systems/CameraZoom.js');
const { REG } = await import('../../src/constants.js');
const { loadContent } = await import('./_helpers.js');
const { LastDeathMarker } = await import('../../src/entities/LastDeathMarker.js');
const { BestMarker } = await import('../../src/entities/BestMarker.js');

const HS = TUNING.hitStopCrashMs;

function frameStub(crashTimerMs) {
  const fxDts = [];
  const s = Object.create(RunScene.prototype);
  Object.assign(s, {
    sled: { x: 5000, y: 300, vx: 800, vy: 0, speed: 800, render() {}, body: { angle: 0 } },
    crashed: true, crashTimerMs, hitStopMs: 0, shieldCharges: 0,
    cameras: { main: { zoom: 0.7, scrollX: 4800, scrollY: 100, setZoom(z) { this.zoom = z; } } },
    mesh: { cull() {} }, hazards: new Map(), powerups: new Map(), fx: { update: (d) => fxDts.push(d) },
    shardField: null, bestMarker: null, deathMarker: null, groundTelegraph: null, streaks: null,
    bg: { update() {} }, flashRect: { alpha: 0, setAlpha() {} }, runTimeMs: 9000,
    drawStreaks() {}, updateBlindOverlay() {}, updateCamera() {}, heightFn: () => 300,
  });
  return { s, fxDts };
}

describe('crash beat: FX time', () => {
  test('hit-stop 0.08x, then 0.25x for 400 ms, then normal', () => {
    const at = (t) => { const { s, fxDts } = frameStub(t); s.renderFrame(16); return fxDts[0] / 16; };
    expect(at(HS - 1)).toBeCloseTo(0.08, 9);
    expect(at(HS)).toBeCloseTo(CRASH_BEAT.slowScale, 9);
    expect(at(HS + CRASH_BEAT.slowMs - 1)).toBeCloseTo(0.25, 9);
    expect(at(HS + CRASH_BEAT.slowMs)).toBeCloseTo(1, 9);
  });
  test('a live run is untouched', () => {
    const { s, fxDts } = frameStub(0);
    s.crashed = false;
    s.trail = { update() {} };
    s.renderFrame(16);
    expect(fxDts[0]).toBe(16);
  });
});

describe('crash beat: camera zoom-in', () => {
  function cam(crashed, crashTimerMs) {
    const s = Object.create(RunScene.prototype);
    Object.assign(s, {
      sled: { x: 50000, y: 3000, vx: 900, vy: 0, speed: 900 }, crashed, crashTimerMs,
      cameras: { main: { zoom: 1, scrollX: 0, scrollY: 0, setZoom(z) { this.zoom = z; } } },
      _camX: 50000 - 182, _camY: 3000 - 90, _zoom: speedZoom(900), _zoomKick: 0, shakeAmp: 0, bg: null, flashRect: null, blindRect: null,
    });
    s.updateCamera(16);
    return s.cameras.main.zoom;
  }
  test('eases in over the slow-mo and holds; nothing before the hit-stop ends', () => {
    const base = cam(false, 0);
    expect(cam(true, 0)).toBeCloseTo(base, 2);
    expect(cam(true, HS + CRASH_BEAT.slowMs / 2)).toBeGreaterThan(base);
    const full = cam(true, HS + CRASH_BEAT.slowMs);
    expect(full).toBeCloseTo(Math.round(base * (1 + CRASH_BEAT.zoomIn) * 200) / 200, 2);
    expect(cam(true, 900)).toBeCloseTo(full, 6);
  });
});

describe('the crash banner names the killer', () => {
  const CONTENT = loadContent();
  function ui() {
    const banners = [];
    const s = Object.create(UIScene.prototype);
    Object.assign(s, {
      registry: { get: (k) => (k === REG.CONTENT ? CONTENT : undefined) },
      comboInfo: { setText() {} },
      _banner: (text, color, scale) => banners.push([text, color, scale]),
    });
    return { s, banners };
  }
  test('a hazard crash shows the hazard name (biome ones too)', () => {
    for (const [id, name] of [['packetSpike', 'PACKET SPIKE'], ['rollingBoulder', 'ROLLING BOULDER'], ['gearGate', 'GEAR GATE'], ['dewDrop', 'DEW DROP']]) {
      const { s, banners } = ui();
      s.onCrash({ cause: 'hazard', hazardId: id, negated: false });
      expect(banners[0][0]).toBe(name);
      expect(banners[0][1]).toBe('danger');
    }
  });
  test('other causes are named; an absorbed crash still says HASHED BACKUP USED (no killer)', () => {
    const { s, banners } = ui();
    s.onCrash({ cause: 'terrain', negated: false });
    s.onCrash({ cause: 'hazard', hazardId: 'packetSpike', negated: true });
    expect(banners.map((b) => b[0])).toEqual(['HEAD FIRST', 'HASHED BACKUP USED']);
  });
  test('a long name still fits the 480 px HUD at its scale', () => {
    const { s, banners } = ui();
    s.onCrash({ cause: 'chasm', negated: false });
    const [text, , scale] = banners[0];
    expect(text.length * 6 * scale).toBeLessThanOrEqual(470);
  });
});

describe('DIED HERE marker vs the BEST marker (both often stand at the same distance: your best is where you died)', () => {
  const scene = () => {
    const labels = [];
    const chain = (o) => new Proxy(o, { get: (t, k) => (k in t ? t[k] : () => chain(t)) });
    return {
      labels,
      add: {
        graphics: () => chain({}),
        text: (x, y, s) => { const l = chain({ s, x, y, setPosition(px, py) { this.x = px; this.y = py; return this; } }); labels.push(l); return l; },
      },
    };
  };
  test('labels sit on different rows, so they never overprint', () => {
    const PAL = { danger: 1, lime: 2, amber: 3 };
    const sb = scene();
    new BestMarker(sb, PAL, 1000, 344).update(0, 900, () => 500);
    const sd = scene();
    new LastDeathMarker(sd, PAL, 1004, 344).update(0, 900, () => 500);
    expect(Math.abs(sb.labels[0].y - sd.labels[0].y)).toBeGreaterThanOrEqual(16);
  });
});
