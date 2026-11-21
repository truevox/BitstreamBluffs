/**
 * BB-CJSON v1: canonical JSON for Replay Contract v1 (docs/replay/replay-contract-v1.md, section 2, with the binding
 * amendments from the independent review).
 *
 * A strict profile of RFC 8785 (JCS): the same bytes in every implementation, so a SHA-256 over them is a stable
 * identity. Anything not representable is an error with a stable `code` and an RFC 6901 JSON Pointer `pointer`
 * (root is the empty string, e.g. "/causal/bsod/syncLevel", "/pose/2"), never silently altered. Pure module: no
 * Phaser, no clock, no randomness, no TextEncoder/TextDecoder (UTF-8 is done by hand so it behaves identically under
 * Node, browsers and Jest's jsdom).
 *
 * Error codes: nan, infinity, negative-zero, unsafe-integer, float-out-of-range, undefined, lone-surrogate,
 * key-not-allowed, proto-key, non-plain-object, unsupported-type:<typeof>, sparse-array, too-deep, duplicate-key,
 * not-canonical, invalid-utf8, bom, syntax-error, too-large (canonical bytes > 16 MiB), string-too-long (string >
 * 1 MiB of UTF-8), f64-noncanonical. Additional codes (not named by the contract): non-plain-array, array-extra-props,
 * symbol-key, accessor, hidden-property.
 *
 * parseCanonical error precedence (deterministic): UTF-8 decode -> BOM -> too-large -> syntax-error / duplicate-key
 * (first offender in document order) -> value-level rejections (first offender in document order: depth, number,
 * string, key rules) -> re-serialize byte equality (`not-canonical`). Token-level forms such as `1.0`, `1e2` are caught
 * by the byte-equality step; a parsed -0 value is `negative-zero`.
 */

export const MAX_DEPTH = 32;
export const MAX_OUTPUT_BYTES = 16777216; // 16 MiB
export const MAX_STRING_BYTES = 1048576; // 1 MiB

const KEY_RE = /^[A-Za-z0-9_.:$-]{1,64}$/;
const NEEDS_ESCAPE_RE = /[\u0000-\u001f"\\]/;
const F64_RE = /^f64:[0-9a-f]{16}$/;

/** Error for every canonical-JSON failure. `code` is contract-stable; `pointer` is an RFC 6901 JSON Pointer. */
export class CJSONError extends Error {
  /**
   * @param {string} code
   * @param {string} pointer RFC 6901 JSON Pointer ("" is the root)
   * @param {string} [detail]
   */
  constructor(code, pointer, detail) {
    super(`${code} at pointer ${JSON.stringify(pointer)}${detail ? ` (${detail})` : ''}`);
    this.name = 'CJSONError';
    this.code = code;
    this.pointer = pointer;
  }
}

/** RFC 6901 reference-token escaping. */
const esc = (token) => String(token).replace(/~/g, '~0').replace(/\//g, '~1');

// ---------------------------------------------------------------------------------------------------------------------
// UTF-8 (hand-rolled so the module has no environment dependencies)
// ---------------------------------------------------------------------------------------------------------------------

/** True when `s` has no unpaired UTF-16 surrogate. */
function isWellFormed(s) {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) i++;
      else return false;
    } else if (c >= 0xdc00 && c <= 0xdfff) return false;
  }
  return true;
}

/**
 * UTF-8 byte length of a well-formed string.
 * @param {string} s
 * @returns {number}
 */
export function utf8Length(s) {
  let n = 0;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
}

/**
 * Encode a well-formed string as UTF-8. Throws CJSONError('lone-surrogate') on an unpaired surrogate.
 * @param {string} s
 * @returns {Uint8Array}
 */
export function utf8Encode(s) {
  if (!isWellFormed(s)) throw new CJSONError('lone-surrogate', '');
  const out = new Uint8Array(utf8Length(s));
  let p = 0;
  for (let i = 0; i < s.length; i++) {
    let c = s.charCodeAt(i);
    if (c < 0x80) out[p++] = c;
    else if (c < 0x800) {
      out[p++] = 0xc0 | (c >> 6);
      out[p++] = 0x80 | (c & 63);
    } else if (c >= 0xd800 && c <= 0xdbff) {
      c = 0x10000 + ((c - 0xd800) << 10) + (s.charCodeAt(++i) - 0xdc00);
      out[p++] = 0xf0 | (c >> 18);
      out[p++] = 0x80 | ((c >> 12) & 63);
      out[p++] = 0x80 | ((c >> 6) & 63);
      out[p++] = 0x80 | (c & 63);
    } else {
      out[p++] = 0xe0 | (c >> 12);
      out[p++] = 0x80 | ((c >> 6) & 63);
      out[p++] = 0x80 | (c & 63);
    }
  }
  return out;
}

/**
 * Strict UTF-8 decode: rejects overlong forms, surrogate code points, values above U+10FFFF, truncated and stray bytes.
 * A leading BOM is NOT stripped (it decodes to U+FEFF).
 * @param {Uint8Array} bytes
 * @returns {string}
 * @throws {CJSONError} code `invalid-utf8`
 */
export function utf8DecodeStrict(bytes) {
  const bad = (i) => new CJSONError('invalid-utf8', '', `byte offset ${i}`);
  let out = '';
  let chunk = [];
  const n = bytes.length;
  for (let i = 0; i < n; ) {
    const b0 = bytes[i];
    let cp;
    if (b0 < 0x80) {
      cp = b0;
      i += 1;
    } else if (b0 >= 0xc2 && b0 <= 0xdf) {
      if (i + 1 >= n || (bytes[i + 1] & 0xc0) !== 0x80) throw bad(i);
      cp = ((b0 & 0x1f) << 6) | (bytes[i + 1] & 63);
      i += 2;
    } else if (b0 >= 0xe0 && b0 <= 0xef) {
      if (i + 2 >= n || (bytes[i + 1] & 0xc0) !== 0x80 || (bytes[i + 2] & 0xc0) !== 0x80) throw bad(i);
      cp = ((b0 & 0x0f) << 12) | ((bytes[i + 1] & 63) << 6) | (bytes[i + 2] & 63);
      if (cp < 0x800 || (cp >= 0xd800 && cp <= 0xdfff)) throw bad(i);
      i += 3;
    } else if (b0 >= 0xf0 && b0 <= 0xf4) {
      if (
        i + 3 >= n ||
        (bytes[i + 1] & 0xc0) !== 0x80 ||
        (bytes[i + 2] & 0xc0) !== 0x80 ||
        (bytes[i + 3] & 0xc0) !== 0x80
      )
        throw bad(i);
      cp = ((b0 & 0x07) << 18) | ((bytes[i + 1] & 63) << 12) | ((bytes[i + 2] & 63) << 6) | (bytes[i + 3] & 63);
      if (cp < 0x10000 || cp > 0x10ffff) throw bad(i);
      i += 4;
    } else throw bad(i);
    if (cp >= 0x10000) {
      cp -= 0x10000;
      chunk.push(0xd800 + (cp >> 10), 0xdc00 + (cp & 0x3ff));
    } else chunk.push(cp);
    if (chunk.length >= 4096) {
      out += String.fromCharCode.apply(null, chunk);
      chunk = [];
    }
  }
  if (chunk.length) out += String.fromCharCode.apply(null, chunk);
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// Serializer
// ---------------------------------------------------------------------------------------------------------------------

/** Exact string rules: well-formed UTF-16 and at most MAX_STRING_BYTES of UTF-8. Returns an error code or null. */
function stringViolation(s) {
  if (!isWellFormed(s)) return 'lone-surrogate';
  // UTF-16 length <= UTF-8 length <= 3 x UTF-16 length: only compute the exact size when the cheap bounds disagree.
  if (s.length > MAX_STRING_BYTES || (s.length * 3 > MAX_STRING_BYTES && utf8Length(s) > MAX_STRING_BYTES)) {
    return 'string-too-long';
  }
  return null;
}

/** Key rules. Returns an error code or null. */
function keyViolation(k) {
  if (!KEY_RE.test(k)) return 'key-not-allowed';
  if (k === '__proto__') return 'proto-key';
  return null;
}

function serString(s, pointer) {
  const bad = stringViolation(s);
  if (bad) throw new CJSONError(bad, pointer);
  if (!NEEDS_ESCAPE_RE.test(s)) return `"${s}"`;
  let out = '"';
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x22) out += '\\"';
    else if (c === 0x5c) out += '\\\\';
    else if (c === 0x08) out += '\\b';
    else if (c === 0x09) out += '\\t';
    else if (c === 0x0a) out += '\\n';
    else if (c === 0x0c) out += '\\f';
    else if (c === 0x0d) out += '\\r';
    else if (c < 0x20) out += `\\u${c.toString(16).padStart(4, '0')}`;
    else out += s[i];
  }
  return `${out}"`;
}

function serNumber(v, pointer) {
  if (Number.isNaN(v)) throw new CJSONError('nan', pointer);
  if (!Number.isFinite(v)) throw new CJSONError('infinity', pointer);
  if (Object.is(v, -0)) throw new CJSONError('negative-zero', pointer);
  if (Number.isInteger(v)) {
    if (!Number.isSafeInteger(v)) throw new CJSONError('unsafe-integer', pointer);
    return String(v);
  }
  const s = String(v);
  if (s.includes('e')) throw new CJSONError('float-out-of-range', pointer);
  return s;
}

const toStringTag = (v) => Object.prototype.toString.call(v);

/**
 * Cross-realm plain-object test: prototype is null, or the prototype's own prototype is null and the object's
 * toString tag is "[object Object]" (so Object.prototype of any realm qualifies; Date, Map, typed arrays, class
 * instances and objects with an inherited prototype chain do not).
 */
function isPlainObject(v) {
  const proto = Object.getPrototypeOf(v);
  if (proto === null) return true;
  return Object.getPrototypeOf(proto) === null && toStringTag(v) === '[object Object]';
}

/** Plain array: Array.isArray and a prototype that is some realm's Array.prototype (chain length exactly 2). */
function isPlainArray(v) {
  const proto = Object.getPrototypeOf(v);
  return proto !== null && Object.getPrototypeOf(Object.getPrototypeOf(proto)) === null && toStringTag(v) === '[object Array]';
}

/**
 * @param {*} v
 * @param {string} pointer JSON Pointer of `v`
 * @param {number} level number of containers enclosing `v` (0 at the root)
 * @returns {string}
 */
function ser(v, pointer, level) {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'string':
      return serString(v, pointer);
    case 'number':
      return serNumber(v, pointer);
    case 'undefined':
      throw new CJSONError('undefined', pointer);
    case 'object':
      break;
    default:
      throw new CJSONError(`unsupported-type:${typeof v}`, pointer);
  }
  // `v` is a container: it sits at nesting level `level + 1`, which must not exceed MAX_DEPTH.
  if (level + 1 > MAX_DEPTH) throw new CJSONError('too-deep', pointer);
  if (Array.isArray(v)) {
    if (!isPlainArray(v)) throw new CJSONError('non-plain-array', pointer);
    const parts = new Array(v.length);
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) throw new CJSONError('sparse-array', `${pointer}/${i}`);
      parts[i] = ser(v[i], `${pointer}/${i}`, level + 1);
    }
    if (Object.getOwnPropertyNames(v).length !== v.length + 1 || Object.getOwnPropertySymbols(v).length) {
      throw new CJSONError('array-extra-props', pointer);
    }
    return `[${parts.join(',')}]`;
  }
  if (!isPlainObject(v)) throw new CJSONError('non-plain-object', pointer);
  if (Object.getOwnPropertySymbols(v).length) throw new CJSONError('symbol-key', pointer);
  const keys = Object.keys(v);
  if (Object.getOwnPropertyNames(v).length !== keys.length) throw new CJSONError('hidden-property', pointer);
  for (const k of keys) {
    const bad = keyViolation(k);
    if (bad) throw new CJSONError(bad, `${pointer}/${esc(k)}`);
    if (!('value' in Object.getOwnPropertyDescriptor(v, k))) throw new CJSONError('accessor', `${pointer}/${esc(k)}`);
  }
  keys.sort(); // UTF-16 code unit order; keys are ASCII so it equals code point and UTF-8 byte order
  let out = '{';
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    out += `${i ? ',' : ''}"${k}":${ser(v[k], `${pointer}/${esc(k)}`, level + 1)}`;
  }
  return `${out}}`;
}

/**
 * Canonical text of `value` (BB-CJSON v1).
 * @param {*} value
 * @returns {string}
 * @throws {CJSONError}
 */
export function canonicalize(value) {
  const text = ser(value, '', 0);
  // UTF-16 length is a lower bound of the byte length: only measure when it could matter.
  if (text.length > MAX_OUTPUT_BYTES || (text.length * 3 > MAX_OUTPUT_BYTES && utf8Length(text) > MAX_OUTPUT_BYTES)) {
    throw new CJSONError('too-large', '');
  }
  return text;
}

/**
 * Canonical UTF-8 bytes of `value`.
 * @param {*} value
 * @returns {Uint8Array}
 * @throws {CJSONError}
 */
export function canonicalBytes(value) {
  return utf8Encode(canonicalize(value));
}

// ---------------------------------------------------------------------------------------------------------------------
// Strict parser
// ---------------------------------------------------------------------------------------------------------------------

const NUMBER_RE = /-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/y;

/**
 * Iterative (no recursion, so absurd nesting cannot overflow the stack) JSON parser that accepts the whole JSON
 * grammar, rejects duplicate keys, builds Object.create(null) objects, and records the FIRST value-level violation in
 * document order without stopping, so that a later syntax error still takes precedence (see the module comment).
 */
class Parser {
  constructor(text) {
    this.t = text;
    this.i = 0;
    this.stack = []; // frames {arr: boolean, value, tok}
    this.violation = null;
  }

  /** JSON Pointer of the current location (the value being read, or the member whose key was just read). */
  pointer() {
    let p = '';
    for (const f of this.stack) p += `/${esc(f.tok)}`;
    return p;
  }

  /** Record the first value-level violation (pointer built lazily: only the first one is ever needed). */
  note(code) {
    if (this.violation === null) this.violation = new CJSONError(code, this.pointer());
  }

  syntax(why) {
    return new CJSONError('syntax-error', this.pointer(), `${why} at offset ${this.i}`);
  }

  ws() {
    const t = this.t;
    for (;;) {
      const c = t.charCodeAt(this.i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.i++;
      else return;
    }
  }

  /** Read a string token (cursor on the opening quote) and return its decoded value. */
  string() {
    const t = this.t;
    this.i++;
    let out = '';
    let start = this.i;
    for (;;) {
      if (this.i >= t.length) throw this.syntax('unterminated string');
      const c = t.charCodeAt(this.i);
      if (c === 0x22) {
        out += t.slice(start, this.i);
        this.i++;
        return out;
      }
      if (c < 0x20) throw this.syntax('raw control character in string');
      if (c !== 0x5c) {
        this.i++;
        continue;
      }
      out += t.slice(start, this.i);
      const e = t[this.i + 1];
      this.i += 2;
      switch (e) {
        case '"':
          out += '"';
          break;
        case '\\':
          out += '\\';
          break;
        case '/':
          out += '/';
          break;
        case 'b':
          out += '\b';
          break;
        case 'f':
          out += '\f';
          break;
        case 'n':
          out += '\n';
          break;
        case 'r':
          out += '\r';
          break;
        case 't':
          out += '\t';
          break;
        case 'u': {
          const hex = t.slice(this.i, this.i + 4);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw this.syntax('bad \\u escape');
          out += String.fromCharCode(parseInt(hex, 16));
          this.i += 4;
          break;
        }
        default:
          throw this.syntax('bad escape');
      }
      start = this.i;
    }
  }

  parseDocument() {
    const t = this.t;
    const stack = this.stack;
    let phase = 'value';
    let v;
    for (;;) {
      if (phase === 'value') {
        this.ws();
        const top = stack[stack.length - 1];
        if (top && top.arr) top.tok = top.value.length;
        const c = t[this.i];
        if (c === '{' || c === '[') {
          if (stack.length + 1 > MAX_DEPTH) this.note('too-deep');
          const arr = c === '[';
          stack.push({ arr, value: arr ? [] : Object.create(null), tok: arr ? 0 : '' });
          this.i++;
          this.ws();
          if (t[this.i] === (arr ? ']' : '}')) {
            this.i++;
            v = stack.pop().value;
            phase = 'deliver';
          } else phase = arr ? 'value' : 'key';
        } else if (c === '"') {
          const s = this.string();
          const bad = stringViolation(s);
          if (bad) this.note(bad);
          v = s;
          phase = 'deliver';
        } else if (c === '-' || (c >= '0' && c <= '9')) {
          NUMBER_RE.lastIndex = this.i;
          const m = NUMBER_RE.exec(t);
          if (!m) throw this.syntax('bad number');
          this.i += m[0].length;
          v = Number(m[0]);
          try {
            serNumber(v, '');
          } catch (e) {
            this.note(e.code);
          }
          phase = 'deliver';
        } else if (t.startsWith('true', this.i)) {
          this.i += 4;
          v = true;
          phase = 'deliver';
        } else if (t.startsWith('false', this.i)) {
          this.i += 5;
          v = false;
          phase = 'deliver';
        } else if (t.startsWith('null', this.i)) {
          this.i += 4;
          v = null;
          phase = 'deliver';
        } else throw this.syntax('unexpected token');
      } else if (phase === 'key') {
        this.ws();
        if (t[this.i] !== '"') throw this.syntax('expected string key');
        const top = stack[stack.length - 1];
        const key = this.string();
        top.tok = key;
        if (key in top.value) throw new CJSONError('duplicate-key', this.pointer(), `key ${JSON.stringify(key)}`);
        const bad = keyViolation(key);
        if (bad) this.note(bad);
        this.ws();
        if (t[this.i] !== ':') throw this.syntax('expected :');
        this.i++;
        phase = 'value';
      } else {
        // deliver `v` to the enclosing container, then expect `,` or the closer
        const top = stack[stack.length - 1];
        if (!top) {
          this.ws();
          if (this.i !== t.length) throw this.syntax('trailing characters');
          return v;
        }
        if (top.arr) top.value.push(v);
        else top.value[top.tok] = v;
        this.ws();
        const c = t[this.i];
        if (c === ',') {
          this.i++;
          phase = top.arr ? 'value' : 'key';
        } else if (c === (top.arr ? ']' : '}')) {
          this.i++;
          v = stack.pop().value;
        } else throw this.syntax(top.arr ? 'expected , or ]' : 'expected , or }');
      }
    }
  }
}

/**
 * Parse canonical bytes (or text). Precedence: strict UTF-8 -> BOM -> too-large -> syntax / duplicate-key ->
 * value-level rejections -> re-serialize byte equality. Returned objects have a null prototype.
 * @param {Uint8Array|string} input
 * @returns {*}
 * @throws {CJSONError}
 */
export function parseCanonical(input) {
  let text;
  let size;
  if (typeof input === 'string') {
    text = input;
    size = -1;
  } else if (ArrayBuffer.isView(input)) {
    const bytes = input instanceof Uint8Array ? input : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    text = utf8DecodeStrict(bytes);
    size = bytes.length;
  } else throw new CJSONError(`unsupported-type:${typeof input}`, '', 'parseCanonical takes bytes or a string');
  if (text.charCodeAt(0) === 0xfeff) throw new CJSONError('bom', '');
  if (size > MAX_OUTPUT_BYTES || (size < 0 && utf8Length(text) > MAX_OUTPUT_BYTES)) throw new CJSONError('too-large', '');
  const parser = new Parser(text);
  const value = parser.parseDocument();
  if (parser.violation) throw parser.violation;
  if (canonicalize(value) !== text) throw new CJSONError('not-canonical', '');
  return value;
}

// ---------------------------------------------------------------------------------------------------------------------
// F64 strings (section 2.2)
// ---------------------------------------------------------------------------------------------------------------------

const HEX = '0123456789abcdef';
const f64View = new DataView(new ArrayBuffer(8));

/**
 * Encode a JS number as `"f64:" + 16 lowercase hex digits` of its IEEE-754 binary64 bits, big-endian.
 * Preserves -0 and +-Infinity; every NaN becomes `f64:7ff8000000000000`.
 * @param {number} v
 * @returns {string}
 * @throws {TypeError} when `v` is not a number
 */
export function f64Encode(v) {
  if (typeof v !== 'number') throw new TypeError(`f64Encode expects a number, got ${typeof v}`);
  if (Number.isNaN(v)) return 'f64:7ff8000000000000';
  f64View.setFloat64(0, v, false);
  let s = 'f64:';
  for (let i = 0; i < 8; i++) {
    const b = f64View.getUint8(i);
    s += HEX[b >> 4] + HEX[b & 15];
  }
  return s;
}

/**
 * Inverse of f64Encode. Decodes, re-encodes and compares: any non-canonical form (uppercase hex, wrong length, missing
 * prefix, a NaN payload other than 7ff8000000000000, non-strings) throws `f64-noncanonical`.
 * @param {string} s
 * @returns {number}
 * @throws {CJSONError} code `f64-noncanonical`
 */
export function f64Decode(s) {
  if (typeof s !== 'string' || !F64_RE.test(s)) {
    throw new CJSONError('f64-noncanonical', '', 'expected "f64:" + 16 lowercase hex digits');
  }
  for (let i = 0; i < 8; i++) f64View.setUint8(i, parseInt(s.substr(4 + 2 * i, 2), 16));
  const v = f64View.getFloat64(0, false);
  if (f64Encode(v) !== s) throw new CJSONError('f64-noncanonical', '', 'does not re-encode to the same string');
  return v;
}
