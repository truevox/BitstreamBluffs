/**
 * #82: local analytics over a bounded, caller-selected SaveStore history.
 * This module has no persistence, scene, or standing-update side effects.
 */
import { countsForDailyBest, countsForDraftDailyBest, isModdedOnly, isRankable } from './Ranking.js';
import { BOOSTS } from './Boosts.js';
import { activeUpgradeRanks } from './PermanentUpgrades.js';
import {
  DRAFT_LEDGER_HASH_V, INITIALS_MIN, LEDGER_HASH_V, UPGRADE_LEDGER_HASH_V,
  normalizeInitials, verifyLedgerHash,
} from './SaveStore.js';

export const MAX_LOCAL_RANKING_RECORDS = 1000;
const boards = ['clean', 'modded', 'daily-classic', 'daily-draft'];
const ledgerVersions = [LEDGER_HASH_V, UPGRADE_LEDGER_HASH_V, DRAFT_LEDGER_HASH_V];
const metricUnits = Object.freeze({
  distanceM: 'm',
  score: 'points',
  averageProgressMps: 'm/s',
  trickVariety: 'types',
  efficiencyPointsPerM: 'points/m',
  maxAirtimeMs: 'ms',
  survivalMs: 'ms',
});
const metricKeys = Object.keys(metricUnits);

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const nonnegative = (value) => Number.isFinite(value) && value >= 0;
const isMask = (value) => Number.isInteger(value) && value >= 0 && value <= 0xffffffff;
const nonempty = (value) => typeof value === 'string' && value.trim().length > 0;
const byId = (a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
const canonicalZero = (value) => value === 0 ? 0 : value;

function loadoutOf({ boosts, upgradeRanks }) {
  if (boosts !== undefined && (!Array.isArray(boosts) || ![...boosts].every((id) => BOOSTS.includes(id)))) return null;
  if (upgradeRanks !== undefined && !isObject(upgradeRanks)) return null;
  const ranks = activeUpgradeRanks(upgradeRanks);
  // Do not silently treat malformed, future, or inactive values as a known loadout.
  if (upgradeRanks && Object.entries(upgradeRanks).some(([id, rank]) => !Object.hasOwn(ranks, id) || ranks[id] !== rank)) return null;
  return { boosts: [...new Set(boosts ?? [])].sort(), upgradeRanks: ranks };
}

function boardOf(record) {
  if (countsForDraftDailyBest(record)) return 'daily-draft';
  if (countsForDailyBest(record)) return 'daily-classic';
  // An invalid Official Daily stamp isn't evidence of an ordinary practice run.
  if (record.dailyOfficial === true) return null;
  if (isModdedOnly(record)) return 'modded';
  if (isRankable(record)) return 'clean';
  return null;
}

function scopeOf(board, seed, biomeMask, dailyRuleId, loadout) {
  return { board, seed, biomeMask, dailyRuleId, ...loadout };
}

function ratio(a, b, scale = 1) {
  const value = b > 0 ? (a / b) * scale : NaN;
  return Number.isFinite(value) ? canonicalZero(value) : null;
}

function candidateOf(record, { includeUnenteredLocalRuns = false } = {}) {
  if (!isObject(record) || !ledgerVersions.includes(record.hashV) ||
      !nonempty(record.id) || !nonempty(record.seed) || !nonempty(record.dailyRuleId) ||
      !isMask(record.biomeMask ?? 0) || record.imported === true ||
      (!includeUnenteredLocalRuns && normalizeInitials(record.initials).length < INITIALS_MIN) ||
      record.cause !== 'crash' ||
      ![record.distanceM, record.score, record.durationMs, record.maxAirtimeMs].every(nonnegative) ||
      !isObject(record.tricks) || !Object.values(record.tricks).every(nonnegative)) return null;
  if (record.biomeMask === null ||
      (record.dailyOfficial !== undefined && typeof record.dailyOfficial !== 'boolean')) return null;

  const loadout = loadoutOf(record);
  // Permanent upgrade ranks weren't committed by v2, so don't infer them there.
  if (!loadout || (record.hashV === LEDGER_HASH_V && Object.keys(loadout.upgradeRanks).length) ||
      !verifyLedgerHash(record)) return null;
  const board = boardOf(record);
  if (!board) return null;
  const hasAppliedLoadout = loadout.boosts.length > 0 || Object.keys(loadout.upgradeRanks).length > 0;
  // Only compare known loadouts. A hash-consistent but contradictory record
  // must not enter a clean cohort, or be treated as an empty modded loadout.
  if ((board === 'clean' || board === 'daily-classic') && hasAppliedLoadout) return null;
  if (board === 'modded' && !hasAppliedLoadout) return null;

  const scope = scopeOf(board, record.seed, record.biomeMask ?? 0, record.dailyRuleId, loadout);
  const scopeKey = JSON.stringify(scope);
  const values = {
    distanceM: canonicalZero(record.distanceM),
    score: canonicalZero(record.score),
    // Divide the stored values first, then scale: separately rounding a
    // scaled operand can split otherwise equal physical ratios.
    averageProgressMps: ratio(record.distanceM, record.durationMs, 1000),
    trickVariety: Object.values(record.tricks).filter((count) => count > 0).length,
    efficiencyPointsPerM: ratio(record.score, record.distanceM),
    maxAirtimeMs: canonicalZero(record.maxAirtimeMs),
    // Zero can mean an unavailable historical duration after store normalization.
    survivalMs: record.durationMs > 0 ? record.durationMs : null,
  };
  return {
    id: record.id, scopeKey, values,
    signature: JSON.stringify([record.hashV, record.ledgerHash, scopeKey, values]),
  };
}

/** Exact stored-run cohort, using the same canonical validation as the
 * calculator. The default requires initials (the existing local board
 * contract); `includeUnenteredLocalRuns` is for private read-only history
 * presentation ONLY, and does not grant official leaderboard eligibility.
 * A local ledger hash is not proof of human play. */
export function localRankingSelectionForRecord(record, options = {}) {
  const candidate = candidateOf(record, options);
  return candidate ? JSON.parse(candidate.scopeKey) : null;
}

function localCohort(history, scopeKey, options = {}) {
  const byRun = new Map();
  const conflicts = new Set();
  for (const record of history) {
    const candidate = candidateOf(record, options);
    if (!candidate) continue;
    const prior = byRun.get(candidate.id);
    if (!prior) byRun.set(candidate.id, candidate);
    else if (prior.signature !== candidate.signature) conflicts.add(candidate.id);
  }
  // Resolve identity collisions before applying the cohort filter.
  return [...byRun.values()].filter((row) => !conflicts.has(row.id) && row.scopeKey === scopeKey).sort(byId);
}

function percentileRanks(rows, metric) {
  const available = rows.filter((row) => row.values[metric] !== null)
    .sort((a, b) => a.values[metric] - b.values[metric]);
  const n = available.length;
  if (n < 2) return n;
  for (let start = 0; start < n;) {
    let end = start + 1;
    while (end < n && available[end].values[metric] === available[start].values[metric]) end++;
    const midrank = 100 * (start + (end - start) / 2) / n;
    for (let i = start; i < end; i++) available[i].percentiles[metric] = midrank;
    start = end;
  }
  return n;
}

function dominates(a, b) {
  let better = false;
  for (const key of metricKeys) {
    if (a.values[key] < b.values[key]) return false;
    if (a.values[key] > b.values[key]) better = true;
  }
  return better;
}

/**
 * Analyze one explicit board/course/rule/loadout cohort from a recent history
 * obtained with SaveStore.getRecentRuns(limit). Same score does not imply
 * same result; rows are ordered by run ID, not official board placement.
 * @param {Array<object>} history current SaveStore history snapshot
 * @param {{board:string, seed:string, biomeMask:number, dailyRuleId:string,
 *   boosts?:string[], upgradeRanks?:Object<string,number>}} selection exact cohort
 * @param {{includeUnenteredLocalRuns?:boolean}} [options] private local history only; default preserves initials-gated board
 */
export function calculateLocalRankings(history, selection, options = {}) {
  if (!Array.isArray(history)) throw new TypeError('Local ranking history must be an array');
  if (history.length > MAX_LOCAL_RANKING_RECORDS) {
    throw new RangeError(`Local ranking history is limited to ${MAX_LOCAL_RANKING_RECORDS} records`);
  }
  if (!isObject(selection) || !boards.includes(selection.board) || !nonempty(selection.seed) ||
      !isMask(selection.biomeMask) || !nonempty(selection.dailyRuleId)) {
    throw new TypeError('Select one explicit board, seed, biome mask, and movement rule');
  }
  const loadout = loadoutOf(selection);
  if (!loadout) throw new TypeError('Invalid local ranking loadout');
  const cohort = scopeOf(selection.board, selection.seed, selection.biomeMask, selection.dailyRuleId, loadout);
  const rows = localCohort(history, JSON.stringify(cohort), options).map(({ id, values }) => ({
    id, values,
    percentiles: Object.fromEntries(metricKeys.map((key) => [key, null])),
    pareto: null,
  }));

  const metrics = Object.fromEntries(metricKeys.map((key) => [
    key, { unit: metricUnits[key], sampleSize: percentileRanks(rows, key) },
  ]));
  const complete = rows.filter((row) => metricKeys.every((key) => row.values[key] !== null));
  for (const row of complete) {
    row.pareto = complete.some((other) => dominates(other, row)) ? 'dominated' : 'nondominated';
  }

  return {
    cohort, historySize: history.length, sampleSize: rows.length, metrics, rows,
    frontierSampleSize: complete.length,
    frontierIds: complete.filter((row) => row.pareto === 'nondominated').map((row) => row.id),
  };
}
