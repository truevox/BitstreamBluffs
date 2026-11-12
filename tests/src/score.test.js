import { ScoreManager, rotationFactor, airtimeFactor, comboName, milestoneBonus } from '../../src/systems/ScoreManager.js';
import { TrickTracker } from '../../src/systems/TrickTracker.js';
import { SCORING } from '../../src/constants.js';

const trick = (type, count = 1, airtimeMs = 0) => ({ type, count, rotationDeg: count * 360, airtimeMs });

describe('ScoreManager distance', () => {
  test('+1 point per whole metre, monotonic', () => {
    const s = new ScoreManager();
    expect(s.getSnapshot().total).toBe(0);
    expect(s.setDistance(0.5)).toBe(false);
    expect(s.setDistance(1.2)).toBe(true);
    expect(s.setDistance(1.9)).toBe(false);
    expect(s.setDistance(10)).toBe(true);
    expect(s.setDistance(4)).toBe(false); // never goes backwards
    const snap = s.getSnapshot();
    expect(snap.distanceM).toBe(10);
    expect(snap.distancePoints).toBe(10);
    expect(snap.total).toBe(10);
  });
});

describe('ScoreManager tricks and combo', () => {
  test('trick value = base x rotation x airtime modifier', () => {
    const s = new ScoreManager();
    const r = s.addTrick(trick('backflip', 1, 0));
    expect(r.value).toBe(SCORING.trickBase.backflip * rotationFactor(1) * airtimeFactor(0));
    expect(r.isNew).toBe(true);
    const s2 = new ScoreManager();
    const long = s2.addTrick(trick('backflip', 1, 2500));
    expect(long.value).toBe(SCORING.trickBase.backflip * 2); // airtime factor tops out at 2
    expect(long.value).toBeGreaterThan(r.value);
  });

  test('rotation factor grows exponentially; airtime factor is clamped to 1..2', () => {
    expect(rotationFactor(1)).toBe(1);
    expect(rotationFactor(2)).toBe(3);
    expect(rotationFactor(3)).toBe(7);
    expect(rotationFactor(0)).toBe(1);
    expect(airtimeFactor(-10)).toBe(1);
    expect(airtimeFactor(1250)).toBeCloseTo(1.5);
    expect(airtimeFactor(99999)).toBe(2);
  });

  test('unknown trick types are worth nothing but do not throw', () => {
    const s = new ScoreManager();
    expect(s.addTrick(trick('nope')).value).toBe(0);
  });

  test('combo starts x1 and gains +0.25 per UNIQUE trick', () => {
    const s = new ScoreManager();
    expect(s.getMultiplier()).toBe(1);
    expect(s.addTrick(trick('backflip')).multiplier).toBe(1.25);
    expect(s.addTrick(trick('frontflip')).multiplier).toBe(1.5);
    // air brake keeps its points but no longer steps the multiplier (flips and helis are the stars)
    expect(s.addTrick(trick('airBrake')).multiplier).toBe(1.5);
    expect(s.addTrick(trick('helicopterCW')).multiplier).toBe(1.75);
    expect(s.getSnapshot().comboTricks).toEqual(['backflip', 'frontflip', 'airBrake', 'helicopterCW']);
  });

  test('repeating the same trick type does not raise the multiplier and is not flagged new', () => {
    const s = new ScoreManager();
    s.addTrick(trick('backflip', 1));
    const again = s.addTrick(trick('backflip', 2));
    expect(again.isNew).toBe(false);
    expect(again.multiplier).toBe(1.25);
    expect(s.getSnapshot().comboTricks).toEqual(['backflip']);
  });

  test('cumulative double-flip events pay only the increase (never double count)', () => {
    const s = new ScoreManager();
    const a = s.addTrick(trick('backflip', 1, 800));
    const b = s.addTrick(trick('backflip', 2, 800));
    const total = SCORING.trickBase.backflip * rotationFactor(2) * airtimeFactor(800);
    expect(a.value + b.value).toBeCloseTo(total, 0);
    expect(s.getSnapshot().pendingPoints).toBeCloseTo(total, 0);
    expect(b.value).toBeGreaterThan(a.value);
  });

  test('tricks are provisional: nothing banked until landing', () => {
    const s = new ScoreManager();
    s.addTrick(trick('backflip'));
    const snap = s.getSnapshot();
    expect(snap.trickPoints).toBe(0);
    expect(snap.pendingPoints).toBeGreaterThan(0);
    expect(snap.total).toBe(0);
  });

  test('landing banks pending x multiplier and resets the combo', () => {
    const s = new ScoreManager();
    s.addTrick(trick('backflip'));
    s.addTrick(trick('airBrake'));
    const pending = s.getSnapshot().pendingPoints;
    const r = s.onLanding({ quality: 'good' });
    expect(r.multiplierUsed).toBe(1.25);
    // the first clean trick landing already pays its own flow gain (good = +0.15)
    expect(r.flowUsed).toBe(1.15);
    expect(r.banked).toBe(Math.round(pending * 1.25 * 1.15));
    expect(r.bonus).toBe(0);
    const snap = s.getSnapshot();
    expect(snap.trickPoints).toBe(r.banked);
    expect(snap.multiplier).toBe(1);
    expect(snap.comboTricks).toEqual([]);
    expect(snap.pendingPoints).toBe(0);
    expect(snap.bestCombo).toBe(1.25);
  });

  test('perfect landing adds +20 flat (not multiplied), even with no tricks', () => {
    const s = new ScoreManager();
    expect(s.onLanding({ quality: 'perfect' })).toMatchObject({ banked: 0, bonus: 20, multiplierUsed: 1 });
    expect(s.getSnapshot().total).toBe(20);
    s.addTrick(trick('frontflip'));
    s.addTrick(trick('parachute'));
    const r = s.onLanding({ quality: 'perfect' });
    expect(r.bonus).toBe(SCORING.perfectLandingBonus);
    expect(s.getSnapshot().trickPoints).toBe(20 + r.banked + 20);
  });

  test('sloppy/good landings bank but give no bonus', () => {
    for (const q of ['good', 'sloppy']) {
      const s = new ScoreManager();
      s.addTrick(trick('backflip'));
      const r = s.onLanding({ quality: q });
      expect(r.bonus).toBe(0);
      expect(r.banked).toBeGreaterThan(0);
    }
  });

  test('crash landing forfeits the pending combo (no points, no bonus)', () => {
    const s = new ScoreManager();
    s.addTrick(trick('backflip', 2));
    s.addTrick(trick('frontflip'));
    const r = s.onLanding({ quality: 'crash' });
    expect(r.banked).toBe(0);
    expect(r.bonus).toBe(0);
    const snap = s.getSnapshot();
    expect(snap.trickPoints).toBe(0);
    expect(snap.pendingPoints).toBe(0);
    expect(snap.multiplier).toBe(1);
  });

  test('onCrash discards pending tricks but keeps banked points and distance', () => {
    const s = new ScoreManager();
    s.setDistance(50);
    s.addTrick(trick('backflip'));
    s.onLanding({ quality: 'good' });
    const banked = s.getSnapshot().trickPoints;
    s.addTrick(trick('frontflip'));
    s.onCrash();
    const snap = s.getSnapshot();
    expect(snap.trickPoints).toBe(banked);
    expect(snap.pendingPoints).toBe(0);
    expect(snap.total).toBe(50 + banked);
  });

  test('a new combo after landing starts from scratch (paid ledger cleared)', () => {
    const s = new ScoreManager();
    const a = s.addTrick(trick('backflip', 1, 0));
    s.onLanding({ quality: 'good' });
    const b = s.addTrick(trick('backflip', 1, 0));
    expect(b.value).toBe(a.value);
    expect(b.isNew).toBe(true);
  });

  test('bestCombo tracks the highest multiplier of the run', () => {
    const s = new ScoreManager();
    s.addTrick(trick('backflip'));
    s.addTrick(trick('frontflip'));
    s.addTrick(trick('helicopterCW'));
    s.addTrick(trick('helicopterCCW'));
    s.onLanding({ quality: 'good' });
    s.addTrick(trick('backflip'));
    expect(s.getSnapshot().bestCombo).toBe(2);
  });
});

describe('ScoreManager reset penalty and reset()', () => {
  test('Shift reset drops the combo and deducts points, total never negative', () => {
    const s = new ScoreManager();
    s.setDistance(30);
    s.addTrick(trick('backflip'));
    s.addTrick(trick('frontflip'));
    const r = s.penalizeReset();
    expect(r.comboPenalty).toBe(2);
    expect(r.pointsLost).toBe(30); // only had 30 points
    const snap = s.getSnapshot();
    expect(snap.total).toBe(0);
    expect(snap.comboTricks).toEqual([]);
    expect(snap.pendingPoints).toBe(0);
    s.setDistance(500);
    expect(s.getSnapshot().total).toBe(500 - 30);
    expect(s.penalizeReset().pointsLost).toBe(SCORING.resetPenaltyPoints);
    expect(s.getSnapshot().total).toBe(500 - 30 - SCORING.resetPenaltyPoints);
  });

  test('penalty with zero score is free and never goes negative', () => {
    const s = new ScoreManager();
    expect(s.penalizeReset()).toMatchObject({ comboPenalty: 0, pointsLost: 0 });
    expect(s.getSnapshot().total).toBe(0);
  });

  test('reset() clears everything', () => {
    const s = new ScoreManager();
    s.setDistance(100);
    s.addTrick(trick('backflip'));
    s.onLanding({ quality: 'perfect' });
    s.penalizeReset();
    s.reset();
    expect(s.getSnapshot()).toEqual({
      total: 0, distancePoints: 0, trickPoints: 0, distanceM: 0, multiplier: 1, comboTricks: [], pendingPoints: 0,
      bestCombo: 1, penaltyPoints: 0, bonusPoints: 0, shards: 0, nearMisses: 0, milestones: 0,
      bonusByKind: { shard: 0, nearMiss: 0, milestone: 0 },
      comboCounts: {}, flow: 1, flowTimeoutFrac: 0, bestFlow: 1,
    });
  });

  test('snapshot comboTricks is a copy', () => {
    const s = new ScoreManager();
    s.addTrick(trick('backflip'));
    s.getSnapshot().comboTricks.push('x');
    expect(s.getSnapshot().comboTricks).toEqual(['backflip']);
  });
});

describe('ScoreManager bonuses (shards / near misses / milestones)', () => {
  test('addBonus adds immediately to the total and tracks per-kind counts and points', () => {
    const s = new ScoreManager();
    s.setDistance(10);
    let snap = s.addBonus(25, 'shard');
    expect(snap.total).toBe(35);
    expect(snap.bonusPoints).toBe(25);
    expect(snap.shards).toBe(1);
    expect(snap.trickPoints).toBe(0);
    s.addBonus(25, 'shard');
    s.addBonus(100, 'nearMiss');
    snap = s.addBonus(500, 'milestone');
    expect(snap.shards).toBe(2);
    expect(snap.nearMisses).toBe(1);
    expect(snap.milestones).toBe(1);
    expect(snap.bonusPoints).toBe(650);
    expect(snap.bonusByKind).toEqual({ shard: 50, nearMiss: 100, milestone: 500 });
    expect(snap.total).toBe(10 + 650);
  });

  test('bonuses are not part of the pending combo, are not multiplied, and survive crash / reset penalties', () => {
    const s = new ScoreManager();
    s.addTrick(trick('backflip'));
    s.addTrick(trick('frontflip'));
    s.addBonus(40, 'shard');
    expect(s.getSnapshot().pendingPoints).toBe(s.pending);
    const before = s.getSnapshot().pendingPoints;
    s.onLanding({ quality: 'crash' });
    expect(s.getSnapshot().bonusPoints).toBe(40);
    expect(s.getSnapshot().total).toBe(40);
    s.addTrick(trick('backflip'));
    s.onLanding({ quality: 'good' });
    const t = s.getSnapshot().total;
    expect(t).toBeGreaterThan(40);
    expect(before).toBeGreaterThan(0);
    s.penalizeReset();
    expect(s.getSnapshot().bonusPoints).toBe(40);
  });

  test('bad input is sanitised: rounded, negatives / NaN count as 0, unknown kinds add points but no counts', () => {
    const s = new ScoreManager();
    expect(s.addBonus(10.6, 'shard').bonusPoints).toBe(11);
    expect(s.addBonus(-5, 'shard').bonusPoints).toBe(11);
    expect(s.addBonus(NaN, 'nearMiss').bonusPoints).toBe(11);
    const snap = s.addBonus(7, 'weird');
    expect(snap.bonusPoints).toBe(18);
    expect(snap.shards).toBe(2);
    expect(snap.nearMisses).toBe(1);
  });

  test('reset clears bonuses', () => {
    const s = new ScoreManager();
    s.addBonus(50, 'milestone');
    s.reset();
    const snap = s.getSnapshot();
    expect(snap.bonusPoints).toBe(0);
    expect(snap.milestones).toBe(0);
    expect(snap.total).toBe(0);
  });
});

/** One jump: perform tricks, land with the given quality. */
function jump(s, quality, types = ['backflip']) {
  for (const t of types) s.addTrick(trick(t));
  return s.onLanding({ quality });
}

describe('flow streak', () => {
  test('starts at x1.0 and gains +0.25 perfect / +0.15 good, capped at x3.0', () => {
    const s = new ScoreManager();
    expect(s.getFlow()).toBe(1);
    expect(SCORING.flowPerfectStep).toBe(0.25);
    expect(SCORING.flowGoodStep).toBe(0.15);
    expect(SCORING.flowTimeoutMs).toBe(9000);
    expect(jump(s, 'perfect').flowChange).toMatchObject({ changed: true, previous: 1, flow: 1.25, reason: 'gain' });
    jump(s, 'good');
    expect(s.getFlow()).toBe(1.4);
    for (let i = 0; i < 30; i++) jump(s, 'perfect');
    expect(s.getFlow()).toBe(SCORING.flowMax);
    expect(s.getFlow()).toBe(3);
    expect(s.getSnapshot().bestFlow).toBe(SCORING.flowMax);
  });

  test('x2 is reachable: four perfect flip landings', () => {
    const s = new ScoreManager();
    for (let i = 0; i < 4; i++) jump(s, 'perfect');
    expect(s.getFlow()).toBe(2);
  });

  test('landings without a combo-step trick do not build flow (none, air brake or parachute alone)', () => {
    for (const types of [[], ['airBrake'], ['parachute'], ['airBrake', 'parachute']]) {
      const s = new ScoreManager();
      const r = jump(s, 'perfect', types);
      expect(r.flowChange.changed).toBe(false);
      expect(s.getFlow()).toBe(1);
    }
    // a helicopter or a frontflip does
    expect(jump(new ScoreManager(), 'good', ['helicopterCW']).flowChange.reason).toBe('gain');
    expect(jump(new ScoreManager(), 'good', ['frontflip', 'airBrake']).flowChange.reason).toBe('gain');
  });

  test('ANY good or perfect landing refreshes the timeout, tricks or not; sloppy does not', () => {
    const s = new ScoreManager();
    jump(s, 'good');
    s.tick(SCORING.flowTimeoutMs - 1000);
    expect(s.getFlowTimeoutFraction()).toBeCloseTo(1000 / SCORING.flowTimeoutMs, 5);
    s.onLanding({ quality: 'good' }); // no tricks at all
    expect(s.getFlowTimeoutFraction()).toBe(1);
    s.tick(5000);
    jump(s, 'perfect', ['airBrake']); // air brake only: no gain, but the clean landing keeps the streak alive
    expect(s.getFlow()).toBe(1.15);
    expect(s.getFlowTimeoutFraction()).toBe(1);
    s.tick(5000);
    s.onLanding({ quality: 'sloppy' });
    expect(s.getFlowTimeoutFraction()).toBeCloseTo(4000 / SCORING.flowTimeoutMs, 5);
  });

  test('the landing that gains flow pays at the NEW flow (first clean trick landing already pays)', () => {
    const s = new ScoreManager();
    s.addTrick(trick('backflip'));
    const pending = s.getSnapshot().pendingPoints;
    const r = s.onLanding({ quality: 'perfect' });
    expect(r.flowUsed).toBe(1.25);
    expect(r.banked).toBe(Math.round(pending * 1.25 * 1.25));
    expect(r.bonus).toBe(SCORING.perfectLandingBonus); // flat, never multiplied
    // a landing that gains nothing pays at the carried-in flow
    s.addTrick(trick('airBrake'));
    const p2 = s.getSnapshot().pendingPoints;
    const r2 = s.onLanding({ quality: 'good' });
    expect(r2.flowUsed).toBe(1.25);
    expect(r2.banked).toBe(Math.round(p2 * 1.25));
  });

  test('sloppy landing halves the bonus above 1.0 (paid at the carried-in flow) and does not refresh the timeout', () => {
    const s = new ScoreManager();
    for (let i = 0; i < 4; i++) jump(s, 'perfect'); // 2.0
    s.tick(3000);
    s.addTrick(trick('backflip'));
    const pending = s.getSnapshot().pendingPoints;
    const r = s.onLanding({ quality: 'sloppy' });
    expect(r.flowChange).toMatchObject({ reason: 'halved', previous: 2, flow: 1.5, lost: false });
    expect(r.flowUsed).toBe(2);
    expect(r.banked).toBe(Math.round(pending * 1.25 * 2));
    expect(s.getFlowTimeoutFraction()).toBeCloseTo(6000 / SCORING.flowTimeoutMs, 5);
    const none = new ScoreManager();
    expect(jump(none, 'sloppy').flowChange.changed).toBe(false);
  });

  test('halving that leaves a bonus below flowClearBelow clears flow (sloppy landing and shield hit); exact 1.0 is lost', () => {
    const a = new ScoreManager();
    a.flow = 1.08; // bonus 0.08 -> halves to 0.04 < flowClearBelow
    a.flowRemainingMs = 5000;
    a.addTrick(trick('backflip'));
    const r = a.onLanding({ quality: 'sloppy' });
    expect(r.flowChange).toMatchObject({ lost: true, reason: 'halved', previous: 1.08, flow: 1 });
    expect(a.getFlow()).toBe(1);
    expect(a.getFlowTimeoutFraction()).toBe(0);
    const b = new ScoreManager();
    b.flow = 1.04;
    b.flowRemainingMs = 5000;
    expect(b.onShieldHit()).toMatchObject({ lost: true, reason: 'halved', flow: 1 });
    expect(b.flowRemainingMs).toBe(0);
    const c = new ScoreManager();
    c.flow = 1.1;
    expect(c.onShieldHit()).toMatchObject({ lost: false, flow: 1.05 });
    const d = new ScoreManager();
    d.flow = 1.2;
    const ch = d._setFlow(1, 'x');
    expect(ch).toMatchObject({ lost: true, flow: 1 });
    expect(d.flowRemainingMs).toBe(0);
  });

  test('a sloppy landing with zero tricks does not halve flow', () => {
    const s = new ScoreManager();
    for (let i = 0; i < 4; i++) jump(s, 'perfect'); // 2.0
    const r = jump(s, 'sloppy', []);
    expect(r.flowChange.changed).toBe(false);
    expect(s.getFlow()).toBe(2);
  });

  test('crash, crash landing and Shift reset clear flow', () => {
    const build = () => {
      const s = new ScoreManager();
      for (let i = 0; i < 3; i++) jump(s, 'perfect');
      return s;
    };
    let s = build();
    expect(s.onCrash()).toMatchObject({ lost: true, reason: 'crash', previous: 1.75, flow: 1 });
    s = build();
    expect(s.onLanding({ quality: 'crash' }).flowChange).toMatchObject({ lost: true, reason: 'crash' });
    s = build();
    expect(s.penalizeReset().flowChange).toMatchObject({ lost: true, reason: 'reset' });
    expect(s.getFlow()).toBe(1);
    expect(s.onCrash().lost).toBe(false); // nothing left to lose
  });

  test('timeout halves the bonus above 1.0 and restarts the timer; clears (lost) when the bonus falls below 0.05', () => {
    const s = new ScoreManager();
    for (let i = 0; i < 4; i++) jump(s, 'perfect'); // 2.0
    expect(s.tick(SCORING.flowTimeoutMs - 1)).toMatchObject({ changed: false, lost: false });
    const h1 = s.tick(1);
    expect(h1).toMatchObject({ changed: true, lost: false, reason: 'timeout', previous: 2, flow: 1.5, timeoutFrac: 1 });
    expect(s.getFlowTimeoutFraction()).toBe(1); // timer restarted
    expect(s.tick(SCORING.flowTimeoutMs)).toMatchObject({ lost: false, reason: 'timeout', previous: 1.5, flow: 1.25 });
    expect(s.tick(SCORING.flowTimeoutMs)).toMatchObject({ lost: false, reason: 'timeout', flow: 1.13 });
    expect(s.tick(SCORING.flowTimeoutMs)).toMatchObject({ lost: false, reason: 'timeout', flow: 1.07 });
    const gone = s.tick(SCORING.flowTimeoutMs);
    expect(gone).toMatchObject({ lost: true, reason: 'timeout', previous: 1.07, flow: 1 });
    expect(s.getFlowTimeoutFraction()).toBe(0);
    expect(s.tick(99999)).toMatchObject({ lost: false, changed: false });
  });

  test('a clean landing after a timeout halving rebuilds from the halved value', () => {
    const s = new ScoreManager();
    for (let i = 0; i < 4; i++) jump(s, 'perfect');
    s.tick(SCORING.flowTimeoutMs); // 1.5
    jump(s, 'perfect');
    expect(s.getFlow()).toBe(1.75);
    expect(s.getFlowTimeoutFraction()).toBe(1);
  });

  test('onShieldHit halves the flow bonus and keeps the pending combo (or drops it on request)', () => {
    const s = new ScoreManager();
    for (let i = 0; i < 4; i++) jump(s, 'perfect'); // 2.0
    s.addTrick(trick('backflip', 1, 500));
    const pending = s.getSnapshot().pendingPoints;
    expect(s.onShieldHit()).toMatchObject({ changed: true, lost: false, reason: 'halved', previous: 2, flow: 1.5 });
    expect(s.getSnapshot()).toMatchObject({ pendingPoints: pending, comboTricks: ['backflip'], flow: 1.5 });
    expect(s.onShieldHit(true).flow).toBe(1.25);
    expect(s.getSnapshot()).toMatchObject({ pendingPoints: 0, comboTricks: [] });
    expect(new ScoreManager().onShieldHit()).toMatchObject({ changed: false, lost: false, reason: 'none' });
  });

  test('shield-absorbed mid-air hit: later flips are paid once, never re-paid at full cumulative value', () => {
    const s = new ScoreManager();
    // jump: a backflip is finished, then a hazard hit is absorbed by the shield, then the SECOND turn completes
    const a = s.addTrick(trick('backflip', 1, 600));
    s.onShieldHit();
    const b = s.addTrick(trick('backflip', 2, 900));
    const worth = SCORING.trickBase.backflip * rotationFactor(2) * airtimeFactor(900);
    expect(a.value + b.value).toBeCloseTo(worth, 0);
    expect(s.getSnapshot().pendingPoints).toBe(a.value + b.value);
    expect(s.getSnapshot().comboTricks).toEqual(['backflip']);
    const r = s.onLanding({ quality: 'good' });
    expect(r.banked).toBe(Math.round((a.value + b.value) * 1.25 * r.flowUsed));
    // the old behaviour (onCrash on a shield hit) wiped `paid`, so the second event re-paid the whole worth
    const bad = new ScoreManager();
    bad.addTrick(trick('backflip', 1, 600));
    bad.onCrash();
    const re = bad.addTrick(trick('backflip', 2, 900));
    expect(re.value).toBeCloseTo(worth, 0);
    expect(b.value).toBeLessThan(re.value);
  });

  test('REAL tracker + score: backflip, shield-absorbed hit mid-air (tracker not flagged crashed), second backflip, clean landing', () => {
    const s = new ScoreManager();
    const tracker = new TrickTracker();
    let t = 0;
    let angle = 0;
    const events = [];
    const feed = (o) => {
      t += 16;
      angle += o.dAngle || 0;
      const upd = tracker.update({
        timeMs: t, dtMs: 16, x: 0, y: 0, vx: 400, vy: 0, angularVelDegS: 0, groundAngleDeg: 0, crashed: false,
        grounded: !!o.grounded, angleDeg: angle, input: { heli: 0, airBrake: false, parachute: false },
      });
      for (const tr of upd.tricks) events.push({ kind: 'trick', value: s.addTrick(tr).value, count: tr.count, air: tr.airtimeMs });
      if (upd.landing) events.push({ kind: 'landing', ...s.onLanding({ ...upd.landing, quality: 'good' }) });
    };
    feed({ grounded: true });
    for (let i = 0; i < 70; i++) feed({ dAngle: i < 60 ? -6 : 0 }); // first backflip
    s.onShieldHit(); // the hit is absorbed: scene feeds the tracker an UNFLAGGED frame, sled keeps flying
    for (let i = 0; i < 70; i++) feed({ dAngle: i < 60 ? -6 : 0 }); // second backflip
    expect(events.filter((e) => e.kind === 'landing')).toHaveLength(0);
    for (let i = 0; i < 5; i++) feed({ grounded: true });
    const tricks = events.filter((e) => e.kind === 'trick');
    const landings = events.filter((e) => e.kind === 'landing');
    expect(tricks.map((e) => e.count)).toEqual([1, 2]); // never counted from 1 again
    expect(landings).toHaveLength(1);
    const paid = tricks[0].value + tricks[1].value;
    const worthAt = (air) => SCORING.trickBase.backflip * rotationFactor(2) * airtimeFactor(air);
    // two flips are paid once in total: about one double-flip's worth, not a double flip plus a re-paid single
    expect(paid).toBeGreaterThanOrEqual(worthAt(tricks[0].air) - 1);
    expect(paid).toBeLessThanOrEqual(worthAt(tricks[1].air) + 1);
    expect(landings[0].banked).toBe(Math.round(paid * 1.25 * landings[0].flowUsed));
    expect(s.getSnapshot()).toMatchObject({ pendingPoints: 0, comboTricks: [] });
    expect(s.getSnapshot().trickPoints).toBe(landings[0].banked);
  });

  test('best flow survives loss, reset() clears everything, snapshot exposes flow fields', () => {
    const s = new ScoreManager();
    jump(s, 'perfect');
    jump(s, 'perfect');
    const snap = s.getSnapshot();
    expect(snap).toMatchObject({ flow: 1.5, bestFlow: 1.5, flowTimeoutFrac: 1 });
    s.onCrash();
    expect(s.getSnapshot()).toMatchObject({ flow: 1, bestFlow: 1.5 });
    s.reset();
    expect(s.getSnapshot()).toMatchObject({ flow: 1, bestFlow: 1 });
  });

  test('flow does not touch distance or flat bonuses', () => {
    const s = new ScoreManager();
    for (let i = 0; i < 5; i++) jump(s, 'perfect');
    s.setDistance(10);
    s.addBonus(25, 'shard');
    const snap = s.getSnapshot();
    expect(snap.distancePoints).toBe(10);
    expect(snap.bonusPoints).toBe(25);
  });

  test('flow share: a run of clean trick landings pays clearly more with flow than without', () => {
    const s = new ScoreManager();
    let withoutFlow = 0;
    for (let i = 0; i < 8; i++) {
      s.addTrick(trick('backflip', 1, 800));
      const pending = s.getSnapshot().pendingPoints;
      const r = s.onLanding({ quality: i % 2 ? 'good' : 'perfect' });
      withoutFlow += Math.round(pending * 1.25) + r.bonus;
    }
    expect(s.getSnapshot().trickPoints).toBeGreaterThan(withoutFlow * 1.4);
  });
});

describe('unique-trick combo step', () => {
  test('air brake and parachute keep base points but do not step; isNew reflects stepping', () => {
    const s = new ScoreManager();
    const ab = s.addTrick(trick('airBrake'));
    expect(ab.value).toBe(SCORING.trickBase.airBrake);
    expect(ab.isNew).toBe(false);
    expect(s.addTrick(trick('parachute')).multiplier).toBe(1);
    expect(s.addTrick(trick('helicopterCCW')).isNew).toBe(true);
    expect(s.getMultiplier()).toBe(1.25);
    expect(s.getSnapshot().comboTricks).toEqual(['airBrake', 'parachute', 'helicopterCCW']);
  });
});

describe('comboName', () => {
  test('names from type strings and {type,count} objects', () => {
    expect(comboName([{ type: 'backflip', count: 2 }, { type: 'helicopterCW', count: 1 }])).toBe('DOUBLE BACKFLIP + HELI');
    expect(comboName([{ type: 'frontflip', count: 3 }])).toBe('TRIPLE FRONTFLIP');
    expect(comboName(['backflip', 'airBrake'])).toBe('BACKFLIP + AIR BRAKE');
    expect(comboName(['airBrake', 'backflip'])).toBe('BACKFLIP + AIR BRAKE'); // stable order
    expect(comboName([{ type: 'backflip', count: 5 }])).toBe('5X BACKFLIP');
    expect(comboName(['helicopterCW', 'helicopterCCW'])).toBe('DOUBLE HELI');
    expect(comboName([])).toBe('');
    expect(comboName(['nope'])).toBe('');
  });

  test('degrades to short names then N-TRICK COMBO, always within the cap', () => {
    expect(comboName([{ type: 'backflip', count: 2 }, 'helicopterCW', 'parachute'])).toBe('4-TRICK COMBO');
    expect(comboName([{ type: 'backflip', count: 2 }, 'helicopterCW', 'parachute'], 32)).toBe('DOUBLE BACKFLIP + HELI + CHUTE');
    expect(comboName(['backflip', 'helicopterCW', 'parachute'])).toBe('BACKFLIP + HELI + PARACHUTE');
    expect(comboName([{ type: 'backflip', count: 2 }, 'helicopterCW', 'parachute'], 40)).toBe(
      'DOUBLE BACKFLIP + HELI + PARACHUTE',
    );
    const big = comboName([
      { type: 'backflip', count: 2 }, { type: 'frontflip', count: 1 }, { type: 'helicopterCW', count: 2 }, 'airBrake',
    ]);
    expect(big).toBe('6-TRICK COMBO');
    for (const names of [['backflip', 'frontflip', 'helicopterCW', 'airBrake', 'parachute'], [{ type: 'backflip', count: 8 }]]) {
      expect(comboName(names).length).toBeLessThanOrEqual(SCORING.comboNameMaxChars);
    }
    expect(comboName(['backflip', 'frontflip', 'helicopterCW', 'airBrake', 'parachute'])).toBe('5-TRICK COMBO');
  });

  test('ScoreManager exposes the pending name and returns it from onLanding', () => {
    const s = new ScoreManager();
    s.addTrick(trick('backflip', 1));
    s.addTrick(trick('backflip', 2));
    s.addTrick(trick('helicopterCW', 1));
    expect(s.getComboName()).toBe('DOUBLE BACKFLIP + HELI');
    expect(s.getSnapshot().comboCounts).toEqual({ backflip: 2, helicopterCW: 1 });
    expect(s.onLanding({ quality: 'good' }).comboName).toBe('DOUBLE BACKFLIP + HELI');
    expect(s.getComboName()).toBe('');
  });
});

describe('milestone bonus', () => {
  test('milestoneBonus = 100 x min(sector, 10): linear, capped at 1000', () => {
    expect(milestoneBonus(1)).toBe(100);
    expect(milestoneBonus(4)).toBe(400);
    expect(milestoneBonus(10)).toBe(1000);
    expect(milestoneBonus(11)).toBe(1000);
    expect(milestoneBonus(40)).toBe(1000);
    expect(milestoneBonus(0)).toBe(0);
    expect(milestoneBonus(NaN)).toBe(0);
  });

  test('checkMilestones pays each 500 m once, catches up skipped sectors, and counts as a milestone bonus', () => {
    const s = new ScoreManager();
    expect(s.checkMilestones(499.9)).toEqual([]);
    expect(s.checkMilestones(500)).toEqual([{ sector: 1, points: 100, distanceM: 500 }]);
    expect(s.checkMilestones(520)).toEqual([]);
    const jumped = s.checkMilestones(1600);
    expect(jumped.map((m) => m.sector)).toEqual([2, 3]);
    expect(s.checkMilestones(1600)).toEqual([]);
    const snap = s.getSnapshot();
    expect(snap.milestones).toBe(3);
    expect(snap.bonusByKind.milestone).toBe(600);
    s.reset();
    expect(s.checkMilestones(500)).toHaveLength(1);
  });

  test('milestone pay-out is linear then flat: 5 km pays 5500 in total, 10 km 15500 (the old 100 x sector would pay 21000)', () => {
    const s = new ScoreManager();
    s.checkMilestones(5000); // sectors 1..10
    expect(s.getSnapshot().bonusByKind.milestone).toBe(5500);
    s.checkMilestones(10000); // sectors 11..20 at 1000 each
    expect(s.getSnapshot().bonusByKind.milestone).toBe(15500);
  });
});
