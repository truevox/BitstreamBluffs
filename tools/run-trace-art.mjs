/** #87: opt-in local conversion of a saved GhostTape v1 to SVG on stdout. */
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { GHOST_TAPE_FORMAT, decodeTrace } from '../src/systems/ghost/GhostTape.js';
import { MAX_ART_POSES, renderRunTraceArt, renderRunTraceOrientationStudy } from '../src/systems/run-trace-art.js';

const MAX_TAPE_BYTES = 2 * 1024 * 1024;
const TRACE_TAPE_VERSION = 1;
// V1 encodes each [x, y, angle] as exactly three Float32s (12 bytes,
// hence 16 base64 characters without padding). Do not let the decoder's
// trailing-byte truncation accept a partial or noncanonical pose.
const CHARS_PER_POSE = 16;

async function readLocalTape(path) {
  // Nonblocking open also lets us reject a pipe without waiting for its writer.
  const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK).catch(() => {
    throw new Error('Could not open the local tape file');
  });
  try {
    const stat = await file.stat();
    if (!stat.isFile()) throw new TypeError('Use a regular local tape file');
    if (stat.size > MAX_TAPE_BYTES) throw new RangeError('Tape JSON exceeds the 2 MiB local limit');
    const buffer = Buffer.alloc(MAX_TAPE_BYTES + 1);
    // Bound reads even if the file grows since stat.
    let size = 0;
    while (size < buffer.length) {
      const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
      if (!bytesRead) break;
      size += bytesRead;
    }
    if (size > MAX_TAPE_BYTES) throw new RangeError('Tape JSON exceeds the 2 MiB local limit');
    try { return JSON.parse(buffer.toString('utf8', 0, size)); }
    catch { throw new TypeError('Tape file must contain a JSON object'); }
  } finally {
    await file.close();
  }
}

function decodeV1(tape) {
  if (!tape || tape.format !== GHOST_TAPE_FORMAT || tape.version !== TRACE_TAPE_VERSION) {
    throw new TypeError('Expected a GhostTape v1 JSON object');
  }
  const trace = tape.trace;
  if (typeof trace !== 'string' || trace.length < 2 * CHARS_PER_POSE ||
      trace.length > MAX_ART_POSES * CHARS_PER_POSE ||
      trace.length % CHARS_PER_POSE !== 0 || /[^A-Za-z0-9+/]/.test(trace)) {
    throw new TypeError('Expected bounded, complete GhostTape v1 pose encoding');
  }
  const poses = decodeTrace({ trace });
  if (poses.length !== 3 * trace.length / CHARS_PER_POSE) {
    throw new TypeError('Could not decode complete GhostTape v1 poses');
  }
  return poses;
}

async function main([first, ...rest]) {
  if (rest.length === 0 && (first === '--help' || first === '-h')) {
    process.stdout.write('Usage: node tools/run-trace-art.mjs /path/to/ghost-tape.json > run-dna.svg\n');
    process.stdout.write('Opt-in orientation study: node tools/run-trace-art.mjs --art-v2 /path/to/ghost-tape.json > run-dna-v2.svg\n');
    return;
  }
  const orientationStudy = first === '--art-v2';
  const paths = orientationStudy ? rest : [first, ...rest];
  if (paths.length !== 1 || !paths[0] ||
      (orientationStudy && paths[0].startsWith('-'))) {
    throw new TypeError('Provide exactly one local GhostTape v1 JSON file');
  }
  const poses = decodeV1(await readLocalTape(paths[0]));
  const render = orientationStudy ? renderRunTraceOrientationStudy : renderRunTraceArt;
  process.stdout.write(render(poses));
}

main(process.argv.slice(2)).catch((error) => {
  process.stderr.write(`Trace art: ${error.message}\n`);
  process.exitCode = 1;
});
