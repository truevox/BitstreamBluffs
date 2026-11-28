/** Read-only presentation of a locally validated run cohort (#82). */
import { calculateLocalRankings, localRankingSelectionForRecord } from './local-rankings.js';

export const LOCAL_RANK_METRICS = Object.freeze([
  ['distanceM', 'DISTANCE', 'M'],
  ['score', 'SCORE', 'PTS'],
  ['averageProgressMps', 'AVG SPEED', 'M/S'],
  ['trickVariety', 'TRICK TYPES', 'TYPES'],
  ['efficiencyPointsPerM', 'EFFICIENCY', 'PTS/M'],
  ['maxAirtimeMs', 'BEST AIR', 'MS'],
  ['survivalMs', 'SURVIVAL', 'MS'],
]);
const fmt = (number) => {
  if (number === null || !Number.isFinite(number)) return 'N/A';
  return (Math.abs(number) >= 10000 ? Math.round(number) : Number(number.toFixed(2))).toLocaleString('en-US');
};

export function presentLocalRunRankings(history, record) {
  const selection = localRankingSelectionForRecord(record);
  if (!selection) return { status: 'ineligible', message: 'RUN NOT ELIGIBLE FOR LOCAL COMPARISON' };
  const result = calculateLocalRankings(history, selection);
  const own = result.rows.find((row) => row.id === record.id);
  if (!own) return { status: 'not-saved', message: 'NO MATCHING HASH-VALID LOCAL HISTORY ENTRY' };
  return {
    status: 'ready', board: selection.board, seed: selection.seed, mask: selection.biomeMask,
    sampleSize: result.sampleSize, frontierSampleSize: result.frontierSampleSize,
    frontier: result.frontierSampleSize >= 2 ? own.pareto : null,
    metrics: LOCAL_RANK_METRICS.map(([key,label,unit]) => ({
      key, label, unit, value: fmt(own.values[key]),
      percentile: own.percentiles[key] === null ? 'N/A' : `${fmt(own.percentiles[key])}%`,
      sampleSize: result.metrics[key].sampleSize,
    })),
  };
}
