// Replay Contract v1, sections 3.2, 6.5, 6.10: XXH32 over bytes, xxh32x2, BB-FP encoder, combined fingerprint.
import { xxHash32 } from '../../src/systems/Rng.js';
import { CJSONError, f64Decode, f64Encode } from '../../src/systems/replay/canonicalJson.js';
import {
  FP_SEED_A,
  FP_SEED_B,
  FP_VERSION,
  FpWriter,
  combineFingerprintBytes,
  combineFingerprints,
  fingerprintOf,
  xxh32Bytes,
  xxh32x2,
} from '../../src/systems/replay/canonicalBinary.js';
import { encodeBySchema, fromHex, loadFixture, prng, randomDouble, randomString, toHex } from './replayFixtures.js';

const utf8 = (s) => Uint8Array.from(Buffer.from(s, 'utf8'));
const hex8 = (n) => n.toString(16).padStart(8, '0');

function vectorBytes(v) {
  if ('utf8' in v) return utf8(v.utf8);
  if ('hex' in v) return fromHex(v.hex);
  throw new Error('bad vector shape');
}

describe('xxh32Bytes', () => {
  const vectors = loadFixture('hash-vectors.json');

  test.each(vectors.xxh32.map((v) => [v.id, v.seed, v]))('vector %s seed %s', (_id, _seed, v) => {
    expect(hex8(xxh32Bytes(vectorBytes(v), v.seed))).toBe(v.xxh32);
  });

  test('spec 3.2 reference values, verbatim', () => {
    expect(hex8(xxh32Bytes(utf8(''), 0))).toBe('02cc5d05');
    expect(hex8(xxh32Bytes(utf8('a'), 0))).toBe('550d7456');
    expect(hex8(xxh32Bytes(utf8('abc'), 0))).toBe('32d153ff');
    expect(hex8(xxh32Bytes(utf8('Nobody inspects the spammish repetition'), 0))).toBe('e2293b2f');
    expect(hex8(xxh32Bytes(utf8('abc'), 0x9e3779b9))).toBe('1bab3a57');
    expect(hex8(xxh32Bytes(Uint8Array.from({ length: 16 }, (_, i) => i), 0))).toBe('b72837f4');
  });

  test('seed defaults to 0 and is taken modulo 2^32', () => {
    const b = utf8('seed handling');
    expect(xxh32Bytes(b)).toBe(xxh32Bytes(b, 0));
    expect(xxh32Bytes(b, -1)).toBe(xxh32Bytes(b, 0xffffffff));
    expect(xxh32Bytes(b, 2 ** 32 + 5)).toBe(xxh32Bytes(b, 5));
  });

  test('returns an unsigned 32-bit integer, accepts views with offsets and Buffers', () => {
    const base = Uint8Array.from({ length: 64 }, (_, i) => i * 3);
    const h = xxh32Bytes(base.subarray(7, 49), 9);
    expect(Number.isInteger(h) && h >= 0 && h <= 0xffffffff).toBe(true);
    expect(h).toBe(xxh32Bytes(Uint8Array.from(base.subarray(7, 49)), 9));
    expect(xxh32Bytes(Buffer.from(base), 9)).toBe(xxh32Bytes(base, 9));
  });

  test('rejects non-byte input', () => {
    for (const bad of ['abc', [1], null, undefined, new Uint16Array(1)]) expect(() => xxh32Bytes(bad)).toThrow(TypeError);
  });
});

describe('xxh32Bytes(utf8(s), seed) === Rng.js xxHash32(s, seed) (Rng.js is untouched)', () => {
  const samples = [
    '',
    'a',
    'abc',
    'Nobody inspects the spammish repetition',
    'RPLAY59',
    'daily-2026-11-21',
    'seed with spaces and punctuation !@#$%^&*()',
    'é',
    'naïve café résumé',
    'ünïcödé wörld, more than sixteen bytes',
    '日本語のテキスト',
    '😀',
    '😀😀😀😀😀',
    'mixed ascii é 日本 😀 tail',
    '\u0000\u0001\u007f',
    'x'.repeat(15),
    'x'.repeat(16),
    'x'.repeat(17),
    'x'.repeat(1000),
  ];
  const seeds = [0, 1, 0x9e3779b9, 0xffffffff, 12345];

  test.each(samples.map((s) => [JSON.stringify(s).slice(0, 30), s]))('sample %s, every seed', (_label, s) => {
    for (const seed of seeds) expect(xxh32Bytes(utf8(s), seed)).toBe(xxHash32(s, seed));
  });

  test('seeded random ASCII and UTF-8 strings, lengths 0..80, random seeds', () => {
    const rand = prng(0xabc);
    for (let i = 0; i < 1500; i++) {
      const s = i % 2 ? randomString(rand) + randomString(rand) : 'k'.repeat(rand.int(80)).replace(/k/g, () => String.fromCharCode(0x20 + rand.int(0x5f)));
      const seed = rand.int(3) === 0 ? 0 : rand.u32();
      expect([s, xxh32Bytes(utf8(s), seed)]).toEqual([s, xxHash32(s, seed)]);
    }
  });
});

describe('xxh32x2 / fingerprintOf', () => {
  const vectors = loadFixture('hash-vectors.json').xxh32x2;

  test.each(vectors.map((v) => [v.id, v]))('vector %s', (_id, v) => {
    const b = fromHex(v.hex);
    expect(xxh32x2(b)).toBe(v.xxh32x2);
    expect(fingerprintOf(b)).toBe(`xxh32x2:${v.xxh32x2}`);
  });

  test('is hex8(XXH32(b, 0)) + hex8(XXH32(b, 0x9E3779B9)); spec value for bytes 00..1f', () => {
    const b = Uint8Array.from({ length: 32 }, (_, i) => i);
    expect(xxh32x2(b)).toBe('830741c1698ff899');
    expect(xxh32x2(b)).toBe(hex8(xxh32Bytes(b, FP_SEED_A)) + hex8(xxh32Bytes(b, FP_SEED_B)));
    expect([FP_SEED_A, FP_SEED_B]).toEqual([0, 0x9e3779b9]);
  });

  test('always 16 lowercase hex, including when high digits are zero', () => {
    const rand = prng(3);
    for (let i = 0; i < 500; i++) {
      expect(xxh32x2(Uint8Array.from({ length: rand.int(40) }, () => rand.int(256)))).toMatch(/^[0-9a-f]{16}$/);
    }
  });
});

describe('FpWriter (BB-FP v1, little-endian)', () => {
  test('u32 / i32 layout and range checks', () => {
    const w = new FpWriter();
    w.u32(1).u32(0xffffffff).i32(-1).i32(-2147483648).i32(2147483647);
    expect(toHex(w.bytes())).toBe('01000000ffffffffffffffff00000080ffffff7f');
    for (const bad of [-1, 4294967296, 1.5, NaN, Infinity, '1', null, undefined, 2 ** 53]) {
      expect(() => new FpWriter().u32(bad)).toThrow(RangeError);
    }
    for (const bad of [-2147483649, 2147483648, 0.5, NaN, -Infinity, '1', null, 4294967295]) {
      expect(() => new FpWriter().i32(bad)).toThrow(RangeError);
    }
  });

  test('a failed write does not change the buffer', () => {
    const w = new FpWriter().u32(7);
    expect(() => w.u32(-1)).toThrow();
    expect(() => w.f64('x')).toThrow();
    expect(() => w.bool(1)).toThrow();
    expect(toHex(w.bytes())).toBe('07000000');
    expect(w.length).toBe(4);
  });

  test('f64: IEEE-754 bits little-endian, -0 and +-Infinity preserved', () => {
    const cases = {
      1.5: '000000000000f83f',
      '-0': '0000000000000080',
      0: '0000000000000000',
      Infinity: '000000000000f07f',
      '-Infinity': '000000000000f0ff',
      0.1: '9a9999999999b93f',
      5e-324: '0100000000000000',
    };
    for (const [k, want] of Object.entries(cases)) {
      expect(toHex(new FpWriter().f64(Number(k)).bytes())).toBe(want);
    }
    expect(() => new FpWriter().f64('1')).toThrow(TypeError);
    expect(() => new FpWriter().f64(null)).toThrow(TypeError);
    expect(() => new FpWriter().f64(1n)).toThrow(TypeError);
  });

  test('f64: every NaN (any sign/payload) becomes 0x7ff8000000000000', () => {
    const want = '000000000000f87f';
    expect(toHex(new FpWriter().f64(NaN).bytes())).toBe(want);
    const dv = new DataView(new ArrayBuffer(8));
    for (const [hi, lo] of [
      [0xfff80000, 0],
      [0x7ff00000, 1],
      [0xffffffff, 0xffffffff],
      [0x7ff12345, 0xdeadbeef],
    ]) {
      dv.setUint32(0, hi);
      dv.setUint32(4, lo);
      const x = dv.getFloat64(0);
      expect(Number.isNaN(x)).toBe(true);
      expect(toHex(new FpWriter().f64(x).bytes())).toBe(want);
    }
  });

  test('bool: strictly true/false as one byte', () => {
    expect(toHex(new FpWriter().bool(true).bool(false).bytes())).toBe('0100');
    for (const bad of [0, 1, 'true', null, undefined]) expect(() => new FpWriter().bool(bad)).toThrow(TypeError);
  });

  test('str: u32 UTF-8 byte length + bytes (not UTF-16 length); lone surrogate throws', () => {
    expect(toHex(new FpWriter().str('').bytes())).toBe('00000000');
    expect(toHex(new FpWriter().str('abc').bytes())).toBe('03000000616263');
    expect(toHex(new FpWriter().str('é😀').bytes())).toBe('06000000c3a9f09f9880');
    expect(() => new FpWriter().str('\ud800')).toThrow(CJSONError);
    expect(() => new FpWriter().str(5)).toThrow(TypeError);
  });

  test('opt: 0 for null, 1 + value otherwise; undefined is a bug', () => {
    const f = (w, v) => w.f64(v);
    expect(toHex(new FpWriter().opt(null, f).bytes())).toBe('00');
    expect(toHex(new FpWriter().opt(1.5, f).bytes())).toBe('01000000000000f83f');
    expect(toHex(new FpWriter().opt(0, (w, v) => w.u32(v)).bytes())).toBe('0100000000');
    expect(() => new FpWriter().opt(undefined, f)).toThrow(TypeError);
  });

  test('list: u32 count then elements; empty list', () => {
    expect(toHex(new FpWriter().list([], (w, v) => w.u32(v)).bytes())).toBe('00000000');
    expect(toHex(new FpWriter().list([1, 2], (w, v) => w.u32(v)).bytes())).toBe('020000000100000002000000');
    const idx = [];
    new FpWriter().list(['a', 'b'], (w, v, i) => idx.push([v, i]));
    expect(idx).toEqual([['a', 0], ['b', 1]]);
  });

  test('records are fields concatenated with no padding or tags', () => {
    const w = new FpWriter();
    w.u32(1).bool(true).f64(1).str('x');
    expect(w.length).toBe(4 + 1 + 8 + 4 + 1);
  });

  test('grows past the initial capacity; reset() reuses the buffer; bytes() is a copy', () => {
    const w = new FpWriter(1);
    for (let i = 0; i < 1000; i++) w.u32(i).f64(i + 0.5);
    expect(w.length).toBe(12000);
    const snap = w.bytes();
    expect(snap.length).toBe(12000);
    w.reset();
    expect(w.length).toBe(0);
    w.u32(42);
    expect(toHex(w.bytes())).toBe('2a000000');
    expect(snap[0]).toBe(0); // earlier copy untouched
    const w2 = new FpWriter().u32(1);
    const b = w2.bytes();
    b[0] = 99;
    expect(toHex(w2.bytes())).toBe('01000000');
  });

  test('seeded random records match an independent Buffer-based encoder byte for byte', () => {
    const rand = prng(0xf9f9);
    for (let i = 0; i < 400; i++) {
      const w = new FpWriter(rand.int(3) ? 4 : 1024);
      const parts = [];
      const n = rand.int(12);
      for (let k = 0; k < n; k++) {
        switch (rand.int(6)) {
          case 0: {
            const v = rand.u32();
            w.u32(v);
            const b = Buffer.alloc(4);
            b.writeUInt32LE(v);
            parts.push(b);
            break;
          }
          case 1: {
            const v = rand.u32() | 0;
            w.i32(v);
            const b = Buffer.alloc(4);
            b.writeInt32LE(v);
            parts.push(b);
            break;
          }
          case 2: {
            const v = randomDouble(rand);
            w.f64(v);
            const b = Buffer.alloc(8);
            if (Number.isNaN(v)) b.writeUInt32LE(0x7ff80000, 4);
            else b.writeDoubleLE(v);
            parts.push(b);
            break;
          }
          case 3: {
            const v = rand.int(2) === 1;
            w.bool(v);
            parts.push(Buffer.from([v ? 1 : 0]));
            break;
          }
          case 4: {
            const s = randomString(rand);
            w.str(s);
            const u = Buffer.from(s, 'utf8');
            const b = Buffer.alloc(4);
            b.writeUInt32LE(u.length);
            parts.push(b, u);
            break;
          }
          default: {
            const v = rand.int(2) ? null : rand.u32();
            w.opt(v, (ww, x) => ww.u32(x));
            if (v === null) parts.push(Buffer.from([0]));
            else {
              const b = Buffer.alloc(5);
              b[0] = 1;
              b.writeUInt32LE(v, 1);
              parts.push(b);
            }
          }
        }
      }
      expect(toHex(w.bytes())).toBe(Buffer.concat(parts).toString('hex'));
    }
  });
});

describe('fingerprint vectors (spec 6.10)', () => {
  const fx = loadFixture('fingerprint-vectors.json');
  const names = Object.keys(fx.subsystems);

  test('fixture covers clock, rng, bsod, sledPose', () => {
    expect(names.sort()).toEqual(['bsod', 'clock', 'rng', 'sledPose']);
  });

  function encodeSubsystem(name) {
    const sub = fx.subsystems[name];
    const def = fx.schemas[name];
    expect(sub.schemaVersion).toBe(def.version);
    const w = new FpWriter();
    w.u32(sub.schemaVersion);
    encodeBySchema(w, def.schema, sub.state);
    return w.bytes();
  }

  test.each(['clock', 'rng', 'bsod', 'sledPose'])('%s: bytes and xxh32x2 digest', (name) => {
    const bytes = encodeSubsystem(name);
    expect(toHex(bytes)).toBe(fx.subsystems[name].bytesHex);
    expect(fingerprintOf(bytes)).toBe(fx.subsystems[name].digest);
  });

  test('spec 6.10 literal digests', () => {
    expect(fx.subsystems.clock.digest).toBe('xxh32x2:ee0baf926a8ed6d3');
    expect(fx.subsystems.rng.digest).toBe('xxh32x2:c100334bfc5d0aad');
    expect(fx.subsystems.bsod.digest).toBe('xxh32x2:eca47c91b23b1ae3');
    expect(fx.subsystems.sledPose.digest).toBe('xxh32x2:4eab99674ff7efe1');
    expect(fx.combined.digest).toBe('xxh32x2:84522c271965fe33');
  });

  function digests() {
    return Object.fromEntries(names.map((n) => [n, fingerprintOf(encodeSubsystem(n))]));
  }

  test('combined bytes and digest over the declared order at the declared tick', () => {
    const { order, tick } = fx.combined;
    const bytes = combineFingerprintBytes(tick, digests(), order);
    expect(toHex(bytes)).toBe(fx.combined.bytesHex);
    expect(combineFingerprints(tick, digests(), order)).toBe(fx.combined.digest);
    // layout: fpVersion | tick | count | 8 bytes per subsystem
    expect(bytes.length).toBe(12 + 8 * order.length);
    expect(Array.from(bytes.subarray(0, 12))).toEqual([FP_VERSION, 0, 0, 0, tick, 0, 0, 0, order.length, 0, 0, 0]);
  });

  test('BSOD-only 1-ulp mutation: bsod and combined change, sledPose does not', () => {
    const m = fx.bsodOnlyMutation;
    expect(m.field).toBe('wallX');
    const orig = f64Decode(m.originalF64);
    const mut = f64Decode(m.mutatedF64);
    expect(mut).not.toBe(orig);
    expect(Object.is(mut, orig)).toBe(false);
    // exactly one ulp apart
    const dv = new DataView(new ArrayBuffer(16));
    dv.setFloat64(0, orig);
    dv.setFloat64(8, mut);
    expect(dv.getBigUint64(8) - dv.getBigUint64(0)).toBe(BigInt(1));
    expect(f64Encode(orig)).toBe(m.originalF64);
    expect(f64Encode(mut)).toBe(m.mutatedF64);

    const state = JSON.parse(JSON.stringify(fx.subsystems.bsod.state));
    expect(state.wallX).toBe(m.originalF64);
    state.wallX = m.mutatedF64;
    const w = new FpWriter().u32(fx.subsystems.bsod.schemaVersion);
    encodeBySchema(w, fx.schemas.bsod.schema, state);
    const mutated = fingerprintOf(w.bytes());
    expect(mutated).toBe(m.bsodDigest);
    expect(mutated).not.toBe(fx.subsystems.bsod.digest);

    const d = digests();
    expect(d.sledPose).toBe(m.sledPoseDigest);
    const after = combineFingerprints(fx.combined.tick, { ...d, bsod: mutated }, fx.combined.order);
    expect(after).toBe(m.combinedDigest);
    expect(after).not.toBe(fx.combined.digest);
    expect(m.sledPoseDigest).toBe(fx.subsystems.sledPose.digest);
  });

  test('flipping any single bit of any subsystem encoding changes its digest', () => {
    for (const n of names) {
      const base = encodeSubsystem(n);
      const baseFp = fingerprintOf(base);
      for (let i = 0; i < base.length; i++) {
        for (let bit = 0; bit < 8; bit += 3) {
          const copy = base.slice();
          copy[i] ^= 1 << bit;
          expect(fingerprintOf(copy)).not.toBe(baseFp);
        }
      }
    }
  });
});

describe('combineFingerprints', () => {
  const order = ['a', 'b', 'c'];
  const d = { a: 'xxh32x2:0123456789abcdef', b: 'xxh32x2:fedcba9876543210', c: 'xxh32x2:0000000000000000' };

  test('layout: u32 version | u32 tick | u32 count | raw 8-byte digests in order', () => {
    expect(toHex(combineFingerprintBytes(7, d, order))).toBe(
      '01000000' + '07000000' + '03000000' + '0123456789abcdef' + 'fedcba9876543210' + '0000000000000000',
    );
    expect(combineFingerprints(7, d, order)).toBe(fingerprintOf(combineFingerprintBytes(7, d, order)));
  });

  test('order matters and tick matters; object key order does not', () => {
    const base = combineFingerprints(1, d, order);
    expect(combineFingerprints(1, d, ['b', 'a', 'c'])).not.toBe(base);
    expect(combineFingerprints(2, d, order)).not.toBe(base);
    expect(combineFingerprints(1, { c: d.c, b: d.b, a: d.a }, order)).toBe(base);
  });

  test('a missing subsystem is an error, never a silent zero', () => {
    const { b, ...rest } = d;
    expect(b).toBeDefined();
    expect(() => combineFingerprints(1, rest, order)).toThrow(/missing digest for subsystem "b"/);
    expect(() => combineFingerprints(1, { ...d, b: undefined }, order)).toThrow();
  });

  test('extra digests, duplicate order entries, malformed digests and bad ticks throw', () => {
    expect(() => combineFingerprints(1, { ...d, z: d.a }, order)).toThrow(/not in the subsystem order/);
    expect(() => combineFingerprints(1, d, ['a', 'a', 'b', 'c'])).toThrow(/duplicate/);
    for (const bad of ['0123456789abcdef', 'xxh32x2:0123456789ABCDEF', 'xxh32x2:0123', 'xxh32x2:0123456789abcdef0', 'sha256:0123456789abcdef', 5, null]) {
      expect(() => combineFingerprints(1, { ...d, a: bad }, order)).toThrow(TypeError);
    }
    for (const t of [-1, 1.5, 2 ** 32, NaN, '1']) expect(() => combineFingerprints(t, d, order)).toThrow(RangeError);
    expect(() => combineFingerprints(1, d, 'abc')).toThrow(TypeError);
  });

  test('prototype keys are not digests (hasOwnProperty, not `in`)', () => {
    expect(() => combineFingerprints(1, {}, ['toString'])).toThrow(/missing digest/);
  });

  test('empty order is legal and hashes the 12-byte header', () => {
    expect(toHex(combineFingerprintBytes(0, {}, []))).toBe('010000000000000000000000');
  });
});
