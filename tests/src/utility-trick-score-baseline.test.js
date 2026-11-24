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
  function frame({ grounded, pitch = 0, airBrake = false, airBrakeKicked = false, parachute = false }) {
    timeMs += dtMs;
    angleDeg += pitch;
    score.tick(dtMs);
    return tracker.update({
      timeMs, dtMs, angleDeg, grounded, groundAngleDeg: 0, vx: 400, vy: 100,
      input: { airBrake, airBrakeKicked, parachute },
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
      const combined = maneuver === 'paid+parachute';
      const immediate = maneuver === 'paid-tap' || maneuver === 'paid-then-duplicate';
      const spent = maneuver === 'paid-then-duplicate' || maneuver === 'held-without-pulse';
      recordTricks(frame({
        grounded: false,
        // Hold/tap state and the post-physics pulse are independent. The
        // extra pulse in one arm is deliberate, testing the tracker latch.
        airBrake: active && (combined || spent || (maneuver === 'unpaid-tap' && activeTick === 0)),
        airBrakeKicked: (combined && activeTick === 24) || (immediate && activeTick === 0) ||
          (maneuver === 'paid-then-duplicate' && activeTick === 30),
        parachute: active && (combined || maneuver === 'parachute-only'),
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
    ['unpaid-tap', [[], []], [0, 0], [0, 0], [1, 1], 1],
    ['held-without-pulse', [[], []], [0, 0], [0, 0], [1, 1], 1],
    ['paid-tap', [[utility('airBrake', 10, 40)], [utility('airBrake', 210, 43)]],
      [40, 43], [40, 43], [1, 1], 1],
    ['paid-then-duplicate', [[utility('airBrake', 10, 40)], [utility('airBrake', 210, 43)]],
      [40, 43], [40, 43], [1, 1], 1],
    ['parachute-only', [[utility('parachute', 300, 45)], [utility('parachute', 500, 48)]],
      [45, 48], [45, 48], [1, 1], 1],
    ['paid+parachute', [
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
    const [, second] = scoreTwoFlights(['backflip', 'paid+parachute']);
    expect(second.awards).toEqual([utility('airBrake', 450, 47), utility('parachute', 500, 48)]);
    expect(second.provisional).toMatchObject({ pendingPoints: 95, flow: 1.25 });
    expect(second.payout).toMatchObject({
      banked: 119, bonus: 20, multiplierUsed: 1, flowUsed: 1.25,
      flowChange: { changed: false, flow: 1.25 },
    });
    expect(second.settled).toMatchObject({ flow: 1.25, trickPoints: 334, total: 354 });
  });

  test('a held AirBrake with no new pulse settles a prior paid trick on a short landing', () => {
    const tracker = new TrickTracker();
    const score = new ScoreManager();
    const frame = (timeMs, grounded, airBrakeKicked) => tracker.update({
      timeMs, dtMs: 10, angleDeg: 0, grounded, groundAngleDeg: 0, vx: 160, vy: 100,
      input: { airBrake: true, airBrakeKicked },
    });
    frame(10, true, false);
    const kick = frame(20, false, true);
    expect(kick.tricks).toHaveLength(1);
    expect(kick.landing).toBeNull();
    expect({ ...kick.tricks[0], ...score.addTrick(kick.tricks[0]) }).toEqual(utility('airBrake', 10, 40));
    const touchdown = frame(30, true, false);
    expect(touchdown.tricks).toEqual([]);
    expect(touchdown.landing).toMatchObject({ quality: 'good', airtimeMs: 20, shortAirBrakeTouchdown: true });
    expect(score.onLanding(touchdown.landing)).toMatchObject({
      banked: 40, bonus: 0, multiplierUsed: 1, flowUsed: 1, flowChange: { changed: false },
    });
    expect(score.getSnapshot()).toMatchObject({ pendingPoints: 0, trickPoints: 40, flow: 1 });
  });
});
