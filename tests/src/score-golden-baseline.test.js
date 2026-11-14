/**
 * SPEC §9: "With biomeMask = 0 and no boosts, terrain AND SCORING are identical to ecd8e51."
 *
 * The terrain half is `terrain-golden-mask0` (hash-pinned). Scoring had no such pin, and W3 added a
 * `zoneScoreMul` parameter to `ScoreManager.onLanding()` — exactly the kind of change that can move a
 * score without touching terrain. `terrain-golden-mask0` would stay green through a scoring regression.
 *
 * So this is a differential test: the real ScoreManager and a FROZEN COPY of the same file at `ecd8e51`
 * (tests/src/fixtures/ScoreManager-ecd8e51.js) are driven through the same long scripted run — distance,
 * tricks, landings of every quality, flow decay, shield hits, crashes, milestones, penalties — and their
 * full snapshots must agree step for step.
 *
 * mask-0 / no-boost is expressed the only way the scoring layer can express it: the caller passes no
 * `zoneScoreMul`, which is what `RunScene._zoneScoreMulAt()` returns when no mod zone has a `scoreMul`
 * (it starts at 1 and only multiplies for mods that define one). The final case checks that the new
 * parameter is genuinely inert when nobody supplies it, and the one case that must differ (a zone bonus
 * supplied) is asserted separately so this file cannot pass by the feature being dead.
 */
import { ScoreManager } from '../../src/systems/ScoreManager.js';
import { BaselineScoreManager } from './fixtures/ScoreManager-ecd8e51.js';

const NO_ZONE = undefined; // mask 0: no mod zones, so no zone multiplier is ever passed

/** Same trick shape TrickTracker emits. */
const trick = (type, count = 1, airtimeMs = 0) => ({ type, count, rotationDeg: count * 360, airtimeMs });

/**
 * A deterministic, varied run. Not random: a failure has to be reproducible and readable.
 * Covers every trick type in SCORING.trickBase so a change to any base value or factor shows up.
 */
const SCRIPT = [
  ['distance', 1], ['distance', 250], ['distance', 250], ['distance', 1200],
  ['trick', trick('backflip', 1, 900)], ['trick', trick('backflip', 2, 1500)],
  ['land', { quality: 'perfect' }],
  ['distance', 2500],
  ['trick', trick('helicopter', 1, 2000)], ['trick', trick('frontflip', 1, 1200)],
  ['trick', trick('airbrake', 1, 400)],
  ['land', { quality: 'good' }],
  ['distance', 3400], ['distance', 5000], ['distance', 5000],
  ['milestone', 5000], ['bonus', [100, 'shard']], ['bonus', [50, 'nearMiss']],
  ['trick', trick('backflip', 3, 2500)], ['trick', trick('parachute', 1, 300)],
  ['land', { quality: 'sloppy' }],
  ['distance', 10000], ['distance', 10000], ['milestone', 10000], ['bonus', [200, 'shard']],
  ['trick', trick('frontflip', 2, 1800)],
  ['land', { quality: 'crash' }],
  ['distance', 15500],
  ['shield', true], ['shield', false],
  ['trick', trick('helicopter', 2, 2400)], ['land', { quality: 'good' }],
  ['penalize'],
  ['distance', 20400], ['distance', 30000],
  ['tick', 3000], ['tick', 3000], ['tick', 3000], ['tick', 4000],
  ['trick', trick('backflip', 1, 0)], ['land', { quality: 'perfect' }],
  ['crash'],
  ['distance', 42000],
];

/** Drive one ScoreManager through the script; return the snapshot after every step. */
function drive(Mgr) {
  const s = new Mgr();
  const out = [];
  for (const [op, arg] of SCRIPT) {
    if (op === 'distance') s.setDistance(arg);
    else if (op === 'trick') s.addTrick(arg);
    else if (op === 'land') s.onLanding(arg);
    else if (op === 'tick') s.tick(arg);
    else if (op === 'shield') s.onShieldHit(arg);
    else if (op === 'crash') s.onCrash();
    else if (op === 'penalize') s.penalizeReset();
    else if (op === 'milestone') s.checkMilestones(arg);
    else if (op === 'bonus') s.addBonus(arg[0], arg[1]);
    else throw new Error(`unknown op ${op}`);
    out.push(s.getSnapshot());
  }
  return out;
}

describe('scoring is identical to ecd8e51 with mask 0 and no boosts', () => {
  test('a 40-step scripted run produces the same snapshot at every step', () => {
    const live = drive(ScoreManager);
    const base = drive(BaselineScoreManager);
    expect(live).toHaveLength(SCRIPT.length);
    // Compare step by step so a failure names the step that diverged instead of dumping 40 snapshots.
    for (let i = 0; i < SCRIPT.length; i += 1) {
      expect({ step: i, op: SCRIPT[i][0], snap: live[i] })
        .toEqual({ step: i, op: SCRIPT[i][0], snap: base[i] });
    }
  });

  test('final score and every scoring component match the baseline', () => {
    const live = drive(ScoreManager).at(-1);
    const base = drive(BaselineScoreManager).at(-1);
    expect(live).toEqual(base);
    // Guard against a vacuous pass: the script really did produce a substantial score.
    expect(live.total).toBeGreaterThan(10000);
    expect(live.trickPoints).toBeGreaterThan(0);
    expect(live.penaltyPoints).toBeGreaterThan(0);
    expect(live.bonusPoints).toBeGreaterThan(0);
  });

  test('the zone multiplier is inert when no zone supplies one', () => {
    // RunScene passes undefined on mask 0. Passing an explicit 1 must also be a no-op, and passing
    // nothing at all must equal what the baseline (which has no parameter) produces.
    const withNone = new ScoreManager();
    withNone.addTrick(trick('backflip', 1, 1000));
    const none = withNone.onLanding({ quality: 'good' }, NO_ZONE);

    const withOne = new ScoreManager();
    withOne.addTrick(trick('backflip', 1, 1000));
    const one = withOne.onLanding({ quality: 'good' }, { zoneScoreMul: 1 });

    const base = new BaselineScoreManager();
    base.addTrick(trick('backflip', 1, 1000));
    const ref = base.onLanding({ quality: 'good' });

    expect(none.banked).toBe(ref.banked);
    expect(one.banked).toBe(ref.banked);
    expect(none.zoneMul).toBe(1);
  });

  test('the one intended difference still exists: a zone bonus multiplies banked tricks', () => {
    // If this ever stops differing, zoneScoreMul has been quietly neutered and the test above would
    // pass for the wrong reason.
    const plain = new ScoreManager();
    plain.addTrick(trick('backflip', 1, 1000));
    const p = plain.onLanding({ quality: 'good' });
    const echo = new ScoreManager();
    echo.addTrick(trick('backflip', 1, 1000));
    const e = echo.onLanding({ quality: 'good' }, { zoneScoreMul: 1.3 });
    expect(e.banked).toBeGreaterThan(p.banked);
  });
});
