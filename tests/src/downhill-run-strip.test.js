import { TextEncoder } from 'node:util';
import {
  MAX_STRIP_FILE_BYTES, MAX_STRIP_POINTS, MAX_STRIP_POSES, MAX_STRIP_SVG_BYTES, openDownhillRunTrace,
} from '../../src/systems/downhill-run-strip.js';

globalThis.TextEncoder ??= TextEncoder;

function tape(samples, fields = {}) {
  return JSON.stringify({
    format: 'bb-ghost-tape', version: 1, simTickHz: 120,
    trace: Buffer.from(new Float32Array(samples.flat()).buffer).toString('base64'), ...fields,
  });
}

const points = [[100, 320, 0.5], [300, 420, 1], [200, 370, 0], [400, 470, -1]];
const path = (svg) => svg.match(/<path d="(M[\d.]+ [\d.]+ L[\s\d.L]+)" fill="none" stroke="url\(#trace\)"/)[1];
const vertices = (svg) => path(svg).split(' ').filter((x) => /^[ML]/.test(x)).length;

describe('Downhill Run Strip', () => {
  test('retains the actual decoded coordinates with v1 nominal sample ticks, not header endpoints', () => {
    const trace = openDownhillRunTrace(tape(points, { endTick: 17, cause: 'crash' }));
    expect(trace.count).toBe(4);
    expect(trace.sample(0)).toEqual({ x: 100, y: 320, tick: 4, nominalSeconds: 4 / 120 });
    expect(trace.sample(3)).toEqual({ x: 400, y: 470, tick: 16, nominalSeconds: 16 / 120 });
    expect(trace.render()).toContain('Trace start - sample 1');
    expect(trace.render()).toContain('Trace end - sample 4');
    expect(trace.render()).not.toContain('crash');
  });

  test('keeps backward X motion, positive Y down and equal geometric scale', () => {
    const svg = openDownhillRunTrace(tape(points)).render();
    expect(path(svg)).toBe('M382 127 L672.67 272.33 L527.33 199.67 L818 345');
    const translated = points.map(([x, y, angle]) => [x + 11000, y - 7000, angle]);
    expect(openDownhillRunTrace(tape(translated)).render()).toBe(svg);
  });

  test('fits the selected interval independently and distinguishes section from trace boundaries', () => {
    const trace = openDownhillRunTrace(tape(points));
    const svg = trace.render({ start: 1, end: 2 });
    expect(svg).toContain('samples 2 through 3 of 4');
    expect(svg).toContain('Section start - sample 2');
    expect(svg).toContain('Section end - sample 3');
    expect(path(svg)).toBe('M818 345 L382 127');
    expect(trace.render({ start: 0, end: 2 })).toContain('Trace start - sample 1');
    expect(trace.render({ start: 1, end: 3 })).toContain('Trace end - sample 4');
    expect(trace.render({ start: 1, end: 2, selected: 1 })).toContain('stroke="#ffc977"');
    expect(svg).not.toContain('stroke="#ffc977"');
  });

  test('bounds the overview but includes endpoints and extrema; detailed sections show each sample', () => {
    const samples = Array.from({ length: MAX_STRIP_POSES }, (_, i) => [i, i % 101, 0]);
    samples[3333] = [1000, -50000, 0];
    samples[4444] = [50000, 90000, 0];
    const trace = openDownhillRunTrace(tape(samples));
    const svg = trace.render();
    expect(vertices(svg)).toBeLessThanOrEqual(MAX_STRIP_POINTS);
    expect(svg.length).toBeLessThan(MAX_STRIP_SVG_BYTES);
    expect(svg).toContain(`${vertices(svg)} of 32768 window poses shown`);
    expect(svg).toContain('Trace end - sample 32768');
    expect(path(svg)).toMatch(/(?:^| )L[\d.]+ 127 /);
    expect(path(svg)).toMatch(/(?:^| )L[\d.]+ 345 /);
    expect(vertices(trace.render({ start: 3332, end: 3334 }))).toBe(3);
  });

  test.each([
    [[[4, 1, 0], [4, 5, 0]], 'M600 127 L600 345'],
    [[[1, 4, 0], [5, 4, 0]], 'M64 236 L1136 236'],
    [[[1, 4, 0], [1, 4, 0]], 'M600 236 L600 236'],
    [[[0, 0, 0], [2 ** -149, 2 ** -149, 0]], 'M491 127 L709 345'],
  ])('keeps constant, degenerate and tiny axes finite', (samples, expected) => {
    expect(path(openDownhillRunTrace(tape(samples)).render())).toBe(expected);
  });

  test('exports deterministic static geometry and never embeds arbitrary header fields or payload', () => {
    const malicious = '<script>bad</script><a href="https://invalid.example">';
    const plain = openDownhillRunTrace(tape(points)).render();
    const modified = openDownhillRunTrace(tape(points, {
      runId: malicious, seed: 'private-seed', initials: 'XYZ', score: 1234567,
      inputs: ['raw-input'], checkpoints: ['raw-checkpoint'], verification: 'trusted',
      traceMarker: 'raw-trace', physicsVersion: 999,
    })).render();
    expect(modified).toBe(plain);
    expect(modified).toContain('LOCAL / UNVERIFIED');
    expect(modified).not.toMatch(/<script|<a |href=|foreignObject|onload=|trusted|private-seed|raw-input|raw-checkpoint|XYZ|1234567/);
    expect(modified).not.toContain(JSON.parse(tape(points)).trace);
  });

  test.each([
    'invalid JSON',
    '{}',
    'null',
    tape(points, { version: 2 }),
    tape(points, { simTickHz: 60 }),
    tape(points, { trace: 'A'.repeat(33) }),
    tape(points, { trace: `${'A'.repeat(31)}=` }),
    tape(points, { trace: `${'A'.repeat(31)}_` }),
    tape(points, { trace: 'A'.repeat(16 * (MAX_STRIP_POSES + 1)) }),
    tape([[1, 2, 0]]),
    tape([[1, 2, 0], [3, 4, Infinity]]),
    tape([[1, 2, 0], [3, NaN, 0]]),
    tape([[1, 2, 0], [1e20, 4, 0]]),
    'é'.repeat(MAX_STRIP_FILE_BYTES / 2 + 1),
  ])('rejects malformed, incompatible or excessive inputs without echoing file data', (json) => {
    expect(() => openDownhillRunTrace(json)).toThrow(/^(Expected|Could not read|GhostTape poses|Use one)/);
  });

  test('rejects invalid windows and selected indices', () => {
    const trace = openDownhillRunTrace(tape(points));
    for (const window of [{ start: -1 }, { start: 1.5 }, { start: 2, end: 2 }, { end: 4 },
      { start: 1, selected: 0 }, { selected: 4 }]) {
      expect(() => trace.render(window)).toThrow(/Choose a section/);
    }
    expect(() => trace.sample(1.1)).toThrow(/Choose a recorded sample/);
  });
});
