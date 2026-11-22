/**
 * Issue #119 Phase 2 prerequisite: TelegraphTracker state is keyed by stable hazard ids (`Hazard.hid` =
 * `${chunk.index}:${spawn ordinal}`, assigned in RunScene.takeChunk) and is plain data with snapshot()/restore().
 * Before this change the tracker used WeakMap/WeakSet keyed by Hazard object identity, so a restored game (hazards rebuilt
 * from the chunk data) re-warned every already-announced hazard and re-stamped Hazard.teleAtMs.
 * Diagnostic, non-authoritative; the replay/savestate contract is #152's.
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
const { TelegraphTracker, planTelegraph } = await import('../../src/systems/HazardTelegraph.js');
const { emptyWards } = await import('../../src/systems/Wards.js');
const { loadContent } = await import('../src/_helpers.js');

const DEFS = loadContent().hazards;
// The spawn list stands in for chunk data: every build of the hazards from it yields NEW objects with the SAME hid.
const SPAWNS = [
  ['packetSpike', 1500], ['overflowFirewall', 1700], ['glitchChasm', 1750], ['packetSpike', 2400], ['garbageDataVent', 2600], ['packetSpike', 3300],
];
const buildHazards = () => SPAWNS.map(([id, cx], i) => ({
  hid: `${Math.floor(i / 3)}:${i % 3}`, def: DEFS[id], cx, cy: 300 - DEFS[id].size.h / 2, w: DEFS[id].size.w, h: DEFS[id].size.h, hit: false,
}));
const TICK_MS = 1000 / 120;

function makeRun(hazards, x, tick) {
  const sfx = [];
  const s = Object.create(RunScene.prototype);
  Object.assign(s, {
    sfx, tick,
    sled: { x, y: 280, vx: 650, vy: 0, speed: 650, grounded: true, airEtaMs: Infinity, invulnerableMs: 0, groundAngleDeg: 0, airtimeMs: 0 },
    hazards: new Map([[0, hazards.slice(0, 3)], [1, hazards.slice(3)]]),
    wards: emptyWards(),
    teleTracker: new TelegraphTracker(),
    runTimeMs: tick * TICK_MS,
    playSfx(name, opts) { sfx.push([s.tick, name, opts && opts.brace]); },
  });
  return s;
}
function step(s, n) {
  for (let i = 0; i < n; i++) {
    s.tick++;
    s.sled.x += s.sled.vx / 120;
    s.runTimeMs = s.tick * TICK_MS;
    s.updateGroundTelegraph(s.runTimeMs);
  }
}
const stamps = (s) => [...s.hazards.values()].flat().map((h) => h.teleAtMs ?? null);
const arrivals = (s) => [...s.hazards.values()].flat().map((h) => s.teleTracker.lastArrivalMs(h));

describe('TelegraphTracker state survives a snapshot/restore into freshly built hazards', () => {
  const TOTAL = 520;
  const K = 150; // mid-run: the first hazards are warned (some cued), later ones are not announced yet

  test('no re-warn, identical teleAtMs, arrivals and cue sequence versus the uninterrupted run', () => {
    const a = makeRun(buildHazards(), 1000, 0);
    step(a, TOTAL);
    expect(a.sfx.length).toBeGreaterThan(3); // the fixture really warns and cues

    const b1 = makeRun(buildHazards(), 1000, 0);
    step(b1, K);
    expect(b1.sfx.length).toBeGreaterThan(0);
    expect(b1.sfx.length).toBeLessThan(a.sfx.length); // snapshot is genuinely mid-run
    const snap = JSON.parse(JSON.stringify(b1.snapshotTelegraph())); // plain data: survives JSON

    const b2 = makeRun(buildHazards(), b1.sled.x, K); // fresh scene, fresh hazard objects, same ids
    b2.restoreTelegraph(snap);
    step(b2, TOTAL - K);

    expect([...b1.sfx, ...b2.sfx]).toEqual(a.sfx);
    expect(stamps(b2)).toEqual(stamps(a));
    expect(arrivals(b2)).toEqual(arrivals(a));
  });

  test('control: restoring nothing re-warns every already-announced hazard (the bug this removes)', () => {
    const a = makeRun(buildHazards(), 1000, 0);
    step(a, 520);
    const b1 = makeRun(buildHazards(), 1000, 0);
    step(b1, 150);
    const b2 = makeRun(buildHazards(), b1.sled.x, 150);
    step(b2, 370);
    expect([...b1.sfx, ...b2.sfx].length).toBeGreaterThan(a.sfx.length);
  });
});

describe('TelegraphTracker as plain data', () => {
  test('snapshot is JSON-stable and carries no object references', () => {
    const tr = new TelegraphTracker();
    const hs = buildHazards();
    const sled = { x: 1000, vx: 650, speed: 650, grounded: true, landX: null };
    tr.update(1000, planTelegraph(hs, sled, 1e9, { nowMs: 1000 }));
    const snap = tr.snapshot();
    expect(JSON.parse(JSON.stringify(snap))).toEqual(snap);
    const tr2 = new TelegraphTracker();
    tr2.restore(JSON.parse(JSON.stringify(snap)));
    expect(tr2.snapshot()).toEqual(snap);
    expect(tr2.firstWarnMs(hs[0])).toBe(tr.firstWarnMs(hs[0]));
  });
  test('a hazard without a stable id is an error, never silently tracked by identity', () => {
    const tr = new TelegraphTracker();
    const h = { def: DEFS.packetSpike, cx: 1500, cy: 0, w: 10, h: 10, hit: false };
    expect(() => tr.update(0, planTelegraph([h], { x: 1000, vx: 650, speed: 650, grounded: true, landX: null }, 1e9))).toThrow(/stable id/);
  });
  test('forgetChunk drops only that chunk\'s entries', () => {
    const tr = new TelegraphTracker();
    const hs = buildHazards();
    tr.update(0, planTelegraph(hs, { x: 2000, vx: 650, speed: 650, grounded: true, landX: null }, 1e9, { nowMs: 0 }));
    tr.forgetChunk(0);
    expect(tr.lastArrivalMs(hs[0])).toBe(null);
    expect(tr.lastArrivalMs(hs[3])).not.toBe(null);
  });
});
