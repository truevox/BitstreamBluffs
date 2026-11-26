/**
 * #67 stage 2b-1: postcards on the REAL takeover path (headless RunScene). A postcard has no checkpoints and no trace, so
 * its takeover runs with `coverage:'fingerprint-only'`: the seek skips per-second verification, and at tick N the live
 * combined fingerprint must equal the postcard's, or the takeover is refused. The fingerprint at N is the trust check.
 */
import { jest } from '@jest/globals';
const H = await import('./takeoverHarness.js');
const { buildTakeoverDescriptor, takeoverEligible, validateTakeoverDescriptor, retryDescriptor } = await import('../../src/systems/replay/Takeover.js');
const { CURRENT_RULESET_ID } = await import('../../src/systems/replay/currentRulesetId.js');
const { createPostcard, postcardToTakeoverInput, buildPostcardDescriptor } = await import('../../src/systems/replay/Postcard.js');
const { readChallenge, liveFingerprint } = await import('../../src/systems/replay/PostcardChallenge.js');

jest.spyOn(Date, 'now').mockReturnValue(1_767_000_000_000);

const SEED = 'A';
const scripted = (t) => H.livePad({
  push: t < 400, variableHop: true, noAutoNudge: true,
  hop: t >= 300 && t <= 303, tuck: t > 500 && t < 540, tilt: t > 420 && t < 460 ? -1 : 0,
  pressed: { hop: t === 300 || t === 700 },
});
const REC = H.recordRun({ seed: SEED, padFor: scripted, fpEvery: 1 });
const TAPE = REC.tape;
const TICK_MS = 1000 / 120;
const IDENTITY = { gameVersion: '2.22.7', simRevision: TAPE.simRevision, rulesetId: TAPE.rulesetId, buildId: TAPE.buildId };

function takeoverScene(descriptor, { mutate } = {}) {
  const sent = mutate ? mutate(descriptor) : descriptor;
  class T extends H.RunScene {
    create() {
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
  return H.createRun(T, H.REG, { seed: 'WRONG-SEED-IGNORED' });
}
function seekReady(scene, maxFrames = 400) {
  scene.inputRouter = { poll: () => H.livePad(), setEnabled() {} };
  for (let i = 0; i < maxFrames && scene.takeover && scene.takeover.phase === 'seeking'; i++) scene.update(0, TICK_MS);
  return scene.takeover && scene.takeover.phase;
}

/** The sender: a normal takeover of the recorded tape, READY at N; the postcard is made from the authoritative state there. */
function sender(N) {
  const s = takeoverScene(buildTakeoverDescriptor({ tape: TAPE, tick: N, source: 'last-run' }));
  expect(seekReady(s)).toBe('ready');
  return s;
}
function makePostcard(N, over = {}) {
  const s = sender(N);
  const r = createPostcard({ tape: TAPE, startTick: N, windowSec: 8, fingerprintAtStart: liveFingerprint(s), challenge: readChallenge(s), identity: IDENTITY, inSessionTape: true, ...over });
  expect(r).toMatchObject({ ok: true });
  return { pc: r.postcard, sender: s };
}
const postcardDescriptor = buildPostcardDescriptor;

describe('the sender fingerprint is the game\'s own', () => {
  test('liveFingerprint at READY equals the recording\'s fingerprint at N', () => {
    for (const N of [150, 640, 977]) expect(liveFingerprint(sender(N))).toBe(REC.fps.get(N));
  });
});

describe('a recipient re-simulates the postcard prefix and reaches the sender\'s exact state', () => {
  test.each([150, 333, 640, 977])('N=%i: READY, the fingerprint at N equals the sender\'s, challenge equal, tape had no checkpoints or trace', (N) => {
    const { pc, sender: s } = makePostcard(N);
    const d = postcardDescriptor(pc);
    expect(d.tape.checkpoints).toEqual([]);
    expect(d.tape.trace).toBe('');
    const r = takeoverScene(d);
    expect(seekReady(r)).toBe('ready');
    expect(r.simClock.tick).toBe(N);
    expect(liveFingerprint(r)).toBe(pc.fingerprintAtStart);
    expect(liveFingerprint(r)).toBe(liveFingerprint(s));
    expect(readChallenge(r)).toEqual(readChallenge(s));
    expect(readChallenge(r)).toEqual(pc.challenge);
    expect(r.__starts).toHaveLength(0);
  });
});

describe('fingerprint-only coverage: only a postcard with an expected fingerprint may skip the checkpoint coverage', () => {
  const { pc } = makePostcard(640);
  const input = postcardToTakeoverInput(pc);
  const ctx = (o) => ({ rulesetId: CURRENT_RULESET_ID, ...o });

  test('control: the plain tape-shaped postcard input is refused by the default (full) coverage rule', () => {
    expect(takeoverEligible(input.tape, input.tick, ctx())).toMatchObject({ ok: false, reason: 'prefix-uncovered' });
  });
  test('fingerprint-only from source postcard with an expected fingerprint is accepted', () => {
    expect(takeoverEligible(input.tape, input.tick, ctx({ coverage: 'fingerprint-only', source: 'postcard', expectedFingerprint: pc.fingerprintAtStart }))).toEqual({ ok: true });
  });
  test('fingerprint-only WITHOUT an expectedFingerprint is refused (or a malformed one)', () => {
    for (const expectedFingerprint of [undefined, null, '', 'abc', 'xxh32x2:zz']) {
      expect(takeoverEligible(input.tape, input.tick, ctx({ coverage: 'fingerprint-only', source: 'postcard', expectedFingerprint }))).toMatchObject({ ok: false, reason: 'coverage' });
    }
  });
  test('fingerprint-only from any source other than postcard is refused', () => {
    for (const source of ['last-run', 'retry', 'test', undefined, 'Postcard']) {
      expect(takeoverEligible(input.tape, input.tick, ctx({ coverage: 'fingerprint-only', source, expectedFingerprint: pc.fingerprintAtStart }))).toMatchObject({ ok: false, reason: 'coverage' });
    }
  });
  test('an unknown coverage value is refused', () => {
    expect(takeoverEligible(input.tape, input.tick, ctx({ coverage: 'none', source: 'postcard', expectedFingerprint: pc.fingerprintAtStart }))).toMatchObject({ ok: false, reason: 'coverage' });
  });
  test('the descriptor carries coverage + fingerprint and validates; stripping the fingerprint or relabelling the source breaks it', () => {
    const d = postcardDescriptor(pc);
    expect(d).toMatchObject({ source: 'postcard', coverage: 'fingerprint-only', expectedFingerprint: pc.fingerprintAtStart });
    expect(validateTakeoverDescriptor(d, { rulesetId: CURRENT_RULESET_ID })).toEqual({ ok: true });
    expect(validateTakeoverDescriptor({ ...d, expectedFingerprint: undefined }, { rulesetId: CURRENT_RULESET_ID })).toMatchObject({ ok: false, reason: 'coverage' });
    expect(validateTakeoverDescriptor({ ...d, source: 'last-run' }, { rulesetId: CURRENT_RULESET_ID })).toMatchObject({ ok: false, reason: 'coverage' });
    expect(validateTakeoverDescriptor({ ...d, coverage: undefined }, { rulesetId: CURRENT_RULESET_ID })).toMatchObject({ ok: false, reason: 'prefix-uncovered' });
  });
  test('a retry of a postcard descriptor stays a postcard (independent, re-validated) and keeps its binding', () => {
    const d = postcardDescriptor(pc);
    const r = retryDescriptor(d, { rulesetId: CURRENT_RULESET_ID });
    expect(r.ok).toBe(true);
    expect(r.descriptor).toMatchObject({ source: 'postcard', coverage: 'fingerprint-only', expectedFingerprint: pc.fingerprintAtStart, postcard: { digest: pc.digest, windowTicks: pc.windowTicks } });
    expect(r.descriptor).not.toBe(d);
  });
});

describe('the fingerprint at N is the authority: a mismatch refuses, ends at the title, starts no run', () => {
  const expectRefusedAtN = (s, N) => {
    seekReady(s);
    expect(s.takeover.phase).toBe('aborted');
    expect(s.takeover.abort.reason).toBe('fingerprint');
    expect(s.simClock.tick).toBe(N);
    expect(s.__starts.map((a) => a[0])).toEqual([H.SCENES.TITLE]);
    expect(s.registry.get(H.REG.TAKEOVER_NOTICE)).toMatchObject({ reason: 'fingerprint' });
    expect(s.registry.get(H.REG.TAKEOVER_NOTICE).message).toMatch(/isn't reproducible on this build/i);
    expect(s.ghostRecorder == null).toBe(true);
    expect(s.__events.find((e) => e[0] === H.EVT.RUN_ABORT)[1]).toMatchObject({ practice: true, takeover: true, reason: 'takeover-aborted' });
    expect(s.__events.some((e) => e[0] === H.EVT.RUN_END)).toBe(false);
    expect(s.__events.some((e) => e[0] === H.EVT.TAKEOVER_STATE && e[1].phase === 'ready')).toBe(false);
  };
  test('a mutated prefix row that still decodes (re-signed) gives a different state at N: refused', () => {
    const N = 640;
    const { pc } = makePostcard(N);
    const mutated = { ...pc, prefix: pc.prefix.map((r) => [...r]) };
    const i = mutated.prefix.findIndex((r) => (r[1] >> 12) & 1); // the hop edge at 300
    expect(i).toBeGreaterThanOrEqual(0);
    mutated.prefix[i][1] &= ~(1 << 12);
    expectRefusedAtN(takeoverScene(postcardDescriptor(mutated)), N);
  });
  test('a wrong expected fingerprint on an untouched prefix is refused', () => {
    const N = 640;
    const { pc } = makePostcard(N);
    expectRefusedAtN(takeoverScene(postcardDescriptor({ ...pc, fingerprintAtStart: 'xxh32x2:0000000000000000' })), N);
  });
  test('control: the untouched postcard reaches READY (the refusals above are not an artefact of the harness)', () => {
    const { pc } = makePostcard(640);
    expect(seekReady(takeoverScene(postcardDescriptor(pc)))).toBe('ready');
  });
  test('a fingerprint-only descriptor without an expected fingerprint never starts (scene refuses at create)', () => {
    const { pc } = makePostcard(640);
    const s = takeoverScene(postcardDescriptor(pc), { mutate: (d) => ({ ...d, expectedFingerprint: undefined }) });
    expect(s.takeover).toBeNull();
    expect(s.__starts.map((a) => a[0])).toEqual([H.SCENES.TITLE]);
    expect(s.registry.get(H.REG.TAKEOVER_NOTICE)).toMatchObject({ reason: 'coverage' });
  });
});
