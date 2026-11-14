/**
 * B1 "Wards": the SHIPPED biome defs through the shipped RunScene dispatch, HUD tables and entity drawing (same fake
 * Phaser seam as biome-effects-runscene.test.js). The built-game gate checks the same effects on the real sled.
 */
import { jest } from '@jest/globals';

const Body = {
  getVelocity: (b) => ({ x: b.velocity.x, y: b.velocity.y }),
  setVelocity: (b, v) => { b.velocity = { x: v.x, y: v.y }; },
  getAngularVelocity: () => 0,
  setAngularVelocity: () => {},
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
const { loadContent } = await import('./_helpers.js');

const C = loadContent();
const MODS = C.terrainMods;
const PAD = { tuck: false, brake: false };

function makeRun({ zones = [] } = {}) {
  const emitted = [];
  const scaled = [];
  const s = Object.create(RunScene.prototype);
  Object.assign(s, {
    game: { events: { emit: (e, p) => { emitted.push([e, p]); } } },
    emitted,
    scaled,
    sled: {
      x: 1000, y: 0, vx: 300, vy: 20, inWorld: true, invulnerableMs: 0, grounded: true, parachuteMs: 0, airBrakeActive: false,
      body: { velocity: { x: 300 * BASE_STEP_MS / 1000, y: 20 * BASE_STEP_MS / 1000 } },
      scaleVelocity(k) { scaled.push(k); }, wobble() {},
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
    slowMs: 0, slowFactor: 0.5, scrambleMs: 0, boostMs: 0, boostFactor: 1, slowmoMs: 0, slowmoScale: 0.5, shieldCharges: 0,
    collectedPowerups: new Set(),
    _despawn: [],
  });
  s.getZoneDefs = () => zones;
  s._resetBiomeEffects();
  return s;
}
const hit = (id) => ({ def: C.hazards[id], cx: 1000, cy: 0, color: 5, gfx: null, hit: false });
const take = (id) => ({ def: C.powerups[id], spawn: { x: 1000, y: 0 }, color: 5, destroy() {} });
const phys = (s) => s.tuner.getEffective(s.physicsContext(PAD));
const events = (s, name) => s.emitted.filter(([e]) => e === name).map(([, p]) => p);

describe('B1 hazards through RunScene.onHazard (shipped defs)', () => {
  test.each([
    ['groomerCat', 0.7, 900],
    ['seaweedTangle', 0.6, 1200],
    ['chocolateRiver', 0.5, 1500],
  ])('%s: a slow of %p x %p ms on the sled (instant velocity cut + tuner speedMul), then it ends', (id, k, ms) => {
    const s = makeRun();
    s.onHazard(hit(id));
    expect(s.scaled).toEqual([k]);
    expect(phys(s).speedMul).toBeCloseTo(k, 12);
    expect(events(s, EVT.HAZARD_HIT)).toEqual([{ hazardId: id, effect: 'slow', durationMs: ms, x: 1000, y: 0 }]);
    s.tickEffects(ms + 1);
    expect(phys(s).speedMul).toBeCloseTo(1, 12);
    expect(events(s, EVT.EFFECT_END)).toEqual([{ effect: 'slow' }]);
  });

  test('seagullDive queues a crash', () => {
    const s = makeRun();
    s.onHazard(hit('seagullDive'));
    expect(s.pendingCrash).toEqual({ cause: 'hazard', hazardId: 'seagullDive' });
  });
});

describe('B1 power-ups through RunScene.onPowerUp (shipped defs)', () => {
  test('Maple Wax: a 1.2 speed boost for 2 s, reported (and expired) under its OWN id', () => {
    const s = makeRun();
    s.onPowerUp(take('mapleWax'));
    expect(s.scaled).toEqual([1.2]);
    expect(phys(s).speedMul).toBeCloseTo(1.2, 12);
    expect(events(s, EVT.POWERUP_COLLECTED)).toEqual([{ id: 'mapleWax', durationMs: 2000, charges: 0 }]);
    s.tickEffects(2001);
    expect(phys(s).speedMul).toBeCloseTo(1, 12);
    expect(events(s, EVT.POWERUP_EXPIRED)).toEqual([{ id: 'mapleWax', reason: 'timeout' }]);
  });

  test('a base Packet Burst still expires as packetBurst', () => {
    const s = makeRun();
    s.onPowerUp(take('packetBurst'));
    s.tickEffects(3001);
    expect(events(s, EVT.POWERUP_EXPIRED)).toEqual([{ id: 'packetBurst', reason: 'timeout' }]);
  });

  test('Slick Wax Spray: stickyPatch is neutralised AND the sled gets a 1.1 speed boost while the 4 s ward runs', () => {
    const s = makeRun({ zones: [MODS.stickyPatch] });
    const plain = phys(makeRun());
    const sticky = phys(s);
    expect(sticky.groundResist).toBeGreaterThan(plain.groundResist);
    s.onPowerUp(take('slickWaxSpray'));
    expect(s.scaled).toEqual([1.1]);
    const w = phys(s);
    expect(w.groundResist).toBeCloseTo(plain.groundResist, 12);
    expect(w.speedMul).toBeCloseTo(1.1, 12);
    expect(events(s, EVT.POWERUP_COLLECTED)).toEqual([{ id: 'slickWaxSpray', durationMs: 4000, charges: 0 }]);
    s.tickEffects(4001);
    const after = phys(s);
    expect(after.groundResist).toBeCloseTo(sticky.groundResist, 12);
    expect(after.speedMul).toBeCloseTo(1, 12);
    expect(events(s, EVT.POWERUP_EXPIRED)).toEqual([{ id: 'slickWaxSpray', reason: 'timeout' }]);
  });

  test('Slick Wax\'s speed and a Packet Burst are separate: both multiply, and each chip ends on its own', () => {
    const s = makeRun();
    s.onPowerUp(take('packetBurst'));
    s.onPowerUp(take('slickWaxSpray'));
    expect(phys(s).speedMul).toBeCloseTo(1.3 * 1.1, 12);
    s.tickEffects(3001);
    expect(phys(s).speedMul).toBeCloseTo(1.1, 12);
    expect(events(s, EVT.POWERUP_EXPIRED)).toEqual([{ id: 'packetBurst', reason: 'timeout' }]);
  });

  test('Aqua-Lung Bubble: the slowMotion zone stops acting (gravity and friction back to base) for 4 s', () => {
    const s = makeRun({ zones: [MODS.slowMotion] });
    const plain = phys(makeRun());
    const slowZone = phys(s);
    expect(slowZone.gravityPxS2).toBeLessThan(plain.gravityPxS2);
    s.onPowerUp(take('aquaLungBubble'));
    const w = phys(s);
    expect(w.gravityPxS2).toBeCloseTo(plain.gravityPxS2, 12);
    expect(w.groundResist).toBeCloseTo(plain.groundResist, 12);
    expect(s.scaled).toEqual([]); // no speed part
    s.tickEffects(4001);
    expect(phys(s).gravityPxS2).toBeCloseTo(slowZone.gravityPxS2, 12);
  });

  test('Sweet-Tooth Coating: a Chocolate River hit while it runs does nothing (no HAZARD_HIT, no velocity cut, speedMul 1)', () => {
    const s = makeRun();
    s.onPowerUp(take('sweetToothCoating'));
    s.onHazard(hit('chocolateRiver'));
    expect(events(s, EVT.HAZARD_HIT)).toEqual([]);
    expect(s.scaled).toEqual([]);
    expect(phys(s).speedMul).toBeCloseTo(1, 12);
    s.tickEffects(5001);
    s.onHazard(hit('chocolateRiver'));
    expect(events(s, EVT.HAZARD_HIT).map((p) => p.hazardId)).toEqual(['chocolateRiver']);
  });

  test('Sweet-Tooth Coating also stops a river slow that is already acting', () => {
    const s = makeRun();
    s.onHazard(hit('chocolateRiver'));
    expect(phys(s).speedMul).toBeCloseTo(0.5, 12);
    s.onPowerUp(take('sweetToothCoating'));
    expect(phys(s).speedMul).toBeCloseTo(1, 12);
  });
});

describe('B1 HUD entries (UIScene)', () => {
  const ui = () => Object.assign(Object.create(UIScene.prototype), { content: C, nowMs: 0, warnY: 40, effects: new Map() });
  const recorder = () => {
    const ops = [];
    return { ops, g: new Proxy({}, { get: (t, k) => (...a) => { ops.push([k, ...a]); return undefined; } }) };
  };
  const IDS = ['mapleWax', 'slickWaxSpray', 'aquaLungBubble', 'sweetToothCoating'];

  test('each B1 pickup has its own HUD name (not an id-derived label)', () => {
    const u = ui();
    expect(IDS.map((id) => u._powerInfo(id).name)).toEqual(['MAPLE WAX', 'SLICK WAX', 'AQUA-LUNG', 'SWEET-TOOTH']);
  });

  test('each B1 pickup chip draws its own icon: not the unknown square, not the generic ward icon, all different', () => {
    const u = ui();
    const draw = (id) => { const r = recorder(); u._drawIcon(r.g, id, 10, 10, 1); return JSON.stringify(r.ops.filter(([k]) => k !== 'lineStyle' && k !== 'fillStyle')); };
    const square = JSON.stringify([['strokeRect', 5, 5, 10, 10]]);
    const wardIcon = (() => {
      const v = Object.assign(Object.create(UIScene.prototype), { content: { powerups: { w: { effect: { kind: 'ward' } } } } });
      const r = recorder(); v._drawIcon(r.g, 'w', 10, 10, 1); return JSON.stringify(r.ops.filter(([k]) => k !== 'lineStyle' && k !== 'fillStyle'));
    })();
    const icons = IDS.map(draw);
    for (const ic of icons) {
      expect(ic).not.toBe(square);
      expect(ic).not.toBe(wardIcon);
    }
    expect(new Set(icons).size).toBe(IDS.length);
  });

  test('a B1 slow hazard names itself on the warning line; a base slow keeps SPEED CUT', () => {
    const u = ui();
    const made = [];
    u._t = () => { const t = { text: '', setText(x) { this.text = x; return t; }, setColorKey() { return t; }, destroy() {} }; made.push(t); return t; };
    u.onHazard({ hazardId: 'chocolateRiver', effect: 'slow', durationMs: 1500 });
    expect(made[0].text).toContain('CHOCOLATE RIVER');
    u._removeEffect('slow');
    u.onHazard({ hazardId: 'groomerCat', effect: 'slow', durationMs: 900 });
    expect(made[1].text).toContain('GROOMER CAT');
    u._removeEffect('slow');
    u.onHazard({ hazardId: 'seaweedTangle', effect: 'slow', durationMs: 1200 });
    expect(made[2].text).toContain('SEAWEED TANGLE');
    u._removeEffect('slow');
    u.onHazard({ hazardId: 'overflowFirewall', effect: 'slow', durationMs: 1500 });
    expect(made[3].text).toContain('SPEED CUT');
  });
});

describe('B1 drawing: every new shapeKey has its own routine', () => {
  const PAL = { danger: 0xff0000, magenta: 0xff00ff, lime: 0x00ff00, cyan: 0x00ffff, amber: 0xffaa00, bg: 0, bgAlt: 1, text: 0xffffff };
  const scene = () => ({
    matter: { world: { add() {}, remove() {} } },
    add: {
      graphics: () => {
        const ops = [];
        const g = new Proxy({ ops, y: 0 }, {
          get: (t, k) => (k in t ? t[k] : (...a) => { ops.push([k, ...a]); return g; }),
          set: (t, k, v) => { t[k] = v; return true; },
        });
        return g;
      },
    },
  });
  const shape = (gfx) => JSON.stringify(gfx.ops.filter(([k]) => /^fill(Rect|Triangle|Points|Circle|Ellipse)$|^stroke|^lineBetween$/.test(k)).map(([k]) => k));

  test('the four hazards draw non-generic, mutually different shapes; Seagull Dive is `danger`', () => {
    const out = {};
    for (const id of ['groomerCat', 'seagullDive', 'seaweedTangle', 'chocolateRiver']) {
      const def = C.hazards[id];
      const h = new Hazard(scene(), def, { x: 100, y: 50, rotationDeg: 0 }, PAL);
      expect(h.drawKind).toBe(def.shapeKey);
      out[id] = shape(h.gfx);
      // the generic box is one fillRect + one strokeRect of the full hit box; none of these is that
      expect(out[id]).not.toBe(JSON.stringify(['fillRect', 'strokeRect']));
      if (id === 'seagullDive') expect(h.color).toBe(PAL.danger);
    }
    expect(new Set(Object.values(out)).size).toBe(4);
  });

  test('the four pickups draw non-generic, mutually different glyphs', () => {
    const out = {};
    for (const id of ['mapleWax', 'slickWaxSpray', 'aquaLungBubble', 'sweetToothCoating']) {
      const def = C.powerups[id];
      const p = new PowerUp(scene(), def, { x: 100, y: 50 }, PAL);
      expect(p.drawKind).toBe(def.shapeKey);
      out[id] = shape(p.gfx);
    }
    expect(new Set(Object.values(out)).size).toBe(4);
  });
});
