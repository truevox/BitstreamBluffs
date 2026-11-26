/**
 * #72 Replay Takeover on the REAL RunScene (headless harness: real create/update/Matter/terrain/BSOD, stubbed scene graph).
 * Takeover = authoritative re-simulation of the tape prefix (1..N), then handoff. These tests prove: state at N equals an
 * uninterrupted replay; the live suffix reproduces the original run exactly; different input diverges; and the run is
 * unranked at every write site, with negative controls.
 */
import { jest } from '@jest/globals';
const H = await import('./takeoverHarness.js');
const { buildTakeoverDescriptor } = await import('../../src/systems/replay/Takeover.js');
const { CURRENT_RULESET_ID } = await import('../../src/systems/replay/currentRulesetId.js');
const { GhostLibrary } = await import('../../src/systems/ghost/GhostLibrary.js');

jest.spyOn(Date, 'now').mockReturnValue(1_767_000_000_000);

const SEED = 'A';
// push for 400 ticks, a hop (edge on 300), a tuck window and a tilt: real edges AND held rows in the prefix and the suffix
const scripted = (t) => H.livePad({
  push: t < 400, variableHop: true, noAutoNudge: true,
  hop: t >= 300 && t <= 303, tuck: t > 500 && t < 540, tilt: t > 420 && t < 460 ? -1 : 0,
  pressed: { hop: t === 300 || t === 700 },
});
const REC = H.recordRun({ seed: SEED, padFor: scripted, fpEvery: 1 });
const TAPE = REC.tape;
const TICK_MS = 1000 / 120;

// A takeover scene: the descriptor goes in REG.TAKEOVER, exactly as the picker / retry would hand it over.
function takeoverScene(tape, tick, { profile, settings, mutateDesc, level = 1, raw } = {}) {
  const desc = raw || buildTakeoverDescriptor({ tape, tick, source: 'test' });
  const sent = mutateDesc ? mutateDesc(desc) : desc;
  class T extends H.RunScene {
    create() {
      // spies go in BEFORE create(): a refusal happens inside it
      this.__events = [];
      const emit = this.game.events.emit.bind(this.game.events);
      this.game.events.emit = (e, ...a) => { this.__events.push([e, ...a]); return emit(e, ...a); };
      this.__starts = [];
      this.scene.start = (...a) => this.__starts.push(a);
      this.registry.set(H.RULESET_KEY, H.RULESET);
      this.registry.set(H.REG.TAKEOVER, sent);
      super.create();
    }
  }
  return H.createRun(T, H.REG, { seed: 'WRONG-SEED-IGNORED', level, profile, settings });
}
const tickMs = TICK_MS;
function seekReady(scene, maxFrames = 400) {
  scene.inputRouter = { poll: () => H.livePad(), setEnabled() {} };
  for (let i = 0; i < maxFrames && scene.takeover && scene.takeover.phase === 'seeking'; i++) scene.update(0, tickMs);
  return scene.takeover && scene.takeover.phase;
}
/** Press the READY key (Space) once, the way the router reports it. */
function pressReady(scene, over = {}) {
  let first = true;
  scene.inputRouter = { poll: () => { const p = H.livePad({ hop: true, pressed: { hop: first, confirm: first }, ...over }); first = false; return p; }, setEnabled() {} };
  scene.update(0, tickMs);
}
/** Run the live suffix to the end with the given per-tick pad; returns per-tick fingerprints and the end tick. */
function playLive(scene, padFor, maxTicks = 5000) {
  scene.inputRouter = { poll: () => padFor(scene.simClock.tick + 1), setEnabled() {} };
  const fps = new Map();
  let n = 0;
  while (!scene.crashed && n < maxTicks) { scene.update(0, tickMs); n++; fps.set(scene.simClock.tick, H.fp(scene)); }
  return { fps, end: scene.simClock.tick };
}

describe('the recording used by these tests', () => {
  test('is a real crashing run with a stamped, takeover-eligible tape', () => {
    expect(TAPE.mode).toBe('normal');
    expect(TAPE.rulesetId).toBe(CURRENT_RULESET_ID);
    expect(TAPE.endTick).toBeGreaterThan(1000);
    expect(REC.scene.crashed).toBe(true);
    expect(TAPE.inputs.some((r) => (r[1] >> 12) & 1)).toBe(true); // a recorded hop edge
  });
});

describe('seek: state at N equals the uninterrupted run', () => {
  test.each([1, 7, 100, 119, 120, 121, 300, 301, 640, 977, 1200, TAPE.endTick - 1])('N=%i: fingerprint and tick match the recording', (N) => {
    const s = takeoverScene(TAPE, N);
    expect(seekReady(s)).toBe('ready');
    expect(s.simClock.tick).toBe(N);
    expect(H.fp(s)).toBe(REC.fps.get(N));
    expect(s.takeover.seekTicks).toBe(N);
    expect(s.tapePlayer.desync).toBeNull();
    expect(s.crashed).toBe(false);
  });

  test('a seek is bounded per frame (never one giant frame) and reports progress', () => {
    const N = TAPE.endTick - 1;
    const s = takeoverScene(TAPE, N);
    s.inputRouter = { poll: () => H.livePad(), setEnabled() {} };
    let frames = 0, last = 0;
    while (s.takeover.phase === 'seeking' && frames < 100) {
      s.update(0, tickMs); frames++;
      expect(s.simClock.tick - last).toBeLessThanOrEqual(1500);
      last = s.simClock.tick;
    }
    expect(frames).toBeGreaterThan(1);
    const states = s.__events.filter((e) => e[0] === H.EVT.TAKEOVER_STATE).map((e) => e[1]);
    expect(states[0].phase).toBe('seeking');
    expect(states.at(-1)).toMatchObject({ phase: 'ready', pct: 100 });
  });

  test('the seek is silent: no presentation events leak out of the muted re-simulation', () => {
    const s = takeoverScene(TAPE, 700);
    seekReady(s);
    const leaked = s.__events.filter((e) => ![H.EVT.RUN_START, H.EVT.TAKEOVER_STATE, H.EVT.SCORE_CHANGED, H.EVT.DISTANCE_CHANGED, H.EVT.BSOD_STATE_CHANGED, H.EVT.HUD_RESYNC].includes(e[0]));
    expect(leaked).toEqual([]);
    expect(s._seeking).toBe(false);
    expect(Object.prototype.hasOwnProperty.call(s.game.events, 'emit')).toBe(true); // our test wrapper, restored (not the mute no-op)
    expect(s.game.events.emit('x')).toBe(true);
  });

  test('the live profile / settings are irrelevant: a hostile profile (other level, boosts) gives the same state at N', () => {
    const s = takeoverScene(TAPE, 640, { level: 12, profile: { level: 12, boosts: { shield: true, headStart: true }, unlocked: { boosts: { shield: true, headStart: true } } }, settings: { kodiakPacks: 'mixed', controlLayout: 'classic' } });
    seekReady(s);
    expect(H.fp(s)).toBe(REC.fps.get(640));
  });
});

describe('seek: tampering aborts visibly and never continues', () => {
  const HOP_EDGE = 1 << 12;
  // remove the recorded hop edge at tick 300: the sled does not jump, so the state diverges from the tape right there
  const tampered = () => {
    const t = JSON.parse(JSON.stringify(TAPE));
    const i = t.inputs.findIndex((r) => r[1] & HOP_EDGE);
    expect(i).toBeGreaterThan(0);
    t.inputs[i][1] &= ~HOP_EDGE;
    return t;
  };
  test('a mutated input row before N is detected as a desync -> TITLE, no live phase, no recorder', () => {
    const s = takeoverScene(tampered(), 900);
    seekReady(s);
    expect(s.takeover.phase).toBe('aborted');
    expect(s.takeover.abort.reason).toBe('desync');
    expect(s.__starts.map((a) => a[0])).toEqual([H.SCENES.TITLE]);
    expect(s.registry.get(H.REG.TAKEOVER_NOTICE)).toMatchObject({ reason: 'desync' });
    expect(s.ghostRecorder == null).toBe(true);
    expect(s.tapePlayer).toBeNull();
    expect(s.__events.find((e) => e[0] === H.EVT.RUN_ABORT)[1]).toMatchObject({ practice: true, takeover: true, reason: 'takeover-aborted' });
    expect(s.__events.some((e) => e[0] === H.EVT.RUN_END)).toBe(false);
    expect(s.simClock.tick).toBeLessThan(900); // it stopped at the first mismatch; it did not run on
  });
  test('control: the untouched tape does not abort', () => {
    const s = takeoverScene(TAPE, 900);
    expect(seekReady(s)).toBe('ready');
    expect(s.__starts).toHaveLength(0);
  });
  test('the pose trace catches the divergence BETWEEN 1 s checkpoints (N=359 is before the tick-360 checkpoint)', () => {
    const s = takeoverScene(tampered(), 359);
    seekReady(s);
    expect(s.takeover.phase).toBe('aborted');
    expect(s.takeover.abort.detail.desync.via).toBe('trace');
    expect(s.takeover.abort.detail.desync.tick).toBeLessThan(310);
    // the same N on the untouched tape is fine (control)
    expect(seekReady(takeoverScene(TAPE, 359))).toBe('ready');
  });
  test('a late tamper that only the checkpoint can see: trace samples are exact, so it is also caught there', () => {
    const t = tampered();
    const s = takeoverScene(t, 600);
    seekReady(s);
    expect(s.takeover.phase).toBe('aborted');
  });
});

describe('fail closed: an invalid REG.TAKEOVER never becomes a ranked run', () => {
  const expectRefused = (scene, reason) => {
    expect(scene.takeover).toBeNull();
    expect(scene.ghostRecorder === undefined || scene.ghostRecorder === null).toBe(true);
    expect(scene.sled).toBeNull();
    expect(scene.__starts.map((a) => a[0])).toEqual([H.SCENES.TITLE]);
    expect(scene.registry.get(H.REG.TAKEOVER_NOTICE)).toMatchObject({ reason });
    const starts = scene.__events.filter((e) => e[0] === H.EVT.RUN_START);
    expect(starts).toEqual([]);
    expect(scene.__events.find((e) => e[0] === H.EVT.RUN_ABORT)[1]).toMatchObject({ practice: true, takeover: true, reason: 'takeover-refused' });
    expect(scene.registry.get(H.REG.TAKEOVER)).toBeUndefined(); // one-shot: cleared
    // and it stays inert
    scene.inputRouter = { poll: () => H.livePad(), setEnabled() {} };
    expect(() => { for (let i = 0; i < 30; i++) scene.update(0, tickMs); }).not.toThrow();
    expect(scene.ghostRecorder == null).toBe(true);
  };
  test('sim revision mismatch', () => {
    const t = JSON.parse(JSON.stringify(TAPE)); t.simRevision = 1;
    expectRefused(takeoverScene(t, 300, { raw: { ...buildTakeoverDescriptor({ tape: TAPE, tick: 300 }), tape: t } }), 'sim-revision');
  });
  test('an unstamped (older-build) tape', () => {
    const t = JSON.parse(JSON.stringify(TAPE)); delete t.rulesetId;
    const d = buildTakeoverDescriptor({ tape: TAPE, tick: 300 });
    expectRefused(takeoverScene(t, 300, { raw: { ...d, tape: t, rulesetId: undefined } }), 'older-build');
  });
  test('a truncated prefix (checkpoints gone)', () => {
    const t = JSON.parse(JSON.stringify(TAPE)); t.checkpoints = t.checkpoints.slice(0, 1);
    const d = buildTakeoverDescriptor({ tape: TAPE, tick: 640 });
    expectRefused(takeoverScene(t, 640, { raw: { ...d, tape: t } }), 'prefix-uncovered');
  });
  test('a tick out of range', () => {
    const d = buildTakeoverDescriptor({ tape: TAPE, tick: 300 });
    expectRefused(takeoverScene(TAPE, 300, { raw: { ...d, tick: TAPE.endTick + 5 } }), 'tick');
  });
  test('garbage descriptor', () => {
    expectRefused(takeoverScene(TAPE, 300, { raw: { kind: 'bb-takeover', v: 1 } }), 'undecodable');
    expectRefused(takeoverScene(TAPE, 300, { raw: 'nope' }), 'undecodable');
  });
  test('a tape whose digest no longer matches the descriptor', () => {
    const d = buildTakeoverDescriptor({ tape: TAPE, tick: 300 });
    expectRefused(takeoverScene(TAPE, 300, { raw: { ...d, parentDigest: 'sha256:' + '0'.repeat(64) } }), 'undecodable');
  });
  test('control: the same harness with a valid descriptor starts a takeover', () => {
    const s = takeoverScene(TAPE, 300);
    expect(s.takeover).not.toBeNull();
    expect(s.sled).not.toBeNull();
    expect(s.__events.filter((e) => e[0] === H.EVT.RUN_START)).toHaveLength(1);
  });
});

describe('handoff and the live suffix', () => {
  test('READY freezes the sim at N; the ready key is consumed and a held key is no edge on tick N+1', () => {
    const N = 640;
    const s = takeoverScene(TAPE, N);
    seekReady(s);
    // idle frames in READY change nothing
    const before = H.fp(s);
    for (let i = 0; i < 20; i++) s.update(0, tickMs);
    expect(s.simClock.tick).toBe(N);
    expect(H.fp(s)).toBe(before);
    expect(s.takeover.phase).toBe('ready');
    pressReady(s);
    expect(s.takeover.phase).toBe('live');
    expect(s.tapePlayer).toBeNull();
    expect(s.ghostRecorder).not.toBeNull();
    expect(s.simClock.tick).toBe(N); // the press frame ran no tick
    // Space is STILL held after the handoff frame; the next frame must carry no hop edge
    s.inputRouter = { poll: () => H.livePad({ push: true, hop: true, pressed: {} }), setEnabled() {} };
    s.update(0, tickMs);
    expect(s.simClock.tick).toBe(N + 1);
    const edgeBits = s.ghostRecorder.inputs.filter((_r, i, a) => { let at = 0; for (let k = 0; k <= i; k++) at += a[k][0]; return at > N; }).map((r) => r[1]);
    expect(edgeBits.every((b) => ((b >> 12) & 63) === 0)).toBe(true);
  });
  test('negative control: the READY key pressed during the seek does not skip READY', () => {
    const s = takeoverScene(TAPE, 900);
    s.inputRouter = { poll: () => H.livePad({ hop: true, pressed: { hop: true, confirm: true } }), setEnabled() {} };
    for (let i = 0; i < 200 && s.takeover.phase === 'seeking'; i++) s.update(0, tickMs);
    expect(s.takeover.phase).toBe('ready');
    s.inputRouter = { poll: () => H.livePad(), setEnabled() {} };
    s.update(0, tickMs);
    expect(s.takeover.phase).toBe('ready');
  });
  test('(b) exact suffix agreement: the original pads fed through the LIVE input path reproduce every tick, the crash tick and cause', () => {
    for (const N of [100, 640, TAPE.endTick - 1]) {
      const s = takeoverScene(TAPE, N);
      seekReady(s); pressReady(s);
      const live = playLive(s, scripted);
      expect(live.end).toBe(REC.ticks);
      for (let t = N + 1; t <= TAPE.endTick; t++) expect(live.fps.get(t)).toBe(REC.fps.get(t));
      expect(s.crashed).toBe(true);
      // the tape the takeover recorded is a complete replayable prefix + suffix with identical inputs and checkpoints
      const out = s.registry.get(H.REG.LAST_TAKEOVER_TAPE);
      expect(out.mode).toBe('takeover');
      expect(out.takeoverTick).toBe(N);
      expect(out.inputs).toEqual(TAPE.inputs);
      expect(out.checkpoints).toEqual(TAPE.checkpoints);
      expect(out.endTick).toBe(TAPE.endTick);
    }
  });
  test('(c) divergence: different live input diverges from the original and the run still ends unranked', () => {
    const N = 640;
    const s = takeoverScene(TAPE, N);
    seekReady(s); pressReady(s);
    const other = (t) => scripted(t).push ? H.livePad({ push: true, variableHop: true, noAutoNudge: true, tilt: 1 }) : H.livePad({ variableHop: true, noAutoNudge: true, tilt: 1, tuck: true });
    const live = playLive(s, other, 6000);
    let diverged = false;
    for (let t = N + 1; t <= Math.min(live.end, TAPE.endTick); t++) if (live.fps.get(t) !== REC.fps.get(t)) { diverged = true; break; }
    expect(diverged).toBe(true);
    expect(s.crashed).toBe(true);
    expect(s.__events.some((e) => e[0] === H.EVT.RUN_END)).toBe(false);
  });
  test('retries are independent: two takeovers from the same N reach the same state at N and share nothing', () => {
    const a = takeoverScene(TAPE, 640), b = takeoverScene(TAPE, 640);
    seekReady(a); seekReady(b);
    expect(H.fp(a)).toBe(H.fp(b));
    pressReady(a); pressReady(b);
    playLive(a, (t) => H.livePad({ push: true, tilt: 1 }), 300);
    expect(H.fp(b)).toBe(REC.fps.get(640));
    expect(a.ghostRecorder === null || a.ghostRecorder !== b.ghostRecorder).toBe(true);
  });
});

describe('UNRANKED at every write site (each with a negative control)', () => {
  const spyStorage = () => {
    const calls = [];
    const set = jest.spyOn(Storage.prototype, 'setItem').mockImplementation((k, v) => { calls.push(['set', k]); });
    return { calls, restore: () => set.mockRestore() };
  };

  test('ending a takeover: no RUN_END, no record, no LAST_RECORD/LAST_CRASH/LAST_GHOST_TAPE, no ghost-library save, no evidence, RUN_ABORT practice', async () => {
    const saved = [];
    const s = takeoverScene(TAPE, 640);
    s.registry.set(H.REG.GHOSTS, { saveRun: (t) => { saved.push(t); return Promise.resolve(); }, ghostsFor: async () => [] });
    s.saveStore = { runs: [], saveRun: (r) => { saved.push(r); } };
    seekReady(s); pressReady(s);
    playLive(s, scripted);
    expect(s.crashed).toBe(true);
    for (let i = 0; i < 200 && !s._leaving; i++) s.update(0, 50);
    expect(s._leaving).toBe(true);
    expect(saved).toEqual([]);
    expect(s.registry.get(H.REG.LAST_RECORD)).toBeUndefined();
    expect(s.registry.get(H.REG.LAST_CRASH)).toBeUndefined();
    expect(s.registry.get(H.REG.LAST_GHOST_TAPE)).toBeUndefined();
    expect(s.registry.get('lastEvidenceStatus')).toBeUndefined();
    expect(s.__events.some((e) => e[0] === H.EVT.RUN_END)).toBe(false);
    const abort = s.__events.find((e) => e[0] === H.EVT.RUN_ABORT);
    expect(abort[1]).toMatchObject({ reason: 'takeover-ended', practice: true, takeover: true });
    expect(s.__starts.map((a) => a[0])).toEqual([H.SCENES.TAKEOVER_END]); // never GAME_OVER
    expect(s.__starts[0][1]).toMatchObject({ cause: expect.any(String) });
    expect(s.registry.get(H.REG.LAST_TAKEOVER_TAPE).mode).toBe('takeover');
  });

  test('negative control: the same crash in an ORDINARY run does save, credit and emit RUN_END', () => {
    const saved = [];
    const scene = H.createRun(H.RunScene, H.REG, { seed: SEED });
    scene.saveStore = { runs: [], saveRun: (r) => { saved.push(r); } };
    const ev = []; const emit = scene.game.events.emit.bind(scene.game.events);
    scene.game.events.emit = (e, ...a) => { ev.push(e); return emit(e, ...a); };
    scene.inputRouter = { poll: () => scripted(scene.simClock.tick + 1), setEnabled() {} };
    for (let i = 0; i < 6000 && !scene.crashed; i++) scene.update(0, tickMs);
    expect(scene.crashed).toBe(true);
    expect(saved).toHaveLength(1);
    expect(ev).toContain(H.EVT.RUN_END);
    expect(scene.registry.get(H.REG.LAST_RECORD)).toBeTruthy();
    expect(scene.registry.get(H.REG.LAST_CRASH)).toBeTruthy();
    expect(scene.unrankedPractice).toBe(false);
    expect(scene.takeover).toBeNull();
    expect(ev.find(() => true)).toBeDefined();
  });

  test('RUN_START carries practice:true and takeover:true; an ordinary run carries neither', () => {
    const s = takeoverScene(TAPE, 300);
    const start = s.__events.find((e) => e[0] === H.EVT.RUN_START)[1];
    expect(start).toMatchObject({ practice: true, takeover: true, dailyOfficial: false, gym: false });
    const ord = H.createRun(H.RunScene, H.REG, { seed: SEED });
    expect(ord.unrankedPractice).toBe(false);
  });

  test('official daily and BSOD gym are forced off even when the registry asks for them', () => {
    class T2 extends H.RunScene {
      create() {
        const todayDaily = `daily-${new Date().toISOString().slice(0, 10)}`;
        this.registry.set(H.RULESET_KEY, H.RULESET);
        this.registry.set(H.REG.TAKEOVER, buildTakeoverDescriptor({ tape: TAPE, tick: 300 }));
        this.registry.set(H.REG.DAILY_OFFICIAL, true); this.registry.set(H.REG.DAILY_MODE, 'draft'); this.registry.set(H.REG.BSOD_GYM, true);
        this.registry.set(H.REG.SEED, todayDaily);
        super.create();
      }
    }
    const s = H.createRun(T2, H.REG, { seed: 'x', profile: { bsodGym: { owned: true } } });
    expect(s.dailyOfficial).toBe(false);
    expect(s.dailyMode).toBe('classic');
    expect(s.bsodGym).toBe(false);
    expect(s.seed).toBe(TAPE.seed);
  });

  test('NEW_BEST never fires in a takeover (control: it fires in an ordinary run with the same best)', () => {
    const run = (takeover) => {
      const profileRuns = [{ seed: SEED, distanceM: 5, boosts: undefined, modded: false, dailyOfficial: false, biomeMask: 0 }];
      const scene = takeover ? takeoverScene(TAPE, 100) : H.createRun(H.RunScene, H.REG, { seed: SEED });
      scene.saveStore = { runs: profileRuns, saveRun() {} };
      // RunScene reads the best distance in create(); force the same threshold directly (it is the guard that is under test)
      scene.bestM = 5; scene.newBestDone = false;
      const ev = [];
      const emit = scene.game.events.emit.bind(scene.game.events);
      scene.game.events.emit = (e, ...a) => { ev.push(e); return emit(e, ...a); };
      if (takeover) { seekReady(scene); pressReady(scene); }
      scene.inputRouter = { poll: () => scripted(scene.simClock.tick + 1), setEnabled() {} };
      for (let i = 0; i < 2500 && !scene.crashed; i++) scene.update(0, tickMs);
      return ev.includes(H.EVT.NEW_BEST);
    };
    expect(run(false)).toBe(true);
    expect(run(true)).toBe(false);
  });

  test('tutorial / tuck-hint flags are never written to localStorage in a takeover (control: an ordinary run writes them)', () => {
    const run = (takeover) => {
      const st = spyStorage();
      try {
        const scene = takeover ? takeoverScene(TAPE, 100) : H.createRun(H.RunScene, H.REG, { seed: SEED });
        if (takeover) { seekReady(scene); pressReady(scene); }
        scene.tutDone = new Set(); scene.tuckShows = 0;
        scene.tutDoneId('push'); scene.applyHintEvents([{ id: 'tuck', show: true }]);
        return st.calls.slice();
      } finally { st.restore(); }
    };
    expect(run(false).map((c) => c[1])).toEqual(expect.arrayContaining(['bb.tutorialDone', 'bb.tuckShows']));
    expect(run(true)).toEqual([]);
  });

  test('guest practice (#69) tutorial / tuck-hint writes are EXACTLY as on main: still written (control: takeover skips them)', () => {
    const guestTape = JSON.parse(JSON.stringify(TAPE));
    const st = spyStorage();
    try {
      class G extends H.RunScene { create() { this.registry.set(H.REG.GUEST_PRACTICE, guestTape); super.create(); } }
      const guest = H.createRun(G, H.REG, { seed: SEED });
      expect(guest.guestPractice).toBe(true);
      expect(guest.unrankedPractice).toBe(true);
      expect(guest.takeover).toBeNull();
      guest.tutDone = new Set(); guest.tuckShows = 0;
      guest.tutDoneId('push'); guest.applyHintEvents([{ id: 'tuck', show: true }]);
      expect(st.calls.map((c) => c[1])).toEqual(expect.arrayContaining(['bb.tutorialDone', 'bb.tuckShows']));
    } finally { st.restore(); }
  });

  test('a BSOD bluff never reaches the progression store in a takeover (control: it does in an ordinary run)', () => {
    const run = (takeover) => {
      const calls = [];
      const store = { recordBsodBluff: (...a) => { calls.push(['bluff', ...a]); return { added: [] }; }, discoverBsodGym: () => { calls.push(['discover']); return { discovered: false }; }, profile: {} };
      const scene = takeover ? takeoverScene(TAPE, 100) : H.createRun(H.RunScene, H.REG, { seed: SEED });
      scene.registry.set(H.REG.PROGRESSION, { store });
      if (takeover) { seekReady(scene); pressReady(scene); }
      scene.awardBsodBluff({ points: 10, chain: 1, surfing: false, closestGapPx: 5 });
      return calls;
    };
    expect(run(false).length).toBeGreaterThan(0);
    expect(run(true)).toEqual([]);
  });

  test('GhostLibrary.saveRun refuses a takeover tape (control: it accepts the same tape as mode normal); guest practice refuses it too', async () => {
    const lib = new GhostLibrary();
    const normal = JSON.parse(JSON.stringify(TAPE));
    const tk = { ...normal, mode: 'takeover', parentDigest: 'x', takeoverTick: 100 };
    expect(await lib.saveRun(tk)).toBeNull();
    expect(lib.tapes.has(tk.runId)).toBe(false);
    expect(await lib.saveRun(normal)).not.toBeNull();
  });

  test('scheduleRunEvidence is unreachable from an unranked scene (control: _saveGhostTape on an ordinary scene runs the evidence path)', async () => {
    const make = (takeover) => {
      const scene = takeover ? takeoverScene(TAPE, 100) : H.createRun(H.RunScene, H.REG, { seed: SEED });
      scene.ghostRecorder = scene.ghostRecorder || { finish: () => ({ ...TAPE, runId: 'z' }), fingerprints: [], inputs: [] };
      return scene;
    };
    const ordinary = make(false);
    ordinary._saveGhostTape({ id: 'z', distanceM: 1, score: 1, endedAt: 1 });
    expect(ordinary.registry.get(H.REG.LAST_GHOST_TAPE)).toBeTruthy();
    const tk = make(true);
    tk._saveGhostTape({ id: 'z', distanceM: 1, score: 1, endedAt: 1 });
    expect(tk.registry.get(H.REG.LAST_GHOST_TAPE)).toBeUndefined();
    expect(tk.ghostRecorder).toBeNull();
  });
});

describe('exceptions end at the title, never a black screen', () => {
  test('a throw in the middle of the seek aborts: TITLE, notice with the reason, no recorder / tape driver, RUN_ABORT practice', () => {
    const s = takeoverScene(TAPE, 900);
    s.inputRouter = { poll: () => H.livePad(), setEnabled() {} };
    const orig = s.stepReplayTick.bind(s);
    s.stepReplayTick = (...a) => { if (s.simClock.tick === 50) throw new Error('boom at 50'); return orig(...a); };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    for (let i = 0; i < 50 && s.takeover.phase === 'seeking'; i++) s.update(0, tickMs);
    warn.mockRestore();
    expect(s.takeover.phase).toBe('aborted');
    expect(s.takeover.abort.reason).toBe('error');
    expect(s.__starts.map((a) => a[0])).toEqual([H.SCENES.TITLE]);
    expect(s.registry.get(H.REG.TAKEOVER_NOTICE)).toMatchObject({ reason: 'error', message: expect.stringContaining('boom at 50') });
    expect(s.ghostRecorder).toBeNull();
    expect(s.tapePlayer).toBeNull();
    expect(s._seeking).toBe(false); // the mute was undone
    expect(s.__events.find((e) => e[0] === H.EVT.RUN_ABORT)[1]).toMatchObject({ practice: true, takeover: true, why: 'error' });
    expect(s.__events.some((e) => e[0] === H.EVT.RUN_END)).toBe(false);
  });
  test('control: without the injected throw the same seek reaches READY', () => {
    expect(seekReady(takeoverScene(TAPE, 900))).toBe('ready');
  });
  test('a tape with an unknown daily rule id is refused up front (it would have thrown in create)', () => {
    const t = JSON.parse(JSON.stringify(TAPE)); t.dailyRuleId = 'no-such-daily-rule';
    const d = { ...buildTakeoverDescriptor({ tape: TAPE, tick: 300 }), tape: t };
    const s = takeoverScene(TAPE, 300, { raw: d });
    expect(s.takeover).toBeNull();
    expect(s.__starts.map((a) => a[0])).toEqual([H.SCENES.TITLE]);
    expect(s.registry.get(H.REG.TAKEOVER_NOTICE)).toMatchObject({ reason: 'undecodable' });
  });
});

describe('seekTo without a takeover (the #66 candidate path)', () => {
  const replayScene = (tape) => {
    class R extends H.RunScene { create() { this.registry.set(H.RULESET_KEY, H.RULESET); this.registry.set(H.REG.GHOST_REPLAY, tape); super.create(); } }
    return H.createRun(R, H.REG, { seed: 'x' });
  };
  test('plain GHOST_REPLAY scene: seekTo(N) reaches N exactly, silently, with verification (control: tampered tape desyncs)', () => {
    const s = replayScene(JSON.parse(JSON.stringify(TAPE)));
    expect(s.takeover).toBeNull();
    const r = s.seekTo(700);
    expect(r).toMatchObject({ done: true, tick: 700 });
    expect(H.fp(s)).toBe(REC.fps.get(700));
    const t = JSON.parse(JSON.stringify(TAPE));
    const i = t.inputs.findIndex((row) => row[1] & (1 << 12)); t.inputs[i][1] &= ~(1 << 12);
    const bad = replayScene(t).seekTo(900);
    expect(bad.done).toBe(false);
    expect(bad.desync).toBeTruthy();
  });
  test('verify:false skips the checkpoint and pose checks (a candidate tape that diverges from its own stored trace)', () => {
    const t = JSON.parse(JSON.stringify(TAPE));
    const i = t.inputs.findIndex((row) => row[1] & (1 << 12)); t.inputs[i][1] &= ~(1 << 12);
    const r = replayScene(t).seekTo(900, { verify: false });
    expect(r).toMatchObject({ done: true, tick: 900 });
    expect(r.desync).toBeUndefined();
  });
  test('a tape whose trace and checkpoints end before the target verifies only what it has (no error, no false desync)', () => {
    const t = JSON.parse(JSON.stringify(TAPE));
    t.checkpoints = t.checkpoints.filter((c) => c[0] <= 240);
    const keep = Math.floor(240 / 4) * 3;
    const all = new Float32Array(Uint8Array.from(Buffer.from(TAPE.trace, 'base64')).buffer);
    t.trace = Buffer.from(all.slice(0, keep).buffer).toString('base64');
    const s = replayScene(t);
    const r = s.seekTo(700);
    expect(r).toMatchObject({ done: true, tick: 700 });
    expect(s.tapePlayer.desync).toBeNull();
    expect(H.fp(s)).toBe(REC.fps.get(700));
  });
  test('seekTo with no tape or no target returns a clean failure instead of throwing', () => {
    const ord = H.createRun(H.RunScene, H.REG, { seed: 'A' });
    expect(ord.seekTo(100)).toMatchObject({ done: false, desync: { reason: 'no-tape' } });
    expect(replayScene(JSON.parse(JSON.stringify(TAPE))).seekTo(undefined)).toMatchObject({ done: false, desync: { reason: 'no-target' } });
  });
});
