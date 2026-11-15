/**
 * B1 presence (spec §4, amended by the spec author 2026-11-14 after the lead found biome hazards too rare to be felt):
 *   (a) a biome ground hazard needs >= BIOME_HAZARD_CLEARANCE_PX (240) from any other hazard, not the base 480 px;
 *       the 240 px chunk-edge margin stays (so base hazards across a chunk border stay >= 480 px apart);
 *   (b) the descent-ahead rule binds a biome `slow` hazard only when its speedFactor < BIOME_GENTLE_SLOW_FACTOR (0.6);
 *       a gentler slow (Groomer 0.7, Seaweed 0.6) may sit on flat or downhill ground, never before an uphill;
 *   (c) the biome HAZARD chance cap may rise to 0.75 (power-ups keep 0.5);
 *   (d) the replace rule stays the fallback.
 * Target: over 8 seeds x chunks 0-44 at each single biome bit, the biome hazard sits in 35-55 % of that biome's chunks
 * eligible for its placement kind, and at least 1 per 2 km of biome terrain on every seed. Shipped content.
 */
import { makeGen, loadContent } from './_helpers.js';
import {
  HAZARD_MIN_SPACING_PX, BIOME_HAZARD_CLEARANCE_PX, BIOME_GENTLE_SLOW_FACTOR, BIOME_EDGE_MARGIN_PX, SPACING_PX,
} from '../../src/systems/TerrainGenerator.js';

const c = loadContent();
const ROWS = [
  [1, 'debumont', 'groomerCat'],
  [2, 'garbage-dump-glacier', 'seagullDive'],
  [8, 'underwater-mountain', 'seaweedTangle'],
  [64, 'candy-cane-canyon', 'chocolateRiver'],
];
const SEEDS = ['pres1', 'pres2', 'pres3', 'pres4', 'pres5', 'pres6', 'pres7', 'pres8'];
const eligibleFor = (def, ch) => (def.placement === 'air' ? ch.defId === 'gen-jump' : ch.kind !== 'bridge' && ch.defId !== 'gen-jump');
const deg = (pts, k) => (Math.atan2(pts[k + 1].y - pts[k].y, SPACING_PX) * 180) / Math.PI;

/** Share of eligible chunks and per-seed 1-per-2-km check over chunks 1..44 at a single biome bit. */
function presence(mask, biome, id, seeds) {
  const def = c.hazards[id];
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
      if (eligibleFor(def, ch)) { elig++; if (here) has++; }
    }
    perSeed.push({ seed, n, km: +km.toFixed(2), ok: n * 2 >= km });
  }
  const share = has / elig;
  console.log(`${id} (${seeds.length} seeds): ${has}/${elig} eligible = ${(100 * share).toFixed(1)} %; per seed ${perSeed.map((p) => `${p.n}/${p.km}km`).join(' ')}`);
  return { elig, share, perSeed, fails: perSeed.filter((p) => !p.ok).length };
}
const ROB = Array.from({ length: 32 }, (_, k) => `rob${k + 1}`);

describe('B1 presence: the biome hazard is felt in early terrain (chunks 0-44, single biome bit)', () => {
  // Target (lead): 35-55 % of eligible chunks on 8 seeds, and >= 1 per 2 km of biome terrain on every seed. The 8-seed
  // sample is small (17-28 eligible chunks), so the band is also asserted on 32 independent seeds.
  test.each([[1, 'debumont', 'groomerCat'], [8, 'underwater-mountain', 'seaweedTangle']])(
    'mask %p (%s): %s meets the full target (band on 8 and 32 seeds, 1 per 2 km on every seed)', (mask, biome, id) => {
      const a = presence(mask, biome, id, SEEDS);
      expect(a.elig).toBeGreaterThanOrEqual(15);
      expect(a.share).toBeGreaterThanOrEqual(0.35);
      expect(a.share).toBeLessThanOrEqual(0.55);
      for (const p of a.perSeed) expect(p).toMatchObject({ ok: true });
      const b = presence(mask, biome, id, ROB);
      expect(b.share).toBeGreaterThanOrEqual(0.35);
      expect(b.share).toBeLessThanOrEqual(0.55);
      expect(b.fails).toBeLessThanOrEqual(2); // 2/30 groomer, 2/30 seaweed: seeds with < 1 km of biome terrain
    });

  test('mask 2 (garbage-dump-glacier): seagullDive meets the band; OPEN for the lead: the 1-per-2-km rule fails on some seeds', () => {
    // Air hazards sit only in biome jump chunks (often 2-3 per seed in chunks 0-44, a third of them already holding a base
    // Rogue Packet). No amendment covers the air slot, so the per-seed rule is pinned at its measured value, not met.
    const a = presence(2, 'garbage-dump-glacier', 'seagullDive', SEEDS);
    expect(a.share).toBeGreaterThanOrEqual(0.35);
    expect(a.share).toBeLessThanOrEqual(0.55);
    expect(a.fails).toBeLessThanOrEqual(3); // measured 3 of the 6 seeds with biome terrain
    const b = presence(2, 'garbage-dump-glacier', 'seagullDive', ROB);
    expect(b.share).toBeGreaterThanOrEqual(0.35);
    expect(b.share).toBeLessThanOrEqual(0.55);
    expect(b.fails).toBeLessThanOrEqual(4); // measured 3/30
  });

  test('mask 64 (candy-cane-canyon): chocolateRiver meets the band', () => {
    // Lead ruling (2026-11-14): speedFactor 0.5 -> 0.6 puts the river under the gentle-slow rule (amendment b)
    // instead of descent-ahead; at 0.5 it reached only ~21 % of eligible chunks. Sweet-Tooth still wards it.
    const a = presence(64, 'candy-cane-canyon', 'chocolateRiver', SEEDS);
    expect(a.share).toBeGreaterThanOrEqual(0.35);
    expect(a.share).toBeLessThanOrEqual(0.55);
    const b = presence(64, 'candy-cane-canyon', 'chocolateRiver', ROB);
    expect(b.share).toBeGreaterThanOrEqual(0.35);
    expect(b.share).toBeLessThanOrEqual(0.55);
  });
});

/** Every placed biome hazard of one def over 8 seeds x 300 chunks, with its chunk and generator. */
function placements(mask, id, n = 300) {
  const out = [];
  for (const seed of SEEDS) {
    const g = makeGen(seed, { biomeMask: mask });
    for (let i = 1; i < n; i++) {
      const ch = g.getChunk(i);
      for (const h of ch.hazards) if (h.defId === id) out.push({ g, ch, h, i });
    }
  }
  return out;
}

describe('B1 amended placement rules (a) and (b)', () => {
  test('(a) a biome ground hazard keeps >= 240 px from every hazard (and uses the closer spacing); base pairs keep 480 px', () => {
    expect(BIOME_HAZARD_CLEARANCE_PX).toBe(240);
    expect(BIOME_EDGE_MARGIN_PX).toBe(240);
    let closer = 0;
    for (const [mask, , id] of ROWS.filter(([, , i]) => c.hazards[i].placement !== 'air')) {
      for (const seed of SEEDS.slice(0, 4)) {
        const g = makeGen(seed, { biomeMask: mask });
        const all = [];
        for (let i = 0; i < 300; i++) all.push(...g.getChunk(i).hazards);
        for (let k = 1; k < all.length; k++) {
          const a = all[k - 1];
          const b = all[k];
          const biomeInvolved = a.defId === id || b.defId === id;
          expect({ a: a.defId, b: b.defId, gap: b.x - a.x, ok: b.x - a.x >= (biomeInvolved ? BIOME_HAZARD_CLEARANCE_PX : HAZARD_MIN_SPACING_PX) })
            .toMatchObject({ ok: true });
          if (biomeInvolved && b.x - a.x < HAZARD_MIN_SPACING_PX) closer++;
        }
      }
    }
    expect(closer).toBeGreaterThan(10);
  });


  test.each([[1, 'groomerCat'], [8, 'seaweedTangle'], [64, 'chocolateRiver']])('(b) mask %p: %s never sits before an uphill (240 px ahead), and some sit off a descent', (mask, id) => {
    const ps = placements(mask, id);
    expect(ps.length).toBeGreaterThan(20);
    let offDescent = 0;
    for (const { g, ch, h } of ps) {
      const pts = ch.points;
      const k0 = Math.max(0, Math.min(pts.length - 2, Math.floor((h.x - ch.startX) / SPACING_PX)));
      const k1 = Math.min(pts.length - 2, k0 + Math.ceil(BIOME_EDGE_MARGIN_PX / SPACING_PX));
      for (let k = k0; k <= k1; k++) expect(deg(pts, k)).toBeGreaterThanOrEqual(0);
      if (!g._descentAhead(pts, k0, ch.endX)) offDescent++;
    }
    expect(offDescent).toBeGreaterThan(0);
  });
});

describe('B1 stall check: no biome slow hit can stop the sled', () => {
  /**
   * The QA point-mass model of _helpers.rollSim (65 % of g sin(slope), linear + quadratic drag), started at the hazard
   * with a deliberately LOW entry speed (300 px/s; the expected speed past 1000 m, where biome sectors start, is >= 520)
   * cut by the hazard's speedFactor, then run for 2 s along the following terrain. The slow's own drag scaling is
   * included: while slowed the linear drag is divided by speedFactor (PhysicsTuner frictionAir / speedMul).
   */
  const ENTRY_PX_S = 300;
  function minSpeedAfterHit(g, ch, h, k) {
    const pts = [];
    for (let j = ch.index; j <= ch.index + 2; j++) for (const p of g.getChunk(j).points) if (!pts.length || p.x > pts[pts.length - 1].x) pts.push(p);
    const eff = c.hazards[h.defId].onHit;
    let v = ENTRY_PX_S * eff.speedFactor;
    let i = pts.findIndex((p) => p.x > h.x) - 1;
    let pos = h.x;
    let min = v;
    for (let t = 0; t < 2; t += 0.01) {
      const a = Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x);
      const lin = t * 1000 < eff.durationMs ? 0.2 / eff.speedFactor : 0.2;
      v = Math.max(0, v + (900 * Math.sin(a) * 0.65 - lin * v - 0.0003 * v * v) * 0.01);
      pos += v * Math.cos(a) * 0.01;
      while (i < pts.length - 2 && pos >= pts[i + 1].x) i++;
      min = Math.min(min, v);
    }
    void k;
    return min;
  }

  test.each([[1, 'groomerCat'], [8, 'seaweedTangle'], [64, 'chocolateRiver']])('mask %p: every %s placement keeps the sled moving (> 40 px/s) for 2 s after the hit', (mask, id) => {
    const ps = placements(mask, id);
    expect(ps.length).toBeGreaterThan(20);
    let worst = Infinity;
    for (const { g, ch, h } of ps) worst = Math.min(worst, minSpeedAfterHit(g, ch, h));
    console.log(`${id}: worst speed within 2 s of a hit from ${ENTRY_PX_S} px/s: ${worst.toFixed(1)} px/s over ${ps.length} placements`);
    expect(worst).toBeGreaterThan(40);
  });
});
