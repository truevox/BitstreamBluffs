/**
 * Issue #65: the biome "Debumont" was renamed "Debutmont". The legacy id is an alias, not a second biome:
 * old saves migrate losslessly and a stale music pack / voice request resolves to the new key. A guard test
 * keeps the misspelling out of the tree everywhere except this alias layer and the historical CHANGELOG.
 */
import fs from 'fs';
import { execFileSync } from 'child_process';
import { LEGACY_BIOME_ALIASES, canonicalBiomeId, canonicalLegacyId } from '../../src/data/biomeAliases.js';
import { sanitizeProfile } from '../../src/systems/ProfileStore.js';
import { sanitizeBiomeProgress, mergeBiomeVisits, BIOME_IDS } from '../../src/systems/BiomeDiscovery.js';
import { normalizePack } from '../../src/systems/music/MusicPack.js';
import { voiceSourceForBiome } from '../../src/systems/music/BiomeVoices.js';

const LEGACY = 'debu' + 'mont'; // split so this guard does not match itself
const LEVELS = JSON.parse(fs.readFileSync('src/data/progression/levels.json', 'utf8'));

describe('legacy biome alias helpers', () => {
  test('maps the legacy id and leaves everything else alone', () => {
    expect(LEGACY_BIOME_ALIASES).toEqual({ [LEGACY]: 'debutmont' });
    expect(canonicalBiomeId(LEGACY)).toBe('debutmont');
    expect(canonicalBiomeId('debutmont')).toBe('debutmont');
    expect(canonicalBiomeId('pyramid-peak')).toBe('pyramid-peak');
    expect(canonicalBiomeId('toString')).toBe('toString');
    expect(canonicalBiomeId(undefined)).toBeUndefined();
    expect(canonicalBiomeId(7)).toBe(7);
  });
  test('rewrites ids embedded in mission ids, source keys and asset paths', () => {
    expect(canonicalLegacyId(`t4-biome-${LEGACY}`)).toBe('t4-biome-debutmont');
    expect(canonicalLegacyId(`voice:${LEGACY}`)).toBe('voice:debutmont');
    expect(canonicalLegacyId(`adaptive/${LEGACY}/bass-0000.ogg`)).toBe('adaptive/debutmont/bass-0000.ogg');
    expect(canonicalLegacyId(null)).toBeNull();
  });
  test('the shipped biome table uses only the new id', () => {
    expect(BIOME_IDS).toContain('debutmont');
    expect(BIOME_IDS).not.toContain(LEGACY);
    expect(LEVELS.biomeOrder).toContain('debutmont');
    expect(fs.existsSync('src/data/biomes/debutmont.json')).toBe(true);
    expect(fs.existsSync(`src/data/biomes/${LEGACY}.json`)).toBe(false);
  });
});

describe('an old save migrates losslessly', () => {
  test('biomeProgress and unlocked.biomes follow the rename', () => {
    const p = sanitizeProfile({
      v: 1,
      biomeProgress: { encountered: [LEGACY, 'pyramid-peak'], completed: [LEGACY] },
      unlocked: { biomes: [LEGACY, 'pyramid-peak'] },
    }, LEVELS);
    expect(p.biomeProgress).toEqual({ encountered: ['debutmont', 'pyramid-peak'], completed: ['debutmont'] });
    expect(p.unlocked.biomes).toEqual(['debutmont', 'pyramid-peak']);
  });
  test('a save holding both spellings merges to one entry', () => {
    const p = sanitizeProfile({
      v: 1,
      biomeProgress: { encountered: [LEGACY, 'debutmont'], completed: ['debutmont', LEGACY] },
      unlocked: { biomes: ['debutmont', LEGACY] },
    }, LEVELS);
    expect(p.biomeProgress).toEqual({ encountered: ['debutmont'], completed: ['debutmont'] });
    expect(p.unlocked.biomes).toEqual(['debutmont']);
  });
  test('mission ids and their progress follow the rename; the larger count wins on a collision', () => {
    const p = sanitizeProfile({
      v: 1,
      missions: {
        counter: 3,
        active: [`t4-biome-${LEGACY}`, 'other-mission'],
        progress: { [`t4-biome-${LEGACY}`]: 900, 'other-mission': 2 },
      },
    }, LEVELS);
    expect(p.missions.active).toEqual(['t4-biome-debutmont', 'other-mission']);
    expect(p.missions.progress).toEqual({ 't4-biome-debutmont': 900, 'other-mission': 2 });

    const both = sanitizeProfile({
      v: 1,
      missions: { progress: { [`t4-biome-${LEGACY}`]: 900, 't4-biome-debutmont': 400 } },
    }, LEVELS);
    expect(both.missions.progress).toEqual({ 't4-biome-debutmont': 900 });
    const bothRev = sanitizeProfile({
      v: 1,
      missions: { progress: { 't4-biome-debutmont': 1200, [`t4-biome-${LEGACY}`]: 900 } },
    }, LEVELS);
    expect(bothRev.missions.progress).toEqual({ 't4-biome-debutmont': 1200 });
  });
  test('a crafted __proto__ / constructor mission progress key cannot poison the result', () => {
    const raw = JSON.parse('{"v":1,"missions":{"progress":{"__proto__":{"polluted":1},"constructor":5,"t4-biome-debutmont":7}}}');
    const p = sanitizeProfile(raw, LEVELS);
    expect(Object.getPrototypeOf(p.missions.progress)).toBe(Object.prototype);
    expect(p.missions.progress.polluted).toBeUndefined();
    expect(Object.keys(p.missions.progress)).toEqual(['t4-biome-debutmont']);
    expect({}.polluted).toBeUndefined();
  });
  test('run visits recorded under the legacy id merge into the canonical set', () => {
    expect(sanitizeBiomeProgress({ encountered: [LEGACY], completed: [] }).encountered).toEqual(['debutmont']);
    const merged = mergeBiomeVisits({ encountered: [LEGACY], completed: [] }, { encountered: ['debutmont'], completed: ['debutmont'] });
    expect(merged).toEqual({ encountered: ['debutmont'], completed: ['debutmont'] });
  });
});

describe('music lookups accept the legacy id', () => {
  test('a stale voice request resolves to the new key', () => {
    expect(voiceSourceForBiome(LEGACY)).toBe('voice:debutmont');
    expect(voiceSourceForBiome('debutmont')).toBe('voice:debutmont');
  });
  test('a pack still written with the legacy keys and paths loads under the new ones', () => {
    const stems = (n) => ({
      vocals: 'v.ogg', drums: 'd.ogg', bass: 'b.ogg', guitar: 'g.ogg', piano: 'p.ogg', other: 'o.ogg',
      [`voice:${LEGACY}`]: `adaptive/${LEGACY}/melody-000${n}.ogg`,
    });
    const files = [0, 1].map((n) => `adaptive/${LEGACY}/bass-000${n}.ogg`);
    const p = normalizePack({
      format: 'bitstream-music-pack-v1', id: 'stale', sampleRate: 48000, frameCount: 96000,
      segments: [{ startFrame: 0, frames: 48000, sources: stems(0) }, { startFrame: 48000, frames: 48000, sources: stems(1) }],
      adaptive: { featuredStem: 'guitar', variants: { bass: { [LEGACY]: files } } },
    });
    expect(p.sourceNames).toContain('voice:debutmont');
    expect(p.sourceNames).not.toContain(`voice:${LEGACY}`);
    expect(p.segments[1].sources['voice:debutmont']).toBe('adaptive/debutmont/melody-0001.ogg');
    expect(p.adaptive.variants.bass.debutmont).toEqual(['adaptive/debutmont/bass-0000.ogg', 'adaptive/debutmont/bass-0001.ogg']);
    expect(p.adaptive.variants.bass[LEGACY]).toBeUndefined();
  });
});

describe('a pack carrying both spellings of one key is rejected', () => {
  const stems = (extra) => ({ vocals: 'v.ogg', drums: 'd.ogg', bass: 'b.ogg', guitar: 'g.ogg', piano: 'p.ogg', other: 'o.ogg', ...extra });
  const seg = (extra) => [{ startFrame: 0, frames: 48000, sources: stems(extra) }, { startFrame: 48000, frames: 48000, sources: stems(extra) }];
  const pack = (o) => ({ format: 'bitstream-music-pack-v1', id: 'dup', sampleRate: 48000, frameCount: 96000, ...o });
  const DUP = /duplicate biome key \(legacy alias\)/;
  test('source keys', () => {
    const both = { [`voice:${LEGACY}`]: 'a.ogg', 'voice:debutmont': 'b.ogg' };
    expect(() => normalizePack(pack({ segments: seg(both) }))).toThrow(DUP);
  });
  test('adaptive biome keys', () => {
    const files = ['x.ogg', 'y.ogg'];
    expect(() => normalizePack(pack({
      segments: seg({}),
      adaptive: { featuredStem: 'guitar', variants: { bass: { [LEGACY]: files, debutmont: files } } },
    }))).toThrow(DUP);
  });
  test('roomSends keys', () => {
    expect(() => normalizePack(pack({ segments: seg({ 'voice:debutmont': 'b.ogg' }), roomSends: { [`voice:${LEGACY}`]: 0.1, 'voice:debutmont': 0.2 } }))).toThrow(DUP);
  });
});

describe('guard: the misspelling stays out of the tree', () => {
  // The alias layer and its test name the legacy id on purpose; CHANGELOG.md keeps it in entries that describe
  // already-shipped releases (and in the entry that records this rename).
  const ALLOWED = new Set([
    'src/data/biomeAliases.js',
    'tests/src/biome-debutmont-alias.test.js',
    'CHANGELOG.md',
  ]);
  test('no tracked text file outside the allowlist contains it (case-insensitive)', () => {
    // `-t` tags each path: "S" = skip-worktree (a sparse checkout without the OGG media), "H" = normal.
    const tracked = execFileSync('git', ['ls-files', '-t', '-z'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
      .split('\0').filter(Boolean).map((e) => ({ sparse: e[0] === 'S', path: e.slice(2) }));
    const offenders = [];
    for (const { sparse, path: f } of tracked) {
      if (ALLOWED.has(f)) continue;
      // The path check comes first so a re-added adaptive/<legacy>/*.ogg fails even though its bytes are skipped.
      if (f.toLowerCase().includes(LEGACY)) { offenders.push(f + ' (path)'); continue; }
      if (f.endsWith('.ogg')) continue;
      let buf;
      try {
        buf = fs.readFileSync(f);
      } catch (err) {
        // Only a sparse (skip-worktree) path may be absent from disk; anything else unreadable is a real problem.
        if (err.code === 'ENOENT' && sparse) continue;
        throw err;
      }
      if (buf.subarray(0, 8000).includes(0)) continue; // binary
      if (buf.toString('utf8').toLowerCase().includes(LEGACY)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });
});
