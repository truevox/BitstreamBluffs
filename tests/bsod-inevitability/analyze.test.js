import { analyzeRun, classifyEnd, validateAndSummarize, markdownReport } from '../../tools/bsod-inevitability/lib/analysis.mjs';

function sample(seed = 'sim-01', policy = 'handsOff') {
  return {
    seed, policy, endReason: 'timeout', simSec: 180, distM: 2800, frames: 10800, score: 105,
    crash: null, maxAirtimeMs: 2000, minBsodGapPx: 100, finalBsodGapPx: 900,
    bsodActiveFrames: 10800, inputActivity: { airborneFrames: 5400 },
    pursuitProbe: { intervalMs: 5000, firstActive: { tMs: 17, gapPx: 200, distM: 0, airborne: false },
      lastObserved: { tMs: 180000, gapPx: 900, distM: 2800, airborne: true }, maxSampledGapPx: 930,
      samples: [
        { tMs: 17, gapPx: 200, distM: 0, airborne: false },
        { tMs: 90000, gapPx: 400, distM: 1000, airborne: true },
        { tMs: 135000, gapPx: 600, distM: 2000, airborne: false },
        { tMs: 180000, gapPx: 900, distM: 2800, airborne: true },
      ] },
  };
}
const record = (policy, runs) => ({ args: { policy, pursuitSampleMs: 5000 }, results: runs });

describe('BSOD terminal attribution and censoring', () => {
  test.each(['timeout', 'maxM'])(`%s is right-censored, NEVER an escape proof`, (why) => {
    expect(classifyEnd({ ...sample(), endReason: why })).toBe('censored');
    expect(analyzeRun({ ...sample(), endReason: why }, { sampleMs: 5000 }).censored).toBe(true);
  });
  test('actual authoritative crash:bsod is a wall catch', () => {
    const r = sample(); r.endReason = 'crash:bsod'; r.crash = { cause: 'bsod' };
    expect(classifyEnd(r)).toBe('bsodCatch');
    expect(analyzeRun(r, { sampleMs: 5000 }).wallCatch).toBe(true);
  });
  test('non-wall deaths stay separately attributed', () => {
    const r = sample(); r.endReason = 'crash:hazard'; r.crash = { cause: 'hazard' };
    expect(classifyEnd(r)).toBe('otherDeath');
  });
  test('stalled is terminal, not a censor or wall catch', () => {
    expect(classifyEnd({ ...sample(), endReason: 'stalled' })).toBe('stalled');
  });
  test('contradictory crash cause fails closed', () => {
    const r = sample(); r.endReason = 'crash:hazard'; r.crash = { cause: 'bsod' };
    expect(() => classifyEnd(r)).toThrow(/contradictory/);
  });
  test('a hidden crash behind a timeout fails closed', () => {
    expect(() => classifyEnd({ ...sample(), crash: { cause: 'hazard' } })).toThrow(/hidden/);
  });
  test('unrecognized policy result fails closed', () => {
    expect(() => classifyEnd({ ...sample(), endReason: 'escapedForever' })).toThrow(/unsupported/);
  });
});

describe('actual post-tick gap sampling', () => {
  test('sampled first/min/final/growth and airtime are distinct quantities', () => {
    const x = analyzeRun(sample(), { sampleMs: 5000 });
    expect(x).toMatchObject({ initialGapPx: 200, minSampledGapPx: 100, maxSampledGapPx: 930,
      finalGapPx: 900, netGapGrowthPx: 700, lastHalfSampledGrowthPx: 300,
      airborneFraction: 0.5, sampledGapGrewOverall: true, longestAirtimeMs: 2000 });
    expect(x.gapSamples).toHaveLength(4);
  });
  test('unchanged or contracting pursuit is not growing', () => {
    const r = sample(); r.finalBsodGapPx = 50; r.pursuitProbe.lastObserved.gapPx = 50;
    r.pursuitProbe.samples.at(-1).gapPx = 50;
    expect(analyzeRun(r, { sampleMs: 5000 }).sampledGapGrewOverall).toBe(false);
  });
  test('probe is opt-in but mandatory for this analysis, not invented', () => {
    const r = sample(); delete r.pursuitProbe;
    expect(() => analyzeRun(r, { sampleMs: 5000 })).toThrow(/measurements missing/);
  });
  test('wrong sampling interval is rejected', () => {
    expect(() => analyzeRun(sample(), { sampleMs: 1000 })).toThrow(/incorrect interval/);
  });
  test('last observation must be included, no manufactured terminal point', () => {
    const r = sample(); r.pursuitProbe.lastObserved.tMs++;
    expect(() => analyzeRun(r, { sampleMs: 5000 })).toThrow(/first\/last/);
  });
  test('unordered, repeated, NaN and absent gap timestamps are rejected', () => {
    for (const value of [NaN, undefined, -Infinity, 17]) {
      const r = sample(); r.pursuitProbe.samples[1].tMs = value;
      expect(() => analyzeRun(r, { sampleMs: 5000 })).toThrow(/unordered or nonfinite/);
    }
  });
  test('invalid airborne count is rejected', () => {
    const r = sample(); r.inputActivity.airborneFrames = r.frames + 1;
    expect(() => analyzeRun(r, { sampleMs: 5000 })).toThrow(/airborne/);
  });
});

describe('source-complete paired policy matrix', () => {
  const input = () => ({
    sampleMs: 5000, seedList: ['sim-01', 'sim-02'], policies: ['handsOff', 'canopyFlip'],
    byPolicy: {
      handsOff: record('handsOff', [sample('sim-01'), sample('sim-02')]),
      canopyFlip: record('canopyFlip', [sample('sim-01', 'canopyFlip'), sample('sim-02', 'canopyFlip')]),
    },
  });
  test('valid policies are pooled only within their named arm', () => {
    const { rows, summary } = validateAndSummarize(input());
    expect(rows).toHaveLength(4);
    expect(summary.canopyFlip.counts).toEqual({ bsodCatch: 0, otherDeath: 0, censored: 2, stalled: 0 });
    expect(summary.handsOff.sampledGapGrewOverallN).toBe(2);
  });
  test('missing a seed fails even if two rows exist', () => {
    const x = input(); x.byPolicy.canopyFlip.results[1].seed = 'sim-01';
    expect(() => validateAndSummarize(x)).toThrow(/truncated, duplicated/);
  });
  test('off-plan seed and truncated arm both fail', () => {
    const a = input(); a.byPolicy.handsOff.results[1].seed = 'sim-99';
    expect(() => validateAndSummarize(a)).toThrow(/off-plan/);
    const b = input(); b.byPolicy.handsOff.results.pop();
    expect(() => validateAndSummarize(b)).toThrow(/truncated/);
  });
  test('wrong policy or interval is rejected before any report', () => {
    const a = input(); a.byPolicy.handsOff.results[0].policy = 'canopyFlip';
    expect(() => validateAndSummarize(a)).toThrow(/wrong policy/);
    const b = input(); b.byPolicy.handsOff.args.pursuitSampleMs = 1000;
    expect(() => validateAndSummarize(b)).toThrow(/wrong pursuit/);
  });
  test('report never characterizes bounded survival as indefinite', () => {
    const x = input(); const { rows, summary } = validateAndSummarize(x);
    const doc = markdownReport({ source: { gitSha: 'fake', workingTreeClean: true, simRevision: 6,
      rulesetId: 'sha256:test', buildId: 'sha256:other' },
      config: { ...x, maxSec: 180, maxM: 100000 }, rows, summary });
    expect(doc).toContain('right-censored');
    expect(doc).toContain('NOT proof');
    expect(doc).toContain('60Hz');
  });
});
