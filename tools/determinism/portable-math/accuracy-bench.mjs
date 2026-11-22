// Accuracy (ulp vs the host's native Math, which is itself <= ~1 ulp from the true value) and speed of the portable candidates.
// Run: node tools/determinism/portable-math/accuracy-bench.mjs [--json out.json]. DIAGNOSTIC; Node/V8 only.

import { writeFileSync } from 'node:fs';
import PM from '../../../src/systems/pmath.js';
const f = new Float64Array(2), u = new BigInt64Array(f.buffer);
const ulp = (a, b) => { if (a === b) return 0; if (a !== a || b !== b) return (a !== a && b !== b) ? 0 : Infinity; f[0] = a; f[1] = b; if ((a < 0) !== (b < 0)) return Infinity; const d = u[0] - u[1]; return Number(d < 0n ? -d : d); };
let seed = 12345; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
const N = 200000;
const domains = {
  sin: () => (rnd() - 0.5) * 80, cos: () => (rnd() - 0.5) * 80, tan: () => (rnd() - 0.5) * 20, atan: () => (rnd() - 0.5) * 40,
  exp: () => (rnd() - 0.5) * 40, expm1: () => (rnd() - 0.5) * 4, log: () => Math.exp((rnd() - 0.5) * 40), log1p: () => rnd() * 30, tanh: () => (rnd() - 0.5) * 8,
};
const out = {};
function stat(name, gen, nat, pm, arity = 1) {
  const h = { 0: 0, 1: 0, 2: 0, big: 0 }; let max = 0, n = 0;
  for (let i = 0; i < N; i++) { const a = []; for (let k = 0; k < arity; k++) a.push(gen()); const d = ulp(nat(...a), pm(...a)); max = Math.max(max, d); h[d <= 2 ? d : 'big']++; n++; }
  out[name] = { samples: n, exact: h[0] / n, le1: (h[0] + h[1]) / n, le2: (h[0] + h[1] + h[2]) / n, maxUlp: max };
}
for (const k of Object.keys(domains)) stat(k, domains[k], Math[k], PM[k]);
stat('atan2', () => (rnd() - 0.5) * 200, Math.atan2, PM.atan2, 2);
stat('hypot', () => (rnd() - 0.5) * 2000, Math.hypot, PM.hypot, 2);
{ const g = () => rnd() * 20; stat('pow(x,0.45)', g, (x) => Math.pow(x, 0.45), (x) => PM.pow(x, 0.45)); stat('pow(x,1.5)', g, (x) => Math.pow(x, 1.5), (x) => PM.pow(x, 1.5)); stat('pow(x,3)', g, (x) => Math.pow(x, 3), (x) => PM.pow(x, 3)); stat('pow(0.5..2,y 0..20 non-int)', () => 0.5 + rnd() * 1.5, (x) => Math.pow(x, 7.3), (x) => PM.pow(x, 7.3)); }
// speed (ns/call), averaged over a fixed argument array to defeat constant folding
const xs = Float64Array.from({ length: 4096 }, () => (rnd() - 0.5) * 20), ys = Float64Array.from({ length: 4096 }, () => 0.1 + rnd() * 20);
function bench(name, fn) { let s = 0; for (let w = 0; w < 50; w++) for (let i = 0; i < 4096; i++) s += fn(xs[i], ys[i]); const t0 = process.hrtime.bigint(); const R = 2000; for (let r = 0; r < R; r++) for (let i = 0; i < 4096; i++) s += fn(xs[i], ys[i]); const ns = Number(process.hrtime.bigint() - t0) / (R * 4096); return [ns, s]; }
const speed = {};
for (const k of ['sin', 'cos', 'tan', 'atan', 'atan2', 'exp', 'log', 'tanh', 'hypot', 'pow']) {
  const nat = k === 'pow' ? (a, b) => Math.pow(ys[0] + Math.abs(a), 0.45) : k === 'atan2' || k === 'hypot' ? (a, b) => Math[k](a, b) : (a) => Math[k](k === 'log' ? Math.abs(a) + 0.1 : a);
  const pm = k === 'pow' ? (a, b) => PM.pow(ys[0] + Math.abs(a), 0.45) : k === 'atan2' || k === 'hypot' ? (a, b) => PM[k](a, b) : (a) => PM[k](k === 'log' ? Math.abs(a) + 0.1 : a);
  speed[k] = { nativeNs: +bench(k, nat)[0].toFixed(1), portableNs: +bench(k, pm)[0].toFixed(1) };
}
const res = { node: process.version, N, accuracy: out, speed };
console.log(JSON.stringify(res, null, 1));
const i = process.argv.indexOf('--json'); if (i > 0) writeFileSync(process.argv[i + 1], JSON.stringify(res, null, 1));
