/** #236: historical replay tapes may be read, but never accidentally re-recorded. */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { prepareRecordingDirectory, selectTapeDirectory } from '../../tools/conformance/cross-engine-paths.mjs';

const root = path.resolve(import.meta.dirname || path.dirname(new URL(import.meta.url).pathname), '../..');
const historical = path.join(root, 'tools', 'conformance', 'fixtures', 'cross-engine');
const select = (mode, explicit, base = historical) => selectTapeDirectory({ mode, explicit, historical: base });

let sandbox;
let originals;
beforeEach(() => {
  sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'bb-ce-immutable-'));
  fs.mkdirSync(path.join(sandbox, 'legacy'));
  fs.writeFileSync(path.join(sandbox, 'legacy', 'record-meta.json'), 'historical evidence');
  originals = path.join(sandbox, 'legacy');
});
afterEach(() => fs.rmSync(sandbox, { recursive: true, force: true }));

test('record requires explicit absolute NEW output; no historical default', () => {
  expect(() => select('record', undefined, originals)).toThrow(/requires CE_TAPE_DIR/);
  expect(() => select('record', '', originals)).toThrow(/requires CE_TAPE_DIR/);
  expect(() => select('record', 123, originals)).toThrow(/requires CE_TAPE_DIR/);
  expect(() => select('record', 'relative/path', originals)).toThrow(/absolute directory path/);
  expect(() => select('record', originals, originals)).toThrow(/protected historical/);
  expect(() => select('record', path.join(originals, 'rev6'), originals)).toThrow(/protected historical/);
  expect(() => select('record', sandbox, originals)).toThrow(/protected historical/);
});

test('symlinked paths cannot evade historical fixture protection', () => {
  const alias = path.join(sandbox, 'alias');
  fs.symlinkSync(originals, alias);
  expect(() => select('record', alias, originals)).toThrow(/protected historical/);
  expect(() => select('record', path.join(alias, 'revision-6'), originals)).toThrow(/protected historical/);
  // A symlinked parent also cannot redirect a supposedly new output into history.
  const parent = path.join(sandbox, 'parent-link');
  fs.symlinkSync(originals, parent);
  expect(() => select('record', path.join(parent, 'new-subdir'), originals)).toThrow(/protected historical/);
});

test('record atomically creates only a fresh, separate directory and never reuses it', async () => {
  const target = path.join(sandbox, 'revision-six-new');
  expect(select('record', target, originals)).toBe(target);
  await expect(prepareRecordingDirectory(target, originals)).resolves.toBe(target);
  expect(fs.statSync(target).isDirectory()).toBe(true);
  await expect(prepareRecordingDirectory(target, originals)).rejects.toThrow(/already exists/);
  expect(fs.readFileSync(path.join(originals, 'record-meta.json'), 'utf8')).toBe('historical evidence');
});

test('a previously recorded destination cannot be reopened or overwritten', async () => {
  const target = path.join(sandbox, 'existing-recording');
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, 'record-meta.json'), 'evidence v1');
  await expect(prepareRecordingDirectory(target, originals)).rejects.toThrow(/already exists/);
  expect(fs.readFileSync(path.join(target, 'record-meta.json'), 'utf8')).toBe('evidence v1');
});

test('matrix, fresh, positions and default reads resolve the SAME selected tape directory', () => {
  const target = path.join(sandbox, 'new-recording');
  for (const command of ['matrix', 'fresh', 'positions']) {
    expect(select(command, target, originals)).toBe(target);
    expect(select(command, undefined, originals)).toBe(originals);
  }
});

test('real CLI record without CE_TAPE_DIR fails before browser launch and preserves committed tapes', () => {
  const beforeMeta = fs.readFileSync(path.join(historical, 'record-meta.json'));
  const beforeTape = fs.readFileSync(path.join(historical, 'chunk-biome-boundaries.tape.json'));
  const env = { ...process.env };
  delete env.CE_TAPE_DIR;
  const run = spawnSync(process.execPath, [path.join(root, 'tools/conformance/cross-engine.mjs'), 'record'],
    { env, cwd: root, encoding: 'utf8', timeout: 7000 });
  expect(run.status).not.toBe(0);
  expect(run.stderr).toMatch(/record requires CE_TAPE_DIR/);
  expect(run.stderr).not.toMatch(/browserType\.launch|no executable found/);
  expect(fs.readFileSync(path.join(historical, 'record-meta.json'))).toEqual(beforeMeta);
  expect(fs.readFileSync(path.join(historical, 'chunk-biome-boundaries.tape.json'))).toEqual(beforeTape);
});
