// Issue #59 stage 1: gameplay randomness comes from named seeded streams; new seeds from the CSPRNG.
import fs from 'fs';
import { Rng } from '../../src/systems/Rng.js';
import { runRandomStreams, runRandomState, RUN_STREAMS, RUN_RANDOM_VERSION } from '../../src/systems/RunRandom.js';
import { randomSeed } from '../../src/ui/Format.js';

const draws = (rng, n) => Array.from({ length: n }, () => rng.next());

describe('run random streams', () => {
  test('same seed, same scramble sequence; different seed, different sequence', () => {
    expect(draws(runRandomStreams('ABC234').physicsScramble, 50)).toEqual(draws(runRandomStreams('ABC234').physicsScramble, 50));
    expect(draws(runRandomStreams('ABC234').physicsScramble, 5)).not.toEqual(draws(runRandomStreams('ABC235').physicsScramble, 5));
  });

  test('drawing cosmetic randomness never moves the physics stream', () => {
    const a = runRandomStreams('DAILY-1'), b = runRandomStreams('DAILY-1');
    const quiet = draws(a.physicsScramble, 40);
    const noisy = [];
    for (let i = 0; i < 40; i++) { draws(b.visualSled, 7); noisy.push(b.physicsScramble.next()); }
    expect(noisy).toEqual(quiet);
  });

  test('streams are Rng.fork of the run seed, so existing terrain/mission streams are untouched', () => {
    const s = runRandomStreams('legacy-seed');
    expect(s.physicsScramble.baseSeed).toBe(new Rng('legacy-seed').fork(RUN_STREAMS.physicsScramble).baseSeed);
    expect(s.physicsScramble.baseSeed).not.toBe(s.visualSled.baseSeed);
    expect(new Rng('legacy-seed').next()).toBe(new Rng('legacy-seed').next());
  });

  test('stream state snapshot is versioned and tracks consumption', () => {
    const s = runRandomStreams('X');
    const before = runRandomState(s);
    expect(before.version).toBe(RUN_RANDOM_VERSION);
    s.physicsScramble.next();
    const after = runRandomState(s);
    expect(after.physicsScramble).not.toBe(before.physicsScramble);
    expect(after.visualSled).toBe(before.visualSled);
  });

  test('Sled draws scramble torque from the seeded physics stream; no Math.random left in it', () => {
    const src = fs.readFileSync('src/entities/Sled.js', 'utf8');
    expect(src).not.toMatch(/Math\.random/);
    expect(src).toMatch(/this\.random\.physicsScramble\.next\(\) \* 2 - 1\) \* phys\.scrambleJitterDegS2/);
    expect(src).toMatch(/this\.random\.visualSled\.next\(\)/);
    expect(fs.readFileSync('src/scenes/RunScene.js', 'utf8')).toMatch(/this\.runRandom = runRandomStreams\(this\.seed\)/);
  });
});

describe('new seeds use the CSPRNG', () => {
  test('six readable chars taken from getRandomValues, unbiased mapping', () => {
    const fake = { getRandomValues: (a) => { a.set([0, 31, 32, 63, 255, 8]); return a; } };
    // bytes & 31 -> [0, 31, 0, 31, 31, 8] -> 'A', '9', 'A', '9', '9', 'J'
    expect(randomSeed(fake)).toBe('A9A99J');
  });

  test('real platform crypto: valid alphabet, and not one fixed seed for everyone', () => {
    const seen = new Set();
    for (let i = 0; i < 50; i++) {
      const s = randomSeed();
      expect(s).toMatch(/^[A-HJ-NP-Z2-9]{6}$/);
      seen.add(s);
    }
    expect(seen.size).toBeGreaterThan(45);
    expect(fs.readFileSync('src/ui/Format.js', 'utf8')).not.toMatch(/Math\.random/);
  });
});
