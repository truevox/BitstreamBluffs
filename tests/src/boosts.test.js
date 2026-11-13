/**
 * W4 — boosts: default off, refused on the Daily, and the single source of `record.modded`.
 *
 * The dangerous half of this feature is not the shield or the speed; it is the flag. `record.modded`
 * decides whether a run is eligible for any clean board, so it must be derived in exactly one place and
 * must be impossible to forget. Two failure modes are pinned here:
 *
 *   1. A loadout that is absent, empty, or holds a junk value must produce modded=false. If a missing
 *      field read as "boosted", every run would be quietly exiled from the boards.
 *   2. A Daily run must be modded=false even when the player's saved loadout has boosts ON, because the
 *      daily refuses them. Otherwise the daily leaderboard would either hide honest daily runs or admit
 *      a boosted one.
 */
import {
  BOOSTS, BOOST_DEFS, enabledBoosts, loadoutForRun, isModdedRun, boostEffects, setBoost,
} from '../../src/systems/Boosts.js';

describe('defaults', () => {
  test('an absent or empty loadout enables nothing', () => {
    for (const l of [undefined, null, {}, { boosts: {} }, { boosts: { headStart: false } }]) {
      expect({ l: JSON.stringify(l), on: enabledBoosts(l) }).toMatchObject({ on: [] });
    }
  });

  test('a junk value does not enable a boost', () => {
    // 'true', 1, and 'yes' are all not `true`. A hand-edited save must not grant a boost.
    for (const junk of ['true', 1, 'yes', {}, []]) {
      expect({ junk: JSON.stringify(junk), on: enabledBoosts({ boosts: { headStart: junk } }) })
        .toMatchObject({ on: [] });
    }
  });

  test('an unknown boost id is ignored, not carried through', () => {
    expect(enabledBoosts({ boosts: { warpDrive: true, headStart: true } })).toEqual(['headStart']);
  });

  test('a clean run reports modded false', () => {
    expect(isModdedRun({})).toBe(false);
    expect(isModdedRun({ boosts: { headStart: false } })).toBe(false);
  });

  test('any boost reports modded true', () => {
    for (const id of BOOSTS) {
      expect({ id, modded: isModdedRun({ boosts: { [id]: true } }) }).toMatchObject({ id, modded: true });
    }
  });
});

describe('the Daily refuses boosts', () => {
  test('a boosted loadout produces a clean run on the daily', () => {
    const loadout = { boosts: { errorCorrection: true, headStart: true } };
    expect(loadoutForRun(loadout, { daily: true }).boosts).toEqual({ errorCorrection: false, headStart: false });
    expect(isModdedRun(loadout, { daily: true })).toBe(false);
  });

  test('the daily still gets no shield and no head start', () => {
    const eff = boostEffects({ boosts: { errorCorrection: true, headStart: true } }, { daily: true });
    expect(eff).toEqual({ shieldCharges: 0, speedFactor: 1, modded: false });
  });

  test('a daily run is never marked modded, even by a boosted save', () => {
    // This is what keeps the daily leaderboard honest while MODDED_RUNS_RANKED is false.
    expect(isModdedRun({ boosts: { headStart: true } }, { daily: true })).toBe(false);
  });
});

describe('effects', () => {
  test('Error Correction Engine starts with exactly one shield charge', () => {
    const eff = boostEffects({ boosts: { errorCorrection: true } });
    expect(eff.shieldCharges).toBe(1);
    expect(eff.speedFactor).toBe(1);
    expect(eff.modded).toBe(true);
  });

  test('Head Start raises the starting speed and nothing else', () => {
    const eff = boostEffects({ boosts: { headStart: true } });
    expect(eff.speedFactor).toBeGreaterThan(1);
    expect(eff.shieldCharges).toBe(0);
  });

  test('both together apply both, and their factors multiply once', () => {
    const eff = boostEffects({ boosts: { errorCorrection: true, headStart: true } });
    expect(eff.shieldCharges).toBe(1);
    expect(eff.speedFactor).toBe(BOOST_DEFS.headStart.speedFactor);
  });

  test('an unboosted run has no effects at all', () => {
    expect(boostEffects({})).toEqual({ shieldCharges: 0, speedFactor: 1, modded: false });
  });

  test('Head Start does not touch a physics constant', () => {
    // Spec W4 / §6: no change to physics tuning constants outside a biome's own bounded mod. Head Start
    // is a starting velocity, so PHYSICS must be identical to a clean run's; this asserts the module
    // exposes no physics override at all.
    const eff = boostEffects({ boosts: { headStart: true } });
    expect(Object.keys(eff).sort()).toEqual(['modded', 'shieldCharges', 'speedFactor']);
    expect(eff).not.toHaveProperty('gravityPxS2');
    expect(eff).not.toHaveProperty('dragUntucked');
  });
});

describe('setBoost', () => {
  test('turning a boost on and off round-trips', () => {
    const on = setBoost({}, 'headStart', true);
    expect(on.boosts.headStart).toBe(true);
    expect(setBoost(on, 'headStart', false).boosts.headStart).toBe(false);
  });

  test('setting a boost does not disturb the other', () => {
    const l = setBoost(setBoost({}, 'headStart', true), 'errorCorrection', true);
    expect(l.boosts).toEqual({ errorCorrection: true, headStart: true });
    const off = setBoost(l, 'headStart', false);
    expect(off.boosts).toEqual({ errorCorrection: true, headStart: false });
  });

  test('an unknown id leaves the loadout usable rather than throwing', () => {
    expect(setBoost({ boosts: { headStart: true } }, 'nope', true).boosts.headStart).toBe(true);
  });
});
