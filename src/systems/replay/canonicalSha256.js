/**
 * Tier A identity digests for Replay Contract v1 (docs/replay/replay-contract-v1.md, section 3.1).
 *
 * Synchronous, dependency-free SHA-256 so it works everywhere the replay code does: crypto.subtle needs a secure
 * context and is absent from Jest's jsdom environment, and sync code needs no async plumbing. Inputs are tens of KB
 * and hashed outside the sim loop, so speed is irrelevant. A boot self-test against NIST vectors runs when the module
 * loads and throws if the implementation is wrong. Pure module: no Phaser, no clock, no randomness.
 */
import { canonicalBytes } from './canonicalJson.js';

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01,
  0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc,
  0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147,
  0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116, 0x1e376c08,
  0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const HEX = '0123456789abcdef';

/** Compress one 64-byte block starting at `off` of `buf` into state `h` (Uint32Array(8)); `w` is scratch (64). */
function block(h, buf, off, w) {
  for (let i = 0; i < 16; i++) {
    const p = off + i * 4;
    w[i] = ((buf[p] << 24) | (buf[p + 1] << 16) | (buf[p + 2] << 8) | buf[p + 3]) >>> 0;
  }
  for (let i = 16; i < 64; i++) {
    const a = w[i - 15];
    const b = w[i - 2];
    const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
    const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
    w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
  }
  let a = h[0];
  let b = h[1];
  let c = h[2];
  let d = h[3];
  let e = h[4];
  let f = h[5];
  let g = h[6];
  let hh = h[7];
  for (let i = 0; i < 64; i++) {
    const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
    const ch = (e & f) ^ (~e & g);
    const t1 = (hh + S1 + ch + K[i] + w[i]) >>> 0;
    const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
    const maj = (a & b) ^ (a & c) ^ (b & c);
    const t2 = (S0 + maj) >>> 0;
    hh = g;
    g = f;
    f = e;
    e = (d + t1) >>> 0;
    d = c;
    c = b;
    b = a;
    a = (t1 + t2) >>> 0;
  }
  h[0] = (h[0] + a) >>> 0;
  h[1] = (h[1] + b) >>> 0;
  h[2] = (h[2] + c) >>> 0;
  h[3] = (h[3] + d) >>> 0;
  h[4] = (h[4] + e) >>> 0;
  h[5] = (h[5] + f) >>> 0;
  h[6] = (h[6] + g) >>> 0;
  h[7] = (h[7] + hh) >>> 0;
}

/**
 * SHA-256 of `bytes` as 64 lowercase hex digits.
 * @param {Uint8Array} bytes
 * @returns {string}
 */
export function sha256Hex(bytes) {
  // ArrayBuffer.isView, not instanceof: Jest's jsdom realm makes node Buffers fail `instanceof Uint8Array`.
  if (!ArrayBuffer.isView(bytes) || bytes.BYTES_PER_ELEMENT !== 1) throw new TypeError('sha256Hex expects a Uint8Array');
  const h = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);
  const n = bytes.length;
  const full = n - (n % 64);
  for (let off = 0; off < full; off += 64) block(h, bytes, off, w);
  // Tail: remaining bytes, 0x80, zero padding, 64-bit big-endian bit length. One or two final blocks.
  const rem = n - full;
  const tail = new Uint8Array(rem < 56 ? 64 : 128);
  tail.set(bytes.subarray(full), 0);
  tail[rem] = 0x80;
  const bitsHi = Math.floor(n / 0x20000000); // (n * 8) >>> 32 without overflowing 2^53
  const bitsLo = (n << 3) >>> 0;
  const end = tail.length;
  tail[end - 8] = bitsHi >>> 24;
  tail[end - 7] = (bitsHi >>> 16) & 255;
  tail[end - 6] = (bitsHi >>> 8) & 255;
  tail[end - 5] = bitsHi & 255;
  tail[end - 4] = bitsLo >>> 24;
  tail[end - 3] = (bitsLo >>> 16) & 255;
  tail[end - 2] = (bitsLo >>> 8) & 255;
  tail[end - 1] = bitsLo & 255;
  for (let off = 0; off < end; off += 64) block(h, tail, off, w);
  let out = '';
  for (let i = 0; i < 8; i++) {
    for (let s = 28; s >= 0; s -= 4) out += HEX[(h[i] >>> s) & 15];
  }
  return out;
}

/**
 * Tier A identity digest of a value: `sha256:` + hex of its BB-CJSON v1 canonical bytes (section 3.1).
 * @param {*} value
 * @returns {string}
 * @throws {CJSONError} when the value is not canonicalizable
 */
export function digestOf(value) {
  return `sha256:${sha256Hex(canonicalBytes(value))}`;
}

/** Digest of already-canonical bytes: `sha256:` + hex. */
export function digestOfBytes(bytes) {
  return `sha256:${sha256Hex(bytes)}`;
}

const ascii = (s) => Uint8Array.from(s, (c) => c.charCodeAt(0));

/** NIST FIPS 180-4 / CAVS reference vectors, [message bytes, expected hex]. The million-'a' one is opt-in (slow-ish). */
const VECTORS = [
  [ascii(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
  [ascii('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
  [
    ascii('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'),
    '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
  ],
  [
    ascii('abcdefghbcdefghicdefghijdefghijkefghijklfghijklmghijklmnhijklmnoijklmnopjklmnopqklmnopqrlmnopqrsmnopqrstnopqrstu'),
    'cf5b16a778af8380036ce59e7b0492370b249b11e8f07a51afac45037afee9d1',
  ],
];

/**
 * Check the implementation against NIST vectors. Throws on the first mismatch.
 * @param {{full?: boolean}} [opts] full: also hash one million 'a' bytes (NIST long message).
 * @returns {true}
 */
export function sha256SelfTest(opts = {}) {
  for (const [msg, want] of VECTORS) {
    const got = sha256Hex(msg);
    if (got !== want) throw new Error(`sha256 self-test failed for ${msg.length}-byte vector: ${got} != ${want}`);
  }
  if (opts.full) {
    const got = sha256Hex(new Uint8Array(1000000).fill(0x61));
    const want = 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0';
    if (got !== want) throw new Error(`sha256 self-test failed for one million 'a': ${got} != ${want}`);
  }
  return true;
}

// Boot self-test (Replay Contract v1, 3.1): an engine or port that gets SHA-256 wrong must fail loudly at load.
sha256SelfTest();
