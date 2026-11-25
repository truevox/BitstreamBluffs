/**
 * Synchronous identity of the RUNNING build, for stamping new tape headers (#72). NO Phaser imports.
 *
 * `tools/ruleset/current.json` is a tiny committed pointer that Vite bundles as plain JSON, so the id is available at
 * the first tick of a run, before the asynchronous archive loader (runtimeRuleset.js, which uses `import.meta.glob`)
 * has finished. CI (`build-ruleset.mjs --check`) proves the pointer equals a fresh assembly of this source tree.
 * Jest can import this file (a JSON import, like runtimeIdentity.js).
 */
import current from '../../../tools/ruleset/current.json';
import { composeCurrentBuildIdentity } from '../savestate/runtimeIdentity.js';

/** The exact id of this build's ruleset, e.g. `sha256:86d1...`. */
export const CURRENT_RULESET_ID = typeof current.rulesetId === 'string' ? current.rulesetId : null;

const buildIds = new WeakMap();

/**
 * The build id (`bb-build-identity`) of this build, composed from the already-loaded ruleset, or null while the ruleset has
 * not loaded (or does not match this build's pointer). Never throws; a tape without a buildId is still stamped with its rulesetId.
 * @param {{doc:object, rulesetId:string}|undefined|null} ruleset the registry's RULESET_KEY value
 * @returns {string|null}
 */
export function currentBuildId(ruleset) {
  try {
    if (!ruleset || typeof ruleset !== 'object' || ruleset.rulesetId !== CURRENT_RULESET_ID) return null;
    if (!buildIds.has(ruleset)) buildIds.set(ruleset, composeCurrentBuildIdentity(ruleset).buildId);
    return buildIds.get(ruleset);
  } catch {
    return null;
  }
}
