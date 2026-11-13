/**
 * Luna W3 audit probe — the two claims my round-2 note rests on, measured rather than asserted.
 *
 * (a) D6 says stats compare only same-mask records. `getDailyStats` does not filter. My note claims
 *     that is a real divergence; CC Friday's ruling claims the seed already scopes the mask. A seed
 *     accepts an `@mask` suffix, so one seed string is playable at several masks. This measures it.
 *
 * (b) Biome-tied missions must be offered only when the biome is unlocked AND enabled (§5 W2/W3).
 */
import { strict as assert } from 'node:assert';
import { DailyPatch } from './src/systems/DailyPatch.js';
import { parseSeedMask } from './src/systems/SaveStore.js';

const out = [];
const line = (s) => out.push(s);

const DEFS = [
  { id: 'debumont', bit: 1, unlockLevel: 1 },
  { id: 'garbage-dump-glacier', bit: 2, unlockLevel: 4 },
  { id: 'pyramid-peak', bit: 4, unlockLevel: 7 },
  { id: 'underwater-mountain', bit: 8, unlockLevel: 13 },
  { id: 'crystal-cavern', bit: 16, unlockLevel: 16 },
];

line('== (a) Is "the seed already scopes the mask" true? ==');
const date = '2026-11-13';
const derived = DailyPatch.biomeMaskForDate(new Date(`${date}T12:00:00Z`));
const dailySeed = DailyPatch.getDailyInfo(new Date(`${date}T12:00:00Z`)).seed;
line(`  date ${date} -> daily seed "${dailySeed}", date-derived mask ${derived}`);

// The three ways a player can start that exact daily seed, per TitleScene.startRun precedence.
const paths = [
  ['DAILY RUN (explicit maskOverride)', parseSeedMask(dailySeed, DEFS), derived],
  ['ENTER SEED, bare text (profile mask)', parseSeedMask(dailySeed, DEFS), 0],
  ['ENTER SEED, "@31" suffix', parseSeedMask(`${dailySeed}@31`, DEFS), parseSeedMask(`${dailySeed}@31`, DEFS).biomeMask],
];
const masks = new Set();
for (const [label, parsed, effective] of paths) {
  const m = parsed.hadSuffix ? parsed.biomeMask : effective;
  masks.add(m);
  line(`  ${label.padEnd(38)} -> mask ${m}`);
}
line(`  DISTINCT MASKS FOR ONE SEED STRING: ${masks.size} (${[...masks].sort((a, b) => a - b).join(', ')})`);
line(`  => "the seed already scopes the mask" is ${masks.size > 1 ? 'FALSE' : 'true'}`);

line('\n== (a2) How often does the date-derived mask differ from 0? ==');
let zero = 0;
const DAYS = 730;
const start = new Date('2024-01-01T12:00:00Z');
for (let i = 0; i < DAYS; i++) {
  const d = new Date(start.getTime() + i * 86400000);
  if (!DailyPatch.biomeMaskForDate(d)) zero++;
}
line(`  ${zero}/${DAYS} days derive mask 0 (${((zero / DAYS) * 100).toFixed(1)}%), `
  + `${DAYS - zero} non-zero (${(((DAYS - zero) / DAYS) * 100).toFixed(1)}%)`);
line('  => filtering daily stats by the derived mask would hide every pre-W3 daily record on');
line('     the non-zero days, which is exactly the counter-argument CC Friday\'s ruling rests on.');

line('\n== (b) daily mask is deterministic and player-independent (§5) ==');
const a = DailyPatch.biomeMaskForDate(new Date(`${date}T00:00:00Z`));
const b = DailyPatch.biomeMaskForDate(new Date(`${date}T23:59:59Z`));
line(`  same date key, two times of day: ${a} vs ${b} -> ${a === b ? 'identical' : 'DIVERGED'}`);
assert.equal(a, b, 'daily mask must not depend on the time of day');

line('\n== (b2) unlocked but SWITCHED OFF must not be offered ==');
line(`  (see probe-w3-gates.mjs for the enabledBiomeMask/b ones; the mission gate is exercised there)`);

console.log(out.join('\n'));
