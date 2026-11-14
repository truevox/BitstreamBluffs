/**
 * Boosts apply only once the profile OWNS them. Head Start unlocks at Sync Level 8 and the Error Correction
 * Engine at 15 (levels.json; ProfileStore records them in `profile.unlocked.boosts` as `{ id: level }`).
 * A toggle that is switched on but not owned must not change the run and must not mark it modded.
 *
 * The rule lives in the pure Boosts.js: `boostEffects`, `isModdedRun` and `loadoutForRun` take the owned
 * set as `o.unlocked`, and an omitted set owns nothing (default off, like the toggles themselves).
 */
import fs from 'fs';
import { jest } from '@jest/globals';

jest.unstable_mockModule('phaser', () => ({
  default: { Scene: class {}, GameObjects: new Proxy({}, { get: () => class {} }) },
}));
jest.unstable_mockModule('../../src/data/index.js', () => ({ content: {}, loadContent: () => ({}) }));

const { sanitizeProfile } = await import('../../src/systems/ProfileStore.js');
const { boostEffects, isModdedRun, loadoutForRun } = await import('../../src/systems/Boosts.js');

const LEVELS = JSON.parse(fs.readFileSync('src/data/progression/levels.json', 'utf8'));
const v1 = (o = {}) => sanitizeProfile({ v: 1, ...o }, LEVELS);
const BOTH_ON = { boosts: { errorCorrection: true, headStart: true } };

describe('boosts are gated by their level unlock', () => {
  test('a level-1 profile with boosts.headStart=true does not start a boosted run', () => {
    const p = v1({ boosts: { headStart: true } });
    expect(p.level).toBe(1);
    const loadout = { boosts: { ...p.boosts } };
    expect(boostEffects(loadout, { daily: false }).speedFactor).toBe(1);
    expect(boostEffects(loadout, { daily: false, unlocked: p.unlocked.boosts }))
      .toEqual({ shieldCharges: 0, speedFactor: 1, modded: false });
  });

  test('only owned boosts apply, and only an owned boost marks the run modded', () => {
    const headStartOnly = { headStart: 8 };
    expect(boostEffects(BOTH_ON, { unlocked: headStartOnly })).toEqual({ shieldCharges: 0, speedFactor: 1.25, modded: true });
    expect(isModdedRun(BOTH_ON, { unlocked: headStartOnly })).toBe(true);
    expect(loadoutForRun(BOTH_ON, { unlocked: headStartOnly }).boosts).toEqual({ errorCorrection: false, headStart: true });

    expect(isModdedRun(BOTH_ON, { unlocked: {} })).toBe(false);
    expect(loadoutForRun(BOTH_ON, { unlocked: {} }).boosts).toEqual({ errorCorrection: false, headStart: false });
    expect(boostEffects(BOTH_ON, { unlocked: { headStart: 8, errorCorrection: 15 } }))
      .toEqual({ shieldCharges: 1, speedFactor: 1.25, modded: true });
  });

  test('an omitted owned set owns nothing', () => {
    expect(boostEffects(BOTH_ON)).toEqual({ shieldCharges: 0, speedFactor: 1, modded: false });
    expect(isModdedRun(BOTH_ON)).toBe(false);
  });

  test('a junk unlock value owns nothing', () => {
    for (const junk of [0, -8, '8', true, null, NaN, Infinity]) {
      expect({ junk: String(junk), fx: boostEffects({ boosts: { headStart: true } }, { unlocked: { headStart: junk } }) })
        .toMatchObject({ fx: { speedFactor: 1, modded: false } });
    }
  });

  test('the Daily still refuses owned boosts', () => {
    expect(boostEffects(BOTH_ON, { daily: true, unlocked: { headStart: 8, errorCorrection: 15 } }))
      .toEqual({ shieldCharges: 0, speedFactor: 1, modded: false });
  });
});
