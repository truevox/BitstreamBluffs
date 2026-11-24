/**
 * GOLDEN TERRAIN — mask 0.
 *
 * re-pinned for #65: Debutmont base + arcade bridges. Marvin's owner decision (issue #65, pre-alpha) made Debutmont
 * the base biome, so mask 0 is no longer plain arcade terrain: every chunk is a Debutmont chunk (its own zones and
 * spawns, tagged `biome`), and mask 0 plays pure Debutmont. Every digest below was re-recorded at that change (all
 * 15 pins moved; the prose that follows describes the original pin and still describes the test's purpose). Existing
 * mask-0 leaderboard and Daily records were set on the old arcade terrain; #65 flags that consequence.
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
    shape: 'f562dc6bea3bbe921528423818504d72',
    full: '49d76d04b66e6ad732a11b9baefa590d',
  },
  'bitstream-bluffs': {
    shape: '81e2ac207bbcb23ce1e7447c3d344e05',
    full: 'c4d0afbe5291e1484d197902ae85f228',
  },
  42: {
    shape: 'acb168d64667adf2794a582f25e77fd1',
    full: '0ba820a0940256c8c6da9a3112d5e4cf',
  },
  'seed@mask0': {
    shape: '6dae8ae9045446ea0fd3915b1b733c60',
    full: 'f50efa6c10aaf97d6ffa89425bb15c63',
  },
  '2026-11-13': {
    shape: '6f9d1a090f2bd54e32cf0419a6c8e12a',
    full: 'de6a60d7084ab6e1b0ab77ae37848f5f',
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
  alpha: '89b27d5e315159a45daa1454e4fc30c6',
  'bitstream-bluffs': '98a0ff45aedb2ba622157a96f3703436',
  42: '8ce76450881e0516408f70c877afcdbd',
  'seed@mask0': 'b204706f8fb22f0ee5c10a614d76b984',
  '2026-11-13': '68555f37f29225fc06df702915ba8dd2',
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
