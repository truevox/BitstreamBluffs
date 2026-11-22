import { compareStockAdjacentArms } from '../../tools/qa/stock-adjacent-ab-guards.js';

function arm(count = 120) {
  return {
    match: {
      header: {
        format: 'bb-ghost-tape', version: 1, physicsVersion: 1, runRandomVersion: 1,
        seed: 'sim-11', biomeMask: 0, mode: 'normal', dailyRuleId: 'featherweight', simTickHz: 120,
        dailyRuleSource: 'clock-at-start', syncLevel: 1,
        startedAt: Date.parse('2026-01-05T12:00:00Z'), controlLayout: 'tricksRight', edgeRows: 'every-tick',
        boosts: [], upgradeRanks: null, magnetsDrop: false, kodiaksOn: false, kodiakPackMode: 'same',
        startPose: [0, 1, 0, 0, 0, 0],
        bsod: { leftEdgeX: 1, initial: { wallX: -2, wallSpeedPxS: 0, accelerationPxS2: 0 } },
        random: { version: 1, physicsScramble: 4, visualSled: 2, visualFx: 3, visualCamera: 4 },
      },
      inputs: [[1, 6, 0]],
    },
    rows: Array.from({ length: count }, (_, i) => ({
      tick: i + 1, x: i, y: 2, angle: 0, vx: 1, vy: 0, angularVelocity: 0, score: 0, grounded: true,
    })),
    terminal: { tick: count + 1, cause: 'hazard', hazardId: 'packetSpike', x: 9999, y: 2, speedPxS: 1 },
    nativeCheckpoints: Math.floor(count / 120),
  };
}

describe('fixed native adjacent-release comparison', () => {
  test('reports a true observed match without disclosing raw evidence', () => {
    const result = compareStockAdjacentArms(arm(), arm());
    expect(result).toMatchObject({
      commonCompletedTicks: 120, firstObservedDifference: null, maxCommonPositionDeltaPx: 0,
      terminalChangedFields: [], before: { completedTicks: 120, nativeCheckpointsPerReplay: 1, commonIntervalAirborneTicks: 0 },
    });
    expect(result.matchedNativeInputSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.before.terminal).toEqual({ tick: 121, cause: 'hazard', hazardId: 'packetSpike' });
    expect(JSON.stringify(result)).not.toMatch(/9999|startPose|physicsScramble|\[\[1,6,0\]\]/);
  });

  test('identifies exact first scalar changes, separate fatal changes and only comparable ticks', () => {
    const a = arm(), b = arm(121);
    Object.assign(b.rows[7], { x: 10, score: 5, grounded: false });
    b.rows[119].score = 12;
    b.rows[120].score = 999;
    b.terminal.x++;
    expect(compareStockAdjacentArms(a, b)).toMatchObject({
      commonCompletedTicks: 120, firstObservedDifference: { tick: 8, fields: ['x', 'score', 'grounded'] },
      maxCommonPositionDeltaPx: 3, terminalChangedFields: ['tick', 'x'],
      after: { completedTicks: 121, commonIntervalAirborneTicks: 1, commonLastCompletedScore: 12 },
    });
  });

  test.each([
    [a => { a.match.inputs[0][1] = 7; }, /neutral input encoding/],
    [a => { a.match.header.random.physicsScramble = 5; }, /headers do not match/],
    [a => { delete a.match.header.random.visualFx; }, /stock capture header/],
    [a => { a.match.header.seed = 'other'; }, /stock capture header/],
    [a => { a.match.header.kodiaksOn = true; }, /stock capture header/],
    [a => { a.rows[3].tick = 3; }, /noncontiguous/],
    [a => { a.rows[3].vx = Infinity; }, /completed observations/],
    [a => { a.rows[3].grounded = 0; }, /completed observations/],
    [a => { a.nativeCheckpoints = 0; }, /checkpoint coverage/],
    [a => { a.terminal.tick = 120; }, /natural terminal observation/],
    [a => { a.terminal.hazardId = undefined; }, /natural terminal observation/],
  ])('rejects invalid evidence case %#', (mutate, error) => {
    const candidate = arm();
    mutate(candidate);
    expect(() => compareStockAdjacentArms(arm(), candidate)).toThrow(error);
  });
});
