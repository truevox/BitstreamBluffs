/**
 * B3 "Motion": the SHIPPED Pyramid Peak, Steampunk Slopes and Micro Mountain defs through the shipped Hazard entity
 * (motion, drawing), RunScene dispatch (an open Gear Gate is passed, a closed one crashes; glide; Treads ward) and HUD
 * tables. Same fake Phaser seam as biome-b2-effects.test.js. The built-game gate checks the same effects on the real sled.
 */
import { jest } from '@jest/globals';

const moved = [];
const Body = {
  getVelocity: (b) => ({ x: b.velocity.x, y: b.velocity.y }),
  setVelocity: (b, v) => { b.velocity = { x: v.x, y: v.y }; },
  getAngularVelocity: () => 0,
  setAngularVelocity: () => {},
  setPosition: (b, p) => { b.x = p.x; b.y = p.y; moved.push(p); },
  setAngle: (b, a) => { b.angle = a; },
};
class Stub { constructor() { this.alpha = 0; } setAlpha(a) { this.alpha = a; return this; } setFillStyle() { return this; } }
const FakePhaser = {
  Scene: class {},
  Physics: { Matter: { Matter: { Bodies: { rectangle: (x, y, w, h, o) => ({ x, y, w, h, ...o }), circle: (x, y, r, o) => ({ x, y, r, ...o }) }, Body } } },
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
const { Hazard } = await import('../../src/entities/Hazard.js');
const { PowerUp } = await import('../../src/entities/PowerUp.js');
const { EVT } = await import('../../src/events.js');
const { PhysicsTuner, BASE_STEP_MS } = await import('../../src/systems/PhysicsTuner.js');
const { ROLL_ACTIVATE_PX, gateOpenAt, gateTiming, rollOffsetAt, rollParams } = await import('../../src/systems/HazardMotion.js');
const { loadContent, makeGen } = await import('./_helpers.js');
const { glideDrag } = await import('../../src/systems/BiomeEffects.js');

const C = loadContent();
const PAD = { tuck: false, brake: false };
const PAL = { danger: 0xff0000, magenta: 0xff00ff, lime: 0x00ff00, cyan: 0x00ffff, amber: 0xffaa00, bg: 0, bgAlt: 1, text: 0xffffff };

/** A fake scene for the entity: graphics that record draw calls and keep their position, a sled, the ground. */
function scene({ sledX = -1e9, heightAt = (x) => 200 + x * 0.25, slopeAt = () => Math.atan(0.25) * 180 / Math.PI } = {}) {
  return {
    matter: { world: { add() {}, remove() {} } },
    sled: { x: sledX },
    heightFn: heightAt,
    terrain: { slopeDegAt: slopeAt, heightAt },
    add: {
      graphics: (o) => {
        const ops = [];
        const g = new Proxy({ ops, x: o ? o.x : 0, y: o ? o.y : 0, rotation: 0, visible: true }, {
          get: (t, k) => {
            if (k in t) return t[k];
            if (k === 'setPosition') return (x, y) => { t.x = x; t.y = y; return g; };
            if (k === 'setRotation') return (r) => { t.rotation = r; return g; };
            if (k === 'setVisible') return (v) => { t.visible = v; return g; };
            if (k === 'clear') return () => { ops.length = 0; return g; };
            return (...a) => { ops.push([k, ...a]); return g; };
          },
          set: (t, k, v) => { t[k] = v; return true; },
        });
        return g;
      },
    },
  };
}
const spawnOn = (sc, x, extra = {}) => ({ x, y: sc.heightFn(x), rotationDeg: sc.terrain.slopeDegAt(x), ...extra });

function makeRun({ zones = [] } = {}) {
  const emitted = [];
  const s = Object.create(RunScene.prototype);
  Object.assign(s, {
    game: { events: { emit: (e, p) => { emitted.push([e, p]); } } },
    emitted,
    sled: {
      x: 1000, y: 0, vx: 300, vy: 20, inWorld: true, invulnerableMs: 0, grounded: true, parachuteMs: 0, airBrakeActive: false, shield: false,
      body: { velocity: { x: 300 * BASE_STEP_MS / 1000, y: 20 * BASE_STEP_MS / 1000 } },
      scaleVelocity() {}, wobble() {},
    },
    fx: { sparks() {}, ring() {} },
    shake() {},
    flashRect: new Stub(),
    blindRect: new Stub(),
    palette: { cyan: 1, amber: 2, lime: 3, bg: 0 },
    tuner: new PhysicsTuner(),
    dailyMods: {},
    crashed: false,
    pendingCrash: null,
    runTimeMs: 0,
    startX: 0,
    openingGraces: 0,
    slowMs: 0, slowFactor: 0.5, scrambleMs: 0, boostMs: 0, boostFactor: 1, slowmoMs: 0, slowmoScale: 0.5, shieldCharges: 0,
    collectedPowerups: new Set(),
    score: { onShieldHit: () => null, getSnapshot: () => ({ comboTricks: [] }) },
    emitFlow() {},
    _despawn: [],
  });
  s.getZoneDefs = () => zones;
  s._resetBiomeEffects();
  return s;
}
const take = (id) => ({ def: C.powerups[id], spawn: { x: 1000, y: 0 }, color: 5, destroy() {} });
const phys = (s) => s.tuner.getEffective(s.physicsContext(PAD));
const events = (s, name) => s.emitted.filter(([e]) => e === name).map(([, p]) => p);

describe('B3 rolling hazards: the shipped entity moves along the ground (Hazard.update -> HazardMotion.rollStep)', () => {
  test.each(['rollingBoulder', 'dewDrop'])('%s waits at its spawn until the sled is within ROLL_ACTIVATE_PX, then rolls downhill, away from it', (id) => {
    const sc = scene();
    const x0 = 3000;
    const h = new Hazard(sc, C.hazards[id], spawnOn(sc, x0), PAL);
    const cx0 = h.cx;
    const cy0 = h.cy;
    sc.sled.x = x0 - ROLL_ACTIVATE_PX - 50;
    h.update(1000, 0, 99999);
    h.update(3000, 0, 99999);
    expect(h.cx).toBe(cx0); // not started
    expect(h.rolling).toBeFalsy();
    sc.sled.x = x0 - ROLL_ACTIVATE_PX;
    h.update(3000, 0, 99999); // starts here
    h.update(3500, 0, 99999);
    const m = C.hazards[id].motion;
    const off = rollOffsetAt(m, 500, sc.terrain.slopeDegAt, x0); // the pure motion over the ground the entity rides
    expect(off).toBeGreaterThan(20);
    expect(h.cx - cx0).toBeCloseTo(off, 6); // downhill (+x), away from the sled
    expect(h.roll.vPxS).toBeGreaterThan(0);
    expect(h.roll.vPxS).toBeLessThanOrEqual(rollParams(m).speedPxS);
    expect(h.predictX(4000)).toBeCloseTo(x0 + rollOffsetAt(m, 1000, sc.terrain.slopeDegAt, x0), 6); // the telegraph API
    expect(h.rolling).toBe(true);
    // it follows the ground: y moves with heightAt at its new x (the box centre stays h/2 above the surface)
    expect(h.cy).toBeGreaterThan(cy0);
    const box = h._boxAt(h.gfx.x, h.gfx.y, h.gfx.rotation);
    expect(h.body.x).toBeCloseTo(box.bcx, 9); // the sensor moved with it (same hit-box geometry as a static hazard)
    expect(h.body.y).toBeCloseTo(box.bcy, 9);
    expect(h.body.angle).toBeCloseTo(h.gfx.rotation, 12);
    expect(h.gfx.x).toBeCloseTo(x0 + off, 6);
    expect(h.gfx.y).toBeCloseTo(sc.heightFn(x0 + off), 6);
    // after its range it rests
    h.update(60000, 0, 99999);
    expect(h.gfx.x).toBeCloseTo(x0 + C.hazards[id].motion.rangePx, 6);
    expect(h.rolling).toBe(false);
  });

  test('the motion runs even off camera (the sim hop policy, near-miss and hop hint read h.cx)', () => {
    const sc = scene({ sledX: 2700 });
    const h = new Hazard(sc, C.hazards.rollingBoulder, spawnOn(sc, 3000), PAL);
    h.update(0, -5000, -4000); // camera far away
    h.update(500, -5000, -4000);
    expect(h.gfx.visible).toBe(false);
    expect(h.gfx.x).toBeCloseTo(3000 + rollOffsetAt(C.hazards.rollingBoulder.motion, 500, sc.terrain.slopeDegAt, 3000), 6);
    expect(h.gfx.x).toBeGreaterThan(3020);
  });

  test('a Dew Drop on the Micro dew swell rides the same surface the sled rides (generator heightAt == collider points)', () => {
    // a real Micro Mountain chunk with a dewSwell zone: the swell is in the chunk points (T2), so heightAt is the polyline
    const g = makeGen('b3-dew', { biomeMask: 512 });
    let chunk = null;
    let zone = null;
    for (let i = 1; i < 200 && !zone; i++) {
      const ch = g.getChunk(i);
      const z = ch.zones.find((q) => q.modId === 'dewSwell' && q.x1 - q.x0 > 400);
      if (z) { chunk = ch; zone = z; }
    }
    expect(zone).not.toBe(null);
    const polyY = (x) => {
      const p = chunk.points;
      for (let k = 0; k < p.length - 1; k++) if (x >= p[k].x && x <= p[k + 1].x) return p[k].y + (p[k + 1].y - p[k].y) * (x - p[k].x) / (p[k + 1].x - p[k].x);
      return NaN;
    };
    const sc = scene({ heightAt: (x) => g.heightAt(x), slopeAt: (x) => g.slopeDegAt(x) });
    const x0 = Math.round(zone.x0 + 300);
    const h = new Hazard(sc, C.hazards.dewDrop, spawnOn(sc, x0), PAL);
    sc.sled.x = x0 - 100;
    let t = 0;
    let worst = 0;
    h.update(t, 0, 99999);
    for (let k = 0; k < 90; k++) {
      t += 16;
      h.update(t, 0, 99999);
      worst = Math.max(worst, Math.abs(h.gfx.y - polyY(h.gfx.x)));
    }
    expect(h.gfx.x).toBeGreaterThan(x0 + 40); // it really rolled (downhill) across the swell
    expect(worst).toBeLessThan(1e-6);
  });
});

describe('B3 Gear Gate: open/closed from the seeded phase and run time', () => {
  test('the entity reads the spawn phase; isPassable(t) is gateOpenAt(motion, phase, t); the drawing changes with it', () => {
    const sc = scene();
    const def = C.hazards.gearGate;
    const h = new Hazard(sc, def, spawnOn(sc, 3000, { phase: 0.25 }), PAL);
    const per = gateTiming(def.motion).periodMs;
    for (let t = 0; t < per * 2; t += 50) expect(h.isPassable(t)).toBe(gateOpenAt(def.motion, 0.25, t));
    // draw open, then closed: different shapes
    const tOpen = [...Array(per).keys()].find((t) => gateOpenAt(def.motion, 0.25, t));
    const tShut = [...Array(per).keys()].find((t) => !gateOpenAt(def.motion, 0.25, t));
    h.update(tOpen, 0, 99999);
    expect(h.open).toBe(true);
    const a = JSON.stringify(h.gfx.ops);
    h.update(tShut, 0, 99999);
    expect(h.open).toBe(false);
    expect(JSON.stringify(h.gfx.ops)).not.toBe(a);
  });

  test('RunScene.onHazard: an open gate is passed (no hit, the gate stays armed); a closed gate crashes', () => {
    const sc = scene();
    const def = C.hazards.gearGate;
    const h = new Hazard(sc, def, spawnOn(sc, 3000, { phase: 0 }), PAL);
    const s = makeRun();
    s.runTimeMs = 100; // open (each cycle starts open)
    s.onHazard(h);
    expect(h.hit).toBe(false);
    expect(s.pendingCrash).toBe(null);
    expect(events(s, EVT.HAZARD_HIT)).toEqual([]);
    s.runTimeMs = gateTiming(def.motion).openMs + 10; // closed
    s.onHazard(h);
    expect(h.hit).toBe(true);
    expect(s.pendingCrash).toEqual({ cause: 'hazard', hazardId: 'gearGate' });
    expect(events(s, EVT.HAZARD_HIT).map((p) => `${p.hazardId}:${p.effect}`)).toEqual(['gearGate:crash']);
  });

  test('a rolling hazard crashes on contact like any crash hazard (no gate check applies)', () => {
    for (const id of ['rollingBoulder', 'dewDrop']) {
      const sc = scene();
      const h = new Hazard(sc, C.hazards[id], spawnOn(sc, 3000), PAL);
      const s = makeRun();
      s.onHazard(h);
      expect(s.pendingCrash).toEqual({ cause: 'hazard', hazardId: id });
    }
  });
});

describe('B3 power-ups through RunScene.onPowerUp (shipped defs)', () => {
  test.each(['sandrunnerSkis', 'royalJellyWax'])('%s: glide, all three drags lowered for its duration, then back', (id) => {
    const s = makeRun();
    const b = phys(s);
    const e = C.powerups[id].effect;
    s.onPowerUp(take(id));
    expect(events(s, EVT.POWERUP_COLLECTED)).toEqual([{ id, durationMs: e.durationMs, charges: 0 }]);
    const d = glideDrag(1, e.frictionMul);
    const g = phys(s);
    expect(g.groundResist).toBeCloseTo(b.groundResist * e.frictionMul, 12);
    expect(g.frictionAir).toBeCloseTo(b.frictionAir / d.speedMul, 12);
    expect(g.quadDrag).toBeCloseTo(b.quadDrag * d.quadMul, 12);
    s.tickEffects(e.durationMs - 1);
    expect(phys(s).speedMul).toBeCloseTo(d.speedMul, 12);
    s.tickEffects(2);
    expect(phys(s)).toEqual(b);
    expect(events(s, EVT.POWERUP_EXPIRED)).toEqual([{ id, reason: 'timeout' }]);
  });

  test('Clockwork Treads: the conveyor belt drive is 0 while the 4 s ward runs, then back', () => {
    const s = makeRun({ zones: [C.terrainMods.conveyorBelt] });
    const drive = phys(s).beltDrivePxS2;
    expect(drive).toBeGreaterThan(0);
    s.onPowerUp(take('clockworkTreads'));
    expect(phys(s).beltDrivePxS2).toBe(0);
    expect(phys(s).pushForceMul).toBe(phys(makeRun()).pushForceMul); // the belt's push multiplier is gone too
    s.tickEffects(4001);
    expect(phys(s).beltDrivePxS2).toBe(drive);
  });
});

describe('B3 HUD entries (UIScene)', () => {
  const ui = () => Object.assign(Object.create(UIScene.prototype), { content: C, nowMs: 0, warnY: 40, effects: new Map() });
  const recorder = () => {
    const ops = [];
    return { ops, g: new Proxy({}, { get: (t, k) => (...a) => { ops.push([k, ...a]); return undefined; } }) };
  };
  const IDS = ['sandrunnerSkis', 'royalJellyWax', 'clockworkTreads'];

  test('each B3 pickup has its own HUD name and colour', () => {
    const u = ui();
    expect(IDS.map((id) => u._powerInfo(id).name)).toEqual(['SANDRUNNER SKIS', 'JELLY WAX', 'CLOCKWORK TREADS']);
    expect(IDS.map((id) => u._powerInfo(id).color)).toEqual(['amber', 'amber', 'cyan']);
  });

  test('each B3 pickup chip draws its own icon: not the unknown square, not its kind icon, all different', () => {
    const u = ui();
    const draw = (id) => { const r = recorder(); u._drawIcon(r.g, id, 10, 10, 1); return JSON.stringify(r.ops.filter(([k]) => k !== 'lineStyle' && k !== 'fillStyle')); };
    const square = JSON.stringify([['strokeRect', 5, 5, 10, 10]]);
    const kindIcon = (kind) => {
      const v = Object.assign(Object.create(UIScene.prototype), { content: { powerups: { w: { effect: { kind } } } } });
      const r = recorder(); v._drawIcon(r.g, 'w', 10, 10, 1); return JSON.stringify(r.ops.filter(([k]) => k !== 'lineStyle' && k !== 'fillStyle'));
    };
    const icons = IDS.map(draw);
    for (const ic of icons) {
      expect(ic).not.toBe(square);
      expect(ic).not.toBe(kindIcon('glide'));
      expect(ic).not.toBe(kindIcon('ward'));
    }
    expect(new Set(icons).size).toBe(IDS.length);
  });
});

describe('B3 drawing: every new shapeKey has its own routine', () => {
  const shape = (gfx) => JSON.stringify(gfx.ops.filter(([k]) => /^fill(Rect|Triangle|Points|Circle|Ellipse)$|^stroke|^lineBetween$/.test(k)).map(([k]) => k));

  test('the three hazards draw non-generic, mutually different shapes in `danger`, with the usual hit-box brackets', () => {
    const out = {};
    for (const id of ['rollingBoulder', 'dewDrop', 'gearGate']) {
      const def = C.hazards[id];
      const sc = scene();
      const h = new Hazard(sc, def, spawnOn(sc, 100), PAL);
      expect(h.drawKind).toBe(def.shapeKey);
      expect(h.color).toBe(PAL.danger);
      out[id] = shape(h.gfx);
      expect(h.gfx.ops.filter(([k]) => k === 'lineBetween').length).toBeGreaterThanOrEqual(8); // brackets (telegraphable)
      const generic = new Hazard(sc, { ...def, shapeKey: 'zzUnknownShape' }, spawnOn(sc, 100), PAL);
      expect(generic.drawKind).toBe('generic');
      expect(out[id]).not.toBe(shape(generic.gfx));
    }
    expect(new Set(Object.values(out)).size).toBe(3);
  });

  test('the three pickups draw non-generic glyphs, different from each other', () => {
    const out = {};
    for (const id of ['sandrunnerSkis', 'royalJellyWax', 'clockworkTreads']) {
      const def = C.powerups[id];
      const p = new PowerUp(scene(), def, { x: 100, y: 50 }, PAL);
      expect(p.drawKind).toBe(def.shapeKey);
      out[id] = shape(p.gfx);
      const generic = new PowerUp(scene(), { ...def, shapeKey: 'zzUnknownGlyph' }, { x: 100, y: 50 }, PAL);
      expect(out[id]).not.toBe(shape(generic.gfx));
    }
    expect(new Set(Object.values(out)).size).toBe(3);
  });
});
