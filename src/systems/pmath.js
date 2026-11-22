/**
 * pmath: the single import point for the math functions that ECMAScript does not require to be bit-identical across engines
 * (issue #121). Every authoritative simulation file imports these instead of the native Math.sin/cos/tan/asin/acos/atan/atan2/
 * exp/expm1/log/log1p/log2/log10/pow/hypot/tanh/sinh/cosh/cbrt; presentation-only code (audio, backgrounds, UI, particles) stays on
 * native Math. The boundary is enforced by tests/determinism/sim-math-boundary.test.js.
 *
 * Implementation: the maintained @stdlib/math-base-special-* packages (Apache-2.0, ports of FreeBSD msun / fdlibm / Boost algorithms
 * in pure JS: only IEEE + - * / sqrt floor abs, no native transcendental, no FMA). They are pinned to exact versions in package.json
 * and package-lock.json, and evaluated in docs/determinism/portable-math.md (golden hashes identical in Node, Chromium, Firefox and
 * WebKit; accuracy <= 1 to 2 ulp vs V8; per-engine cost at the real op mix). This module is a thin facade so call sites never import
 * the packages directly and the implementation can be swapped without touching them.
 *
 * Changing ANY result bit of ANY function here (a version bump of any @stdlib package, or swapping the implementation) changes
 * simulation outcomes: bump SIM_REVISION (ruleset.js) and re-record fixtures. tests/determinism/pmath.test.js pins the outputs with
 * fixed-input golden hashes (docs/determinism/results/portable-math-golden.json).
 */
import sin from '@stdlib/math-base-special-sin';
import cos from '@stdlib/math-base-special-cos';
import tan from '@stdlib/math-base-special-tan';
import asin from '@stdlib/math-base-special-asin';
import acos from '@stdlib/math-base-special-acos';
import atan from '@stdlib/math-base-special-atan';
import atan2 from '@stdlib/math-base-special-atan2';
import exp from '@stdlib/math-base-special-exp';
import expm1 from '@stdlib/math-base-special-expm1';
import log from '@stdlib/math-base-special-ln';
import log1p from '@stdlib/math-base-special-log1p';
import log2 from '@stdlib/math-base-special-log2';
import log10 from '@stdlib/math-base-special-log10';
import pow from '@stdlib/math-base-special-pow';
import hypot from '@stdlib/math-base-special-hypot';
import tanh from '@stdlib/math-base-special-tanh';
import sinh from '@stdlib/math-base-special-sinh';
import cosh from '@stdlib/math-base-special-cosh';
import cbrt from '@stdlib/math-base-special-cbrt';

export const pmath = Object.freeze({ sin, cos, tan, asin, acos, atan, atan2, exp, expm1, log, log1p, log2, log10, pow, hypot, tanh, sinh, cosh, cbrt });
export { sin, cos, tan, asin, acos, atan, atan2, exp, expm1, log, log1p, log2, log10, pow, hypot, tanh, sinh, cosh, cbrt };
export default pmath;
