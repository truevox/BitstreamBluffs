/**
 * #67 Playable Postcards, stage 2a: the pure codec (no RunScene, no network, no storage).
 * `bb-postcard` v1 / `bb-postcard-reply` v1. Jest runs under jsdom, which has no CompressionStream, so the codec is
 * injected (node:zlib raw deflate); a separate block proves the CompressionStream path interoperates with it.
 */
import zlib from 'node:zlib';
import { tapeCompatible } from '../../src/systems/ghost/GhostLibrary.js';
import { validateInputRows, tapeDigest } from '../../src/systems/replay/manifest.js';
import { GhostRecorder, GHOST_TAPE_FORMAT, GHOST_TAPE_VERSION } from '../../src/systems/ghost/GhostTape.js';
import { canonicalBytes, parseCanonical } from '../../src/systems/replay/canonicalJson.js';
import { digestOf } from '../../src/systems/replay/canonicalSha256.js';
import { SIM_TICK_HZ } from '../../src/systems/SimClock.js';
import { RUN_STREAMS, RUN_RANDOM_VERSION } from '../../src/systems/RunRandom.js';
import {
  POSTCARD_KIND, POSTCARD_VERSION, POSTCARD_PREFIX, HEADER_FIELDS,
  MIN_WINDOW_TICKS, MAX_WINDOW_TICKS, MAX_ENCODED_POSTCARD_CHARS,
  MAX_PREFIX_ROWS, MAX_INFLATED_POSTCARD_BYTES, MAX_START_TICK,
  REPLY_KIND, REPLY_VERSION, REPLY_PREFIX, MAX_ENCODED_REPLY_CHARS,
  createReply, encodeReply, decodeReply, replyWire,
  createPostcard, encodePostcard, decodePostcard, postcardWire, postcardCompatible, postcardToTakeoverInput,
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

const f64For = (v) => { const b = Buffer.alloc(8); b.writeDoubleBE(v); return `f64:${b.toString('hex')}`; };
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


// --- stage 2: tamper, corruption, caps, compatibility, takeover adapter -----------------------------------------------

const b64u = (bytes) => Buffer.from(bytes).toString('base64url');
/** Encode ANY wire object the way the codec would, optionally re-signing it, to forge payloads with a valid or stale digest. */
async function forge(pc, mutate, { redigest = true } = {}) {
  const wire = postcardWire(pc);
  mutate(wire);
  if (redigest) { const { digest, ...rest } = wire; wire.digest = digestOf(rest); }
  return POSTCARD_PREFIX + b64u(await zlibCodec.deflate(canonicalBytes(wire)));
}

describe('tamper and corruption', () => {
  const tape = makeTape();
  const pc = must(createPostcard(baseArgs(tape)));
  let good;
  beforeAll(async () => { good = await encodePostcard(pc, OPTS); });

  test('control: an untouched code decodes', async () => {
    expect((await decodePostcard(good, OPTS)).ok).toBe(true);
  });

  test('flipping one prefix row (stale digest) is refused as a digest mismatch', async () => {
    const s = await forge(pc, (w) => { w.prefix[3][2] += 1; }, { redigest: false });
    expect(await decodePostcard(s, OPTS)).toMatchObject({ ok: false, reason: 'digest-mismatch' });
  });

  test('changing startTick, the fingerprint or the challenge (stale digest) is refused as a digest mismatch', async () => {
    for (const m of [(w) => { w.startTick += 1; }, (w) => { w.fingerprintAtStart = 'xxh32x2:ffffffffffffffff'; }, (w) => { w.challenge.speedPxS = f64For(1); },
      (w) => { w.header.seed = 'OTHER'; }, (w) => { w.gameVersion = '9.9.9'; }]) {
      expect(await decodePostcard(await forge(pc, m, { redigest: false }), OPTS)).toMatchObject({ ok: false, reason: 'digest-mismatch' });
    }
  });

  test('flipping any single character of the encoded code never yields a different valid postcard', async () => {
    const body = good.slice(POSTCARD_PREFIX.length);
    let refused = 0; let tried = 0;
    for (let i = 0; i < body.length; i += 5) {
      const ch = body[i] === 'A' ? 'B' : 'A';
      const bad = POSTCARD_PREFIX + body.slice(0, i) + ch + body.slice(i + 1);
      const r = await decodePostcard(bad, OPTS);
      tried++;
      if (!r.ok) refused++; else expect(r.postcard).toEqual(pc); // a flip in unused bits cannot change content
    }
    expect(tried).toBeGreaterThan(50);
    expect(refused).toBe(tried); // base64url is strict-canonical, so even unused-bit flips are refused
  });

  test('negative control: a RE-SIGNED forgery decodes, so the digest is integrity only and the re-simulation is the real check', async () => {
    const s = await forge(pc, (w) => { w.prefix[3][2] += 1; });
    const r = await decodePostcard(s, OPTS);
    expect(r.ok).toBe(true);
    expect(r.postcard.prefix[3][2]).toBe(pc.prefix[3][2] + 1);
  });

  test('unknown top-level or header fields are refused, even when re-signed (strict allowlist)', async () => {
    expect(await decodePostcard(await forge(pc, (w) => { w.extra = 1; }), OPTS)).toMatchObject({ ok: false, reason: 'unknown-field' });
    expect(await decodePostcard(await forge(pc, (w) => { w.header.extra = 1; }), OPTS)).toMatchObject({ ok: false, reason: 'unknown-field' });
    expect(await decodePostcard(await forge(pc, (w) => { w.challenge.extra = 1; }), OPTS)).toMatchObject({ ok: false, reason: 'unknown-field' });
    expect(await decodePostcard(await forge(pc, (w) => { w.header.startedAt = 1767000000000; }), OPTS)).toMatchObject({ ok: false, reason: 'unknown-field' });
    expect(await decodePostcard(await forge(pc, (w) => { w.header.initials = 'ZZZ'; }, { redigest: false }), OPTS)).toMatchObject({ ok: false, reason: 'unknown-field' });
    expect(await decodePostcard(await forge(pc, (w) => { delete w.fingerprintAtStart; }), OPTS)).toMatchObject({ ok: false, reason: 'unknown-field' });
  });

  test('a wrong kind or version is refused, even when re-signed', async () => {
    expect(await decodePostcard(await forge(pc, (w) => { w.kind = 'bb-postcard-reply'; }), OPTS)).toMatchObject({ ok: false, reason: 'kind' });
    expect(await decodePostcard(await forge(pc, (w) => { w.kind = 'nope'; }), OPTS)).toMatchObject({ ok: false, reason: 'kind' });
    expect(await decodePostcard(await forge(pc, (w) => { w.v = 2; }), OPTS)).toMatchObject({ ok: false, reason: 'version' });
    expect(await decodePostcard(await forge(pc, (w) => { w.v = '1'; }), OPTS)).toMatchObject({ ok: false, reason: 'version' });
  });

  test('out-of-range or inconsistent values are refused even when re-signed', async () => {
    const bad = [
      (w) => { w.startTick = 0; }, (w) => { w.startTick = MAX_START_TICK + 1; }, (w) => { w.startTick = 1.5; },
      (w) => { w.windowTicks = 599; }, (w) => { w.windowTicks = 1201; },
      (w) => { w.fingerprintAtStart = 'xxh32x2:XYZ'; },
      (w) => { w.prefix.push([5000, 0, 0]); }, // beyond startTick
      (w) => { w.prefix[0][0] = 0; }, (w) => { w.prefix[0][1] = 0x100000; }, (w) => { w.prefix[0][2] = 200; },
      (w) => { w.simRevision = 8; }, // differs from header.simRevision
      (w) => { w.buildId = `sha256:${'cc'.repeat(32)}`; },
      (w) => { w.header.mode = 'takeover'; }, (w) => { w.header.syncLevel = 0; }, (w) => { w.header.startPose = w.header.startPose.slice(1); },
      (w) => { w.header.startPose[0] = 'f64:zz'; }, (w) => { w.header.edgeRows = 'legacy'; },
      (w) => { w.challenge.speedPxS = f64For(-5); }, (w) => { w.challenge.bsodGapPx = f64For(-1); }, (w) => { w.challenge.angVel = 12; },
      (w) => { w.gameVersion = 'v<script>'; },
    ];
    for (const [i, m] of bad.entries()) {
      const r = await decodePostcard(await forge(pc, m), OPTS);
      expect({ i, ok: r.ok, src: String(m) }).toMatchObject({ i, ok: false });
    }
    // a malformed or absent digest (no re-signing)
    for (const d of ['nope', '', 5, null, `sha256:${'0'.repeat(64)}`]) {
      expect((await decodePostcard(await forge(pc, (w) => { w.digest = d; }, { redigest: false }), OPTS)).ok).toBe(false);
    }
  });

  test('wrong prefix, non-strings and corrupt base64 are refused', async () => {
    const body = good.slice(POSTCARD_PREFIX.length);
    expect(await decodePostcard(`BBPX1.${body}`, OPTS)).toMatchObject({ ok: false, reason: 'bad-prefix' });
    expect(await decodePostcard(body, OPTS)).toMatchObject({ ok: false, reason: 'bad-prefix' });
    expect(await decodePostcard(`BBPR1.${body}`, OPTS)).toMatchObject({ ok: false, reason: 'bad-prefix' });
    for (const v of [null, undefined, 42, {}, []]) expect(await decodePostcard(v, OPTS)).toMatchObject({ ok: false, reason: 'bad-prefix' });
    for (const junk of ['!!!!', 'AAAA====', `${body}=`, `${body}+/`, ' ' + body, `${body}\n`, 'A', '', 'AAAAA']) {
      expect((await decodePostcard(POSTCARD_PREFIX + junk, OPTS)).ok).toBe(false);
    }
    expect(await decodePostcard(`${POSTCARD_PREFIX}!!!!`, OPTS)).toMatchObject({ ok: false, reason: 'bad-encoding' });
  });

  test('corrupt deflate, truncated deflate, non-JSON and non-canonical JSON are refused', async () => {
    const body = Buffer.from(good.slice(POSTCARD_PREFIX.length), 'base64url');
    expect(await decodePostcard(POSTCARD_PREFIX + b64u(Buffer.from('garbage-not-deflate-at-all-0123456789')), OPTS)).toMatchObject({ ok: false, reason: 'bad-compression' });
    expect((await decodePostcard(POSTCARD_PREFIX + b64u(body.subarray(0, Math.floor(body.length / 2))), OPTS)).ok).toBe(false);
    const wrap = async (bytes) => POSTCARD_PREFIX + b64u(await zlibCodec.deflate(bytes));
    expect(await decodePostcard(await wrap(Buffer.from('not json')), OPTS)).toMatchObject({ ok: false, reason: 'bad-json' });
    expect(await decodePostcard(await wrap(Buffer.from('[1,2]')), OPTS)).toMatchObject({ ok: false, reason: 'bad-json' });
    // valid JSON that is not CANONICAL (pretty-printed, key order): refused, so one postcard has exactly one byte form
    const pretty = Buffer.from(JSON.stringify(postcardWire(pc), null, 2));
    expect(await decodePostcard(await wrap(pretty), OPTS)).toMatchObject({ ok: false, reason: 'bad-json' });
    const reordered = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(postcardWire(pc)).reverse())));
    expect(await decodePostcard(await wrap(reordered), OPTS)).toMatchObject({ ok: false, reason: 'bad-json' });
  });

  test('with no CompressionStream and no injected codec, decode and encode fail closed (unsupported-browser)', async () => {
    expect(typeof globalThis.CompressionStream).toBe('undefined'); // jsdom
    expect(await decodePostcard(good)).toMatchObject({ ok: false, reason: 'unsupported-browser' });
    await expect(encodePostcard(pc)).rejects.toMatchObject({ code: 'unsupported-browser' });
  });
});

describe('size caps', () => {
  /** A tape that changes pad every tick with pseudo-random bits: close to the worst case for deflate. */
  function noisyTape(rows) {
    let x = 0x12345;
    const rnd = () => { x ^= x << 13; x >>>= 0; x ^= x >>> 17; x ^= x << 5; x >>>= 0; return x; };
    const rec = new GhostRecorder({ ...REAL_HEADER() });
    for (let t = 1; t <= rows + 10; t++) {
      const r = rnd();
      rec.input(t, { push: !!(r & 1), tilt: ((r >>> 8) % 255 - 127) / 127, variableHop: !!(r & 2), noAutoNudge: !!(r & 4), divebomb: !!(r & 8), corkscrew: !!(r & 16),
        tuck: !!(r & 32), brakeHeld: !!(r & 64), hop: !!(r & 128), reset: false, heli: ((r >>> 16) % 3) - 1, airBrake: !!(r & 1024), parachute: !!(r & 2048), pause: false,
        pressed: { hop: !!(r & 4096), reset: false, pause: false, airBrake: !!(r & 8192), parachute: false, confirm: false } });
    }
    rec.lastTick = rows + 10;
    return rec.finish({ runId: 'r', distanceM: 1, score: 1 });
  }

  test('the largest legal postcard (30000 near-random rows) still encodes under the cap, with measured headroom', async () => {
    const t = noisyTape(MAX_PREFIX_ROWS);
    expect(t.inputs.length).toBeGreaterThanOrEqual(MAX_PREFIX_ROWS);
    const pc = must(createPostcard(baseArgs(t, { startTick: MAX_PREFIX_ROWS })));
    expect(pc.prefix.length).toBe(MAX_PREFIX_ROWS);
    const str = await encodePostcard(pc, OPTS);
    expect(str.length).toBeLessThan(MAX_ENCODED_POSTCARD_CHARS);
    expect(str.length).toBeLessThan(MAX_ENCODED_POSTCARD_CHARS * 0.8);
    expect(canonicalBytes(postcardWire(pc)).length).toBeLessThan(MAX_INFLATED_POSTCARD_BYTES);
    expect((await decodePostcard(str, OPTS)).ok).toBe(true);
  });

  test('more than MAX_PREFIX_ROWS rows is refused at create', () => {
    const t = noisyTape(MAX_PREFIX_ROWS + 500);
    expect(createPostcard(baseArgs(t, { startTick: MAX_PREFIX_ROWS + 400 }))).toMatchObject({ ok: false, reason: 'tape' });
  });

  test('negative control: encode refuses to emit a code over the cap (no compression)', async () => {
    const t = noisyTape(MAX_PREFIX_ROWS);
    const pc = must(createPostcard(baseArgs(t, { startTick: MAX_PREFIX_ROWS })));
    const identity = { deflate: async (b) => b, inflate: async (b) => b };
    await expect(encodePostcard(pc, { codec: identity })).rejects.toMatchObject({ code: 'too-large' });
  });

  test('decode refuses an over-long string before parsing anything', async () => {
    const long = POSTCARD_PREFIX + 'A'.repeat(MAX_ENCODED_POSTCARD_CHARS);
    expect(await decodePostcard(long, OPTS)).toMatchObject({ ok: false, reason: 'too-large' });
    // one char under the cap is NOT a size refusal (it fails later, as corrupt)
    const under = POSTCARD_PREFIX + 'A'.repeat(MAX_ENCODED_POSTCARD_CHARS - POSTCARD_PREFIX.length);
    expect((await decodePostcard(under, OPTS)).reason).not.toBe('too-large');
  });

  test('decompression bomb: a tiny code that inflates past the inflate cap is refused as too-large', async () => {
    const bomb = POSTCARD_PREFIX + b64u(await zlibCodec.deflate(Buffer.alloc(5 * 1024 * 1024, 0x20)));
    expect(bomb.length).toBeLessThan(MAX_ENCODED_POSTCARD_CHARS / 10); // it would sail through the char cap
    expect(await decodePostcard(bomb, OPTS)).toMatchObject({ ok: false, reason: 'too-large' });
  });
});

describe('compatibility', () => {
  const pc = must(createPostcard(baseArgs(makeTape())));

  test('the exact simRevision, rulesetId and buildId is compatible', () => {
    expect(postcardCompatible(pc, IDENTITY)).toEqual({ ok: true });
    expect(postcardCompatible(pc, { ...IDENTITY, gameVersion: '9.9.9' })).toEqual({ ok: true }); // game version is informational
  });

  test('a different simRevision, rulesetId or buildId is other-build', () => {
    expect(postcardCompatible(pc, { ...IDENTITY, simRevision: 10 })).toMatchObject({ ok: false, reason: 'other-build' });
    expect(postcardCompatible(pc, { ...IDENTITY, rulesetId: `sha256:${'00'.repeat(32)}` })).toMatchObject({ ok: false, reason: 'other-build' });
    expect(postcardCompatible(pc, { ...IDENTITY, buildId: `sha256:${'00'.repeat(32)}` })).toMatchObject({ ok: false, reason: 'other-build' });
  });

  test('an incomplete current identity never matches (fail closed)', () => {
    for (const bad of [null, undefined, {}, { ...IDENTITY, buildId: null }, { ...IDENTITY, rulesetId: '' }, { ...IDENTITY, simRevision: '9' }]) {
      expect(postcardCompatible(pc, bad).ok).toBe(false);
    }
  });

  test('create refuses a tape recorded on another build, and a missing identity', () => {
    expect(createPostcard(baseArgs(makeTape({ header: { simRevision: 8 } })))).toMatchObject({ ok: false, reason: 'other-build' });
    expect(createPostcard(baseArgs(makeTape({ header: { rulesetId: `sha256:${'00'.repeat(32)}` } })))).toMatchObject({ ok: false, reason: 'other-build' });
    expect(createPostcard(baseArgs(makeTape({ header: { buildId: `sha256:${'00'.repeat(32)}` } })))).toMatchObject({ ok: false, reason: 'other-build' });
    expect(createPostcard(baseArgs(makeTape(), { identity: { ...IDENTITY, buildId: null } }))).toMatchObject({ ok: false, reason: 'identity' });
    expect(createPostcard(baseArgs(makeTape(), { identity: undefined }))).toMatchObject({ ok: false, reason: 'identity' });
  });

  test('a tape stamped before the build id was known (buildId null) takes the creating build id; one with no rulesetId is refused', () => {
    expect(must(createPostcard(baseArgs(makeTape({ header: { buildId: null } })))).buildId).toBe(BUILD);
    const noRuleset = makeTape(); delete noRuleset.rulesetId;
    expect(createPostcard(baseArgs(noRuleset)).ok).toBe(false);
  });

  test('create validates the fingerprint and the challenge', () => {
    const t = makeTape();
    for (const fingerprintAtStart of [undefined, '', 'abc', 'xxh32x2:123', 'sha256:' + 'a'.repeat(64)]) expect(createPostcard(baseArgs(t, { fingerprintAtStart }))).toMatchObject({ ok: false, reason: 'fingerprint' });
    const ok = { speedPxS: 1, angVel: 0, parachuteFuel: null, hazardPhase: null, bsodGapPx: null };
    for (const challenge of [undefined, null, {}, { ...ok, extra: 1 }, { ...ok, speedPxS: NaN }, { ...ok, speedPxS: -1 }, { ...ok, angVel: Infinity }, { ...ok, parachuteFuel: -1 },
      { ...ok, hazardPhase: '0.5' }, { ...ok, bsodGapPx: -0.5 }, { speedPxS: 1, angVel: 0 }]) {
      expect(createPostcard(baseArgs(t, { challenge }))).toMatchObject({ ok: false, reason: 'challenge' });
    }
    expect(createPostcard(baseArgs(t, { challenge: ok })).ok).toBe(true);
  });
});

describe('postcardToTakeoverInput: the tape-shaped object #72 consumes', () => {
  const pc = must(createPostcard(baseArgs(makeTape())));
  const input = postcardToTakeoverInput(pc);

  /** A local mirror of #72's takeoverEligible checks (wt-72 Takeover.js), minus the checkpoint/trace COVERAGE test. */
  function eligibleExceptCoverage(tape, tick, rulesetId) {
    if (tape.format !== GHOST_TAPE_FORMAT || !tapeCompatible(tape)) return 'undecodable';
    if (!Number.isSafeInteger(tape.endTick) || tape.endTick < 1 || !Array.isArray(tape.inputs) || !Array.isArray(tape.checkpoints)) return 'undecodable';
    try { validateInputRows(tape.inputs, tape.endTick); } catch { return 'undecodable'; }
    if (tape.mode !== 'normal') return 'mode';
    if (tape.simRevision !== 9) return 'sim-revision';
    if (typeof tape.rulesetId !== 'string' || tape.rulesetId !== rulesetId) return 'ruleset-mismatch';
    if (typeof tape.seed !== 'string' || !tape.seed || !Number.isSafeInteger(tape.biomeMask)) return 'course';
    if (!Array.isArray(tape.boosts) || !('upgradeRanks' in tape) || !Number.isSafeInteger(tape.syncLevel) || tape.syncLevel < 1) return 'loadout';
    if (!Number.isSafeInteger(tick) || tick < 1 || tick > tape.endTick - 1) return 'tick';
    return null;
  }

  test('it is a descriptor-input {tape, tick, source} that passes the eligibility checks #72 applies to the tape itself', () => {
    expect(input.tick).toBe(pc.startTick);
    expect(input.source).toBe('postcard');
    expect(eligibleExceptCoverage(input.tape, input.tick, RULESET)).toBeNull();
    expect(input.tape.format).toBe(GHOST_TAPE_FORMAT);
    expect(input.tape.version).toBe(GHOST_TAPE_VERSION);
    expect(input.tape.mode).toBe('normal');
    expect(input.tape.endTick).toBe(pc.startTick + pc.windowTicks);
    expect(input.tape.inputs).toEqual(pc.prefix);
    expect(input.tape.startPose).toEqual(REAL_HEADER().startPose);
    expect(input.tape.random).toEqual(REAL_HEADER().random);
    expect(input.tape.bsod).toEqual(REAL_HEADER().bsod);
    expect(tapeDigest(input.tape)).toMatch(/^sha256:/); // the digest #72's descriptor takes of it is computable
  });

  test('it carries what RunScene needs to verify the re-simulation: the expected fingerprint, and the honest coverage mode', () => {
    expect(input.expectedFingerprint).toBe(FP);
    expect(input.postcardDigest).toBe(pc.digest);
    expect(input.windowTicks).toBe(pc.windowTicks);
    expect(input.challenge).toEqual(pc.challenge);
    // A postcard has NO per-second checkpoints and NO trace (it proves the start by fingerprint only). #72's
    // takeoverEligible demands both for ticks >= 120, so it must be told. See the report: this is the rebase reconciliation point.
    expect(input.coverage).toBe('fingerprint-only');
    expect(input.tape.checkpoints).toEqual([]);
    expect(input.tape.trace).toBe('');
  });

  test('it is a deep, independent copy, and holds none of the private fields', () => {
    input.tape.inputs[0][1] = 999; input.tape.startPose[0] = -1; input.tape.random.visualFx = 0;
    expect(pc.prefix[0][1]).not.toBe(999);
    expect(pc.header.startPose[0]).toBe(100.5);
    expect(pc.header.random.visualFx).toBe(2);
    const json = JSON.stringify(postcardToTakeoverInput(pc));
    for (const n of ['startedAt', 'controlLayout', 'initials', 'profile', 'run-PRIVATE', 'endedAt', 'distanceM']) expect(json).not.toContain(n);
  });

  test('negative control: the mirror check really fails on a bad tape (not vacuous)', () => {
    expect(eligibleExceptCoverage({ ...input.tape, mode: 'daily' }, input.tick, RULESET)).toBe('mode');
    expect(eligibleExceptCoverage(input.tape, input.tape.endTick, RULESET)).toBe('tick');
    expect(eligibleExceptCoverage(input.tape, input.tick, `sha256:${'00'.repeat(32)}`)).toBe('ruleset-mismatch');
    expect(eligibleExceptCoverage({ ...input.tape, physicsVersion: 99 }, input.tick, RULESET)).toBe('undecodable');
  });

  test('a postcard that decoded from a code converts exactly like the original', async () => {
    const dec = await decodePostcard(await encodePostcard(pc, OPTS), OPTS);
    expect(postcardToTakeoverInput(dec.postcard)).toEqual(postcardToTakeoverInput(pc));
  });
});


// --- stage 3: the outcome reply ---------------------------------------------------------------------------------------

describe('bb-postcard-reply', () => {
  const pc = must(createPostcard(baseArgs(makeTape({ header: { initials: 'ZZZ', profile: { name: 'Ada' } } }))));
  const suffix = [[10, 7, 0], [30, 39, 64], [5, 7, -127]]; // offsets from tick N: 10, 40, 45
  const survived = { postcard: pc, outcome: 'survived', crashOffsetTicks: null, suffix };
  const crashed = { postcard: pc, outcome: 'crashed', crashOffsetTicks: 300, suffix };
  const mustReply = (r) => { expect(r).toMatchObject({ ok: true }); return r.reply; };
  const replyForge = async (reply, mutate, { redigest = true } = {}) => {
    const wire = replyWire(reply);
    mutate(wire);
    if (redigest) { const { digest, ...rest } = wire; wire.digest = digestOf(rest); }
    return REPLY_PREFIX + b64u(await zlibCodec.deflate(canonicalBytes(wire)));
  };

  test('shape: kind, version, the explicit unranked marker, a postcard binding, and nothing else', () => {
    const r = mustReply(createReply(survived));
    expect(Object.keys(r).sort()).toEqual(['crashOffsetTicks', 'digest', 'kind', 'outcome', 'postcardDigest', 'suffix', 'unranked', 'v']);
    expect(r).toMatchObject({ kind: REPLY_KIND, v: REPLY_VERSION, unranked: true, postcardDigest: pc.digest, outcome: 'survived', crashOffsetTicks: null, suffix });
    expect(REPLY_PREFIX).toBe('BBPR1.');
    expect(r.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });

  test('round trip survived and crashed; deterministic; prefix BBPR1.', async () => {
    for (const args of [survived, crashed, { ...survived, suffix: [] }]) {
      const r = mustReply(createReply(args));
      const s = await encodeReply(r, OPTS);
      expect(s.startsWith('BBPR1.')).toBe(true);
      expect(s).toBe(await encodeReply(mustReply(createReply(args)), OPTS));
      expect(await decodeReply(s, OPTS)).toEqual({ ok: true, reply: r });
      expect(await decodeReply(s, { ...OPTS, postcard: pc })).toEqual({ ok: true, reply: r });
    }
  });

  test('the reply holds no PII: nothing of the postcard header, tape or profile is in the code or its inflated JSON', async () => {
    const s = await encodeReply(mustReply(createReply(crashed)), OPTS);
    const inflated = Buffer.from(zlib.inflateRawSync(Buffer.from(s.slice(6), 'base64url'))).toString('utf8');
    for (const n of ['startedAt', 'ZZZ', 'Ada', 'profile', 'initials', 'POSTCARD-SEED', 'seed', 'run-PRIVATE', 'runId', 'startPose', 'header', 'prefix', 'score', 'wallet']) {
      expect(inflated).not.toContain(n); expect(s).not.toContain(n);
    }
    expect(inflated).toContain('"unranked":true'); // negative control: the grep sees real content
  });

  test('create validates the outcome, the crash offset and the suffix against the postcard', () => {
    const bad = [
      { ...survived, outcome: 'won' }, { ...survived, outcome: undefined },
      { ...survived, crashOffsetTicks: 5 }, // survived must carry null
      { ...crashed, crashOffsetTicks: null }, { ...crashed, crashOffsetTicks: 0 }, { ...crashed, crashOffsetTicks: pc.windowTicks + 1 }, { ...crashed, crashOffsetTicks: 1.5 },
      { ...survived, suffix: [[0, 0, 0]] }, { ...survived, suffix: [[1, 0x100000, 0]] }, { ...survived, suffix: [[1, 0, 200]] }, { ...survived, suffix: [[pc.windowTicks + 1, 0, 0]] },
      { ...survived, suffix: 'nope' }, { ...survived, suffix: undefined },
      { ...crashed, crashOffsetTicks: 20, suffix }, // an input row after the crash tick
      { postcard: { ...pc, digest: 'nope' }, outcome: 'survived', crashOffsetTicks: null, suffix: [] },
      { postcard: null, outcome: 'survived', crashOffsetTicks: null, suffix: [] },
    ];
    for (const [i, a] of bad.entries()) expect({ i, ok: createReply(a).ok }).toEqual({ i, ok: false });
    expect(createReply({ ...survived, suffix: [[pc.windowTicks, 0, 0]] }).ok).toBe(true); // the last tick of the window is fine
  });

  test('tamper: a flipped suffix row (stale digest) is a digest mismatch; any single-character flip is refused', async () => {
    const r = mustReply(createReply(crashed));
    expect(await decodeReply(await replyForge(r, (w) => { w.suffix[1][2] += 1; }, { redigest: false }), OPTS)).toMatchObject({ ok: false, reason: 'digest-mismatch' });
    expect(await decodeReply(await replyForge(r, (w) => { w.postcardDigest = `sha256:${'ab'.repeat(32)}`; }, { redigest: false }), OPTS)).toMatchObject({ ok: false, reason: 'digest-mismatch' });
    const good = await encodeReply(r, OPTS);
    for (let i = REPLY_PREFIX.length; i < good.length; i++) {
      const bad = good.slice(0, i) + (good[i] === 'A' ? 'B' : 'A') + good.slice(i + 1);
      const d = await decodeReply(bad, OPTS);
      expect(d.ok).toBe(false);
    }
  });

  test('unranked:true is REQUIRED: absent, false or any other value is refused, even when re-signed', async () => {
    const r = mustReply(createReply(survived));
    expect(await decodeReply(await replyForge(r, (w) => { delete w.unranked; }), OPTS)).toMatchObject({ ok: false, reason: 'unranked' });
    for (const v of [false, 'true', 1, null]) expect(await decodeReply(await replyForge(r, (w) => { w.unranked = v; }), OPTS)).toMatchObject({ ok: false, reason: 'unranked' });
    expect((await decodeReply(await replyForge(r, () => {}), OPTS)).ok).toBe(true); // control: the forge helper itself is sound
  });

  test('wrong kind or version, unknown fields, and cross-format mixups are refused', async () => {
    const r = mustReply(createReply(survived));
    expect(await decodeReply(await replyForge(r, (w) => { w.kind = 'bb-postcard'; }), OPTS)).toMatchObject({ ok: false, reason: 'kind' });
    expect(await decodeReply(await replyForge(r, (w) => { w.v = 2; }), OPTS)).toMatchObject({ ok: false, reason: 'version' });
    expect(await decodeReply(await replyForge(r, (w) => { w.initials = 'ZZZ'; }), OPTS)).toMatchObject({ ok: false, reason: 'unknown-field' });
    expect(await decodeReply(await replyForge(r, (w) => { w.score = 5; }), OPTS)).toMatchObject({ ok: false, reason: 'unknown-field' });
    const postcardCode = await encodePostcard(pc, OPTS);
    expect(await decodeReply(postcardCode, OPTS)).toMatchObject({ ok: false, reason: 'bad-prefix' });
    expect(await decodePostcard(await encodeReply(r, OPTS), OPTS)).toMatchObject({ ok: false, reason: 'bad-prefix' });
    expect(await decodeReply(await replyForge(r, (w) => { w.postcardDigest = 'x'; }), OPTS)).toMatchObject({ ok: false, reason: 'invalid-field' });
    expect(await decodeReply(await replyForge(r, (w) => { w.outcome = 'crashed'; }), OPTS)).toMatchObject({ ok: false, reason: 'invalid-field' }); // crashed needs an offset
    expect(await decodeReply(await replyForge(r, (w) => { w.crashOffsetTicks = 5; }), OPTS)).toMatchObject({ ok: false, reason: 'invalid-field' });
  });

  test('bound to its postcard: a reply for another postcard, or one outside this postcard window, is refused when the postcard is supplied', async () => {
    const other = must(createPostcard(baseArgs(makeTape(), { startTick: 1300 })));
    const s = await encodeReply(mustReply(createReply(crashed)), OPTS);
    expect(await decodeReply(s, { ...OPTS, postcard: other })).toMatchObject({ ok: false, reason: 'mismatch' });
    const long = must(createPostcard(baseArgs(makeTape(), { windowSec: 10 })));
    const longCrash = mustReply(createReply({ postcard: long, outcome: 'crashed', crashOffsetTicks: 1100, suffix: [[1100, 0, 0]] }));
    const short = must(createPostcard(baseArgs(makeTape(), { windowSec: 5 })));
    const forged = await replyForge(longCrash, (w) => { w.postcardDigest = short.digest; });
    expect(await decodeReply(forged, { ...OPTS, postcard: short })).toMatchObject({ ok: false, reason: 'invalid-field' });
  });

  test('size cap: an over-long reply is refused before parsing; an inflate bomb is refused', async () => {
    expect(await decodeReply(REPLY_PREFIX + 'A'.repeat(MAX_ENCODED_REPLY_CHARS), OPTS)).toMatchObject({ ok: false, reason: 'too-large' });
    const bomb = REPLY_PREFIX + b64u(await zlibCodec.deflate(Buffer.alloc(2 * 1024 * 1024, 0x20)));
    expect(await decodeReply(bomb, OPTS)).toMatchObject({ ok: false, reason: 'too-large' });
    const biggest = mustReply(createReply({ ...survived, suffix: Array.from({ length: pc.windowTicks }, (_, i) => [1, i % 2 ? 7 : 39, ((i * 53) % 255) - 127]) }));
    expect((await encodeReply(biggest, OPTS)).length).toBeLessThan(MAX_ENCODED_REPLY_CHARS);
  });
});

// --- the browser path: CompressionStream('deflate-raw') ---------------------------------------------------------------

describe('CompressionStream codec (the browser path), simulated with node:stream/web', () => {
  const saved = {};
  const names = ['CompressionStream', 'DecompressionStream', 'ReadableStream'];
  beforeAll(async () => {
    const web = await import('node:stream/web');
    for (const n of names) { saved[n] = globalThis[n]; globalThis[n] = web[n]; }
  });
  afterAll(() => { for (const n of names) { if (saved[n] === undefined) delete globalThis[n]; else globalThis[n] = saved[n]; } });

  test('the default codec round-trips with no injected codec, and interoperates with the zlib codec both ways', async () => {
    const pc = must(createPostcard(baseArgs(makeTape())));
    const viaStream = await encodePostcard(pc); // no opts: uses CompressionStream
    expect((await decodePostcard(viaStream)).postcard).toEqual(pc);
    expect((await decodePostcard(viaStream, OPTS)).postcard).toEqual(pc); // browser-made code opens under node zlib
    const viaZlib = await encodePostcard(pc, OPTS);
    expect((await decodePostcard(viaZlib)).postcard).toEqual(pc); // and the other way round
    // the digest is over canonical JSON, so identity does not depend on which deflater ran
    expect((await decodePostcard(viaStream)).postcard.digest).toBe((await decodePostcard(viaZlib)).postcard.digest);
  });

  test('the default codec refuses a bomb and corrupt data without throwing', async () => {
    const bomb = POSTCARD_PREFIX + b64u(await zlibCodec.deflate(Buffer.alloc(5 * 1024 * 1024, 0x20)));
    expect(await decodePostcard(bomb)).toMatchObject({ ok: false, reason: 'too-large' });
    expect(await decodePostcard(POSTCARD_PREFIX + b64u(Buffer.from('definitely not deflate data 0123456789')))).toMatchObject({ ok: false, reason: 'bad-compression' });
  });
});
