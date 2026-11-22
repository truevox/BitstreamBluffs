/**
 * Ruleset identity (Replay Contract v1, section 7; issue #123).
 *
 * `rulesetId = sha256(BB-CJSON(ruleset document))`. The document (`bb-ruleset` v1) is assembled ONLY from the sources
 * and decisions in rulesetRegistry.js plus the content JSON handed in by the caller (this module does no I/O). Pure:
 * no Phaser, no fs, no network, no clock, no randomness, and it never executes loaded or uploaded code; it only reads
 * the constants of modules this repository ships.
 *
 * What the id does NOT see: behavior that lives in function bodies (Sled geometry/density, contact logic, update
 * order, `x > 480` style literals, Matter patching). `SIM_REVISION` is the human attestation for those: bump it in the
 * same PR as any change to causal code behavior, even a bug fix, even when no constant moved. Backstops: golden
 * canaries (#117) and the source tripwire (tools/ruleset/source-digest.json, NOT part of the id).
 */
import { canonicalBytes, parseCanonical } from './canonicalJson.js';
import { digestOf } from './canonicalSha256.js';
import {
  CONTENT_GROUPS, HIDDEN_LITERALS, SOURCE_EXTRACTS, omitKeysFor, RULESET_SOURCES, RulesetRegistryError,
  classifyExports, classifyExtract, projectData, scanNumericConsts,
} from './rulesetRegistry.js';

import * as constantsNs from '../../constants.js';
import * as physicsTunerNs from '../PhysicsTuner.js';
import * as bsodPursuitNs from '../BsodPursuit.js';
import * as simClockNs from '../SimClock.js';
import * as terrainGeneratorNs from '../TerrainGenerator.js';
import * as hazardMotionNs from '../HazardMotion.js';
import * as kodiaksNs from '../Kodiaks.js';
import * as permanentUpgradesNs from '../PermanentUpgrades.js';
import * as boostsNs from '../Boosts.js';
import * as dailyDraftNs from '../DailyDraft.js';
import * as runRandomNs from '../RunRandom.js';
import * as ghostTapeNs from '../ghost/GhostTape.js';
import * as dailyPatchNs from '../DailyPatch.js';
import * as trickTrackerNs from '../TrickTracker.js';
import * as biomeEffectsNs from '../BiomeEffects.js';
import * as wardsNs from '../Wards.js';
import * as bsodBluffTrackerNs from '../BsodBluffTracker.js';
import * as shardMagnetNs from '../ShardMagnet.js';
import * as bsodAerodynamicsNs from '../BsodAerodynamics.js';
import * as rngNs from '../Rng.js';
import * as scoreManagerNs from '../ScoreManager.js';
import * as terrainContactNs from '../TerrainContact.js';

/**
 * Hand-bumped simulation revision, integer >= 1, part of the ruleset document (and so of the id). Bump it, in the
 * same PR, for ANY change to causal code behavior; see the module comment. It is independent of package.json's version
 * and of GHOST_PHYSICS_VERSION (kept only for legacy tape mapping, not bumped further).
 */
export const SIM_REVISION = 2;

/**
 * `SIM_REVISION` of the last ruleset RELEASED on main (0 = none released yet). While the current SIM_REVISION is above
 * this value it is still unreleased, so causal behavior may change inside it without a bump and the source tripwire
 * accepts a `behavior-change-unreleased:` attestation. Set this to SIM_REVISION in the PR that releases a ruleset: from
 * then on a behavior change needs a real SIM_REVISION bump. Not part of the ruleset document or the id.
 */
export const LAST_RELEASED_SIM_REVISION = 0;

export const RULESET_FORMAT = 'bb-ruleset';
export const RULESET_FORMAT_VERSION = 1;
/** `bb-pad` input protocol v1 (contract 4.4). Defined by the contract, not (yet) by a source module. */
export const INPUT_PROTOCOL = Object.freeze({ id: 'bb-pad', version: 1 });

export const RULESET_ID_RE = /^sha256:[0-9a-f]{64}$/;

/** Module namespaces by registry id: the only code this module reads constants from. */
export const DEFAULT_SOURCES = Object.freeze({
  constants: constantsNs,
  physicsTuner: physicsTunerNs,
  bsodPursuit: bsodPursuitNs,
  simClock: simClockNs,
  terrainGenerator: terrainGeneratorNs,
  hazardMotion: hazardMotionNs,
  kodiaks: kodiaksNs,
  permanentUpgrades: permanentUpgradesNs,
  boosts: boostsNs,
  dailyDraft: dailyDraftNs,
  runRandom: runRandomNs,
  ghostTape: ghostTapeNs,
  dailyPatch: dailyPatchNs,
  trickTracker: trickTrackerNs,
  biomeEffects: biomeEffectsNs,
  wards: wardsNs,
  bsodBluffTracker: bsodBluffTrackerNs,
  shardMagnet: shardMagnetNs,
  bsodAerodynamics: bsodAerodynamicsNs,
  rng: rngNs,
  scoreManager: scoreManagerNs,
  terrainContact: terrainContactNs,
});

const KEY_OK = /^[A-Za-z0-9_.:$-]{1,64}$/;
const PROTO_IDS = new Set(['__proto__', 'constructor', 'prototype', 'toString', 'valueOf', 'hasOwnProperty']);

function setPath(doc, path, value) {
  const parts = path.split('.');
  let o = doc;
  for (let i = 0; i < parts.length - 1; i++) {
    const k = parts[i];
    if (o[k] === undefined) o[k] = {};
    else if (o[k] === null || typeof o[k] !== 'object' || Array.isArray(o[k])) throw new RulesetRegistryError('path-conflict', path);
    o = o[k];
  }
  const last = parts[parts.length - 1];
  if (Object.prototype.hasOwnProperty.call(o, last)) throw new RulesetRegistryError('duplicate-path', path);
  o[last] = value;
}

/** Registry self-consistency: no two decisions may write the same path. Throws RulesetRegistryError. */
export function assertRegistryShape() {
  const paths = new Set();
  const note = (p) => {
    if (paths.has(p)) throw new RulesetRegistryError('duplicate-path', p);
    paths.add(p);
  };
  for (const s of RULESET_SOURCES) {
    const decisions = [...Object.values(s.exports)];
    for (const members of Object.values(s.statics || {})) decisions.push(...Object.values(members));
    for (const d of decisions) {
      if (d.exclude !== undefined) {
        if (typeof d.exclude !== 'string' || d.exclude.length < 8) throw new RulesetRegistryError('missing-reason', s.id);
        continue;
      }
      for (const p of Array.isArray(d.at) ? d.at : [d.at]) note(p);
    }
  }
  for (const ex of SOURCE_EXTRACTS) {
    for (const d of Object.values(ex.consts)) {
      if (d.exclude === undefined) for (const p of [].concat(d.at)) note(p);
      else if (typeof d.exclude !== 'string' || d.exclude.length < 8) throw new RulesetRegistryError('missing-reason', ex.id);
    }
  }
  for (const h of HIDDEN_LITERALS) note(h.at);
}

/**
 * Assemble the ruleset document from this repository's constants and the supplied content/engine facts.
 *
 * @param {Object} inputs
 * @param {Object} inputs.content   `{chunks, hazards, powerups, terrainMods, biomes}`: each an object keyed by def id
 *                                  holding the FULL JSON def (cosmetic keys are removed here, by NON_SIM_KEYS + EXTRA_NON_SIM_KEYS).
 * @param {{phaser:string, matter:string}} inputs.engineVersions resolved versions (package-lock phaser; bundled Matter).
 * @param {Object<string,string>} inputs.sourceTexts text of every SOURCE_EXTRACTS file by repo path (modules that cannot be
 *                                  imported in node; their numeric constants are scanned, never executed).
 * @param {number} [inputs.simRevision=SIM_REVISION] test seam for two-version proofs; production never overrides it.
 * @param {Object} [sources=DEFAULT_SOURCES] module namespaces by registry id (test seam; a namespace with an
 *                                  unregistered export makes this throw `unregistered-export`).
 * @returns {Object} plain, canonicalizable ruleset document.
 * @throws {RulesetRegistryError}
 */
export function assembleRuleset(inputs, sources = DEFAULT_SOURCES) {
  assertRegistryShape();
  const { content, engineVersions } = inputs;
  const simRevision = inputs.simRevision === undefined ? SIM_REVISION : inputs.simRevision;
  if (!Number.isSafeInteger(simRevision) || simRevision < 1) throw new RulesetRegistryError('bad-sim-revision', String(simRevision));
  if (!engineVersions || typeof engineVersions.phaser !== 'string' || typeof engineVersions.matter !== 'string') {
    throw new RulesetRegistryError('bad-engine-versions', 'phaser and matter version strings required');
  }

  const doc = {
    format: RULESET_FORMAT,
    formatVersion: RULESET_FORMAT_VERSION,
    simRevision,
    versions: {},
    engine: {},
    constants: {},
    tables: {},
    content: {},
  };

  for (const source of RULESET_SOURCES) {
    const ns = sources[source.id];
    if (!ns) throw new RulesetRegistryError('missing-source', source.id);
    const { unregistered, stale } = classifyExports(source, ns);
    if (unregistered.length) throw new RulesetRegistryError('unregistered-export', `${source.file}: ${unregistered.join(', ')}`);
    if (stale.length) throw new RulesetRegistryError('stale-registry-entry', `${source.file}: ${stale.join(', ')}`);
    const place = (decision, value, label) => {
      if (decision.exclude !== undefined) return;
      const data = projectData(value, decision.omit || [], label);
      for (const at of Array.isArray(decision.at) ? decision.at : [decision.at]) setPath(doc, at, data);
    };
    for (const [name, decision] of Object.entries(source.exports)) place(decision, ns[name], `${source.id}.${name}`);
    for (const [cls, members] of Object.entries(source.statics || {})) {
      for (const [m, decision] of Object.entries(members)) place(decision, ns[cls][m], `${source.id}.${cls}.${m}`);
    }
  }

  for (const ex of SOURCE_EXTRACTS) {
    const text = inputs.sourceTexts && inputs.sourceTexts[ex.file];
    if (typeof text !== 'string') throw new RulesetRegistryError('missing-source-text', ex.file);
    const { unregistered, stale } = classifyExtract(ex, text);
    if (unregistered.length) throw new RulesetRegistryError('unregistered-export', `${ex.file}: ${unregistered.join(', ')}`);
    if (stale.length) throw new RulesetRegistryError('stale-registry-entry', `${ex.file}: ${stale.join(', ')}`);
    const found = scanNumericConsts(text);
    for (const [name, d] of Object.entries(ex.consts)) {
      if (d.exclude !== undefined) continue;
      for (const at of [].concat(d.at)) setPath(doc, at, projectData(found[name], d.omit || [], `${ex.id}.${name}`));
    }
  }

  for (const h of HIDDEN_LITERALS) setPath(doc, h.at, h.value);

  // Derived values (formulas mirrored from RunScene; the pin test asserts the formula text is still there).
  setPath(doc, 'engine.gravity.y', doc.constants.physics.gravityPxS2 / 1000);
  setPath(doc, 'engine.phaser', engineVersions.phaser);
  setPath(doc, 'engine.matter', engineVersions.matter);
  setPath(doc, 'versions.inputProtocol', { id: INPUT_PROTOCOL.id, version: INPUT_PROTOCOL.version });

  for (const group of CONTENT_GROUPS) {
    const defs = content && content[group];
    if (!defs || typeof defs !== 'object' || Array.isArray(defs)) throw new RulesetRegistryError('bad-content', `${group} must be an object keyed by id`);
    const out = {};
    for (const id of Object.keys(defs)) {
      if (!KEY_OK.test(id) || PROTO_IDS.has(id)) throw new RulesetRegistryError('bad-content-id', `${group}.${id}`);
      out[id] = projectData(defs[id], omitKeysFor(group), `content.${group}.${id}`);
    }
    doc.content[group] = out;
  }
  return doc;
}

/** Canonical bytes of a ruleset document (throws CJSONError if the document is not canonicalizable). */
export function rulesetBytes(doc) {
  return canonicalBytes(doc);
}

/** `rulesetId` of a ruleset document: `sha256:` + hex of its canonical bytes. */
export function rulesetIdOf(doc) {
  return digestOf(doc);
}

const REQUIRED_BLOCKS = ['versions', 'engine', 'constants', 'tables', 'content'];

/**
 * Shape check for a ruleset document (loaded from an archive, say). Throws RulesetRegistryError. Does NOT prove the
 * document matches any claimed id: callers always recompute the id from the bytes.
 * @param {*} doc
 * @returns {Object} the same doc
 */
export function assertRulesetShape(doc) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) throw new RulesetRegistryError('bad-ruleset', 'not an object');
  if (doc.format !== RULESET_FORMAT) throw new RulesetRegistryError('bad-ruleset', `format must be ${RULESET_FORMAT}`);
  if (doc.formatVersion !== RULESET_FORMAT_VERSION) throw new RulesetRegistryError('unsupported-ruleset-version', String(doc.formatVersion));
  if (!Number.isSafeInteger(doc.simRevision) || doc.simRevision < 1) throw new RulesetRegistryError('bad-ruleset', 'simRevision must be an integer >= 1');
  for (const b of REQUIRED_BLOCKS) {
    if (doc[b] === null || typeof doc[b] !== 'object' || Array.isArray(doc[b])) throw new RulesetRegistryError('bad-ruleset', `missing block ${b}`);
  }
  for (const k of Object.keys(doc)) {
    if (k !== 'format' && k !== 'formatVersion' && k !== 'simRevision' && !REQUIRED_BLOCKS.includes(k)) {
      throw new RulesetRegistryError('bad-ruleset', `unknown top-level key ${k}`);
    }
  }
  const { tickHz } = doc.versions;
  if (!Number.isSafeInteger(tickHz) || tickHz < 1) throw new RulesetRegistryError('bad-ruleset', 'versions.tickHz');
  if (typeof doc.engine.phaser !== 'string' || typeof doc.engine.matter !== 'string') throw new RulesetRegistryError('bad-ruleset', 'engine versions');
  return doc;
}

/**
 * Parse archived ruleset bytes strictly (canonical bytes only) and return `{doc, rulesetId}`. The id is ALWAYS computed
 * from the bytes; a filename or any other claim is never trusted.
 * @param {Uint8Array} bytes
 * @returns {{doc:Object, rulesetId:string}}
 */
export function parseRuleset(bytes) {
  const doc = assertRulesetShape(parseCanonical(bytes));
  return { doc, rulesetId: rulesetIdOf(doc) };
}
