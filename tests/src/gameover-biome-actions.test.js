/**
 * W3 — Game Over's two run-starting actions and the biome mask.
 *
 * CC Friday's requirement: "Retry from Game Over must keep the mask of the run being retried."
 *
 * `retry()` set REG.SEED and nothing else. That happens to work today only because nothing clears
 * REG.BIOME_MASK between scenes, so the previous run's value is still sitting in the registry — it is
 * correct by accident, and it breaks the moment a scene resets the registry or `newSeed()` runs first.
 *
 * `newSeed()` is the same bug with a visible consequence: it sets a fresh seed but leaves the previous
 * run's mask behind, so pressing NEW SEED after a Daily run (mask 8, date-derived) starts an ordinary
 * run at mask 8 — a world the player never chose, and one that is not the Daily any more either.
 *
 * These pin the actions themselves, called on the prototype, not a re-implementation.
 */
import { jest } from '@jest/globals';
jest.unstable_mockModule('phaser', () => ({ default: { Scene: class {}, GameObjects: new Proxy({}, { get: () => class {} }) } }));
jest.unstable_mockModule('../../src/data/index.js', () => ({ content: {}, loadContent: () => ({}) }));
const { GameOverScene } = await import('../../src/scenes/GameOverScene.js');
const { REG, SCENES } = await import('../../src/constants.js');

const DEFS = {
  debumont: { id: 'debumont', bit: 1 },
  glacier: { id: 'glacier', bit: 2 },
  pyramid: { id: 'pyramid', bit: 4 },
};

/** A capped profile with every batch-1 signature enabled. */
const capped = (over = {}) => ({
  v: 1, biomeMask: 7, level: 30,
  pendingBiomes: ['debumont', 'glacier', 'pyramid'],
  unlocked: { biomes: [], cosmetics: [], boosts: {} },
  ...over,
});

/**
 * @param {{rec?:Object, profile?:Object, mask?:number}} o
 */
function scene(o = {}) {
  const values = new Map([[REG.CONTENT, { biomes: DEFS }]]);
  if (o.profile) values.set(REG.PROFILE, o.profile);
  if (o.mask !== undefined) values.set(REG.BIOME_MASK, o.mask);
  const ctx = {
    registry: { get: (k) => values.get(k), set: (k, v) => values.set(k, v) },
    rec: o.rec || { seed: 'alpha', id: 'r1' },
    scene: { start: jest.fn() },
    leaving: false,
    pulse: null,
    _commitPending() {},
  };
  return { ctx, values };
}

describe('RETRY keeps the mask of the run being retried', () => {
  test('a mask-16 run retries at mask 16, not at the profile mask', () => {
    // The run's own mask wins over the profile: the player picked this world (or the Daily did) and
    // asked to try it again, not to change it.
    const { ctx, values } = scene({ mask: 16, profile: capped({ biomeMask: 1 }), rec: { seed: 'alpha', id: 'r1', biomeMask: 16 } });
    GameOverScene.prototype.retry.call(ctx);
    expect(values.get(REG.BIOME_MASK)).toBe(16);
    expect(values.get(REG.SEED)).toBe('alpha');
    expect(ctx.scene.start).toHaveBeenCalledWith(SCENES.RUN);
  });

  test('retry sets the mask explicitly, so it does not depend on registry leftovers', () => {
    // Start with NO mask in the registry at all: nothing to accidentally inherit. A run whose record
    // says mask 2 must still retry at mask 2.
    const { ctx, values } = scene({ profile: capped({ biomeMask: 7 }), rec: { seed: 'alpha', id: 'r1', biomeMask: 2 } });
    GameOverScene.prototype.retry.call(ctx);
    expect(values.get(REG.BIOME_MASK)).toBe(2);
  });

  test('a mask-0 run retries at 0 even when the profile has signatures enabled', () => {
    // The inverse mistake: falling back to the profile mask would silently switch a clean run into a
    // biome run, so the retry would not be the same run.
    const { ctx, values } = scene({ profile: capped({ biomeMask: 7 }), rec: { seed: 'alpha', id: 'r1', biomeMask: 0 } });
    GameOverScene.prototype.retry.call(ctx);
    expect(values.get(REG.BIOME_MASK)).toBe(0);
  });

  test('a pre-W3 record with no mask retries at 0', () => {
    const { ctx, values } = scene({ profile: capped({ biomeMask: 7 }), rec: { seed: 'alpha', id: 'r1' } });
    GameOverScene.prototype.retry.call(ctx);
    expect(values.get(REG.BIOME_MASK)).toBe(0);
  });
});

describe('NEW SEED drops the previous run mask', () => {
  test('NEW SEED after a Daily run does not inherit the Daily mask', () => {
    // The bug this pins: newSeed() set only REG.SEED, so the Daily's date-derived mask stayed in the
    // registry and an ordinary new-seed run was played in it.
    const { ctx, values } = scene({ mask: 8, profile: capped({ biomeMask: 7 }) });
    GameOverScene.prototype.newSeed.call(ctx);
    expect(values.get(REG.BIOME_MASK)).toBe(7);
  });

  test('NEW SEED with nothing enabled runs at mask 0', () => {
    const { ctx, values } = scene({ mask: 8, profile: capped({ biomeMask: 0 }) });
    GameOverScene.prototype.newSeed.call(ctx);
    expect(values.get(REG.BIOME_MASK)).toBe(0);
  });

  test('NEW SEED strips bits for biomes the profile has not unlocked', () => {
    const { ctx, values } = scene({ mask: 8, profile: capped({ biomeMask: 7, pendingBiomes: ['debumont'] }) });
    GameOverScene.prototype.newSeed.call(ctx);
    expect(values.get(REG.BIOME_MASK)).toBe(1);
  });
});
