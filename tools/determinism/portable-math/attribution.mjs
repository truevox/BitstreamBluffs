// Call-site attribution of non-IEEE-exact Math calls (issue #121, Phase A). Needs an UNMINIFIED dev server (`npx vite --port N`) so stacks name
// real files. Replays fixture tapes (chromium) in 'count' mode and, for each Math call, records op, whether it ran inside RunScene.simTick, and the
// first frame outside Math plus the nearest src/ frame. Sampled (every call for rare ops, 1/N for hot presentation ops) to stay cheap.
//   GAME_URL=http://localhost:8443/ node tools/determinism/portable-math/attribution.mjs [fixtureId...]  -> JSON on stdout
import { chromium } from 'playwright';
import { readFile } from 'node:fs/promises';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { FIXTURES } from './fixtures.mjs';
const here = path.dirname(fileURLToPath(import.meta.url));
const url = process.env.GAME_URL || 'http://localhost:8443/';
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['collision-heavy', 'kodiaks-on'];
const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
const exe = readdirSync(root).filter((d) => /^chromium_headless_shell-\d/.test(d)).sort().reverse().map((d) => path.join(root, d, 'chrome-headless-shell-linux64', 'chrome-headless-shell')).find(existsSync);
const pageJs = await readFile(path.join(here, 'page.js'), 'utf8'), pmJs = await readFile(path.join(here, 'portable-math.cjs'), 'utf8');
const browser = await chromium.launch({ headless: true, executablePath: exe, args: ['--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist'] });
const agg = {};
for (const id of ids) {
  const f = FIXTURES.find((x) => x.id === id), tape = JSON.parse(await readFile(path.join(here, 'fixtures', `${id}.tape.json`), 'utf8'));
  const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } }), page = await ctx.newPage();
  await page.addInitScript(`window.__cePatch = { ops: [], mode: 'count' };`);
  await page.addInitScript(pmJs); await page.addInitScript(pageJs);
  await page.addInitScript(`(() => { window.__attr = {}; const HOT = { sin: 40, cos: 40, atan2: 4, hypot: 4, exp: 4, pow: 1, tan: 1, tanh: 1, log: 1, log1p: 1 }; const seen = {};
    for (const n of Object.keys(HOT)) { const inner = Math[n]; Math[n] = function () { const k = (seen[n] = (seen[n] || 0) + 1); if (k % HOT[n] === 0) {
      const ins = window.__PMX.COUNT.depth > 0, st = (new Error().stack || '').split('\\n').slice(2);
      const clean = (l) => l.replace(/^\\s*at /, '').replace(/https?:\\/\\/[^/]+/, '').replace(/\\?v=\\w+/, '').replace(/:\\d+:\\d+\\)?$/, '');
      const first = clean(st[0] || '?'), src = st.map(clean).find((l) => l.includes('/src/') && !l.includes('page.js')) || '-';
      const key = n + ' | ' + (ins ? 'IN-simTick' : 'outside') + ' | ' + first + ' | via ' + src;
      window.__attr[key] = (window.__attr[key] || 0) + HOT[n]; } return inner.apply(Math, arguments); }; } })();`);
  await page.addInitScript(`(() => { const R = Date, base = R.parse('2026-11-21T12:00:00Z'), t0 = R.now(); const now = () => base + (R.now() - t0); function D(...a) { return a.length ? new R(...a) : new R(now()); } D.prototype = R.prototype; D.now = now; D.parse = R.parse; D.UTC = R.UTC; window.Date = D; })();`);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => window.__bbGame?.scene?.getScene('TitleScene')?.sys?.isActive() && window.__ce, null, { timeout: 90000 });
  await page.evaluate((x) => window.__ce.play(x), { seed: f.seed, hz: 120, tape, level: f.kodiaks ? 8 : 1, raster: false });
  const a = await page.evaluate(() => window.__attr);
  for (const [k, v] of Object.entries(a)) agg[k] = (agg[k] || 0) + v;
  await ctx.close();
}
await browser.close();
console.log(JSON.stringify({ fixtures: ids, approxCalls: Object.fromEntries(Object.entries(agg).sort((x, y) => y[1] - x[1])) }, null, 1));
