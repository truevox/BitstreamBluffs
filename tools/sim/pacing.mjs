#!/usr/bin/env node
/**
 * Measures the W1 pacing targets from REAL simulated runs (tools/sim/run.mjs, handsOff policy).
 * XP is computed with the shipped xpForRun/levelForXp, so this is the real curve, not a model.
 *
 *   node tools/sim/pacing.mjs [--seeds 24] [--maxM 3000]
 *
 * Reports: runs-to-level-2 for a new player, and minutes of play to the first biome unlock.
 */
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);
const args = { seeds: 24, maxM: 3000, maxSec: 240, policy: 'handsOff' };
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, '')] = process.argv[i + 1];
const seeds = Number(args.seeds);
const LEVELS = JSON.parse(readFileSync(path.join(root, 'src/data/progression/levels.json'), 'utf8'));
const { xpForRun, levelForXp } = await import(path.join(root, 'src/systems/Progression.js'));
const { chromium } = require('playwright');

const port = await new Promise((res) => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); });
const outDir = path.join(root, 'tools/sim/.pacing');
mkdirSync(outDir, { recursive: true });
const outJson = path.join(outDir, 'runs.json');

// Reuse the real sim harness: it writes one record per seed.
await new Promise((res, rej) => {
  const p = spawn(process.execPath, [
    path.join(here, 'run.mjs'), '--seeds', String(seeds), '--policy', String(args.policy),
    '--maxM', String(args.maxM), '--maxSec', String(args.maxSec), '--workers', '4', '--out', outJson,
  ], { cwd: root, stdio: 'inherit' });
  p.on('exit', (c) => (c === 0 ? res() : rej(new Error(`run.mjs exit ${c}`))));
});

const data = JSON.parse(readFileSync(outJson, 'utf8'));
// The sim reports distances/times, not a RunRecord. Build the record fields xpForRun reads, using the
// game's own scoring constant (SCORING.pointsPerMeter = 1), so XP reflects a real hands-off run.
const SCORING_PPM = 1;
const runs = (Array.isArray(data) ? data : data.results || data.runs || [])
  .filter((r) => r && r.distM > 0)
  .map((r) => ({
    distanceM: r.distM,
    durationMs: Math.round((r.simSec || 0) * 1000),
    score: Math.round(r.distM * SCORING_PPM),
    tricks: {},
    shards: 0,
    nearMisses: 0,
    maxAirtimeMs: Math.round(((r.landings || []).reduce((a, l) => Math.max(a, l.airtimeMs || 0), 0))),
  }));
if (!runs.length) { console.error('no runs in', outJson, Object.keys(data || {})); process.exit(1); }

// New player: runs are played in order; find when level 2 is reached.
let xp = 0;
let level2At = null;
const levelsSeen = [];
runs.forEach((r, i) => {
  const before = levelForXp(xp, LEVELS);
  xp += xpForRun(r).total;
  const after = levelForXp(xp, LEVELS);
  levelsSeen.push({ run: i + 1, xpTotal: xp, level: after, min: +(r.durationMs / 60000).toFixed(2) });
  if (!level2At && after >= 2) level2At = i + 1;
});

// First biome (level 4) time-to-unlock: play runs in a loop until the threshold is crossed.
const firstBiomeLevel = (LEVELS.levels.find((l) => l.biome) || {}).level || 4;
const biomeXp = (LEVELS.levels.find((l) => l.level === firstBiomeLevel) || {}).xpMin || 0;
let accXp = 0;
let accMs = 0;
let runsToBiome = 0;
let i = 0;
while (accXp < biomeXp && runsToBiome < 500) {
  const r = runs[i % runs.length];
  accXp += xpForRun(r).total;
  accMs += r.durationMs || 0;
  runsToBiome += 1;
  i += 1;
}

const avg = (k) => runs.reduce((a, r) => a + (Number(r[k]) || 0), 0) / runs.length;
const report = {
  seeds,
  policy: String(args.policy),
  runs: runs.length,
  avgDistanceM: Math.round(avg('distanceM')),
  avgScore: Math.round(avg('score')),
  avgRunMin: +(avg('durationMs') / 60000).toFixed(2),
  avgXpPerRun: Math.round(runs.reduce((a, r) => a + xpForRun(r).total, 0) / runs.length),
  runsToLevel2: level2At,
  minutesToLevel2: level2At ? +(levelsSeen[level2At - 1].min).toFixed(2) : null,
  firstBiomeLevel,
  firstBiomeXp: biomeXp,
  runsToFirstBiome: runsToBiome,
  minutesToFirstBiome: +(accMs / 60000).toFixed(1),
  targets: {
    level2WithinRuns: 3,
    firstBiomeMinutes: 20,
    levelCap: LEVELS.cap,
    biomes: LEVELS.biomeOrder.length,
  },
};
writeFileSync(path.join(outDir, 'pacing.json'), JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
process.exit(0);
