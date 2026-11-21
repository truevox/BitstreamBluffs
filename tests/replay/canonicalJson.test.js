// Replay Contract v1, section 2: BB-CJSON v1 canonical JSON (vectors, rejections, parse-level checks, properties).
import vm from 'node:vm';
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
import {
  CJSONError,
  MAX_DEPTH,
  asUint8Array,
  canonicalBytes,
  canonicalSelfTest,
  canonicalize,
  f64Decode,
  f64Encode,
  parseCanonical,
  utf8DecodeStrict,
  utf8Encode,
} from '../../src/systems/replay/canonicalJson.js';
import {
  fixtureBytes,
  fromHex,
  loadFixture,
  prng,
  randomDouble,
  randomValueWithStrings,
  resolveInput,
  toHex,
  JS_INPUTS,
} from './replayFixtures.js';

const enc = new NodeTextEncoder();
const dec = new NodeTextDecoder('utf-8', { fatal: true, ignoreBOM: true });

const nested = (n, leaf = 0) => {
  let v = leaf;
  for (let i = 0; i < n; i++) v = [v];
  return v;
};
const nestedObj = (n) => {
  let v = 0;
  for (let i = 0; i < n; i++) v = { k: v };
  return v;
};

function thrown(fn) {
  try {
    fn();
  } catch (e) {
    return e;
  }
  return null;
}

function expectCJSON(fn, code, path) {
  const e = thrown(fn);
  expect(e).toBeInstanceOf(CJSONError);
  expect(e.code).toBe(code);
  if (path !== undefined) expect(e.pointer).toBe(path);
  return e;
}

describe('fixtures are canonical bytes', () => {
  test.each(['cjson-valid.json', 'cjson-reject.json', 'hash-vectors.json', 'fingerprint-vectors.json'])(
    '%s parses with parseCanonical (strict, byte-equal) and has no trailing newline',
    (name) => {
      const bytes = fixtureBytes(name);
      const value = parseCanonical(bytes);
      expect(toHex(canonicalBytes(value))).toBe(toHex(bytes));
      expect(bytes[bytes.length - 1]).not.toBe(0x0a);
    },
  );
});

describe('cjson-valid vectors (spec 2.4, cj-*)', () => {
  const vectors = loadFixture('cjson-valid.json');

  test('ids cover cj-001..cj-011', () => {
    expect(vectors.map((v) => v.id.slice(0, 6))).toEqual(
      Array.from({ length: 11 }, (_, i) => `cj-${String(i + 1).padStart(3, '0')}`),
    );
  });

  test.each(vectors.map((v) => [v.id, v]))('%s: text, bytes, parse round trip', (_id, v) => {
    const input = resolveInput(v.input);
    const text = utf8DecodeStrict(fromHex(v.hex)); // hex is authoritative; text (when present) is a readable copy
    if ('text' in v) expect(v.text).toBe(text);
    expect(canonicalize(input)).toBe(text);
    const bytes = canonicalBytes(input);
    expect(toHex(bytes)).toBe(v.hex);
    expect(toHex(utf8Encode(text))).toBe(v.hex);
    expect(toHex(enc.encode(text))).toBe(v.hex);
    const parsed = parseCanonical(bytes);
    expect(canonicalize(parsed)).toBe(text);
    expect(parseCanonical(text)).toEqual(parsed);
  });

  test('vectors with invisible or non-ASCII content give inputs as escaped JS descriptors and omit `text`', () => {
    for (const v of vectors) {
      if ('text' in v) expect(v.text).toMatch(/^[\x20-\x7e]*$/);
      else expect(v.input).toHaveProperty('$js');
    }
    expect(vectors.filter((v) => !('text' in v)).map((v) => v.id)).toEqual([
      'cj-005-string-escapes',
      'cj-009-unicode-value-no-normalization',
    ]);
  });

  test('cj-005 emits U+007F and U+2028 literally and lowercase \\u00xx for other controls', () => {
    const v = vectors.find((x) => x.id.startsWith('cj-005'));
    expect(v.hex).toContain('5c7530303166'); // \u001f lowercase
    expect(v.hex).toContain('7fe280a8'); // U+007F and U+2028 as raw UTF-8
  });

  test('cj-009 does not normalize: NFC and NFD differ', () => {
    const v = vectors.find((x) => x.id.startsWith('cj-009'));
    expect(v.hex).toContain('c3a9'); // nfc: U+00E9
    expect(v.hex).toContain('65cc81'); // nfd: 'e' + U+0301
    const input = resolveInput(v.input);
    expect(input.nfd).toBe('e\u0301');
    expect(input.nfd).not.toBe(input.nfc);
  });

  test('cj-011: 32 nested containers are accepted', () => {
    expect(canonicalize(nested(32)).length).toBe(65);
    expect(canonicalize(nestedObj(32))).toBeTruthy();
  });
});

describe('cjson-reject vectors (spec 2.4 "Required rejections", rj-*, plus amendment vectors)', () => {
  const vectors = loadFixture('cjson-reject.json');

  test('ids are unique and cover rj-001..rj-043 in order', () => {
    expect(vectors.map((v) => v.id.slice(0, 6))).toEqual(
      Array.from({ length: 43 }, (_, i) => `rj-${String(i + 1).padStart(3, '0')}`),
    );
  });

  test('every code in the contract is exercised', () => {
    const want = [
      'nan',
      'infinity',
      'negative-zero',
      'unsafe-integer',
      'float-out-of-range',
      'undefined',
      'lone-surrogate',
      'key-not-allowed',
      'proto-key',
      'non-plain-object',
      'unsupported-type:bigint',
      'sparse-array',
      'too-deep',
      'duplicate-key',
      'not-canonical',
      'invalid-utf8',
      'bom',
      'syntax-error',
      'too-large',
      'string-too-long',
    ];
    expect(new Set(vectors.map((v) => v.code))).toEqual(new Set(want));
  });

  test('every JS descriptor in the fixtures has a table entry and every entry is used', () => {
    const used = new Set(
      [...vectors, ...loadFixture('cjson-valid.json')].filter((v) => v.input && v.input.$js).map((v) => v.input.$js),
    );
    expect(Object.keys(JS_INPUTS).sort()).toEqual([...used].sort());
  });

  test('pointers are RFC 6901 (root is the empty string)', () => {
    for (const v of vectors) {
      const ptr = 'pointerHex' in v ? utf8DecodeStrict(fromHex(v.pointerHex)) : v.pointer;
      if (ptr !== undefined) expect(ptr === '' || ptr.startsWith('/')).toBe(true);
    }
  });

  const pointerOf = (v) => ('pointerHex' in v ? utf8DecodeStrict(fromHex(v.pointerHex)) : v.pointer);

  test.each(vectors.map((v) => [v.id, v]))('%s fails with its code and pointer', (_id, v) => {
    const ptr = pointerOf(v);
    if (v.via === 'canonicalize') {
      const input = resolveInput(v.input);
      expectCJSON(() => canonicalize(input), v.code, ptr);
      expectCJSON(() => canonicalBytes(input), v.code, ptr);
    } else {
      expect(v.via).toBe('parse');
      const bytes = 'inputHex' in v ? fromHex(v.inputHex) : resolveInput(v.input);
      if (typeof v.input === 'string') {
        expect(toHex(enc.encode(v.input))).toBe(v.inputHex); // text and bytes forms agree
        expectCJSON(() => parseCanonical(v.input), v.code, ptr);
      }
      expectCJSON(() => parseCanonical(bytes), v.code, ptr);
    }
  });
});

describe('fixture index', () => {
  const index = loadFixture('index.json').files;
  const idsOf = (rows) => rows.map((r) => r.id);

  test('lists every shipped vector id exactly once', () => {
    const hv = loadFixture('hash-vectors.json');
    const fp = loadFixture('fingerprint-vectors.json');
    expect(index['cjson-valid.json']).toEqual(idsOf(loadFixture('cjson-valid.json')));
    expect(index['cjson-reject.json']).toEqual(idsOf(loadFixture('cjson-reject.json')));
    expect(index['hash-vectors.json']).toEqual({
      sha256: idsOf(hv.sha256),
      xxh32: idsOf(hv.xxh32),
      xxh32x2: idsOf(hv.xxh32x2),
      f64: idsOf(hv.f64),
      f64Reject: idsOf(hv.f64Reject),
    });
    expect(index['fingerprint-vectors.json']).toEqual([...Object.keys(fp.subsystems).sort(), 'combined', 'bsodOnlyMutation']);
    const all = [
      ...index['cjson-valid.json'],
      ...index['cjson-reject.json'],
      ...Object.values(index['hash-vectors.json']).flat(),
      ...index['fingerprint-vectors.json'],
    ];
    expect(new Set(all).size).toBe(all.length);
  });
});

describe('parseCanonical error precedence', () => {
  const t = (s) => () => parseCanonical(s);

  test('utf8 > bom > too-large > syntax/duplicate > value-level (document order) > not-canonical', () => {
    expectCJSON(() => parseCanonical(fromHex('efbbbfff')), 'invalid-utf8');
    expectCJSON(() => parseCanonical(fromHex('efbbbf5b')), 'bom');
    const huge = new Uint8Array(16777217).fill(0x20);
    expectCJSON(() => parseCanonical(huge), 'too-large');
    huge[0] = 0xff; // invalid UTF-8 outranks size
    expectCJSON(() => parseCanonical(huge), 'invalid-utf8');
    expectCJSON(t('{"a":-0,"b":}'), 'syntax-error');
    expectCJSON(t('{"a":-0,"a":1}'), 'duplicate-key', '/a');
    expectCJSON(t('{"a":1,"a":-0}'), 'duplicate-key', '/a');
    expectCJSON(t('{"b":-0,"a":1e400}'), 'negative-zero', '/b'); // document order, not key-sorted order
    expectCJSON(t('{"b":1e400,"a":-0}'), 'infinity', '/b');
    expectCJSON(t('{"z":-0,"\\u00e9":1}'.replace('\\\\', '\\')), 'negative-zero', '/z');
    expectCJSON(t('{"\\u00e9":1,"z":-0}'.replace('\\\\', '\\')), 'key-not-allowed');
    expectCJSON(t('[1e400,{"__proto__":1}]'), 'infinity', '/0');
    expectCJSON(t('[{"__proto__":1},1e400]'), 'proto-key', '/0/__proto__');
    expectCJSON(t('["\\ud800",1e400]'), 'lone-surrogate', '/0');
    expectCJSON(t('{"b":1,"a":2}'), 'not-canonical');
  });

  test('integer-like keys keep document order for error reporting (JS would reorder them in the object)', () => {
    expectCJSON(t('{"b":-0,"1":1e400}'), 'negative-zero', '/b');
    expectCJSON(t('{"2":-0,"1":1e400}'), 'negative-zero', '/2');
  });

  test('token-level spellings are caught by byte equality, except -0 values', () => {
    for (const s of ['1.0', '1e2', '[1E2]', '[1.50]', '[10e-1]']) expectCJSON(t(s), 'not-canonical', '');
    expectCJSON(t('-0'), 'negative-zero', '');
    expectCJSON(t('-0.0'), 'negative-zero', '');
  });
});

describe('JSON Pointer paths (RFC 6901)', () => {
  test('keys containing "." are unambiguous; "/" and "~" are escaped', () => {
    expectCJSON(() => canonicalize({ 'a.b': [0, -0] }), 'negative-zero', '/a.b/1');
    expectCJSON(() => canonicalize({ 'a/b': 1 }), 'key-not-allowed', '/a~1b');
    expectCJSON(() => canonicalize({ 'a~b': 1 }), 'key-not-allowed', '/a~0b');
    expectCJSON(() => canonicalize({ 'a~/b': 1 }), 'key-not-allowed', '/a~0~1b');
    expectCJSON(() => canonicalize({ causal: { bsod: { syncLevel: NaN } } }), 'nan', '/causal/bsod/syncLevel');
    expectCJSON(() => canonicalize({ pose: [1, 2, Infinity] }), 'infinity', '/pose/2');
  });

  test('error object exposes `pointer` (no `path`)', () => {
    const e = thrown(() => canonicalize({ a: NaN }));
    expect(e.pointer).toBe('/a');
    expect(e).not.toHaveProperty('path');
    expect(e.message).toContain('nan');
  });
});

describe('cross-realm plain objects', () => {
  test('objects and arrays from another vm realm canonicalize identically', () => {
    const foreign = vm.runInNewContext('({ b: [1, { z: null, y: "x" }], a: true, n: Object.create(null) })');
    expect(foreign.constructor).not.toBe(Object);
    expect(Object.getPrototypeOf(foreign)).not.toBe(Object.prototype);
    expect(canonicalize(foreign)).toBe('{"a":true,"b":[1,{"y":"x","z":null}],"n":{}}');
    expect(canonicalize(foreign)).toBe(canonicalize({ b: [1, { z: null, y: 'x' }], a: true, n: {} }));
  });

  test('foreign non-plain values are still rejected', () => {
    expectCJSON(() => canonicalize(vm.runInNewContext('new Date(0)')), 'non-plain-object', '');
    expectCJSON(() => canonicalize(vm.runInNewContext('new Map()')), 'non-plain-object', '');
    expectCJSON(() => canonicalize(vm.runInNewContext('new Uint8Array(2)')), 'non-plain-object', '');
    expectCJSON(() => canonicalize(vm.runInNewContext('new (class A { constructor() { this.a = 1; } })()')), 'non-plain-object', '');
    expectCJSON(() => canonicalize(vm.runInNewContext('new (class B extends Array {})()')), 'non-plain-array', '');
    expectCJSON(() => canonicalize(vm.runInNewContext('Object.create({ inherited: 1 })')), 'non-plain-object', '');
  });

  test('toString tag must be "[object Object]" for objects with a prototype', () => {
    const tagged = Object.create(Object.create(null), { [Symbol.toStringTag]: { value: 'Foo' } });
    expectCJSON(() => canonicalize(tagged), 'non-plain-object', ''); // tag is "[object Foo]"
    const proto = Object.create(null);
    proto[Symbol.toStringTag] = 'Foo';
    expectCJSON(() => canonicalize(Object.create(proto)), 'non-plain-object', '');
  });
});

describe('array elements are inspected by descriptor (getters never run)', () => {
  test('accessor element -> accessor at /i, getter not invoked', () => {
    let calls = 0;
    const a = [1, 2];
    Object.defineProperty(a, 1, {
      get() {
        calls++;
        return 5;
      },
      enumerable: true,
      configurable: true,
    });
    expectCJSON(() => canonicalize(a), 'accessor', '/1');
    expectCJSON(() => canonicalize({ k: [[], a] }), 'accessor', '/k/1/1');
    expect(calls).toBe(0);
  });

  test('non-enumerable accessor element is still an accessor; non-enumerable data element is hidden-property', () => {
    const a = [1, 2, 3];
    Object.defineProperty(a, 0, { get: () => 1, enumerable: false, configurable: true });
    expectCJSON(() => canonicalize(a), 'accessor', '/0');
    const b = [1, 2, 3];
    Object.defineProperty(b, 2, { value: 3, enumerable: false, writable: true, configurable: true });
    expectCJSON(() => canonicalize(b), 'hidden-property', '/2');
  });

  test('sparse arrays and normal arrays are unchanged', () => {
    expectCJSON(() => canonicalize([1, , 3]), 'sparse-array', '/1'); // eslint-disable-line no-sparse-arrays
    expect(canonicalize([1, [2, [3]], { a: [] }])).toBe('[1,[2,[3]],{"a":[]}]');
  });
});

describe('null-prototype lookalikes are not plain objects', () => {
  test('stripped typed arrays, DataViews, Date, Map, Set, ArrayBuffer', () => {
    const strip = (x) => Object.setPrototypeOf(x, null);
    for (const make of [
      () => new Uint8Array(3),
      () => new DataView(new ArrayBuffer(2)),
      () => new Date(0),
      () => new Map(),
      () => new Set(),
      () => new WeakMap(),
      () => new ArrayBuffer(4),
    ]) {
      expectCJSON(() => canonicalize({ x: strip(make()) }), 'non-plain-object', '/x');
    }
    expect(canonicalize({ x: Object.create(null) })).toBe('{"x":{}}');
    const withData = Object.create(null);
    withData.a = 1;
    expect(canonicalize(withData)).toBe('{"a":1}');
  });
});

describe('hostile nesting is bounded in time and memory', () => {
  test('16 MiB of "[" fails with syntax-error quickly and without gigabytes of allocation', () => {
    const text = '['.repeat(16 * 1024 * 1024);
    const before = process.memoryUsage().rss;
    const t0 = Date.now();
    const e = thrown(() => parseCanonical(text));
    const ms = Date.now() - t0;
    const grownMB = (process.memoryUsage().rss - before) / 1e6;
    expect(e).toBeInstanceOf(CJSONError);
    expect(e.code).toBe('syntax-error');
    // Reference machine: ~1.1 s and ~100 MB (was 11.4 s and 2.7 GB). Generous bounds for slow CI.
    expect(ms).toBeLessThan(10000);
    expect(grownMB).toBeLessThan(700);
  });

  test('the same input as bytes behaves the same', () => {
    const bytes = new Uint8Array(4 * 1024 * 1024).fill(0x5b);
    const e = thrown(() => parseCanonical(bytes));
    expect(e && e.code).toBe('syntax-error');
    expect(e.message.length).toBeLessThan(400); // the message truncates the (multi-megabyte) pointer, the property does not
    expect(e.pointer.length).toBe(2 * bytes.length);
  });

  test('past depth 32 syntax errors, duplicate keys and pointers are still exact', () => {
    const deepArr = '['.repeat(40);
    expectCJSON(() => parseCanonical(`${deepArr}{"a":1,"a":2}${']'.repeat(40)}`), 'duplicate-key', `${'/0'.repeat(40)}/a`);
    expectCJSON(() => parseCanonical(`${'{"k":'.repeat(40)}{"a":1,"b":2,"c":3,"b":4}${'}'.repeat(40)}`), 'duplicate-key', `${'/k'.repeat(40)}/b`);
    expectCJSON(() => parseCanonical(`${'{"k":'.repeat(40)}{"a":1,"a":2}${'}'.repeat(40)}`), 'duplicate-key', `${'/k'.repeat(40)}/a`);
    expectCJSON(() => parseCanonical(`${'['.repeat(33)}1,1,x`), 'syntax-error', `${'/0'.repeat(32)}/2`);
    expectCJSON(() => parseCanonical(`${'['.repeat(40)}0${']'.repeat(39)}`), 'syntax-error');
    expectCJSON(() => parseCanonical(`${'['.repeat(40)}0${']'.repeat(40)}`), 'too-deep', '/0'.repeat(32));
    expectCJSON(() => parseCanonical(`[-0,${'['.repeat(40)}0${']'.repeat(40)}]`), 'negative-zero', '/0');
    // sibling deep objects with the same key are not duplicates of each other
    const deepObj = (k) => `${'['.repeat(33)}{"${k}":1}${']'.repeat(33)}`;
    expectCJSON(() => parseCanonical(`[${deepObj('a')},${deepObj('a')}]`), 'too-deep');
  });
});

describe('canonicalSelfTest', () => {
  test('passes on this engine', () => {
    expect(canonicalSelfTest()).toBe(true);
  });
});

describe('asUint8Array', () => {
  test('accepts Uint8Array, Buffer, ArrayBuffer and foreign-realm Uint8Array without copying views', () => {
    const u = new Uint8Array([1, 2, 3]);
    expect(asUint8Array(u)).toBe(u);
    expect(toHex(asUint8Array(Buffer.from([1, 2, 3])))).toBe('010203');
    expect(toHex(asUint8Array(u.buffer))).toBe('010203');
    expect(toHex(asUint8Array(vm.runInNewContext('new Uint8Array([9, 8])')))).toBe('0908');
  });

  test('rejects every other view and non-bytes with TypeError', () => {
    for (const bad of [new Int8Array(2), new Uint8ClampedArray(2), new Uint16Array(1), new Float32Array(1), new DataView(new ArrayBuffer(2)), 'abc', [1], null, undefined, 5, {}, { buffer: new ArrayBuffer(1) }]) {
      expect(() => asUint8Array(bad)).toThrow(TypeError);
    }
  });
});

describe('serializer details', () => {
  test('keys sort by UTF-16 code unit order regardless of insertion order', () => {
    const a = canonicalize({ b: 1, a: 2, B: 3, _: 4, 10: 5, 9: 6 });
    const b = canonicalize({ 9: 6, _: 4, B: 3, a: 2, 10: 5, b: 1 });
    expect(a).toBe(b);
    expect(a).toBe('{"10":5,"9":6,"B":3,"_":4,"a":2,"b":1}');
  });

  test('integer-valued floats are integers; -0 and unsafe integers are errors at the right path', () => {
    expect(canonicalize([3.0, 1e3, 2 ** 40, -5e0, 1e20 / 1e19])).toBe('[3,1000,1099511627776,-5,10]');
    expectCJSON(() => canonicalize({ a: [0, -0] }), 'negative-zero', '/a/1');
    expectCJSON(() => canonicalize([2 ** 53]), 'unsafe-integer', '/0');
    expectCJSON(() => canonicalize(-(2 ** 53)), 'unsafe-integer', '');
    expect(canonicalize(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991');
    expect(canonicalize(Number.MIN_SAFE_INTEGER)).toBe('-9007199254740991');
  });

  test('non-integer band: 1e-6 <= |x| < 1e21, exponent text is rejected', () => {
    expect(canonicalize(0.000001)).toBe('0.000001');
    expect(canonicalize(-0.000001)).toBe('-0.000001');
    expectCJSON(() => canonicalize(0.0000001), 'float-out-of-range', '');
    expectCJSON(() => canonicalize(5e-324), 'float-out-of-range', '');
    expectCJSON(() => canonicalize(1.5e-10), 'float-out-of-range', '');
    expectCJSON(() => canonicalize(Number.MAX_VALUE), 'unsafe-integer', '');
    expectCJSON(() => canonicalize(-Infinity), 'infinity', '');
  });

  test('string escapes: all C0 controls, quotes, backslash; everything else literal', () => {
    const expected = {
      8: '\\b',
      9: '\\t',
      10: '\\n',
      12: '\\f',
      13: '\\r',
    };
    for (let c = 0; c < 0x20; c++) {
      const want = expected[c] || `\\u${c.toString(16).padStart(4, '0')}`;
      expect(canonicalize(String.fromCharCode(c))).toBe(`"${want}"`);
    }
    expect(canonicalize('"\\')).toBe('"\\"\\\\"');
    for (const lit of ['/', '\u007f', ' ', ' ', '﻿', 'é', '😀', "'", '<', '&']) {
      expect(canonicalize(lit)).toBe(`"${lit}"`);
    }
    expect(canonicalize('😀')).toBe('"😀"'); // valid surrogate pair is fine
  });

  test('lone surrogates (high, low, reversed pair, trailing) are errors with a path', () => {
    for (const s of ['\ud800', '\udc00', '\udc00\ud800', 'x\ud83d', '\ud83dx']) {
      expectCJSON(() => canonicalize({ a: [s] }), 'lone-surrogate', '/a/0');
    }
  });

  test('key alphabet: length 1..64, A-Za-z0-9_.:$-, __proto__ rejected', () => {
    expect(canonicalize({ [`a${'b'.repeat(63)}`]: 1 })).toBe(`{"a${'b'.repeat(63)}":1}`);
    expectCJSON(() => canonicalize({ [`a${'b'.repeat(64)}`]: 1 }), 'key-not-allowed');
    expectCJSON(() => canonicalize({ '': 1 }), 'key-not-allowed', '/');
    expectCJSON(() => canonicalize({ 'a b': 1 }), 'key-not-allowed', '/a b');
    expectCJSON(() => canonicalize({ 'a"b': 1 }), 'key-not-allowed');
    expectCJSON(() => canonicalize({ 'a/b': 1 }), 'key-not-allowed');
    expectCJSON(() => canonicalize({ 'a\u0000': 1 }), 'key-not-allowed');
    expect(canonicalize({ 'A.b:c$d-e_f9': 1 })).toBe('{"A.b:c$d-e_f9":1}');
    expectCJSON(() => canonicalize(JSON.parse('{"x":{"__proto__":1}}')), 'proto-key', '/x/__proto__');
  });

  test('absent is not null: undefined anywhere is an error', () => {
    expectCJSON(() => canonicalize(undefined), 'undefined', '');
    expectCJSON(() => canonicalize({ a: { b: [1, undefined] } }), 'undefined', '/a/b/1');
  });

  test('unsupported and non-plain values', () => {
    expectCJSON(() => canonicalize(() => 1), 'unsupported-type:function', '');
    expectCJSON(() => canonicalize(Symbol('s')), 'unsupported-type:symbol', '');
    expectCJSON(() => canonicalize(BigInt(2)), 'unsupported-type:bigint', '');
    expectCJSON(() => canonicalize(new Set()), 'non-plain-object', '');
    expectCJSON(() => canonicalize(new ArrayBuffer(1)), 'non-plain-object', '');
    expectCJSON(() => canonicalize(new Float64Array(1)), 'non-plain-object', '');
    expectCJSON(() => canonicalize(/x/), 'non-plain-object', '');
    expectCJSON(() => canonicalize({ d: new Date(0) }), 'non-plain-object', '/d');
    expectCJSON(() => canonicalize(new (class A extends Array {})()), 'non-plain-array', '');
    expectCJSON(() => canonicalize(Object.create({ inherited: 1 })), 'non-plain-object', '');
    expect(canonicalize(Object.create(null))).toBe('{}');
  });

  test('accessors, symbol keys, hidden properties and array extras', () => {
    expectCJSON(() => canonicalize({ get a() { return 1; } }), 'accessor', '/a'); // prettier-ignore
    expectCJSON(() => canonicalize({ [Symbol('k')]: 1 }), 'symbol-key', '');
    const hidden = {};
    Object.defineProperty(hidden, 'h', { value: 1, enumerable: false });
    expectCJSON(() => canonicalize(hidden), 'hidden-property', '');
    const extra = [1, 2];
    extra.note = 'x';
    expectCJSON(() => canonicalize(extra), 'array-extra-props', '');
    const symArr = [1];
    symArr[Symbol('s')] = 1;
    expectCJSON(() => canonicalize(symArr), 'array-extra-props', '');
    expectCJSON(() => canonicalize(new Array(3)), 'sparse-array', '/0');
  });

  test('depth: 32 nested containers accepted, 33 rejected (arrays and objects), path is the 33rd container', () => {
    expect(() => canonicalize(nested(32))).not.toThrow();
    expect(() => canonicalize(nestedObj(32))).not.toThrow();
    expectCJSON(() => canonicalize(nested(33)), 'too-deep', '/0'.repeat(32));
    expectCJSON(() => canonicalize(nestedObj(33)), 'too-deep', '/k'.repeat(32));
    // The limit counts containers, so an empty innermost container at level 33 is also too deep.
    expectCJSON(() => canonicalize(nested(32, [])), 'too-deep');
    expect(MAX_DEPTH).toBe(32);
  });

  test('size limits: string <= 1 MiB (UTF-8 bytes), output <= 16 MiB', () => {
    const mib = 1024 * 1024;
    expect(canonicalize('a'.repeat(mib)).length).toBe(mib + 2);
    expectCJSON(() => canonicalize('a'.repeat(mib + 1)), 'string-too-long', '');
    expect(() => canonicalize('é'.repeat(mib / 2))).not.toThrow(); // exactly 1 MiB of UTF-8
    expectCJSON(() => canonicalize({ k: ['é'.repeat(mib / 2 + 1)] }), 'string-too-long', '/k/0');
    const big = 'a'.repeat(mib);
    expectCJSON(() => canonicalize(Array.from({ length: 17 }, () => big)), 'too-large', '');
    expect(() => canonicalize(Array.from({ length: 15 }, () => big))).not.toThrow();
  });
});

describe('F64 hex helpers (spec 2.2/2.4)', () => {
  const vectors = loadFixture('hash-vectors.json').f64;

  test.each(vectors.map((v) => [v.value, v.hex, v]))('%s <-> %s', (_value, _hex, v) => {
    const x = Number(v.value);
    expect(f64Encode(x)).toBe(v.hex);
    const back = f64Decode(v.hex);
    if (Number.isNaN(x)) expect(Number.isNaN(back)).toBe(true);
    else expect(Object.is(back, x)).toBe(true);
  });

  test('NaN of any payload canonicalizes to 0x7ff8000000000000', () => {
    const dv = new DataView(new ArrayBuffer(8));
    dv.setUint32(0, 0xfff12345);
    dv.setUint32(4, 0xdeadbeef);
    expect(f64Encode(dv.getFloat64(0))).toBe('f64:7ff8000000000000');
  });

  test('-0 and +0 are distinct and visible', () => {
    expect(f64Encode(-0)).toBe('f64:8000000000000000');
    expect(f64Encode(0)).toBe('f64:0000000000000000');
    expect(Object.is(f64Decode('f64:8000000000000000'), -0)).toBe(true);
  });

  test('decode accepts only the exact canonical spelling', () => {
    for (const bad of [
      'f64:3FF8000000000000',
      'f64:3ff800000000000',
      'f64:3ff80000000000000',
      '3ff8000000000000',
      'F64:3ff8000000000000',
      'f64:3ff800000000000g',
      'f64:7ff8000000000001', // NaN with a payload
      'f64:fff8000000000000', // negative quiet NaN
      'f64:7ff0000000000001', // signalling NaN
      ' f64:3ff8000000000000',
      '',
      null,
      1.5,
    ]) {
      expectCJSON(() => f64Decode(bad), 'f64-noncanonical');
    }
    expect(() => f64Encode('1.5')).toThrow(TypeError);
  });

  test.each(loadFixture('hash-vectors.json').f64Reject.map((v) => [v.id, v]))('reject vector %s', (_id, v) => {
    expectCJSON(() => f64Decode(v.input), v.code, '');
  });

  test('seeded random bit patterns round trip (bit-exact except NaN payloads)', () => {
    const rand = prng(0xf64);
    for (let i = 0; i < 2000; i++) {
      const x = randomDouble(rand);
      const s = f64Encode(x);
      expect(s).toMatch(/^f64:[0-9a-f]{16}$/);
      const y = f64Decode(s);
      if (Number.isNaN(x)) expect(s).toBe('f64:7ff8000000000000');
      else expect(Object.is(x, y)).toBe(true);
    }
  });

  test('f64 strings are plain canonical-JSON strings', () => {
    expect(canonicalize({ p: [f64Encode(1.5), f64Encode(-0)] })).toBe('{"p":["f64:3ff8000000000000","f64:8000000000000000"]}');
  });
});

describe('parseCanonical: parse-level rejections', () => {
  const t = (s) => () => parseCanonical(s);

  test('spec examples', () => {
    expectCJSON(t('{"a":1,"a":2}'), 'duplicate-key', '/a');
    for (const s of ['{ "a": 1 }', '{"b":1,"a":2}', '{"a":1}\n', '{"a":"\\/"}', '{"a":1e2}', '{"a":"\\u0041"}']) {
      expectCJSON(t(s), 'not-canonical', '');
    }
  });

  test('more non-canonical spellings', () => {
    for (const s of ['1.0', '[1.50]', '[1E2]', '{"a":1} ', ' {"a":1}', '[1, 2]', '{"a":"\\u007f"}', '"\\u00e9"', '[1e0]', '[-1.0]']) {
      const e = thrown(t(s));
      expect(e).toBeInstanceOf(CJSONError);
      expect(['not-canonical', 'syntax-error']).toContain(e.code);
    }
    expectCJSON(t('1.0'), 'not-canonical');
    expectCJSON(t('"\\u00e9"'), 'not-canonical');
    expectCJSON(t('"\\ud83d\\ude00"'), 'not-canonical'); // escaped pair; canonical form is the literal character
    expectCJSON(t('[1e0]'), 'not-canonical');
  });

  test('duplicate keys are found at any depth, including after escapes decode to the same key', () => {
    expectCJSON(t('{"a":{"b":1,"b":2}}'), 'duplicate-key', '/a/b');
    expectCJSON(t('[{"x":1,"y":2,"x":3}]'), 'duplicate-key', '/0/x');
    expectCJSON(t('{"a":1,"\\u0061":2}'), 'duplicate-key', '/a');
    expect(() => parseCanonical('{"a":{"a":1},"b":{"a":2}}')).not.toThrow(); // same key in different objects is fine
  });

  test('values that fail serializer rules surface the serializer code', () => {
    expectCJSON(t('-0'), 'negative-zero', '');
    expectCJSON(t('[0,-0]'), 'negative-zero', '/1');
    expectCJSON(t('1e400'), 'infinity', '');
    expectCJSON(t('[9007199254740993]'), 'unsafe-integer', '/0');
    expectCJSON(t('[1e-7]'), 'float-out-of-range', '/0');
    expectCJSON(t('{"é":1}'), 'key-not-allowed');
    expectCJSON(t('{"__proto__":1}'), 'proto-key', '/__proto__');
    expectCJSON(t('{"a":"\\ud800"}'), 'lone-surrogate', '/a');
    expectCJSON(t('{"a":"\\udc00x"}'), 'lone-surrogate', '/a');
  });

  test('syntax errors', () => {
    for (const s of [
      '',
      ' ',
      '{',
      '}',
      '[',
      '[1,',
      '[1,]',
      '[,1]',
      '{"a"}',
      '{"a":}',
      '{"a":1,}',
      '{a:1}',
      "{'a':1}",
      '{"a":1 "b":2}',
      '[1 2]',
      'nul',
      'tru',
      'NaN',
      'Infinity',
      '+1',
      '.5',
      '1.',
      '[1.e3]',
      '0x10',
      '[1]x',
      '{}{}',
      '"abc',
      '"a\nb"',
      '"a\tb"',
      '"\\x"',
      '"\\u12"',
      '"\\u12g4"',
      '// c\n1',
      '[undefined]',
    ]) {
      expectCJSON(t(s), 'syntax-error');
    }
    expectCJSON(t('01'), 'syntax-error');
    expectCJSON(t('[1,\n2]'), 'not-canonical');
  });

  test('depth: 32 nested containers parse, 33 are too-deep (no stack overflow on absurd nesting)', () => {
    expect(parseCanonical(`${'['.repeat(32)}0${']'.repeat(32)}`)).toEqual(nested(32));
    expectCJSON(t(`${'['.repeat(33)}0${']'.repeat(33)}`), 'too-deep', '/0'.repeat(32));
    expectCJSON(t(`${'{"k":'.repeat(33)}0${'}'.repeat(33)}`), 'too-deep');
    expectCJSON(t('['.repeat(100000) + ']'.repeat(100000)), 'too-deep', '/0'.repeat(32));
    expectCJSON(t('['.repeat(100000)), 'syntax-error'); // a syntax error outranks the earlier depth violation
  });

  test('invalid UTF-8 is rejected before parsing', () => {
    const cases = {
      'stray continuation': 'c3a9 80',
      'lone 0xff': 'ff',
      'overlong NUL (c0 80)': 'c0 80',
      'overlong slash (c0 af)': 'c0 af',
      'overlong 3-byte (e0 80 80)': 'e0 80 80',
      'overlong 4-byte (f0 80 80 80)': 'f0 80 80 80',
      'CESU surrogate (ed a0 80)': 'ed a0 80',
      'above U+10FFFF (f4 90 80 80)': 'f4 90 80 80',
      'f5 start byte': 'f5 80 80 80',
      'truncated 2-byte': 'c3',
      'truncated 3-byte': 'e2 82',
      'truncated 4-byte': 'f0 9f 98',
      'bad continuation': 'e2 28 a1',
    };
    for (const [label, hex] of Object.entries(cases)) {
      const body = fromHex(hex.replace(/ /g, ''));
      const bytes = new Uint8Array([0x22, ...body, 0x22]); // inside a JSON string
      const e = thrown(() => parseCanonical(bytes));
      expect([label, e && e.code]).toEqual([label, 'invalid-utf8']);
      expect(thrown(() => dec.decode(bytes))).toBeTruthy(); // node's strict decoder agrees it is invalid
    }
  });

  test('UTF-8 byte order mark is not canonical', () => {
    expectCJSON(() => parseCanonical(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), 'bom', '');
    expectCJSON(t('\ufeff{}'), 'bom', '');
  });

  test('accepts bytes, views with offsets, and strings; returns null-prototype objects', () => {
    const text = '{"a":[1,{"__x":null,"b":"é😀"}],"z":true}';
    const bytes = enc.encode(text);
    const padded = new Uint8Array(bytes.length + 8);
    padded.set(bytes, 4);
    const view = padded.subarray(4, 4 + bytes.length);
    for (const input of [text, bytes, view, Buffer.from(bytes), bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length)]) {
      const v = parseCanonical(input);
      expect(canonicalize(v)).toBe(text);
      expect(Object.getPrototypeOf(v)).toBeNull();
      expect(Object.getPrototypeOf(v.a[1])).toBeNull();
    }
    for (const bad of [new DataView(padded.buffer), new Int8Array(2), new Uint8ClampedArray(2), new Uint16Array(2), [1, 2]]) {
      expectCJSON(() => parseCanonical(bad), 'unsupported-type:object');
    }
    expectCJSON(() => parseCanonical(42), 'unsupported-type:number');
    expectCJSON(() => parseCanonical(null), 'unsupported-type:object');
  });

  test('__proto__ cannot pollute: parse rejects it and Object.prototype stays clean', () => {
    expectCJSON(t('{"__proto__":{"polluted":true}}'), 'proto-key');
    expect({}.polluted).toBeUndefined();
    expect(Object.prototype.polluted).toBeUndefined();
  });

  test('output-too-large input is rejected up front', () => {
    expectCJSON(() => parseCanonical(new Uint8Array(16 * 1024 * 1024 + 1)), 'too-large', '');
  });
});

describe('UTF-8 codec vs node (seeded)', () => {
  test('utf8Encode == TextEncoder and utf8DecodeStrict inverts it on random well-formed strings', () => {
    const rand = prng(0x8f);
    for (let i = 0; i < 1500; i++) {
      let s = '';
      const n = rand.int(40);
      for (let k = 0; k < n; k++) {
        const r = rand.int(4);
        let cp = r === 0 ? rand.int(0x80) : r === 1 ? 0x80 + rand.int(0x780) : r === 2 ? 0x800 + rand.int(0xf800) : 0x10000 + rand.int(0x100000);
        if (cp >= 0xd800 && cp <= 0xdfff) cp = 0xfffd;
        s += String.fromCodePoint(cp);
      }
      const bytes = utf8Encode(s);
      expect(toHex(bytes)).toBe(toHex(enc.encode(s)));
      expect(utf8DecodeStrict(bytes)).toBe(s);
    }
  });

  test('utf8DecodeStrict accepts exactly what the fatal TextDecoder accepts on random byte strings', () => {
    const rand = prng(0xbad);
    const alphabet = [0x00, 0x41, 0x7f, 0x80, 0xbf, 0xc0, 0xc2, 0xdf, 0xe0, 0xa0, 0xed, 0xef, 0xf0, 0xf4, 0xf5, 0xff, 0x90, 0x9f];
    let ok = 0;
    for (let i = 0; i < 6000; i++) {
      const bytes = Uint8Array.from({ length: rand.int(7) }, () => (rand.int(3) ? rand.pick(alphabet) : rand.int(256)));
      let want;
      try {
        want = dec.decode(bytes);
      } catch {
        want = null;
      }
      const e = thrown(() => utf8DecodeStrict(bytes));
      if (want === null) expect([toHex(bytes), e && e.code]).toEqual([toHex(bytes), 'invalid-utf8']);
      else {
        ok++;
        expect(e).toBeNull();
        expect(utf8DecodeStrict(bytes)).toBe(want);
      }
    }
    expect(ok).toBeGreaterThan(500); // the generator does produce plenty of valid sequences
  });

  test('utf8Encode rejects lone surrogates', () => {
    expectCJSON(() => utf8Encode('\ud800'), 'lone-surrogate');
  });

  test('a BOM decodes to U+FEFF (not stripped)', () => {
    expect(utf8DecodeStrict(new Uint8Array([0xef, 0xbb, 0xbf, 0x41]))).toBe('﻿A');
  });
});

describe('seeded property tests', () => {
  test('round trip: parse(canonicalBytes(v)) re-serializes to identical bytes and equals v', () => {
    const rand = prng(0xc0ffee);
    for (let i = 0; i < 1500; i++) {
      const v = randomValueWithStrings(rand);
      const text = canonicalize(v);
      const bytes = canonicalBytes(v);
      expect(toHex(bytes)).toBe(toHex(enc.encode(text)));
      const parsed = parseCanonical(bytes);
      expect(parsed).toEqual(v);
      expect(toHex(canonicalBytes(parsed))).toBe(toHex(bytes));
      expect(canonicalize(parseCanonical(text))).toBe(text);
    }
  });

  test('output is independent of key insertion order and of prototype (plain vs null-prototype)', () => {
    const rand = prng(0x0d0e);
    const rebuild = (x, shuffle, nullProto) => {
      if (Array.isArray(x)) return x.map((y) => rebuild(y, shuffle, nullProto));
      if (x !== null && typeof x === 'object') {
        const keys = Object.keys(x);
        if (shuffle) for (let i = keys.length - 1; i > 0; i--) { const j = rand.int(i + 1); [keys[i], keys[j]] = [keys[j], keys[i]]; } // prettier-ignore
        const o = nullProto ? Object.create(null) : {};
        for (const k of keys) o[k] = rebuild(x[k], shuffle, nullProto);
        return o;
      }
      return x;
    };
    for (let i = 0; i < 400; i++) {
      const v = randomValueWithStrings(rand);
      const want = canonicalize(v);
      expect(canonicalize(rebuild(v, true, false))).toBe(want);
      expect(canonicalize(rebuild(v, true, true))).toBe(want);
    }
  });

  test('agrees with an independent oracle (JSON.stringify per leaf, sorted keys)', () => {
    const rand = prng(0x1234);
    // Manual recursion: a plain-object clone would reorder integer-like keys ("5" before "-x") on its own.
    const oracle = (x) => {
      if (Array.isArray(x)) return `[${x.map(oracle).join(',')}]`;
      if (x !== null && typeof x === 'object') {
        return `{${Object.keys(x)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${oracle(x[k])}`)
          .join(',')}}`;
      }
      return JSON.stringify(x);
    };
    for (let i = 0; i < 1500; i++) {
      const v = randomValueWithStrings(rand);
      expect(canonicalize(v)).toBe(oracle(v));
    }
  });

  test('every canonical output is a fixed point of parse + canonicalize and survives one more cycle', () => {
    const rand = prng(0x5eed);
    for (let i = 0; i < 300; i++) {
      const text = canonicalize(randomValueWithStrings(rand));
      const once = canonicalize(parseCanonical(text));
      expect(once).toBe(text);
      expect(canonicalize(parseCanonical(once))).toBe(once);
    }
  });

  test('random double values: if the serializer accepts them, text re-parses to the same double', () => {
    const rand = prng(0xd0b1e);
    let accepted = 0;
    for (let i = 0; i < 3000; i++) {
      const x = randomDouble(rand) * (i % 3 === 0 ? 1e-290 : i % 3 === 1 ? 1e290 : 1);
      const y = i % 2 ? x / 1e280 : x;
      const e = thrown(() => canonicalize(y));
      if (e) {
        expect(e).toBeInstanceOf(CJSONError);
        expect(['nan', 'infinity', 'negative-zero', 'unsafe-integer', 'float-out-of-range']).toContain(e.code);
      } else {
        accepted++;
        expect(Object.is(parseCanonical(canonicalize(y)), y)).toBe(true);
      }
    }
    expect(accepted).toBeGreaterThan(50);
  });
});
