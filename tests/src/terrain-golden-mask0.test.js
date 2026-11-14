/**
 * GOLDEN TERRAIN — mask 0.
 *
 * This is the campaign's "nothing changed" proof (SPEC §9). Every value in `GOLDEN` below was
 * recorded from `main` at `06e79f5`, the commit W3 branches from, with `biomeMask = 0`.
 *
 * `TerrainGenerator.js` is byte-identical between the campaign baseline `ecd8e51` and `06e79f5`
 * (`git diff --stat ecd8e51..06e79f5 -- src/systems/TerrainGenerator.js` is empty), so pinning to
 * `06e79f5` pins the original terrain behaviour. If that ever stops being true this test is the
 * thing that says so.
 *
 * WHY HASHES AND NOT INLINE COPIES: the point is to detect ANY change to mask-0 output, including
 * one that looks harmless in a diff. A hash over the full chunk stream (points, kind, hazards,
 * shards, bounce pads, gaps) fails on the first moved point anywhere in the range, and it does so
 * without a 10,000-line fixture nobody reviews.
 *
 * WHEN THIS FAILS, the fix is almost never to update `GOLDEN`. Mask 0 must stay bit-identical for
 * the whole campaign, because every existing leaderboard record and daily-seed score was set on it.
 * A failure means a W3+ change reached terrain that has no business changing. If a genuine,
 * intended change is needed, that is a decision for Marvin, and the diff plus the reason belongs in
 * the PR body — not a silent re-pin.
 *
 * The range is deliberately long enough to cross sector boundaries (SECTOR_M = 500 m; measured span
 * is ~34 km, ~70 sectors) and wide enough to hit noise zones, bridge chunks, breathers and late-game
 * hazard retry (HAZARD_RETRY_FROM_M = 2000 m). At 300 chunks the stream covers 17 distinct chunk defs
 * and all three kinds (`spline`, `noise`, `bridge`), so a change to any of those code paths moves a
 * digit.
 *
 * Separate from this file: `tests/src/terrain.test.js` already pins determinism and the shape rules.
 * This adds the cross-workstream regression pin, which is a different claim: "W3-W6 changed nothing
 * here", not "the generator is self-consistent".
 */
import crypto from 'crypto';
import { makeGen } from './_helpers.js';

/** Chunk stream length. See the note above: ~16.5 km, spans every sector-driven behaviour. */
const CHUNKS = 300;

/**
 * Seeds chosen for spread, not for convenience: two plain strings, a numeric-looking one, one with
 * punctuation (seed strings reach `hashInts` and a punctuation seed exercises a different mixing
 * path than a word), and the daily-run style key the game actually uses.
 */
const SEEDS = ['alpha', 'bitstream-bluffs', '42', 'seed@mask0', '2026-11-13'];

/**
 * Golden digests, recorded at `06e79f5` with `biomeMask = 0`.
 *
 * `shape` covers the geometry only (kind + every point). `full` covers geometry plus every spawned
 * object. They are separate so a failure says WHICH layer moved: a hazard-only change keeps `shape`
 * green and breaks `full`, which is a much cheaper diagnosis than re-deriving both.
 */
const GOLDEN = {
  alpha: {
    shape: 'dfaf9f891a4290e22ff09da9acaa94ed',
    full: 'dbacfea9a57f6f85dd92d4fe78669c40',
  },
  'bitstream-bluffs': {
    shape: 'b3343e353f066c7be8d87cdd2f2370bc',
    full: '87de6b9d7c239bb8dab2290617bf9033',
  },
  42: {
    shape: '148ed741521a290ccd074e81442cd3eb',
    full: 'b9e60952604aec26279d9eae035662fc',
  },
  'seed@mask0': {
    shape: 'f443cef44dd1e3014275602592107506',
    full: '838f9f5d9a888d39038ce5d57abd64cc',
  },
  '2026-11-13': {
    shape: '6c54d47267e071fcdfc0e05bdaa86624',
    full: 'ea23952e1e8189e443eb08ca18a88b69',
  },
};

/**
 * Whole-chunk digests, recorded at BOTH `06e79f5` and `e0ae90f` with `biomeMask = 0` (identical at
 * both, 2026-11-14 audit). `full` above was written by hand and misses things that are gameplay:
 * power-ups, launches, the zone `modId` (it hashes `z.id`, which does not exist, so every zone
 * hashed as `null`), and hazard rotation (it hashes `speedPxS`, which does not exist either). The
 * audit proved the gap by mutation: swapping a zone modId past 2 km left `full` green. `complete`
 * hashes every field of every chunk instead, so nothing that ships in a chunk can move unseen.
 * `shape` and `full` stay as they were so their history and failure-layer diagnosis still hold.
 */
const COMPLETE = {
  alpha: 'e18f051a5ad2f594bc39f748e61403f6',
  'bitstream-bluffs': 'a11305dc97011fed89c4f69817b55d68',
  42: '4ea6be7e07ea665a31f2a4ac380b7367',
  'seed@mask0': '195bb43cdec549f317ffd43063d2b047',
  '2026-11-13': '8a4a990ba2d5de392c78bd532bd40d37',
};

/** Every field, keys sorted, numbers rounded like `round` below. */
const completeOf = (v) =>
  Array.isArray(v)
    ? v.map(completeOf)
    : v && typeof v === 'object'
      ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, completeOf(v[k])]))
      : typeof v === 'number'
        ? round(v)
        : v;

/**
 * A chunk reduced to everything that affects play, in a fixed key order.
 *
 * Built explicitly rather than by `JSON.stringify(chunk)` so that adding a purely cosmetic field to
 * a chunk (a future colour, a debug label) does not fail the golden test for no gameplay reason —
 * while any change to a point, a hazard, a shard, a pad or a gap does.
 */
function shapeOf(chunk) {
  return {
    index: chunk.index,
    kind: chunk.kind,
    startX: round(chunk.startX),
    endX: round(chunk.endX),
    points: chunk.points.map((p) => [round(p.x), round(p.y)]),
  };
}

function fullOf(chunk) {
  return {
    ...shapeOf(chunk),
    hazards: (chunk.hazards || []).map((h) => [round(h.x), round(h.y), h.defId, round(h.speedPxS)]),
    shards: (chunk.shards || []).map((s) => [round(s.x), round(s.y)]),
    bouncePads: (chunk.bouncePads || []).map((b) => [round(b.x), round(b.y)]),
    zones: (chunk.zones || []).map((z) => [z.id, round(z.x0), round(z.x1)]),
    gaps: (chunk.gaps || []).map((g) => [round(g.x0), round(g.x1)]),
  };
}

/**
 * 4 decimals: sub-thousandth-of-a-pixel differences are not gameplay and would make the pin
 * brittle against float noise in a legitimate refactor of the maths that provably cannot move a
 * rendered pixel. Anything a player can feel moves a point by far more than 0.0001 px.
 */
const round = (n) => (Number.isFinite(n) ? Math.round(n * 1e4) / 1e4 : n);

function digest(value) {
  return crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 32);
}

function stream(seed, project) {
  const gen = makeGen(seed, { biomeMask: 0 });
  const out = [];
  for (let i = 0; i < CHUNKS; i++) out.push(project(gen.getChunk(i)));
  return out;
}

describe('golden terrain — mask 0 must never change (SPEC §9)', () => {
  test('the golden table is fully recorded, not left as placeholders', () => {
    // Guards the failure mode where someone adds a seed and forgets to fill in its digests: a
    // placeholder would silently never match, and a `toMatchSnapshot`-style auto-accept habit would
    // turn this whole file into decoration.
    for (const [seed, hashes] of Object.entries(GOLDEN)) {
      expect({ seed, shape: hashes.shape, full: hashes.full }).toMatchObject({
        seed,
        shape: expect.stringMatching(/^[0-9a-f]{32}$/),
        full: expect.stringMatching(/^[0-9a-f]{32}$/),
      });
    }
    expect(Object.keys(GOLDEN).sort()).toEqual([...SEEDS].sort());
    expect(Object.keys(COMPLETE).sort()).toEqual([...SEEDS].sort());
  });

  for (const seed of SEEDS) {
    describe(`seed ${seed}`, () => {
      test('geometry is bit-identical to the recorded baseline', () => {
        expect(digest(stream(seed, shapeOf))).toBe(GOLDEN[seed].shape);
      });

      test('geometry plus every spawned object is bit-identical to the baseline', () => {
        expect(digest(stream(seed, fullOf))).toBe(GOLDEN[seed].full);
      });

      test('every field of every chunk (power-ups, launches, zone modIds included) is bit-identical', () => {
        expect(digest(stream(seed, completeOf))).toBe(COMPLETE[seed]);
      });
    });
  }

  test('mask 0 generates identically in a second generator instance (no hidden state)', () => {
    // Two instances in one process, interleaved reads: catches a module-level cache or a shared
    // mutation that would make the hashes above order-dependent.
    const a = makeGen('alpha', { biomeMask: 0 });
    const b = makeGen('alpha', { biomeMask: 0 });
    for (let i = 0; i < 60; i++) {
      expect(JSON.stringify(fullOf(b.getChunk(59 - i)))).toBe(JSON.stringify(fullOf(a.getChunk(59 - i))));
    }
  });

  test('the range really does cross sector boundaries, so the pin covers them', () => {
    // If CHUNKS were shortened below one sector this test would fail, which is the point: the
    // golden range has to be long enough to exercise the sector-driven behaviour it claims to pin.
    const gen = makeGen('alpha', { biomeMask: 0 });
    const first = gen.getChunk(0);
    const last = gen.getChunk(CHUNKS - 1);
    const spanM = (last.endX - first.startX) / 20; // PIXELS_PER_METER = 20
    expect(spanM).toBeGreaterThan(1500);
    const kinds = new Set();
    for (let i = 0; i < CHUNKS; i++) kinds.add(gen.getChunk(i).kind);
    // Measured at 06e79f5: spline 259 / noise 34 / bridge 7 for seed 'alpha'. All three matter —
    // noise zones and bridge gaps are the two code paths most likely to be disturbed by new
    // biome geometry, so pinning a range that only ever produced splines would miss them.
    expect([...kinds].sort()).toEqual(['bridge', 'noise', 'spline']);
  });
});
