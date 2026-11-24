/**
 * B4 "Air" content (spec §4 table and bounds): the biome hazard and power-up of Space Mountain (32) and Sky Jellyfish
 * Mountain (128). Loader + schema check for the new JSON, the values the spec names, and the pairing rule (each pickup
 * counters its own biome: the Gravity Stabilizer widens the landing tolerance that Space's long low-gravity flights test,
 * the Stabilizer Rails also damp the bounce of Sky Jellyfish's bouncySpring mod).
 */
import { readDir, loadContent, makeGen } from './_helpers.js';
import { PALETTE_KEYS } from '../../src/constants.js';
import {
  hazardDrawKind, powerupDrawKind, hazardColorKey, gustImpulse, GUST_MAX_PX_S, stabilizeToleranceDeg, stabilizeBounceMul,
  timedPowerupMs, resolveLanding,
} from '../../src/systems/BiomeEffects.js';
import { BIOME_SPAWN_MAX_CHANCE, BIOME_HAZARD_MAX_CHANCE } from '../../src/systems/TerrainGenerator.js';
import { PhysicsTuner, TUNING } from '../../src/systems/PhysicsTuner.js';

const c = loadContent();
const biomeHaz = readDir('hazards').filter((d) => d.biome);
const biomePu = readDir('powerups').filter((d) => d.biome);

/** Spec §4 B4 rows. */
const B4 = {
  'space-mountain': { hazard: 'meteor', powerup: 'gravityStabilizer' },
  'sky-jellyfish-mountain': { hazard: 'gustFront', powerup: 'stabilizerRails' },
};
const B4_HAZ = Object.values(B4).map((r) => c.hazards[r.hazard]);
const B4_PU = Object.values(B4).map((r) => c.powerups[r.powerup]);

describe('B4 content: loader and schema', () => {
  test('exactly one hazard and one power-up per B4 biome; all 11 biomes now ship 11 hazards and 11 power-ups', () => {
    const byBiome = (list) => Object.fromEntries(Object.keys(B4).map((b) => [b, list.filter((d) => d.biome === b).map((d) => d.id)]));
    expect(byBiome(biomeHaz)).toEqual(Object.fromEntries(Object.entries(B4).map(([b, r]) => [b, [r.hazard]])));
    expect(byBiome(biomePu)).toEqual(Object.fromEntries(Object.entries(B4).map(([b, r]) => [b, [r.powerup]])));
    expect(biomeHaz.length).toBe(11);
    expect(biomePu.length).toBe(11);
    // one of each per biome, every biome covered (spec §10 completion contract)
    for (const b of Object.keys(c.biomes)) {
      expect({ b, h: biomeHaz.filter((d) => d.biome === b).length, p: biomePu.filter((d) => d.biome === b).length }).toEqual({ b, h: 1, p: 1 });
    }
  });

  test('every B4 def names a real biome and follows the hazard / power-up schema and the §4 chance caps', () => {
    for (const h of B4_HAZ) {
      expect(c.biomes[h.biome]).toBeDefined();
      expect(h.size.w).toBeGreaterThan(0);
      expect(h.size.h).toBeGreaterThan(0);
      expect(h.weight).toBeGreaterThan(0);
      expect(h.minDistanceM).toBeGreaterThanOrEqual(0);
      expect(h.placement).toBe('air');
      expect(PALETTE_KEYS).toContain(h.colorKey);
      expect(h.spawn.baseChance).toBeGreaterThan(0);
      expect(h.spawn.baseChance).toBeLessThanOrEqual(BIOME_HAZARD_MAX_CHANCE);
    }
    for (const p of B4_PU) {
      expect(c.biomes[p.biome]).toBeDefined();
      expect(p.radius).toBeGreaterThan(0);
      expect(PALETTE_KEYS).toContain(p.colorKey);
      expect(p.spawn.baseChance).toBeGreaterThan(0);
      expect(p.spawn.baseChance).toBeLessThanOrEqual(BIOME_SPAWN_MAX_CHANCE);
    }
  });

  test('both B4 hazards carry a display name (death legibility names the killer from it)', () => {
    expect(c.hazards.meteor.name).toBe('Meteor');
    expect(c.hazards.gustFront.name).toBe('Gust Front');
  });

  test('every B4 shapeKey has its own drawing and all biome shapeKeys stay unique', () => {
    for (const h of B4_HAZ) expect({ id: h.id, draw: hazardDrawKind(h) }).toEqual({ id: h.id, draw: h.shapeKey });
    for (const p of B4_PU) expect({ id: p.id, draw: powerupDrawKind(p) }).toEqual({ id: p.id, draw: p.shapeKey });
    const keys = [...biomeHaz, ...biomePu].map((d) => d.shapeKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('Meteor crashes, so it is `danger`; Gust Front never crashes, so it is not', () => {
    expect(c.hazards.meteor.onHit).toEqual({ effect: 'crash' });
    expect(c.hazards.meteor.colorKey).toBe('danger');
    expect(hazardColorKey(c.hazards.meteor)).toBe('danger');
    expect(c.hazards.gustFront.onHit.effect).toBe('gust');
    expect(c.hazards.gustFront.colorKey).not.toBe('danger');
    expect(hazardColorKey(c.hazards.gustFront)).toBe(c.hazards.gustFront.colorKey);
  });
});

describe('B4 content: the spec §4 values', () => {
  test('Space Mountain: Meteor is an air crash hazard in the jump arcs (like Seagull Dive)', () => {
    expect(c.hazards.meteor).toMatchObject({ placement: 'air', onHit: { effect: 'crash' }, biome: 'space-mountain' });
  });

  test('Sky Jellyfish: Gust Front is an air zone with ONE bounded impulse (<= 180 px/s, never clamped from above)', () => {
    const g = c.hazards.gustFront;
    expect(g.placement).toBe('air');
    expect(Array.isArray(g.onHit.impulsePxS)).toBe(true);
    const [x, y] = g.onHit.impulsePxS;
    expect(Math.hypot(x, y)).toBeLessThanOrEqual(GUST_MAX_PX_S);
    expect(gustImpulse(g.onHit.impulsePxS)).toEqual({ dvx: x, dvy: y });
    expect(Math.hypot(x, y)).toBeGreaterThanOrEqual(100); // felt: a kick, not a nudge
  });

  test('Gravity Stabilizer: stabilize, landing tolerance +12 deg for 5 s (no bounce change)', () => {
    const e = c.powerups.gravityStabilizer.effect;
    expect(e).toEqual({ kind: 'stabilize', landingToleranceDeg: 12, durationMs: 5000 });
    expect(stabilizeToleranceDeg(e.landingToleranceDeg)).toBe(12);
    expect(stabilizeBounceMul(e.bounceMul)).toBe(1);
    expect(timedPowerupMs(e)).toBe(5000);
  });

  test('Stabilizer Rails: the shared stabilize kind, with a damped bounce (bounceMul < 1, inside the clamp)', () => {
    const e = c.powerups.stabilizerRails.effect;
    expect(e.kind).toBe('stabilize');
    expect(e.bounceMul).toBeGreaterThan(0.1);
    expect(e.bounceMul).toBeLessThan(1);
    expect(stabilizeBounceMul(e.bounceMul)).toBe(e.bounceMul);
    expect(stabilizeToleranceDeg(e.landingToleranceDeg)).toBe(e.landingToleranceDeg);
    expect(timedPowerupMs(e)).toBe(e.durationMs);
  });
});

describe('B4 content: each power-up counters its own biome', () => {
  test('the Gravity Stabilizer turns a landing just past the forgiveness angle from a crash into a wobble', () => {
    const tol = c.powerups.gravityStabilizer.effect.landingToleranceDeg;
    const land = { quality: 'crash', angleDeg: TUNING.forgiveAngleDeg + 6, impactSpeedPxS: 500 };
    expect(resolveLanding(land, 0).quality).toBe('crash');
    expect(resolveLanding(land, tol).quality).toBe('sloppy');
    // past the widened tolerance it still crashes (the stabilizer is a margin, not invulnerability)
    expect(resolveLanding({ ...land, angleDeg: TUNING.forgiveAngleDeg + tol + 1 }, tol).quality).toBe('crash');
  });

  test('the Stabilizer Rails damp the Sky Jellyfish bouncySpring mod on the real tuner (bounce and restitution lower)', () => {
    expect(c.biomes['sky-jellyfish-mountain'].mod).toBe('bouncySpring');
    const t = new PhysicsTuner();
    const zone = [c.terrainMods.bouncySpring];
    const m = stabilizeBounceMul(c.powerups.stabilizerRails.effect.bounceMul);
    const bouncy = t.getEffective({ zones: zone });
    const railed = t.getEffective({ zones: zone, stabilizeBounceMul: m });
    expect(bouncy.bounceMul).toBeGreaterThan(1.5);
    expect(railed.bounceMul).toBeCloseTo(bouncy.bounceMul * m, 12);
    expect(railed.restitution).toBeLessThan(bouncy.restitution * 0.5);
  });

  test('no B4 def appears at mask 0', () => {
    const ids = new Set([...B4_HAZ, ...B4_PU].map((d) => d.id));
    const g = makeGen('b4-mask0', { biomeMask: 0 });
    for (let i = 0; i < 120; i++) {
      const ch = g.getChunk(i);
      expect(ch.hazards.some((h) => ids.has(h.defId))).toBe(false);
      expect(ch.powerups.some((p) => ids.has(p.defId))).toBe(false);
    }
  });
});
