// Derives the identity of the math library from package-lock.json: every @stdlib package in the dependency closure of the 19 direct
// `@stdlib/math-base-special-*` dependencies, with exact version and integrity (issue #121). The result is committed as
// src/systems/pmath-stdlib-lock.json, which is listed in the source tripwire (tools/ruleset/lib.mjs), so a lockfile refresh that moves ANY
// kernel changes a tripwire file and needs an attestation / SIM_REVISION decision. tests/determinism/pmath-lock.test.js recomputes it.
//   node tools/determinism/portable-math/stdlib-lock.mjs --write     rewrite src/systems/pmath-stdlib-lock.json
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const LOCK_JSON = 'src/systems/pmath-stdlib-lock.json';

export function computeStdlibLock(rootDir = root) {
  const pkg = JSON.parse(fs.readFileSync(path.join(rootDir, 'package.json'), 'utf8'));
  const lock = JSON.parse(fs.readFileSync(path.join(rootDir, 'package-lock.json'), 'utf8'));
  const direct = Object.fromEntries(Object.entries({ ...pkg.dependencies, ...pkg.devDependencies }).filter(([n]) => n.startsWith('@stdlib/math-base-special-')).sort());
  const resolve = (from, name) => { // nearest node_modules/<name> entry, like Node resolution applied to the lockfile's package paths
    let base = from;
    for (;;) { const key = `${base ? base + '/' : ''}node_modules/${name}`; if (lock.packages[key]) return key; if (!base) return null; const i = base.lastIndexOf('/node_modules/'); base = i < 0 ? '' : base.slice(0, i); }
  };
  const seen = new Map(); const queue = Object.keys(direct).map((n) => resolve('', n));
  while (queue.length) {
    const key = queue.pop(); if (!key || seen.has(key)) continue;
    const e = lock.packages[key]; seen.set(key, e);
    for (const dep of Object.keys({ ...e.dependencies, ...e.optionalDependencies })) queue.push(resolve(key, dep));
  }
  const packages = [...seen.entries()].map(([key, e]) => ({ name: key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length), version: e.version, integrity: e.integrity, resolved: e.resolved }))
    .filter((p) => p.name.startsWith('@stdlib/')).sort((a, b) => (a.name + a.version < b.name + b.version ? -1 : 1));
  const digest = 'sha256:' + crypto.createHash('sha256').update(packages.map((p) => `${p.name}@${p.version} ${p.integrity}\n`).join('')).digest('hex');
  return { format: 'bb-pmath-stdlib-lock', formatVersion: 1, note: 'Derived from package-lock.json by tools/determinism/portable-math/stdlib-lock.mjs; a tripwire file (a change needs an attestation or SIM_REVISION bump).', direct, packageCount: packages.length, digest, packages };
}
if (process.argv.includes('--write')) {
  const r = computeStdlibLock(); fs.writeFileSync(path.join(root, LOCK_JSON), JSON.stringify(r, null, 1) + '\n'); console.log(`${LOCK_JSON}: ${r.packageCount} packages, ${r.digest}`);
}
