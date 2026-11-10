import { GlitchDirector, glitchGapRange, glitchRamp } from '../../../src/systems/GlitchDirector.js';
import { GLITCH } from '../../../src/constants.js';

function run(seed, seconds, dist = () => 0) {
  const d = new GlitchDirector({ seed });
  const starts = [];
  const ends = [];
  for (let t = 0; t <= seconds * 1000; t += 16) {
    const r = d.update(t, dist(t));
    r.started.forEach((e) => starts.push({ ...e, at: t }));
    r.ended.forEach((e) => ends.push({ id: e.id, at: t }));
  }
  return { starts, ends };
}

describe('GlitchDirector', () => {
  test('same seed => identical schedule, different seed => different', () => {
    const a = run('abc', 120);
    const b = run('abc', 120);
    const c = run('abd', 120);
    expect(a.starts.map((e) => [e.id, e.kind, e.startMs, e.durationMs, e.intensity])).toEqual(
      b.starts.map((e) => [e.id, e.kind, e.startMs, e.durationMs, e.intensity]));
    expect(a.starts.length).toBeGreaterThan(5);
    expect(c.starts.map((e) => e.startMs)).not.toEqual(a.starts.map((e) => e.startMs));
  });

  test('schedule is independent of the update cadence', () => {
    const d1 = new GlitchDirector({ seed: 's1' });
    const d2 = new GlitchDirector({ seed: 's1' });
    const s1 = [];
    const s2 = [];
    for (let t = 0; t < 90000; t += 7) d1.update(t, 0).started.forEach((e) => s1.push(e.id + e.startMs));
    for (let t = 0; t < 90000; t += 40) d2.update(t, 0).started.forEach((e) => s2.push(e.id + e.startMs));
    expect(s1).toEqual(s2);
  });

  test('early gaps 5-15 s, durations 50-200 ms, intensity 0..1, valid kinds', () => {
    const { starts } = run('gaps', 600);
    let prevEnd = 0;
    for (const e of starts) {
      const gap = e.startMs - prevEnd;
      expect(gap).toBeGreaterThanOrEqual(GLITCH.earlyGapMs[0] - 1);
      expect(gap).toBeLessThanOrEqual(GLITCH.earlyGapMs[1] + 1);
      expect(e.durationMs).toBeGreaterThanOrEqual(GLITCH.durationMs[0]);
      expect(e.durationMs).toBeLessThanOrEqual(GLITCH.durationMs[1]);
      expect(e.intensity).toBeGreaterThan(0);
      expect(e.intensity).toBeLessThanOrEqual(1);
      expect(GLITCH.kinds).toContain(e.kind);
      prevEnd = e.startMs + e.durationMs;
    }
  });

  test('past 1000 m gaps tighten to 3-6 s', () => {
    expect(glitchRamp(0)).toBe(0);
    expect(glitchRamp(1000)).toBe(1);
    expect(glitchGapRange(1500)).toEqual([...GLITCH.lateGapMs]);
    const { starts } = run('late', 300, () => 1500);
    // the first event was drawn at distance 0; later ones use the late range
    for (let i = 2; i < starts.length; i++) {
      const gap = starts[i].startMs - (starts[i - 1].startMs + starts[i - 1].durationMs);
      expect(gap).toBeGreaterThanOrEqual(3000 - 1);
      expect(gap).toBeLessThanOrEqual(6000 + 1);
    }
  });

  test('started/ended pair up; active reflects state; reset replays', () => {
    const { starts, ends } = run('pairs', 100);
    expect(starts.length).toBeGreaterThanOrEqual(ends.length);
    expect(starts.length - ends.length).toBeLessThanOrEqual(1);
    const d = new GlitchDirector({ seed: 'pairs' });
    const first = d.preview(1)[0];
    const r = d.update(first.startMs + 1, 0);
    expect(r.started[0].id).toBe(first.id);
    expect(r.active.id).toBe(first.id);
    const r2 = d.update(first.startMs + first.durationMs + 1, 0);
    expect(r2.ended[0].id).toBe(first.id);
    expect(r2.active).toBeNull();
    d.reset();
    expect(d.update(first.startMs + 1, 0).started[0].id).toBe(first.id);
  });

  test('a huge time jump starts and ends events without looping forever', () => {
    const d = new GlitchDirector({ seed: 'jump' });
    const r = d.update(10 * 60 * 1000, 0);
    expect(r.started.length).toBeGreaterThan(0);
    expect(r.started.length).toBeLessThanOrEqual(64);
  });
});
