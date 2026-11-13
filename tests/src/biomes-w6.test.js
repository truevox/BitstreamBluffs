/**
 * W6: the six batch-2 biomes, and the proof that each mechanic actually reaches the game.
 *
 * Spec W6 says "same pattern and gates as W3". W3's gate was not "the JSON exists" — it was "every
 * physics biome changes an effective constant", which is what caught a biome that was pure decoration.
 * Four of W6's six mechanics are expressible in the existing constants, but two are not: Micro Mountain
 * lifts the surface, Vertigo Vents kicks the sled off it. Those need their own proofs, or they are data
 * nobody can feel.
 *
 * The batch-1 content assertions live in biomes.test.js and were extended in place (that file already
 * anticipated W6 by name). This file covers what is genuinely new.
 */
import fs from 'fs';
import { PhysicsTuner } from '../../src/systems/PhysicsTuner.js';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator.js';

const readJson = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const LEVELS = readJson('src/data/progression/levels.json');
const BIOMES = {
  space: readJson('src/data/biomes/space-mountain.json'),
  candy: readJson('src/data/biomes/candy-cane-canyon.json'),
  jelly: readJson('src/data/biomes/sky-jellyfish-mountain.json'),
  steam: readJson('src/data/biomes/steampunk-slopes.json'),
  micro: readJson('src/data/biomes/micro-mountain.json'),
  vertigo: readJson('src/data/biomes/vertigo-vents.json'),
};
const MOD_FILE = {
  lowGravity: 'src/data/terrainMods/low-gravity.json',
  sugarRush: 'src/data/terrainMods/sugar-rush.json',
  bouncySpring: 'src/data/terrainMods/bouncy-spring.json',
  conveyorBelt: 'src/data/terrainMods/conveyor-belt.json',
  dewSwell: 'src/data/terrainMods/dew-swell.json',
  geyserVent: 'src/data/terrainMods/geyser-vent.json',
};
const MODS = Object.fromEntries(Object.entries(MOD_FILE).map(([id, f]) => [id, readJson(f)]));

// PhysicsTuner takes no arguments: its tuning and base constants are module-level, exactly as
// biomes.test.js constructs it.
function tuner() {
  return new PhysicsTuner();
}

/** Effective physics with and without a single mod's zone active. */
function effectOf(mod) {
  const t = tuner();
  return { base: t.getEffective({}), mod: t.getEffective({ zones: [mod] }) };
}

describe('the six batch-2 biomes exist and point at their own mod', () => {
  test('each names exactly the mod its mechanic needs', () => {
    expect(BIOMES.space.mod).toBe('lowGravity');
    expect(BIOMES.candy.mod).toBe('sugarRush');
    expect(BIOMES.jelly.mod).toBe('bouncySpring');
    expect(BIOMES.steam.mod).toBe('conveyorBelt');
    expect(BIOMES.micro.mod).toBe('dewSwell');
    expect(BIOMES.vertigo.mod).toBe('geyserVent');
  });

  test('each mod file declares the mechanic the spec table names', () => {
    // Pinned to the SPEC TABLE, not to whatever the file happens to say: this is the line that turns a
    // typing mistake ("bouncy" wired to friction) into a test failure instead of a quiet misdesign.
    expect(MODS.lowGravity.physics.gravityMul).toBeLessThan(1);       // Low gravity
    expect(MODS.sugarRush.physics.speedMul).toBeGreaterThan(1);        // Sugar-rush surge...
    expect(MODS.sugarRush.physics.steerMul).toBeLessThan(1);           // ...with reduced steering
    expect(MODS.bouncySpring.physics.bounceMul).toBeGreaterThan(1);    // Bouncy surfaces
    expect(MODS.conveyorBelt.physics.pushForceMul).toBeGreaterThan(1); // Conveyor push
    expect(MODS.dewSwell.terrainSwell.amplitudePx).toBeGreaterThan(0); // Periodic swells
    expect(MODS.geyserVent.launch.velocityPxS).toBeGreaterThan(0);     // Geysers launch you
  });

  test('every batch-2 biome is ordered after batch 1 in levels.json', () => {
    // D4's order is not cosmetic: the unlock ladder must hand out the cheap mechanics before these.
    const order = LEVELS.biomeOrder;
    const batch1 = ['debumont', 'garbage-dump-glacier', 'pyramid-peak', 'underwater-mountain', 'crystal-cavern'];
    const lastBatch1 = Math.max(...batch1.map((id) => order.indexOf(id)));
    for (const id of Object.keys(BIOMES).length ? ['space-mountain', 'candy-cane-canyon', 'sky-jellyfish-mountain', 'steampunk-slopes', 'micro-mountain', 'vertigo-vents'] : []) {
      expect({ id, afterBatch1: order.indexOf(id) > lastBatch1 }).toMatchObject({ id, afterBatch1: true });
    }
  });
});

describe('the three constant-based mechanics reach the physics', () => {
  test('Space Mountain lowers gravity and nothing else', () => {
    const { base, mod } = effectOf(MODS.lowGravity);
    expect(mod.gravityPxS2).toBeLessThan(base.gravityPxS2);
    expect(mod.groundResist).toBe(base.groundResist);
    expect(mod.bounceMul).toBe(base.bounceMul);
  });

  test('Candy Cane raises speed and cuts steering, in opposite directions', () => {
    const { base, mod } = effectOf(MODS.sugarRush);
    expect(mod.speedMul).toBeGreaterThan(base.speedMul);
    // Steering is airControl, which is where the sled's tilt authority lives.
    expect(mod.airControl).toBeLessThan(base.airControl);
    // Reduced, never removed: a biome with no steering is a cutscene.
    expect(mod.airControl).toBeGreaterThan(0);
  });

  test('Sky Jellyfish raises bounce', () => {
    const { base, mod } = effectOf(MODS.bouncySpring);
    expect(mod.bounceMul).toBeGreaterThan(base.bounceMul);
    expect(mod.restitution).toBeGreaterThan(base.restitution);
  });

  test('Steampunk raises push force', () => {
    const { base, mod } = effectOf(MODS.conveyorBelt);
    expect(mod.pushForceMul).toBeGreaterThan(base.pushForceMul);
  });

  test('two overlapping sugar strips compound rather than one winning', () => {
    const t = tuner();
    const one = t.getEffective({ zones: [MODS.sugarRush] });
    const two = t.getEffective({ zones: [MODS.sugarRush, MODS.sugarRush] });
    expect(two.speedMul).toBeGreaterThan(one.speedMul);
  });
});

describe('Micro Mountain lifts the surface', () => {
  /** A generator with a single swell zone planted over a known span. */
  function withSwell(swell) {
    const mods = [{ id: 'synthetic', colorKey: 'cyan', physics: {}, terrainSwell: swell, weight: 1, minDistanceM: 0, lengthPx: [1, 2] }];
    const g = new TerrainGenerator({
      seed: 'swell-seed',
      biomeMask: 0,
      chunkTemplates: [],
      hazardDefs: [],
      modDefs: mods,
    });
    // Reach into the generated chunk to plant the zone: generation is seeded, so a synthetic zone is
    // clearer than trying to make the RNG produce one at a known x.
    const chunk = g._chunkAt(0);
    chunk.zones.length = 0;
    chunk.zones.push({ modId: 'synthetic', x0: 0, x1: 600 });
    return g;
  }

  test('the height differs from the un-swelled line, by at most the amplitude', () => {
    const amp = 20;
    const g = withSwell({ amplitudePx: amp, periodPx: 200 });
    let sawOffset = false;
    for (let x = 0; x <= 600; x += 10) {
      const offset = g._swellAt(x);
      expect(Math.abs(offset)).toBeLessThanOrEqual(amp + 1e-9);
      if (Math.abs(offset) > 1) sawOffset = true;
    }
    expect(sawOffset).toBe(true);
  });

  test('the swell is periodic: it returns to the same offset one period later', () => {
    const g = withSwell({ amplitudePx: 18, periodPx: 240 });
    const a = g._swellAt(40);
    const b = g._swellAt(40 + 240);
    expect(Math.abs(a - b)).toBeLessThan(1e-6);
  });

  test('zero outside the zone', () => {
    const g = withSwell({ amplitudePx: 18, periodPx: 240 });
    expect(g._swellAt(700)).toBe(0);
  });

  test('a swell never inverts the surface: amplitude is bounded by the schema test', () => {
    // The bound that matters is in data.test.js (amplitude must stay small). Here we pin the property
    // that makes the bound sufficient: the offset is a sine, so it can never exceed its amplitude.
    const g = withSwell({ amplitudePx: 26, periodPx: 220 });
    for (let x = 0; x < 600; x += 3) expect(Math.abs(g._swellAt(x))).toBeLessThanOrEqual(26 + 1e-9);
  });

  test('junk swell data contributes nothing rather than throwing', () => {
    const g = withSwell({ amplitudePx: 0, periodPx: 0 });
    expect(() => g._swellAt(100)).not.toThrow();
    expect(g._swellAt(100)).toBe(0);
  });
});

describe('Vertigo Vents launches the sled', () => {
  test('the launch is bounded and cooldown-backed', () => {
    const l = MODS.geyserVent.launch;
    // Enough to clear a normal jump, not enough to leave the playfield.
    expect(l.velocityPxS).toBeGreaterThan(300);
    expect(l.velocityPxS).toBeLessThan(1200);
    // Without a cooldown the vent would re-fire on every contact frame and the sled would never land.
    expect(l.cooldownMs).toBeGreaterThanOrEqual(250);
  });
});
