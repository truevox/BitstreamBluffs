import { jest } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import { Rng } from '../../src/systems/Rng.js';
import {
  DEFAULT_NOISE_SEED, FATIGUE_RAMP, NOISE_PROFILES, fatigueAtFrame, makeHopNoise, noiseOutcome, summarizeNoise, verifyNoiseEvidence,
} from '../../tools/sim/human-noise.js';

function sample(profile, noiseSeed = DEFAULT_NOISE_SEED, courseSeed = 'sim-01') {
  const planner = makeHopNoise(profile, courseSeed, noiseSeed);
  const frames = [];
  for (let frame = 0; frame < 2400; frame++) {
    if (planner.step(frame, frame % 40 === 0)) frames.push(frame);
  }
  return { frames, stats: planner.stats() };
}

test('ideal passes each hop intent immediately and introduces no misses or other controls', () => {
  const ideal = sample('ideal');
  expect(ideal.frames).toEqual(Array.from({ length: 60 }, (_, i) => i * 40));
  expect(ideal.stats).toEqual({
    intents: 60, missed: 0, sent: 60, coalesced: 0, delayFrames: 0, pendingAtEnd: false,
  });
});

test('seeded profile jitter and misses repeat and do not draw from global randomness', () => {
  const random = jest.spyOn(Math, 'random').mockImplementation(() => {
    throw new Error('Must not use the global RNG');
  });
  try {
    for (const profile of ['steady', 'distracted']) {
      const result = sample(profile);
      expect(result).toEqual(sample(profile));
      expect(result).not.toEqual(sample(profile, 'another-seed'));
      expect(result).not.toEqual(sample(profile, DEFAULT_NOISE_SEED, 'sim-02'));
      const spec = NOISE_PROFILES[profile];
      const offsets = result.frames.map((frame) => frame % 40);
      expect(offsets.every((offset) => offset >= spec.minDelayFrames && offset <= spec.maxDelayFrames)).toBe(true);
      expect(new Set(offsets).size).toBeGreaterThan(1);
      expect(result.stats.delayFrames).toBe(offsets.reduce((a, b) => a + b, 0));
      expect(result.stats.missed).toBeGreaterThan(0);
      expect(result.stats.sent + result.stats.missed).toBe(60);
    }
  } finally { random.mockRestore(); }
});

test('pending reactions do not stack simultaneous presses or fire twice', () => {
  const planner = makeHopNoise('steady', 'sim-01');
  const first = sample('steady').frames[0];
  expect(first).toBeLessThan(8); // this seed schedules the first intent
  expect(planner.step(0, true)).toBe(false);
  expect(planner.step(1, true)).toBe(false);
  const delivered = [];
  for (let frame = 2; frame < 12; frame++) {
    if (planner.step(frame, false)) delivered.push(frame);
  }
  expect(delivered).toEqual([first]);
  expect(planner.stats()).toMatchObject({ coalesced: 1, sent: 1, pendingAtEnd: false });
  expect(() => planner.step(11, false)).toThrow(/increasing/);
  expect(() => makeHopNoise('toString', 'sim-01')).toThrow(/unknown/i);
});

test('the fatigue ramp starts at 6 simulated seconds, reaches full at 18 and clamps', () => {
  expect(FATIGUE_RAMP).toMatchObject({ frameHz: 60, startFrame: 360, fullFrame: 1080,
    maxAddedDelayFrames: 6, maxAddedMissProbability: .16, unaffectedProfile: 'ideal' });
  const fresh = { phase: 'preRamp', delayFrames: 0, missProbability: 0 };
  expect(fatigueAtFrame(0)).toEqual(fresh);
  expect(fatigueAtFrame(360)).toEqual(fresh);
  expect(fatigueAtFrame(361)).toMatchObject({ phase: 'ramp', delayFrames: 0 });
  expect(fatigueAtFrame(361).missProbability).toBeGreaterThan(0);
  expect(fatigueAtFrame(720)).toEqual({ phase: 'ramp', delayFrames: 3, missProbability: .08 });
  expect(fatigueAtFrame(1079).delayFrames).toBe(5);
  expect(fatigueAtFrame(1080)).toEqual({ phase: 'capped', delayFrames: 6, missProbability: .16 });
  expect(fatigueAtFrame(1800)).toEqual(fatigueAtFrame(1080));
  expect(() => fatigueAtFrame(NaN)).toThrow(/simulated frame/);
});

function planned(profile, course, intentFrames, fatigue) {
  const planner = makeHopNoise(profile, course, DEFAULT_NOISE_SEED, { fatigue });
  const frames = [];
  // Only simulated frame indices, not wall time or number of prior calls.
  for (let frame = Math.min(...intentFrames); frame <= Math.max(...intentFrames) + 30; frame++) {
    if (planner.step(frame, intentFrames.includes(frame))) frames.push(frame);
  }
  return { frames, ...planner.stats() };
}

test.each([false, true])('coalesces an intent on the pending dispatch frame with fatigue=%s', (fatigue) => {
  const firstIntent = FATIGUE_RAMP.startFrame - 1;
  const [dispatch] = planned('steady', 'sim-01', [firstIntent], fatigue).frames;
  expect(dispatch).toBeGreaterThan(FATIGUE_RAMP.startFrame);
  const intents = [firstIntent, 420, 600, 720, 1080, 1600];
  const chance = jest.spyOn(Rng.prototype, 'chance');
  const delay = jest.spyOn(Rng.prototype, 'int');
  try {
    const control = planned('steady', 'sim-01', intents, fatigue);
    const chanceCalls = chance.mock.calls.slice(), delayCalls = delay.mock.calls.slice();
    expect(chanceCalls.length).toBe(intents.length);
    expect(delayCalls.length).toBeGreaterThan(1);
    expect(control.frames).toContain(dispatch);
    expect(control.frames.at(-1)).toBeGreaterThan(dispatch);
    chance.mockClear();
    delay.mockClear();

    const paired = planned('steady', 'sim-01', [firstIntent, dispatch, ...intents.slice(1)], fatigue);
    expect(paired).toEqual({ ...control, intents: control.intents + 1, coalesced: control.coalesced + 1 });
    expect(chance.mock.calls).toEqual(chanceCalls);
    expect(delay.mock.calls).toEqual(delayCalls);
  } finally {
    chance.mockRestore();
    delay.mockRestore();
  }
});

test('early and already planned presses stay identical, and the ideal control stays unchanged at all phases', () => {
  const base = planned('steady', 'sim-01', [359], false);
  const { fatigue, ...early } = planned('steady', 'sim-01', [359], true);
  expect(early).toEqual(base);
  expect(early.frames[0]).toBeGreaterThan(FATIGUE_RAMP.startFrame); // pending press crossed the boundary
  expect(fatigue).toEqual({ applies: true, phaseIntents: { preRamp: 1, ramp: 0, capped: 0 }, addedDelayFrames: 0 });
  const intents = [0, 361, 720, 1080, 2000];
  const { fatigue: control, ...ideal } = planned('ideal', 'sim-01', intents, true);
  expect(ideal).toEqual(planned('ideal', 'sim-01', intents, false));
  expect(ideal.frames).toEqual(intents);
  expect(control).toEqual({ applies: false, phaseIntents: { preRamp: 0, ramp: 0, capped: 0 }, addedDelayFrames: 0 });
});

test('late noisy intents can gain delay or miss; no extra randomness or cross-run state', () => {
  const guard = jest.spyOn(Math, 'random').mockImplementation(() => { throw new Error('No global randomness'); });
  try {
    const base = planned('steady', 'sim-01', [1080], false);
    const delayed = planned('steady', 'sim-01', [1080], true);
    expect(delayed.frames).toEqual([base.frames[0] + 6]);
    expect(delayed.fatigue).toEqual({ applies: true, phaseIntents: { preRamp: 0, ramp: 0, capped: 1 }, addedDelayFrames: 6 });
    expect(delayed).toEqual(planned('steady', 'sim-01', [1080], true));
    expect(planned('steady', 'sim-11', [1080], false).sent).toBe(1);
    expect(planned('steady', 'sim-11', [1080], true)).toMatchObject({ sent: 0, missed: 1 });
    expect(planned('steady', 'sim-01', [0], true).frames).toEqual(base.frames.map((f) => f - 1080));
  } finally { guard.mockRestore(); }
});

test('keeps crashes, deadlines and stalls in the denominator rather than calling them passes', () => {
  const runs = ['maxM', 'crash:hazard', 'timeout', 'stalled'].map((endReason) => ({ endReason }));
  expect(summarizeNoise(runs)).toEqual({ trials: 4, pass: 1, crash: 1, timeout: 1, stalled: 1, passRate: .25 });
  expect(summarizeNoise([]).passRate).toBeNull();
  expect(() => noiseOutcome('browser error')).toThrow();
});

test('verification compares actual tick input and outcomes, ignoring only wall time and playback-only loss of planner stats', () => {
  const record = {
    wallMs: 40, endReason: 'maxM', distM: 191, trace: [[1, 2, 3, 0]],
    humanNoise: { stats: { sent: 1 }, input: { ticks: 20, rows: [[1, 0, 0], [12, 128, 0]] }, final: { score: 90 } },
  };
  const borrowed = { ...record.humanNoise, stats: null };
  expect(verifyNoiseEvidence(record, { ...record, wallMs: 90 })).toBe(true);
  expect(verifyNoiseEvidence(record, { ...record, humanNoise: borrowed })).toBe(false);
  expect(verifyNoiseEvidence(record, { ...record, humanNoise: borrowed }, { playback: true })).toBe(true);
  expect(verifyNoiseEvidence(record, {
    ...record, humanNoise: { ...borrowed, input: { ticks: 20, rows: [[1, 0, 0], [13, 128, 0]] } },
  }, { playback: true })).toBe(false);
  expect(verifyNoiseEvidence(record, { ...record, endReason: 'timeout' }, { playback: true })).toBe(false);
});

test('CLI rejects unsafe or accidental unpaired panel options before browser startup', () => {
  const failedArgs = [
    ['--noiseProfiles', 'steady'],
    ['--noiseProfiles', 'steady,steady'],
    ['--noiseProfiles', 'steady,unknown'],
    ['--noiseProfiles', 'ideal,steady', '--seeds', '10000000000'],
    ['--noiseProfiles', 'ideal,steady', '--seeds', 'x,x'],
    ['--noiseProfiles', 'ideal,steady', '--maxSec', '61'],
    ['--noiseProfiles', 'ideal,steady', '--noReload'],
    ['--noiseProfiles', 'ideal,steady', '--policy', 'flip'],
    ['--fatigue'],
    ['--noiseProfiles', 'ideal,steady', '--fatigue=false'],
    ['--noiseProfiles', 'ideal,steady', '--fatigue', 'false'],
    ['--noiseProfiles', 'ideal,steady', '--fatigue', '--fatigue'],
  ];
  for (const args of failedArgs) {
    const result = spawnSync(process.execPath, ['tools/sim/run.mjs', ...args], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/TypeError|RangeError/);
  }
});
