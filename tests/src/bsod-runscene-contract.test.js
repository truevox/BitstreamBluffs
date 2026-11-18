import { jest } from '@jest/globals';
import { BsodPursuit } from '../../src/systems/BsodPursuit.js';
import { EVT } from '../../src/events.js';
import { killerName } from '../../src/systems/CrashReport.js';

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

describe('BSOD RunScene contract', () => {
  test('only RunScene owns emission; deactivate emits one complete inactive payload', () => {
    const r = Object.create(RunScene.prototype);
    const emitted = [];
    r.game = { events: { emit: (key, payload) => emitted.push({ key, payload }) } };
    r.bsod = new BsodPursuit({ sledLeftEdgeX: 2000 });
    r.deactivateBsod();
    r.deactivateBsod();
    expect(emitted).toHaveLength(1);
    expect(emitted[0].key).toBe(EVT.BSOD_STATE_CHANGED);
    expect(emitted[0].payload).toEqual({
      active: false, gapPx: null, wallSpeedPxS: 0, worldTailwindPxS: 0,
      sledVelocityXPxS: 0, relativeAirX: 0, proximity01: 0,
      timeToImpactMs: null, atmosphereDensity: 0,
    });
  });

  test('BSOD catch beats shields and invulnerability, never consumes a charge', () => {
    const r = Object.create(RunScene.prototype);
    r.pendingCrash = { cause: 'bsod' };
    r.shieldCharges = 4;
    r.openingGraces = 0;
    r.sled = { invulnerableMs: 1800 };
    r.doCrash = jest.fn();
    const fs = { x: 50, y: 10, vx: 25, vy: 0 };
    r.resolveCrash(fs);
    expect(r.pendingCrash).toBeNull();
    expect(r.doCrash).toHaveBeenCalledWith({ cause: 'bsod' }, fs, 25);
    expect(r.shieldCharges).toBe(4);
    expect(killerName('bsod')).toBe('ERASED BY THE BSOD');
  });

  test('camera pullback stays within the horizontal rider safety band', () => {
    const scene = Object.create(RunScene.prototype);
    const rider = { x: 12000, y: 2000, vx: 0, vy: 0, speed: 0 };
    const cam = { zoom: 1, scrollX: 0, scrollY: 0, setZoom(z) { this.zoom = z; } };
    Object.assign(scene, {
      sled: rider, cameras: { main: cam },
      _camX: rider.x - 182, _camY: rider.y - 90, _zoom: 1, _zoomKick: 0,
      shakeAmp: 0, bsodState: { proximity01: 1 },
      bg: null, flashRect: null, blindRect: null,
    });
    for (let i = 0; i < 70; i++) scene.updateCamera(16);
    const riderScreenX = rider.x - scene._camX;
    expect(riderScreenX).toBeGreaterThan(182);
    expect(riderScreenX).toBeLessThanOrEqual(480 - 72);
  });

  test('vacuum is biome-specific and does not disable the pursuing wall', () => {
    const r = Object.create(RunScene.prototype);
    r.biomeMask = 32;
    r.terrain = { _sectorOf: () => 2 };
    r.sled = { x: 200 };
    r._biomeDefForSector = () => ({ id: 'space-mountain' });
    expect(r.bsodAtmosphere()).toBe(0);
    r.bsod = new BsodPursuit({ sledLeftEdgeX: 200 });
    expect(r.bsod.state(201, 400, r.bsodAtmosphere()).worldTailwindPxS).toBe(0);
    expect(r.bsod.active).toBe(true);
    r._biomeDefForSector = () => ({ id: 'forest' });
    expect(r.bsodAtmosphere()).toBe(1);
  });
});
