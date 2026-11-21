// Shared helpers for the Replay Contract v1 tests. Not a test file (no .test.js suffix). Deterministic: seeded PRNG only.
import fs from 'node:fs';
import path from 'node:path';
import { parseCanonical, f64Decode } from '../../src/systems/replay/canonicalJson.js';

const DIR = path.resolve('tests/fixtures/replay/v1');

/** Fixture file as raw bytes (copied into this realm's Uint8Array). */
export function fixtureBytes(name) {
  return new Uint8Array(fs.readFileSync(path.join(DIR, name)));
}

/** Fixture parsed with the strict canonical parser: also proves the file is byte-for-byte canonical. */
export function loadFixture(name) {
  return parseCanonical(fixtureBytes(name));
}

export const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');

export function fromHex(h) {
  if (!/^(?:[0-9a-f]{2})*$/.test(h)) throw new Error(`bad hex: ${h}`);
  const out = new Uint8Array(h.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(h.substr(i * 2, 2), 16);
  return out;
}

const nested = (n, leaf = 0) => {
  let v = leaf;
  for (let i = 0; i < n; i++) v = [v];
  return v;
};

/** Fixed table for the `{"$js": "..."}` descriptors used by the fixtures (explicit, no eval). */
export const JS_INPUTS = {
  'nested-array:32': () => nested(32),
  'nested-array:33': () => nested(33),
  NaN: () => NaN,
  Infinity: () => Infinity,
  '-0': () => -0,
  '9007199254740992': () => 9007199254740992,
  '1e-7': () => 1e-7,
  '1e21': () => 1e21,
  '{a:undefined}': () => ({ a: undefined }),
  '[undefined]': () => [undefined],
  "{s:'a\\ud800b'}": () => ({ s: 'a\ud800b' }),
  [String.raw`{'\u00e9':1}`]: () => ({ '\u00e9': 1 }),
  [String.raw`{s:'q"b\\c/\n\t\r\b\f\u0001\u001f\u007f\u2028\u00e9\ud83d\ude00'}`]: () => ({
    s: 'q"b\\c/\n\t\r\b\f\u0001\u001f\u007f\u2028\u00e9\ud83d\ude00',
  }),
  [String.raw`{nfc:'\u00e9',nfd:'e\u0301'}`]: () => ({ nfc: '\u00e9', nfd: 'e\u0301' }),
  'string:1048577': () => 'a'.repeat(1048577),
  'bytes:16777217': () => new Uint8Array(16777217).fill(0x20),
  "JSON.parse('{\"__proto__\":1}')": () => JSON.parse('{"__proto__":1}'),
  'new Date(0)': () => new Date(0),
  'new Map()': () => new Map(),
  '1n': () => BigInt(1),
  '[1,,3]': () => [1, , 3], // eslint-disable-line no-sparse-arrays
  'new Uint8Array(2)': () => new Uint8Array(2),
  'new (class A { constructor() { this.a = 1; } })()': () =>
    new (class A {
      constructor() {
        this.a = 1;
      }
    })(),
  '{a:[0,-0]}': () => ({ a: [0, -0] }),
};

/** Resolve a fixture `input`: `{"$js": name}` descriptors go through JS_INPUTS, anything else is returned as is. */
export function resolveInput(input) {
  if (input !== null && typeof input === 'object' && Object.keys(input).length === 1 && '$js' in input) {
    const make = JS_INPUTS[input.$js];
    if (!make) throw new Error(`no JS_INPUTS entry for descriptor ${JSON.stringify(input.$js)}`);
    return make();
  }
  return input;
}

/** mulberry32: tiny seeded PRNG for property tests (never Math.random). */
export function prng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.int = (n) => Math.floor(next() * n);
  next.u32 = () => Math.floor(next() * 4294967296) >>> 0;
  next.pick = (arr) => arr[next.int(arr.length)];
  return next;
}

/** Random IEEE-754 double from random bits (any exponent, may be NaN/Inf/subnormal/-0). */
export function randomDouble(rand) {
  const dv = new DataView(new ArrayBuffer(8));
  dv.setUint32(0, rand.u32());
  dv.setUint32(4, rand.u32());
  return dv.getFloat64(0);
}

const KEY_CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_.:$-';

export function randomKey(rand) {
  let k = '';
  const n = 1 + rand.int(12);
  for (let i = 0; i < n; i++) k += KEY_CHARS[rand.int(KEY_CHARS.length)];
  return k === '__proto__' ? 'x__proto__' : k;
}

/** Random well-formed string mixing ASCII, controls, quotes, BMP, astral and special code points. */
export function randomString(rand) {
  const n = rand.int(24);
  let s = '';
  for (let i = 0; i < n; i++) {
    const r = rand.int(8);
    if (r === 0) s += String.fromCharCode(rand.int(0x20));
    else if (r === 1) s += rand.pick(['"', '\\', '/', '\u007f', ' ', ' ', '﻿', '\u0000']);
    else if (r === 2) s += String.fromCodePoint(0x10000 + rand.int(0x100000));
    else if (r === 3) {
      let cp = 0x80 + rand.int(0xff80);
      if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xe000;
      s += String.fromCodePoint(cp);
    } else s += String.fromCharCode(0x20 + rand.int(0x5f));
  }
  return s;
}

/** Random canonicalizable value: floats stay in the exponent-free band, no -0/NaN/Infinity. */
export function randomValue(rand, depth = 0) {
  const kinds = depth >= 5 ? 5 : 7;
  switch (rand.int(kinds)) {
    case 0:
      return null;
    case 1:
      return rand.int(2) === 1;
    case 2:
      return rand.int(2001) - 1000;
    case 3: {
      // safe integers of any magnitude
      const v = Math.floor((rand() - 0.5) * 2 * Number.MAX_SAFE_INTEGER);
      return Object.is(v, -0) ? 0 : v;
    }
    case 4: {
      // non-integer within [1e-6, 1e21)
      const mag = 10 ** (rand.int(15) - 6);
      let v = (rand() + 0.001) * mag;
      if (Number.isInteger(v)) v += 0.5;
      if (rand.int(2)) v = -v;
      return Math.abs(v) >= 1e-6 && Math.abs(v) < 1e21 && !String(v).includes('e') ? v : 0.5;
    }
    case 5: {
      const a = [];
      const n = rand.int(5);
      for (let i = 0; i < n; i++) a.push(randomValue(rand, depth + 1));
      return a;
    }
    default: {
      const o = {};
      const n = rand.int(5);
      for (let i = 0; i < n; i++) o[randomKey(rand)] = randomValue(rand, depth + 1);
      return o;
    }
  }
}

/** Random string leaf as its own kind is mixed in via wrap: callers wrap strings in values. */
export function randomValueWithStrings(rand, depth = 0) {
  const v = randomValue(rand, depth);
  const walk = (x) => {
    if (Array.isArray(x)) return x.map(walk);
    if (x !== null && typeof x === 'object') {
      const o = {};
      for (const k of Object.keys(x)) o[k] = walk(x[k]);
      return o;
    }
    return typeof x === 'boolean' && rand.int(3) === 0 ? randomString(rand) : x;
  };
  return walk(v);
}

// ---- BB-FP schema interpreter (test-only: the production module has only FpWriter) -------------------------------

/** Encode `state` by a schema `{rec:[[name,type]...]}` / `'u32'|'i32'|'f64'|'bool'|'str'` / `{opt:T}` / `{list:T}`. */
export function encodeBySchema(writer, schema, v, path = '$') {
  if (typeof schema === 'string') {
    switch (schema) {
      case 'u32':
        return writer.u32(v);
      case 'i32':
        return writer.i32(v);
      case 'f64':
        return writer.f64(typeof v === 'string' ? f64Decode(v) : v);
      case 'bool':
        return writer.bool(v);
      case 'str':
        return writer.str(v);
      default:
        throw new Error(`unknown schema type ${schema} at ${path}`);
    }
  }
  if ('opt' in schema) return writer.opt(v, (w, x) => encodeBySchema(w, schema.opt, x, path));
  if ('list' in schema) return writer.list(v, (w, x, i) => encodeBySchema(w, schema.list, x, `${path}[${i}]`));
  if ('rec' in schema) {
    for (const [name, type] of schema.rec) {
      if (!(name in v)) throw new Error(`missing field ${path}.${name}`);
      encodeBySchema(writer, type, v[name], `${path}.${name}`);
    }
    return writer;
  }
  throw new Error(`bad schema at ${path}`);
}
