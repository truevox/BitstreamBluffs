/**
 * B2 "Sight" placement: presence (spec §4 presence amendment, same target and method as biome-b1-presence.test.js), the
 * blind fairness rule (TerrainGenerator.blindClearAheadPx: no crash hazard in the stretch the sled rides blinded), and
 * determinism for masks 16 and 1024 (shipped content).
 */
import { makeGen, loadContent } from './_helpers.js';
import {
  BIOME_HAZARD_CLEARANCE_PX, BIOME_BLIND_REACT_MS, BIOME_BLIND_SPEED_MUL, blindClearAheadPx, expectedSpeedPxS,
} from '../../src/systems/TerrainGenerator.js';

const c = loadContent();
const SEEDS = ['pres1', 'pres2', 'pres3', 'pres4', 'pres5', 'pres6', 'pres7', 'pres8'];
const ROB = Array.from({ length: 32 }, (_, k) => `rob${k + 1}`);
/** Chunks the generator can place the def in: air hazards only in generated jumps (isJump), ground never in a bridge or jump. */
const eligibleFor = (def, ch) => (def.placement === 'air' ? ch.defId === 'gen-jump' : ch.kind !== 'bridge' && ch.defId !== 'gen-jump');
const isCrash = (id) => { const d = c.hazards[id]; return !d.onHit || d.onHit.effect === 'crash'; };

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

describe('B2 presence: the biome hazard is felt in early terrain (chunks 0-44, single biome bit)', () => {
  test('mask 16 (crystal-cavern): shatterWall meets the full target (band on 8 and 32 seeds, 1 per 2 km on every seed)', () => {
    const a = presence(16, 'crystal-cavern', 'shatterWall', SEEDS);
    expect(a.elig).toBeGreaterThanOrEqual(15);
    expect(a.share).toBeGreaterThanOrEqual(0.35);
    expect(a.share).toBeLessThanOrEqual(0.55);
    for (const p of a.perSeed) expect(p).toMatchObject({ ok: true });
    const b = presence(16, 'crystal-cavern', 'shatterWall', ROB);
    expect(b.share).toBeGreaterThanOrEqual(0.35);
    expect(b.share).toBeLessThanOrEqual(0.55);
    expect(b.fails).toBeLessThanOrEqual(2); // measured 2/30: seeds with < 1 km of Crystal terrain in chunks 0-44
  });

  test('mask 1024 (vertigo-vents): ashCloud meets the band; OPEN for the lead (as B1 seagullDive): the 1-per-2-km rule fails on some seeds', () => {
    // An air hazard sits only in a generated jump of a Vertigo sector, above the no-hop arc (the existing air pass; the
    // spec's "air zone" uses it, as "no new mechanism" for Vertigo requires). Chance is at the 0.75 cap already.
    const a = presence(1024, 'vertigo-vents', 'ashCloud', SEEDS);
    expect(a.share).toBeGreaterThanOrEqual(0.35);
    expect(a.share).toBeLessThanOrEqual(0.55);
    expect(a.fails).toBeLessThanOrEqual(2); // measured 2 of the 6 seeds with Vertigo terrain
    const b = presence(1024, 'vertigo-vents', 'ashCloud', ROB);
    expect(b.share).toBeGreaterThanOrEqual(0.35);
    expect(b.share).toBeLessThanOrEqual(0.55);
    expect(b.fails).toBeLessThanOrEqual(5); // measured 4/30
  });
});

describe('B2 presence: long range (4 seeds x 300 chunks), hazard floor and power-up band', () => {
  const ROWS = [
    [16, 'crystal-cavern', 'shatterWall', 'crystalClearGoggles', 0.35, 0.25, 0.45],
    // Heat Shield chance 0.25 (19 % of Vertigo chunks), below B1's 25-45 % power-up band on purpose: at 0.4 (32 %) the
    // extra shield charges lifted hop survival on mask 1024 by +22 % (18 -> 22 of 48), outside the +/-15 % sim tolerance.
    [1024, 'vertigo-vents', 'ashCloud', 'heatShield', 0.25, 0.12, 0.3],
  ];
  test.each(ROWS)('mask %p (%s): hazard %s, power-up %s, hazard share of eligible chunks >= %p, power-up share of biome chunks in [%p, %p]', (mask, biome, hz, pu, floor, lo, hi) => {
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
        if (eligibleFor(c.hazards[hz], ch)) elig++;
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

/** Every hazard of 300 chunks of one seed + mask, in x order. */
function allHazards(seed, mask) {
  const g = makeGen(seed, { biomeMask: mask });
  const out = [];
  for (let i = 0; i < 300; i++) { const ch = g.getChunk(i); for (const h of ch.hazards) out.push({ ...h, chunk: ch.index, endX: ch.endX }); }
  return out;
}

describe('B2 blind fairness: a hazard hidden by blind is not a cheap death', () => {
  test('blindClearAheadPx = (durationMs + react) at 1.2 x the expected speed', () => {
    expect(BIOME_BLIND_REACT_MS).toBe(500);
    expect(BIOME_BLIND_SPEED_MUL).toBe(1.2);
    expect(blindClearAheadPx({ durationMs: 1200 }, 2000)).toBe(Math.round(expectedSpeedPxS(2000) * 1.2 * 1.7));
    expect(blindClearAheadPx({}, 0)).toBe(Math.round(340 * 1.2 * 1.7));
  });

  test('no Shatter Wall has a crash hazard of its own chunk inside its blind stretch; keeps 240 px from every hazard', () => {
    let n = 0;
    for (const seed of ['fair1', 'fair2', 'fair3', 'fair4', 'fair5', 'fair6', 'fair7', 'fair8']) {
      const hs = allHazards(seed, 16);
      for (const w of hs.filter((h) => h.defId === 'shatterWall')) {
        n++;
        const ahead = blindClearAheadPx(c.hazards.shatterWall.onHit, w.x / 20);
        for (const q of hs) {
          if (q === w) continue;
          expect(Math.abs(q.x - w.x)).toBeGreaterThanOrEqual(BIOME_HAZARD_CLEARANCE_PX);
          if (q.chunk === w.chunk && q.x > w.x && isCrash(q.defId)) expect({ id: q.defId, gap: q.x - w.x, ok: q.x - w.x > ahead }).toMatchObject({ ok: true });
        }
      }
    }
    expect(n).toBeGreaterThan(100);
  });

  test('measured: under 5 % of Shatter Walls (and no Ash Cloud) meet a crash hazard within the 1.2 s blind at the expected speed', () => {
    // Without the rule 268 of 910 Shatter Walls (29 %) did. The residue is all in the NEXT chunk, which the pass cannot see.
    for (const [mask, id, max] of [[16, 'shatterWall', 0.05], [1024, 'ashCloud', 0]]) {
      let n = 0;
      let met = 0;
      let sameChunk = 0;
      for (let s = 1; s <= 32; s++) {
        const hs = allHazards(`fair${s}`, mask);
        for (const w of hs.filter((h) => h.defId === id)) {
          n++;
          const next = hs.find((q) => q.x > w.x && isCrash(q.defId));
          if (next && next.x - w.x <= expectedSpeedPxS(w.x / 20) * 1.2) { met++; if (next.chunk === w.chunk) sameChunk++; }
        }
      }
      console.log(`${id}: ${met}/${n} placements meet a crash hazard within the 1.2 s blind at the expected speed (${sameChunk} in the same chunk)`);
      expect(n).toBeGreaterThan(200);
      expect(met / n).toBeLessThanOrEqual(max);
      expect(sameChunk).toBe(0);
    }
  });

  // The rule binds only `blind` defs: masks 1, 2, 8, 64 (B1 content) keep their e080803 digests in
  // micro-swell-isolation.test.js, which still includes every B1 def.
});

describe('B2 invariant: same seed + mask gives identical terrain twice (shipped content)', () => {
  test.each([16, 1024])('mask %p: two generators, forward and reverse call order, deep-equal over 150 chunks', (mask) => {
    const snap = (ch) => JSON.parse(JSON.stringify(ch));
    const a = makeGen('b2-det', { biomeMask: mask });
    const b = makeGen('b2-det', { biomeMask: mask });
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
