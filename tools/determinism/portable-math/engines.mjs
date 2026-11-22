// Per-engine checks of the portable-math prototype (issue #121 Phase A): (1) fixed-input golden hashes must equal the committed values in chromium,
// firefox and webkit; (2) in-page micro-benchmark of the real in-simTick op mix (103 calls/tick), native vs portable, interleaved in one process, many reps.
//   xvfb-run -a node tools/determinism/portable-math/engines.mjs [reps]  -> docs/determinism/results/portable-math-engines.json
// Run on an otherwise idle machine. DIAGNOSTIC. Playwright WebKit is not Safari.
import { chromium, firefox, webkit } from 'playwright';
import { readFile, writeFile } from 'node:fs/promises';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const REPS = Number(process.argv[2] || 31);
const pm = await readFile(path.join(here, 'portable-math.cjs'), 'utf8'), gold = await readFile(path.join(here, 'golden.cjs'), 'utf8');
const expected = JSON.parse(await readFile(path.join(here, '..', '..', '..', 'docs', 'determinism', 'results', 'portable-math-golden.json'), 'utf8'));
const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const shell = readdirSync(root).filter((d) => /^chromium_headless_shell-\d/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell')).find(existsSync);
const ENG = { chromium: [chromium, { headless: true, executablePath: shell, args: ['--no-sandbox'] }], firefox: [firefox, { headless: true }], webkit: [webkit, { headless: true }] };
const out = { reps: REPS, expected, engines: {} };
for (const [name, [type, opts]] of Object.entries(ENG)) {
  const browser = await type.launch(opts), page = await browser.newPage();
  await page.goto('about:blank');
  await page.addScriptTag({ content: pm }); await page.addScriptTag({ content: gold });
  const r = await page.evaluate((REPS) => {
    const PM = window.__PM, g = window.__PM_GOLDEN(PM);
    const MIX = [['sin', 40], ['cos', 39], ['atan2', 6], ['hypot', 13], ['exp', 3], ['pow', 1], ['tan', 1]];
    const xs = new Float64Array(1024), ys = new Float64Array(1024);
    for (let i = 0; i < 1024; i++) { xs[i] = Math.sin(i * 0.37) * 6; ys[i] = 1 + Math.abs(Math.cos(i * 0.91)) * 9; }
    const mk = (M) => (n) => { let s = 0, j = 0; for (let t = 0; t < n; t++) for (let m = 0; m < MIX.length; m++) { const op = MIX[m][0], c = MIX[m][1]; for (let k = 0; k < c; k++) { const x = xs[j & 1023], y = ys[(j++ * 7) & 1023]; s += op === 'atan2' || op === 'hypot' || op === 'pow' ? M[op](x, y > 4 ? 1.5 : y) : M[op](x); } } return s; };
    const nat = mk(Math), prt = mk(PM); nat(2000); prt(2000);
    const N = 20000, A = [], B = [];
    for (let r = 0; r < REPS; r++) { let t0 = performance.now(); nat(N); A.push((performance.now() - t0) * 1000 / N); t0 = performance.now(); prt(N); B.push((performance.now() - t0) * 1000 / N); }
    const med = (a) => a.slice().sort((x, y) => x - y)[a.length >> 1];
    return { golden: g, nativeUsPerTickMedian: +med(A).toFixed(2), portableUsPerTickMedian: +med(B).toFixed(2), deltaUsMedian: +(med(B) - med(A)).toFixed(2), nativeRange: [Math.min(...A), Math.max(...A)].map((v) => +v.toFixed(2)), portableRange: [Math.min(...B), Math.max(...B)].map((v) => +v.toFixed(2)) };
  }, REPS);
  r.goldenMatchesCommitted = JSON.stringify(r.golden) === JSON.stringify(expected);
  out.engines[name] = r; await browser.close();
  console.log(name, 'golden', r.goldenMatchesCommitted, 'native', r.nativeUsPerTickMedian, 'portable', r.portableUsPerTickMedian, 'delta', r.deltaUsMedian, 'us/tick');
}
await writeFile(path.join(here, '..', '..', '..', 'docs', 'determinism', 'results', 'portable-math-engines.json'), JSON.stringify(out, null, 1));
