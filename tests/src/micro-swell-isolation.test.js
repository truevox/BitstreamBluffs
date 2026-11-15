/**
 * T2 isolation pin: the Micro Mountain swell fix (audit T2) may change ONLY biomeMask 512 terrain.
 *
 * Every digest below was recorded at main @ e080803 (v2.6.0), before the swell was moved into the chunk
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
    'alpha': '928ba72be1f0d66f',
    'beta': 'da26983b9cf8204b',
    'swell': '3b62e6072c4acddb'
  },
  '1': {
    'alpha': '278595375a32f556',
    'beta': 'f8b2422926785ef7',
    'swell': 'e0f53979265a9921'
  },
  '2': {
    'alpha': 'b45429063aa529df',
    'beta': '23a14a2d16b8ceb1',
    'swell': '01c405444ce29d3f'
  },
  '4': {
    'alpha': '647c5467907ed31a',
    'beta': '4cbaae1962df564c',
    'swell': '68fa00cd462a2a5e'
  },
  '8': {
    'alpha': '0012d6c77a06f5d8',
    'beta': '4fe4d11f63813848',
    'swell': 'c3325aa50de3d5af'
  },
  '16': {
    'alpha': 'c1eff14d27e75184',
    'beta': 'c2b561512d6cd5a6',
    'swell': 'f295c4fea164960d'
  },
  '32': {
    'alpha': '4a10c2876215a4f0',
    'beta': '5b66df3e4027f456',
    'swell': 'db96e88c331e25fa'
  },
  '64': {
    'alpha': 'f03fb6333ad6cc0f',
    'beta': '423598b7b134483e',
    'swell': '86f27de590c16d0f'
  },
  '128': {
    'alpha': '0ff4025ea50160a4',
    'beta': '35f36874cca50845',
    'swell': 'd751c69b6a0004e4'
  },
  '256': {
    'alpha': 'd6168ac49ae115ff',
    'beta': '0bd1869c2f626847',
    'swell': '2b7bd9060d07b065'
  },
  '1024': {
    'alpha': 'ec87892f2d89a6f5',
    'beta': '6390062ecf09675c',
    'swell': '1fd6dafeecebb98d'
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
