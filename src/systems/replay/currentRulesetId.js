/**
 * Synchronous identity of the RUNNING build's ruleset, for stamping new tape headers (#72). NO Phaser imports.
 *
 * `tools/ruleset/current.json` is a tiny committed pointer that Vite bundles as plain JSON, so the id is available at
 * the first tick of a run, before the asynchronous archive loader (runtimeRuleset.js, which uses `import.meta.glob`)
 * has finished. CI (`build-ruleset.mjs --check`) proves the pointer equals a fresh assembly of this source tree.
 * Jest can import this file (a plain JSON import).
 *
 * The build id (`bb-build-identity`) needs the loaded ruleset document and the savestate modules, which must stay out of
 * RunScene's sim-reachable import graph: services.js composes it after the ruleset loads and puts it on the registry
 * (evidenceCapture.BUILD_ID_KEY); RunScene only reads it.
 */
import current from '../../../tools/ruleset/current.json';

/** The exact id of this build's ruleset, e.g. `sha256:86d1...`. */
export const CURRENT_RULESET_ID = typeof current.rulesetId === 'string' ? current.rulesetId : null;
