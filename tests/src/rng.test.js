import { Rng, xxHash32, hashInts } from '../../src/systems/Rng.js';

describe('xxHash32', () => {
  test('matches reference vectors', () => {
    expect(xxHash32('')).toBe(0x02cc5d05);
    expect(xxHash32('a')).toBe(0x550d7456);
    expect(xxHash32('abc')).toBe(0x32d153ff);
    expect(xxHash32('Nobody inspects the spammish repetition')).toBe(0xe2293b2f);
  });

  test('seed parameter changes the hash and result is unsigned 32-bit', () => {
    const a = xxHash32('bitstream', 0);
    const b = xxHash32('bitstream', 1);
    expect(a).not.toBe(b);
    for (const v of [a, b]) {
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(2 ** 32);
    }
  });

  test('handles long and non-ASCII input deterministically', () => {
    const s = 'sled-é中🚀-'.repeat(20);
    expect(xxHash32(s)).toBe(xxHash32(s));
    expect(xxHash32(s)).not.toBe(xxHash32(s + 'x'));
  });

  test('hashInts is deterministic and scrambles', () => {
    expect(hashInts(1, 2)).toBe(hashInts(1, 2));
    expect(hashInts(1, 2)).not.toBe(hashInts(2, 1));
  });
});

describe('Rng', () => {
  const take = (r, n) => Array.from({ length: n }, () => r.next());

  test('same seed => identical sequence', () => {
    expect(take(new Rng('hello'), 200)).toEqual(take(new Rng('hello'), 200));
  });

  test('different seeds differ', () => {
    expect(take(new Rng('hello'), 20)).not.toEqual(take(new Rng('hellp'), 20));
  });

  test('next() is in [0,1) and roughly uniform', () => {
    const r = new Rng('uniform');
    let sum = 0;
    const buckets = new Array(10).fill(0);
    const N = 20000;
    for (let i = 0; i < N; i++) {
      const v = r.next();
      if (v < 0 || v >= 1) throw new Error('out of range ' + v);
      sum += v;
      buckets[Math.floor(v * 10)]++;
    }
    expect(sum / N).toBeGreaterThan(0.48);
    expect(sum / N).toBeLessThan(0.52);
    buckets.forEach((b) => expect(b).toBeGreaterThan(N / 10 - 300));
  });

  test('int/range/chance/pick behave', () => {
    const r = new Rng('helpers');
    for (let i = 0; i < 500; i++) {
      const n = r.int(3, 7);
      expect(n).toBeGreaterThanOrEqual(3);
      expect(n).toBeLessThanOrEqual(7);
      expect(Number.isInteger(n)).toBe(true);
      const f = r.range(-2, 5);
      expect(f).toBeGreaterThanOrEqual(-2);
      expect(f).toBeLessThan(5);
    }
    expect(r.chance(0)).toBe(false);
    expect(r.chance(1.0001)).toBe(true);
    const seen = new Set();
    for (let i = 0; i < 200; i++) seen.add(r.pick(['a', 'b', 'c']));
    expect(seen.size).toBe(3);
  });

  test('weighted respects weights, skips zeros, handles empty', () => {
    const r = new Rng('weights');
    const items = [{ k: 'a', w: 1 }, { k: 'b', w: 9 }, { k: 'z', w: 0 }];
    const counts = { a: 0, b: 0, z: 0 };
    for (let i = 0; i < 5000; i++) counts[r.weighted(items, (x) => x.w).k]++;
    expect(counts.z).toBe(0);
    expect(counts.b / counts.a).toBeGreaterThan(6);
    expect(r.weighted([], () => 1)).toBeUndefined();
    expect(r.weighted(items, () => 0)).toBeUndefined();
  });

  test('fork: deterministic, independent of consumption, independent streams', () => {
    const a = new Rng('seed');
    const f1 = a.fork('terrain');
    take(a, 50); // consuming the parent must not change forks
    const f2 = a.fork('terrain');
    expect(take(f1, 10)).toEqual(take(f2, 10));
    expect(take(a.fork('terrain'), 10)).not.toEqual(take(a.fork('glitch'), 10));
    // consuming one fork does not shift another
    const g1 = new Rng('seed').fork('glitch');
    const t = new Rng('seed').fork('terrain');
    take(t, 1000);
    const g2 = new Rng('seed').fork('glitch');
    expect(take(g1, 10)).toEqual(take(g2, 10));
  });

  test('numeric seeds are used as state directly', () => {
    expect(take(new Rng(42), 5)).toEqual(take(new Rng(42), 5));
    expect(take(new Rng(42), 5)).not.toEqual(take(new Rng(43), 5));
  });
});
