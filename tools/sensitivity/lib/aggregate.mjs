/**
 * Issue #130 (narrow slice) — aggregation for the input-timing sensitivity preflight, kept pure.
 *
 * WHAT THIS ANSWERS, AND WHAT IT REFUSES TO ANSWER
 * The question is narrow on purpose: *for this seed set, this action, and these fixed-tick offsets, did the
 * outcome change, and where did it change first?* A run that ends at the distance cap did not survive forever;
 * it was still going when the measurement stopped. Every such row is marked censored and is reported as
 * censored, never as a survival. Nothing here extrapolates past the offsets actually run, and nothing here
 * makes a fairness, balance or "unbounded" claim.
 *
 * WHY BIN RATES CARRY AN INTERVAL
 * With a dozen seeds a rate of 1.0 or 0.0 is indistinguishable from a small sample, and printing "100% of
 * offsets survived" invites exactly the overreach this issue warns about. Rates therefore carry a two-sided
 * Wilson score interval, and any bin below `SMALL_N` observations is flagged explicitly.
 */

/** Below this many observations a per-bin rate is reported with an explicit small-sample warning. */
export const SMALL_N = 12;
/** Two-sided z for a 95% interval. Fixed and documented so a re-run cannot silently change the interval. */
export const Z95 = 1.959963984540054;

/** Outcome classes. Deliberately coarse: each one is a fact about how the run ended, not a quality judgement. */
export const OUTCOMES = Object.freeze(['crash', 'stalled', 'censored', 'excluded']);

/**
 * Classify one replay record.
 *
 * `censored` is a run whose finite measurement window ended without crashing. In this CLI,
 * replay stops at the captured tape's horizon + 1200 fixed ticks, labeled `replay-window`;
 * `--maxM`/`--maxSec` limit capture, not replay. It is NOT a success.
 * `stalled` is a run the harness gave up on because the sled stopped making progress. `excluded` is a perturbation the tool refused to build (see `perturbTape`), and it is
 * carried in the row so the denominator is never quietly shrunk.
 *
 * CHECKPOINT DIVERGENCE (`desync`) is graded by arm, because it means opposite things on each one:
 *
 *  - On the control arm the tape is the unshifted replay of the capture, so its own checkpoints must match.
 *    Any divergence there means the harness is not reproducing the real run, and the row is excluded.
 *    That is `{ integrityRequired: true }`.
 *  - On a perturbed arm the checkpoints were recorded from the *unperturbed* trajectory by construction, so a
 *    shifted control diverges as soon as the change reaches the simulation. That divergence is the measurement
 *    itself. Excluding it would discard precisely the runs that show sensitivity and report a falsely quiet
 *    result, so the row keeps its own outcome class and carries the divergence tick as evidence.
 */
export function classifyOutcome({ endReason, desync }, { integrityRequired = false } = {}) {
  if (desync && integrityRequired) return 'excluded';
  if (endReason === 'maxM' || endReason === 'timeout' || endReason === 'replay-window') return 'censored';
  if (endReason === 'stalled') return 'stalled';
  if (typeof endReason === 'string' && endReason.startsWith('crash:')) return 'crash';
  return 'excluded';
}

/** Wilson score interval for `k` successes out of `n`. Returns `[lo, hi]` in [0, 1]; null when n is 0. */
export function wilson(k, n, z = Z95) {
  if (!Number.isSafeInteger(n) || n < 0) throw new TypeError('n must be a nonnegative integer');
  if (!Number.isSafeInteger(k) || k < 0 || k > n) throw new TypeError('k must be an integer in [0, n]');
  if (n === 0) return null;
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

const r4 = (v) => (v == null ? null : Math.round(v * 10000) / 10000);

/**
 * Group rows into offset bins and report, per bin: how many observations exist, how many were excluded
 * before running, and the share that crashed with its interval.
 *
 * `crashed` counts only rows that actually crashed. Censored and stalled rows stay in `n` (they were run and
 * they did not crash) so the rate cannot be inflated by dropping the awkward rows.
 */
export function binOffsets(rows) {
  const byOffset = new Map();
  for (const row of rows) {
    const key = String(row.offset);
    if (!byOffset.has(key)) byOffset.set(key, []);
    byOffset.get(key).push(row);
  }
  return [...byOffset.entries()]
    .map(([key, group]) => {
      const run = group.filter((r) => r.outcome !== 'excluded');
      const crashed = run.filter((r) => r.outcome === 'crash').length;
      const censored = run.filter((r) => r.outcome === 'censored').length;
      const stalled = run.filter((r) => r.outcome === 'stalled').length;
      const interval = wilson(crashed, run.length);
      return {
        offset: Number(key),
        observations: run.length,
        excluded: group.length - run.length,
        crashed, censored, stalled,
        crashRate: run.length ? r4(crashed / run.length) : null,
        crashRateCi95: interval ? [r4(interval[0]), r4(interval[1])] : null,
        smallSample: run.length < SMALL_N,
      };
    })
    .sort((a, b) => a.offset - b.offset);
}

/**
 * Paired comparison of every non-zero offset against the offset-0 control **on the same seed**.
 *
 * Pairing matters: seeds differ enormously in how far a run gets, so an unpaired comparison of offsets would
 * mostly measure which seeds happened to be in which bin. Only seeds present in both arms are compared, and a
 * seed that is missing from either arm is named rather than dropped silently.
 *
 * `changed` means the two runs ended differently in a way a player would notice: a different outcome class, a
 * different crash cause, or a materially different distance/score. The tolerances are stated, not tuned.
 */
export const PAIR_TOLERANCE = Object.freeze({ distanceM: 0.5, score: 0 });

export function pairedAgainstControl(rows, { tolerance = PAIR_TOLERANCE } = {}) {
  const control = new Map();
  for (const row of rows) {
    if (row.offset !== 0 || row.outcome === 'excluded') continue;
    if (!control.has(row.seed)) control.set(row.seed, row);
  }
  const offsets = [...new Set(rows.map((r) => r.offset))].filter((o) => o !== 0).sort((a, b) => a - b);
  return offsets.map((offset) => {
    const arm = new Map();
    for (const row of rows) {
      if (row.offset !== offset || row.outcome === 'excluded') continue;
      if (!arm.has(row.seed)) arm.set(row.seed, row);
    }
    const pairs = [];
    const missingControl = [];
    const missingArm = [];
    for (const [seed, base] of control) {
      const other = arm.get(seed);
      if (!other) { missingArm.push(seed); continue; }
      pairs.push({ seed, base, other });
    }
    for (const seed of arm.keys()) if (!control.has(seed)) missingControl.push(seed);

    const changed = pairs.filter(({ base, other }) => {
      if (base.outcome !== other.outcome) return true;
      if (base.crashCause !== other.crashCause) return true;
      if (base.distanceM == null || other.distanceM == null) return false;
      if (Math.abs(base.distanceM - other.distanceM) > tolerance.distanceM) return true;
      return Math.abs((base.score ?? 0) - (other.score ?? 0)) > tolerance.score;
    });
    const interval = wilson(changed.length, pairs.length);
    return {
      offset,
      paired: pairs.length,
      changed: changed.length,
      changedRate: pairs.length ? r4(changed.length / pairs.length) : null,
      changedRateCi95: interval ? [r4(interval[0]), r4(interval[1])] : null,
      smallSample: pairs.length < SMALL_N,
      changedSeeds: changed.map((p) => p.seed).sort(),
      missingControl: missingControl.sort(),
      missingArm: missingArm.sort(),
    };
  });
}

/**
 * Name the smallest |offset| at which *every* paired seed changed, or the smallest at which *any* seed changed.
 *
 * A "sensitive boundary" is reported only when it is an exact observation: an offset that was actually run,
 * on a seed set that was actually paired. It is not interpolated between offsets and it is never reported as
 * the boundary of the game.
 */
export function sensitiveBoundary(comparisons) {
  const all = comparisons.filter((c) => c.paired > 0).sort((a, b) => Math.abs(a.offset) - Math.abs(b.offset));
  const everySeed = all.find((c) => c.changed === c.paired);
  const anySeed = all.find((c) => c.changed > 0);
  return {
    allSeedsChangedAtOffset: everySeed ? everySeed.offset : null,
    anySeedChangedAtOffset: anySeed ? anySeed.offset : null,
    note: 'An exact observation on the seeds and offsets actually run. Not a boundary of the game, and not extrapolated to offsets that were not measured.',
  };
}

/**
 * Build the whole aggregate. `rows` are the per-(seed, offset) records the CLI measured.
 *
 * `censoring` is reported as its own count so a reader cannot mistake "did not crash in the window" for
 * "survived". `noExtrapolation` is a machine-readable statement that this aggregate covers only the offsets
 * present in `bins`, which the README and the report both repeat.
 */
export function aggregate(rows, { tolerance = PAIR_TOLERANCE, smallN = SMALL_N } = {}) {
  const bins = binOffsets(rows).map((b) => ({ ...b, smallSample: b.observations < smallN }));
  const comparisons = pairedAgainstControl(rows, { tolerance })
    .map((c) => ({ ...c, smallSample: c.paired < smallN }));
  const run = rows.filter((r) => r.outcome !== 'excluded');
  return {
    seeds: [...new Set(rows.map((r) => r.seed))].sort(),
    offsets: [...new Set(rows.map((r) => r.offset))].sort((a, b) => a - b),
    observations: rows.length,
    measured: run.length,
    excluded: rows.length - run.length,
    censoring: {
      censored: run.filter((r) => r.outcome === 'censored').length,
      stalled: run.filter((r) => r.outcome === 'stalled').length,
      note: 'A censored run reached the measurement cap without crashing. It did not survive: the window ended.',
    },
    smallSampleThreshold: smallN,
    bins,
    comparisons,
    boundary: sensitiveBoundary(comparisons),
    noExtrapolation: 'Results cover only the seeds and offsets listed here. No claim is made about other offsets, other seeds, live gameplay, fairness, balance, or unbounded survival.',
  };
}
