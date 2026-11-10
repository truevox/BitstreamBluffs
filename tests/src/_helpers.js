// Shared test helpers (not a test file). Reads content JSON with fs (no Vite import.meta.glob under Jest).
import fs from 'fs';
import path from 'path';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator.js';

const dataDir = path.resolve('src/data');

export function readDir(sub) {
  const dir = path.join(dataDir, sub);
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
}

const byId = (arr) => Object.fromEntries(arr.map((d) => [d.id, d]));

export function loadContent() {
  return {
    chunks: readDir('chunks'),
    hazards: byId(readDir('hazards')),
    powerups: byId(readDir('powerups')),
    terrainMods: byId(readDir('terrainMods')),
  };
}

export function makeGen(seed = 'test-seed', overrides = {}) {
  const c = loadContent();
  return new TerrainGenerator({
    seed,
    chunkDefs: c.chunks,
    hazardDefs: c.hazards,
    powerupDefs: c.powerups,
    modDefs: c.terrainMods,
    ...overrides,
  });
}

export const segAngle = (p, i) => (Math.atan2(p[i + 1].y - p[i].y, p[i + 1].x - p[i].x) * 180) / Math.PI;
export const inGap = (chunk, i) =>
  chunk.gaps.some((g) => chunk.points[i].x >= g.x0 && chunk.points[i + 1].x <= g.x1);
