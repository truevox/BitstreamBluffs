/**
 * W3 at the call sites — the mask a run actually starts with.
 *
 * CC Friday's finding on `3453347`: a normal run never has biomes. `TitleScene.startRun` took the mask
 * only from `maskOverride` or a `seed@mask` suffix, so START RUN and a bare ENTER SEED always ran at
 * mask 0 no matter what the profile had enabled. She set a profile to Sync Level 30 with `biomeMask 31`,
 * pressed START RUN, and the registry mask was 0.
 *
 * These tests pin the CALLER, the same way the D6 tests pin GameOverScene's call site rather than
 * re-testing SaveStore. The rule under test:
 *   explicit `maskOverride` (Daily) > `seed@mask` suffix > the profile's enabled-and-unlocked bits.
 * A locked biome's bit is never honoured, even if it is set in the profile.
 */
import { jest } from '@jest/globals';
jest.unstable_mockModule('phaser', () => ({ default: { Scene: class {}, GameObjects: new Proxy({}, { get: () => class {} }) } }));
jest.unstable_mockModule('../../src/data/index.js', () => ({ content: {}, loadContent: () => ({}) }));
const { TitleScene } = await import('../../src/scenes/TitleScene.js');
const { REG, SCENES } = await import('../../src/constants.js');

const DEFS = {
  debumont: { id: 'debumont', bit: 1 },
  glacier: { id: 'glacier', bit: 2 },
  pyramid: { id: 'pyramid', bit: 4 },
};

/**
 * A TitleScene whose registry is a plain Map. `startRun` is called directly on the prototype so this
 * exercises the real method, not a re-implementation of it.
 * @param {{profile?:Object}} [o]
 */
function scene(o = {}) {
  const values = new Map([[REG.CONTENT, { biomes: DEFS }]]);
  if (o.profile) values.set(REG.PROFILE, o.profile);
  const ctx = {
    registry: { get: (k) => values.get(k), set: (k, v) => values.set(k, v) },
    scene: { start: jest.fn() },
    _closeView() {},
  };
  return { ctx, values };
}

/** A profile at cap with every batch-1 bit enabled, i.e. the state CC Friday tested. */
const capped = (over = {}) => ({
  v: 1, biomeMask: 7, level: 30,
  pendingBiomes: ['debumont', 'glacier', 'pyramid'],
  unlocked: { biomes: [], cosmetics: [], boosts: {} },
  ...over,
});

describe('START RUN / bare seed use the profile mask', () => {
  test('a bare seed starts with the enabled unlocked bits, not 0', () => {
    const { ctx, values } = scene({ profile: capped() });
    TitleScene.prototype.startRun.call(ctx, 'alpha');
    expect(values.get(REG.BIOME_MASK)).toBe(7);
    expect(values.get(REG.SEED)).toBe('alpha');
    expect(ctx.scene.start).toHaveBeenCalledWith(SCENES.RUN);
  });

  test('a profile with nothing enabled runs at mask 0', () => {
    const { ctx, values } = scene({ profile: capped({ biomeMask: 0 }) });
    TitleScene.prototype.startRun.call(ctx, 'alpha');
    expect(values.get(REG.BIOME_MASK)).toBe(0);
  });

  test('with no profile at all it stays mask 0 rather than throwing', () => {
    // A first launch, or a profile that failed to load. Terrain must still be playable.
    const { ctx, values } = scene();
    TitleScene.prototype.startRun.call(ctx, 'alpha');
    expect(values.get(REG.BIOME_MASK)).toBe(0);
  });

  test('a bit for a biome the profile has NOT unlocked is stripped', () => {
    // The profile says 1|2|4 but only Debumont is unlocked (level 4). Honouring the glacier/pyramid
    // bits would hand a low-level player terrain they never earned — the same rule toggleBiome enforces.
    const { ctx, values } = scene({ profile: capped({ biomeMask: 7, pendingBiomes: ['debumont'] }) });
    TitleScene.prototype.startRun.call(ctx, 'alpha');
    expect(values.get(REG.BIOME_MASK)).toBe(1);
  });

  test('unlocked.biomes counts too, not just pendingBiomes', () => {
    const { ctx, values } = scene({
      profile: capped({ biomeMask: 7, pendingBiomes: [], unlocked: { biomes: ['glacier'], cosmetics: [], boosts: {} } }),
    });
    TitleScene.prototype.startRun.call(ctx, 'alpha');
    expect(values.get(REG.BIOME_MASK)).toBe(2);
  });
});

describe('an explicit mask wins over the profile', () => {
  test('the seed@mask suffix wins, so a shared seed reproduces exactly', () => {
    // This is what makes a share string shareable: the recipient must see the sender's world, not
    // their own unlocked set.
    const { ctx, values } = scene({ profile: capped({ biomeMask: 7 }) });
    TitleScene.prototype.startRun.call(ctx, 'alpha@2');
    expect(values.get(REG.SEED)).toBe('alpha');
    expect(values.get(REG.BIOME_MASK)).toBe(2);
  });

  test('the suffix wins even when it is @0', () => {
    // `seed@0` is a deliberate request for base terrain, not an absent suffix. Treating 0 as "unset"
    // would make it impossible to share a clean-terrain run with a player who has biomes on.
    const { ctx, values } = scene({ profile: capped({ biomeMask: 7 }) });
    TitleScene.prototype.startRun.call(ctx, 'alpha@0');
    expect(values.get(REG.BIOME_MASK)).toBe(0);
  });

  test('a Daily override wins over both the suffix and the profile', () => {
    // D6: the Daily mask is derived from the date and is the same for every player. It must not be
    // overridden by local unlocks, or two players' Daily runs would be different worlds.
    const { ctx, values } = scene({ profile: capped({ biomeMask: 7 }) });
    TitleScene.prototype.startRun.call(ctx, 'alpha@2', 8);
    expect(values.get(REG.BIOME_MASK)).toBe(8);
  });

  test('a Daily mask 0 is honoured, not treated as absent', () => {
    const { ctx, values } = scene({ profile: capped({ biomeMask: 7 }) });
    TitleScene.prototype.startRun.call(ctx, 'daily-2026-11-13', 0);
    expect(values.get(REG.BIOME_MASK)).toBe(0);
  });

  test('a suffix naming bits with no biome is still stripped to playable bits', () => {
    const { ctx, values } = scene({ profile: capped() });
    TitleScene.prototype.startRun.call(ctx, 'alpha@999');
    expect(values.get(REG.BIOME_MASK)).toBe(7);
  });
});
