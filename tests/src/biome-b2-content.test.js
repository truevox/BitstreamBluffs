/**
 * B2 "Sight" content (spec §4 table and bounds): the biome hazard and power-up of Crystal Cavern (16) and Vertigo Vents
 * (1024). Loader + schema check for the new JSON, the values the spec names, the pairing rule (the Goggles ward off the
 * blind both B2 hazards cause, and the scramble of the base Garbage Data Vent), and the shield-source helpers that let
 * the biome-only Heat Shield report its own HUD chip.
 */
import { readDir, loadContent, makeGen } from './_helpers.js';
import { PALETTE_KEYS } from '../../src/constants.js';
import { emptyWards, addWard, isWarded, tickWards, WARD_MIN_MS, WARD_MAX_MS } from '../../src/systems/Wards.js';
import {
  hazardDrawKind, powerupDrawKind, hazardColorKey, BLIND_MIN_VISIBILITY, blindVisibility,
  addShieldSource, spendShieldSource, shieldChargesFor, SHIELD_DEFAULT_SOURCE,
} from '../../src/systems/BiomeEffects.js';
import { BIOME_SPAWN_MAX_CHANCE, BIOME_HAZARD_MAX_CHANCE } from '../../src/systems/TerrainGenerator.js';

const c = loadContent();
const biomeHaz = readDir('hazards').filter((d) => d.biome);
const biomePu = readDir('powerups').filter((d) => d.biome);

/** Spec §4 B2 rows. */
const B2 = {
  'crystal-cavern': { hazard: 'shatterWall', powerup: 'crystalClearGoggles' },
  'vertigo-vents': { hazard: 'ashCloud', powerup: 'heatShield' },
};
const B2_HAZ = Object.values(B2).map((r) => c.hazards[r.hazard]);
const B2_PU = Object.values(B2).map((r) => c.powerups[r.powerup]);

describe('B2 content: loader and schema', () => {
  test('exactly one hazard and one power-up per B2 biome; 6 biome hazards and 6 biome power-ups shipped after B1 + B2', () => {
    const byBiome = (list) => Object.fromEntries(Object.keys(B2).map((b) => [b, list.filter((d) => d.biome === b).map((d) => d.id)]));
    expect(byBiome(biomeHaz)).toEqual(Object.fromEntries(Object.entries(B2).map(([b, r]) => [b, [r.hazard]])));
    expect(byBiome(biomePu)).toEqual(Object.fromEntries(Object.entries(B2).map(([b, r]) => [b, [r.powerup]])));
    expect(biomeHaz.length).toBe(6);
    expect(biomePu.length).toBe(6);
    for (const r of Object.values(B2)) {
      expect(c.hazards[r.hazard]).toBeDefined();
      expect(c.powerups[r.powerup]).toBeDefined();
    }
  });

  test('every B2 def names a real biome and follows the hazard / power-up schema and the §4 chance caps', () => {
    for (const h of B2_HAZ) {
      expect(c.biomes[h.biome]).toBeDefined();
      expect(h.size.w).toBeGreaterThan(0);
      expect(h.size.h).toBeGreaterThan(0);
      expect(h.weight).toBeGreaterThan(0);
      expect(h.minDistanceM).toBeGreaterThanOrEqual(0);
      expect(['ground', 'air']).toContain(h.placement);
      expect(PALETTE_KEYS).toContain(h.colorKey);
      expect(h.spawn.baseChance).toBeGreaterThan(0);
      expect(h.spawn.baseChance).toBeLessThanOrEqual(BIOME_HAZARD_MAX_CHANCE);
    }
    for (const p of B2_PU) {
      expect(c.biomes[p.biome]).toBeDefined();
      expect(p.radius).toBeGreaterThan(0);
      expect(PALETTE_KEYS).toContain(p.colorKey);
      expect(p.spawn.baseChance).toBeGreaterThan(0);
      expect(p.spawn.baseChance).toBeLessThanOrEqual(BIOME_SPAWN_MAX_CHANCE);
    }
  });

  test('every B2 shapeKey has its own drawing, all shapeKeys stay unique; the blind hazards are not drawn as danger', () => {
    for (const h of B2_HAZ) expect({ id: h.id, draw: hazardDrawKind(h) }).toEqual({ id: h.id, draw: h.shapeKey });
    for (const p of B2_PU) expect({ id: p.id, draw: powerupDrawKind(p) }).toEqual({ id: p.id, draw: p.shapeKey });
    const keys = [...biomeHaz, ...biomePu].map((d) => d.shapeKey);
    expect(new Set(keys).size).toBe(keys.length);
    for (const h of B2_HAZ) {
      expect(h.colorKey).not.toBe('danger'); // `danger` is for crash hazards (spec §4); a blind hit never crashes
      expect(hazardColorKey(h)).toBe(h.colorKey);
    }
  });
});

describe('B2 content: the spec §4 values', () => {
  test('Crystal Cavern: Shatter Wall is a ground blind of 1.2 s (no crash); Goggles ward blind and scramble for 6 s', () => {
    expect(c.hazards.shatterWall).toMatchObject({ placement: 'ground', onHit: { effect: 'blind', durationMs: 1200 } });
    expect(c.powerups.crystalClearGoggles.effect).toEqual({ kind: 'ward', durationMs: 6000, mods: [], hazards: [], effects: ['blind', 'scramble'] });
  });

  test('Vertigo Vents: Ash Cloud is an air blind (same kind and timing); Heat Shield is the existing shield, 1 charge', () => {
    expect(c.hazards.ashCloud).toMatchObject({ placement: 'air', onHit: { effect: 'blind', durationMs: 1200 } });
    expect(c.powerups.heatShield.effect).toEqual({ kind: 'shield', charges: 1 });
    // the same kind as the base Hashed Backup, but its own biome-only def
    expect(c.powerups.heatShield.effect.kind).toBe(c.powerups.hashedBackup.effect.kind);
    expect(c.powerups.hashedBackup.biome).toBeUndefined();
  });

  test('blind is readable: both B2 hazards keep >= 35 % visibility as defined (never clamped up from below)', () => {
    for (const h of B2_HAZ) {
      expect(h.onHit.visibility).toBeGreaterThanOrEqual(BLIND_MIN_VISIBILITY);
      expect(blindVisibility(h.onHit.visibility)).toBe(h.onHit.visibility);
    }
  });

  test('Shatter Wall fits the slot rule: its box fits in a base ground hazard box + 8 px (vent, firewall, chasm)', () => {
    const w = c.hazards.shatterWall.size;
    const fits = Object.values(c.hazards).filter((d) => !d.biome && d.placement === 'ground' && w.w <= d.size.w + 8 && w.h <= d.size.h + 8).map((d) => d.id).sort();
    expect(fits).toEqual(['garbageDataVent', 'glitchChasm', 'overflowFirewall']);
  });
});

describe('B2 content: each power-up counters its own biome', () => {
  test('the Goggles ward is inside the 4-6 s band (Wards.addWard keeps 6 s) and wards both B2 hazards and the base scramble', () => {
    const e = c.powerups.crystalClearGoggles.effect;
    expect(e.durationMs).toBeGreaterThanOrEqual(WARD_MIN_MS);
    expect(e.durationMs).toBeLessThanOrEqual(WARD_MAX_MS);
    const w = addWard(emptyWards(), 'crystalClearGoggles', e);
    expect(w.wards[0].msLeft).toBe(6000);
    expect(isWarded(w, { effect: c.hazards.shatterWall.onHit.effect })).toBe(true);
    expect(isWarded(w, { effect: c.hazards.ashCloud.onHit.effect })).toBe(true);
    expect(isWarded(w, { effect: c.hazards.garbageDataVent.onHit.effect })).toBe(true);
    expect(isWarded(w, { effect: 'crash' })).toBe(false);
    expect(isWarded(w, { effect: 'slow' })).toBe(false);
    expect(isWarded(w, { modId: c.biomes['crystal-cavern'].mod })).toBe(false); // echoZone is a score zone, not a hazard
    tickWards(w, 6001);
    expect(isWarded(w, { effect: 'blind' })).toBe(false);
  });

  test('Heat Shield is a biome-only shield: absent from mask 0, and the base Hashed Backup keeps its def', () => {
    const g = makeGen('b2-shield', { biomeMask: 0 });
    for (let i = 0; i < 120; i++) {
      const ch = g.getChunk(i);
      expect(ch.powerups.some((p) => p.defId === 'heatShield')).toBe(false);
      expect(ch.hazards.some((h) => h.defId === 'shatterWall' || h.defId === 'ashCloud')).toBe(false);
    }
  });
});

describe('BiomeEffects B2: shield sources (which pickup a spent shield charge came from)', () => {
  test('a spent charge reports the most recent source; with no tracked source it is the base Hashed Backup', () => {
    expect(SHIELD_DEFAULT_SOURCE).toBe('hashedBackup');
    let s = addShieldSource(undefined, 'hashedBackup', 1);
    s = addShieldSource(s, 'heatShield', 1);
    expect(s).toEqual(['hashedBackup', 'heatShield']);
    let r = spendShieldSource(s);
    expect(r.id).toBe('heatShield');
    r = spendShieldSource(r.sources);
    expect(r.id).toBe('hashedBackup');
    r = spendShieldSource(r.sources);
    expect(r).toEqual({ sources: [], id: 'hashedBackup' }); // a W4 boost charge is never tracked: it is the Backup's
  });

  test('addShieldSource does not mutate, and adds one entry per charge (at least 1)', () => {
    const a = ['hashedBackup'];
    const b = addShieldSource(a, 'heatShield', 2);
    expect(a).toEqual(['hashedBackup']);
    expect(b).toEqual(['hashedBackup', 'heatShield', 'heatShield']);
    expect(addShieldSource([], 'heatShield', 0)).toEqual(['heatShield']);
  });

  test('shieldChargesFor: a biome shield counts its own charges; the Hashed Backup keeps the pool minus the others (a lone Backup keeps it all)', () => {
    expect(shieldChargesFor(['hashedBackup'], 'hashedBackup', 2)).toBe(2); // 1 pickup + 1 boost charge: unchanged x2
    expect(shieldChargesFor(['hashedBackup', 'heatShield'], 'heatShield', 2)).toBe(1);
    expect(shieldChargesFor(['hashedBackup', 'heatShield'], 'hashedBackup', 2)).toBe(1);
    expect(shieldChargesFor(undefined, 'heatShield', 1)).toBe(0); // an untracked charge is never a Heat Shield's
    expect(shieldChargesFor(undefined, 'hashedBackup', 1)).toBe(1);
  });

  test('an untracked charge (Error Correction boost, granted at spawn) belongs to the Hashed Backup, never to the Heat Shield chip', () => {
    // pool 2 = 1 boost charge + 1 Heat Shield pickup
    expect(shieldChargesFor(['heatShield'], 'heatShield', 2)).toBe(1);
    expect(shieldChargesFor(['heatShield'], 'hashedBackup', 2)).toBe(1);
    // pool 3 = 1 boost charge + 1 Hashed Backup + 1 Heat Shield: the Backup chip keeps the boost charge as before B2
    expect(shieldChargesFor(['hashedBackup', 'heatShield'], 'hashedBackup', 3)).toBe(2);
    expect(shieldChargesFor(['hashedBackup', 'heatShield'], 'heatShield', 3)).toBe(1);
  });
});
