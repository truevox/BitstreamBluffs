/**
 * T2 isolation pin: the Micro Mountain swell fix (audit T2) may change ONLY biomeMask 512 terrain.
 *
 * Chain of trust. Each digest hashes JSON.stringify of chunks 0..299 (points, zones, hazards, power-ups, shards, pads, launches) for one seed and
 * one single-biome mask. They were first recorded at main @ e080803 (v2.6.0), before the swell moved into the chunk points, and were RE-PINNED ONCE
 * at #121 (portable math, SIM_REVISION 4): terrain generation now calls pmath instead of the native Math, which changes the last bits of about
 * 10% of the numbers. The re-pin is justified by a tolerance comparison, not by trusting the new hashes: with the same seeds and masks, native-Math
 * (main 97ba4f5c) versus pmath terrain differs by at most 8.7e-11 px (6e-16 relative) with ZERO structural differences (same keys, lengths, ids,
 * kinds, hazards, power-ups) over 20 seed/mask pairs x 300 chunks (tools/determinism/portable-math/terrain-delta.mjs; an independent run over
 * 13 masks x 8 seeds found a max of 1.2e-10 px and no structural difference). Mask 512 is left out on purpose: it is the one mask the fix is
 * meant to change. Mask 0 is also pinned by terrain-golden-mask0.test.js; it is repeated here so this file alone proves 'nothing but Micro moved'.
 *
 * WHEN THIS FAILS, do not re-pin without redoing that tolerance comparison: a failure outside Micro means a change reached terrain that has no business
 * changing. (Only changes to pmath, or to the @stdlib pins that feed it, may legitimately move these digests.)
 */
import crypto from 'crypto';
import { makeGen, loadContent } from './_helpers.js';

// #121 (portable math): digests re-pinned once. Terrain generation now uses pmath (tan/atan2/hypot/cos), which differs from native V8 Math in the last bits
// of about 10% of the numbers (max 8.7e-11 px, 6e-16 relative; zero structural differences over 20 seed/mask pairs x 300 chunks, tools/determinism/portable-math/terrain-delta.mjs).
const CHUNKS = 300;
const PINNED = {
  '0': {
    'alpha': 'a02af9e4d56273c8',
    'beta': '7fbbbeb590fce060',
    'swell': 'b3717ba9fd1b0647'
  },
  '1': {
    'alpha': '32d58dd8f362f924',
    'beta': 'b20ebff2d719d23a',
    'swell': '35c5415b08ce016b'
  },
  '2': {
    'alpha': 'dd7dde8b607ed7ad',
    'beta': '55114419899d1e08',
    'swell': '46f7867ddabab199'
  },
  '4': {
    'alpha': '6075257a767a800c',
    'beta': '3ca54022e98a1de4',
    'swell': 'bda8a94c3f608510'
  },
  '8': {
    'alpha': 'dbb1e39c19e38857',
    'beta': 'adee253636195873',
    'swell': '31b2b00a6acca365'
  },
  '16': {
    'alpha': '8cb8d5dab0b21137',
    'beta': '7735c9a3cfa91469',
    'swell': '73133a4cd6c4b275'
  },
  '32': {
    'alpha': '947264f11bc668a4',
    'beta': '306105700ab0eebf',
    'swell': 'd729a0aff52faef1'
  },
  '64': {
    'alpha': '0b7704b772ed7977',
    'beta': 'a3010169fa3781d2',
    'swell': '631e52c8be4904fd'
  },
  '128': {
    'alpha': 'e8f9f66592a5711d',
    'beta': 'efda9348aaced421',
    'swell': '36d3b75d4e2118f7'
  },
  '256': {
    'alpha': '6f2d152ca9c14458',
    'beta': '0dd1ede1c4e96b71',
    'swell': '055a2716fe288d90'
  },
  '1024': {
    'alpha': '78ed32962ead990b',
    'beta': '9e483afe1335d274',
    'swell': '1baa7f4cb7dea24f'
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
  // Issue #65 renamed the biome id; the pins predate it, so the id is read back as its old spelling. The
  // geometry is bit-identical, only the serialized id string differs.
  for (let i = 0; i < CHUNKS; i++) h.update(JSON.stringify(g.getChunk(i)).replace(/debutmont/g, 'debu'+'mont'));
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
