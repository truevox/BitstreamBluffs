/**
 * B0 (biome full treatment): biome-tagged hazard and power-up defs.
 *
 * Spec §5: a def with a `biome` field never enters the base hazard / air hazard / power-up lists, so
 * base placement and mask-0 output are untouched by construction. Biome spawns come only from the new
 * `_placeBiomeSpawns` pass, on forks 'biomeHaz' / 'biomePu', inside chunks whose biome is set.
 */
import { makeGen, loadContent } from './_helpers.js';
import { withBiomeFixtures } from './_biomeFixtures.js';
import {
  HAZARD_MIN_SPACING_PX, BIOME_SPAWN_MAX_CHANCE, BIOME_EDGE_MARGIN_PX, BIOME_SLOT_DRAWS,
} from '../../src/systems/TerrainGenerator.js';
import { FX_GROUND_HAZARD, FX_AIR_HAZARD, FX_WARD_POWERUP, FX_STABILIZE_POWERUP, FX_MASK } from './_biomeFixtures.js';

const content = loadContent();

/** Every field, keys sorted, numbers rounded to 4 dp: the golden test's `complete` projection. */
const round = (n) => (Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : n);
const completeOf = (v) =>
  Array.isArray(v)
    ? v.map(completeOf)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, completeOf(v[k])]))
      : typeof v === 'number'
        ? round(v)
        : v;

describe('isolation: biome-tagged defs change NOTHING at mask 0', () => {
  test('300 chunks x 3 seeds: the full-chunk projection is identical with and without the biome defs', () => {
    const fx = withBiomeFixtures(content);
    for (const seed of ['iso-alpha', 'iso-beta', '2026-11-14']) {
      const withDefs = makeGen(seed, { biomeMask: 0, ...fx });
      const without = makeGen(seed, { biomeMask: 0 });
      for (let i = 0; i < 300; i++) {
        expect(completeOf(withDefs.getChunk(i))).toEqual(completeOf(without.getChunk(i)));
      }
    }
  });
});

describe('constructor filter: biome defs leave the base lists and are kept per biome', () => {
  test('hazardList, airHazardList and powerupList hold no biome def; the per-biome maps hold them', () => {
    const g = makeGen('filter', withBiomeFixtures(content));
    const ids = (l) => l.map((d) => d.id);
    expect(g.hazardList.some((d) => d.biome)).toBe(false);
    expect(g.airHazardList.some((d) => d.biome)).toBe(false);
    expect(g.powerupList.some((d) => d.biome)).toBe(false);
    // base lists are exactly what they were without the fixtures
    const base = makeGen('filter');
    expect(ids(g.hazardList)).toEqual(ids(base.hazardList));
    expect(ids(g.airHazardList)).toEqual(ids(base.airHazardList));
    expect(ids(g.powerupList)).toEqual(ids(base.powerupList));
    expect(ids(g.biomeHazards['garbage-dump-glacier'])).toEqual(['fxGroundHazard']);
    expect(ids(g.biomeHazards['space-mountain'])).toEqual(['fxAirHazard']);
    expect(ids(g.biomePowerups['garbage-dump-glacier'])).toEqual(['fxWardPowerup']);
    expect(ids(g.biomePowerups['space-mountain'])).toEqual(['fxStabilizePowerup']);
  });
});

// ------------------------------------------------------------------------------------------------ placement


const N = 300;
const SEEDS = ['bs-alpha', 'bs-beta', 'bs-gamma', 'bs-delta'];
const FX_IDS = new Set([FX_GROUND_HAZARD.id, FX_AIR_HAZARD.id, FX_WARD_POWERUP.id, FX_STABILIZE_POWERUP.id]);
const fxDefs = { ...content.hazards, ...content.powerups, [FX_GROUND_HAZARD.id]: FX_GROUND_HAZARD, [FX_AIR_HAZARD.id]: FX_AIR_HAZARD,
  [FX_WARD_POWERUP.id]: FX_WARD_POWERUP, [FX_STABILIZE_POWERUP.id]: FX_STABILIZE_POWERUP };
const isFx = (s) => FX_IDS.has(s.defId);
const snap = (c) => JSON.parse(JSON.stringify(c));

/** Fixture content with per-def overrides, e.g. { fxGroundHazard: { spawn: { baseChance: 0.2 } } }. */
function fxGen(seed, over = {}, mask = FX_MASK) {
  const patch = (d) => (over[d.id] ? { ...JSON.parse(JSON.stringify(d)), ...over[d.id] } : d);
  return makeGen(seed, {
    biomeMask: mask,
    ...withBiomeFixtures(content, {
      hazards: Object.fromEntries([FX_GROUND_HAZARD, FX_AIR_HAZARD].map((d) => [d.id, patch(d)])),
      powerups: Object.fromEntries([FX_WARD_POWERUP, FX_STABILIZE_POWERUP].map((d) => [d.id, patch(d)])),
    }),
  });
}

function chunks(gen, n = N) {
  const out = [];
  for (let i = 0; i < n; i++) out.push(snap(gen.getChunk(i)));
  return out;
}

describe('_placeBiomeSpawns: placement of biome hazards and power-ups', () => {
  const all = SEEDS.map((s) => chunks(fxGen(s)));

  test('the pass places fixture hazards and power-ups at all (otherwise every bound below is vacuous)', () => {
    let gh = 0;
    let ah = 0;
    let pu = 0;
    for (const cs of all) {
      for (const c of cs) {
        gh += c.hazards.filter((h) => h.defId === FX_GROUND_HAZARD.id).length;
        ah += c.hazards.filter((h) => h.defId === FX_AIR_HAZARD.id).length;
        pu += c.powerups.filter(isFx).length;
      }
    }
    expect(gh).toBeGreaterThanOrEqual(8); // rare by design: see BIOME_EDGE_MARGIN_PX and the 480 px spacing rule
    expect(ah).toBeGreaterThan(0);
    expect(pu).toBeGreaterThan(10);
  });

  test('biome spawns appear only inside a chunk of THAT def\'s biome', () => {
    for (const cs of all) {
      for (const c of cs) {
        for (const s of [...c.hazards, ...c.powerups].filter(isFx)) expect({ def: s.defId, biome: c.biome }).toEqual({ def: s.defId, biome: fxDefs[s.defId].biome });
      }
    }
  });

  test('at most one biome hazard and one biome power-up per chunk', () => {
    for (const cs of all) {
      for (const c of cs) {
        expect(c.hazards.filter(isFx).length).toBeLessThanOrEqual(1);
        expect(c.powerups.filter(isFx).length).toBeLessThanOrEqual(1);
      }
    }
  });

  test('ground biome hazards keep the base clearances: chunk edges, gaps, lips, spacing, slope, power-ups, shards', () => {
    expect(BIOME_EDGE_MARGIN_PX).toBeGreaterThanOrEqual(96);
    for (const cs of all) {
      let prev = null;
      for (const c of cs) {
        for (const h of c.hazards) {
          if (prev != null) expect(h.x - prev).toBeGreaterThanOrEqual(HAZARD_MIN_SPACING_PX); // across chunk borders too
          prev = h.x;
        }
        const h = c.hazards.find((q) => q.defId === FX_GROUND_HAZARD.id);
        if (!h) continue;
        expect(c.kind).not.toBe('bridge');
        expect(c.defId).not.toBe('gen-jump');
        expect(h.x).toBeGreaterThanOrEqual(c.startX + BIOME_EDGE_MARGIN_PX);
        expect(h.x).toBeLessThanOrEqual(c.endX - BIOME_EDGE_MARGIN_PX);
        for (const g of c.gaps) expect(h.x < g.x0 - 96 || h.x > g.x1 + 96).toBe(true);
        for (const l of c.launches) expect(h.x < l.x - 40 || h.x > (l.landX || l.x)).toBe(true);
        for (const p of c.powerups) expect(Math.abs(p.x - h.x)).toBeGreaterThanOrEqual(90);
        const w = FX_GROUND_HAZARD.size.w;
        const top = h.y - FX_GROUND_HAZARD.size.h - 22;
        for (const s of c.shards) expect(s.x >= h.x - w / 2 - 22 && s.x <= h.x + w / 2 + 22 && s.y >= top).toBe(false);
        expect(Math.abs(h.rotationDeg)).toBeLessThan(28);
      }
    }
  });

  test('hazards stay sorted by x in every chunk', () => {
    for (const cs of all) for (const c of cs) expect(c.hazards.map((h) => h.x)).toEqual(c.hazards.map((h) => h.x).sort((a, b) => a - b));
  });

  test('air biome hazards only in jump chunks, floating above the ground, clear of power-ups and gaps', () => {
    for (const cs of all) {
      for (const c of cs) {
        const a = c.hazards.find((q) => q.defId === FX_AIR_HAZARD.id);
        if (!a) continue;
        expect(c.defId).toBe('gen-jump');
        expect(a.rotationDeg).toBe(0);
        const pts = c.points;
        const i = Math.max(0, Math.min(pts.length - 2, Math.floor((a.x - c.startX) / 16)));
        expect(a.y).toBeLessThan(pts[i].y - 60);
        for (const p of c.powerups) expect(Math.abs(p.x - a.x)).toBeGreaterThanOrEqual(90);
      }
    }
  });

  test('biome power-ups: lifted above the ground, never within 90 px of any hazard, clear of gaps and of other power-ups', () => {
    for (const cs of all) {
      for (const c of cs) {
        const p = c.powerups.find(isFx);
        if (!p) continue;
        for (const h of c.hazards) expect(Math.abs(h.x - p.x)).toBeGreaterThanOrEqual(90);
        for (const g of c.gaps) expect(p.x <= g.x0 - 80 || p.x >= g.x1 + 40).toBe(true);
        for (const q of c.powerups) if (q !== p) expect(Math.abs(q.x - p.x)).toBeGreaterThanOrEqual(90);
        expect(p.x).toBeGreaterThanOrEqual(c.startX + BIOME_EDGE_MARGIN_PX);
        expect(p.x).toBeLessThanOrEqual(c.endX - BIOME_EDGE_MARGIN_PX);
        const pts = c.points;
        const i = Math.max(0, Math.min(pts.length - 2, Math.floor((p.x - c.startX) / 16)));
        expect(p.y).toBeLessThan(Math.min(pts[i].y, pts[i + 1].y) - 20);
      }
    }
  });

  test('determinism: same (seed, mask, content) twice and in any call order is deep-equal; streamed chunks match fresh ones', () => {
    const a = fxGen('bs-det');
    const b = fxGen('bs-det');
    const rev = [];
    for (let i = 199; i >= 0; i--) rev[i] = snap(b.getChunk(i));
    for (let i = 0; i < 200; i++) expect(snap(a.getChunk(i))).toEqual(rev[i]);
    const stream = fxGen('bs-det');
    let x = 0;
    for (let f = 0; f < 700; f++) {
      x += 180;
      stream.update(x);
      for (const c of stream.getActiveChunks()) expect(snap(c)).toEqual(snap(b.getChunk(c.index)));
    }
  });

  test('spawn chance comes from the def and is capped at BIOME_SPAWN_MAX_CHANCE (0.5)', () => {
    expect(BIOME_SPAWN_MAX_CHANCE).toBe(0.5);
    const n = (cs) => cs.reduce((k, c) => k + c.hazards.filter((h) => h.defId === FX_GROUND_HAZARD.id).length
      + c.powerups.filter((p) => p.defId === FX_WARD_POWERUP.id).length, 0);
    let half = 0;
    let low = 0;
    for (const seed of SEEDS) {
      const capped = chunks(fxGen(seed, { fxGroundHazard: { spawn: { baseChance: 1 } }, fxWardPowerup: { spawn: { baseChance: 1, distanceDecayM: 1 } } }));
      const h = chunks(fxGen(seed));
      expect(capped).toEqual(h);
      half += n(h);
      low += n(chunks(fxGen(seed, { fxGroundHazard: { spawn: { baseChance: 0.1 } }, fxWardPowerup: { spawn: { baseChance: 0.1 } } })));
      // weight 0 disables a def (weight || 1 would resurrect it)
      expect(n(chunks(fxGen(seed, { fxGroundHazard: { weight: 0 }, fxWardPowerup: { weight: 0 } })))).toBe(0);
    }
    expect(low).toBeLessThan(half / 2);
  });

  test('fixed draws: lowering a hazard chance only removes hazards (none move) and leaves the power-up stream alone', () => {
    expect(BIOME_SLOT_DRAWS).toBeGreaterThanOrEqual(4);
    for (const seed of SEEDS) {
      const hi = chunks(fxGen(seed));
      const lo = chunks(fxGen(seed, { fxGroundHazard: { spawn: { baseChance: 0.2 } } }));
      for (let i = 0; i < N; i++) {
        const hiH = hi[i].hazards.filter(isFx);
        const loH = lo[i].hazards.filter(isFx);
        for (const h of loH) expect(hiH).toContainEqual(h);
        // power-ups: removing a hazard can only UNBLOCK a power-up slot, never move one
        const hiP = hi[i].powerups.filter(isFx);
        const loP = lo[i].powerups.filter(isFx);
        for (const p of hiP) expect(loP).toContainEqual(p);
        for (const p of loP) {
          if (hiP.some((q) => q.x === p.x)) continue;
          expect(hiH.some((h) => Math.abs(h.x - p.x) < 90)).toBe(true);
        }
      }
    }
  });

  test('fixed draws: changing a power-up chance changes NO hazard', () => {
    for (const seed of SEEDS) {
      const a = chunks(fxGen(seed));
      const b = chunks(fxGen(seed, { fxWardPowerup: { spawn: { baseChance: 0.05, distanceDecayM: 1500 } } }));
      for (let i = 0; i < N; i++) expect(b[i].hazards).toEqual(a[i].hazards);
    }
  });

  test('a biome with no biome defs gets no biome spawn, even when another biome has some', () => {
    // debumont (bit 1) has no fixture def; garbage-dump-glacier and space-mountain do
    let debumontChunks = 0;
    for (const seed of SEEDS) {
      for (const c of chunks(fxGen(seed, {}, 1 | FX_MASK))) {
        if (c.biome !== 'debumont') continue;
        debumontChunks++;
        expect([...c.hazards, ...c.powerups].filter(isFx)).toEqual([]);
      }
    }
    expect(debumontChunks).toBeGreaterThan(20);
  });

  test('a biome not in the mask gets nothing; base spawns in a biome chunk are untouched by the pass', () => {
    const onlyGarbage = chunks(fxGen('bs-mask', {}, 2));
    for (const c of onlyGarbage) for (const s of [...c.hazards, ...c.powerups]) expect([FX_AIR_HAZARD.id, FX_STABILIZE_POWERUP.id]).not.toContain(s.defId);
    const withFx = chunks(fxGen('bs-mask'));
    const noFx = chunks(makeGen('bs-mask', { biomeMask: FX_MASK }));
    for (let i = 0; i < N; i++) {
      expect(withFx[i].points).toEqual(noFx[i].points);
      expect(withFx[i].zones).toEqual(noFx[i].zones);
      expect(withFx[i].shards).toEqual(noFx[i].shards);
      expect(withFx[i].hazards.filter((h) => !isFx(h))).toEqual(noFx[i].hazards);
      expect(withFx[i].powerups.filter((p) => !isFx(p))).toEqual(noFx[i].powerups);
    }
  });
});
