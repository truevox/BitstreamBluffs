/**
 * W3 — biome-tied missions must be offerable to a normal credited profile.
 *
 * Luna's round-2 finding #5: `isOfferable` read `profile.unlocked.biomes`, which nothing populates,
 * and `profile.biomeOrder`, which nothing sets. So on a real profile both checks were vacuous or
 * fatal: a level-12 profile carrying three `pendingBiomes` had an empty `unlocked.biomes` list and
 * drew 0/500 biome missions. Manually filling `unlocked.biomes` made 62/500 appear — proof the gate
 * was the only thing blocking them.
 *
 * The subtle half is the mask check. Luna's `biomeOrder` bypass meant that with no order the mask was
 * never consulted at all, so a profile that had switched every signature OFF could still be offered
 * biome missions for terrain it would never see. Both halves are pinned here.
 */
import { isOfferable } from '../../src/systems/Missions.js';
import { earnedBiomeIds } from '../../src/systems/ProfileStore.js';

const BIOME_DEFS = [
  { id: 'debumont', bit: 1, unlockLevel: 1 },
  { id: 'garbage-dump-glacier', bit: 2, unlockLevel: 3 },
  { id: 'pyramid-peak', bit: 4, unlockLevel: 6 },
  { id: 'underwater-mountain', bit: 8, unlockLevel: 10 },
  { id: 'crystal-cavern', bit: 16, unlockLevel: 12 },
];

/** A credited profile as the game actually stores one: pendingBiomes derived, unlocked.biomes empty. */
const credited = (level, mask) => ({
  v: 1, xp: 0, level, bank: 0, biomeMask: mask,
  pendingBiomes: BIOME_DEFS.filter((d) => d.unlockLevel <= level).map((d) => d.id),
  unlocked: { biomes: [], cosmetics: [], boosts: {} },
  missions: { counter: 0, active: [], progress: {} }, achievements: {}, credited: [],
});

const missionFor = (biome) => ({ id: `m-${biome}`, biome, tier: 2, metric: 'distance', target: 100, xp: 10 });

describe('biome missions reach a real profile', () => {
  test("a credited profile's earned biomes are not an empty list", () => {
    const p = credited(12, 31);
    // The two reads that must agree. `unlocked.biomes` being empty is exactly why the old gate failed.
    expect(p.unlocked.biomes).toEqual([]);
    expect(earnedBiomeIds(p, BIOME_DEFS)).toEqual([
      'debumont', 'garbage-dump-glacier', 'pyramid-peak', 'underwater-mountain', 'crystal-cavern',
    ]);
  });

  test('a mission for an earned biome is offerable', () => {
    const p = credited(12, 31);
    expect(isOfferable(missionFor('crystal-cavern'), p, 'r1', BIOME_DEFS)).toBe(true);
  });

  test('a mission for a biome above the level is still refused', () => {
    // Unlock is earned, not merely enabled: a level-3 profile cannot be offered a level-12 biome.
    const p = credited(3, 31);
    expect(isOfferable(missionFor('crystal-cavern'), p, 'r1', BIOME_DEFS)).toBe(false);
    expect(isOfferable(missionFor('debumont'), p, 'r1', BIOME_DEFS)).toBe(true);
  });

  test('a mission for a switched-OFF signature is refused', () => {
    // Luna's biomeOrder bypass: with no order array the mask was never consulted, so this passed.
    const p = credited(12, 31 & ~16); // crystal-cavern off, everything else on
    expect(isOfferable(missionFor('crystal-cavern'), p, 'r1', BIOME_DEFS)).toBe(false);
    expect(isOfferable(missionFor('pyramid-peak'), p, 'r1', BIOME_DEFS)).toBe(true);
  });

  test('mask 0 offers no biome missions at all', () => {
    const p = credited(12, 0);
    for (const d of BIOME_DEFS) {
      expect({ id: d.id, offerable: isOfferable(missionFor(d.id), p, 'r1', BIOME_DEFS) })
        .toMatchObject({ id: d.id, offerable: false });
    }
  });

  test('backwards compatibility: the old two-argument call keeps working', () => {
    // Every existing caller and test passes no defs. Without them the mask cannot be resolved to ids,
    // so the gate must still fail closed for a biome the profile demonstrably has not earned.
    const p = credited(12, 31);
    expect(isOfferable(missionFor('crystal-cavern'), p, 'r1')).toBe(true);
    expect(isOfferable(missionFor('crystal-cavern'), credited(1, 31), 'r1')).toBe(false);
  });

  test('non-biome missions are unaffected', () => {
    const plain = { id: 'm-plain', tier: 1, metric: 'distance', target: 100, xp: 10 };
    expect(isOfferable(plain, credited(1, 0), 'r1', BIOME_DEFS)).toBe(true);
  });

  test('an excluded rule still wins over a biome mission', () => {
    const t = { ...missionFor('debumont'), excludedRuleIds: ['r1'] };
    expect(isOfferable(t, credited(12, 31), 'r1', BIOME_DEFS)).toBe(false);
  });
});
