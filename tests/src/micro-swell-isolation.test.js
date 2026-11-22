/**
 * re-pinned for #65: Debutmont base + arcade bridges. Every digest below was re-recorded at that change, which
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
    'alpha': 'b69e7cfc83cf5ef7',
    'beta': 'c7d4c1f03c7285b9',
    'swell': '7196c3a64d0e3ab1'
  },
  '1': {
    'alpha': 'b69e7cfc83cf5ef7',
    'beta': 'c7d4c1f03c7285b9',
    'swell': '7196c3a64d0e3ab1'
  },
  '2': {
    'alpha': 'd4ce3ad76b2f340d',
    'beta': '3b7d5570395bd44b',
    'swell': '2613280caea597a6'
  },
  '4': {
    'alpha': 'eea683f5b7ed9d74',
    'beta': 'a1211f7aebe266af',
    'swell': '5acb41dcf35b3e65'
  },
  '8': {
    'alpha': '67d4cca06dda418a',
    'beta': '33285a293ccd0d5e',
    'swell': 'f994b4adb9685a23'
  },
  '16': {
    'alpha': 'b0bfe33a941bfb97',
    'beta': '1d7029654c8a3c6b',
    'swell': 'ac0d7362ad5558b1'
  },
  '32': {
    'alpha': 'b73e14927cecf07c',
    'beta': 'bafe740e1aa1dcea',
    'swell': '27e3c7d0bcf7a3e3'
  },
  '64': {
    'alpha': '9e0d5fd715ce2bf0',
    'beta': '1e9ebb6f7c0b9f36',
    'swell': 'ef647241e89a1ee6'
  },
  '128': {
    'alpha': '2fdb3461bee95811',
    'beta': 'c8e6b2c929a8dcf2',
    'swell': '91645a6b071d48ae'
  },
  '256': {
    'alpha': '88d308622a08dd5f',
    'beta': '2d0bfae077f04b4f',
    'swell': 'c8a4c650bb766b82'
  },
  '1024': {
    'alpha': 'dc2df3000b93d9e2',
    'beta': '3d391b63e37c2378',
    'swell': '8e0f4963a76fcec6'
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
