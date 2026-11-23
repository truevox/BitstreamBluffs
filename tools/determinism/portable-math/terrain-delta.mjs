// How different is generated terrain under pmath vs the native Math (issue #121)? Dumps chunks 0..N for a few seeds/masks as JSON; run it in a
// tree with native Math (origin/main before #121) and in this tree, then compare:
//   node terrain-delta.mjs dump out.json   |   node terrain-delta.mjs compare native.json pmath.json
// Structural fields (counts, ids, kinds, flags) must be identical; numbers may differ in the last bits only. DIAGNOSTIC.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [cmd, a, b] = process.argv.slice(2);
if (cmd === 'dump') {
  const root = process.env.TREE || process.cwd();
  const { makeGen } = await import(pathToFileURL(path.join(root, 'tests/src/_helpers.js')).href);
  const out = {};
  for (const mask of [0, 1, 4, 64, 2047]) for (const seed of ['alpha', 'beta', 'swell', 'gamma7']) {
    const g = makeGen(seed, { biomeMask: mask }); const chunks = [];
    for (let i = 0; i < 300; i++) chunks.push(JSON.parse(JSON.stringify(g.getChunk(i))));
    out[`${mask}/${seed}`] = chunks;
  }
  fs.writeFileSync(a, JSON.stringify(out));
} else {
  const A = JSON.parse(fs.readFileSync(a, 'utf8')), B = JSON.parse(fs.readFileSync(b, 'utf8'));
  let nums = 0, differing = 0, maxAbs = 0, maxRel = 0, structural = 0;
  const walk = (x, y) => {
    if (typeof x === 'number' && typeof y === 'number') { nums++; if (x !== y) { differing++; const d = Math.abs(x - y); maxAbs = Math.max(maxAbs, d); maxRel = Math.max(maxRel, d / Math.max(Math.abs(x), 1e-300)); } return; }
    if (Array.isArray(x) && Array.isArray(y)) { if (x.length !== y.length) { structural++; return; } x.forEach((v, i) => walk(v, y[i])); return; }
    if (x && y && typeof x === 'object' && typeof y === 'object') { const kx = Object.keys(x), ky = Object.keys(y); if (kx.join() !== ky.join()) { structural++; return; } for (const k of kx) walk(x[k], y[k]); return; }
    if (x !== y) structural++;
  };
  for (const k of Object.keys(A)) walk(A[k], B[k]);
  console.log(JSON.stringify({ numbers: nums, differingNumbers: differing, maxAbs, maxRel, structuralDifferences: structural }));
}
