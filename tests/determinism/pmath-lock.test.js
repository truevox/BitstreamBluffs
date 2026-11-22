// Issue #121: the identity of the math library is pinned, and a change to it fails loudly. pmath.js is a facade over @stdlib/math-base-special-*;
// the bits it returns depend on those packages AND on their transitive kernels (kernel-sin, rempio2, ...), which the stdlib package.json files
// only constrain with caret ranges. So: (1) the 19 direct packages are exact in package.json and the lockfile; (2) every @stdlib package in
// the lockfile closure has an exact version, a sha512 integrity and a registry URL; (3) every package the code can actually reach at runtime is
// in that closure and installed at the locked version; (4) the closure's digest is committed in src/systems/pmath-stdlib-lock.json, which is a
// source-tripwire file, so a lockfile refresh that moves any kernel needs an attestation (and normally a SIM_REVISION bump).
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { computeStdlibLock, LOCK_JSON } from '../../tools/determinism/portable-math/stdlib-lock.mjs';
import { TRIPWIRE_FILES } from '../../tools/ruleset/lib.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const json = (f) => JSON.parse(fs.readFileSync(path.join(root, f), 'utf8'));
const pkg = json('package.json'), lock = json('package-lock.json'), committed = json(LOCK_JSON);
const SEMVER = /^\d+\.\d+\.\d+$/;
const pmathText = fs.readFileSync(path.join(root, 'src/systems/pmath.js'), 'utf8');
const imported = [...pmathText.matchAll(/from '(@stdlib\/[^']+)'/g)].map((m) => m[1]).sort();

describe('direct pins', () => {
  test('pmath.js imports exactly the 19 math packages, and package.json lists exactly those as exact versions', () => {
    expect(imported).toHaveLength(19);
    expect(Object.keys(committed.direct)).toEqual(imported);
    for (const n of imported) {
      expect(pkg.devDependencies[n]).toMatch(SEMVER); // no ^ or ~
      expect(lock.packages[''].devDependencies[n]).toBe(pkg.devDependencies[n]);
      expect(lock.packages[`node_modules/${n}`].version).toBe(pkg.devDependencies[n]);
    }
    expect(Object.keys(pkg.devDependencies).filter((n) => n.startsWith('@stdlib/')).sort()).toEqual(imported);
  });
});

describe('the whole @stdlib closure is pinned with integrity', () => {
  test('every package in the lockfile closure has an exact version, a sha512 integrity and a registry URL', () => {
    expect(committed.packages.length).toBeGreaterThanOrEqual(90);
    for (const p of committed.packages) {
      expect(p.version).toMatch(SEMVER);
      expect(p.integrity).toMatch(/^sha512-[A-Za-z0-9+/]+=*$/);
      expect(p.resolved).toMatch(/^https:\/\/registry\.npmjs\.org\/@stdlib\//);
    }
  });
  test('the committed manifest equals a fresh derivation from package-lock.json (so a lockfile change must update it)', () => {
    expect(computeStdlibLock(root)).toEqual(committed);
    expect(committed.digest).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
  test('the manifest is a source-tripwire file', () => { expect(TRIPWIRE_FILES).toContain(LOCK_JSON); });
});

describe('what the code can reach at runtime is inside that closure and installed at the locked version', () => {
  const nm = path.join(root, 'node_modules');
  const closure = new Map(committed.packages.map((p) => [p.name, p.version]));
  const seen = new Set(), files = new Set();
  const resolveFile = (from, req) => { const base = path.resolve(path.dirname(from), req); for (const c of [base, `${base}.js`, path.join(base, 'index.js')]) if (fs.existsSync(c) && fs.statSync(c).isFile()) return c; return null; };
  const visitFile = (f) => { if (files.has(f)) return; files.add(f); const s = fs.readFileSync(f, 'utf8'); for (const m of s.matchAll(/require\(\s*'([^']+)'\s*\)/g)) { if (m[1].startsWith('.')) { const x = resolveFile(f, m[1]); if (x) visitFile(x); } else visitPkg(m[1]); } };
  const visitPkg = (name) => { if (seen.has(name)) return; seen.add(name); const dir = path.join(nm, name); if (!fs.existsSync(path.join(dir, 'package.json'))) { seen.add(`MISSING:${name}`); return; } const pj = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')); const entry = resolveFile(path.join(dir, 'package.json'), pj.main || './index.js'); if (entry) visitFile(entry); };
  imported.forEach(visitPkg);
  const reachable = [...seen].filter((n) => !n.startsWith('MISSING:') && fs.existsSync(path.join(nm, n, 'package.json')));
  test('reachable packages are all @stdlib, none missing, and a sensible number', () => {
    expect(reachable.filter((n) => !n.startsWith('@stdlib/'))).toEqual([]);
    expect([...seen].filter((n) => n.startsWith('MISSING:')).filter((n) => !/number-float64-base-to-uint32/.test(n))).toEqual([]); // that one is only named in a doc comment (a `require` inside a JSDoc example)
    expect(reachable.length).toBeGreaterThan(60);
  });
  test('each reachable package is in the pinned closure and installed at exactly the locked version', () => {
    for (const n of reachable) {
      expect(closure.has(n)).toBe(true);
      expect(JSON.parse(fs.readFileSync(path.join(nm, n, 'package.json'), 'utf8')).version).toBe(closure.get(n));
    }
  });
});
