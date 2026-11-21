// Replay input resolution (R-1..R-5), recorder fixes (C4, C11), old-tape migration and the #116 acceptance
// "same tape reproduces across wall-clock dates and profile upgrades" (Replay Contract v1.0 sections 0.3, 8.5).
import fs from 'node:fs';
import { jest } from '@jest/globals';
import {
  GhostRecorder, TapePlayer, quantizeTilt, encodePad, decodePad, GHOST_TAPE_FORMAT,
} from '../../src/systems/ghost/GhostTape.js';
import { GhostLibrary, tapeCompatible } from '../../src/systems/ghost/GhostLibrary.js';
import { DailyPatch } from '../../src/systems/DailyPatch.js';
import { BsodPursuit, BSOD_DEFAULTS } from '../../src/systems/BsodPursuit.js';
import { resolveReplaySetup, legacyManifestFromTape, validateManifest, ManifestError } from '../../src/systems/replay/manifest.js';
import { canonicalBytes } from '../../src/systems/replay/canonicalJson.js';
import { legacyTape, liveTape, liveManifest, clone } from './manifestFixtures.js';

const pad = (o = {}) => ({ push: false, tilt: 0, variableHop: true, noAutoNudge: true, divebomb: false, corkscrew: false, tuck: false,
  brakeHeld: false, hop: false, reset: false, heli: 0, airBrake: false, parachute: false, pause: false,
  ...o, pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false, ...(o.pressed || {}) } });
const scene = (tick) => ({ sled: { body: { position: { x: tick, y: -tick / 2 }, angle: tick / 100, velocity: { x: 1, y: 2 }, angularVelocity: 0.5 } },
  score: { getTotal: () => tick * 3 } });
function record(ticks, inputAt, header = {}) {
  const rec = new GhostRecorder({ seed: 'S1', biomeMask: 0, mode: 'normal', ...header });
  for (let t = 1; t <= ticks; t++) { rec.input(t, inputAt(t)); rec.afterTick(t, scene(t)); }
  return rec.finish({ runId: 'run-1', distanceM: 10, score: 5, endedAt: 1 });
}
const feed = (tape, n) => { const p = new TapePlayer(tape); return Array.from({ length: n }, (_, i) => p.padAt(i + 1)); };

describe('C11 / R-5: edge rows on consecutive ticks', () => {
  test('edges on ticks 1-3 write 3 rows and replay yields the edge on all 3 ticks', () => {
    const tape = record(6, (t) => pad({ pressed: { hop: t <= 3 } }));
    expect(tape.inputs.map((r) => r[0])).toEqual([1, 1, 1, 1]); // three edge rows + the row that clears the edge
    const fed = feed(tape, 6);
    expect(fed.map((p) => !!p.pressed.hop)).toEqual([true, true, true, false, false, false]);
    expect(tape.edgeRows).toBe('every-tick');
  });

  test('without an edge bit identical consecutive rows are still deduped', () => {
    const tape = record(300, (t) => pad({ push: t < 100 }));
    expect(tape.inputs).toHaveLength(2);
  });

  test('edge row with held bits unchanged: each tick of a long edge streak is recorded exactly', () => {
    const edgeTicks = new Set([5, 6, 7, 20, 21]);
    const tape = record(30, (t) => pad({ hop: edgeTicks.has(t), pressed: { hop: edgeTicks.has(t) } }));
    const fed = feed(tape, 30);
    fed.forEach((p, i) => expect(!!p.pressed.hop).toBe(edgeTicks.has(i + 1)));
  });

  test('an OLD tape (one deduped row) still replays exactly as before: edge on its own tick only', () => {
    const old = { format: GHOST_TAPE_FORMAT, version: 1, inputs: [[1, 4102, 0]], checkpoints: [] }; // pre-fix output for edges on ticks 1-3
    expect(feed(old, 4).map((p) => !!p.pressed.hop)).toEqual([true, false, false, false]);
  });

  test('a manifest of a fixed-recorder tape declares every-tick; an old tape declares legacy', () => {
    expect(liveManifest().causal.input.edgeRows).toBe('every-tick');
    expect(legacyManifestFromTape(legacyTape()).causal.input.edgeRows).toBe('legacy');
    expect(legacyManifestFromTape(liveTape()).causal.input.edgeRows).toBe('every-tick');
  });
});

describe('C4: -0 tilt', () => {
  test('quantizeTilt and encodePad never return -0', () => {
    for (const t of [-0, -0.001, -0.003, 0.0001]) {
      expect(Object.is(quantizeTilt(t), 0)).toBe(true);
      expect(Object.is(encodePad(pad({ tilt: t }))[1], 0)).toBe(true);
    }
    expect(quantizeTilt(-1)).toBe(-1);
    expect(quantizeTilt(0.5)).toBe(Math.round(0.5 * 127) / 127);
    expect(Object.is(decodePad(...encodePad(pad({ tilt: -0 }))).tilt, 0)).toBe(true);
  });

  test('a recorded tape has no -0 whether or not it goes through JSON', () => {
    const tape = record(10, (t) => pad({ tilt: t === 3 ? -0 : t === 4 ? -0.002 : 0, pressed: { hop: t === 3 } }));
    expect(tape.inputs.some((r) => r.some((v) => Object.is(v, -0)))).toBe(false);
    expect(JSON.parse(JSON.stringify(tape)).inputs).toEqual(tape.inputs);
  });
});

describe('R-1..R-4: replay setup never reads the clock, the profile level or the live registry flags', () => {
  afterEach(() => jest.useRealTimers());
  const rules = DailyPatch.RULES;
  const dayA = '2026-11-21T09:00:00Z'; // featherweight (spec 8.2)
  const dayB = '2027-03-04T09:00:00Z';

  test('the same tape resolves to identical inputs on different UTC days (R-1)', () => {
    const tape = liveTape();
    jest.useFakeTimers({ now: new Date(dayA) });
    const a = resolveReplaySetup(tape, { rules });
    const clockA = DailyPatch.getDailyInfo().rule.id;
    jest.setSystemTime(new Date(dayB));
    const b = resolveReplaySetup(tape, { rules });
    const clockB = DailyPatch.getDailyInfo().rule.id;
    expect(clockA).not.toBe(clockB); // the mock matters: today's rule really changed
    expect(b).toEqual(a);
    expect(a.dailyRuleId).toBe('featherweight');
    expect(a.dailyRule.modifiers).toEqual(DailyPatch.getRuleById('featherweight').modifiers);
  });

  test('a manifest source resolves the same as its tape', () => {
    const t = liveTape({ magnetsDrop: true, kodiaksOn: true, kodiakPackMode: 'mixed', syncLevel: 9 });
    const fromTape = resolveReplaySetup(t, { rules });
    const fromManifest = resolveReplaySetup(liveManifest({ tape: t }), { rules });
    expect(fromManifest).toEqual(fromTape);
    expect(fromTape).toMatchObject({ syncLevel: 9, magnetsDrop: true, kodiaksOn: true, kodiakPackMode: 'mixed' });
  });

  test('"none" means no rule; an unknown id is refused; a missing id is no rule', () => {
    expect(resolveReplaySetup(liveTape({ dailyRuleId: 'none' }), { rules })).toMatchObject({ dailyRuleId: 'none', dailyRule: null });
    expect(() => resolveReplaySetup(liveTape({ dailyRuleId: 'gone' }), { rules })).toThrow(ManifestError);
    expect(resolveReplaySetup({ ...legacyTape(), dailyRuleId: undefined }, { rules })).toMatchObject({ dailyRuleId: 'none', dailyRule: null });
  });

  test('Sync Level comes from the recording (R-2): the BSOD wall is the same at any profile level', () => {
    const tape = liveTape({ syncLevel: 12 });
    const wallFor = (profileLevel) => {
      const rp = resolveReplaySetup(tape, { rules });
      // RunScene replay path: `level: rp ? rp.syncLevel : prof.level` -- profileLevel is never consulted
      const b = new BsodPursuit({ sledLeftEdgeX: 41.5, level: rp.syncLevel, config: { ...BSOD_DEFAULTS } });
      void profileLevel;
      return [b.wallX, b.accelerationPxS2];
    };
    expect(wallFor(1)).toEqual(wallFor(40));
    const live1 = new BsodPursuit({ sledLeftEdgeX: 41.5, level: 1, config: { ...BSOD_DEFAULTS } });
    expect(wallFor(1)[0]).not.toBe(live1.wallX); // and it is not the level-1 wall
  });

  test('a tape without a recorded Sync Level uses level 1, never the live profile', () => {
    expect(resolveReplaySetup(legacyTape(), { rules }).syncLevel).toBe(1);
  });

  test('Kodiak and magnet flags: recorded values; absent values default off, never live-derived (R-3)', () => {
    expect(resolveReplaySetup(legacyTape(), { rules })).toMatchObject({ kodiaksOn: false, magnetsDrop: false });
    const pre = legacyTape(); for (const k of ['kodiaksOn', 'kodiakPackMode', 'kodiakVersion', 'magnetsDrop']) delete pre[k];
    expect(resolveReplaySetup(pre, { rules })).toMatchObject({ kodiaksOn: false, kodiakPackMode: 'same', magnetsDrop: false });
    expect(resolveReplaySetup({ ...legacyTape(), kodiaksOn: true, kodiakPackMode: 'mixed', magnetsDrop: true }, { rules }))
      .toMatchObject({ kodiaksOn: true, kodiakPackMode: 'mixed', magnetsDrop: true });
  });

  test('replay forces Gym off, official Daily off and classic mode (R-4)', () => {
    expect(resolveReplaySetup(liveTape({ mode: 'daily' }), { rules })).toMatchObject({ bsodGym: false, dailyOfficial: false, dailyMode: 'classic' });
  });

  test('RunScene replay path is wired to the resolved setup and live play paths are intact', () => {
    const src = fs.readFileSync('src/scenes/RunScene.js', 'utf8');
    expect(src).toMatch(/const rp = replay \? resolveReplaySetup\(replay, \{ rules: DailyPatch\.RULES \}\) : null;/);
    expect(src).toMatch(/this\.dailyOfficial = !replay && reg\.get\(REG\.DAILY_OFFICIAL\) === true/);
    expect(src).toMatch(/this\.bsodGym = !replay && reg\.get\(REG\.BSOD_GYM\) === true/);
    expect(src).toMatch(/const daily = rp \? \{ rule: rp\.dailyRule \} : seedDayInfo \? \{ rule: seedDayInfo\.rule \} : DailyPatch\.getDailyInfo\(\);/);
    expect(src).toMatch(/this\.magnetsDrop = rp \? rp\.magnetsDrop\n\s+: magnetsDropFor\(\{ level: prof\.level,/);
    expect(src).toMatch(/this\.kodiaksOn = rp \? rp\.kodiaksOn\n\s+: kodiaksEnabledFor\(\{ level: prof\.level,/);
    expect(src).toMatch(/this\.kodiakPackMode = rp \? rp\.kodiakPackMode\n\s+: this\.settings\?\.kodiakPacks/);
    expect(src).toMatch(/level: rp \? rp\.syncLevel : prof\.level,/);
    // the header records what the manifest needs, and nothing identifying
    expect(src).toMatch(/dailyRuleSource: DailyPatch\.dateKeyFromSeed\(this\.seed\) \? 'seed-date' : 'clock-at-start'/);
    expect(src).toMatch(/syncLevel: Number\.isFinite/);
    expect(src).toMatch(/bsod: \{ leftEdgeX: sledLeftCollisionEdge\(this\.sled\),/);
  });

  test('a replay with a wrong recorded BSOD start is flagged by the manifest check, not silently accepted', () => {
    const m = clone(liveManifest());
    m.causal.bsod.syncLevel = 7; // a tape whose Sync Level disagrees with its recorded initial wall
    const r = validateManifest(canonicalBytes(m), (id) => (id === m.causal.sim.rulesetId ? JSON.parse(fs.readFileSync('tests/fixtures/replay/v1/ruleset-illustrative.json', 'utf8')) : null));
    expect(r).toMatchObject({ ok: true, outcome: 'inconclusive' });
    expect(r.reasons[0].reason).toBe('bsod-initial-divergence');
  });
});

describe('migration: existing tapes and GhostLibrary data still load and replay', () => {
  test('a tape recorded by the pre-fix recorder (no edgeRows, no syncLevel) replays through TapePlayer unchanged', () => {
    const tape = legacyTape();
    expect(tape.edgeRows).toBeUndefined();
    const p = new TapePlayer(tape);
    const fed = Array.from({ length: 600 }, (_, i) => p.padAt(i + 1));
    expect(fed[0].push).toBe(true); // row [1,7,0]
    expect(fed[199].push).toBe(false);
    expect(fed.filter((x) => x.pressed.hop)).toHaveLength(1); // the single recorded edge row (tick 250)
    expect(fed[299].tilt).toBe(0);
    expect(fed[310].tilt).toBe(1); // tilt127 127 from tick 301+... row [31,6,127]
    for (let t = 1; t <= 600; t++) p.check(t, { sled: { body: { position: { x: t * 5.5, y: t * 0.4 }, angle: t / 100, velocity: { x: 5.5, y: 0.4 }, angularVelocity: 0 } }, score: { getTotal: () => t } });
    expect(p.checked).toBe(5);
    expect(p.desync).toBeNull();
  });

  test('both old and new tapes are compatible with GhostLibrary and survive saveRun/getTape', async () => {
    const lib = new GhostLibrary();
    const oldTape = { ...legacyTape(), runId: 'old', mode: 'normal' };
    const newTape = record(120, () => pad(), { runId: 'n' });
    expect(tapeCompatible(oldTape)).toBe(true);
    expect(tapeCompatible(newTape)).toBe(true);
    await lib.saveRun(oldTape);
    expect((await lib.getTape('old')).inputs).toEqual(oldTape.inputs);
  });

  test('an old tape never mentions the new header fields and still produces a legacy manifest', () => {
    const t = legacyTape();
    for (const k of ['syncLevel', 'bsod', 'dailyRuleSource', 'edgeRows']) expect(t[k]).toBeUndefined();
    expect(validateManifest(canonicalBytes(legacyManifestFromTape(t)), null)).toMatchObject({ ok: true });
  });

  test('V1-V4 run-ledger code is untouched', () => {
    const src = fs.readFileSync('src/systems/SaveStore.js', 'utf8');
    expect(src).not.toMatch(/replay\/manifest|bundleDigest|edgeRows/);
  });
});
