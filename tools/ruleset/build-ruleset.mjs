#!/usr/bin/env node
/**
 * Ruleset artifact tool (issue #123, Replay Contract v1 section 7).
 *
 *   node tools/ruleset/build-ruleset.mjs                 print the current rulesetId and canonical byte length
 *   node tools/ruleset/build-ruleset.mjs --write         archive the current ruleset (content-addressed) + update current.json
 *   node tools/ruleset/build-ruleset.mjs --check         exit 1 unless committed artifacts equal a fresh assembly and pins hold
 *   node tools/ruleset/build-ruleset.mjs --attest "no-behavior-change: <why>"
 *   node tools/ruleset/build-ruleset.mjs --attest "sim-revision-bumped: <what>"
 *                                                        rewrite tools/ruleset/source-digest.json (the source tripwire)
 *
 * Reads files under the repo only. No network. Does not execute anything it reads.
 */
import fs from 'node:fs';
import path from 'node:path';
import { canonicalBytes } from '../../src/systems/replay/canonicalJson.js';
import { digestOfBytes } from '../../src/systems/replay/canonicalSha256.js';
import {
  ARCHIVE_DIR, CURRENT_PATH, assembleFromDisk, checkPins, currentPointer, hexOf, repoRoot, readTripwire, tripwireDigests, writeArtifacts, writeTripwire,
} from './lib.mjs';

const root = repoRoot();
const args = process.argv.slice(2);

function check() {
  const problems = [...checkPins(root)];
  const built = assembleFromDisk(root);
  const archived = path.join(root, ARCHIVE_DIR, `${hexOf(built.rulesetId)}.json`);
  if (!fs.existsSync(archived)) problems.push(`no archive file for the current ${built.rulesetId}; run --write (and bump SIM_REVISION if code behavior changed)`);
  else if (!Buffer.from(built.bytes).equals(fs.readFileSync(archived))) problems.push(`${archived} differs from a fresh assembly`);
  const ptr = path.join(root, CURRENT_PATH);
  if (!fs.existsSync(ptr) || !Buffer.from(canonicalBytes(currentPointer(built))).equals(fs.readFileSync(ptr))) problems.push(`${CURRENT_PATH} is stale; run --write`);
  for (const f of fs.readdirSync(path.join(root, ARCHIVE_DIR))) {
    const got = digestOfBytes(new Uint8Array(fs.readFileSync(path.join(root, ARCHIVE_DIR, f))));
    if (`${hexOf(got)}.json` !== f) problems.push(`archive file ${f} does not hash to its name (archived rulesets are immutable)`);
  }
  const committed = readTripwire(root);
  const fresh = tripwireDigests(root);
  for (const f of Object.keys({ ...committed.files, ...fresh })) if (committed.files[f] !== fresh[f]) problems.push(`source tripwire: ${f} changed; run --attest`);
  return problems;
}

const attestIx = args.indexOf('--attest');
if (attestIx >= 0) {
  const r = writeTripwire(root, args[attestIx + 1]);
  console.log(r.wrote ? `tripwire updated (${r.changed.length} file(s) changed)` : 'tripwire already current');
} else if (args.includes('--write')) {
  const b = writeArtifacts(root);
  console.log(`${b.rulesetId} (${b.bytes.length} canonical bytes, simRevision ${b.doc.simRevision})`);
} else if (args.includes('--check')) {
  const problems = check();
  if (problems.length) {
    for (const p of problems) console.error(`FAIL ${p}`);
    process.exit(1);
  }
  console.log('ruleset artifacts and source tripwire are current');
} else {
  const b = assembleFromDisk(root);
  console.log(`${b.rulesetId} (${b.bytes.length} canonical bytes, simRevision ${b.doc.simRevision})`);
}
