// Bundles src/systems/pmath.js (the @stdlib facade) into a plain script that sets globalThis.__PM, for page.addInitScript / addScriptTag
// in the browser experiments (no bundler in the page). Used by experiment.mjs, engines.mjs and attribution.mjs. DIAGNOSTIC tooling.
import { buildSync } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const src = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'src', 'systems', 'pmath.js');
export function pmathScript() {
  const r = buildSync({ entryPoints: [src], bundle: true, format: 'iife', globalName: '__PMNS', minify: true, write: false, logLevel: 'warning' });
  return `${r.outputFiles[0].text}\nglobalThis.__PM = __PMNS.default;`;
}
