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
 * Deliberately NOT here: `computeLedgerHash`. Hashing is integrity, not ranking. Since decision 6 the v2
 * hash covers `modded` (so a sharecode cannot strip it), but WHETHER a modded run ranks is still decided
 * only here.
 *
 * Decisions 1 and 2 (2026-11-14) add the other ranking rule: which runs are OFFICIAL Daily runs
 * (isOfficialDaily). Daily best and the streak count only those.
 */
import { MODDED_RUNS_RANKED } from '../constants.js';
import { DailyPatch } from './DailyPatch.js';

/**
 * Whether this record plays on the MODDED board rather than the clean one.
 *
 * This exists so a view can label the board it is showing without testing the field itself. Game Over needs
 * the answer twice — which board to load, and whether to say MODDED - UNRANKED instead of announcing a seed
 * best — and both are ranking decisions, so both belong here rather than in the scene.
 *
 * @param {{modded?:boolean}} record
 * @param {{ranked?:boolean}} [o] test override
 * @returns {boolean}
 */
export function boardsModded(record, o) {
  if (!record || typeof record !== 'object') return false;
  if (record.modded !== true) return false;
  return !ranksModded(o);
}

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

/**
 * A predicate for "on the same board as this record": the modded board when `record` boards modded,
 * otherwise the clean board. A run's in-world BEST marker and its NEW BEST chase the best on the board the
 * run itself will land on, the same split Game Over makes when it picks which list to compare against.
 *
 * While MODDED_RUNS_RANKED is false a clean run never chases a boosted distance and a boosted run chases
 * the modded runs. When the constant is on, every run is on the one clean board.
 * @param {{modded?:boolean}} record the run being played (any object carrying the loadout's `modded`)
 * @param {{ranked?:boolean}} [o]
 * @returns {(r:Object) => boolean}
 */
export function sameBoardAs(record, o) {
  return boardsModded(record, o) ? (r) => isModdedOnly(r, o) : (r) => isRankable(r, o);
}

/**
 * Decision 2: whether this record is an OFFICIAL Daily run. Only a run started from the DAILY RUN menu
 * item is official; a typed `daily-YYYY-MM-DD[@mask]` seed is a practice run.
 *
 *  - The seed must be a daily seed, and the record must have been played on THAT date's mask and rule.
 *    Official runs are on them by construction; the explicit check keeps a mis-stamped record out.
 *  - A v2 record (`hashV` 2, written since decision 6) is official only when `dailyOfficial === true`.
 *    This matters most for a typed `daily-<today>` with no suffix: it plays today's mask AND today's rule,
 *    so it is indistinguishable from a legacy official run by mask and rule alone.
 *  - A legacy record (no `hashV`) has no flag. It counts as official when its mask (absent = 0) and its
 *    `dailyRuleId` are the date's. That keeps the history of real Daily runs and drops typed runs that
 *    used a different mask.
 * @param {Object} record
 * @returns {boolean}
 */
export function isOfficialDaily(record) {
  if (!record || typeof record !== 'object') return false;
  const key = DailyPatch.dateKeyFromSeed(record.seed);
  if (!key) return false;
  const info = DailyPatch.infoForDateKey(key);
  if (!info) return false;
  if (((Number(record.biomeMask) >>> 0) || 0) !== info.biomeMask) return false;
  if (record.dailyRuleId !== info.rule.id) return false;
  const versioned = Number.isFinite(record.hashV) && record.hashV >= 2;
  return versioned ? record.dailyOfficial === true : true;
}

/**
 * Decision 1: whether this record may set a Daily best (TODAY'S BEST on Title and Game Over). An
 * official Daily run that is allowed on a clean surface.
 * @param {Object} record @param {{ranked?:boolean}} [o]
 * @returns {boolean}
 */
export function countsForDailyBest(record, o) {
  return isRankable(record, o) && isOfficialDaily(record);
}

/**
 * Decision 1: whether this record holds a day of the Daily streak. Official, clean, and played on THIS
 * device: an imported run (`imported: true`, set by SaveStore.importSharecode) never extends the streak.
 * @param {Object} record @param {{ranked?:boolean}} [o]
 * @returns {boolean}
 */
export function countsForStreak(record, o) {
  return countsForDailyBest(record, o) && record.imported !== true;
}
