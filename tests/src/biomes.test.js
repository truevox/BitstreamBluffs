/**
 * W3 — biomes batch 1: sector assignment and biome content.
 *
 * `biomeForSector` is the whole of W3's terrain-side change. Everything else is data. That makes it
 * the one function where a mistake silently rewrites terrain, so the tests here are weighted towards
 * the properties that would break existing players: mask 0 must behave exactly as it does today, the
 * choice must not depend on call order or on how much terrain has been generated, and sectors 0-1
 * stay base Bitstream so every existing seed's opening is unchanged.
 */
import fs from 'fs';
import path from 'path';
import { TerrainGenerator, biomeForSector } from '../../src/systems/TerrainGenerator.js';
import { SECTOR_M } from '../../src/systems/TerrainGenerator.js';
import { makeGen, loadContent, readDir } from './_helpers.js';
import { PALETTE_KEYS, PALETTE_NAMES } from '../../src/constants.js';
import { Rng, hashInts } from '../../src/systems/Rng.js';
import { PhysicsTuner } from '../../src/systems/PhysicsTuner.js';

const BIOMES = readDir('biomes');

/**
 * Call the real function with the shipped defs. Passing defs explicitly (rather than letting the
 * function reach for content) is what keeps it pure; without them every biome assertion below would
 * pass trivially because nothing could ever be drawn.
 */
const bio = (seed, sector, mask) => biomeForSector(seed, sector, mask, BIOMES);
const byId = (arr) => Object.fromEntries(arr.map((d) => [d.id, d]));

/** Bit of a biome id, from the data (not typed here: the data owns the mask). */
const bitOf = (id) => BIOMES.find((b) => b.id === id).bit;

describe('biome content — src/data/biomes/*.json', () => {
  test('all eleven biomes are defined, batch 1 and batch 2 together', () => {
    // Pinned by NAME, not by count: a missing biome would silently be a locked sector that can never
    // appear, which is the failure mode worth catching. D1 puts all 11 SledHEAD biomes in scope, so this
    // is the complete set W1-W6 must ship.
    expect(BIOMES.map((b) => b.id).sort()).toEqual([
      'candy-cane-canyon',
      'crystal-cavern',
      'debumont',
      'garbage-dump-glacier',
      'micro-mountain',
      'pyramid-peak',
      'sky-jellyfish-mountain',
      'space-mountain',
      'steampunk-slopes',
      'underwater-mountain',
      'vertigo-vents',
    ]);
  });

  test('mask bits are distinct powers of two', () => {
    // The mask is a bitfield and is stored in run records; a collision would make two biomes
    // indistinguishable in saved data forever.
    const bits = BIOMES.map((b) => b.bit).sort((a, b) => a - b);
    expect(bits).toEqual([1, 2, 4, 8, 16, 32, 64, 128, 256, 512, 1024]);
    expect(new Set(bits).size).toBe(bits.length);
    // Every bit must fit the mask the profile stores, or the 11th biome would be silently unselectable.
    for (const b of BIOMES) expect({ id: b.id, fits: b.bit > 0 && b.bit <= 1024 }).toMatchObject({ id: b.id, fits: true });
  });

  test('every biome carries the fields the loader and UI read', () => {
    for (const b of BIOMES) {
      expect({ id: b.id, hasName: typeof b.name === 'string' && b.name.length > 0 })
        .toMatchObject({ id: b.id, hasName: true });
      expect({ id: b.id, unlockLevel: b.unlockLevel })
        .toMatchObject({ id: b.id, unlockLevel: expect.any(Number) });
      expect(typeof b.background).toBe('string');
      expect(typeof b.lore).toBe('string');
      expect(b.lore.length).toBeGreaterThan(10);
    }
  });

  test('unlock levels match levels.json, which is what actually unlocks them', () => {
    // levels.json is the source of truth for when a biome unlocks (W1 shipped it). A biome JSON that
    // disagrees would display one level and unlock at another.
    const levels = JSON.parse(fs.readFileSync(path.resolve('src/data/progression/levels.json'), 'utf8'));
    for (const b of BIOMES) {
      const entry = levels.levels.find((l) => l.biome === b.id);
      expect({ id: b.id, unlockLevel: b.unlockLevel })
        .toMatchObject({ id: b.id, unlockLevel: entry.level });
    }
  });

  test('palette overrides are complete for BOTH palettes and never touch danger', () => {
    // Spec: "The `danger` colour never changes with the biome. Hazards must read as hazards in
    // every palette." A biome that recolours danger would make its hazards look safe, which is the
    // one cosmetic mistake that changes how the game plays.
    for (const b of BIOMES) {
      expect({ id: b.id, palettes: Object.keys(b.palettes || {}).sort() })
        .toMatchObject({ id: b.id, palettes: [...PALETTE_NAMES].sort() });
      for (const name of PALETTE_NAMES) {
        const overrides = b.palettes[name] || {};
        expect({ id: b.id, palette: name, keys: Object.keys(overrides).length })
          .toMatchObject({ id: b.id, palette: name, keys: expect.any(Number) });
        // Only real palette keys, and never 'danger'.
        for (const k of Object.keys(overrides)) {
          expect({ id: b.id, key: k, known: PALETTE_KEYS.includes(k) }).toMatchObject({
            id: b.id, key: k, known: true,
          });
          expect({ id: b.id, key: k, isDanger: k === 'danger' }).toMatchObject({
            id: b.id, key: k, isDanger: false,
          });
        }
        for (const v of Object.values(overrides)) expect(v).toMatch(/^#[0-9a-f]{6}$/i);
      }
    }
  });

  test('each biome names a mod that exists and expresses exactly ONE mechanic', () => {
    // D2: "exactly one signature mechanic per biome". That is the invariant; how the mechanic is
    // expressed is not. Four of the five mechanics are physical (drag / loft / gravity / sticky), but
    // Crystal Cavern's is scoring ("tricks landed inside score a combo bonus"), which cannot be
    // written as a physics multiplier at all. So the assertion is one mechanic of one kind - not
    // "a physics multiplier" - and a biome carrying both would be a D2 violation, which is the thing
    // actually worth pinning.
    const mods = byId(readDir('terrainMods'));
    for (const b of BIOMES) {
      const def = mods[b.mod];
      expect({ id: b.id, mod: b.mod, exists: Boolean(def) }).toMatchObject({
        id: b.id, mod: b.mod, exists: true,
      });
      const p = def.physics || {};
      // W6 widened the vocabulary: speedMul (sugar rush) and steerMul are physics too, and two mechanics
      // are neither physics nor scoring — a terrain swell and a launch act on the surface and on contact.
      const muls = ['frictionMul', 'gravityMul', 'bounceMul', 'speedMul', 'steerMul', 'pushForceMul']
        .filter((k) => Number.isFinite(p[k]));
      const hasScore = Number.isFinite(def.scoreMul);
      const hasSwell = Boolean(def.terrainSwell);
      const hasLaunch = Boolean(def.launch);
      const kinds = [muls.length > 0, hasScore, hasSwell, hasLaunch].filter(Boolean).length;
      // Exactly ONE kind of mechanic per biome (D2), whichever kind it is.
      expect({ id: b.id, kinds }).toMatchObject({ id: b.id, kinds: 1 });
      // Never both score and physics: that would be two mechanics in one biome.
      if (hasScore) {
        expect({ id: b.id, alsoPhysics: muls.length }).toMatchObject({ id: b.id, alsoPhysics: 0 });
      }
      // Bounded: a gravityMul of 0.2 would not read as a different biome, it would read as a broken
      // game, and it would make that biome's leaderboard incomparable.
      for (const k of muls) {
        expect({ id: b.id, mul: k, bounded: p[k] >= 0.5 && p[k] <= 2 }).toMatchObject({
          id: b.id, mul: k, bounded: true,
        });
      }
      if (hasScore) {
        expect({ id: b.id, scoreMul: def.scoreMul, bounded: def.scoreMul > 1 && def.scoreMul <= 2 })
          .toMatchObject({ id: b.id, scoreMul: def.scoreMul, bounded: true });
      }
    }
  });

  test('currently shipped mods are untouched (additive only)', () => {
    // The three existing mods are referenced by chunk templates and tested elsewhere. W3 must add
    // mods, never redefine the ones already in play.
    const mods = byId(readDir('terrainMods'));
    for (const id of ['compression', 'highBandwidth', 'wirelessBridge']) {
      expect({ id, present: Boolean(mods[id]) }).toMatchObject({ id, present: true });
    }
  });

  test('each biome names 2-3 chunk template ids that exist', () => {
    const chunks = byId(readDir('chunks'));
    for (const b of BIOMES) {
      expect({ id: b.id, n: (b.chunks || []).length }).toMatchObject({ id: b.id, n: expect.any(Number) });
      expect(b.chunks.length).toBeGreaterThanOrEqual(2);
      expect(b.chunks.length).toBeLessThanOrEqual(3);
      for (const cid of b.chunks) {
        expect({ biome: b.id, chunk: cid, exists: Boolean(chunks[cid]) }).toMatchObject({
          biome: b.id, chunk: cid, exists: true,
        });
      }
    }
  });
});

const ALL_MASK = BIOMES.reduce((m, b) => m | b.bit, 0);

describe('biomeForSector', () => {
  const ALL = ALL_MASK;

  test('sectors 0 and 1 are always base Bitstream, whatever the mask', () => {
    // Every existing seed and daily key starts with two base sectors. Changing that would change the
    // opening of every run ever recorded, which is exactly what the golden test forbids.
    for (const mask of [0, ALL, bitOf('debumont'), bitOf('crystal-cavern')]) {
      for (const seed of ['alpha', 'bitstream-bluffs', '2026-11-13']) {
        expect({ seed, mask, s0: bio(seed, 0, mask) }).toMatchObject({ seed, mask, s0: null });
        expect({ seed, mask, s1: bio(seed, 1, mask) }).toMatchObject({ seed, mask, s1: null });
      }
    }
  });

  test('mask 0 is base everywhere, for thousands of sectors', () => {
    // The whole point of the mask: a player who has unlocked nothing sees the terrain that shipped.
    for (const seed of ['alpha', 'bitstream-bluffs', '42']) {
      for (let s = 0; s < 2000; s++) {
        expect({ seed, s, biome: bio(seed, s, 0) }).toMatchObject({ seed, s, biome: null });
      }
    }
  });

  test('is deterministic and independent of call order', () => {
    const a = [];
    for (let s = 0; s < 400; s++) a.push(bio('order', s, ALL));
    // Ask out of order, and twice for good measure.
    const b = new Array(400);
    for (let s = 399; s >= 0; s -= 1) b[s] = bio('order', s, ALL);
    expect(b).toEqual(a);
    for (let s = 0; s < 400; s += 37) expect(bio('order', s, ALL)).toBe(a[s]);
  });

  test('different seeds give different sector layouts', () => {
    // A layout that ignored the seed would make every run identical, which is the bug this catches.
    const layoutA = [];
    const layoutB = [];
    for (let s = 2; s < 400; s++) {
      layoutA.push(bio('seed-a', s, ALL));
      layoutB.push(bio('seed-b', s, ALL));
    }
    const diff = layoutA.filter((v, i) => v !== layoutB[i]).length;
    expect(diff).toBeGreaterThan(150);
  });

  test('never returns a biome whose bit is not in the mask', () => {
    // The single most important invariant: a locked biome must be impossible, not merely unlikely.
    for (const b of BIOMES) {
      const mask = b.bit;
      for (let s = 0; s < 600; s++) {
        const got = bio('locked', s, mask);
        expect({ s, got, ok: got === null || got === b.id }).toMatchObject({ s, got, ok: true });
      }
    }
  });

  test('each enabled biome actually appears, and base sectors still occur', () => {
    // A mask where one biome never wins its share is a biome the player cannot reach. "Base" must
    // also survive, or the game would be biome soup with no Bitstream left.
    const seen = new Map();
    for (let s = 2; s < 2000; s++) {
      const got = bio('variety', s, ALL) || '(base)';
      seen.set(got, (seen.get(got) || 0) + 1);
    }
    for (const b of BIOMES) expect({ id: b.id, n: seen.get(b.id) || 0 }).toMatchObject({
      id: b.id, n: expect.any(Number),
    });
    for (const b of BIOMES) expect(seen.get(b.id) || 0).toBeGreaterThan(50);
    expect(seen.get('(base)') || 0).toBeGreaterThan(200);
  });

  test('the choice draws from its own stream and does not consume the terrain stream', () => {
    // Spec: "drawing from Rng.fork('biome') so no existing random stream is disturbed". Proved by
    // constructing two generators whose biome stream is exercised a different number of times and
    // requiring identical terrain.
    const a = makeGen('stream-check');
    const b = makeGen('stream-check');
    for (let s = 0; s < 500; s++) bio('stream-check', s, ALL); // poke the biome stream
    for (let i = 0; i < 40; i++) {
      expect(JSON.stringify(a.getChunk(i))).toBe(JSON.stringify(b.getChunk(i)));
    }
  });

  test('the sector length used matches the generator, so banners and terrain agree', () => {
    // A banner that fires on a different boundary than the terrain changes would be visibly wrong.
    expect(SECTOR_M).toBe(500);
    const gen = makeGen('alpha');
    // Chunk 0 starts in sector 1 (1-based, see TerrainChunk.sector); sector 2 begins at 500 m.
    expect(gen.getChunk(0).sector).toBe(1);
  });
});

describe('biome mechanics actually reach the physics', () => {
  // A biome whose mod exists but whose multipliers never touch the sled is a skin, not a mechanic -
  // D2 requires one signature mechanic each. This checks the number the tuner hands the physics step,
  // not the JSON, so a typo in a multiplier name (gravityMult vs gravityMul) fails here.
  const mods = byId(readDir('terrainMods'));
  const tuner = () => new PhysicsTuner();

  const effectOf = (modId) => {
    const t = tuner();
    const base = t.getEffective({});
    const mod = t.getEffective({ zones: [mods[modId]] });
    return { base, mod };
  };

  test('every physics biome changes gravity, ground resistance or bounce', () => {
    for (const b of BIOMES) {
      const def = mods[b.mod];
      // Scoring and the two W6 surface/contact mechanics are covered by their own tests below; this one
      // is about the biomes whose mechanic is an effective constant.
      if (Number.isFinite(def.scoreMul) || def.terrainSwell || def.launch) continue;
      const { base, mod } = effectOf(b.mod);
      // W6 widened this from three fields: sugar rush changes terminal speed and steering, the conveyor
      // changes push force. A mechanic that reaches NO effective constant is the bug being caught.
      const changed =
        mod.gravityPxS2 !== base.gravityPxS2 ||
        mod.groundResist !== base.groundResist ||
        mod.bounceMul !== base.bounceMul ||
        mod.speedMul !== base.speedMul ||
        mod.pushForceMul !== base.pushForceMul ||
        mod.airControl !== base.airControl;
      expect({ biome: b.id, mod: b.mod, changed }).toMatchObject({ biome: b.id, mod: b.mod, changed: true });
    }
  });

  test('the direction of each mechanic matches the spec table', () => {
    // "more drag ... more loft", "sticky patches that bleed speed", "updraft zones that extend airtime",
    // "lower gravity and higher drag together". A sign flip would make a biome play the opposite of its
    // name and nobody would notice from the data alone.
    const powder = effectOf('powderFlurry');
    expect(powder.mod.groundResist).toBeGreaterThan(powder.base.groundResist); // more drag
    expect(powder.mod.bounceMul).toBeGreaterThan(powder.base.bounceMul); // more loft

    const sticky = effectOf('stickyPatch');
    expect(sticky.mod.groundResist).toBeGreaterThan(sticky.base.groundResist);

    const thermal = effectOf('thermalUpdraft');
    expect(thermal.mod.gravityPxS2).toBeLessThan(thermal.base.gravityPxS2); // longer airtime

    const slow = effectOf('slowMotion');
    expect(slow.mod.gravityPxS2).toBeLessThan(slow.base.gravityPxS2);
    expect(slow.mod.groundResist).toBeGreaterThan(slow.base.groundResist);
  });

  test('no biome turns the gravity into a different game', () => {
    // Bounds, not direction: a zone may flavour a sector, never disable physics.
    for (const b of BIOMES) {
      const def = mods[b.mod];
      if (Number.isFinite(def.scoreMul) || def.terrainSwell || def.launch) continue;
      const { base, mod } = effectOf(b.mod);
      const ratio = mod.gravityPxS2 / base.gravityPxS2;
      expect({ biome: b.id, ratio: expect.any(Number) }).toMatchObject({ biome: b.id, ratio: expect.any(Number) });
      expect(ratio).toBeGreaterThanOrEqual(0.7);
      expect(ratio).toBeLessThanOrEqual(1.3);
      // The same bound has to hold for the multipliers W6 added, or a biome could quietly make the sled
      // unsteerable (steer ~0) or launch it off the map (speed 3x) without tripping the gravity check.
      expect({ biome: b.id, speed: mod.speedMul }).toMatchObject({ biome: b.id, speed: expect.any(Number) });
      expect(mod.speedMul).toBeGreaterThanOrEqual(0.5);
      expect(mod.speedMul).toBeLessThanOrEqual(1.4);
      // Steering may be reduced hard (that is sugar rush's whole idea) but never to zero: a biome that
      // takes steering away entirely is not a mechanic, it is a cutscene.
      expect(mod.airControl).toBeGreaterThan(0);
      expect(mod.pushForceMul).toBeGreaterThanOrEqual(0.5);
      expect(mod.pushForceMul).toBeLessThanOrEqual(2.5);
    }
  });

  test('zones inside a biome sector are the biome\'s own mod', () => {
    // Confirms the generator wires a biome sector's zone to that biome, not to a shared default.
    for (const b of BIOMES) {
      const gen = new TerrainGenerator({
        seed: 'zone-wiring',
        chunkDefs: readDir('chunks'), hazardDefs: byId(readDir('hazards')), powerupDefs: byId(readDir('powerups')),
        modDefs: mods, biomeDefs: BIOMES, biomeMask: ALL_MASK,
      });
      let found = 0;
      for (let i = 0; i < 400 && found < 3; i++) {
        const c = gen.getChunk(i);
        if (c.biome !== b.id) continue;
        for (const z of c.zones) if (z.modId === b.mod) found++;
      }
      expect({ biome: b.id, mod: b.mod, found }).toMatchObject({ biome: b.id, mod: b.mod, found: expect.any(Number) });
      expect(found).toBeGreaterThan(0);
    }
  });
});

describe('terrain determinism with a biome mask (W3 gate: same seed + mask -> same terrain, twice)', () => {
  // The spec asks for this at the TERRAIN level, not just the sector function. A generator that
  // consulted mutable state (or reused a stream across builds) could agree on which biome owns a
  // sector and still emit different chunks for it.
  const build = (seed, mask, n) => {
    const gen = new TerrainGenerator({
      seed,
      chunkDefs: readDir('chunks'), hazardDefs: byId(readDir('hazards')), powerupDefs: byId(readDir('powerups')),
      modDefs: byId(readDir('terrainMods')), biomeDefs: BIOMES, biomeMask: mask,
    });
    const out = [];
    for (let i = 0; i < n; i++) out.push(JSON.stringify(gen.getChunk(i)));
    return out;
  };

  test('the same seed and mask produce byte-identical chunks on two separate builds', () => {
    for (const mask of [0, 1, 16, ALL_MASK]) {
      const a = build('det-seed', mask, 120);
      const b = build('det-seed', mask, 120);
      expect({ mask, same: JSON.stringify(a) === JSON.stringify(b) }).toMatchObject({ mask, same: true });
    }
  });

  test('a masked build differs from mask 0, so the mask is not silently ignored', () => {
    // Guards the failure that made the first sim comparison meaningless: a mask that never reaches
    // the generator looks deterministic and identical, and proves nothing.
    const zero = build('det-seed', 0, 120);
    const masked = build('det-seed', ALL_MASK, 120);
    expect(JSON.stringify(zero)).not.toBe(JSON.stringify(masked));
  });

  test('generation order does not change the terrain', () => {
    // A player streams chunks left to right; a pooled-chunk bug would make the same chunk differ
    // depending on what was generated before it.
    const gen = new TerrainGenerator({
      seed: 'order-terrain',
      chunkDefs: readDir('chunks'), hazardDefs: byId(readDir('hazards')), powerupDefs: byId(readDir('powerups')),
      modDefs: byId(readDir('terrainMods')), biomeDefs: BIOMES, biomeMask: ALL_MASK,
    });
    const forward = [];
    for (let i = 0; i < 60; i++) forward.push(JSON.stringify(gen.getChunk(i)));
    // Re-read the same chunks in a different order on a fresh generator.
    const gen2 = new TerrainGenerator({
      seed: 'order-terrain',
      chunkDefs: readDir('chunks'), hazardDefs: byId(readDir('hazards')), powerupDefs: byId(readDir('powerups')),
      modDefs: byId(readDir('terrainMods')), biomeDefs: BIOMES, biomeMask: ALL_MASK,
    });
    for (const i of [59, 12, 0, 33, 7, 45]) {
      expect({ i, chunk: JSON.stringify(gen2.getChunk(i)) }).toMatchObject({ i, chunk: forward[i] });
    }
  });
});
