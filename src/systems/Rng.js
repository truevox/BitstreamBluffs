/**
 * OWNER: core-logic engineer. NO Phaser imports.
 * Public signatures are a contract - do not change without updating src/ARCHITECTURE.md.
 *
 * Seeded randomness. Seed string -> xxHash32 -> PRNG state. Same seed => same sequence on every machine.
 */

/**
 * xxHash32 of a string (UTF-8 bytes).
 * @param {string} input
 * @param {number} [seed=0] 32-bit hash seed.
 * @returns {number} unsigned 32-bit integer.
 */
export function xxHash32(input, seed = 0) {
  // STUB: simple FNV-1a placeholder. Core engineer: implement real xxHash32.
  let h = (0x811c9dc5 ^ seed) >>> 0;
  for (let i = 0; i < input.length; i++) h = Math.imul(h ^ input.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

export class Rng {
  /**
   * @param {string|number} seed seed string (hashed with xxHash32) or a number used directly as state.
   */
  constructor(seed) {
    this.state = typeof seed === 'number' ? seed >>> 0 : xxHash32(String(seed));
  }

  /** @returns {number} float in [0,1). */
  next() {
    // STUB: mulberry32.
    let t = (this.state += 0x6d2b79f5) >>> 0;
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
    const total = items.reduce((s, it) => s + Math.max(0, weightFn(it)), 0);
    if (total <= 0) return undefined;
    let r = this.next() * total;
    for (const it of items) {
      r -= Math.max(0, weightFn(it));
      if (r < 0) return it;
    }
    return items[items.length - 1];
  }

  /**
   * Derive an independent, deterministic child stream (e.g. 'terrain', 'hazards', 'glitch') so that
   * consuming numbers in one subsystem never shifts another. Does NOT advance this stream.
   * @param {string} label
   * @returns {Rng}
   */
  fork(label) {
    return new Rng(xxHash32(label, this.state));
  }
}
