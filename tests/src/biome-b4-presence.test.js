/**
 * B4 "Air" placement: presence (spec §4 presence amendment, same target and method as biome-b2-presence.test.js), the
 * low-gravity fairness rule for biome air boxes (TerrainGenerator.flightGravityMul: under Space Mountain's lowGravity zone
 * a no-hop flight drops less, so the Meteor box is lifted to keep AIR_CLEARANCE_PX over the flatter arc), and determinism
 * for masks 32 and 128 (shipped content).
 */
import { makeGen, loadContent } from './_helpers.js';
import { flightGravityMul } from '../../src/systems/TerrainGenerator.js';

const c = loadContent();
const SEEDS = ['pres1', 'pres2', 'pres3', 'pres4', 'pres5', 'pres6', 'pres7', 'pres8'];
const ROB = Array.from({ length: 32 }, (_, k) => `rob${k + 1}`);
// re-pinned for #65: Debutmont base + arcade bridges. Same re-assessment as biome-b1-presence.test.js: the generator's hazard
// rates are unchanged (400 seeds, +/-0.02), the sample is ~25 % smaller because each biome sector opens with an arcade bridge,
// so the band is asserted on BIG (150 seeds) and the per-seed 1-per-2-km rule on seeds with >= SHORT_KM of the biome.
const BIG = Array.from({ length: 150 }, (_, k) => `big${k + 1}`);
const SHORT_KM = 1;
/** Air hazards are placed only in generated jumps (isJump). */
const eligible = (ch) => ch.defId === 'gen-jump';

function presence(mask, biome, id, seeds) {
  let elig = 0;
  let has = 0;
  const perSeed = [];
  for (const seed of seeds) {
    const g = makeGen(seed, { biomeMask: mask });
    let km = 0;
    let n = 0;
    for (let i = 1; i < 45; i++) {
      const ch = g.getChunk(i);
      if (ch.biome !== biome) continue;
      km += (ch.endX - ch.startX) / 20000;
      const here = ch.hazards.some((q) => q.defId === id);
      if (here) n++;
      if (eligible(ch)) { elig++; if (here) has++; }
    }
    perSeed.push({ seed, n, km: +km.toFixed(2), ok: km < SHORT_KM || n * 2 >= km });
  }
  const share = has / elig;
  console.log(`${id} (${seeds.length} seeds): ${has}/${elig} eligible = ${(100 * share).toFixed(1)} %; per seed ${perSeed.map((p) => `${p.n}/${p.km}km`).join(' ')}`);
  return { elig, share, perSeed, fails: perSeed.filter((p) => !p.ok).length };
}

describe('B4 presence: the biome hazard is felt in early terrain (chunks 0-44, single biome bit)', () => {
  // Both B4 hazards are air hazards: like B1's Seagull Dive and B2's Ash Cloud they sit only in a generated jump of their
  // biome, above the no-hop arc, with the chance at the 0.75 cap. The band holds; the 1-per-2-km rule fails on seeds
  // with few generated jumps in their biome sectors (OPEN for the lead, as for seagullDive / ashCloud).
  test.each([
    [32, 'space-mountain', 'meteor', 2, 6],
    [128, 'sky-jellyfish-mountain', 'gustFront', 2, 6],
  ])('mask %p (%s): %s meets the 35-60 %% band (150 seeds); 1-per-2-km misses (seeds with >= 1 km of biome) at most %p / 8 and %p / 32 seeds', (mask, biome, id, f8, f32) => {
    const a = presence(mask, biome, id, SEEDS);
    expect(a.elig).toBeGreaterThanOrEqual(10);
    expect(a.fails).toBeLessThanOrEqual(f8);
    const b = presence(mask, biome, id, ROB);
    expect(b.fails).toBeLessThanOrEqual(f32); // 2 of ~22 seeds with >= 1 km of biome at #65 (an air hazard needs a generated jump)
    const big = presence(mask, biome, id, BIG);
    expect(big.share).toBeGreaterThanOrEqual(0.35);
    expect(big.share).toBeLessThanOrEqual(0.6);
  });
});

describe('B4 presence: long range (16 seeds x 300 chunks), hazard floor and power-up band', () => {
  // re-pinned for #65: Debutmont base + arcade bridges. The sample grew from 4 seeds to 16 (the original four first): bridges
  // took ~25 % of the biome chunks, and 4 seeds now read meteor 29.2 % / gustFront 28.9 % (below both old floors) while 60
  // seeds read 34.1 / 33.7 % before #65 and 34.8 / 33.3 % after, i.e. the placement rate did not move. gustFront's old 0.35
  // floor came from one lucky 4-seed sample (35.6 %); its rate was 33.7 % over 60 seeds even then, so its floor is 0.3 like meteor's.
  const LONG = [...['b1-share-a', 'b1-share-b', 'b1-share-c', 'b1-share-d'], ...Array.from({ length: 12 }, (_, k) => `b4-share-${k + 1}`)];
  const ROWS = [
    // measured 33.5 % at long range (119 / 355): Space's generated jumps past 2 km often carry a base air hazard already
    // (one air box per jump), so the floor is 0.3 (B2's Vertigo row uses 0.25 for the same reason)
    [32, 'space-mountain', 'meteor', 'gravityStabilizer', 0.3, 0.25, 0.45],
    [128, 'sky-jellyfish-mountain', 'gustFront', 'stabilizerRails', 0.3, 0.25, 0.45],
  ];
  test.each(ROWS)('mask %p (%s): hazard %s, power-up %s, hazard share of eligible chunks >= %p, power-up share of biome chunks in [%p, %p]', (mask, biome, hz, pu, floor, lo, hi) => {
    let all = 0;
    let elig = 0;
    let h = 0;
    let p = 0;
    for (const seed of LONG) {
      const g = makeGen(seed, { biomeMask: mask });
      for (let i = 1; i < 300; i++) {
        const ch = g.getChunk(i);
        if (ch.biome !== biome) continue;
        all++;
        if (eligible(ch)) elig++;
        if (ch.hazards.some((q) => q.defId === hz)) h++;
        if (ch.powerups.some((q) => q.defId === pu)) p++;
      }
    }
    console.log(`${hz}: ${h}/${elig} eligible = ${(100 * h / elig).toFixed(1)} %; ${pu}: ${p}/${all} = ${(100 * p / all).toFixed(1)} %`);
    expect(elig).toBeGreaterThan(60);
    expect(h / elig).toBeGreaterThanOrEqual(floor);
    expect(p / all).toBeGreaterThanOrEqual(lo);
    expect(p / all).toBeLessThanOrEqual(hi);
  });
});

describe('B4 low-gravity fairness: a Meteor stays above every no-hop arc under the zone gravity', () => {
  const MODS = c.terrainMods;
  test('flightGravityMul: product of the gravityMul < 1 of the zones over the flight span; 1 with none (and gravityMul > 1 never lowers the box)', () => {
    const map = { lowGravity: MODS.lowGravity, compression: MODS.compression, bouncySpring: MODS.bouncySpring };
    expect(MODS.lowGravity.physics.gravityMul).toBe(0.7);
    expect(flightGravityMul([], map, 0, 500)).toBe(1);
    expect(flightGravityMul([{ modId: 'lowGravity', x0: 100, x1: 300 }], map, 0, 500)).toBeCloseTo(0.7, 12);
    expect(flightGravityMul([{ modId: 'lowGravity', x0: 600, x1: 900 }], map, 0, 500)).toBe(1); // outside the span
    expect(flightGravityMul([{ modId: 'lowGravity', x0: -300, x1: 10 }], map, 0, 500)).toBeCloseTo(0.7, 12); // overlaps the lip
    expect(flightGravityMul([{ modId: 'bouncySpring', x0: 0, x1: 500 }], map, 0, 500)).toBe(1); // no gravityMul
    expect(flightGravityMul([{ modId: 'compression', x0: 0, x1: 500 }], map, 0, 500)).toBe(1); // heavier: arcs only drop more
    expect(flightGravityMul([{ modId: 'lowGravity', x0: 0, x1: 200 }, { modId: 'lowGravity', x0: 250, x1: 500 }], map, 0, 500)).toBeCloseTo(0.49, 12);
    expect(flightGravityMul([{ modId: 'nope', x0: 0, x1: 500 }], map, 0, 500)).toBe(1);
  });

  test('every Meteor whose flight crosses a lowGravity zone is placed higher than it would be at normal gravity; the others are unchanged', () => {
    // control: the same content with lowGravity's gravity at 1 (the arc model's own g), so only the fairness lift differs
    const flat = { ...MODS, lowGravity: { ...MODS.lowGravity, physics: { ...MODS.lowGravity.physics, gravityMul: 1 } } };
    let lifted = 0;
    let same = 0;
    for (let s = 1; s <= 12; s++) {
      const a = makeGen(`rob${s}`, { biomeMask: 32 });
      const b = makeGen(`rob${s}`, { biomeMask: 32, modDefs: flat });
      for (let i = 1; i < 150; i++) {
        const ca = a.getChunk(i);
        const cb = b.getChunk(i);
        const ma = ca.hazards.filter((h) => h.defId === 'meteor');
        const mb = cb.hazards.filter((h) => h.defId === 'meteor');
        expect(ma.map((h) => h.x)).toEqual(mb.map((h) => h.x)); // same slots and x: only the height may move
        for (let k = 0; k < ma.length; k++) {
          let lip = null;
          for (const l of ca.launches) if (l.x < ma[k].x && (!lip || l.x > lip.x)) lip = l;
          const low = ca.zones.some((z) => z.modId === 'lowGravity' && z.x0 <= lip.landX && z.x1 >= lip.x);
          if (low) { expect(ma[k].y).toBeLessThan(mb[k].y - 10); lifted++; } else { expect(ma[k].y).toBe(mb[k].y); same++; }
        }
      }
    }
    console.log(`meteors lifted by the low-gravity rule: ${lifted}, unchanged: ${same}`);
    expect(lifted).toBeGreaterThan(10);
    expect(same).toBeGreaterThan(10);
  });
});

describe('B4 invariant: same seed + mask gives identical terrain twice (shipped content)', () => {
  test.each([32, 128])('mask %p: two generators, forward and reverse call order, deep-equal over 150 chunks', (mask) => {
    const snap = (ch) => JSON.parse(JSON.stringify(ch));
    const a = makeGen('b4-det', { biomeMask: mask });
    const b = makeGen('b4-det', { biomeMask: mask });
    const rev = [];
    for (let i = 149; i >= 0; i--) rev[i] = snap(b.getChunk(i));
    let biomeSpawns = 0;
    for (let i = 0; i < 150; i++) {
      const ch = snap(a.getChunk(i));
      expect(ch).toEqual(rev[i]);
      biomeSpawns += [...ch.hazards, ...ch.powerups].filter((s) => (c.hazards[s.defId] || c.powerups[s.defId]).biome).length;
    }
    expect(biomeSpawns).toBeGreaterThan(0);
  });
});
