import { ScoreManager, rotationFactor, airtimeFactor } from '../../src/systems/ScoreManager.js';
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
    expect(s.addTrick(trick('airBrake')).multiplier).toBe(1.75);
    expect(s.getSnapshot().comboTricks).toEqual(['backflip', 'frontflip', 'airBrake']);
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
    expect(r.multiplierUsed).toBe(1.5);
    expect(r.banked).toBe(Math.round(pending * 1.5));
    expect(r.bonus).toBe(0);
    const snap = s.getSnapshot();
    expect(snap.trickPoints).toBe(r.banked);
    expect(snap.multiplier).toBe(1);
    expect(snap.comboTricks).toEqual([]);
    expect(snap.pendingPoints).toBe(0);
    expect(snap.bestCombo).toBe(1.5);
  });

  test('perfect landing adds +20 flat (not multiplied), even with no tricks', () => {
    const s = new ScoreManager();
    expect(s.onLanding({ quality: 'perfect' })).toEqual({ banked: 0, bonus: 20, multiplierUsed: 1 });
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
    s.addTrick(trick('airBrake'));
    s.addTrick(trick('parachute'));
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
    expect(s.penalizeReset()).toEqual({ comboPenalty: 0, pointsLost: 0 });
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
      bestCombo: 1, penaltyPoints: 0,
    });
  });

  test('snapshot comboTricks is a copy', () => {
    const s = new ScoreManager();
    s.addTrick(trick('backflip'));
    s.getSnapshot().comboTricks.push('x');
    expect(s.getSnapshot().comboTricks).toEqual(['backflip']);
  });
});
