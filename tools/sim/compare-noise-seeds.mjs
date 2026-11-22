/** Local JSON input adapter; writes a descriptive report to stdout only. */
import { constants, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { MAX_PANEL_BYTES } from './daily-shortlist.js';
import { compareNoiseSensitivity, MIN_NOISE_PANELS, MAX_NOISE_PANELS } from './noise-seed-sensitivity.js';

const USAGE = 'Usage: node tools/sim/compare-noise-seeds.mjs --build FULL_GIT_COMMIT --panel FILE --panel FILE [--panel FILE …]';

function parseArgs(args) {
  const paths = [];
  let buildCommit;
  for (let i = 0; i < args.length; i += 2) {
    const [key, value] = args.slice(i, i + 2);
    if (!value || value.startsWith('--')) throw new Error(USAGE);
    if (key === '--panel') paths.push(value);
    else if (key === '--build' && buildCommit === undefined) buildCommit = value;
    else throw new Error(USAGE);
  }
  if (paths.length < MIN_NOISE_PANELS || paths.length > MAX_NOISE_PANELS) {
    throw new Error(`Provide ${MIN_NOISE_PANELS}–${MAX_NOISE_PANELS} --panel files. ${USAGE}`);
  }
  if (!buildCommit || !/^[a-f\d]{40}$/i.test(buildCommit)) {
    throw new Error('Provide a full 40-hex Git commit for the common producing build');
  }
  return { paths, buildCommit };
}

function readPanel(path, index) {
  const at = `Panel ${index + 1}`;
  let fd, stat;
  // A FIFO must never block the CLI; accept only a regular local file after opening it.
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK); }
  catch { throw new Error(`${at}: could not open a local panel file`); }
  try {
    try { stat = fstatSync(fd); }
    catch { throw new Error(`${at}: could not inspect a local panel file`); }
    if (!stat.isFile()) throw new Error(`${at}: use a regular local panel file`);
    if (stat.size > MAX_PANEL_BYTES) throw new Error(`${at}: exceeds the 4 MiB panel limit`);
    const buffer = Buffer.alloc(MAX_PANEL_BYTES + 1);
    let size = 0;
    // Keep the bound even if the file grows between the size check and the read.
    try {
      while (size < buffer.length) {
        const count = readSync(fd, buffer, size, buffer.length - size, size);
        if (count === 0) break;
        size += count;
      }
    } catch { throw new Error(`${at}: could not read a local panel file`); }
    if (size > MAX_PANEL_BYTES) throw new Error(`${at}: exceeds the 4 MiB panel limit`);
    return buffer.subarray(0, size);
  } finally { closeSync(fd); }
}

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(`${USAGE}\n`);
  } else {
    const { paths, buildCommit } = parseArgs(args);
    const report = compareNoiseSensitivity(paths.map(readPanel), { buildCommit });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`Noise seed sensitivity: ${error.message}\n`);
  process.exitCode = 1;
}
