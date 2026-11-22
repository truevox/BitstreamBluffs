/* Fixed-input golden hashes for the portable math prototype (issue #121). Pure JS, no Node APIs, so the same text runs in Node and in all three
 * browser engines (engines.mjs injects it). Takes the pmath object (src/systems/pmath.js). Inputs come from an integer LCG and exact power-of-two scaling, outputs are hashed over their IEEE bits (FNV-1a),
 * so any engine-dependent last-bit difference changes the hash. DIAGNOSTIC; not the #152 contract. */
(function (root) {
  'use strict';
  function computeGolden(PM) {
    const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
    let seed = 20261122;
    const next = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return seed / 2147483648; }; // in [-1,1), exact
    const p2 = (k) => { let v = 1; if (k >= 0) for (let i = 0; i < k; i++) v *= 2; else for (let i = 0; i < -k; i++) v /= 2; return v; };
    const SC = [1, 8, 64, 1024, 131072, 1048576 * 0.5];
    const fnv = (h, v) => { if (v !== v) { h ^= 0x7ff80000; return Math.imul(h, 0x01000193); } f64[0] = v; h ^= u32[0]; h = Math.imul(h, 0x01000193); h ^= u32[1]; return Math.imul(h, 0x01000193); };
    const N = 4000, out = {};
    const run = (name, gen, fn) => { let h = 0x811c9dc5 | 0; for (let i = 0; i < N; i++) h = fnv(h, fn(...gen(i))); out[name] = (h >>> 0).toString(16).padStart(8, '0'); };
    run('sin', (i) => [next() * SC[i % 6]], PM.sin); run('cos', (i) => [next() * SC[i % 6]], PM.cos); run('tan', (i) => [next() * SC[i % 4]], PM.tan);
    run('atan', (i) => [next() * p2((i % 12) - 4)], PM.atan); run('atan2', (i) => [next() * p2((i % 9) - 3), next() * p2(((i * 7) % 9) - 3)], PM.atan2);
    run('asin', () => [next()], PM.asin); run('acos', () => [next()], PM.acos);
    run('exp', (i) => [next() * (i % 5 === 0 ? 700 : 8)], PM.exp); run('expm1', (i) => [next() * (i % 3 === 0 ? 3 : 0.3)], PM.expm1);
    run('log', (i) => [(next() + 1) * p2((i % 61) - 30)], PM.log); run('log1p', (i) => [(next() + 1) * p2((i % 31) - 20)], PM.log1p);
    const EXPS = [0.32, 0.45, 1.5, 2, 3, -2.5, 7.3, 4, 0.5];
    run('pow', (i) => [(next() + 1) * 25 + 0.01, EXPS[i % 9]], PM.pow);
    run('tanh', () => [next() * 10], PM.tanh);
    run('sinh', (i) => [next() * (i % 4 === 0 ? 700 : 6)], PM.sinh); run('cosh', (i) => [next() * (i % 4 === 0 ? 700 : 6)], PM.cosh);
    run('cbrt', (i) => [next() * p2((i % 80) - 40)], PM.cbrt); run('log2', (i) => [(next() + 1) * p2((i % 61) - 30)], PM.log2); run('log10', (i) => [(next() + 1) * p2((i % 61) - 30)], PM.log10); run('hypot', (i) => [next() * p2((i % 20) - 6), next() * p2(((i * 3) % 20) - 6)], PM.hypot);
    const SPECIAL = [0, -0, 1, -1, 0.5, Infinity, -Infinity, NaN, 1e-300, 5e-324, 1e300, 710, -746, 1e22, 1e7, 3.14159, -3.14159];
    let h = 0x811c9dc5 | 0;
    for (const op of ['sin', 'cos', 'tan', 'atan', 'asin', 'acos', 'exp', 'expm1', 'log', 'log1p', 'tanh', 'sinh', 'cosh', 'cbrt', 'log2', 'log10']) for (const x of SPECIAL) h = fnv(h, PM[op](x));
    for (const a of SPECIAL) for (const b of SPECIAL) { h = fnv(h, PM.atan2(a, b)); h = fnv(h, PM.hypot(a, b)); h = fnv(h, PM.pow(a, b)); }
    out.special = (h >>> 0).toString(16).padStart(8, '0');
    return out;
  }
  root.__PM_GOLDEN = computeGolden;
  if (typeof module !== 'undefined' && module.exports) module.exports = computeGolden;
})(typeof globalThis !== 'undefined' ? globalThis : this);
