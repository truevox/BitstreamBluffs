/**
 * B1 (biome full treatment): the amended SLOT RULE (spec §4, amended by CC Friday 2026-11-14 from B0 evidence).
 *
 * B0 showed that past 2 km the base 480 px hazard spacing leaves almost no free ground slot for a biome hazard. So a
 * biome chunk whose free scan found no slot may REPLACE ONE existing base ground hazard with its biome hazard:
 *   - the choice comes from the 'biomeHaz' fork with a fixed draw count (the slot's 5th draw), so base streams are
 *     untouched and BIOME_SLOT_DRAWS is unchanged;
 *   - it happens only when the biome footprint fits within the replaced box + BIOME_REPLACE_SLACK_PX (8 px) in both w and
 *     h, so the shard and power-up clearances computed around the base hazard still hold;
 *   - the replaced spot must still pass every biome ground rule (slope, lips, gaps, power-ups, shards with the NEW size,
 *     crash-safe distance, `slow` only before a descent).
 * The fixtures stand in for real content so this file tests the engine, not the B1 tuning.
 */
import crypto from 'crypto';
import { makeGen, loadContent, readDir } from './_helpers.js';
import { FX_GROUND_HAZARD, FX_AIR_HAZARD, FX_WARD_POWERUP, FX_STABILIZE_POWERUP, FX_MASK } from './_biomeFixtures.js';
import { BIOME_SLOT_DRAWS, BIOME_REPLACE_SLACK_PX, SPACING_PX, BIOME_EDGE_MARGIN_PX } from '../../src/systems/TerrainGenerator.js';

const content = loadContent();
/** Shipped content WITHOUT any biome-tagged def (the engine under test, not the B1 tuning). */
const baseOf = (o) => Object.fromEntries(Object.entries(o).filter(([, d]) => !d.biome));
const BASE_H = baseOf(content.hazards);
const BASE_P = baseOf(content.powerups);
const ALL = readDir('biomes').reduce((m, b) => m | b.bit, 0);
const snap = (c) => JSON.parse(JSON.stringify(c));
const clone = (d) => JSON.parse(JSON.stringify(d));

/** Generator with base content plus the given biome hazard defs (power-up fixtures always on). */
function gen(seed, hazards = [FX_GROUND_HAZARD, FX_AIR_HAZARD], mask = FX_MASK) {
  return makeGen(seed, {
    biomeMask: mask,
    hazardDefs: { ...BASE_H, ...Object.fromEntries(hazards.map((d) => [d.id, clone(d)])) },
    powerupDefs: { ...BASE_P, [FX_WARD_POWERUP.id]: clone(FX_WARD_POWERUP), [FX_STABILIZE_POWERUP.id]: clone(FX_STABILIZE_POWERUP) },
  });
}
const baseGen = (seed, mask = FX_MASK) => makeGen(seed, { biomeMask: mask, hazardDefs: BASE_H, powerupDefs: BASE_P });
const chunksOf = (g, n) => Array.from({ length: n }, (_, i) => snap(g.getChunk(i)));

const SEEDS = ['slot-alpha', 'slot-beta', 'slot-gamma', 'slot-delta'];
const N = 300;

describe('slot rule: base streams untouched', () => {
  test('with biome defs absent, nothing changes at ANY mask (digests pinned at 00978f6, before the slot rule)', () => {
    // Recorded on 00978f6 (v2.5.0, B0) with the same projection: 2 seeds x 200 chunks of JSON.stringify(getChunk(i)).
    const PINNED = { 1: 'ba7a764bc87f8a44', 2: '3abca580d8e3b709', 8: 'b9d8da9bde0a6517', 64: '3b2af138f1ac87ae', [ALL]: 'd65be5a81a4903b4' };
    const out = {};
    for (const mask of Object.keys(PINNED).map(Number)) {
      const parts = [];
      for (const seed of ['slot-a', 'slot-b']) {
        const g = baseGen(seed, mask);
        for (let i = 0; i < 200; i++) parts.push(JSON.stringify(g.getChunk(i)));
      }
      out[mask] = crypto.createHash('sha256').update(parts.join('|')).digest('hex').slice(0, 16);
    }
    expect(out).toEqual(Object.fromEntries(Object.entries(PINNED).map(([k, v]) => [Number(k), v])));
  });

  test('the slot keeps a fixed draw count: BIOME_SLOT_DRAWS is still 5', () => {
    expect(BIOME_SLOT_DRAWS).toBe(5);
    expect(BIOME_REPLACE_SLACK_PX).toBe(8);
  });
});

describe('slot rule: replacing one base ground hazard', () => {
  const runs = SEEDS.map((s) => ({ fx: chunksOf(gen(s), N), base: chunksOf(baseGen(s), N) }));
  const isFx = (h) => h.defId === FX_GROUND_HAZARD.id;

  test('replacements happen, and each one swaps a base GROUND hazard in place (same x, y, rotation) for the biome def', () => {
    let replaced = 0;
    for (const { fx, base } of runs) {
      for (let i = 0; i < N; i++) {
        const h = fx[i].hazards.find(isFx);
        if (!h) continue;
        const was = base[i].hazards.find((q) => q.x === h.x);
        if (!was) continue;
        replaced++;
        expect({ x: h.x, y: h.y, rotationDeg: h.rotationDeg }).toEqual({ x: was.x, y: was.y, rotationDeg: was.rotationDeg });
        expect(content.hazards[was.defId].placement).not.toBe('air');
        expect(content.hazards[was.defId].biome).toBeUndefined();
      }
    }
    expect(replaced).toBeGreaterThan(20); // fewer since amendment (a) frees more slots: 28 measured
  });

  test('every other hazard, power-up, shard, zone and point of the chunk is unchanged; at most one base hazard per chunk is replaced', () => {
    for (const { fx, base } of runs) {
      for (let i = 0; i < N; i++) {
        const a = fx[i];
        const b = base[i];
        expect(a.points).toEqual(b.points);
        expect(a.zones).toEqual(b.zones);
        expect(a.shards).toEqual(b.shards);
        expect(a.powerups.filter((p) => !p.defId.startsWith('fx'))).toEqual(b.powerups);
        const own = a.hazards.filter((h) => !h.defId.startsWith('fx'));
        const lost = b.hazards.filter((h) => !own.some((q) => q.x === h.x && q.defId === h.defId));
        expect(lost.length).toBeLessThanOrEqual(1);
        for (const h of own) expect(b.hazards).toContainEqual(h);
        if (lost.length) {
          // the lost base hazard is exactly where the biome hazard now is: a swap, never a removal
          const h = a.hazards.find(isFx);
          expect(h && h.x).toBe(lost[0].x);
        }
      }
    }
  });

  test('footprint rule: the biome box fits within the replaced box + 8 px (w and h)', () => {
    for (const { fx, base } of runs) {
      for (let i = 0; i < N; i++) {
        const h = fx[i].hazards.find(isFx);
        const was = h && base[i].hazards.find((q) => q.x === h.x);
        if (!was) continue;
        const s = content.hazards[was.defId].size;
        expect(FX_GROUND_HAZARD.size.w).toBeLessThanOrEqual(s.w + BIOME_REPLACE_SLACK_PX);
        expect(FX_GROUND_HAZARD.size.h).toBeLessThanOrEqual(s.h + BIOME_REPLACE_SLACK_PX);
      }
    }
  });

  test('footprint rule: a biome hazard too big for every base box is never placed by replacement', () => {
    const big = { ...clone(FX_GROUND_HAZARD), size: { w: 80, h: 60 } };
    let free = 0;
    for (const seed of SEEDS) {
      const a = chunksOf(gen(seed, [big, FX_AIR_HAZARD]), N);
      const b = chunksOf(baseGen(seed), N);
      for (let i = 0; i < N; i++) {
        const h = a[i].hazards.find(isFx);
        if (!h) continue;
        free++;
        expect(b[i].hazards.some((q) => q.x === h.x)).toBe(false);
        expect(a[i].hazards.filter((q) => !isFx(q))).toEqual(b[i].hazards);
      }
    }
    expect(free).toBeGreaterThanOrEqual(1);
  });

  test('a `slow` biome hazard keeps its fairness rule on swapped and free slots: descent ahead below 0.6, no climb ahead from 0.6', () => {
    // B1 presence amendment (b): speedFactor < 0.6 needs a descent ahead; a gentler slow needs no climbing segment ahead.
    for (const [k0, needDescent] of [[0.5, true], [0.7, false]]) {
      const slow = { ...clone(FX_GROUND_HAZARD), id: 'fxGroundHazard', onHit: { effect: 'slow', durationMs: 900, speedFactor: k0 } };
      let n = 0;
      for (const seed of SEEDS) {
        const g = gen(seed, [slow, FX_AIR_HAZARD]);
        for (let i = 0; i < N; i++) {
          const c = g.getChunk(i);
          const h = c.hazards.find(isFx);
          if (!h) continue;
          n++;
          const k = Math.max(0, Math.min(c.points.length - 2, Math.floor((h.x - c.startX) / SPACING_PX)));
          if (needDescent) expect(g._descentAhead(c.points, k, c.endX)).toBe(true);
          else {
            const k1 = Math.min(c.points.length - 2, k + Math.ceil(BIOME_EDGE_MARGIN_PX / SPACING_PX));
            for (let j = k; j <= k1; j++) expect(c.points[j + 1].y).toBeGreaterThanOrEqual(c.points[j].y);
          }
        }
      }
      expect(n).toBeGreaterThan(10);
    }
  });

  test('share: with chance 0.5 the biome hazard sits in 40-60 % of GROUND-ELIGIBLE biome chunks (not bridge, not gen-jump)', () => {
    let eligible = 0;
    let has = 0;
    for (const { fx } of runs) {
      for (const c of fx) {
        if (c.biome !== FX_GROUND_HAZARD.biome || c.index === 0 || c.kind === 'bridge' || c.defId === 'gen-jump') continue;
        eligible++;
        if (c.hazards.some(isFx)) has++;
      }
    }
    expect(eligible).toBeGreaterThan(150);
    console.log(`slot-rule share (fixture, chance 0.5): ${has}/${eligible} ground-eligible = ${(has / eligible).toFixed(3)}`);
    expect(has / eligible).toBeGreaterThanOrEqual(0.4);
    expect(has / eligible).toBeLessThanOrEqual(0.6);
  });

  test('the pick among candidates is cands[floor(r * n)] with r the slot\'s 5th draw (spied on the real generator)', () => {
    // Spy on this instance: inside _replaceBiomeGround, every candidate that passes the ground rules goes through
    // _biomeGroundAt with itself as `skip`, in chunk order, so the spy sees the real candidate list and the draw r.
    let multi = 0;
    let notFirst = 0;
    let total = 0;
    for (const seed of [...SEEDS, 'slot-e', 'slot-f', 'slot-g', 'slot-h']) {
      const g = gen(seed);
      const at = g._biomeGroundAt.bind(g);
      const rep = g._replaceBiomeGround.bind(g);
      let log = null;
      g._biomeGroundAt = (...args) => { const r = at(...args); if (log && r && args[6]) log.push(args[6]); return r; };
      g._replaceBiomeGround = (chunk, def, r, ...rest) => {
        log = [];
        const before = chunk.hazards.slice();
        const ok = rep(chunk, def, r, ...rest);
        const cands = log;
        log = null;
        if (ok) {
          total++;
          const k = before.findIndex((q, j) => chunk.hazards[j] !== q);
          const want = cands[Math.min(cands.length - 1, Math.floor(r * cands.length))];
          expect(before[k]).toBe(want);
          if (cands.length > 1) multi++;
          if (want !== cands[0]) notFirst++;
        }
        return ok;
      };
      for (let i = 0; i < 600; i++) g.getChunk(i);
    }
    console.log(`slot-rule pick: ${total} replacements, ${multi} with > 1 candidate, ${notFirst} not the first candidate`);
    expect(total).toBeGreaterThan(20);
    expect(notFirst).toBeGreaterThan(3);
  });

  test('determinism: same (seed, mask, content) twice and in reverse call order is deep-equal', () => {
    const a = gen('slot-det');
    const b = gen('slot-det');
    const rev = [];
    for (let i = 199; i >= 0; i--) rev[i] = snap(b.getChunk(i));
    for (let i = 0; i < 200; i++) expect(snap(a.getChunk(i))).toEqual(rev[i]);
  });
});
