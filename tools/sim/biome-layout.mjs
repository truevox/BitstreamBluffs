#!/usr/bin/env node
/**
 * #65: print the biome / arcade-bridge layout the real generator builds, as runs of whole chunks.
 *
 *   node tools/sim/biome-layout.mjs [--seeds a,b,c] [--masks 0,2,6,2047] [--upto 6000]
 *
 * One line per run of same-biome chunks: seed, mask, 0-based sector of its start, start m, end m, biome
 * (`ARCADE` is a bridge). Pure and deterministic: the output depends only on seed, mask and --upto, so two
 * runs must be byte-identical.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { TerrainGenerator, SECTOR_M, HOME_BIOME_ID } from '../../src/systems/TerrainGenerator.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const readDir = (sub) => {
  const dir = path.join(root, 'src/data', sub);
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
};
const byId = (arr) => Object.fromEntries(arr.map((d) => [d.id, d]));
const content = {
  chunks: readDir('chunks'), hazards: byId(readDir('hazards')), powerups: byId(readDir('powerups')),
  terrainMods: byId(readDir('terrainMods')), biomes: Object.values(byId(readDir('biomes'))),
};

const arg = (name, dflt) => {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};
const seeds = arg('seeds', 'alpha,bitstream-bluffs,42,seed@mask0,2026-11-13').split(',');
const masks = arg('masks', '0,2,6,2047').split(',').map((m) => Number(m) >>> 0);
const upto = Number(arg('upto', 6000));

export function layout(seed, mask, uptoM = upto) {
  const gen = new TerrainGenerator({
    seed, chunkDefs: content.chunks, hazardDefs: content.hazards, powerupDefs: content.powerups,
    modDefs: content.terrainMods, biomeDefs: content.biomes, biomeMask: mask,
  });
  const runs = [];
  for (let i = 0; ; i++) {
    const c = gen.getChunk(i);
    const startM = c.startX / gen.ppm;
    if (startM >= uptoM) break;
    const biome = c.biome || 'ARCADE';
    const last = runs[runs.length - 1];
    if (last && last.biome === biome) last.endM = c.endX / gen.ppm;
    else runs.push({ biome, startM, endM: c.endX / gen.ppm, sector: Math.floor(startM / SECTOR_M) });
  }
  return runs;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  console.log(`# home biome ${HOME_BIOME_ID}, sector ${SECTOR_M} m, up to ${upto} m`);
  for (const seed of seeds) {
    for (const mask of masks) {
      for (const r of layout(seed, mask)) {
        console.log(`${seed}\tmask=${mask}\ts${r.sector}\t${r.startM.toFixed(0)}\t${r.endM.toFixed(0)}\t${r.biome}`);
      }
    }
  }
}
