// Shared helpers for the manifest/evidence tests (not a test file). Deterministic; reads only committed fixtures.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalBytes } from '../../src/systems/replay/canonicalJson.js';
import { digestOf } from '../../src/systems/replay/canonicalSha256.js';
import { buildManifest } from '../../src/systems/replay/manifest.js';

const DIR = path.resolve('tests/fixtures/replay/v1');
export const readJson = (name) => JSON.parse(fs.readFileSync(path.join(DIR, name), 'utf8'));
export const readText = (name) => fs.readFileSync(path.join(DIR, name), 'utf8');
export const clone = (v) => JSON.parse(JSON.stringify(v));

/** The spec 8.3 tape: a real-format tape from the pre-fix recorder (no edgeRows, no syncLevel). */
export const legacyTape = () => readJson('legacy-tape.json');
/** The illustrative ruleset of spec 7.1 (digest sha256:7567d9ac...). */
export const ruleset = () => readJson('ruleset-illustrative.json');
export const rulesetOf = (rs) => (id) => (id === digestOf(rs) ? rs : null);

export const SCHEMAS = Object.fromEntries(['bsod', 'clock', 'effects', 'hazards', 'kodiak', 'matter', 'pickups', 'recovery', 'rng',
  'score', 'sled', 'terrain', 'tricks'].map((k) => [k, 1]));

/** The same tape with the header fields RunScene._ghostHeader writes today (spec 8.2 inputs). */
export const liveTape = (over = {}) => ({
  ...legacyTape(), edgeRows: 'every-tick', syncLevel: 1, dailyRuleSource: 'clock-at-start',
  bsod: { leftEdgeX: 41.5, initial: { wallX: -7558.5, wallSpeedPxS: 115, accelerationPxS2: 1.15 } }, ...over,
});

export function liveManifest({ tape = liveTape(), rs = ruleset(), checkpoints = { algo: 'xxh32x2', detail: 'combined', schemas: SCHEMAS } } = {}) {
  return buildManifest({ tape, ruleset: { rulesetId: digestOf(rs), simRevision: rs.simRevision, engine: { phaser: rs.engine.phaser, matter: rs.engine.matter } },
    checkpoints, gameVersion: '2.15.1' });
}

/** Validate a mutated copy of an object manifest. */
export const bytesOf = (obj) => canonicalBytes(obj);
