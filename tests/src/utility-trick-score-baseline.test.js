import { ScoreManager } from '../../src/systems/ScoreManager.js';
import { TrickTracker } from '../../src/systems/TrickTracker.js';

// Synthetic post-physics frames: this measures the current tracker-to-score
// contract, not the controls/physics, a recorded run, or future Trick Flow.
function scoreTwoFlights(maneuvers) {
  const dtMs = 10;
  const tracker = new TrickTracker();
  const score = new ScoreManager();
  let timeMs = 0;
  let angleDeg = 0;
  function frame({ grounded, pitch = 0, utility = false }) {
    timeMs += dtMs;
    angleDeg += pitch;
    score.tick(dtMs);
    return tracker.update({
      timeMs, dtMs, angleDeg, grounded, groundAngleDeg: 0, vx: 400, vy: 100,
      input: { airBrake: utility, parachute: utility },
    });
  }
  frame({ grounded: true });
  return maneuvers.map((maneuver, index) => {
    const awards = [];
    const recordTricks = (tricks) => {
      for (const trick of tricks) awards.push({ ...trick, ...score.addTrick(trick) });
    };

    // Both flights have the same duration and distance across all arms.
    // In flight two the maneuver starts 200ms later, so utility awards can
    // show the effect of airtime at registration independently of duration.
    for (let tick = 0; tick < 60; tick++) {
      const activeTick = tick - index * 20;
      const active = activeTick >= 0;
      recordTricks(frame({
        grounded: false,
        utility: active && (maneuver === 'utility' || (maneuver === 'tap' && activeTick < 1)),
        pitch: active && maneuver === 'backflip' && activeTick < 30 ? -12 : 0,
      }).tricks);
    }

    score.setDistance((index + 1) * 10 + 0.5);
    const { tricks, landing } = frame({ grounded: true });
    recordTricks(tricks);
    const provisional = score.getSnapshot();
    const payout = score.onLanding(landing);
    return { awards, provisional, landing, payout, settled: score.getSnapshot() };
  });
}

describe('#157 current utility trick score attribution', () => {
  const utility = (type, airtimeMs, value) => ({
    type, count: 1, airtimeMs, value, rotationDeg: 0, isNew: false, multiplier: 1,
  });
  const backflip = (airtimeMs, value) => ({
    type: 'backflip', count: 1, airtimeMs, value, rotationDeg: 348, isNew: true, multiplier: 1.25,
  });

  test.each([
    ['flat', [[], []], [0, 0], [0, 0], [1, 1], 1],
    ['tap', [[], []], [0, 0], [0, 0], [1, 1], 1],
    ['utility', [
      [utility('airBrake', 250, 44), utility('parachute', 300, 45)],
      [utility('airBrake', 450, 47), utility('parachute', 500, 48)],
    ], [89, 95], [89, 95], [1, 1], 1],
    ['backflip', [[backflip(290, 112)], [backflip(490, 120)]], [112, 120], [175, 225], [1.25, 1.5], 1.25],
  ])('two %s flights distinguish registered tricks and the score components', (
    maneuver, expectedTricks, pending, banked, flow, combo,
  ) => {
    let settledTrickPoints = 0;
    for (const [i, flight] of scoreTwoFlights([maneuver, maneuver]).entries()) {
      const distancePoints = (i + 1) * 10;
      expect(flight.awards).toEqual(expectedTricks[i]);
      expect(flight.landing).toMatchObject({ quality: 'perfect', airtimeMs: 610 });
      expect(flight.provisional).toMatchObject({
        distancePoints, pendingPoints: pending[i], multiplier: combo,
        trickPoints: settledTrickPoints, total: distancePoints + settledTrickPoints,
      });
      expect(flight.payout).toMatchObject({
        banked: banked[i], bonus: 20, multiplierUsed: combo, flowUsed: flow[i],
        flowChange: { changed: maneuver === 'backflip' },
      });

      settledTrickPoints += banked[i] + 20;
      expect(flight.settled).toMatchObject({
        distancePoints, trickPoints: settledTrickPoints, bonusPoints: 0, penaltyPoints: 0,
        total: distancePoints + settledTrickPoints, pendingPoints: 0, multiplier: 1, flow: flow[i],
      });
    }
  });

  test('a utility-only landing uses previously earned flow without increasing it', () => {
    const [, second] = scoreTwoFlights(['backflip', 'utility']);
    expect(second.awards).toEqual([utility('airBrake', 450, 47), utility('parachute', 500, 48)]);
    expect(second.provisional).toMatchObject({ pendingPoints: 95, flow: 1.25 });
    expect(second.payout).toMatchObject({
      banked: 119, bonus: 20, multiplierUsed: 1, flowUsed: 1.25,
      flowChange: { changed: false, flow: 1.25 },
    });
    expect(second.settled).toMatchObject({ flow: 1.25, trickPoints: 334, total: 354 });
  });
});
