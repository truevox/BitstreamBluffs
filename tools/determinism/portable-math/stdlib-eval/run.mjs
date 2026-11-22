// Evaluation of the maintained @stdlib per-function math packages as a replacement for src/systems/pmath.js (issue #121, Phase B step 1).
// DIAGNOSTIC tooling; the result is recorded in docs/determinism/portable-math.md. Setup (outside the repo, nothing is added to package.json by this tool):
//   mkdir /tmp/stdlib-eval && cd /tmp/stdlib-eval && npm init -y && npm i --ignore-scripts --save-exact <the 19 @stdlib/math-base-special-* packages at the versions in the doc>
//   STDLIB_DIR=/tmp/stdlib-eval xvfb-run -a node tools/determinism/portable-math/stdlib-eval/run.mjs
// Checks: (1) golden hash of the stdlib bundle in Node, Chromium, Firefox, WebKit must be identical; (2) accuracy in ulp vs the host Math and vs pmath;
// (3) per-tick cost of the real in-simTick op mix, native / pmath / stdlib, interleaved in one process per engine; (4) bundle size.
import { chromium, firefox, webkit } from 'playwright';
import { build } from 'esbuild';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import zlib from 'node:zlib';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pmath from '../../../../src/systems/pmath.js';
import { pmathScript } from '../load-pmath.mjs';
import { createRequire } from 'node:module';
const here = path.dirname(fileURLToPath(import.meta.url));
const STD = process.env.STDLIB_DIR; if (!STD) throw new Error('set STDLIB_DIR to a directory with node_modules/@stdlib installed');
const golden = createRequire(import.meta.url)('../golden.cjs');
const out = { stdlibDir: 'STDLIB_DIR', packages: {} };
for (const f of readdirSync(path.join(STD, 'node_modules', '@stdlib')).filter((d) => d.startsWith('math-base-special-'))) { const pj = JSON.parse(readFileSync(path.join(STD, 'node_modules', '@stdlib', f, 'package.json'), 'utf8')); if (['sin','cos','tan','asin','acos','atan','atan2','exp','expm1','ln','log1p','log2','log10','pow','hypot','tanh','sinh','cosh','cbrt'].includes(f.replace('math-base-special-', ''))) out.packages[pj.name] = { version: pj.version, license: pj.license }; }
const res = await build({ entryPoints: [path.join(here, 'facade.mjs')], bundle: true, format: 'iife', globalName: '__SD', minify: true, write: false, nodePaths: [path.join(STD, 'node_modules')], logLevel: 'warning' });
const sdText = res.outputFiles[0].text + '\nglobalThis.__SDPM = __SD.default;';
const pmText = pmathScript();
out.bundle = { stdlibMinBytes: sdText.length, stdlibGzipBytes: zlib.gzipSync(sdText, { level: 9 }).length, pmathMinBytes: (await build({ entryPoints: [path.join(here, '..', '..', '..', '..', 'src', 'systems', 'pmath.js')], bundle: true, format: 'esm', minify: true, write: false })).outputFiles[0].text.length };
out.bundle.pmathGzipBytes = zlib.gzipSync((await build({ entryPoints: [path.join(here, '..', '..', '..', '..', 'src', 'systems', 'pmath.js')], bundle: true, format: 'esm', minify: true, write: false })).outputFiles[0].text, { level: 9 }).length;
const ctx = { globalThis: null }; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(sdText, ctx); const SD = ctx.__SDPM;

// ---- (1) golden hashes
const goldenNode = golden(SD); out.golden = { node: goldenNode, pmathNode: golden(pmath) };
// ---- (2) accuracy
const f = new Float64Array(2), u = new BigInt64Array(f.buffer);
const ulp = (a, b) => { if (a === b) return 0; if (a !== a || b !== b) return a !== a && b !== b ? 0 : Infinity; if ((a < 0) !== (b < 0)) return Infinity; f[0] = a; f[1] = b; const d = u[0] - u[1]; return Number(d < 0n ? -d : d); };
let seed = 4242; const rnd = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
const R = (s) => () => (rnd() - 0.5) * s, E = (s) => () => Math.exp((rnd() - 0.5) * s);
const DOM = { sin: [R(80)], cos: [R(80)], 'sin(|x|<2e6)': [R(4e6), 'sin'], 'sin(|x|<1e9)': [R(2e9), 'sin'], tan: [R(20)], asin: [() => rnd() * 2 - 1], acos: [() => rnd() * 2 - 1], atan: [R(40)], exp: [R(40)], expm1: [R(4)], log: [E(40)], log1p: [() => rnd() * 30], log2: [E(40)], log10: [E(40)], tanh: [R(8)], sinh: [R(10)], cosh: [R(10)], cbrt: [R(2000)] };
const N = 40000; out.accuracy = {};
const stat = (name, gen, fn, arity = 1) => { const hostMax = { v: 0 }, ours = { v: 0 }, hostEq = { v: 0 }, ourEq = { v: 0 }; for (let i = 0; i < N; i++) { const a = Array.from({ length: arity }, gen); const s = SD[fn](...a), h = Math[fn === 'log' ? 'log' : fn](...a), o = pmath[fn](...a); const d1 = ulp(s, h), d2 = ulp(s, o); hostMax.v = Math.max(hostMax.v, d1); ours.v = Math.max(ours.v, d2); if (d1 === 0) hostEq.v++; if (d2 === 0) ourEq.v++; } out.accuracy[name] = { stdlibVsHostMaxUlp: hostMax.v, stdlibVsHostExact: +(hostEq.v / N).toFixed(4), stdlibVsPmathMaxUlp: ours.v, stdlibVsPmathExact: +(ourEq.v / N).toFixed(4) }; };
for (const [k, [g, fn]] of Object.entries(DOM)) stat(k, g, fn || k);
stat('atan2', R(200), 'atan2', 2); stat('hypot', R(2000), 'hypot', 2);
{ const g = () => rnd() * 20, mk = (name, y) => { const hm = { v: 0 }, om = { v: 0 }; for (let i = 0; i < N; i++) { const x = g(); hm.v = Math.max(hm.v, ulp(SD.pow(x, y), Math.pow(x, y))); om.v = Math.max(om.v, ulp(SD.pow(x, y), pmath.pow(x, y))); } out.accuracy[name] = { stdlibVsHostMaxUlp: hm.v, stdlibVsPmathMaxUlp: om.v }; }; mk('pow(x,3)', 3); mk('pow(x,0.32)', 0.32); mk('pow(x,0.45)', 0.45); mk('pow(x,7.3)', 7.3); mk('pow(x,2)', 2); }
const big = {}; for (const x of [1e7, 1e9, 1e15, 1e22, 1e300]) big[x] = { host: Math.sin(x), stdlib: SD.sin(x), pmath: pmath.sin(x) }; out.largeArgSin = big;
// ---- (3)+(1b) per engine
const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const shell = readdirSync(root).filter((d) => /^chromium_headless_shell-\d/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell')).find(existsSync);
const ENG = { chromium: [chromium, { headless: true, executablePath: shell, args: ['--no-sandbox'] }], firefox: [firefox, { headless: true }], webkit: [webkit, { headless: true }] };
const goldText = readFileSync(path.join(here, '..', 'golden.cjs'), 'utf8');
out.engines = {};
for (const [name, [type, opts]] of Object.entries(ENG)) {
  const browser = await type.launch(opts), page = await browser.newPage(); await page.goto('about:blank');
  await page.addScriptTag({ content: pmText }); await page.addScriptTag({ content: sdText }); await page.addScriptTag({ content: goldText });
  const r = await page.evaluate(() => {
    const G = window.__PM_GOLDEN, SDm = window.__SDPM, PMm = window.__PM;
    const MIX = [['sin', 40], ['cos', 39], ['atan2', 6], ['hypot', 13], ['exp', 3], ['pow', 1], ['tan', 1]];
    const xs = new Float64Array(1024), ys = new Float64Array(1024); for (let i = 0; i < 1024; i++) { xs[i] = Math.sin(i * 0.37) * 6; ys[i] = 1 + Math.abs(Math.cos(i * 0.91)) * 9; }
    const mk = (M) => (n) => { let s = 0, j = 0; for (let t = 0; t < n; t++) for (let m = 0; m < MIX.length; m++) { const op = MIX[m][0], c = MIX[m][1]; for (let k = 0; k < c; k++) { const x = xs[j & 1023], y = ys[(j++ * 7) & 1023]; s += op === 'atan2' || op === 'hypot' || op === 'pow' ? M[op](x, y > 4 ? 1.5 : y) : M[op](x); } } return s; };
    const fns = { native: mk(Math), pmath: mk(PMm), stdlib: mk(SDm) }; for (const k in fns) fns[k](2000);
    const N = 20000, T = { native: [], pmath: [], stdlib: [] };
    for (let r = 0; r < 31; r++) for (const k of ['native', 'pmath', 'stdlib']) { const t0 = performance.now(); fns[k](N); T[k].push((performance.now() - t0) * 1000 / N); }
    const med = (a) => +a.slice().sort((x, y) => x - y)[a.length >> 1].toFixed(2);
    return { stdlibGolden: G(SDm), pmathGolden: G(PMm), usPerTickMedian: { native: med(T.native), pmath: med(T.pmath), stdlib: med(T.stdlib) } };
  });
  out.engines[name] = r; await browser.close();
  console.log(name, JSON.stringify(r.usPerTickMedian), 'golden equals node:', JSON.stringify(r.stdlibGolden) === JSON.stringify(goldenNode));
}
out.goldenIdenticalAcrossEngines = Object.values(out.engines).every((e) => JSON.stringify(e.stdlibGolden) === JSON.stringify(goldenNode));
out.pmathGoldenIdenticalAcrossEngines = Object.values(out.engines).every((e) => JSON.stringify(e.pmathGolden) === JSON.stringify(out.golden.pmathNode));
writeFileSync(path.join(here, '..', '..', '..', '..', 'docs', 'determinism', 'results', 'portable-math-stdlib-eval.json'), JSON.stringify(out, null, 1));
console.log('stdlib golden identical across node+3 engines:', out.goldenIdenticalAcrossEngines, '| pmath:', out.pmathGoldenIdenticalAcrossEngines, '| bundle', JSON.stringify(out.bundle));
