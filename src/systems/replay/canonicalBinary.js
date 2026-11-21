/**
 * Tier B frame-fingerprint primitives for Replay Contract v1 (docs/replay/replay-contract-v1.md, sections 3.2, 6.5).
 *
 *  - xxh32Bytes / xxh32x2: XXH32 over raw bytes (a bytes twin of Rng.js's string xxHash32, which stays untouched
 *    because ledger hashes depend on it) and the 64-bit `xxh32x2` pair (seeds 0 and 0x9E3779B9).
 *  - FpWriter: the BB-FP v1 little-endian binary encoder (the bytes that get hashed), with range checks.
 *  - combineFingerprints: the per-frame combined digest over per-subsystem digests.
 *
 * Fingerprints are drift detectors, never proofs: XXH32 is not collision resistant against an adversary.
 * Pure module: no Phaser, no clock, no randomness.
 */
import { utf8Encode } from './canonicalJson.js';

const P1 = 2654435761;
const P2 = 2246822519;
const P3 = 3266489917;
const P4 = 668265263;
const P5 = 374761393;
const rotl = (x, r) => ((x << r) | (x >>> (32 - r))) >>> 0;

export const FP_VERSION = 1;
export const FP_SEED_A = 0x00000000;
export const FP_SEED_B = 0x9e3779b9;
export const FP_PREFIX = 'xxh32x2:';
const FP_DIGEST_RE = /^xxh32x2:[0-9a-f]{16}$/;

const isBytes = (b) => ArrayBuffer.isView(b) && b.BYTES_PER_ELEMENT === 1;
const hex8 = (n) => (n >>> 0).toString(16).padStart(8, '0');

/**
 * XXH32 of raw bytes.
 * @param {Uint8Array} b
 * @param {number} [seed=0] 32-bit seed
 * @returns {number} unsigned 32-bit
 */
export function xxh32Bytes(b, seed = 0) {
  if (!isBytes(b)) throw new TypeError('xxh32Bytes expects a Uint8Array');
  const len = b.length;
  seed >>>= 0;
  const lane = (i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0;
  let p = 0;
  let h;
  if (len >= 16) {
    let v1 = (seed + P1 + P2) >>> 0;
    let v2 = (seed + P2) >>> 0;
    let v3 = seed;
    let v4 = (seed - P1) >>> 0;
    const limit = len - 16;
    while (p <= limit) {
      v1 = Math.imul(rotl((v1 + Math.imul(lane(p), P2)) >>> 0, 13), P1) >>> 0;
      v2 = Math.imul(rotl((v2 + Math.imul(lane(p + 4), P2)) >>> 0, 13), P1) >>> 0;
      v3 = Math.imul(rotl((v3 + Math.imul(lane(p + 8), P2)) >>> 0, 13), P1) >>> 0;
      v4 = Math.imul(rotl((v4 + Math.imul(lane(p + 12), P2)) >>> 0, 13), P1) >>> 0;
      p += 16;
    }
    h = (rotl(v1, 1) + rotl(v2, 7) + rotl(v3, 12) + rotl(v4, 18)) >>> 0;
  } else {
    h = (seed + P5) >>> 0;
  }
  h = (h + len) >>> 0;
  while (p + 4 <= len) {
    h = (h + Math.imul(lane(p), P3)) >>> 0;
    h = Math.imul(rotl(h, 17), P4) >>> 0;
    p += 4;
  }
  while (p < len) {
    h = (h + Math.imul(b[p], P5)) >>> 0;
    h = Math.imul(rotl(h, 11), P1) >>> 0;
    p++;
  }
  h ^= h >>> 15;
  h = Math.imul(h, P2) >>> 0;
  h ^= h >>> 13;
  h = Math.imul(h, P3) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}

/**
 * 64-bit fingerprint body: `hex8(XXH32(bytes, 0)) + hex8(XXH32(bytes, 0x9E3779B9))` (16 lowercase hex, no prefix).
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function xxh32x2(bytes) {
  return hex8(xxh32Bytes(bytes, FP_SEED_A)) + hex8(xxh32Bytes(bytes, FP_SEED_B));
}

/**
 * Tier B fingerprint string: `xxh32x2:` + 16 lowercase hex.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function fingerprintOf(bytes) {
  return FP_PREFIX + xxh32x2(bytes);
}

/**
 * BB-FP v1 binary encoder (section 6.5). Little-endian, schema-driven (field names are not encoded), no padding, no
 * tags. Callers write `u32 schemaVersion` first, then fields in schema order. Growable; reusable via reset().
 */
export class FpWriter {
  /** @param {number} [capacity=256] initial buffer size in bytes */
  constructor(capacity = 256) {
    this.buf = new Uint8Array(Math.max(16, capacity | 0));
    this.view = new DataView(this.buf.buffer);
    this.len = 0;
  }

  /** Bytes written so far. */
  get length() {
    return this.len;
  }

  /** Discard written bytes and keep the buffer. @returns {this} */
  reset() {
    this.len = 0;
    return this;
  }

  _need(n) {
    const want = this.len + n;
    if (want <= this.buf.length) return;
    let cap = this.buf.length;
    while (cap < want) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf.subarray(0, this.len));
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  /** @param {number} v integer 0..2^32-1 @returns {this} */
  u32(v) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 0xffffffff) {
      throw new RangeError(`FpWriter.u32: ${String(v)} is not an integer in [0, 4294967295]`);
    }
    this._need(4);
    this.view.setUint32(this.len, v, true);
    this.len += 4;
    return this;
  }

  /** @param {number} v integer -2^31..2^31-1 @returns {this} */
  i32(v) {
    if (typeof v !== 'number' || !Number.isInteger(v) || v < -2147483648 || v > 2147483647) {
      throw new RangeError(`FpWriter.i32: ${String(v)} is not an integer in [-2147483648, 2147483647]`);
    }
    this._need(4);
    this.view.setInt32(this.len, v, true);
    this.len += 4;
    return this;
  }

  /**
   * IEEE-754 bits as is (keeps -0 and +-Infinity); every NaN becomes 0x7ff8000000000000.
   * @param {number} v
   * @returns {this}
   */
  f64(v) {
    if (typeof v !== 'number') throw new TypeError(`FpWriter.f64: expected number, got ${typeof v}`);
    this._need(8);
    if (Number.isNaN(v)) {
      this.view.setUint32(this.len, 0, true);
      this.view.setUint32(this.len + 4, 0x7ff80000, true);
    } else this.view.setFloat64(this.len, v, true);
    this.len += 8;
    return this;
  }

  /** @param {boolean} v strictly true/false @returns {this} */
  bool(v) {
    if (typeof v !== 'boolean') throw new TypeError(`FpWriter.bool: expected boolean, got ${typeof v}`);
    this._need(1);
    this.buf[this.len++] = v ? 1 : 0;
    return this;
  }

  /** `u32` UTF-8 byte length + bytes. Lone surrogates throw. @param {string} s @returns {this} */
  str(s) {
    if (typeof s !== 'string') throw new TypeError(`FpWriter.str: expected string, got ${typeof s}`);
    const b = utf8Encode(s);
    this.u32(b.length);
    this._need(b.length);
    this.buf.set(b, this.len);
    this.len += b.length;
    return this;
  }

  /**
   * `opt<T>`: presence byte, then the value if present. Absent means exactly `null` (undefined is a bug and throws).
   * @param {*} v
   * @param {(w: FpWriter, v: *) => void} writeFn writes one T
   * @returns {this}
   */
  opt(v, writeFn) {
    if (v === undefined) throw new TypeError('FpWriter.opt: undefined is not a valid optional (use null)');
    this._need(1);
    if (v === null) {
      this.buf[this.len++] = 0;
    } else {
      this.buf[this.len++] = 1;
      writeFn(this, v);
    }
    return this;
  }

  /**
   * `list<T>`: `u32` count, then the elements.
   * @param {ArrayLike<*>} arr
   * @param {(w: FpWriter, v: *, i: number) => void} writeFn writes one T
   * @returns {this}
   */
  list(arr, writeFn) {
    this.u32(arr.length);
    for (let i = 0; i < arr.length; i++) writeFn(this, arr[i], i);
    return this;
  }

  /** Copy of the bytes written so far. @returns {Uint8Array} */
  bytes() {
    return this.buf.slice(0, this.len);
  }
}

function digestBytes(d, name) {
  if (typeof d !== 'string' || !FP_DIGEST_RE.test(d)) {
    throw new TypeError(`combineFingerprints: digest for "${name}" is not "xxh32x2:" + 16 lowercase hex`);
  }
  const out = new Uint8Array(8);
  for (let i = 0; i < 8; i++) out[i] = parseInt(d.substr(FP_PREFIX.length + 2 * i, 2), 16);
  return out;
}

/**
 * The bytes hashed for the combined frame fingerprint (section 6.5):
 * `u32 fpVersion(=1) | u32 tick | u32 count | count x 8 raw digest bytes`, in `order`.
 * Every name in `order` must have a digest and vice versa; a missing or extra subsystem is a bug, never a silent zero.
 * @param {number} tick u32
 * @param {Record<string, string>} digests subsystem name -> `xxh32x2:<16 hex>`
 * @param {string[]} order canonical subsystem order (FP_SUBSYSTEMS)
 * @returns {Uint8Array}
 */
export function combineFingerprintBytes(tick, digests, order) {
  if (!Array.isArray(order)) throw new TypeError('combineFingerprints: order must be an array of subsystem names');
  const seen = new Set();
  const w = new FpWriter(12 + 8 * order.length);
  w.u32(FP_VERSION).u32(tick).u32(order.length);
  for (const name of order) {
    if (seen.has(name)) throw new Error(`combineFingerprints: duplicate subsystem "${name}" in order`);
    seen.add(name);
    if (!Object.prototype.hasOwnProperty.call(digests, name)) {
      throw new Error(`combineFingerprints: missing digest for subsystem "${name}"`);
    }
    const raw = digestBytes(digests[name], name);
    w._need(8);
    w.buf.set(raw, w.len);
    w.len += 8;
  }
  for (const name of Object.keys(digests)) {
    if (!seen.has(name)) throw new Error(`combineFingerprints: digest for "${name}" is not in the subsystem order`);
  }
  return w.bytes();
}

/**
 * Combined frame fingerprint: `xxh32x2:` of combineFingerprintBytes.
 * @param {number} tick
 * @param {Record<string, string>} digests
 * @param {string[]} order
 * @returns {string}
 */
export function combineFingerprints(tick, digests, order) {
  return fingerprintOf(combineFingerprintBytes(tick, digests, order));
}
