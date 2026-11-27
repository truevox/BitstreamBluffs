/**
 * B2 "Sight": the SHIPPED Crystal Cavern and Vertigo Vents defs through the shipped RunScene dispatch, HUD tables and
 * entity drawing (same fake Phaser seam as biome-b1-effects.test.js). The built-game gate checks the same effects on the
 * real sled.
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
const { BLIND_MIN_VISIBILITY } = await import('../../src/systems/BiomeEffects.js');
const { loadContent } = await import('./_helpers.js');

const C = loadContent();
const PAD = { tuck: false, brake: false };

function makeRun() {
  const emitted = [];
  const scaled = [];
  const s = Object.create(RunScene.prototype);
  Object.assign(s, {
    game: { events: { emit: (e, p) => { emitted.push([e, p]); } } },
    emitted,
    scaled,
    sled: {
      x: 1000, y: 0, vx: 300, vy: 20, inWorld: true, invulnerableMs: 0, grounded: true, parachuteMs: 0, airBrakeActive: false, shield: false,
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
    startX: 0,
    openingGraces: 0,
    slowMs: 0, slowFactor: 0.5, scrambleMs: 0, boostMs: 0, boostFactor: 1, slowmoMs: 0, slowmoScale: 0.5, shieldCharges: 0,
    collectedPowerups: new Set(),
    score: { onShieldHit: () => null, getSnapshot: () => ({ comboTricks: [] }) },
    emitFlow() {},
    _despawn: [],
  });
  s.getZoneDefs = () => [];
  s._resetBiomeEffects();
  return s;
}
const hit = (id) => ({ def: C.hazards[id], cx: 1000, cy: 0, color: 5, gfx: null, hit: false });
const take = (id) => ({ def: C.powerups[id], spawn: { x: 1000, y: 0 }, color: 5, destroy() {} });
const phys = (s) => s.tuner.getEffective(s.physicsContext(PAD));
const events = (s, name) => s.emitted.filter(([e]) => e === name).map(([, p]) => p);
const overlay = (s) => { s.updateBlindOverlay(); return s.blindRect.alpha; };

describe('B2 hazards through RunScene.onHazard (shipped defs)', () => {
  test.each(['shatterWall', 'ashCloud'])('%s: blind for 1.2 s: overlay up within the visibility floor, no crash, then clear', (id) => {
    const s = makeRun();
    const def = C.hazards[id];
    s.onHazard(hit(id));
    expect(s.pendingCrash).toBe(null);
    expect(s.scaled).toEqual([]); // no speed change
    expect(events(s, EVT.HAZARD_HIT)).toEqual([{ hazardId: id, effect: 'blind', durationMs: 1200, x: 1000, y: 0 }]);
    expect(s.flashRect.alpha).toBeGreaterThan(0); // the flash
    s.tickEffects(600);
    const mid = overlay(s);
    expect(mid).toBeCloseTo(1 - def.onHit.visibility, 9);
    expect(mid).toBeLessThanOrEqual(1 - BLIND_MIN_VISIBILITY + 1e-12);
    s.tickEffects(601);
    expect(overlay(s)).toBe(0);
    expect(events(s, EVT.EFFECT_END)).toEqual([{ effect: 'blind' }]);
  });
});

describe('B2 Crystal Clear Goggles (ward vs blind and scramble, 6 s)', () => {
  test('a Shatter Wall or Ash Cloud hit while the Goggles run does nothing (no HAZARD_HIT, overlay stays 0)', () => {
    const s = makeRun();
    s.onPowerUp(take('crystalClearGoggles'));
    expect(events(s, EVT.POWERUP_COLLECTED)).toEqual([{ id: 'crystalClearGoggles', durationMs: 6000, charges: 0 }]);
    s.onHazard(hit('shatterWall'));
    s.onHazard(hit('ashCloud'));
    expect(events(s, EVT.HAZARD_HIT)).toEqual([]);
    expect(s.blindMs).toBe(0);
    expect(overlay(s)).toBe(0);
  });

  test('a Garbage Data Vent scramble while the Goggles run does nothing (controls not inverted, no jitter)', () => {
    const plain = phys(makeRun());
    const sc = makeRun();
    sc.onHazard(hit('garbageDataVent'));
    expect(phys(sc).tiltSign).toBe(-1); // control: the scramble really acts without the Goggles
    const s = makeRun();
    s.onPowerUp(take('crystalClearGoggles'));
    s.onHazard(hit('garbageDataVent'));
    expect(events(s, EVT.HAZARD_HIT)).toEqual([]);
    expect(s.scrambleMs).toBe(0);
    expect(phys(s).tiltSign).toBe(plain.tiltSign);
    expect(phys(s).scrambleJitterDegS2).toBe(plain.scrambleJitterDegS2);
  });

  test('the Goggles also stop a blind and a scramble that are already acting', () => {
    const s = makeRun();
    s.onHazard(hit('shatterWall'));
    s.onHazard(hit('garbageDataVent'));
    s.tickEffects(300);
    expect(overlay(s)).toBeGreaterThan(0.3);
    expect(phys(s).tiltSign).toBe(-1);
    s.onPowerUp(take('crystalClearGoggles'));
    expect(overlay(s)).toBe(0);
    expect(phys(s).tiltSign).toBe(1);
  });

  test('after 6 s the Goggles expire under their own id and blind acts again', () => {
    const s = makeRun();
    s.onPowerUp(take('crystalClearGoggles'));
    s.tickEffects(6001);
    expect(events(s, EVT.POWERUP_EXPIRED)).toEqual([{ id: 'crystalClearGoggles', reason: 'timeout' }]);
    s.onHazard(hit('shatterWall'));
    expect(events(s, EVT.HAZARD_HIT).map((p) => p.hazardId)).toEqual(['shatterWall']);
    s.tickEffects(600);
    expect(overlay(s)).toBeGreaterThan(0.3);
  });
});

describe('B2 Heat Shield (the existing shield, 1 charge, its own HUD chip)', () => {
  test('a pickup adds 1 charge (the shield visual derives from shieldCharges); a hazard crash is negated and the Heat Shield chip expires', () => {
    const s = makeRun();
    s.onPowerUp(take('heatShield'));
    expect(s.shieldCharges).toBe(1);
    expect(events(s, EVT.POWERUP_COLLECTED)).toEqual([{ id: 'heatShield', durationMs: 0, charges: 1 }]);
    s.onHazard(hit('packetSpike'));
    expect(s.pendingCrash).toEqual({ cause: 'hazard', hazardId: 'packetSpike' });
    s.resolveCrash({ x: 2000, y: 0, vx: 300, vy: 0 });
    expect(s.crashed).toBe(false);
    expect(s.shieldCharges).toBe(0);
    expect(events(s, EVT.CRASH)).toEqual([expect.objectContaining({ hazardId: 'packetSpike', negated: true })]);
    expect(events(s, EVT.POWERUP_EXPIRED)).toEqual([{ id: 'heatShield', reason: 'consumed' }]);
  });

  test('with a Hashed Backup and a Heat Shield each chip shows its own x1, and each spend expires the right chip', () => {
    const s = makeRun();
    s.onPowerUp(take('hashedBackup'));
    s.onPowerUp(take('heatShield'));
    expect(events(s, EVT.POWERUP_COLLECTED).map((p) => [p.id, p.charges])).toEqual([['hashedBackup', 1], ['heatShield', 1]]);
    s.pendingCrash = { cause: 'hazard', hazardId: 'packetSpike' };
    s.resolveCrash({ x: 2000, y: 0, vx: 300, vy: 0 });
    s.sled.invulnerableMs = 0;
    s.pendingCrash = { cause: 'hazard', hazardId: 'packetSpike' };
    s.resolveCrash({ x: 2400, y: 0, vx: 300, vy: 0 });
    expect(events(s, EVT.POWERUP_EXPIRED).map((p) => p.id)).toEqual(['heatShield', 'hashedBackup']);
  });

  test('a lone Hashed Backup still expires as hashedBackup (base behaviour unchanged)', () => {
    const s = makeRun();
    s.onPowerUp(take('hashedBackup'));
    s.pendingCrash = { cause: 'hazard', hazardId: 'packetSpike' };
    s.resolveCrash({ x: 2000, y: 0, vx: 300, vy: 0 });
    expect(events(s, EVT.POWERUP_EXPIRED)).toEqual([{ id: 'hashedBackup', reason: 'consumed' }]);
  });
});

describe('B2 HUD entries (UIScene)', () => {
  const ui = () => Object.assign(Object.create(UIScene.prototype), { content: C, nowMs: 0, warnY: 40, effects: new Map() });
  const recorder = () => {
    const ops = [];
    return { ops, g: new Proxy({}, { get: (t, k) => (...a) => { ops.push([k, ...a]); return undefined; } }) };
  };
  const IDS = ['crystalClearGoggles', 'heatShield'];

  test('each B2 pickup has its own HUD name and colour', () => {
    const u = ui();
    expect(IDS.map((id) => u._powerInfo(id).name)).toEqual(['GOGGLES', 'HEAT SHIELD']);
    expect(IDS.map((id) => u._powerInfo(id).color)).toEqual(['cyan', 'magenta']);
  });

  test('each B2 pickup chip draws its own icon: not the unknown square, not the ward icon, not the Hashed Backup', () => {
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
      expect(ic).not.toBe(draw('hashedBackup'));
    }
    expect(new Set(icons).size).toBe(IDS.length);
  });

  test('a B2 blind names its hazard on the warning line; a nameless blind keeps BLINDED', () => {
    const u = ui();
    const made = [];
    u._t = () => { const t = { text: '', setText(x) { this.text = x; return t; }, setColorKey() { return t; }, destroy() {} }; made.push(t); return t; };
    u.onHazard({ hazardId: 'shatterWall', effect: 'blind', durationMs: 1200 });
    expect(made[0].text).toContain('SHATTER WALL');
    u._removeEffect('blind');
    u.onHazard({ hazardId: 'ashCloud', effect: 'blind', durationMs: 1200 });
    expect(made[1].text).toContain('ASH CLOUD');
    u._removeEffect('blind');
    u.onHazard({ effect: 'blind', durationMs: 1200 });
    expect(made[2].text).toContain('BLINDED');
  });
});

describe('B2 drawing: every new shapeKey has its own routine', () => {
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

  test('both hazards draw non-generic, mutually different shapes, in their own colour (not danger)', () => {
    const out = {};
    for (const id of ['shatterWall', 'ashCloud']) {
      const def = C.hazards[id];
      const h = new Hazard(scene(), def, { x: 100, y: 50, rotationDeg: 0 }, PAL);
      expect(h.drawKind).toBe(def.shapeKey);
      expect(h.color).toBe(PAL[def.colorKey]);
      out[id] = shape(h.gfx);
      const generic = new Hazard(scene(), { ...def, shapeKey: 'zzUnknownShape' }, { x: 100, y: 50, rotationDeg: 0 }, PAL);
      expect(generic.drawKind).toBe('generic');
      expect(out[id]).not.toBe(shape(generic.gfx));
    }
    expect(new Set(Object.values(out)).size).toBe(2);
  });

  test('the Shatter Wall keeps the usual hit-box brackets (telegraphable like any ground hazard)', () => {
    const h = new Hazard(scene(), C.hazards.shatterWall, { x: 100, y: 50, rotationDeg: 0 }, PAL);
    expect(h.gfx.ops.filter(([k]) => k === 'lineBetween').length).toBeGreaterThanOrEqual(8);
  });

  test('both pickups draw non-generic glyphs, different from each other and from the Hashed Backup shield', () => {
    const out = {};
    for (const id of ['crystalClearGoggles', 'heatShield', 'hashedBackup']) {
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
