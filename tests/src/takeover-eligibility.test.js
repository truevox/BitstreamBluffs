/** #72 Replay Takeover: pure eligibility + descriptor + live-suffix recorder. Every refusal has a negative control. */
import {
  takeoverEligible, buildTakeoverDescriptor, validateTakeoverDescriptor, createTakeoverRecorder, takeoverHeaderOf, seekStep,
  OLDER_BUILD_MESSAGE, TAKEOVER_KIND,
} from '../../src/systems/replay/Takeover.js';
import { GHOST_TAPE_FORMAT, GHOST_TAPE_VERSION, GHOST_PHYSICS_VERSION, decodeTrace } from '../../src/systems/ghost/GhostTape.js';
import { SIM_TICK_HZ } from '../../src/systems/SimClock.js';
import { SIM_REVISION } from '../../src/systems/replay/ruleset.js';
import { guestPracticeEligible } from '../../src/systems/ghost/GuestPractice.js';

const RULESET = `sha256:${'a'.repeat(64)}`;
const CTX = { rulesetId: RULESET };
const END = 600;

const tape = (over = {}) => ({
  format: GHOST_TAPE_FORMAT, version: GHOST_TAPE_VERSION, physicsVersion: GHOST_PHYSICS_VERSION, simTickHz: SIM_TICK_HZ,
  runRandomVersion: 1, edgeRows: 'every-tick',
  seed: 'TKOVR72', biomeMask: 5, simRevision: SIM_REVISION, rulesetId: RULESET, buildId: 'sha256:b', mode: 'normal',
  dailyRuleId: 'none', syncLevel: 3, boosts: ['shield'], upgradeRanks: null, magnetsDrop: false, kodiaksOn: false,
  bsod: { leftEdgeX: 10, initial: { wallX: -100, wallSpeedPxS: 1, accelerationPxS2: 1 } },
  startPose: [1, 2, 3, 4, 5, 6], random: {}, startedAt: 1,
  runId: 'r1', distanceM: 10, score: 100, cause: 'crash', endedAt: 2, endTick: END,
  // [dt, bits, tilt]: push from tick 1, a hop edge on 300 (bit 6 = hop held, bit 12 = hop edge), release at 302
  inputs: [[1, 1, 0], [299, 1 | (1 << 6) | (1 << 12), 0], [2, 1, 0], [100, 1, 127]],
  checkpoints: [120, 240, 360, 480, 600].map((t) => [t, t, 0, 0, 0, 0, 0, 0]),
  trace: Buffer.from(new Float32Array(Array.from({ length: (END / 4) * 3 }, (_, i) => i)).buffer).toString('base64'),
  ...over,
});
const omit = (t, k) => { const c = { ...t }; delete c[k]; return c; };

describe('takeoverEligible: happy path', () => {
  test('a stamped, current, normal tape is eligible anywhere in [1, endTick-1]', () => {
    for (const n of [1, 2, 119, 120, 121, 300, 599]) expect(takeoverEligible(tape(), n, CTX)).toEqual({ ok: true });
  });
});

describe('takeoverEligible: every refusal reason (each with its control)', () => {
  const cases = [
    ['guest-practice', () => takeoverEligible(tape(), 100, { ...CTX, guestPractice: true })],
    ['undecodable', () => takeoverEligible(null, 100, CTX)],
    ['undecodable', () => takeoverEligible({ nope: 1 }, 100, CTX)],
    ['undecodable', () => takeoverEligible(tape({ inputs: [[1, 1, 0], 'x'] }), 100, CTX)],
    ['undecodable', () => takeoverEligible(tape({ inputs: [[1, 0xfffffff, 0]] }), 100, CTX)],
    ['undecodable', () => takeoverEligible(tape({ trace: 7 }), 100, CTX)],
    ['undecodable', () => takeoverEligible(tape({ physicsVersion: 99 }), 100, CTX)],
    ['mode', () => takeoverEligible(tape({ mode: 'daily' }), 100, CTX)],
    ['mode', () => takeoverEligible(tape({ mode: 'daily-draft' }), 100, CTX)],
    ['mode', () => takeoverEligible(tape({ mode: 'gym' }), 100, CTX)],
    ['mode', () => takeoverEligible(tape({ mode: 'takeover' }), 100, CTX)],
    ['mode', () => takeoverEligible(tape({ mode: 'guest' }), 100, CTX)],
    ['sim-revision', () => takeoverEligible(tape({ simRevision: SIM_REVISION - 1 }), 100, CTX)],
    ['sim-revision', () => takeoverEligible(omit(tape(), 'simRevision'), 100, CTX)],
    ['older-build', () => takeoverEligible(omit(tape(), 'rulesetId'), 100, CTX)],
    ['older-build', () => takeoverEligible(tape({ rulesetId: '' }), 100, CTX)],
    ['older-build', () => takeoverEligible(tape({ rulesetId: null }), 100, CTX)],
    ['ruleset-mismatch', () => takeoverEligible(tape({ rulesetId: `sha256:${'c'.repeat(64)}` }), 100, CTX)],
    ['no-ruleset', () => takeoverEligible(tape(), 100, {})],
    ['no-ruleset', () => takeoverEligible(tape(), 100, { rulesetId: '' })],
    ['course', () => takeoverEligible(omit(tape(), 'seed'), 100, CTX)],
    ['course', () => takeoverEligible(tape({ seed: '' }), 100, CTX)],
    ['course', () => takeoverEligible(omit(tape(), 'biomeMask'), 100, CTX)],
    ['course', () => takeoverEligible(tape({ biomeMask: -1 }), 100, CTX)],
    ['loadout', () => takeoverEligible(omit(tape(), 'boosts'), 100, CTX)],
    ['loadout', () => takeoverEligible(omit(tape(), 'upgradeRanks'), 100, CTX)],
    ['loadout', () => takeoverEligible(omit(tape(), 'syncLevel'), 100, CTX)],
    ['loadout', () => takeoverEligible(tape({ syncLevel: 0 }), 100, CTX)],
    ['tick', () => takeoverEligible(tape(), 0, CTX)],
    ['tick', () => takeoverEligible(tape(), END, CTX)],
    ['tick', () => takeoverEligible(tape(), END + 50, CTX)],
    ['tick', () => takeoverEligible(tape(), -3, CTX)],
    ['tick', () => takeoverEligible(tape(), 12.5, CTX)],
    ['tick', () => takeoverEligible(tape(), NaN, CTX)],
    ['tick', () => takeoverEligible(tape(), '100', CTX)],
    ['prefix-uncovered', () => takeoverEligible(tape({ checkpoints: [[120, 0], [360, 0], [480, 0], [600, 0]] }), 400, CTX)],
    ['prefix-uncovered', () => takeoverEligible(tape({ checkpoints: [] }), 300, CTX)],
    ['prefix-uncovered', () => takeoverEligible(tape({ trace: Buffer.from(new Float32Array(30).buffer).toString('base64') }), 300, CTX)],
  ];
  test.each(cases.map((c, i) => [i, c[0], c[1]]))('#%i refuses with %s', (_i, reason, run) => {
    const r = run();
    expect(r.ok).toBe(false);
    expect(r.reason).toBe(reason);
    expect(typeof r.message).toBe('string');
    expect(r.message.length).toBeGreaterThan(5);
  });

  test('an unstamped tape gets the exact older-build message', () => {
    const r = takeoverEligible(omit(tape(), 'rulesetId'), 100, CTX);
    expect(r).toEqual({ ok: false, reason: 'older-build', message: OLDER_BUILD_MESSAGE });
    expect(OLDER_BUILD_MESSAGE).toBe('recorded on an older build; not takeover-compatible');
  });

  test('negative control: the refusals are not vacuous (the same tape passes when well-formed)', () => {
    expect(takeoverEligible(tape(), 100, CTX).ok).toBe(true);
    expect(takeoverEligible(tape({ checkpoints: [] }), 100, CTX).ok).toBe(true); // N < 120 needs no checkpoint
    expect(takeoverEligible(tape({ checkpoints: [] }), 300, CTX).ok).toBe(false);
  });

  test('never throws on hostile input', () => {
    for (const bad of [undefined, 0, 'x', [], () => 1, { inputs: { length: 5 } }, Object.create(null), new Proxy({}, { get() { throw new Error('boom'); } })]) {
      expect(() => takeoverEligible(bad, 5, CTX)).not.toThrow();
      expect(takeoverEligible(bad, 5, CTX).ok).toBe(false);
    }
  });

  test('a takeover tape is itself never takeover-eligible and never a guest-practice opponent', () => {
    const t = tape({ mode: 'takeover' });
    expect(takeoverEligible(t, 100, CTX).reason).toBe('mode');
    expect(guestPracticeEligible(t)).toBe(false);
    expect(guestPracticeEligible(tape())).toBe(true); // control: the same tape as mode normal is admitted
  });
});

describe('buildTakeoverDescriptor', () => {
  test('is a frozen bb-takeover v1 with the parent digest, ruleset id and sim revision', () => {
    const t = tape();
    const d = buildTakeoverDescriptor({ tape: t, tick: 250, source: 'last-run' });
    expect(d.kind).toBe(TAKEOVER_KIND);
    expect(d.v).toBe(1);
    expect(d.tick).toBe(250);
    expect(d.source).toBe('last-run');
    expect(d.rulesetId).toBe(RULESET);
    expect(d.simRevision).toBe(SIM_REVISION);
    expect(d.parentDigest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(Object.isFrozen(d)).toBe(true);
    expect(Object.isFrozen(d.tape)).toBe(true);
    expect(Object.isFrozen(d.tape.inputs)).toBe(true);
    expect(Object.isFrozen(d.tape.inputs[0])).toBe(true);
    expect(() => { 'use strict'; d.tick = 5; }).toThrow();
    expect(validateTakeoverDescriptor(d, CTX)).toEqual({ ok: true });
  });

  test('the descriptor shares no mutable state with the parent tape', () => {
    const t = tape();
    const d = buildTakeoverDescriptor({ tape: t, tick: 250 });
    t.inputs[0][1] = 99; t.inputs.push([1, 2, 3]); t.bsod.leftEdgeX = -1;
    expect(d.tape.inputs[0][1]).toBe(1);
    expect(d.tape.inputs).toHaveLength(4);
    expect(d.tape.bsod.leftEdgeX).toBe(10);
  });

  test('the parent digest changes when an input row changes (tamper evidence), and revalidation catches a swapped tape', () => {
    const a = buildTakeoverDescriptor({ tape: tape(), tick: 250 });
    const b = buildTakeoverDescriptor({ tape: tape({ inputs: [[1, 1, 0], [299, 1, 0]] }), tick: 250 });
    expect(a.parentDigest).not.toBe(b.parentDigest);
    expect(validateTakeoverDescriptor({ ...a, parentDigest: b.parentDigest }, CTX).ok).toBe(false);
  });

  test('descriptor validation re-runs eligibility (ruleset drift, bad tick, wrong kind)', () => {
    const d = buildTakeoverDescriptor({ tape: tape(), tick: 250 });
    expect(validateTakeoverDescriptor(d, { rulesetId: `sha256:${'d'.repeat(64)}` }).reason).toBe('ruleset-mismatch');
    expect(validateTakeoverDescriptor({ ...d, tick: 9999 }, CTX).reason).toBe('tick');
    expect(validateTakeoverDescriptor({ ...d, kind: 'x' }, CTX).ok).toBe(false);
    expect(validateTakeoverDescriptor(null, CTX).ok).toBe(false);
    expect(validateTakeoverDescriptor(d, { ...CTX, guestPractice: true }).reason).toBe('guest-practice');
  });
});

describe('createTakeoverRecorder: the independent live suffix', () => {
  test('header is the parent header plus {mode, parentDigest, takeoverTick}; results are not inherited', () => {
    const d = buildTakeoverDescriptor({ tape: tape(), tick: 250 });
    const h = takeoverHeaderOf(d);
    expect(h.mode).toBe('takeover');
    expect(h.parentDigest).toBe(d.parentDigest);
    expect(h.takeoverTick).toBe(250);
    expect(h.seed).toBe('TKOVR72');
    expect(h.rulesetId).toBe(RULESET);
    for (const k of ['inputs', 'checkpoints', 'trace', 'score', 'runId', 'endTick', 'endedAt']) expect(h).not.toHaveProperty(k);
  });

  test('prefix rows, checkpoints and trace up to N are copied; rows after N are not', () => {
    const d = buildTakeoverDescriptor({ tape: tape(), tick: 250 });
    const rec = createTakeoverRecorder(d);
    expect(rec.inputs).toEqual([[1, 1, 0], [299, 1 | (1 << 6) | (1 << 12), 0]].slice(0, 1)); // the row at tick 300 is after N
    expect(rec.checkpoints.map((c) => c[0])).toEqual([120, 240]);
    expect(rec.trace).toHaveLength(Math.floor(250 / 4) * 3);
    expect(rec.lastTick).toBe(250);
    const full = decodeTrace(tape());
    expect(rec.trace[5]).toBe(full[5]);
  });

  test('live input after N is recorded relative to the copied prefix, and a repeated pad is not re-written', () => {
    const d = buildTakeoverDescriptor({ tape: tape(), tick: 310 });
    const rec = createTakeoverRecorder(d);
    // the parent held bits=1 (push) from tick 302; a live tick 311 with push only must NOT add a row
    rec.input(311, { push: true, tilt: 0, pressed: {} });
    expect(rec.inputs).toHaveLength(3);
    rec.input(312, { push: true, tilt: 0, hop: true, pressed: { hop: true } });
    expect(rec.inputs).toHaveLength(4);
    expect(rec.inputs[3][0]).toBe(312 - 302);
  });

  test('mutating the recorder never touches the parent tape or descriptor', () => {
    const parent = tape();
    const d = buildTakeoverDescriptor({ tape: parent, tick: 250 });
    const rec = createTakeoverRecorder(d);
    rec.inputs[0][1] = 77; rec.inputs.push([1, 1, 1]); rec.checkpoints[0][1] = -5; rec.header.bsod.leftEdgeX = 12345;
    expect(parent.inputs[0][1]).toBe(1);
    expect(parent.checkpoints[0][1]).toBe(120);
    expect(parent.bsod.leftEdgeX).toBe(10);
    expect(d.tape.inputs[0][1]).toBe(1);
    expect(d.tape.bsod.leftEdgeX).toBe(10);
  });

  test('finish() yields a mode:takeover tape that is neither takeover-eligible nor guest-eligible', () => {
    const d = buildTakeoverDescriptor({ tape: tape(), tick: 250 });
    const rec = createTakeoverRecorder(d);
    const out = rec.finish({ runId: 'tk', distanceM: 1, score: 0, cause: 'crash' });
    expect(out.mode).toBe('takeover');
    expect(out.takeoverTick).toBe(250);
    expect(out.endTick).toBe(250);
    expect(takeoverEligible(out, 100, CTX).reason).toBe('mode');
    expect(guestPracticeEligible(out)).toBe(false);
  });
});

describe('seekStep (scene-free driver)', () => {
  const fakeScene = (over = {}) => {
    const s = { simClock: { tick: 0 }, tapePlayer: { desync: null }, crashed: false, calls: 0,
      stepReplayTick() { this.simClock.tick++; this.calls++; if (this.onTick) this.onTick(this); }, ...over };
    return s;
  };
  test('advances exactly to the target, bounded per call', () => {
    const s = fakeScene();
    expect(seekStep(s, 1000, { maxTicks: 400 })).toMatchObject({ done: false, tick: 400, steps: 400 });
    expect(seekStep(s, 1000, { maxTicks: 400 })).toMatchObject({ done: false, tick: 800 });
    expect(seekStep(s, 1000, { maxTicks: 400 })).toMatchObject({ done: true, tick: 1000, steps: 200 });
    expect(seekStep(s, 1000, { maxTicks: 400 })).toMatchObject({ done: true, steps: 0 });
  });
  test('a desync stops the seek immediately and reports it (control: no desync completes)', () => {
    const s = fakeScene({ onTick: (sc) => { if (sc.simClock.tick === 7) sc.tapePlayer.desync = { tick: 7 }; } });
    const r = seekStep(s, 100);
    expect(r.done).toBe(false);
    expect(r.desync).toEqual({ tick: 7 });
    expect(s.calls).toBe(7);
    expect(seekStep(fakeScene(), 100).done).toBe(true);
  });
  test('a crash before N is a failed prefix', () => {
    const s = fakeScene({ onTick: (sc) => { if (sc.simClock.tick === 3) sc.crashed = true; } });
    expect(seekStep(s, 100)).toMatchObject({ done: false, crashed: true, tick: 3 });
  });
  test('the wall-clock budget bounds a call', () => {
    let t = 0;
    const s = fakeScene();
    const r = seekStep(s, 1e6, { maxTicks: 1e6, budgetMs: 5, now: () => (t += 1) });
    expect(r.done).toBe(false);
    expect(r.steps).toBeLessThan(1000);
  });
});
