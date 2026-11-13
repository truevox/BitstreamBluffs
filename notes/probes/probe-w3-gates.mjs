/**
 * Luna W3 audit probe — the §5 W3 behaviour gates, measured against shipped code.
 *
 * These are the gates a green suite cannot vouch for on its own, because each one is a claim about
 * a VALUE produced at runtime rather than a shape. Every number below comes from calling the real
 * module; nothing is re-implemented.
 */
import { strict as assert } from 'node:assert';
import { enabledBiomeMask, biomeToggleRows, sanitizeProfile } from './src/systems/ProfileStore.js';
import { shareableSeed } from './src/ui/Format.js';
import { parseSeedMask } from './src/systems/SaveStore.js';
import { biomeForSector } from './src/systems/TerrainGenerator.js';

const out = [];
const line = (s) => out.push(s);
const check = (name, fn) => {
  try {
    const detail = fn();
    line(`  PASS  ${name}${detail ? ` — ${detail}` : ''}`);
    return true;
  } catch (e) {
    line(`  FAIL  ${name} — ${e.message}`);
    return false;
  }
};

// The shipped unlock levels. Crystal Cavern is L16 and Underwater Mountain L13, NOT 12 — getting this
// wrong is what made my round-1 note claim a level-12 pilot could enable all five bits.
const DEFS = [
  { id: 'debumont', bit: 1, unlockLevel: 1 },
  { id: 'garbage-dump-glacier', bit: 2, unlockLevel: 4 },
  { id: 'pyramid-peak', bit: 4, unlockLevel: 7 },
  { id: 'underwater-mountain', bit: 8, unlockLevel: 13 },
  { id: 'crystal-cavern', bit: 16, unlockLevel: 16 },
];
const ALL = 31;

/** A profile that has reached `level` and has every signature switched on. */
const prof = (level, mask = ALL) => ({
  v: 1, level, biomeMask: mask, unlocked: { biomes: [], cosmetics: [], boosts: {} },
  pendingBiomes: DEFS.filter((d) => d.unlockLevel <= level).map((d) => d.id),
});

line('\n== Gate: an ordinary run uses only EARNED bits (START RUN precedence) ==');
let pass = 0;
for (const [level, want] of [[1, 1], [3, 1], [4, 3], [7, 7], [12, 7], [13, 15], [16, 31], [29, 31]]) {
  if (check(`level ${level} / mask 31 -> ${want}`, () => {
    const got = enabledBiomeMask(prof(level), DEFS);
    assert.equal(got, want, `got ${got}, wanted ${want}`);
    return `mask ${got}`;
  })) pass++;
}
check('mask 0 is never widened by earned bits', () => {
  const got = enabledBiomeMask(prof(30, 0), DEFS);
  assert.equal(got, 0);
  return 'mask 0';
});

line('\n== Gate: a share seed round-trips through the entry field ==');
for (const [rec, want] of [
  [{ seed: 'alpha', biomeMask: 0 }, 'alpha'],
  [{ seed: 'alpha', biomeMask: ALL }, 'alpha@31'],
  [{ seed: 'alpha' }, 'alpha'],
  [{ seed: '', biomeMask: 5 }, ''],
  [null, ''],
]) {
  check(`shareableSeed(${JSON.stringify(rec)})`, () => {
    const got = shareableSeed(rec);
    assert.equal(got, want, `got ${JSON.stringify(got)}`);
    return `"${got}"`;
  });
}
check('what COPY puts on the clipboard re-enters at the same mask', () => {
  const rec = { seed: 'daily-2026-11-13', biomeMask: 21 };
  const shared = shareableSeed(rec);
  const back = parseSeedMask(shared, DEFS);
  assert.equal(back.seed, rec.seed, 'seed changed through a copy/paste round trip');
  assert.equal(back.biomeMask, rec.biomeMask, `mask ${back.biomeMask} != ${rec.biomeMask}`);
  return `${shared} -> seed ${back.seed} @ ${back.biomeMask}`;
});

line('\n== Gate: sectors 0 and 1 are always base Bitstream (§5) ==');
check('no biome in sectors 0-1 across 400 seeds at mask 31', () => {
  let hits = 0;
  for (let s = 0; s < 400; s++) {
    for (const sector of [0, 1]) {
      if (biomeForSector(`seed-${s}`, sector, ALL, DEFS) !== null) hits++;
    }
  }
  assert.equal(hits, 0, `${hits} biome assignments in the base sectors`);
  return '0/800 sector draws';
});
check('biomes DO appear from sector 2 at mask 31', () => {
  let hits = 0;
  const total = 400;
  for (let s = 0; s < total; s++) if (biomeForSector(`seed-${s}`, 2, ALL, DEFS) !== null) hits++;
  assert.ok(hits > 0, 'a full mask produced no biome at sector 2 - the gate is dead');
  return `${hits}/${total} sector-2 draws`;
});

line('\n== Gate: determinism — same seed + mask yields the same terrain, twice ==');
check('biomeForSector is a pure function of (seed, sector, mask)', () => {
  for (let s = 0; s < 50; s++) {
    for (let sector = 0; sector < 8; sector++) {
      const a = biomeForSector(`det-${s}`, sector, ALL, DEFS);
      const b = biomeForSector(`det-${s}`, sector, ALL, DEFS);
      assert.equal(a, b, `sector ${sector} of det-${s} diverged`);
    }
  }
  return '50 seeds x 8 sectors, identical';
});
check('mask 0 yields no biome anywhere', () => {
  for (let s = 0; s < 200; s++) {
    for (let sector = 0; sector < 10; sector++) {
      assert.equal(biomeForSector(`zero-${s}`, sector, 0, DEFS), null, 'mask 0 produced a biome');
    }
  }
  return '0/2000 sector draws';
});
check('one bit set admits only its own biome', () => {
  const seen = new Set();
  for (let s = 0; s < 300; s++) {
    for (let sector = 0; sector < 10; sector++) {
      const b = biomeForSector(`one-${s}`, sector, 4, DEFS);
      if (b) seen.add(b);
    }
  }
  assert.deepEqual([...seen], ['pyramid-peak'], `saw ${[...seen].join(', ')}`);
  return 'only pyramid-peak';
});

line('\n== Gate: toggles reflect earned bits, and a stale mask cannot smuggle one in ==');
check('biomeToggleRows: only earned biomes are toggleable', () => {
  const rows = biomeToggleRows(prof(7), DEFS);
  const on = rows.filter((r) => r.unlocked).map((r) => r.id);
  assert.deepEqual(on, ['debumont', 'garbage-dump-glacier', 'pyramid-peak'], `unlocked ${on.join(', ')}`);
  return `${on.length}/5 toggleable at L7`;
});
check('sanitizeProfile keeps biomeMask', () => {
  const p = sanitizeProfile({ v: 1, biomeMask: 21, xp: 0 });
  assert.equal(p.biomeMask, 21, `biomeMask came back as ${p.biomeMask}`);
  return 'mask 21 survives sanitisation';
});

line(`\n${pass >= 8 ? 'ALL CHECKS PASS' : 'SOME CHECKS FAILED'}`);
console.log(out.join('\n'));
process.exit(pass >= 8 ? 0 : 1);
