/**
 * BB-CJSON v1: canonical JSON for Replay Contract v1 (docs/replay/replay-contract-v1.md, section 2).
 *
 * A strict profile of RFC 8785 (JCS): the same bytes in every implementation, so a SHA-256 over them is a stable
 * identity. Anything not representable is an error with a stable `code` and a `$`-rooted `path`, never silently
 * altered. Pure module: no Phaser, no clock, no randomness, no TextEncoder/TextDecoder (UTF-8 is done by hand so it
 * behaves identically under Node, browsers and Jest's jsdom).
 *
 * Error codes (part of the contract, section 2.4): nan, infinity, negative-zero, unsafe-integer, float-out-of-range,
 * undefined, lone-surrogate, key-not-allowed, proto-key, non-plain-object, unsupported-type:<typeof>, sparse-array,
 * too-deep, duplicate-key, not-canonical. Additional codes used by this implementation (not in the 2.4 list):
 * non-plain-array, array-extra-props, symbol-key, accessor, hidden-property, string-too-long, output-too-large,
 * invalid-utf8, syntax, bad-f64.
 */

export const MAX_DEPTH = 32;
export const MAX_OUTPUT_BYTES = 16 * 1024 * 1024;
export const MAX_STRING_BYTES = 1024 * 1024;

const KEY_RE = /^[A-Za-z0-9_.:$-]{1,64}$/;
const NEEDS_ESCAPE_RE = /[\u0000-\u001f"\\]/;
const F64_RE = /^f64:([0-9a-f]{16})$/;

/** Error for every canonical-JSON failure. `code` is contract-stable; `path` is `$`-rooted (`$.a[1].b`). */
export class CJSONError extends Error {
  /**
   * @param {string} code
   * @param {string} path
   * @param {string} [detail]
   */
  constructor(code, path, detail) {
    super(`${code} at ${path}${detail ? ` (${detail})` : ''}`);
    this.name = 'CJSONError';
    this.code = code;
    this.path = path;
  }
}

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
  if (!isWellFormed(s)) throw new CJSONError('lone-surrogate', '$');
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
  const bad = (i) => new CJSONError('invalid-utf8', '$', `byte offset ${i}`);
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

function serString(s, path) {
  if (!isWellFormed(s)) throw new CJSONError('lone-surrogate', path);
  // UTF-16 length <= UTF-8 length <= 3 x UTF-16 length: only compute the exact size when the cheap bounds disagree.
  if (s.length > MAX_STRING_BYTES || (s.length * 3 > MAX_STRING_BYTES && utf8Length(s) > MAX_STRING_BYTES)) {
    throw new CJSONError('string-too-long', path);
  }
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

function serNumber(v, path) {
  if (Number.isNaN(v)) throw new CJSONError('nan', path);
  if (!Number.isFinite(v)) throw new CJSONError('infinity', path);
  if (Object.is(v, -0)) throw new CJSONError('negative-zero', path);
  if (Number.isInteger(v)) {
    if (!Number.isSafeInteger(v)) throw new CJSONError('unsafe-integer', path);
    return String(v);
  }
  const s = String(v);
  if (s.includes('e')) throw new CJSONError('float-out-of-range', path);
  return s;
}

/**
 * @param {*} v
 * @param {string} path
 * @param {number} level number of containers enclosing `v` (0 at the root)
 * @returns {string}
 */
function ser(v, path, level) {
  if (v === null) return 'null';
  switch (typeof v) {
    case 'boolean':
      return v ? 'true' : 'false';
    case 'string':
      return serString(v, path);
    case 'number':
      return serNumber(v, path);
    case 'undefined':
      throw new CJSONError('undefined', path);
    case 'object':
      break;
    default:
      throw new CJSONError(`unsupported-type:${typeof v}`, path);
  }
  // `v` is a container: it sits at nesting level `level + 1`, which must not exceed MAX_DEPTH.
  if (level + 1 > MAX_DEPTH) throw new CJSONError('too-deep', path);
  if (Array.isArray(v)) {
    if (Object.getPrototypeOf(v) !== Array.prototype) throw new CJSONError('non-plain-array', path);
    const parts = new Array(v.length);
    for (let i = 0; i < v.length; i++) {
      if (!(i in v)) throw new CJSONError('sparse-array', `${path}[${i}]`);
      parts[i] = ser(v[i], `${path}[${i}]`, level + 1);
    }
    if (Object.getOwnPropertyNames(v).length !== v.length + 1 || Object.getOwnPropertySymbols(v).length) {
      throw new CJSONError('array-extra-props', path);
    }
    return `[${parts.join(',')}]`;
  }
  const proto = Object.getPrototypeOf(v);
  if (proto !== Object.prototype && proto !== null) throw new CJSONError('non-plain-object', path);
  if (Object.getOwnPropertySymbols(v).length) throw new CJSONError('symbol-key', path);
  const keys = Object.keys(v);
  if (Object.getOwnPropertyNames(v).length !== keys.length) throw new CJSONError('hidden-property', path);
  for (const k of keys) {
    if (!KEY_RE.test(k)) throw new CJSONError('key-not-allowed', `${path}.${k}`);
    if (k === '__proto__') throw new CJSONError('proto-key', path);
    if (!('value' in Object.getOwnPropertyDescriptor(v, k))) throw new CJSONError('accessor', `${path}.${k}`);
  }
  keys.sort(); // UTF-16 code unit order; keys are ASCII so it equals code point and UTF-8 byte order
  let out = '{';
  for (let i = 0; i < keys.length; i++) {
    const k = keys[i];
    out += `${i ? ',' : ''}"${k}":${ser(v[k], `${path}.${k}`, level + 1)}`;
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
  const text = ser(value, '$', 0);
  // UTF-16 length is a lower bound of the byte length: only measure when it could matter.
  if (text.length > MAX_OUTPUT_BYTES || (text.length * 3 > MAX_OUTPUT_BYTES && utf8Length(text) > MAX_OUTPUT_BYTES)) {
    throw new CJSONError('output-too-large', '$');
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
 * Minimal JSON parser that (a) rejects duplicate keys, (b) builds Object.create(null) objects so `__proto__` is just
 * data, and (c) accepts the whole JSON grammar (including non-canonical spellings) so that canonical-ness is decided
 * in exactly one place: the re-serialize byte-equality check in parseCanonical.
 */
class Parser {
  constructor(text) {
    this.t = text;
    this.i = 0;
  }

  fail(path, why) {
    return new CJSONError('syntax', path, `${why} at offset ${this.i}`);
  }

  ws() {
    const t = this.t;
    for (;;) {
      const c = t.charCodeAt(this.i);
      if (c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d) this.i++;
      else return;
    }
  }

  parseDocument() {
    this.ws();
    const v = this.value('$', 0);
    this.ws();
    if (this.i !== this.t.length) throw this.fail('$', 'trailing characters');
    return v;
  }

  value(path, level) {
    const t = this.t;
    const c = t[this.i];
    if (c === '{') return this.object(path, level);
    if (c === '[') return this.array(path, level);
    if (c === '"') return this.string(path);
    if (c === '-' || (c >= '0' && c <= '9')) {
      NUMBER_RE.lastIndex = this.i;
      const m = NUMBER_RE.exec(t);
      if (!m) throw this.fail(path, 'bad number');
      this.i += m[0].length;
      return Number(m[0]);
    }
    if (t.startsWith('true', this.i)) {
      this.i += 4;
      return true;
    }
    if (t.startsWith('false', this.i)) {
      this.i += 5;
      return false;
    }
    if (t.startsWith('null', this.i)) {
      this.i += 4;
      return null;
    }
    throw this.fail(path, 'unexpected token');
  }

  string(path) {
    const t = this.t;
    this.i++; // opening quote
    let out = '';
    let start = this.i;
    for (;;) {
      if (this.i >= t.length) throw this.fail(path, 'unterminated string');
      const c = t.charCodeAt(this.i);
      if (c === 0x22) {
        out += t.slice(start, this.i);
        this.i++;
        return out;
      }
      if (c < 0x20) throw this.fail(path, 'raw control character in string');
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
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) throw this.fail(path, 'bad \\u escape');
          out += String.fromCharCode(parseInt(hex, 16));
          this.i += 4;
          break;
        }
        default:
          throw this.fail(path, 'bad escape');
      }
      start = this.i;
    }
  }

  array(path, level) {
    if (level + 1 > MAX_DEPTH) throw new CJSONError('too-deep', path);
    this.i++; // [
    const out = [];
    this.ws();
    if (this.t[this.i] === ']') {
      this.i++;
      return out;
    }
    for (;;) {
      this.ws();
      out.push(this.value(`${path}[${out.length}]`, level + 1));
      this.ws();
      const c = this.t[this.i++];
      if (c === ',') continue;
      if (c === ']') return out;
      this.i--;
      throw this.fail(path, 'expected , or ]');
    }
  }

  object(path, level) {
    if (level + 1 > MAX_DEPTH) throw new CJSONError('too-deep', path);
    this.i++; // {
    const out = Object.create(null);
    this.ws();
    if (this.t[this.i] === '}') {
      this.i++;
      return out;
    }
    for (;;) {
      this.ws();
      if (this.t[this.i] !== '"') throw this.fail(path, 'expected string key');
      const key = this.string(path);
      if (key in out) throw new CJSONError('duplicate-key', path, `key ${JSON.stringify(key)}`);
      this.ws();
      if (this.t[this.i++] !== ':') {
        this.i--;
        throw this.fail(path, 'expected :');
      }
      this.ws();
      out[key] = this.value(`${path}.${key}`, level + 1);
      this.ws();
      const c = this.t[this.i++];
      if (c === ',') continue;
      if (c === '}') return out;
      this.i--;
      throw this.fail(path, 'expected , or }');
    }
  }
}

/**
 * Parse canonical bytes (or text). Strict UTF-8 -> duplicate-key-rejecting parse -> re-serialize -> byte equality.
 * Returned objects have a null prototype.
 * @param {Uint8Array|string} input
 * @returns {*}
 * @throws {CJSONError} invalid-utf8, syntax, duplicate-key, too-deep, any serializer code, or not-canonical
 */
export function parseCanonical(input) {
  let text;
  if (typeof input === 'string') text = input;
  else if (input instanceof Uint8Array || ArrayBuffer.isView(input)) {
    const bytes =
      input instanceof Uint8Array ? input : new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    if (bytes.length > MAX_OUTPUT_BYTES) throw new CJSONError('output-too-large', '$');
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      throw new CJSONError('not-canonical', '$', 'byte order mark');
    }
    text = utf8DecodeStrict(bytes);
  } else throw new CJSONError('unsupported-type:' + typeof input, '$', 'parseCanonical takes bytes or a string');
  if (text.length > MAX_OUTPUT_BYTES) throw new CJSONError('output-too-large', '$');
  const value = new Parser(text).parseDocument();
  if (canonicalize(value) !== text) throw new CJSONError('not-canonical', '$');
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
 */
export function f64Encode(v) {
  if (typeof v !== 'number') throw new CJSONError('bad-f64', '$', `expected number, got ${typeof v}`);
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
 * Inverse of f64Encode. Accepts only the exact canonical spelling.
 * @param {string} s
 * @returns {number}
 */
export function f64Decode(s) {
  const m = typeof s === 'string' ? F64_RE.exec(s) : null;
  if (!m) throw new CJSONError('bad-f64', '$', 'expected "f64:" + 16 lowercase hex digits');
  for (let i = 0; i < 8; i++) f64View.setUint8(i, parseInt(m[1].substr(2 * i, 2), 16));
  return f64View.getFloat64(0, false);
}
