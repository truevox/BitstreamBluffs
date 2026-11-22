// Issue #121: unit test for pmath (src/systems/pmath.js), the portable math every authoritative simulation file uses. Accuracy bounds are measured against the host Math (V8 under Jest) and are deliberately a little looser than the
// measured maxima so a different V8 libm does not make the test flaky; the engine-independence claim is the golden hash, which engines.mjs
// also checks in chromium, firefox and webkit.
import fs from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
import PM from '../../src/systems/pmath.js';
const golden = require('../../tools/determinism/portable-math/golden.cjs');
const expected = JSON.parse(fs.readFileSync(new URL('../../docs/determinism/results/portable-math-golden.json', import.meta.url), 'utf8'));

const f = new Float64Array(2), u = new BigInt64Array(f.buffer);
const ulp = (a, b) => { if (a === b) return 0; if (a !== a || b !== b) return a !== a && b !== b ? 0 : Infinity; if ((a < 0) !== (b < 0)) return Infinity; f[0] = a; f[1] = b; const d = u[0] - u[1]; return Number(d < 0n ? -d : d); };
let seed = 777;
const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
function maxUlp(gen, nat, pm, arity = 1, n = 20000) { let m = 0; for (let i = 0; i < n; i++) { const a = Array.from({ length: arity }, gen); m = Math.max(m, ulp(nat(...a), pm(...a))); } return m; }

describe('pmath: accuracy vs host Math (ulp)', () => {
  const R = (s) => () => (rnd() - 0.5) * s;
  test.each([
    ['sin', R(80), 1], ['cos', R(80), 1], ['sin small args', R(2e5), 2], ['cos small args', R(2e5), 2], ['tan', R(20), 4], ['atan', R(40), 1], ['asin', () => rnd() * 2 - 1, 3], ['acos', () => rnd() * 2 - 1, 3],
    ['exp', R(40), 1], ['expm1', R(4), 6], ['sinh', R(10), 6], ['cosh', R(10), 4], ['cbrt', R(2000), 3], ['log2', () => Math.exp((rnd() - 0.5) * 40), 3], ['log10', () => Math.exp((rnd() - 0.5) * 40), 3], ['log', () => Math.exp((rnd() - 0.5) * 40), 1], ['log1p', () => rnd() * 30, 3], ['tanh', R(8), 6],
  ])('%s', (name, gen, bound) => { const fn = name.split(' ')[0]; expect(maxUlp(gen, Math[fn], PM[fn])).toBeLessThanOrEqual(bound); });
  test('atan2, hypot', () => {
    expect(maxUlp(R(200), Math.atan2, PM.atan2, 2)).toBeLessThanOrEqual(1);
    expect(maxUlp(R(2000), Math.hypot, PM.hypot, 2)).toBeLessThanOrEqual(3);
  });
  test('pow: integer exponents (what the sim uses) and non-integer exponents (looser)', () => {
    expect(maxUlp(() => rnd() * 20, (x) => Math.pow(x, 3), (x) => PM.pow(x, 3))).toBeLessThanOrEqual(3);
    expect(maxUlp(() => rnd() * 20, (x) => Math.pow(x, 0.32), (x) => PM.pow(x, 0.32))).toBeLessThanOrEqual(4);
    expect(maxUlp(() => rnd() * 20, (x) => Math.pow(x, 0.45), (x) => PM.pow(x, 0.45))).toBeLessThanOrEqual(4);
    expect(maxUlp(() => 0.5 + rnd() * 1.5, (x) => Math.pow(x, 7.3), (x) => PM.pow(x, 7.3))).toBeLessThanOrEqual(12);
  });
});

describe('pmath: special values and range limits', () => {
  test('signs, zeros, infinities, NaN', () => {
    expect(Object.is(PM.sin(-0), -0)).toBe(true);
    expect(PM.sin(Infinity)).toBeNaN(); expect(PM.cos(NaN)).toBeNaN(); expect(PM.atan2(NaN, 1)).toBeNaN();
    expect(Object.is(PM.atan2(-0, 1), -0)).toBe(true); expect(PM.atan2(0, -1)).toBe(Math.PI); expect(PM.atan2(-0, -1)).toBe(-Math.PI);
    expect(PM.atan2(1, 0)).toBe(Math.PI / 2); expect(PM.atan2(-1, -Infinity)).toBe(-Math.PI);
    expect(PM.exp(710)).toBe(Infinity); expect(PM.exp(-746)).toBe(0); expect(PM.exp(0)).toBe(1);
    expect(PM.log(0)).toBe(-Infinity); expect(PM.log(-1)).toBeNaN(); expect(PM.log(1)).toBe(0);
    expect(PM.acos(1)).toBe(0); expect(PM.acos(-1)).toBe(Math.PI); expect(PM.acos(2)).toBeNaN(); expect(PM.asin(0.5)).toBeCloseTo(Math.PI / 6, 15);
    expect(PM.hypot(3, 4)).toBe(5); expect(PM.hypot(1e200, 1e200)).toBeCloseTo(1.4142135623730951e200, -185); expect(PM.hypot(NaN, Infinity)).toBe(Infinity);
    expect(PM.pow(2, 10)).toBe(1024); expect(PM.pow(9, 0.5)).toBe(3); expect(PM.pow(5, 0)).toBe(1);
  });
  test('reachable range: error stays <= 2 ulp below 1e6 rad, degrades beyond 1.6e6 rad (documented, deterministic)', () => {
    expect(maxUlp(() => (rnd() - 0.5) * 2e6, Math.sin, PM.sin, 1, 20000)).toBeLessThanOrEqual(2);
    const rel = (x) => Math.abs(PM.sin(x) - Math.sin(x)) / Math.abs(Math.sin(x));
    expect(rel(1e7)).toBeLessThan(1e-7); // measured 2.8e-9
    expect(rel(1e15)).toBeGreaterThan(1e-4); // measured ~1e-2: the huge-argument branch is NOT accurate
    expect(PM.sin(1e22)).toBe(0); // measured: documented degradation, identical in every engine
    expect(PM.sin(1e7)).toBe(PM.sin(1e7));
  });
});

describe('pmath: golden hashes (engine-independence check, also run by engines.mjs in chromium/firefox/webkit)', () => {
  test('fixed-input hashes equal the committed values', () => { expect(golden(PM)).toEqual(expected); });
});
