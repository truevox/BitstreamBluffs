/**
 * Replay manifest v1 (Replay Contract v1.0, sections 4, 5 and 8; issue #116). Pure module: no Phaser, no clock, no
 * randomness, no storage. Importable from Jest.
 *
 *  - buildManifest(runContext)      manifest of a live recording (tape recorded by the fixed GhostRecorder)
 *  - validateManifest(input, rs)    4.2 fail-closed validation of canonical bytes -> result object (never throws for bad input)
 *  - legacyManifestFromTape(tape)   section 5 mapping, computed on demand, never written back
 *  - evidenceBundle / validateEvidenceBundle / bundleBytes   `bb-replay-evidence` v1 (section 4.5)
 *  - resolveReplaySetup(source)     R-1..R-4: the inputs a replay uses, from a manifest or tape, never from clock/profile
 *
 * A manifest excludes startedAt/endedAt/runId/controlLayout (section 1.3).
 *
 * Refusal codes (validateManifest/validateEvidenceBundle `code`): every BB-CJSON code (invalid-utf8, bom, too-large,
 * syntax-error, duplicate-key, not-canonical, ...), plus unsupported-format-version, unknown-envelope-field,
 * unknown-causal-field, unsupported-critical-extension, invalid-field, inconsistent-field, unsupported-input-protocol,
 * invalid-input-row, unknown-ruleset, ruleset-digest-mismatch, invalid-ruleset, digest-mismatch.
 */
import {
  canonicalBytes, parseCanonical, f64Encode, f64Decode, CJSONError,
} from './canonicalJson.js';
import { digestOf, digestOfBytes } from './canonicalSha256.js';
import { xxHash32 } from '../Rng.js';
import { BsodPursuit } from '../BsodPursuit.js';
import { upgradeEffects } from '../PermanentUpgrades.js';
import { DailyPatch } from '../DailyPatch.js';

export const MANIFEST_FORMAT = 'bb-replay-manifest';
export const MANIFEST_VERSION = 1;
export const MANIFEST_MINOR = 0;
export const EVIDENCE_FORMAT = 'bb-replay-evidence';
export const EVIDENCE_VERSION = 1;
export const TAPE_FORMAT = 'bb-input-tape';

/** `bb-pad` v1 self-description (4.3 `causal.input.bits`); must equal the protocol version's definition. */
export const PAD_BITS_V1 = Object.freeze({
  bool: Object.freeze(['push', 'variableHop', 'noAutoNudge', 'divebomb', 'corkscrew', 'tuck', 'brakeHeld', 'hop', 'reset',
    'airBrake', 'parachute', 'pause']),
  edge: Object.freeze(['hop', 'reset', 'pause', 'airBrake', 'parachute', 'confirm']),
  heliShift: 18,
});
/** Per-subsystem fingerprint names, fixed order (6.3). */
export const FP_SUBSYSTEMS = Object.freeze(['clock', 'rng', 'sled', 'matter', 'terrain', 'hazards', 'pickups', 'effects',
  'bsod', 'kodiak', 'score', 'tricks', 'recovery']);

const ENVELOPE_KEYS = ['format', 'formatVersion', 'formatMinor', 'critical', 'causal', 'info', 'ext'];
const PROVENANCE = ['live-recording', 'legacy-derived', 'synthetic'];
const RULE_SOURCES = ['seed-date', 'clock-at-start', 'recorded'];
const LANE_MODES = ['normal', 'daily', 'daily-draft'];
const DIGEST_RE = /^sha256:[0-9a-f]{64}$/;
const FP16_RE = /^[0-9a-f]{16}$/;

/** Refusal with a stable `code` and an RFC 6901 `pointer`. */
export class ManifestError extends Error {
  constructor(code, pointer = '', detail) {
    super(`${code} at ${JSON.stringify(pointer)}${detail ? ` (${detail})` : ''}`);
    this.name = 'ManifestError';
    this.code = code;
    this.pointer = pointer;
    this.detail = detail;
  }
}

const fail = (code, pointer, detail) => { throw new ManifestError(code, pointer, detail); };
const bad = (pointer, detail) => fail('invalid-field', pointer, detail);
const esc = (t) => String(t).replace(/~/g, '~0').replace(/\//g, '~1');

// --- tiny type predicates -------------------------------------------------------------------------------------------
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => Number.isSafeInteger(v);
const isU32 = (v) => isInt(v) && v >= 0 && v <= 0xffffffff;
const isStr = (v) => typeof v === 'string';
const nz = (v) => (v === 0 ? 0 : v); // -0 -> 0 (C4)
/** Refusal detail for ANY value (a null-prototype object cannot be stringified by a template literal). */
const show = (v) => (typeof v === 'string' ? JSON.stringify(v.length > 40 ? `${v.slice(0, 40)}...` : v)
  : typeof v === 'number' || typeof v === 'boolean' ? String(v) : v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);

function needObj(v, ptr) { if (!isObj(v)) bad(ptr, 'expected object'); return v; }
function needInt(v, ptr, min = -Infinity) { if (!isInt(v) || v < min) bad(ptr, `expected integer >= ${min}`); return v; }
function needU32(v, ptr) { if (!isU32(v)) bad(ptr, 'expected uint32'); return v; }
function needStr(v, ptr) { if (!isStr(v)) bad(ptr, 'expected string'); return v; }
function needBool(v, ptr) { if (typeof v !== 'boolean') bad(ptr, 'expected boolean'); return v; }
function needEnum(v, list, ptr) { if (!list.includes(v)) bad(ptr, `expected one of ${list.join('|')}`); return v; }
function needDigest(v, ptr) { if (!isStr(v) || !DIGEST_RE.test(v)) bad(ptr, 'expected sha256:<64 lowercase hex>'); return v; }
function needF64(v, ptr) {
  try { return f64Decode(v); } catch (e) { if (e instanceof CJSONError) bad(ptr, 'malformed F64'); throw e; }
}

/** Strict object: unknown keys refuse with `unknownCode`; missing required keys are invalid-field. */
function strict(v, ptr, required, optional = [], unknownCode = 'unknown-causal-field') {
  needObj(v, ptr);
  for (const k of Object.keys(v).sort()) {
    if (!required.includes(k) && !optional.includes(k)) fail(unknownCode, `${ptr}/${esc(k)}`);
  }
  for (const k of required) if (!(k in v)) bad(`${ptr}/${k}`, 'missing');
  return v;
}

const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);

// --- bb-pad rows and the tape digest (4.4, 4.5) --------------------------------------------------------------------

/**
 * Refuse a malformed `bb-pad` v1 input list (4.4): rows `[dt, bits, tilt127]`, dt >= 1, bits uint32 with only bits 0-19
 * defined, heli value 3 refused, tilt127 in [-127, 127], last row tick <= endTick + 1.
 * @throws {ManifestError} invalid-input-row
 */
export function validateInputRows(rows, endTick, ptr = '/inputs') {
  if (!Array.isArray(rows)) fail('invalid-input-row', ptr, 'expected array');
  let tick = 0;
  rows.forEach((row, i) => {
    const p = `${ptr}/${i}`;
    if (!Array.isArray(row) || row.length !== 3) fail('invalid-input-row', p, 'expected [dt, bits, tilt127]');
    const [dt, bits, tilt] = row;
    if (!isInt(dt) || dt < 1) fail('invalid-input-row', `${p}/0`, 'dt must be an integer >= 1');
    if (!isU32(bits) || bits > 0xfffff) fail('invalid-input-row', `${p}/1`, 'bits 20-31 must be 0');
    if (((bits >>> PAD_BITS_V1.heliShift) & 3) === 3) fail('invalid-input-row', `${p}/1`, 'heli value 3 is refused');
    if (!isInt(tilt) || tilt < -127 || tilt > 127) fail('invalid-input-row', `${p}/2`, 'tilt127 out of range');
    tick += dt;
    if (isInt(endTick) && tick > endTick + 1) fail('invalid-input-row', p, 'row tick beyond endTick + 1');
  });
}

/** Digest projection of a tape's inputs (4.5): `-0` normalized, no trace/startedAt/checkpoints. */
export function tapeProjection(tape) {
  return {
    format: TAPE_FORMAT, formatVersion: 1, protocol: { id: 'bb-pad', version: 1 }, tickHz: tape.simTickHz ?? 120,
    endTick: tape.endTick,
    inputs: (tape.inputs || []).map((r) => r.map(nz)),
  };
}
export const tapeDigest = (tape) => digestOf(tapeProjection(tape));

// --- manifest validation ----------------------------------------------------------------------------------------------

function validateInfo(info, legacy) {
  needObj(info, '/info');
  const prov = needEnum(info.provenance, PROVENANCE, '/info/provenance');
  if (info.gameVersion !== undefined) needStr(info.gameVersion, '/info/gameVersion');
  if (info.lane !== undefined) {
    const lane = needObj(info.lane, '/info/lane');
    needEnum(lane.mode, LANE_MODES, '/info/lane/mode');
    if (lane.dailyOfficial !== undefined) needBool(lane.dailyOfficial, '/info/lane/dailyOfficial');
    if (lane.dailyMode !== undefined) needEnum(lane.dailyMode, ['classic', 'draft'], '/info/lane/dailyMode');
    if (lane.draft !== undefined) needObj(lane.draft, '/info/lane/draft');
  }
  if (info.inputCapture !== undefined) {
    const ic = needObj(info.inputCapture, '/info/inputCapture');
    if (ic.edgeAssignment !== undefined) needStr(ic.edgeAssignment, '/info/inputCapture/edgeAssignment');
  }
  if (info.rngVisual !== undefined) {
    const r = needObj(info.rngVisual, '/info/rngVisual');
    for (const k of ['visualSled', 'visualFx', 'visualCamera']) needU32(r[k], `/info/rngVisual/${k}`);
  }
  if (info.legacy !== undefined) {
    const l = needObj(info.legacy, '/info/legacy');
    if (l.absentFields !== undefined && (!Array.isArray(l.absentFields) || !l.absentFields.every(isStr))) {
      bad('/info/legacy/absentFields', 'expected string[]');
    }
  }
  legacy.value = prov === 'legacy-derived';
  return prov;
}

function validateCausal(c, isLegacy) {
  strict(c, '/causal', ['sim', 'course', 'loadout', 'bsod', 'start', 'rng', 'input', 'checkpoints'], ['kodiak']);
  const nullable = (v, ptr, f) => {
    if (v === null) { if (!isLegacy) bad(ptr, 'null is legal only in legacy-derived manifests'); return null; }
    return f(v, ptr);
  };

  const sim = strict(c.sim, '/causal/sim', ['rulesetId', 'simRevision', 'tickHz', 'engine']);
  nullable(sim.rulesetId, '/causal/sim/rulesetId', needDigest);
  nullable(sim.simRevision, '/causal/sim/simRevision', (v, p) => needInt(v, p, 1));
  needInt(sim.tickHz, '/causal/sim/tickHz', 1);
  nullable(sim.engine, '/causal/sim/engine', (v, p) => {
    strict(v, p, ['phaser', 'matter']);
    needStr(v.phaser, `${p}/phaser`); needStr(v.matter, `${p}/matter`);
  });

  const course = strict(c.course, '/causal/course', ['seed', 'biomeMask', 'dailyRuleId', 'dailyRuleSource']);
  needStr(course.seed, '/causal/course/seed');
  needU32(course.biomeMask, '/causal/course/biomeMask');
  nullable(course.dailyRuleId, '/causal/course/dailyRuleId', (v, p) => { needStr(v, p); if (!v) bad(p, 'empty'); });
  needEnum(course.dailyRuleSource, RULE_SOURCES, '/causal/course/dailyRuleSource');

  const lo = strict(c.loadout, '/causal/loadout', ['upgradeRanks', 'boosts', 'magnetsDrop']);
  needObj(lo.upgradeRanks, '/causal/loadout/upgradeRanks');
  for (const [k, v] of Object.entries(lo.upgradeRanks)) needInt(v, `/causal/loadout/upgradeRanks/${esc(k)}`, 1);
  if (!Array.isArray(lo.boosts)) bad('/causal/loadout/boosts', 'expected array');
  lo.boosts.forEach((b, i) => {
    needStr(b, `/causal/loadout/boosts/${i}`);
    if (i > 0 && !(lo.boosts[i - 1] < b)) bad(`/causal/loadout/boosts/${i}`, 'boosts must be sorted and unique');
  });
  nullable(lo.magnetsDrop, '/causal/loadout/magnetsDrop', needBool);

  if (c.kodiak !== undefined) {
    const k = strict(c.kodiak, '/causal/kodiak', ['enabled', 'packMode', 'version']);
    needBool(k.enabled, '/causal/kodiak/enabled');
    needEnum(k.packMode, ['same', 'mixed'], '/causal/kodiak/packMode');
    needInt(k.version, '/causal/kodiak/version', 1);
  }

  const b = strict(c.bsod, '/causal/bsod', ['syncLevel', 'leftEdgeX', 'initial']);
  const nulls = [b.syncLevel, b.leftEdgeX, b.initial].filter((v) => v === null).length;
  if (nulls !== 0 && nulls !== 3) bad('/causal/bsod', 'syncLevel, leftEdgeX and initial are all null or all set');
  nullable(b.syncLevel, '/causal/bsod/syncLevel', (v, p) => needInt(v, p, 1));
  nullable(b.leftEdgeX, '/causal/bsod/leftEdgeX', needF64);
  nullable(b.initial, '/causal/bsod/initial', (v, p) => {
    strict(v, p, ['wallX', 'wallSpeedPxS', 'accelerationPxS2']);
    for (const k of ['wallX', 'wallSpeedPxS', 'accelerationPxS2']) needF64(v[k], `${p}/${k}`);
  });

  const st = strict(c.start, '/causal/start', ['tick', 'pose']);
  if (st.tick !== 0) bad('/causal/start/tick', 'non-zero start tick is reserved');
  if (!Array.isArray(st.pose) || st.pose.length !== 6) bad('/causal/start/pose', 'expected 6 F64');
  st.pose.forEach((v, i) => needF64(v, `/causal/start/pose/${i}`));

  const rng = strict(c.rng, '/causal/rng', ['version', 'physicsScramble']);
  needInt(rng.version, '/causal/rng/version', 1);
  needU32(rng.physicsScramble, '/causal/rng/physicsScramble');

  const inp = strict(c.input, '/causal/input',
    ['protocol', 'protocolVersion', 'tickHz', 'tiltScale', 'bits', 'endTick', 'edgeRows', 'tapeDigest']);
  if (inp.protocol !== 'bb-pad' || inp.protocolVersion !== 1) {
    fail('unsupported-input-protocol', '/causal/input/protocol', `${show(inp.protocol)} v${show(inp.protocolVersion)}`);
  }
  needInt(inp.tickHz, '/causal/input/tickHz', 1);
  if (inp.tiltScale !== 127) bad('/causal/input/tiltScale', 'must be 127');
  strict(inp.bits, '/causal/input/bits', ['bool', 'edge', 'heliShift']);
  if (!sameList(inp.bits.bool, PAD_BITS_V1.bool)) bad('/causal/input/bits/bool', 'must equal the bb-pad v1 definition');
  if (!sameList(inp.bits.edge, PAD_BITS_V1.edge)) bad('/causal/input/bits/edge', 'must equal the bb-pad v1 definition');
  if (inp.bits.heliShift !== PAD_BITS_V1.heliShift) bad('/causal/input/bits/heliShift', 'must equal the bb-pad v1 definition');
  needInt(inp.endTick, '/causal/input/endTick', 0);
  needEnum(inp.edgeRows, ['every-tick', 'legacy'], '/causal/input/edgeRows');
  needDigest(inp.tapeDigest, '/causal/input/tapeDigest');

  const cp = strict(c.checkpoints, '/causal/checkpoints', ['everyTicks', 'algo', 'schemas', 'detail']);
  needInt(cp.everyTicks, '/causal/checkpoints/everyTicks', 1);
  needEnum(cp.detail, ['none', 'combined', 'full'], '/causal/checkpoints/detail');
  const none = cp.detail === 'none';
  if (none !== (cp.algo === null)) bad('/causal/checkpoints/algo', 'null iff detail is none');
  if (none !== (cp.schemas === null)) bad('/causal/checkpoints/schemas', 'null iff detail is none');
  if (!none) {
    if (cp.algo !== 'xxh32x2') bad('/causal/checkpoints/algo', 'expected xxh32x2');
    strict(cp.schemas, '/causal/checkpoints/schemas', [...FP_SUBSYSTEMS]);
    for (const n of FP_SUBSYSTEMS) needInt(cp.schemas[n], `/causal/checkpoints/schemas/${n}`, 1);
  }
}

function collectNaNF64(node, ptr, out) {
  if (isStr(node)) { if (node === 'f64:7ff8000000000000') out.push(ptr); } else if (Array.isArray(node)) {
    node.forEach((v, i) => collectNaNF64(v, `${ptr}/${i}`, out));
  } else if (isObj(node)) for (const k of Object.keys(node)) collectNaNF64(node[k], `${ptr}/${esc(k)}`, out);
}

function checkRuleset(rs) {
  const ok = isObj(rs) && isObj(rs.versions) && isObj(rs.engine) && isObj(rs.constants) && isObj(rs.constants.bsodDefaults)
    && isObj(rs.versions.inputProtocol) && isObj(rs.tables) && Array.isArray(rs.tables.dailyRules);
  if (!ok) fail('invalid-ruleset', '', 'ruleset document lacks versions/engine/constants.bsodDefaults/tables.dailyRules');
}

/** 4.2.8 cross-field checks. Hard refusals throw `inconsistent-field`; the BSOD initial check is a soft outcome. */
function crossChecks(m, rs, outcomes) {
  const c = m.causal;
  const inc = (ptr, detail) => fail('inconsistent-field', ptr, detail);
  if (c.sim.tickHz !== c.input.tickHz) inc('/causal/input/tickHz', 'sim.tickHz != input.tickHz');
  const lane = m.info.lane;
  if (lane?.mode === 'daily') {
    if (Object.keys(c.loadout.upgradeRanks).length) inc('/causal/loadout/upgradeRanks', 'daily lane has no ranks');
    if (c.loadout.boosts.length) inc('/causal/loadout/boosts', 'daily lane has no boosts');
    if (c.kodiak?.enabled) inc('/causal/kodiak/enabled', 'daily lane has no Kodiaks');
    if (c.loadout.magnetsDrop === false) inc('/causal/loadout/magnetsDrop', 'daily lane drops magnets');
  }
  if (c.rng.version === 1) {
    const want = xxHash32('physics/scramble', xxHash32(c.course.seed));
    if (c.rng.physicsScramble !== want) inc('/causal/rng/physicsScramble', 'not xxHash32("physics/scramble", xxHash32(seed))');
  }
  if (c.course.dailyRuleSource === 'seed-date') {
    const key = DailyPatch.dateKeyFromSeed(c.course.seed);
    const info = key ? DailyPatch.infoForDateKey(key) : null;
    if (!info) inc('/causal/course/dailyRuleSource', 'seed-date requires a daily-YYYY-MM-DD seed');
    if (c.course.dailyRuleId !== info.rule.id) inc('/causal/course/dailyRuleId', 'differs from the rule of the seed date');
  }
  if (c.loadout.magnetsDrop === null && !(m.info.legacy?.absentFields || []).includes('magnetsDrop')) {
    inc('/info/legacy/absentFields', 'unknown magnetsDrop must be listed in absentFields');
  }
  if (c.bsod.leftEdgeX !== null && f64Decode(c.bsod.leftEdgeX) > f64Decode(c.start.pose[0])) {
    inc('/causal/bsod/leftEdgeX', 'leftEdgeX > start.pose[0]');
  }
  if (!rs) return;
  checkRuleset(rs);
  if (c.sim.tickHz !== rs.versions.tickHz) inc('/causal/sim/tickHz', 'differs from ruleset.versions.tickHz');
  if (c.sim.engine && (c.sim.engine.phaser !== rs.engine.phaser || c.sim.engine.matter !== rs.engine.matter)) {
    inc('/causal/sim/engine', 'differs from ruleset.engine');
  }
  if (c.sim.simRevision !== null && c.sim.simRevision !== rs.simRevision) inc('/causal/sim/simRevision', 'differs from ruleset');
  if (c.kodiak && c.kodiak.version !== rs.versions.kodiak) inc('/causal/kodiak/version', 'differs from ruleset.versions.kodiak');
  if (c.rng.version !== rs.versions.runRandom) inc('/causal/rng/version', 'differs from ruleset.versions.runRandom');
  if (c.input.protocolVersion !== rs.versions.inputProtocol.version) {
    inc('/causal/input/protocolVersion', 'differs from ruleset.versions.inputProtocol.version');
  }
  const rid = c.course.dailyRuleId;
  if (rid !== null && rid !== 'none' && !rs.tables.dailyRules.some((r) => r && r.id === rid)) {
    inc('/causal/course/dailyRuleId', 'not in the ruleset daily rule table');
  }
  if (c.bsod.syncLevel !== null) {
    // Computed through the real constructor so constructor drift is caught. A bit mismatch is `inconclusive`, not a
    // refusal (spec amendment: Math.log1p results may differ across engines).
    const D = rs.constants.bsodDefaults;
    const eff = upgradeEffects(c.loadout.upgradeRanks);
    const p = new BsodPursuit({ sledLeftEdgeX: f64Decode(c.bsod.leftEdgeX), level: c.bsod.syncLevel,
      config: { ...D, accelerationPxS2: D.accelerationPxS2 * eff.bsodAccelerationMul } });
    const expected = { wallX: f64Encode(p.wallX), wallSpeedPxS: f64Encode(p.wallSpeedPxS),
      accelerationPxS2: f64Encode(p.accelerationPxS2) };
    for (const k of ['wallX', 'wallSpeedPxS', 'accelerationPxS2']) {
      if (c.bsod.initial[k] !== expected[k]) {
        outcomes.push({ outcome: 'inconclusive', reason: 'bsod-initial-divergence', pointer: `/causal/bsod/initial/${k}`,
          expected: expected[k], actual: c.bsod.initial[k] });
      }
    }
  }
}

/**
 * Validate a manifest (4.2). `input` is canonical bytes, a canonical string, or a plain object (canonicalized first).
 * `rulesetResolver(rulesetId) -> ruleset document | null`; pass `null` to skip ruleset-dependent checks (reported in
 * `warnings`). `opts.understoodExtensions`: `ext` keys this reader implements (for `critical`).
 * @returns {{ok:true, manifest, manifestDigest, causalDigest, outcome:'valid'|'inconclusive', reasons:object[], warnings:string[]}
 *   | {ok:false, code:string, pointer:string, detail?:string}}
 */
export function validateManifest(input, rulesetResolver = null, opts = {}) {
  try {
    const bytes = (typeof input === 'string' || ArrayBuffer.isView(input)) ? input : canonicalBytes(input);
    const manifest = parseCanonical(bytes);
    return { ok: true, ...checkManifest(manifest, rulesetResolver, opts, bytes) };
  } catch (e) {
    if (e instanceof CJSONError || e instanceof ManifestError) {
      return { ok: false, code: e.code, pointer: e.pointer, ...(e.detail ? { detail: e.detail } : {}) };
    }
    throw e;
  }
}

/** Throwing core: refusal => ManifestError. Exposed for the evidence-bundle validator. */
export function checkManifest(m, rulesetResolver, opts = {}, bytes = null) {
  const warnings = [];
  const reasons = [];
  if (!isObj(m)) bad('', 'manifest must be an object');
  if (m.format !== MANIFEST_FORMAT) bad('/format', `expected ${MANIFEST_FORMAT}`);
  if (!isInt(m.formatVersion) || m.formatVersion < 1) bad('/formatVersion', 'expected integer >= 1');
  if (m.formatVersion > MANIFEST_VERSION) fail('unsupported-format-version', '/formatVersion', String(m.formatVersion));
  for (const k of Object.keys(m).sort()) if (!ENVELOPE_KEYS.includes(k)) fail('unknown-envelope-field', `/${esc(k)}`);
  for (const k of ENVELOPE_KEYS) if (!(k in m)) bad(`/${k}`, 'missing');
  needInt(m.formatMinor, '/formatMinor', 0);
  needObj(m.ext, '/ext');
  if (!Array.isArray(m.critical)) bad('/critical', 'expected array');
  m.critical.forEach((k, i) => {
    needStr(k, `/critical/${i}`);
    if (i > 0 && !(m.critical[i - 1] < k)) bad(`/critical/${i}`, 'critical must be sorted and unique');
    if (!(k in m.ext)) bad(`/critical/${i}`, 'names a nonexistent ext key');
  });
  const understood = opts.understoodExtensions || [];
  m.critical.forEach((k, i) => {
    if (!understood.includes(k)) fail('unsupported-critical-extension', `/critical/${i}`, k);
  });

  const legacy = { value: false };
  const prov = validateInfo(m.info, legacy);
  validateCausal(m.causal, legacy.value);
  if (prov === 'live-recording' && m.causal.input.edgeRows !== 'every-tick') {
    bad('/causal/input/edgeRows', 'live-recording requires every-tick');
  }

  let rs = null;
  const id = m.causal.sim.rulesetId;
  if (id !== null && rulesetResolver) {
    rs = rulesetResolver(id) || null;
    if (!rs) fail('unknown-ruleset', '/causal/sim/rulesetId', id);
    if (digestOf(rs) !== id) fail('ruleset-digest-mismatch', '/causal/sim/rulesetId', id);
  } else if (id !== null) warnings.push('ruleset-checks-skipped');
  crossChecks(m, rs, reasons);

  const nan = [];
  collectNaNF64(m.causal, '/causal', nan);
  for (const p of nan) warnings.push(`nan-f64:${p}`);

  return {
    manifest: m,
    manifestDigest: bytes && ArrayBuffer.isView(bytes) ? digestOfBytes(bytes) : digestOf(m),
    causalDigest: digestOf(m.causal),
    outcome: reasons.length ? 'inconclusive' : 'valid',
    reasons,
    warnings,
  };
}

// --- building ---------------------------------------------------------------------------------------------------------

const hasSurrogate = (s) => {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) { const d = s.charCodeAt(i + 1); if (d >= 0xdc00 && d <= 0xdfff) i++; else return true; } else if (c >= 0xdc00 && c <= 0xdfff) return true;
  }
  return false;
};

const POSE_KEYS = 6;
const f64Pose = (pose, ptr) => {
  if (!Array.isArray(pose) || pose.length !== POSE_KEYS || !pose.every((v) => typeof v === 'number')) bad(ptr, 'expected 6 numbers');
  return pose.map(f64Encode);
};

function laneOf(mode) {
  if (!LANE_MODES.includes(mode)) fail('evidence-ineligible', '/info/lane/mode', show(mode));
  return { mode, dailyOfficial: mode !== 'normal', dailyMode: mode === 'daily-draft' ? 'draft' : 'classic' };
}

function commonCausal(tape, edgeRows) {
  if (!isStr(tape.seed)) bad('/causal/course/seed', 'tape has no seed');
  if (hasSurrogate(tape.seed)) fail('evidence-ineligible', '/causal/course/seed', 'lone-surrogate');
  if (!tape.random || !isU32(tape.random.physicsScramble)) bad('/causal/rng/physicsScramble', 'tape has no random state');
  return {
    course: { seed: tape.seed, biomeMask: (Number(tape.biomeMask) || 0) >>> 0 },
    start: { tick: 0, pose: f64Pose(tape.startPose, '/causal/start/pose') },
    rng: { version: tape.runRandomVersion, physicsScramble: tape.random.physicsScramble },
    input: {
      protocol: 'bb-pad', protocolVersion: 1, tickHz: tape.simTickHz, tiltScale: 127,
      bits: { bool: [...PAD_BITS_V1.bool], edge: [...PAD_BITS_V1.edge], heliShift: PAD_BITS_V1.heliShift },
      endTick: tape.endTick, edgeRows, tapeDigest: tapeDigest(tape),
    },
  };
}

const rngVisual = (tape) => (tape.random && isU32(tape.random.visualSled)
  ? { visualSled: tape.random.visualSled, visualFx: tape.random.visualFx, visualCamera: tape.random.visualCamera } : undefined);

const sortedBoosts = (tape) => [...(Array.isArray(tape.boosts) ? tape.boosts : [])].sort();

/**
 * Manifest of a live recording. `runContext`:
 *  - tape: a finished tape from the fixed GhostRecorder (`edgeRows:'every-tick'`, header with `syncLevel`, `bsod`,
 *    `dailyRuleSource` as written by RunScene._ghostHeader);
 *  - ruleset: `{ rulesetId, simRevision, engine:{phaser,matter} }` (from #123);
 *  - checkpoints?: `{ algo, schemas, detail }` (default: none);  gameVersion?, provenance? ('live-recording' | 'synthetic'),
 *    ext?, critical?.
 * @throws {ManifestError} evidence-ineligible (gym, lone-surrogate seed) | invalid-run-context
 */
export function buildManifest(runContext) {
  const { tape, ruleset, checkpoints, gameVersion, provenance = 'live-recording', ext = {}, critical = [] } = runContext || {};
  const ctx = (detail) => fail('invalid-run-context', '', detail);
  if (!tape || tape.format !== 'bb-ghost-tape') ctx('tape required');
  if (tape.mode === 'gym') fail('evidence-ineligible', '/info/lane/mode', 'gym');
  if (tape.edgeRows !== 'every-tick') ctx('tape was recorded by the legacy recorder: use legacyManifestFromTape');
  if (!ruleset || !ruleset.rulesetId || !ruleset.engine) ctx('ruleset {rulesetId, simRevision, engine} required');
  if (!isInt(tape.syncLevel) || !tape.bsod || !tape.bsod.initial || typeof tape.bsod.leftEdgeX !== 'number') ctx('tape header lacks syncLevel/bsod');
  if (typeof tape.magnetsDrop !== 'boolean') ctx('tape header lacks magnetsDrop');
  if (typeof tape.dailyRuleId !== 'string' || !tape.dailyRuleId) ctx('tape header lacks dailyRuleId');
  const base = commonCausal(tape, 'every-tick');
  const cp = checkpoints || { algo: null, schemas: null, detail: 'none' };
  const lane = laneOf(tape.mode);
  const kodiak = typeof tape.kodiaksOn === 'boolean'
    ? { enabled: tape.kodiaksOn, packMode: tape.kodiakPackMode, version: tape.kodiakVersion } : undefined;
  const causal = {
    sim: { rulesetId: ruleset.rulesetId, simRevision: ruleset.simRevision, tickHz: tape.simTickHz, engine: { ...ruleset.engine } },
    course: { ...base.course, dailyRuleId: tape.dailyRuleId, dailyRuleSource: tape.dailyRuleSource },
    loadout: { upgradeRanks: tape.upgradeRanks && typeof tape.upgradeRanks === 'object' ? { ...tape.upgradeRanks } : {},
      boosts: sortedBoosts(tape), magnetsDrop: tape.magnetsDrop },
    ...(kodiak ? { kodiak } : {}),
    bsod: { syncLevel: tape.syncLevel, leftEdgeX: f64Encode(tape.bsod.leftEdgeX),
      initial: { wallX: f64Encode(tape.bsod.initial.wallX), wallSpeedPxS: f64Encode(tape.bsod.initial.wallSpeedPxS),
        accelerationPxS2: f64Encode(tape.bsod.initial.accelerationPxS2) } },
    start: base.start,
    rng: base.rng,
    input: base.input,
    checkpoints: { everyTicks: 120, algo: cp.algo, schemas: cp.schemas, detail: cp.detail },
  };
  const rv = rngVisual(tape);
  return {
    format: MANIFEST_FORMAT, formatVersion: MANIFEST_VERSION, formatMinor: MANIFEST_MINOR, critical: [...critical],
    causal,
    info: {
      ...(gameVersion ? { gameVersion } : {}), provenance, lane,
      inputCapture: { edgeAssignment: 'frame-first-tick' },
      ...(rv ? { rngVisual: rv } : {}),
    },
    ext: { ...ext },
  };
}

/**
 * Legacy-derived manifest (section 5), computed on demand; nothing is written back. Reduced guarantees: no ruleset,
 * no Sync Level, no BSOD start state, no fingerprints.
 * @throws {ManifestError}
 */
export function legacyManifestFromTape(tape) {
  if (!isObj(tape) || tape.format !== 'bb-ghost-tape') bad('/format', 'not a bb-ghost-tape');
  if (tape.version !== 1) fail('unsupported-format-version', '/version', show(tape.version));
  if (!Array.isArray(tape.inputs)) bad('/inputs', 'missing');
  if (!isInt(tape.endTick) || tape.endTick < 0) bad('/endTick', 'expected integer >= 0');
  const lane = laneOf(tape.mode === undefined ? 'normal' : tape.mode);
  validateInputRows(tape.inputs, tape.endTick);
  const base = commonCausal(tape, tape.edgeRows === 'every-tick' ? 'every-tick' : 'legacy');
  const absentFields = [];
  let magnetsDrop = null;
  if (typeof tape.magnetsDrop === 'boolean') magnetsDrop = tape.magnetsDrop; else absentFields.push('magnetsDrop');
  const kf = [tape.kodiaksOn, tape.kodiakPackMode, tape.kodiakVersion];
  const present = kf.filter((v) => v !== undefined).length;
  let kodiak;
  if (present === 3) {
    if (typeof kf[0] !== 'boolean' || !['same', 'mixed'].includes(kf[1]) || !isInt(kf[2]) || kf[2] < 1) bad('/kodiak', 'malformed Kodiak fields');
    kodiak = { enabled: kf[0], packMode: kf[1], version: kf[2] };
  } else if (present !== 0) bad('/kodiak', 'Kodiak fields are partially present');
  const dailyRuleId = isStr(tape.dailyRuleId) && tape.dailyRuleId ? tape.dailyRuleId : null;
  const rv = rngVisual(tape);
  return {
    format: MANIFEST_FORMAT, formatVersion: MANIFEST_VERSION, formatMinor: MANIFEST_MINOR, critical: [],
    causal: {
      sim: { rulesetId: null, simRevision: null, tickHz: tape.simTickHz, engine: null },
      course: { ...base.course, dailyRuleId, dailyRuleSource: 'recorded' },
      loadout: { upgradeRanks: tape.upgradeRanks && typeof tape.upgradeRanks === 'object' ? { ...tape.upgradeRanks } : {},
        boosts: sortedBoosts(tape), magnetsDrop },
      ...(kodiak ? { kodiak } : {}),
      bsod: { syncLevel: null, leftEdgeX: null, initial: null },
      start: base.start,
      rng: base.rng,
      input: { ...base.input, protocolVersion: tape.version },
      checkpoints: { everyTicks: 120, algo: null, schemas: null, detail: 'none' },
    },
    info: {
      provenance: 'legacy-derived', lane: { mode: lane.mode },
      legacy: { format: tape.format, version: tape.version, ...(tape.physicsVersion !== undefined ? { physicsVersion: tape.physicsVersion } : {}),
        exactSledCheckpoints: Array.isArray(tape.checkpoints) ? tape.checkpoints.length : 0, absentFields },
      ...(rv ? { rngVisual: rv } : {}),
    },
    ext: {},
  };
}

// --- evidence bundle (4.5) ----------------------------------------------------------------------------------------------

/**
 * Evidence bundle from a manifest and its tape. `opts.checkpoints` (rows for detail combined/full) and
 * `opts.exact` are optional; for a legacy-derived manifest the tape's exact sled checkpoints become `exact.sled`.
 */
export function evidenceBundle({ manifest, tape, checkpoints = [], exact }) {
  const inputs = (tape.inputs || []).map((r) => r.map(nz));
  let ex = exact;
  if (!ex && Array.isArray(tape.checkpoints) && tape.checkpoints.length) {
    ex = { sled: tape.checkpoints.map((r) => [r[0], ...r.slice(1, 7).map(f64Encode), r[7]]) };
  }
  return {
    format: EVIDENCE_FORMAT, formatVersion: EVIDENCE_VERSION,
    manifest, manifestDigest: digestOf(manifest),
    inputs, checkpoints,
    ...(ex ? { exact: ex } : {}),
    claims: { endTick: tape.endTick, cause: tape.cause || 'crash', score: Math.max(0, Math.round(tape.score)),
      distanceM: Math.floor(tape.distanceM) },
  };
}

export const bundleBytes = (bundle) => canonicalBytes(bundle);
export const bundleDigest = (bundleOrBytes) => (ArrayBuffer.isView(bundleOrBytes) ? digestOfBytes(bundleOrBytes) : digestOf(bundleOrBytes));
export const bundleFilename = (digest) => `${String(digest).replace(/^sha256:/, '')}.bbreplay`;

function checkBundle(b, rulesetResolver, opts, bytes) {
  strict(b, '', ['format', 'formatVersion', 'manifest', 'manifestDigest', 'inputs', 'checkpoints', 'claims'], ['exact'], 'unknown-envelope-field');
  if (b.format !== EVIDENCE_FORMAT) bad('/format', `expected ${EVIDENCE_FORMAT}`);
  if (!isInt(b.formatVersion) || b.formatVersion < 1) bad('/formatVersion', 'expected integer >= 1');
  if (b.formatVersion > EVIDENCE_VERSION) fail('unsupported-format-version', '/formatVersion', String(b.formatVersion));
  const res = checkManifest(b.manifest, rulesetResolver, opts);
  const m = res.manifest;
  needDigest(b.manifestDigest, '/manifestDigest');
  if (b.manifestDigest !== res.manifestDigest) fail('digest-mismatch', '/manifestDigest', 'does not match the manifest');
  const endTick = m.causal.input.endTick;
  validateInputRows(b.inputs, endTick);
  const td = digestOf({ format: TAPE_FORMAT, formatVersion: 1, protocol: { id: 'bb-pad', version: 1 }, tickHz: m.causal.input.tickHz,
    endTick, inputs: b.inputs.map((r) => r.map(nz)) });
  if (td !== m.causal.input.tapeDigest) fail('digest-mismatch', '/inputs', 'inputs do not hash to causal.input.tapeDigest');

  const cp = m.causal.checkpoints;
  if (!Array.isArray(b.checkpoints)) bad('/checkpoints', 'expected array');
  const want = cp.detail === 'none' ? 0 : cp.detail === 'combined' ? 2 : 1 + FP_SUBSYSTEMS.length + 1;
  let last = 0;
  b.checkpoints.forEach((row, i) => {
    const p = `/checkpoints/${i}`;
    if (!Array.isArray(row) || row.length !== want) bad(p, `row length ${want} required for detail ${cp.detail}`);
    needInt(row[0], `${p}/0`, 1);
    if (row[0] <= last || row[0] % cp.everyTicks !== 0 || row[0] > endTick) bad(`${p}/0`, 'checkpoint tick');
    last = row[0];
    row.slice(1).forEach((h, j) => { if (!isStr(h) || !FP16_RE.test(h)) bad(`${p}/${j + 1}`, 'expected 16 lowercase hex digits'); });
  });
  if (b.exact !== undefined) {
    strict(b.exact, '/exact', ['sled'], [], 'unknown-envelope-field');
    if (!Array.isArray(b.exact.sled)) bad('/exact/sled', 'expected array');
    let lt = 0;
    b.exact.sled.forEach((row, i) => {
      const p = `/exact/sled/${i}`;
      if (!Array.isArray(row) || row.length !== 8) bad(p, 'expected [tick, 6 x F64, score]');
      needInt(row[0], `${p}/0`, 1);
      if (row[0] <= lt || row[0] > endTick) bad(`${p}/0`, 'tick');
      lt = row[0];
      for (let j = 1; j <= 6; j++) needF64(row[j], `${p}/${j}`);
      needInt(row[7], `${p}/7`);
    });
  }
  const cl = strict(b.claims, '/claims', ['endTick', 'cause', 'score', 'distanceM'], ['distanceExact'], 'unknown-envelope-field');
  needInt(cl.endTick, '/claims/endTick', 0);
  if (cl.endTick !== endTick) fail('inconsistent-field', '/claims/endTick', 'differs from causal.input.endTick');
  needEnum(cl.cause, ['crash'], '/claims/cause');
  needInt(cl.score, '/claims/score', 0);
  needInt(cl.distanceM, '/claims/distanceM', 0);
  if (cl.distanceExact !== undefined) needF64(cl.distanceExact, '/claims/distanceExact');
  return { bundle: b, bundleDigest: bundleDigest(bytes), manifest: m, manifestDigest: res.manifestDigest, causalDigest: res.causalDigest,
    outcome: res.outcome, reasons: res.reasons, warnings: res.warnings };
}

/** Validate canonical evidence-bundle bytes (or an object). Same result shape as validateManifest. */
export function validateEvidenceBundle(input, rulesetResolver = null, opts = {}) {
  try {
    const bytes = (typeof input === 'string' || ArrayBuffer.isView(input)) ? input : canonicalBytes(input);
    const parsed = parseCanonical(bytes);
    const raw = typeof bytes === 'string' ? canonicalBytes(parsed) : bytes;
    return { ok: true, ...checkBundle(parsed, rulesetResolver, opts, raw) };
  } catch (e) {
    if (e instanceof CJSONError || e instanceof ManifestError) {
      return { ok: false, code: e.code, pointer: e.pointer, ...(e.detail ? { detail: e.detail } : {}) };
    }
    throw e;
  }
}

// --- replay setup (R-1..R-4) --------------------------------------------------------------------------------------------

/**
 * What a replay uses instead of the clock, the live profile and the live registry flags. `source` is a manifest or a
 * tape (new header, or an older tape). `opts.rules` is the daily rule table in use (array of `{id, modifiers}`).
 *
 * Values an older tape never recorded get a deterministic default that is NEVER read from the live profile, and the
 * name of each is listed in `defaulted` so strict verification / #117 can report reduced guarantees:
 *  - `magnetsDrop` absent -> true. Ghost tapes (da8935a) predate the Sync Level 5 magnet gate (3b6b961, which added the
 *    header field); until then magnets always dropped, so a tape without the field was recorded with magnets ON;
 *  - kodiak fields absent -> bears off (Kodiaks, 44e291c, postdate every such tape): listed as `kodiak` for legacy sources;
 *  - `syncLevel` absent -> 1 (not recorded before this contract; the true level is unknowable): `syncLevel`;
 *  - `dailyRuleId` absent/null -> no rule: `dailyRule`.
 * @returns {{dailyRuleId:string, dailyRule:object|null, syncLevel:number, magnetsDrop:boolean, kodiaksOn:boolean,
 *   kodiakPackMode:string, upgradeRanks:object, boosts:string[], bsodGym:false, dailyOfficial:false, dailyMode:'classic',
 *   defaulted:string[]}}
 * @throws {ManifestError} unknown-daily-rule (R-1: an id the rule table lacks)
 */
export function resolveReplaySetup(source, opts = {}) {
  const rules = opts.rules || DailyPatch.RULES;
  if (!isObj(source)) bad('', 'replay source required');
  let f;
  if (source.format === MANIFEST_FORMAT) {
    const c = source.causal;
    const legacy = Boolean(source.info && source.info.provenance === 'legacy-derived');
    f = { dailyRuleId: c.course.dailyRuleId, syncLevel: c.bsod.syncLevel, magnetsDrop: c.loadout.magnetsDrop,
      kodiak: c.kodiak ? { enabled: c.kodiak.enabled, packMode: c.kodiak.packMode } : null, kodiakAbsentIsDefault: legacy,
      upgradeRanks: c.loadout.upgradeRanks, boosts: c.loadout.boosts };
  } else {
    // A tape (new header or older): read it directly; replay must keep working for tapes the evidence rules would refuse.
    const t = source;
    f = { dailyRuleId: isStr(t.dailyRuleId) && t.dailyRuleId ? t.dailyRuleId : null,
      syncLevel: isInt(t.syncLevel) && t.syncLevel >= 1 ? t.syncLevel : null,
      magnetsDrop: typeof t.magnetsDrop === 'boolean' ? t.magnetsDrop : null,
      kodiak: typeof t.kodiaksOn === 'boolean'
        ? { enabled: t.kodiaksOn, packMode: t.kodiakPackMode === 'mixed' ? 'mixed' : 'same' } : null,
      kodiakAbsentIsDefault: true,
      upgradeRanks: t.upgradeRanks && typeof t.upgradeRanks === 'object' ? t.upgradeRanks : {},
      boosts: Array.isArray(t.boosts) ? t.boosts : [] };
  }
  const defaulted = [];
  if (f.dailyRuleId === null) defaulted.push('dailyRule');
  const id = f.dailyRuleId === null ? 'none' : f.dailyRuleId;
  let rule = null;
  if (id !== 'none') {
    rule = rules.find((r) => r && r.id === id) || null;
    if (!rule) fail('unknown-daily-rule', '/causal/course/dailyRuleId', show(id));
  }
  if (f.syncLevel === null) defaulted.push('syncLevel');
  if (f.magnetsDrop === null) defaulted.push('magnetsDrop');
  if (!f.kodiak && f.kodiakAbsentIsDefault) defaulted.push('kodiak');
  return {
    dailyRuleId: id, dailyRule: rule,
    syncLevel: f.syncLevel === null ? 1 : f.syncLevel,
    magnetsDrop: f.magnetsDrop === null ? true : f.magnetsDrop === true,
    kodiaksOn: f.kodiak ? f.kodiak.enabled === true : false,
    kodiakPackMode: f.kodiak ? f.kodiak.packMode : 'same',
    upgradeRanks: { ...f.upgradeRanks }, boosts: [...f.boosts],
    bsodGym: false, dailyOfficial: false, dailyMode: 'classic',
    defaulted,
  };
}
