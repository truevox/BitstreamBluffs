/**
 * Issue #65 (Track B, profile): unlocked biomes default ON, the player's explicit OFF is authoritative, and
 * Debutmont is the base biome, unlocked from run 1.
 *
 * The profile stores explicit OFF choices in `biomeOff` (a bitfield of the biome table's `bit`s). The legacy
 * opt-in `biomeMask` is ignored, so every existing profile migrates to all-unlocked-ON with no PROFILE_VERSION
 * bump (a bump would wipe every profile). The base biome has no toggle and no bit in the run-start mask.
 */
import fs from 'fs';
import { jest } from '@jest/globals';
import {
  sanitizeProfile, ProfileStore, PROFILE_KEY, enabledBiomeMask, toggleBiome, biomeToggleRows,
  unlockedBiomeIds, earnedBiomeIds, BASE_BIOME_ID,
} from '../../src/systems/ProfileStore.js';
import { defaultProfile, PROFILE_VERSION } from '../../src/systems/Progression.js';
import { parseSeedMask } from '../../src/systems/SaveStore.js';
import { readDir } from './_helpers.js';
jest.unstable_mockModule('phaser', () => ({ default: { Scene: class {}, GameObjects: new Proxy({}, { get: () => class {} }) } }));
jest.unstable_mockModule('../../src/data/index.js', () => ({ content: {}, loadContent: () => ({}) }));
const { TitleScene } = await import('../../src/scenes/TitleScene.js');
const { GameOverScene } = await import('../../src/scenes/GameOverScene.js');
const { REG } = await import('../../src/constants.js');

const LEVELS = JSON.parse(fs.readFileSync('src/data/progression/levels.json', 'utf8'));
const DEFS = readDir('biomes');
const bitOf = (id) => DEFS.find((d) => d.id === id).bit;
const xpAt = (level) => LEVELS.levels.find((l) => l.level === level).xpMin;
const at = (level, o = {}) => sanitizeProfile({ v: 1, xp: xpAt(level), ...o }, LEVELS);
const GLACIER = bitOf('garbage-dump-glacier');
const PYRAMID = bitOf('pyramid-peak');

function memStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) };
}

describe('Debutmont is the base biome', () => {
  test('its data says unlocked from level 1, and the level table grants it there (not at level 4)', () => {
    expect(DEFS.find((d) => d.id === BASE_BIOME_ID).unlockLevel).toBe(1);
    expect(LEVELS.levels.find((l) => l.level === 1).biome).toBe('debutmont');
    expect(LEVELS.levels.find((l) => l.level === 4).biome).toBeNull();
    expect(LEVELS.levels.filter((l) => l.biome).map((l) => l.biome)).toEqual(LEVELS.biomeOrder);
  });

  test('a fresh profile at L1 has Debutmont unlocked and a run mask of 0', () => {
    const p = new ProfileStore({ levels: LEVELS }).load();
    expect(p.level).toBe(1);
    expect(unlockedBiomeIds(p)).toEqual(['debutmont']);
    expect(earnedBiomeIds(p, DEFS)).toEqual(['debutmont']);
    expect(enabledBiomeMask(p, DEFS)).toBe(0);
  });

  test('it is unlocked even for a profile built without the level table', () => {
    expect(unlockedBiomeIds({})).toEqual(['debutmont']);
    expect(unlockedBiomeIds(sanitizeProfile({ v: 1, xp: 5 }, null))).toContain('debutmont');
  });

  test('it has no toggle row and toggleBiome refuses it, so it can never be turned off', () => {
    const p = at(30);
    expect(biomeToggleRows(p, DEFS).map((r) => r.id)).not.toContain('debutmont');
    expect(toggleBiome(p, 'debutmont', DEFS)).toBe(p);
  });

  test('its bit never appears in enabledBiomeMask, whatever the profile carries', () => {
    for (const lvl of [1, 7, 30]) {
      for (const biomeOff of [0, 1, 2, 0xffffffff]) {
        expect(enabledBiomeMask(at(lvl, { biomeOff }), DEFS) & bitOf('debutmont')).toBe(0);
      }
    }
    expect(enabledBiomeMask(at(30), DEFS)).toBe(DEFS.reduce((a, d) => (d.id === 'debutmont' ? a : a | d.bit), 0));
  });
});

describe('unlocked biomes default ON', () => {
  test('after leveling to L7, Garbage Dump Glacier is ON without the player touching anything', () => {
    const s = new ProfileStore({ levels: LEVELS, storage: memStorage() });
    s.load();
    expect(enabledBiomeMask(s.profile, DEFS)).toBe(0);
    s.save({ ...s.profile, xp: xpAt(7) });
    expect(s.profile.level).toBe(7);
    expect(enabledBiomeMask(s.profile, DEFS)).toBe(GLACIER);
    expect(biomeToggleRows(s.profile, DEFS).find((r) => r.id === 'garbage-dump-glacier')).toMatchObject({ unlocked: true, enabled: true });
  });

  test('a newly unlocked biome is ON at its unlock level, every level up to the cap', () => {
    let expected = 0;
    for (let lvl = 1; lvl <= 30; lvl++) {
      const entry = LEVELS.levels.find((l) => l.level === lvl);
      if (entry.biome && entry.biome !== BASE_BIOME_ID) expected |= bitOf(entry.biome);
      expect({ lvl, mask: enabledBiomeMask(at(lvl), DEFS) }).toEqual({ lvl, mask: expected });
    }
  });
});

describe('an explicit OFF is authoritative', () => {
  test('it persists across save, load and sanitize, and across a later level-up', () => {
    const storage = memStorage();
    const a = new ProfileStore({ levels: LEVELS, storage });
    a.load();
    a.save({ ...a.profile, xp: xpAt(7) });
    a.save(toggleBiome(a.profile, 'garbage-dump-glacier', DEFS));
    expect(a.profile.biomeOff).toBe(GLACIER);
    expect(enabledBiomeMask(a.profile, DEFS)).toBe(0);

    const b = new ProfileStore({ levels: LEVELS, storage });
    b.load();
    expect(b.profile.biomeOff).toBe(GLACIER);
    expect(enabledBiomeMask(b.profile, DEFS)).toBe(0);
    expect(sanitizeProfile(JSON.parse(storage.getItem(PROFILE_KEY)), LEVELS).biomeOff).toBe(GLACIER);

    // A later level-up unlocks Pyramid Peak ON by default; the glacier stays OFF.
    b.save({ ...b.profile, xp: xpAt(10) });
    expect(b.profile.level).toBe(10);
    expect(b.profile.biomeOff).toBe(GLACIER);
    expect(enabledBiomeMask(b.profile, DEFS)).toBe(PYRAMID);
  });

  test('turning a biome back ON clears only its own OFF bit', () => {
    const off = at(10, { biomeOff: GLACIER | PYRAMID });
    const back = toggleBiome(off, 'garbage-dump-glacier', DEFS);
    expect(back.biomeOff).toBe(PYRAMID);
    expect(enabledBiomeMask(back, DEFS)).toBe(GLACIER);
  });

  test('biomeOff is sanitized to a non-negative integer, never a bump of PROFILE_VERSION', () => {
    expect(PROFILE_VERSION).toBe(1);
    expect(defaultProfile().biomeOff).toBe(0);
    for (const bad of [-5, NaN, 'x', null, undefined, {}, [], Infinity]) {
      expect(at(7, { biomeOff: bad }).biomeOff).toBe(0);
    }
    expect(at(7, { biomeOff: 6.2 }).biomeOff).toBe(6);
  });
});

describe('legacy profiles migrate to all-unlocked-ON', () => {
  test('a legacy profile with biomeMask 0 at level 28 has every unlocked biome ON', () => {
    const p = sanitizeProfile({ v: 1, xp: xpAt(28), biomeMask: 0 }, LEVELS);
    expect(p.level).toBe(28);
    expect('biomeMask' in p).toBe(false); // no longer written
    const all = DEFS.reduce((a, d) => (d.id === 'debutmont' ? a : a | d.bit), 0);
    expect(enabledBiomeMask(p, DEFS)).toBe(all);
    expect(biomeToggleRows(p, DEFS).every((r) => r.unlocked && r.enabled)).toBe(true);
  });

  test('the legacy mask is ignored, even a non-zero one', () => {
    const p = at(10, { biomeMask: GLACIER });
    expect(enabledBiomeMask(p, DEFS)).toBe(GLACIER | PYRAMID);
  });
});

describe('a locked biome can never be enabled', () => {
  test('toggleBiome refuses it', () => {
    const p = at(7);
    expect(toggleBiome(p, 'pyramid-peak', DEFS)).toBe(p);
  });

  test('a crafted biomeOff cannot enable or disturb a locked biome: only unlocked bits ever reach the mask', () => {
    for (const biomeOff of [0, PYRAMID, 0xffffffff, ~GLACIER >>> 0]) {
      expect(enabledBiomeMask(at(7, { biomeOff }), DEFS) & ~GLACIER).toBe(0);
    }
  });

  test('a crafted legacy mask cannot enable a locked biome', () => {
    expect(enabledBiomeMask(at(1, { biomeMask: 0xffffffff }), DEFS)).toBe(0);
    expect(enabledBiomeMask(at(7, { biomeMask: 0xffffffff }), DEFS)).toBe(GLACIER);
  });

  test('a stale OFF bit for a not-yet-unlocked biome is inert until unlocked, then keeps it OFF (explicit OFF wins)', () => {
    // Not reachable through the UI (toggleBiome refuses locked biomes); only a hand-edited save gets here.
    expect(enabledBiomeMask(at(7, { biomeOff: PYRAMID }), DEFS)).toBe(GLACIER); // Pyramid Peak still locked
    expect(enabledBiomeMask(at(10, { biomeOff: PYRAMID }), DEFS)).toBe(GLACIER); // unlocked, but explicitly OFF
  });

  test('a profile with no level table still never enables a biome it has not earned', () => {
    expect(enabledBiomeMask({ biomeOff: 0, pendingBiomes: [] }, DEFS)).toBe(0);
    expect(enabledBiomeMask(null, DEFS)).toBe(0);
  });
});

describe('run-start mask precedence is unchanged', () => {
  const content = { biomes: Object.fromEntries(DEFS.map((d) => [d.id, d])) };
  const sceneWith = (profile, extra = {}) => {
    const values = new Map([[REG.CONTENT, content], [REG.PROFILE, profile]]);
    for (const [k, v] of Object.entries(extra)) values.set(k, v);
    return {
      values,
      ctx: {
        registry: { get: (k) => values.get(k), set: (k, v) => values.set(k, v) },
        scene: { start: jest.fn() }, _closeView() {}, leaving: false, pulse: null, _commitPending() {},
      },
    };
  };
  const startMask = (profile, ...args) => {
    const { ctx, values } = sceneWith(profile);
    TitleScene.prototype.startRun.call(ctx, ...args);
    return values.get(REG.BIOME_MASK);
  };
  const L10 = () => at(10);

  test('a normal START RUN / bare seed uses the new default (every unlocked biome ON)', () => {
    expect(startMask(L10(), 'alpha')).toBe(GLACIER | PYRAMID);
    expect(startMask(at(1), 'alpha')).toBe(0);
    expect(startMask(toggleBiome(L10(), 'pyramid-peak', DEFS), 'alpha')).toBe(GLACIER);
  });

  test('seed@mask wins, including @0 and bits the profile has not unlocked (a shared seed reproduces)', () => {
    const want = parseSeedMask('alpha@16', DEFS).biomeMask;
    expect(startMask(L10(), 'alpha@16')).toBe(want);
    expect(startMask(L10(), 'alpha@0')).toBe(0);
    expect(startMask(at(1), `alpha@${GLACIER}`)).toBe(GLACIER);
  });

  test('a Daily maskOverride wins, including an override of 0', () => {
    expect(startMask(L10(), 'alpha', 8)).toBe(8);
    expect(startMask(L10(), 'daily-2026-11-13', 0)).toBe(0);
  });

  test('the BSOD Gym start (mask override 0) stays at 0 whatever the profile has ON', () => {
    expect(startMask({ ...L10(), bsodGym: { discovered: true, owned: true } }, 'bsod-gym', 0, { gym: true })).toBe(0);
  });

  test('NEW SEED takes the new default; RETRY reuses the record mask, not the profile default', () => {
    const profile = L10();
    const ns = sceneWith(profile, { [REG.BIOME_MASK]: 8 });
    GameOverScene.prototype.newSeed.call({ ...ns.ctx, rec: { seed: 'alpha', id: 'r1', biomeMask: 8 } });
    expect(ns.values.get(REG.BIOME_MASK)).toBe(GLACIER | PYRAMID);

    for (const recMask of [0, 8, GLACIER]) {
      const rt = sceneWith(profile);
      GameOverScene.prototype.retry.call({ ...rt.ctx, rec: { seed: 'alpha', id: 'r1', biomeMask: recMask } });
      expect(rt.values.get(REG.BIOME_MASK)).toBe(recMask);
    }
  });
});
