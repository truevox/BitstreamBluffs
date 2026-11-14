// Negative control for W6: prove the six biome mods actually move the simulation.
// For each mod, run the deterministic sim with the mod active and with it neutralised, and compare
// the resulting run distance/score. If a mod is decorative, both numbers are identical.
import { execFileSync } from 'child_process';
import fs from 'fs';

const mods = ['lowGravity', 'sugarRush', 'bouncySpring', 'conveyorBelt', 'dewSwell', 'geyserVent'];

function run(modId, disable) {
  const out = execFileSync('node', [
    'tools/sim/run.mjs', '--seeds', '6', '--policy', 'hop', '--biomeMask', '2047',
    '--maxM', '3000', '--json',
    ...(disable ? ['--disableMod', modId] : []),
  ], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return JSON.parse(out);
}

console.log('W6 mod effectiveness probe — does neutralizing each mod change the run?');
console.log('(biomeMask 2047 = all 11 biomes; hop policy; 6 seeds; comparing per-seed results)');
const rows = [];
for (const m of mods) {
  let on, off;
  try {
    on = run(m, false);
    off = run(m, true);
  } catch (e) {
    rows.push([m, 'ERROR', String(e.message).slice(0, 80)]);
    continue;
  }
  const pick = (r) => r.runs.map((x) => `${Math.round(x.distanceM)}:${x.score}`).join('|');
  const same = pick(on) === pick(off);
  rows.push([m, same ? 'NO EFFECT' : 'CHANGES RUN', same ? '' : `${pick(on)}  vs  ${pick(off)}`]);
}
for (const r of rows) console.log(`  ${r[0].padEnd(15)} ${r[1].padEnd(12)} ${r[2] || ''}`);
