/**
 * Issue #130 (narrow slice) — the capture guard, kept pure so it can be tested without a browser.
 *
 * WHY THIS EXISTS
 * The tool reads the captured tape from the game registry (`REG.LAST_GHOST_TAPE`), which the shipped
 * `RunScene._saveGhostTape` sets when a run *ends*. A harness capture that stops at its own cap (`timeout`)
 * never finalises a tape, so the registry still holds whatever the PREVIOUS seed wrote. Reading it
 * unconditionally means one seed is silently measured against another seed's inputs — the run looks fine, the
 * numbers look fine, and they belong to the wrong course.
 *
 * Observed before this guard existed: seed `sim-06` captured 2024 m / score 4656, but the tape it measured was
 * `sim-04`'s (1033.5 m / score 1799), producing two seeds with byte-identical replay rows.
 *
 * The guard is therefore an identity check on the tape the registry handed back, plus an explicit clear before
 * each capture so a stale tape can never be mistaken for a fresh one.
 */

/** Thrown when the registry does not hand back the tape the current seed just produced. */
export class CaptureTapeError extends Error {
  constructor(message, detail = {}) {
    super(message);
    this.name = 'CaptureTapeError';
    this.detail = detail;
  }
}

/**
 * Accept only the tape belonging to `seed`, recorded under `rule`.
 *
 * Refuses, with a named reason, when:
 *   `missing`        nothing was registered at all
 *   `seed-mismatch`  the registry returned another seed's tape (the stale-tape bug)
 *   `rule-mismatch`  the tape's rule is not the rule the capture ran under, so it would replay something else
 *
 * @param {object|null|undefined} tape the tape the registry returned
 * @param {{ seed: string, rule: string }} expect
 * @returns {object} the same tape, when it is provably the right one
 */
export function assertCaptureTape(tape, { seed, rule }) {
  if (!tape || typeof tape !== 'object') {
    throw new CaptureTapeError(
      `the capture produced no ghost tape for seed "${seed}": the run ended before the tape finalised (a capture that hits its own cap does not save one)`,
      { reason: 'missing', seed },
    );
  }
  if (tape.seed !== seed) {
    throw new CaptureTapeError(
      `the registry returned a tape for seed "${tape.seed}", not "${seed}": a capture that never finalised left the previous seed's tape in place`,
      { reason: 'seed-mismatch', seed, tapeSeed: tape.seed },
    );
  }
  const want = rule === 'none' ? 'none' : rule;
  if (tape.dailyRuleId !== want) {
    throw new CaptureTapeError(
      `the capture recorded rule "${tape.dailyRuleId}", not "${want}": its tape would replay a different rule`,
      { reason: 'rule-mismatch', seed, rule: tape.dailyRuleId, want },
    );
  }
  return tape;
}
