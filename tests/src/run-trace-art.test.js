import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MAX_ART_POSES, MAX_ART_SVG_BYTES, RUN_TRACE_ART_VERSION, renderRunTraceArt, renderRunTraceOrientationStudy,
} from '../../src/systems/run-trace-art.js';
import { GhostRecorder, TRACE_EVERY, decodeTrace } from '../../src/systems/ghost/GhostTape.js';

const flat = [[50001, 140009, 0], [51025, 140009, 0.5]];
const curve = [[50001, 140009, 0], [50513, 140169, 0.25], [51025, 140049, 0.5]];
const poses = (rows) => new Float32Array(rows.flat());
const art = (rows) => renderRunTraceArt(poses(rows));

function tapeOf(rows, header = {}) {
  const recorder = new GhostRecorder(header);
  rows.forEach(([x, y, angle], index) => {
    recorder.afterTick((index + 1) * TRACE_EVERY, {
      sled: { body: { position: { x, y }, angle, velocity: { x: 0, y: 0 }, angularVelocity: 0 } },
    });
  });
  return recorder.finish({ runId: 'PRIVATE-RUN-ID', distanceM: 812345, score: 987654, endedAt: 1795284763551 });
}

function parseSvg(markup) {
  const doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  expect(doc.querySelector('parsererror')).toBeNull();
  expect(doc.documentElement.namespaceURI).toBe('http://www.w3.org/2000/svg');
  return doc;
}

test('identical trace bytes recreate identical art; different recorded paths change geometry', () => {
  const tape = tapeOf(curve);
  const svg = renderRunTraceArt(decodeTrace(tape));
  expect(renderRunTraceArt(decodeTrace(tapeOf(curve)))).toBe(svg);
  expect(svg).toContain(`ART V${RUN_TRACE_ART_VERSION}`);
  expect(parseSvg(svg).querySelector('text[letter-spacing="1.3"]').textContent).toBe('LOCAL / UNVERIFIED');
  const a = parseSvg(svg).querySelector('path[stroke-width="4"]').getAttribute('d');
  const b = parseSvg(art(flat)).querySelector('path[stroke-width="4"]').getAttribute('d');
  expect(a).not.toBe(b);
  expect(a.match(/[ML]/g)).toHaveLength(64);
  expect(b.match(/[ML]/g)).toHaveLength(64);
  expect(svg).not.toMatch(/50001|51025|140009|140169/);
});

test('loses world origin and scale, and resamples an equivalent shape consistently', () => {
  const shifted = curve.map(([x, y, angle]) => [x + 3_000_000, y + 1_000_000, -angle]);
  const scaled = curve.map(([x, y, angle]) => [x * 2, y * 3, angle]);
  const interpolatedFlat = [flat[0], [50513, 140009, 0], flat[1]];
  expect(art(shifted)).toBe(art(curve));
  expect(art(scaled)).toBe(art(curve));
  expect(art(interpolatedFlat)).toBe(art(flat));
  const center = parseSvg(art([[7, 8, 0], [7, 8, 0]])).querySelector('path[stroke-width="4"]');
  expect(center.getAttribute('d')).toMatch(/^M480 364(?: L480 364){63}$/);
  // A trace with one flat axis has an empty object bounding box for paint.
  expect(parseSvg(art(flat)).querySelector('#ion').getAttribute('gradientUnits')).toBe('userSpaceOnUse');
});

test.each([['V1', renderRunTraceArt], ['V2', renderRunTraceOrientationStudy]])(
  '%s emits only inert SVG markup and local paint references, within its ASCII byte cap', (_version, render) => {
    const svg = render(poses(curve));
    expect(Buffer.byteLength(svg)).toBeLessThanOrEqual(MAX_ART_SVG_BYTES);
    const doc = parseSvg(svg);
    const allowed = ['svg', 'title', 'desc', 'defs', 'linearGradient', 'radialGradient', 'stop',
      'rect', 'ellipse', 'path', 'g', 'circle', 'text'];
    for (const el of doc.querySelectorAll('*')) {
      expect(allowed).toContain(el.localName);
      for (const attr of el.attributes) {
        expect(attr.name).not.toMatch(/^(?:on|href|src|style)/i);
        if (attr.name !== 'xmlns' && attr.value.includes('url(')) {
          expect(attr.value).toMatch(/^url\(#[a-z]+\)$/);
        }
        if (attr.name !== 'xmlns') expect(attr.value).not.toMatch(/https?:|javascript:|data:/i);
      }
    }
    expect(svg).not.toMatch(/<!DOCTYPE|<\?xml-stylesheet/i);
  });

test('validates all finite complete triples, including points skipped by rendering, and bounds work', () => {
  expect(() => renderRunTraceArt([0, 1, 2, 3, 4, 5])).toThrow(/Float32/);
  expect(() => renderRunTraceArt(new Float32Array(7))).toThrow(/complete/);
  expect(() => art([[0, 0, 0]])).toThrow(/2 to/);
  for (const invalid of [Infinity, NaN, -3.4e38]) {
    const input = new Float32Array(32_000 * 3);
    input[17] = invalid;
    expect(() => renderRunTraceArt(input)).toThrow(/finite and within/);
  }
  const maximum = new Float32Array(MAX_ART_POSES * 3);
  expect(Buffer.byteLength(renderRunTraceArt(maximum))).toBeLessThanOrEqual(MAX_ART_SVG_BYTES);
  expect(() => renderRunTraceArt(new Float32Array((MAX_ART_POSES + 1) * 3))).toThrow(/2 to/);
});

function runCli(files, test) {
  const dir = mkdtempSync(join(tmpdir(), 'bb-trace-art-'));
  try {
    for (const [name, data] of Object.entries(files)) writeFileSync(join(dir, name), data);
    test((name, ...options) => spawnSync(process.execPath,
      ['tools/run-trace-art.mjs', ...options, join(dir, name)], { encoding: 'utf8', timeout: 5000 }));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test.each([
  ['V1', renderRunTraceArt, []],
  ['V2', renderRunTraceOrientationStudy, ['--art-v2']],
])('%s CLI writes the same SVG for the real recorder payload and for hostile metadata', (_version, render, options) => {
  const tape = tapeOf(curve, { seed: 'RAW-SEED', initials: 'PLAYER-X', account: '<script>metadata()</script>' });
  const hostile = {
    ...tape, seed: 'malicious.example/other-seed', runId: 'OTHER-RUN-ID',
    initials: '<image href="https://malicious.example/">', email: 'private@example.com',
    inputs: [[1, 4, 9]], checkpoints: [[2, 143599, 732109]], verified: true,
    physicsVersion: 999, simTickHz: 1, endTick: 999999,
  };
  runCli({ 'raw.json': JSON.stringify(tape), 'hostile.json': JSON.stringify(hostile) }, (run) => {
    const raw = run('raw.json', ...options), attack = run('hostile.json', ...options);
    expect(raw.status).toBe(0);
    expect(attack.status).toBe(0);
    expect(raw.stderr).toBe('');
    expect(raw.stdout).toBe(render(poses(curve)));
    expect(attack.stdout).toBe(raw.stdout);
    expect(raw.stdout).not.toMatch(/RAW-SEED|PLAYER-X|PRIVATE-RUN-ID|812345|987654|1795284763551|143599|732109|malicious\.example|private@example\.com|<script|href=/);
    expect(raw.stdout).not.toContain(tape.trace);
  });
});

test.each([['V1', []], ['V2', ['--art-v2']]])(
  '%s CLI rejects partial or invalid encoding, unsupported versions and oversized JSON without SVG output', (_version, options) => {
    const tape = tapeOf(curve);
    const file = (updates) => JSON.stringify({ ...tape, ...updates });
    runCli({
      'version.json': file({ version: 2 }),
      'partial.json': file({ trace: Buffer.concat([Buffer.from(tape.trace, 'base64'), Buffer.from([0])]).toString('base64') }),
      'invalid.json': file({ trace: '?' + tape.trace.slice(1) }),
      'nonfinite.json': JSON.stringify(tapeOf([[0, 0, 0], [NaN, 10, 0]])),
      'too-many-poses.json': file({ trace: 'A'.repeat((MAX_ART_POSES + 1) * 16) }),
      'huge.json': Buffer.alloc(2 * 1024 * 1024 + 1),
    }, (run) => {
      for (const name of ['version.json', 'partial.json', 'invalid.json', 'nonfinite.json', 'too-many-poses.json', 'huge.json']) {
        const result = run(name, ...options);
        expect(result.status).toBe(1);
        expect(result.stdout).toBe('');
        expect(result.stderr).toMatch(/^Trace art:/);
      }
    });
  });


test('defaults to the frozen V1 bytes and ignores orientation unless V2 is explicitly requested', () => {
  const still = curve.map(([x, y]) => [x, y, 0]);
  expect(art(still)).toBe(art(curve));
  expect(createHash('sha256').update(art(curve)).digest('hex'))
    .toBe('ea4554f7982c30c079c6d1da3e17d354e5e08ae5182ca84002bb0bde3fae1fed');
  const render = (rows) => renderRunTraceOrientationStudy(poses(rows));
  const svg = render(curve);
  expect(svg).toBe(render(curve));
  expect(svg).not.toBe(render(still));
  expect(svg).toContain('ART V2');
  expect(svg).toContain('LOCAL / UNVERIFIED');
  expect(svg).toContain('NO ATTESTATION');
  const path = (markup) => parseSvg(markup).querySelector('path[stroke-width="4"]').getAttribute('d');
  expect(path(svg)).toBe(path(art(curve)));
});

test('V2 projects only fixed-size, unsigned wrapped orientation tiers', () => {
  const marks = (rows) => {
    const svg = renderRunTraceOrientationStudy(poses(rows));
    return [...parseSvg(svg).querySelectorAll('g[aria-label="Coarse sampled sled orientation changes"] circle')]
      .map((el) => Number(el.getAttribute('r')));
  };
  const sample = (angle) => [[7, 8, 0], [7, 8, angle]];
  const still = Array(16).fill(2);
  expect(marks(sample(0))).toEqual(still);
  expect(marks([[7, 8, Math.PI - 0.01], [7, 8, -Math.PI + 0.01]])).toEqual(still);
  for (const [angle, radius] of [[0.05, 3], [0.13, 4], [1, 5]]) {
    const expected = [...still];
    expected[8] = radius;
    expect(marks(sample(angle))).toEqual(expected);
    expect(marks(sample(-angle))).toEqual(expected);
  }
  expect(marks([[0, 0, -1e9], [0, 0, 1e9]])).toHaveLength(16);
});

test('V2 validates before quantizing, even for off-path pose components', () => {
  const max = new Float32Array(MAX_ART_POSES * 3);
  expect(Buffer.byteLength(renderRunTraceOrientationStudy(max))).toBeLessThanOrEqual(MAX_ART_SVG_BYTES);
  max[20] = NaN;
  expect(() => renderRunTraceOrientationStudy(max)).toThrow(/finite and within/);
  expect(() => renderRunTraceOrientationStudy(new Float32Array((MAX_ART_POSES + 1) * 3))).toThrow(/2 to/);
});

test('CLI documents V2 and emits no SVG for invalid opt-in arguments or a directory', () => {
  const cli = (...args) => spawnSync(process.execPath, ['tools/run-trace-art.mjs', ...args],
    { encoding: 'utf8', timeout: 5000 });
  const help = cli('--help');
  expect(help.status).toBe(0);
  expect(help.stdout).toMatch(/run-trace-art\.mjs --art-v2 /);
  for (const args of [['--art-v2'], ['--art-v2', '--help'], ['--art-v2', './file', './extra'], ['--art-v2', '.']]) {
    const result = cli(...args);
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^Trace art:/);
  }
});
