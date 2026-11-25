// Issue #56: ghost tape encoding, replay input feed, and the per-course ghost library.
import fs from 'fs';
import { courseKey, quantizeTilt, encodePad, decodePad, GhostRecorder, TapePlayer, decodeTrace, tracePose,
  TRACE_EVERY, CHECKPOINT_EVERY, GHOST_TAPE_FORMAT } from '../../src/systems/ghost/GhostTape.js';
import { GhostLibrary, courseGhostRuns, tapeCompatible, MAX_GHOSTS_PER_COURSE } from '../../src/systems/ghost/GhostLibrary.js';
import { ghostTag } from '../../src/entities/GhostRider.js';

const pad = (o = {}) => ({ push: false, tilt: 0, variableHop: true, noAutoNudge: true, divebomb: false, corkscrew: false, tuck: false,
  brakeHeld: false, hop: false, reset: false, heli: 0, airBrake: false, parachute: false, pause: false,
  ...o, pressed: { hop: false, reset: false, pause: false, airBrake: false, parachute: false, confirm: false, ...(o.pressed || {}) } });

/** Fake scene whose sled moves along x = tick, angle = tick / 100. */
const scene = (tick) => ({ sled: { body: { position: { x: tick, y: -tick / 2 }, angle: tick / 100, velocity: { x: 1, y: 2 }, angularVelocity: 0.5 } },
  score: { getTotal: () => tick * 3 } });

function recordTape(ticks, inputAt, extra = {}) {
  const rec = new GhostRecorder({ seed: 'S1', biomeMask: 0, mode: 'normal', ...extra });
  for (let t = 1; t <= ticks; t++) { rec.input(t, inputAt(t)); rec.afterTick(t, scene(t)); }
  return rec.finish({ runId: `run-${extra.id || 1}`, distanceM: extra.distanceM ?? 100, score: 5, endedAt: 1 });
}

describe('ghost tape format', () => {
  test('course key is the exact seed plus the biome mask', () => {
    expect(courseKey('ABC', 0)).toBe('ABC|00000000');
    expect(courseKey('ABC', 0x2a)).toBe('ABC|0000002a');
    expect(courseKey('ABC', 1)).not.toBe(courseKey('ABD', 1));
  });

  test('every pad field round-trips; analog tilt is quantized to 1/127 and keyboard tilt is exact', () => {
    const p = pad({ push: true, tuck: true, brakeHeld: true, heli: -1, tilt: -1, pressed: { hop: true, confirm: true } });
    const d = decodePad(...encodePad(p));
    for (const k of ['push', 'tuck', 'brakeHeld', 'variableHop', 'noAutoNudge', 'heli', 'tilt']) expect(d[k]).toBe(p[k]);
    expect(d.pressed).toEqual(p.pressed);
    expect(quantizeTilt(0.5)).toBe(Math.round(0.5 * 127) / 127);
    expect(decodePad(...encodePad(pad({ tilt: quantizeTilt(0.3) }))).tilt).toBe(quantizeTilt(0.3));
  });

  test('inputs are stored only on change; edges replay on exactly their tick', () => {
    const tape = recordTape(300, (t) => pad({ push: t < 100, pressed: { hop: t === 150 } }));
    expect(tape.format).toBe(GHOST_TAPE_FORMAT);
    expect(tape.inputs.length).toBe(4); // push on, push off, hop edge, edge cleared
    const player = new TapePlayer(tape);
    const fed = Array.from({ length: 300 }, (_, i) => player.padAt(i + 1));
    expect(fed.filter((p) => p.pressed.hop).length).toBe(1);
    expect(fed[149].pressed.hop).toBe(true);
    expect(fed[98].push).toBe(true);
    expect(fed[99].push).toBe(false);
  });

  test('checkpoints catch a replay that drifts, and pass an exact one', () => {
    const tape = recordTape(600, () => pad());
    expect(tape.checkpoints.length).toBe(600 / CHECKPOINT_EVERY);
    const ok = new TapePlayer(tape);
    for (let t = 1; t <= 600; t++) ok.check(t, scene(t));
    expect(ok.desync).toBeNull();
    expect(ok.checked).toBe(5);
    const bad = new TapePlayer(tape);
    for (let t = 1; t <= 600; t++) bad.check(t, scene(t === 360 ? t + 1e-9 : t));
    expect(bad.desync?.tick).toBe(360);
  });

  test('trace gives the pose at any tick, interpolated, and nothing past the run', () => {
    const tape = recordTape(400, () => pad());
    const trace = decodeTrace(tape);
    expect(trace.length).toBe((400 / TRACE_EVERY) * 3);
    expect(tracePose(trace, 40).x).toBeCloseTo(40, 3);
    expect(tracePose(trace, 42).x).toBeCloseTo(42, 3);
    expect(tracePose(trace, 400)).not.toBeNull();
    expect(tracePose(trace, 405)).toBeNull();
    expect(JSON.stringify(tape).length).toBeLessThan(8000);
  });
});

describe('ghost library', () => {
  test('a course keeps Latest and Best; one run in both roles is one ghost', async () => {
    const lib = new GhostLibrary();
    await lib.saveRun(recordTape(80, () => pad(), { id: 1, distanceM: 100 }));
    expect(courseGhostRuns(lib.course('S1', 0))).toEqual([{ runId: 'run-1', roles: ['best', 'latest'] }]);
    await lib.saveRun(recordTape(80, () => pad(), { id: 2, distanceM: 50 }));
    expect(courseGhostRuns(lib.course('S1', 0))).toEqual([{ runId: 'run-1', roles: ['best'] }, { runId: 'run-2', roles: ['latest'] }]);
    await lib.saveRun(recordTape(80, () => pad(), { id: 3, distanceM: 100 })); // tie keeps the earlier best
    expect(lib.course('S1', 0).best).toBe('run-1');
    expect(await lib.getTape('run-2')).toBeNull(); // no role left: tape collected
  });

  test('favorites pin runs, never exceed five ghosts per course, and survive Latest/Best changes', async () => {
    const lib = new GhostLibrary();
    for (let i = 1; i <= 4; i++) {
      await lib.saveRun(recordTape(80, () => pad(), { id: i, distanceM: i }));
      await lib.setFavorite('S1', 0, i - 1, `run-${i}`);
    }
    await lib.saveRun(recordTape(80, () => pad(), { id: 9, distanceM: 99 }));
    const runs = courseGhostRuns(lib.course('S1', 0));
    expect(runs.length).toBeLessThanOrEqual(MAX_GHOSTS_PER_COURSE);
    // Only three favorite slots: pinning a fourth (slot 3) is refused.
    expect(runs).toEqual([{ runId: 'run-9', roles: ['best', 'latest'] }, { runId: 'run-1', roles: ['fav0'] },
      { runId: 'run-2', roles: ['fav1'] }, { runId: 'run-3', roles: ['fav2'] }]);
    expect(await lib.getTape('run-4')).toBeNull(); // was Latest and Best, now nothing: collected
    expect(await lib.getTape('run-1')).not.toBeNull(); // pinned favorites are never collected
  });

  test('P1: favorite selector refuses foreign seed and biome course tapes',async()=>{
    const lib=new GhostLibrary();
    const local=recordTape(80,()=>pad(),{id:'native',seed:'S1',biomeMask:0});
    const wrongSeed=recordTape(80,()=>pad(),{id:'other-seed',seed:'S2',biomeMask:0});
    const wrongMask=recordTape(80,()=>pad(),{id:'other-mask',seed:'S1',biomeMask:7});
    for(const tape of [local,wrongSeed,wrongMask])await lib.saveRun(tape);
    expect(await lib.setFavorite('S1',0,0,wrongSeed.runId)).toBeNull();
    expect(await lib.setFavorite('S1',0,1,wrongMask.runId)).toBeNull();
    expect(lib.course('S1',0).favorites).toEqual([null,null,null]);
    expect(await lib.setFavorite('S1',0,2,local.runId)).not.toBeNull();
    expect((await lib.ghostsFor('S1',0)).map(x=>x.runId)).toEqual([local.runId]);
  });

  test('P1: stored corrupted foreign course references never draw in original course',async()=>{
    const lib=new GhostLibrary();
    const local=recordTape(80,()=>pad(),{id:'native',seed:'S1',biomeMask:0});
    const foreign=recordTape(80,()=>pad(),{id:'foreign',seed:'S2',biomeMask:0});
    await lib.saveRun(local);await lib.saveRun(foreign);
    lib.course('S1',0).favorites[1]=foreign.runId; // simulated stale/corrupt IDB role
    expect((await lib.ghostsFor('S1',0)).map(x=>x.runId)).toEqual([local.runId]);
    expect((await lib.ghostsFor('S1',0,{}, {simRevision:local.simRevision})).map(x=>x.runId))
      .toEqual([local.runId]);
  });

  test('P1: a duplicate run ID from another course cannot overwrite the first saved tape',async()=>{
    const lib=new GhostLibrary();
    const original=recordTape(80,()=>pad(),{id:'same',seed:'S1',biomeMask:0,distanceM:100});
    const foreign=recordTape(80,()=>pad(),{id:'same',seed:'S2',biomeMask:1,distanceM:9999});
    await lib.saveRun(original);
    expect(await lib.saveRun(foreign)).toBeNull();
    expect(lib.course('S2',1)).toBeNull();
    expect(await lib.getTape(original.runId)).toEqual(original);
    expect((await lib.ghostsFor('S1',0)).map(x=>x.runId)).toEqual([original.runId]);
  });

  test('P2: only the five known role switches can mutate course preferences',async()=>{
    const lib=new GhostLibrary();
    await lib.saveRun(recordTape(80,()=>pad(),{id:'same'}));
    expect(await lib.setShow('S1',0,'fav3',false)).toBeNull();
    expect(await lib.setShow('S1',0,'__proto__',false)).toBeNull();
    expect(lib.course('S1',0).show).toBeUndefined();
    expect(await lib.setShow('S1',0,'fav2',false)).not.toBeNull();
  });

  test('different seeds or biome masks are different courses; Gym runs are never stored', async () => {
    const lib = new GhostLibrary();
    await lib.saveRun(recordTape(80, () => pad(), { id: 1, biomeMask: 3 }));
    expect(lib.course('S1', 0)).toBeNull();
    expect(lib.course('S1', 3)).not.toBeNull();
    expect(await lib.saveRun(recordTape(80, () => pad(), { id: 2, mode: 'gym' }))).toBeNull();
  });

  test('ghostsFor honours per-role switches and skips incompatible tapes', async () => {
    const lib = new GhostLibrary();
    await lib.saveRun(recordTape(80, () => pad(), { id: 1, distanceM: 100 }));
    await lib.saveRun(recordTape(80, () => pad(), { id: 2, distanceM: 10 }));
    expect((await lib.ghostsFor('S1', 0)).length).toBe(2);
    expect((await lib.ghostsFor('S1', 0, { latest: false })).map((g) => g.runId)).toEqual(['run-1']);
    lib.tapes.get('run-1').physicsVersion = 999;
    expect(tapeCompatible(lib.tapes.get('run-1'))).toBe(false);
    expect((await lib.ghostsFor('S1', 0)).map((g) => g.runId)).toEqual(['run-2']);
  });

  test('other-revision or unstamped legacy ghosts are hidden only from current-terrain display', async () => {
    const lib = new GhostLibrary();
    const old = recordTape(120, () => pad(), { id: 'old', simRevision: 5, distanceM: 350 });
    const current = recordTape(120, () => pad(), { id: 'current', simRevision: 6, distanceM: 75 });
    const legacy = recordTape(120, () => pad(), { id: 'legacy', distanceM: 5 });
    await lib.saveRun(old);
    await lib.setFavorite('S1', 0, 0, old.runId);
    await lib.saveRun(current);
    await lib.saveRun(legacy);
    await lib.setFavorite('S1', 0, 1, legacy.runId);
    // Direct tape/replay APIs stay backward compatible: no blanket rejection
    // of historical tape input, no mutated headers or deleted stored inputs.
    expect(tapeCompatible(old)).toBe(true);
    expect(tapeCompatible(legacy)).toBe(true);
    expect((await lib.getTape(old.runId)).inputs).toEqual(old.inputs);
    expect(new TapePlayer(old).padAt(1)).toEqual(new TapePlayer(current).padAt(1));
    const display6 = await lib.ghostsFor('S1', 0, {}, { simRevision: 6 });
    expect(display6.map(({runId}) => runId)).toEqual([current.runId]);
    const display5 = await lib.ghostsFor('S1', 0, {}, { simRevision: 5 });
    expect(display5.map(({runId}) => runId)).toEqual([old.runId]);
    expect((await lib.ghostsFor('S1', 0, {}, { simRevision: 0 })).length).toBe(0);
    // Existing tools that omit the fourth display-context argument retain
    // their legacy compatibility behavior.
    expect((await lib.ghostsFor('S1', 0)).map(({runId}) => runId)).toContain(legacy.runId);
  });

  test('a fresh shorter revision-6 run becomes Best over stale v5; legacy tape survives for replay', async () => {
    const lib = new GhostLibrary();
    const oldBest = recordTape(120, () => pad(), { id: 'oldbest', simRevision: 5, distanceM: 9000 });
    const oldLatest = recordTape(120, () => pad(), { id: 'oldlatest', simRevision: 5, distanceM: 1 });
    const fresh = recordTape(120, () => pad(), { id: 'new', simRevision: 6, distanceM: 15 });
    await lib.saveRun(oldBest);
    await lib.saveRun(oldLatest);
    await lib.saveRun(fresh);
    expect(lib.course('S1',0)).toMatchObject({best:fresh.runId,latest:fresh.runId,bestDistanceM:15});
    expect((await lib.ghostsFor('S1',0,{}, {simRevision:6})).map(({runId}) => runId)).toEqual([fresh.runId]);
    // Displaced legacy tapes are retained, even if no current course role
    // refers to them. Player-initiated historical replay remains possible.
    expect((await lib.getTape(oldBest.runId)).inputs).toEqual(oldBest.inputs);
    expect((await lib.getTape(oldLatest.runId)).inputs).toEqual(oldLatest.inputs);
    const betterCurrent = recordTape(120, () => pad(), { id: 'betternew', simRevision: 6, distanceM: 20 });
    await lib.saveRun(betterCurrent);
    expect(lib.course('S1',0).best).toBe(betterCurrent.runId);
    expect(await lib.getTape(fresh.runId)).toBeNull(); // old same-revision GC still works
  });

  test('RunScene obtains the revision from RULESET_KEY, stamps new tape headers, and gates display', () => {
    const run = fs.readFileSync('src/scenes/RunScene.js','utf8');
    expect(run).toMatch(/simRevision:\s*this\.registry\.get\(RULESET_KEY\)/);
    expect(run).toMatch(/lib\.ghostsFor\(this\.seed, this\.biomeMask, show, \{ simRevision \}\)/);
    expect(run).toMatch(/loadedRevision === SIM_REVISION/);
  });

  test('ghost tags: best leads, merged roles read BEST+LAST', () => {
    expect(ghostTag(['latest', 'best'])).toEqual({ text: 'BEST+LAST', color: 'amber' });
    expect(ghostTag(['fav1'])).toEqual({ text: 'FAV B', color: 'magenta' });
  });

  test('ghosts stay out of the simulation: no Matter body, recorded beside the RunRecord', () => {
    const rider = fs.readFileSync('src/entities/GhostRider.js', 'utf8');
    expect(rider).not.toMatch(/scene\.matter|\.emit\(|\.bonus\(|getTotal/);
    const run = fs.readFileSync('src/scenes/RunScene.js', 'utf8');
    expect(run).toMatch(/record\.ledgerHash = SaveStore\.computeLedgerHash\(record\);\n\s+this\.registry\.set\(REG\.LAST_RECORD, record\);\n\s+this\._saveGhostTape\(record\);/);
  });
});
