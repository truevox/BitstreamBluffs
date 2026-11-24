/**
 * OWNER: core-logic engineer. NO Phaser imports.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Seeded randomness. Seed string -> xxHash32 (real, spec-compliant) -> mulberry32 PRNG state.
 * Same seed => same sequence on every machine. `fork(label)` derives an independent stream from the
 * ORIGINAL seed state (not the current position), so consuming numbers in one stream never shifts another
 * and the order in which forks are created does not matter.
 */

const P1 = 2654435761;
const P2 = 2246822519;
const P3 = 3266489917;
const P4 = 668265263;
const P5 = 374761393;

const rotl = (x, r) => ((x << r) | (x >>> (32 - r))) >>> 0;

/**
 * Encode a string to UTF-8 bytes without TextEncoder (not present in every Jest environment).
 * @param {string} str
 * @returns {number[]}
 */
function utf8Bytes(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) {
    let c = str.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      const d = str.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        c = 0x10000 + ((c - 0xd800) << 10) + (d - 0xdc00);
        i++;
      }
    }
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
  }
  return out;
}

/**
 * xxHash32 of a string (UTF-8 bytes).
 * @param {string} input
 * @param {number} [seed=0] 32-bit hash seed.
 * @returns {number} unsigned 32-bit integer.
 */
export function xxHash32(input, seed = 0) {
  const b = utf8Bytes(String(input));
  const len = b.length;
  seed = seed >>> 0;
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
 * Cheap integer mixer: combine two 32-bit ints into a well-scrambled unsigned 32-bit value. Pure, allocation free.
 * Used for lattice noise and per-index seeding.
 * @param {number} a
 * @param {number} b
 * @returns {number} unsigned 32-bit.
 */
export function hashInts(a, b) {
  let h = Math.imul((a ^ 0x9e3779b9) >>> 0, 0x85ebca6b) ^ Math.imul((b + 0x7f4a7c15) >>> 0, 0xc2b2ae35);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  h = Math.imul(h, 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}

export class Rng {
  /**
   * @param {string|number} seed seed string (hashed with xxHash32) or a number used directly as state.
   */
  constructor(seed) {
    const s = typeof seed === 'number' ? seed >>> 0 : xxHash32(String(seed));
    /** Initial state, immutable: fork() derives from this so it is independent of consumption. */
    this.baseSeed = s;
    this.state = s;
  }

  /** @returns {number} float in [0,1). */
  next() {
    // mulberry32
    let t = (this.state = (this.state + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * @param {number} min inclusive
   * @param {number} max inclusive
   * @returns {number} integer.
   */
  int(min, max) {
    return min + Math.floor(this.next() * (max - min + 1));
  }

  /**
   * @param {number} min
   * @param {number} max
   * @returns {number} float in [min,max).
   */
  range(min, max) {
    return min + this.next() * (max - min);
  }

  /**
   * @param {number} p probability 0..1
   * @returns {boolean}
   */
  chance(p) {
    return this.next() < p;
  }

  /**
   * @template T
   * @param {T[]} arr non-empty
   * @returns {T}
   */
  pick(arr) {
    return arr[this.int(0, arr.length - 1)];
  }

  /**
   * Weighted pick.
   * @template T
   * @param {T[]} items
   * @param {(item:T)=>number} weightFn returns weight >= 0
   * @returns {T|undefined} undefined if items empty or all weights 0.
   */
  weighted(items, weightFn) {
    let total = 0;
    for (let i = 0; i < items.length; i++) total += Math.max(0, weightFn(items[i]));
    if (!(total > 0)) return undefined;
    let r = this.next() * total;
    let last;
    for (let i = 0; i < items.length; i++) {
      const w = Math.max(0, weightFn(items[i]));
      if (w <= 0) continue;
      last = items[i];
      r -= w;
      if (r < 0) return items[i];
    }
    return last;
  }

  /**
   * Derive an independent, deterministic child stream (e.g. 'terrain', 'hazards', 'glitch') so that
   * consuming numbers in one subsystem never shifts another. Does NOT advance this stream and does not
   * depend on how far it has advanced.
   * @param {string} label
   * @returns {Rng}
   */
  fork(label) {
    return new Rng(xxHash32(label, this.baseSeed));
  }
}
