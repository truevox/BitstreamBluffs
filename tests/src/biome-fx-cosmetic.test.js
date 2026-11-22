/**
 * #65 presentation is cosmetic only: with the dissolve / glitch layers on or off, terrain and the simulation are
 * byte-identical.
 *
 * The presentation layer's only reach into the world is TerrainGenerator.bridgeSpanAt (a read-only scratch query) and
 * RunScene._updateLook (which decides the look and when to repaint). So this file proves, for several seeds and masks:
 *  1. terrain digests (every field of every chunk) are identical whether or not a presentation frame loop is
 *     interleaved with generation, in either effects mode (dissolve on, or the reduced-motion hard cut);
 *  2. a streamed "run" (the scene's own generator.update(x) calls) adds and removes the same chunks in the same order,
 *     and the rolling-sled outcome over that terrain is identical;
 *  3. the real RunScene._updateLook rebuilds colliders (a full refresh) at exactly the same x in both modes, repaints
 *     graphics only (never colliders) at the extra points the dissolve adds, and asks the generator nothing but reads.
 * The built game is checked the same way end to end with `npm run sim` on the two builds (see the PR).
 */
import { jest } from '@jest/globals';
import crypto from 'crypto';

const FakePhaser = {
  Scene: class {},
  Physics: { Matter: { Matter: { Bodies: {}, Body: {} } } },
  Renderer: { WebGL: { Pipelines: { PostFXPipeline: class {} } } },
  GameObjects: { Container: class {}, Graphics: class {}, BitmapText: class {}, Zone: class {}, Image: class {}, Rectangle: class {}, Text: class {} },
  BlendModes: { ADD: 1 },
  Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown', DESTROY: 'destroy' } },
  Math: { Between: (a) => a, Clamp: (v, a, b) => Math.min(b, Math.max(a, v)) },
};
jest.unstable_mockModule('phaser', () => ({ default: FakePhaser }));
jest.unstable_mockModule('../../src/shaders/GlitchPipeline.js', () => ({ GlitchPipeline: { install() {} } }));

const { RunScene } = await import('../../src/scenes/RunScene.js');
const { bridgeLook, veilCovers, VEIL_CELL_PX } = await import('../../src/systems/BiomeTransition.js');
const { REG } = await import('../../src/constants.js');
const { makeGen, loadContent, readDir, rollSim } = await import('./_helpers.js');

const ALL = readDir('biomes').reduce((m, d) => m | d.bit, 0);
const SEEDS = ['alpha', 'bitstream-bluffs', '42', 'shots65-d', '2026-11-13'];
const MASKS = [0, 2, ALL];
const CHUNKS = 120;

const round = (n) => (Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : n);
const completeOf = (v) => (Array.isArray(v) ? v.map(completeOf)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, completeOf(v[k])]))
    : typeof v === 'number' ? round(v) : v);
const digest = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32);

/** One frame of everything the presentation layer asks of the world around x, in the given effects mode. */
function presentationFrame(gen, x, enabled, sink) {
  const biomeNow = gen.biomeAtX(x);
  const span = biomeNow === null ? gen.bridgeSpanAt(x) : null;
  const look = bridgeLook(span, x, biomeNow, enabled);
  // what BiomeFx does with the veil each frame
  let covered = 0;
  for (let iy = 0; iy < 17; iy++) for (let ix = 0; ix < 480 / VEIL_CELL_PX; ix++) if (veilCovers(ix, iy, look.veil)) covered++;
  if (sink) sink.push([round(x), look.lookId, round(look.veil), covered]);
}

function chunkDigests(seed, mask, mode) {
  const gen = makeGen(seed, { biomeMask: mask });
  const out = [];
  for (let i = 0; i < CHUNKS; i++) {
    if (mode !== 'none') {
      // probe behind, at, ahead and far ahead (before those chunks have been generated), in both modes' order
      const b = gen.bounds[Math.min(i, gen.bounds.length - 1)];
      for (const dx of [-400, 0, 350, 9000, 25000]) presentationFrame(gen, Math.max(0, b.startX + dx), mode === 'on');
    }
    out.push(completeOf(gen.getChunk(i)));
  }
  return digest(out);
}

describe('terrain is identical with the presentation layer on, off, or absent', () => {
  for (const seed of SEEDS) {
    for (const mask of MASKS) {
      test(`seed ${seed} mask ${mask}: chunk digests`, () => {
        const plain = chunkDigests(seed, mask, 'none');
        expect(chunkDigests(seed, mask, 'on')).toBe(plain);
        expect(chunkDigests(seed, mask, 'off')).toBe(plain);
      });
    }
  }
});

describe('a streamed run and its simulated outcome are identical with the effects on or off', () => {
  function streamRun(seed, mask, mode) {
    const gen = makeGen(seed, { biomeMask: mask });
    const log = [];
    for (let x = 0; x < 2600 * 20; x += 160) {
      if (mode !== 'none') presentationFrame(gen, x, mode === 'on');
      const r = gen.update(x) || {};
      log.push([(r.added || []).map((c) => c.index), (r.removed || []).map((c) => (c && c.index !== undefined ? c.index : c))]);
      if (mode !== 'none') presentationFrame(gen, x + 300, mode === 'on');
    }
    const heights = [];
    for (let x = 0; x < 2400 * 20; x += 997) heights.push(round(gen.heightAt(x)));
    return { log, heights, sim: rollSim(gen, 1800), biomes: [0, 1500, 20000, 30000, 45000].map((x) => gen.biomeAtX(x)) };
  }
  for (const seed of SEEDS.slice(0, 4)) {
    for (const mask of [2, ALL]) {
      test(`seed ${seed} mask ${mask}: add/remove log, heights, rolling-sled outcome`, () => {
        const plain = streamRun(seed, mask, 'none');
        expect(streamRun(seed, mask, 'on')).toEqual(plain);
        expect(streamRun(seed, mask, 'off')).toEqual(plain);
      });
    }
  }
});

describe('RunScene._updateLook: the same collider rebuilds, extra repaints are graphics-only', () => {
  const content = loadContent();

  function walk(seed, mask, reduced) {
    const gen = makeGen(seed, { biomeMask: mask });
    const calls = [];
    const touched = new Set();
    const terrain = new Proxy(gen, {
      get(t, k) {
        if (typeof k === 'string' && typeof t[k] === 'function') touched.add(k);
        const v = t[k];
        return typeof v === 'function' ? v.bind(t) : v;
      },
    });
    const s = Object.create(RunScene.prototype);
    Object.assign(s, {
      terrain, sled: { x: 0 }, content: { biomes: content.biomes },
      registry: { get: (k) => (k === REG.SETTINGS ? { reduceMotion: reduced ? 'on' : 'off' } : null) },
    });
    s.refreshPalette = function refresh(visualOnly) { calls.push({ x: this.sled.x, visualOnly: !!visualOnly, look: this._lookId }); };
    const veils = [];
    for (let x = 0; x < 2800 * 20; x += 20) {
      s.sled.x = x;
      const biomeNow = gen.biomeAtX(x);
      const changed = s._biomeId !== biomeNow;
      const first = s._biomeId === undefined;
      if (changed) s._biomeId = biomeNow;
      const def = s._biomeDefById(biomeNow);
      s._updateLook(biomeNow, changed && (def !== null || !first));
      veils.push(s._veil);
    }
    return { calls, touched, veils, gen };
  }

  for (const [seed, mask] of [['shots65-d', 2], ['alpha', ALL], ['bitstream-bluffs', ALL]]) {
    test(`seed ${seed} mask ${mask}`, () => {
      const on = walk(seed, mask, false);
      const off = walk(seed, mask, true);
      const full = (w) => w.calls.filter((c) => !c.visualOnly).map((c) => c.x);
      expect(full(on).length).toBeGreaterThan(2);
      expect(full(on)).toEqual(full(off)); // colliders are rebuilt at the generator's biome changes, whatever the setting
      expect(off.calls.every((c) => !c.visualOnly)).toBe(true); // the hard cut adds nothing
      expect(on.calls.filter((c) => c.visualOnly).length).toBeGreaterThan(0); // the dissolve repaints inside bridges
      // the generator is only ever read
      for (const name of on.touched) expect(['biomeAtX', 'bridgeSpanAt']).toContain(name);
      // reduced motion: the veil is on for exactly the bridge, never partial
      expect(off.veils.every((v) => v === 0 || v === 1)).toBe(true);
      expect(on.veils.some((v) => v > 0 && v < 1)).toBe(true);
    });
  }

  test('the real generator is left untouched by a whole walk (same digests as a fresh one)', () => {
    const { gen } = walk('shots65-d', 2, false);
    const fresh = makeGen('shots65-d', { biomeMask: 2 });
    for (let i = 0; i < 60; i++) expect(digest(completeOf(gen.getChunk(i)))).toBe(digest(completeOf(fresh.getChunk(i))));
  });
});
