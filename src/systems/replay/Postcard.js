/**
 * #67 Playable Postcards: the pure codec stage. NO Phaser, NO RunScene, NO network, NO storage, NO clipboard.
 *
 * A postcard is a shareable, reproducible 5-10 s dangerous moment: the sanitised causal header of a run, the input rows
 * that lead up to tick N, N itself, the game's combined fingerprint at N, and a summary of the challenge at N. A recipient
 * re-simulates the prefix (Replay Takeover, #72) and gets live, retryable, UNRANKED practice control at N.
 *
 * Trust model: the digest is an INTEGRITY check (corruption, accidental edits, naive tampering), NOT producer
 * authentication; anybody can mint a valid postcard for any input. The real verification is the re-simulation: the
 * recipient's engine must reach `fingerprintAtStart` at tick N, otherwise the takeover aborts. A postcard can never credit
 * anything: it is unranked practice by construction (see the `unranked:true` marker on every reply).
 *
 * Wire format: `BBPC1.` + base64url(raw-deflate(BB-CJSON v1 bytes of the wire object)). Floats travel as `f64:<hex>`
 * strings (BB-CJSON refuses -0 and exponent forms; the manifest code does the same), so a decode is bit-exact.
 *
 * Compression is injected: browsers use CompressionStream('deflate-raw'); Node/Jest (jsdom has no CompressionStream)
 * pass `{codec:{deflate, inflate}}`. Neither encode nor decode is synchronous, because CompressionStream is not.
 * The digest is over the canonical JSON, never over compressed bytes, so a different deflater cannot change identity.
 */
import { GHOST_TAPE_FORMAT, GHOST_TAPE_VERSION, GHOST_PHYSICS_VERSION } from '../ghost/GhostTape.js';
import { SIM_TICK_HZ } from '../SimClock.js';
import { canonicalBytes, parseCanonical, f64Encode, f64Decode, CJSONError } from './canonicalJson.js';
import { digestOf } from './canonicalSha256.js';
import { validateInputRows } from './manifest.js';

export const POSTCARD_KIND = 'bb-postcard';
export const POSTCARD_VERSION = 1;
export const POSTCARD_PREFIX = 'BBPC1.';
export const REPLY_KIND = 'bb-postcard-reply';
export const REPLY_VERSION = 1;
export const REPLY_PREFIX = 'BBPR1.';

/** The challenge window (the part the recipient plays and the reply reports on): 5 to 10 s of sim time. */
export const MIN_WINDOW_TICKS = 5 * SIM_TICK_HZ;
export const MAX_WINDOW_TICKS = 10 * SIM_TICK_HZ;
export const DEFAULT_WINDOW_SEC = 8;
/** Longest run a postcard may start in: 10 minutes (the same ceiling as Ghost-in-a-Link). */
export const MAX_START_TICK = 10 * 60 * SIM_TICK_HZ;
/** Input rows in a prefix (Ghost-in-a-Link allows 30000 changes in a whole tape). */
export const MAX_PREFIX_ROWS = 30000;

/**
 * Size caps. A maximal prefix (30000 rows, the cap above, of near-random pad bits) is ~390 KB of canonical JSON and about
 * 130-200 KB once deflated and base64url'd, so 256 KiB of encoded text covers the largest legal postcard with headroom while
 * still being one clipboard paste / one small file. The inflate cap (1 MiB) bounds a decompression bomb: a postcard is
 * refused as soon as it inflates past it. Both caps are checked BEFORE any parsing.
 */
export const MAX_ENCODED_POSTCARD_CHARS = 256 * 1024;
export const MAX_INFLATED_POSTCARD_BYTES = 1024 * 1024;
/** A reply carries at most one window of rows (<= 1200), so it is small. */
export const MAX_ENCODED_REPLY_CHARS = 64 * 1024;
export const MAX_INFLATED_REPLY_BYTES = 256 * 1024;

/**
 * HEADER ALLOWLIST. A tape header is copied field by field through this list; everything else is dropped on create and
 * REFUSED on decode (unknown field). Classification of every field a tape header can carry:
 *
 * CAUSAL (kept; the sim cannot be reproduced without it):
 *   format, version, physicsVersion, simTickHz, runRandomVersion, edgeRows  tape/engine versioning (how rows are read)
 *   seed, biomeMask                  the course
 *   simRevision, rulesetId, buildId  exact engine identity (a postcard only replays on the same build)
 *   mode                             must be 'normal': the only mode takeover accepts
 *   dailyRuleId                      daily-rule patch applied by resolveReplaySetup
 *   dailyRuleSource                  non-identifying enum ('seed-date' | 'clock-at-start'); kept because the brief lists it
 *                                    and Ghost-in-a-Link carries it; it is NOT a person-identifying field
 *   syncLevel                        BSOD pursuit tuning
 *   bsod {leftEdgeX, initial{wallX, wallSpeedPxS, accelerationPxS2}}  BSOD init state
 *   boosts, upgradeRanks, magnetsDrop  loadout that changes the sim
 *   kodiaksOn, kodiakPackMode, kodiakVersion  Kodiak encounters
 *   startPose [x, y, angle, vx, vy, omega]    initial body state
 *   random {version, <stream>: u32 state}     RNG stream states at tick 0
 *
 * PRIVATE / NOT CAUSAL (never leave the device):
 *   controlLayout   a UI preference. The sim only sees the recorded pad bits (variableHop / noAutoNudge are already in the
 *                   rows, and the recipient's own layout drives their live input). The replay manifest also excludes it.
 *   startedAt, endedAt, runId, endTick, distanceM, score, cause   per-run result / timing / identity (runId links to a profile)
 *   checkpoints, trace   result data; the postcard proves the start with `fingerprintAtStart` instead
 *   takeover, parentDigest, takeoverTick   #72 provenance of a takeover tape (a takeover tape is mode 'takeover': refused)
 *   initials, profile, ledger*, best scores, wallet, player/device ids, any future field   not in the list, so dropped
 */
export const HEADER_FIELDS = Object.freeze([
  'format', 'version', 'physicsVersion', 'simTickHz', 'runRandomVersion', 'edgeRows',
  'seed', 'biomeMask', 'simRevision', 'rulesetId', 'buildId', 'mode', 'dailyRuleId', 'dailyRuleSource', 'syncLevel',
  'bsod', 'boosts', 'upgradeRanks', 'magnetsDrop', 'kodiaksOn', 'kodiakPackMode', 'kodiakVersion', 'startPose', 'random',
]);
const TOP_FIELDS = ['kind', 'v', 'gameVersion', 'simRevision', 'rulesetId', 'buildId', 'header', 'prefix', 'startTick', 'windowTicks',
  'fingerprintAtStart', 'challenge', 'digest'];
const CHALLENGE_FIELDS = ['speedPxS', 'angVel', 'parachuteFuel', 'hazardPhase', 'bsodGapPx'];
const REPLY_FIELDS = ['kind', 'v', 'unranked', 'postcardDigest', 'outcome', 'crashOffsetTicks', 'suffix', 'digest'];

/** Every refusal code with its player-facing message. */
export const REFUSALS = Object.freeze({
  'bad-prefix': 'this is not a postcard code',
  'too-large': 'this postcard is too large',
  'bad-encoding': 'this postcard code is corrupt',
  'bad-compression': 'this postcard code is corrupt',
  'unsupported-browser': 'this browser cannot open postcards (no compression support)',
  'bad-json': 'this postcard is malformed',
  kind: 'this is not a postcard of the expected kind',
  version: 'this postcard is from a different postcard version',
  'unknown-field': 'this postcard has fields this version does not understand',
  'invalid-field': 'this postcard has an invalid value',
  'digest-mismatch': 'this postcard was altered or damaged',
  'other-build': 'this postcard was made on a different game build',
  mode: 'only normal runs can become postcards',
  tick: 'that tick is outside the recorded run',
  window: 'the challenge window must be a number of seconds',
  identity: 'this build has no complete identity to stamp on a postcard',
  tape: 'the tape cannot be turned into a postcard',
  fingerprint: 'the start fingerprint is missing or malformed',
  challenge: 'the challenge summary is missing or out of range',
  outcome: 'the reply outcome is invalid',
  unranked: 'a postcard reply must be marked unranked',
  mismatch: 'this reply does not belong to that postcard',
});
const refuse = (reason, detail) => ({ ok: false, reason, message: REFUSALS[reason] + (detail ? ` (${detail})` : '') });

// --- small validators -------------------------------------------------------------------------------------------------

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => typeof v === 'number' && Number.isSafeInteger(v);
const isU32 = (v) => isInt(v) && v >= 0 && v <= 0xffffffff;
const isFin = (v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= 1e12;
const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
const SAFE_ID = /^[A-Za-z0-9_.:-]{1,64}$/;
const SHA_ID = /^sha256:[0-9a-f]{64}$/;
const FP_ID = /^xxh32x2:[0-9a-f]{16}$/;
const VERSION_RE = /^[0-9]{1,5}\.[0-9]{1,5}\.[0-9]{1,5}(?:[-+][A-Za-z0-9.-]{1,32})?$/;
const RANK_KEY = /^[a-zA-Z][a-zA-Z0-9_-]{0,40}$/;
const seedOk = (s) => typeof s === 'string' && s.length > 0 && s.length <= 128 && !/[\u0000-\u001f\u007f<>]/u.test(s);
const exactKeys = (o, allowed) => Object.keys(o).every((k) => allowed.includes(k));

/** `null` when valid, else a short description of the first problem. Never throws. */
function headerProblem(h) {
  if (!isObj(h)) return 'header is not an object';
  if (!exactKeys(h, HEADER_FIELDS)) return `unknown header field ${Object.keys(h).find((k) => !HEADER_FIELDS.includes(k))}`;
  for (const k of HEADER_FIELDS) if (!hasOwn(h, k)) return `missing header field ${k}`;
  if (h.format !== GHOST_TAPE_FORMAT) return 'format';
  if (!isInt(h.version) || !isInt(h.physicsVersion) || !isInt(h.simTickHz) || !isInt(h.runRandomVersion)) return 'versions';
  if (h.edgeRows !== 'every-tick') return 'edgeRows'; // legacy deduping recorders cannot be re-simulated faithfully
  if (!seedOk(h.seed)) return 'seed';
  if (!isU32(h.biomeMask)) return 'biomeMask';
  if (!isInt(h.simRevision) || h.simRevision < 0) return 'simRevision';
  if (typeof h.rulesetId !== 'string' || !SHA_ID.test(h.rulesetId)) return 'rulesetId';
  if (typeof h.buildId !== 'string' || !SHA_ID.test(h.buildId)) return 'buildId';
  if (h.mode !== 'normal') return 'mode';
  if (!(h.dailyRuleId === null || (typeof h.dailyRuleId === 'string' && SAFE_ID.test(h.dailyRuleId)))) return 'dailyRuleId';
  if (!['seed-date', 'clock-at-start'].includes(h.dailyRuleSource)) return 'dailyRuleSource';
  if (!isInt(h.syncLevel) || h.syncLevel < 1 || h.syncLevel > 100000) return 'syncLevel';
  const b = h.bsod;
  if (!isObj(b) || !exactKeys(b, ['leftEdgeX', 'initial']) || !hasOwn(b, 'leftEdgeX') || !isFin(b.leftEdgeX)) return 'bsod';
  const i = b.initial;
  if (!isObj(i) || !exactKeys(i, ['wallX', 'wallSpeedPxS', 'accelerationPxS2']) || !isFin(i.wallX) || !isFin(i.wallSpeedPxS) || !isFin(i.accelerationPxS2)) return 'bsod.initial';
  if (!Array.isArray(h.boosts) || h.boosts.length > 32 || !h.boosts.every((x) => typeof x === 'string' && SAFE_ID.test(x))) return 'boosts';
  if (h.upgradeRanks !== null) {
    if (!isObj(h.upgradeRanks)) return 'upgradeRanks';
    const ks = Object.keys(h.upgradeRanks);
    if (ks.length > 60 || !ks.every((k) => RANK_KEY.test(k) && !['__proto__', 'constructor', 'prototype'].includes(k) && isInt(h.upgradeRanks[k]) && h.upgradeRanks[k] >= 0 && h.upgradeRanks[k] <= 1000)) return 'upgradeRanks';
  }
  if (typeof h.magnetsDrop !== 'boolean' || typeof h.kodiaksOn !== 'boolean') return 'magnetsDrop/kodiaksOn';
  if (!['same', 'mixed'].includes(h.kodiakPackMode)) return 'kodiakPackMode';
  if (!isInt(h.kodiakVersion) || h.kodiakVersion < 0) return 'kodiakVersion';
  if (!Array.isArray(h.startPose) || h.startPose.length !== 6 || !h.startPose.every(isFin)) return 'startPose';
  const r = h.random;
  if (!isObj(r) || !isInt(r.version)) return 'random';
  const rk = Object.keys(r).filter((k) => k !== 'version');
  if (rk.length < 1 || rk.length > 16 || !rk.every((k) => SAFE_ID.test(k) && isU32(r[k]))) return 'random';
  return null;
}

/** Copy the allowlisted header fields out of a tape (deep, independent). Unknown fields are never read. */
function pickHeader(tape) {
  const h = {};
  for (const k of HEADER_FIELDS) if (hasOwn(tape, k)) h[k] = clone(tape[k]);
  // The identity stamps may be absent (older tapes) or null (stamped before the build id was known): left absent -> refused later.
  return h;
}
function clone(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(clone);
  const o = {};
  for (const k of Object.keys(v)) o[k] = clone(v[k]);
  return o;
}

function challengeProblem(c) {
  if (!isObj(c)) return 'not an object';
  if (!exactKeys(c, CHALLENGE_FIELDS) || !CHALLENGE_FIELDS.every((k) => hasOwn(c, k))) return 'fields';
  if (!isFin(c.speedPxS) || c.speedPxS < 0 || c.speedPxS > 1e6) return 'speedPxS';
  if (!isFin(c.angVel) || Math.abs(c.angVel) > 1e4) return 'angVel';
  if (!(c.parachuteFuel === null || (isFin(c.parachuteFuel) && c.parachuteFuel >= 0 && c.parachuteFuel <= 1e7))) return 'parachuteFuel';
  // hazardPhase is whatever scalar phase the wiring stage derives (a cycle position); only its sanity is checked here.
  if (!(c.hazardPhase === null || (isFin(c.hazardPhase) && c.hazardPhase >= 0 && c.hazardPhase <= 1e7))) return 'hazardPhase';
  if (!(c.bsodGapPx === null || (isFin(c.bsodGapPx) && c.bsodGapPx >= 0 && c.bsodGapPx <= 1e7))) return 'bsodGapPx';
  return null;
}

function prefixProblem(rows, startTick) {
  if (!Array.isArray(rows) || rows.length > MAX_PREFIX_ROWS) return 'too many rows';
  try { validateInputRows(rows, startTick - 1, '/prefix'); } catch (e) { return `invalid input row (${e && e.message})`; }
  return null;
}

// --- float <-> wire ---------------------------------------------------------------------------------------------------

const CHALLENGE_FLOATS = ['speedPxS', 'angVel', 'parachuteFuel', 'hazardPhase', 'bsodGapPx'];
const encF = (v) => (v === null ? null : f64Encode(v));

function headerToWire(h) {
  return { ...h, startPose: h.startPose.map(f64Encode),
    bsod: { leftEdgeX: f64Encode(h.bsod.leftEdgeX), initial: { wallX: f64Encode(h.bsod.initial.wallX),
      wallSpeedPxS: f64Encode(h.bsod.initial.wallSpeedPxS), accelerationPxS2: f64Encode(h.bsod.initial.accelerationPxS2) } } };
}
function headerFromWire(w) {
  if (!isObj(w) || !Array.isArray(w.startPose) || !isObj(w.bsod) || !isObj(w.bsod.initial)) throw new TypeError('header shape');
  return { ...plain(w), startPose: w.startPose.map(f64Decode),
    bsod: { leftEdgeX: f64Decode(w.bsod.leftEdgeX), initial: { wallX: f64Decode(w.bsod.initial.wallX),
      wallSpeedPxS: f64Decode(w.bsod.initial.wallSpeedPxS), accelerationPxS2: f64Decode(w.bsod.initial.accelerationPxS2) } } };
}
/** Null-prototype objects from parseCanonical -> ordinary objects, recursively. */
function plain(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(plain);
  const o = {};
  for (const k of Object.keys(v)) o[k] = plain(v[k]);
  return o;
}

/**
 * The exact object whose canonical bytes are encoded, with the digest in place. Pure; used by encode, and by tests that
 * forge payloads. Throws CJSONError if a value is not canonicalizable (cannot happen for a validated postcard).
 * @param {object} pc a postcard
 */
export function postcardWire(pc) {
  const challenge = { ...pc.challenge };
  for (const k of CHALLENGE_FLOATS) challenge[k] = encF(pc.challenge[k]);
  return { kind: pc.kind, v: pc.v, gameVersion: pc.gameVersion, simRevision: pc.simRevision, rulesetId: pc.rulesetId, buildId: pc.buildId,
    header: headerToWire(pc.header), prefix: pc.prefix.map((r) => [...r]), startTick: pc.startTick, windowTicks: pc.windowTicks,
    fingerprintAtStart: pc.fingerprintAtStart, challenge, digest: pc.digest };
}
const digestOfWire = (wire) => { const { digest, ...rest } = wire; return digestOf(rest); };

// --- create -----------------------------------------------------------------------------------------------------------

/**
 * Build a postcard from a finished ghost tape. Pure, never throws.
 * @param {{tape:object, startTick:number, windowSec?:number, fingerprintAtStart:string,
 *   challenge:{speedPxS:number, angVel:number, parachuteFuel:number|null, hazardPhase:number|null, bsodGapPx:number|null},
 *   identity:{gameVersion:string, simRevision:number, rulesetId:string, buildId:string}}} p
 * @returns {{ok:true, postcard:object}|{ok:false, reason:string, message:string}}
 */
export function createPostcard({ tape, startTick, windowSec, fingerprintAtStart, challenge, identity } = {}) {
  try {
    const id = identity;
    if (!isObj(id) || typeof id.gameVersion !== 'string' || !VERSION_RE.test(id.gameVersion) || !isInt(id.simRevision)
      || typeof id.rulesetId !== 'string' || !SHA_ID.test(id.rulesetId) || typeof id.buildId !== 'string' || !SHA_ID.test(id.buildId)) return refuse('identity');
    if (!isObj(tape) || tape.format !== GHOST_TAPE_FORMAT || tape.version !== GHOST_TAPE_VERSION || tape.physicsVersion !== GHOST_PHYSICS_VERSION
      || !Array.isArray(tape.inputs) || !isInt(tape.endTick)) return refuse('tape');
    if (tape.mode !== 'normal') return refuse('mode');
    if (!isInt(startTick) || startTick < 1 || startTick > tape.endTick - 1 || startTick > MAX_START_TICK) return refuse('tick', `1..${Math.min(tape.endTick - 1, MAX_START_TICK)}`);
    let sec = DEFAULT_WINDOW_SEC;
    if (windowSec !== undefined) {
      if (typeof windowSec !== 'number' || !Number.isFinite(windowSec)) return refuse('window');
      sec = windowSec;
    }
    const windowTicks = Math.min(MAX_WINDOW_TICKS, Math.max(MIN_WINDOW_TICKS, Math.round(sec * SIM_TICK_HZ)));
    if (typeof fingerprintAtStart !== 'string' || !FP_ID.test(fingerprintAtStart)) return refuse('fingerprint');
    const cp = challengeProblem(challenge);
    if (cp) return refuse('challenge', cp);

    const header = pickHeader(tape);
    // Identity: the tape must have been recorded by exactly the build that is creating the postcard. A null build id
    // (stamped before the async ruleset loader finished) is the same build by construction (same rulesetId), so the
    // caller's id is used; a different non-null id is refused.
    if (header.buildId === null || header.buildId === undefined) header.buildId = id.buildId;
    if (header.simRevision !== id.simRevision || header.rulesetId !== id.rulesetId || header.buildId !== id.buildId) return refuse('other-build', 'the tape was recorded on another build');
    const hp = headerProblem(header);
    if (hp) return refuse('invalid-field', `header: ${hp}`);

    // Prefix: every row whose absolute tick is <= startTick. This is #72's "N ticks applied" (SimClock.tick === N): the row
    // at tick N is consumed by the N-th tick; the first live tick is N + 1.
    const prefix = [];
    let at = 0;
    for (const r of tape.inputs) {
      if (!Array.isArray(r) || r.length !== 3) return refuse('tape', 'malformed input row');
      at += r[0];
      if (at > startTick) break;
      prefix.push([r[0], r[1], r[2] === 0 ? 0 : r[2]]);
    }
    const pp = prefixProblem(prefix, startTick);
    if (pp) return refuse('tape', pp);

    const postcard = { kind: POSTCARD_KIND, v: POSTCARD_VERSION, gameVersion: id.gameVersion, simRevision: id.simRevision, rulesetId: id.rulesetId,
      buildId: id.buildId, header, prefix, startTick, windowTicks, fingerprintAtStart, challenge: clone(challenge), digest: '' };
    postcard.digest = digestOfWire(postcardWire(postcard));
    return { ok: true, postcard };
  } catch (e) {
    return refuse('tape', e && e.message);
  }
}

// --- codec ------------------------------------------------------------------------------------------------------------

class CodecError extends Error {
  constructor(code, message) { super(message || code); this.code = code; }
}

async function collect(readable, max) {
  const reader = readable.getReader();
  const chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > max) { try { await reader.cancel(); } catch { /* ignore */ } throw new CodecError('too-large'); }
      chunks.push(value);
    }
  } finally { try { reader.releaseLock(); } catch { /* ignore */ } }
  const out = new Uint8Array(size);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.byteLength; }
  return out;
}
const oneShot = (bytes) => new ReadableStream({ start(c) { c.enqueue(bytes); c.close(); } });

/** Browser codec: CompressionStream / DecompressionStream('deflate-raw'). Absent in jsdom and old browsers. */
export const streamCodec = Object.freeze({
  available: () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' && typeof ReadableStream === 'function',
  async deflate(bytes) { return collect(oneShot(bytes).pipeThrough(new CompressionStream('deflate-raw')), Infinity); },
  async inflate(bytes, max) {
    try { return await collect(oneShot(bytes).pipeThrough(new DecompressionStream('deflate-raw')), max); } catch (e) {
      if (e instanceof CodecError) throw e;
      throw new CodecError('bad-compression');
    }
  },
});

function pickCodec(opts) {
  if (opts && opts.codec) return opts.codec;
  if (streamCodec.available()) return streamCodec;
  throw new CodecError('unsupported-browser');
}

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
function toUrl64(bytes) {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
    out += B64[(n >> 18) & 63] + B64[(n >> 12) & 63];
    if (i + 1 < bytes.length) out += B64[(n >> 6) & 63];
    if (i + 2 < bytes.length) out += B64[n & 63];
  }
  return out;
}
/** Strict, unpadded base64url. Refuses anything else (padding, '+', '/', whitespace, a dangling single char). */
function fromUrl64(s) {
  if (!/^[A-Za-z0-9_-]*$/.test(s) || s.length % 4 === 1) return null;
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let o = 0;
  for (let i = 0; i < s.length; i += 4) {
    const a = B64.indexOf(s[i]); const b = B64.indexOf(s[i + 1]);
    const c = i + 2 < s.length ? B64.indexOf(s[i + 2]) : 0; const d = i + 3 < s.length ? B64.indexOf(s[i + 3]) : 0;
    const n = (a << 18) | (b << 12) | (c << 6) | d;
    out[o++] = (n >> 16) & 255;
    if (i + 2 < s.length) out[o++] = (n >> 8) & 255;
    if (i + 3 < s.length) out[o++] = n & 255;
  }
  // Canonical form only: re-encoding must reproduce the input (rejects non-zero padding bits, so one byte string has one code).
  return toUrl64(out) === s ? out : null;
}

async function encodeWire(prefix, wire, maxChars, opts) {
  const deflated = await pickCodec(opts).deflate(canonicalBytes(wire));
  const str = prefix + toUrl64(deflated);
  if (str.length > maxChars) throw new CodecError('too-large', `${str.length} > ${maxChars}`);
  return str;
}

/**
 * @param {object} pc a postcard from createPostcard / decodePostcard
 * @param {{codec?:{deflate:Function, inflate:Function}}} [opts]
 * @returns {Promise<string>} `BBPC1.<base64url(deflate-raw(canonical JSON))>`
 * @throws {Error} with `.code` of too-large | unsupported-browser | (CJSONError code)
 */
export async function encodePostcard(pc, opts = {}) {
  return encodeWire(POSTCARD_PREFIX, postcardWire(pc), MAX_ENCODED_POSTCARD_CHARS, opts);
}

/** Shared front half of both decoders: prefix, size, base64url, bounded inflate, strict canonical parse. */
async function openWire(str, prefix, maxChars, maxInflated, opts) {
  if (typeof str !== 'string' || !str.startsWith(prefix)) return refuse('bad-prefix');
  if (str.length > maxChars) return refuse('too-large', `${str.length} > ${maxChars}`);
  const bytes = fromUrl64(str.slice(prefix.length));
  if (!bytes || bytes.length === 0) return refuse('bad-encoding');
  let raw;
  try { raw = await pickCodec(opts).inflate(bytes, maxInflated); } catch (e) {
    const code = e && e.code;
    return refuse(code === 'too-large' ? 'too-large' : code === 'unsupported-browser' ? 'unsupported-browser' : 'bad-compression');
  }
  if (raw.length > maxInflated) return refuse('too-large');
  let wire;
  try { wire = plain(parseCanonical(raw)); } catch (e) { return refuse('bad-json', e instanceof CJSONError ? e.code : undefined); }
  if (!isObj(wire)) return refuse('bad-json');
  return { ok: true, wire };
}

/**
 * Decode and validate. Never throws. Refuses: wrong prefix, corrupt base64/deflate, oversize, non-canonical JSON, wrong
 * kind or version, unknown top-level or header fields, malformed values, digest mismatch.
 * @param {string} str
 * @param {{codec?:object}} [opts]
 * @returns {Promise<{ok:true, postcard:object}|{ok:false, reason:string, message:string}>}
 */
export async function decodePostcard(str, opts = {}) {
  try {
    const opened = await openWire(str, POSTCARD_PREFIX, MAX_ENCODED_POSTCARD_CHARS, MAX_INFLATED_POSTCARD_BYTES, opts);
    if (!opened.ok) return opened;
    const w = opened.wire;
    if (w.kind !== POSTCARD_KIND) return refuse('kind');
    if (w.v !== POSTCARD_VERSION) return refuse('version');
    if (!exactKeys(w, TOP_FIELDS) || !TOP_FIELDS.every((k) => hasOwn(w, k))) return refuse('unknown-field', 'top level');
    if (!isObj(w.header)) return refuse('invalid-field', 'header');
    if (!exactKeys(w.header, HEADER_FIELDS)) return refuse('unknown-field', `header.${Object.keys(w.header).find((k) => !HEADER_FIELDS.includes(k))}`);
    if (!isObj(w.challenge)) return refuse('invalid-field', 'challenge');
    if (!exactKeys(w.challenge, CHALLENGE_FIELDS)) return refuse('unknown-field', 'challenge');

    let header;
    const challenge = {};
    try {
      header = headerFromWire(w.header);
      for (const k of CHALLENGE_FLOATS) challenge[k] = w.challenge[k] === null ? null : f64Decode(w.challenge[k]);
    } catch { return refuse('invalid-field', 'malformed float'); }

    if (typeof w.gameVersion !== 'string' || !VERSION_RE.test(w.gameVersion)) return refuse('invalid-field', 'gameVersion');
    if (!isInt(w.simRevision) || typeof w.rulesetId !== 'string' || !SHA_ID.test(w.rulesetId) || typeof w.buildId !== 'string' || !SHA_ID.test(w.buildId)) return refuse('invalid-field', 'identity');
    const hp = headerProblem(header);
    if (hp) return refuse('invalid-field', `header: ${hp}`);
    if (header.simRevision !== w.simRevision || header.rulesetId !== w.rulesetId || header.buildId !== w.buildId) return refuse('invalid-field', 'identity differs from header');
    if (!isInt(w.startTick) || w.startTick < 1 || w.startTick > MAX_START_TICK) return refuse('invalid-field', 'startTick');
    if (!isInt(w.windowTicks) || w.windowTicks < MIN_WINDOW_TICKS || w.windowTicks > MAX_WINDOW_TICKS) return refuse('invalid-field', 'windowTicks');
    if (typeof w.fingerprintAtStart !== 'string' || !FP_ID.test(w.fingerprintAtStart)) return refuse('invalid-field', 'fingerprintAtStart');
    const cp = challengeProblem(challenge);
    if (cp) return refuse('invalid-field', `challenge: ${cp}`);
    const pp = prefixProblem(w.prefix, w.startTick);
    if (pp) return refuse('invalid-field', `prefix: ${pp}`);
    if (typeof w.digest !== 'string' || !SHA_ID.test(w.digest)) return refuse('invalid-field', 'digest');

    const postcard = { kind: w.kind, v: w.v, gameVersion: w.gameVersion, simRevision: w.simRevision, rulesetId: w.rulesetId, buildId: w.buildId,
      header, prefix: w.prefix.map((r) => [...r]), startTick: w.startTick, windowTicks: w.windowTicks, fingerprintAtStart: w.fingerprintAtStart,
      challenge, digest: w.digest };
    return { ok: true, postcard };
  } catch (e) {
    return refuse('bad-json', e && e.message);
  }
}
