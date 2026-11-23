/** Developer-only readout of real tools/sim/browser.js results; NO game implementation. */
const validFinite = (x) => typeof x === 'number' && Number.isFinite(x);
const median = (xs) => {
  const a = xs.filter(validFinite).sort((x, y) => x - y);
  if (!a.length) return null;
  const k = a.length >>> 1;
  return a.length % 2 ? a[k] : (a[k - 1] + a[k]) / 2;
};
const rounded = (x) => validFinite(x) ? Math.round(x * 1000) / 1000 : null;

export function classifyEnd(run) {
  if (!run || typeof run.endReason !== 'string' || !run.endReason) throw new Error('missing terminal endReason');
  const why = run.endReason;
  if (why.startsWith('crash:')) {
    if (!run.crash || typeof run.crash.cause !== 'string' || !run.crash.cause) {
      throw new Error(`${run.seed}: crashed but no recorded crash cause`);
    }
    if (why !== `crash:${run.crash.cause}`) throw new Error(`${run.seed}: contradictory crash cause (${why}, ${run.crash.cause})`);
    return run.crash.cause === 'bsod' ? 'bsodCatch' : 'otherDeath';
  }
  if (run.crash) throw new Error(`${run.seed}: live crash hidden by endReason ${why}`);
  if (why === 'maxM' || why === 'timeout') return 'censored';
  if (why === 'stalled') return 'stalled';
  throw new Error(`${run.seed}: unsupported result ${why}`);
}

export function analyzeRun(run, { sampleMs }) {
  if (!run || !run.seed || !run.policy) throw new Error('missing run seed/policy');
  if (!validFinite(run.simSec) || run.simSec < 0 || !validFinite(run.distM) || run.distM < 0 ||
      !Number.isInteger(run.frames) || run.frames < 0) throw new Error(`${run.seed}: invalid runtime/distance/frames`);
  const endType = classifyEnd(run);
  const probe = run.pursuitProbe;
  if (!probe || !Array.isArray(probe.samples) || probe.intervalMs !== sampleMs || !probe.firstActive) {
    throw new Error(`${run.seed}: authoritative pursuit measurements missing or with incorrect interval`);
  }
  const samples = probe.samples;
  if (!samples.length || !validFinite(probe.firstActive.gapPx)) throw new Error(`${run.seed}: no active sampled BSOD gap`);
  if (!validFinite(run.minBsodGapPx) || !validFinite(run.finalBsodGapPx) ||
      !validFinite(probe.maxSampledGapPx) || !Number.isInteger(run.bsodActiveFrames) ||
      run.bsodActiveFrames < 1 || run.bsodActiveFrames > run.frames) {
    throw new Error(`${run.seed}: invalid BSOD state, frame count or min/max/final pursuit gaps`);
  }
  let prev = -1;
  for (const sample of samples) {
    if (!validFinite(sample.tMs) || sample.tMs <= prev || !validFinite(sample.gapPx) ||
        !validFinite(sample.distM) || typeof sample.airborne !== 'boolean') {
      throw new Error(`${run.seed}: missing, unordered or nonfinite pursuit sample`);
    }
    prev = sample.tMs;
  }
  if (samples[0].tMs !== probe.firstActive.tMs || samples[0].gapPx !== probe.firstActive.gapPx ||
      samples.at(-1).tMs !== probe.lastObserved?.tMs) {
    throw new Error(`${run.seed}: first/last pursuit observation mismatch`);
  }
  // The periodic timeline uses 0.001px rounding, but the authoritative 60Hz
  // full-frame extremes and terminal gap retain native precision. Do not let
  // a conflicting set of fields become a plausible-looking science report.
  const tolerancePx = 0.0011;
  if (!validFinite(probe.lastObserved?.gapPx) ||
      Math.abs(samples.at(-1).gapPx - probe.lastObserved.gapPx) > tolerancePx ||
      Math.abs(run.finalBsodGapPx - probe.lastObserved.gapPx) > tolerancePx ||
      run.minBsodGapPx > probe.maxSampledGapPx + tolerancePx ||
      samples.some((v) => v.gapPx < run.minBsodGapPx - tolerancePx ||
        v.gapPx > probe.maxSampledGapPx + tolerancePx)) {
    throw new Error(`${run.seed}: contradictory BSOD pursuit minimum/maximum/terminal observations`);
  }
  if (!run.inputActivity || !Number.isInteger(run.inputActivity.airborneFrames) ||
      run.inputActivity.airborneFrames < 0 || run.inputActivity.airborneFrames > run.frames) {
    throw new Error(`${run.seed}: invalid airborne-frame samples`);
  }
  const first = probe.firstActive.gapPx;
  const last = run.finalBsodGapPx;
  const cutoff = samples[0].tMs + (samples.at(-1).tMs - samples[0].tMs) / 2;
  const tail = samples.filter((s) => s.tMs >= cutoff);
  const tailGrowth = tail.length < 2 ? null : tail.at(-1).gapPx - tail[0].gapPx;
  return {
    seed: run.seed, policy: run.policy, endReason: run.endReason, classification: endType,
    simSec: run.simSec, distM: run.distM, score: run.score,
    wallCatch: endType === 'bsodCatch', censored: endType === 'censored',
    horizon: endType === 'censored' ? run.endReason : null,
    crashCause: run.crash?.cause || null,
    initialGapPx: first, minSampledGapPx: run.minBsodGapPx,
    maxSampledGapPx: probe.maxSampledGapPx, finalGapPx: last,
    netGapGrowthPx: rounded(last - first), lastHalfSampledGrowthPx: rounded(tailGrowth),
    sampledGapGrewOverall: last > first && tailGrowth != null && tailGrowth > 0,
    longestAirtimeMs: run.maxAirtimeMs,
    airborneFraction: rounded(run.frames ? run.inputActivity.airborneFrames / run.frames : 0),
    activeBsodFrames: run.bsodActiveFrames,
    inputActivity: run.inputActivity,
    ...(run.pursuitIntervention ? { pursuitIntervention: run.pursuitIntervention } : {}),
    gapSamples: samples,
  };
}

export function validateAndSummarize({ seedList, policies, byPolicy, sampleMs, startGapPx = null, startSpeedPxS = null }) {
  if (!Array.isArray(seedList) || !seedList.length || seedList.some((s) => !s || typeof s !== 'string') ||
      new Set(seedList).size !== seedList.length) throw new Error('seed plan must have unique nonempty seed identities');
  if (!Array.isArray(policies) || !policies.length || new Set(policies).size !== policies.length) {
    throw new Error('policy plan must have unique names');
  }
  const rows = [];
  const summary = {};
  for (const policy of policies) {
    const record = byPolicy[policy];
    if (!record || !record.args || record.args.policy !== policy || !Array.isArray(record.results)) {
      throw new Error(`${policy}: missing or mislabeled actual simulator output`);
    }
    if (record.results.length !== seedList.length || new Set(record.results.map((r) => r.seed)).size !== seedList.length ||
        seedList.some((seed) => !record.results.some((r) => r.seed === seed))) {
      throw new Error(`${policy}: truncated, duplicated or off-plan seed measurements`);
    }
    if (record.args.pursuitSampleMs !== sampleMs) throw new Error(`${policy}: wrong pursuit sampling interval`);
    for (const run of record.results) {
      if (run.policy !== policy) throw new Error(`${policy}: wrong policy reported by authoritative simulator`);
      const injection = run.pursuitIntervention;
      if (startGapPx === null) {
        if (injection) throw new Error(`${policy}: unexpected counterfactual pursuit intervention in stock result`);
      } else if (!injection || injection.kind !== 'developer-counterfactual-initial-bsod-state' ||
          injection.noCanonicalPlayerTape !== true || injection.requestedGapPx !== startGapPx ||
          !validFinite(injection.observedGapPx) || Math.abs(injection.observedGapPx - startGapPx) > 0.001 ||
          !validFinite(injection.priorGapPx) || !validFinite(injection.dangerRangePx) ||
          injection.dangerRangePx <= 0 ||
          !validFinite(injection.priorWallSpeedPxS) || !validFinite(injection.observedWallSpeedPxS) ||
          (injection.requestedWallSpeedPxS ?? null) !== startSpeedPxS ||
          (startSpeedPxS !== null && injection.observedWallSpeedPxS !== startSpeedPxS) ||
          (startSpeedPxS === null && injection.observedWallSpeedPxS !== injection.priorWallSpeedPxS)) {
        throw new Error(`${policy}: unverified near-threat wall-start intervention`);
      }
      rows.push(analyzeRun(run, { sampleMs }));
    }
    const these = rows.filter((r) => r.policy === policy);
    const counts = { bsodCatch: 0, otherDeath: 0, censored: 0, stalled: 0 };
    for (const r of these) counts[r.classification]++;
    summary[policy] = {
      n: these.length, counts,
      medianSurvivalSec: rounded(median(these.map((r) => r.simSec))),
      medianDistanceM: rounded(median(these.map((r) => r.distM))),
      medianInitialGapPx: rounded(median(these.map((r) => r.initialGapPx))),
      medianMinimumGapPx: rounded(median(these.map((r) => r.minSampledGapPx))),
      medianFinalGapPx: rounded(median(these.map((r) => r.finalGapPx))),
      medianNetGapGrowthPx: rounded(median(these.map((r) => r.netGapGrowthPx))),
      medianLongestAirtimeSec: rounded(median(these.map((r) => r.longestAirtimeMs / 1000))),
      medianAirborneFraction: rounded(median(these.map((r) => r.airborneFraction))),
      sampledGapGrewOverallN: these.filter((r) => r.sampledGapGrewOverall).length,
      censoredAtTimeN: these.filter((r) => r.horizon === 'timeout').length,
      censoredAtDistanceN: these.filter((r) => r.horizon === 'maxM').length,
    };
  }
  return { rows, summary };
}

export function markdownReport(record) {
  const { source, config, summary } = record;
  const cell = (x) => x == null ? '—' : String(x);
  const lines = [
    '# BSOD Inevitability — bounded deterministic experiment (#128)', '',
    `Source commit: \`${source.gitSha}\` (${source.workingTreeClean ? 'clean' : 'DIRTY/experimental'}).`,
    `SIM_REVISION ${source.simRevision}; ruleset \`${source.rulesetId}\`; build ID \`${source.buildId}\`.`,
    `Real authoritative headless Chromium/Phaser/Matter simulation, sampled post-tick at 60Hz; wall-gap timeline every ${config.sampleMs}ms.`,
    `Seeds: ${config.seedList.join(', ')}. Horizon: ${config.maxSec}s or ${config.maxM}m, whichever is first.`,
    ...(config.startGapPx == null ? [] : [
      '', `**COUNTERFACTUAL intervention**: BSOD leading edge was translated at RunScene RUN_START to exactly ${config.startGapPx}px behind the real sled left edge${config.startSpeedPxS == null ? '' : `, and its initial speed set to ${config.startSpeedPxS}px/s`}. This is not default gameplay or an admissible player replay; no production physics constants were changed.`,
    ]), '',
    '| Strategy | Seeds | BSOD catches | Other deaths | Cutoffs | Stalls | Median min gap (px) | Median final gap (px) | Median growth (px) | Median max air (s) | Growing gap cases |',
    '| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
  ];
  for (const policy of config.policies) {
    const x = summary[policy];
    lines.push(`| ${policy} | ${x.n} | ${x.counts.bsodCatch} | ${x.counts.otherDeath} | ${x.counts.censored} | ${x.counts.stalled} | ${cell(x.medianMinimumGapPx)} | ${cell(x.medianFinalGapPx)} | ${cell(x.medianNetGapGrowthPx)} | ${cell(x.medianLongestAirtimeSec)} | ${x.sampledGapGrewOverallN}/${x.n} |`);
  }
  lines.push('', '## Interpretation boundaries', '',
    '- Reaching a time/distance cutoff is **right-censored survival**, NOT proof that pursuit can be avoided indefinitely.',
    '- Growing sampled BSOD gap means it grew during this finite test only; it does not establish an unbounded strategy or balance recommendation.',
    '- Gap minima are sampled at post-tick 60Hz; a narrower 120Hz collision substep might be missed. Actual BSOD catches come from the authoritative crash event.',
    '- Policies are scripted bots, not player skill distributions. Unmeasured inputs, upgrades, difficulty settings and strategies remain untested.',
    '- This is developer-only evidence. No gameplay, scoring, wall speed, leaderboard or compatibility contract was modified.', '',
    'Raw per-policy simulator outputs and a JSON summary reside next to this Markdown report.', '');
  return lines.join('\n');
}
