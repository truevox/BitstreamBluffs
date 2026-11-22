/** Offline adapter for a local #126 panel. Prints JSON only; makes no external changes. */
import { createHash } from 'node:crypto';
import { constants, openSync, fstatSync, readSync, closeSync } from 'node:fs';
import { TextDecoder } from 'node:util';
import { createDailyShortlist, MAX_PANEL_BYTES } from './daily-shortlist.js';

const USAGE = 'Usage: node tools/sim/shortlist-daily.mjs --panel FILE --build FULL_GIT_COMMIT';

function parseArgs(args) {
  const options = new Map();
  for (let i = 0; i < args.length; i += 2) {
    const [key, value] = args.slice(i, i + 2);
    if (!['--panel', '--build'].includes(key) || options.has(key) || !value || value.startsWith('--')) throw new Error(USAGE);
    options.set(key, value);
  }
  if (options.size !== 2) throw new Error(USAGE);
  return [options.get('--panel'), options.get('--build')];
}

function readPanel(path) {
  let fd;
  try { fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK); }
  catch { throw new Error('Could not open the local panel file'); }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error('Use a regular local panel file');
    if (stat.size > MAX_PANEL_BYTES) throw new Error('Panel exceeds the 4 MiB limit');
    const buffer = Buffer.alloc(MAX_PANEL_BYTES + 1);
    let size = 0;
    while (size < buffer.length) {
      const read = readSync(fd, buffer, size, buffer.length - size, size);
      if (read === 0) break;
      size += read;
    }
    if (size > MAX_PANEL_BYTES) throw new Error('Panel exceeds the 4 MiB limit');
    return buffer.subarray(0, size);
  } finally { closeSync(fd); }
}

try {
  const args = process.argv.slice(2);
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(`${USAGE}\n`);
  } else {
    const [path, buildCommit] = parseArgs(args);
    const bytes = readPanel(path);
    let panel;
    try { panel = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
    catch { throw new Error('Expected a UTF-8 JSON bot panel'); }
    const sourceSha256 = createHash('sha256').update(bytes).digest('hex');
    process.stdout.write(`${JSON.stringify(createDailyShortlist(panel, { buildCommit, sourceSha256 }), null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`Shortlist: ${error.message}\n`);
  process.exitCode = 1;
}
