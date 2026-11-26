/**
 * #67 stage 2b-2: the postcard window and outcome on the REAL RunScene, the reply built from the live suffix, and the sender-side
 * verification of that reply (re-simulating prefix + suffix). SURVIVED at N + window, CRASHED at +x ticks inside it.
 */
import { jest } from '@jest/globals';
const H = await import('./takeoverHarness.js');
const { buildTakeoverDescriptor } = await import('../../src/systems/replay/Takeover.js');
const { createPostcard, buildPostcardDescriptor, replyFromTakeoverTape, encodeReply, decodeReply, createReply } = await import('../../src/systems/replay/Postcard.js');
const { readChallenge, liveFingerprint } = await import('../../src/systems/replay/PostcardChallenge.js');
const { replyReplayTape, verifyReplyOnScene, judgeReply } = await import('../../src/systems/replay/PostcardVerify.js');

jest.spyOn(Date, 'now').mockReturnValue(1_767_000_000_000);

const scripted = (t) => H.livePad({
  push: t < 400, variableHop: true, noAutoNudge: true,
  hop: t >= 300 && t <= 303, tuck: t > 500 && t < 540, tilt: t > 420 && t < 460 ? -1 : 0,
  pressed: { hop: t === 300 || t === 700 },
});
const REC = H.recordRun({ seed: 'A', padFor: scripted, fpEvery: 1 });
const TAPE = REC.tape;
const CRASH_TICK = REC.ticks;
const TICK_MS = 1000 / 120;
const IDENTITY = { gameVersion: '2.22.7', simRevision: TAPE.simRevision, rulesetId: TAPE.rulesetId, buildId: TAPE.buildId };

function sceneFor(descriptor, { replayTape } = {}) {
  class T extends H.RunScene {
    create() {
      this.__events = []; this.__starts = [];
      const emit = this.game.events.emit.bind(this.game.events);
      this.game.events.emit = (e, ...a) => { this.__events.push([e, ...a]); return emit(e, ...a); };
      this.scene.start = (...a) => this.__starts.push(a);
      this.registry.set(H.RULESET_KEY, H.RULESET);
      if (replayTape) this.registry.set(H.REG.GHOST_REPLAY, replayTape); else this.registry.set(H.REG.TAKEOVER, descriptor);
      super.create();
    }
  }
  return H.createRun(T, H.REG, { seed: 'WRONG-SEED-IGNORED' });
}
function seekReady(s) {
  s.inputRouter = { poll: () => H.livePad(), setEnabled() {} };
  for (let i = 0; i < 400 && s.takeover && s.takeover.phase === 'seeking'; i++) s.update(0, TICK_MS);
  return s.takeover && s.takeover.phase;
}
function makePostcard(N, windowSec) {
  const s = sceneFor(buildTakeoverDescriptor({ tape: TAPE, tick: N, source: 'last-run' }));
  expect(seekReady(s)).toBe('ready');
  const r = createPostcard({ tape: TAPE, startTick: N, windowSec, fingerprintAtStart: liveFingerprint(s), challenge: readChallenge(s), identity: IDENTITY, inSessionTape: true });
  expect(r.ok).toBe(true);
  return r.postcard;
}
function pressGo(s) {
  let first = true;
  s.inputRouter = { poll: () => { const p = H.livePad({ hop: true, pressed: { hop: first, confirm: first } }); first = false; return p; }, setEnabled() {} };
  s.update(0, TICK_MS);
}
/** Open the postcard as a recipient, take control, and play `padFor` until the attempt ends (a scene start or the frame budget). */
function attempt(pc, padFor, maxFrames = 6000) {
  const d = buildPostcardDescriptor(pc);
  const s = sceneFor(d);
  expect(seekReady(s)).toBe('ready');
  pressGo(s);
  expect(s.takeover.phase).toBe('live');
  s.inputRouter = { poll: () => padFor(s.simClock.tick + 1), setEnabled() {} };
  let n = 0;
  while (!s.__starts.length && n < maxFrames) { s.update(0, TICK_MS); n++; }
  return { s, d };
}
const endData = (s) => s.__starts.find((a) => a[0] === H.SCENES.TAKEOVER_END)[1];

describe('SURVIVED: alive at N + window', () => {
  const N = 150;
  const pc = makePostcard(N, 5);
  const { s, d } = attempt(pc, scripted);
  test('the run ends exactly at N + windowTicks on the takeover end screen, outcome SURVIVED', () => {
    expect(pc.windowTicks).toBe(600);
    expect(s.simClock.tick).toBe(N + 600);
    expect(s.crashed).toBe(false);
    const data = endData(s);
    expect(data.cause).toBe('survived');
    expect(data.outcome).toMatchObject({ result: 'survived', crashOffsetTicks: null, windowTicks: 600 });
    expect(data.descriptor.postcard.digest).toBe(pc.digest);
    expect(s.__starts.map((a) => a[0])).toEqual([H.SCENES.TAKEOVER_END]);
  });
  test('the countdown is published each frame and reaches 0', () => {
    const w = s.__events.filter((e) => e[0] === H.EVT.TAKEOVER_STATE && e[1].phase === 'window').map((e) => e[1]);
    expect(w.length).toBeGreaterThan(300);
    expect(w[0].windowTicks).toBe(600);
    expect(w[0].remainingTicks).toBeLessThanOrEqual(600);
    for (let i = 1; i < w.length; i++) expect(w[i].remainingTicks).toBeLessThanOrEqual(w[i - 1].remainingTicks);
  });
  test('unranked at every write site: no RUN_END, no record, no credits, nothing in the ghost library', () => {
    expect(s.__events.some((e) => e[0] === H.EVT.RUN_END)).toBe(false);
    expect(s.registry.get(H.REG.LAST_RECORD)).toBeUndefined();
    expect(s.__events.find((e) => e[0] === H.EVT.RUN_ABORT)[1]).toMatchObject({ practice: true, takeover: true, reason: 'takeover-ended', cause: 'survived' });
    expect(s.unrankedPractice).toBe(true);
    expect(s.registry.get(H.REG.LAST_TAKEOVER_TAPE)).toBeTruthy();
  });
  test('the reply is built from the live suffix inside the window, round-trips, and carries unranked:true and no PII', async () => {
    const tape = s.registry.get(H.REG.LAST_TAKEOVER_TAPE);
    const r = replyFromTakeoverTape({ tape, descriptor: d, outcome: endData(s).outcome });
    expect(r).toMatchObject({ ok: true });
    expect(r.reply).toMatchObject({ unranked: true, outcome: 'survived', crashOffsetTicks: null, postcardDigest: pc.digest });
    expect(r.reply.suffix.reduce((a, row) => a + row[0], 0)).toBeLessThanOrEqual(600);
    const zlib = (await import('node:zlib')).default;
    const codec = { deflate: async (b) => new Uint8Array(zlib.deflateRawSync(b)), inflate: async (b, m) => new Uint8Array(zlib.inflateRawSync(b, { maxOutputLength: m })) };
    const code = await encodeReply(r.reply, { codec });
    expect(await decodeReply(code, { codec, postcard: pc })).toEqual({ ok: true, reply: r.reply });
    const json = JSON.stringify(r.reply);
    for (const n of ['seed', 'runId', 'startedAt', 'initials', 'profile', 'score', 'POSTCARD']) expect(json).not.toContain(n);
  });
  test('sender verification: replaying prefix + suffix confirms SURVIVED', () => {
    const tape = s.registry.get(H.REG.LAST_TAKEOVER_TAPE);
    const reply = replyFromTakeoverTape({ tape, descriptor: d, outcome: endData(s).outcome }).reply;
    const v = sceneFor(null, { replayTape: replyReplayTape(pc, reply) });
    expect(verifyReplyOnScene(v, pc, reply)).toEqual({ ok: true, outcome: 'survived', crashOffsetTicks: null });
  });
});

describe('CRASHED inside the window', () => {
  const N = 977;
  const pc = makePostcard(N, 10);
  const { s, d } = attempt(pc, scripted);
  test('the original inputs crash at the original tick: CRASHED at +offset, the end screen carries it', () => {
    expect(s.crashed).toBe(true);
    const data = endData(s);
    expect(CRASH_TICK).toBeGreaterThan(N);
    expect(CRASH_TICK).toBeLessThan(N + 1200);
    expect(data.outcome).toMatchObject({ result: 'crashed', windowTicks: 1200 });
    expect(data.outcome.crashOffsetTicks).toBe(CRASH_TICK - N);
    expect(data.cause).not.toBe('survived');
    expect(s.__events.some((e) => e[0] === H.EVT.RUN_END)).toBe(false);
  });
  test('the reply says crashed at that offset, and the sender verification confirms it', () => {
    const tape = s.registry.get(H.REG.LAST_TAKEOVER_TAPE);
    const reply = replyFromTakeoverTape({ tape, descriptor: d, outcome: endData(s).outcome }).reply;
    expect(reply).toMatchObject({ outcome: 'crashed', crashOffsetTicks: CRASH_TICK - N, unranked: true });
    const v = sceneFor(null, { replayTape: replyReplayTape(pc, reply) });
    expect(verifyReplyOnScene(v, pc, reply)).toEqual({ ok: true, outcome: 'crashed', crashOffsetTicks: CRASH_TICK - N });
  });
  test('verification negative controls: a lying reply, a wrong offset, another postcard, a wrong fingerprint and a non-replay scene are all refused', () => {
    const tape = s.registry.get(H.REG.LAST_TAKEOVER_TAPE);
    const good = replyFromTakeoverTape({ tape, descriptor: d, outcome: endData(s).outcome }).reply;
    const run = (reply, post = pc, rows = reply) => verifyReplyOnScene(sceneFor(null, { replayTape: replyReplayTape(post, rows) }), post, reply);
    // claims survival, but the engine crashes with those inputs
    const lie = createReply({ binding: { digest: pc.digest, windowTicks: pc.windowTicks }, outcome: 'survived', crashOffsetTicks: null, suffix: good.suffix }).reply;
    expect(run(lie)).toMatchObject({ ok: false, reason: 'outcome' });
    // right outcome, wrong tick
    const off = createReply({ binding: { digest: pc.digest, windowTicks: pc.windowTicks }, outcome: 'crashed', crashOffsetTicks: good.crashOffsetTicks - 1, suffix: good.suffix.filter((r, i, a) => a.slice(0, i + 1).reduce((x, y) => x + y[0], 0) <= good.crashOffsetTicks - 1) }).reply;
    expect(run(off, pc, good)).toMatchObject({ ok: false, reason: 'outcome' });
    // a reply for another postcard
    const other = makePostcard(640, 5);
    expect(verifyReplyOnScene(sceneFor(null, { replayTape: replyReplayTape(pc, good) }), other, good)).toMatchObject({ ok: false, reason: 'mismatch' });
    // a postcard whose expected fingerprint is wrong cannot be confirmed even with an honest reply
    const bad = { ...pc, fingerprintAtStart: 'xxh32x2:0000000000000000' };
    expect(verifyReplyOnScene(sceneFor(null, { replayTape: replyReplayTape(pc, good) }), bad, good)).toMatchObject({ ok: false, reason: 'fingerprint' });
    // not in replay mode
    expect(verifyReplyOnScene({ seekTo() {} }, pc, good)).toMatchObject({ ok: false, reason: 'no-replay' });
  });
  test('judgeReply is a pure function of observations (the browser proof judges in Node)', () => {
    const rp = { digest: 'sha256:' + 'a'.repeat(64), startTick: 100, windowTicks: 600, fingerprintAtStart: 'xxh32x2:1111111111111111' };
    const rep = (o) => ({ postcardDigest: rp.digest, outcome: 'crashed', crashOffsetTicks: 50, ...o });
    const ok = { prefixDone: true, prefixCrashed: false, startFingerprint: rp.fingerprintAtStart, endTick: 150, endDone: false, endCrashed: true };
    expect(judgeReply(rp, rep(), ok)).toMatchObject({ ok: true, outcome: 'crashed', crashOffsetTicks: 50 });
    expect(judgeReply(rp, rep({ crashOffsetTicks: 49 }), ok)).toMatchObject({ ok: false, reason: 'outcome' });
    expect(judgeReply(rp, rep(), { ...ok, startFingerprint: 'xxh32x2:2222222222222222' })).toMatchObject({ ok: false, reason: 'fingerprint' });
    expect(judgeReply(rp, rep({ postcardDigest: 'sha256:' + 'b'.repeat(64) }), ok)).toMatchObject({ ok: false, reason: 'mismatch' });
    expect(judgeReply(rp, rep(), { ...ok, prefixCrashed: true })).toMatchObject({ ok: false, reason: 'prefix' });
    const surv = { ...ok, endCrashed: false, endDone: true, endTick: 700 };
    expect(judgeReply(rp, rep({ outcome: 'survived', crashOffsetTicks: null }), surv)).toMatchObject({ ok: true, outcome: 'survived' });
    expect(judgeReply(rp, rep(), surv)).toMatchObject({ ok: false, reason: 'outcome' });
    expect(judgeReply(rp, rep({ outcome: 'survived', crashOffsetTicks: null }), { ...surv, endTick: 699 })).toMatchObject({ ok: false, reason: 'outcome' });
  });
});

describe('an ordinary takeover has no window (regression)', () => {
  test('no postcard binding: no window events, no outcome, the run continues until it crashes', () => {
    const s = sceneFor(buildTakeoverDescriptor({ tape: TAPE, tick: 977, source: 'last-run' }));
    seekReady(s); pressGo(s);
    s.inputRouter = { poll: () => scripted(s.simClock.tick + 1), setEnabled() {} };
    let n = 0;
    while (!s.__starts.length && n < 6000) { s.update(0, TICK_MS); n++; }
    expect(s.takeover.windowEndTick).toBeUndefined();
    expect(s.__events.some((e) => e[0] === H.EVT.TAKEOVER_STATE && e[1].phase === 'window')).toBe(false);
    expect(endData(s).outcome).toBeNull();
    expect(s.crashed).toBe(true);
  });
});
