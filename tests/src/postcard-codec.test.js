/**
 * #67 Playable Postcards, stage 2a: the pure codec (no RunScene, no network, no storage).
 * `bb-postcard` v1 / `bb-postcard-reply` v1. Jest runs under jsdom, which has no CompressionStream, so the codec is
 * injected (node:zlib raw deflate); a separate block proves the CompressionStream path interoperates with it.
 */
import zlib from 'node:zlib';
import { webcrypto } from 'node:crypto';
import { GhostRecorder, GHOST_TAPE_FORMAT } from '../../src/systems/ghost/GhostTape.js';
import { canonicalBytes, parseCanonical } from '../../src/systems/replay/canonicalJson.js';
import { digestOf } from '../../src/systems/replay/canonicalSha256.js';
import { SIM_TICK_HZ } from '../../src/systems/SimClock.js';
import { RUN_STREAMS, RUN_RANDOM_VERSION } from '../../src/systems/RunRandom.js';
import {
  POSTCARD_KIND, POSTCARD_VERSION, POSTCARD_PREFIX, HEADER_FIELDS,
  MIN_WINDOW_TICKS, MAX_WINDOW_TICKS, MAX_ENCODED_POSTCARD_CHARS,
  createPostcard, encodePostcard, decodePostcard, postcardWire,
} from '../../src/systems/replay/Postcard.js';

// --- fixtures ---------------------------------------------------------------------------------------------------------

const zlibCodec = {
  async deflate(bytes) { return new Uint8Array(zlib.deflateRawSync(bytes, { level: 9 })); },
  async inflate(bytes, max) {
    try { return new Uint8Array(zlib.inflateRawSync(bytes, { maxOutputLength: max })); } catch (e) {
      const err = new Error(String(e && e.message)); err.code = e && e.code === 'ERR_BUFFER_TOO_LARGE' ? 'too-large' : 'bad-compression'; throw err;
    }
  },
};
const OPTS = { codec: zlibCodec };

const RULESET = `sha256:${'a1'.repeat(32)}`;
const BUILD = `sha256:${'b2'.repeat(32)}`;
const IDENTITY = { gameVersion: '2.22.7', simRevision: 9, rulesetId: RULESET, buildId: BUILD };
const FP = 'xxh32x2:0123456789abcdef';

/** Every header field a real RunScene._ghostHeader() writes, plus the private ones a tape picks up at finish(). */
const REAL_HEADER = () => ({
  seed: 'POSTCARD-SEED', biomeMask: 5, simRevision: 9, rulesetId: RULESET, buildId: BUILD, mode: 'normal',
  dailyRuleId: null, dailyRuleSource: 'clock-at-start', syncLevel: 3,
  bsod: { leftEdgeX: 112.5, initial: { wallX: -400.25, wallSpeedPxS: 90.125, accelerationPxS2: 0.5 } },
  controlLayout: 'tricksLeft', boosts: ['b-one', 'b-two'], upgradeRanks: { grip: 2, canopy: 1 }, magnetsDrop: true,
  kodiaksOn: true, kodiakPackMode: 'mixed', kodiakVersion: 3,
  startPose: [100.5, -20.25, 0.0123, 4.5, -0.75, 0.001],
  random: { version: RUN_RANDOM_VERSION, physicsScramble: 123456789, visualSled: 1, visualFx: 2, visualCamera: 4294967295 },
  startedAt: 1767000000000,
});

const pad = (t) => ({
  push: t % 3 === 0, tilt: ((t * 37) % 255 - 127) / 127, variableHop: true, noAutoNudge: true, divebomb: false, corkscrew: false,
  tuck: t % 11 === 0, brakeHeld: false, hop: false, reset: false, heli: 0, airBrake: false, parachute: t % 500 > 450, pause: false,
  pressed: { hop: t % 97 === 0, reset: false, pause: false, airBrake: false, parachute: false, confirm: false },
});

/** A finished tape with PII-ish extras. `ticks` simulation ticks, input changing about every 5-7 ticks. */
function makeTape({ ticks = 3600, header = {}, padFor = (t) => (t % 6 === 0 ? pad(t) : pad(t - (t % 6))) } = {}) {
  const rec = new GhostRecorder({ ...REAL_HEADER(), ...header });
  for (let t = 1; t <= ticks; t++) rec.input(t, padFor(t));
  rec.lastTick = ticks;
  return rec.finish({ runId: 'run-PRIVATE-123', distanceM: 4321, score: 99999, endedAt: 1767000099999 });
}

const baseArgs = (tape, o = {}) => ({ tape, startTick: 1200, windowSec: 8, fingerprintAtStart: FP, identity: IDENTITY,
  challenge: { speedPxS: 612.75, angVel: -0.125, parachuteFuel: 2750.5, hazardPhase: 0.375, bsodGapPx: 240.5 }, ...o });

const must = (r) => { expect(r).toMatchObject({ ok: true }); return r.postcard; };

// --- tests ------------------------------------------------------------------------------------------------------------

describe('create / encode / decode', () => {
  const tape = makeTape();

  test('format identity: kind, version and the BBPC1. prefix', async () => {
    const pc = must(createPostcard(baseArgs(tape)));
    expect(pc).toMatchObject({ kind: POSTCARD_KIND, v: POSTCARD_VERSION, gameVersion: '2.22.7', simRevision: 9, rulesetId: RULESET, buildId: BUILD,
      startTick: 1200, windowTicks: 8 * SIM_TICK_HZ, fingerprintAtStart: FP });
    expect(pc.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect((await encodePostcard(pc, OPTS)).startsWith(POSTCARD_PREFIX)).toBe(true);
    expect(POSTCARD_PREFIX).toBe('BBPC1.');
  });

  test('round trip: create, encode, decode gives deep equality (floats are bit-exact)', async () => {
    const pc = must(createPostcard(baseArgs(tape)));
    const out = await decodePostcard(await encodePostcard(pc, OPTS), OPTS);
    expect(out.ok).toBe(true);
    expect(out.postcard).toEqual(pc);
    expect(out.postcard.header.startPose).toEqual(REAL_HEADER().startPose);
    expect(out.postcard.header.bsod).toEqual(REAL_HEADER().bsod);
    expect(out.postcard.challenge).toEqual({ speedPxS: 612.75, angVel: -0.125, parachuteFuel: 2750.5, hazardPhase: 0.375, bsodGapPx: 240.5 });
  });

  test('round trip keeps awkward floats exact: -0, tiny exponents, many digits', async () => {
    const t2 = makeTape({ header: { startPose: [1e-7, -0, 0.1 + 0.2, 123456789.123456789, -5e-324, 1.7976931348623157e308 / 1e300] } });
    const pc = must(createPostcard(baseArgs(t2, { challenge: { speedPxS: 1e-9, angVel: -0, parachuteFuel: null, hazardPhase: null, bsodGapPx: null } })));
    const out = await decodePostcard(await encodePostcard(pc, OPTS), OPTS);
    expect(out.ok).toBe(true);
    out.postcard.header.startPose.forEach((v, i) => expect(Object.is(v, t2.startPose[i])).toBe(true));
    expect(Object.is(out.postcard.challenge.angVel, -0)).toBe(true);
    expect(out.postcard.challenge.speedPxS).toBe(1e-9);
  });

  test('determinism: the same inputs give the same encoded string', async () => {
    const a = await encodePostcard(must(createPostcard(baseArgs(makeTape()))), OPTS);
    const b = await encodePostcard(must(createPostcard(baseArgs(makeTape()))), OPTS);
    expect(a).toBe(b);
  });

  test('negative control: a different startTick, fingerprint or challenge changes the encoding', async () => {
    const a = await encodePostcard(must(createPostcard(baseArgs(tape))), OPTS);
    expect(await encodePostcard(must(createPostcard(baseArgs(tape, { startTick: 1201 }))), OPTS)).not.toBe(a);
    expect(await encodePostcard(must(createPostcard(baseArgs(tape, { fingerprintAtStart: 'xxh32x2:fedcba9876543210' }))), OPTS)).not.toBe(a);
    expect(await encodePostcard(must(createPostcard(baseArgs(tape, { challenge: { speedPxS: 613, angVel: 0, parachuteFuel: null, hazardPhase: null, bsodGapPx: null } }))), OPTS)).not.toBe(a);
  });

  test('the prefix is the tape rows with absolute tick <= startTick, in GhostTape row encoding, nothing later', () => {
    const pc = must(createPostcard(baseArgs(tape)));
    let at = 0; const expected = [];
    for (const r of tape.inputs) { at += r[0]; if (at > 1200) break; expected.push([r[0], r[1], r[2]]); }
    expect(pc.prefix).toEqual(expected);
    expect(pc.prefix.length).toBeGreaterThan(50);
    expect(pc.prefix.length).toBeLessThan(tape.inputs.length);
    expect(pc.prefix.reduce((s, r) => s + r[0], 0)).toBeLessThanOrEqual(1200);
  });

  test('the prefix is a deep copy (mutating the tape later does not change the postcard)', () => {
    const t = makeTape();
    const pc = must(createPostcard(baseArgs(t)));
    const before = JSON.stringify(pc.prefix);
    t.inputs.forEach((r) => { r[1] = 0; });
    t.startPose[0] = 1; t.bsod.initial.wallX = 5;
    expect(JSON.stringify(pc.prefix)).toBe(before);
    expect(pc.header.startPose[0]).toBe(100.5);
    expect(pc.header.bsod.initial.wallX).toBe(-400.25);
  });
});

describe('privacy: only the causal allowlist crosses', () => {
  const PRIVATE_TAPE = makeTape({ header: {
    startedAt: 1767000123456, initials: 'ZZZ', profile: { name: 'Ada Lovelace', email: 'ada@example.com', level: 77, wallet: 123456 },
    runId: 'run-LEAK-9', ledgerHash: 'sha256:leak', bestScore: 424242, playerId: 'player-LEAK', deviceId: 'device-LEAK',
    takeover: true, parentDigest: 'sha256:parentleak', takeoverTick: 777, nested: { deeper: { secret: 'SECRET-NEST' } },
  } });
  const NEEDLES = ['startedAt', '1767000123456', 'ZZZ', 'initials', 'Ada', 'Lovelace', 'ada@example.com', 'profile', 'wallet', 'run-LEAK', 'run-PRIVATE',
    'runId', 'ledger', 'sha256:leak', 'bestScore', '424242', 'player-LEAK', 'device-LEAK', 'parentDigest', 'parentleak', 'takeoverTick', 'SECRET-NEST',
    'endedAt', '1767000099999', 'controlLayout', 'tricksLeft', 'distanceM', 'score'];

  test('the decoded JSON contains none of the private fields or values', async () => {
    const pc = must(createPostcard(baseArgs(PRIVATE_TAPE)));
    const json = JSON.stringify(pc);
    for (const n of NEEDLES) expect(json).not.toContain(n);
    expect(Object.keys(pc.header).sort()).toEqual([...HEADER_FIELDS].sort());
  });

  test('the raw inflated canonical text and the encoded string contain none of them either', async () => {
    const pc = must(createPostcard(baseArgs(PRIVATE_TAPE)));
    const str = await encodePostcard(pc, OPTS);
    const b64 = str.slice(POSTCARD_PREFIX.length).replace(/-/g, '+').replace(/_/g, '/');
    const inflated = Buffer.from(zlib.inflateRawSync(Buffer.from(b64, 'base64'))).toString('utf8');
    for (const n of NEEDLES) { expect(inflated).not.toContain(n); expect(str).not.toContain(n); }
  });

  test('negative control: the needles ARE present in the source tape, so the greps are not vacuous', () => {
    const src = JSON.stringify(PRIVATE_TAPE);
    for (const n of ['startedAt', 'ZZZ', 'ada@example.com', 'run-PRIVATE', 'sha256:leak', 'player-LEAK', 'parentleak', 'SECRET-NEST', 'tricksLeft']) expect(src).toContain(n);
  });

  test('a tape recorded by a takeover (mode takeover) or any non-normal mode is refused', () => {
    for (const mode of ['takeover', 'daily', 'daily-draft', 'gym', 'guest']) {
      const r = createPostcard(baseArgs(makeTape({ header: { mode } })));
      expect(r).toMatchObject({ ok: false, reason: 'mode' });
    }
  });
});

describe('window and startTick bounds', () => {
  const tape = makeTape({ ticks: 3600 });

  test('windowSec clamps to 5..10 s at the sim tick rate', () => {
    expect(MIN_WINDOW_TICKS).toBe(5 * SIM_TICK_HZ);
    expect(MAX_WINDOW_TICKS).toBe(10 * SIM_TICK_HZ);
    expect(must(createPostcard(baseArgs(tape, { windowSec: 1 }))).windowTicks).toBe(600);
    expect(must(createPostcard(baseArgs(tape, { windowSec: 0 }))).windowTicks).toBe(600);
    expect(must(createPostcard(baseArgs(tape, { windowSec: 5 }))).windowTicks).toBe(600);
    expect(must(createPostcard(baseArgs(tape, { windowSec: 7.5 }))).windowTicks).toBe(900);
    expect(must(createPostcard(baseArgs(tape, { windowSec: 10 }))).windowTicks).toBe(1200);
    expect(must(createPostcard(baseArgs(tape, { windowSec: 99 }))).windowTicks).toBe(1200);
    expect(must(createPostcard(baseArgs(tape, { windowSec: undefined }))).windowTicks).toBeGreaterThanOrEqual(600);
  });

  test('a non-numeric or non-finite window is refused, not silently defaulted', () => {
    for (const windowSec of [NaN, Infinity, '8', null, {}]) expect(createPostcard(baseArgs(tape, { windowSec }))).toMatchObject({ ok: false, reason: 'window' });
  });

  test('startTick 0, negative, fractional, or beyond the tape is refused; the first and last valid ticks pass', () => {
    const endTick = tape.endTick;
    expect(endTick).toBe(3600);
    for (const startTick of [0, -1, 1.5, NaN, '10', endTick, endTick + 1, 1e9]) {
      expect(createPostcard(baseArgs(tape, { startTick }))).toMatchObject({ ok: false, reason: 'tick' });
    }
    expect(createPostcard(baseArgs(tape, { startTick: 1 })).ok).toBe(true);
    expect(createPostcard(baseArgs(tape, { startTick: endTick - 1 })).ok).toBe(true);
  });
});
