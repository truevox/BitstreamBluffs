/**
 * Node-side helpers for ruleset artifacts (issue #123). Shared by tools/ruleset/build-ruleset.mjs (the CLI) and
 * tests/replay/ruleset*.test.js. Reads files and nothing else: no network, no child processes, no `eval`, and it never
 * imports or runs anything it reads from the data directories. The only code it loads is this repository's own
 * src/systems/replay modules.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonicalBytes } from '../../src/systems/replay/canonicalJson.js';
import { digestOfBytes } from '../../src/systems/replay/canonicalSha256.js';
import { assembleRuleset, rulesetIdOf, LAST_RELEASED_SIM_REVISION, SIM_REVISION } from '../../src/systems/replay/ruleset.js';
import { composeBuildIdentity, sourceTextDigest, sourceTripwireIdOf } from '../../src/systems/savestate/buildIdentity.js';
import { SAVESTATE_LAYOUT_DESCRIPTOR } from '../../src/systems/savestate/layoutDeclaration.js';
import { CONTENT_GROUPS, HIDDEN_LITERALS, GRAVITY_Y_PIN, SOURCE_EXTRACTS } from '../../src/systems/replay/rulesetRegistry.js';

export const repoRoot = () => path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const ARCHIVE_DIR = 'tools/ruleset/archive';
export const CURRENT_PATH = 'tools/ruleset/current.json';
export const TRIPWIRE_PATH = 'tools/ruleset/source-digest.json';

/**
 * Allowlisted causal source files for the tripwire (section 7.2). Whole files: a refactor of one of them needs a
 * one-line human attestation, which is the point. RunScene.js is here too (update order, slowmo, spawn, engine setup);
 * it cannot be imported in node, so its top-level numeric constants are read by source extraction (SOURCE_EXTRACTS).
 */
export const TRIPWIRE_FILES = Object.freeze([
  'src/constants.js',
  'src/entities/Hazard.js',
  'src/entities/PowerUp.js',
  'src/entities/Shard.js',
  'src/entities/Sled.js',
  'src/entities/TerrainMesh.js',
  'src/scenes/RunScene.js',
  'src/systems/BiomeEffects.js',
  'src/systems/Boosts.js',
  'src/systems/BsodAerodynamics.js',
  'src/systems/BsodBluffTracker.js',
  'src/systems/BsodPursuit.js',
  'src/systems/DailyDraft.js',
  'src/systems/DailyPatch.js',
  'src/systems/HazardMotion.js',
  'src/systems/Kodiaks.js',
  'src/systems/MarkerLayout.js', // #253 visual-origin helper can mutate causal terrain via heightAt; protect it
  'src/systems/MatterPortable.js',
  'src/systems/PermanentUpgrades.js',
  'src/systems/PhysicsTuner.js',
  'src/systems/Rng.js',
  'src/systems/pmath-stdlib-lock.json',
  'src/systems/pmath.js',
  'src/systems/RunRandom.js',
  'src/systems/ScoreManager.js',
  'src/systems/ShardMagnet.js',
  'src/systems/SimClock.js',
  'src/systems/TerrainContact.js',
  'src/systems/TerrainGenerator.js',
  'src/systems/TrickTracker.js',
  'src/systems/Wards.js',
  'src/systems/ghost/GhostTape.js',
]);

const readText = (root, file) => fs.readFileSync(path.join(root, file), 'utf8');

/** Content JSON by group, keyed by def id. Throws on a duplicate id (the game's loader would silently overwrite). */
export function loadContentFromDisk(root = repoRoot()) {
  const out = {};
  for (const group of CONTENT_GROUPS) {
    const dir = path.join(root, 'src/data', group);
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort();
    out[group] = {};
    for (const f of files) {
      const def = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
      if (typeof def.id !== 'string') throw new Error(`${group}/${f}: missing string id`);
      if (['__proto__', 'constructor', 'prototype'].includes(def.id)) throw new Error(`${group}/${f}: forbidden id ${def.id}`);
      if (Object.prototype.hasOwnProperty.call(out[group], def.id)) throw new Error(`${group}/${f}: duplicate id ${def.id}`);
      out[group][def.id] = def;
    }
  }
  return out;
}

/** phaser: resolved version from package-lock.json; matter: the version Phaser bundles (not a lockfile entry). */
export function readEngineVersions(root = repoRoot()) {
  const lock = JSON.parse(readText(root, 'package-lock.json'));
  const phaser = lock.packages && lock.packages['node_modules/phaser'] && lock.packages['node_modules/phaser'].version;
  if (typeof phaser !== 'string') throw new Error('package-lock.json has no node_modules/phaser version');
  const installed = JSON.parse(readText(root, 'node_modules/phaser/package.json')).version;
  if (installed !== phaser) throw new Error(`installed phaser ${installed} != package-lock ${phaser}; run npm ci`);
  const m = /Matter\.version = '([^']+)'/.exec(readText(root, 'node_modules/phaser/src/physics/matter-js/lib/core/Matter.js'));
  if (!m) throw new Error('cannot find Matter.version in Phaser bundle');
  return { phaser, matter: m[1] };
}

/** Assemble the current ruleset from disk. `opts.simRevision` is the two-version-proof seam. */
/** Text of every SOURCE_EXTRACTS file (modules that cannot be imported in node). */
export function readSourceTexts(root = repoRoot()) {
  return Object.fromEntries(SOURCE_EXTRACTS.map((e) => [e.file, readText(root, e.file)]));
}

export function assembleFromDisk(root = repoRoot(), opts = {}) {
  const doc = assembleRuleset({ content: loadContentFromDisk(root), engineVersions: readEngineVersions(root), sourceTexts: readSourceTexts(root), ...opts });
  const bytes = canonicalBytes(doc);
  return { doc, bytes, rulesetId: rulesetIdOf(doc) };
}

export const hexOf = (id) => id.slice('sha256:'.length);

export function currentPointer({ doc, bytes, rulesetId }) {
  return {
    format: 'bb-ruleset-current',
    formatVersion: 1,
    rulesetId,
    canonicalBytes: bytes.length,
    simRevision: doc.simRevision,
    archivePath: `${ARCHIVE_DIR}/${hexOf(rulesetId)}.json`,
  };
}

/** Source-text pins from the registry: every needle must still exist; `absentInSrc` needles must not occur in src/. */
export function checkPins(root = repoRoot()) {
  const problems = [];
  const pins = [{ file: GRAVITY_Y_PIN.file, text: GRAVITY_Y_PIN.text, at: 'engine.gravity.y' }];
  for (const h of HIDDEN_LITERALS) for (const p of h.pins || []) pins.push({ ...p, at: h.at });
  for (const p of pins) {
    let text;
    try {
      text = readText(root, p.file);
    } catch {
      problems.push(`${p.at}: cannot read ${p.file}`);
      continue;
    }
    if (!text.includes(p.text)) problems.push(`${p.at}: ${p.file} no longer contains \`${p.text}\``);
  }
  const absent = HIDDEN_LITERALS.flatMap((h) => (h.absentInSrc || []).map((t) => ({ at: h.at, text: t })));
  if (absent.length) {
    const walk = (dir) => fs.readdirSync(path.join(root, dir), { withFileTypes: true }).flatMap((e) => {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) return rel === 'src/systems/replay' ? [] : walk(rel);
      return e.name.endsWith('.js') ? [rel] : [];
    });
    for (const f of walk('src')) {
      const t = readText(root, f);
      for (const a of absent) if (t.includes(a.text)) problems.push(`${a.at}: ${f} now contains \`${a.text}\` (the registry assumes it never does)`);
    }
  }
  return problems;
}

/** SHA-256 identity digest of each tripwire file, line endings normalized (CRLF -> LF) so autocrlf cannot trip it. */
export function tripwireDigests(root = repoRoot(), files = TRIPWIRE_FILES) {
  const out = {};
  for (const f of files) out[f] = sourceTextDigest(readText(root, f));
  return out;
}

export const ATTESTATION_RE = /^(no-behavior-change|sim-revision-bumped|behavior-change-unreleased): .{8,}$/;

/**
 * Check an attestation against the revision state. Returns null when acceptable, else the reason.
 * - `no-behavior-change: <why>`: always format-checked only.
 * - `sim-revision-bumped: <what>`: SIM_REVISION must have increased relative to the previously committed artifact.
 * - `behavior-change-unreleased: <why>`: causal behavior changed inside a revision that has not been released
 *   (SIM_REVISION > LAST_RELEASED_SIM_REVISION). Once a ruleset is released the revision is frozen: bump instead.
 */
export function attestationProblem(attestation, { simRevision = SIM_REVISION, prevSimRevision = null, lastReleased = LAST_RELEASED_SIM_REVISION } = {}) {
  if (typeof attestation !== 'string' || !ATTESTATION_RE.test(attestation)) {
    return 'attestation required, format: "no-behavior-change: <why>", "sim-revision-bumped: <what>" or "behavior-change-unreleased: <why>" (>= 8 chars of reason)';
  }
  if (attestation.startsWith('sim-revision-bumped') && prevSimRevision !== null && !(simRevision > prevSimRevision)) {
    return `"sim-revision-bumped" needs SIM_REVISION (${simRevision}) to exceed the previously committed one (${prevSimRevision}); use "no-behavior-change" or, for an unreleased revision, "behavior-change-unreleased"`;
  }
  if (attestation.startsWith('behavior-change-unreleased') && !(simRevision > lastReleased)) {
    return `"behavior-change-unreleased" is only valid while SIM_REVISION (${simRevision}) is above the last released revision (${lastReleased}); bump SIM_REVISION and use "sim-revision-bumped"`;
  }
  return null;
}

export function readTripwire(root = repoRoot()) {
  return JSON.parse(readText(root, TRIPWIRE_PATH));
}

/** Rewrite the tripwire file. Requires an attestation when any digest differs from the committed one. */
export function writeTripwire(root, attestation, files = TRIPWIRE_FILES) {
  const digests = tripwireDigests(root, files);
  let prev = null;
  try {
    prev = readTripwire(root);
  } catch { /* first run */ }
  const changed = prev ? Object.keys({ ...prev.files, ...digests }).filter((f) => (prev.files || {})[f] !== digests[f]).sort() : Object.keys(digests);
  if (prev && changed.length === 0) return { changed, wrote: false };
  const problem = attestationProblem(attestation, { prevSimRevision: prev ? prev.simRevision : null });
  if (problem) throw new Error(problem);
  const doc = {
    format: 'bb-source-tripwire',
    formatVersion: 1,
    note: 'Not part of rulesetId. A diff here means causal source changed: attest it did not change behavior, or bump SIM_REVISION.',
    simRevision: SIM_REVISION,
    attestation,
    changedFiles: prev ? changed : [],
    files: digests,
  };
  fs.writeFileSync(path.join(root, TRIPWIRE_PATH), `${JSON.stringify(doc, null, 2)}\n`);
  return { changed, wrote: true };
}

/** Archived ruleset files: `{name, bytes}`. */
export function readArchive(root = repoRoot()) {
  const dir = path.join(root, ARCHIVE_DIR);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).sort().map((name) => ({ name, bytes: new Uint8Array(fs.readFileSync(path.join(dir, name))) }));
}

/** Write the current ruleset into the content-addressed archive and the pointer. Never rewrites an existing archive file. */
export function writeArtifacts(root = repoRoot()) {
  const built = assembleFromDisk(root);
  const dir = path.join(root, ARCHIVE_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${hexOf(built.rulesetId)}.json`);
  if (fs.existsSync(file)) {
    if (!Buffer.from(built.bytes).equals(fs.readFileSync(file))) throw new Error(`archive file ${file} exists with different bytes: identities are immutable`);
  } else fs.writeFileSync(file, built.bytes);
  fs.writeFileSync(path.join(root, CURRENT_PATH), canonicalBytes(currentPointer(built)));
  return built;
}

/** The committed ruleset of this tree: the pointer plus the archive file re-hashed against its name. Read-only. */
export function readCurrentRuleset(root = repoRoot()) {
  const pointer = JSON.parse(readText(root, CURRENT_PATH));
  if (!pointer || typeof pointer.rulesetId !== 'string') throw new Error(`${CURRENT_PATH} has no rulesetId`);
  const file = path.join(root, ARCHIVE_DIR, `${hexOf(pointer.rulesetId)}.json`);
  if (!fs.existsSync(file)) throw new Error(`no archive file for ${pointer.rulesetId}: cannot prove the committed ruleset`);
  const bytes = new Uint8Array(fs.readFileSync(file));
  const doc = JSON.parse(Buffer.from(bytes).toString('utf8'));
  if (digestOfBytes(bytes) !== pointer.rulesetId || rulesetIdOf(doc) !== pointer.rulesetId) {
    throw new Error(`ruleset archive ${hexOf(pointer.rulesetId)} does not hash to its name`);
  }
  return { doc, rulesetId: pointer.rulesetId };
}

/**
 * `--root` is a read-only ARTIFACT OVERLAY, not a second executable checkout.
 * Imported ruleset constants, source registry, and savestate-layout declaration
 * come from this running CLI's checkout. Verifying a different physical `src`
 * tree would silently substitute the wrong declaration (and might certify a
 * different build as identical). A distinct root is therefore allowed only
 * when its `src` and `node_modules` resolve to the same directories as ours.
 * This fail-closed boundary is deliberately stronger than comparing hashes of
 * a hand-picked subset of imports, which could omit a new transitive module.
 */
export function assertArtifactOverlayRoot(root = repoRoot()) {
  let sameRoot = false;
  try { sameRoot = fs.realpathSync(root) === fs.realpathSync(repoRoot()); } catch { /* fail closed below */ }
  if (sameRoot) return;
  for (const directory of ['src', 'node_modules']) {
    let same = false;
    try {
      same = fs.realpathSync(path.join(root, directory)) === fs.realpathSync(path.join(repoRoot(), directory));
    } catch { /* missing path: not the same code/dependencies */ }
    if (!same) throw new Error(`--root must be an artifact overlay reusing this checkout's ${directory}; independent source trees cannot be certified by this process`);
  }
}

/**
 * Compose the build identity implied by the COMMITTED artifacts only. Read-only: never writes
 * `current.json` or the tripwire. An alternate root must share our source and dependencies.
 * @returns {{record:object, parts:object, built:{doc:object,rulesetId:string}}}
 */
export function currentBuildIdentity(root = repoRoot()) {
  assertArtifactOverlayRoot(root);
  // Artifact overlays reuse THIS checkout's executable source; do not
  // certify a stale generated savestate codec closure even if the physics
  // tripwire is unchanged. Overlay-specific artifact files are read below.
  for (const [file, expected] of SAVESTATE_LAYOUT_DESCRIPTOR.schemaSources || []) {
    if (sourceTextDigest(readText(repoRoot(), file)) !== expected)
      throw Error('stale savestate schema source identity: '+file+'; regenerate layout-source-identity.mjs --write');
  }
  const pkg = JSON.parse(readText(root, 'package.json'));
  const { doc, rulesetId } = readCurrentRuleset(root);
  const parts = {
    gameVersion: pkg.version,
    physicsIdentity: { rulesetId, simRevision: doc.simRevision },
    matterVersion: doc.engine.matter,
    layoutDescriptor: SAVESTATE_LAYOUT_DESCRIPTOR,
    sourceTripwire: readTripwire(root),
  };
  return { record: composeBuildIdentity(parts), parts, built: { doc, rulesetId } };
}

/**
 * Read-only consistency check of the build identity against committed artifacts AND a fresh source
 * assembly. Returns problems (empty means the identity is current and provable).
 */
export function checkBuildIdentity(root = repoRoot()) {
  const problems = [];
  let committed;
  try { committed = currentBuildIdentity(root); } catch (error) { return [`cannot compose the committed build identity: ${error && error.message ? error.message : error}`]; }

  let fresh;
  try { fresh = assembleFromDisk(root); } catch (error) { problems.push(`cannot assemble the ruleset for the build identity: ${error && error.message ? error.message : error}`); }
  if (fresh) {
    if (fresh.rulesetId !== committed.record.physicsIdentity.rulesetId) {
      problems.push(`build identity ruleset ${committed.record.physicsIdentity.rulesetId} != fresh assembly ${fresh.rulesetId}; run --write (and attest/bump if code behavior changed)`);
    } else if (fresh.doc.simRevision !== committed.record.physicsIdentity.simRevision) {
      problems.push(`build identity simRevision ${committed.record.physicsIdentity.simRevision} != fresh assembly ${fresh.doc.simRevision}`);
    } else if (fresh.doc.engine.matter !== committed.record.matterVersion) {
      problems.push(`build identity matterVersion ${committed.record.matterVersion} != fresh assembly ${fresh.doc.engine.matter}`);
    }
  }

  // The identity's sourceTripwireId is a digest of the COMMITTED digests, so the only meaningful
  // freshness proof is that those digests still equal the working tree's causal source. (Re-deriving
  // the id from fresh digests would be tautological once these are equal.)
  const committedFiles = readTripwire(root).files || {};
  let freshDigests;
  try { freshDigests = tripwireDigests(root); } catch (error) { problems.push(`cannot digest causal sources: ${error && error.message ? error.message : error}`); }
  if (freshDigests) {
    for (const f of Object.keys({ ...committedFiles, ...freshDigests })) {
      if (committedFiles[f] !== freshDigests[f]) problems.push(`source tripwire: ${f} changed; run --attest (the build identity would change)`);
    }
  }
  return problems;
}
