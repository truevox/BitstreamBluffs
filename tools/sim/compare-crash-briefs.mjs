/** #78: compare two existing #190 receipts, without loading or replaying a tape. */
import { constants } from 'node:fs';
import { open } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { parseArgs, TextDecoder, types } from 'node:util';
import { crashBriefReport } from './replay-crash-brief.js';

const USAGE = 'Usage: node tools/sim/compare-crash-briefs.mjs --observed FILE --reference FILE';
const INVALID = 'Expected unchanged #190 v1 crash-brief JSON.';
const MAX_BRIEF_BYTES = 4 * 1024;
// #190 v1: 2–5 replays, 1–180 whole 120-tick checkpoints (a 180-second cap).
const MAX_CHECKPOINTS = 180;
const utf8 = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });

class BriefInputError extends Error {}

export function parseCrashBriefV1(bytes) {
  try {
    if (!types.isUint8Array(bytes) || bytes.byteLength === 0 || bytes.byteLength > MAX_BRIEF_BYTES) {
      throw new BriefInputError(INVALID);
    }
    const source = utf8.decode(bytes);
    const input = JSON.parse(source);
    const { freshRuns, checkpointsCheckedPerRun } = input.replay;
    if (!Number.isSafeInteger(freshRuns) || freshRuns < 2 || freshRuns > 5 ||
        !Number.isSafeInteger(checkpointsCheckedPerRun) || checkpointsCheckedPerRun < 1 ||
        checkpointsCheckedPerRun > MAX_CHECKPOINTS) throw new BriefInputError(INVALID);
    const reference = crashBriefReport({ cause: input.crash.category, hazardId: input.crash.hazardId },
      freshRuns, checkpointsCheckedPerRun);
    // Rebuild using the real v1 producer instead of copying inputs into the
    // accepted tree. Equality with emitted UTF-8 JSON rejects unknown/private
    // fields and duplicate keys, even where JSON.parse kept only the last one.
    if (source !== JSON.stringify(reference, null, 2) + '\n') throw new BriefInputError(INVALID);
    return reference.crash;
  } catch {
    throw new BriefInputError(INVALID);
  }
}

export function compareCrashBriefs(observedBytes, referenceBytes) {
  const observed = parseCrashBriefV1(observedBytes);
  const reference = parseCrashBriefV1(referenceBytes);
  let status;
  if (observed.category !== reference.category) status = 'mismatch';
  else if (observed.category !== 'hazard') status = 'match';
  else if (!observed.hazardId || !reference.hazardId) status = 'inconclusive';
  else status = observed.hazardId === reference.hazardId ? 'match' : 'mismatch';
  return {
    kind: 'local-replay-crash-brief-comparison', reportVersion: 1,
    scope: 'Redacted outcome agreement only; does not authenticate either brief, build, or run.',
    status, observed, reference,
  };
}

async function readBrief(path, role) {
  const failure = `${role} input must be a readable regular file containing 1–4096 bytes.`;
  try {
    const file = await open(path, constants.O_RDONLY | constants.O_NONBLOCK);
    try {
      const stat = await file.stat();
      if (!stat.isFile() || stat.size < 1 || stat.size > MAX_BRIEF_BYTES) throw new BriefInputError(failure);
      const buffer = Buffer.alloc(MAX_BRIEF_BYTES + 1);
      let size = 0;
      while (size < buffer.length) {
        const { bytesRead } = await file.read(buffer, size, buffer.length - size, size);
        if (bytesRead === 0) break;
        size += bytesRead;
      }
      // Retain the bound if the file grows after the stat check.
      if (size < 1 || size > MAX_BRIEF_BYTES) throw new BriefInputError(failure);
      return buffer.subarray(0, size);
    } finally { await file.close(); }
  } catch { throw new BriefInputError(failure); }
}

async function main(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    process.stdout.write(`${USAGE}\n`);
    return;
  }
  let parsed;
  try {
    parsed = parseArgs({ args, options: { observed: { type: 'string' }, reference: { type: 'string' } }, tokens: true });
  } catch { throw new BriefInputError(USAGE); }
  const { observed, reference } = parsed.values;
  if (parsed.tokens.length !== 2 || !observed || !reference) throw new BriefInputError(USAGE);
  const result = compareCrashBriefs(await readBrief(observed, 'Observed'), await readBrief(reference, 'Reference'));
  process.stdout.write(JSON.stringify(result, null, 2) + '\n');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`Crash brief comparison: ${error instanceof BriefInputError ? error.message : 'Local comparison did not complete.'}\n`);
    process.exitCode = 1;
  });
}
