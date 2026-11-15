/**
 * B1 "Wards" content (spec §4 table and bounds): the biome hazard and power-up of Debumont, Garbage Dump Glacier,
 * Underwater Mountain and Candy Cane Canyon. Loader + schema check for the new JSON, the values the spec names, and the
 * pairing rule (each ward switches off something its own biome has).
 */
import { readDir, loadContent, makeGen } from './_helpers.js';
import { PALETTE_KEYS } from '../../src/constants.js';
import { emptyWards, addWard, isWarded, tickWards, wardSpeedFactor, wardSpeedMul, WARD_MIN_MS, WARD_MAX_MS, WARD_MAX_SPEED_FACTOR } from '../../src/systems/Wards.js';
import { hazardDrawKind, powerupDrawKind, hazardColorKey } from '../../src/systems/BiomeEffects.js';
import { BIOME_SPAWN_MAX_CHANCE, BIOME_HAZARD_MAX_CHANCE } from '../../src/systems/TerrainGenerator.js';

const c = loadContent();
const biomeHaz = readDir('hazards').filter((d) => d.biome);
const biomePu = readDir('powerups').filter((d) => d.biome);

/** Spec §4 B1 rows. */
const B1 = {
  debumont: { hazard: 'groomerCat', powerup: 'mapleWax' },
  'garbage-dump-glacier': { hazard: 'seagullDive', powerup: 'slickWaxSpray' },
  'underwater-mountain': { hazard: 'seaweedTangle', powerup: 'aquaLungBubble' },
  'candy-cane-canyon': { hazard: 'chocolateRiver', powerup: 'sweetToothCoating' },
};

describe('B1 content: loader and schema', () => {
  test('exactly the B1 biome defs are shipped, one hazard and one power-up per B1 biome', () => {
    const byBiome = (list) => Object.fromEntries(Object.keys(B1).map((b) => [b, list.filter((d) => d.biome === b).map((d) => d.id)]));
    expect(byBiome(biomeHaz)).toEqual(Object.fromEntries(Object.entries(B1).map(([b, r]) => [b, [r.hazard]])));
    expect(byBiome(biomePu)).toEqual(Object.fromEntries(Object.entries(B1).map(([b, r]) => [b, [r.powerup]])));
    expect(biomeHaz.length).toBe(4);
    expect(biomePu.length).toBe(4);
    // loadContent (the shape the game's loader produces) carries them by id
    for (const r of Object.values(B1)) {
      expect(c.hazards[r.hazard]).toBeDefined();
      expect(c.powerups[r.powerup]).toBeDefined();
    }
  });

  test('every biome def names a real biome, and follows the hazard / power-up schema', () => {
    const effects = ['crash', 'slow', 'scramble', 'blind', 'gust'];
    for (const h of biomeHaz) {
      expect(c.biomes[h.biome]).toBeDefined();
      expect(typeof h.shapeKey).toBe('string');
      expect(h.size.w).toBeGreaterThan(0);
      expect(h.size.h).toBeGreaterThan(0);
      expect(effects).toContain(h.onHit.effect);
      expect(h.weight).toBeGreaterThan(0);
      expect(h.minDistanceM).toBeGreaterThanOrEqual(0);
      expect(['ground', 'air']).toContain(h.placement);
      expect(PALETTE_KEYS).toContain(h.colorKey);
      expect(h.spawn.baseChance).toBeGreaterThan(0);
      expect(h.spawn.baseChance).toBeLessThanOrEqual(BIOME_HAZARD_MAX_CHANCE); // B1 presence amendment (c): 0.75 for hazards
    }
    for (const p of biomePu) {
      expect(c.biomes[p.biome]).toBeDefined();
      expect(typeof p.shapeKey).toBe('string');
      expect(p.radius).toBeGreaterThan(0);
      expect(['slowmo', 'speedBoost', 'shield', 'ward', 'glide', 'stabilize']).toContain(p.effect.kind);
      expect(PALETTE_KEYS).toContain(p.colorKey);
      expect(p.spawn.baseChance).toBeGreaterThan(0);
      expect(p.spawn.baseChance).toBeLessThanOrEqual(BIOME_SPAWN_MAX_CHANCE);
    }
  });

  test('every new shapeKey has its own drawing (never the generic fallback); crash hazards are `danger`', () => {
    for (const h of biomeHaz) expect({ id: h.id, draw: hazardDrawKind(h) }).toEqual({ id: h.id, draw: h.shapeKey });
    for (const p of biomePu) expect({ id: p.id, draw: powerupDrawKind(p) }).toEqual({ id: p.id, draw: p.shapeKey });
    const keys = [...biomeHaz, ...biomePu].map((d) => d.shapeKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const h of biomeHaz.filter((d) => d.onHit.effect === 'crash')) {
      expect(h.colorKey).toBe('danger');
      expect(hazardColorKey(h)).toBe('danger');
    }
  });
});

describe('B1 content: the spec §4 values', () => {
  test('Debumont: Groomer Cat slow 0.7 x 900 ms on the ground; Maple Wax speedBoost 1.2 x 2 s', () => {
    expect(c.hazards.groomerCat).toMatchObject({ placement: 'ground', onHit: { effect: 'slow', speedFactor: 0.7, durationMs: 900 } });
    expect(c.hazards.groomerCat.motion).toBeUndefined(); // static in B1; motion kinds land in B3
    expect(c.powerups.mapleWax.effect).toEqual({ kind: 'speedBoost', speedFactor: 1.2, durationMs: 2000 });
  });

  test('Garbage Dump Glacier: Seagull Dive is an air crash hazard; Slick Wax Spray wards stickyPatch 4 s + speed 1.1', () => {
    expect(c.hazards.seagullDive).toMatchObject({ placement: 'air', onHit: { effect: 'crash' }, colorKey: 'danger' });
    expect(c.powerups.slickWaxSpray.effect).toEqual({ kind: 'ward', durationMs: 4000, mods: ['stickyPatch'], hazards: [], effects: [], speedFactor: 1.1 });
  });

  test('Underwater Mountain: Seaweed Tangle slow 0.6 x 1.2 s; Aqua-Lung Bubble wards slowMotion 4 s', () => {
    expect(c.hazards.seaweedTangle).toMatchObject({ placement: 'ground', onHit: { effect: 'slow', speedFactor: 0.6, durationMs: 1200 } });
    expect(c.powerups.aquaLungBubble.effect).toEqual({ kind: 'ward', durationMs: 4000, mods: ['slowMotion'], hazards: [], effects: [] });
  });

  test('Candy Cane Canyon: Chocolate River is a wide ground strip, slow 0.6 x 1.5 s; Sweet-Tooth wards slow effects 5 s', () => {
    const r = c.hazards.chocolateRiver;
    expect(r).toMatchObject({ placement: 'ground', onHit: { effect: 'slow', speedFactor: 0.6, durationMs: 1500 } });
    expect(r.size.w).toBeGreaterThanOrEqual(3 * r.size.h); // a strip: much wider than tall
    expect(c.powerups.sweetToothCoating.effect).toEqual({ kind: 'ward', durationMs: 5000, mods: [], hazards: [], effects: ['slow'] });
  });
});

describe('B1 content: each ward counters its own biome', () => {
  test('ward durations are inside the spec band (4-6 s), so Wards.addWard keeps them unchanged', () => {
    for (const p of biomePu.filter((d) => d.effect.kind === 'ward')) {
      expect(p.effect.durationMs).toBeGreaterThanOrEqual(WARD_MIN_MS);
      expect(p.effect.durationMs).toBeLessThanOrEqual(WARD_MAX_MS);
    }
  });

  test('a ward\'s mods are its biome\'s signature mod, and exist as terrain mods', () => {
    for (const p of biomePu.filter((d) => d.effect.kind === 'ward')) {
      for (const m of p.effect.mods) {
        expect(c.terrainMods[m]).toBeDefined();
        expect({ ward: p.id, mod: m }).toEqual({ ward: p.id, mod: c.biomes[p.biome].mod });
      }
    }
  });

  test('Sweet-Tooth Coating wards off the Chocolate River (and nothing it should not)', () => {
    const w = addWard(emptyWards(), 'sweetToothCoating', c.powerups.sweetToothCoating.effect);
    expect(isWarded(w, { effect: c.hazards.chocolateRiver.onHit.effect })).toBe(true);
    expect(isWarded(w, { effect: 'crash' })).toBe(false);
    expect(isWarded(w, { modId: 'sugarRush' })).toBe(false);
  });

  test('Slick Wax Spray wards stickyPatch; Aqua-Lung Bubble wards slowMotion', () => {
    expect(isWarded(addWard(emptyWards(), 'slickWaxSpray', c.powerups.slickWaxSpray.effect), { modId: 'stickyPatch' })).toBe(true);
    expect(isWarded(addWard(emptyWards(), 'aquaLungBubble', c.powerups.aquaLungBubble.effect), { modId: 'slowMotion' })).toBe(true);
  });
});

describe('Wards.js B1 extension: optional ward speedFactor', () => {
  test('wardSpeedFactor: 1 when absent, clamped to [1, WARD_MAX_SPEED_FACTOR] (a bonus, never a slow)', () => {
    expect(WARD_MAX_SPEED_FACTOR).toBe(1.2);
    expect(wardSpeedFactor(undefined)).toBe(1);
    expect(wardSpeedFactor(1.1)).toBe(1.1);
    expect(wardSpeedFactor(0.5)).toBe(1);
    expect(wardSpeedFactor(3)).toBe(1.2);
  });

  test('wardSpeedMul: product over active wards; ends with the ward; plain wards add nothing', () => {
    let w = addWard(emptyWards(), 'slickWaxSpray', c.powerups.slickWaxSpray.effect);
    w = addWard(w, 'aquaLungBubble', c.powerups.aquaLungBubble.effect);
    expect(wardSpeedMul(w)).toBeCloseTo(1.1, 12);
    expect(wardSpeedMul(emptyWards())).toBe(1);
    expect(wardSpeedMul(null)).toBe(1);
    tickWards(w, 4001);
    expect(wardSpeedMul(w)).toBe(1);
  });
});

describe('B1 content: measured presence in biome chunks (slot rule, spec §4 amendment)', () => {
  // Long-range floors (8 seeds x 300 chunks). After the presence amendment the measured shares of ELIGIBLE chunks are
  // groomerCat 42.5 %, seagullDive 33.5 %, seaweedTangle 44.2 %, chocolateRiver 27.3 %; the early-terrain target and its
  // open items live in biome-b1-presence.test.js. These floors stay as a second, long-range regression pin.
  const ROWS = [
    [1, 'debumont', 'groomerCat', 'mapleWax', 0.08],
    [2, 'garbage-dump-glacier', 'seagullDive', 'slickWaxSpray', 0.12],
    [8, 'underwater-mountain', 'seaweedTangle', 'aquaLungBubble', 0.06],
    [64, 'candy-cane-canyon', 'chocolateRiver', 'sweetToothCoating', 0.05],
  ];
  test.each(ROWS)('mask %p (%s): hazard %s, power-up %s, hazard share of eligible chunks >= %p, power-up in 25-45 %% of biome chunks', (mask, biome, hz, pu, floor) => {
    const air = c.hazards[hz].placement === 'air';
    let all = 0;
    let elig = 0;
    let h = 0;
    let p = 0;
    for (const seed of ['b1-share-a', 'b1-share-b', 'b1-share-c', 'b1-share-d']) {
      const g = makeGen(seed, { biomeMask: mask });
      for (let i = 1; i < 300; i++) {
        const ch = g.getChunk(i);
        if (ch.biome !== biome) continue;
        all++;
        const ok = air ? ch.defId === 'gen-jump' : ch.kind !== 'bridge' && ch.defId !== 'gen-jump';
        if (ok) elig++;
        if (ch.hazards.some((q) => q.defId === hz)) h++;
        if (ch.powerups.some((q) => q.defId === pu)) p++;
      }
    }
    expect(elig).toBeGreaterThan(60);
    expect(h / elig).toBeGreaterThanOrEqual(floor);
    expect(p / all).toBeGreaterThanOrEqual(0.25);
    expect(p / all).toBeLessThanOrEqual(0.45);
  });
});

describe('B1 invariant: same seed + mask gives identical terrain twice (shipped content)', () => {
  test.each([1, 2, 8, 64])('mask %p: two generators, forward and reverse call order, deep-equal over 150 chunks', (mask) => {
    const snap = (ch) => JSON.parse(JSON.stringify(ch));
    const a = makeGen('b1-det', { biomeMask: mask });
    const b = makeGen('b1-det', { biomeMask: mask });
    const rev = [];
    for (let i = 149; i >= 0; i--) rev[i] = snap(b.getChunk(i));
    let biomeSpawns = 0;
    for (let i = 0; i < 150; i++) {
      const ch = snap(a.getChunk(i));
      expect(ch).toEqual(rev[i]);
      biomeSpawns += [...ch.hazards, ...ch.powerups].filter((s) => (c.hazards[s.defId] || c.powerups[s.defId]).biome).length;
    }
    expect(biomeSpawns).toBeGreaterThan(0); // the stream really contains biome spawns
  });
});
