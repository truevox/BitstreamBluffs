/**
 * Scoreboard helpers keyed on `rulesetId` (Replay Contract v1, section 7.5; issue #123). Pure: no Phaser, no clock, no
 * randomness, no storage. Nothing here touches RunRecord, the SaveStore ledger hashes (V1-V4) or sanitizeRun: wiring a
 * rulesetId into the local ledger would need a V5 hash and is an owner decision (open question Q7).
 *
 * Rules enforced:
 * - A board key always contains a `rulesetId` (never null: legacy outcomes are not eligible for any ruleset board).
 * - Only a `match` outcome, produced by a named verifier under a named ruleset, may appear on a board.
 * - Entries of different rulesets are never merged implicitly. A board that spans rulesets must be built with an explicit
 *   cross-ruleset call, whose result is a different kind of object (`kind: 'cross-ruleset'`).
 * - Historical validity and current eligibility are separate fields.
 */
import { canonicalize } from './canonicalJson.js';
import { RULESET_ID_RE } from './ruleset.js';
import { RulesetRegistryError } from './rulesetRegistry.js';

export class RulesetMixError extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'RulesetMixError';
    this.code = 'ruleset-mix';
  }
}

const isId = (s) => typeof s === 'string' && RULESET_ID_RE.test(s);

/**
 * Stable key of one scoreboard: canonical JSON text of `{format, rulesetId, lane, biomeMask, seed}`.
 * @param {{rulesetId:string, lane:string, biomeMask:number, seed?:(string|null)}} parts `lane` is the existing mode
 *        string (`normal`/`daily`/`daily-draft`), `seed` null for boards that span seeds.
 * @returns {string}
 */
export function scoreboardKey({ rulesetId, lane, biomeMask, seed = null }) {
  if (!isId(rulesetId)) throw new RulesetRegistryError('bad-scoreboard-key', 'rulesetId must be sha256:<hex> (legacy/null runs have no board)');
  if (typeof lane !== 'string' || !lane) throw new RulesetRegistryError('bad-scoreboard-key', 'lane required');
  if (!Number.isSafeInteger(biomeMask) || biomeMask < 0) throw new RulesetRegistryError('bad-scoreboard-key', 'biomeMask must be a non-negative integer');
  if (seed !== null && typeof seed !== 'string') throw new RulesetRegistryError('bad-scoreboard-key', 'seed must be a string or null');
  return canonicalize({ format: 'bb-board-key', rulesetId, lane, biomeMask, seed });
}

/** Why an outcome record may not be placed on any ruleset board, or null when it may. */
export function ineligibleReason(record) {
  if (!record || typeof record !== 'object') return 'not-a-record';
  if (record.outcome === 'consistent-with' || record.outcome === 'inconclusive-legacy') return 'legacy-outcome';
  if (record.outcome === 'refused') return 'refused';
  if (record.outcome === 'diverged') return 'diverged';
  if (record.outcome !== 'match') return 'unknown-outcome';
  if (!isId(record.verifiedUnder)) return 'no-ruleset';
  return null;
}

/**
 * Split entries by the ruleset each was verified under. Never merges. Entries are `{record, ...anything}`.
 * @param {Array<{record:Object}>} entries
 * @param {string} [currentRulesetId] when given, each partition reports `currentlyEligible`.
 * @returns {{boards: Map<string, {rulesetId:string, historicallyValid:true, currentlyEligible:(boolean|null), entries:Array}>, ineligible:Array<{entry:Object, reason:string}>}}
 */
export function partitionByRuleset(entries, currentRulesetId = null) {
  const boards = new Map();
  const ineligible = [];
  for (const entry of entries) {
    const reason = ineligibleReason(entry && entry.record);
    if (reason) {
      ineligible.push({ entry, reason });
      continue;
    }
    const id = entry.record.verifiedUnder;
    if (!boards.has(id)) boards.set(id, { rulesetId: id, historicallyValid: true, currentlyEligible: currentRulesetId === null ? null : id === currentRulesetId, entries: [] });
    boards.get(id).entries.push(entry);
  }
  return { boards, ineligible };
}

/** The entries a board for `rulesetId` may show: exactly those verified under it. */
export function boardEntries(entries, rulesetId) {
  if (!isId(rulesetId)) throw new RulesetRegistryError('bad-scoreboard-key', 'rulesetId must be sha256:<hex>');
  const p = partitionByRuleset(entries).boards.get(rulesetId);
  return p ? p.entries : [];
}

/** Throws RulesetMixError unless every entry is eligible and verified under one and the same ruleset. Returns that id (null for no entries). */
export function assertSingleRuleset(entries) {
  const { boards, ineligible } = partitionByRuleset(entries);
  if (ineligible.length) throw new RulesetMixError(`board input contains an ineligible entry (${ineligible[0].reason})`);
  if (boards.size > 1) throw new RulesetMixError(`board input mixes rulesets: ${[...boards.keys()].sort().join(', ')}`);
  return boards.size ? [...boards.keys()][0] : null;
}

/**
 * Explicit cross-ruleset view (a history board). The caller must opt in; every entry keeps its own `rulesetId` and the
 * result's `kind` says it spans rulesets, so it cannot be mistaken for a current board.
 * @param {Array<{record:Object}>} entries
 * @param {{crossRuleset:true, currentRulesetId?:string}} opts
 */
export function crossRulesetView(entries, opts) {
  if (!opts || opts.crossRuleset !== true) throw new RulesetMixError('a board spanning rulesets must be requested with {crossRuleset: true}');
  const { boards } = partitionByRuleset(entries, opts.currentRulesetId || null);
  const rows = [];
  for (const id of [...boards.keys()].sort()) {
    const b = boards.get(id);
    for (const entry of b.entries) rows.push({ rulesetId: id, historicallyValid: true, currentlyEligible: b.currentlyEligible, entry });
  }
  return Object.freeze({ kind: 'cross-ruleset', rulesetIds: Object.freeze([...boards.keys()].sort()), rows: Object.freeze(rows) });
}
