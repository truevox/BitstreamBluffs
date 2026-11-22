/**
 * Read-only identity of the RUNNING build (#238). This is the seam a live build uses to report
 * exactly what it is; it writes nothing, touches no storage, mutates no ruleset and performs no
 * restore.
 *
 * Choice of location: the pure composition lives in `./buildIdentity.js`. This module is also
 * Jest-importable: its top-level imports are plain data (`package.json`, the committed source
 * tripwire) and pure modules. Only `loadCurrentBuildIdentity()` reaches for
 * `../replay/runtimeRuleset.js`, and it does so with a DYNAMIC import, because that module uses
 * Vite's `import.meta.glob`, which Jest cannot import (see its header and `src/data/index.js`).
 * That split keeps `composeCurrentBuildIdentity()` testable in Jest while the live path still
 * reuses the one archive loader the replay evidence path already trusts. No Phaser import.
 */
import packageInfo from '../../../package.json';
import sourceTripwire from '../../../tools/ruleset/source-digest.json';
import { BuildIdentityError, buildDescriptorOf, composeBuildIdentity } from './buildIdentity.js';
import { SAVESTATE_LAYOUT_DESCRIPTOR } from './layoutDeclaration.js';

/**
 * The parts a running build supplies, from its already-loaded ruleset and the committed artifacts.
 * @param {{doc:object, rulesetId:string}} ruleset `loadCurrentRuleset()`'s result
 * @returns {object}
 * @throws {BuildIdentityError} when the ruleset cannot prove a part
 */
export function buildIdentityPartsOf(ruleset) {
  if (ruleset === null || typeof ruleset !== 'object' || Array.isArray(ruleset)) throw new BuildIdentityError('invalid-ruleset', '');
  const { doc, rulesetId } = ruleset;
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) throw new BuildIdentityError('invalid-ruleset', 'doc');
  if (doc.engine === null || typeof doc.engine !== 'object' || Array.isArray(doc.engine)) throw new BuildIdentityError('invalid-ruleset', 'doc.engine');
  return {
    gameVersion: packageInfo.version,
    physicsIdentity: { rulesetId, simRevision: doc.simRevision },
    matterVersion: doc.engine.matter,
    layoutDescriptor: SAVESTATE_LAYOUT_DESCRIPTOR,
    sourceTripwire,
  };
}

/**
 * Compose the running build's full identity from an already-loaded ruleset. Pure.
 * @param {{doc:object, rulesetId:string}} ruleset
 * @returns {Readonly<object>} full `bb-build-identity` record
 */
export function composeCurrentBuildIdentity(ruleset) {
  return composeBuildIdentity(buildIdentityPartsOf(ruleset));
}

/**
 * The envelope-shaped projection of the running build's identity. Pure.
 * @param {{doc:object, rulesetId:string}} ruleset
 * @returns {Readonly<object>} the five fields `envelope.js` requires
 */
export function currentBuildDescriptorOf(ruleset) {
  return buildDescriptorOf(composeCurrentBuildIdentity(ruleset));
}

/**
 * Load the committed ruleset and report this build's full identity. Read-only.
 * @returns {Promise<Readonly<object>>}
 */
export async function loadCurrentBuildIdentity() {
  const { loadCurrentRuleset } = await import('../replay/runtimeRuleset.js');
  return composeCurrentBuildIdentity(await loadCurrentRuleset());
}

/**
 * Load the committed ruleset and report this build's envelope-shaped identity. Read-only.
 * @returns {Promise<Readonly<object>>}
 */
export async function loadCurrentBuildDescriptor() {
  return buildDescriptorOf(await loadCurrentBuildIdentity());
}
