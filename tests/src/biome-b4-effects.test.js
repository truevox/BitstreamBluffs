/**
 * B4 "Air": the SHIPPED Space Mountain and Sky Jellyfish Mountain defs through RunScene dispatch (Meteor crash, Gust
 * Front impulse, never named as the killer; both stabilizers on the real landing path and the frame tuner), HUD tables
 * and drawing. Same fake Phaser seam as biome-b3-effects.test.js. The built-game gate checks the same effects on the real sled.
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
const { PhysicsTuner, BASE_STEP_MS, TUNING } = await import('../../src/systems/PhysicsTuner.js');

const { loadContent, makeGen } = await import('./_helpers.js');
const { GUST_MAX_PX_S } = await import('../../src/systems/BiomeEffects.js');

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

const hit = (id) => ({ def: C.hazards[id], cx: 1000, cy: 0, color: 5, gfx: null, hit: false });
const toPxS = (v) => (v * 1000) / BASE_STEP_MS;
const vel = (s) => ({ x: toPxS(s.sled.body.velocity.x), y: toPxS(s.sled.body.velocity.y) });
/** RunScene.handleTricksAndLanding needs a score and a few emitters; the landing path itself is the shipped one. */
const landable = (s) => {
  s.score = { getSnapshot: () => ({ multiplier: 1, comboTricks: [] }), onLanding: () => ({ bonus: 0, banked: 0, multiplierUsed: 1 }) };
  s.emitCombo = () => {}; s.emitScore = () => {}; s._zoneScoreMulAt = () => 1; s.applyLandingBoost = () => {};
  return s;
};
const LAND = { quality: 'crash', angleDeg: TUNING.forgiveAngleDeg + 6, impactSpeedPxS: 450, airtimeMs: 900 };
const FS = { x: 1000, y: 0, vx: 300, vy: 0 };

describe('B4 hazards through RunScene.onHazard (shipped defs)', () => {
  test('Meteor: a hit queues a crash named meteor (the killer death legibility shows)', () => {
    const s = makeRun();
    s.onHazard(hit('meteor'));
    expect(s.pendingCrash).toEqual({ cause: 'hazard', hazardId: 'meteor' });
    expect(events(s, EVT.HAZARD_HIT)).toEqual([{ hazardId: 'meteor', effect: 'crash', durationMs: 0, x: 1000, y: 0 }]);
  });

  test('Gust Front: the real sled body velocity changes by exactly the def impulse (<= 180 px/s), no crash, HAZARD_HIT 0 ms', () => {
    const s = makeRun();
    const [ix, iy] = C.hazards.gustFront.onHit.impulsePxS;
    const v0 = vel(s);
    s.onHazard(hit('gustFront'));
    const v1 = vel(s);
    expect(v1.x - v0.x).toBeCloseTo(ix, 6);
    expect(v1.y - v0.y).toBeCloseTo(iy, 6);
    expect(Math.hypot(v1.x - v0.x, v1.y - v0.y)).toBeLessThanOrEqual(GUST_MAX_PX_S + 1e-9);
    expect([s.sled.vx, s.sled.vy]).toEqual([300 + ix, 20 + iy]); // Sled's px/s cache kept in step
    expect(s.pendingCrash).toBe(null);
    expect(events(s, EVT.HAZARD_HIT)).toEqual([{ hazardId: 'gustFront', effect: 'gust', durationMs: 0, x: 1000, y: 0 }]);
  });

  test('a gust is never named as the killer: what the gust pushes you into is', () => {
    // into a hazard
    const a = makeRun();
    a.onHazard(hit('gustFront'));
    a.onHazard(hit('meteor'));
    expect(a.pendingCrash).toEqual({ cause: 'hazard', hazardId: 'meteor' });
    // into a bad landing
    const b = landable(makeRun());
    b.onHazard(hit('gustFront'));
    b.handleTricksAndLanding({ tricks: [], landing: { ...LAND, angleDeg: 120 } }, FS);
    expect(b.pendingCrash).toEqual({ cause: 'badLanding' });
    // a second gust front does not overwrite an earlier queued killer, and adds no hazardId of its own
    const c = makeRun();
    c.onHazard(hit('meteor'));
    const g2 = hit('gustFront');
    c.crashed = false;
    c.onHazard(g2);
    expect(c.pendingCrash).toEqual({ cause: 'hazard', hazardId: 'meteor' });
  });
});

describe('B4 power-ups through RunScene.onPowerUp (shipped defs, the shared stabilize kind)', () => {
  test.each(['gravityStabilizer', 'stabilizerRails'])('%s: a landing just past the forgiveness angle crashes without it, is a wobble with it, crashes again after 5 s', (id) => {
    const plain = landable(makeRun());
    plain.handleTricksAndLanding({ tricks: [], landing: LAND }, FS);
    expect(plain.pendingCrash).toEqual({ cause: 'badLanding' });

    const s = landable(makeRun());
    s.onPowerUp(take(id));
    expect(events(s, EVT.POWERUP_COLLECTED)).toEqual([{ id, durationMs: 5000, charges: 0 }]);
    s.handleTricksAndLanding({ tricks: [], landing: LAND }, FS);
    expect(s.pendingCrash).toBe(null);
    expect(events(s, EVT.LANDING).map((p) => p.quality)).toEqual(['sloppy']);
    s.tickEffects(5001);
    expect(events(s, EVT.POWERUP_EXPIRED)).toEqual([{ id, reason: 'timeout' }]);
    s.handleTricksAndLanding({ tricks: [], landing: LAND }, FS);
    expect(s.pendingCrash).toEqual({ cause: 'badLanding' });
  });

  test('Stabilizer Rails damp the Sky Jellyfish bouncySpring on the frame tuner (bounceMul, restitution), back after 5 s', () => {
    const s = makeRun({ zones: [C.terrainMods.bouncySpring] });
    const bouncy = phys(s);
    s.onPowerUp(take('stabilizerRails'));
    const railed = phys(s);
    expect(railed.bounceMul).toBeCloseTo(bouncy.bounceMul * C.powerups.stabilizerRails.effect.bounceMul, 12);
    expect(railed.restitution).toBeLessThan(bouncy.restitution * 0.5);
    s.tickEffects(5001);
    expect(phys(s).bounceMul).toBeCloseTo(bouncy.bounceMul, 12);
  });

  test('the Gravity Stabilizer leaves the bounce alone (no bounceMul: it is the landing margin only)', () => {
    const s = makeRun({ zones: [C.terrainMods.bouncySpring] });
    const bouncy = phys(s);
    s.onPowerUp(take('gravityStabilizer'));
    expect(phys(s).bounceMul).toBeCloseTo(bouncy.bounceMul, 12);
  });

  test('taking the other stabilizer replaces the first one (the chip of the first expires as replaced)', () => {
    const s = makeRun();
    s.onPowerUp(take('gravityStabilizer'));
    s.onPowerUp(take('stabilizerRails'));
    expect(events(s, EVT.POWERUP_EXPIRED)).toEqual([{ id: 'gravityStabilizer', reason: 'replaced' }]);
  });
});

describe('B4 HUD entries (UIScene)', () => {
  const ui = () => Object.assign(Object.create(UIScene.prototype), { content: C, nowMs: 0, warnY: 40, effects: new Map() });
  const recorder = () => {
    const ops = [];
    return { ops, g: new Proxy({}, { get: (t, k) => (...a) => { ops.push([k, ...a]); return undefined; } }) };
  };
  const IDS = ['gravityStabilizer', 'stabilizerRails'];

  test('each B4 pickup has its own HUD name and colour', () => {
    const u = ui();
    expect(IDS.map((id) => u._powerInfo(id).name)).toEqual(['GRAV STABILIZER', 'STABILIZER RAILS']);
    expect(IDS.map((id) => u._powerInfo(id).color)).toEqual(['amber', 'lime']);
  });

  test('each B4 pickup chip draws its own icon: not the unknown square, not the stabilize kind icon, both different', () => {
    const u = ui();
    const draw = (id) => { const r = recorder(); u._drawIcon(r.g, id, 10, 10, 1); return JSON.stringify(r.ops.filter(([k]) => k !== 'lineStyle' && k !== 'fillStyle')); };
    const square = JSON.stringify([['strokeRect', 5, 5, 10, 10]]);
    const v = Object.assign(Object.create(UIScene.prototype), { content: { powerups: { w: { effect: { kind: 'stabilize' } } } } });
    const r = recorder(); v._drawIcon(r.g, 'w', 10, 10, 1);
    const kindIcon = JSON.stringify(r.ops.filter(([k]) => k !== 'lineStyle' && k !== 'fillStyle'));
    const icons = IDS.map(draw);
    for (const ic of icons) {
      expect(ic).not.toBe(square);
      expect(ic).not.toBe(kindIcon);
    }
    expect(new Set(icons).size).toBe(2);
  });

  test('a Gust Front names itself on the warning line; a nameless gust keeps GUST', () => {
    const u = ui();
    const made = [];
    u._t = () => { const t = { text: '', setText(x) { this.text = x; return t; }, setColorKey() { return t; }, destroy() {} }; made.push(t); return t; };
    u.onHazard({ effect: 'gust', durationMs: 0, hazardId: 'gustFront' });
    expect(made[0].text).toContain('GUST FRONT');
    const w = ui();
    const made2 = [];
    w._t = () => { const t = { text: '', setText(x) { this.text = x; return t; }, setColorKey() { return t; }, destroy() {} }; made2.push(t); return t; };
    w.onHazard({ effect: 'gust', durationMs: 0 });
    expect(made2[0].text).toContain('GUST');
    expect(made2[0].text).not.toContain('FRONT');
  });
});

describe('B4 drawing: every new shapeKey has its own routine', () => {
  const shape = (gfx) => JSON.stringify(gfx.ops.filter(([k]) => /^fill(Rect|Triangle|Points|Circle|Ellipse)$|^stroke|^lineBetween$/.test(k)).map(([k]) => k));
  const air = (x) => ({ x, y: 50, rotationDeg: 0 });

  test('Meteor draws its own shape in `danger`; Gust Front its own in cyan (not danger); both differ from the generic box', () => {
    const out = {};
    for (const id of ['meteor', 'gustFront']) {
      const def = C.hazards[id];
      const sc = scene();
      const h = new Hazard(sc, def, air(100), PAL);
      expect(h.drawKind).toBe(def.shapeKey);
      expect(h.color).toBe(id === 'meteor' ? PAL.danger : PAL.cyan);
      out[id] = shape(h.gfx);
      const generic = new Hazard(sc, { ...def, shapeKey: 'zzUnknownShape' }, air(100), PAL);
      expect(generic.drawKind).toBe('generic');
      expect(out[id]).not.toBe(shape(generic.gfx));
    }
    expect(out.meteor).not.toBe(out.gustFront);
  });

  test('the Gust Front streaks point the way the gust pushes (its arrowhead tip lies along the impulse)', () => {
    const def = C.hazards.gustFront;
    const h = new Hazard(scene(), def, air(100), PAL);
    const tri = h.gfx.ops.filter(([k]) => k === 'fillTriangle').pop();
    expect(tri).toBeDefined();
    const [, tx, ty] = tri;
    const [ix, iy] = def.onHit.impulsePxS;
    // tip relative to the box centre (0, -h/2) points along the impulse
    const cx = tx;
    const cy = ty + def.size.h / 2;
    expect((cx * ix + cy * iy) / (Math.hypot(cx, cy) * Math.hypot(ix, iy))).toBeGreaterThan(0.99);
  });

  test('both pickups draw non-generic glyphs, different from each other', () => {
    const out = {};
    for (const id of ['gravityStabilizer', 'stabilizerRails']) {
      const def = C.powerups[id];
      const p = new PowerUp(scene(), def, { x: 100, y: 50 }, PAL);
      expect(p.drawKind).toBe(def.shapeKey);
      out[id] = shape(p.gfx);
      const generic = new PowerUp(scene(), { ...def, shapeKey: 'zzUnknownGlyph' }, { x: 100, y: 50 }, PAL);
      expect(out[id]).not.toBe(shape(generic.gfx));
    }
    expect(new Set(Object.values(out)).size).toBe(2);
  });
});
