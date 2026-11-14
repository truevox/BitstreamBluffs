// Biome-tagged content FIXTURES for the B0 groundwork tests (not a test file, not shipped content).
// B0 adds the engine for biome hazards and power-ups but no biome content; these defs stand in for the
// JSON that B1-B4 will add under src/data/hazards and src/data/powerups.

/** Ground biome hazard (Garbage Dump Glacier). */
export const FX_GROUND_HAZARD = Object.freeze({
  id: 'fxGroundHazard',
  biome: 'garbage-dump-glacier',
  shapeKey: 'fxUnknownShape',
  size: { w: 26, h: 22 },
  onHit: { effect: 'slow', durationMs: 900, speedFactor: 0.7 },
  spawn: { baseChance: 0.5 },
  weight: 1,
  minDistanceM: 0,
  placement: 'ground',
  colorKey: 'lime',
});

/** Air biome hazard (Space Mountain), placed in jump arcs. */
export const FX_AIR_HAZARD = Object.freeze({
  id: 'fxAirHazard',
  biome: 'space-mountain',
  shapeKey: 'fxUnknownAir',
  size: { w: 40, h: 28 },
  onHit: { effect: 'crash' },
  spawn: { baseChance: 0.5 },
  weight: 1,
  minDistanceM: 0,
  placement: 'air',
  colorKey: 'magenta',
});

/** Biome power-up (Garbage Dump Glacier): a ward against its own sticky ground. */
export const FX_WARD_POWERUP = Object.freeze({
  id: 'fxWardPowerup',
  biome: 'garbage-dump-glacier',
  shapeKey: 'fxUnknownPickup',
  radius: 10,
  effect: { kind: 'ward', durationMs: 4000, mods: ['stickyPatch'], hazards: [], effects: [] },
  spawn: { baseChance: 0.5, distanceDecayM: 1500 },
  colorKey: 'cyan',
});

/** Second biome power-up (Space Mountain). */
export const FX_STABILIZE_POWERUP = Object.freeze({
  id: 'fxStabilizePowerup',
  biome: 'space-mountain',
  shapeKey: 'fxUnknownPickup2',
  radius: 10,
  effect: { kind: 'stabilize', landingToleranceDeg: 12, durationMs: 5000 },
  spawn: { baseChance: 0.5, distanceDecayM: 1500 },
  colorKey: 'amber',
});

const byId = (arr) => Object.fromEntries(arr.map((d) => [d.id, JSON.parse(JSON.stringify(d))]));

/** Shipped content plus every fixture above, as TerrainGenerator options overrides. */
export function withBiomeFixtures(content, extra = {}) {
  return {
    hazardDefs: { ...content.hazards, ...byId([FX_GROUND_HAZARD, FX_AIR_HAZARD]), ...(extra.hazards || {}) },
    powerupDefs: { ...content.powerups, ...byId([FX_WARD_POWERUP, FX_STABILIZE_POWERUP]), ...(extra.powerups || {}) },
  };
}

/** Mask with both fixture biomes on (garbage-dump-glacier 2 | space-mountain 32). */
export const FX_MASK = 2 | 32;
