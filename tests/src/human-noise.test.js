import { jest } from '@jest/globals';
import { spawnSync } from 'node:child_process';
import {
  DEFAULT_NOISE_SEED, NOISE_PROFILES, makeHopNoise, noiseOutcome, summarizeNoise, verifyNoiseEvidence,
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
  ];
  for (const args of failedArgs) {
    const result = spawnSync(process.execPath, ['tools/sim/run.mjs', ...args], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/TypeError|RangeError/);
  }
});
