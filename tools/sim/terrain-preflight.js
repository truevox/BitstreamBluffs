/** #127: diagnostic seed geometry, not a gameplay simulation or fairness verdict. */
import { blindClearAheadPx, expectedSpeedPxS } from '../../src/systems/TerrainGenerator.js';

export const DEFAULT_ORIGIN_CHUNKS = 80;
export const MAX_ORIGIN_CHUNKS = 256;
export const MAX_ORIGIN_END = 4096;
const MAX_EXTRA_CHUNKS = 64;
const MAX_PAIRS = 4096;
const DEFAULT_BLIND_MS = 1200; // same fallback as blindClearAheadPx

const compareId = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const sortSpawn = (a, b) => a.worldXPx - b.worldXPx || a.chunkIndex - b.chunkIndex ||
  compareId(a.hazardId, b.hazardId) || a.worldYPx - b.worldYPx;

export function validateOriginWindow(fromChunk, chunkCount) {
  if (!Number.isSafeInteger(fromChunk) || fromChunk < 0 || !Number.isSafeInteger(chunkCount) ||
      chunkCount < 1 || chunkCount > MAX_ORIGIN_CHUNKS || fromChunk + chunkCount > MAX_ORIGIN_END) {
    throw new RangeError('Use 1–256 origin chunks and an exclusive end no greater than 4096');
  }
}

function firstDownstream(sorted, x) {
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = lo + Math.floor((hi - lo) / 2);
    if (sorted[mid].worldXPx <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function position(spawn, def, chunk, pxPerMeter) {
  return {
    hazardId: spawn.defId, chunkIndex: chunk.index, biome: chunk.biome ?? null,
    worldXPx: spawn.x, worldYPx: spawn.y, generatorDistanceM: spawn.x / pxPerMeter,
    placement: def.placement === 'air' ? 'air' : 'ground', motionKind: def.motion?.kind ?? null,
  };
}

/** Read origin chunks and enough downstream chunks to cover every reported blind window. */
export function scanBlindClearance(terrain, hazardDefs, { fromChunk = 0, chunkCount = DEFAULT_ORIGIN_CHUNKS } = {}) {
  validateOriginWindow(fromChunk, chunkCount);
  const { ppm, seed, biomeMask } = terrain;
  if (!Number.isFinite(ppm) || ppm <= 0) throw new RangeError('Expected a positive terrain scale');
  const endChunkExclusive = fromChunk + chunkCount;
  const origins = [], crashes = [];
  let furthest = -Infinity, coveredThroughX = null;
  function inspect(index, allowOrigins) {
    const chunk = terrain.getChunk(index);
    if (chunk.index !== index || !Number.isFinite(chunk.startX) || !Number.isFinite(chunk.endX) ||
        chunk.endX <= chunk.startX || (coveredThroughX !== null && chunk.startX !== coveredThroughX)) {
      throw new Error('Unexpected noncontiguous generated chunk geometry');
    }
    coveredThroughX = chunk.endX;
    for (const spawn of chunk.hazards) {
      if (!Object.hasOwn(hazardDefs, spawn.defId) || !Number.isFinite(spawn.x) || !Number.isFinite(spawn.y) ||
          spawn.x < chunk.startX || spawn.x > chunk.endX) throw new Error('Unexpected generated hazard geometry');
      const def = hazardDefs[spawn.defId];
      if (terrain.crashHazardIds.has(spawn.defId)) crashes.push(position(spawn, def, chunk, ppm));
      if (allowOrigins && def.onHit?.effect === 'blind') {
        const source = position(spawn, def, chunk, ppm);
        const clearAheadPx = blindClearAheadPx(def.onHit, source.generatorDistanceM);
        const blindDurationMs = Number.isFinite(def.onHit.durationMs) ? def.onHit.durationMs : DEFAULT_BLIND_MS;
        const nominalBlindAheadPx = expectedSpeedPxS(source.generatorDistanceM) * (blindDurationMs / 1000);
        if (!Number.isFinite(clearAheadPx) || clearAheadPx <= 0 || !Number.isFinite(nominalBlindAheadPx) || nominalBlindAheadPx < 0) {
          throw new Error('Unexpected blind window');
        }
        origins.push({ source, clearAheadPx, blindDurationMs, nominalBlindAheadPx });
        furthest = Math.max(furthest, source.worldXPx + clearAheadPx);
      }
    }
  }

  for (let i = fromChunk; i < endChunkExclusive; i++) inspect(i, true);
  const originThroughWorldXPx = coveredThroughX;
  let endInspectedChunkExclusive = endChunkExclusive;
  // The >= equality case keeps an inclusive target whose spawn center is on the next boundary.
  while (coveredThroughX <= furthest) {
    if (endInspectedChunkExclusive - endChunkExclusive >= MAX_EXTRA_CHUNKS) {
      throw new RangeError('Generated lookahead exceeded its safety bound');
    }
    inspect(endInspectedChunkExclusive++, false);
  }

  crashes.sort(sortSpawn);
  origins.sort((a, b) => sortSpawn(a.source, b.source));
  const findings = [];
  for (const origin of origins) {
    const { source, clearAheadPx, nominalBlindAheadPx } = origin;
    for (let i = firstDownstream(crashes, source.worldXPx); i < crashes.length; i++) {
      const target = crashes[i], separationPx = target.worldXPx - source.worldXPx;
      if (separationPx > clearAheadPx) break;
      if (findings.length >= MAX_PAIRS) throw new RangeError('Too many findings; choose a smaller origin window');
      findings.push({ ...origin, target, separationPx, separationM: separationPx / ppm,
        withinNominalBlind: separationPx <= nominalBlindAheadPx, crossChunk: source.chunkIndex !== target.chunkIndex });
    }
  }
  return {
    kind: 'local-terrain-preflight', version: 1,
    scope: 'spawn spacing only; not a gameplay, fairness, or reachability verdict',
    seed, biomeMask, pixelsPerMeter: ppm,
    originWindow: { fromChunk, chunkCount, endChunkExclusive, throughWorldXPx: originThroughWorldXPx },
    lookahead: { additionalChunks: endInspectedChunkExclusive - endChunkExclusive,
      endInspectedChunkExclusive, throughWorldXPx: coveredThroughX },
    blindSpawnCount: origins.length,
    findings,
  };
}
