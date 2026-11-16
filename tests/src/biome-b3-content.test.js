/**
 * B3 "Motion" content (spec §4 table and bounds): the biome hazard and power-up of Pyramid Peak (4), Steampunk Slopes
 * (256) and Micro Mountain (512). Loader + schema check for the new JSON, the values the spec names, the motion blocks
 * the generator and Hazard.js read, and the pairing rule (each pickup counters its own biome: the glides lower the ground
 * friction, the Clockwork Treads ward off the Steampunk conveyor belt).
 */
import { readDir, loadContent, makeGen } from './_helpers.js';
import { PALETTE_KEYS } from '../../src/constants.js';
import { emptyWards, addWard, isWarded, tickWards, WARD_MIN_MS, WARD_MAX_MS } from '../../src/systems/Wards.js';
import { hazardDrawKind, powerupDrawKind, hazardColorKey, glideFrictionMul, timedPowerupMs, glideStrength, glideDrag } from '../../src/systems/BiomeEffects.js';
import { rollParams, gateTiming, GATE_MAX_CLOSED_MS, ROLL_MAX_RANGE_PX } from '../../src/systems/HazardMotion.js';
import { BIOME_SPAWN_MAX_CHANCE, BIOME_HAZARD_MAX_CHANCE, BIOME_REPLACE_SLACK_PX } from '../../src/systems/TerrainGenerator.js';
import { PhysicsTuner } from '../../src/systems/PhysicsTuner.js';

const c = loadContent();
const biomeHaz = readDir('hazards').filter((d) => d.biome);
const biomePu = readDir('powerups').filter((d) => d.biome);

/** Spec §4 B3 rows. */
const B3 = {
  'pyramid-peak': { hazard: 'rollingBoulder', powerup: 'sandrunnerSkis', motion: 'roll' },
  'steampunk-slopes': { hazard: 'gearGate', powerup: 'clockworkTreads', motion: 'gate' },
  'micro-mountain': { hazard: 'dewDrop', powerup: 'royalJellyWax', motion: 'roll' },
};
const B3_HAZ = Object.values(B3).map((r) => c.hazards[r.hazard]);
const B3_PU = Object.values(B3).map((r) => c.powerups[r.powerup]);

describe('B3 content: loader and schema', () => {
  test('exactly one hazard and one power-up per B3 biome; 9 biome hazards and 9 biome power-ups shipped after B1-B3', () => {
    const byBiome = (list) => Object.fromEntries(Object.keys(B3).map((b) => [b, list.filter((d) => d.biome === b).map((d) => d.id)]));
    expect(byBiome(biomeHaz)).toEqual(Object.fromEntries(Object.entries(B3).map(([b, r]) => [b, [r.hazard]])));
    expect(byBiome(biomePu)).toEqual(Object.fromEntries(Object.entries(B3).map(([b, r]) => [b, [r.powerup]])));
    expect(biomeHaz.length).toBe(9);
    expect(biomePu.length).toBe(9);
    for (const r of Object.values(B3)) {
      expect(c.hazards[r.hazard]).toBeDefined();
      expect(c.powerups[r.powerup]).toBeDefined();
    }
  });

  test('every B3 def names a real biome and follows the hazard / power-up schema and the §4 chance caps', () => {
    for (const h of B3_HAZ) {
      expect(c.biomes[h.biome]).toBeDefined();
      expect(h.size.w).toBeGreaterThan(0);
      expect(h.size.h).toBeGreaterThan(0);
      expect(h.weight).toBeGreaterThan(0);
      expect(h.minDistanceM).toBeGreaterThanOrEqual(0);
      expect(h.placement).toBe('ground');
      expect(PALETTE_KEYS).toContain(h.colorKey);
      expect(h.spawn.baseChance).toBeGreaterThan(0);
      expect(h.spawn.baseChance).toBeLessThanOrEqual(BIOME_HAZARD_MAX_CHANCE);
    }
    for (const p of B3_PU) {
      expect(c.biomes[p.biome]).toBeDefined();
      expect(p.radius).toBeGreaterThan(0);
      expect(PALETTE_KEYS).toContain(p.colorKey);
      expect(p.spawn.baseChance).toBeGreaterThan(0);
      expect(p.spawn.baseChance).toBeLessThanOrEqual(BIOME_SPAWN_MAX_CHANCE);
    }
  });

  test('every B3 shapeKey has its own drawing and all biome shapeKeys stay unique', () => {
    for (const h of B3_HAZ) expect({ id: h.id, draw: hazardDrawKind(h) }).toEqual({ id: h.id, draw: h.shapeKey });
    for (const p of B3_PU) expect({ id: p.id, draw: powerupDrawKind(p) }).toEqual({ id: p.id, draw: p.shapeKey });
    const keys = [...biomeHaz, ...biomePu].map((d) => d.shapeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('all three B3 hazards crash, so they are `danger` in both the JSON and hazardColorKey (the palette switch reads the JSON)', () => {
    for (const h of B3_HAZ) {
      expect(h.onHit).toEqual({ effect: 'crash' });
      expect(h.colorKey).toBe('danger');
      expect(hazardColorKey(h)).toBe('danger');
    }
  });
});

describe('B3 content: the spec §4 values and the motion blocks', () => {
  test('Pyramid Peak: Rolling Boulder rolls (motion roll, B3 tuning: downhill away from the sled, capped at 80 px/s), crash on contact', () => {
    const b = c.hazards.rollingBoulder;
    expect(b.motion.kind).toBe('roll');
    expect(rollParams(b.motion)).toEqual({ speedPxS: 80, rangePx: 120, dir: 1 }); // inside the bounds: not clamped
  });

  test('Micro Mountain: Dew Drop reuses motion roll (smaller and slower than the boulder), crash on contact', () => {
    const d = c.hazards.dewDrop;
    expect(d.motion.kind).toBe('roll');
    const p = rollParams(d.motion);
    expect(p).toEqual({ speedPxS: 75, rangePx: 120, dir: 1 });
    expect(p.speedPxS).toBeLessThanOrEqual(rollParams(c.hazards.rollingBoulder.motion).speedPxS);
    expect(p.rangePx).toBeLessThanOrEqual(ROLL_MAX_RANGE_PX);
    expect(d.size.w * d.size.h).toBeLessThan(c.hazards.rollingBoulder.size.w * c.hazards.rollingBoulder.size.h);
  });

  test('Steampunk Slopes: Gear Gate opens and closes on a period (motion gate), closed spell inside the fairness bound', () => {
    const g = c.hazards.gearGate;
    expect(g.motion.kind).toBe('gate');
    const t = gateTiming(g.motion);
    expect(t).toEqual({ periodMs: g.motion.periodMs, openMs: g.motion.openMs, closedMs: g.motion.periodMs - g.motion.openMs });
    expect(t.closedMs).toBeLessThanOrEqual(GATE_MAX_CLOSED_MS);
    expect(t.openMs).toBeGreaterThan(t.closedMs);
  });

  test('B3 tuning: Sandrunner Skis are a short punchy slick burst, Royal Jelly Wax a longer gentler glide (both kind glide)', () => {
    const skis = c.powerups.sandrunnerSkis.effect;
    const jelly = c.powerups.royalJellyWax.effect;
    expect(skis).toEqual({ kind: 'glide', frictionMul: 0.3, durationMs: 2000 });
    expect(jelly).toEqual({ kind: 'glide', frictionMul: 0.55, durationMs: 5000 });
    for (const e of [skis, jelly]) {
      expect(glideFrictionMul(e.frictionMul)).toBe(e.frictionMul); // inside the bounds: not clamped
      expect(timedPowerupMs(e)).toBe(e.durationMs);
    }
    // their own flavours: the Skis are slicker and shorter, the wax gentler and longer
    expect(glideStrength(skis.frictionMul)).toBeGreaterThan(glideStrength(jelly.frictionMul));
    expect(skis.durationMs).toBeLessThan(jelly.durationMs);
  });

  test('Clockwork Treads: ward against the conveyorBelt mod for 4 s', () => {
    expect(c.powerups.clockworkTreads.effect).toEqual({ kind: 'ward', durationMs: 4000, mods: ['conveyorBelt'], hazards: [], effects: [] });
  });

  test('each B3 hazard fits the slot rule (its box fits in a base ground hazard box + 8 px)', () => {
    for (const h of B3_HAZ) {
      const fits = Object.values(c.hazards).filter((d) => !d.biome && d.placement === 'ground'
        && h.size.w <= d.size.w + BIOME_REPLACE_SLACK_PX && h.size.h <= d.size.h + BIOME_REPLACE_SLACK_PX);
      expect({ id: h.id, fits: fits.length > 0 }).toEqual({ id: h.id, fits: true });
    }
  });
});

describe('B3 content: each power-up counters its own biome', () => {
  test('Clockwork Treads ward the Steampunk mod (conveyorBelt) and nothing a B3 hazard does', () => {
    const e = c.powerups.clockworkTreads.effect;
    expect(e.durationMs).toBeGreaterThanOrEqual(WARD_MIN_MS);
    expect(e.durationMs).toBeLessThanOrEqual(WARD_MAX_MS);
    const w = addWard(emptyWards(), 'clockworkTreads', e);
    expect(c.biomes['steampunk-slopes'].mod).toBe('conveyorBelt');
    expect(isWarded(w, { modId: 'conveyorBelt' })).toBe(true);
    expect(isWarded(w, { modId: 'stickyPatch' })).toBe(false);
    expect(isWarded(w, { hazardId: 'gearGate' })).toBe(false);
    expect(isWarded(w, { effect: 'crash' })).toBe(false);
    // the conveyor's drive is gone while the Treads run, and back after 4 s
    const t = new PhysicsTuner();
    const zone = [c.terrainMods.conveyorBelt];
    expect(t.getEffective({ zones: zone }).beltDrivePxS2).toBeGreaterThan(0);
    expect(t.getEffective({ zones: zone, wards: w }).beltDrivePxS2).toBe(0);
    tickWards(w, 4001);
    expect(t.getEffective({ zones: zone, wards: w }).beltDrivePxS2).toBeGreaterThan(0);
  });

  test('a glide lowers all three drags of the real tuner in each glide biome (no zone needed)', () => {
    const t = new PhysicsTuner();
    const base = t.getEffective({});
    for (const id of ['sandrunnerSkis', 'royalJellyWax']) {
      const m = glideFrictionMul(c.powerups[id].effect.frictionMul);
      const g = t.getEffective({ glideFrictionMul: m });
      const d = glideDrag(1, m);
      expect(g.groundResist).toBeCloseTo(base.groundResist * m, 12);
      expect(g.frictionAir).toBeCloseTo(base.frictionAir / d.speedMul, 12);
      expect(g.quadDrag).toBeCloseTo(base.quadDrag * d.quadMul, 12);
      expect(d.speedMul).toBeGreaterThan(1.1);
    }
  });

  test('no B3 def appears at mask 0', () => {
    const ids = new Set([...B3_HAZ, ...B3_PU].map((d) => d.id));
    const g = makeGen('b3-mask0', { biomeMask: 0 });
    for (let i = 0; i < 120; i++) {
      const ch = g.getChunk(i);
      expect(ch.hazards.some((h) => ids.has(h.defId))).toBe(false);
      expect(ch.powerups.some((p) => ids.has(p.defId))).toBe(false);
    }
  });
});
