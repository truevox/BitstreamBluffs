/**
 * B0: the RunScene dispatch of every new hazard effect and power-up kind (audit T3: no Jest test imported RunScene, so a
 * deleted dispatch branch failed nothing). The scene methods under test are the shipped ones, called on a stub built
 * from RunScene.prototype; Phaser is a small fake with just the Matter Body calls the gust uses. The built-game gate
 * (tools/sim/gate-playthrough.mjs) checks the same effects on the real sled.
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
const { PhysicsTuner, TUNING, BASE_STEP_MS } = await import('../../src/systems/PhysicsTuner.js');
const { GUST_MAX_PX_S, BLIND_MIN_VISIBILITY } = await import('../../src/systems/BiomeEffects.js');
const { loadContent } = await import('./_helpers.js');

const MODS = loadContent().terrainMods;
const PAD = { tuck: false, brake: false };
const toPxS = (v) => (v * 1000) / BASE_STEP_MS;

function makeRun({ zones = [] } = {}) {
  const emitted = [];
  const s = Object.create(RunScene.prototype);
  Object.assign(s, {
    game: { events: { emit: (e, p) => { emitted.push([e, p]); } } },
    emitted,
    sled: {
      x: 1000, y: 0, vx: 300, vy: 20, inWorld: true, invulnerableMs: 0, grounded: true, parachuteMs: 0, airBrakeActive: false,
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
    slowMs: 0, slowFactor: 0.5, scrambleMs: 0, boostMs: 0, boostFactor: 1, slowmoMs: 0, slowmoScale: 0.5, shieldCharges: 0,
    collectedPowerups: new Set(),
    _despawn: [],
    _airTricks: 0,
    maxAirtimeMs: 0,
    _landings: 0,
  });
  s.getZoneDefs = () => zones;
  s._resetBiomeEffects();
  return s;
}

const hazard = (onHit, id = 'fxHazard') => ({ def: { id, onHit }, cx: 1000, cy: 0, color: 5, gfx: null, hit: false });
const pickup = (effect, id = 'fxPickup') => ({ def: { id, effect }, spawn: { x: 1000, y: 0 }, color: 5, destroy() {} });
const phys = (s) => s.tuner.getEffective(s.physicsContext(PAD));
const events = (s, name) => s.emitted.filter(([e]) => e === name).map(([, p]) => p);

describe('RunScene.onPowerUp: ward', () => {
  test('a ward vs stickyPatch makes the effective groundResist the un-sticky value while it lasts, then sticky again', () => {
    const s = makeRun({ zones: [MODS.stickyPatch] });
    const base = makeRun().tuner.getEffective(makeRun().physicsContext(PAD)).groundResist;
    const sticky = phys(s).groundResist;
    expect(sticky).toBeGreaterThan(base);
    s.onPowerUp(pickup({ kind: 'ward', durationMs: 4000, mods: ['stickyPatch'], hazards: [], effects: [] }, 'slickWax'));
    expect(phys(s).groundResist).toBeCloseTo(base, 12);
    expect(events(s, EVT.POWERUP_COLLECTED)).toEqual([{ id: 'slickWax', durationMs: 4000, charges: 0 }]);
    s.tickEffects(3990);
    expect(phys(s).groundResist).toBeCloseTo(base, 12);
    s.tickEffects(20);
    expect(phys(s).groundResist).toBeCloseTo(sticky, 12);
    expect(events(s, EVT.POWERUP_EXPIRED)).toEqual([{ id: 'slickWax', reason: 'timeout' }]);
  });

  test('a warded hazard id does nothing and reports no hit', () => {
    const s = makeRun();
    s.onPowerUp(pickup({ kind: 'ward', durationMs: 5000, hazards: ['groomerCat'] }));
    s.onHazard(hazard({ effect: 'crash' }, 'groomerCat'));
    expect(s.pendingCrash).toBe(null);
    expect(events(s, EVT.HAZARD_HIT)).toEqual([]);
    s.onHazard(hazard({ effect: 'crash' }, 'packetSpike'));
    expect(s.pendingCrash).toEqual({ cause: 'hazard', hazardId: 'packetSpike' });
  });

  test('a warded effect (blind, slow) does nothing, and an active slow stops acting while warded', () => {
    const s = makeRun();
    s.onHazard(hazard({ effect: 'slow', durationMs: 1500, speedFactor: 0.5 }, 'firewall'));
    expect(phys(s).speedMul).toBeCloseTo(0.5, 9);
    s.onPowerUp(pickup({ kind: 'ward', durationMs: 5000, effects: ['blind', 'slow'] }));
    expect(phys(s).speedMul).toBeCloseTo(1, 9);
    s.onHazard(hazard({ effect: 'blind', durationMs: 1200, visibility: 0.4 }, 'shatterWall'));
    expect(s.blindMs).toBe(0);
    expect(events(s, EVT.HAZARD_HIT).map((p) => p.effect)).toEqual(['slow']);
  });

  test('a manual reset (Shift) ends every ward, glide, stabilize and blind with reason respawn', () => {
    const s = makeRun();
    Object.assign(s, {
      pickSafe: () => ({}), respawnAt: () => ({ x: 0, y: 0 }), emitFlow() {}, emitCombo() {}, emitScore() {},
      score: { penalizeReset: () => ({ comboPenalty: 0, pointsLost: 0 }) },
    });
    s.onPowerUp(pickup({ kind: 'ward', durationMs: 5000, mods: ['stickyPatch'] }, 'slickWax'));
    s.onPowerUp(pickup({ kind: 'glide', frictionMul: 0.7, durationMs: 4000 }, 'sandrunner'));
    s.onPowerUp(pickup({ kind: 'stabilize', landingToleranceDeg: 12, durationMs: 5000 }, 'gravStab'));
    s.onHazard(hazard({ effect: 'blind', durationMs: 1200 }, 'shatterWall'));
    s.manualReset();
    expect(events(s, EVT.POWERUP_EXPIRED)).toEqual([
      { id: 'slickWax', reason: 'respawn' }, { id: 'sandrunner', reason: 'respawn' }, { id: 'gravStab', reason: 'respawn' },
    ]);
    expect(events(s, EVT.EFFECT_END)).toEqual([{ effect: 'blind' }]);
    expect(s.wards.wards).toEqual([]);
    expect([s.glideMs, s.stabilizeMs, s.blindMs]).toEqual([0, 0, 0]);
  });
});

describe('RunScene.onPowerUp: glide and stabilize', () => {
  test('a glide lowers ground friction (groundResist x frictionMul) for its duration', () => {
    const s = makeRun();
    const base = phys(s).groundResist;
    s.onPowerUp(pickup({ kind: 'glide', frictionMul: 0.7, durationMs: 4000 }, 'sandrunner'));
    expect(phys(s).groundResist).toBeCloseTo(base * 0.7, 12);
    s.tickEffects(4001);
    expect(phys(s).groundResist).toBeCloseTo(base, 12);
    expect(events(s, EVT.POWERUP_EXPIRED)).toEqual([{ id: 'sandrunner', reason: 'timeout' }]);
  });

  test('a stabilize widens landing tolerance: a landing that would crash becomes a wobble', () => {
    const land = { quality: 'crash', angleDeg: TUNING.forgiveAngleDeg + 8, impactSpeedPxS: 400, airtimeMs: 600 };
    const fs = { x: 1000, y: 0, vx: 300, vy: 0 };
    const stubLanding = (s) => {
      s.score = { getSnapshot: () => ({ multiplier: 1, comboTricks: [] }), onLanding: () => ({ bonus: 0, banked: 0, multiplierUsed: 1 }) };
      s.emitCombo = () => {}; s.emitScore = () => {}; s.emitFlow = () => {}; s._zoneScoreMulAt = () => 1; s.applyLandingBoost = () => {};
    };
    const plain = makeRun();
    stubLanding(plain);
    plain.handleTricksAndLanding({ tricks: [], landing: land }, fs);
    expect(plain.pendingCrash).toEqual({ cause: 'badLanding' });

    const s = makeRun();
    stubLanding(s);
    s.onPowerUp(pickup({ kind: 'stabilize', landingToleranceDeg: 12, durationMs: 5000 }, 'gravStab'));
    s.handleTricksAndLanding({ tricks: [], landing: land }, fs);
    expect(s.pendingCrash).toBe(null);
    expect(events(s, EVT.LANDING).map((p) => p.quality)).toEqual(['sloppy']);
  });

  test('a stabilize bounceMul damps bounce', () => {
    const s = makeRun({ zones: [MODS.bouncySpring] });
    const before = phys(s).bounceMul;
    s.onPowerUp(pickup({ kind: 'stabilize', landingToleranceDeg: 12, bounceMul: 0.5, durationMs: 5000 }));
    expect(phys(s).bounceMul).toBeCloseTo(before * 0.5, 12);
  });
});

describe('RunScene.onHazard: gust and blind', () => {
  test('a gust changes the sled velocity by the bounded impulse', () => {
    const s = makeRun();
    const v0 = { x: toPxS(s.sled.body.velocity.x), y: toPxS(s.sled.body.velocity.y) };
    s.onHazard(hazard({ effect: 'gust', impulsePxS: [400, -300] }, 'gustFront'));
    const dvx = toPxS(s.sled.body.velocity.x) - v0.x;
    const dvy = toPxS(s.sled.body.velocity.y) - v0.y;
    expect(Math.hypot(dvx, dvy)).toBeCloseTo(GUST_MAX_PX_S, 6);
    expect(dvx).toBeGreaterThan(0);
    expect(dvy).toBeLessThan(0);
    expect(events(s, EVT.HAZARD_HIT)).toEqual([{ hazardId: 'gustFront', effect: 'gust', durationMs: 0, x: 1000, y: 0 }]);
    expect(s.pendingCrash).toBe(null);
  });

  test('blind shows the overlay (>= 35 % visibility), never crashes, and ends with EFFECT_END', () => {
    const s = makeRun();
    s.onHazard(hazard({ effect: 'blind', durationMs: 1200, visibility: 0.05 }, 'shatterWall'));
    expect(s.pendingCrash).toBe(null);
    expect(events(s, EVT.HAZARD_HIT)[0]).toMatchObject({ effect: 'blind', durationMs: 1200 });
    s.tickEffects(400);
    s.updateBlindOverlay();
    expect(s.blindRect.alpha).toBeGreaterThan(0.5);
    expect(s.blindRect.alpha).toBeLessThanOrEqual(1 - BLIND_MIN_VISIBILITY + 1e-12);
    s.tickEffects(900);
    s.updateBlindOverlay();
    expect(s.blindRect.alpha).toBe(0);
    expect(events(s, EVT.EFFECT_END)).toEqual([{ effect: 'blind' }]);
  });

  test('base effects still dispatch as before (slow, scramble, crash)', () => {
    const s = makeRun();
    s.onHazard(hazard({ effect: 'scramble' }, 'vent'));
    expect(events(s, EVT.HAZARD_HIT)[0]).toMatchObject({ effect: 'scramble', durationMs: 2000 });
    expect(s.scrambleMs).toBe(2000);
    s.onHazard(hazard({ effect: 'slow', speedFactor: 0.5 }, 'fw'));
    expect(s.slowMs).toBe(1500);
    s.onHazard(hazard({ effect: 'crash' }, 'spike'));
    expect(s.pendingCrash).toEqual({ cause: 'hazard', hazardId: 'spike' });
  });
});

describe('UIScene: HUD entries for every new kind', () => {
  const content = {
    powerups: {
      fxWard: { id: 'fxWard', effect: { kind: 'ward' } },
      fxGlide: { id: 'fxGlide', effect: { kind: 'glide' } },
      fxStab: { id: 'fxStab', effect: { kind: 'stabilize' } },
      fxOdd: { id: 'fxOdd', effect: { kind: 'mystery' } },
    },
  };
  const ui = () => Object.assign(Object.create(UIScene.prototype), { content, nowMs: 0, warnY: 40, effects: new Map() });
  const recorder = () => {
    const ops = [];
    return { ops, g: new Proxy({}, { get: (t, k) => (...a) => { ops.push(k); return undefined; } }) };
  };

  test('a biome pickup without its own POWERUP_INFO row gets its kind\'s colour and an id-derived name', () => {
    const u = ui();
    expect(u._powerInfo('fxWard')).toEqual({ name: 'FX WARD', color: 'cyan' });
    expect(u._powerInfo('fxGlide').color).toBe('lime');
    expect(u._powerInfo('fxStab').color).toBe('amber');
    expect(u._powerInfo('clockPulse').name).toBe('CLOCK PULSE');
  });

  test('ward, glide and stabilize chips draw their own icon, not the unknown-id square', () => {
    const u = ui();
    const draw = (id) => { const r = recorder(); u._drawIcon(r.g, id, 10, 10, 1); return r.ops.filter((k) => k !== 'lineStyle' && k !== 'fillStyle'); };
    const square = draw('fxOdd');
    expect(square).toEqual(['strokeRect']);
    for (const id of ['fxWard', 'fxGlide', 'fxStab']) {
      expect(draw(id)).not.toEqual(square);
      expect(draw(id).length).toBeGreaterThan(1);
    }
    expect(draw('fxWard')).not.toEqual(draw('fxGlide'));
    expect(draw('fxGlide')).not.toEqual(draw('fxStab'));
  });

  test('blind and gust raise a warning line; an instant gust stays up for its showMs', () => {
    const u = ui();
    const made = [];
    u._t = () => { const t = { text: '', setText(x) { this.text = x; return t; }, setColorKey() { return t; }, destroy() {} }; t.__snap = false; made.push(t); return t; };
    u.onHazard({ effect: 'blind', durationMs: 1200 });
    u.onHazard({ effect: 'gust', durationMs: 0 });
    expect([...u.effects.keys()]).toEqual(['blind', 'gust']);
    expect(made[0].text).toContain('BLINDED');
    expect(made[1].text).toContain('GUST');
    expect(u.effects.get('gust').remaining).toBeGreaterThanOrEqual(700);
  });
});

describe('Hazard.js / PowerUp.js: biome defs with a new shapeKey still draw, crash hazards keep `danger`', () => {
  const PAL = { danger: 0xff0000, magenta: 0xff00ff, lime: 0x00ff00, cyan: 0x00ffff, amber: 0xffaa00, bg: 0, text: 0xffffff };
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
  const fills = (gfx) => gfx.ops.filter(([k]) => /^fill|^stroke/.test(k));

  test('a biome crash hazard is drawn in `danger` even when its JSON names another colour; a base def is not recoloured', () => {
    const biome = new Hazard(scene(), { id: 'meteor', biome: 'space-mountain', shapeKey: 'meteor', size: { w: 30, h: 30 }, onHit: { effect: 'crash' }, placement: 'air', colorKey: 'magenta' }, { x: 100, y: 50, rotationDeg: 0 }, PAL);
    expect(biome.color).toBe(PAL.danger);
    const chasm = new Hazard(scene(), { id: 'glitchChasm', shapeKey: 'chasm', size: { w: 64, h: 40 }, onHit: { effect: 'crash' }, placement: 'ground', colorKey: 'magenta' }, { x: 100, y: 50, rotationDeg: 0 }, PAL);
    expect(chasm.color).toBe(PAL.magenta);
    const slow = new Hazard(scene(), { id: 'seaweed', biome: 'underwater-mountain', shapeKey: 'seaweed', size: { w: 30, h: 30 }, onHit: { effect: 'slow' }, placement: 'ground', colorKey: 'lime' }, { x: 100, y: 50, rotationDeg: 0 }, PAL);
    expect(slow.color).toBe(PAL.lime);
  });

  test('an unknown hazard shapeKey draws the visible generic box', () => {
    const h = new Hazard(scene(), { id: 'groomer', biome: 'debumont', shapeKey: 'groomerCat', size: { w: 30, h: 20 }, onHit: { effect: 'slow' }, placement: 'ground', colorKey: 'lime' }, { x: 100, y: 50, rotationDeg: 0 }, PAL);
    expect(h.drawKind).toBe('generic');
    const ops = fills(h.gfx);
    expect(ops.some(([k, , , w, ht]) => k === 'fillRect' && w === 30 && ht === 20)).toBe(true);
  });

  test('an unknown power-up shapeKey draws a filled glyph, not just the ring', () => {
    const p = new PowerUp(scene(), { id: 'mapleWax', biome: 'debumont', shapeKey: 'mapleWax', radius: 10, effect: { kind: 'speedBoost' }, colorKey: 'amber' }, { x: 100, y: 50 }, PAL);
    expect(p.drawKind).toBe('generic');
    expect(p.gfx.ops.some(([k, pts]) => k === 'fillPoints' && Array.isArray(pts) && pts.length === 4)).toBe(true);
  });
});
