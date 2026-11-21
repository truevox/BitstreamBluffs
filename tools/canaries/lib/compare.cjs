/**
 * Issue #117 golden-canary comparators (TEST INFRASTRUCTURE ONLY).
 *
 * Pure, dependency-free and browser-free: this module is loaded both by `feel-diff.mjs` (ESM, via
 * `import core from './lib/compare.cjs'`) and by the Jest unit tests (CommonJS `require`), so it must not
 * import Phaser, the game's `src/**` or any DOM API. It only knows the record shape the runner writes.
 *
 * A record is one canary's captured run:
 *   {
 *     id, seed, biomeMask, hz,
 *     simVersion: { simTickHz, runRandomVersion, ghostTapeFormat, ghostTapeVersion, ghostPhysicsVersion },
 *     checkpoints: [ [tickMs, x, y, angle, vx, vy, score], ... ],   // one per simulated second
 *     result: { crashed, crashTick, cause, score, distance, endTick },
 *     stats: { timeToFirstInputMs, inputChanges, airborneTicks, ticks, totalSimMs, scoreMean, scoreMin, scoreMax }
 *   }
 *
 * Checkpoints are arrays in CHECKPOINT_FIELDS order (as the issue specifies) but this module also accepts
 * object checkpoints with the same keys, so hand-written fixtures stay readable.
 */

'use strict';

/** Checkpoint column order written by `run-canaries.mjs`. Never reorder: golden files depend on it. */
const CHECKPOINT_FIELDS = Object.freeze(['tickMs', 'x', 'y', 'angle', 'vx', 'vy', 'score']);

/** Numeric comparison fields (tickMs is an identifier, not compared). */
const NUMERIC_FIELDS = Object.freeze(['x', 'y', 'angle', 'vx', 'vy', 'score']);

/**
 * Default tolerance per field. Zero means exact: goldens are recorded and compared on one machine/build,
 * and IEEE-754 doubles round-trip through JSON exactly, so any difference IS a divergence. Do not widen
 * these to hide a flaky result; declare a reviewed, field-scoped `expected/<id>.json` instead.
 */
const DEFAULT_EPSILON = Object.freeze({
  x: 0, y: 0, angle: 0, vx: 0, vy: 0, score: 0,
  crashTick: 0, distance: 0, endTick: 0,
});

const STATUS = Object.freeze({
  PASS: 'PASS',
  EXPECTED_DIFF: 'EXPECTED_DIFF',
  DIVERGED: 'DIVERGED',
  MISSING_BASELINE: 'MISSING_BASELINE',
});

const r6 = (v) => (Number.isFinite(v) ? Math.round(v * 1e6) / 1e6 : v);

/** Normalise a checkpoint (array or object) to a plain object with every field. */
function normalizeCheckpoint(cp) {
  if (Array.isArray(cp)) {
    const out = {};
    CHECKPOINT_FIELDS.forEach((f, i) => { out[f] = cp[i]; });
    return out;
  }
  const out = {};
  for (const f of CHECKPOINT_FIELDS) out[f] = cp ? cp[f] : undefined;
  return out;
}

function finiteOrNull(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

/**
 * Earliest checkpoint where any numeric field differs beyond `epsilon`.
 * Returns null when the runs match on every shared checkpoint, else
 * { tickMs, field, baseline, current, delta, absDelta }.
 * @param {Array} baseline checkpoints @param {Array} current checkpoints @param {Object} [epsilon]
 */
function compareCheckpoints(baseline, current, epsilon = DEFAULT_EPSILON) {
  const a = Array.isArray(baseline) ? baseline : [];
  const b = Array.isArray(current) ? current : [];
  const n = Math.min(a.length, b.length);
  let first = null;
  for (let i = 0; i < n; i++) {
    const p = normalizeCheckpoint(a[i]);
    const q = normalizeCheckpoint(b[i]);
    // Checkpoints are paired by index only because index 0 is t=0 and every run samples one per simulated
    // second. If the two sides disagree on the time axis the pairing is meaningless, so report it as the
    // divergence rather than comparing unrelated samples.
    if (p.tickMs !== q.tickMs) {
      const d = { tickMs: p.tickMs, field: 'tickMs', baseline: p.tickMs, current: q.tickMs, delta: null, absDelta: null, rawAbsDelta: null };
      if (!first) first = d;
      continue;
    }
    for (const field of NUMERIC_FIELDS) {
      const tol = finiteOrNull(epsilon && epsilon[field]) ?? 0;
      const pv = p[field];
      const qv = q[field];
      if (!Number.isFinite(pv) || !Number.isFinite(qv)) {
        // A missing/non-finite value on either side is always a divergence.
        if (pv !== qv) {
          const d = { tickMs: p.tickMs, field, baseline: pv, current: qv, delta: null, absDelta: null };
          if (!first) first = d;
        }
        continue;
      }
      const delta = qv - pv;
      const absDelta = Math.abs(delta);
      if (absDelta > tol) {
        const d = { tickMs: p.tickMs, field, baseline: pv, current: qv, delta: r6(delta), absDelta: r6(absDelta) };
        if (!first) first = d;
      }
    }
  }
  return first;
}

/** Every checkpoint divergence (same shape as firstDivergence), for coverage checks against `expected`. */
function allCheckpointDivergences(baseline, current, epsilon = DEFAULT_EPSILON) {
  const a = Array.isArray(baseline) ? baseline : [];
  const b = Array.isArray(current) ? current : [];
  const out = [];
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const p = normalizeCheckpoint(a[i]);
    const q = normalizeCheckpoint(b[i]);
    if (p.tickMs !== q.tickMs) {
      out.push({ tickMs: p.tickMs, field: 'tickMs', baseline: p.tickMs, current: q.tickMs, delta: null, absDelta: null, rawAbsDelta: null });
      continue;
    }
    for (const field of NUMERIC_FIELDS) {
      const tol = finiteOrNull(epsilon && epsilon[field]) ?? 0;
      const pv = p[field];
      const qv = q[field];
      if (!Number.isFinite(pv) || !Number.isFinite(qv)) {
        if (pv !== qv) out.push({ tickMs: p.tickMs, field, baseline: pv, current: qv, delta: null, absDelta: null, rawAbsDelta: null });
        continue;
      }
      // Tolerance is applied to the RAW delta. `absDelta`/`delta` are rounded for display only; `rawAbsDelta`
      // is what an expected-difference declaration is checked against, so rounding can never approve a delta
      // that is larger than the declared bound.
      const absDelta = Math.abs(qv - pv);
      if (absDelta > tol) out.push({ tickMs: p.tickMs, field, baseline: pv, current: qv, delta: r6(qv - pv), absDelta: r6(absDelta), rawAbsDelta: absDelta });
    }
  }
  if (a.length !== b.length) {
    const tickMs = a.length === 0 || b.length === 0
      ? (a[0] ? normalizeCheckpoint(a[0]).tickMs : (b[0] ? normalizeCheckpoint(b[0]).tickMs : null))
      : normalizeCheckpoint(a[n - 1]).tickMs;
    out.push({ tickMs, field: 'checkpointCount', baseline: a.length, current: b.length, delta: b.length - a.length, absDelta: Math.abs(b.length - a.length) });
  }
  return out;
}

/** Field-wise comparison of `result` (outcome): crashes, crash tick, cause, score, distance, end tick. */
function compareOutcome(baseline, current) {
  const a = baseline || {};
  const b = current || {};
  const fields = ['crashed', 'crashTick', 'cause', 'hazardId', 'score', 'distance', 'endTick'];
  const deltas = {};
  // Compare RAW values; round only for display. Rounding first would report a sub-microscopic change as
  // "unchanged" and could let an expected-difference declaration cover it.
  for (const f of fields) {
    const av = a[f];
    const bv = b[f];
    if (typeof av === 'number' && typeof bv === 'number') deltas[f] = r6(bv - av);
    else deltas[f] = av === bv ? 0 : { baseline: av == null ? null : av, current: bv == null ? null : bv };
  }
  const changed = fields.filter((f) => a[f] !== b[f]);
  return { baseline: a, current: b, deltas, changed };
}

/** Normalise record stats, recomputing the score aggregates from checkpoints when absent. */
function normalizeStats(record, checkpoints) {
  const s = (record && record.stats) || {};
  const cps = (checkpoints || []).map(normalizeCheckpoint);
  const scores = cps.map((c) => c.score).filter((v) => Number.isFinite(v));
  const mean = scores.length ? scores.reduce((x, y) => x + y, 0) / scores.length : 0;
  const min = scores.length ? Math.min(...scores) : 0;
  const max = scores.length ? Math.max(...scores) : 0;
  return {
    timeToFirstInputMs: finiteOrNull(s.timeToFirstInputMs),
    inputChanges: finiteOrNull(s.inputChanges) ?? 0,
    airborneTicks: finiteOrNull(s.airborneTicks) ?? 0,
    ticks: finiteOrNull(s.ticks) ?? 0,
    totalSimMs: finiteOrNull(s.totalSimMs) ?? 0,
    scoreMean: Number.isFinite(s.scoreMean) ? s.scoreMean : r6(mean),
    scoreMin: finiteOrNull(s.scoreMin) ?? min,
    scoreMax: finiteOrNull(s.scoreMax) ?? max,
  };
}

/**
 * Resolve the checkpoints/result/stats of a record, accepting either a full record or the record's
 * `checkpoints`/`record` wrapper. Throws a clear error on shapes a canary JSON would never have.
 */
function partsOf(record) {
  if (!record || typeof record !== 'object') throw new TypeError('record must be an object');
  if (typeof record.id !== 'string' || !record.id) throw new TypeError('record is missing a string id');
  if (!record.result || typeof record.result !== 'object') throw new TypeError(`record ${record.id} is missing result`);
  if (!Array.isArray(record.checkpoints) || record.checkpoints.length === 0) {
    throw new TypeError(`record ${record.id} has no checkpoints`);
  }
  const checkpoints = record.checkpoints.map((cp, i) => {
    const n = normalizeCheckpoint(cp);
    if (!Number.isFinite(n.tickMs)) throw new TypeError(`record ${record.id} checkpoint[${i}] has no numeric tickMs`);
    if (!Number.isFinite(n.x) || !Number.isFinite(n.y)) throw new TypeError(`record ${record.id} checkpoint[${i}] has no numeric x/y`);
    if (i > 0) {
      const prev = normalizeCheckpoint(record.checkpoints[i - 1]);
      if (!(n.tickMs > prev.tickMs)) throw new TypeError(`record ${record.id} checkpoint[${i}] tickMs is not increasing (${prev.tickMs} -> ${n.tickMs})`);
    }
    return cp;
  });
  return {
    id: record.id,
    checkpoints,
    result: record.result,
    stats: normalizeStats(record, checkpoints),
    simVersion: record.simVersion || null,
  };
}

/**
 * Validate an expected-difference declaration. An undeclared/blank declaration must never act as a
 * wildcard: every entry needs a concrete numeric `field`, a finite non-negative `maxAbs`, a written
 * `reason` and a named `reviewer`. Throws instead of silently widening tolerance.
 * @param {Object} exp parsed expected/<id>.json
 * @param {string} [id] canary id, for error messages
 */
function validateExpected(exp, id = '?') {
  if (!exp || typeof exp !== 'object') throw new Error(`expected/${id}.json: not an object`);
  const allowed = Array.isArray(exp.allowed) ? exp.allowed : exp.allowed ? [exp.allowed] : [];
  if (!allowed.length) throw new Error(`expected/${id}.json: missing "allowed" entry`);
  if (typeof exp.reason !== 'string' || !exp.reason.trim()) throw new Error(`expected/${id}.json: missing written "reason"`);
  if (typeof exp.reviewer !== 'string' || !exp.reviewer.trim()) throw new Error(`expected/${id}.json: missing "reviewer"`);
  const norm = allowed.map((a, i) => {
    if (!a || typeof a !== 'object') throw new Error(`expected/${id}.json: allowed[${i}] is not an object`);
    if (typeof a.field !== 'string' || !a.field) throw new Error(`expected/${id}.json: allowed[${i}].field missing`);
    // A bound must be a real finite number, not something Number() will happily coerce: `null` -> 0,
    // `""` -> 0, `true` -> 1 and `[]` -> 0 would each silently become a bound nobody wrote.
    if (typeof a.maxAbs !== 'number' || !Number.isFinite(a.maxAbs) || a.maxAbs < 0) {
      throw new Error(`expected/${id}.json: allowed[${i}].maxAbs must be a finite non-negative number`);
    }
    return { field: a.field, maxAbs: a.maxAbs };
  });
  if (exp.id != null && exp.id !== id) throw new Error(`expected/${id}.json: id "${exp.id}" does not match canary "${id}"`);
  const reviewedAt = typeof exp.reviewedAt === 'string' && exp.reviewedAt.trim() ? exp.reviewedAt : null;
  if (!reviewedAt) throw new Error(`expected/${id}.json: missing "reviewedAt"`);
  return { id, allowed: norm, reason: exp.reason, reviewer: exp.reviewer, reviewedAt };
}

/**
 * Decide PASS / EXPECTED_DIFF / DIVERGED / MISSING_BASELINE for one canary.
 * @param {{baseline:Object|null,current:Object,expected?:Object|null,epsilon?:Object}} args
 */
function classifyRun({ baseline, current, expected = null, epsilon = DEFAULT_EPSILON }) {
  const id = (current && current.id) || (baseline && baseline.id) || '?';
  if (!baseline) {
    return { id, status: STATUS.MISSING_BASELINE, firstDivergence: null, divergences: [], outcome: null,
      stats: null, simVersion: null, expected: null };
  }
  const base = partsOf(baseline);
  const cur = partsOf(current);
  const divergences = allCheckpointDivergences(base.checkpoints, cur.checkpoints, epsilon);
  const firstDivergence = divergences.length
    ? divergences.reduce((best, d) => (best == null || d.tickMs < best.tickMs ? d : best), null)
    : null;
  const outcome = compareOutcome(base.result, cur.result);
  const outcomeChanged = outcome.changed;

  let expectedNorm = null;
  let covered = true;
  if (expected) {
    expectedNorm = validateExpected(expected, id);
    for (const d of divergences) {
      // Match on the RAW delta, never the display-rounded one: `absDelta` can round a real difference down
      // to 0 and would then satisfy a `maxAbs: 0` bound it actually exceeds.
      const raw = d.rawAbsDelta;
      const hit = expectedNorm.allowed.find((a) => a.field === d.field && raw != null && raw <= a.maxAbs);
      if (!hit) { covered = false; break; }
    }
    if (covered) {
      for (const f of outcomeChanged) {
        const delta = outcome.deltas[f];
        const abs = typeof delta === 'number' ? Math.abs(delta) : Infinity;
        const hit = expectedNorm.allowed.find((a) => a.field === f && abs <= a.maxAbs);
        if (!hit) { covered = false; break; }
      }
    }
  }

  const anyDiff = divergences.length > 0 || outcomeChanged.length > 0;
  let status = STATUS.PASS;
  if (anyDiff) status = expectedNorm && covered ? STATUS.EXPECTED_DIFF : STATUS.DIVERGED;

  const stats = {
    baseline: base.stats,
    current: cur.stats,
    scoreMeanDelta: r6(cur.stats.scoreMean - base.stats.scoreMean),
    scoreMinDelta: r6(cur.stats.scoreMin - base.stats.scoreMin),
    scoreMaxDelta: r6(cur.stats.scoreMax - base.stats.scoreMax),
    inputChangesDelta: cur.stats.inputChanges - base.stats.inputChanges,
    airborneTicksDelta: cur.stats.airborneTicks - base.stats.airborneTicks,
    ticksDelta: cur.stats.ticks - base.stats.ticks,
    timeToFirstInputDeltaMs: base.stats.timeToFirstInputMs == null || cur.stats.timeToFirstInputMs == null
      ? null : r6(cur.stats.timeToFirstInputMs - base.stats.timeToFirstInputMs),
  };

  const simVersion = { baseline: base.simVersion, current: cur.simVersion, changed: !sameSimVersion(base.simVersion, cur.simVersion) };

  return { id, status, firstDivergence, divergences, outcome, stats, simVersion, expected: expectedNorm };
}

function sameSimVersion(a, b) {
  if (!a || !b) return a === b;
  const keys = ['simTickHz', 'runRandomVersion', 'ghostTapeFormat', 'ghostTapeVersion', 'ghostPhysicsVersion'];
  return keys.every((k) => a[k] === b[k]);
}

/**
 * Aggregate handling statistics across canaries.
 * @param {Array<Object>} records full records (with result/stats/checkpoints)
 */
function aggregateStats(records) {
  const list = Array.isArray(records) ? records.filter(Boolean) : [];
  const n = list.length;
  if (!n) {
    return { canaries: 0, crashRate: 0, meanScore: 0, minScore: 0, maxScore: 0, meanDistance: 0,
      meanTicks: 0, meanTotalSimMs: 0, meanInputChanges: 0, meanAirborneTicks: 0, meanTimeToFirstInputMs: 0, crashes: 0 };
  }
  const stats = list.map((r) => normalizeStats(r, r.checkpoints));
  const results = list.map((r) => r.result || {});
  const sum = (a) => a.reduce((x, y) => x + y, 0);
  const scores = results.map((r) => (Number.isFinite(r.score) ? r.score : 0));
  const distances = results.map((r) => (Number.isFinite(r.distance) ? r.distance : 0));
  const crashes = results.filter((r) => r.crashed === true).length;
  const ttis = stats.map((s) => s.timeToFirstInputMs).filter((v) => Number.isFinite(v));
  return {
    canaries: n,
    crashes,
    crashRate: crashes / n,
    meanScore: r6(sum(scores) / n),
    minScore: Math.min(...scores),
    maxScore: Math.max(...scores),
    meanDistance: r6(sum(distances) / n),
    meanTicks: r6(sum(stats.map((s) => s.ticks)) / n),
    meanTotalSimMs: r6(sum(stats.map((s) => s.totalSimMs)) / n),
    meanInputChanges: r6(sum(stats.map((s) => s.inputChanges)) / n),
    meanAirborneTicks: r6(sum(stats.map((s) => s.airborneTicks)) / n),
    meanTimeToFirstInputMs: ttis.length ? r6(sum(ttis) / ttis.length) : 0,
  };
}

module.exports = {
  CHECKPOINT_FIELDS,
  NUMERIC_FIELDS,
  DEFAULT_EPSILON,
  STATUS,
  normalizeCheckpoint,
  compareCheckpoints,
  allCheckpointDivergences,
  compareOutcome,
  normalizeStats,
  partsOf,
  validateExpected,
  classifyRun,
  sameSimVersion,
  aggregateStats,
};
