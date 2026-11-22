// Issue #120 finding 4 (session leak): the SAME RunScene instance serves every run of a page session, so a field that
// create() does not reset leaks the previous run's outcome into the next run. Diagnostic, non-authoritative: the
// per-tick comparison below is test-side evidence, not the #152 fingerprint.
//
// Root cause pinned here: `_biomeSector` (and `_lastBiome`) were never reset in create(). The first tick of a mask != 0
// run compares the sled's sector with it: a fresh page (undefined) sees a "change" and runs refreshPalette(), which
// removes and re-adds every collider (world order, ids and warm-start state change); a later run whose previous run
// ended in the same sector sees no change and does not. Same tape, different physics by session position.
import { jest } from '@jest/globals';

const { installPhaserStub, createRun, stepRun } = await import('./headlessRun.js');
const { Matter } = installPhaserStub(jest);
const { RunScene } = await import('../../src/scenes/RunScene.js');
const { REG } = await import('../../src/constants.js');

const MASK = 0xffffffff; // every biome unlocked: sector changes call refreshPalette
const bodyOrder = (scene) => scene.matter.world.localWorld.bodies.map((b) => b.label);
const pose = (scene) => { const b = scene.sled.body; return [b.position.x, b.position.y, b.angle, b.velocity.x, b.velocity.y, b.angularVelocity]; };

/** Restart on the SAME instance, the way Phaser's scene.start('RunScene') does: shutdown (teardown), then create(). */
function restart(scene) {
  scene.teardown();
  Matter.Composite.clear(scene.matter.world.localWorld, false, true);
  scene.create();
}

describe('a run starts from identical sim state whatever ran before it in the page session', () => {
  let refreshCalls;
  beforeEach(() => {
    refreshCalls = 0;
    const real = RunScene.prototype.refreshPalette;
    jest.spyOn(RunScene.prototype, 'refreshPalette').mockImplementation(function (...a) { refreshCalls++; return real.apply(this, a); });
  });
  afterEach(() => jest.restoreAllMocks());

  test('run #2 on a reused scene instance behaves exactly like the same run on a fresh instance', () => {
    const fresh = createRun(RunScene, REG, { seed: 'ISO-TARGET', biomeMask: MASK });
    stepRun(fresh, 1);
    const freshOrder = bodyOrder(fresh);
    const freshRefresh = refreshCalls;
    stepRun(fresh, 119);
    const freshPose = pose(fresh);

    // A previous run on the SAME instance, on another seed that ends in sector 1 (as the terrain-crash run does).
    refreshCalls = 0;
    const reused = createRun(RunScene, REG, { seed: 'ISO-PREVIOUS', biomeMask: MASK });
    stepRun(reused, 30);
    reused.registry.set(REG.SEED, 'ISO-TARGET');
    restart(reused);
    refreshCalls = 0;
    stepRun(reused, 1);

    expect(refreshCalls).toBe(freshRefresh);
    expect(bodyOrder(reused)).toEqual(freshOrder);
    stepRun(reused, 119);
    expect(pose(reused)).toEqual(freshPose);
  });

  test('the biome-announcement fields are reset by create()', () => {
    const scene = createRun(RunScene, REG, { seed: 'ISO-FIELDS', biomeMask: MASK });
    stepRun(scene, 5);
    expect(scene._biomeSector).toBe(1);
    scene._lastBiome = true;
    restart(scene);
    expect(scene._biomeSector).toBeUndefined();
    expect(scene._lastBiome).toBeUndefined();
  });
});

describe('no instance field survives from the previous run', () => {
  test('after restart (before its first tick) the scene has no own field that a fresh create() lacks', () => {
    const fresh = createRun(RunScene, REG, { seed: 'ISO-KEYS', biomeMask: MASK });
    const freshKeys = new Set(Object.keys(fresh));
    const used = createRun(RunScene, REG, { seed: 'ISO-KEYS', biomeMask: MASK });
    stepRun(used, 400);
    restart(used);
    // A key that exists only as null/undefined/false (teardown() nulls its objects) carries nothing into the next run.
    const leaked = Object.keys(used).filter((k) => !freshKeys.has(k) && used[k] != null && used[k] !== false).sort();
    // Lists the keys so a new leak names itself. Fields that only exist after the first tick of a run must be reset in create().
    expect(leaked).toEqual([]);
  });
});
