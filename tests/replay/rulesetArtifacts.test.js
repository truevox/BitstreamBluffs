// Issue #123 / Contract 7.1-7.2: committed ruleset artifact == freshly assembled (silent constant drift fails CI), the
// content-addressed archive is immutable, and the source tripwire forces a human decision.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { digestOfBytes } from '../../src/systems/replay/canonicalSha256.js';
import { parseRuleset, SIM_REVISION } from '../../src/systems/replay/ruleset.js';
import { parseCanonical } from '../../src/systems/replay/canonicalJson.js';
import {
  ARCHIVE_DIR, ATTESTATION_RE, CURRENT_PATH, TRIPWIRE_FILES, assembleFromDisk, currentPointer, hexOf, readArchive, readTripwire, repoRoot, tripwireDigests,
} from '../../tools/ruleset/lib.mjs';

const root = repoRoot();
const built = assembleFromDisk(root);

describe('committed ruleset artifact', () => {
  test('the archive file for the current rulesetId exists and is byte-equal to a fresh assembly', () => {
    const file = path.join(root, ARCHIVE_DIR, `${hexOf(built.rulesetId)}.json`);
    expect(fs.existsSync(file)).toBe(true); // failing here: constants/content/SIM_REVISION changed. Run `node tools/ruleset/build-ruleset.mjs --write`
    expect(Buffer.from(built.bytes).equals(fs.readFileSync(file))).toBe(true);
    expect(createHash('sha256').update(fs.readFileSync(file)).digest('hex')).toBe(hexOf(built.rulesetId));
  });

  test('current.json points at the fresh id, byte length and simRevision', () => {
    const ptr = parseCanonical(new Uint8Array(fs.readFileSync(path.join(root, CURRENT_PATH))));
    expect({ ...ptr }).toEqual(currentPointer(built));
    expect(ptr.simRevision).toBe(SIM_REVISION);
  });

  test('every archived ruleset hashes to its file name and parses as a canonical bb-ruleset (immutable identities)', () => {
    const archive = readArchive(root);
    expect(archive.length).toBeGreaterThanOrEqual(1);
    for (const { name, bytes } of archive) {
      expect(`${hexOf(digestOfBytes(bytes))}.json`).toBe(name);
      expect(parseRuleset(bytes).rulesetId).toBe(`sha256:${name.replace('.json', '')}`);
    }
  });
});

describe('source tripwire (not part of rulesetId)', () => {
  const committed = readTripwire(root);

  test('committed digests equal the working tree (failing: causal source changed; attest or bump SIM_REVISION)', () => {
    const fresh = tripwireDigests(root);
    expect(committed.files).toEqual(fresh);
  });

  test('the allowlist is exactly the committed file list, and every file exists', () => {
    expect(Object.keys(committed.files).sort()).toEqual([...TRIPWIRE_FILES].sort());
    for (const f of TRIPWIRE_FILES) expect(fs.existsSync(path.join(root, f))).toBe(true);
  });

  test('carries a well-formed attestation; a sim-revision-bumped attestation must match the current SIM_REVISION', () => {
    expect(committed.attestation).toMatch(ATTESTATION_RE);
    if (committed.attestation.startsWith('sim-revision-bumped')) expect(committed.simRevision).toBe(SIM_REVISION);
  });

  test('is not part of the ruleset document', () => {
    expect(JSON.stringify(built.doc)).not.toContain('tripwire');
  });
});
