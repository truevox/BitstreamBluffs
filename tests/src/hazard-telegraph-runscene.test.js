/**
 * Readable Chaos, phase 1: the telegraph wired into the shipped RunScene (stub built from RunScene.prototype, as in
 * biome-effects-runscene.test.js), the drawing entity against a recording graphics fake, and the two new sounds.
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
const { GroundTelegraph, EDGE_INSET_PX, EDGE_MAX_STACK } = await import('../../src/entities/GroundTelegraph.js');
const { TelegraphTracker, planTelegraph, GROUND_WARN } = await import('../../src/systems/HazardTelegraph.js');
const { emptyWards, addWard } = await import('../../src/systems/Wards.js');
const { SFX, AudioSynth } = await import('../../src/systems/AudioSynth.js');
const { loadContent } = await import('./_helpers.js');

const DEFS = loadContent().hazards;
const hz = (id, cx, extra = {}) => ({ def: DEFS[id], cx, cy: 300 - DEFS[id].size.h / 2, w: DEFS[id].size.w, h: DEFS[id].size.h, hit: false, ...extra });
const PAL = { danger: 0xff0000, amber: 0xffaa00, lime: 0x00ff00, bg: 0x000011, text: 0xffffff, cyan: 0x00ffff };

function makeRun(hazards, sledOver = {}) {
  const sfx = [];
  const s = Object.create(RunScene.prototype);
  Object.assign(s, {
    sfx,
    sled: { x: 1000, y: 280, vx: 650, vy: 0, speed: 650, grounded: true, airEtaMs: Infinity, invulnerableMs: 0, groundAngleDeg: 0, airtimeMs: 0, ...sledOver },
    hazards: new Map([[0, hazards]]),
    wards: emptyWards(),
    teleTracker: new TelegraphTracker(),
    _view: { left: 900, right: 1900, top: 0, bottom: 540 },
    runTimeMs: 5000,
    playSfx(name, opts) { sfx.push([name, opts]); },
  });
  return s;
}

describe('RunScene.updateGroundTelegraph', () => {
  test('announces a crash hazard once (groundWarn), stamps it, then cues the hop once when the window opens', () => {
    const h = hz('packetSpike', 1000 + 1250);
    const s = makeRun([h]);
    s.updateGroundTelegraph(5000);
    expect(s.sfx).toEqual([['groundWarn', { brace: false }]]);
    expect(h.teleAtMs).toBe(5000);
    expect(s._teleMarks).toHaveLength(1);
    expect(s._teleMarks[0]).toMatchObject({ ref: h, color: 'danger', onScreen: false });
    s.updateGroundTelegraph(5016);
    expect(s.sfx).toHaveLength(1);
    s.sled.x = h.cx - 650 * 0.37;
    s._view.right = s.sled.x + 900;
    s.updateGroundTelegraph(6000);
    expect(s.sfx[1]).toEqual(['hopCue', undefined]);
    expect(s._teleMarks[0]).toMatchObject({ state: 'go', color: 'lime', onScreen: true });
    s.updateGroundTelegraph(6016);
    expect(s.sfx).toHaveLength(2);
    expect(h.teleAtMs).toBe(5000);
  });
  test('a slow hazard warns with the brace sound and never cues a hop', () => {
    const h = hz('overflowFirewall', 1400);
    const s = makeRun([h]);
    for (let x = 1000; x < 1400; x += 9) { s.sled.x = x; s.updateGroundTelegraph(5000 + x); }
    expect(s.sfx).toEqual([['groundWarn', { brace: true }]]);
  });
  test('a warded hazard (by id or by effect) is not announced', () => {
    const a = hz('overflowFirewall', 1400);
    const s = makeRun([a]);
    s.wards = addWard(s.wards, 'w1', { kind: 'ward', durationMs: 5000, effects: ['slow'] });
    s.updateGroundTelegraph(5000);
    expect(s.sfx).toEqual([]);
    expect(s._teleMarks).toEqual([]);
    const b = hz('packetSpike', 1400);
    const s2 = makeRun([b]);
    s2.wards = addWard(s2.wards, 'w2', { kind: 'ward', durationMs: 5000, hazards: ['packetSpike'] });
    s2.updateGroundTelegraph(5000);
    expect(s2._teleMarks).toEqual([]);
  });
  test('airborne with the ballistic landing well past the box: dim, silent; the forecast uses sled.airEtaMs', () => {
    const h = hz('packetSpike', 1400);
    const s = makeRun([h], { grounded: false, airEtaMs: 1000 }); // lands at 1650
    s.updateGroundTelegraph(5000);
    expect(s._teleMarks[0]).toMatchObject({ clear: true });
    expect(s.sfx).toEqual([]);
    s.sled.airEtaMs = 500; // lands at 1325, short of the box
    s.updateGroundTelegraph(5016);
    expect(s._teleMarks[0]).toMatchObject({ clear: false });
    expect(s.sfx).toEqual([['groundWarn', { brace: false }]]);
  });
  test('passes the run time: a moving hazard is timed with its predictX, an open Gear Gate stays silent', () => {
    // rolls toward the sled at 200 px/s from run time 5000: dx 243 closes at 850 px/s -> 0.286 s (static: 0.374 s)
    const roll = hz('rollingBoulder', 1243, { predictX: (t) => 1240 - 200 * Math.max(0, t - 5000) / 1000 });
    const s = makeRun([roll]);
    s.updateGroundTelegraph(5000);
    expect(s._teleMarks[0].etaS).toBeCloseTo(243 / 850, 3);
    expect(s._teleMarks[0].arrivalMs).toBeCloseTo(5000 + 243 / 850 * 1000, 0);
    // a gate that is open from 5000 to 6400 (arrival at 5000 + 650 / 650 s): no sound, state open
    const gate = hz('gearGate', 1650, { predictX: () => 1650, isPassable: (t) => t >= 5000 && t < 6400, gateNextChangeMs: (t) => (t < 5000 ? 5000 - t : 6400 - t) });
    const s2 = makeRun([gate]);
    s2.updateGroundTelegraph(5000);
    expect(s2._teleMarks[0]).toMatchObject({ state: 'open', gate: 'open' });
    expect(s2.sfx).toEqual([]);
  });
  test('updateFun runs the telegraph every live frame', () => {
    const h = hz('packetSpike', 2200);
    const s = makeRun([h]);
    Object.assign(s, {
      shardField: null, airTelegraph: null, bestMarker: null, bestM: 0, newBestDone: true, biomeMask: 0, _biomeId: null,
      score: { checkMilestones: () => [] }, terrain: { _sectorOf: () => 1, biomeAtX: () => null },
      tutTimers: { stall: 0 }, tutDone: new Set(['hop', 'flip', 'push', 'tuck']), tutShown: new Set(), _steepMs: 0, _landings: 0, tuckShows: 9,
      hints: { update: () => [] }, lastBoost: null, _airTricks: 0,
    });
    s.launchAheadPx = () => Infinity;
    s.applyHintEvents = () => {};
    s.updateFun(16, { tuck: false }, 100);
    expect(s.sfx).toEqual([['groundWarn', { brace: false }]]);
    expect(s._teleMarks).toHaveLength(1);
  });
});

/** A Graphics fake that records every call. */
function fakeScene() {
  const calls = [];
  const g = new Proxy({}, { get: (_, name) => (name === 'calls' ? calls : (...args) => { calls.push([name, ...args]); return g; }) });
  return { add: { graphics: () => g }, g, calls };
}
const names = (calls) => calls.map((c) => c[0]);
const colours = (calls) => new Set(calls.filter((c) => c[0] === 'lineStyle' || c[0] === 'fillStyle').map((c) => c[2 - (c[0] === 'fillStyle' ? 1 : 0)]));
const xs = (calls) => calls.flatMap((c) => (c[0] === 'lineBetween' ? [c[1], c[3]] : c[0] === 'fillRect' ? [c[1], c[1] + c[3]] : c[0] === 'fillTriangle' || c[0] === 'strokeTriangle' ? [c[1], c[3], c[5]] : []));

describe('GroundTelegraph (drawing)', () => {
  const VIEW = { left: 900, right: 1900, top: 0, bottom: 540 };
  const flat = () => 300;
  const draw = (marks, zoom = 1, view = VIEW) => {
    const sc = fakeScene();
    const t = new GroundTelegraph(sc, PAL);
    sc.calls.length = 0;
    t.update(1234, marks, view, zoom, flat);
    return sc.calls;
  };
  const plan = (list, x = 1000, speed = 650, right = VIEW.right) => planTelegraph(list, { x, vx: speed, speed, grounded: true, landX: null }, right);

  test('no marks: clears and draws nothing', () => {
    expect(draw([])).toEqual([['clear']]);
  });
  test('an off-screen hazard is drawn at the right screen edge, on the terrain line, in its response colour', () => {
    const calls = draw(plan([hz('packetSpike', 2200)]));
    expect(names(calls)).toContain('lineBetween');
    expect(colours(calls).has(PAL.danger)).toBe(true);
    expect(colours(calls).has(PAL.amber)).toBe(false);
    const x = xs(calls);
    expect(Math.max(...x)).toBeLessThanOrEqual(VIEW.right);
    expect(Math.min(...x)).toBeGreaterThan(VIEW.right - 2 * EDGE_INSET_PX - 30);
    const ys = calls.flatMap((c) => (c[0] === 'lineBetween' ? [c[2], c[4]] : []));
    expect(Math.max(...ys)).toBeLessThanOrEqual(300 + 1);
    expect(Math.min(...ys)).toBeGreaterThan(300 - 120);
  });
  test('a brace hazard draws in amber, a hop-window hazard in lime', () => {
    expect(colours(draw(plan([hz('overflowFirewall', 2200)]))).has(PAL.amber)).toBe(true);
    const go = plan([hz('packetSpike', 1000 + 650 * 0.3)]);
    expect(go[0].state).toBe('go');
    const c = colours(draw(go));
    expect(c.has(PAL.lime)).toBe(true);
    expect(c.has(PAL.danger)).toBe(false);
  });
  test('an on-screen hazard gets a light column standing on the box, not an edge marker', () => {
    const h = hz('packetSpike', 1500);
    const calls = draw(plan([h]));
    const col = calls.filter((c) => c[0] === 'lineBetween' && c[1] === h.cx && c[3] === h.cx);
    expect(col.length).toBeGreaterThanOrEqual(2); // soft band + core
    const top = Math.min(...col.map((c) => Math.min(c[2], c[4])));
    expect(top).toBeLessThan(h.cy - h.h / 2 - 100);
    expect(Math.max(...xs(calls))).toBeLessThan(VIEW.right - EDGE_INSET_PX - 40);
  });
  test('a hazard high in the view: the column is shortened so the cue on top stays on screen', () => {
    const h = hz('packetSpike', 1500, { cy: 90 });
    const calls = draw(plan([h]));
    const ys = calls.flatMap((c) => (c[0] === 'lineBetween' ? [c[2], c[4]] : []));
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(VIEW.top);
    expect(Math.min(...ys)).toBeLessThan(90 - 10 - 30); // still a column above the box
  });
  test('sizes are counter-scaled: at zoom 0.5 the edge marker is twice as large in world px (same on screen)', () => {
    const view2 = { left: 0, right: 1920, top: 0, bottom: 1080 };
    const span = (calls) => { const x = xs(calls); return Math.max(...x) - Math.min(...x); };
    const a = span(draw(plan([hz('packetSpike', 2400)], 1000, 800, 1900)));
    const b = span(draw(plan([hz('packetSpike', 2400)], 1000, 800, 1920), 0.5, view2));
    expect(b / a).toBeCloseTo(2, 1);
  });
  test('edge markers stack upward and are capped at EDGE_MAX_STACK', () => {
    const many = [];
    for (let i = 0; i < 5; i++) many.push(hz('packetSpike', 2000 + i * 40));
    const m = plan(many);
    expect(m.length).toBe(5);
    const stems = (calls) => calls.filter((c) => c[0] === 'strokeRect').length;
    expect(stems(draw(m))).toBe(EDGE_MAX_STACK);
    expect(stems(draw(m.slice(0, 1)))).toBe(1);
  });
  test('a clear mark is drawn dim', () => {
    const m = planTelegraph([hz('packetSpike', 2200)], { x: 1000, vx: 650, speed: 650, grounded: false, landX: 3000 }, VIEW.right);
    const alphas = (calls) => calls.filter((c) => c[0] === 'lineStyle').map((c) => c[3]);
    expect(Math.max(...alphas(draw(m)))).toBeLessThanOrEqual(0.35);
    expect(Math.max(...alphas(draw(plan([hz('packetSpike', 2200)]))))).toBeGreaterThan(0.8);
  });
  test('an open Gear Gate is drawn dim, and its glyph has no bar across it (closed has one)', () => {
    const g = (open) => ({ ...hz('gearGate', 2200), predictX: () => 2200, isPassable: () => open, gateNextChangeMs: () => 1000 });
    const mk = (open) => planTelegraph([g(open)], { x: 1000, vx: 650, speed: 650, grounded: true, landX: null }, VIEW.right, { nowMs: 0 });
    const alphas = (calls) => calls.filter((c) => c[0] === 'lineStyle').map((c) => c[3]);
    expect(mk(true)[0].state).toBe('open');
    expect(Math.max(...alphas(draw(mk(true))))).toBeLessThanOrEqual(0.35);
    expect(Math.max(...alphas(draw(mk(false))))).toBeGreaterThan(0.8);
    const lines = (calls) => calls.filter((c) => c[0] === 'lineBetween').length;
    expect(lines(draw(mk(false)))).toBe(lines(draw(mk(true))) + 1);
  });
  test('the B3 and B2 hazards get their own glyphs (not the generic box)', () => {
    for (const id of ['rollingBoulder', 'dewDrop', 'gearGate', 'shatterWall']) {
      const calls = draw(plan([hz(id, 2200)]));
      // the generic glyph is a filled square at half alpha
      expect(calls.some((c) => c[0] === 'fillRect' && c[3] === c[4] && c[3] < 20 && c[2] !== undefined && c[5] === undefined)).toBe(false);
    }
  });
  test('setPalette and destroy', () => {
    const sc = fakeScene();
    const t = new GroundTelegraph(sc, PAL);
    t.setPalette({ ...PAL, danger: 0x123456 });
    sc.calls.length = 0;
    t.update(0, plan([hz('packetSpike', 2200)]), VIEW, 1, flat);
    expect(colours(sc.calls).has(0x123456)).toBe(true);
    t.destroy();
    expect(names(sc.calls)).toContain('destroy');
    expect(() => t.update(0, [], VIEW, 1, flat)).not.toThrow();
  });
});

describe('telegraph sounds', () => {
  test('groundWarn and hopCue are public SFX names', () => {
    expect(SFX).toContain('groundWarn');
    expect(SFX).toContain('hopCue');
  });
  test('each makes sound; the brace warning is a different, lower sound than the hop warning', () => {
    const a = new AudioSynth({ events: { on() {}, off() {} } });
    const rec = [];
    a.nodes = { sfxBus: {} };
    a._osc = (type, f0, f1) => { rec.push([type, f0, f1]); };
    a._noise = () => {};
    const play = (name, opts) => { rec.length = 0; a._sfx(name, 0, 1, 1, opts || {}); return rec.map((r) => r.slice()); };
    const hop = play('groundWarn', { brace: false });
    const brace = play('groundWarn', { brace: true });
    const cue = play('hopCue');
    expect(hop.length).toBeGreaterThan(0);
    expect(brace.length).toBeGreaterThan(0);
    expect(cue.length).toBeGreaterThan(0);
    const top = (r) => Math.max(...r.map((x) => Math.max(x[1], x[2])));
    expect(top(brace)).toBeLessThan(top(hop));
    expect(top(cue)).toBeGreaterThan(top(hop));
    expect(play('nope')).toEqual([]);
    void GROUND_WARN;
  });
});
