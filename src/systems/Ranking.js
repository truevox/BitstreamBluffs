/**
 * OWNER: progression engineer. The ONE place that decides whether a modded (boosted) run may rank.
 *
 * Spec W4 requires every ranking decision to route through a single helper that reads
 * `MODDED_RUNS_RANKED`, and that grep shows no other place deciding whether a modded run counts. A run
 * with a boost is a different game — Head Start literally moves the start line — so while the constant is
 * false a boosted run must not enter the clean top-10, seed best, daily best or streak. It still earns
 * Resonance, Data Shards and mission progress: the boosts are not a penalty, they are a separate board.
 *
 * Why a module and not a condition at each call site: this was the one piece of W4 that review could not
 * verify behaviourally. Five inline `!rec.modded` checks pass every test and still mean that turning the
 * constant on requires finding all five, and that a sixth ranking surface added later silently defaults
 * to excluding modded runs. tests/src/modded-ranking.test.js greps the tree to keep it to one place.
 *
 * Deliberately NOT here: `computeLedgerHash`. The hash is unchanged and `modded` is not part of it, so a
 * recorded run re-imported from a sharecode computes the same hash it always did.
 */
import { MODDED_RUNS_RANKED } from '../constants.js';

/**
 * Whether modded runs are allowed to rank right now.
 * @param {{ranked?:boolean}} [o] test override; production callers pass nothing and read the constant.
 * @returns {boolean}
 */
export function ranksModded(o) {
  if (o && typeof o.ranked === 'boolean') return o.ranked;
  return MODDED_RUNS_RANKED === true;
}

/**
 * Whether this record may appear on a CLEAN ranking surface (top-10, seed best, daily best, streak).
 *
 * A missing/unknown `modded` field means a pre-W4 record or an imported one, and those are clean by
 * definition: W4 is additive, and treating an absent field as modded would retroactively disqualify every
 * run a player has already set. `null`/non-object is not rankable at all, which keeps a junk record from
 * poisoning a board.
 * @param {Object} record
 * @param {{ranked?:boolean}} [o]
 * @returns {boolean}
 */
export function isRankable(record, o) {
  if (!record || typeof record !== 'object') return false;
  if (record.modded !== true) return true;
  return ranksModded(o);
}

/**
 * Whether this record belongs on the MODDED board.
 *
 * The complement of `isRankable`, and deliberately defined here rather than at the view: a modded tab that
 * filtered on `r.modded === true` itself would be the sixth scattered decision this module exists to
 * prevent, and would ignore the constant when it flips.
 * @param {Object} record
 * @param {{ranked?:boolean}} [o]
 * @returns {boolean}
 */
export function isModdedOnly(record, o) {
  if (!record || typeof record !== 'object') return false;
  if (record.modded !== true) return false;
  // When the constant is on, a modded run ranks on the CLEAN board too, so it does not also need a
  // separate listing to be discoverable.
  return !ranksModded(o);
}

/**
 * Filter a list of records down to the ones allowed on a clean surface. Callers use this instead of
 * hand-rolling the predicate, so the rule stays in one place even as surfaces are added.
 * @param {Array<Object>} records
 * @param {{ranked?:boolean}} [o]
 * @returns {Array<Object>}
 */
export function rankableOnly(records, o) {
  return (Array.isArray(records) ? records : []).filter((r) => isRankable(r, o));
}
