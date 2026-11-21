// Replay Contract v1, section 3.1: synchronous pure-JS SHA-256 and Tier A digests.
import { createHash } from 'node:crypto';
import { CJSONError, canonicalBytes } from '../../src/systems/replay/canonicalJson.js';
import { digestOf, digestOfBytes, sha256Hex, sha256SelfTest } from '../../src/systems/replay/canonicalSha256.js';
import { fixtureBytes, fromHex, loadFixture, prng, resolveInput } from './replayFixtures.js';

const nodeSha = (u8) => createHash('sha256').update(u8).digest('hex');
const enc = (s) => Uint8Array.from(Buffer.from(s, 'utf8'));

function inputBytes(v) {
  if ('ascii' in v) return enc(v.ascii);
  if ('hex' in v) return fromHex(v.hex);
  if ('repeat' in v) return new Uint8Array(v.repeat.count).fill(v.repeat.byte);
  throw new Error(`unknown vector input shape in ${v.id}`);
}

describe('sha256Hex', () => {
  const vectors = loadFixture('hash-vectors.json').sha256;

  test.each(vectors.map((v) => [v.id, v]))('vector %s matches the fixture and node:crypto', (_id, v) => {
    const bytes = inputBytes(v);
    expect(sha256Hex(bytes)).toBe(v.sha256);
    expect(nodeSha(bytes)).toBe(v.sha256);
  });

  test('spec 3.1 NIST vectors, verbatim', () => {
    expect(sha256Hex(enc(''))).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
    expect(sha256Hex(enc('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('every length 0..300 (all padding boundaries) equals node:crypto', () => {
    for (let n = 0; n <= 300; n++) {
      const b = Uint8Array.from({ length: n }, (_, i) => (i * 131 + n * 7) & 255);
      expect([n, sha256Hex(b)]).toEqual([n, nodeSha(b)]);
    }
  });

  test('seeded random buffers up to 20 KB equal node:crypto', () => {
    const rand = prng(0x5a256);
    for (let i = 0; i < 150; i++) {
      const b = Uint8Array.from({ length: rand.int(20000) }, () => rand.int(256));
      expect(sha256Hex(b)).toBe(nodeSha(b));
    }
  });

  test('all-0xff and all-zero inputs around the block size', () => {
    for (const fill of [0x00, 0xff]) {
      for (const n of [55, 56, 57, 63, 64, 65, 127, 128, 129]) {
        const b = new Uint8Array(n).fill(fill);
        expect(sha256Hex(b)).toBe(nodeSha(b));
      }
    }
  });

  test('accepts node Buffers and typed-array views with offsets; does not mutate or retain the input', () => {
    const base = Uint8Array.from({ length: 100 }, (_, i) => i);
    const before = Array.from(base);
    expect(sha256Hex(Buffer.from(base))).toBe(nodeSha(base));
    expect(sha256Hex(base.subarray(10, 90))).toBe(nodeSha(base.subarray(10, 90)));
    expect(Array.from(base)).toEqual(before);
  });

  test('rejects non-byte input', () => {
    for (const bad of ['abc', [1, 2, 3], null, undefined, new Uint16Array(2), 5, {}, new Int8Array(1)]) {
      expect(() => sha256Hex(bad)).toThrow(TypeError);
    }
  });

  test('only Uint8Array / Buffer / ArrayBuffer: other typed arrays throw instead of hashing wrongly', () => {
    const base = Uint8Array.from([0, 1, 2, 3, 250, 255, 128, 127]);
    for (const bad of [new Int8Array(base.buffer), new Uint8ClampedArray(base.buffer), new DataView(base.buffer), new Uint32Array(2), new Float64Array(1)]) {
      expect(() => sha256Hex(bad)).toThrow(TypeError);
      expect(() => digestOfBytes(bad)).toThrow(TypeError);
    }
    expect(sha256Hex(base.buffer)).toBe(nodeSha(base)); // ArrayBuffer is normalized to a view
    expect(sha256Hex(Buffer.from(base))).toBe(nodeSha(base));
  });

  test('self-test passes (short vectors and the NIST million-a vector)', () => {
    expect(sha256SelfTest()).toBe(true);
    expect(sha256SelfTest({ full: true })).toBe(true);
  });
});

describe('digestOf (Tier A identity digest)', () => {
  const vectors = loadFixture('cjson-valid.json');

  test.each(vectors.map((v) => [v.id, v]))('%s: sha256 of the canonical bytes', (_id, v) => {
    const input = resolveInput(v.input);
    expect(digestOf(input)).toBe(v.sha256);
    expect(digestOf(input)).toBe(`sha256:${nodeSha(canonicalBytes(input))}`);
    expect(digestOfBytes(fromHex(v.hex))).toBe(v.sha256);
  });

  test('spec 2.4 digests, verbatim', () => {
    expect(digestOf({})).toBe('sha256:44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a');
    expect(digestOf({ z: [3, 1, 2], a: { y: null, x: true, w: false } })).toBe(
      'sha256:2247629f1fbd78153e4d67314eaf96ac6bf9d3918d86213913bc63f5311ca241',
    );
  });

  test('format is sha256: + 64 lowercase hex, and key order does not matter', () => {
    expect(digestOf({ a: 1, b: 2 })).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(digestOf({ a: 1, b: 2 })).toBe(digestOf({ b: 2, a: 1 }));
    expect(digestOf({ a: 1 })).not.toBe(digestOf({ a: 2 }));
  });

  test('the digest of a canonical file equals `sha256sum file` (node:crypto over the stored bytes)', () => {
    for (const name of ['cjson-valid.json', 'hash-vectors.json', 'fingerprint-vectors.json']) {
      const bytes = fixtureBytes(name);
      expect(digestOfBytes(bytes)).toBe(`sha256:${nodeSha(bytes)}`);
    }
  });

  test('non-canonicalizable values throw CJSONError (never a digest of something altered)', () => {
    for (const bad of [NaN, -0, { a: undefined }, new Date(0), BigInt(1)]) {
      expect(() => digestOf(bad)).toThrow(CJSONError);
    }
  });
});
