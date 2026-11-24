/**
 * re-pinned for #65 (on the #121 portable-math build): Debutmont base + arcade bridges. Every digest below was re-recorded at that change, which
 * deliberately moved every mask's terrain: Debutmont is now the base biome (mask 0 is pure Debutmont, so mask 1 hashes
 * the same as mask 0), and each biome change is bridged by arcade chunks. The isolation claim below still holds and is
 * still what these pins prove: a later change that reaches terrain outside Micro (512) moves a digest.
 *
 * T2 isolation pin: the Micro Mountain swell fix (audit T2) may change ONLY biomeMask 512 terrain.
 *
 * Every digest below was first recorded at main @ e080803 (v2.6.0), before the swell was moved into the chunk
 * points. Each one hashes JSON.stringify of chunks 0..299 (points, zones, hazards, power-ups, shards, pads,
 * launches) for one seed and one single-biome mask. Mask 512 is left out on purpose: it is the one mask the
 * fix is meant to change. Mask 0 is also pinned by terrain-golden-mask0.test.js; it is repeated here so this
 * file alone proves the claim 'nothing but Micro moved'.
 *
 * WHEN THIS FAILS, do not re-pin. A change outside Micro reached terrain that has no business changing.
 */
import crypto from 'crypto';
import { makeGen, loadContent } from './_helpers.js';

const CHUNKS = 300;
const PINNED = {
  '0': {
    'alpha': '14a3e138ca0e0b5c',
    'beta': 'c3b5c86bad2a1efb',
    'swell': '8133b77519002d2b'
  },
  '1': {
    'alpha': '14a3e138ca0e0b5c',
    'beta': 'c3b5c86bad2a1efb',
    'swell': '8133b77519002d2b'
  },
  '2': {
    'alpha': '84668b85ff02f3a5',
    'beta': '11d4045a6d608bab',
    'swell': '60193eee0278b474'
  },
  '4': {
    'alpha': '348ca2deb497a397',
    'beta': 'a62db1db2c6c3866',
    'swell': '8b7c608b20200ee7'
  },
  '8': {
    'alpha': '4aaa9cad784a014b',
    'beta': '003edfb3c875c463',
    'swell': '792a77ca25d9a040'
  },
  '16': {
    'alpha': 'b403d967b5c526eb',
    'beta': '93668c3469bf40b4',
    'swell': '5f062e3d7e384b84'
  },
  '32': {
    'alpha': '10a0e5f762871e85',
    'beta': '9f12f4012acc8820',
    'swell': 'be3622d778a7d48e'
  },
  '64': {
    'alpha': 'a6583c39eb6e53c1',
    'beta': '02e3f030e38e6255',
    'swell': '4a19ba8ee75a3f04'
  },
  '128': {
    'alpha': '932a3ca67f207c57',
    'beta': 'f0aa1876f450ab8a',
    'swell': '9974f37333c9c4e1'
  },
  '256': {
    'alpha': 'e1243e73476e9a20',
    'beta': '978ee95dfbdee619',
    'swell': '3d87988802424226'
  },
  '1024': {
    'alpha': '9538114f294f7869',
    'beta': 'f517660e997c6131',
    'swell': '15c886c6c2158e18'
  }
};

/**
 * Biome content that landed AFTER e080803 on purpose (spec §4: a biome batch changes its own masks' spawns). Its defs are
 * left out of the digest so this pin keeps proving its own claim (the swell fix and everything else moved nothing outside
 * Micro) without being re-pinned. Only these biome-tagged defs are dropped; base defs and every earlier biome def stay in.
 * B2 "Sight" (2026-11-15): Crystal Cavern (16) and Vertigo Vents (1024). Their own determinism and mask-0 isolation are
 * pinned in biome-b2-presence.test.js and terrain-golden-mask0.test.js. B3 "Motion": Pyramid Peak, Steampunk Slopes and
 * Micro Mountain (see LATER_BIOMES).
 */
const LATER_BIOMES = new Set([
  'crystal-cavern', 'vertigo-vents',
  // B3 "Motion" (2026-11-15): Pyramid Peak (4), Steampunk Slopes (256), Micro Mountain (512). Pinned in
  // biome-b3-presence.test.js (determinism, placement rules) and terrain-golden-mask0.test.js (mask 0).
  'pyramid-peak', 'steampunk-slopes', 'micro-mountain',
  // B4 "Air" (2026-11-16): Space Mountain (32), Sky Jellyfish Mountain (128). Pinned in biome-b4-presence.test.js
  // (determinism, presence) and terrain-golden-mask0.test.js (mask 0).
  'space-mountain', 'sky-jellyfish-mountain',
]);
const c = loadContent();
const without = (o) => Object.fromEntries(Object.entries(o).filter(([, d]) => !LATER_BIOMES.has(d.biome)));

function digest(seed, mask) {
  const g = makeGen(seed, { biomeMask: mask, hazardDefs: without(c.hazards), powerupDefs: without(c.powerups) });
  const h = crypto.createHash('sha256');
  for (let i = 0; i < CHUNKS; i++) h.update(JSON.stringify(g.getChunk(i)));
  return h.digest('hex').slice(0, 16);
}

describe('T2 isolation: terrain of every mask except Micro (512) is unchanged since e080803', () => {
  for (const mask of Object.keys(PINNED)) {
    test(`mask ${mask}`, () => {
      const got = {};
      for (const seed of Object.keys(PINNED[mask])) got[seed] = digest(seed, Number(mask));
      expect(got).toEqual(PINNED[mask]);
    });
  }
});
