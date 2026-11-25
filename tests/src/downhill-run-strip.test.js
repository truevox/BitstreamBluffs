import { readFileSync } from 'node:fs';
import { TextDecoder, TextEncoder } from 'node:util';
import { jest } from '@jest/globals';
import {
  MAX_STRIP_FILE_BYTES, MAX_STRIP_POINTS, MAX_STRIP_POSES, MAX_STRIP_SVG_BYTES, openDownhillRunTrace,
} from '../../src/systems/downhill-run-strip.js';
import { renderRunTraceArt } from '../../src/systems/run-trace-art.js';

globalThis.TextEncoder ??= TextEncoder;
globalThis.TextDecoder ??= TextDecoder;

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

  test('locates only recorded poses, prefers the earlier pose on ties, and ignores tape endpoints', () => {
    const trace = openDownhillRunTrace(tape(points, { endTick: 209, cause: 'crash' }));
    for (const [request, index, tick, exact] of [
      [4, 0, 4, true], [5, 0, 4, false], [6, 0, 4, false], [7, 1, 8, false],
      [8, 1, 8, true], [14, 2, 12, false], [16, 3, 16, true],
    ]) expect(trace.locateTick(request)).toEqual({ index, tick, exact });
    for (const request of ['', '8', NaN, Infinity, 3, 16.5, 17, 209]) {
      expect(() => trace.locateTick(request)).toThrow('Choose a whole tick from 4 to 16');
    }
  });

  test('can locate a pose that was omitted from the decimated default SVG', () => {
    const rows = Array.from({ length: 1532 }, (_, i) => [i, 0, 0]);
    rows[2][1] = 60; rows[3][1] = 40; rows[5][1] = -60;
    const trace = openDownhillRunTrace(tape(rows));
    const {index} = trace.locateTick(16);
    const svg = trace.render();
    expect(index).toBe(3);
    expect(vertices(trace.render({ selected: index }))).toBe(vertices(svg) + 1);
    expect(trace.render()).toBe(svg);
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

  test('keeps a non-extremal cursor on the overview line without changing the exported section', () => {
    const rows = Array.from({ length: 1532 }, (_, i) => [i, 0, 0]);
    // All four points below are in the first decimation bucket. Sample 4 is
    // neither a bucket extreme nor collinear with the retained path.
    for (const [index, y] of [[2, 60], [3, 40], [4, 40], [5, -60]]) rows[index][1] = y;
    const trace = openDownhillRunTrace(tape(rows));
    const withoutCursor = trace.render();
    const preview = trace.render({ selected: 3 });
    const [, x, y] = preview.match(/<circle cx="([\d.]+)" cy="([\d.]+)" r="13"/);
    expect(path(preview)).toContain(` L${x} ${y} `);
    expect(path(withoutCursor)).not.toContain(` L${x} ${y} `);
    expect(path(preview).replace(` L${x} ${y}`, '')).toBe(path(withoutCursor));
    expect(vertices(preview)).toBe(vertices(withoutCursor) + 1);
    expect(vertices(preview)).toBeLessThanOrEqual(MAX_STRIP_POINTS);
    expect(vertices(trace.render({ selected: 2 }))).toBe(vertices(withoutCursor));
    expect(vertices(trace.render({ selected: 1531 }))).toBe(vertices(withoutCursor));
    expect(trace.render()).toBe(withoutCursor);
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

  test('art preview uses the exact full decoded poses, not section or input metadata', () => {
    const noisy = tape(points, { seed: 'private-seed', runId: '<script>bad</script>', inputs: ['raw-input'], score: 1234567 });
    const trace = openDownhillRunTrace(noisy);
    const svg = renderRunTraceArt(new Float32Array(points.flat()));
    expect(trace.renderArt()).toBe(svg);
    expect(trace.renderArt()).not.toMatch(/private-seed|<script|raw-input|1234567/);
    expect(trace.renderArt()).toContain('LOCAL / UNVERIFIED');
    const section = trace.render({ start: 1, end: 2 });
    expect(section).toBe(openDownhillRunTrace(tape(points)).render({ start: 1, end: 2 }));
    expect(trace.renderArt()).toBe(svg);
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

test('file changes clear artwork immediately; stale reads cannot replace the current preview', async () => {
  const html = readFileSync(new URL('../../tools/downhill-run-strip.html', import.meta.url), 'utf8');
  document.body.replaceChildren(...new DOMParser().parseFromString(html, 'text/html').body.childNodes);
  const image = document.getElementById('run-art'), frame = document.getElementById('run-art-frame');
  const input = document.getElementById('tape'), status = document.getElementById('load-status');
  const tick = document.getElementById('jump-tick'), tickStatus = document.getElementById('tick-status');
  const submitTick = (value) => {
    tick.value = value;
    document.getElementById('tick-form').dispatchEvent(new Event('submit', { cancelable: true }));
  };
  const methods = ['createObjectURL', 'revokeObjectURL'];
  const saved = methods.map((name) => Object.getOwnPropertyDescriptor(URL, name));
  let sequence = 0;
  const createObjectURL = jest.fn(() => `blob:http://localhost/${++sequence}`);
  const revokeObjectURL = jest.fn();
  Object.defineProperties(URL, {
    createObjectURL: { configurable: true, value: createObjectURL },
    revokeObjectURL: { configurable: true, value: revokeObjectURL },
  });
  const buffer = (text) => new TextEncoder().encode(text).buffer;
  const file = (text) => ({ size: text.length, arrayBuffer: async () => buffer(text) });
  const select = (value) => {
    Object.defineProperty(input, 'files', { configurable: true, value: value ? [value] : [] });
    input.dispatchEvent(new Event('change'));
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  try {
    await import('../../tools/downhill-run-strip.js');
    select(file(tape(points)));
    await settle();
    const first = image.getAttribute('src');
    expect(first).toMatch(/^blob:/);
    expect(frame.hidden).toBe(false);
    expect(document.querySelector('svg')).toBeNull();
    expect(createObjectURL.mock.calls.at(-1)[0].type).toBe('image/svg+xml');
    document.getElementById('zoom-in').click();
    expect(image.getAttribute('src')).toBe(first);
    expect(tick.max).toBe('16');
    submitTick('6');
    expect(tickStatus.textContent).toBe('No stored pose at tick 6; showing the closest one at tick 4.');
    submitTick('16');
    expect(tickStatus.textContent).toBe('Showing stored pose at tick 16. Reopened the full trace.');
    expect(document.getElementById('sample').value).toBe('4');
    expect(document.getElementById('pose').textContent).toContain('X 400 · Y 470');
    submitTick('17');
    expect(tick.getAttribute('aria-invalid')).toBe('true');
    expect(tickStatus.textContent).toBe('Choose a whole tick from 4 to 16');
    expect(document.getElementById('sample').value).toBe('4');
    expect(image.getAttribute('src')).toBe(first);

    let finishSlow;
    select({ size: 1, arrayBuffer: () => new Promise((resolve) => { finishSlow = resolve; }) });
    expect(frame.hidden).toBe(true);
    expect(tick.value).toBe('');
    expect(tickStatus.textContent).toBe('');
    expect(tick.hasAttribute('aria-invalid')).toBe(false);
    expect(image.hasAttribute('src')).toBe(false);
    expect(revokeObjectURL).toHaveBeenCalledWith(first);
    select(file(tape(points.slice(0, 2))));
    await settle();
    const second = image.getAttribute('src');
    expect(second).toMatch(/^blob:/);
    expect(second).not.toBe(first);
    finishSlow(buffer(tape(points)));
    await settle();
    expect(image.getAttribute('src')).toBe(second);
    expect(status.textContent).toContain('Opened 2 recorded poses');
    expect(tick.max).toBe('8');

    select(file('not valid JSON'));
    await settle();
    expect(status.textContent).toBe('Could not read GhostTape JSON');
    expect(image.hasAttribute('src')).toBe(false);
    expect(frame.hidden).toBe(true);
    expect(revokeObjectURL).toHaveBeenCalledWith(second);
    select(null);
    expect(status.textContent).toBe('');
    expect(image.hasAttribute('src')).toBe(false);
  } finally {
    for (const [i, name] of methods.entries()) {
      if (saved[i]) Object.defineProperty(URL, name, saved[i]);
      else delete URL[name];
    }
    document.body.replaceChildren();
  }
});
