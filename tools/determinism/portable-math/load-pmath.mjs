// Turns src/systems/pmath.js (ESM, the production module) into a plain script that sets globalThis.__PM, for page.addInitScript / addScriptTag
// in the browser experiments (no bundler, no import). Used by experiment.mjs and engines.mjs. DIAGNOSTIC tooling.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'systems', 'pmath.js');
export function pmathScript() {
  let t = readFileSync(src, 'utf8');
  t = t.replace(/^export default pmath;\s*$/m, '').replace(/^export \{[^}]*\};\s*$/m, '').replace(/^export const pmath/m, 'const pmath');
  if (/^\s*(import|export)\s/m.test(t)) throw new Error('pmath.js must stay a self-contained module of plain declarations');
  return `(() => {\n${t}\nglobalThis.__PM = pmath;\n})();`;
}
