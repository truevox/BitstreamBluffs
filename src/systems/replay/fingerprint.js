/**
 * Frame fingerprints for Replay Contract v1 (docs/replay/replay-contract-v1.md, section 6; issue #118): schema-driven BB-FP
 * encoding, per-subsystem and combined `xxh32x2` digests, a flat field dump, and `compareRuns` (first-divergence
 * localization). Fingerprints are drift detectors, never proofs of anything (section 3.2).
 *
 * Pure module: no Phaser, no clock, no randomness. Capture (reading a live scene) is fingerprintCapture.js.
 */
import { FpWriter, combineFingerprints, fingerprintOf } from './canonicalBinary.js';
import { f64Encode } from './canonicalJson.js';
import { FP_SCHEMAS, FP_SUBSYSTEMS, FP_VERSION } from './fingerprintSchemas.js';

export { FP_SCHEMAS, FP_SUBSYSTEMS, FP_VERSION };

const hasOwn = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

const FP_ERR = (path, msg) => new TypeError(`fingerprint ${path}: ${msg}`);

/**
 * Write `value` by `schema` (BB-FP v1, section 6.5). Strict: a missing field, an extra field, a wrong type or an
 * out-of-range integer throws with a path, because a silent default would hide drift.
 * @param {FpWriter} w
 * @param {*} schema DSL node
 * @param {*} v
 * @param {string} [path]
 * @returns {FpWriter}
 */
export function encodeBySchema(w, schema, v, path = '$') {
  if (typeof schema === 'string') {
    try {
      switch (schema) {
        case 'u32': return w.u32(v);
        case 'i32': return w.i32(v);
        case 'f64': return w.f64(v);
        case 'bool': return w.bool(v);
        case 'str': return w.str(v);
        default: throw new Error(`unknown schema type "${schema}"`);
      }
    } catch (e) {
      throw FP_ERR(path, e.message);
    }
  }
  if (hasOwn(schema, 'opt')) {
    if (v === undefined) throw FP_ERR(path, 'undefined is not a valid optional (use null)');
    return w.opt(v, (ww, x) => encodeBySchema(ww, schema.opt, x, path));
  }
  if (hasOwn(schema, 'list')) {
    if (!Array.isArray(v)) throw FP_ERR(path, `expected an array, got ${typeof v}`);
    return w.list(v, (ww, x, i) => encodeBySchema(ww, schema.list, x, `${path}[${i}]`));
  }
  if (hasOwn(schema, 'rec')) {
    if (v === null || typeof v !== 'object') throw FP_ERR(path, `expected a record, got ${v === null ? 'null' : typeof v}`);
    const names = new Set();
    for (const [name, type] of schema.rec) {
      if (!hasOwn(v, name)) throw FP_ERR(`${path}.${name}`, 'missing field');
      names.add(name);
      encodeBySchema(w, type, v[name], `${path}.${name}`);
    }
    for (const k of Object.keys(v)) if (!names.has(k)) throw FP_ERR(`${path}.${k}`, 'field is not in the schema');
    return w;
  }
  throw FP_ERR(path, 'malformed schema node');
}

/**
 * The BB-FP bytes of one subsystem: `u32 schemaVersion` then the fields in schema order.
 * @param {string} name subsystem
 * @param {*} value that subsystem's plain-object state
 * @returns {Uint8Array}
 */
export function encodeSubsystem(name, value) {
  const def = FP_SCHEMAS[name];
  if (!def) throw new Error(`unknown fingerprint subsystem "${name}"`);
  const w = new FpWriter(256);
  w.u32(def.version);
  encodeBySchema(w, def.schema, value, name);
  return w.bytes();
}

/** `xxh32x2:<16 hex>` of one subsystem's state. */
export function fingerprintSubsystem(name, value) {
  return fingerprintOf(encodeSubsystem(name, value));
}

/**
 * @typedef {{fp:number, tick:number, combined:string, subsystems:Object<string,string>}} FingerprintResult
 * Per-subsystem digests plus the combined digest (`u32 fpVersion | u32 tick | u32 count | count x 8 digest bytes`).
 * @param {{fp:number, tick:number}} state a CausalState from captureCausalState (or any state of the same shape)
 * @returns {FingerprintResult}
 */
export function fingerprintState(state) {
  if (!state || state.fp !== FP_VERSION) throw new TypeError(`fingerprintState: expected a CausalState with fp=${FP_VERSION}`);
  const subsystems = {};
  for (const name of FP_SUBSYSTEMS) {
    if (!hasOwn(state, name)) throw new Error(`fingerprintState: missing subsystem "${name}"`);
    subsystems[name] = fingerprintSubsystem(name, state[name]);
  }
  return { fp: FP_VERSION, tick: state.tick, combined: combineFingerprints(state.tick, subsystems, FP_SUBSYSTEMS), subsystems };
}

// ---------------------------------------------------------------------------------------------------------------------
// dumpState
// ---------------------------------------------------------------------------------------------------------------------

function dumpNode(out, schema, v, path) {
  if (typeof schema === 'string') {
    out[path] = schema === 'f64' ? f64Encode(v) : v;
  } else if (hasOwn(schema, 'opt')) {
    if (v === null) out[path] = null;
    else dumpNode(out, schema.opt, v, path);
  } else if (hasOwn(schema, 'list')) {
    out[`${path}.length`] = v.length;
    for (let i = 0; i < v.length; i++) dumpNode(out, schema.list, v[i], `${path}[${i}]`);
  } else {
    for (const [name, type] of schema.rec) dumpNode(out, type, v[name], `${path}.${name}`);
  }
}

/**
 * Flat field dump of a CausalState: `{ "bsod.wallX": "f64:c0bd2fecccccccce", "kodiak.bears[0].phase": "approach", ... }`.
 * Floats are F64 hex strings (so -0, Infinity and NaN are visible and exact), integers and booleans are literal, an absent
 * optional is `null`, a list adds `<path>.length`. Key order is the canonical schema order (FP_SUBSYSTEMS order, then the
 * schema's field order, then ascending index), which is what "first differing field" means.
 * @param {{fp:number, tick:number}} state
 * @param {{subsystems?: string[]}} [opts] restrict to some subsystems
 * @returns {Object<string, string|number|boolean|null>}
 */
export function dumpState(state, opts = {}) {
  const names = opts.subsystems || FP_SUBSYSTEMS;
  const out = { tick: state.tick };
  for (const name of FP_SUBSYSTEMS) {
    if (!names.includes(name)) continue;
    dumpNode(out, FP_SCHEMAS[name].schema, state[name], name);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------------------------
// compareRuns
// ---------------------------------------------------------------------------------------------------------------------

/**
 * @typedef {Object} RunTrace
 * @property {string} [causalDigest] `sha256:` of the manifest `causal` object; two runs are only comparable when equal
 * @property {string} [manifestDigest] informational
 * @property {number} [endTick] last simulated tick of the run (`causal.input.endTick`); compared when both sides have it
 * @property {Array<{tick:number, combined:string, subsystems?:Object<string,string>}>} checkpoints ascending by tick
 * @property {(w:{fromTick:number, toTick:number}) => Promise<FingerprintResult[]>|FingerprintResult[]} [resimulate]
 *   re-simulate this side from tick 0 and return the per-tick fingerprint (with `subsystems`) of every tick in
 *   (fromTick, toTick]; the caller owns the simulator, this module never imports one
 * @property {(tick:number) => Promise<object>|object} [dumpAt] CausalState at a tick (a re-simulation capture)
 */

/**
 * @typedef {Object} CompareResult
 * @property {'match'|'diverged'|'inconclusive'} status
 * @property {number|null} firstDivergentTick first tick whose combined digest differs (needs both resimulate callbacks)
 * @property {number|null} firstDivergentCheckpoint first checkpoint tick whose combined digest differs
 * @property {string|null} subsystem owner of `fieldPath`
 * @property {string|null} fieldPath first differing field in canonical order (`bsod.wallX`)
 * @property {*} expected `a`'s value at `fieldPath`
 * @property {*} actual `b`'s value at `fieldPath`
 * @property {string[]} differingSubsystems subsystems whose digest differs at firstDivergentTick (FP_SUBSYSTEMS order)
 * @property {string[]} matchingSubsystems the rest
 * @property {number} resims simulations started (resimulate calls)
 * @property {string[]} differingPaths additive: every differing field of `subsystem` at firstDivergentTick, canonical order
 * @property {string} [note]
 */

const result = (over) => ({
  status: 'match', firstDivergentTick: null, firstDivergentCheckpoint: null, subsystem: null, fieldPath: null,
  expected: null, actual: null, differingSubsystems: [], matchingSubsystems: [...FP_SUBSYSTEMS], resims: 0,
  differingPaths: [], ...over,
});

const splitSubsystems = (a, b) => {
  const differing = FP_SUBSYSTEMS.filter((n) => a[n] !== b[n]);
  return { differing, matching: FP_SUBSYSTEMS.filter((n) => a[n] === b[n]) };
};

const ownerOf = (path) => path.slice(0, path.search(/[.[]/) < 0 ? path.length : path.search(/[.[]/));

/**
 * Compare two runs of the same causal inputs and localize the first divergence (section 6.6, steps 1-5).
 *  1. refuse (inconclusive, note "causal-mismatch") when the causal digests differ, unless `opts.ignoreCausal`;
 *  2. find the first checkpoint whose combined digest differs (or a different checkpoint list);
 *  3. name the differing subsystems there (from stored `full` detail, else from the re-simulation);
 *  4. re-simulate both sides once over (previous matching checkpoint, divergent checkpoint] and find the first tick whose
 *     per-tick combined digest differs;
 *  5. dump both sides at that tick and diff the flat dumps.
 * `a` is the reference ("expected"), `b` the run under test ("actual"). Re-simulation is injected through
 * `RunTrace.resimulate/dumpAt`; without it the result stops at checkpoint resolution and is `inconclusive`.
 * @param {RunTrace} a
 * @param {RunTrace} b
 * @param {{ignoreCausal?: boolean}} [opts]
 * @returns {Promise<CompareResult>}
 */
export async function compareRuns(a, b, opts = {}) {
  let resims = 0;
  if (!opts.ignoreCausal) {
    if (!a.causalDigest || !b.causalDigest) return result({ status: 'inconclusive', note: 'no-causal-digest' });
    if (a.causalDigest !== b.causalDigest) return result({ status: 'inconclusive', note: 'causal-mismatch' });
  }
  const ca = a.checkpoints || [];
  const cb = b.checkpoints || [];
  if (ca.length === 0 && cb.length === 0) return result({ status: 'inconclusive', note: 'no-checkpoints' });
  // A gap (a capture that failed, or a stripped checkpoint) must never be read as agreement or as a divergence.
  const every = opts.everyTicks || 120;
  for (const c of [ca, cb]) {
    if (c.some((x, i) => x.tick !== (i + 1) * every)) return result({ status: 'inconclusive', note: 'checkpoint-gap' });
  }
  const n = Math.min(ca.length, cb.length);
  let idx = -1;
  for (let i = 0; i < n; i++) {
    if (ca[i].tick !== cb[i].tick) {
      return result({ status: 'diverged', firstDivergentCheckpoint: Math.min(ca[i].tick, cb[i].tick), note: 'checkpoint-tick-mismatch' });
    }
    if (ca[i].combined !== cb[i].combined) { idx = i; break; }
  }
  if (idx < 0) {
    if (ca.length !== cb.length) {
      const longer = ca.length > cb.length ? ca : cb;
      return result({ status: 'diverged', firstDivergentCheckpoint: longer[n].tick, note: 'checkpoint-count-mismatch' });
    }
    if (a.endTick !== undefined && b.endTick !== undefined && a.endTick !== b.endTick) {
      return result({ status: 'diverged', note: 'end-tick-mismatch' });
    }
    return result({ status: 'match', ...(a.endTick === undefined || b.endTick === undefined ? { note: 'end-tick-not-compared' } : {}) });
  }
  const t1 = ca[idx].tick;
  const t0 = idx > 0 ? ca[idx - 1].tick : 0;
  const base = { firstDivergentCheckpoint: t1 };

  // Step 3 from stored detail, when both sides have it.
  let storedSplit = null;
  if (ca[idx].subsystems && cb[idx].subsystems) storedSplit = splitSubsystems(ca[idx].subsystems, cb[idx].subsystems);

  if (typeof a.resimulate !== 'function' || typeof b.resimulate !== 'function') {
    return result({
      ...base, status: 'inconclusive', note: 'no-resimulate',
      differingSubsystems: storedSplit ? storedSplit.differing : [], matchingSubsystems: storedSplit ? storedSplit.matching : [...FP_SUBSYSTEMS],
    });
  }

  // Step 4: one re-simulation per side over the window.
  const window = { fromTick: t0, toTick: t1 };
  const ra = await a.resimulate(window); resims++;
  const rb = await b.resimulate(window); resims++;
  const want = t1 - t0;
  if (!Array.isArray(ra) || !Array.isArray(rb) || ra.length !== want || rb.length !== want
    || ra.some((r, i) => r.tick !== t0 + 1 + i) || rb.some((r, i) => r.tick !== t0 + 1 + i)) {
    return result({ ...base, status: 'inconclusive', resims, note: 'bad-resimulation-window' });
  }
  let k = -1;
  for (let i = 0; i < want; i++) if (ra[i].combined !== rb[i].combined) { k = i; break; }
  if (k < 0) {
    return result({ ...base, status: 'inconclusive', resims, note: 'divergence-not-reproduced' });
  }
  // The re-simulation must reproduce what was recorded at the checkpoint, or its first divergence means nothing.
  if (ra[want - 1].combined !== ca[idx].combined || rb[want - 1].combined !== cb[idx].combined) {
    return result({ ...base, status: 'inconclusive', resims, note: 'resim-does-not-reproduce-checkpoint' });
  }
  const tick = ra[k].tick;
  const split = splitSubsystems(ra[k].subsystems || {}, rb[k].subsystems || {});
  const out = { ...base, firstDivergentTick: tick, resims, differingSubsystems: split.differing, matchingSubsystems: split.matching };

  // Step 5: field-level diff.
  if (typeof a.dumpAt !== 'function' || typeof b.dumpAt !== 'function') {
    return result({ ...out, status: 'diverged', subsystem: split.differing[0] ?? null, note: 'no-dumpAt' });
  }
  const da = dumpState(await a.dumpAt(tick));
  const db = dumpState(await b.dumpAt(tick));
  const paths = [];
  const seen = new Set();
  for (const p of Object.keys(da)) { seen.add(p); if (!Object.is(da[p], db[p])) paths.push(p); }
  for (const p of Object.keys(db)) if (!seen.has(p) && !Object.is(da[p], db[p])) paths.push(p);
  const first = paths[0];
  if (first === undefined) {
    return result({ ...out, status: 'diverged', subsystem: split.differing[0] ?? null, note: 'dumps-identical-but-digests-differ' });
  }
  const subsystem = ownerOf(first);
  return result({
    ...out, status: 'diverged', subsystem, fieldPath: first, expected: first in da ? da[first] : null,
    actual: first in db ? db[first] : null, differingPaths: paths.filter((p) => ownerOf(p) === subsystem),
  });
}
