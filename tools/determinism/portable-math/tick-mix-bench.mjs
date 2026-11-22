// Per-tick cost of the portable ops at the REAL in-simTick op mix measured in the corpus (30860 ticks: sin 39.8, cos 39.2, atan2 6.2, hypot 13.0,
// exp 3.2, pow 1.2, tan 0.25, log 0.05, tanh 0.09 calls per tick). Interleaved native/portable batches, median of 15. Node/V8 only. DIAGNOSTIC.

import PM from '../../../src/systems/pmath.js';
const MIX = [['sin', 40], ['cos', 39], ['atan2', 6], ['hypot', 13], ['exp', 3], ['pow', 1], ['tan', 1]];
const xs = Float64Array.from({ length: 1024 }, (_, i) => Math.sin(i * 0.37) * 6), ys = Float64Array.from({ length: 1024 }, (_, i) => 1 + Math.abs(Math.cos(i * 0.91)) * 9);
const mk = (M) => (n) => { let s = 0, j = 0; for (let t = 0; t < n; t++) for (const [op, c] of MIX) for (let k = 0; k < c; k++) { const x = xs[j & 1023], y = ys[(j++ * 7) & 1023]; s += op === 'atan2' || op === 'hypot' || op === 'pow' ? M[op](x, y > 4 ? 1.5 : y) : M[op](x); } return s; };
const nat = mk(Math), prt = mk(PM); nat(2000); prt(2000);
const med = (a) => a.sort((x, y) => x - y)[a.length >> 1], N = 20000, A = [], B = [];
for (let r = 0; r < 15; r++) { let t0 = process.hrtime.bigint(); nat(N); A.push(Number(process.hrtime.bigint() - t0) / N / 1000); t0 = process.hrtime.bigint(); prt(N); B.push(Number(process.hrtime.bigint() - t0) / N / 1000); }
console.log(JSON.stringify({ node: process.version, callsPerTick: MIX.reduce((s, m) => s + m[1], 0), nativeUsPerTick: +med(A).toFixed(2), portableUsPerTick: +med(B).toFixed(2), deltaUsPerTick: +(med(B) - med(A)).toFixed(2) }));
