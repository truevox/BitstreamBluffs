/** #128: explicit, non-player-record counterfactual pursuit start. */
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAndSummarize, markdownReport } from '../../tools/bsod-inevitability/lib/analysis.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
function row(seed = 'sim-01') {
  const initGap = 200;
  return {
    seed, policy: 'handsOff', endReason: 'timeout', simSec: 30, distM: 400, frames: 1800,
    score: 123, crash: null, maxAirtimeMs: 100,
    minBsodGapPx: 100, finalBsodGapPx: 900, bsodActiveFrames: 1800,
    inputActivity: { airborneFrames: 50 },
    pursuitProbe: { intervalMs: 5000, firstActive: { tMs: 17, gapPx: initGap, distM: 0, airborne: true },
      lastObserved: { tMs: 30000, gapPx: 900, distM: 400, airborne: false },
      maxSampledGapPx: 930,
      samples: [
        { tMs: 17, gapPx: initGap, distM: 0, airborne: true },
        { tMs: 15000, gapPx: 400, distM: 150, airborne: false },
        { tMs: 30000, gapPx: 900, distM: 400, airborne: false },
      ],
    },
    pursuitIntervention: {
      kind: 'developer-counterfactual-initial-bsod-state',
      priorGapPx: 7600, requestedGapPx: 200, observedGapPx: 200,
      priorWallSpeedPxS: 115, requestedWallSpeedPxS: 1000, observedWallSpeedPxS: 1000,
      dangerRangePx: 3400, phase: 'RUN_START before first regular physics tick',
      noCanonicalPlayerTape: true,
    },
  };
}
const setup = () => ({
  seedList: ['sim-01', 'sim-02'], policies: ['handsOff'], sampleMs: 5000,
  startGapPx: 200, startSpeedPxS: 1000,
  byPolicy: {
    handsOff: { args: { policy: 'handsOff', pursuitSampleMs: 5000 },
      results: [row('sim-01'), row('sim-02')] },
  },
});

describe('source-honest near-threat counterfactual research', () => {
  test('accepts only a consistently stamped 2-seed genuine counterfactual', () => {
    const x = setup();
    const { rows, summary } = validateAndSummarize(x);
    expect(rows).toHaveLength(2);
    expect(rows[0].pursuitIntervention).toEqual(x.byPolicy.handsOff.results[0].pursuitIntervention);
    expect(summary.handsOff.counts).toEqual({ bsodCatch: 0, otherDeath: 0, censored: 2, stalled: 0 });
    const md = markdownReport({
      source: { gitSha: 'a'.repeat(40), workingTreeClean: true, simRevision: 6,
        rulesetId: `sha256:${'b'.repeat(64)}`, buildId: `sha256:${'c'.repeat(64)}` },
      config: { ...x, maxSec: 30, maxM: 100000 }, rows, summary,
    });
    expect(md).toContain('COUNTERFACTUAL intervention');
    expect(md).toContain('200px');
    expect(md).toContain('1000px/s');
    expect(md).toContain('not default gameplay');
  });
  test('default source cannot disguise an injected counterfactual as normal', () => {
    const x = setup(); delete x.startGapPx; delete x.startSpeedPxS;
    expect(() => validateAndSummarize(x)).toThrow(/unexpected counterfactual/);
  });
  test.each([
    ['missing intervention', x => {delete x.byPolicy.handsOff.results[0].pursuitIntervention;}],
    ['wrong kind', x => {x.byPolicy.handsOff.results[0].pursuitIntervention.kind='other';}],
    ['requested gap mismatch', x => {x.byPolicy.handsOff.results[0].pursuitIntervention.requestedGapPx=900;}],
    ['observed gap mismatch', x => {x.byPolicy.handsOff.results[0].pursuitIntervention.observedGapPx=500;}],
    ['fake player tape', x => {x.byPolicy.handsOff.results[0].pursuitIntervention.noCanonicalPlayerTape=false;}],
    ['fake speed', x => {x.byPolicy.handsOff.results[0].pursuitIntervention.observedWallSpeedPxS=2000;}],
    ['wrong input speed', x => {x.byPolicy.handsOff.results[0].pursuitIntervention.requestedWallSpeedPxS=200;}],
    ['nonfinite old speed', x => {x.byPolicy.handsOff.results[0].pursuitIntervention.priorWallSpeedPxS=NaN;}],
    ['missing danger range', x => {delete x.byPolicy.handsOff.results[0].pursuitIntervention.dangerRangePx;}],
    ['inverted danger range', x => {x.byPolicy.handsOff.results[0].pursuitIntervention.dangerRangePx=-2;}],
  ])('rejects %s', (_name, damage) => {
    const x=setup();damage(x);
    expect(() => validateAndSummarize(x)).toThrow(/unverified near-threat/);
  });
  test('gap-only experimental branch verifies unchanged wall speed, not synthetic acceleration', () => {
    const x = setup(); x.startSpeedPxS = null;
    x.byPolicy.handsOff.results.forEach(r => {
      r.pursuitIntervention.requestedWallSpeedPxS = null;
      r.pursuitIntervention.observedWallSpeedPxS = r.pursuitIntervention.priorWallSpeedPxS;
    });
    expect(validateAndSummarize(x).rows).toHaveLength(2);
    x.byPolicy.handsOff.results[0].pursuitIntervention.observedWallSpeedPxS = 1000;
    expect(() => validateAndSummarize(x)).toThrow(/unverified near-threat/);
  });
  test.each([
    ['--startGapPx', '0'], ['--startGapPx', '2.5'],
    ['--startGapPx', '20001'], ['--startSpeedPxS', '0'],
    ['--startSpeedPxS', '1000'],
  ])('CLI fails before browser setup on invalid %s %s', (flag,value) => {
    let error;
    try {
      execFileSync(process.execPath, [path.join(ROOT, 'tools/bsod-inevitability/run.mjs'),
        flag, value, '--outDir', '/tmp/this-must-never-be-created'],
        { cwd: ROOT, stdio: 'pipe', encoding:'utf8' });
    } catch(e) { error=e; }
    expect(error).toBeDefined();
    expect(error.status).not.toBe(0);
    expect(error.stderr).toMatch(/startGapPx|startSpeedPxS/);
  });
});
