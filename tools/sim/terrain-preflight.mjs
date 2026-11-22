/** Offline Node entry point; uses the production generator and checked-out JSON. */
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { TerrainGenerator } from '../../src/systems/TerrainGenerator.js';
import { DEFAULT_ORIGIN_CHUNKS, scanBlindClearance, validateOriginWindow } from './terrain-preflight.js';

const root = new URL('../../', import.meta.url);
const GROUPS = ['biomes', 'chunks', 'hazards', 'powerups', 'terrainMods'];
const GENERATOR_FILES = ['src/constants.js', 'src/systems/HazardMotion.js', 'src/systems/Rng.js', 'src/systems/TerrainGenerator.js'];
const USAGE = 'Usage: node tools/sim/terrain-preflight.mjs --seed SEED --mask UINT32 [--from-chunk INDEX] [--chunks COUNT]';

function parseArgs(args) {
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const [key, value] = args.slice(i, i + 2);
    if (!['--seed', '--mask', '--from-chunk', '--chunks'].includes(key) || options.has(key) || !value) {
      throw new TypeError(USAGE);
    }
    options.set(key, value);
  }
  const seed = options.get('--seed');
  if (typeof seed !== 'string' || !seed.trim() || seed.length > 64 || /[\p{Cc}\p{Cf}]/u.test(seed)) {
    throw new TypeError('Provide a seed of 1–64 characters without control characters');
  }
  const readInt = (key, fallback) => {
    if (!options.has(key) && fallback !== undefined) return fallback;
    const value = options.get(key);
    if (!/^\d{1,10}$/.test(value ?? '')) throw new TypeError(`Use a decimal integer for ${key}`);
    return Number(value);
  };
  const biomeMask = readInt('--mask');
  if (biomeMask > 0xffffffff) throw new RangeError('Mask must be an unsigned 32-bit value');
  const fromChunk = readInt('--from-chunk', 0), chunkCount = readInt('--chunks', DEFAULT_ORIGIN_CHUNKS);
  validateOriginWindow(fromChunk, chunkCount);
  return { seed, biomeMask, fromChunk, chunkCount };
}

function loadInputs() {
  // Match the five production loadContent() direct JSON globs; the generator sorts defs by id.
  const sources = new Map(GENERATOR_FILES.map((file) => [file, readFileSync(new URL(file, root))]));
  const content = Object.fromEntries(GROUPS.map((group) => {
    const dir = `src/data/${group}/`;
    const names = readdirSync(new URL(dir, root), { withFileTypes: true })
      .filter(({ name }) => name.endsWith('.json')).map((entry) => {
        if (!entry.isFile()) throw new Error(`Expected regular JSON definitions in ${group}`);
        return entry.name;
      }).sort();
    const ids = new Set();
    const data = names.map((name) => {
      const path = `${dir}${name}`;
      const bytes = readFileSync(new URL(path, root));
      sources.set(path, bytes);
      const definition = JSON.parse(bytes.toString('utf8'));
      if (typeof definition?.id !== 'string' || !definition.id || ids.has(definition.id)) {
        throw new Error(`Invalid or duplicate definition id in ${group}`);
      }
      ids.add(definition.id);
      return definition;
    });
    if (!data.length) throw new Error(`No geometry content in ${group}`);
    return [group, data];
  }));
  const algorithm = 'sha256-framed-relative-path-file-bytes-v1';
  const digest = createHash('sha256').update(`bitstream-terrain-preflight-inputs-v1\0`);
  for (const path of [...sources.keys()].sort()) {
    const bytes = sources.get(path);
    digest.update(`${path}\0${bytes.length}\0`).update(bytes);
  }
  return { content, provenance: { algorithm, sha256: digest.digest('hex'), files: sources.size,
    generatorFiles: GENERATOR_FILES, contentGlobs: GROUPS.map((group) => `src/data/${group}/*.json`) } };
}

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(`${USAGE}\n`);
  } else {
    const { seed, biomeMask, fromChunk, chunkCount } = parseArgs(args);
    const { content, provenance } = loadInputs();
    const terrain = new TerrainGenerator({ seed, biomeMask, chunkDefs: content.chunks,
      hazardDefs: content.hazards, powerupDefs: content.powerups, modDefs: content.terrainMods, biomeDefs: content.biomes });
    const hazardDefs = Object.fromEntries(content.hazards.map((def) => [def.id, def]));
    const result = scanBlindClearance(terrain, hazardDefs, { fromChunk, chunkCount });
    process.stdout.write(`${JSON.stringify({ ...result, provenance }, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`Terrain preflight: ${error.message}\n`);
  process.exitCode = 1;
}
