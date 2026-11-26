/**
 * #66 Crash Coach on the REAL RunScene (headless harness): a candidate tape runs hidden, silent and unranked, and a crash is
 * returned as DATA. These tests prove the hooks the EngineSimulator needs and that they leak nothing.
 */
import { jest } from '@jest/globals';
const H = await import('./takeoverHarness.js');
const { buildTakeoverDescriptor } = await import('../../src/systems/replay/Takeover.js');

jest.spyOn(Date, 'now').mockReturnValue(1_767_000_000_000);

const scripted = (t) => H.livePad({
  push: t < 400, variableHop: true, noAutoNudge: true,
  hop: t >= 300 && t <= 303, tuck: t > 500 && t < 540, tilt: t > 420 && t < 460 ? -1 : 0,
  pressed: { hop: t === 300 || t === 700 },
});
const REC = H.recordRun({ seed: 'A', padFor: scripted, fpEvery: 1 });
const TAPE = REC.tape;
const ORIGINAL_CRASH = REC.scene.registry.get(H.REG.LAST_CRASH);
const TOKEN = 'tok-1';

const coachScene = (tape, o) => H.coachSceneFor(tape, { token: TOKEN, ...(o || {}) });

describe('the recording used by these tests', () => {
  test('is a real crashing run whose crash tick is endTick + 1 (the crash tick records no checkpoint)', () => {
    expect(REC.scene.crashed).toBe(true);
    expect(REC.scene.simClock.tick).toBe(TAPE.endTick + 1);
    expect(ORIGINAL_CRASH).toBeTruthy();
  });
});

describe('coach simulation scene', () => {
  test('runs the tape hidden, unranked, with no recorder, no ghost riders, no HUD scene and no run lifecycle events', () => {
    const s = coachScene(TAPE);
    expect(s.coachSim).toMatchObject({ token: TOKEN, created: true });
    expect(s.unrankedPractice).toBe(true);
    expect(s.guestPractice).toBe(false);
    expect(s.takeover).toBeNull();
    expect(s.ghostRecorder).toBeNull();
    expect(s.ghostRiders).toEqual([]);
    expect(s.tapePlayer).toBeTruthy();
    expect(s.seed).toBe(TAPE.seed);
    expect(s.__calls.launch).toEqual([]); // UIScene is never launched
    expect(s.__events.map((e) => e[0])).not.toContain(H.EVT.RUN_START);
    expect(s._seeking).toBe(false); // the creation mute is released
    s.inputRouter = { poll: () => { throw new Error('a coach sim must never poll live input'); }, setEnabled() {} };
    expect(() => s.update(0, 8)).not.toThrow(); // update() is a no-op in coach mode
    expect(s.simClock.tick).toBe(0);
  });

  test('stopOnCrash returns the crash as data and matches the original run exactly', () => {
    const s = coachScene(TAPE);
    const r = s.seekTo(TAPE.endTick + 5000, { stopOnCrash: true, maxTicks: 1e9 });
    expect(r).toMatchObject({ done: true, crashed: true, crashTick: TAPE.endTick + 1, cause: ORIGINAL_CRASH.cause, hazardId: ORIGINAL_CRASH.hazardId });
    expect(s.tapePlayer.desync).toBeNull();
    expect(H.fp(s)).toBe(REC.fps.get(TAPE.endTick + 1));
  });

  test('without stopOnCrash a crash is still an abort (the takeover behaviour is unchanged)', () => {
    const s = coachScene(TAPE);
    const r = s.seekTo(TAPE.endTick + 5000, { maxTicks: 1e9 });
    expect(r).toMatchObject({ done: false, crashed: true });
    expect(r.crashTick).toBeUndefined();
  });

  test('a seek short of the crash is not a crash; onTick sees every tick', () => {
    const s = coachScene(TAPE);
    const seen = [];
    const r = s.seekTo(500, { stopOnCrash: true, maxTicks: 1e9, onTick: (sc) => seen.push(sc.simClock.tick) });
    expect(r).toMatchObject({ done: true, tick: 500 });
    expect(r.crashed).toBeUndefined();
    expect(seen.length).toBe(500);
    expect(seen[0]).toBe(1);
    expect(seen.at(-1)).toBe(500);
  });

  test('two simulations of the same tape agree at every fingerprint (a fresh scene each time)', () => {
    const a = coachScene(TAPE), b = coachScene(TAPE);
    for (const t of [120, 480, 900]) {
      a.seekTo(t, { maxTicks: 1e9 }); b.seekTo(t, { maxTicks: 1e9 });
      expect(H.fp(a)).toBe(H.fp(b));
      expect(H.fp(a)).toBe(REC.fps.get(t));
    }
  });

  test('leaks nothing: no registry result keys, no localStorage writes, no events during the whole simulation', () => {
    const ls = JSON.stringify(Object.entries(localStorage));
    const s = coachScene(TAPE);
    s.seekTo(TAPE.endTick + 5000, { stopOnCrash: true, maxTicks: 1e9 });
    for (const k of [H.REG.LAST_RECORD, H.REG.LAST_CRASH, H.REG.LAST_GHOST_TAPE, H.REG.LAST_TAKEOVER_TAPE, H.REG.TAKEOVER_NOTICE]) expect(s.registry.get(k)).toBeUndefined();
    expect(JSON.stringify(Object.entries(localStorage))).toBe(ls);
    expect(s.__events.map((e) => e[0])).not.toContain(H.EVT.CRASH);
    expect(s.__events.map((e) => e[0])).not.toContain(H.EVT.RUN_END);
    expect(s.__calls.start).toEqual([]); // never heads for GameOver / Title on its own
  });

  test('NEGATIVE CONTROL: a cancelled search that reaches create() late is refused, builds nothing and does not touch other handoffs', () => {
    const live = { cancelled: true };
    const s = coachScene(TAPE, { live, before: (sc) => { sc.registry.set(H.REG.TAKEOVER, 'primed-for-a-later-start'); sc.registry.set(H.REG.GUEST_PRACTICE, 'also-primed'); } });
    expect(s.coachSim.refused).toMatchObject({ reason: 'cancelled' });
    expect(s.sled).toBeUndefined();
    expect(s.registry.get(H.REG.TAKEOVER)).toBe('primed-for-a-later-start'); // not consumed by a hidden simulation
    expect(s.registry.get(H.REG.GUEST_PRACTICE)).toBe('also-primed');
  });

  test('a live coach simulation does not consume a takeover handoff primed for a later start either', () => {
    const s = coachScene(TAPE, { before: (sc) => sc.registry.set(H.REG.TAKEOVER, 'primed') });
    expect(s.registry.get(H.REG.TAKEOVER)).toBe('primed');
    expect(s.takeover).toBeNull();
    expect(s.coachSim.refused).toBeNull();
  });

  test('without scene data an ordinary create is not a coach simulation (no registry flag can make it one)', () => {
    const s = H.createRun(H.RunScene, H.REG, { seed: 'A' });
    expect(s.coachSim).toBeNull();
    expect(s.unrankedPractice).toBe(false);
  });

  test('NEGATIVE CONTROL: a tape of another build is refused (fail closed, no sled, nothing runs)', () => {
    const s = coachScene({ ...TAPE, rulesetId: 'some-other-ruleset' });
    expect(s.coachSim.refused).toMatchObject({ reason: 'ruleset-mismatch' });
    expect(s.coachSim.created).toBe(true);
    expect(s.sled).toBeUndefined();
    expect(s.seekTo(10, { stopOnCrash: true })).toMatchObject({ done: false });
    expect(s.unrankedPractice).toBe(true);
  });

  test('a candidate tape (checkpoints and trace cut at the branch) verifies its prefix and then runs on', () => {
    const { enumerateCandidates, applyCandidate } = H.coach;
    const crashTick = TAPE.endTick + 1;
    const list = enumerateCandidates(TAPE, { branchTick: crashTick - 360, crashTick, budget: 50 });
    expect(list.length).toBeGreaterThan(5);
    const cand = applyCandidate(TAPE, list[0]);
    const s = coachScene(cand);
    const r = s.seekTo(crashTick + 240, { stopOnCrash: true, maxTicks: 1e9 });
    expect(r.desync).toBeUndefined(); // the prefix reproduces the original checkpoints / trace
    expect(r.done).toBe(true);
    expect(s.tapePlayer.desync).toBeNull();
    // an edit INSIDE the verified prefix would be a desync: prove the verification can fail
    const tampered = { ...cand, checkpoints: cand.checkpoints.map((c, i) => (i === 0 ? [c[0], c[1] + 1, ...c.slice(2)] : c)) };
    const t = coachScene(tampered);
    expect(t.seekTo(crashTick + 240, { stopOnCrash: true, maxTicks: 1e9 }).desync).toBeTruthy();
  });
});
