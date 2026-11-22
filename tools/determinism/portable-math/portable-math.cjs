/* EXPERIMENT (issue #121, Phase A): candidate portable replacements for the non-IEEE-exact Math functions.
 * DIAGNOSTIC / PROTOTYPE ONLY. Not wired into the game. Pure IEEE-754 double arithmetic: + - * / sqrt, floor, abs,
 * comparisons and typed-array bit casts only (all exactly specified by ECMAScript), so every engine computes the
 * same bits as long as it does not fuse multiply-add (ECMAScript forbids it). Algorithms follow the public-domain
 * fdlibm/msun kernels; accuracy is measured by tools/determinism/portable-math/accuracy-bench.mjs, not assumed.
 * Loaded as a plain script in the page (sets globalThis.__PM) and via require() in Node. */
(function (root) {
  'use strict';
  const abs = Math.abs, floor = Math.floor, sqrt = Math.sqrt; // exactly specified operations
  const f64 = new Float64Array(1), u32 = new Uint32Array(f64.buffer);
  const LE = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1, HI = LE ? 1 : 0, LO = LE ? 0 : 1;
  const PI = 3.141592653589793, PIO2 = 1.5707963267948966, PI_LO = 1.2246467991473532e-16;
  const trunc = (x) => (x < 0 ? -floor(-x) : floor(x));

  // ---- sin / cos / tan -----------------------------------------------------------------------
  const invpio2 = 6.36619772367581382433e-01, pio2_1 = 1.57079632673412561417e+00, pio2_1t = 6.07710050650619224932e-11,
    pio2_2 = 6.07710050630396597660e-11, pio2_2t = 2.02226624879595063154e-21, pio2_3 = 2.02226624871116645580e-21, pio2_3t = 8.47842766036889956997e-32;
  const S1 = -1.66666666666666324348e-01, S2 = 8.33333333332248946124e-03, S3 = -1.98412698298579493134e-04,
    S4 = 2.75573137070700676789e-06, S5 = -2.50507602534068634195e-08, S6 = 1.58969099521155010221e-10;
  const C1 = 4.16666666666666019037e-02, C2 = -1.38888888888741095749e-03, C3 = 2.48015872894767294178e-05,
    C4 = -2.75573143513906633035e-07, C5 = 2.08757232129817482790e-09, C6 = -1.13596475577881948265e-11;
  function ksin(x, y) { const z = x * x, v = z * x, r = S2 + z * (S3 + z * (S4 + z * (S5 + z * S6))); return x - ((z * (0.5 * y - v * r) - y) - v * S1); }
  function kcos(x, y) {
    const z = x * x, r = z * (C1 + z * (C2 + z * (C3 + z * (C4 + z * (C5 + z * C6)))));
    const ax = abs(x);
    if (ax < 0.3) return 1 - (0.5 * z - (z * r - x * y));
    const qx = ax > 0.78125 ? 0.28125 : floor(ax * 4) / 16; // exact value <= ax/4
    const hz = 0.5 * z - qx, a = 1 - qx;
    return a - (hz - (z * r - x * y));
  }
  // Returns quadrant n (mod 4) and sets RY0/RY1 (reduced argument as head + tail). |x| < 2^20*pi/2 uses the 3-part Cody-Waite
  // reduction; larger arguments use a slower but still deterministic multi-pass reduction (degraded, see the huge-argument branch).
  let RY0 = 0, RY1 = 0;
  function reduce(x) {
    if (abs(x) <= 0.7853981633974483) { RY0 = x; RY1 = 0; return 0; }
    const ax = abs(x); let n;
    if (ax < 1.6471e6) {
      n = floor(ax * invpio2 + 0.5);
      let t = ax - n * pio2_1, r, w = n * pio2_2; r = t - w; w = n * pio2_2t - ((t - r) - w); // pass 2 (pass 1 residue is exact)
      t = r; w = n * pio2_3; r = t - w; w = n * pio2_3t - ((t - r) - w); // pass 3
      const y0 = r - w;
      RY0 = y0; RY1 = (r - y0) - w;
    } else { // huge: deterministic but DEGRADED two-stage reduction, no true Payne-Hanek: measured relative error sin(1e7) 2.8e-9, sin(1e9) 2.4e-8, sin(1e15) ~1e-2, sin(1e22) returns 0. Identical in every engine; the game never gets near it (corpus max |body.angle| 3.4 rad; 1.6e6 rad is hours of continuous spin)
      const twopi = 2 * PI; let r = ax - floor(ax / twopi) * twopi;
      n = floor(r * invpio2 + 0.5); r = r - n * PIO2; RY0 = r; RY1 = 0;
    }
    if (x < 0) { RY0 = -RY0; RY1 = -RY1; n = -n; }
    return ((n % 4) + 4) % 4;
  }
  function sin(x) {
    if (x !== x || x === Infinity || x === -Infinity) return NaN;
    if (abs(x) < 3.725290298461914e-9) return x;
    const n = reduce(x);
    switch (n) { case 0: return ksin(RY0, RY1); case 1: return kcos(RY0, RY1); case 2: return -ksin(RY0, RY1); default: return -kcos(RY0, RY1); }
  }
  function cos(x) {
    if (x !== x || x === Infinity || x === -Infinity) return NaN;
    if (abs(x) < 1.4901161193847656e-8) return 1;
    const n = reduce(x);
    switch (n) { case 0: return kcos(RY0, RY1); case 1: return -ksin(RY0, RY1); case 2: return -kcos(RY0, RY1); default: return ksin(RY0, RY1); }
  }
  function tan(x) { // sin/cos from one reduction; ~2 ulp (documented), deterministic
    if (x !== x || x === Infinity || x === -Infinity) return NaN;
    if (abs(x) < 3.725290298461914e-9) return x;
    const n = reduce(x), s = ksin(RY0, RY1), c = kcos(RY0, RY1);
    return (n & 1) ? -c / s : s / c;
  }

  // ---- atan / atan2 ----------------------------------------------------------------------------
  const atanhi = [4.63647609000806093515e-01, 7.85398163397448278999e-01, 9.82793723247329054082e-01, 1.57079632679489655800e+00];
  const atanlo = [2.26987774529616870924e-17, 3.06161699786838301793e-17, 1.39033110312309984516e-17, 6.12323399573676603587e-17];
  const aT = [3.33333333333329318027e-01, -1.99999999998764832476e-01, 1.42857142725034663711e-01, -1.11111104054623557880e-01,
    9.09088713343650656196e-02, -7.69187620504482999495e-02, 6.66107313738753120669e-02, -5.83357013379057348645e-02,
    4.97687799461593236017e-02, -3.65315727442169155270e-02, 1.62858201153657823623e-02];
  function atan(x) {
    if (x !== x) return NaN;
    const neg = x < 0; let a = neg ? -x : x, id;
    if (a === Infinity) return neg ? -atanhi[3] - atanlo[3] : atanhi[3] + atanlo[3];
    if (a < 0.4375) { if (a < 3.725290298461914e-9) return x; id = -1; }
    else if (a < 1.1875) { if (a < 0.6875) { id = 0; a = (2 * a - 1) / (2 + a); } else { id = 1; a = (a - 1) / (a + 1); } }
    else if (a < 2.4375) { id = 2; a = (a - 1.5) / (1 + 1.5 * a); }
    else { id = 3; a = -1 / a; }
    const z = a * a, w = z * z;
    const s1 = z * (aT[0] + w * (aT[2] + w * (aT[4] + w * (aT[6] + w * (aT[8] + w * aT[10])))));
    const s2 = w * (aT[1] + w * (aT[3] + w * (aT[5] + w * (aT[7] + w * aT[9]))));
    if (id < 0) { const r = a - a * (s1 + s2); return neg ? -r : r; }
    const r = atanhi[id] - ((a * (s1 + s2) - atanlo[id]) - a);
    return neg ? -r : r;
  }
  const isNegZero = (v) => v === 0 && 1 / v < 0;
  function atan2(y, x) {
    if (x !== x || y !== y) return NaN;
    const sx = x < 0 || isNegZero(x), sy = y < 0 || isNegZero(y);
    const ax = abs(x), ay = abs(y);
    if (ay === 0) return sx ? (sy ? -PI : PI) : (sy ? -0 : 0);
    if (ax === 0) return sy ? -PIO2 : PIO2;
    if (ax === Infinity) { if (ay === Infinity) { const q = sx ? 3 * PI / 4 : PI / 4; return sy ? -q : q; } return sx ? (sy ? -PI : PI) : (sy ? -0 : 0); }
    if (ay === Infinity) return sy ? -PIO2 : PIO2;
    let z;
    if (ay / ax > 1e18) z = PIO2 + 0.5 * PI_LO; else if (sx && ay / ax < 1e-18) z = 0; else z = atan(ay / ax);
    if (!sx) return sy ? -z : z;
    const r = PI - (z - PI_LO);
    return sy ? -r : r;
  }

  // ---- exp / expm1 / log / log1p / pow / tanh ----------------------------------------------------
  const ln2HI = 6.93147180369123816490e-01, ln2LO = 1.90821492927058770002e-10, invln2 = 1.44269504088896338700e+00;
  const P1 = 1.66666666666666019037e-01, P2 = -2.77777777770155933842e-03, P3 = 6.61375632143793436117e-05, P4 = -1.65339022054652515390e-06, P5 = 4.13813679705723846039e-08;
  function pow2(k) { u32[HI] = (k + 1023) << 20; u32[LO] = 0; return f64[0]; } // exact 2^k, k in [-1022,1023]
  function scalbn(y, k) {
    while (k > 1023) { y *= pow2(1023); k -= 1023; }
    while (k < -1022) { y *= pow2(-1022); k += 1022; }
    return y * pow2(k);
  }
  function exp(x) {
    if (x !== x) return NaN;
    if (x > 709.782712893384) return Infinity;
    if (x < -745.1332191019411) return 0;
    if (abs(x) < 3.725290298461914e-9) return 1 + x;
    let k = 0, hi = x, lo = 0;
    if (abs(x) > 0.34657359027997264) {
      k = trunc(invln2 * x + (x < 0 ? -0.5 : 0.5)); hi = x - k * ln2HI; lo = k * ln2LO;
    }
    const r = hi - lo, t = r * r, c = r - t * (P1 + t * (P2 + t * (P3 + t * (P4 + t * P5))));
    const y = 1 - ((lo - (r * c) / (2 - c)) - hi);
    return k === 0 ? y : scalbn(y, k);
  }
  function expm1(x) {
    if (x !== x) return NaN;
    if (abs(x) < 0.34657359027997264) { // Taylor, no cancellation for small |x|
      if (abs(x) < 1.1102230246251565e-16) return x;
      let term = x, sum = x; for (let i = 2; i <= 22; i++) { term = term * x / i; sum += term; } return sum;
    }
    return exp(x) - 1;
  }
  function log(x) {
    if (x !== x || x < 0) return NaN;
    if (x === 0) return -Infinity; if (x === Infinity) return Infinity;
    let k = 0;
    if (x < 2.2250738585072014e-308) { x *= 18014398509481984; k = -54; }
    f64[0] = x; let hx = u32[HI]; k += (hx >> 20) - 1023; hx &= 0x000fffff;
    const i = (hx + 0x95f64) & 0x100000; u32[HI] = hx | (i ^ 0x3ff00000); k += i >> 20;
    const m = f64[0]; // u32[LO] preserved from x
    const f = m - 1;
    if (abs(f) < 3.725290298461914e-9 && k === 0) return f - 0.5 * f * f; // |f|<2^-28 region (only reachable for x==1 exactly -> 0)
    const s = f / (2 + f), z = s * s, w = z * z;
    const t1 = w * (3.999999999940941908e-01 + w * (2.222219843214978396e-01 + w * 1.531383769920937332e-01));
    const t2 = z * (6.666666666666735130e-01 + w * (2.857142874366239149e-01 + w * (1.818357216161805012e-01 + w * 1.479819860511658591e-01)));
    const R = t2 + t1, hfsq = 0.5 * f * f;
    return k * ln2HI - ((hfsq - (s * (hfsq + R) + k * ln2LO)) - f);
  }
  function log1p(x) { if (x !== x || x < -1) return NaN; if (x === -1) return -Infinity; if (x === Infinity) return Infinity; const u = 1 + x; return u === 1 ? x : log(u) * x / (u - 1); }
  function pow(x, y) {
    if (y === 0) return 1; if (x === 1) return 1; if (x !== x || y !== y) return NaN;
    if (y === 1) return x;
    if (y === 0.5 && x >= 0 && x !== Infinity) return sqrt(x); // sqrt is correctly rounded
    if (y === floor(y) && abs(y) <= 1024) { // repeated squaring: deterministic (<= ~log2|y| ulp)
      let r = 1, b = x, e = abs(y); while (e > 0) { if (e % 2 === 1) r *= b; b *= b; e = floor(e / 2); } return y < 0 ? 1 / r : r;
    }
    if (x < 0) return NaN; // non-integer power of a negative base
    if (x === 0) return y > 0 ? 0 : Infinity;
    if (x === Infinity) return y > 0 ? Infinity : 0;
    return exp(y * log(x)); // error grows with |y*log x| (~|y log x| * 1.1e-16 relative); documented
  }
  function tanh(x) {
    if (x !== x) return NaN;
    const a = abs(x); let r;
    if (a > 22) r = 1; else if (a < 5.551115123125783e-17) return x; else { const t = expm1(2 * a); r = t / (t + 2); }
    return x < 0 ? -r : r;
  }
  function hypot() { // sqrt of sum of squares, power-of-two scaled so it neither overflows nor underflows
    let m = 0; for (let i = 0; i < arguments.length; i++) { const v = abs(arguments[i]); if (v === Infinity) return Infinity; if (v !== v) m = NaN; else if (m === m && v > m) m = v; }
    if (m !== m) return NaN; if (m === 0) return 0;
    let sc = 1, inv = 1;
    if (m > 1e150) { sc = pow2(-600); inv = pow2(600); } else if (m < 1e-150) { sc = pow2(600); inv = pow2(-600); }
    let s = 0; for (let i = 0; i < arguments.length; i++) { const v = arguments[i] * sc; s += v * v; }
    return sqrt(s) * inv;
  }
  // acos/asin via atan2 of exactly-computed sqrt factors (used by Matter's Vertices.chamfer at body construction). |x| > 1 -> NaN.
  function acos(x) { if (x !== x || x > 1 || x < -1) return NaN; if (x === 1) return 0; if (x === -1) return PI; return 2 * atan2(sqrt(1 - x), sqrt(1 + x)); }
  function asin(x) { if (x !== x || x > 1 || x < -1) return NaN; if (x === 1) return PIO2; if (x === -1) return -PIO2; return atan2(x, sqrt((1 - x) * (1 + x))); }
  const PM = { sin, cos, tan, atan, atan2, asin, acos, exp, expm1, log, log1p, pow, tanh, hypot };
  root.__PM = PM;
  if (typeof module !== 'undefined' && module.exports) module.exports = PM;
})(typeof globalThis !== 'undefined' ? globalThis : this);
