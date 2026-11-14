/**
 * B0 (biome full treatment): biome-tagged hazard and power-up defs.
 *
 * Spec §5: a def with a `biome` field never enters the base hazard / air hazard / power-up lists, so
 * base placement and mask-0 output are untouched by construction. Biome spawns come only from the new
 * `_placeBiomeSpawns` pass, on forks 'biomeHaz' / 'biomePu', inside chunks whose biome is set.
 */
import { makeGen, loadContent } from './_helpers.js';
import { withBiomeFixtures } from './_biomeFixtures.js';

const content = loadContent();

/** Every field, keys sorted, numbers rounded to 4 dp: the golden test's `complete` projection. */
const round = (n) => (Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : n);
const completeOf = (v) =>
  Array.isArray(v)
    ? v.map(completeOf)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, completeOf(v[k])]))
      : typeof v === 'number'
        ? round(v)
        : v;

describe('isolation: biome-tagged defs change NOTHING at mask 0', () => {
  test('300 chunks x 3 seeds: the full-chunk projection is identical with and without the biome defs', () => {
    const fx = withBiomeFixtures(content);
    for (const seed of ['iso-alpha', 'iso-beta', '2026-11-14']) {
      const withDefs = makeGen(seed, { biomeMask: 0, ...fx });
      const without = makeGen(seed, { biomeMask: 0 });
      for (let i = 0; i < 300; i++) {
        expect(completeOf(withDefs.getChunk(i))).toEqual(completeOf(without.getChunk(i)));
      }
    }
  });
});

describe('constructor filter: biome defs leave the base lists and are kept per biome', () => {
  test('hazardList, airHazardList and powerupList hold no biome def; the per-biome maps hold them', () => {
    const g = makeGen('filter', withBiomeFixtures(content));
    const ids = (l) => l.map((d) => d.id);
    expect(g.hazardList.some((d) => d.biome)).toBe(false);
    expect(g.airHazardList.some((d) => d.biome)).toBe(false);
    expect(g.powerupList.some((d) => d.biome)).toBe(false);
    // base lists are exactly what they were without the fixtures
    const base = makeGen('filter');
    expect(ids(g.hazardList)).toEqual(ids(base.hazardList));
    expect(ids(g.airHazardList)).toEqual(ids(base.airHazardList));
    expect(ids(g.powerupList)).toEqual(ids(base.powerupList));
    expect(ids(g.biomeHazards['garbage-dump-glacier'])).toEqual(['fxGroundHazard']);
    expect(ids(g.biomeHazards['space-mountain'])).toEqual(['fxAirHazard']);
    expect(ids(g.biomePowerups['garbage-dump-glacier'])).toEqual(['fxWardPowerup']);
    expect(ids(g.biomePowerups['space-mountain'])).toEqual(['fxStabilizePowerup']);
  });
});
