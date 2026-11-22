/**
 * The ruleset of the running build, for the live evidence path (#116). Uses Vite (`import.meta.glob` + JSON import), so
 * like src/data/index.js it is NOT importable from Jest; only src/services.js imports it. The committed artifact
 * (tools/ruleset/current.json + archive/<hex>.json, #123) is what CI proves equal to a fresh assembly of this source tree
 * (`node tools/ruleset/build-ruleset.mjs --check`), so the game does not re-assemble it (the assembly needs source text
 * of several files, which the browser bundle does not carry). The loaded bytes are re-hashed against the pointer.
 */
import current from '../../../tools/ruleset/current.json';
import { digestOf } from './canonicalSha256.js';

const archive = import.meta.glob('../../../tools/ruleset/archive/*.json', { import: 'default' });

/**
 * @returns {Promise<{doc:object, rulesetId:string}>}
 * @throws when the archive file is missing or does not hash to the id in current.json
 */
export async function loadCurrentRuleset() {
  const hex = String(current.rulesetId).replace(/^sha256:/, '');
  const key = Object.keys(archive).find((k) => k.endsWith(`/${hex}.json`));
  if (!key) throw new Error(`ruleset archive file for ${current.rulesetId} is not in this build`);
  const doc = await archive[key]();
  if (digestOf(doc) !== current.rulesetId) throw new Error(`ruleset archive ${hex} does not hash to its name`);
  return { doc, rulesetId: current.rulesetId };
}
