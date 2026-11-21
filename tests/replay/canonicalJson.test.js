// Replay Contract v1, section 2: BB-CJSON v1 canonical JSON (vectors, rejections, parse-level checks, properties).
import { TextDecoder as NodeTextDecoder, TextEncoder as NodeTextEncoder } from 'node:util';
import {
  CJSONError,
  MAX_DEPTH,
  canonicalBytes,
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
  if (path !== undefined) expect(e.path).toBe(path);
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
    expect(canonicalize(input)).toBe(v.text);
    const bytes = canonicalBytes(input);
    expect(toHex(bytes)).toBe(v.hex);
    expect(toHex(utf8Encode(v.text))).toBe(v.hex);
    expect(toHex(enc.encode(v.text))).toBe(v.hex);
    const parsed = parseCanonical(bytes);
    expect(canonicalize(parsed)).toBe(v.text);
    expect(parseCanonical(v.text)).toEqual(parsed);
  });

  test('cj-005 emits U+007F and U+2028 literally and lowercase \\u00xx for other controls', () => {
    const v = vectors.find((x) => x.id.startsWith('cj-005'));
    expect(v.hex).toContain('5c7530303166'); // \u001f lowercase
    expect(v.hex).toContain('7fe280a8'); // U+007F and U+2028 as raw UTF-8
  });

  test('cj-009 does not normalize: NFC and NFD differ', () => {
    const v = vectors.find((x) => x.id.startsWith('cj-009'));
    expect(v.hex).toContain('c3a9');
    expect(v.hex).toContain('65cc81');
  });

  test('cj-011: 32 nested containers are accepted', () => {
    expect(canonicalize(nested(32)).length).toBe(65);
    expect(canonicalize(nestedObj(32))).toBeTruthy();
  });
});

describe('cjson-reject vectors (spec 2.4 "Required rejections", rj-*)', () => {
  const vectors = loadFixture('cjson-reject.json');

  test('ids cover rj-001..rj-026', () => {
    expect(vectors.map((v) => v.id.slice(0, 6))).toEqual(
      Array.from({ length: 26 }, (_, i) => `rj-${String(i + 1).padStart(3, '0')}`),
    );
  });

  test('every code named in the spec is exercised', () => {
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
    ];
    expect(new Set(vectors.map((v) => v.code))).toEqual(new Set(want));
  });

  test('every JS descriptor in the fixtures has a table entry and every entry is used', () => {
    const used = new Set(
      [...vectors, ...loadFixture('cjson-valid.json')].filter((v) => v.input && v.input.$js).map((v) => v.input.$js),
    );
    expect(Object.keys(JS_INPUTS).sort()).toEqual([...used].sort());
  });

  test.each(vectors.map((v) => [v.id, v]))('%s fails with its code and path', (_id, v) => {
    if (v.via === 'canonicalize') {
      const input = resolveInput(v.input);
      expectCJSON(() => canonicalize(input), v.code, v.path);
      expectCJSON(() => canonicalBytes(input), v.code, v.path);
    } else {
      expect(v.via).toBe('parse');
      expectCJSON(() => parseCanonical(v.input), v.code, v.path);
      expectCJSON(() => parseCanonical(enc.encode(v.input)), v.code, v.path);
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
    expectCJSON(() => canonicalize({ a: [0, -0] }), 'negative-zero', '$.a[1]');
    expectCJSON(() => canonicalize([2 ** 53]), 'unsafe-integer', '$[0]');
    expectCJSON(() => canonicalize(-(2 ** 53)), 'unsafe-integer', '$');
    expect(canonicalize(Number.MAX_SAFE_INTEGER)).toBe('9007199254740991');
    expect(canonicalize(Number.MIN_SAFE_INTEGER)).toBe('-9007199254740991');
  });

  test('non-integer band: 1e-6 <= |x| < 1e21, exponent text is rejected', () => {
    expect(canonicalize(0.000001)).toBe('0.000001');
    expect(canonicalize(-0.000001)).toBe('-0.000001');
    expectCJSON(() => canonicalize(0.0000001), 'float-out-of-range', '$');
    expectCJSON(() => canonicalize(5e-324), 'float-out-of-range', '$');
    expectCJSON(() => canonicalize(1.5e-10), 'float-out-of-range', '$');
    expectCJSON(() => canonicalize(Number.MAX_VALUE), 'unsafe-integer', '$');
    expectCJSON(() => canonicalize(-Infinity), 'infinity', '$');
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
      expectCJSON(() => canonicalize({ a: [s] }), 'lone-surrogate', '$.a[0]');
    }
  });

  test('key alphabet: length 1..64, A-Za-z0-9_.:$-, __proto__ rejected', () => {
    expect(canonicalize({ [`a${'b'.repeat(63)}`]: 1 })).toBe(`{"a${'b'.repeat(63)}":1}`);
    expectCJSON(() => canonicalize({ [`a${'b'.repeat(64)}`]: 1 }), 'key-not-allowed');
    expectCJSON(() => canonicalize({ '': 1 }), 'key-not-allowed', '$.');
    expectCJSON(() => canonicalize({ 'a b': 1 }), 'key-not-allowed', '$.a b');
    expectCJSON(() => canonicalize({ 'a"b': 1 }), 'key-not-allowed');
    expectCJSON(() => canonicalize({ 'a/b': 1 }), 'key-not-allowed');
    expectCJSON(() => canonicalize({ 'a\u0000': 1 }), 'key-not-allowed');
    expect(canonicalize({ 'A.b:c$d-e_f9': 1 })).toBe('{"A.b:c$d-e_f9":1}');
    expectCJSON(() => canonicalize(JSON.parse('{"x":{"__proto__":1}}')), 'proto-key', '$.x');
  });

  test('absent is not null: undefined anywhere is an error', () => {
    expectCJSON(() => canonicalize(undefined), 'undefined', '$');
    expectCJSON(() => canonicalize({ a: { b: [1, undefined] } }), 'undefined', '$.a.b[1]');
  });

  test('unsupported and non-plain values', () => {
    expectCJSON(() => canonicalize(() => 1), 'unsupported-type:function', '$');
    expectCJSON(() => canonicalize(Symbol('s')), 'unsupported-type:symbol', '$');
    expectCJSON(() => canonicalize(BigInt(2)), 'unsupported-type:bigint', '$');
    expectCJSON(() => canonicalize(new Set()), 'non-plain-object', '$');
    expectCJSON(() => canonicalize(new ArrayBuffer(1)), 'non-plain-object', '$');
    expectCJSON(() => canonicalize(new Float64Array(1)), 'non-plain-object', '$');
    expectCJSON(() => canonicalize(/x/), 'non-plain-object', '$');
    expectCJSON(() => canonicalize({ d: new Date(0) }), 'non-plain-object', '$.d');
    expectCJSON(() => canonicalize(new (class A extends Array {})()), 'non-plain-array', '$');
    expectCJSON(() => canonicalize(Object.create({ inherited: 1 })), 'non-plain-object', '$');
    expect(canonicalize(Object.create(null))).toBe('{}');
  });

  test('accessors, symbol keys, hidden properties and array extras', () => {
    expectCJSON(() => canonicalize({ get a() { return 1; } }), 'accessor', '$.a'); // prettier-ignore
    expectCJSON(() => canonicalize({ [Symbol('k')]: 1 }), 'symbol-key', '$');
    const hidden = {};
    Object.defineProperty(hidden, 'h', { value: 1, enumerable: false });
    expectCJSON(() => canonicalize(hidden), 'hidden-property', '$');
    const extra = [1, 2];
    extra.note = 'x';
    expectCJSON(() => canonicalize(extra), 'array-extra-props', '$');
    const symArr = [1];
    symArr[Symbol('s')] = 1;
    expectCJSON(() => canonicalize(symArr), 'array-extra-props', '$');
    expectCJSON(() => canonicalize(new Array(3)), 'sparse-array', '$[0]');
  });

  test('depth: 32 nested containers accepted, 33 rejected (arrays and objects), path is the 33rd container', () => {
    expect(() => canonicalize(nested(32))).not.toThrow();
    expect(() => canonicalize(nestedObj(32))).not.toThrow();
    expectCJSON(() => canonicalize(nested(33)), 'too-deep', `$${'[0]'.repeat(32)}`);
    expectCJSON(() => canonicalize(nestedObj(33)), 'too-deep', `$${'.k'.repeat(32)}`);
    // The limit counts containers, so an empty innermost container at level 33 is also too deep.
    expectCJSON(() => canonicalize(nested(32, [])), 'too-deep');
    expect(MAX_DEPTH).toBe(32);
  });

  test('size limits: string <= 1 MiB (UTF-8 bytes), output <= 16 MiB', () => {
    const mib = 1024 * 1024;
    expect(canonicalize('a'.repeat(mib)).length).toBe(mib + 2);
    expectCJSON(() => canonicalize('a'.repeat(mib + 1)), 'string-too-long', '$');
    expect(() => canonicalize('é'.repeat(mib / 2))).not.toThrow(); // exactly 1 MiB of UTF-8
    expectCJSON(() => canonicalize({ k: ['é'.repeat(mib / 2 + 1)] }), 'string-too-long', '$.k[0]');
    const big = 'a'.repeat(mib);
    expectCJSON(() => canonicalize(Array.from({ length: 17 }, () => big)), 'output-too-large', '$');
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
      ' f64:3ff8000000000000',
      '',
      null,
      1.5,
    ]) {
      expectCJSON(() => f64Decode(bad), 'bad-f64');
    }
    expectCJSON(() => f64Encode('1.5'), 'bad-f64');
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
    expectCJSON(t('{"a":1,"a":2}'), 'duplicate-key', '$');
    for (const s of ['{ "a": 1 }', '{"b":1,"a":2}', '{"a":1}\n', '{"a":"\\/"}', '{"a":1e2}', '{"a":"\\u0041"}']) {
      expectCJSON(t(s), 'not-canonical', '$');
    }
  });

  test('more non-canonical spellings', () => {
    for (const s of ['1.0', '[1.50]', '[1E2]', '{"a":1} ', ' {"a":1}', '[1, 2]', '{"a":"\\u007f"}', '"\\u00e9"', '[1e0]', '[-1.0]']) {
      const e = thrown(t(s));
      expect(e).toBeInstanceOf(CJSONError);
      expect(['not-canonical', 'syntax']).toContain(e.code);
    }
    expectCJSON(t('1.0'), 'not-canonical');
    expectCJSON(t('"\\u00e9"'), 'not-canonical');
    expectCJSON(t('"\\ud83d\\ude00"'), 'not-canonical'); // escaped pair; canonical form is the literal character
    expectCJSON(t('[1e0]'), 'not-canonical');
  });

  test('duplicate keys are found at any depth, including after escapes decode to the same key', () => {
    expectCJSON(t('{"a":{"b":1,"b":2}}'), 'duplicate-key', '$.a');
    expectCJSON(t('[{"x":1,"y":2,"x":3}]'), 'duplicate-key', '$[0]');
    expectCJSON(t('{"a":1,"\\u0061":2}'), 'duplicate-key', '$');
    expect(() => parseCanonical('{"a":{"a":1},"b":{"a":2}}')).not.toThrow(); // same key in different objects is fine
  });

  test('values that fail serializer rules surface the serializer code', () => {
    expectCJSON(t('-0'), 'negative-zero', '$');
    expectCJSON(t('[0,-0]'), 'negative-zero', '$[1]');
    expectCJSON(t('1e400'), 'infinity', '$');
    expectCJSON(t('[9007199254740993]'), 'unsafe-integer', '$[0]');
    expectCJSON(t('[1e-7]'), 'float-out-of-range', '$[0]');
    expectCJSON(t('{"é":1}'), 'key-not-allowed');
    expectCJSON(t('{"__proto__":1}'), 'proto-key', '$');
    expectCJSON(t('{"a":"\\ud800"}'), 'lone-surrogate', '$.a');
    expectCJSON(t('{"a":"\\udc00x"}'), 'lone-surrogate', '$.a');
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
      expectCJSON(t(s), 'syntax');
    }
    expectCJSON(t('01'), 'syntax');
    expectCJSON(t('[1,\n2]'), 'not-canonical');
  });

  test('depth: 32 nested containers parse, 33 are too-deep (no stack overflow on absurd nesting)', () => {
    expect(parseCanonical(`${'['.repeat(32)}0${']'.repeat(32)}`)).toEqual(nested(32));
    expectCJSON(t(`${'['.repeat(33)}0${']'.repeat(33)}`), 'too-deep', `$${'[0]'.repeat(32)}`);
    expectCJSON(t(`${'{"k":'.repeat(33)}0${'}'.repeat(33)}`), 'too-deep');
    expectCJSON(t('['.repeat(100000)), 'too-deep');
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
    expectCJSON(() => parseCanonical(new Uint8Array([0xef, 0xbb, 0xbf, 0x7b, 0x7d])), 'not-canonical', '$');
    expectCJSON(t('﻿{}'), 'syntax');
  });

  test('accepts bytes, views with offsets, and strings; returns null-prototype objects', () => {
    const text = '{"a":[1,{"__x":null,"b":"é😀"}],"z":true}';
    const bytes = enc.encode(text);
    const padded = new Uint8Array(bytes.length + 8);
    padded.set(bytes, 4);
    const view = padded.subarray(4, 4 + bytes.length);
    for (const input of [text, bytes, view, new DataView(padded.buffer, 4, bytes.length)]) {
      const v = parseCanonical(input);
      expect(canonicalize(v)).toBe(text);
      expect(Object.getPrototypeOf(v)).toBeNull();
      expect(Object.getPrototypeOf(v.a[1])).toBeNull();
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
    expectCJSON(() => parseCanonical(new Uint8Array(16 * 1024 * 1024 + 1)), 'output-too-large', '$');
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
